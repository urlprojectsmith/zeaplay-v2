import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import {
  AssetStatus,
  AttachmentType,
  DepartmentStatus,
  GamificationPointWorkType,
  GamificationWorkXpEventOutcome,
  GamificationWorkXpEventType,
  MembershipStatus,
  Prisma,
  ProcessingJobStatus,
  StatusEntityType,
  TicketSavedViewScope,
  TicketConversationEntryType,
  TicketEscalationLevel,
  TaskPriority,
} from '@prisma/client';
import type { Queue } from 'bullmq';
import { DateTime } from 'luxon';
import { randomUUID } from 'node:crypto';
import { validateEnvironment } from '@zea-play/config';
import type { WorkspaceTenantContext } from '../../common/auth/auth.types';
import { PermissionKeys } from '../../common/authorization/permissions';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  ASSET_PROCESSING_JOB_TYPE,
  ASSET_PROCESSING_QUEUE,
} from '../../infrastructure/queue/queue.constants';
import type { StorageAdapter } from '../../infrastructure/storage/storage-adapter';
import { STORAGE_ADAPTER } from '../../infrastructure/storage/storage.tokens';
import { AuditService } from '../audit/audit.service';
import { UploadCompleteDto } from '../assets/dto/upload-complete.dto';
import { UploadInitDto } from '../assets/dto/upload-init.dto';
import { GamificationService } from '../gamification/gamification.service';
import { CreateTicketDto, TicketRequesterDto } from './dto/create-ticket.dto';
import {
  CreateTicketUrlAttachmentDto,
  TicketActivityQueryDto,
  TicketAttachmentIdsDto,
  TicketAttachmentQueryDto,
} from './dto/ticket-attachments.dto';
import {
  CreateTicketConversationEntryDto,
  TicketConversationQueryDto,
} from './dto/ticket-conversation.dto';
import { TicketReportQueryDto } from './dto/ticket-reports.dto';
import { TicketSlaService } from './ticket-sla.service';
import {
  assignmentStates,
  requesterTypeFilters,
  slaMetrics,
  slaStates,
  TicketBuiltInQueue,
  ticketBuiltInQueues,
  TicketQueryDto,
} from './dto/ticket-query.dto';
import { TicketSavedViewDto, UpdateTicketSavedViewDto } from './dto/ticket-saved-view.dto';
import {
  TicketEscalationAction,
  UpdateTicketAssignmentDto,
  UpdateTicketDto,
  UpdateTicketEscalationDto,
} from './dto/update-ticket.dto';

type TicketListRecord = Prisma.TicketGetPayload<{ select: typeof ticketListSelect }>;
type TicketDetailRecord = Prisma.TicketGetPayload<{ select: typeof ticketDetailSelect }>;
type TicketConversationRecord = Prisma.TicketConversationEntryGetPayload<{
  select: typeof ticketConversationEntrySelect;
}>;
type TicketAttachmentRecord = Prisma.TicketAttachmentGetPayload<{
  select: typeof ticketAttachmentSelect;
}>;
type TicketConversationAttachmentRecord = Prisma.TicketConversationAttachmentGetPayload<{
  select: typeof ticketConversationAttachmentSelect;
}>;
type AttachmentAssetRecord = Prisma.AssetGetPayload<{ select: typeof attachmentAssetSelect }>;
type AttachmentCoreRecord = Prisma.AttachmentGetPayload<{ select: typeof attachmentCoreSelect }>;
type TicketActivityRecord = Prisma.AuditLogGetPayload<{ select: typeof ticketActivitySelect }>;
type TicketSavedViewRecord = Prisma.TicketSavedViewGetPayload<{
  select: typeof ticketSavedViewSelect;
}>;
type ActorScope = { membershipId: string | null; departmentId: string | null };
type NormalizedRequester =
  | {
      type: 'INTERNAL';
      internalMembershipId: string;
      externalName: null;
      externalEmail: null;
      externalPhone: null;
    }
  | {
      type: 'EXTERNAL';
      internalMembershipId: null;
      externalName: string;
      externalEmail: string | null;
      externalPhone: string | null;
    };

const ASSET_JOB_VERSION = 1;
const TICKET_ATTACHMENT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const TICKET_REPORT_EXPORT_MAX_ROWS = 10_000;
const HIDDEN_INTERNAL_NOTE_ACTIONS = ['ticket.internal_note_added'];
const ATTACHMENT_ACTIVITY_ACTIONS = [
  'ticket.attachment_file_uploaded',
  'ticket.attachment_url_added',
  'ticket.attachments_linked',
  'ticket.attachment_download_authorized',
  'ticket.conversation_attachment_download_authorized',
  'ticket.attachment_removed',
];
const TICKET_ACTIVITY_ACTIONS = [
  'ticket.created',
  'ticket.updated',
  'ticket.deleted',
  'ticket.status_changed',
  'ticket.requester_changed',
  'ticket.assignment_changed',
  'ticket.claimed',
  'ticket.escalation_changed',
  'ticket.public_reply_added',
  'ticket.internal_note_added',
  'ticket.sla.first_response.met',
  'ticket.sla.first_response.breached',
  'ticket.sla.resolution.met',
  'ticket.sla.resolution.breached',
  ...ATTACHMENT_ACTIVITY_ACTIONS,
] as const;
const missingStorageAdapter = {
  upload(): Promise<void> {
    return Promise.reject(new ServiceUnavailableException('Storage adapter is not configured.'));
  },
  delete(): Promise<void> {
    return Promise.reject(new ServiceUnavailableException('Storage adapter is not configured.'));
  },
  createPresignedUploadUrl(): Promise<string> {
    return Promise.reject(new ServiceUnavailableException('Storage adapter is not configured.'));
  },
  createPresignedDownloadUrl(): Promise<string> {
    return Promise.reject(new ServiceUnavailableException('Storage adapter is not configured.'));
  },
  getMetadata(): Promise<never> {
    return Promise.reject(new ServiceUnavailableException('Storage adapter is not configured.'));
  },
  getObject(): Promise<never> {
    return Promise.reject(new ServiceUnavailableException('Storage adapter is not configured.'));
  },
  isHealthy(): Promise<boolean> {
    return Promise.resolve(false);
  },
} satisfies StorageAdapter;
const missingQueue = {
  add() {
    return Promise.reject(
      new ServiceUnavailableException('Asset processing queue is not configured.'),
    );
  },
} as unknown as Queue;
const missingGamificationService = {
  evaluateTicketResolutionAchievements: () => Promise.resolve(undefined),
  handleTicketCreationXp: () => Promise.resolve(undefined),
  handleTicketCompletionXp: () => Promise.resolve(undefined),
  handleWorkCreationVoid: () => Promise.resolve(undefined),
  handleWorkReopen: () => Promise.resolve(undefined),
} as Pick<
  GamificationService,
  | 'evaluateTicketResolutionAchievements'
  | 'handleTicketCreationXp'
  | 'handleTicketCompletionXp'
  | 'handleWorkCreationVoid'
  | 'handleWorkReopen'
> as GamificationService;

@Injectable()
export class TicketsService {
  private readonly env = validateEnvironment(process.env);
  private readonly allowedMimeTypes = new Set(
    this.env.ALLOWED_MIME_TYPES.split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ticketSla: TicketSlaService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter = missingStorageAdapter,
    @InjectQueue(ASSET_PROCESSING_QUEUE) private readonly queue: Queue = missingQueue,
    @Optional() private readonly gamification: GamificationService = missingGamificationService,
  ) {}

  async create(tenant: WorkspaceTenantContext, dto: CreateTicketDto) {
    const subject = normalizeSubject(dto.subject);
    const description = normalizeDescription(dto.description);
    const status = await this.ticketStatus(tenant.workspaceId, dto.statusDefinitionId);
    const priority = dto.priority ?? TaskPriority.MEDIUM;
    const requester = await this.validRequester(tenant.workspaceId, dto.requester);
    const hasAssignmentInput =
      dto.departmentId !== undefined || dto.assignedToMembershipId !== undefined;
    if (hasAssignmentInput && !hasPermission(tenant, PermissionKeys.ticketsAssign)) {
      throw new ForbiddenException('TICKET_ASSIGN_PERMISSION_REQUIRED');
    }
    const assignment = hasAssignmentInput
      ? await this.validAssignment(tenant.workspaceId, null, {
          departmentId: dto.departmentId ?? null,
          assignedToMembershipId: dto.assignedToMembershipId ?? null,
        })
      : { departmentId: null, assignedToMembershipId: null };

    const ticket = await this.prisma.$transaction(async (tx) => {
      const sequenceNumber = await allocateTicketNumber(tx, tenant.workspaceId);
      const created = await tx.ticket.create({
        data: {
          workspaceId: tenant.workspaceId,
          sequenceNumber,
          ticketNumber: formatTicketNumber(sequenceNumber),
          subject,
          description,
          statusDefinitionId: status.id,
          priority,
          departmentId: assignment.departmentId,
          assignedToMembershipId: assignment.assignedToMembershipId,
          createdByMembershipId: tenant.workspaceMembershipId,
        },
        select: {
          id: true,
          workspaceId: true,
          priority: true,
          statusDefinitionId: true,
          createdAt: true,
        },
      });
      await tx.ticketRequester.create({
        data: { workspaceId: tenant.workspaceId, ticketId: created.id, ...requester },
      });
      await this.ticketSla.initializeForTicket(tx, created);
      return tx.ticket.findUniqueOrThrow({
        where: { id_workspaceId: { id: created.id, workspaceId: tenant.workspaceId } },
        select: ticketDetailSelect,
      });
    });

    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'ticket.created',
      entityType: 'Ticket',
      entityId: ticket.id,
      metadata: {
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        statusDefinitionId: ticket.statusDefinitionId,
        priority: ticket.priority,
        requesterType: requester.type,
        departmentId: assignment.departmentId,
        assignedToMembershipId: assignment.assignedToMembershipId,
      },
    });
    await this.gamification.handleTicketCreationXp(
      tenant.workspaceId,
      ticket.id,
      tenant.workspaceMembershipId ?? null,
    );
    return serializeTicket(ticket);
  }

  async list(tenant: WorkspaceTenantContext, query: TicketQueryDto) {
    const where = await this.ticketWhere(tenant, query);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.ticket.findMany({
        where,
        select: ticketListSelect,
        orderBy: ticketOrderBy(query.sortBy, query.sortDirection),
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.ticket.count({ where }),
    ]);
    return {
      items: items.map(serializeTicket),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async queueSummary(tenant: WorkspaceTenantContext) {
    const visibility = await this.visibilityWhere(tenant);
    const base: Prisma.TicketWhereInput = {
      workspaceId: tenant.workspaceId,
      deletedAt: null,
      AND: [visibility],
    };
    const actor = await this.actorScope(tenant);
    const queues = ticketBuiltInQueues;
    const counts = await this.prisma.$transaction(
      queues.map((queue) =>
        this.prisma.ticket.count({
          where: composeTicketWhere(base, this.queueWhere(queue, actor)),
        }),
      ),
    );
    return Object.fromEntries(queues.map((queue, index) => [queue, counts[index]]));
  }

  async reports(tenant: WorkspaceTenantContext, query: TicketReportQueryDto) {
    this.assertPermission(tenant, PermissionKeys.ticketsView);
    this.assertPermission(tenant, PermissionKeys.ticketsReportsView);
    const timezone = await this.workspaceTimezone(tenant.workspaceId);
    const where = await this.ticketWhere(tenant, query);
    const trendRange = dateRange(query.trendFrom, query.trendTo, timezone);
    const trendWhere = trendRange ? composeTicketWhere(where, { createdAt: trendRange }) : where;
    const [
      totalTickets,
      openTickets,
      terminalTickets,
      unassignedTickets,
      escalatedTickets,
      slaBreachedTickets,
      slaNotConfiguredTickets,
      statusGroups,
      priorityGroups,
      departmentGroups,
      assigneeGroups,
      requesterGroups,
      escalationGroups,
      firstResponseCounts,
      resolutionCounts,
      createdTrendRows,
      resolutionTrendRows,
    ] = await Promise.all([
      this.prisma.ticket.count({ where }),
      this.prisma.ticket.count({
        where: composeTicketWhere(where, { statusDefinition: { isTerminal: false } }),
      }),
      this.prisma.ticket.count({
        where: composeTicketWhere(where, { statusDefinition: { isTerminal: true } }),
      }),
      this.prisma.ticket.count({
        where: composeTicketWhere(where, { assignedToMembershipId: null }),
      }),
      this.prisma.ticket.count({
        where: composeTicketWhere(where, { escalationLevel: { not: TicketEscalationLevel.NONE } }),
      }),
      this.prisma.ticket.count({
        where: composeTicketWhere(where, this.slaWhere('ANY', 'BREACHED')),
      }),
      this.prisma.ticket.count({ where: composeTicketWhere(where, { slaState: null }) }),
      this.prisma.ticket.groupBy({
        by: ['statusDefinitionId'],
        where,
        _count: { _all: true },
      }),
      this.prisma.ticket.groupBy({ by: ['priority'], where, _count: { _all: true } }),
      this.prisma.ticket.groupBy({ by: ['departmentId'], where, _count: { _all: true } }),
      this.prisma.ticket.groupBy({
        by: ['assignedToMembershipId'],
        where,
        _count: { _all: true },
        orderBy: { _count: { assignedToMembershipId: 'desc' } },
        take: 50,
      }),
      this.prisma.ticketRequester.groupBy({
        by: ['type'],
        where: { workspaceId: tenant.workspaceId, ticket: where },
        _count: { _all: true },
      }),
      this.prisma.ticket.groupBy({ by: ['escalationLevel'], where, _count: { _all: true } }),
      this.slaSummaryCounts(where, 'FIRST_RESPONSE'),
      this.slaSummaryCounts(where, 'RESOLUTION'),
      this.prisma.ticket.findMany({
        where: trendWhere,
        select: { createdAt: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: TICKET_REPORT_EXPORT_MAX_ROWS,
      }),
      this.resolutionTrendRows(tenant.workspaceId, where, trendRange),
    ]);
    const [statuses, departments, assignees] = await Promise.all([
      this.prisma.statusDefinition.findMany({
        where: {
          id: { in: statusGroups.map((group) => group.statusDefinitionId) },
          workspaceId: tenant.workspaceId,
          entityType: StatusEntityType.TICKET,
        },
        select: { id: true, name: true, color: true, isTerminal: true },
      }),
      this.prisma.department.findMany({
        where: {
          id: {
            in: departmentGroups
              .map((group) => group.departmentId)
              .filter((id): id is string => Boolean(id)),
          },
          workspaceId: tenant.workspaceId,
        },
        select: { id: true, name: true },
      }),
      this.prisma.workspaceMembership.findMany({
        where: {
          id: {
            in: assigneeGroups
              .map((group) => group.assignedToMembershipId)
              .filter((id): id is string => Boolean(id)),
          },
          workspaceId: tenant.workspaceId,
        },
        select: {
          id: true,
          status: true,
          user: { select: { name: true, email: true } },
        },
      }),
    ]);
    const statusById = new Map(statuses.map((status) => [status.id, status]));
    const departmentById = new Map(departments.map((department) => [department.id, department]));
    const assigneeById = new Map(assignees.map((assignee) => [assignee.id, assignee]));
    const requesterSet = new Map(requesterGroups.map((group) => [group.type, group._count._all]));
    const requesterLinkedTotal = requesterGroups.reduce((sum, group) => sum + group._count._all, 0);
    return {
      timezone,
      filters: safeTicketReportFilters(query),
      kpis: {
        totalTickets,
        openTickets,
        terminalTickets,
        unassignedTickets,
        escalatedTickets,
        slaBreachedTickets,
        slaNotConfiguredTickets,
      },
      distributions: {
        status: statusGroups.map((group) => {
          const status = statusById.get(group.statusDefinitionId);
          return {
            statusDefinitionId: group.statusDefinitionId,
            name: status?.name ?? 'Unknown',
            color: status?.color ?? '#64748B',
            isTerminal: status?.isTerminal ?? false,
            count: group._count._all,
          };
        }),
        priority: Object.values(TaskPriority).map((priority) => ({
          priority,
          count: priorityGroups.find((group) => group.priority === priority)?._count._all ?? 0,
        })),
        requesterType: [
          { type: 'INTERNAL', count: requesterSet.get('INTERNAL') ?? 0 },
          { type: 'EXTERNAL', count: requesterSet.get('EXTERNAL') ?? 0 },
          { type: 'UNSET', count: Math.max(totalTickets - requesterLinkedTotal, 0) },
        ],
        escalation: Object.values(TicketEscalationLevel).map((level) => ({
          level,
          count:
            escalationGroups.find((group) => group.escalationLevel === level)?._count._all ?? 0,
        })),
        departments: departmentGroups.map((group) => ({
          departmentId: group.departmentId,
          name: group.departmentId
            ? (departmentById.get(group.departmentId)?.name ?? 'Unknown')
            : 'No Department',
          ticketCount: group._count._all,
        })),
        assignees: assigneeGroups.map((group) => {
          const assignee = group.assignedToMembershipId
            ? assigneeById.get(group.assignedToMembershipId)
            : null;
          return {
            membershipId: group.assignedToMembershipId,
            displayName: assignee ? assignee.user.name || assignee.user.email : 'Unassigned',
            inactive: assignee ? assignee.status !== MembershipStatus.ACTIVE : false,
            ticketCount: group._count._all,
          };
        }),
      },
      trends: {
        created: bucketDates(
          createdTrendRows.map((row) => row.createdAt),
          timezone,
          query.bucket,
        ),
        firstTerminalResolution: bucketDates(
          resolutionTrendRows.map((row) => row.createdAt),
          timezone,
          query.bucket,
        ),
      },
      sla: {
        firstResponse: slaSummary(firstResponseCounts),
        resolution: slaSummary(resolutionCounts),
      },
      semantics: {
        population:
          'Reports reuse the current authorized Ticket list filters and visibility at request time.',
        resolutionTrend:
          'First Terminal Resolution counts the first reliable ticket.status_changed AuditLog transition into a terminal Ticket status for Tickets in the current report population.',
        sla: 'SLA metrics use authoritative TicketSlaState outcomes; running, paused, not applicable, and not configured are excluded from compliance denominator.',
      },
    };
  }

  async reportsCsv(tenant: WorkspaceTenantContext, query: TicketReportQueryDto) {
    this.assertPermission(tenant, PermissionKeys.ticketsView);
    this.assertPermission(tenant, PermissionKeys.ticketsReportsExport);
    const where = await this.ticketWhere(tenant, query);
    const total = await this.prisma.ticket.count({ where });
    if (total > TICKET_REPORT_EXPORT_MAX_ROWS) throw ticketExportTooLarge();
    const tickets = await this.prisma.ticket.findMany({
      where,
      select: ticketReportCsvSelect,
      orderBy: [{ createdAt: 'desc' }, { sequenceNumber: 'desc' }, { id: 'desc' }],
      take: TICKET_REPORT_EXPORT_MAX_ROWS,
    });
    return {
      filename: `ticket-report-${DateTime.utc().toISODate()}.csv`,
      contentType: 'text/csv; charset=utf-8',
      csv: toTicketCsv([
        [
          'Ticket ID',
          'Ticket Number',
          'Subject',
          'Status',
          'Priority',
          'Requester Type',
          'Requester Name',
          'Department',
          'Assigned To',
          'Escalation Level',
          'Created At',
          'Updated At',
          'First Response SLA State',
          'First Response Due At',
          'First Response Completed At',
          'First Response Breached At',
          'Resolution SLA State',
          'Resolution Due At',
          'Resolution Completed At',
          'Resolution Breached At',
        ],
        ...tickets.map((ticket) => [
          ticket.id,
          ticket.ticketNumber,
          ticket.subject,
          ticket.statusDefinition.name,
          ticket.priority,
          ticket.requester?.type ?? 'UNSET',
          ticket.requester
            ? ticket.requester.type === 'INTERNAL'
              ? ticket.requester.internalMembership?.user.name ||
                ticket.requester.internalMembership?.user.email ||
                ''
              : ticket.requester.externalName || ''
            : '',
          ticket.department?.name ?? '',
          ticket.assignedToMembership
            ? ticket.assignedToMembership.user.name || ticket.assignedToMembership.user.email
            : '',
          ticket.escalationLevel,
          ticket.createdAt.toISOString(),
          ticket.updatedAt.toISOString(),
          ticket.slaState
            ? metricStateFromColumns({
                notApplicableAt: ticket.slaState.firstResponseNotApplicableAt,
                completedAt: ticket.slaState.firstResponseCompletedAt,
                breachedAt: ticket.slaState.firstResponseBreachedAt,
                pausedAt: ticket.slaState.firstResponsePausedAt,
              })
            : 'NOT_CONFIGURED',
          ticket.slaState?.firstResponseDueAt?.toISOString() ?? '',
          ticket.slaState?.firstResponseCompletedAt?.toISOString() ?? '',
          ticket.slaState?.firstResponseBreachedAt?.toISOString() ?? '',
          ticket.slaState
            ? metricStateFromColumns({
                completedAt: ticket.slaState.resolutionCompletedAt,
                breachedAt: ticket.slaState.resolutionBreachedAt,
                pausedAt: ticket.slaState.resolutionPausedAt,
              })
            : 'NOT_CONFIGURED',
          ticket.slaState?.resolutionDueAt?.toISOString() ?? '',
          ticket.slaState?.resolutionCompletedAt?.toISOString() ?? '',
          ticket.slaState?.resolutionBreachedAt?.toISOString() ?? '',
        ]),
      ]),
    };
  }

  async listSavedViews(tenant: WorkspaceTenantContext) {
    const actorMembershipId = tenant.workspaceMembershipId ?? null;
    const views = await this.prisma.ticketSavedView.findMany({
      where: {
        workspaceId: tenant.workspaceId,
        OR: [
          { scope: TicketSavedViewScope.WORKSPACE },
          ...(actorMembershipId
            ? [{ scope: TicketSavedViewScope.PERSONAL, ownerMembershipId: actorMembershipId }]
            : []),
        ],
      },
      select: ticketSavedViewSelect,
      orderBy: [{ scope: 'asc' }, { nameNormalized: 'asc' }, { id: 'asc' }],
      take: 100,
    });
    return views.map(serializeSavedView);
  }

  async createSavedView(tenant: WorkspaceTenantContext, dto: TicketSavedViewDto) {
    const name = normalizeSavedViewName(dto.name);
    const scope = dto.scope;
    const ownerMembershipId =
      scope === TicketSavedViewScope.PERSONAL ? this.requireWorkspaceMembership(tenant) : null;
    this.assertSavedViewPermission(tenant, scope);
    await this.ensureMembershipInWorkspace(tenant.workspaceId, tenant.workspaceMembershipId);
    const config = await this.normalizeSavedViewConfig(tenant.workspaceId, dto.filters, dto.sort);
    await this.ensureSavedViewNameAvailable(
      tenant.workspaceId,
      scope,
      normalizeName(name),
      ownerMembershipId,
    );
    try {
      const view = await this.prisma.ticketSavedView.create({
        data: {
          workspaceId: tenant.workspaceId,
          name,
          nameNormalized: normalizeName(name),
          scope,
          ownerMembershipId,
          filterSchemaVersion: 1,
          filters: config.filters as Prisma.InputJsonValue,
          sort: config.sort as Prisma.InputJsonValue,
          createdByMembershipId: tenant.workspaceMembershipId,
          updatedByMembershipId: tenant.workspaceMembershipId,
        },
        select: ticketSavedViewSelect,
      });
      await this.audit.record({
        agencyId: tenant.agencyId,
        workspaceId: tenant.workspaceId,
        userId: tenant.userId,
        action: 'ticket.saved_view_created',
        entityType: 'TicketSavedView',
        entityId: view.id,
        metadata: { savedViewId: view.id, scope: view.scope },
      });
      return serializeSavedView(view);
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new ConflictException('TICKET_VIEW_NAME_EXISTS');
      throw error;
    }
  }

  async updateSavedView(
    tenant: WorkspaceTenantContext,
    viewId: string,
    dto: UpdateTicketSavedViewDto,
  ) {
    const existing = await this.readSavedViewForMutation(tenant, viewId);
    const data: Prisma.TicketSavedViewUpdateInput = {};
    const changed: string[] = [];
    const nextName = dto.name !== undefined ? normalizeSavedViewName(dto.name) : existing.name;
    if (nextName !== existing.name) {
      await this.ensureSavedViewNameAvailable(
        tenant.workspaceId,
        existing.scope,
        normalizeName(nextName),
        existing.ownerMembershipId,
        existing.id,
      );
      data.name = nextName;
      data.nameNormalized = normalizeName(nextName);
      changed.push('name');
    }
    if (dto.filters !== undefined || dto.sort !== undefined) {
      const config = await this.normalizeSavedViewConfig(
        tenant.workspaceId,
        dto.filters ?? asRecord(existing.filters),
        dto.sort ?? asRecord(existing.sort),
      );
      if (JSON.stringify(config.filters) !== JSON.stringify(existing.filters)) {
        data.filters = config.filters as Prisma.InputJsonValue;
        changed.push('filters');
      }
      if (JSON.stringify(config.sort) !== JSON.stringify(existing.sort)) {
        data.sort = config.sort as Prisma.InputJsonValue;
        changed.push('sort');
      }
    }
    if (changed.length === 0) return serializeSavedView(existing);
    data.updatedByMembership = tenant.workspaceMembershipId
      ? {
          connect: {
            id_workspaceId: { id: tenant.workspaceMembershipId, workspaceId: tenant.workspaceId },
          },
        }
      : { disconnect: true };
    try {
      const view = await this.prisma.ticketSavedView.update({
        where: { id_workspaceId: { id: existing.id, workspaceId: tenant.workspaceId } },
        data,
        select: ticketSavedViewSelect,
      });
      await this.audit.record({
        agencyId: tenant.agencyId,
        workspaceId: tenant.workspaceId,
        userId: tenant.userId,
        action: 'ticket.saved_view_updated',
        entityType: 'TicketSavedView',
        entityId: view.id,
        metadata: { savedViewId: view.id, scope: view.scope, changed },
      });
      return serializeSavedView(view);
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new ConflictException('TICKET_VIEW_NAME_EXISTS');
      throw error;
    }
  }

  async deleteSavedView(tenant: WorkspaceTenantContext, viewId: string) {
    const existing = await this.readSavedViewForMutation(tenant, viewId);
    await this.prisma.ticketSavedView.delete({
      where: { id_workspaceId: { id: existing.id, workspaceId: tenant.workspaceId } },
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'ticket.saved_view_deleted',
      entityType: 'TicketSavedView',
      entityId: existing.id,
      metadata: { savedViewId: existing.id, scope: existing.scope },
    });
    return { id: existing.id, deleted: true };
  }

  async get(tenant: WorkspaceTenantContext, id: string) {
    return serializeTicket(await this.readTicket(tenant, id));
  }

  async update(tenant: WorkspaceTenantContext, id: string, dto: UpdateTicketDto) {
    const existing = await this.readTicket(tenant, id);
    const data: Prisma.TicketUncheckedUpdateManyInput = {};
    const changed: string[] = [];
    let statusChanged: { fromStatusDefinitionId: string; toStatusDefinitionId: string } | null =
      null;
    let nextStatus: { id: string; isTerminal: boolean } | null = null;

    if (dto.subject !== undefined) {
      const subject = normalizeSubject(dto.subject);
      if (subject !== existing.subject) {
        data.subject = subject;
        changed.push('subject');
      }
    }
    if (dto.description !== undefined) {
      const description = normalizeDescription(dto.description);
      if (description !== existing.description) {
        data.description = description;
        changed.push('description');
      }
    }
    if (dto.priority !== undefined && dto.priority !== existing.priority) {
      data.priority = dto.priority;
      changed.push('priority');
    }
    if (
      dto.statusDefinitionId !== undefined &&
      dto.statusDefinitionId !== existing.statusDefinitionId
    ) {
      const status = await this.ticketStatus(tenant.workspaceId, dto.statusDefinitionId);
      nextStatus = status;
      data.statusDefinitionId = status.id;
      changed.push('statusDefinitionId');
      statusChanged = {
        fromStatusDefinitionId: existing.statusDefinitionId,
        toStatusDefinitionId: status.id,
      };
    }
    const reopensTicket =
      Boolean(nextStatus) && existing.statusDefinition.isTerminal && !nextStatus!.isTerminal;
    const reopensAwardedCompletion =
      reopensTicket &&
      (await this.hasActiveCompletionXpAward(
        tenant.workspaceId,
        GamificationPointWorkType.TICKET,
        id,
      ));
    if (reopensAwardedCompletion) {
      data.gamificationResolutionTargetAt = requireFutureReopenTarget(
        parseOptionalDate(dto.gamificationResolutionTargetAt),
        'TICKET_REOPEN_REQUIRES_NEW_FUTURE_GAMIFICATION_TARGET',
      );
      changed.push('gamificationResolutionTargetAt');
    } else if (dto.gamificationResolutionTargetAt !== undefined) {
      throw new BadRequestException('TICKET_GAMIFICATION_TARGET_REOPEN_ONLY');
    }
    if (changed.length === 0) return serializeTicket(existing);

    let slaEvents: Array<{ metric: 'FIRST_RESPONSE' | 'RESOLUTION'; action: string }> = [];
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.ticket.updateMany({
        where: { id, workspaceId: tenant.workspaceId, deletedAt: null },
        data,
      });
      if (result.count !== 1) throw new NotFoundException('TICKET_NOT_FOUND');
      if (statusChanged) {
        slaEvents = await this.ticketSla.handleStatusChange(
          tx,
          id,
          tenant.workspaceId,
          statusChanged.toStatusDefinitionId,
          new Date(),
        );
      }
      return tx.ticket.findUniqueOrThrow({
        where: { id_workspaceId: { id, workspaceId: tenant.workspaceId } },
        select: ticketDetailSelect,
      });
    });

    if (statusChanged) {
      const terminalResolution = updated.statusDefinition.isTerminal;
      await this.audit.record({
        agencyId: tenant.agencyId,
        workspaceId: tenant.workspaceId,
        userId: tenant.userId,
        action: 'ticket.status_changed',
        entityType: 'Ticket',
        entityId: id,
        metadata: {
          ticketId: id,
          ...statusChanged,
          ...(terminalResolution ? { assignedToMembershipId: updated.assignedToMembershipId } : {}),
        },
      });
      if (terminalResolution) {
        await this.gamification.evaluateTicketResolutionAchievements(
          tenant.workspaceId,
          id,
          updated.assignedToMembershipId,
        );
        await this.gamification.handleTicketCompletionXp(
          tenant.workspaceId,
          id,
          updated.assignedToMembershipId,
          tenant.workspaceMembershipId ?? null,
        );
      } else if (reopensAwardedCompletion) {
        await this.gamification.handleWorkReopen(
          tenant.workspaceId,
          GamificationPointWorkType.TICKET,
          id,
          tenant.workspaceMembershipId ?? null,
        );
      }
    }
    const nonStatusChanged = changed.filter((field) => field !== 'statusDefinitionId');
    if (nonStatusChanged.length > 0) {
      await this.audit.record({
        agencyId: tenant.agencyId,
        workspaceId: tenant.workspaceId,
        userId: tenant.userId,
        action: 'ticket.updated',
        entityType: 'Ticket',
        entityId: id,
        metadata: { ticketId: id, changed: nonStatusChanged },
      });
    }
    for (const event of slaEvents) {
      await this.audit.record({
        agencyId: tenant.agencyId,
        workspaceId: tenant.workspaceId,
        userId: tenant.userId,
        action: `ticket.sla.${event.metric.toLowerCase()}.${event.action}`,
        entityType: 'Ticket',
        entityId: id,
        metadata: { ticketId: id, metric: event.metric },
      });
    }
    return serializeTicket(updated);
  }

  async updateStatus(
    tenant: WorkspaceTenantContext,
    id: string,
    statusDefinitionId: string,
    gamificationResolutionTargetAt?: string | null,
  ) {
    return this.update(tenant, id, { statusDefinitionId, gamificationResolutionTargetAt });
  }

  async updateRequester(tenant: WorkspaceTenantContext, id: string, dto: TicketRequesterDto) {
    const existing = await this.readTicket(tenant, id);
    const requester = await this.validRequester(tenant.workspaceId, dto);
    if (sameRequester(existing.requester, requester)) return serializeTicket(existing);

    const updated = await this.prisma.$transaction(async (tx) => {
      const requesterAtCommit = await this.validRequester(tenant.workspaceId, dto, tx);
      const current = await tx.ticket.findFirst({
        where: { id, workspaceId: tenant.workspaceId, deletedAt: null },
        select: { id: true, requester: { select: ticketRequesterSelect } },
      });
      if (!current) throw new NotFoundException('TICKET_NOT_FOUND');
      await tx.ticketRequester.upsert({
        where: { ticketId: id },
        create: { workspaceId: tenant.workspaceId, ticketId: id, ...requesterAtCommit },
        update: requesterAtCommit,
      });
      return tx.ticket.findUniqueOrThrow({
        where: { id_workspaceId: { id, workspaceId: tenant.workspaceId } },
        select: ticketDetailSelect,
      });
    });

    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'ticket.requester_changed',
      entityType: 'Ticket',
      entityId: id,
      metadata: {
        ticketId: id,
        fromType: existing.requester?.type ?? null,
        toType: requester.type,
        fromInternalMembershipId: existing.requester?.internalMembershipId ?? null,
        toInternalMembershipId: requester.internalMembershipId,
      },
    });
    return serializeTicket(updated);
  }

  async updateAssignment(
    tenant: WorkspaceTenantContext,
    id: string,
    dto: UpdateTicketAssignmentDto,
  ) {
    const existing = await this.readTicket(tenant, id);
    const assignment = await this.validAssignment(tenant.workspaceId, existing, dto);
    if (
      assignment.departmentId === existing.departmentId &&
      assignment.assignedToMembershipId === existing.assignedToMembershipId
    ) {
      return serializeTicket(existing);
    }

    let committedAssignment = assignment;
    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await tx.ticket.findFirst({
        where: { id, workspaceId: tenant.workspaceId, deletedAt: null },
        select: { departmentId: true, assignedToMembershipId: true, updatedAt: true },
      });
      if (!current) throw new NotFoundException('TICKET_NOT_FOUND');
      const assignmentAtCommit = await this.validAssignment(tenant.workspaceId, current, dto, tx);
      committedAssignment = assignmentAtCommit;
      const result = await tx.ticket.updateMany({
        where: {
          id,
          workspaceId: tenant.workspaceId,
          deletedAt: null,
          updatedAt: current.updatedAt,
        },
        data: assignmentAtCommit,
      });
      if (result.count !== 1) throw new ConflictException('TICKET_ASSIGNMENT_STALE');
      return tx.ticket.findUniqueOrThrow({
        where: { id_workspaceId: { id, workspaceId: tenant.workspaceId } },
        select: ticketDetailSelect,
      });
    });

    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'ticket.assignment_changed',
      entityType: 'Ticket',
      entityId: id,
      metadata: {
        ticketId: id,
        fromDepartmentId: existing.departmentId,
        toDepartmentId: committedAssignment.departmentId,
        fromAssignedMembershipId: existing.assignedToMembershipId,
        toAssignedMembershipId: committedAssignment.assignedToMembershipId,
      },
    });
    return serializeTicket(updated);
  }

  async claim(tenant: WorkspaceTenantContext, id: string) {
    if (!hasPermission(tenant, PermissionKeys.ticketsClaim)) {
      throw new ForbiddenException('TICKET_CLAIM_PERMISSION_REQUIRED');
    }
    const existing = await this.readTicket(tenant, id);
    if (!existing.departmentId) throw new BadRequestException('TICKET_CLAIM_DEPARTMENT_REQUIRED');
    if (existing.assignedToMembershipId) throw new ConflictException('TICKET_ALREADY_ASSIGNED');

    let departmentId = existing.departmentId;
    const updated = await this.prisma.$transaction(async (tx) => {
      const actor = await this.actorScope(tenant, tx);
      if (!actor.membershipId || !actor.departmentId) {
        throw new ForbiddenException('TICKET_CLAIM_ACTIVE_DEPARTMENT_REQUIRED');
      }
      departmentId = actor.departmentId;
      const result = await tx.ticket.updateMany({
        where: {
          id,
          workspaceId: tenant.workspaceId,
          deletedAt: null,
          updatedAt: existing.updatedAt,
          departmentId: actor.departmentId,
          assignedToMembershipId: null,
        },
        data: { assignedToMembershipId: actor.membershipId },
      });
      if (result.count !== 1) throw new ConflictException('TICKET_CLAIM_STALE');
      return tx.ticket.findUniqueOrThrow({
        where: { id_workspaceId: { id, workspaceId: tenant.workspaceId } },
        select: ticketDetailSelect,
      });
    });

    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'ticket.claimed',
      entityType: 'Ticket',
      entityId: id,
      metadata: {
        ticketId: id,
        departmentId,
        claimedByMembershipId: tenant.workspaceMembershipId,
      },
    });
    return serializeTicket(updated);
  }

  async updateEscalation(
    tenant: WorkspaceTenantContext,
    id: string,
    dto: UpdateTicketEscalationDto,
  ) {
    if (!hasPermission(tenant, PermissionKeys.ticketsEscalate)) {
      throw new ForbiddenException('TICKET_ESCALATE_PERMISSION_REQUIRED');
    }
    const reason = normalizeEscalationReason(dto.reason);
    const existing = await this.readTicket(tenant, id);
    const nextLevel = nextEscalationLevel(existing.escalationLevel, dto.action);
    if (!nextLevel) throw new ConflictException('TICKET_ESCALATION_ACTION_UNAVAILABLE');
    if (existing.escalationLevel !== dto.expectedLevel) {
      throw new ConflictException('TICKET_ESCALATION_STALE');
    }

    const changedAt = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.ticket.updateMany({
        where: {
          id,
          workspaceId: tenant.workspaceId,
          deletedAt: null,
          escalationLevel: dto.expectedLevel,
        },
        data: {
          escalationLevel: nextLevel,
          escalationChangedAt: changedAt,
          escalationChangedByMembershipId: tenant.workspaceMembershipId,
          escalationLastReason: reason,
        },
      });
      if (result.count !== 1) throw new ConflictException('TICKET_ESCALATION_STALE');
      return tx.ticket.findUniqueOrThrow({
        where: { id_workspaceId: { id, workspaceId: tenant.workspaceId } },
        select: ticketDetailSelect,
      });
    });

    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'ticket.escalation_changed',
      entityType: 'Ticket',
      entityId: id,
      metadata: {
        ticketId: id,
        action: dto.action,
        fromLevel: existing.escalationLevel,
        toLevel: nextLevel,
        reason,
        changedByMembershipId: tenant.workspaceMembershipId,
      },
    });
    return serializeTicket(updated);
  }

  async delete(tenant: WorkspaceTenantContext, id: string) {
    const existing = await this.readTicket(tenant, id);
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.ticket.updateMany({
        where: { id, workspaceId: tenant.workspaceId, deletedAt: null },
        data: {
          deletedAt: new Date(),
          deletedByMembershipId: tenant.workspaceMembershipId,
        },
      });
      if (result.count !== 1) throw new NotFoundException('TICKET_NOT_FOUND');
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'ticket.deleted',
      entityType: 'Ticket',
      entityId: id,
      metadata: { ticketId: id, ticketNumber: existing.ticketNumber },
    });
    await this.gamification.handleWorkCreationVoid(
      tenant.workspaceId,
      GamificationPointWorkType.TICKET,
      id,
      tenant.workspaceMembershipId ?? null,
    );
    return { id, deleted: true };
  }

  async listConversation(
    tenant: WorkspaceTenantContext,
    ticketId: string,
    query: TicketConversationQueryDto,
  ) {
    await this.readTicket(tenant, ticketId);
    const where = this.conversationWhere(tenant, ticketId);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.ticketConversationEntry.findMany({
        where,
        select: ticketConversationEntrySelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.ticketConversationEntry.count({ where }),
    ]);
    return {
      items: items.reverse().map(serializeConversationEntry),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async createConversationEntry(
    tenant: WorkspaceTenantContext,
    ticketId: string,
    dto: CreateTicketConversationEntryDto,
  ) {
    const body = normalizeConversationBody(dto.body);
    const requiredPermission =
      dto.type === TicketConversationEntryType.PUBLIC_REPLY
        ? PermissionKeys.ticketsReply
        : PermissionKeys.ticketsNotesCreate;
    if (!hasPermission(tenant, requiredPermission)) {
      throw new ForbiddenException('TICKET_CONVERSATION_PERMISSION_REQUIRED');
    }
    const attachmentIds = uniqueIds(dto.attachmentIds ?? []);
    if (attachmentIds.length > 0 && !hasPermission(tenant, PermissionKeys.ticketsAttachmentsAdd)) {
      throw new ForbiddenException('TICKET_ATTACHMENT_PERMISSION_REQUIRED');
    }
    const authorMembershipId = this.requireWorkspaceMembership(tenant);

    let firstResponseSlaBreached: boolean | null = null;
    const created = await this.prisma.$transaction(async (tx) => {
      const visibility = await this.visibilityWhere(tenant, tx);
      const [ticket, author] = await Promise.all([
        tx.ticket.findFirst({
          where: {
            id: ticketId,
            workspaceId: tenant.workspaceId,
            deletedAt: null,
            AND: [visibility],
          },
          select: { id: true },
        }),
        tx.workspaceMembership.findFirst({
          where: {
            id: authorMembershipId,
            workspaceId: tenant.workspaceId,
            status: MembershipStatus.ACTIVE,
          },
          select: { id: true },
        }),
      ]);
      if (!ticket) throw new NotFoundException('TICKET_NOT_FOUND');
      if (!author) throw new ForbiddenException('ACTIVE_WORKSPACE_MEMBERSHIP_REQUIRED');
      if (attachmentIds.length > 0) {
        const attachments = await tx.attachment.findMany({
          where: { id: { in: attachmentIds }, workspaceId: tenant.workspaceId, deletedAt: null },
          select: reusableAttachmentSelect,
        });
        this.assertAttachmentsReusable(attachmentIds, attachments);
      }
      const entry = await tx.ticketConversationEntry.create({
        data: {
          workspaceId: tenant.workspaceId,
          ticketId,
          type: dto.type,
          body,
          authorMembershipId,
          authorUserId: tenant.userId,
        },
        select: ticketConversationEntryBaseSelect,
      });
      if (attachmentIds.length > 0) {
        await tx.ticketConversationAttachment.createMany({
          data: attachmentIds.map((attachmentId) => ({
            workspaceId: tenant.workspaceId,
            conversationEntryId: entry.id,
            attachmentId,
          })),
          skipDuplicates: true,
        });
      }
      await tx.auditLog.create({
        data: {
          agencyId: tenant.agencyId,
          workspaceId: tenant.workspaceId,
          userId: tenant.userId,
          action:
            dto.type === TicketConversationEntryType.PUBLIC_REPLY
              ? 'ticket.public_reply_added'
              : 'ticket.internal_note_added',
          entityType: 'TicketConversationEntry',
          entityId: entry.id,
          metadata: {
            ticketId,
            conversationEntryId: entry.id,
            type: dto.type,
            attachmentCount: attachmentIds.length,
          },
        },
      });
      const slaEvent = await this.ticketSla.handleConversationEntry(
        tx,
        ticketId,
        tenant.workspaceId,
        dto.type,
        authorMembershipId,
        entry.createdAt,
      );
      firstResponseSlaBreached = slaEvent?.breached ?? null;
      return tx.ticketConversationEntry.findUniqueOrThrow({
        where: { id_workspaceId: { id: entry.id, workspaceId: tenant.workspaceId } },
        select: ticketConversationEntrySelect,
      });
    });

    if (firstResponseSlaBreached !== null) {
      await this.audit.record({
        agencyId: tenant.agencyId,
        workspaceId: tenant.workspaceId,
        userId: tenant.userId,
        action: `ticket.sla.first_response.${firstResponseSlaBreached ? 'breached' : 'met'}`,
        entityType: 'Ticket',
        entityId: ticketId,
        metadata: { ticketId, metric: 'FIRST_RESPONSE' },
      });
    }

    return serializeConversationEntry(created);
  }

  async listAttachments(
    tenant: WorkspaceTenantContext,
    ticketId: string,
    query: TicketAttachmentQueryDto,
  ) {
    this.assertPermission(tenant, PermissionKeys.ticketsAttachmentsView);
    await this.readTicket(tenant, ticketId);
    const where: Prisma.TicketAttachmentWhereInput = {
      workspaceId: tenant.workspaceId,
      ticketId,
      removedAt: null,
      attachment: { deletedAt: null },
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.ticketAttachment.findMany({
        where,
        select: ticketAttachmentSelect,
        orderBy: [{ createdAt: 'desc' }, { attachmentId: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.ticketAttachment.count({ where }),
    ]);
    return {
      items: items.map(serializeTicketAttachment),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async initAttachmentUpload(
    tenant: WorkspaceTenantContext,
    ticketId: string,
    dto: UploadInitDto,
    correlationId: string,
  ) {
    this.assertPermission(tenant, PermissionKeys.ticketsAttachmentsAdd);
    await this.readTicket(tenant, ticketId);
    const filename = sanitizeFilename(dto.filename);
    const displayName = sanitizeFilename(dto.displayName ?? filename);
    const mimeType = sanitizeMimeType(dto.mimeType);
    if (!this.allowedMimeTypes.has(mimeType)) {
      throw new UnprocessableEntityException('File type is not allowed.');
    }
    if (dto.sizeBytes > TICKET_ATTACHMENT_MAX_UPLOAD_BYTES) {
      throw new PayloadTooLargeException('File is too large.');
    }

    const assetId = randomUUID();
    const extension = extractExtension(filename);
    const storageKey = buildWorkspaceAssetStorageKey(tenant.workspaceId, assetId, extension);
    const uploadExpiresAt = new Date(Date.now() + this.env.UPLOAD_URL_TTL_SECONDS * 1000);
    const sizeBytes = BigInt(dto.sizeBytes);
    const created = await this.prisma.$transaction(async (tx) => {
      const ticket = await tx.ticket.findFirst({
        where: { id: ticketId, workspaceId: tenant.workspaceId, deletedAt: null },
        select: { id: true },
      });
      if (!ticket) throw new NotFoundException('TICKET_NOT_FOUND');
      const workspace = await tx.workspace.findUniqueOrThrow({
        where: { id: tenant.workspaceId },
        select: { storageUsedBytes: true, storageLimitBytes: true },
      });
      if (workspace.storageUsedBytes + sizeBytes > workspace.storageLimitBytes) {
        throw new PayloadTooLargeException('Workspace storage limit would be exceeded.');
      }
      await tx.workspace.update({
        where: { id: tenant.workspaceId },
        data: { storageUsedBytes: { increment: sizeBytes } },
      });
      const asset = await tx.asset.create({
        data: {
          id: assetId,
          workspaceId: tenant.workspaceId,
          projectId: null,
          createdById: tenant.userId,
          originalFilename: filename,
          displayName,
          storageBucket: this.env.MINIO_BUCKET,
          storageKey,
          mimeType,
          extension,
          sizeBytes,
          status: AssetStatus.UPLOADING,
          uploadExpiresAt,
          metadata: { correlationId, ticketId },
        },
        select: attachmentAssetSelect,
      });
      const attachment = await tx.attachment.create({
        data: {
          id: asset.id,
          workspaceId: tenant.workspaceId,
          type: AttachmentType.FILE,
          assetId: asset.id,
          displayName,
          createdById: tenant.userId,
        },
        select: attachmentCoreSelect,
      });
      return { asset, attachment };
    });

    const uploadUrl = await this.storage.createPresignedUploadUrl(
      storageKey,
      this.env.UPLOAD_URL_TTL_SECONDS,
    );
    return {
      attachment: serializePendingFileAttachment(created.attachment, created.asset),
      uploadUrl,
      expiresAt: uploadExpiresAt,
    };
  }

  async completeAttachmentUpload(
    tenant: WorkspaceTenantContext,
    ticketId: string,
    attachmentId: string,
    dto: UploadCompleteDto,
    correlationId: string,
  ) {
    this.assertPermission(tenant, PermissionKeys.ticketsAttachmentsAdd);
    await this.readTicket(tenant, ticketId);
    const attachment = await this.findFileAttachment(tenant.workspaceId, attachmentId);
    const asset = attachment.asset;
    if (!asset) throw new NotFoundException('Attachment not found.');
    if (asset.status === AssetStatus.DELETED) throw new NotFoundException('Attachment not found.');
    const metadata = isRecord(asset.metadata) ? asset.metadata : {};
    if (metadata.ticketId !== ticketId) throw new NotFoundException('Attachment not found.');
    if (asset.status === AssetStatus.UPLOADING) {
      if (!asset.uploadExpiresAt || asset.uploadExpiresAt <= new Date()) {
        throw new GoneException('Upload authorization has expired.');
      }
      const object = await this.storage.getMetadata(asset.storageKey).catch(() => {
        throw new ServiceUnavailableException('Uploaded object is not available for verification.');
      });
      if (object.key !== asset.storageKey) {
        throw new BadRequestException('Uploaded object key mismatch.');
      }
      if (object.size !== dto.sizeBytes || BigInt(object.size) !== asset.sizeBytes) {
        throw new BadRequestException('Uploaded object size does not match the authorized size.');
      }
      await this.prisma.asset.update({
        where: { id_workspaceId: { id: asset.id, workspaceId: tenant.workspaceId } },
        data: {
          status: AssetStatus.PROCESSING,
          metadata: {
            ...withoutUndefined({
              ...(isRecord(asset.metadata) ? asset.metadata : {}),
              etag: object.etag,
              uploadedContentType: object.contentType,
            }),
          },
        },
      });
    } else if (asset.status !== AssetStatus.PROCESSING && asset.status !== AssetStatus.READY) {
      throw new ConflictException('Attachment file is not awaiting upload completion.');
    }

    const link = await this.prisma.$transaction(async (tx) => {
      const ticket = await tx.ticket.findFirst({
        where: { id: ticketId, workspaceId: tenant.workspaceId, deletedAt: null },
        select: { id: true },
      });
      if (!ticket) throw new NotFoundException('TICKET_NOT_FOUND');
      const changed = await tx.$queryRaw<Array<{ attachment_id: string }>>(Prisma.sql`
        INSERT INTO "ticket_attachments" ("workspace_id", "ticket_id", "attachment_id", "attached_by_id")
        VALUES (${tenant.workspaceId}::uuid, ${ticketId}::uuid, ${attachmentId}::uuid, ${tenant.userId}::uuid)
        ON CONFLICT ("ticket_id", "attachment_id") DO UPDATE
        SET "removed_at" = NULL,
            "attached_by_id" = EXCLUDED."attached_by_id"
        WHERE "ticket_attachments"."removed_at" IS NOT NULL
        RETURNING "attachment_id"
      `);
      return tx.ticketAttachment
        .findUniqueOrThrow({
          where: { ticketId_attachmentId: { ticketId, attachmentId } },
          select: ticketAttachmentSelect,
        })
        .then((ticketAttachment) => ({ ticketAttachment, changedCount: changed.length }));
    });
    await this.ensureProcessingJob(asset, correlationId);
    if (link.changedCount > 0) {
      await this.audit.record({
        agencyId: tenant.agencyId,
        workspaceId: tenant.workspaceId,
        userId: tenant.userId,
        action: 'ticket.attachment_file_uploaded',
        entityType: 'Ticket',
        entityId: ticketId,
        metadata: { attachmentId, assetId: asset.id, sizeBytes: Number(asset.sizeBytes) },
      });
    }
    return serializeTicketAttachment(link.ticketAttachment);
  }

  async addUrlAttachment(
    tenant: WorkspaceTenantContext,
    ticketId: string,
    dto: CreateTicketUrlAttachmentDto,
  ) {
    this.assertPermission(tenant, PermissionKeys.ticketsAttachmentsAdd);
    await this.readTicket(tenant, ticketId);
    const url = normalizeAttachmentUrl(dto.url);
    const displayName =
      normalizeAttachmentDisplayName(dto.displayName) ?? attachmentUrlDisplayName(url);
    const link = await this.prisma.$transaction(async (tx) => {
      const ticket = await tx.ticket.findFirst({
        where: { id: ticketId, workspaceId: tenant.workspaceId, deletedAt: null },
        select: { id: true },
      });
      if (!ticket) throw new NotFoundException('TICKET_NOT_FOUND');
      const attachment = await tx.attachment.create({
        data: {
          workspaceId: tenant.workspaceId,
          type: AttachmentType.URL,
          url,
          displayName,
          createdById: tenant.userId,
        },
        select: { id: true },
      });
      await tx.ticketAttachment.create({
        data: {
          workspaceId: tenant.workspaceId,
          ticketId,
          attachmentId: attachment.id,
          attachedById: tenant.userId,
        },
      });
      return tx.ticketAttachment.findUniqueOrThrow({
        where: { ticketId_attachmentId: { ticketId, attachmentId: attachment.id } },
        select: ticketAttachmentSelect,
      });
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'ticket.attachment_url_added',
      entityType: 'Ticket',
      entityId: ticketId,
      metadata: { attachmentId: link.attachmentId },
    });
    return serializeTicketAttachment(link);
  }

  async linkAttachments(
    tenant: WorkspaceTenantContext,
    ticketId: string,
    dto: TicketAttachmentIdsDto,
  ) {
    this.assertPermission(tenant, PermissionKeys.ticketsAttachmentsAdd);
    await this.readTicket(tenant, ticketId);
    const attachmentIds = uniqueIds(dto.attachmentIds);
    const attachments = await this.prisma.attachment.findMany({
      where: { id: { in: attachmentIds }, workspaceId: tenant.workspaceId, deletedAt: null },
      select: reusableAttachmentSelect,
    });
    this.assertAttachmentsReusable(attachmentIds, attachments);

    const result = await this.prisma.$transaction(async (tx) => {
      const ticket = await tx.ticket.findFirst({
        where: { id: ticketId, workspaceId: tenant.workspaceId, deletedAt: null },
        select: { id: true },
      });
      if (!ticket) throw new NotFoundException('TICKET_NOT_FOUND');
      const values = Prisma.join(
        attachmentIds.map(
          (id) =>
            Prisma.sql`(${tenant.workspaceId}::uuid, ${ticketId}::uuid, ${id}::uuid, ${tenant.userId}::uuid)`,
        ),
      );
      const changed = await tx.$queryRaw<Array<{ attachment_id: string }>>(Prisma.sql`
        INSERT INTO "ticket_attachments" ("workspace_id", "ticket_id", "attachment_id", "attached_by_id")
        VALUES ${values}
        ON CONFLICT ("ticket_id", "attachment_id") DO UPDATE
        SET "removed_at" = NULL,
            "attached_by_id" = EXCLUDED."attached_by_id"
        WHERE "ticket_attachments"."removed_at" IS NOT NULL
        RETURNING "attachment_id"
      `);
      return { requestedCount: attachmentIds.length, changedCount: changed.length };
    });
    if (result.changedCount > 0) {
      await this.audit.record({
        agencyId: tenant.agencyId,
        workspaceId: tenant.workspaceId,
        userId: tenant.userId,
        action: 'ticket.attachments_linked',
        entityType: 'Ticket',
        entityId: ticketId,
        metadata: {
          requestedCount: result.requestedCount,
          changedCount: result.changedCount,
          unchangedCount: result.requestedCount - result.changedCount,
          attachmentIds,
        },
      });
    }
    return { requestedCount: result.requestedCount, changedCount: result.changedCount };
  }

  async downloadAttachment(tenant: WorkspaceTenantContext, ticketId: string, attachmentId: string) {
    this.assertPermission(tenant, PermissionKeys.ticketsAttachmentsView);
    await this.readTicket(tenant, ticketId);
    const link = await this.findActiveTicketAttachment(tenant.workspaceId, ticketId, attachmentId);
    return this.authorizeTicketAttachmentDownload(
      tenant,
      ticketId,
      link.attachment,
      'ticket.attachment_download_authorized',
    );
  }

  async downloadConversationAttachment(
    tenant: WorkspaceTenantContext,
    ticketId: string,
    entryId: string,
    attachmentId: string,
  ) {
    this.assertPermission(tenant, PermissionKeys.ticketsAttachmentsView);
    await this.readTicket(tenant, ticketId);
    const link = await this.prisma.ticketConversationAttachment.findFirst({
      where: {
        workspaceId: tenant.workspaceId,
        conversationEntryId: entryId,
        attachmentId,
        conversationEntry: this.conversationWhere(tenant, ticketId),
        attachment: { deletedAt: null },
      },
      select: ticketConversationAttachmentSelect,
    });
    if (!link) throw new NotFoundException('Attachment not found.');
    return this.authorizeTicketAttachmentDownload(
      tenant,
      ticketId,
      link.attachment,
      'ticket.conversation_attachment_download_authorized',
    );
  }

  async removeAttachment(tenant: WorkspaceTenantContext, ticketId: string, attachmentId: string) {
    this.assertPermission(tenant, PermissionKeys.ticketsAttachmentsRemove);
    await this.readTicket(tenant, ticketId);
    await this.findActiveTicketAttachment(tenant.workspaceId, ticketId, attachmentId);
    const removed = await this.prisma.ticketAttachment.updateMany({
      where: { workspaceId: tenant.workspaceId, ticketId, attachmentId, removedAt: null },
      data: { removedAt: new Date() },
    });
    if (removed.count > 0) {
      await this.audit.record({
        agencyId: tenant.agencyId,
        workspaceId: tenant.workspaceId,
        userId: tenant.userId,
        action: 'ticket.attachment_removed',
        entityType: 'Ticket',
        entityId: ticketId,
        metadata: { attachmentId },
      });
    }
    return { changed: removed.count > 0 };
  }

  async activity(tenant: WorkspaceTenantContext, ticketId: string, query: TicketActivityQueryDto) {
    this.assertPermission(tenant, PermissionKeys.ticketsActivityView);
    await this.readTicket(tenant, ticketId);
    const timezone = await this.workspaceTimezone(tenant.workspaceId);
    const where: Prisma.AuditLogWhereInput = {
      workspaceId: tenant.workspaceId,
      OR: [
        { entityType: 'Ticket', entityId: ticketId },
        {
          entityType: 'TicketConversationEntry',
          metadata: { path: ['ticketId'], equals: ticketId },
        },
      ],
    };
    const hiddenActions = this.hiddenActivityActions(tenant);
    if (query.action && !(TICKET_ACTIVITY_ACTIONS as readonly string[]).includes(query.action)) {
      throw new BadRequestException('INVALID_TICKET_ACTIVITY_ACTION');
    }
    if (query.action) {
      where.action = hiddenActions.includes(query.action) ? { in: [] } : query.action;
    } else if (hiddenActions.length > 0) {
      where.action = { notIn: hiddenActions };
    }
    if (query.actorMembershipId) {
      const actor = await this.prisma.workspaceMembership.findFirst({
        where: { id: query.actorMembershipId, workspaceId: tenant.workspaceId },
        select: { userId: true },
      });
      if (!actor) throw new NotFoundException('ACTOR_NOT_FOUND');
      where.userId = actor.userId;
    }
    const range = dateRange(query.from, query.to, timezone);
    if (range) where.createdAt = range;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        select: ticketActivitySelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return {
      items: items.map(serializeTicketActivity),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  private assertPermission(tenant: WorkspaceTenantContext, permission: string) {
    if (!hasPermission(tenant, permission)) {
      throw new ForbiddenException('TICKET_PERMISSION_REQUIRED');
    }
  }

  private assertAttachmentsReusable(
    attachmentIds: string[],
    attachments: Array<Prisma.AttachmentGetPayload<{ select: typeof reusableAttachmentSelect }>>,
  ) {
    if (attachments.length !== attachmentIds.length) {
      throw new NotFoundException('One or more attachments were not found.');
    }
    const unavailable = attachments.find(
      (attachment) =>
        attachment.type === AttachmentType.FILE &&
        (!attachment.asset ||
          attachment.asset.deletedAt ||
          attachment.asset.status !== AssetStatus.READY),
    );
    if (unavailable) {
      throw new ConflictException('Only ready file attachments can be linked.');
    }
  }

  private async findFileAttachment(workspaceId: string, attachmentId: string) {
    const attachment = await this.prisma.attachment.findFirst({
      where: {
        id: attachmentId,
        workspaceId,
        deletedAt: null,
        type: AttachmentType.FILE,
        asset: { deletedAt: null },
      },
      select: fileAttachmentSelect,
    });
    if (!attachment || !attachment.asset) throw new NotFoundException('Attachment not found.');
    return attachment;
  }

  private async findActiveTicketAttachment(
    workspaceId: string,
    ticketId: string,
    attachmentId: string,
  ) {
    const link = await this.prisma.ticketAttachment.findFirst({
      where: {
        workspaceId,
        ticketId,
        attachmentId,
        removedAt: null,
        attachment: { deletedAt: null },
      },
      select: ticketAttachmentSelect,
    });
    if (!link) throw new NotFoundException('Attachment not found.');
    return link;
  }

  private async authorizeTicketAttachmentDownload(
    tenant: WorkspaceTenantContext,
    ticketId: string,
    attachment:
      TicketAttachmentRecord['attachment'] | TicketConversationAttachmentRecord['attachment'],
    action: string,
  ) {
    if (attachment.type !== AttachmentType.FILE || !attachment.asset) {
      throw new ConflictException('Attachment is not a downloadable file.');
    }
    if (attachment.asset.deletedAt || attachment.asset.status !== AssetStatus.READY) {
      throw new ConflictException('Attachment file is not ready for download.');
    }
    const downloadUrl = await this.storage.createPresignedDownloadUrl(
      attachment.asset.storageKey,
      this.env.DOWNLOAD_URL_TTL_SECONDS,
    );
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action,
      entityType: 'Ticket',
      entityId: ticketId,
      metadata: { attachmentId: attachment.id, assetId: attachment.asset.id },
    });
    return { downloadUrl, expiresInSeconds: this.env.DOWNLOAD_URL_TTL_SECONDS };
  }

  private async ensureProcessingJob(asset: AttachmentAssetRecord, correlationId: string) {
    const job = await this.prisma.processingJob.upsert({
      where: { assetId_type: { assetId: asset.id, type: ASSET_PROCESSING_JOB_TYPE } },
      update: {},
      create: {
        workspaceId: asset.workspaceId,
        projectId: asset.projectId,
        assetId: asset.id,
        type: ASSET_PROCESSING_JOB_TYPE,
        status: ProcessingJobStatus.QUEUED,
        correlationId,
      },
      select: { id: true, status: true },
    });
    if (job.status === ProcessingJobStatus.QUEUED) {
      await this.queue.add(
        ASSET_PROCESSING_JOB_TYPE,
        {
          version: ASSET_JOB_VERSION,
          jobId: job.id,
          correlationId,
          workspaceId: asset.workspaceId,
          projectId: asset.projectId,
          assetId: asset.id,
          type: ASSET_PROCESSING_JOB_TYPE,
          createdAt: new Date().toISOString(),
        },
        { jobId: job.id, attempts: 3, backoff: { type: 'exponential', delay: 1_000 } },
      );
    }
    return job;
  }

  private hiddenActivityActions(tenant: WorkspaceTenantContext) {
    return [
      ...(hasPermission(tenant, PermissionKeys.ticketsNotesView)
        ? []
        : HIDDEN_INTERNAL_NOTE_ACTIONS),
      ...(hasPermission(tenant, PermissionKeys.ticketsAttachmentsView)
        ? []
        : ATTACHMENT_ACTIVITY_ACTIONS),
    ];
  }

  private async readTicket(tenant: WorkspaceTenantContext, id: string) {
    const visibility = await this.visibilityWhere(tenant);
    const ticket = await this.prisma.ticket.findFirst({
      where: { id, workspaceId: tenant.workspaceId, deletedAt: null, AND: [visibility] },
      select: ticketDetailSelect,
    });
    if (!ticket) throw new NotFoundException('TICKET_NOT_FOUND');
    return ticket;
  }

  private async ticketStatus(workspaceId: string, statusDefinitionId?: string) {
    const where = statusDefinitionId
      ? { id: statusDefinitionId, workspaceId, entityType: StatusEntityType.TICKET }
      : { workspaceId, entityType: StatusEntityType.TICKET, isDefault: true };
    const status = await this.prisma.statusDefinition.findFirst({
      where: { ...where, isActive: true },
      select: {
        id: true,
        workspaceId: true,
        entityType: true,
        isActive: true,
        isDefault: true,
        isTerminal: true,
      },
    });
    if (!status) {
      if (statusDefinitionId) throw new BadRequestException('INVALID_TICKET_STATUS');
      throw new ConflictException('NO_ACTIVE_TICKET_DEFAULT_STATUS');
    }
    return status;
  }

  private async hasActiveCompletionXpAward(
    workspaceId: string,
    workType: GamificationPointWorkType,
    sourceEntityId: string,
  ) {
    const award = await this.prisma.gamificationWorkXpEvent.findFirst({
      where: {
        workspaceId,
        workType,
        sourceEntityId,
        eventType: GamificationWorkXpEventType.COMPLETION_AWARD,
        outcome: GamificationWorkXpEventOutcome.APPLIED,
        reversalEvents: { none: {} },
      },
      select: { id: true },
    });
    return Boolean(award);
  }

  private async ticketWhere(
    tenant: WorkspaceTenantContext,
    query: TicketQueryDto,
  ): Promise<Prisma.TicketWhereInput> {
    const visibility = await this.visibilityWhere(tenant);
    const actor = await this.actorScope(tenant);
    const where: Prisma.TicketWhereInput = {
      workspaceId: tenant.workspaceId,
      deletedAt: null,
      AND: [visibility, this.queueWhere(query.queue ?? 'ALL_VISIBLE', actor)],
    };
    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { ticketNumber: { contains: search, mode: 'insensitive' } },
        { subject: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (query.statusDefinitionId) {
      await this.ensureTicketStatusExists(tenant.workspaceId, query.statusDefinitionId);
      where.statusDefinitionId = query.statusDefinitionId;
    }
    if (query.priority) where.priority = query.priority;
    if (query.requesterType) {
      if (query.requesterType === 'UNSET') where.requester = null;
      else where.requester = { type: query.requesterType };
    }
    if (query.internalRequesterMembershipId) {
      await this.ensureMembershipInWorkspace(
        tenant.workspaceId,
        query.internalRequesterMembershipId,
      );
      where.requester = {
        type: 'INTERNAL',
        internalMembershipId: query.internalRequesterMembershipId,
      };
    }
    if (query.departmentId) {
      await this.ensureDepartmentInWorkspace(tenant.workspaceId, query.departmentId);
      where.departmentId = query.departmentId;
    }
    if (query.assignedToMembershipId) {
      await this.ensureMembershipInWorkspace(tenant.workspaceId, query.assignedToMembershipId);
      where.assignedToMembershipId = query.assignedToMembershipId;
    }
    if (query.assignmentState === 'ASSIGNED') where.assignedToMembershipId = { not: null };
    if (query.assignmentState === 'UNASSIGNED') where.assignedToMembershipId = null;
    const timezone = await this.workspaceTimezone(tenant.workspaceId);
    const createdRange = dateRange(query.createdFrom, query.createdTo, timezone);
    const updatedRange = dateRange(query.updatedFrom, query.updatedTo, timezone);
    if (createdRange) where.createdAt = createdRange;
    if (updatedRange) where.updatedAt = updatedRange;
    if (query.slaState || query.slaDueFrom || query.slaDueTo) {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
        this.slaWhere(
          query.slaMetric ?? 'ANY',
          query.slaState,
          dateRange(query.slaDueFrom, query.slaDueTo, timezone),
        ),
      ];
    }
    return where;
  }

  private queueWhere(queue: TicketBuiltInQueue, actor: ActorScope): Prisma.TicketWhereInput {
    switch (queue) {
      case 'ALL_VISIBLE':
        return {};
      case 'MY_ASSIGNED':
        return actor.membershipId
          ? {
              assignedToMembershipId: actor.membershipId,
              assignedToMembership: { status: MembershipStatus.ACTIVE },
            }
          : noTicketsWhere();
      case 'MY_REQUESTED':
        return actor.membershipId
          ? {
              requester: {
                type: 'INTERNAL',
                internalMembershipId: actor.membershipId,
                internalMembership: { status: MembershipStatus.ACTIVE },
              },
            }
          : noTicketsWhere();
      case 'MY_DEPARTMENT':
        return actor.departmentId ? { departmentId: actor.departmentId } : noTicketsWhere();
      case 'UNASSIGNED_MY_DEPARTMENT':
        return actor.departmentId
          ? { departmentId: actor.departmentId, assignedToMembershipId: null }
          : noTicketsWhere();
      case 'SLA_BREACHED':
        return this.slaWhere('ANY', 'BREACHED');
    }
  }

  private slaWhere(
    metric: 'ANY' | 'FIRST_RESPONSE' | 'RESOLUTION',
    state?: string,
    dueRange?: Prisma.DateTimeNullableFilter<'TicketSlaState'>,
  ): Prisma.TicketWhereInput {
    const predicates: Prisma.TicketSlaStateWhereInput[] = [];
    if (state) predicates.push(slaStatePredicate(metric, state));
    if (dueRange) predicates.push(slaDuePredicate(metric, dueRange));
    if (state === 'NOT_CONFIGURED') return { slaState: { is: null } };
    if (predicates.length === 0) return {};
    return { slaState: { is: { AND: predicates } } };
  }

  private async workspaceTimezone(workspaceId: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { timezone: true },
    });
    return workspace?.timezone || 'UTC';
  }

  private slaSummaryCounts(
    where: Prisma.TicketWhereInput,
    metric: 'FIRST_RESPONSE' | 'RESOLUTION',
  ) {
    const states = ['NOT_CONFIGURED', 'RUNNING', 'PAUSED', 'MET', 'BREACHED', 'NOT_APPLICABLE'];
    return Promise.all(
      states.map((state) =>
        this.prisma.ticket.count({
          where: composeTicketWhere(where, this.slaWhere(metric, state)),
        }),
      ),
    ).then((counts) => Object.fromEntries(states.map((state, index) => [state, counts[index]])));
  }

  private async resolutionTrendRows(
    workspaceId: string,
    where: Prisma.TicketWhereInput,
    range: Prisma.DateTimeFilter<'AuditLog'> | undefined,
  ) {
    const terminalStatuses = await this.prisma.statusDefinition.findMany({
      where: { workspaceId, entityType: StatusEntityType.TICKET, isTerminal: true },
      select: { id: true },
    });
    if (terminalStatuses.length === 0) return [];
    const ticketIds = await this.prisma.ticket.findMany({
      where,
      select: { id: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: TICKET_REPORT_EXPORT_MAX_ROWS,
    });
    if (ticketIds.length === 0) return [];
    const terminalIds = terminalStatuses.map((status) => status.id);
    const rows = await this.prisma.auditLog.findMany({
      where: {
        workspaceId,
        entityType: 'Ticket',
        action: 'ticket.status_changed',
        entityId: { in: ticketIds.map((ticket) => ticket.id) },
        OR: terminalIds.map((statusId) => ({
          metadata: { path: ['toStatusDefinitionId'], equals: statusId },
        })),
      },
      select: { entityId: true, createdAt: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: TICKET_REPORT_EXPORT_MAX_ROWS,
    });
    const firstByTicket = new Map<string, Date>();
    for (const row of rows) {
      if (row.entityId && !firstByTicket.has(row.entityId))
        firstByTicket.set(row.entityId, row.createdAt);
    }
    return [...firstByTicket.values()]
      .filter((createdAt) => {
        if (!range) return true;
        if (range.gte && createdAt < range.gte) return false;
        if (range.lte && createdAt > range.lte) return false;
        return true;
      })
      .map((createdAt) => ({ createdAt }));
  }

  private async normalizeSavedViewConfig(
    workspaceId: string,
    filters: Record<string, unknown>,
    sort: Record<string, unknown>,
  ) {
    const allowedFilterKeys = new Set([
      'queue',
      'search',
      'statusDefinitionId',
      'priority',
      'requesterType',
      'internalRequesterMembershipId',
      'departmentId',
      'assignedToMembershipId',
      'assignmentState',
      'createdFrom',
      'createdTo',
      'updatedFrom',
      'updatedTo',
      'slaMetric',
      'slaState',
      'slaDueFrom',
      'slaDueTo',
    ]);
    for (const key of Object.keys(filters)) {
      if (!allowedFilterKeys.has(key)) throw new BadRequestException('INVALID_TICKET_VIEW_FILTER');
    }
    for (const key of Object.keys(sort)) {
      if (!['sortBy', 'sortDirection'].includes(key)) {
        throw new BadRequestException('INVALID_TICKET_VIEW_SORT');
      }
    }
    const query = new TicketQueryDto();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null && value !== '') {
        (query as unknown as Record<string, unknown>)[key] = value;
      }
    }
    if (sort.sortBy !== undefined) query.sortBy = sort.sortBy as TicketQueryDto['sortBy'];
    if (sort.sortDirection !== undefined) {
      query.sortDirection = sort.sortDirection as TicketQueryDto['sortDirection'];
    }
    if (query.queue && !ticketBuiltInQueues.includes(query.queue))
      throw new BadRequestException('INVALID_TICKET_VIEW_QUEUE');
    if (query.priority && !Object.values(TaskPriority).includes(query.priority))
      throw new BadRequestException('INVALID_TICKET_VIEW_PRIORITY');
    if (query.requesterType && !requesterTypeFilters.includes(query.requesterType))
      throw new BadRequestException('INVALID_TICKET_VIEW_REQUESTER_TYPE');
    if (query.assignmentState && !assignmentStates.includes(query.assignmentState))
      throw new BadRequestException('INVALID_TICKET_VIEW_ASSIGNMENT_STATE');
    if (query.slaMetric && !slaMetrics.includes(query.slaMetric))
      throw new BadRequestException('INVALID_TICKET_VIEW_SLA_METRIC');
    if (query.slaState && !slaStates.includes(query.slaState))
      throw new BadRequestException('INVALID_TICKET_VIEW_SLA_STATE');
    if (!['createdAt', 'updatedAt', 'ticketNumber', 'priority'].includes(query.sortBy)) {
      throw new BadRequestException('INVALID_TICKET_VIEW_SORT');
    }
    if (!['asc', 'desc'].includes(query.sortDirection)) {
      throw new BadRequestException('INVALID_TICKET_VIEW_SORT');
    }
    if (query.statusDefinitionId)
      await this.ensureTicketStatusExists(workspaceId, query.statusDefinitionId);
    if (query.departmentId) await this.ensureDepartmentInWorkspace(workspaceId, query.departmentId);
    if (query.assignedToMembershipId)
      await this.ensureMembershipInWorkspace(workspaceId, query.assignedToMembershipId);
    if (query.internalRequesterMembershipId)
      await this.ensureMembershipInWorkspace(workspaceId, query.internalRequesterMembershipId);
    const normalizedFilters: Record<string, unknown> = {};
    for (const key of allowedFilterKeys) {
      const value = (query as unknown as Record<string, unknown>)[key];
      if (value !== undefined && value !== null && value !== '') normalizedFilters[key] = value;
    }
    return {
      filters: normalizedFilters,
      sort: { sortBy: query.sortBy, sortDirection: query.sortDirection },
    };
  }

  private async readSavedViewForMutation(tenant: WorkspaceTenantContext, viewId: string) {
    const view = await this.prisma.ticketSavedView.findFirst({
      where: { id: viewId, workspaceId: tenant.workspaceId },
      select: ticketSavedViewSelect,
    });
    if (!view) throw new NotFoundException('TICKET_SAVED_VIEW_NOT_FOUND');
    if (view.scope === TicketSavedViewScope.PERSONAL) {
      if (view.ownerMembershipId !== tenant.workspaceMembershipId) {
        throw new NotFoundException('TICKET_SAVED_VIEW_NOT_FOUND');
      }
      if (!hasPermission(tenant, PermissionKeys.ticketsViewsManage)) {
        throw new ForbiddenException('TICKET_VIEW_PERMISSION_REQUIRED');
      }
    } else if (!hasPermission(tenant, PermissionKeys.ticketsViewsManageShared)) {
      throw new ForbiddenException('TICKET_VIEW_SHARED_PERMISSION_REQUIRED');
    }
    return view;
  }

  private assertSavedViewPermission(tenant: WorkspaceTenantContext, scope: TicketSavedViewScope) {
    const permission =
      scope === TicketSavedViewScope.PERSONAL
        ? PermissionKeys.ticketsViewsManage
        : PermissionKeys.ticketsViewsManageShared;
    if (!hasPermission(tenant, permission)) {
      throw new ForbiddenException('TICKET_VIEW_PERMISSION_REQUIRED');
    }
  }

  private async ensureSavedViewNameAvailable(
    workspaceId: string,
    scope: TicketSavedViewScope,
    normalizedName: string,
    ownerMembershipId: string | null,
    excludeId?: string,
  ) {
    const exists = await this.prisma.ticketSavedView.findFirst({
      where: {
        workspaceId,
        scope,
        nameNormalized: normalizedName,
        ...(scope === TicketSavedViewScope.PERSONAL ? { ownerMembershipId } : {}),
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (exists) throw new ConflictException('TICKET_VIEW_NAME_EXISTS');
  }

  private async ensureDepartmentInWorkspace(workspaceId: string, departmentId: string) {
    const exists = await this.prisma.department.findFirst({
      where: { id: departmentId, workspaceId },
      select: { id: true },
    });
    if (!exists) throw new BadRequestException('INVALID_TICKET_DEPARTMENT');
  }

  private async ensureMembershipInWorkspace(workspaceId: string, membershipId?: string | null) {
    if (!membershipId) return;
    const exists = await this.prisma.workspaceMembership.findFirst({
      where: { id: membershipId, workspaceId },
      select: { id: true },
    });
    if (!exists) throw new BadRequestException('INVALID_TICKET_MEMBERSHIP');
  }

  private conversationWhere(
    tenant: WorkspaceTenantContext,
    ticketId: string,
  ): Prisma.TicketConversationEntryWhereInput {
    return {
      workspaceId: tenant.workspaceId,
      ticketId,
      ...(hasPermission(tenant, PermissionKeys.ticketsNotesView)
        ? {}
        : { type: TicketConversationEntryType.PUBLIC_REPLY }),
    };
  }

  private async visibilityWhere(
    tenant: WorkspaceTenantContext,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<Prisma.TicketWhereInput> {
    if (hasPermission(tenant, PermissionKeys.ticketsViewAll)) return {};
    const actor = await this.actorScope(tenant, client);
    if (!actor.membershipId) return { id: '00000000-0000-4000-8000-000000000000' };
    const conditions: Prisma.TicketWhereInput[] = [
      {
        requester: {
          internalMembershipId: actor.membershipId,
          internalMembership: { status: MembershipStatus.ACTIVE },
        },
      },
    ];
    if (actor.departmentId) {
      conditions.push({ departmentId: actor.departmentId });
      conditions.push({
        departmentId: actor.departmentId,
        assignedToMembershipId: actor.membershipId,
        assignedToMembership: {
          status: MembershipStatus.ACTIVE,
          departmentId: actor.departmentId,
        },
      });
    }
    return { OR: conditions };
  }

  private async actorScope(
    tenant: WorkspaceTenantContext,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<ActorScope> {
    if (!tenant.workspaceMembershipId) return { membershipId: null, departmentId: null };
    const membership = await client.workspaceMembership.findFirst({
      where: {
        id: tenant.workspaceMembershipId,
        workspaceId: tenant.workspaceId,
        status: MembershipStatus.ACTIVE,
      },
      select: { id: true, departmentId: true },
    });
    return {
      membershipId: membership?.id ?? null,
      departmentId: membership?.departmentId ?? null,
    };
  }

  private async validRequester(
    workspaceId: string,
    dto: TicketRequesterDto | undefined,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<NormalizedRequester> {
    if (!dto) throw new BadRequestException('TICKET_REQUESTER_REQUIRED');
    if (dto.type === 'INTERNAL') {
      if (!dto.membershipId) throw new BadRequestException('INTERNAL_REQUESTER_REQUIRED');
      if (dto.name || dto.email || dto.phone)
        throw new BadRequestException('INVALID_REQUESTER_FIELDS');
      const membership = await client.workspaceMembership.findFirst({
        where: { id: dto.membershipId, workspaceId },
        select: { id: true, status: true },
      });
      if (!membership) throw new BadRequestException('INVALID_INTERNAL_REQUESTER');
      if (membership.status !== MembershipStatus.ACTIVE) {
        throw new BadRequestException('INTERNAL_REQUESTER_INACTIVE');
      }
      return {
        type: 'INTERNAL',
        internalMembershipId: membership.id,
        externalName: null,
        externalEmail: null,
        externalPhone: null,
      };
    }

    if (dto.membershipId) throw new BadRequestException('INVALID_REQUESTER_FIELDS');
    const externalName = normalizeExternalName(dto.name);
    const externalEmail = normalizeExternalEmail(dto.email);
    const externalPhone = normalizeExternalPhone(dto.phone);
    if (!externalEmail && !externalPhone)
      throw new BadRequestException('REQUESTER_CONTACT_REQUIRED');
    return {
      type: 'EXTERNAL',
      internalMembershipId: null,
      externalName,
      externalEmail,
      externalPhone,
    };
  }

  private async validAssignment(
    workspaceId: string,
    existing: Pick<TicketDetailRecord, 'departmentId' | 'assignedToMembershipId'> | null,
    dto: UpdateTicketAssignmentDto,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const departmentId =
      dto.departmentId === undefined ? (existing?.departmentId ?? null) : dto.departmentId;
    const assignedToMembershipId =
      dto.assignedToMembershipId === undefined
        ? (existing?.assignedToMembershipId ?? null)
        : dto.assignedToMembershipId;

    if (assignedToMembershipId && !departmentId) {
      throw new BadRequestException('TICKET_ASSIGNEE_REQUIRES_DEPARTMENT');
    }
    if (departmentId && departmentId !== existing?.departmentId) {
      const department = await client.department.findFirst({
        where: { id: departmentId, workspaceId },
        select: { id: true, status: true },
      });
      if (!department) throw new BadRequestException('INVALID_TICKET_DEPARTMENT');
      if (department.status !== DepartmentStatus.ACTIVE) {
        throw new BadRequestException('TICKET_DEPARTMENT_INACTIVE');
      }
    }
    if (assignedToMembershipId) {
      const membership = await client.workspaceMembership.findFirst({
        where: { id: assignedToMembershipId, workspaceId },
        select: { id: true, status: true, departmentId: true },
      });
      if (!membership) throw new BadRequestException('INVALID_TICKET_ASSIGNEE');
      if (membership.status !== MembershipStatus.ACTIVE) {
        throw new BadRequestException('TICKET_ASSIGNEE_INACTIVE');
      }
      if (membership.departmentId !== departmentId) {
        throw new BadRequestException('TICKET_ASSIGNEE_NOT_IN_DEPARTMENT');
      }
    }
    return {
      departmentId: departmentId ?? null,
      assignedToMembershipId: assignedToMembershipId ?? null,
    };
  }

  private async ensureTicketStatusExists(workspaceId: string, statusDefinitionId: string) {
    const exists = await this.prisma.statusDefinition.findFirst({
      where: { id: statusDefinitionId, workspaceId, entityType: StatusEntityType.TICKET },
      select: { id: true },
    });
    if (!exists) throw new BadRequestException('INVALID_TICKET_STATUS');
  }

  private requireWorkspaceMembership(tenant: WorkspaceTenantContext) {
    if (!tenant.workspaceMembershipId) {
      throw new ForbiddenException('WORKSPACE_MEMBERSHIP_REQUIRED');
    }
    return tenant.workspaceMembershipId;
  }
}

const ticketRequesterSelect = Prisma.validator<Prisma.TicketRequesterSelect>()({
  id: true,
  type: true,
  internalMembershipId: true,
  externalName: true,
  externalEmail: true,
  externalPhone: true,
  internalMembership: {
    select: {
      id: true,
      status: true,
      departmentId: true,
      user: { select: { id: true, email: true, name: true, status: true } },
    },
  },
});

const ticketListSelect = Prisma.validator<Prisma.TicketSelect>()({
  id: true,
  workspaceId: true,
  sequenceNumber: true,
  ticketNumber: true,
  subject: true,
  statusDefinitionId: true,
  priority: true,
  departmentId: true,
  assignedToMembershipId: true,
  escalationLevel: true,
  escalationChangedAt: true,
  escalationChangedByMembershipId: true,
  createdAt: true,
  updatedAt: true,
  statusDefinition: {
    select: { id: true, name: true, color: true, isTerminal: true, isActive: true },
  },
  requester: { select: ticketRequesterSelect },
  department: { select: { id: true, name: true, status: true } },
  assignedToMembership: {
    select: {
      id: true,
      status: true,
      departmentId: true,
      user: { select: { id: true, email: true, name: true, status: true } },
    },
  },
  createdByMembership: {
    select: {
      id: true,
      status: true,
      user: { select: { id: true, email: true, name: true } },
    },
  },
  escalationChangedByMembership: {
    select: {
      id: true,
      status: true,
      user: { select: { id: true, email: true, name: true } },
    },
  },
  slaState: {
    select: {
      firstResponseDueAt: true,
      firstResponsePausedAt: true,
      firstResponseCompletedAt: true,
      firstResponseBreachedAt: true,
      firstResponseNotApplicableAt: true,
      resolutionDueAt: true,
      resolutionPausedAt: true,
      resolutionCompletedAt: true,
      resolutionBreachedAt: true,
    },
  },
});

const ticketDetailSelect = Prisma.validator<Prisma.TicketSelect>()({
  ...ticketListSelect,
  description: true,
});

const ticketConversationEntryBaseSelect = Prisma.validator<Prisma.TicketConversationEntrySelect>()({
  id: true,
  workspaceId: true,
  ticketId: true,
  type: true,
  body: true,
  createdAt: true,
  authorMembership: {
    select: {
      id: true,
      status: true,
      user: { select: { name: true, email: true } },
    },
  },
});

const ticketConversationEntrySelect = Prisma.validator<Prisma.TicketConversationEntrySelect>()({
  ...ticketConversationEntryBaseSelect,
  attachments: {
    select: {
      conversationEntryId: true,
      attachmentId: true,
      createdAt: true,
      attachment: {
        select: {
          id: true,
          workspaceId: true,
          type: true,
          assetId: true,
          url: true,
          displayName: true,
          createdAt: true,
          updatedAt: true,
          asset: {
            select: {
              id: true,
              workspaceId: true,
              projectId: true,
              originalFilename: true,
              displayName: true,
              storageBucket: true,
              storageKey: true,
              mimeType: true,
              extension: true,
              sizeBytes: true,
              checksum: true,
              status: true,
              metadata: true,
              uploadExpiresAt: true,
              deletedAt: true,
              createdAt: true,
              updatedAt: true,
            },
          },
          createdBy: { select: { id: true, email: true, name: true } },
        },
      },
    },
  },
});

const attachmentAssetSelect = {
  id: true,
  workspaceId: true,
  projectId: true,
  originalFilename: true,
  displayName: true,
  storageBucket: true,
  storageKey: true,
  mimeType: true,
  extension: true,
  sizeBytes: true,
  checksum: true,
  status: true,
  metadata: true,
  uploadExpiresAt: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AssetSelect;

const attachmentCoreSelect = {
  id: true,
  workspaceId: true,
  type: true,
  assetId: true,
  url: true,
  displayName: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AttachmentSelect;

const fileAttachmentSelect = {
  ...attachmentCoreSelect,
  asset: { select: attachmentAssetSelect },
} satisfies Prisma.AttachmentSelect;

const ticketAttachmentSelect = {
  ticketId: true,
  attachmentId: true,
  createdAt: true,
  removedAt: true,
  attachment: {
    select: {
      ...attachmentCoreSelect,
      asset: { select: attachmentAssetSelect },
      createdBy: { select: { id: true, email: true, name: true } },
    },
  },
  attachedBy: { select: { id: true, email: true, name: true } },
} satisfies Prisma.TicketAttachmentSelect;

const ticketConversationAttachmentSelect = {
  conversationEntryId: true,
  attachmentId: true,
  createdAt: true,
  attachment: {
    select: {
      ...attachmentCoreSelect,
      asset: { select: attachmentAssetSelect },
      createdBy: { select: { id: true, email: true, name: true } },
    },
  },
} satisfies Prisma.TicketConversationAttachmentSelect;

const reusableAttachmentSelect = {
  id: true,
  type: true,
  asset: { select: { id: true, status: true, deletedAt: true } },
} satisfies Prisma.AttachmentSelect;

const ticketActivitySelect = {
  id: true,
  action: true,
  entityType: true,
  entityId: true,
  metadata: true,
  createdAt: true,
  user: { select: { id: true, email: true, name: true } },
} satisfies Prisma.AuditLogSelect;

const ticketReportCsvSelect = {
  id: true,
  ticketNumber: true,
  sequenceNumber: true,
  subject: true,
  priority: true,
  escalationLevel: true,
  createdAt: true,
  updatedAt: true,
  statusDefinition: { select: { name: true } },
  requester: {
    select: {
      type: true,
      externalName: true,
      internalMembership: { select: { user: { select: { name: true, email: true } } } },
    },
  },
  department: { select: { name: true } },
  assignedToMembership: { select: { user: { select: { name: true, email: true } } } },
  slaState: {
    select: {
      firstResponseDueAt: true,
      firstResponseCompletedAt: true,
      firstResponseBreachedAt: true,
      firstResponsePausedAt: true,
      firstResponseNotApplicableAt: true,
      resolutionDueAt: true,
      resolutionCompletedAt: true,
      resolutionBreachedAt: true,
      resolutionPausedAt: true,
    },
  },
} satisfies Prisma.TicketSelect;

const ticketSavedViewSelect = Prisma.validator<Prisma.TicketSavedViewSelect>()({
  id: true,
  workspaceId: true,
  name: true,
  scope: true,
  ownerMembershipId: true,
  filterSchemaVersion: true,
  filters: true,
  sort: true,
  createdByMembershipId: true,
  updatedByMembershipId: true,
  createdAt: true,
  updatedAt: true,
});

async function allocateTicketNumber(tx: Prisma.TransactionClient, workspaceId: string) {
  const rows = await tx.$queryRaw<Array<{ last_number: number }>>`
    INSERT INTO "workspace_ticket_counters" ("workspace_id", "last_number", "updated_at")
    VALUES (${workspaceId}::uuid, 1, NOW())
    ON CONFLICT ("workspace_id")
    DO UPDATE SET "last_number" = "workspace_ticket_counters"."last_number" + 1,
                  "updated_at" = NOW()
    RETURNING "last_number"
  `;
  const number = rows[0]?.last_number;
  if (!number) throw new ConflictException('TICKET_NUMBER_ALLOCATION_FAILED');
  return number;
}

function ticketOrderBy(
  sortBy: TicketQueryDto['sortBy'],
  direction: TicketQueryDto['sortDirection'],
) {
  if (sortBy === 'ticketNumber') {
    return [
      { sequenceNumber: direction },
      { id: 'desc' },
    ] satisfies Prisma.TicketOrderByWithRelationInput[];
  }
  return [
    { [sortBy]: direction },
    { sequenceNumber: 'desc' },
    { id: 'desc' },
  ] as Prisma.TicketOrderByWithRelationInput[];
}

function serializeTicket(ticket: TicketListRecord | TicketDetailRecord) {
  return {
    id: ticket.id,
    workspaceId: ticket.workspaceId,
    sequenceNumber: ticket.sequenceNumber,
    ticketNumber: ticket.ticketNumber,
    subject: ticket.subject,
    description: 'description' in ticket ? ticket.description : undefined,
    statusDefinitionId: ticket.statusDefinitionId,
    status: {
      id: ticket.statusDefinition.id,
      name: ticket.statusDefinition.name,
      color: ticket.statusDefinition.color,
      terminal: ticket.statusDefinition.isTerminal,
      active: ticket.statusDefinition.isActive,
    },
    priority: ticket.priority,
    requester: serializeRequester(ticket.requester, 'description' in ticket),
    departmentId: ticket.departmentId,
    department: ticket.department,
    assignedToMembershipId: ticket.assignedToMembershipId,
    assignedTo: ticket.assignedToMembership
      ? {
          id: ticket.assignedToMembership.id,
          status: ticket.assignedToMembership.status,
          departmentId: ticket.assignedToMembership.departmentId,
          user: ticket.assignedToMembership.user,
        }
      : null,
    escalationLevel: ticket.escalationLevel,
    escalationChangedAt: 'description' in ticket ? ticket.escalationChangedAt : undefined,
    escalationChangedBy:
      'description' in ticket && ticket.escalationChangedByMembership
        ? {
            id: ticket.escalationChangedByMembership.id,
            status: ticket.escalationChangedByMembership.status,
            user: ticket.escalationChangedByMembership.user,
          }
        : undefined,
    createdBy: ticket.createdByMembership
      ? {
          id: ticket.createdByMembership.id,
          status: ticket.createdByMembership.status,
          user: ticket.createdByMembership.user,
        }
      : null,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    sla: ticket.slaState
      ? {
          firstResponse: {
            state: metricStateFromColumns({
              notApplicableAt: ticket.slaState.firstResponseNotApplicableAt,
              completedAt: ticket.slaState.firstResponseCompletedAt,
              breachedAt: ticket.slaState.firstResponseBreachedAt,
              pausedAt: ticket.slaState.firstResponsePausedAt,
            }),
            dueAt: ticket.slaState.firstResponseDueAt,
          },
          resolution: {
            state: metricStateFromColumns({
              completedAt: ticket.slaState.resolutionCompletedAt,
              breachedAt: ticket.slaState.resolutionBreachedAt,
              pausedAt: ticket.slaState.resolutionPausedAt,
            }),
            dueAt: ticket.slaState.resolutionDueAt,
          },
        }
      : {
          firstResponse: { state: 'NOT_CONFIGURED', dueAt: null },
          resolution: { state: 'NOT_CONFIGURED', dueAt: null },
        },
  };
}

function serializeRequester(requester: TicketListRecord['requester'], detail: boolean) {
  if (!requester) return null;
  if (requester.type === 'INTERNAL') {
    return {
      id: requester.id,
      type: requester.type,
      internalMembershipId: requester.internalMembershipId,
      displayName:
        requester.internalMembership?.user.name ?? requester.internalMembership?.user.email ?? null,
      internalMembership: requester.internalMembership
        ? {
            id: requester.internalMembership.id,
            status: requester.internalMembership.status,
            departmentId: requester.internalMembership.departmentId,
            user: requester.internalMembership.user,
          }
        : null,
    };
  }
  return {
    id: requester.id,
    type: requester.type,
    displayName: requester.externalName,
    externalName: requester.externalName,
    externalEmail: detail ? requester.externalEmail : undefined,
    externalPhone: detail ? requester.externalPhone : undefined,
  };
}

function normalizeSubject(value: string) {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) throw new BadRequestException('TICKET_SUBJECT_REQUIRED');
  if (normalized.length > 200) throw new BadRequestException('TICKET_SUBJECT_TOO_LONG');
  return normalized;
}

function normalizeDescription(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeConversationBody(value: string) {
  const normalized = value.trim();
  if (!normalized) throw new BadRequestException('TICKET_CONVERSATION_BODY_REQUIRED');
  if (normalized.length > 12000) throw new BadRequestException('TICKET_CONVERSATION_BODY_TOO_LONG');
  return normalized;
}

function normalizeEscalationReason(value: string) {
  const normalized = value.trim();
  if (!normalized) throw new BadRequestException('TICKET_ESCALATION_REASON_REQUIRED');
  if (normalized.length > 500) throw new BadRequestException('TICKET_ESCALATION_REASON_TOO_LONG');
  return normalized;
}

function nextEscalationLevel(
  current: TicketEscalationLevel,
  action: TicketEscalationAction,
): TicketEscalationLevel | null {
  if (action === 'ESCALATE') {
    if (current === TicketEscalationLevel.NONE) return TicketEscalationLevel.LEVEL_1;
    if (current === TicketEscalationLevel.LEVEL_1) return TicketEscalationLevel.LEVEL_2;
    if (current === TicketEscalationLevel.LEVEL_2) return TicketEscalationLevel.LEVEL_3;
    return null;
  }
  if (action === 'DEESCALATE') {
    if (current === TicketEscalationLevel.LEVEL_3) return TicketEscalationLevel.LEVEL_2;
    if (current === TicketEscalationLevel.LEVEL_2) return TicketEscalationLevel.LEVEL_1;
    if (current === TicketEscalationLevel.LEVEL_1) return TicketEscalationLevel.NONE;
    return null;
  }
  if (current === TicketEscalationLevel.NONE) return null;
  return TicketEscalationLevel.NONE;
}

function normalizeExternalName(value: string | undefined) {
  const normalized = value?.trim().replace(/\s+/g, ' ') ?? '';
  if (!normalized) throw new BadRequestException('EXTERNAL_REQUESTER_NAME_REQUIRED');
  if (normalized.length > 160) throw new BadRequestException('EXTERNAL_REQUESTER_NAME_TOO_LONG');
  return normalized;
}

function normalizeExternalEmail(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}

function normalizeExternalPhone(value: string | undefined) {
  const normalized = value?.trim().replace(/\s+/g, ' ');
  return normalized || null;
}

function formatTicketNumber(sequenceNumber: number) {
  return `TKT-${String(sequenceNumber).padStart(6, '0')}`;
}

function hasPermission(tenant: WorkspaceTenantContext, permission: string) {
  return tenant.permissions.includes('*') || tenant.permissions.includes(permission);
}

function composeTicketWhere(
  base: Prisma.TicketWhereInput,
  extra: Prisma.TicketWhereInput,
): Prisma.TicketWhereInput {
  if (Object.keys(extra).length === 0) return base;
  return { ...base, AND: [...(Array.isArray(base.AND) ? base.AND : []), extra] };
}

function noTicketsWhere(): Prisma.TicketWhereInput {
  return { id: '00000000-0000-4000-8000-000000000000' };
}

function dateRange(from: string | undefined, to: string | undefined, timezone: string) {
  const gte = parseBoundary(from, timezone, 'start');
  const lte = parseBoundary(to, timezone, 'end');
  if (!gte && !lte) return undefined;
  return {
    ...(gte ? { gte } : {}),
    ...(lte ? { lte } : {}),
  };
}

function parseOptionalDate(value: string | Date | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (value instanceof Date) return value;
  return new Date(value);
}

function requireFutureReopenTarget(value: Date | null | undefined, errorCode: string) {
  if (!value || Number.isNaN(value.getTime()) || value <= new Date()) {
    throw new BadRequestException(errorCode);
  }
  return value;
}

function parseBoundary(value: string | undefined, timezone: string, boundary: 'start' | 'end') {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const localDate = DateTime.fromISO(trimmed, { zone: timezone });
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? boundary === 'start'
      ? localDate.startOf('day')
      : localDate.endOf('day')
    : DateTime.fromISO(trimmed, { zone: 'utc' });
  if (!parsed.isValid) throw new BadRequestException('INVALID_TICKET_DATE_FILTER');
  return parsed.toUTC().toJSDate();
}

function slaStatePredicate(metric: 'ANY' | 'FIRST_RESPONSE' | 'RESOLUTION', state: string) {
  const predicates: Prisma.TicketSlaStateWhereInput[] = [];
  if (metric === 'ANY' || metric === 'FIRST_RESPONSE') {
    predicates.push(firstResponseStatePredicate(state));
  }
  if (metric === 'ANY' || metric === 'RESOLUTION') {
    predicates.push(resolutionStatePredicate(state));
  }
  return predicates.length === 1 ? (predicates[0] ?? {}) : { OR: predicates };
}

function firstResponseStatePredicate(state: string): Prisma.TicketSlaStateWhereInput {
  switch (state) {
    case 'BREACHED':
      return { firstResponseBreachedAt: { not: null } };
    case 'MET':
      return { firstResponseCompletedAt: { not: null }, firstResponseBreachedAt: null };
    case 'PAUSED':
      return {
        firstResponsePausedAt: { not: null },
        firstResponseCompletedAt: null,
        firstResponseBreachedAt: null,
        firstResponseNotApplicableAt: null,
      };
    case 'NOT_APPLICABLE':
      return { firstResponseNotApplicableAt: { not: null } };
    case 'RUNNING':
      return {
        firstResponseDueAt: { not: null },
        firstResponsePausedAt: null,
        firstResponseCompletedAt: null,
        firstResponseBreachedAt: null,
        firstResponseNotApplicableAt: null,
      };
    default:
      return {};
  }
}

function resolutionStatePredicate(state: string): Prisma.TicketSlaStateWhereInput {
  switch (state) {
    case 'BREACHED':
      return { resolutionBreachedAt: { not: null } };
    case 'MET':
      return { resolutionCompletedAt: { not: null }, resolutionBreachedAt: null };
    case 'PAUSED':
      return {
        resolutionPausedAt: { not: null },
        resolutionCompletedAt: null,
        resolutionBreachedAt: null,
      };
    case 'NOT_APPLICABLE':
      return { id: '00000000-0000-4000-8000-000000000000' };
    case 'RUNNING':
      return {
        resolutionDueAt: { not: null },
        resolutionPausedAt: null,
        resolutionCompletedAt: null,
        resolutionBreachedAt: null,
      };
    default:
      return {};
  }
}

function slaDuePredicate(
  metric: 'ANY' | 'FIRST_RESPONSE' | 'RESOLUTION',
  dueRange: Prisma.DateTimeNullableFilter<'TicketSlaState'>,
): Prisma.TicketSlaStateWhereInput {
  if (metric === 'FIRST_RESPONSE') return { firstResponseDueAt: dueRange };
  if (metric === 'RESOLUTION') return { resolutionDueAt: dueRange };
  return { OR: [{ firstResponseDueAt: dueRange }, { resolutionDueAt: dueRange }] };
}

function metricStateFromColumns(options: {
  notApplicableAt?: Date | null;
  completedAt?: Date | null;
  breachedAt?: Date | null;
  pausedAt?: Date | null;
}) {
  if (options.notApplicableAt) return 'NOT_APPLICABLE';
  if (options.breachedAt) return 'BREACHED';
  if (options.completedAt) return 'MET';
  if (options.pausedAt) return 'PAUSED';
  return 'RUNNING';
}

function normalizeSavedViewName(value: string) {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) throw new BadRequestException('TICKET_VIEW_NAME_REQUIRED');
  if (normalized.length > 120) throw new BadRequestException('TICKET_VIEW_NAME_TOO_LONG');
  return normalized;
}

function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function serializeSavedView(view: TicketSavedViewRecord) {
  return {
    id: view.id,
    workspaceId: view.workspaceId,
    name: view.name,
    scope: view.scope,
    ownerMembershipId: view.ownerMembershipId,
    filterSchemaVersion: view.filterSchemaVersion,
    filters: view.filters,
    sort: view.sort,
    createdByMembershipId: view.createdByMembershipId,
    updatedByMembershipId: view.updatedByMembershipId,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
  };
}

function asRecord(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function withoutUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function uniqueIds(values: string[]) {
  return [...new Set(values)];
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function serializeConversationEntry(entry: TicketConversationRecord) {
  return {
    id: entry.id,
    workspaceId: entry.workspaceId,
    ticketId: entry.ticketId,
    type: entry.type,
    body: entry.body,
    author: {
      membershipId: entry.authorMembership.id,
      displayName:
        entry.authorMembership.user.name ?? entry.authorMembership.user.email ?? 'Unknown',
      inactive: entry.authorMembership.status !== MembershipStatus.ACTIVE,
    },
    attachments: entry.attachments.map((link) => serializeConversationAttachment(link)),
    createdAt: entry.createdAt,
  };
}

function serializePendingFileAttachment(
  attachment: AttachmentCoreRecord,
  asset: AttachmentAssetRecord,
) {
  return {
    id: attachment.id,
    workspaceId: attachment.workspaceId,
    type: attachment.type,
    displayName: attachment.displayName ?? asset.displayName,
    url: null,
    file: serializeAttachmentAsset(asset),
    attachedAt: null,
    createdAt: attachment.createdAt,
    updatedAt: attachment.updatedAt,
  };
}

function serializeTicketAttachment(link: TicketAttachmentRecord) {
  const attachment = link.attachment;
  return {
    id: attachment.id,
    workspaceId: attachment.workspaceId,
    ticketId: link.ticketId,
    type: attachment.type,
    displayName: attachment.displayName ?? attachment.asset?.displayName ?? attachment.url,
    url: attachment.type === AttachmentType.URL ? attachment.url : null,
    file: attachment.asset ? serializeAttachmentAsset(attachment.asset) : null,
    attachedAt: link.createdAt,
    createdAt: attachment.createdAt,
    updatedAt: attachment.updatedAt,
    createdBy: attachment.createdBy,
    attachedBy: link.attachedBy,
  };
}

function serializeConversationAttachment(link: TicketConversationAttachmentRecord) {
  const attachment = link.attachment;
  return {
    id: attachment.id,
    workspaceId: attachment.workspaceId,
    type: attachment.type,
    displayName: attachment.displayName ?? attachment.asset?.displayName ?? attachment.url,
    url: attachment.type === AttachmentType.URL ? attachment.url : null,
    file: attachment.asset ? serializeAttachmentAsset(attachment.asset) : null,
    attachedAt: link.createdAt,
    createdAt: attachment.createdAt,
    updatedAt: attachment.updatedAt,
    createdBy: attachment.createdBy,
  };
}

function serializeAttachmentAsset(asset: AttachmentAssetRecord) {
  return {
    id: asset.id,
    workspaceId: asset.workspaceId,
    projectId: asset.projectId,
    originalFilename: asset.originalFilename,
    displayName: asset.displayName,
    mimeType: asset.mimeType,
    extension: asset.extension,
    sizeBytes: Number(asset.sizeBytes),
    checksum: asset.checksum,
    status: asset.status,
    uploadExpiresAt: asset.uploadExpiresAt,
    deletedAt: asset.deletedAt,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  };
}

function serializeTicketActivity(item: TicketActivityRecord) {
  return {
    id: item.id,
    action: item.action,
    entityType: item.entityType,
    entityId: item.entityId,
    actor: item.user
      ? { id: item.user.id, displayName: item.user.name ?? item.user.email, email: item.user.email }
      : null,
    metadata: safeActivityMetadata(item.metadata),
    createdAt: item.createdAt,
  };
}

function safeTicketReportFilters(query: TicketReportQueryDto) {
  const keys = [
    'queue',
    'search',
    'statusDefinitionId',
    'priority',
    'requesterType',
    'internalRequesterMembershipId',
    'departmentId',
    'assignedToMembershipId',
    'assignmentState',
    'createdFrom',
    'createdTo',
    'updatedFrom',
    'updatedTo',
    'slaMetric',
    'slaState',
    'slaDueFrom',
    'slaDueTo',
    'trendFrom',
    'trendTo',
    'bucket',
  ];
  return Object.fromEntries(
    keys
      .map((key) => [key, (query as unknown as Record<string, unknown>)[key]])
      .filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );
}

function slaSummary(counts: Record<string, number | undefined>) {
  const met = counts.MET ?? 0;
  const breached = counts.BREACHED ?? 0;
  const denominator = met + breached;
  return {
    NOT_CONFIGURED: counts.NOT_CONFIGURED ?? 0,
    RUNNING: counts.RUNNING ?? 0,
    PAUSED: counts.PAUSED ?? 0,
    MET: met,
    BREACHED: breached,
    NOT_APPLICABLE: counts.NOT_APPLICABLE ?? 0,
    complianceRate: denominator ? Math.round((met / denominator) * 10000) / 100 : null,
  };
}

function bucketDates(dates: Date[], timezone: string, bucket: TicketReportQueryDto['bucket']) {
  const counts = new Map<string, number>();
  for (const date of dates) {
    const zoned = DateTime.fromJSDate(date, { zone: 'utc' }).setZone(timezone);
    const key =
      bucket === 'MONTH'
        ? zoned.startOf('month').toFormat('yyyy-MM')
        : bucket === 'WEEK'
          ? zoned.startOf('week').toISODate()
          : zoned.toISODate();
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, count]) => ({ date, count }));
}

function toTicketCsv(rows: string[][]) {
  return `\uFEFF${rows.map((row) => row.map(ticketCsvCell).join(',')).join('\n')}`;
}

function ticketCsvCell(value: string) {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

function ticketExportTooLarge() {
  return new PayloadTooLargeException({
    code: 'TICKET_EXPORT_TOO_LARGE',
    message: 'TICKET_EXPORT_TOO_LARGE',
    details: { maxRows: TICKET_REPORT_EXPORT_MAX_ROWS },
  });
}

function safeActivityMetadata(value: Prisma.JsonValue) {
  const metadata = asRecord(value);
  const allowed = [
    'ticketId',
    'ticketNumber',
    'conversationEntryId',
    'type',
    'attachmentId',
    'attachmentCount',
    'assetId',
    'sizeBytes',
    'requestedCount',
    'changedCount',
    'unchangedCount',
    'from',
    'to',
    'field',
    'statusDefinitionId',
    'priority',
    'departmentId',
    'assignedToMembershipId',
    'escalationLevel',
    'previousEscalationLevel',
    'nextEscalationLevel',
    'metric',
  ];
  return Object.fromEntries(
    allowed.map((key) => [key, metadata[key]]).filter(([, value]) => value !== undefined),
  );
}

function normalizeAttachmentUrl(value: string) {
  const normalized = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new UnprocessableEntityException('Attachment URL is invalid.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new UnprocessableEntityException('Attachment URL must use http or https.');
  }
  if (normalized.length > 2048) {
    throw new UnprocessableEntityException('Attachment URL is too long.');
  }
  return parsed.toString();
}

function attachmentUrlDisplayName(url: string) {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}`;
}

function normalizeAttachmentDisplayName(value: string | undefined) {
  if (value === undefined) return undefined;
  const normalized = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  return normalized ? normalized.slice(0, 255) : undefined;
}

function sanitizeFilename(value: string) {
  const normalized = value.normalize('NFKC').trim();
  if (
    !normalized ||
    normalized.includes('..') ||
    /%(?:25)*(?:2e|2f|5c)/i.test(normalized) ||
    /[\\/\u2044\u2215\u2216\u29f5\u29f8\uFE68\uFF0F\uFF3C]/u.test(normalized) ||
    hasControlCharacters(normalized)
  ) {
    throw new UnprocessableEntityException('Invalid filename.');
  }
  return normalized.slice(0, 255);
}

function sanitizeMimeType(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i.test(normalized)) {
    throw new UnprocessableEntityException('Invalid MIME type.');
  }
  return normalized;
}

function extractExtension(filename: string) {
  const last = filename.lastIndexOf('.');
  if (last <= 0 || last === filename.length - 1) return null;
  const extension = filename
    .slice(last + 1)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return extension ? extension.slice(0, 24) : null;
}

function buildWorkspaceAssetStorageKey(
  workspaceId: string,
  assetId: string,
  extension: string | null,
) {
  const suffix = extension ? `.${extension}` : '';
  return `workspaces/${workspaceId}/assets/${assetId}/original${suffix}`;
}

function hasControlCharacters(value: string) {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

function sameRequester(current: TicketDetailRecord['requester'], next: NormalizedRequester) {
  if (!current || current.type !== next.type) return false;
  if (next.type === 'INTERNAL') {
    return current.internalMembershipId === next.internalMembershipId;
  }
  return (
    current.externalName === next.externalName &&
    current.externalEmail === next.externalEmail &&
    current.externalPhone === next.externalPhone
  );
}
