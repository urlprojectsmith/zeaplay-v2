import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  StatusEntityType,
  TaskPriority,
  TicketConversationEntryType,
  TicketSlaBusinessMode,
} from '@prisma/client';
import type { WorkspaceTenantContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { TicketSlaPolicyDto } from './dto/ticket-sla.dto';
import {
  addBusinessMinutes,
  businessMinutesBetween,
  defaultBusinessHours,
  validateSlaCalendar,
  validateTargetMinutes,
  type TicketSlaCalendarSnapshot,
} from './ticket-sla-business-time';

const SLA_PRIORITIES = [
  TaskPriority.LOW,
  TaskPriority.MEDIUM,
  TaskPriority.HIGH,
  TaskPriority.URGENT,
] as const;

type Tx = Prisma.TransactionClient;
type Snapshot = TicketSlaCalendarSnapshot & {
  policyId: string;
  policyName: string;
  priority: TaskPriority;
  firstResponseTargetMinutes: number;
  resolutionTargetMinutes: number;
  pauseFirstResponseStatusIds: string[];
  pauseResolutionStatusIds: string[];
};
type StateRecord = Prisma.TicketSlaStateGetPayload<{ select: typeof ticketSlaStateSelect }>;
type PolicyRecord = Prisma.TicketSlaPolicyGetPayload<{ include: typeof policyInclude }>;
type ValidatedPolicyInput = {
  name: string;
  description: string | null;
  isActive: boolean;
  isDefault: boolean;
  calendar: TicketSlaCalendarSnapshot;
  rules: Array<{
    workspaceId: string;
    priority: TaskPriority;
    firstResponseMinutes: number;
    resolutionMinutes: number;
  }>;
  pauseStatuses: Array<{
    workspaceId: string;
    statusDefinitionId: string;
    pauseFirstResponse: boolean;
    pauseResolution: boolean;
  }>;
};

@Injectable()
export class TicketSlaService {
  constructor(private readonly prisma: PrismaService) {}

  async listPolicies(tenant: WorkspaceTenantContext) {
    if (
      !hasSlaPermission(tenant, 'tickets.sla.view') &&
      !hasSlaPermission(tenant, 'tickets.sla.manage')
    ) {
      throw new ForbiddenException('TICKET_SLA_PERMISSION_REQUIRED');
    }
    return (
      await this.prisma.ticketSlaPolicy.findMany({
        where: { workspaceId: tenant.workspaceId },
        include: policyInclude,
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
        take: 50,
      })
    ).map(serializePolicy);
  }

  async createPolicy(tenant: WorkspaceTenantContext, dto: TicketSlaPolicyDto) {
    const input = await this.validatePolicyInput(tenant.workspaceId, dto);
    const policy = await this.prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await lockWorkspaceSlaDefaults(tx, tenant.workspaceId);
        await tx.ticketSlaPolicy.updateMany({
          where: { workspaceId: tenant.workspaceId, isDefault: true },
          data: { isDefault: false },
        });
      }
      const created = await tx.ticketSlaPolicy.create({
        data: {
          workspaceId: tenant.workspaceId,
          name: input.name,
          description: input.description,
          isActive: input.isActive,
          isDefault: input.isDefault,
          timezone: input.calendar.timezone,
          businessMode: input.calendar.businessMode,
          businessHours: input.calendar.businessHours as unknown as Prisma.InputJsonValue,
          holidayDates: input.calendar.holidayDates,
        },
        select: { id: true, isDefault: true },
      });
      await tx.ticketSlaRule.createMany({
        data: input.rules.map((rule) => ({ ...rule, policyId: created.id })),
      });
      if (input.pauseStatuses.length > 0) {
        await tx.ticketSlaPauseStatus.createMany({
          data: input.pauseStatuses.map((status) => ({ ...status, policyId: created.id })),
        });
      }
      await tx.auditLog.create({
        data: {
          superAgencyId: tenant.superAgencyId,
          agencyId: tenant.agencyId,
          workspaceId: tenant.workspaceId,
          userId: tenant.userId,
          action: 'ticket.sla_policy_created',
          entityType: 'TicketSlaPolicy',
          entityId: created.id,
          metadata: { policyId: created.id, isDefault: created.isDefault },
        },
      });
      return tx.ticketSlaPolicy.findUniqueOrThrow({
        where: { id: created.id },
        include: policyInclude,
      });
    });
    return serializePolicy(policy);
  }

  async updatePolicy(tenant: WorkspaceTenantContext, policyId: string, dto: TicketSlaPolicyDto) {
    const existing = await this.prisma.ticketSlaPolicy.findFirst({
      where: { id: policyId, workspaceId: tenant.workspaceId },
      include: policyInclude,
    });
    if (!existing) throw new NotFoundException('TICKET_SLA_POLICY_NOT_FOUND');
    const input = await this.validatePolicyInput(tenant.workspaceId, dto);
    if (policyMatchesInput(existing, input)) return serializePolicy(existing);
    const policy = await this.prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await lockWorkspaceSlaDefaults(tx, tenant.workspaceId);
        await tx.ticketSlaPolicy.updateMany({
          where: { workspaceId: tenant.workspaceId, isDefault: true, id: { not: policyId } },
          data: { isDefault: false },
        });
      }
      const updated = await tx.ticketSlaPolicy.update({
        where: { id: policyId },
        data: {
          name: input.name,
          description: input.description,
          isActive: input.isActive,
          isDefault: input.isDefault,
          timezone: input.calendar.timezone,
          businessMode: input.calendar.businessMode,
          businessHours: input.calendar.businessHours as unknown as Prisma.InputJsonValue,
          holidayDates: input.calendar.holidayDates,
        },
        select: { id: true, isDefault: true },
      });
      await tx.ticketSlaRule.deleteMany({ where: { policyId, workspaceId: tenant.workspaceId } });
      await tx.ticketSlaPauseStatus.deleteMany({
        where: { policyId, workspaceId: tenant.workspaceId },
      });
      await tx.ticketSlaRule.createMany({
        data: input.rules.map((rule) => ({ ...rule, policyId })),
      });
      if (input.pauseStatuses.length > 0) {
        await tx.ticketSlaPauseStatus.createMany({
          data: input.pauseStatuses.map((status) => ({ ...status, policyId })),
        });
      }
      await tx.auditLog.create({
        data: {
          superAgencyId: tenant.superAgencyId,
          agencyId: tenant.agencyId,
          workspaceId: tenant.workspaceId,
          userId: tenant.userId,
          action: 'ticket.sla_policy_updated',
          entityType: 'TicketSlaPolicy',
          entityId: updated.id,
          metadata: { policyId: updated.id, isDefault: updated.isDefault },
        },
      });
      return tx.ticketSlaPolicy.findUniqueOrThrow({
        where: { id: updated.id },
        include: policyInclude,
      });
    });
    return serializePolicy(policy);
  }

  async getTicketSla(tenant: WorkspaceTenantContext, ticketId: string) {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id: ticketId, workspaceId: tenant.workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!ticket) throw new NotFoundException('TICKET_NOT_FOUND');
    const state = await this.prisma.ticketSlaState.findFirst({
      where: { ticketId, workspaceId: tenant.workspaceId },
      select: ticketSlaStateSelect,
    });
    return state
      ? serializeState(state)
      : {
          configured: false,
          firstResponse: { state: 'NOT_CONFIGURED' },
          resolution: { state: 'NOT_CONFIGURED' },
        };
  }

  async initializeForTicket(
    tx: Tx,
    ticket: {
      id: string;
      workspaceId: string;
      priority: TaskPriority;
      statusDefinitionId: string;
      createdAt: Date;
    },
  ) {
    const policy = await tx.ticketSlaPolicy.findFirst({
      where: { workspaceId: ticket.workspaceId, isActive: true, isDefault: true },
      include: policyInclude,
    });
    if (!policy) return;
    const status = await tx.statusDefinition.findFirstOrThrow({
      where: {
        id: ticket.statusDefinitionId,
        workspaceId: ticket.workspaceId,
        entityType: StatusEntityType.TICKET,
      },
      select: { id: true, isTerminal: true },
    });
    const snapshot = snapshotFor(policy, ticket.priority);
    const firstPaused = snapshot.pauseFirstResponseStatusIds.includes(status.id);
    const resolutionPaused = snapshot.pauseResolutionStatusIds.includes(status.id);
    const firstDueAt = status.isTerminal
      ? null
      : firstPaused
        ? null
        : addBusinessMinutes(ticket.createdAt, snapshot.firstResponseTargetMinutes, snapshot);
    const resolutionDueAt = status.isTerminal
      ? addBusinessMinutes(ticket.createdAt, snapshot.resolutionTargetMinutes, snapshot)
      : resolutionPaused
        ? null
        : addBusinessMinutes(ticket.createdAt, snapshot.resolutionTargetMinutes, snapshot);
    await tx.ticketSlaState.create({
      data: {
        workspaceId: ticket.workspaceId,
        ticketId: ticket.id,
        sourcePolicyId: policy.id,
        policySnapshot: snapshot as unknown as Prisma.InputJsonValue,
        prioritySnapshot: ticket.priority,
        firstResponseTargetMinutes: snapshot.firstResponseTargetMinutes,
        firstResponseRemainingMinutes: snapshot.firstResponseTargetMinutes,
        firstResponseRunStartedAt: status.isTerminal || firstPaused ? null : ticket.createdAt,
        firstResponseDueAt: firstDueAt,
        firstResponsePausedAt: status.isTerminal ? null : firstPaused ? ticket.createdAt : null,
        firstResponseNotApplicableAt: status.isTerminal ? ticket.createdAt : null,
        resolutionTargetMinutes: snapshot.resolutionTargetMinutes,
        resolutionRemainingMinutes: snapshot.resolutionTargetMinutes,
        resolutionRunStartedAt: status.isTerminal || resolutionPaused ? null : ticket.createdAt,
        resolutionDueAt,
        resolutionPausedAt: status.isTerminal ? null : resolutionPaused ? ticket.createdAt : null,
        resolutionCompletedAt: status.isTerminal ? ticket.createdAt : null,
        resolutionBreachedAt:
          status.isTerminal && resolutionDueAt && ticket.createdAt > resolutionDueAt
            ? resolutionDueAt
            : null,
      },
    });
  }

  async handleConversationEntry(
    tx: Tx,
    ticketId: string,
    workspaceId: string,
    entryType: TicketConversationEntryType,
    authorMembershipId: string,
    at: Date,
  ) {
    if (entryType !== TicketConversationEntryType.PUBLIC_REPLY) return null;
    await this.lockState(tx, ticketId);
    const [ticket, state] = await Promise.all([
      tx.ticket.findFirst({
        where: { id: ticketId, workspaceId, deletedAt: null },
        select: { requester: { select: { type: true, internalMembershipId: true } } },
      }),
      tx.ticketSlaState.findFirst({
        where: { ticketId, workspaceId },
        select: ticketSlaStateSelect,
      }),
    ]);
    if (!ticket || !state || state.firstResponseCompletedAt || state.firstResponseNotApplicableAt) {
      return null;
    }
    const requester = ticket.requester;
    if (requester?.type === 'INTERNAL' && requester.internalMembershipId === authorMembershipId) {
      return null;
    }
    const breachedAt =
      state.firstResponseDueAt && at > state.firstResponseDueAt ? state.firstResponseDueAt : null;
    await tx.ticketSlaState.update({
      where: { id: state.id },
      data: {
        firstResponseCompletedAt: at,
        firstResponseBreachedAt: state.firstResponseBreachedAt ?? breachedAt,
        firstResponseRunStartedAt: null,
        firstResponsePausedAt: null,
      },
    });
    return {
      metric: 'FIRST_RESPONSE' as const,
      breached: Boolean(state.firstResponseBreachedAt ?? breachedAt),
    };
  }

  async handleStatusChange(
    tx: Tx,
    ticketId: string,
    workspaceId: string,
    toStatusDefinitionId: string,
    at: Date,
  ) {
    await this.lockState(tx, ticketId);
    const [status, state] = await Promise.all([
      tx.statusDefinition.findFirstOrThrow({
        where: { id: toStatusDefinitionId, workspaceId, entityType: StatusEntityType.TICKET },
        select: { id: true, isTerminal: true },
      }),
      tx.ticketSlaState.findFirst({
        where: { ticketId, workspaceId },
        select: ticketSlaStateSelect,
      }),
    ]);
    if (!state) return [];
    const snapshot = parseSnapshot(state.policySnapshot);
    const data: Prisma.TicketSlaStateUpdateInput = {};
    const events: Array<{ metric: 'FIRST_RESPONSE' | 'RESOLUTION'; action: string }> = [];
    if (!state.firstResponseCompletedAt && !state.firstResponseNotApplicableAt) {
      applyPauseTransition(data, state, snapshot, 'firstResponse', status.id, at);
    }
    if (!state.resolutionCompletedAt) {
      if (status.isTerminal) {
        const breachedAt =
          state.resolutionDueAt && at > state.resolutionDueAt ? state.resolutionDueAt : null;
        data.resolutionCompletedAt = at;
        data.resolutionBreachedAt = state.resolutionBreachedAt ?? breachedAt;
        data.resolutionRunStartedAt = null;
        data.resolutionPausedAt = null;
        events.push({
          metric: 'RESOLUTION',
          action: breachedAt || state.resolutionBreachedAt ? 'breached' : 'met',
        });
      } else {
        applyPauseTransition(data, state, snapshot, 'resolution', status.id, at);
      }
    }
    if (Object.keys(data).length > 0)
      await tx.ticketSlaState.update({ where: { id: state.id }, data });
    return events;
  }

  async scanBreaches(now = new Date(), limit = 50, client: PrismaService = this.prisma) {
    const dueStates = await client.ticketSlaState.findMany({
      where: {
        OR: [
          {
            firstResponseCompletedAt: null,
            firstResponseNotApplicableAt: null,
            firstResponseBreachedAt: null,
            firstResponsePausedAt: null,
            firstResponseDueAt: { lte: now },
          },
          {
            resolutionCompletedAt: null,
            resolutionBreachedAt: null,
            resolutionPausedAt: null,
            resolutionDueAt: { lte: now },
          },
        ],
      },
      select: { id: true },
      orderBy: { updatedAt: 'asc' },
      take: limit,
    });
    let breached = 0;
    for (const row of dueStates) {
      breached += await client.$transaction(async (tx: Tx) => {
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM ticket_sla_states
          WHERE id = ${row.id}::uuid
          FOR UPDATE SKIP LOCKED
        `;
        if (locked.length === 0) return 0;
        const state = await tx.ticketSlaState.findUniqueOrThrow({
          where: { id: row.id },
          select: ticketSlaStateSelect,
        });
        const data: Prisma.TicketSlaStateUpdateInput = {};
        let count = 0;
        if (
          !state.firstResponseCompletedAt &&
          !state.firstResponseNotApplicableAt &&
          !state.firstResponseBreachedAt &&
          !state.firstResponsePausedAt &&
          state.firstResponseDueAt &&
          state.firstResponseDueAt <= now
        ) {
          data.firstResponseBreachedAt = state.firstResponseDueAt;
          count += 1;
        }
        if (
          !state.resolutionCompletedAt &&
          !state.resolutionBreachedAt &&
          !state.resolutionPausedAt &&
          state.resolutionDueAt &&
          state.resolutionDueAt <= now
        ) {
          data.resolutionBreachedAt = state.resolutionDueAt;
          count += 1;
        }
        if (count > 0) await tx.ticketSlaState.update({ where: { id: state.id }, data });
        return count;
      });
    }
    return breached;
  }

  private async validatePolicyInput(workspaceId: string, dto: TicketSlaPolicyDto) {
    const name = dto.name.trim().replace(/\s+/g, ' ');
    if (!name) throw new BadRequestException('TICKET_SLA_POLICY_NAME_REQUIRED');
    const isActive = dto.isActive ?? true;
    const isDefault = dto.isDefault ?? false;
    if (isDefault && !isActive) throw new BadRequestException('TICKET_SLA_DEFAULT_MUST_BE_ACTIVE');
    const ruleMap = new Map<TaskPriority, TicketSlaPolicyDto['rules'][number]>();
    for (const rule of dto.rules ?? []) {
      validateTargetMinutes(rule.firstResponseMinutes);
      validateTargetMinutes(rule.resolutionMinutes);
      if (ruleMap.has(rule.priority)) throw new BadRequestException('TICKET_SLA_RULE_DUPLICATE');
      ruleMap.set(rule.priority, rule);
    }
    if (SLA_PRIORITIES.some((priority) => !ruleMap.has(priority))) {
      throw new BadRequestException('TICKET_SLA_RULES_INCOMPLETE');
    }
    const calendar = validateSlaCalendar({
      businessMode: dto.businessMode ?? TicketSlaBusinessMode.BUSINESS_HOURS,
      timezone: dto.timezone,
      businessHours: dto.businessHours ?? defaultBusinessHours(),
      holidayDates: dto.holidayDates ?? [],
    });
    const pauseStatuses = await this.validatePauseStatuses(workspaceId, dto.pauseStatuses ?? []);
    return {
      name,
      description: dto.description?.trim() || null,
      isActive,
      isDefault,
      calendar,
      rules: SLA_PRIORITIES.map((priority) => {
        const rule = ruleMap.get(priority)!;
        return {
          workspaceId,
          priority,
          firstResponseMinutes: rule.firstResponseMinutes,
          resolutionMinutes: rule.resolutionMinutes,
        };
      }),
      pauseStatuses: pauseStatuses.map((status) => ({
        workspaceId,
        statusDefinitionId: status.statusDefinitionId,
        pauseFirstResponse: status.pauseFirstResponse,
        pauseResolution: status.pauseResolution,
      })),
    };
  }

  private async validatePauseStatuses(
    workspaceId: string,
    input: TicketSlaPolicyDto['pauseStatuses'],
  ) {
    const ids = new Set<string>();
    const rows = [];
    for (const item of input ?? []) {
      const pauseFirstResponse = item.pauseFirstResponse ?? false;
      const pauseResolution = item.pauseResolution ?? false;
      if (!pauseFirstResponse && !pauseResolution)
        throw new BadRequestException('TICKET_SLA_PAUSE_EMPTY');
      if (ids.has(item.statusDefinitionId))
        throw new BadRequestException('TICKET_SLA_PAUSE_DUPLICATE');
      ids.add(item.statusDefinitionId);
      const status = await this.prisma.statusDefinition.findFirst({
        where: { id: item.statusDefinitionId, workspaceId, entityType: StatusEntityType.TICKET },
        select: { id: true, isTerminal: true },
      });
      if (!status) throw new BadRequestException('TICKET_SLA_PAUSE_STATUS_INVALID');
      if (status.isTerminal) throw new BadRequestException('TICKET_SLA_TERMINAL_PAUSE_INVALID');
      rows.push({ statusDefinitionId: status.id, pauseFirstResponse, pauseResolution });
    }
    return rows;
  }

  private async lockState(tx: Tx, ticketId: string) {
    await tx.$queryRaw(Prisma.sql`
      SELECT id
      FROM ticket_sla_states
      WHERE ticket_id = ${ticketId}::uuid
      FOR UPDATE
    `);
  }
}

const policyInclude = {
  rules: { orderBy: { priority: 'asc' } },
  pauseStatuses: {
    include: {
      statusDefinition: { select: { id: true, name: true, color: true, isTerminal: true } },
    },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.TicketSlaPolicyInclude;

const ticketSlaStateSelect = Prisma.validator<Prisma.TicketSlaStateSelect>()({
  id: true,
  workspaceId: true,
  ticketId: true,
  sourcePolicyId: true,
  policySnapshot: true,
  prioritySnapshot: true,
  firstResponseTargetMinutes: true,
  firstResponseRemainingMinutes: true,
  firstResponseRunStartedAt: true,
  firstResponseDueAt: true,
  firstResponsePausedAt: true,
  firstResponseCompletedAt: true,
  firstResponseBreachedAt: true,
  firstResponseNotApplicableAt: true,
  resolutionTargetMinutes: true,
  resolutionRemainingMinutes: true,
  resolutionRunStartedAt: true,
  resolutionDueAt: true,
  resolutionPausedAt: true,
  resolutionCompletedAt: true,
  resolutionBreachedAt: true,
  createdAt: true,
  updatedAt: true,
});

function snapshotFor(policy: PolicyRecord, priority: TaskPriority): Snapshot {
  const rule = policy.rules.find((item) => item.priority === priority);
  if (!rule) throw new ConflictException('TICKET_SLA_RULE_MISSING');
  return {
    policyId: policy.id,
    policyName: policy.name,
    priority,
    firstResponseTargetMinutes: rule.firstResponseMinutes,
    resolutionTargetMinutes: rule.resolutionMinutes,
    businessMode: policy.businessMode,
    timezone: policy.timezone,
    businessHours: policy.businessHours as unknown as Snapshot['businessHours'],
    holidayDates: policy.holidayDates,
    pauseFirstResponseStatusIds: policy.pauseStatuses
      .filter((item) => item.pauseFirstResponse)
      .map((item) => item.statusDefinitionId),
    pauseResolutionStatusIds: policy.pauseStatuses
      .filter((item) => item.pauseResolution)
      .map((item) => item.statusDefinitionId),
  };
}

function parseSnapshot(value: Prisma.JsonValue): Snapshot {
  return value as unknown as Snapshot;
}

async function lockWorkspaceSlaDefaults(tx: Tx, workspaceId: string) {
  await tx.$executeRaw(Prisma.sql`
    SELECT pg_advisory_xact_lock(hashtext(${workspaceId}::text)::bigint)
  `);
}

function applyPauseTransition(
  data: Prisma.TicketSlaStateUpdateInput,
  state: StateRecord,
  snapshot: Snapshot,
  metric: 'firstResponse' | 'resolution',
  statusDefinitionId: string,
  at: Date,
) {
  const pauseIds =
    metric === 'firstResponse'
      ? snapshot.pauseFirstResponseStatusIds
      : snapshot.pauseResolutionStatusIds;
  const isPause = pauseIds.includes(statusDefinitionId);
  const prefix = metric;
  const completedAt = state[`${prefix}CompletedAt` as keyof StateRecord];
  const pausedAt = state[`${prefix}PausedAt` as keyof StateRecord] as Date | null;
  const runStartedAt = state[`${prefix}RunStartedAt` as keyof StateRecord] as Date | null;
  const remaining = state[`${prefix}RemainingMinutes` as keyof StateRecord] as number;
  const breachedAt = state[`${prefix}BreachedAt` as keyof StateRecord] as Date | null;
  const dueAt = state[`${prefix}DueAt` as keyof StateRecord] as Date | null;
  if (completedAt) return;
  if (breachedAt) return;
  if (isPause && !pausedAt) {
    if (dueAt && at >= dueAt) {
      Object.assign(data, {
        [`${prefix}BreachedAt`]: dueAt,
        [`${prefix}RunStartedAt`]: null,
        [`${prefix}PausedAt`]: null,
      });
      return;
    }
    const elapsed = runStartedAt ? businessMinutesBetween(runStartedAt, at, snapshot) : 0;
    const nextRemaining = Math.max(0, remaining - elapsed);
    Object.assign(data, {
      [`${prefix}RemainingMinutes`]: nextRemaining,
      [`${prefix}RunStartedAt`]: null,
      [`${prefix}DueAt`]: null,
      [`${prefix}PausedAt`]: at,
    });
  } else if (!isPause && pausedAt) {
    Object.assign(data, {
      [`${prefix}RunStartedAt`]: at,
      [`${prefix}DueAt`]: remaining > 0 ? addBusinessMinutes(at, remaining, snapshot) : at,
      [`${prefix}PausedAt`]: null,
    });
  }
}

function metricState(options: {
  configured: boolean;
  notApplicableAt?: Date | null;
  completedAt?: Date | null;
  breachedAt?: Date | null;
  pausedAt?: Date | null;
}) {
  if (!options.configured) return 'NOT_CONFIGURED';
  if (options.notApplicableAt) return 'NOT_APPLICABLE';
  if (options.breachedAt) return 'BREACHED';
  if (options.completedAt) return 'MET';
  if (options.pausedAt) return 'PAUSED';
  return 'RUNNING';
}

function serializePolicy(policy: PolicyRecord) {
  return {
    id: policy.id,
    workspaceId: policy.workspaceId,
    name: policy.name,
    description: policy.description,
    isActive: policy.isActive,
    isDefault: policy.isDefault,
    timezone: policy.timezone,
    businessMode: policy.businessMode,
    businessHours: policy.businessHours,
    holidayDates: policy.holidayDates,
    rules: policy.rules.map((rule) => ({
      priority: rule.priority,
      firstResponseMinutes: rule.firstResponseMinutes,
      resolutionMinutes: rule.resolutionMinutes,
    })),
    pauseStatuses: policy.pauseStatuses.map((item) => ({
      statusDefinitionId: item.statusDefinitionId,
      pauseFirstResponse: item.pauseFirstResponse,
      pauseResolution: item.pauseResolution,
      status: item.statusDefinition,
    })),
    createdAt: policy.createdAt,
    updatedAt: policy.updatedAt,
  };
}

function policyMatchesInput(existing: PolicyRecord, input: ValidatedPolicyInput) {
  const existingComparable = {
    name: existing.name,
    description: existing.description,
    isActive: existing.isActive,
    isDefault: existing.isDefault,
    calendar: {
      timezone: existing.timezone,
      businessMode: existing.businessMode,
      businessHours: existing.businessHours,
      holidayDates: [...existing.holidayDates].sort(),
    },
    rules: existing.rules.map((rule) => ({
      workspaceId: rule.workspaceId,
      priority: rule.priority,
      firstResponseMinutes: rule.firstResponseMinutes,
      resolutionMinutes: rule.resolutionMinutes,
    })),
    pauseStatuses: existing.pauseStatuses.map((status) => ({
      workspaceId: status.workspaceId,
      statusDefinitionId: status.statusDefinitionId,
      pauseFirstResponse: status.pauseFirstResponse,
      pauseResolution: status.pauseResolution,
    })),
  };
  const inputComparable = {
    name: input.name,
    description: input.description,
    isActive: input.isActive,
    isDefault: input.isDefault,
    calendar: {
      timezone: input.calendar.timezone,
      businessMode: input.calendar.businessMode,
      businessHours: input.calendar.businessHours,
      holidayDates: [...input.calendar.holidayDates].sort(),
    },
    rules: input.rules,
    pauseStatuses: input.pauseStatuses,
  };
  return (
    JSON.stringify(sortPolicyComparable(existingComparable)) ===
    JSON.stringify(sortPolicyComparable(inputComparable))
  );
}

function sortPolicyComparable<
  T extends {
    rules: Array<{ priority: TaskPriority }>;
    pauseStatuses: Array<{ statusDefinitionId: string }>;
  },
>(value: T) {
  return {
    ...value,
    rules: [...value.rules].sort((a, b) => a.priority.localeCompare(b.priority)),
    pauseStatuses: [...value.pauseStatuses].sort((a, b) =>
      a.statusDefinitionId.localeCompare(b.statusDefinitionId),
    ),
  };
}

function serializeState(state: StateRecord) {
  const snapshot = parseSnapshot(state.policySnapshot);
  return {
    configured: true,
    policy: { id: snapshot.policyId, name: snapshot.policyName },
    priority: state.prioritySnapshot,
    timezone: snapshot.timezone,
    businessMode: snapshot.businessMode,
    firstResponse: {
      state: metricState({
        configured: true,
        notApplicableAt: state.firstResponseNotApplicableAt,
        completedAt: state.firstResponseCompletedAt,
        breachedAt: state.firstResponseBreachedAt,
        pausedAt: state.firstResponsePausedAt,
      }),
      targetMinutes: state.firstResponseTargetMinutes,
      remainingMinutes: state.firstResponseRemainingMinutes,
      dueAt: state.firstResponseDueAt,
      pausedAt: state.firstResponsePausedAt,
      completedAt: state.firstResponseCompletedAt,
      breachedAt: state.firstResponseBreachedAt,
      notApplicableAt: state.firstResponseNotApplicableAt,
    },
    resolution: {
      state: metricState({
        configured: true,
        completedAt: state.resolutionCompletedAt,
        breachedAt: state.resolutionBreachedAt,
        pausedAt: state.resolutionPausedAt,
      }),
      targetMinutes: state.resolutionTargetMinutes,
      remainingMinutes: state.resolutionRemainingMinutes,
      dueAt: state.resolutionDueAt,
      pausedAt: state.resolutionPausedAt,
      completedAt: state.resolutionCompletedAt,
      breachedAt: state.resolutionBreachedAt,
    },
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
  };
}

export function hasSlaPermission(tenant: WorkspaceTenantContext, permission: string) {
  return tenant.permissions.includes('*') || tenant.permissions.includes(permission);
}
