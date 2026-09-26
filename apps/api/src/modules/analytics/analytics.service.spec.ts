import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { AnalyticsBucket, AnalyticsScopeType, BillingUsageScope, Prisma } from '@prisma/client';
import { AnalyticsService } from './analytics.service';

describe('AnalyticsService', () => {
  const redis = {
    cache: {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('exposes a server-owned registry and excludes billing metrics from workspace scope', () => {
    const service = new AnalyticsService(minimalPrisma() as never, redis as never);
    const registry = service.registry();
    const billing = registry.metrics.find(
      (metric) => metric.key === 'billing.active_subscriptions',
    );

    expect(registry.metrics).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'tasks.total' })]),
    );
    expect(billing?.supportedScopes).toEqual(['SUPER_AGENCY', 'PLATFORM']);
    expect(billing?.supportedDimensions).toEqual([]);
    expect(billing?.supportedFilters).toEqual([]);
    expect(registry.policy.metricDefinitions).toBe('SERVER_OWNED_CODE_REGISTRY');
    expect(registry.policy.redisAuthority).toBe(false);
  });

  it('rejects unknown metric keys before a raw query shape can be supplied', async () => {
    const service = new AnalyticsService(prismaForWorkspace() as never, redis as never);

    await expect(
      service.workspaceSummary(
        workspaceTenant(),
        query({ metrics: 'tasks.total;DROP TABLE tasks' }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('denies financial billing analytics to Workspace scope', async () => {
    const service = new AnalyticsService(prismaForWorkspace() as never, redis as never);

    await expect(
      service.workspaceSummary(
        workspaceTenant(),
        query({ metrics: 'billing.active_subscriptions' }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('denies Workspace scope when a foreign Workspace filter is supplied', async () => {
    const service = new AnalyticsService(prismaForWorkspace() as never, redis as never);

    await expect(
      service.workspaceSummary(
        workspaceTenant(),
        query({
          workspaceId: '00000000-0000-4000-8000-000000000099',
        }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects unimplemented billing dimensions even for financial scopes', async () => {
    const service = new AnalyticsService(minimalPrisma() as never, redis as never);

    await expect(
      service.rebuildRollups(
        {
          type: 'SUPER_AGENCY',
          id: '00000000-0000-4000-8000-000000000001',
          workspaceIds: ['00000000-0000-4000-8000-000000000003'],
          agencyIds: ['00000000-0000-4000-8000-000000000002'],
          timezone: 'UTC',
          financialAllowed: true,
        },
        query({
          metrics: 'billing.active_subscriptions',
          dimension: 'SUBSCRIPTION_STATUS',
        }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('denies Agency scope when a requested Workspace is not a descendant', async () => {
    const prisma = minimalPrisma({
      workspace: { findMany: jest.fn().mockResolvedValue([]) },
    });
    const service = new AnalyticsService(prisma as never, redis as never);

    await expect(
      service.agencySummary(
        agencyTenant(),
        query({
          workspaceId: '00000000-0000-4000-8000-000000000099',
        }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('uses scope type and id in cache keys so same-id scopes cannot collide', async () => {
    const prisma = prismaForWorkspace({
      task: { count: jest.fn().mockResolvedValue(1) },
      statusDefinition: { findMany: jest.fn().mockResolvedValue([]) },
    });
    const service = new AnalyticsService(prisma as never, redis as never);

    await service.workspaceSummary(workspaceTenant(), query({ metrics: 'tasks.total' }));

    expect(redis.cache.set).toHaveBeenCalledWith(
      expect.stringContaining('analytics:WORKSPACE:00000000-0000-4000-8000-000000000003'),
      expect.any(String),
      'EX',
      30,
    );
  });

  it('rebuilds rollups under an advisory lock with delete-and-create idempotency', async () => {
    const prisma = minimalPrisma({
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ locked: true }])
        .mockResolvedValueOnce([{ unlocked: true }]),
      billingUsageCounter: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { used: 3n } }),
      },
      analyticsRollup: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        createMany: jest.fn().mockResolvedValue({ count: 7 }),
      },
    });
    const service = new AnalyticsService(prisma as never, redis as never);

    const result = await service.rebuildRollups(
      {
        type: 'WORKSPACE',
        id: '00000000-0000-4000-8000-000000000003',
        workspaceIds: ['00000000-0000-4000-8000-000000000003'],
        agencyIds: ['00000000-0000-4000-8000-000000000002'],
        timezone: 'UTC',
        financialAllowed: false,
      },
      query({ metrics: 'api.requests', datePreset: 'LAST_7_DAYS', bucket: 'DAY' }),
    );

    expect(result).toEqual({ rebuilt: 7, locked: false });
    const analyticsRollup = prisma.analyticsRollup as unknown as {
      deleteMany: jest.Mock;
      createMany: jest.Mock;
    };
    expect(analyticsRollup.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          scopeType: AnalyticsScopeType.WORKSPACE,
          metricKey: 'api.requests',
          bucket: AnalyticsBucket.DAY,
        }),
      }),
    );
    expect(analyticsRollup.createMany).toHaveBeenCalledTimes(1);
  });
});

function workspaceTenant() {
  return {
    userId: 'user-1',
    superAgencyId: '00000000-0000-4000-8000-000000000001',
    agencyId: '00000000-0000-4000-8000-000000000002',
    workspaceId: '00000000-0000-4000-8000-000000000003',
    workspaceMembershipId: 'member-1',
    agencyMembershipId: 'agency-member-1',
    roleId: 'role-1',
    roleName: 'OWNER',
    permissions: ['analytics.view'],
    accessSource: 'WORKSPACE_MEMBERSHIP',
  } as never;
}

function agencyTenant() {
  return {
    userId: 'user-1',
    superAgencyId: '00000000-0000-4000-8000-000000000001',
    agencyId: '00000000-0000-4000-8000-000000000002',
    agencyMembershipId: 'agency-member-1',
    roleId: 'role-1',
    roleName: 'AGENCY_OWNER',
    permissions: ['analytics.parent.read'],
  } as never;
}

function query(overrides: Record<string, unknown> = {}) {
  return {
    datePreset: 'LAST_30_DAYS',
    bucket: 'DAY',
    page: 1,
    pageSize: 50,
    ...overrides,
  } as never;
}

function prismaForWorkspace(overrides: Record<string, unknown> = {}) {
  return minimalPrisma({
    workspace: {
      findUnique: jest.fn().mockResolvedValue({
        id: '00000000-0000-4000-8000-000000000003',
        agencyId: '00000000-0000-4000-8000-000000000002',
        timezone: 'UTC',
        agency: { superAgencyId: '00000000-0000-4000-8000-000000000001' },
      }),
    },
    ...overrides,
  });
}

function minimalPrisma(overrides: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {
    $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
    $transaction: jest.fn((value: unknown) =>
      Array.isArray(value) ? Promise.all(value) : (value as (tx: unknown) => unknown)(base),
    ),
    workspace: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    agency: { findMany: jest.fn().mockResolvedValue([]) },
    analyticsRollup: { deleteMany: jest.fn(), createMany: jest.fn() },
    task: { count: jest.fn().mockResolvedValue(0) },
    project: { count: jest.fn().mockResolvedValue(0) },
    ticket: { count: jest.fn().mockResolvedValue(0) },
    statusDefinition: { findMany: jest.fn().mockResolvedValue([]) },
    gamificationXpEntry: { aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }) },
    gamificationGlobalScoreEvent: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { normalizedScore: 0 } }),
    },
    gamificationBadgeAward: { count: jest.fn().mockResolvedValue(0) },
    gamificationAchievementAward: { count: jest.fn().mockResolvedValue(0) },
    automationExecution: { count: jest.fn().mockResolvedValue(0) },
    automationWorkflow: { count: jest.fn().mockResolvedValue(0) },
    formSubmission: { count: jest.fn().mockResolvedValue(0) },
    goal: { count: jest.fn().mockResolvedValue(0) },
    asset: {
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue({ _sum: { sizeBytes: 0n } }),
    },
    storageUploadReservation: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { reservedBytes: 0n } }),
    },
    billingUsageCounter: {
      aggregate: jest
        .fn()
        .mockResolvedValue({ _sum: { used: 0n }, where: { scope: BillingUsageScope.WORKSPACE } }),
    },
    superAgencySubscription: { count: jest.fn().mockResolvedValue(0) },
  };
  return Object.assign(base, overrides) as unknown as Prisma.TransactionClient &
    Record<string, unknown>;
}
