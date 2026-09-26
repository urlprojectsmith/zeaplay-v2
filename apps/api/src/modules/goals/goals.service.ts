import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AutomationDomainEventEntityType,
  AutomationTriggerType,
  DepartmentStatus,
  GamificationGlobalScoreEventStatus,
  GamificationXpEntryType,
  GoalMetricType,
  GoalOwnerType,
  GoalPeriodType,
  GoalProgressSourceType,
  GoalStatus,
  MembershipStatus,
  Prisma,
} from '@prisma/client';
import { DateTime } from 'luxon';
import { randomUUID } from 'node:crypto';
import type {
  AgencyTenantContext,
  SuperAgencyTenantContext,
  WorkspaceTenantContext,
} from '../../common/auth/auth.types';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AutomationDomainEventsService } from '../automation/automation-domain-events.service';
import {
  CreateGoalDto,
  GoalListQueryDto,
  ManualGoalProgressDto,
  ParentGoalsQueryDto,
  ReconcileGoalDto,
} from './dto/goals.dto';

type ParentScope =
  { kind: 'AGENCY'; agencyId: string } | { kind: 'SUPER_AGENCY'; superAgencyId: string };

const GOAL_MAX_CUSTOM_PERIOD_DAYS = 366;

const automaticMetrics = new Set<GoalMetricType>([
  GoalMetricType.TASKS_COMPLETED,
  GoalMetricType.PROJECTS_COMPLETED,
  GoalMetricType.TICKETS_RESOLVED,
  GoalMetricType.XP_EARNED,
  GoalMetricType.GLOBAL_SCORE,
]);

@Injectable()
export class GoalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly automationEvents: AutomationDomainEventsService,
  ) {}

  async listGoals(tenant: WorkspaceTenantContext, query: GoalListQueryDto) {
    requireWorkspaceMembership(tenant);
    const where = goalListWhere(tenant.workspaceId, query);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.goal.findMany({
        where,
        select: goalListSelect,
        orderBy: [{ status: 'asc' }, { periodEnd: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.goal.count({ where }),
    ]);
    return { items: items.map(serializeGoal), total, page: query.page, pageSize: query.pageSize };
  }

  async getGoal(tenant: WorkspaceTenantContext, goalId: string) {
    requireWorkspaceMembership(tenant);
    const goal = await this.prisma.goal.findFirst({
      where: { id: goalId, workspaceId: tenant.workspaceId },
      select: goalDetailSelect,
    });
    if (!goal) throw new NotFoundException('GOAL_NOT_FOUND');
    return serializeGoal(goal);
  }

  async createGoal(tenant: WorkspaceTenantContext, dto: CreateGoalDto) {
    const membershipId = requireWorkspaceMembership(tenant);
    assertPositiveTarget(dto.targetValue);
    const workspace = await this.prisma.workspace.findFirst({
      where: { id: tenant.workspaceId },
      select: { id: true, timezone: true },
    });
    if (!workspace) throw new NotFoundException('WORKSPACE_NOT_FOUND');
    const period = normalizeGoalPeriod(dto, workspace.timezone);
    await this.assertOwner(tenant.workspaceId, dto);
    const goal = await this.prisma.goal.create({
      data: {
        workspaceId: tenant.workspaceId,
        ownerType: dto.ownerType,
        ownerMembershipId: dto.ownerType === GoalOwnerType.USER ? dto.ownerMembershipId : null,
        departmentId: dto.ownerType === GoalOwnerType.DEPARTMENT ? dto.departmentId : null,
        metricType: dto.metricType,
        periodType: dto.periodType,
        title: normalizeTitle(dto.title),
        description: normalizeDescription(dto.description),
        targetValue: dto.targetValue,
        periodStart: period.start,
        periodEnd: period.end,
        createdByMembershipId: membershipId,
        metadata: toJson(dto.metadata ?? {}),
      },
      select: goalDetailSelect,
    });
    await this.reconcileGoalInternal(tenant.workspaceId, goal.id, {
      actorMembershipId: membershipId,
      idempotencyKey: `goal-created:${goal.id}`,
    });
    await this.audit.record({
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'goal.create',
      entityType: 'Goal',
      entityId: goal.id,
      metadata: { ownerType: goal.ownerType, metricType: goal.metricType },
    });
    return this.getGoal(tenant, goal.id);
  }

  async archiveGoal(tenant: WorkspaceTenantContext, goalId: string) {
    const membershipId = requireWorkspaceMembership(tenant);
    const goal = await this.prisma.goal.updateMany({
      where: { id: goalId, workspaceId: tenant.workspaceId, status: { not: GoalStatus.ARCHIVED } },
      data: { status: GoalStatus.ARCHIVED, archivedAt: new Date() },
    });
    if (!goal.count) throw new NotFoundException('GOAL_NOT_FOUND');
    await this.audit.record({
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'goal.archive',
      entityType: 'Goal',
      entityId: goalId,
      metadata: { actorMembershipId: membershipId },
    });
    return this.getGoal(tenant, goalId);
  }

  async recordManualProgress(
    tenant: WorkspaceTenantContext,
    goalId: string,
    dto: ManualGoalProgressDto,
  ) {
    const membershipId = requireWorkspaceMembership(tenant);
    const result = await this.recordProgressDelta({
      workspaceId: tenant.workspaceId,
      goalId,
      actorMembershipId: membershipId,
      sourceType: GoalProgressSourceType.MANUAL,
      delta: dto.delta,
      idempotencyKey: dto.idempotencyKey ?? `manual:${membershipId}:${randomUUID()}`,
      note: dto.note,
      metadata: dto.metadata ?? {},
      requireMetricType: GoalMetricType.MANUAL_NUMERIC,
    });
    await this.audit.record({
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'goal.progress.manual',
      entityType: 'Goal',
      entityId: goalId,
      metadata: { delta: dto.delta },
    });
    return result;
  }

  async recordCustomProgress(input: {
    tenant: WorkspaceTenantContext;
    goalId: string;
    delta: number;
    idempotencyKey: string;
    actorMembershipId?: string | null;
    sourceId?: string | null;
    note?: string;
    metadata?: Record<string, unknown>;
  }) {
    return this.recordProgressDelta({
      workspaceId: input.tenant.workspaceId,
      goalId: input.goalId,
      actorMembershipId: input.actorMembershipId ?? input.tenant.workspaceMembershipId,
      sourceType: GoalProgressSourceType.CUSTOM,
      sourceId: input.sourceId,
      delta: input.delta,
      idempotencyKey: input.idempotencyKey,
      note: input.note,
      metadata: input.metadata ?? {},
      requireMetricType: GoalMetricType.CUSTOM_NUMERIC,
    });
  }

  async reconcileGoal(tenant: WorkspaceTenantContext, goalId: string, dto: ReconcileGoalDto) {
    const membershipId = requireWorkspaceMembership(tenant);
    return this.reconcileGoalInternal(tenant.workspaceId, goalId, {
      actorMembershipId: membershipId,
      idempotencyKey: dto.idempotencyKey ?? `reconcile:${goalId}:${randomUUID()}`,
    });
  }

  async expireDueGoals(tenant: WorkspaceTenantContext) {
    requireWorkspaceMembership(tenant);
    const now = new Date();
    const updated = await this.prisma.goal.updateMany({
      where: {
        workspaceId: tenant.workspaceId,
        status: GoalStatus.ACTIVE,
        periodEnd: { lt: now },
        currentProgress: { lt: this.prisma.goal.fields.targetValue },
      },
      data: { status: GoalStatus.EXPIRED, expiredAt: now },
    });
    return { expired: updated.count };
  }

  async listProgressEvents(tenant: WorkspaceTenantContext, goalId: string) {
    requireWorkspaceMembership(tenant);
    await this.assertGoal(tenant.workspaceId, goalId);
    const items = await this.prisma.goalProgressEvent.findMany({
      where: { workspaceId: tenant.workspaceId, goalId },
      select: progressEventSelect,
      orderBy: [{ occurredAt: 'desc' }, { id: 'asc' }],
      take: 100,
    });
    return { items };
  }

  async listAgencyGoals(tenant: AgencyTenantContext, query: ParentGoalsQueryDto) {
    const scope: ParentScope = { kind: 'AGENCY', agencyId: tenant.agencyId };
    return this.parentGoalSummary(scope, query);
  }

  async listSuperAgencyGoals(tenant: SuperAgencyTenantContext, query: ParentGoalsQueryDto) {
    const scope: ParentScope = { kind: 'SUPER_AGENCY', superAgencyId: tenant.superAgencyId };
    return this.parentGoalSummary(scope, query);
  }

  private async parentGoalSummary(scope: ParentScope, query: ParentGoalsQueryDto) {
    const workspaceWhere =
      scope.kind === 'AGENCY'
        ? { agencyId: scope.agencyId }
        : {
            agency: {
              superAgencyId: scope.superAgencyId,
              ...(query.agencyId ? { id: query.agencyId } : {}),
            },
          };
    const where: Prisma.GoalWhereInput = {
      status: query.status,
      ownerType: query.ownerType,
      metricType: query.metricType,
      workspace: workspaceWhere,
      ...(query.workspaceId ? { workspaceId: query.workspaceId } : {}),
      ...(query.search?.trim()
        ? { title: { contains: query.search.trim(), mode: Prisma.QueryMode.insensitive } }
        : {}),
    };
    const items = await this.prisma.goal.groupBy({
      by: ['workspaceId', 'status', 'ownerType', 'metricType'],
      where,
      _count: { _all: true },
      _sum: { currentProgress: true, targetValue: true },
      orderBy: [{ workspaceId: 'asc' }, { status: 'asc' }],
      take: query.pageSize,
      skip: (query.page - 1) * query.pageSize,
    });
    return {
      items,
      page: query.page,
      pageSize: query.pageSize,
      privacy: 'AGGREGATED_WORKSPACE_ONLY',
    };
  }

  private async reconcileGoalInternal(
    workspaceId: string,
    goalId: string,
    input: { actorMembershipId?: string | null; idempotencyKey: string },
  ) {
    const goal = await this.assertGoal(workspaceId, goalId);
    if (!automaticMetrics.has(goal.metricType)) {
      return serializeGoal(goal);
    }
    const computed = await this.computeAutomaticProgress(goal);
    const delta = computed - goal.currentProgress;
    if (delta === 0) return serializeGoal(goal);
    return this.recordProgressDelta({
      workspaceId,
      goalId,
      actorMembershipId: input.actorMembershipId,
      sourceType: GoalProgressSourceType.RECONCILIATION,
      delta,
      idempotencyKey: input.idempotencyKey,
      metadata: { computed },
    });
  }

  private async recordProgressDelta(input: {
    workspaceId: string;
    goalId: string;
    actorMembershipId?: string | null;
    sourceType: GoalProgressSourceType;
    sourceId?: string | null;
    delta: number;
    idempotencyKey: string;
    note?: string;
    metadata: Record<string, unknown>;
    requireMetricType?: GoalMetricType;
  }) {
    assertFiniteDelta(input.delta);
    if (!input.idempotencyKey.trim()) throw new BadRequestException('GOAL_IDEMPOTENCY_REQUIRED');
    const completionToEmit = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM goals WHERE id = ${input.goalId}::uuid AND workspace_id = ${input.workspaceId}::uuid FOR UPDATE`;
      const existingEvent = await tx.goalProgressEvent.findFirst({
        where: { goalId: input.goalId, idempotencyKey: input.idempotencyKey },
        select: { goal: { select: goalDetailSelect } },
      });
      if (existingEvent) {
        return { goal: existingEvent.goal, completionDomainEventId: null };
      }
      const goal = await tx.goal.findFirst({
        where: { id: input.goalId, workspaceId: input.workspaceId },
        select: goalDetailSelect,
      });
      if (!goal) throw new NotFoundException('GOAL_NOT_FOUND');
      if (goal.status !== GoalStatus.ACTIVE) throw new ConflictException('GOAL_NOT_ACTIVE');
      if (input.requireMetricType && goal.metricType !== input.requireMetricType) {
        throw new BadRequestException('GOAL_METRIC_PROGRESS_SOURCE_MISMATCH');
      }
      if (
        input.sourceType === GoalProgressSourceType.MANUAL ||
        input.sourceType === GoalProgressSourceType.CUSTOM
      ) {
        assertGoalAcceptsLiveProgress(goal);
      }
      const next = Math.max(0, goal.currentProgress + input.delta);
      const completed = next >= goal.targetValue;
      const completedAt = completed ? new Date() : null;
      const updated = await tx.goal.update({
        where: { id: goal.id },
        data: {
          currentProgress: next,
          ...(completed ? { status: GoalStatus.COMPLETED, completedAt } : {}),
        },
        select: goalDetailSelect,
      });
      await tx.goalProgressEvent.create({
        data: {
          workspaceId: input.workspaceId,
          goalId: goal.id,
          sourceType: input.sourceType,
          sourceId: input.sourceId ?? null,
          idempotencyKey: input.idempotencyKey,
          delta: input.delta,
          valueAfter: next,
          actorMembershipId: input.actorMembershipId ?? null,
          occurredAt: new Date(),
          note: input.note,
          metadata: toJson(input.metadata),
        },
      });
      let completionDomainEventId: string | null = null;
      if (completed) {
        const event = await this.recordGoalCompletedInTransaction(
          tx,
          updated,
          input.actorMembershipId ?? null,
        );
        completionDomainEventId = event.id;
      }
      return {
        goal: updated,
        completionDomainEventId,
      };
    });
    if (completionToEmit.completionDomainEventId) {
      await this.automationEvents.evaluateDomainEvent(completionToEmit.completionDomainEventId);
    }
    return serializeGoal(completionToEmit.goal);
  }

  private async computeAutomaticProgress(goal: GoalRecord) {
    const base = {
      workspaceId: goal.workspaceId,
      occurredAt: { gte: goal.periodStart, lt: goal.periodEnd },
      actorMembershipId: await this.actorFilterForGoal(goal),
    };
    if (goal.metricType === GoalMetricType.TASKS_COMPLETED) {
      return this.prisma.automationDomainEvent.count({
        where: {
          ...base,
          eventType: AutomationTriggerType.TASK_COMPLETED,
          entityType: AutomationDomainEventEntityType.TASK,
        },
      });
    }
    if (goal.metricType === GoalMetricType.PROJECTS_COMPLETED) {
      return this.prisma.automationDomainEvent.count({
        where: {
          ...base,
          eventType: AutomationTriggerType.PROJECT_COMPLETED,
          entityType: AutomationDomainEventEntityType.PROJECT,
        },
      });
    }
    if (goal.metricType === GoalMetricType.TICKETS_RESOLVED) {
      return this.prisma.automationDomainEvent.count({
        where: {
          ...base,
          eventType: AutomationTriggerType.TICKET_RESOLVED,
          entityType: AutomationDomainEventEntityType.TICKET,
        },
      });
    }
    if (goal.metricType === GoalMetricType.XP_EARNED) {
      const sum = await this.prisma.gamificationXpEntry.aggregate({
        where: {
          workspaceId: goal.workspaceId,
          createdAt: { gte: goal.periodStart, lt: goal.periodEnd },
          entryType: GamificationXpEntryType.EARN,
          amount: { gt: 0 },
          membershipId: await this.membershipFilterForGoal(goal),
        },
        _sum: { amount: true },
      });
      return sum._sum.amount ?? 0;
    }
    if (goal.metricType === GoalMetricType.GLOBAL_SCORE) {
      const sum = await this.prisma.gamificationGlobalScoreEvent.aggregate({
        where: {
          workspaceId: goal.workspaceId,
          occurredAt: { gte: goal.periodStart, lt: goal.periodEnd },
          status: GamificationGlobalScoreEventStatus.APPLIED,
          normalizedScore: { not: null },
          recipientMembershipId: await this.membershipFilterForGoal(goal),
        },
        _sum: { normalizedScore: true },
      });
      return sum._sum.normalizedScore ?? 0;
    }
    return goal.currentProgress;
  }

  private async actorFilterForGoal(goal: GoalRecord) {
    if (goal.ownerType === GoalOwnerType.WORKSPACE) return undefined;
    if (goal.ownerType === GoalOwnerType.USER) return goal.ownerMembershipId;
    return { in: await this.departmentMembershipIds(goal.workspaceId, goal.departmentId) };
  }

  private async membershipFilterForGoal(goal: GoalRecord) {
    if (goal.ownerType === GoalOwnerType.WORKSPACE) return undefined;
    if (goal.ownerType === GoalOwnerType.USER) return goal.ownerMembershipId ?? undefined;
    return { in: await this.departmentMembershipIds(goal.workspaceId, goal.departmentId) };
  }

  private async departmentMembershipIds(workspaceId: string, departmentId: string | null) {
    if (!departmentId) return [];
    const rows = await this.prisma.workspaceMembership.findMany({
      where: { workspaceId, departmentId, status: MembershipStatus.ACTIVE },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  private async assertOwner(workspaceId: string, dto: CreateGoalDto) {
    if (dto.ownerType === GoalOwnerType.USER) {
      if (!dto.ownerMembershipId || dto.departmentId)
        throw new BadRequestException('GOAL_OWNER_INVALID');
      const member = await this.prisma.workspaceMembership.findFirst({
        where: { id: dto.ownerMembershipId, workspaceId, status: MembershipStatus.ACTIVE },
        select: { id: true },
      });
      if (!member) throw new BadRequestException('GOAL_OWNER_NOT_FOUND');
    } else if (dto.ownerType === GoalOwnerType.DEPARTMENT) {
      if (!dto.departmentId || dto.ownerMembershipId)
        throw new BadRequestException('GOAL_OWNER_INVALID');
      const department = await this.prisma.department.findFirst({
        where: { id: dto.departmentId, workspaceId, status: DepartmentStatus.ACTIVE },
        select: { id: true },
      });
      if (!department) throw new BadRequestException('GOAL_OWNER_NOT_FOUND');
    } else if (dto.ownerMembershipId || dto.departmentId) {
      throw new BadRequestException('GOAL_OWNER_INVALID');
    }
    if (
      dto.metricType !== GoalMetricType.MANUAL_NUMERIC &&
      dto.metricType !== GoalMetricType.CUSTOM_NUMERIC &&
      !automaticMetrics.has(dto.metricType)
    ) {
      throw new BadRequestException('GOAL_METRIC_UNSUPPORTED');
    }
  }

  private async assertGoal(workspaceId: string, goalId: string) {
    const goal = await this.prisma.goal.findFirst({
      where: { id: goalId, workspaceId },
      select: goalDetailSelect,
    });
    if (!goal) throw new NotFoundException('GOAL_NOT_FOUND');
    return goal;
  }

  private async recordGoalCompletedInTransaction(
    tx: Prisma.TransactionClient,
    goal: GoalRecord,
    actorMembershipId: string | null,
  ) {
    return this.automationEvents.recordDomainEventInTransaction(tx, {
      workspaceId: goal.workspaceId,
      eventType: AutomationTriggerType.GOAL_COMPLETED,
      entityType: AutomationDomainEventEntityType.GOAL,
      entityId: goal.id,
      actorMembershipId,
      payload: {
        goalId: goal.id,
        metricType: goal.metricType,
        ownerType: goal.ownerType,
        targetValue: goal.targetValue,
        currentProgress: goal.currentProgress,
      },
      idempotencyKey: `goal-completed:${goal.id}`,
    });
  }
}

const goalListSelect = {
  id: true,
  workspaceId: true,
  ownerType: true,
  ownerMembershipId: true,
  departmentId: true,
  metricType: true,
  periodType: true,
  title: true,
  description: true,
  targetValue: true,
  currentProgress: true,
  status: true,
  periodStart: true,
  periodEnd: true,
  completedAt: true,
  expiredAt: true,
  archivedAt: true,
  createdByMembershipId: true,
  metadata: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.GoalSelect;

const goalDetailSelect = {
  ...goalListSelect,
  progressEvents: {
    select: {
      id: true,
      sourceType: true,
      sourceId: true,
      delta: true,
      valueAfter: true,
      occurredAt: true,
      actorMembershipId: true,
      note: true,
      metadata: true,
      createdAt: true,
    },
    orderBy: [{ occurredAt: 'desc' }, { id: 'asc' }],
    take: 20,
  },
} satisfies Prisma.GoalSelect;

const progressEventSelect = {
  id: true,
  workspaceId: true,
  goalId: true,
  sourceType: true,
  sourceId: true,
  delta: true,
  valueAfter: true,
  occurredAt: true,
  actorMembershipId: true,
  note: true,
  metadata: true,
  createdAt: true,
} satisfies Prisma.GoalProgressEventSelect;

type GoalRecord = Prisma.GoalGetPayload<{ select: typeof goalListSelect }>;

function goalListWhere(workspaceId: string, query: GoalListQueryDto): Prisma.GoalWhereInput {
  return {
    workspaceId,
    status: query.status,
    ownerType: query.ownerType,
    metricType: query.metricType,
    ownerMembershipId: query.ownerMembershipId,
    departmentId: query.departmentId,
    ...(query.search?.trim()
      ? { title: { contains: query.search.trim(), mode: Prisma.QueryMode.insensitive } }
      : {}),
  };
}

function normalizeGoalPeriod(dto: CreateGoalDto, timezone: string) {
  const nowDate = new Date();
  if (dto.periodType === GoalPeriodType.CUSTOM) {
    if (!dto.periodStart || !dto.periodEnd)
      throw new BadRequestException('GOAL_CUSTOM_PERIOD_REQUIRED');
    const start = new Date(dto.periodStart);
    const end = new Date(dto.periodEnd);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
      throw new BadRequestException('GOAL_PERIOD_INVALID');
    }
    if (end <= nowDate) throw new BadRequestException('GOAL_PERIOD_ENDED');
    const maxMs = GOAL_MAX_CUSTOM_PERIOD_DAYS * 24 * 60 * 60 * 1000;
    if (end.getTime() - start.getTime() > maxMs) {
      throw new BadRequestException('GOAL_PERIOD_TOO_LONG');
    }
    return { start, end };
  }
  const now = DateTime.now().setZone(timezone || 'UTC');
  const unit =
    dto.periodType === GoalPeriodType.DAILY
      ? 'day'
      : dto.periodType === GoalPeriodType.WEEKLY
        ? 'week'
        : dto.periodType === GoalPeriodType.MONTHLY
          ? 'month'
          : dto.periodType === GoalPeriodType.QUARTERLY
            ? 'quarter'
            : 'year';
  const start = now.startOf(unit);
  return { start: start.toJSDate(), end: start.plus({ [unit]: 1 }).toJSDate() };
}

function assertPositiveTarget(value: number) {
  if (!Number.isInteger(value) || value <= 0 || !Number.isFinite(value)) {
    throw new BadRequestException('GOAL_TARGET_INVALID');
  }
}

function assertFiniteDelta(value: number) {
  if (!Number.isInteger(value) || !Number.isFinite(value)) {
    throw new BadRequestException('GOAL_DELTA_INVALID');
  }
}

function assertGoalAcceptsLiveProgress(goal: GoalRecord) {
  const now = new Date();
  if (now < goal.periodStart) throw new ConflictException('GOAL_PERIOD_NOT_STARTED');
  if (now >= goal.periodEnd) throw new ConflictException('GOAL_PERIOD_CLOSED');
}

function serializeGoal<T extends { currentProgress: number; targetValue: number }>(goal: T) {
  return {
    ...goal,
    percentComplete:
      goal.targetValue <= 0
        ? 0
        : Math.min(100, Math.round((goal.currentProgress / goal.targetValue) * 100)),
  };
}

function normalizeTitle(value: string) {
  const title = value.trim();
  if (!title) throw new BadRequestException('GOAL_TITLE_REQUIRED');
  return title;
}

function normalizeDescription(value?: string | null) {
  const description = value?.trim();
  return description ? description : null;
}

function toJson(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function requireWorkspaceMembership(tenant: WorkspaceTenantContext) {
  if (!tenant.workspaceMembershipId) throw new ForbiddenException('WORKSPACE_MEMBERSHIP_REQUIRED');
  return tenant.workspaceMembershipId;
}
