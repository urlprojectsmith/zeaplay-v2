import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BillingHistoryEventType,
  BillingUsageScope,
  MembershipStatus,
  PlanEntitlementKind,
  Prisma,
  SuperAgencySubscriptionStatus,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  BILLING_RESOURCE_CATALOG,
  BILLING_RESOURCE_KEYS,
  DEFAULT_AGENCY_WORKSPACE_ALLOCATION,
  type BillingResourceKey,
  type PlanFeatureKey,
  type PlanLimitKey,
} from './billing.constants';

type Tx = Prisma.TransactionClient;

type LimitResolution =
  | { managed: false; unlimited: true; value: null }
  | { managed: true; unlimited: true; value: null }
  | { managed: true; unlimited: false; value: bigint };

type AllocationValue =
  | { configured: false; unlimited: false; value: null }
  | { configured: true; unlimited: true; value: null }
  | { configured: true; unlimited: false; value: bigint };

const activeCommercialStatuses = new Set<SuperAgencySubscriptionStatus>([
  SuperAgencySubscriptionStatus.TRIALING,
  SuperAgencySubscriptionStatus.ACTIVE,
  SuperAgencySubscriptionStatus.PAST_DUE,
  SuperAgencySubscriptionStatus.GRACE_PERIOD,
  SuperAgencySubscriptionStatus.TRIAL_GRACE,
  SuperAgencySubscriptionStatus.PAYMENT_GRACE,
]);

@Injectable()
export class BillingEntitlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  monthlyPeriod(date = new Date()) {
    const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, 0, 0, 0, 0));
    return { start, end };
  }

  async getEffectiveEntitlements(superAgencyId: string) {
    const subscription = await this.currentSubscription(this.prisma, superAgencyId);
    const planEntitlements = subscription?.planVersion.entitlements ?? [];
    const overrideRows = await this.prisma.featureEntitlement.findMany({
      where: { superAgencyId },
      select: { enabled: true, feature: { select: { key: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    const overrides = new Map(overrideRows.map((row) => [row.feature.key, row.enabled]));
    const features = [
      ...new Set([...planEntitlements.map((item) => item.key), ...overrides.keys()]),
    ]
      .filter((key): key is PlanFeatureKey => isPlanFeatureKey(key))
      .map((key) => {
        const plan = planEntitlements.find(
          (item) => item.kind === PlanEntitlementKind.FEATURE && item.key === key,
        );
        const planEnabled = plan?.booleanValue === true;
        const override = overrides.get(key);
        const enabled = subscription ? planEnabled && override !== false : override === true;
        return { key, enabled, source: subscription ? 'PLAN_AND_OVERRIDE' : 'DIRECT_OVERRIDE' };
      });
    return {
      superAgencyId,
      enforcementMode: subscription ? 'MANAGED' : 'UNMANAGED',
      hasCurrentSubscription: Boolean(subscription),
      subscription,
      features,
      limits: planEntitlements
        .filter((item) => item.kind === PlanEntitlementKind.LIMIT)
        .map((item) => ({
          key: item.key,
          valueType: item.valueType,
          unlimited: item.unlimited,
          value: item.numericValue?.toString() ?? null,
        })),
    };
  }

  async resolveEffectiveFeature(superAgencyId: string, featureKey: PlanFeatureKey) {
    const entitlements = await this.getEffectiveEntitlements(superAgencyId);
    const feature = entitlements.features.find((item) => item.key === featureKey);
    return {
      superAgencyId,
      featureKey,
      enabled: feature?.enabled === true,
      enforcementMode: entitlements.enforcementMode,
    };
  }

  async assertFeatureAvailable(superAgencyId: string, featureKey: PlanFeatureKey) {
    const feature = await this.resolveEffectiveFeature(superAgencyId, featureKey);
    if (feature.enforcementMode === 'UNMANAGED') return feature;
    if (!feature.enabled) {
      throw new ForbiddenException({
        code: 'FEATURE_NOT_ENTITLED',
        message: 'Feature is not available on the current plan.',
        featureKey,
      });
    }
    return feature;
  }

  async assertWorkspaceFeatureAvailable(workspaceId: string, featureKey: PlanFeatureKey) {
    return this.prisma.$transaction((tx) =>
      this.assertWorkspaceFeatureAvailableTx(tx, workspaceId, featureKey),
    );
  }

  async assertWorkspaceFeatureAvailableTx(tx: Tx, workspaceId: string, featureKey: PlanFeatureKey) {
    const context = await this.workspaceContextTx(tx, workspaceId);
    const subscription = await this.currentSubscription(tx, context.superAgencyId);
    if (!subscription) return false;
    await this.assertFeatureAvailableTx(tx, context.superAgencyId, featureKey);
    this.assertManagedCommercialAccess(subscription);
    return true;
  }

  async assertAgencyCreationAvailable(superAgencyId: string) {
    return this.prisma.$transaction((tx) =>
      this.assertAgencyCreationAvailableTx(tx, superAgencyId),
    );
  }

  async assertAgencyCreationAvailableTx(tx: Tx, superAgencyId: string) {
    await lock(tx, `billing-allocation:${superAgencyId}`);
    const agencyLimit = await this.resolveEffectiveLimitTx(
      tx,
      superAgencyId,
      BILLING_RESOURCE_KEYS.agencies,
    );
    if (!agencyLimit.managed) return;
    this.assertManagedCommercialAccess(await this.currentSubscription(tx, superAgencyId));
    if (!agencyLimit.unlimited) {
      const used = BigInt(await tx.agency.count({ where: { superAgencyId } }));
      this.assertWithinCapacity(BILLING_RESOURCE_KEYS.agencies, used, agencyLimit.value, 1n);
    }
    const workspaceLimit = await this.resolveEffectiveLimitTx(
      tx,
      superAgencyId,
      BILLING_RESOURCE_KEYS.workspaces,
    );
    if (!workspaceLimit.unlimited) {
      const allocated = await this.sumAgencyAllocationsTx(
        tx,
        superAgencyId,
        BILLING_RESOURCE_KEYS.workspaces,
      );
      this.assertWithinCapacity(
        BILLING_RESOURCE_KEYS.workspaces,
        allocated,
        workspaceLimit.value,
        BigInt(DEFAULT_AGENCY_WORKSPACE_ALLOCATION),
      );
    }
  }

  async assignDefaultAgencyAllocationTx(tx: Tx, agencyId: string, actorUserId?: string) {
    const agency = await tx.agency.findUnique({
      where: { id: agencyId },
      select: { superAgencyId: true },
    });
    if (!agency) throw new NotFoundException('Agency not found.');
    const subscription = await this.currentSubscription(tx, agency.superAgencyId);
    if (!subscription) return;
    await tx.agencyResourceAllocation.create({
      data: {
        agencyId,
        resourceKey: BILLING_RESOURCE_KEYS.workspaces,
        allocated: BigInt(DEFAULT_AGENCY_WORKSPACE_ALLOCATION),
        unlimited: false,
        createdById: actorUserId,
        updatedById: actorUserId,
      },
    });
  }

  async assertWorkspaceCreationAvailable(agencyId: string) {
    return this.prisma.$transaction((tx) => this.assertWorkspaceCreationAvailableTx(tx, agencyId));
  }

  async assertWorkspaceCreationAvailableTx(tx: Tx, agencyId: string) {
    const agency = await tx.agency.findUnique({
      where: { id: agencyId },
      select: { id: true, superAgencyId: true },
    });
    if (!agency) throw new NotFoundException('Agency not found.');
    await lock(tx, `billing-allocation:${agency.superAgencyId}`);
    const parentLimit = await this.resolveAgencyAllocationTx(
      tx,
      agencyId,
      BILLING_RESOURCE_KEYS.workspaces,
    );
    if (!parentLimit.configured) return;
    if (parentLimit.unlimited) return;
    const used = BigInt(await tx.workspace.count({ where: { agencyId } }));
    this.assertWithinCapacity(BILLING_RESOURCE_KEYS.workspaces, used, parentLimit.value, 1n);
  }

  async assertWorkspaceMembershipAvailable(workspaceId: string) {
    return this.prisma.$transaction((tx) =>
      this.assertWorkspaceMembershipAvailableTx(tx, workspaceId),
    );
  }

  async assertWorkspaceMembershipAvailableTx(tx: Tx, workspaceId: string) {
    const context = await this.workspaceContextTx(tx, workspaceId);
    await lock(tx, `billing-allocation:${context.superAgencyId}`);
    await this.assertHierarchicalLiveCapacityTx(
      tx,
      context,
      BILLING_RESOURCE_KEYS.workspaceMemberships,
      1n,
    );
  }

  async assertWorkspaceStorageAvailableTx(tx: Tx, workspaceId: string, requestedBytes: bigint) {
    const context = await this.workspaceContextTx(tx, workspaceId);
    const subscription = await this.currentSubscription(tx, context.superAgencyId);
    if (!subscription) return false;
    await lock(tx, `billing-allocation:${context.superAgencyId}`);
    await this.assertFeatureAvailableTx(tx, context.superAgencyId, 'files.enabled');
    this.assertManagedCommercialAccess(subscription);
    await this.assertHierarchicalLiveCapacityTx(
      tx,
      context,
      BILLING_RESOURCE_KEYS.storageBytes,
      requestedBytes,
    );
    return true;
  }

  async assertActiveAutomationAvailableTx(tx: Tx, workspaceId: string, workflowId: string) {
    const context = await this.workspaceContextTx(tx, workspaceId);
    const subscription = await this.currentSubscription(tx, context.superAgencyId);
    if (!subscription) return false;
    await lock(tx, `billing-allocation:${context.superAgencyId}`);
    await this.assertFeatureAvailableTx(tx, context.superAgencyId, 'automation.enabled');
    this.assertManagedCommercialAccess(subscription);
    await this.assertHierarchicalActiveAutomationCapacityTx(tx, context, workflowId);
    return true;
  }

  async reserveAutomationExecutionUsageTx(tx: Tx, workspaceId: string) {
    const context = await this.workspaceContextTx(tx, workspaceId);
    const subscription = await this.currentSubscription(tx, context.superAgencyId);
    if (!subscription) return false;
    await lock(tx, `billing-usage:${context.superAgencyId}`);
    await this.assertFeatureAvailableTx(tx, context.superAgencyId, 'automation.enabled');
    this.assertManagedCommercialAccess(subscription);
    await this.reserveHierarchicalPeriodUsageTx(
      tx,
      context,
      BILLING_RESOURCE_KEYS.automationExecutions,
    );
    return true;
  }

  async reservePublicApiRequestUsageTx(tx: Tx, workspaceId: string) {
    const context = await this.workspaceContextTx(tx, workspaceId);
    const subscription = await this.currentSubscription(tx, context.superAgencyId);
    if (!subscription) return false;
    await lock(tx, `billing-usage:${context.superAgencyId}`);
    await this.assertFeatureAvailableTx(tx, context.superAgencyId, 'api.enabled');
    this.assertManagedCommercialAccess(subscription);
    await this.reserveHierarchicalPeriodUsageTx(tx, context, BILLING_RESOURCE_KEYS.apiRequests);
    return true;
  }

  async reservePublicApiRequestUsage(workspaceId: string) {
    return this.prisma.$transaction((tx) => this.reservePublicApiRequestUsageTx(tx, workspaceId), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  }

  async updateAgencyAllocation(input: {
    superAgencyId: string;
    agencyId: string;
    resourceKey: BillingResourceKey;
    allocated?: number;
    unlimited?: boolean;
    actorUserId?: string;
  }) {
    const resourceKey = assertAllocatableResource(input.resourceKey);
    const updated = await this.prisma.$transaction(async (tx) => {
      await lock(tx, `billing-allocation:${input.superAgencyId}`);
      const agency = await tx.agency.findFirst({
        where: { id: input.agencyId, superAgencyId: input.superAgencyId },
        select: { id: true },
      });
      if (!agency) throw new NotFoundException('Agency not found.');
      const parent = await this.resolveEffectiveLimitTx(tx, input.superAgencyId, resourceKey);
      if (parent.managed && !parent.unlimited) {
        const siblingAllocated = await this.sumAgencyAllocationsTx(
          tx,
          input.superAgencyId,
          resourceKey,
          input.agencyId,
        );
        const requested = input.unlimited ? null : BigInt(input.allocated ?? 0);
        if (requested === null) {
          throw new ForbiddenException({
            code: 'ALLOCATION_EXCEEDED',
            message: 'Finite parent capacity cannot grant unlimited child allocation.',
            resourceKey,
          });
        }
        this.assertWithinCapacity(resourceKey, siblingAllocated, parent.value, requested);
      }
      return tx.agencyResourceAllocation.upsert({
        where: { agencyId_resourceKey: { agencyId: input.agencyId, resourceKey } },
        update: {
          allocated: input.unlimited ? null : BigInt(input.allocated ?? 0),
          unlimited: input.unlimited === true,
          updatedById: input.actorUserId,
        },
        create: {
          agencyId: input.agencyId,
          resourceKey,
          allocated: input.unlimited ? null : BigInt(input.allocated ?? 0),
          unlimited: input.unlimited === true,
          createdById: input.actorUserId,
          updatedById: input.actorUserId,
        },
      });
    });
    await this.audit.record({
      superAgencyId: input.superAgencyId,
      agencyId: input.agencyId,
      userId: input.actorUserId,
      action: 'billing.allocation.agency_updated',
      entityType: 'AgencyResourceAllocation',
      entityId: updated.id,
      metadata: { resourceKey, allocated: updated.allocated?.toString() ?? null, updated: true },
    });
    await this.prisma.billingHistory.create({
      data: {
        superAgencyId: input.superAgencyId,
        eventType: BillingHistoryEventType.ALLOCATION_UPDATED,
        actorUserId: input.actorUserId,
        metadata: {
          scope: 'AGENCY',
          agencyId: input.agencyId,
          resourceKey,
          allocated: updated.allocated?.toString() ?? null,
          unlimited: updated.unlimited,
        },
      },
    });
    return this.agencyUsage(input.agencyId);
  }

  async updateWorkspaceAllocation(input: {
    agencyId: string;
    workspaceId: string;
    resourceKey: BillingResourceKey;
    allocated?: number;
    unlimited?: boolean;
    actorUserId?: string;
  }) {
    const resourceKey = assertAllocatableResource(input.resourceKey);
    const updated = await this.prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.findFirst({
        where: { id: input.workspaceId, agencyId: input.agencyId },
        select: { id: true, agency: { select: { superAgencyId: true } } },
      });
      if (!workspace) throw new NotFoundException('Workspace not found.');
      await lock(tx, `billing-allocation:${workspace.agency.superAgencyId}`);
      const parent = await this.resolveAgencyAllocationTx(tx, input.agencyId, resourceKey);
      if (parent.configured && !parent.unlimited) {
        const siblingAllocated = await this.sumWorkspaceAllocationsTx(
          tx,
          input.agencyId,
          resourceKey,
          input.workspaceId,
        );
        const requested = input.unlimited ? null : BigInt(input.allocated ?? 0);
        if (requested === null) {
          throw new ForbiddenException({
            code: 'ALLOCATION_EXCEEDED',
            message: 'Finite Agency allocation cannot grant unlimited Workspace allocation.',
            resourceKey,
          });
        }
        this.assertWithinCapacity(resourceKey, siblingAllocated, parent.value, requested);
      }
      return tx.workspaceResourceAllocation.upsert({
        where: { workspaceId_resourceKey: { workspaceId: input.workspaceId, resourceKey } },
        update: {
          allocated: input.unlimited ? null : BigInt(input.allocated ?? 0),
          unlimited: input.unlimited === true,
          updatedById: input.actorUserId,
        },
        create: {
          workspaceId: input.workspaceId,
          resourceKey,
          allocated: input.unlimited ? null : BigInt(input.allocated ?? 0),
          unlimited: input.unlimited === true,
          createdById: input.actorUserId,
          updatedById: input.actorUserId,
        },
      });
    });
    await this.audit.record({
      agencyId: input.agencyId,
      workspaceId: input.workspaceId,
      userId: input.actorUserId,
      action: 'billing.allocation.workspace_updated',
      entityType: 'WorkspaceResourceAllocation',
      entityId: updated.id,
      metadata: { resourceKey, allocated: updated.allocated?.toString() ?? null, updated: true },
    });
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: input.workspaceId },
      select: { agency: { select: { superAgencyId: true } } },
    });
    await this.prisma.billingHistory.create({
      data: {
        superAgencyId: workspace?.agency.superAgencyId,
        eventType: BillingHistoryEventType.ALLOCATION_UPDATED,
        actorUserId: input.actorUserId,
        metadata: {
          scope: 'WORKSPACE',
          agencyId: input.agencyId,
          workspaceId: input.workspaceId,
          resourceKey,
          allocated: updated.allocated?.toString() ?? null,
          unlimited: updated.unlimited,
        },
      },
    });
    return this.workspaceUsage(input.workspaceId);
  }

  async superAgencyUsage(superAgencyId: string) {
    const [entitlements, agencies, workspaces, memberships, storage, automation, executions, api] =
      await Promise.all([
        this.getEffectiveEntitlements(superAgencyId),
        this.liveUsage('SUPER_AGENCY', superAgencyId, BILLING_RESOURCE_KEYS.agencies),
        this.liveUsage('SUPER_AGENCY', superAgencyId, BILLING_RESOURCE_KEYS.workspaces),
        this.liveUsage('SUPER_AGENCY', superAgencyId, BILLING_RESOURCE_KEYS.workspaceMemberships),
        this.liveUsage('SUPER_AGENCY', superAgencyId, BILLING_RESOURCE_KEYS.storageBytes),
        this.liveUsage('SUPER_AGENCY', superAgencyId, BILLING_RESOURCE_KEYS.activeAutomations),
        this.periodUsage(
          BillingUsageScope.SUPER_AGENCY,
          superAgencyId,
          BILLING_RESOURCE_KEYS.automationExecutions,
        ),
        this.periodUsage(
          BillingUsageScope.SUPER_AGENCY,
          superAgencyId,
          BILLING_RESOURCE_KEYS.apiRequests,
        ),
      ]);
    const resources = await Promise.all([
      this.superAgencyResourceSummary(superAgencyId, BILLING_RESOURCE_KEYS.agencies, agencies),
      this.superAgencyResourceSummary(superAgencyId, BILLING_RESOURCE_KEYS.workspaces, workspaces),
      this.superAgencyResourceSummary(
        superAgencyId,
        BILLING_RESOURCE_KEYS.workspaceMemberships,
        memberships,
      ),
      this.superAgencyResourceSummary(superAgencyId, BILLING_RESOURCE_KEYS.storageBytes, storage),
      this.superAgencyResourceSummary(
        superAgencyId,
        BILLING_RESOURCE_KEYS.activeAutomations,
        automation,
      ),
      this.resourceSummary(
        superAgencyId,
        BILLING_RESOURCE_KEYS.automationExecutions,
        executions.used,
      ),
      this.resourceSummary(superAgencyId, BILLING_RESOURCE_KEYS.apiRequests, api.used),
    ]);
    return {
      superAgencyId,
      enforcementMode: entitlements.enforcementMode,
      resources,
      period: executions.period,
    };
  }

  async agencyUsage(agencyId: string) {
    const agency = await this.prisma.agency.findUnique({
      where: { id: agencyId },
      select: { id: true, superAgencyId: true },
    });
    if (!agency) throw new NotFoundException('Agency not found.');
    const resources = await Promise.all([
      this.agencyResourceSummary(agencyId, BILLING_RESOURCE_KEYS.workspaces),
      this.agencyResourceSummary(agencyId, BILLING_RESOURCE_KEYS.workspaceMemberships),
      this.agencyResourceSummary(agencyId, BILLING_RESOURCE_KEYS.storageBytes),
      this.agencyResourceSummary(agencyId, BILLING_RESOURCE_KEYS.activeAutomations),
      this.allocatedResourceSummary('AGENCY', agencyId, BILLING_RESOURCE_KEYS.automationExecutions),
      this.allocatedResourceSummary('AGENCY', agencyId, BILLING_RESOURCE_KEYS.apiRequests),
    ]);
    return { agencyId, superAgencyId: agency.superAgencyId, resources };
  }

  async workspaceUsage(workspaceId: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, agencyId: true, agency: { select: { superAgencyId: true } } },
    });
    if (!workspace) throw new NotFoundException('Workspace not found.');
    const resources = await Promise.all([
      this.allocatedResourceSummary(
        'WORKSPACE',
        workspaceId,
        BILLING_RESOURCE_KEYS.workspaceMemberships,
      ),
      this.allocatedResourceSummary('WORKSPACE', workspaceId, BILLING_RESOURCE_KEYS.storageBytes),
      this.allocatedResourceSummary(
        'WORKSPACE',
        workspaceId,
        BILLING_RESOURCE_KEYS.activeAutomations,
      ),
      this.allocatedResourceSummary(
        'WORKSPACE',
        workspaceId,
        BILLING_RESOURCE_KEYS.automationExecutions,
      ),
      this.allocatedResourceSummary('WORKSPACE', workspaceId, BILLING_RESOURCE_KEYS.apiRequests),
    ]);
    return {
      workspaceId,
      agencyId: workspace.agencyId,
      superAgencyId: workspace.agency.superAgencyId,
      resources,
    };
  }

  private async currentSubscription(tx: Tx | PrismaService, superAgencyId: string) {
    return tx.superAgencySubscription.findFirst({
      where: {
        superAgencyId,
        isCurrent: true,
        status: {
          in: [
            SuperAgencySubscriptionStatus.TRIALING,
            SuperAgencySubscriptionStatus.ACTIVE,
            SuperAgencySubscriptionStatus.PAST_DUE,
            SuperAgencySubscriptionStatus.GRACE_PERIOD,
            SuperAgencySubscriptionStatus.TRIAL_GRACE,
            SuperAgencySubscriptionStatus.PAYMENT_GRACE,
            SuperAgencySubscriptionStatus.RESTRICTED,
            SuperAgencySubscriptionStatus.SUSPENDED,
          ],
        },
      },
      select: {
        id: true,
        superAgencyId: true,
        masterPlanId: true,
        planVersionId: true,
        status: true,
        graceEndsAt: true,
        planVersion: {
          select: {
            entitlements: {
              select: {
                key: true,
                kind: true,
                valueType: true,
                booleanValue: true,
                numericValue: true,
                unlimited: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private assertManagedCommercialAccess(
    subscription: Awaited<ReturnType<BillingEntitlementService['currentSubscription']>>,
  ) {
    if (!subscription) return;
    if (!activeCommercialStatuses.has(subscription.status)) {
      throw new ForbiddenException({
        code: 'ACCOUNT_RESTRICTED',
        message: 'Commercial account is restricted.',
      });
    }
  }

  private async resolveEffectiveLimitTx(
    tx: Tx,
    superAgencyId: string,
    resourceKey: BillingResourceKey,
  ): Promise<LimitResolution> {
    const subscription = await this.currentSubscription(tx, superAgencyId);
    if (!subscription) return { managed: false, unlimited: true, value: null };
    const catalogItem = BILLING_RESOURCE_CATALOG[resourceKey] as {
      limitKeys?: readonly PlanLimitKey[];
    };
    const limitKeys = catalogItem.limitKeys ?? [];
    for (const key of limitKeys) {
      const entitlement = subscription.planVersion.entitlements.find(
        (item) => item.kind === PlanEntitlementKind.LIMIT && item.key === key,
      );
      if (!entitlement) continue;
      if (entitlement.unlimited) return { managed: true, unlimited: true, value: null };
      return { managed: true, unlimited: false, value: entitlement.numericValue ?? 0n };
    }
    return { managed: true, unlimited: false, value: 0n };
  }

  private async resolveAgencyAllocationTx(
    tx: Tx,
    agencyId: string,
    resourceKey: BillingResourceKey,
  ): Promise<AllocationValue> {
    const row = await tx.agencyResourceAllocation.findUnique({
      where: { agencyId_resourceKey: { agencyId, resourceKey } },
      select: { allocated: true, unlimited: true },
    });
    if (!row) return { configured: false, unlimited: false, value: null };
    if (row.unlimited) return { configured: true, unlimited: true, value: null };
    return { configured: true, unlimited: false, value: row.allocated ?? 0n };
  }

  private async resolveWorkspaceAllocationTx(
    tx: Tx,
    workspaceId: string,
    resourceKey: BillingResourceKey,
  ): Promise<AllocationValue> {
    const row = await tx.workspaceResourceAllocation.findUnique({
      where: { workspaceId_resourceKey: { workspaceId, resourceKey } },
      select: { allocated: true, unlimited: true },
    });
    if (!row) return { configured: false, unlimited: false, value: null };
    if (row.unlimited) return { configured: true, unlimited: true, value: null };
    return { configured: true, unlimited: false, value: row.allocated ?? 0n };
  }

  private async sumAgencyAllocationsTx(
    tx: Tx,
    superAgencyId: string,
    resourceKey: BillingResourceKey,
    exceptAgencyId?: string,
  ) {
    const rows = await tx.agencyResourceAllocation.findMany({
      where: {
        resourceKey,
        agency: { superAgencyId },
        ...(exceptAgencyId ? { agencyId: { not: exceptAgencyId } } : {}),
      },
      select: { allocated: true, unlimited: true },
    });
    if (rows.some((row) => row.unlimited)) return BigInt(Number.MAX_SAFE_INTEGER);
    return rows.reduce((sum, row) => sum + (row.allocated ?? 0n), 0n);
  }

  private async sumWorkspaceAllocationsTx(
    tx: Tx,
    agencyId: string,
    resourceKey: BillingResourceKey,
    exceptWorkspaceId?: string,
  ) {
    const rows = await tx.workspaceResourceAllocation.findMany({
      where: {
        resourceKey,
        workspace: { agencyId },
        ...(exceptWorkspaceId ? { workspaceId: { not: exceptWorkspaceId } } : {}),
      },
      select: { allocated: true, unlimited: true },
    });
    if (rows.some((row) => row.unlimited)) return BigInt(Number.MAX_SAFE_INTEGER);
    return rows.reduce((sum, row) => sum + (row.allocated ?? 0n), 0n);
  }

  private assertWithinCapacity(
    resourceKey: BillingResourceKey,
    used: bigint,
    limit: bigint,
    requested: bigint,
  ) {
    const remaining = limit - used;
    if (remaining < requested) {
      throw new ForbiddenException({
        code: 'RESOURCE_LIMIT_EXCEEDED',
        message: 'Resource limit exceeded.',
        resourceKey,
        limit: limit.toString(),
        used: used.toString(),
        remaining: remaining > 0n ? remaining.toString() : '0',
        requested: requested.toString(),
      });
    }
  }

  private async resourceSummary(
    superAgencyId: string,
    resourceKey: BillingResourceKey,
    used: bigint,
  ) {
    const limit = await this.prisma.$transaction((tx) =>
      this.resolveEffectiveLimitTx(tx, superAgencyId, resourceKey),
    );
    return buildSummary(resourceKey, used, limit);
  }

  private async superAgencyResourceSummary(
    superAgencyId: string,
    resourceKey: BillingResourceKey,
    used: bigint,
  ) {
    const summary = await this.resourceSummary(superAgencyId, resourceKey, used);
    return this.withChildAllocation(summary, async (tx) =>
      this.childAgencyAllocationTx(tx, superAgencyId, resourceKey),
    );
  }

  private async agencyResourceSummary(agencyId: string, resourceKey: BillingResourceKey) {
    const summary = await this.allocatedResourceSummary('AGENCY', agencyId, resourceKey);
    return this.withChildAllocation(summary, async (tx) =>
      this.childWorkspaceAllocationTx(tx, agencyId, resourceKey),
    );
  }

  private async allocatedResourceSummary(
    scope: 'AGENCY' | 'WORKSPACE',
    scopeId: string,
    resourceKey: BillingResourceKey,
  ) {
    const [used, allocation] = await this.prisma.$transaction(async (tx) => {
      const usage = await this.liveUsage(scope, scopeId, resourceKey, tx);
      const resolved =
        scope === 'AGENCY'
          ? await this.resolveAgencyAllocationTx(tx, scopeId, resourceKey)
          : await this.resolveWorkspaceAllocationTx(tx, scopeId, resourceKey);
      return [usage, resolved] as const;
    });
    return buildSummary(resourceKey, used, allocation);
  }

  private async withChildAllocation(
    summary: ReturnType<typeof buildSummary>,
    load: (tx: Tx) => Promise<{ allocated: bigint; unlimited: boolean }>,
  ) {
    if (summary.dimension !== 'LIVE_CAPACITY') return summary;
    const childAllocation = await this.prisma.$transaction((tx) => load(tx));
    const limit = summary.limit === null ? null : BigInt(summary.limit);
    const unallocated =
      limit === null || childAllocation.unlimited
        ? null
        : limit > childAllocation.allocated
          ? limit - childAllocation.allocated
          : 0n;
    return {
      ...summary,
      allocatedToChildren: childAllocation.unlimited ? null : childAllocation.allocated.toString(),
      childAllocationUnlimited: childAllocation.unlimited,
      unallocated: unallocated?.toString() ?? null,
    };
  }

  private async childAgencyAllocationTx(
    tx: Tx,
    superAgencyId: string,
    resourceKey: BillingResourceKey,
  ) {
    const rows = await tx.agencyResourceAllocation.findMany({
      where: { resourceKey, agency: { superAgencyId } },
      select: { allocated: true, unlimited: true },
    });
    return childAllocationTotal(rows);
  }

  private async childWorkspaceAllocationTx(
    tx: Tx,
    agencyId: string,
    resourceKey: BillingResourceKey,
  ) {
    const rows = await tx.workspaceResourceAllocation.findMany({
      where: { resourceKey, workspace: { agencyId } },
      select: { allocated: true, unlimited: true },
    });
    return childAllocationTotal(rows);
  }

  private async liveUsage(
    scope: 'SUPER_AGENCY' | 'AGENCY' | 'WORKSPACE',
    scopeId: string,
    resourceKey: BillingResourceKey,
    client: Tx | PrismaService = this.prisma,
  ) {
    if (resourceKey === BILLING_RESOURCE_KEYS.agencies && scope === 'SUPER_AGENCY') {
      return BigInt(await client.agency.count({ where: { superAgencyId: scopeId } }));
    }
    if (resourceKey === BILLING_RESOURCE_KEYS.workspaces) {
      if (scope === 'SUPER_AGENCY') {
        return BigInt(
          await client.workspace.count({ where: { agency: { superAgencyId: scopeId } } }),
        );
      }
      if (scope === 'AGENCY') {
        return BigInt(await client.workspace.count({ where: { agencyId: scopeId } }));
      }
    }
    if (resourceKey === BILLING_RESOURCE_KEYS.workspaceMemberships) {
      const where =
        scope === 'SUPER_AGENCY'
          ? { workspace: { agency: { superAgencyId: scopeId } }, status: MembershipStatus.ACTIVE }
          : scope === 'AGENCY'
            ? { workspace: { agencyId: scopeId }, status: MembershipStatus.ACTIVE }
            : { workspaceId: scopeId, status: MembershipStatus.ACTIVE };
      return BigInt(await client.workspaceMembership.count({ where }));
    }
    if (resourceKey === BILLING_RESOURCE_KEYS.storageBytes) {
      return this.storageUsage(scope, scopeId, client);
    }
    if (resourceKey === BILLING_RESOURCE_KEYS.activeAutomations) {
      const where =
        scope === 'SUPER_AGENCY'
          ? { workspace: { agency: { superAgencyId: scopeId } }, status: 'PUBLISHED' as const }
          : scope === 'AGENCY'
            ? { workspace: { agencyId: scopeId }, status: 'PUBLISHED' as const }
            : { workspaceId: scopeId, status: 'PUBLISHED' as const };
      return BigInt(await client.automationWorkflow.count({ where }));
    }
    if (
      resourceKey === BILLING_RESOURCE_KEYS.automationExecutions ||
      resourceKey === BILLING_RESOURCE_KEYS.apiRequests
    ) {
      const periodScope =
        scope === 'SUPER_AGENCY'
          ? BillingUsageScope.SUPER_AGENCY
          : scope === 'AGENCY'
            ? BillingUsageScope.AGENCY
            : BillingUsageScope.WORKSPACE;
      return (await this.periodUsage(periodScope, scopeId, resourceKey, client)).used;
    }
    return 0n;
  }

  private async storageUsage(
    scope: 'SUPER_AGENCY' | 'AGENCY' | 'WORKSPACE',
    scopeId: string,
    client: Tx | PrismaService = this.prisma,
  ) {
    const workspaceWhere =
      scope === 'SUPER_AGENCY'
        ? { agency: { superAgencyId: scopeId } }
        : scope === 'AGENCY'
          ? { agencyId: scopeId }
          : { id: scopeId };
    const used = await client.asset.aggregate({
      where: {
        workspace: workspaceWhere,
        status: { in: ['UPLOADED', 'PROCESSING', 'READY'] },
        lifecycle: { in: ['ACTIVE', 'ARCHIVED', 'PENDING_DELETE', 'PURGING'] },
      },
      _sum: { sizeBytes: true },
    });
    const reserved = await client.storageUploadReservation.aggregate({
      where: {
        workspace: workspaceWhere,
        consumedAt: null,
        releasedAt: null,
        expiresAt: { gt: new Date() },
      },
      _sum: { reservedBytes: true },
    });
    return (used._sum.sizeBytes ?? 0n) + (reserved._sum.reservedBytes ?? 0n);
  }

  private async periodUsage(
    scope: BillingUsageScope,
    scopeId: string,
    resourceKey: BillingResourceKey,
    client: Tx | PrismaService = this.prisma,
  ) {
    const period = this.monthlyPeriod();
    const counter = await client.billingUsageCounter.findUnique({
      where: {
        scope_scopeId_resourceKey_periodStart: {
          scope,
          scopeId,
          resourceKey,
          periodStart: period.start,
        },
      },
      select: { used: true },
    });
    return { used: counter?.used ?? 0n, period };
  }

  private async workspaceContextTx(tx: Tx, workspaceId: string) {
    const workspace = await tx.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, agencyId: true, agency: { select: { superAgencyId: true } } },
    });
    if (!workspace) throw new NotFoundException('Workspace not found.');
    return {
      workspaceId: workspace.id,
      agencyId: workspace.agencyId,
      superAgencyId: workspace.agency.superAgencyId,
    };
  }

  private async assertHierarchicalLiveCapacityTx(
    tx: Tx,
    context: { superAgencyId: string; agencyId: string; workspaceId: string },
    resourceKey: BillingResourceKey,
    requested: bigint,
  ) {
    const subscription = await this.currentSubscription(tx, context.superAgencyId);
    if (subscription) {
      this.assertManagedCommercialAccess(subscription);
      const superLimit = await this.resolveEffectiveLimitTx(tx, context.superAgencyId, resourceKey);
      if (superLimit.managed && !superLimit.unlimited) {
        const used = await this.liveUsage('SUPER_AGENCY', context.superAgencyId, resourceKey, tx);
        this.assertWithinCapacity(resourceKey, used, superLimit.value, requested);
      }
    }

    const agencyLimit = await this.resolveAgencyAllocationTx(tx, context.agencyId, resourceKey);
    if (agencyLimit.configured && !agencyLimit.unlimited) {
      const used = await this.liveUsage('AGENCY', context.agencyId, resourceKey, tx);
      this.assertWithinCapacity(resourceKey, used, agencyLimit.value, requested);
    }

    const workspaceLimit = await this.resolveWorkspaceAllocationTx(
      tx,
      context.workspaceId,
      resourceKey,
    );
    if (workspaceLimit.configured && !workspaceLimit.unlimited) {
      const used = await this.liveUsage('WORKSPACE', context.workspaceId, resourceKey, tx);
      this.assertWithinCapacity(resourceKey, used, workspaceLimit.value, requested);
    }
  }

  private async assertHierarchicalActiveAutomationCapacityTx(
    tx: Tx,
    context: { superAgencyId: string; agencyId: string; workspaceId: string },
    workflowId: string,
  ) {
    const alreadyPublished = await tx.automationWorkflow.findFirst({
      where: { id: workflowId, workspaceId: context.workspaceId, status: 'PUBLISHED' },
      select: { id: true },
    });
    if (alreadyPublished) return;
    const requested = 1n;
    const superLimit = await this.resolveEffectiveLimitTx(
      tx,
      context.superAgencyId,
      BILLING_RESOURCE_KEYS.activeAutomations,
    );
    if (superLimit.managed && !superLimit.unlimited) {
      const used = await this.activeAutomationUsageTx(tx, 'SUPER_AGENCY', context.superAgencyId);
      this.assertWithinCapacity(
        BILLING_RESOURCE_KEYS.activeAutomations,
        used,
        superLimit.value,
        requested,
      );
    }
    const agencyLimit = await this.resolveAgencyAllocationTx(
      tx,
      context.agencyId,
      BILLING_RESOURCE_KEYS.activeAutomations,
    );
    if (agencyLimit.configured && !agencyLimit.unlimited) {
      const used = await this.activeAutomationUsageTx(tx, 'AGENCY', context.agencyId);
      this.assertWithinCapacity(
        BILLING_RESOURCE_KEYS.activeAutomations,
        used,
        agencyLimit.value,
        requested,
      );
    }
    const workspaceLimit = await this.resolveWorkspaceAllocationTx(
      tx,
      context.workspaceId,
      BILLING_RESOURCE_KEYS.activeAutomations,
    );
    if (workspaceLimit.configured && !workspaceLimit.unlimited) {
      const used = await this.activeAutomationUsageTx(tx, 'WORKSPACE', context.workspaceId);
      this.assertWithinCapacity(
        BILLING_RESOURCE_KEYS.activeAutomations,
        used,
        workspaceLimit.value,
        requested,
      );
    }
  }

  private activeAutomationUsageTx(
    tx: Tx,
    scope: 'SUPER_AGENCY' | 'AGENCY' | 'WORKSPACE',
    scopeId: string,
  ) {
    const where =
      scope === 'SUPER_AGENCY'
        ? { workspace: { agency: { superAgencyId: scopeId } }, status: 'PUBLISHED' as const }
        : scope === 'AGENCY'
          ? { workspace: { agencyId: scopeId }, status: 'PUBLISHED' as const }
          : { workspaceId: scopeId, status: 'PUBLISHED' as const };
    return tx.automationWorkflow.count({ where }).then(BigInt);
  }

  private async reserveHierarchicalPeriodUsageTx(
    tx: Tx,
    context: { superAgencyId: string; agencyId: string; workspaceId: string },
    resourceKey: BillingResourceKey,
  ) {
    const period = this.monthlyPeriod();
    const checks: Array<{ scope: BillingUsageScope; scopeId: string; limit: bigint | null }> = [];
    const superLimit = await this.resolveEffectiveLimitTx(tx, context.superAgencyId, resourceKey);
    if (superLimit.managed) {
      checks.push({
        scope: BillingUsageScope.SUPER_AGENCY,
        scopeId: context.superAgencyId,
        limit: superLimit.unlimited ? null : superLimit.value,
      });
    }
    const agencyLimit = await this.resolveAgencyAllocationTx(tx, context.agencyId, resourceKey);
    if (agencyLimit.configured) {
      checks.push({
        scope: BillingUsageScope.AGENCY,
        scopeId: context.agencyId,
        limit: agencyLimit.unlimited ? null : agencyLimit.value,
      });
    }
    const workspaceLimit = await this.resolveWorkspaceAllocationTx(
      tx,
      context.workspaceId,
      resourceKey,
    );
    if (workspaceLimit.configured) {
      checks.push({
        scope: BillingUsageScope.WORKSPACE,
        scopeId: context.workspaceId,
        limit: workspaceLimit.unlimited ? null : workspaceLimit.value,
      });
    }

    for (const check of checks) {
      if (check.limit === null) continue;
      const usage = await this.periodUsage(check.scope, check.scopeId, resourceKey, tx);
      if (usage.used >= check.limit) {
        throw new ForbiddenException({
          code: 'USAGE_QUOTA_EXCEEDED',
          message: 'Monthly usage quota exceeded.',
          resourceKey,
          scope: check.scope,
          limit: check.limit.toString(),
          used: usage.used.toString(),
        });
      }
    }

    const increments = [
      { scope: BillingUsageScope.SUPER_AGENCY, scopeId: context.superAgencyId },
      { scope: BillingUsageScope.AGENCY, scopeId: context.agencyId },
      { scope: BillingUsageScope.WORKSPACE, scopeId: context.workspaceId },
    ];
    for (const item of increments) {
      await tx.billingUsageCounter.upsert({
        where: {
          scope_scopeId_resourceKey_periodStart: {
            scope: item.scope,
            scopeId: item.scopeId,
            resourceKey,
            periodStart: period.start,
          },
        },
        update: { used: { increment: 1 } },
        create: {
          scope: item.scope,
          scopeId: item.scopeId,
          resourceKey,
          periodStart: period.start,
          periodEnd: period.end,
          used: 1,
        },
      });
    }
  }

  private async assertFeatureAvailableTx(
    tx: Tx,
    superAgencyId: string,
    featureKey: PlanFeatureKey,
  ) {
    const subscription = await this.currentSubscription(tx, superAgencyId);
    if (!subscription) return;
    const plan = subscription.planVersion.entitlements.find(
      (item) => item.kind === PlanEntitlementKind.FEATURE && item.key === featureKey,
    );
    const override = await tx.featureEntitlement.findFirst({
      where: { superAgencyId, feature: { key: featureKey } },
      select: { enabled: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (plan?.booleanValue === true && override?.enabled !== false) return;
    throw new ForbiddenException({
      code: 'FEATURE_NOT_ENTITLED',
      message: 'Feature is not available on the current plan.',
      featureKey,
    });
  }
}

async function lock(tx: Tx, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}

function buildSummary(
  resourceKey: BillingResourceKey,
  used: bigint,
  limit: LimitResolution | AllocationValue,
) {
  const configured = 'configured' in limit ? limit.configured : limit.managed;
  const unlimited = configured && limit.unlimited;
  const allowed = unlimited || !configured ? null : limit.value;
  const remaining = allowed === null ? null : allowed > used ? allowed - used : 0n;
  return {
    resourceKey,
    dimension: BILLING_RESOURCE_CATALOG[resourceKey].dimension,
    used: used.toString(),
    limit: allowed?.toString() ?? null,
    unlimited,
    configured,
    remaining: remaining?.toString() ?? null,
    status: allowed !== null && used > allowed ? 'OVER_LIMIT' : 'WITHIN_LIMIT',
  };
}

function childAllocationTotal(rows: Array<{ allocated: bigint | null; unlimited: boolean }>) {
  if (rows.some((row) => row.unlimited)) return { allocated: 0n, unlimited: true };
  return {
    allocated: rows.reduce((sum, row) => sum + (row.allocated ?? 0n), 0n),
    unlimited: false,
  };
}

function assertAllocatableResource(resourceKey: BillingResourceKey) {
  const dimension = BILLING_RESOURCE_CATALOG[resourceKey]?.dimension;
  if (dimension !== 'LIVE_CAPACITY') {
    throw new ForbiddenException({
      code: 'ALLOCATION_EXCEEDED',
      message: 'Only live capacity resources can be allocated.',
      resourceKey,
    });
  }
  return resourceKey;
}

function isPlanFeatureKey(key: string): key is PlanFeatureKey {
  return [
    'tasks',
    'tasks.enabled',
    'projects',
    'projects.enabled',
    'tickets',
    'tickets.enabled',
    'gamification',
    'gamification.enabled',
    'automation',
    'automation.enabled',
    'notifications',
    'notifications.enabled',
    'calendar',
    'calendar.enabled',
    'assets',
    'files.enabled',
    'public_api',
    'api.enabled',
    'webhooks',
    'webhooks.enabled',
    'integrations',
    'integrations.ghl.enabled',
    'integrations.slack.enabled',
    'integrations.webex.enabled',
  ].includes(key);
}
