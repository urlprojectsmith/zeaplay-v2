import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AssetLifecycle,
  AssetStatus,
  AutomationDomainEventEntityType,
  AutomationTriggerMatchStatus,
  AutomationTriggerType,
  AutomationWorkflowStatus,
  AutomationWorkflowVersionState,
  BillingProvider,
  BillingUsageScope,
  MasterPlanStatus,
  MasterPlanType,
  MembershipStatus,
  PlanEntitlementKind,
  PlanEntitlementValueType,
  PlanVersionStatus,
  Prisma,
  RoleScope,
  SuperAgencySubscriptionStatus,
} from '@prisma/client';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { BillingEntitlementService } from '../src/modules/billing/billing-entitlement.service';
import { BILLING_RESOURCE_KEYS } from '../src/modules/billing/billing.constants';
import { AssetsService } from '../src/modules/assets/assets.service';
import { AutomationExecutionService } from '../src/modules/automation/automation-execution.service';
import { AutomationPolicyService } from '../src/modules/automation/automation-policy.service';
import type { WorkspaceTenantContext } from '../src/common/auth/auth.types';

loadApiEnv();

const audit = { record: jest.fn().mockResolvedValue(undefined) };
const storage = {
  createPresignedUploadUrl: jest.fn().mockResolvedValue('https://storage.example/upload'),
  createPresignedDownloadUrl: jest.fn().mockResolvedValue('https://storage.example/download'),
  statObject: jest.fn().mockResolvedValue({ size: 120, etag: 'etag', contentType: 'text/plain' }),
  deleteObject: jest.fn().mockResolvedValue(undefined),
};
const queue = { add: jest.fn().mockResolvedValue(undefined) };

describe('Phase 15.3 PostgreSQL concurrency enforcement', () => {
  let prismaA: PrismaService;
  let prismaB: PrismaService;
  let billingA: BillingEntitlementService;
  let billingB: BillingEntitlementService;
  let ids: SeedIds;
  let tenant: WorkspaceTenantContext;

  beforeAll(async () => {
    expect(process.env.DATABASE_URL).toBeTruthy();
    prismaA = new PrismaService();
    prismaB = new PrismaService();
    await Promise.all([prismaA.$connect(), prismaB.$connect()]);
    billingA = new BillingEntitlementService(prismaA, audit as never);
    billingB = new BillingEntitlementService(prismaB, audit as never);
  });

  afterAll(async () => {
    await cleanup(prismaA, ids).catch(() => undefined);
    await Promise.all([prismaA.$disconnect(), prismaB.$disconnect()]);
  });

  beforeEach(async () => {
    audit.record.mockClear();
    storage.createPresignedUploadUrl.mockClear();
    storage.createPresignedDownloadUrl.mockClear();
    ids = makeIds();
    await cleanup(prismaA, ids);
    await seedTenant(prismaA, ids);
    tenant = {
      userId: ids.user,
      superAgencyId: ids.superAgency,
      agencyId: ids.agency,
      workspaceId: ids.workspace,
      workspaceMembershipId: ids.workspaceMembership,
      agencyMembershipId: ids.agencyMembership,
      roleId: ids.role,
      roleName: 'Phase 15.3 Owner',
      permissions: [],
      accessSource: 'WORKSPACE_MEMBERSHIP',
    };
  });

  afterEach(async () => {
    await cleanup(prismaA, ids);
  });

  it('serializes public API quota reservations and keeps the counter at the exact limit', async () => {
    const period = billingA.monthlyPeriod();
    await prismaA.billingUsageCounter.create({
      data: {
        scope: BillingUsageScope.SUPER_AGENCY,
        scopeId: ids.superAgency,
        resourceKey: BILLING_RESOURCE_KEYS.apiRequests,
        periodStart: period.start,
        periodEnd: period.end,
        used: 99,
      },
    });

    const attempts = await Promise.allSettled([
      billingA.reservePublicApiRequestUsage(ids.workspace),
      billingB.reservePublicApiRequestUsage(ids.workspace),
    ]);

    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1);
    await expectCounter(
      prismaA,
      BillingUsageScope.SUPER_AGENCY,
      ids.superAgency,
      'API_REQUESTS',
      100n,
    );
    await expectCounter(prismaA, BillingUsageScope.AGENCY, ids.agency, 'API_REQUESTS', 1n);
    await expectCounter(prismaA, BillingUsageScope.WORKSPACE, ids.workspace, 'API_REQUESTS', 1n);
  });

  it('serializes automation execution quota reservations and keeps the counter at the exact limit', async () => {
    const period = billingA.monthlyPeriod();
    await prismaA.billingUsageCounter.create({
      data: {
        scope: BillingUsageScope.SUPER_AGENCY,
        scopeId: ids.superAgency,
        resourceKey: BILLING_RESOURCE_KEYS.automationExecutions,
        periodStart: period.start,
        periodEnd: period.end,
        used: 2,
      },
    });

    const attempts = await Promise.allSettled([
      prismaA.$transaction((tx) => billingA.reserveAutomationExecutionUsageTx(tx, ids.workspace), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }),
      prismaB.$transaction((tx) => billingB.reserveAutomationExecutionUsageTx(tx, ids.workspace), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      }),
    ]);

    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1);
    await expectCounter(
      prismaA,
      BillingUsageScope.SUPER_AGENCY,
      ids.superAgency,
      'AUTOMATION_EXECUTIONS',
      3n,
    );
  });

  it('does not meter duplicate canonical automation execution creation for the same trigger match', async () => {
    await seedAutomationGraph(prismaA, ids, ids.triggerMatchA);
    const executionA = automationExecutions(prismaA, billingA);
    const executionB = automationExecutions(prismaB, billingB);

    const attempts = await Promise.allSettled([
      executionA.createForTriggerMatch(ids.triggerMatchA),
      executionB.createForTriggerMatch(ids.triggerMatchA),
    ]);

    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(2);
    await expect(
      prismaA.automationExecution.count({ where: { triggerMatchId: ids.triggerMatchA } }),
    ).resolves.toBe(1);
    await expectCounter(
      prismaA,
      BillingUsageScope.SUPER_AGENCY,
      ids.superAgency,
      'AUTOMATION_EXECUTIONS',
      1n,
    );
  });

  it('serializes active automation publication at the configured limit', async () => {
    await seedPublishedWorkflows(prismaA, ids, 9);
    const workflowA = randomUUID();
    const workflowB = randomUUID();
    await Promise.all([
      createWorkflow(prismaA, ids, workflowA, AutomationWorkflowStatus.DRAFT),
      createWorkflow(prismaA, ids, workflowB, AutomationWorkflowStatus.DRAFT),
    ]);

    const publish = (
      prisma: PrismaService,
      billing: BillingEntitlementService,
      workflowId: string,
    ) =>
      prisma.$transaction(
        async (tx) => {
          await billing.assertActiveAutomationAvailableTx(tx, ids.workspace, workflowId);
          await tx.automationWorkflow.update({
            where: { id_workspaceId: { id: workflowId, workspaceId: ids.workspace } },
            data: { status: AutomationWorkflowStatus.PUBLISHED },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

    const attempts = await Promise.allSettled([
      publish(prismaA, billingA, workflowA),
      publish(prismaB, billingB, workflowB),
    ]);

    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1);
    await expect(
      prismaA.automationWorkflow.count({
        where: { workspaceId: ids.workspace, status: AutomationWorkflowStatus.PUBLISHED },
      }),
    ).resolves.toBe(10);
  });

  it('serializes storage reservations, permits exact boundary size, and blocks expansion over quota', async () => {
    const assetsA = assets(prismaA, billingA);
    const assetsB = assets(prismaB, billingB);

    const attempts = await Promise.allSettled([
      assetsA.initWorkspaceUpload(tenant, uploadDto(70), 'corr-storage-a'),
      assetsB.initWorkspaceUpload(tenant, uploadDto(70), 'corr-storage-b'),
    ]);

    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1);
    await expect(activeReservedBytes(prismaA, ids.workspace)).resolves.toBe(70n);

    await cleanupStorageRows(prismaA, ids);
    await expect(
      assetsA.initWorkspaceUpload(tenant, uploadDto(100), 'corr-storage-boundary'),
    ).resolves.toBeTruthy();
    await cleanupStorageRows(prismaA, ids);
    await expect(
      assetsA.initWorkspaceUpload(tenant, uploadDto(101), 'corr-storage-over'),
    ).rejects.toBeTruthy();
  });

  it('allows storage reduction actions while over limit and continues blocking new storage growth', async () => {
    const assetsA = assets(prismaA, billingA);
    const assetId = randomUUID();
    await prismaA.asset.create({
      data: {
        id: assetId,
        workspaceId: ids.workspace,
        createdById: ids.user,
        uploadedByMembershipId: ids.workspaceMembership,
        originalFilename: 'existing.txt',
        displayName: 'existing.txt',
        storageBucket: 'phase153',
        storageKey: `phase153/${ids.run}/existing.txt`,
        mimeType: 'text/plain',
        extension: 'txt',
        sizeBytes: 120,
        status: AssetStatus.READY,
        lifecycle: AssetLifecycle.ACTIVE,
        uploadExpiresAt: new Date(Date.now() + 60_000),
      },
    });

    await expect(assetsA.createWorkspaceDownloadUrl(tenant, assetId)).resolves.toBeTruthy();
    await expect(assetsA.archiveWorkspaceFile(tenant, assetId)).resolves.toMatchObject({
      lifecycle: AssetLifecycle.ARCHIVED,
    });
    await expect(assetsA.requestWorkspaceFileDelete(tenant, assetId)).resolves.toMatchObject({
      lifecycle: AssetLifecycle.PENDING_DELETE,
    });
    await expect(
      assetsA.initWorkspaceUpload(tenant, uploadDto(1), 'corr-storage-blocked'),
    ).rejects.toBeTruthy();
  });
});

function automationExecutions(prisma: PrismaService, billing: BillingEntitlementService) {
  return new AutomationExecutionService(
    prisma,
    {} as never,
    undefined,
    new AutomationPolicyService(prisma),
    undefined,
    undefined,
    undefined,
    billing,
  );
}

function assets(prisma: PrismaService, billing: BillingEntitlementService) {
  return new AssetsService(prisma, audit as never, storage as never, queue as never, billing);
}

async function seedTenant(prisma: PrismaService, ids: SeedIds) {
  await prisma.user.create({
    data: { id: ids.user, email: `${ids.run}@example.test`, passwordHash: 'hash' },
  });
  await prisma.role.create({
    data: {
      id: ids.role,
      key: `phase15_3_${ids.run}`,
      name: 'Phase 15.3 Owner',
      scope: RoleScope.WORKSPACE,
    },
  });
  await prisma.superAgency.create({
    data: {
      id: ids.superAgency,
      name: 'Phase 15.3 SA',
      slug: `phase153-${ids.run}`,
      createdById: ids.user,
    },
  });
  await prisma.agency.create({
    data: {
      id: ids.agency,
      superAgencyId: ids.superAgency,
      name: 'Phase 15.3 Agency',
      slug: `phase153-agency-${ids.run}`,
      createdById: ids.user,
    },
  });
  await prisma.workspace.create({
    data: {
      id: ids.workspace,
      agencyId: ids.agency,
      name: 'Phase 15.3 Workspace',
      slug: `phase153-workspace-${ids.run}`,
      timezone: 'UTC',
      createdById: ids.user,
      storageLimitBytes: 100,
    },
  });
  await prisma.superAgencyMembership.create({
    data: {
      id: ids.superAgencyMembership,
      userId: ids.user,
      superAgencyId: ids.superAgency,
      roleId: ids.role,
      status: MembershipStatus.ACTIVE,
    },
  });
  await prisma.agencyMembership.create({
    data: { id: ids.agencyMembership, userId: ids.user, agencyId: ids.agency, roleId: ids.role },
  });
  await prisma.workspaceMembership.create({
    data: {
      id: ids.workspaceMembership,
      userId: ids.user,
      workspaceId: ids.workspace,
      roleId: ids.role,
      status: MembershipStatus.ACTIVE,
    },
  });
  await prisma.masterPlan.create({
    data: {
      id: ids.plan,
      key: `phase153_${ids.run}`,
      type: MasterPlanType.PUBLIC,
      displayName: 'Phase 15.3 Plan',
      status: MasterPlanStatus.ACTIVE,
    },
  });
  await prisma.masterPlanVersion.create({
    data: {
      id: ids.planVersion,
      masterPlanId: ids.plan,
      versionNumber: 1,
      status: PlanVersionStatus.PUBLISHED,
      publishedAt: new Date(),
    },
  });
  await prisma.planEntitlement.createMany({
    data: [
      feature(ids, 'api.enabled'),
      feature(ids, 'automation.enabled'),
      feature(ids, 'files.enabled'),
      limit(ids, 'api_requests_per_month', 100n),
      limit(ids, 'automation_executions_per_month', 3n),
      limit(ids, 'max_active_automations', 10n),
      limit(ids, 'storage_bytes', 100n),
    ],
  });
  await prisma.superAgencySubscription.create({
    data: {
      id: ids.subscription,
      superAgencyId: ids.superAgency,
      masterPlanId: ids.plan,
      planVersionId: ids.planVersion,
      provider: BillingProvider.INTERNAL,
      status: SuperAgencySubscriptionStatus.ACTIVE,
      isCurrent: true,
      startedAt: new Date(),
    },
  });
  await prisma.agencyResourceAllocation.createMany({
    data: [
      agencyAllocation(ids.agency, 'API_REQUESTS', 100n),
      agencyAllocation(ids.agency, 'AUTOMATION_EXECUTIONS', 3n),
      agencyAllocation(ids.agency, 'ACTIVE_AUTOMATIONS', 10n),
      agencyAllocation(ids.agency, 'STORAGE_BYTES', 100n),
    ],
  });
  await prisma.workspaceResourceAllocation.createMany({
    data: [
      workspaceAllocation(ids.workspace, 'API_REQUESTS', 100n),
      workspaceAllocation(ids.workspace, 'AUTOMATION_EXECUTIONS', 3n),
      workspaceAllocation(ids.workspace, 'ACTIVE_AUTOMATIONS', 10n),
      workspaceAllocation(ids.workspace, 'STORAGE_BYTES', 100n),
    ],
  });
}

async function seedAutomationGraph(prisma: PrismaService, ids: SeedIds, triggerMatchId: string) {
  await createWorkflow(prisma, ids, ids.workflow, AutomationWorkflowStatus.PUBLISHED);
  await prisma.automationWorkflowVersion.create({
    data: {
      id: ids.workflowVersion,
      workflowId: ids.workflow,
      workspaceId: ids.workspace,
      versionNumber: 1,
      state: AutomationWorkflowVersionState.PUBLISHED,
      triggerDefinition: { type: 'TASK_CREATED' },
      nodesDefinition: [{ nodeId: 'trigger', type: 'TRIGGER', config: {} }],
      edgesDefinition: [],
      settingsDefinition: {},
      definitionSizeBytes: 2,
      createdByMembershipId: ids.workspaceMembership,
      publishedAt: new Date(),
    },
  });
  await prisma.automationWorkflow.update({
    where: { id_workspaceId: { id: ids.workflow, workspaceId: ids.workspace } },
    data: { activePublishedVersionId: ids.workflowVersion },
  });
  await prisma.automationDomainEvent.create({
    data: {
      id: ids.domainEventA,
      workspaceId: ids.workspace,
      eventType: AutomationTriggerType.TASK_CREATED,
      entityType: AutomationDomainEventEntityType.TASK,
      entityId: randomUUID(),
      actorMembershipId: ids.workspaceMembership,
      occurredAt: new Date(),
      correlationId: `corr-${ids.run}`,
      payload: {},
      idempotencyKey: `phase153-event-${ids.run}`,
    },
  });
  await prisma.automationTriggerMatch.create({
    data: {
      id: triggerMatchId,
      workspaceId: ids.workspace,
      domainEventId: ids.domainEventA,
      workflowId: ids.workflow,
      workflowVersionId: ids.workflowVersion,
      triggerNodeId: 'trigger',
      status: AutomationTriggerMatchStatus.MATCHED,
      runtimeEligibleAt: new Date(),
    },
  });
}

async function seedPublishedWorkflows(prisma: PrismaService, ids: SeedIds, count: number) {
  for (let index = 0; index < count; index += 1) {
    await createWorkflow(prisma, ids, randomUUID(), AutomationWorkflowStatus.PUBLISHED);
  }
}

function createWorkflow(
  prisma: PrismaService,
  ids: SeedIds,
  workflowId: string,
  status: AutomationWorkflowStatus,
) {
  return prisma.automationWorkflow.create({
    data: {
      id: workflowId,
      workspaceId: ids.workspace,
      name: `Workflow ${workflowId.slice(0, 8)}`,
      status,
      createdByMembershipId: ids.workspaceMembership,
    },
  });
}

async function cleanup(prisma: PrismaService, ids?: SeedIds) {
  if (!ids) return;
  await cleanupStorageRows(prisma, ids);
  await prisma.automationStepExecution.deleteMany({ where: { workspaceId: ids.workspace } });
  await prisma.automationExecution.deleteMany({ where: { workspaceId: ids.workspace } });
  await deleteImmutableAutomationRows(prisma, ids.workspace);
  await deleteAutomationWorkflowVersions(prisma, ids.workspace);
  await prisma.automationWorkflow.deleteMany({ where: { workspaceId: ids.workspace } });
  await prisma.billingUsageCounter.deleteMany({
    where: { scopeId: { in: [ids.superAgency, ids.agency, ids.workspace] } },
  });
  await prisma.billingHistory.deleteMany({ where: { superAgencyId: ids.superAgency } });
  await prisma.workspaceResourceAllocation.deleteMany({ where: { workspaceId: ids.workspace } });
  await prisma.agencyResourceAllocation.deleteMany({ where: { agencyId: ids.agency } });
  await prisma.superAgencySubscription.deleteMany({ where: { superAgencyId: ids.superAgency } });
  await prisma.planEntitlement.deleteMany({ where: { planVersionId: ids.planVersion } });
  await prisma.masterPlanVersion.deleteMany({ where: { id: ids.planVersion } });
  await prisma.masterPlan.deleteMany({ where: { id: ids.plan } });
  await prisma.workspaceMembership.deleteMany({ where: { workspaceId: ids.workspace } });
  await prisma.agencyMembership.deleteMany({ where: { agencyId: ids.agency } });
  await prisma.superAgencyMembership.deleteMany({ where: { superAgencyId: ids.superAgency } });
  await prisma.workspace.deleteMany({ where: { id: ids.workspace } });
  await prisma.agency.deleteMany({ where: { id: ids.agency } });
  await prisma.superAgency.deleteMany({ where: { id: ids.superAgency } });
  await prisma.role.deleteMany({ where: { id: ids.role } });
  await prisma.user.deleteMany({ where: { id: ids.user } });
}

async function deleteAutomationWorkflowVersions(prisma: PrismaService, workspaceId: string) {
  await prisma.automationWorkflow.updateMany({
    where: { workspaceId },
    data: { activePublishedVersionId: null },
  });
  await prisma.$executeRawUnsafe('ALTER TABLE automation_workflow_versions DISABLE TRIGGER USER');
  try {
    await prisma.automationWorkflowVersion.deleteMany({ where: { workspaceId } });
  } finally {
    await prisma.$executeRawUnsafe('ALTER TABLE automation_workflow_versions ENABLE TRIGGER USER');
  }
}

async function deleteImmutableAutomationRows(prisma: PrismaService, workspaceId: string) {
  await prisma.$executeRawUnsafe('ALTER TABLE automation_trigger_matches DISABLE TRIGGER USER');
  await prisma.$executeRawUnsafe('ALTER TABLE automation_domain_events DISABLE TRIGGER USER');
  try {
    await prisma.automationTriggerMatch.deleteMany({ where: { workspaceId } });
    await prisma.automationDomainEvent.deleteMany({ where: { workspaceId } });
  } finally {
    await prisma.$executeRawUnsafe('ALTER TABLE automation_domain_events ENABLE TRIGGER USER');
    await prisma.$executeRawUnsafe('ALTER TABLE automation_trigger_matches ENABLE TRIGGER USER');
  }
}

async function cleanupStorageRows(prisma: PrismaService, ids: SeedIds) {
  await prisma.storageUploadReservation.deleteMany({ where: { workspaceId: ids.workspace } });
  await prisma.asset.deleteMany({ where: { workspaceId: ids.workspace } });
}

async function activeReservedBytes(prisma: PrismaService, workspaceId: string) {
  const aggregate = await prisma.storageUploadReservation.aggregate({
    where: { workspaceId, consumedAt: null, releasedAt: null, expiresAt: { gt: new Date() } },
    _sum: { reservedBytes: true },
  });
  return aggregate._sum.reservedBytes ?? 0n;
}

async function expectCounter(
  prisma: PrismaService,
  scope: BillingUsageScope,
  scopeId: string,
  resourceKey: string,
  used: bigint,
) {
  const period = new BillingEntitlementService(prisma, audit as never).monthlyPeriod();
  await expect(
    prisma.billingUsageCounter.findUnique({
      where: {
        scope_scopeId_resourceKey_periodStart: {
          scope,
          scopeId,
          resourceKey,
          periodStart: period.start,
        },
      },
      select: { used: true },
    }),
  ).resolves.toMatchObject({ used });
}

function feature(ids: SeedIds, key: string) {
  return {
    planVersionId: ids.planVersion,
    key,
    kind: PlanEntitlementKind.FEATURE,
    valueType: PlanEntitlementValueType.BOOLEAN,
    booleanValue: true,
    unlimited: false,
  };
}

function limit(ids: SeedIds, key: string, value: bigint) {
  return {
    planVersionId: ids.planVersion,
    key,
    kind: PlanEntitlementKind.LIMIT,
    valueType: PlanEntitlementValueType.COUNT,
    numericValue: value,
    unlimited: false,
  };
}

function agencyAllocation(agencyId: string, resourceKey: string, allocated: bigint) {
  return { agencyId, resourceKey, allocated, unlimited: false };
}

function workspaceAllocation(workspaceId: string, resourceKey: string, allocated: bigint) {
  return { workspaceId, resourceKey, allocated, unlimited: false };
}

function uploadDto(sizeBytes: number) {
  return { filename: `upload-${sizeBytes}.txt`, mimeType: 'text/plain', sizeBytes };
}

function makeIds(): SeedIds {
  const run = `p153-${randomUUID()}`;
  return {
    run,
    user: randomUUID(),
    role: randomUUID(),
    superAgency: randomUUID(),
    agency: randomUUID(),
    workspace: randomUUID(),
    superAgencyMembership: randomUUID(),
    agencyMembership: randomUUID(),
    workspaceMembership: randomUUID(),
    plan: randomUUID(),
    planVersion: randomUUID(),
    subscription: randomUUID(),
    workflow: randomUUID(),
    workflowVersion: randomUUID(),
    domainEventA: randomUUID(),
    triggerMatchA: randomUUID(),
  };
}

function loadApiEnv() {
  const envPath = join(__dirname, '..', '.env');
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator);
    if (process.env[key]) continue;
    const rawValue = trimmed.slice(separator + 1);
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, '');
  }
}

interface SeedIds {
  run: string;
  user: string;
  role: string;
  superAgency: string;
  agency: string;
  workspace: string;
  superAgencyMembership: string;
  agencyMembership: string;
  workspaceMembership: string;
  plan: string;
  planVersion: string;
  subscription: string;
  workflow: string;
  workflowVersion: string;
  domainEventA: string;
  triggerMatchA: string;
}
