import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ForbiddenException } from '@nestjs/common';
import {
  BillingProvider,
  BillingUsageScope,
  FormSubmissionSource,
  FormType,
  GamificationGlobalScoreEventScoreType,
  GamificationGlobalScoreEventStatus,
  GamificationPointWorkType,
  GamificationWorkXpEventOutcome,
  GamificationWorkXpEventType,
  GamificationXpEntryType,
  GoalMetricType,
  GoalOwnerType,
  GoalPeriodType,
  GoalStatus,
  MasterPlanStatus,
  MasterPlanType,
  MembershipStatus,
  PlanVersionStatus,
  ProjectStatus,
  RoleScope,
  StatusCategory,
  StatusEntityType,
  SuperAgencySubscriptionStatus,
} from '@prisma/client';
import type {
  AgencyTenantContext,
  SuperAgencyTenantContext,
  WorkspaceTenantContext,
} from '../src/common/auth/auth.types';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { BILLING_RESOURCE_KEYS } from '../src/modules/billing/billing.constants';
import { AnalyticsService } from '../src/modules/analytics/analytics.service';
import type { AnalyticsQueryDto } from '../src/modules/analytics/dto/analytics.dto';

loadApiEnv();

const redis = {
  cache: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
  },
};

describe('Phase 17.1 real Analytics integration', () => {
  let prisma: PrismaService;
  let analytics: AnalyticsService;
  let ids: SeedIds;

  beforeAll(async () => {
    expect(process.env.DATABASE_URL).toBeTruthy();
    prisma = new PrismaService();
    await prisma.$connect();
    analytics = new AnalyticsService(prisma, redis as never);
  });

  afterAll(async () => {
    await cleanup(prisma, ids).catch(() => undefined);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    redis.cache.get.mockResolvedValue(null);
    redis.cache.set.mockClear();
    ids = makeIds();
    await cleanup(prisma, ids);
    await seedAnalyticsFixture(prisma, ids);
  });

  afterEach(async () => {
    await cleanup(prisma, ids);
  });

  it('derives Workspace metrics from canonical domain rows without mutating source systems', async () => {
    const beforeXp = await prisma.gamificationXpEntry.count({
      where: { workspaceId: ids.workspace },
    });
    const beforeScore = await prisma.gamificationGlobalScoreEvent.count({
      where: { workspaceId: ids.workspace },
    });

    const summary = await analytics.workspaceSummary(
      workspaceTenant(ids),
      query([
        'tasks.completed',
        'projects.completed',
        'tickets.resolved',
        'gamification.xp_earned',
        'gamification.global_score',
        'forms.submissions',
        'goals.completed',
        'api.requests',
        'memberships.active',
      ]),
    );

    expect(value(summary, 'tasks.completed')).toBe(1);
    expect(value(summary, 'projects.completed')).toBe(1);
    expect(value(summary, 'tickets.resolved')).toBe(1);
    expect(value(summary, 'gamification.xp_earned')).toBe(40);
    expect(value(summary, 'gamification.global_score')).toBe(7);
    expect(value(summary, 'forms.submissions')).toBe(1);
    expect(value(summary, 'goals.completed')).toBe(1);
    expect(value(summary, 'api.requests')).toBe(9);
    expect(value(summary, 'memberships.active')).toBe(1);
    await expect(
      prisma.gamificationXpEntry.count({ where: { workspaceId: ids.workspace } }),
    ).resolves.toBe(beforeXp);
    await expect(
      prisma.gamificationGlobalScoreEvent.count({ where: { workspaceId: ids.workspace } }),
    ).resolves.toBe(beforeScore);
  });

  it('keeps parent aggregates descendant-only and financial metrics scoped', async () => {
    await expect(
      analytics.workspaceSummary(workspaceTenant(ids), query(['billing.active_subscriptions'])),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      analytics.agencySummary(agencyTenant(ids), query(['billing.active_subscriptions'])),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      analytics.agencySummary(agencyTenant(ids), {
        ...query(['tasks.total']),
        workspaceId: ids.foreignWorkspace,
      }),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      analytics.superAgencySummary(superAgencyTenant(ids), {
        ...query(['tasks.total']),
        workspaceId: ids.foreignWorkspace,
      }),
    ).rejects.toThrow(ForbiddenException);

    const superAgencyBilling = await analytics.superAgencySummary(
      superAgencyTenant(ids),
      query(['billing.active_subscriptions']),
    );
    const platformBilling = await analytics.platformSummary(
      query(['billing.active_subscriptions']),
    );

    expect(value(superAgencyBilling, 'billing.active_subscriptions')).toBe(1);
    expect(Number(value(platformBilling, 'billing.active_subscriptions'))).toBeGreaterThanOrEqual(
      1,
    );
  });

  it('rebuilds API request rollups idempotently and corrects late counter changes', async () => {
    const rollupQuery = query(['api.requests']);
    const scope = {
      type: 'WORKSPACE' as const,
      id: ids.workspace,
      workspaceIds: [ids.workspace],
      agencyIds: [ids.agency],
      timezone: 'UTC',
      financialAllowed: false,
    };

    await expect(analytics.rebuildRollups(scope, rollupQuery)).resolves.toMatchObject({
      locked: false,
    });
    await expect(
      prisma.analyticsRollup.count({
        where: { scopeId: ids.workspace, metricKey: 'api.requests' },
      }),
    ).resolves.toBeGreaterThan(0);
    await prisma.billingUsageCounter.update({
      where: {
        scope_scopeId_resourceKey_periodStart: {
          scope: BillingUsageScope.WORKSPACE,
          scopeId: ids.workspace,
          resourceKey: BILLING_RESOURCE_KEYS.apiRequests,
          periodStart: metricDate('2026-09-01T00:00:00.000Z'),
        },
      },
      data: { used: 12n },
    });

    await expect(analytics.rebuildRollups(scope, rollupQuery)).resolves.toMatchObject({
      locked: false,
    });
    const rollups = await prisma.analyticsRollup.findMany({
      where: { scopeId: ids.workspace, metricKey: 'api.requests' },
      select: { value: true },
      orderBy: { bucketStart: 'asc' },
    });

    expect(rollups.some((rollup) => Number(rollup.value) === 12)).toBe(true);
  });
});

async function seedAnalyticsFixture(prisma: PrismaService, ids: SeedIds) {
  const now = metricDate('2026-09-10T12:00:00.000Z');
  await prisma.user.create({
    data: { id: ids.user, email: `${ids.run}@example.test`, passwordHash: 'hash' },
  });
  await prisma.role.create({
    data: {
      id: ids.role,
      key: `phase17_${ids.run}`,
      name: 'Phase 17 Owner',
      scope: RoleScope.WORKSPACE,
    },
  });
  await prisma.superAgency.create({
    data: {
      id: ids.superAgency,
      name: 'Phase 17 SA',
      slug: `phase17-${ids.run}`,
      createdById: ids.user,
    },
  });
  await prisma.superAgency.create({
    data: {
      id: ids.foreignSuperAgency,
      name: 'Phase 17 Foreign SA',
      slug: `phase17-foreign-${ids.run}`,
      createdById: ids.user,
    },
  });
  await prisma.agency.create({
    data: {
      id: ids.agency,
      superAgencyId: ids.superAgency,
      name: 'Phase 17 Agency',
      slug: `phase17-agency-${ids.run}`,
      createdById: ids.user,
    },
  });
  await prisma.agency.create({
    data: {
      id: ids.foreignAgency,
      superAgencyId: ids.foreignSuperAgency,
      name: 'Phase 17 Foreign Agency',
      slug: `phase17-foreign-agency-${ids.run}`,
      createdById: ids.user,
    },
  });
  await prisma.workspace.createMany({
    data: [
      {
        id: ids.workspace,
        agencyId: ids.agency,
        name: 'Phase 17 Workspace',
        slug: `phase17-workspace-${ids.run}`,
        timezone: 'Asia/Calcutta',
        createdById: ids.user,
      },
      {
        id: ids.foreignWorkspace,
        agencyId: ids.foreignAgency,
        name: 'Phase 17 Foreign Workspace',
        slug: `phase17-foreign-workspace-${ids.run}`,
        timezone: 'UTC',
        createdById: ids.user,
      },
    ],
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

  await prisma.statusDefinition.createMany({
    data: [
      status(ids, ids.taskOpenStatus, StatusEntityType.TASK, 'Open', false, 1),
      status(ids, ids.taskDoneStatus, StatusEntityType.TASK, 'Done', true, 2),
      status(ids, ids.projectDoneStatus, StatusEntityType.PROJECT, 'Done', true, 1),
      status(ids, ids.ticketOpenStatus, StatusEntityType.TICKET, 'Open', false, 1),
      status(ids, ids.ticketResolvedStatus, StatusEntityType.TICKET, 'Resolved', true, 2),
    ],
  });
  await prisma.task.createMany({
    data: [
      {
        id: ids.taskDone,
        workspaceId: ids.workspace,
        title: 'Phase 17 completed task',
        statusDefinitionId: ids.taskDoneStatus,
        createdById: ids.user,
        createdAt: now,
      },
      {
        id: ids.taskOpen,
        workspaceId: ids.workspace,
        title: 'Phase 17 open task',
        statusDefinitionId: ids.taskOpenStatus,
        createdById: ids.user,
        createdAt: now,
      },
    ],
  });
  await prisma.project.create({
    data: {
      id: ids.project,
      workspaceId: ids.workspace,
      name: 'Phase 17 project',
      status: ProjectStatus.ACTIVE,
      statusDefinitionId: ids.projectDoneStatus,
      ownerMembershipId: ids.workspaceMembership,
      createdById: ids.user,
      createdAt: now,
    },
  });
  await prisma.ticket.create({
    data: {
      id: ids.ticket,
      workspaceId: ids.workspace,
      sequenceNumber: 171,
      ticketNumber: `P17${ids.run.slice(-4)}`,
      subject: 'Phase 17 ticket',
      statusDefinitionId: ids.ticketResolvedStatus,
      createdByMembershipId: ids.workspaceMembership,
      createdAt: now,
    },
  });
  await prisma.form.create({
    data: {
      id: ids.form,
      workspaceId: ids.workspace,
      publicId: `phase17-${ids.run.slice(0, 24)}`,
      title: 'Phase 17 form',
      type: FormType.FORM,
      status: 'PUBLISHED',
      visibility: 'PUBLIC',
      publicEnabled: true,
      publishedVersionNumber: 1,
      createdByMembershipId: ids.workspaceMembership,
      createdAt: now,
    },
  });
  await prisma.formVersion.create({
    data: {
      id: ids.formVersion,
      formId: ids.form,
      workspaceId: ids.workspace,
      versionNumber: 1,
      state: 'PUBLISHED',
      titleSnapshot: 'Phase 17 form',
      schema: { fields: [{ id: 'name', type: 'TEXT', label: 'Name' }] },
      createdByMembershipId: ids.workspaceMembership,
      publishedByMembershipId: ids.workspaceMembership,
      publishedAt: now,
      createdAt: now,
    },
  });
  await prisma.formSubmission.create({
    data: {
      id: ids.formSubmission,
      formId: ids.form,
      formVersionId: ids.formVersion,
      workspaceId: ids.workspace,
      source: FormSubmissionSource.PUBLIC,
      answers: { name: 'Ada' },
      submittedAt: now,
      createdAt: now,
    },
  });
  await prisma.goal.create({
    data: {
      id: ids.goal,
      workspaceId: ids.workspace,
      ownerType: GoalOwnerType.WORKSPACE,
      metricType: GoalMetricType.MANUAL_NUMERIC,
      periodType: GoalPeriodType.CUSTOM,
      title: 'Phase 17 completed goal',
      targetValue: 1,
      currentProgress: 1,
      status: GoalStatus.COMPLETED,
      periodStart: metricDate('2026-09-01T00:00:00.000Z'),
      periodEnd: metricDate('2026-10-01T00:00:00.000Z'),
      completedAt: now,
      createdByMembershipId: ids.workspaceMembership,
      createdAt: now,
    },
  });
  await prisma.gamificationXpEntry.create({
    data: {
      id: ids.xpEntry,
      workspaceId: ids.workspace,
      membershipId: ids.workspaceMembership,
      amount: 40,
      entryType: GamificationXpEntryType.EARN,
      sourceType: 'SYSTEM',
      sourceEvent: 'phase17-test',
      idempotencyKey: `phase17-xp-${ids.run}`,
      createdAt: now,
    },
  });
  await prisma.gamificationWorkXpEvent.create({
    data: {
      id: ids.workXpEvent,
      workspaceId: ids.workspace,
      recipientMembershipId: ids.workspaceMembership,
      triggeredByMembershipId: ids.workspaceMembership,
      workType: GamificationPointWorkType.TASK,
      sourceEntityId: ids.taskDone,
      eventType: GamificationWorkXpEventType.COMPLETION_AWARD,
      correlationKey: `phase17-score-${ids.run}`,
      idempotencyKey: `phase17-score-work-${ids.run}`,
      outcome: GamificationWorkXpEventOutcome.APPLIED,
      netXpSnapshot: 40,
      occurredAt: now,
    },
  });
  await prisma.gamificationGlobalScoreEvent.create({
    data: {
      id: ids.globalScoreEvent,
      workspaceId: ids.workspace,
      recipientMembershipId: ids.workspaceMembership,
      workXpEventId: ids.workXpEvent,
      workType: GamificationPointWorkType.TASK,
      sourceEntityId: ids.taskDone,
      eventType: GamificationWorkXpEventType.COMPLETION_AWARD,
      scoreType: GamificationGlobalScoreEventScoreType.COMPLETION,
      status: GamificationGlobalScoreEventStatus.APPLIED,
      normalizedScore: 7,
      occurredAt: now,
      idempotencyKey: `phase17-score-event-${ids.run}`,
    },
  });
  await prisma.billingUsageCounter.create({
    data: {
      id: ids.usageCounter,
      scope: BillingUsageScope.WORKSPACE,
      scopeId: ids.workspace,
      resourceKey: BILLING_RESOURCE_KEYS.apiRequests,
      periodStart: metricDate('2026-09-01T00:00:00.000Z'),
      periodEnd: metricDate('2026-10-01T00:00:00.000Z'),
      used: 9n,
    },
  });
  await prisma.masterPlan.create({
    data: {
      id: ids.plan,
      key: `phase17_${ids.run}`,
      type: MasterPlanType.PUBLIC,
      displayName: 'Phase 17 Plan',
      status: MasterPlanStatus.ACTIVE,
    },
  });
  await prisma.masterPlanVersion.create({
    data: {
      id: ids.planVersion,
      masterPlanId: ids.plan,
      versionNumber: 1,
      status: PlanVersionStatus.PUBLISHED,
      publishedAt: now,
    },
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
      startedAt: now,
    },
  });
}

async function cleanup(prisma: PrismaService, ids?: SeedIds) {
  if (!ids) return;
  await prisma.analyticsRollup.deleteMany({
    where: { scopeId: { in: [ids.workspace, ids.agency, ids.superAgency] } },
  });
  await prisma.superAgencySubscription.deleteMany({ where: { id: ids.subscription } });
  await prisma.masterPlanVersion.deleteMany({ where: { id: ids.planVersion } });
  await prisma.masterPlan.deleteMany({ where: { id: ids.plan } });
  await prisma.billingUsageCounter.deleteMany({ where: { scopeId: ids.workspace } });
  await prisma.goal.deleteMany({ where: { workspaceId: ids.workspace } });
  await prisma.formSubmission.deleteMany({ where: { workspaceId: ids.workspace } });
  await prisma.formVersion.deleteMany({ where: { workspaceId: ids.workspace } });
  await prisma.form.deleteMany({ where: { workspaceId: ids.workspace } });
  await prisma.ticket.deleteMany({ where: { workspaceId: ids.workspace } });
  await prisma.project.deleteMany({ where: { workspaceId: ids.workspace } });
  await prisma.task.deleteMany({ where: { workspaceId: ids.workspace } });
  await prisma.statusDefinition.deleteMany({ where: { workspaceId: ids.workspace } });
  await deleteImmutableGamificationRows(prisma, ids.workspace);
  await prisma.workspaceMembership.deleteMany({ where: { workspaceId: ids.workspace } });
  await prisma.agencyMembership.deleteMany({ where: { agencyId: ids.agency } });
  await prisma.superAgencyMembership.deleteMany({ where: { superAgencyId: ids.superAgency } });
  await prisma.workspace.deleteMany({
    where: { id: { in: [ids.workspace, ids.foreignWorkspace] } },
  });
  await prisma.agency.deleteMany({ where: { id: { in: [ids.agency, ids.foreignAgency] } } });
  await prisma.superAgency.deleteMany({
    where: { id: { in: [ids.superAgency, ids.foreignSuperAgency] } },
  });
  await prisma.role.deleteMany({ where: { id: ids.role } });
  await prisma.user.deleteMany({ where: { id: ids.user } });
}

async function deleteImmutableGamificationRows(prisma: PrismaService, workspaceId: string) {
  await prisma.$executeRawUnsafe(
    'ALTER TABLE gamification_global_score_events DISABLE TRIGGER USER',
  );
  await prisma.$executeRawUnsafe('ALTER TABLE gamification_work_xp_events DISABLE TRIGGER USER');
  await prisma.$executeRawUnsafe('ALTER TABLE gamification_xp_entries DISABLE TRIGGER USER');
  try {
    await prisma.gamificationGlobalScoreEvent.deleteMany({ where: { workspaceId } });
    await prisma.gamificationWorkXpEvent.deleteMany({ where: { workspaceId } });
    await prisma.gamificationXpEntry.deleteMany({ where: { workspaceId } });
  } finally {
    await prisma.$executeRawUnsafe('ALTER TABLE gamification_xp_entries ENABLE TRIGGER USER');
    await prisma.$executeRawUnsafe('ALTER TABLE gamification_work_xp_events ENABLE TRIGGER USER');
    await prisma.$executeRawUnsafe(
      'ALTER TABLE gamification_global_score_events ENABLE TRIGGER USER',
    );
  }
}

function status(
  ids: SeedIds,
  id: string,
  entityType: StatusEntityType,
  name: string,
  isTerminal: boolean,
  position: number,
) {
  return {
    id,
    workspaceId: ids.workspace,
    entityType,
    name,
    nameNormalized: name.toLowerCase(),
    color: isTerminal ? '#22c55e' : '#64748b',
    position,
    category: isTerminal ? StatusCategory.COMPLETED : StatusCategory.TODO,
    isDefault: position === 1,
    isTerminal,
    isSystem: true,
  };
}

function query(metrics: string[]): AnalyticsQueryDto {
  return {
    metrics: metrics.join(','),
    datePreset: 'CUSTOM',
    start: '2026-09-01T00:00:00.000Z',
    end: '2026-10-01T00:00:00.000Z',
    bucket: 'DAY',
    page: 1,
    pageSize: 50,
  } as AnalyticsQueryDto;
}

function value(summary: unknown, key: string) {
  const metric = (summary as { metrics: Array<{ key: string; value: unknown }> }).metrics.find(
    (item) => item.key === key,
  );
  return metric?.value;
}

function workspaceTenant(ids: SeedIds): WorkspaceTenantContext {
  return {
    userId: ids.user,
    superAgencyId: ids.superAgency,
    agencyId: ids.agency,
    workspaceId: ids.workspace,
    workspaceMembershipId: ids.workspaceMembership,
    agencyMembershipId: ids.agencyMembership,
    roleId: ids.role,
    roleName: 'Phase 17 Owner',
    permissions: ['analytics.view'],
    accessSource: 'WORKSPACE_MEMBERSHIP',
  } as never;
}

function agencyTenant(ids: SeedIds): AgencyTenantContext {
  return {
    userId: ids.user,
    superAgencyId: ids.superAgency,
    agencyId: ids.agency,
    agencyMembershipId: ids.agencyMembership,
    roleId: ids.role,
    roleName: 'Phase 17 Agency Owner',
    permissions: ['analytics.parent.read'],
  } as never;
}

function superAgencyTenant(ids: SeedIds): SuperAgencyTenantContext {
  return {
    userId: ids.user,
    superAgencyId: ids.superAgency,
    superAgencyMembershipId: ids.superAgencyMembership,
    roleId: ids.role,
    roleName: 'Phase 17 Super Agency Owner',
    permissions: ['analytics.parent.read'],
  } as never;
}

function metricDate(value: string) {
  return new Date(value);
}

function makeIds(): SeedIds {
  const run = `p171-${randomUUID()}`;
  return {
    run,
    user: randomUUID(),
    role: randomUUID(),
    superAgency: randomUUID(),
    foreignSuperAgency: randomUUID(),
    agency: randomUUID(),
    foreignAgency: randomUUID(),
    workspace: randomUUID(),
    foreignWorkspace: randomUUID(),
    superAgencyMembership: randomUUID(),
    agencyMembership: randomUUID(),
    workspaceMembership: randomUUID(),
    taskOpenStatus: randomUUID(),
    taskDoneStatus: randomUUID(),
    projectDoneStatus: randomUUID(),
    ticketOpenStatus: randomUUID(),
    ticketResolvedStatus: randomUUID(),
    taskOpen: randomUUID(),
    taskDone: randomUUID(),
    project: randomUUID(),
    ticket: randomUUID(),
    form: randomUUID(),
    formVersion: randomUUID(),
    formSubmission: randomUUID(),
    goal: randomUUID(),
    xpEntry: randomUUID(),
    workXpEvent: randomUUID(),
    globalScoreEvent: randomUUID(),
    usageCounter: randomUUID(),
    plan: randomUUID(),
    planVersion: randomUUID(),
    subscription: randomUUID(),
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
  foreignSuperAgency: string;
  agency: string;
  foreignAgency: string;
  workspace: string;
  foreignWorkspace: string;
  superAgencyMembership: string;
  agencyMembership: string;
  workspaceMembership: string;
  taskOpenStatus: string;
  taskDoneStatus: string;
  projectDoneStatus: string;
  ticketOpenStatus: string;
  ticketResolvedStatus: string;
  taskOpen: string;
  taskDone: string;
  project: string;
  ticket: string;
  form: string;
  formVersion: string;
  formSubmission: string;
  goal: string;
  xpEntry: string;
  workXpEvent: string;
  globalScoreEvent: string;
  usageCounter: string;
  plan: string;
  planVersion: string;
  subscription: string;
}
