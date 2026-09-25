import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  CalendarEvent,
  CalendarEventVisibility,
  CalendarSourceType,
  MembershipStatus,
  Prisma,
  ProjectVisibility,
  TaskPriority,
} from '@prisma/client';
import type { WorkspaceTenantContext } from '../../common/auth/auth.types';
import { PermissionKeys } from '../../common/authorization/permissions';
import { safeWorkspaceTimezone } from '../../common/timezones';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BillingEntitlementService } from '../billing/billing-entitlement.service';
import { RealtimeService } from '../realtime/realtime.service';
import {
  CalendarQueryDto,
  CreateCalendarEventDto,
  UpdateCalendarEventDto,
} from './dto/calendar.dto';

const maxRangeMs = 93 * 24 * 60 * 60 * 1000;
const emptyUuid = '00000000-0000-4000-8000-000000000000';

export interface CalendarItemDto {
  id: string;
  sourceType: CalendarSourceType;
  sourceId: string;
  title: string;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  status: { id: string | null; name: string; terminal?: boolean } | string | null;
  priority: TaskPriority | null;
  departmentId: string | null;
  participantMembershipIds: string[];
  visibility: CalendarEventVisibility | ProjectVisibility | 'SOURCE';
  editable: boolean;
  metadata: Record<string, string | number | boolean | null>;
}

@Injectable()
export class CalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    @Optional() private readonly billingEntitlements?: BillingEntitlementService,
  ) {}

  async list(tenant: WorkspaceTenantContext, query: CalendarQueryDto) {
    const window = await this.window(tenant.workspaceId, query);
    const sourceTypes = new Set(query.sourceTypes ?? Object.values(CalendarSourceType));
    const [tasks, projects, tickets, customEvents] = await Promise.all([
      sourceTypes.has(CalendarSourceType.TASK) && hasPermission(tenant, PermissionKeys.tasksView)
        ? this.taskItems(tenant, query, window)
        : Promise.resolve([]),
      sourceTypes.has(CalendarSourceType.PROJECT) &&
      hasPermission(tenant, PermissionKeys.projectsView)
        ? this.projectItems(tenant, query, window)
        : Promise.resolve([]),
      sourceTypes.has(CalendarSourceType.TICKET) &&
      hasPermission(tenant, PermissionKeys.ticketsView)
        ? this.ticketItems(tenant, query, window)
        : Promise.resolve([]),
      sourceTypes.has(CalendarSourceType.CUSTOM_EVENT)
        ? this.customItems(tenant, query, window)
        : Promise.resolve([]),
    ]);
    const items = [...tasks, ...projects, ...tickets, ...customEvents].sort(
      (left, right) =>
        left.startAt.localeCompare(right.startAt) ||
        left.sourceType.localeCompare(right.sourceType) ||
        left.title.localeCompare(right.title),
    );
    return { window, items };
  }

  async getCustomEvent(tenant: WorkspaceTenantContext, eventId: string) {
    const event = await this.findVisibleCustomEvent(tenant, eventId);
    return this.customEventPayload(tenant, event);
  }

  async createCustomEvent(tenant: WorkspaceTenantContext, dto: CreateCalendarEventDto) {
    await this.billingEntitlements?.assertWorkspaceFeatureAvailable(
      tenant.workspaceId,
      'calendar.enabled',
    );
    const actorMembershipId = this.requireMembership(tenant);
    const workspaceTimezone = await this.workspaceTimezone(tenant.workspaceId);
    const input = await this.normalizeCustomEventInput(tenant, dto, workspaceTimezone);
    const created = await this.prisma.$transaction(async (tx) => {
      const event = await tx.calendarEvent.create({
        data: {
          workspaceId: tenant.workspaceId,
          title: input.title,
          description: input.description,
          startAt: input.startAt,
          endAt: input.endAt,
          allDay: input.allDay,
          timezone: input.timezone,
          visibility: input.visibility,
          createdByMembershipId: actorMembershipId,
          ownerMembershipId: input.ownerMembershipId,
          participants: {
            createMany: {
              data: input.participantMembershipIds.map((membershipId) => ({
                workspaceId: tenant.workspaceId,
                membershipId,
                participantRole: membershipId === input.ownerMembershipId ? 'OWNER' : 'PARTICIPANT',
              })),
            },
          },
        },
        include: customEventInclude,
      });
      await this.audit.record({
        agencyId: tenant.agencyId,
        workspaceId: tenant.workspaceId,
        userId: tenant.userId,
        action: 'calendar.event_created',
        entityType: 'CalendarEvent',
        entityId: event.id,
        metadata: auditMetadata(event),
      });
      return event;
    });
    await this.publishCalendarChange(tenant, created, 'CALENDAR_EVENT_CREATED');
    return this.customEventPayload(tenant, created);
  }

  async updateCustomEvent(
    tenant: WorkspaceTenantContext,
    eventId: string,
    dto: UpdateCalendarEventDto,
  ) {
    await this.billingEntitlements?.assertWorkspaceFeatureAvailable(
      tenant.workspaceId,
      'calendar.enabled',
    );
    const existing = await this.findVisibleCustomEvent(tenant, eventId);
    this.assertCanEdit(tenant, existing);
    const workspaceTimezone = await this.workspaceTimezone(tenant.workspaceId);
    const input = await this.normalizeCustomEventInput(tenant, dto, workspaceTimezone, existing);
    if (isNoopUpdate(existing, input)) return this.customEventPayload(tenant, existing);
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.calendarEventParticipant.deleteMany({
        where: { calendarEventId: existing.id, workspaceId: tenant.workspaceId },
      });
      const event = await tx.calendarEvent.update({
        where: { id_workspaceId: { id: existing.id, workspaceId: tenant.workspaceId } },
        data: {
          title: input.title,
          description: input.description,
          startAt: input.startAt,
          endAt: input.endAt,
          allDay: input.allDay,
          timezone: input.timezone,
          visibility: input.visibility,
          ownerMembershipId: input.ownerMembershipId,
          participants: {
            createMany: {
              data: input.participantMembershipIds.map((membershipId) => ({
                workspaceId: tenant.workspaceId,
                membershipId,
                participantRole: membershipId === input.ownerMembershipId ? 'OWNER' : 'PARTICIPANT',
              })),
            },
          },
        },
        include: customEventInclude,
      });
      await this.audit.record({
        agencyId: tenant.agencyId,
        workspaceId: tenant.workspaceId,
        userId: tenant.userId,
        action: 'calendar.event_updated',
        entityType: 'CalendarEvent',
        entityId: event.id,
        metadata: auditMetadata(event),
      });
      return event;
    });
    await this.publishCalendarChange(tenant, updated, 'CALENDAR_EVENT_UPDATED');
    return this.customEventPayload(tenant, updated);
  }

  async cancelCustomEvent(tenant: WorkspaceTenantContext, eventId: string) {
    await this.billingEntitlements?.assertWorkspaceFeatureAvailable(
      tenant.workspaceId,
      'calendar.enabled',
    );
    const existing = await this.findVisibleCustomEvent(tenant, eventId);
    this.assertCanEdit(tenant, existing);
    if (existing.cancelledAt) return this.customEventPayload(tenant, existing);
    const cancelled = await this.prisma.calendarEvent.update({
      where: { id_workspaceId: { id: existing.id, workspaceId: tenant.workspaceId } },
      data: { cancelledAt: new Date() },
      include: customEventInclude,
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'calendar.event_cancelled',
      entityType: 'CalendarEvent',
      entityId: cancelled.id,
      metadata: auditMetadata(cancelled),
    });
    await this.publishCalendarChange(tenant, cancelled, 'CALENDAR_EVENT_CANCELLED');
    return this.customEventPayload(tenant, cancelled);
  }

  private async taskItems(
    tenant: WorkspaceTenantContext,
    query: CalendarQueryDto,
    window: CalendarWindow,
  ): Promise<CalendarItemDto[]> {
    const rows = await this.prisma.task.findMany({
      where: {
        workspaceId: tenant.workspaceId,
        deletedAt: null,
        OR: datedSourceWhere(window) as Prisma.TaskWhereInput[],
        ...(query.priorities?.length ? { priority: { in: query.priorities } } : {}),
        ...(query.statuses?.length ? { statusDefinitionId: { in: query.statuses } } : {}),
        ...(query.departmentIds?.length ? { departmentId: { in: query.departmentIds } } : {}),
        ...(query.memberIds?.length
          ? {
              assignees: {
                some: { workspaceId: tenant.workspaceId, membershipId: { in: query.memberIds } },
              },
            }
          : {}),
      },
      select: {
        id: true,
        title: true,
        priority: true,
        plannedStartAt: true,
        dueAt: true,
        departmentId: true,
        statusDefinition: { select: { id: true, name: true, isTerminal: true } },
        assignees: { select: { membershipId: true }, orderBy: { createdAt: 'asc' } },
      },
      orderBy: [{ dueAt: 'asc' }, { plannedStartAt: 'asc' }],
      take: 500,
    });
    return rows
      .filter((task) => task.plannedStartAt || task.dueAt)
      .map((task) => ({
        id: `TASK:${task.id}`,
        sourceType: CalendarSourceType.TASK,
        sourceId: task.id,
        title: task.title,
        startAt: (task.plannedStartAt ?? task.dueAt)!.toISOString(),
        endAt: task.plannedStartAt && task.dueAt ? task.dueAt.toISOString() : null,
        allDay: false,
        status: {
          id: task.statusDefinition.id,
          name: task.statusDefinition.name,
          terminal: task.statusDefinition.isTerminal,
        },
        priority: task.priority,
        departmentId: task.departmentId,
        participantMembershipIds: task.assignees.map((item) => item.membershipId),
        visibility: 'SOURCE',
        editable: false,
        metadata: { kind: task.plannedStartAt && task.dueAt ? 'range' : 'deadline' },
      }));
  }

  private async projectItems(
    tenant: WorkspaceTenantContext,
    query: CalendarQueryDto,
    window: CalendarWindow,
  ): Promise<CalendarItemDto[]> {
    const projectWhere: Prisma.ProjectWhereInput = {
      AND: [
        this.projectVisibilityWhere(tenant),
        { OR: datedSourceWhere(window) as Prisma.ProjectWhereInput[] },
        ...(query.priorities?.length ? [{ priority: { in: query.priorities } }] : []),
        ...(query.statuses?.length ? [{ statusDefinitionId: { in: query.statuses } }] : []),
        ...(query.departmentIds?.length ? [{ departmentId: { in: query.departmentIds } }] : []),
        ...(query.memberIds?.length
          ? [
              {
                OR: [
                  { ownerMembershipId: { in: query.memberIds } },
                  {
                    members: {
                      some: {
                        workspaceId: tenant.workspaceId,
                        workspaceMembershipId: { in: query.memberIds },
                      },
                    },
                  },
                ],
              },
            ]
          : []),
      ],
    };
    const rows = await this.prisma.project.findMany({
      where: {
        ...projectWhere,
      },
      select: {
        id: true,
        name: true,
        priority: true,
        visibility: true,
        plannedStartAt: true,
        dueAt: true,
        departmentId: true,
        ownerMembershipId: true,
        statusDefinition: { select: { id: true, name: true, isTerminal: true } },
        status: true,
        members: { select: { workspaceMembershipId: true }, orderBy: { createdAt: 'asc' } },
      },
      orderBy: [{ dueAt: 'asc' }, { plannedStartAt: 'asc' }],
      take: 500,
    });
    return rows
      .filter((project) => project.plannedStartAt || project.dueAt)
      .map((project) => ({
        id: `PROJECT:${project.id}`,
        sourceType: CalendarSourceType.PROJECT,
        sourceId: project.id,
        title: project.name,
        startAt: (project.plannedStartAt ?? project.dueAt)!.toISOString(),
        endAt: project.plannedStartAt && project.dueAt ? project.dueAt.toISOString() : null,
        allDay: false,
        status: project.statusDefinition
          ? {
              id: project.statusDefinition.id,
              name: project.statusDefinition.name,
              terminal: project.statusDefinition.isTerminal,
            }
          : project.status,
        priority: project.priority,
        departmentId: project.departmentId,
        participantMembershipIds: [
          project.ownerMembershipId,
          ...project.members.map((item) => item.workspaceMembershipId),
        ].filter(unique),
        visibility: project.visibility,
        editable: false,
        metadata: { kind: project.plannedStartAt && project.dueAt ? 'range' : 'deadline' },
      }));
  }

  private async ticketItems(
    tenant: WorkspaceTenantContext,
    query: CalendarQueryDto,
    window: CalendarWindow,
  ): Promise<CalendarItemDto[]> {
    const rows = await this.prisma.ticket.findMany({
      where: {
        workspaceId: tenant.workspaceId,
        deletedAt: null,
        AND: [
          this.ticketVisibilityWhere(tenant),
          {
            slaState: {
              resolutionDueAt: { gte: window.from, lte: window.to },
              resolutionCompletedAt: null,
            },
          },
          ...(query.priorities?.length ? [{ priority: { in: query.priorities } }] : []),
          ...(query.statuses?.length ? [{ statusDefinitionId: { in: query.statuses } }] : []),
          ...(query.departmentIds?.length ? [{ departmentId: { in: query.departmentIds } }] : []),
          ...(query.memberIds?.length
            ? [
                {
                  assignedToMembershipId: { in: query.memberIds },
                },
              ]
            : []),
        ],
      },
      select: {
        id: true,
        ticketNumber: true,
        subject: true,
        priority: true,
        departmentId: true,
        assignedToMembershipId: true,
        statusDefinition: { select: { id: true, name: true, isTerminal: true } },
        requester: { select: { internalMembershipId: true } },
        slaState: { select: { resolutionDueAt: true } },
      },
      orderBy: { updatedAt: 'asc' },
      take: 500,
    });
    return rows
      .filter((ticket) => ticket.slaState?.resolutionDueAt)
      .map((ticket) => ({
        id: `TICKET:${ticket.id}`,
        sourceType: CalendarSourceType.TICKET,
        sourceId: ticket.id,
        title: `${ticket.ticketNumber}: ${ticket.subject}`,
        startAt: ticket.slaState!.resolutionDueAt!.toISOString(),
        endAt: null,
        allDay: false,
        status: {
          id: ticket.statusDefinition.id,
          name: ticket.statusDefinition.name,
          terminal: ticket.statusDefinition.isTerminal,
        },
        priority: ticket.priority,
        departmentId: ticket.departmentId,
        participantMembershipIds: [
          ticket.assignedToMembershipId,
          ticket.requester?.internalMembershipId,
        ].filter((value): value is string => Boolean(value)),
        visibility: 'SOURCE',
        editable: false,
        metadata: { kind: 'sla_resolution_deadline', ticketNumber: ticket.ticketNumber },
      }));
  }

  private async customItems(
    tenant: WorkspaceTenantContext,
    query: CalendarQueryDto,
    window: CalendarWindow,
  ): Promise<CalendarItemDto[]> {
    const rows = await this.prisma.calendarEvent.findMany({
      where: {
        AND: [
          this.customEventVisibilityWhere(tenant),
          { cancelledAt: null },
          { startAt: { lte: window.to } },
          {
            OR: [{ endAt: null, startAt: { gte: window.from } }, { endAt: { gte: window.from } }],
          },
          ...(query.memberIds?.length
            ? [
                {
                  OR: [
                    { ownerMembershipId: { in: query.memberIds } },
                    { participants: { some: { membershipId: { in: query.memberIds } } } },
                  ],
                },
              ]
            : []),
        ],
      },
      include: customEventInclude,
      orderBy: [{ startAt: 'asc' }, { title: 'asc' }],
      take: 500,
    });
    return rows.map((event) => this.customCalendarItem(tenant, event));
  }

  private async findVisibleCustomEvent(tenant: WorkspaceTenantContext, eventId: string) {
    const event = await this.prisma.calendarEvent.findFirst({
      where: {
        id: eventId,
        workspaceId: tenant.workspaceId,
        ...this.customEventVisibilityWhere(tenant),
      },
      include: customEventInclude,
    });
    if (!event) throw new NotFoundException('CALENDAR_EVENT_NOT_FOUND');
    return event;
  }

  private async normalizeCustomEventInput(
    tenant: WorkspaceTenantContext,
    dto: CreateCalendarEventDto | UpdateCalendarEventDto,
    workspaceTimezone: string,
    existing?: CalendarEventWithParticipants,
  ) {
    const title = (dto.title ?? existing?.title ?? '').trim();
    if (!title) throw new BadRequestException('CALENDAR_EVENT_TITLE_REQUIRED');
    const startAt = dto.startAt ? new Date(dto.startAt) : existing?.startAt;
    if (!startAt || Number.isNaN(startAt.getTime())) {
      throw new BadRequestException('CALENDAR_EVENT_START_INVALID');
    }
    const endAt =
      dto.endAt === null ? null : dto.endAt ? new Date(dto.endAt) : (existing?.endAt ?? null);
    if (endAt && Number.isNaN(endAt.getTime())) {
      throw new BadRequestException('CALENDAR_EVENT_END_INVALID');
    }
    if (endAt && endAt.getTime() < startAt.getTime()) {
      throw new BadRequestException('CALENDAR_EVENT_END_BEFORE_START');
    }
    const allDay = dto.allDay ?? existing?.allDay ?? false;
    const visibility = dto.visibility ?? existing?.visibility ?? CalendarEventVisibility.WORKSPACE;
    const ownerMembershipId =
      dto.ownerMembershipId ?? existing?.ownerMembershipId ?? this.requireMembership(tenant);
    const requestedParticipants =
      dto.participantMembershipIds ??
      existing?.participants.map((participant) => participant.membershipId) ??
      [];
    if (hasDuplicate(requestedParticipants)) {
      throw new BadRequestException('CALENDAR_EVENT_DUPLICATE_PARTICIPANT');
    }
    const participantMembershipIds = [ownerMembershipId, ...requestedParticipants].filter(unique);
    await this.assertActiveMemberships(tenant.workspaceId, participantMembershipIds);
    const timezone =
      (dto.timezone === null ? null : dto.timezone) ?? existing?.timezone ?? workspaceTimezone;
    return {
      title,
      description:
        dto.description === undefined
          ? (existing?.description ?? null)
          : dto.description?.trim() || null,
      startAt,
      endAt,
      allDay,
      timezone,
      visibility,
      ownerMembershipId,
      participantMembershipIds,
    };
  }

  private async assertActiveMemberships(workspaceId: string, membershipIds: string[]) {
    const rows = await this.prisma.workspaceMembership.findMany({
      where: { workspaceId, id: { in: membershipIds } },
      select: { id: true, status: true },
    });
    if (rows.length !== membershipIds.length) {
      throw new BadRequestException('CALENDAR_EVENT_FOREIGN_PARTICIPANT');
    }
    if (rows.some((row) => row.status !== MembershipStatus.ACTIVE)) {
      throw new BadRequestException('CALENDAR_EVENT_INACTIVE_PARTICIPANT');
    }
  }

  private customEventPayload(tenant: WorkspaceTenantContext, event: CalendarEventWithParticipants) {
    return this.customCalendarItem(tenant, event);
  }

  private customCalendarItem(
    tenant: WorkspaceTenantContext,
    event: CalendarEventWithParticipants,
  ): CalendarItemDto {
    return {
      id: `CUSTOM_EVENT:${event.id}`,
      sourceType: CalendarSourceType.CUSTOM_EVENT,
      sourceId: event.id,
      title: event.title,
      startAt: event.startAt.toISOString(),
      endAt: event.endAt?.toISOString() ?? null,
      allDay: event.allDay,
      status: event.cancelledAt ? 'CANCELLED' : 'ACTIVE',
      priority: null,
      departmentId: null,
      participantMembershipIds: event.participants.map((participant) => participant.membershipId),
      visibility: event.visibility,
      editable: this.canEdit(tenant, event),
      metadata: {
        description: event.description,
        timezone: event.timezone,
        ownerMembershipId: event.ownerMembershipId,
      },
    };
  }

  private async window(workspaceId: string, query: CalendarQueryDto): Promise<CalendarWindow> {
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('CALENDAR_RANGE_INVALID');
    }
    if (to.getTime() <= from.getTime()) throw new BadRequestException('CALENDAR_RANGE_INVERTED');
    if (to.getTime() - from.getTime() > maxRangeMs) {
      throw new BadRequestException('CALENDAR_RANGE_TOO_LARGE');
    }
    return { from, to, timezone: await this.workspaceTimezone(workspaceId) };
  }

  private async workspaceTimezone(workspaceId: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { timezone: true },
    });
    return safeWorkspaceTimezone(workspace?.timezone, workspaceId);
  }

  private projectVisibilityWhere(tenant: WorkspaceTenantContext): Prisma.ProjectWhereInput {
    const base: Prisma.ProjectWhereInput = { workspaceId: tenant.workspaceId, archivedAt: null };
    if (hasPermission(tenant, PermissionKeys.projectsViewAll)) return base;
    const membershipId = tenant.workspaceMembershipId;
    return {
      ...base,
      OR: [
        { visibility: ProjectVisibility.WORKSPACE },
        ...(membershipId
          ? [
              { ownerMembershipId: membershipId },
              {
                members: {
                  some: { workspaceMembershipId: membershipId, workspaceId: tenant.workspaceId },
                },
              },
            ]
          : []),
      ],
    };
  }

  private ticketVisibilityWhere(tenant: WorkspaceTenantContext): Prisma.TicketWhereInput {
    if (hasPermission(tenant, PermissionKeys.ticketsViewAll)) return {};
    const membershipId = tenant.workspaceMembershipId;
    if (!membershipId) return { id: emptyUuid };
    return {
      OR: [
        { requester: { internalMembershipId: membershipId } },
        ...(tenant.workspaceMembershipId
          ? [
              {
                assignedToMembershipId: membershipId,
              },
            ]
          : []),
      ],
    };
  }

  private customEventVisibilityWhere(
    tenant: WorkspaceTenantContext,
  ): Prisma.CalendarEventWhereInput {
    const membershipId = tenant.workspaceMembershipId;
    if (hasPermission(tenant, PermissionKeys.calendarEventsManageAll)) {
      return { workspaceId: tenant.workspaceId };
    }
    return {
      workspaceId: tenant.workspaceId,
      OR: [
        { visibility: CalendarEventVisibility.WORKSPACE },
        ...(membershipId
          ? [
              { createdByMembershipId: membershipId },
              { ownerMembershipId: membershipId },
              {
                visibility: CalendarEventVisibility.PARTICIPANTS_ONLY,
                participants: { some: { membershipId } },
              },
            ]
          : []),
      ],
    };
  }

  private assertCanEdit(tenant: WorkspaceTenantContext, event: CalendarEventWithParticipants) {
    if (!this.canEdit(tenant, event)) throw new ForbiddenException('CALENDAR_EVENT_EDIT_DENIED');
  }

  private canEdit(tenant: WorkspaceTenantContext, event: CalendarEventWithParticipants) {
    if (hasPermission(tenant, PermissionKeys.calendarEventsManageAll)) return true;
    if (!hasPermission(tenant, PermissionKeys.calendarEventsEditOwn)) return false;
    const membershipId = tenant.workspaceMembershipId;
    return Boolean(
      membershipId &&
      (event.createdByMembershipId === membershipId || event.ownerMembershipId === membershipId),
    );
  }

  private requireMembership(tenant: WorkspaceTenantContext) {
    if (!tenant.workspaceMembershipId) {
      throw new ForbiddenException('WORKSPACE_MEMBERSHIP_REQUIRED');
    }
    return tenant.workspaceMembershipId;
  }

  private async publishCalendarChange(
    tenant: WorkspaceTenantContext,
    event: CalendarEventWithParticipants,
    eventType: 'CALENDAR_EVENT_CREATED' | 'CALENDAR_EVENT_UPDATED' | 'CALENDAR_EVENT_CANCELLED',
  ) {
    const payload = { calendarEventId: event.id, visibility: event.visibility };
    if (event.visibility === CalendarEventVisibility.WORKSPACE) {
      await this.realtime.publishWorkspace({
        workspaceId: tenant.workspaceId,
        eventType,
        entityType: 'CALENDAR',
        entityId: event.id,
        actorMembershipId: tenant.workspaceMembershipId,
        payload,
      });
      return;
    }
    const targets = [
      event.createdByMembershipId,
      event.ownerMembershipId,
      ...event.participants.map((participant) => participant.membershipId),
    ].filter(unique);
    await Promise.all(
      targets.map((membershipId) =>
        this.realtime.publishMember(tenant.workspaceId, membershipId, {
          eventType,
          entityType: 'CALENDAR',
          entityId: event.id,
          actorMembershipId: tenant.workspaceMembershipId,
          payload,
        }),
      ),
    );
  }
}

const customEventInclude = {
  participants: {
    select: { membershipId: true, participantRole: true },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.CalendarEventInclude;

type CalendarEventWithParticipants = CalendarEvent & {
  participants: Array<{ membershipId: string; participantRole: string }>;
};

interface CalendarWindow {
  from: Date;
  to: Date;
  timezone: string;
}

interface NormalizedCalendarEventInput {
  title: string;
  description: string | null;
  startAt: Date;
  endAt: Date | null;
  allDay: boolean;
  timezone: string | null;
  visibility: CalendarEventVisibility;
  ownerMembershipId: string;
  participantMembershipIds: string[];
}

function hasPermission(tenant: WorkspaceTenantContext, permission: string) {
  return tenant.permissions.includes('*') || tenant.permissions.includes(permission);
}

function datedSourceWhere(window: CalendarWindow) {
  return [
    { plannedStartAt: { gte: window.from, lte: window.to } },
    { dueAt: { gte: window.from, lte: window.to } },
    { plannedStartAt: { lte: window.to }, dueAt: { gte: window.from } },
  ];
}

function unique<T>(value: T, index: number, array: T[]) {
  return Boolean(value) && array.indexOf(value) === index;
}

function hasDuplicate(values: string[]) {
  return new Set(values).size !== values.length;
}

function sameStringSets(left: string[], right: string[]) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === rightSet.size && [...leftSet].every((value) => rightSet.has(value));
}

function isNoopUpdate(
  existing: CalendarEventWithParticipants,
  input: NormalizedCalendarEventInput,
) {
  const existingParticipantIds = existing.participants.map(
    (participant) => participant.membershipId,
  );
  return (
    existing.title === input.title &&
    (existing.description ?? null) === (input.description ?? null) &&
    existing.startAt.getTime() === input.startAt.getTime() &&
    (existing.endAt?.getTime() ?? null) === (input.endAt?.getTime() ?? null) &&
    existing.allDay === input.allDay &&
    (existing.timezone ?? null) === (input.timezone ?? null) &&
    existing.visibility === input.visibility &&
    existing.ownerMembershipId === input.ownerMembershipId &&
    sameStringSets(existingParticipantIds, input.participantMembershipIds)
  );
}

function auditMetadata(event: CalendarEventWithParticipants): Prisma.InputJsonObject {
  return {
    visibility: event.visibility,
    allDay: event.allDay,
    participantCount: event.participants.length,
    ownerMembershipId: event.ownerMembershipId,
  };
}
