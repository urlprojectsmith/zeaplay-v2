import { randomUUID } from 'node:crypto';
import {
  AnalyticsScopeType,
  AssetLifecycle,
  AssetStatus,
  BillingUsageScope,
  DashboardWidgetType,
  FormSubmissionSource,
  FormType,
  GamificationGlobalScoreEventScoreType,
  GamificationGlobalScoreEventStatus,
  GamificationPointWorkType,
  GamificationWorkXpEventOutcome,
  GamificationWorkXpEventType,
  GamificationXpEntryType,
  GamificationXpSourceType,
  GoalMetricType,
  GoalOwnerType,
  GoalPeriodType,
  GoalStatus,
  MembershipStatus,
  ProjectStatus,
  ReportStatus,
  ReportType,
  ReportVisibility,
  RoleScope,
  StatusCategory,
  StatusEntityType,
  TaskPriority,
} from '@prisma/client';
import { PermissionKeys } from '../src/common/authorization/permissions';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { BILLING_RESOURCE_KEYS } from '../src/modules/billing/billing.constants';
import { AnalyticsService } from '../src/modules/analytics/analytics.service';
import { ReportsService } from '../src/modules/reports/reports.service';
import { CustomDashboardsService } from '../src/modules/custom-dashboards/custom-dashboards.service';
import type { CreateDashboardWidgetDto } from '../src/modules/custom-dashboards/dto/custom-dashboards.dto';

jest.setTimeout(90_000);

const audit = { record: jest.fn().mockResolvedValue(undefined) };
const storage = { upload: jest.fn(), createPresignedDownloadUrl: jest.fn() };
const queue = { add: jest.fn() };

describe('Phase 17.4 real PostgreSQL Custom Dashboards integration', () => {
  let prisma: PrismaService;
  let analytics: AnalyticsService;
  let reports: ReportsService;
  let dashboards: CustomDashboardsService;
  let cache: Map<string, string>;
  let ids: SeedIds;

  beforeAll(async () => {
    expect(process.env.DATABASE_URL).toBeTruthy();
    prisma = new PrismaService();
    await prisma.$connect();
    cache = new Map();
    analytics = new AnalyticsService(prisma, redisHarness(cache) as never);
    reports = new ReportsService(
      prisma,
      analytics,
      audit as never,
      storage as never,
      queue as never,
    );
    dashboards = new CustomDashboardsService(prisma, analytics, reports, audit as never);
  });

  afterAll(async () => {
    await cleanup(prisma, ids).catch(() => undefined);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    ids = makeIds();
    cache.clear();
    audit.record.mockClear();
    await cleanup(prisma, ids);
    await seedTenant(prisma, ids);
    await seedOperationalRows(prisma, ids);
  });

  afterEach(async () => {
    await cleanup(prisma, ids);
  });

  it('renders real Workspace analytics and saved Report widgets from canonical sources', async () => {
    const scope = workspaceScope(ids);
    const actor = workspaceOwnerActor(ids);
    const report = await createReport(prisma, ids, {
      visibility: ReportVisibility.SCOPE,
      metricKeys: ['tasks.total'],
    });

    const created = await dashboards.create(scope, actor, {
      name: 'Workspace proof',
      visibility: 'WORKSPACE',
      globalFilters: { datePreset: 'LAST_30_DAYS' },
      widgets: [
        widget('Tasks', ['tasks.total']),
        widget('Projects', ['projects.active']),
        widget('Tickets', ['tickets.open']),
        widget('Forms', ['forms.submissions']),
        widget('Goals', ['goals.active'], 'GOAL_PROGRESS'),
        widget('XP', ['gamification.xp_earned'], 'GAMIFICATION_SUMMARY'),
        widget('Score', ['gamification.global_score'], 'GAMIFICATION_SUMMARY'),
        widget('Storage', ['files.storage_bytes']),
        widget('API', ['api.requests']),
        reportWidget(report.id),
      ],
    });

    const rendered = await dashboards.render(scope, actor, created.dashboard.id);

    expect(rendered.queryConcurrency).toBe(1);
    expect(rendered.widgets).toHaveLength(10);
    expect(rendered.widgets.every((item) => item.status === 'SUCCESS')).toBe(true);
    expect(metricValue(rendered, 'tasks.total')).toBe(1);
    expect(metricValue(rendered, 'projects.active')).toBe(1);
    expect(metricValue(rendered, 'tickets.open')).toBe(1);
    expect(metricValue(rendered, 'forms.submissions')).toBe(1);
    expect(metricValue(rendered, 'goals.active')).toBe(1);
    expect(metricValue(rendered, 'gamification.xp_earned')).toBe(40);
    expect(metricValue(rendered, 'gamification.global_score')).toBe(7);
    expect(metricValue(rendered, 'files.storage_bytes')).toBe(32);
    expect(metricValue(rendered, 'api.requests')).toBe(9);
    expect(rendered.widgets.at(-1)).toMatchObject({
      status: 'SUCCESS',
      data: { table: { rows: expect.any(Array) } },
    });

    await expect(
      prisma.gamificationXpEntry.count({ where: { workspaceId: ids.workspace } }),
    ).resolves.toBe(1);
    await expect(
      prisma.gamificationGlobalScoreEvent.count({ where: { workspaceId: ids.workspace } }),
    ).resolves.toBe(1);
  });

  it('rechecks dashboard ACL, module permissions, Report ACL, and archived Report state at render time', async () => {
    const scope = workspaceScope(ids);
    const owner = workspaceOwnerActor(ids);
    const member = workspaceMemberActor(ids);
    const report = await createReport(prisma, ids, {
      visibility: ReportVisibility.SELECTED_MEMBERS,
      accessMembershipIds: [ids.workspaceMembershipB],
      metricKeys: ['tasks.total'],
    });
    const selected = await dashboards.create(scope, owner, {
      name: 'Selected proof',
      visibility: 'SELECTED_MEMBERS',
      accessMembershipIds: [ids.workspaceMembershipB],
      widgets: [widget('Tasks', ['tasks.total'])],
    });

    await expect(dashboards.get(scope, member, selected.dashboard.id)).resolves.toMatchObject({
      dashboard: { id: selected.dashboard.id },
    });

    await dashboards.update(scope, owner, selected.dashboard.id, {
      expectedRevision: selected.dashboard.revision,
      visibility: 'PRIVATE',
      accessMembershipIds: [],
    });
    await expect(dashboards.get(scope, member, selected.dashboard.id)).rejects.toMatchObject({
      status: 403,
    });

    const shared = await dashboards.create(scope, owner, {
      name: 'Module proof',
      visibility: 'WORKSPACE',
      widgets: [widget('Tasks', ['tasks.total']), reportWidget(report.id)],
    });
    await expect(dashboards.render(scope, member, shared.dashboard.id)).resolves.toMatchObject({
      widgets: [expect.objectContaining({ status: 'SUCCESS' }), expect.any(Object)],
    });

    const withoutAnalytics = {
      ...member,
      permissions: [PermissionKeys.dashboardsView, PermissionKeys.reportsView],
    };
    await expect(dashboards.render(scope, withoutAnalytics, shared.dashboard.id)).resolves.toEqual(
      expect.objectContaining({
        widgets: expect.arrayContaining([expect.objectContaining({ status: 'ACCESS_REVOKED' })]),
      }),
    );

    await prisma.reportAccess.deleteMany({ where: { reportId: report.id } });
    await expect(dashboards.render(scope, member, shared.dashboard.id)).resolves.toEqual(
      expect.objectContaining({
        widgets: expect.arrayContaining([expect.objectContaining({ status: 'ACCESS_REVOKED' })]),
      }),
    );

    await prisma.reportAccess.create({
      data: {
        reportId: report.id,
        scopeType: AnalyticsScopeType.WORKSPACE,
        scopeId: ids.workspace,
        workspaceMembershipId: ids.workspaceMembershipB,
      },
    });
    await prisma.report.update({
      where: { id: report.id },
      data: { status: ReportStatus.ARCHIVED, archivedAt: new Date() },
    });
    await expect(dashboards.render(scope, member, shared.dashboard.id)).resolves.toEqual(
      expect.objectContaining({
        widgets: expect.arrayContaining([expect.objectContaining({ status: 'UNAVAILABLE' })]),
      }),
    );
  });

  it('isolates same-ID Agency/Super Agency dashboards, defaults, and parent aggregates', async () => {
    const agencyScopeValue = agencyScope(ids);
    const superScopeValue = superAgencyScope(ids);
    const agencyActor = agencyOwnerActor(ids);
    const superActor = superAgencyOwnerActor(ids);

    expect(agencyScopeValue.id).toBe(superScopeValue.id);

    const agencyDashboard = await dashboards.create(agencyScopeValue, agencyActor, {
      name: 'Agency aggregate',
      visibility: 'SCOPE',
      widgets: [widget('Agency tasks', ['tasks.total'], 'TABLE', 'WORKSPACE')],
    });
    const superDashboard = await dashboards.create(superScopeValue, superActor, {
      name: 'Super aggregate',
      visibility: 'SCOPE',
      widgets: [widget('Super tasks', ['tasks.total'], 'TABLE', 'WORKSPACE')],
    });

    await dashboards.setDefault(agencyScopeValue, agencyActor, agencyDashboard.dashboard.id);
    await dashboards.setDefault(superScopeValue, superActor, superDashboard.dashboard.id);

    await expect(
      prisma.dashboardPreference.count({
        where: { userId: ids.userA, scopeId: ids.agency },
      }),
    ).resolves.toBe(2);
    await expect(
      prisma.dashboardPreference.count({
        where: { userId: ids.userA, contextKey: `AGENCY:${ids.agency}`, isDefault: true },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.dashboardPreference.count({
        where: {
          userId: ids.userA,
          contextKey: `SUPER_AGENCY:${ids.superAgency}`,
          isDefault: true,
        },
      }),
    ).resolves.toBe(1);

    const agencyRendered = await dashboards.render(
      agencyScopeValue,
      agencyActor,
      agencyDashboard.dashboard.id,
    );
    const superRendered = await dashboards.render(
      superScopeValue,
      superActor,
      superDashboard.dashboard.id,
    );

    expect(dimensionTotal(agencyRendered)).toBe(2);
    expect(dimensionTotal(superRendered)).toBe(2);
    expect(dimensionLabels(agencyRendered)).toEqual(['Primary Workspace', 'Second Workspace']);
    expect(dimensionLabels(superRendered)).toEqual(['Primary Workspace', 'Second Workspace']);
  });

  it('preserves optimistic concurrency and the 30-widget invariant under concurrent writes', async () => {
    const scope = workspaceScope(ids);
    const actor = workspaceOwnerActor(ids);
    const stale = await dashboards.create(scope, actor, {
      name: 'Revision proof',
      widgets: [widget('Tasks', ['tasks.total'])],
    });
    const updated = await dashboards.update(scope, actor, stale.dashboard.id, {
      expectedRevision: stale.dashboard.revision,
      name: 'Revision proof updated',
    });

    await expect(
      dashboards.updateWidget(scope, actor, stale.dashboard.id, stale.dashboard.widgets[0]!.id, {
        expectedRevision: stale.dashboard.revision,
        title: 'Stale widget',
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      dashboards.updateLayout(scope, actor, stale.dashboard.id, {
        expectedRevision: stale.dashboard.revision,
        layouts: [
          {
            widgetId: stale.dashboard.widgets[0]!.id,
            layout: { x: 0, y: 1, width: 6, height: 4, order: 1 },
          },
        ],
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(updated.dashboard.revision).toBe(stale.dashboard.revision + 1);

    const limit = await dashboards.create(scope, actor, {
      name: 'Limit proof',
      widgets: Array.from({ length: 29 }, (_, index) =>
        widget(`Metric ${index}`, ['tasks.total'], 'METRIC_CARD', undefined, index),
      ),
    });
    const additions = await Promise.allSettled([
      dashboards.addWidget(
        scope,
        actor,
        limit.dashboard.id,
        widget('Concurrent A', ['tasks.total']),
      ),
      dashboards.addWidget(
        scope,
        actor,
        limit.dashboard.id,
        widget('Concurrent B', ['tasks.total']),
      ),
    ]);
    expect(additions.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    await expect(
      prisma.dashboardWidget.count({ where: { dashboardId: limit.dashboard.id } }),
    ).resolves.toBe(30);
    await expect(
      prisma.dashboardWidget.create({
        data: {
          dashboardId: limit.dashboard.id,
          type: DashboardWidgetType.METRIC_CARD,
          title: 'Direct 31',
          dataSourceType: 'ANALYTICS_QUERY',
          configuration: { metricKeys: ['tasks.total'] },
          layout: { x: 0, y: 30, width: 4, height: 4, order: 30 },
        },
      }),
    ).rejects.toThrow(/DASHBOARD_WIDGET_LIMIT_EXCEEDED/);
  });

  it('validates financial safety and instantiates all code-owned templates', async () => {
    const workspaceTemplates = dashboards.templates(workspaceScope(ids)).templates;
    const superTemplates = dashboards.templates(superAgencyScope(ids)).templates;

    expect(workspaceTemplates.map((template) => template.key)).not.toContain('commercial-health');
    expect(workspaceTemplates).toHaveLength(8);
    expect(superTemplates.map((template) => template.key)).toContain('commercial-health');
    expect(superTemplates).toHaveLength(9);

    await expect(
      dashboards.create(workspaceScope(ids), workspaceOwnerActor(ids), {
        name: 'Forbidden finance',
        widgets: [widget('Finance', ['billing.active_subscriptions'])],
      }),
    ).rejects.toMatchObject({ status: 403 });

    for (const template of workspaceTemplates) {
      await expect(
        dashboards.createFromTemplate(workspaceScope(ids), workspaceOwnerActor(ids), {
          templateKey: template.key,
        }),
      ).resolves.toMatchObject({ dashboard: { name: template.name } });
    }
    for (const template of superTemplates) {
      await expect(
        dashboards.createFromTemplate(superAgencyScope(ids), superAgencyOwnerActor(ids), {
          templateKey: template.key,
        }),
      ).resolves.toMatchObject({ dashboard: { name: template.name } });
    }
  });
});

function widget(
  title: string,
  metricKeys: string[],
  type: CreateDashboardWidgetDto['type'] = 'METRIC_CARD',
  dimension?: string,
  order = 0,
): CreateDashboardWidgetDto {
  return {
    type,
    title,
    dataSourceType: 'ANALYTICS_QUERY',
    configuration: {
      metricKeys,
      datePreset: 'LAST_30_DAYS',
      bucket: 'DAY',
      ...(dimension ? { dimension: dimension as never } : {}),
    },
    layout: { x: (order % 3) * 4, y: Math.floor(order / 3) * 4, width: 4, height: 4, order },
    refreshSeconds: order === 0 ? 60 : undefined,
  };
}

function reportWidget(reportId: string): CreateDashboardWidgetDto {
  return {
    type: 'TABLE',
    title: 'Saved report',
    dataSourceType: 'SAVED_REPORT',
    configuration: { reportId },
    layout: { x: 0, y: 20, width: 12, height: 6, order: 20 },
  };
}

async function createReport(
  prisma: PrismaService,
  ids: SeedIds,
  options: {
    visibility: ReportVisibility;
    metricKeys: string[];
    accessMembershipIds?: string[];
  },
) {
  return prisma.report.create({
    data: {
      id: ids.nextReport(),
      scopeType: AnalyticsScopeType.WORKSPACE,
      scopeId: ids.workspace,
      workspaceId: ids.workspace,
      agencyId: ids.agency,
      superAgencyId: ids.superAgency,
      createdByUserId: ids.userA,
      createdByWorkspaceMembershipId: ids.workspaceMembershipA,
      name: `Report ${ids.run}`,
      type: ReportType.SUMMARY,
      visibility: options.visibility,
      configuration: {
        metricKeys: options.metricKeys,
        datePreset: 'LAST_30_DAYS',
        bucket: 'DAY',
      },
      accesses: {
        create: (options.accessMembershipIds ?? []).map((membershipId) => ({
          scopeType: AnalyticsScopeType.WORKSPACE,
          scopeId: ids.workspace,
          workspaceMembershipId: membershipId,
        })),
      },
    },
  });
}

async function seedTenant(prisma: PrismaService, ids: SeedIds) {
  await prisma.user.createMany({
    data: [
      { id: ids.userA, email: `${ids.run}-a@example.test`, passwordHash: 'hash' },
      { id: ids.userB, email: `${ids.run}-b@example.test`, passwordHash: 'hash' },
    ],
  });
  await prisma.role.createMany({
    data: [
      {
        id: ids.roleWorkspace,
        key: `p174_workspace_${ids.short}`,
        name: 'Phase 17.4 Workspace',
        scope: RoleScope.WORKSPACE,
      },
      {
        id: ids.roleAgency,
        key: `p174_agency_${ids.short}`,
        name: 'Phase 17.4 Agency',
        scope: RoleScope.AGENCY,
      },
      {
        id: ids.roleSuperAgency,
        key: `p174_super_${ids.short}`,
        name: 'Phase 17.4 Super',
        scope: RoleScope.SUPER_AGENCY,
      },
    ],
  });
  await prisma.superAgency.create({
    data: {
      id: ids.superAgency,
      name: 'Same ID Super Agency',
      slug: `p174-super-${ids.short}`,
      createdById: ids.userA,
    },
  });
  await prisma.superAgency.create({
    data: {
      id: ids.foreignSuperAgency,
      name: 'Foreign Super Agency',
      slug: `p174-super-foreign-${ids.short}`,
      createdById: ids.userA,
    },
  });
  await prisma.agency.createMany({
    data: [
      {
        id: ids.agency,
        superAgencyId: ids.superAgency,
        name: 'Same ID Agency',
        slug: `p174-agency-${ids.short}`,
        createdById: ids.userA,
      },
      {
        id: ids.foreignAgency,
        superAgencyId: ids.foreignSuperAgency,
        name: 'Foreign Agency',
        slug: `p174-agency-foreign-${ids.short}`,
        createdById: ids.userA,
      },
    ],
  });
  await prisma.workspace.createMany({
    data: [
      {
        id: ids.workspace,
        agencyId: ids.agency,
        name: 'Primary Workspace',
        slug: `p174-workspace-${ids.short}`,
        timezone: 'UTC',
        createdById: ids.userA,
      },
      {
        id: ids.workspaceSecond,
        agencyId: ids.agency,
        name: 'Second Workspace',
        slug: `p174-workspace-second-${ids.short}`,
        timezone: 'UTC',
        createdById: ids.userA,
      },
      {
        id: ids.foreignWorkspace,
        agencyId: ids.foreignAgency,
        name: 'Foreign Workspace',
        slug: `p174-workspace-foreign-${ids.short}`,
        timezone: 'UTC',
        createdById: ids.userA,
      },
    ],
  });
  await prisma.superAgencyMembership.create({
    data: {
      id: ids.superAgencyMembership,
      userId: ids.userA,
      superAgencyId: ids.superAgency,
      roleId: ids.roleSuperAgency,
    },
  });
  await prisma.agencyMembership.create({
    data: {
      id: ids.agencyMembership,
      userId: ids.userA,
      agencyId: ids.agency,
      roleId: ids.roleAgency,
    },
  });
  await prisma.workspaceMembership.createMany({
    data: [
      {
        id: ids.workspaceMembershipA,
        userId: ids.userA,
        workspaceId: ids.workspace,
        roleId: ids.roleWorkspace,
        status: MembershipStatus.ACTIVE,
      },
      {
        id: ids.workspaceMembershipB,
        userId: ids.userB,
        workspaceId: ids.workspace,
        roleId: ids.roleWorkspace,
        status: MembershipStatus.ACTIVE,
      },
    ],
  });
}

async function seedOperationalRows(prisma: PrismaService, ids: SeedIds) {
  const createdAt = new Date('2026-09-15T00:00:00.000Z');
  await prisma.statusDefinition.createMany({
    data: [
      status(ids.taskStatus, ids.workspace, StatusEntityType.TASK),
      status(ids.ticketStatus, ids.workspace, StatusEntityType.TICKET),
      status(ids.secondTaskStatus, ids.workspaceSecond, StatusEntityType.TASK),
      status(ids.foreignTaskStatus, ids.foreignWorkspace, StatusEntityType.TASK),
    ],
  });
  await prisma.task.createMany({
    data: [
      {
        id: ids.task,
        workspaceId: ids.workspace,
        title: 'Dashboard task',
        statusDefinitionId: ids.taskStatus,
        priority: TaskPriority.HIGH,
        createdById: ids.userA,
        createdAt,
      },
      {
        id: ids.secondTask,
        workspaceId: ids.workspaceSecond,
        title: 'Second workspace task',
        statusDefinitionId: ids.secondTaskStatus,
        priority: TaskPriority.MEDIUM,
        createdById: ids.userA,
        createdAt,
      },
      {
        id: ids.foreignTask,
        workspaceId: ids.foreignWorkspace,
        title: 'Foreign task',
        statusDefinitionId: ids.foreignTaskStatus,
        priority: TaskPriority.MEDIUM,
        createdById: ids.userA,
        createdAt,
      },
    ],
  });
  await prisma.project.create({
    data: {
      id: ids.project,
      workspaceId: ids.workspace,
      name: 'Dashboard project',
      status: ProjectStatus.ACTIVE,
      ownerMembershipId: ids.workspaceMembershipA,
      createdById: ids.userA,
      createdAt,
    },
  });
  await prisma.ticket.create({
    data: {
      id: ids.ticket,
      workspaceId: ids.workspace,
      sequenceNumber: 174,
      ticketNumber: 'P17-174',
      subject: 'Dashboard ticket',
      statusDefinitionId: ids.ticketStatus,
      priority: TaskPriority.HIGH,
      createdByMembershipId: ids.workspaceMembershipA,
      createdAt,
    },
  });
  await prisma.form.create({
    data: {
      id: ids.form,
      workspaceId: ids.workspace,
      publicId: `p174-${ids.short}`,
      title: 'Dashboard form',
      type: FormType.FORM,
      createdByMembershipId: ids.workspaceMembershipA,
      createdAt,
    },
  });
  await prisma.formVersion.create({
    data: {
      id: ids.formVersion,
      formId: ids.form,
      workspaceId: ids.workspace,
      versionNumber: 1,
      titleSnapshot: 'Dashboard form',
      schema: { fields: [] },
      createdByMembershipId: ids.workspaceMembershipA,
      createdAt,
    },
  });
  await prisma.formSubmission.create({
    data: {
      id: ids.formSubmission,
      formId: ids.form,
      formVersionId: ids.formVersion,
      workspaceId: ids.workspace,
      source: FormSubmissionSource.INTERNAL,
      submittedByMembershipId: ids.workspaceMembershipA,
      answers: { safe: 'aggregate only' },
      createdAt,
    },
  });
  await prisma.goal.create({
    data: {
      id: ids.goal,
      workspaceId: ids.workspace,
      ownerType: GoalOwnerType.WORKSPACE,
      metricType: GoalMetricType.TASKS_COMPLETED,
      periodType: GoalPeriodType.MONTHLY,
      title: 'Dashboard goal',
      targetValue: 10,
      currentProgress: 2,
      status: GoalStatus.ACTIVE,
      periodStart: new Date('2026-09-01T00:00:00.000Z'),
      periodEnd: new Date('2026-10-01T00:00:00.000Z'),
      createdByMembershipId: ids.workspaceMembershipA,
      createdAt,
    },
  });
  await prisma.gamificationWorkXpEvent.create({
    data: {
      id: ids.workXpEvent,
      workspaceId: ids.workspace,
      recipientMembershipId: ids.workspaceMembershipA,
      triggeredByMembershipId: ids.workspaceMembershipA,
      workType: GamificationPointWorkType.TASK,
      sourceEntityId: ids.task,
      eventType: GamificationWorkXpEventType.COMPLETION_AWARD,
      correlationKey: `p174-score-${ids.short}`,
      idempotencyKey: `p174-work-${ids.short}`,
      outcome: GamificationWorkXpEventOutcome.APPLIED,
      netXpSnapshot: 40,
      occurredAt: createdAt,
      createdAt,
    },
  });
  await prisma.gamificationXpEntry.create({
    data: {
      id: ids.xpEntry,
      workspaceId: ids.workspace,
      membershipId: ids.workspaceMembershipA,
      amount: 40,
      entryType: GamificationXpEntryType.EARN,
      sourceType: GamificationXpSourceType.TASK,
      sourceEvent: 'dashboard-proof',
      sourceEntityId: ids.task,
      workXpEventId: ids.workXpEvent,
      idempotencyKey: `p174-xp-${ids.short}`,
      createdAt,
    },
  });
  await prisma.gamificationGlobalScoreEvent.create({
    data: {
      id: ids.globalScore,
      workspaceId: ids.workspace,
      recipientMembershipId: ids.workspaceMembershipA,
      workXpEventId: ids.workXpEvent,
      workType: GamificationPointWorkType.TASK,
      sourceEntityId: ids.task,
      eventType: GamificationWorkXpEventType.COMPLETION_AWARD,
      scoreType: GamificationGlobalScoreEventScoreType.COMPLETION,
      normalizedScore: 7,
      status: GamificationGlobalScoreEventStatus.APPLIED,
      occurredAt: createdAt,
      idempotencyKey: `p174-global-${ids.short}`,
      createdAt,
    },
  });
  await prisma.asset.create({
    data: {
      id: ids.asset,
      workspaceId: ids.workspace,
      createdById: ids.userA,
      uploadedByMembershipId: ids.workspaceMembershipA,
      originalFilename: 'dashboard.txt',
      displayName: 'dashboard.txt',
      storageBucket: 'phase174',
      storageProvider: 'MINIO',
      storageKey: `phase174/${ids.short}/dashboard.txt`,
      mimeType: 'text/plain',
      extension: 'txt',
      sizeBytes: 32,
      status: AssetStatus.READY,
      lifecycle: AssetLifecycle.ACTIVE,
      uploadExpiresAt: new Date('2026-10-01T00:00:00.000Z'),
      createdAt,
    },
  });
  await prisma.billingUsageCounter.create({
    data: {
      id: ids.usageCounter,
      scope: BillingUsageScope.WORKSPACE,
      scopeId: ids.workspace,
      resourceKey: BILLING_RESOURCE_KEYS.apiRequests,
      periodStart: new Date('2026-09-01T00:00:00.000Z'),
      periodEnd: new Date('2026-10-01T00:00:00.000Z'),
      used: 9n,
    },
  });
}

function status(id: string, workspaceId: string, entityType: StatusEntityType) {
  return {
    id,
    workspaceId,
    entityType,
    name: `${entityType} Open`,
    nameNormalized: `${entityType.toLowerCase()}-open-${workspaceId.slice(0, 8)}`,
    color: '#3366ff',
    position: 1,
    category: StatusCategory.TODO,
    isDefault: true,
    isSystem: true,
    isTerminal: false,
  };
}

async function cleanup(prisma: PrismaService, ids?: SeedIds) {
  if (!ids) return;
  const workspaceIds = [ids.workspace, ids.workspaceSecond, ids.foreignWorkspace];
  const agencyIds = [ids.agency, ids.foreignAgency];
  const superAgencyIds = [ids.superAgency, ids.foreignSuperAgency];
  const userIds = [ids.userA, ids.userB];
  const roleIds = [ids.roleWorkspace, ids.roleAgency, ids.roleSuperAgency];

  await prisma.customDashboard.deleteMany({
    where: { OR: [{ scopeId: { in: [...workspaceIds, ...agencyIds, ...superAgencyIds] } }] },
  });
  await prisma.reportExecution.deleteMany({ where: { scopeId: { in: workspaceIds } } });
  await prisma.report.deleteMany({ where: { scopeId: { in: workspaceIds } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.billingUsageCounter.deleteMany({ where: { scopeId: { in: workspaceIds } } });
  await prisma.asset.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.goal.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.formSubmission.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.formVersion.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.form.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await deleteGamificationRows(prisma, workspaceIds);
  await prisma.ticket.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.project.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.task.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.statusDefinition.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.workspaceMembership.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.agencyMembership.deleteMany({ where: { agencyId: { in: agencyIds } } });
  await prisma.superAgencyMembership.deleteMany({
    where: { superAgencyId: { in: superAgencyIds } },
  });
  await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
  await prisma.agency.deleteMany({ where: { id: { in: agencyIds } } });
  await prisma.superAgency.deleteMany({ where: { id: { in: superAgencyIds } } });
  await prisma.role.deleteMany({ where: { id: { in: roleIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function deleteGamificationRows(prisma: PrismaService, workspaceIds: string[]) {
  await prisma.$executeRawUnsafe(
    'ALTER TABLE gamification_global_score_events DISABLE TRIGGER USER',
  );
  await prisma.$executeRawUnsafe('ALTER TABLE gamification_work_xp_events DISABLE TRIGGER USER');
  await prisma.$executeRawUnsafe('ALTER TABLE gamification_xp_entries DISABLE TRIGGER USER');
  try {
    await prisma.gamificationGlobalScoreEvent.deleteMany({
      where: { workspaceId: { in: workspaceIds } },
    });
    await prisma.gamificationXpEntry.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.gamificationWorkXpEvent.deleteMany({
      where: { workspaceId: { in: workspaceIds } },
    });
  } finally {
    await prisma.$executeRawUnsafe('ALTER TABLE gamification_xp_entries ENABLE TRIGGER USER');
    await prisma.$executeRawUnsafe('ALTER TABLE gamification_work_xp_events ENABLE TRIGGER USER');
    await prisma.$executeRawUnsafe(
      'ALTER TABLE gamification_global_score_events ENABLE TRIGGER USER',
    );
  }
}

function workspaceScope(ids: SeedIds) {
  return {
    type: AnalyticsScopeType.WORKSPACE,
    id: ids.workspace,
    workspaceId: ids.workspace,
    agencyId: ids.agency,
    superAgencyId: ids.superAgency,
  };
}

function agencyScope(ids: SeedIds) {
  return {
    type: AnalyticsScopeType.AGENCY,
    id: ids.agency,
    workspaceId: null,
    agencyId: ids.agency,
    superAgencyId: ids.superAgency,
  };
}

function superAgencyScope(ids: SeedIds) {
  return {
    type: AnalyticsScopeType.SUPER_AGENCY,
    id: ids.superAgency,
    workspaceId: null,
    agencyId: null,
    superAgencyId: ids.superAgency,
  };
}

function workspaceOwnerActor(ids: SeedIds) {
  return {
    userId: ids.userA,
    workspaceMembershipId: ids.workspaceMembershipA,
    agencyMembershipId: ids.agencyMembership,
    permissions: [
      PermissionKeys.dashboardsView,
      PermissionKeys.dashboardsCreate,
      PermissionKeys.dashboardsEdit,
      PermissionKeys.dashboardsManage,
      PermissionKeys.analyticsView,
      PermissionKeys.reportsView,
    ],
  };
}

function workspaceMemberActor(ids: SeedIds) {
  return {
    userId: ids.userB,
    workspaceMembershipId: ids.workspaceMembershipB,
    permissions: [
      PermissionKeys.dashboardsView,
      PermissionKeys.analyticsView,
      PermissionKeys.reportsView,
    ],
  };
}

function agencyOwnerActor(ids: SeedIds) {
  return {
    userId: ids.userA,
    agencyMembershipId: ids.agencyMembership,
    permissions: [
      PermissionKeys.dashboardsView,
      PermissionKeys.dashboardsCreate,
      PermissionKeys.dashboardsEdit,
      PermissionKeys.dashboardsManage,
      PermissionKeys.analyticsParentRead,
    ],
  };
}

function superAgencyOwnerActor(ids: SeedIds) {
  return {
    userId: ids.userA,
    superAgencyMembershipId: ids.superAgencyMembership,
    permissions: [
      PermissionKeys.dashboardsView,
      PermissionKeys.dashboardsCreate,
      PermissionKeys.dashboardsEdit,
      PermissionKeys.dashboardsManage,
      PermissionKeys.analyticsParentRead,
    ],
  };
}

function metricValue(rendered: RenderedDashboard, metricKey: string) {
  for (const item of rendered.widgets as RenderedWidget[]) {
    const metric = item.data?.metrics?.find((entry) => entry.key === metricKey);
    if (metric) return Number(metric.value);
  }
  return null;
}

function dimensionTotal(rendered: RenderedDashboard) {
  return (
    (rendered.widgets as RenderedWidget[])[0]?.data?.dimension?.items.reduce(
      (sum: number, item) => sum + Number(item.value ?? 0),
      0,
    ) ?? 0
  );
}

function dimensionLabels(rendered: RenderedDashboard) {
  return (
    (rendered.widgets as RenderedWidget[])[0]?.data?.dimension?.items
      .map((item) => item.label)
      .sort() ?? []
  );
}

function redisHarness(cache: Map<string, string>) {
  return {
    cache: {
      get: jest.fn((key: string) => Promise.resolve(cache.get(key) ?? null)),
      set: jest.fn((key: string, value: string) => {
        cache.set(key, value);
        return Promise.resolve('OK');
      }),
    },
  };
}

function makeIds(): SeedIds {
  const superAgency = randomUUID();
  const short = randomUUID().slice(0, 8);
  return {
    run: `p174-${short}`,
    short,
    userA: randomUUID(),
    userB: randomUUID(),
    roleWorkspace: randomUUID(),
    roleAgency: randomUUID(),
    roleSuperAgency: randomUUID(),
    superAgency,
    agency: superAgency,
    foreignSuperAgency: randomUUID(),
    foreignAgency: randomUUID(),
    workspace: randomUUID(),
    workspaceSecond: randomUUID(),
    foreignWorkspace: randomUUID(),
    superAgencyMembership: randomUUID(),
    agencyMembership: randomUUID(),
    workspaceMembershipA: randomUUID(),
    workspaceMembershipB: randomUUID(),
    taskStatus: randomUUID(),
    ticketStatus: randomUUID(),
    secondTaskStatus: randomUUID(),
    foreignTaskStatus: randomUUID(),
    task: randomUUID(),
    secondTask: randomUUID(),
    foreignTask: randomUUID(),
    project: randomUUID(),
    ticket: randomUUID(),
    form: randomUUID(),
    formVersion: randomUUID(),
    formSubmission: randomUUID(),
    goal: randomUUID(),
    workXpEvent: randomUUID(),
    xpEntry: randomUUID(),
    globalScore: randomUUID(),
    asset: randomUUID(),
    usageCounter: randomUUID(),
    nextReport: () => randomUUID(),
  };
}

type RenderedDashboard = Awaited<ReturnType<CustomDashboardsService['render']>>;

type RenderedWidget = {
  data?: {
    metrics?: Array<{ key: string; value: number | string | null }>;
    dimension?: { items: Array<{ label: string; value: number | string | null }> };
  };
};

type SeedIds = {
  run: string;
  short: string;
  userA: string;
  userB: string;
  roleWorkspace: string;
  roleAgency: string;
  roleSuperAgency: string;
  superAgency: string;
  agency: string;
  foreignSuperAgency: string;
  foreignAgency: string;
  workspace: string;
  workspaceSecond: string;
  foreignWorkspace: string;
  superAgencyMembership: string;
  agencyMembership: string;
  workspaceMembershipA: string;
  workspaceMembershipB: string;
  taskStatus: string;
  ticketStatus: string;
  secondTaskStatus: string;
  foreignTaskStatus: string;
  task: string;
  secondTask: string;
  foreignTask: string;
  project: string;
  ticket: string;
  form: string;
  formVersion: string;
  formSubmission: string;
  goal: string;
  workXpEvent: string;
  xpEntry: string;
  globalScore: string;
  asset: string;
  usageCounter: string;
  nextReport: () => string;
};
