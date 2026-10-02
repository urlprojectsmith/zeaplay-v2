import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import {
  AnalyticsScopeType,
  DashboardStatus,
  DashboardVisibility,
  DashboardWidgetDataSourceType,
  DashboardWidgetType,
} from '@prisma/client';
import { PermissionKeys } from '../../common/authorization/permissions';
import { CustomDashboardsService } from './custom-dashboards.service';

describe('CustomDashboardsService', () => {
  it('rejects Workspace financial widgets before persistence', async () => {
    const { service, prisma, scope, actor } = harness();

    await expect(
      service.create(scope as never, actor, {
        name: 'Finance leak',
        widgets: [
          {
            type: 'METRIC_CARD',
            title: 'Subscriptions',
            dataSourceType: 'ANALYTICS_QUERY',
            configuration: {
              metricKeys: ['billing.active_subscriptions'],
              datePreset: 'LAST_30_DAYS',
            },
            layout: { x: 0, y: 0, width: 4, height: 4 },
          },
        ],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.customDashboard.create).not.toHaveBeenCalled();
  });

  it('rejects dangerous widget configuration and arbitrary formulas', async () => {
    const { service, prisma, scope, actor } = harness();

    await expect(
      service.create(scope as never, actor, {
        name: 'Bad config',
        widgets: [
          {
            type: 'METRIC_CARD',
            title: 'Bad',
            dataSourceType: 'ANALYTICS_QUERY',
            configuration: {
              metricKeys: ['tasks.total'],
              datePreset: 'LAST_30_DAYS',
              // DTO validation catches this on HTTP; service validation keeps tests and internals safe.
              formula: 'select * from users',
            } as never,
            layout: { x: 0, y: 0, width: 4, height: 4 },
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.customDashboard.create).not.toHaveBeenCalled();
  });

  it('enforces the 30-widget service limit', async () => {
    const { service, prisma, scope, actor } = harness();

    await expect(
      service.create(scope as never, actor, {
        name: 'Too many',
        widgets: Array.from({ length: 31 }, (_, index) => ({
          type: 'METRIC_CARD' as const,
          title: `Metric ${index}`,
          dataSourceType: 'ANALYTICS_QUERY' as const,
          configuration: { metricKeys: ['tasks.total'], datePreset: 'LAST_30_DAYS' as const },
          layout: { x: 0, y: index, width: 4, height: 4, order: index },
        })),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.customDashboard.create).not.toHaveBeenCalled();
  });

  it('rejects stale dashboard revisions before widget mutation', async () => {
    const { service, prisma, scope, actor } = harness();
    prisma.customDashboard.findFirst.mockResolvedValue(dashboardRecord({ revision: 6 }));

    await expect(
      service.updateWidget(scope as never, actor, 'dashboard-1', 'widget-1', {
        expectedRevision: 5,
        title: 'Stale',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.dashboardWidget.update).not.toHaveBeenCalled();
  });

  it('returns per-widget access revoked state when a saved report is no longer readable', async () => {
    const { service, prisma, reports, scope, actor } = harness();
    prisma.customDashboard.findFirst.mockResolvedValue(
      dashboardRecord({
        widgets: [
          {
            id: 'widget-report',
            dashboardId: 'dashboard-1',
            type: DashboardWidgetType.TABLE,
            title: 'Report',
            description: null,
            dataSourceType: DashboardWidgetDataSourceType.SAVED_REPORT,
            configuration: { reportId: 'report-1' },
            layout: { x: 0, y: 0, width: 6, height: 5, order: 0 },
            refreshSeconds: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      }),
    );
    reports.preview.mockRejectedValue(new ForbiddenException('REPORT_ACCESS_DENIED'));

    const result = await service.render(scope as never, actor, 'dashboard-1');

    expect(result.widgets[0]).toEqual(
      expect.objectContaining({
        status: 'ACCESS_REVOKED',
        errorCode: expect.stringContaining('REPORT_ACCESS_DENIED'),
      }),
    );
  });
});

function harness() {
  type MockPrisma = {
    customDashboard: { create: jest.Mock; findFirst: jest.Mock; update: jest.Mock };
    dashboardAccess: { deleteMany: jest.Mock };
    dashboardWidget: { create: jest.Mock; update: jest.Mock; delete: jest.Mock };
    dashboardPreference: {
      findUnique: jest.Mock;
      delete: jest.Mock;
      updateMany: jest.Mock;
      upsert: jest.Mock;
    };
    workspaceMembership: { count: jest.Mock };
    agencyMembership: { count: jest.Mock };
    superAgencyMembership: { count: jest.Mock };
    user: { count: jest.Mock };
    workspace: { findUnique: jest.Mock };
    agency: { findUnique: jest.Mock };
    superAgency: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };
  const prisma = {} as MockPrisma;
  Object.assign(prisma, {
    customDashboard: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    dashboardAccess: { deleteMany: jest.fn() },
    dashboardWidget: {
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    dashboardPreference: {
      findUnique: jest.fn(),
      delete: jest.fn(),
      updateMany: jest.fn(),
      upsert: jest.fn(),
    },
    workspaceMembership: { count: jest.fn() },
    agencyMembership: { count: jest.fn() },
    superAgencyMembership: { count: jest.fn() },
    user: { count: jest.fn() },
    workspace: { findUnique: jest.fn() },
    agency: { findUnique: jest.fn() },
    superAgency: { findUnique: jest.fn() },
    $transaction: jest.fn((input: unknown): Promise<unknown> =>
      Promise.resolve(
        typeof input === 'function' ? (input as (tx: MockPrisma) => unknown)(prisma) : input,
      ),
    ),
  });
  const analytics = {
    workspaceSummary: jest.fn(),
    agencySummary: jest.fn(),
    superAgencySummary: jest.fn(),
    platformSummary: jest.fn(),
  };
  const reports = { preview: jest.fn() };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  return {
    service: new CustomDashboardsService(
      prisma as never,
      analytics as never,
      reports as never,
      audit as never,
    ),
    prisma,
    analytics,
    reports,
    scope: {
      type: AnalyticsScopeType.WORKSPACE,
      id: '00000000-0000-4000-8000-000000000001',
      workspaceId: '00000000-0000-4000-8000-000000000001',
      agencyId: '00000000-0000-4000-8000-000000000002',
      superAgencyId: '00000000-0000-4000-8000-000000000003',
    },
    actor: {
      userId: '00000000-0000-4000-8000-000000000004',
      workspaceMembershipId: '00000000-0000-4000-8000-000000000005',
      permissions: [
        PermissionKeys.dashboardsView,
        PermissionKeys.dashboardsCreate,
        PermissionKeys.dashboardsEdit,
        PermissionKeys.dashboardsManage,
        PermissionKeys.analyticsView,
        PermissionKeys.reportsView,
      ],
    },
  };
}

function dashboardRecord(overrides: Record<string, unknown> = {}): never {
  return {
    id: 'dashboard-1',
    scopeType: AnalyticsScopeType.WORKSPACE,
    scopeId: '00000000-0000-4000-8000-000000000001',
    name: 'Ops',
    description: null,
    visibility: DashboardVisibility.WORKSPACE,
    createdByUserId: '00000000-0000-4000-8000-000000000004',
    globalFilters: {},
    revision: 6,
    status: DashboardStatus.ACTIVE,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    accesses: [],
    widgets: [
      {
        id: 'widget-1',
        dashboardId: 'dashboard-1',
        type: DashboardWidgetType.METRIC_CARD,
        title: 'Tasks',
        description: null,
        dataSourceType: DashboardWidgetDataSourceType.ANALYTICS_QUERY,
        configuration: { metricKeys: ['tasks.total'] },
        layout: { x: 0, y: 0, width: 4, height: 4, order: 0 },
        refreshSeconds: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    preferences: [],
    ...overrides,
  } as never;
}
