import { ForbiddenException } from '@nestjs/common';
import {
  BillingUsageScope,
  PlanEntitlementKind,
  PlanEntitlementValueType,
  SuperAgencySubscriptionStatus,
} from '@prisma/client';
import { BILLING_RESOURCE_KEYS, DEFAULT_AGENCY_WORKSPACE_ALLOCATION } from './billing.constants';
import { BillingEntitlementService } from './billing-entitlement.service';

describe('BillingEntitlementService Phase 15.3 allocation and usage', () => {
  it('uses UTC calendar months for metered usage periods', () => {
    const service = new BillingEntitlementService({} as never, {} as never);

    const period = service.monthlyPeriod(new Date('2026-09-25T23:59:59.000Z'));

    expect(period.start.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(period.end.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('blocks new Agency creation when fewer than the default 15 Workspace slots remain', async () => {
    const { service, tx } = buildService({
      planLimits: {
        max_agencies: null,
        max_workspaces: BigInt(DEFAULT_AGENCY_WORKSPACE_ALLOCATION - 1),
      },
    });

    await expect(service.assertAgencyCreationAvailable('super-agency-1')).rejects.toThrow(
      ForbiddenException,
    );
    expect(tx.agencyResourceAllocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ resourceKey: BILLING_RESOURCE_KEYS.workspaces }),
      }),
    );
  });

  it('allows Agency creation at exactly 15 remaining Workspace slots', async () => {
    const { service } = buildService({
      planLimits: {
        max_agencies: null,
        max_workspaces: BigInt(DEFAULT_AGENCY_WORKSPACE_ALLOCATION),
      },
    });

    await expect(service.assertAgencyCreationAvailable('super-agency-1')).resolves.toBeUndefined();
  });

  it('blocks Workspace creation when Agency allocation is exhausted', async () => {
    const { service, prisma, tx } = buildService();
    prisma.agency.findUnique.mockResolvedValue({ id: 'agency-1', superAgencyId: 'super-agency-1' });
    tx.agency.findUnique.mockResolvedValue({ id: 'agency-1', superAgencyId: 'super-agency-1' });
    tx.agencyResourceAllocation.findUnique.mockResolvedValue({
      allocated: 1n,
      unlimited: false,
    });
    tx.workspace.count.mockResolvedValue(1);

    await expect(
      service.assertWorkspaceCreationAvailableTx(tx as never, 'agency-1'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('counts active WorkspaceMembership rows for membership capacity', async () => {
    const { service, tx } = buildService();
    tx.workspace.findUnique.mockResolvedValue({
      id: 'workspace-1',
      agencyId: 'agency-1',
      agency: { superAgencyId: 'super-agency-1' },
    });
    tx.workspaceResourceAllocation.findUnique.mockResolvedValue({
      allocated: 2n,
      unlimited: false,
    });
    tx.workspaceMembership.count.mockResolvedValue(2);

    await expect(
      service.assertWorkspaceMembershipAvailableTx(tx as never, 'workspace-1'),
    ).rejects.toThrow(ForbiddenException);
    expect(tx.workspaceMembership.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'ACTIVE' }) }),
    );
  });

  it('keeps direct FeatureEntitlement as a managed-plan disable override, not a plan replacement', async () => {
    const { service, prisma } = buildService({
      planFeatures: { 'integrations.slack.enabled': true },
    });
    prisma.featureEntitlement.findMany.mockResolvedValue([
      { enabled: false, feature: { key: 'integrations.slack.enabled' } },
    ]);

    await expect(
      service.resolveEffectiveFeature('super-agency-1', 'integrations.slack.enabled'),
    ).resolves.toMatchObject({ enabled: false, enforcementMode: 'MANAGED' });
  });

  it('returns unmanaged compatibility when no subscription exists', async () => {
    const { service, prisma } = buildService({ subscription: null });
    prisma.featureEntitlement.findMany.mockResolvedValue([]);

    await expect(service.getEffectiveEntitlements('legacy-super-agency')).resolves.toMatchObject({
      enforcementMode: 'UNMANAGED',
      hasCurrentSubscription: false,
    });
  });

  it('records BillingHistory for Workspace allocation changes', async () => {
    const { service, prisma, tx } = buildService();
    tx.workspace.findFirst.mockResolvedValue({
      id: 'workspace-1',
      agency: { superAgencyId: 'super-agency-1' },
    });
    tx.workspaceResourceAllocation.upsert.mockResolvedValue({
      id: 'workspace-allocation-1',
      allocated: 1024n,
      unlimited: false,
    });
    prisma.workspace.findUnique.mockResolvedValue({
      id: 'workspace-1',
      agencyId: 'agency-1',
      agency: { superAgencyId: 'super-agency-1' },
    });

    await service.updateWorkspaceAllocation({
      agencyId: 'agency-1',
      workspaceId: 'workspace-1',
      resourceKey: BILLING_RESOURCE_KEYS.storageBytes,
      allocated: 1024,
      actorUserId: 'user-1',
    });

    expect(prisma.billingHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          superAgencyId: 'super-agency-1',
          eventType: 'ALLOCATION_UPDATED',
          metadata: expect.objectContaining({
            scope: 'WORKSPACE',
            agencyId: 'agency-1',
            workspaceId: 'workspace-1',
            resourceKey: BILLING_RESOURCE_KEYS.storageBytes,
            allocated: '1024',
          }),
        }),
      }),
    );
  });

  it('reports period usage from the monthly counter without annual-period semantics', async () => {
    const { service, prisma } = buildService();
    prisma.billingUsageCounter.findUnique.mockResolvedValue({ used: 7n });

    const summary = await service.superAgencyUsage('super-agency-1');

    expect(prisma.billingUsageCounter.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          scope_scopeId_resourceKey_periodStart: expect.objectContaining({
            scope: BillingUsageScope.SUPER_AGENCY,
            resourceKey: BILLING_RESOURCE_KEYS.automationExecutions,
          }),
        }),
      }),
    );
    expect(summary.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resourceKey: BILLING_RESOURCE_KEYS.automationExecutions }),
      ]),
    );
  });

  it('reports Super Agency child allocation totals and remaining parent capacity from the server', async () => {
    const { service, tx } = buildService({
      planLimits: { max_workspaces: 20n },
    });
    tx.agencyResourceAllocation.findMany.mockResolvedValue([
      { allocated: 10n, unlimited: false },
      { allocated: 6n, unlimited: false },
    ]);

    const summary = await service.superAgencyUsage('super-agency-1');

    expect(summary.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceKey: BILLING_RESOURCE_KEYS.workspaces,
          limit: '20',
          allocatedToChildren: '16',
          unallocated: '4',
          childAllocationUnlimited: false,
        }),
      ]),
    );
    expect(tx.agencyResourceAllocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ resourceKey: BILLING_RESOURCE_KEYS.workspaces }),
      }),
    );
  });

  it('reports Agency child Workspace allocation totals and remaining Agency capacity from the server', async () => {
    const { service, prisma, tx } = buildService();
    prisma.agency.findUnique.mockResolvedValue({ id: 'agency-1', superAgencyId: 'super-agency-1' });
    tx.agency.findUnique.mockResolvedValue({ id: 'agency-1', superAgencyId: 'super-agency-1' });
    tx.agencyResourceAllocation.findUnique.mockResolvedValue({
      allocated: 15n,
      unlimited: false,
    });
    tx.workspaceResourceAllocation.findMany.mockResolvedValue([
      { allocated: 10n, unlimited: false },
      { allocated: 2n, unlimited: false },
    ]);

    const summary = await service.agencyUsage('agency-1');

    expect(summary.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceKey: BILLING_RESOURCE_KEYS.workspaces,
          limit: '15',
          allocatedToChildren: '12',
          unallocated: '3',
          childAllocationUnlimited: false,
        }),
      ]),
    );
    expect(tx.workspaceResourceAllocation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ resourceKey: BILLING_RESOURCE_KEYS.workspaces }),
      }),
    );
  });

  it('allows automation executions 1-3 and blocks execution 4 without off-by-one usage', async () => {
    const { service, tx, prisma } = buildService({
      planLimits: { automation_executions_per_month: 3n },
      planFeatures: { 'automation.enabled': true },
    });
    tx.workspace.findUnique.mockResolvedValue(workspaceContext());
    tx.billingUsageCounter.findUnique
      .mockResolvedValueOnce({ used: 0n })
      .mockResolvedValueOnce({ used: 1n })
      .mockResolvedValueOnce({ used: 2n })
      .mockResolvedValueOnce({ used: 3n });

    await expect(
      service.reserveAutomationExecutionUsageTx(tx as never, 'workspace-1'),
    ).resolves.toBe(true);
    await expect(
      service.reserveAutomationExecutionUsageTx(tx as never, 'workspace-1'),
    ).resolves.toBe(true);
    await expect(
      service.reserveAutomationExecutionUsageTx(tx as never, 'workspace-1'),
    ).resolves.toBe(true);
    await expect(
      service.reserveAutomationExecutionUsageTx(tx as never, 'workspace-1'),
    ).rejects.toThrow(ForbiddenException);

    expect(tx.billingUsageCounter.upsert).toHaveBeenCalledTimes(9);
    expect(prisma.billingHistory.create).not.toHaveBeenCalled();
  });

  it('does not increment API usage when the API feature is disabled', async () => {
    const { service, tx, prisma } = buildService({
      planLimits: { api_requests_per_month: 3n },
      planFeatures: { 'api.enabled': false },
    });
    tx.workspace.findUnique.mockResolvedValue(workspaceContext());

    await expect(
      service.reservePublicApiRequestUsageTx(tx as never, 'workspace-1'),
    ).rejects.toThrow(ForbiddenException);

    expect(tx.billingUsageCounter.upsert).not.toHaveBeenCalled();
    expect(prisma.billingHistory.create).not.toHaveBeenCalled();
  });

  it('uses the same storage authority and lock before accepting storage reservations', async () => {
    const { service, tx } = buildService({
      planLimits: { storage_bytes: 100n },
      planFeatures: { 'files.enabled': true },
    });
    tx.workspace.findUnique.mockResolvedValue(workspaceContext());
    tx.asset.aggregate.mockResolvedValue({ _sum: { sizeBytes: 90n } });
    tx.storageUploadReservation.aggregate.mockResolvedValue({ _sum: { reservedBytes: 0n } });

    await expect(
      service.assertWorkspaceStorageAvailableTx(tx as never, 'workspace-1', 15n),
    ).rejects.toThrow(ForbiddenException);
    expect(tx.$executeRaw).toHaveBeenCalled();
  });
});

function buildService(options?: {
  subscription?: Record<string, unknown> | null;
  planLimits?: Record<string, bigint | null>;
  planFeatures?: Record<string, boolean>;
}) {
  const subscription =
    options?.subscription === null
      ? null
      : subscriptionFixture(options?.planLimits ?? {}, options?.planFeatures ?? {});
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    superAgencySubscription: { findFirst: jest.fn().mockResolvedValue(subscription) },
    agency: {
      count: jest.fn().mockResolvedValue(0),
      findUnique: jest.fn(),
      findFirst: jest.fn().mockResolvedValue({ id: 'agency-1' }),
    },
    workspace: {
      count: jest.fn().mockResolvedValue(0),
      findUnique: jest.fn(),
      findFirst: jest.fn().mockResolvedValue({ id: 'workspace-1' }),
    },
    workspaceMembership: {
      count: jest.fn().mockResolvedValue(0),
    },
    automationWorkflow: { count: jest.fn().mockResolvedValue(0) },
    asset: { aggregate: jest.fn().mockResolvedValue({ _sum: { sizeBytes: 0n } }) },
    storageUploadReservation: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { reservedBytes: 0n } }),
    },
    billingUsageCounter: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
    },
    featureEntitlement: { findFirst: jest.fn().mockResolvedValue(null) },
    agencyResourceAllocation: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn(),
      create: jest.fn(),
    },
    workspaceResourceAllocation: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({
        id: 'workspace-allocation-1',
        allocated: 1n,
        unlimited: false,
      }),
    },
  };
  const prisma = {
    $transaction: jest.fn((callback: (inner: typeof tx) => unknown) => callback(tx)),
    superAgencySubscription: { findFirst: jest.fn().mockResolvedValue(subscription) },
    featureEntitlement: { findMany: jest.fn().mockResolvedValue([]) },
    agency: { count: jest.fn().mockResolvedValue(0), findUnique: jest.fn() },
    workspace: { count: jest.fn().mockResolvedValue(0), findUnique: jest.fn() },
    workspaceMembership: { count: jest.fn().mockResolvedValue(0) },
    automationWorkflow: { count: jest.fn().mockResolvedValue(0) },
    asset: { aggregate: jest.fn().mockResolvedValue({ _sum: { sizeBytes: 0n } }) },
    storageUploadReservation: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { reservedBytes: 0n } }),
    },
    billingUsageCounter: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
    },
    agencyResourceAllocation: {
      upsert: jest.fn().mockResolvedValue({
        id: 'agency-allocation-1',
        allocated: 1n,
        unlimited: false,
      }),
    },
    workspaceResourceAllocation: {
      upsert: jest.fn().mockResolvedValue({
        id: 'workspace-allocation-1',
        allocated: 1n,
        unlimited: false,
      }),
    },
    billingHistory: { create: jest.fn() },
  };
  return {
    service: new BillingEntitlementService(prisma as never, { record: jest.fn() } as never),
    prisma,
    tx,
  };
}

function subscriptionFixture(
  limitValues: Record<string, bigint | null>,
  featureValues: Record<string, boolean>,
) {
  return {
    id: 'subscription-1',
    superAgencyId: 'super-agency-1',
    masterPlanId: 'plan-1',
    planVersionId: 'version-1',
    status: SuperAgencySubscriptionStatus.ACTIVE,
    graceEndsAt: null,
    planVersion: {
      entitlements: [
        ...Object.entries(limitValues).map(([key, value]) => ({
          key,
          kind: PlanEntitlementKind.LIMIT,
          valueType:
            value === null ? PlanEntitlementValueType.UNLIMITED : PlanEntitlementValueType.COUNT,
          booleanValue: null,
          numericValue: value,
          unlimited: value === null,
        })),
        ...Object.entries(featureValues).map(([key, value]) => ({
          key,
          kind: PlanEntitlementKind.FEATURE,
          valueType: PlanEntitlementValueType.BOOLEAN,
          booleanValue: value,
          numericValue: null,
          unlimited: false,
        })),
      ],
    },
  };
}

function workspaceContext() {
  return {
    id: 'workspace-1',
    agencyId: 'agency-1',
    agency: { superAgencyId: 'super-agency-1' },
  };
}
