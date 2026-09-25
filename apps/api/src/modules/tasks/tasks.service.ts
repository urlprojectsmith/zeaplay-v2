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
  AssetLifecycle,
  AssetStatus,
  AttachmentType,
  AutomationDomainEventEntityType,
  AutomationTriggerType,
  DepartmentStatus,
  GamificationPointWorkType,
  GamificationWorkXpEventOutcome,
  GamificationWorkXpEventType,
  MembershipStatus,
  NotificationCategory,
  NotificationEntityType,
  NotificationType,
  Prisma,
  ProcessingJobStatus,
  ProjectStatus,
  ProjectVisibility,
  TaskCompletionApproverMode,
  TaskCompletionDecision,
  TaskCompletionProofRequirementMode,
  TaskCompletionProofType,
  TaskCompletionSubmissionStatus,
  TaskCommentReactionType,
  TaskCommentVisibility,
  StatusEntityType,
  TaskPriority,
  TaskRecurrenceEndMode,
  TaskRecurrenceStatus,
  TaskTemplateStatus,
  TaskTimeEntryStopReason,
  TaskTimeEntryType,
  WorkspaceTagStatus,
} from '@prisma/client';
import type { Queue } from 'bullmq';
import { DateTime } from 'luxon';
import { randomUUID } from 'node:crypto';
import { validateEnvironment } from '@zea-play/config';
import type { WorkspaceTenantContext } from '../../common/auth/auth.types';
import { PermissionKeys } from '../../common/authorization/permissions';
import { safeWorkspaceTimezone } from '../../common/timezones';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type { StorageAdapter } from '../../infrastructure/storage/storage-adapter';
import { STORAGE_ADAPTER } from '../../infrastructure/storage/storage.tokens';
import {
  ASSET_PROCESSING_JOB_TYPE,
  ASSET_PROCESSING_QUEUE,
} from '../../infrastructure/queue/queue.constants';
import { AuditService } from '../audit/audit.service';
import type { AutomationMutationContext } from '../automation/automation-action.types';
import { AutomationDomainEventsService } from '../automation/automation-domain-events.service';
import { UploadCompleteDto } from '../assets/dto/upload-complete.dto';
import { UploadInitDto } from '../assets/dto/upload-init.dto';
import { BillingEntitlementService } from '../billing/billing-entitlement.service';
import { GamificationService } from '../gamification/gamification.service';
import { NotificationReminderService } from '../notifications/notification-reminder.service';
import { NotificationRouterService } from '../notifications/notification-router.service';
import { RealtimeService } from '../realtime/realtime.service';
import {
  BulkTaskIdsDto,
  BulkTaskMembershipsDto,
  BulkTaskPriorityDto,
  BulkTaskStatusDto,
  CompletionPolicyDto,
  CompletionProofItemDto,
  CreateTaskCommentDto,
  CreateTaskFromTemplateDto,
  CreateTaskUrlAttachmentDto,
  CreateTaskDto,
  CreateTaskTemplateDto,
  CreateTaskTimeEntryDto,
  ReplaceTaskMembershipsDto,
  ReplaceTaskProjectsDto,
  ReplaceTaskWorkloadAllocationsDto,
  SaveTaskAsTemplateDto,
  TaskActivityQueryDto,
  TaskAttachmentIdsDto,
  TaskCalendarQueryDto,
  TaskCompletionDecisionDto,
  TaskCompletionQueryDto,
  TaskCommentReactionDto,
  TaskGanttQueryDto,
  TaskKanbanMoveDto,
  TaskReportsQueryDto,
  TaskRecurrenceQueryDto,
  TaskTagIdsDto,
  TaskTemplateQueryDto,
  TaskTimeReportQueryDto,
  TaskQueryDto,
  TaskRelationshipIdsDto,
  TaskWorkloadQueryDto,
  SubmitTaskCompletionDto,
  UpdateWorkspaceMemberCapacityDto,
  UpdateTaskRecurrenceDto,
  UpdateTaskScheduleDto,
  UpdateTaskKanbanColumnSettingDto,
  UpdateTaskCommentDto,
  UpdateTaskDto,
  UpdateTaskTemplateDto,
  UpdateTaskTimeEntryDto,
} from './dto/task.dto';
import {
  firstFutureOccurrenceAfter,
  firstOccurrence,
  localDateString,
  nextOccurrenceAfter,
  validateRecurrenceSchedule,
  type RecurrenceScheduleInput,
} from './task-recurrence-schedule';

const TASK_ATTACHMENT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const ASSET_JOB_VERSION = 1;
const KANBAN_RANK_STEP = new Prisma.Decimal(1024);
const KANBAN_RANK_SCALE = 12;
const COMPLETION_TEXT_MAX_LENGTH = 4000;
const COMPLETION_REASON_MAX_LENGTH = 1000;
const TASK_CSV_EXPORT_MAX_ROWS = 10_000;
const missingGamificationService = {
  evaluateTaskCompletionAchievements: () => Promise.resolve(undefined),
  handleTaskCreationXp: () => Promise.resolve(undefined),
  handleTaskCompletionXp: () => Promise.resolve(undefined),
  handleWorkCreationVoid: () => Promise.resolve(undefined),
  handleWorkReopen: () => Promise.resolve(undefined),
} as Pick<
  GamificationService,
  | 'evaluateTaskCompletionAchievements'
  | 'handleTaskCreationXp'
  | 'handleTaskCompletionXp'
  | 'handleWorkCreationVoid'
  | 'handleWorkReopen'
> as GamificationService;
const missingAutomationDomainEventsService = {
  recordDomainEventInTransaction: () => Promise.resolve({ id: null }),
  evaluateDomainEvent: () => Promise.resolve({ domainEventId: null, matched: 0 }),
} as unknown as AutomationDomainEventsService;
const missingNotificationsService = {
  route: () => Promise.resolve({ inApp: null, emailDeliveryId: null }),
} as unknown as NotificationRouterService;
const missingNotificationReminderService = {
  scheduleTaskReminders: () => Promise.resolve(undefined),
} as unknown as NotificationReminderService;
const missingRealtimeService = {
  publishWorkspace: () => Promise.resolve(undefined),
} as unknown as RealtimeService;

@Injectable()
export class TasksService {
  private readonly env = validateEnvironment(process.env);
  private readonly allowedMimeTypes = new Set(
    this.env.ALLOWED_MIME_TYPES.split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    @InjectQueue(ASSET_PROCESSING_QUEUE) private readonly queue: Queue,
    @Optional() private readonly gamification: GamificationService = missingGamificationService,
    @Optional()
    private readonly automationEvents: AutomationDomainEventsService = missingAutomationDomainEventsService,
    @Optional()
    private readonly notifications: NotificationRouterService = missingNotificationsService,
    @Optional()
    private readonly notificationReminders: NotificationReminderService = missingNotificationReminderService,
    @Optional()
    private readonly realtime: RealtimeService = missingRealtimeService,
    @Optional()
    private readonly billingEntitlements?: BillingEntitlementService,
  ) {}

  async create(
    tenant: WorkspaceTenantContext,
    dto: CreateTaskDto,
    automation?: AutomationMutationContext,
  ) {
    return this.createTask(tenant, dto, null, automation);
  }

  async createSubtask(tenant: WorkspaceTenantContext, parentTaskId: string, dto: CreateTaskDto) {
    await this.assertTask(tenant.workspaceId, parentTaskId);
    return this.createTask(tenant, dto, parentTaskId);
  }

  private async createTask(
    tenant: WorkspaceTenantContext,
    dto: CreateTaskDto,
    parentTaskId: string | null,
    automation?: AutomationMutationContext,
  ) {
    await this.billingEntitlements?.assertWorkspaceFeatureAvailable(
      tenant.workspaceId,
      'tasks.enabled',
    );
    const automationInvocationKey = automation?.invocationKey ?? null;
    if (automationInvocationKey) {
      const existing = await this.prisma.task.findFirst({
        where: {
          workspaceId: tenant.workspaceId,
          automationInvocationKey,
          deletedAt: null,
        },
        select: taskDetailSelect,
      });
      if (existing) return serializeTaskDetail(existing, tenant);
    }
    const title = normalizeTitle(dto.title);
    const status = await this.taskStatus(tenant.workspaceId, dto.statusDefinitionId);
    const department = await this.activeDepartment(tenant.workspaceId, dto.departmentId);
    const assigneeIds = await this.activeMembershipIds(
      tenant.workspaceId,
      dto.assigneeMembershipIds ?? [],
    );
    const followerIds = await this.activeMembershipIds(
      tenant.workspaceId,
      dto.followerMembershipIds ?? [],
    );
    const projectIds = await this.activeProjectIds(tenant, dto.projectIds ?? []);
    const tagIds = uniqueIds(dto.tagIds ?? []);
    if (tagIds.length > 0) {
      await this.assertWorkspaceTags(tenant.workspaceId, tagIds, true);
    }
    const workspaceTimezone = dto.recurrence
      ? await this.workspaceTimezone(tenant.workspaceId)
      : null;
    const recurrence = dto.recurrence
      ? normalizeRecurrenceInput(dto.recurrence, workspaceTimezone ?? undefined)
      : null;
    const firstScheduledFor = recurrence ? firstOccurrence(recurrence) : null;
    if (recurrence && !firstScheduledFor) {
      throw new BadRequestException('Recurrence schedule does not produce an occurrence.');
    }
    const plannedStartAt = parseOptionalDate(dto.plannedStartAt);
    const dueAt = firstScheduledFor?.toJSDate() ?? parseOptionalDate(dto.dueAt);
    validateTaskSchedule(plannedStartAt, dueAt);

    const { task, eventIds } = await this.prisma
      .$transaction(async (tx) => {
        if (parentTaskId) {
          await this.assertCanAttachToParent(
            tenant.workspaceId,
            parentTaskId,
            status.isTerminal,
            tx,
          );
        }
        const kanbanRank = await this.nextKanbanRank(tx, tenant.workspaceId, status.id);
        const series = recurrence
          ? await tx.taskRecurrenceSeries.create({
              data: {
                workspaceId: tenant.workspaceId,
                title,
                description: normalizeDescription(dto.description) ?? null,
                priority: dto.priority ?? TaskPriority.MEDIUM,
                statusDefinitionId: status.id,
                departmentId: department?.id ?? null,
                estimatedMinutes: dto.estimatedMinutes ?? null,
                timezone: recurrence.timezone,
                frequency: recurrence.frequency,
                interval: recurrence.interval,
                customIntervalUnit: recurrence.customIntervalUnit ?? null,
                startLocalDate: dateOnly(recurrence.startLocalDate),
                localTime: recurrence.localTime,
                selectedWeekdays: recurrence.selectedWeekdays ?? [],
                monthlyDay: recurrence.monthlyDay ?? null,
                endMode: recurrence.endMode,
                untilLocalDate: recurrence.untilLocalDate
                  ? dateOnly(recurrence.untilLocalDate)
                  : null,
                maxOccurrences: recurrence.maxOccurrences ?? null,
                generatedCount: 1,
                lastGeneratedAt: new Date(),
                nextOccurrenceAt:
                  nextOccurrenceAfter(recurrence, firstScheduledFor!.toJSDate(), 1)?.toJSDate() ??
                  null,
                status:
                  recurrence.endMode === TaskRecurrenceEndMode.AFTER_COUNT &&
                  recurrence.maxOccurrences === 1
                    ? TaskRecurrenceStatus.ENDED
                    : TaskRecurrenceStatus.ACTIVE,
                endedAt:
                  recurrence.endMode === TaskRecurrenceEndMode.AFTER_COUNT &&
                  recurrence.maxOccurrences === 1
                    ? new Date()
                    : null,
                createdById: tenant.userId,
              },
              select: { id: true },
            })
          : null;
        const created = await tx.task.create({
          data: {
            workspaceId: tenant.workspaceId,
            parentTaskId,
            title,
            description: normalizeDescription(dto.description),
            priority: dto.priority ?? TaskPriority.MEDIUM,
            statusDefinitionId: status.id,
            kanbanRank,
            departmentId: department?.id,
            estimatedMinutes: dto.estimatedMinutes ?? null,
            plannedStartAt,
            dueAt,
            recurrenceSeriesId: series?.id ?? null,
            recurrenceScheduledFor: firstScheduledFor?.toJSDate() ?? null,
            recurrenceSequence: series ? 1 : null,
            automationInvocationKey,
            createdById: tenant.userId,
          },
          select: { id: true },
        });
        if (series) {
          await this.replaceRecurrenceRelations(
            tx,
            series.id,
            tenant.workspaceId,
            assigneeIds,
            followerIds,
            projectIds,
            tagIds,
          );
        }
        if (assigneeIds.length > 0) {
          await tx.taskAssignee.createMany({
            data: assigneeIds.map((membershipId) => ({
              taskId: created.id,
              workspaceId: tenant.workspaceId,
              membershipId,
            })),
          });
          await this.notifyTaskAssigneesInTransaction(tx, tenant, created.id, title, assigneeIds);
        }
        if (followerIds.length > 0) {
          await tx.taskFollower.createMany({
            data: followerIds.map((membershipId) => ({
              taskId: created.id,
              workspaceId: tenant.workspaceId,
              membershipId,
            })),
          });
        }
        if (projectIds.length > 0) {
          await this.assertProjectsCanLinkTask(tx, tenant, projectIds);
          await tx.taskProject.createMany({
            data: projectIds.map((projectId) => ({
              taskId: created.id,
              workspaceId: tenant.workspaceId,
              projectId,
            })),
          });
        }
        if (tagIds.length > 0) {
          await tx.taskTag.createMany({
            data: tagIds.map((tagId) => ({
              taskId: created.id,
              workspaceId: tenant.workspaceId,
              tagId,
              createdById: tenant.userId,
            })),
            skipDuplicates: true,
          });
        }
        const task = await tx.task.findUniqueOrThrow({
          where: { id: created.id },
          select: taskDetailSelect,
        });
        const event = await this.automationEvents.recordDomainEventInTransaction(tx, {
          workspaceId: tenant.workspaceId,
          eventType: AutomationTriggerType.TASK_CREATED,
          entityType: AutomationDomainEventEntityType.TASK,
          entityId: task.id,
          actorMembershipId: tenant.workspaceMembershipId ?? null,
          occurredAt: task.createdAt,
          correlationId: automationCorrelationId(automation, `task:${task.id}:created`),
          causationId: automationCausationId(automation),
          automationDepth: automationDepth(automation),
          payload: {
            taskId: task.id,
            workspaceId: tenant.workspaceId,
            departmentId: task.department?.id ?? null,
            statusDefinitionId: task.statusDefinition.id,
            priority: task.priority,
            creatorMembershipId: tenant.workspaceMembershipId ?? null,
            assigneeMembershipIds: assigneeIds,
            plannedStartAt: task.plannedStartAt?.toISOString() ?? null,
            dueAt: task.dueAt?.toISOString() ?? null,
            occurredAt: task.createdAt.toISOString(),
          },
          idempotencyKey: `task:${task.id}:created`,
        });
        return { task, eventIds: event.id ? [event.id] : [] };
      }, serializableTransaction)
      .catch(mapHierarchyWriteError);

    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'task.created',
      entityType: 'Task',
      entityId: task.id,
      metadata: {
        ...relationCounts(assigneeIds, followerIds, projectIds),
        tagCount: tagIds.length,
        parentTaskId,
        recurring: Boolean(recurrence),
      },
    });
    await this.gamification.handleTaskCreationXp(
      tenant.workspaceId,
      task.id,
      tenant.workspaceMembershipId ?? null,
    );
    await this.evaluateAutomationEvents(eventIds);
    await this.scheduleTaskNotificationReminders(tenant.workspaceId, task);
    await this.realtime.publishWorkspace({
      eventType: 'TASK_CREATED',
      workspaceId: tenant.workspaceId,
      entityType: 'TASK',
      entityId: task.id,
      actorMembershipId: tenant.workspaceMembershipId,
      payload: {
        taskId: task.id,
        statusDefinitionId: task.statusDefinition.id,
        assigneeCount: assigneeIds.length,
        projectCount: projectIds.length,
      },
    });
    return serializeTaskDetail(task, tenant);
  }

  async list(tenant: WorkspaceTenantContext, query: TaskQueryDto) {
    const where = this.taskWhere(tenant, query);
    const orderBy = taskOrderBy(query.sortBy, query.sortDirection);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.task.findMany({
        where,
        select: taskListSelect,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.task.count({ where }),
    ]);
    return {
      items: items.map((task) => serializeTaskListItem(task, tenant)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async getActiveTimer(userId: string) {
    const entry = await this.prisma.taskTimeEntry.findFirst({
      where: {
        userId,
        entryType: TaskTimeEntryType.TIMER,
        endedAt: null,
        deletedAt: null,
      },
      select: timeEntrySelect,
    });
    return entry ? serializeTimeEntry(entry) : null;
  }

  async startTimer(
    tenant: WorkspaceTenantContext,
    taskId: string,
    dto: { replaceRunning?: boolean },
  ) {
    const membershipId = this.requireWorkspaceMembership(tenant);
    this.assertPermission(tenant, PermissionKeys.taskTimeTrack);
    const now = new Date();
    const result = await this.prisma
      .$transaction(async (tx) => {
        await lockUser(tx, tenant.userId);
        const task = await tx.task.findFirst({
          where: { id: taskId, workspaceId: tenant.workspaceId, deletedAt: null },
          select: { id: true, title: true, statusDefinition: { select: { isTerminal: true } } },
        });
        if (!task) throw new NotFoundException('Task not found.');
        if (task.statusDefinition.isTerminal) throw new ConflictException('TASK_NOT_TRACKABLE');
        const active = await tx.taskTimeEntry.findFirst({
          where: {
            userId: tenant.userId,
            entryType: TaskTimeEntryType.TIMER,
            endedAt: null,
            deletedAt: null,
          },
          select: timeEntrySelect,
        });
        if (active && !dto.replaceRunning) {
          throw new ConflictException({
            code: 'ACTIVE_TIMER_EXISTS',
            activeTimer: safeActiveTimerSummary(active),
          });
        }
        if (active) {
          await this.stopTimeEntryInTransaction(
            tx,
            active.id,
            now,
            TaskTimeEntryStopReason.SWITCHED_TASK,
            active.workspaceMembershipId,
          );
        }
        const created = await tx.taskTimeEntry.create({
          data: {
            workspaceId: tenant.workspaceId,
            taskId,
            userId: tenant.userId,
            workspaceMembershipId: membershipId,
            createdByMembershipId: membershipId,
            entryType: TaskTimeEntryType.TIMER,
            startedAt: now,
          },
          select: timeEntrySelect,
        });
        await tx.auditLog.create({
          data: {
            superAgencyId: tenant.superAgencyId,
            agencyId: tenant.agencyId,
            workspaceId: tenant.workspaceId,
            userId: tenant.userId,
            action: active ? 'task.time_switched' : 'task.time_started',
            entityType: 'TaskTimeEntry',
            entityId: created.id,
            metadata: {
              taskId,
              timeEntryId: created.id,
              membershipId,
              previousTimeEntryId: active?.id,
              stopReason: active ? TaskTimeEntryStopReason.SWITCHED_TASK : undefined,
            },
          },
        });
        return created;
      }, serializableTransaction)
      .catch(mapTimeWriteError);
    return serializeTimeEntry(result);
  }

  async stopMyActiveTimer(userId: string) {
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      await lockUser(tx, userId);
      const active = await tx.taskTimeEntry.findFirst({
        where: { userId, entryType: TaskTimeEntryType.TIMER, endedAt: null, deletedAt: null },
        select: timeEntrySelect,
      });
      if (!active) return null;
      const stopped = await this.stopTimeEntryInTransaction(
        tx,
        active.id,
        now,
        TaskTimeEntryStopReason.USER,
        active.workspaceMembershipId,
      );
      await tx.auditLog.create({
        data: {
          superAgencyId: active.workspace.agency.superAgencyId,
          agencyId: active.workspace.agencyId,
          workspaceId: active.workspaceId,
          userId,
          action: 'task.time_stopped',
          entityType: 'TaskTimeEntry',
          entityId: active.id,
          metadata: {
            taskId: active.taskId,
            timeEntryId: active.id,
            membershipId: active.workspaceMembershipId,
            durationSeconds: stopped.durationSeconds,
            stopReason: TaskTimeEntryStopReason.USER,
          },
        },
      });
      return stopped;
    });
    return result ? serializeTimeEntry(result) : null;
  }

  async createManualTimeEntry(
    tenant: WorkspaceTenantContext,
    taskId: string,
    dto: CreateTaskTimeEntryDto,
  ) {
    const actorMembershipId = this.requireWorkspaceMembership(tenant);
    this.assertPermission(tenant, PermissionKeys.taskTimeTrack);
    const targetMembershipId = dto.workspaceMembershipId ?? actorMembershipId;
    if (targetMembershipId !== actorMembershipId) {
      this.assertPermission(tenant, PermissionKeys.taskTimeManage);
    }
    const normalized = normalizeCompletedTimeRange(dto);
    await this.assertTask(tenant.workspaceId, taskId);
    const target = await this.prisma.workspaceMembership.findFirst({
      where: {
        id: targetMembershipId,
        workspaceId: tenant.workspaceId,
        status: MembershipStatus.ACTIVE,
      },
      select: { id: true, userId: true },
    });
    if (!target) throw new NotFoundException('Workspace member not found.');
    const entry = await this.prisma.taskTimeEntry.create({
      data: {
        workspaceId: tenant.workspaceId,
        taskId,
        userId: target.userId,
        workspaceMembershipId: target.id,
        createdByMembershipId: actorMembershipId,
        entryType: TaskTimeEntryType.MANUAL,
        startedAt: normalized.startedAt,
        endedAt: normalized.endedAt,
        durationSeconds: normalized.durationSeconds,
      },
      select: timeEntrySelect,
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'task.time_manual_added',
      entityType: 'TaskTimeEntry',
      entityId: entry.id,
      metadata: {
        taskId,
        timeEntryId: entry.id,
        membershipId: target.id,
        durationSeconds: entry.durationSeconds,
      },
    });
    return serializeTimeEntry(entry);
  }

  async listTaskTimeEntries(
    tenant: WorkspaceTenantContext,
    taskId: string,
    query: TaskTimeReportQueryDto,
  ) {
    await this.assertTask(tenant.workspaceId, taskId);
    return this.timeReport(tenant, { ...query, taskId });
  }

  async updateTimeEntry(
    tenant: WorkspaceTenantContext,
    taskId: string,
    timeEntryId: string,
    dto: UpdateTaskTimeEntryDto,
  ) {
    const actorMembershipId = this.requireWorkspaceMembership(tenant);
    const entry = await this.prisma.taskTimeEntry.findFirst({
      where: { id: timeEntryId, workspaceId: tenant.workspaceId, taskId, deletedAt: null },
      select: timeEntrySelect,
    });
    if (!entry) throw new NotFoundException('Time entry not found.');
    if (!entry.endedAt) throw new ConflictException('TIME_ENTRY_NOT_RUNNING');
    this.assertTimeEntryMutationAllowed(
      tenant,
      entry.workspaceMembershipId,
      PermissionKeys.taskTimeEditOwn,
    );
    const normalized = normalizeCompletedTimeRange(dto);
    const updated = await this.prisma.taskTimeEntry.update({
      where: { id: timeEntryId },
      data: {
        startedAt: normalized.startedAt,
        endedAt: normalized.endedAt,
        durationSeconds: normalized.durationSeconds,
        updatedByMembershipId: actorMembershipId,
      },
      select: timeEntrySelect,
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'task.time_updated',
      entityType: 'TaskTimeEntry',
      entityId: timeEntryId,
      metadata: {
        taskId,
        timeEntryId,
        membershipId: entry.workspaceMembershipId,
        durationSeconds: updated.durationSeconds,
      },
    });
    return serializeTimeEntry(updated);
  }

  async deleteTimeEntry(tenant: WorkspaceTenantContext, taskId: string, timeEntryId: string) {
    const actorMembershipId = this.requireWorkspaceMembership(tenant);
    const entry = await this.prisma.taskTimeEntry.findFirst({
      where: { id: timeEntryId, workspaceId: tenant.workspaceId, taskId, deletedAt: null },
      select: timeEntrySelect,
    });
    if (!entry) throw new NotFoundException('Time entry not found.');
    if (!entry.endedAt) throw new ConflictException('TIME_ENTRY_NOT_RUNNING');
    this.assertTimeEntryMutationAllowed(
      tenant,
      entry.workspaceMembershipId,
      PermissionKeys.taskTimeDeleteOwn,
    );
    const deletedAt = new Date();
    await this.prisma.taskTimeEntry.update({
      where: { id: timeEntryId },
      data: { deletedAt, deletedByMembershipId: actorMembershipId },
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'task.time_deleted',
      entityType: 'TaskTimeEntry',
      entityId: timeEntryId,
      metadata: {
        taskId,
        timeEntryId,
        membershipId: entry.workspaceMembershipId,
        durationSeconds: entry.durationSeconds,
      },
    });
    return { changed: true };
  }

  async timeReport(tenant: WorkspaceTenantContext, query: TaskTimeReportQueryDto) {
    const canViewAll = this.hasPermission(tenant, PermissionKeys.taskTimeViewAll);
    const ownMembershipId = this.requireWorkspaceMembership(tenant);
    if (!canViewAll) this.assertPermission(tenant, PermissionKeys.taskTimeViewOwn);
    const timezone = await this.workspaceTimezone(tenant.workspaceId);
    const range = reportDateWindow(query, timezone);
    const from = range.from;
    const to = range.to;
    if (from && to && to <= from) throw new BadRequestException('INVALID_TIME_RANGE');
    const where: Prisma.TaskTimeEntryWhereInput = {
      workspaceId: tenant.workspaceId,
      deletedAt: null,
      ...(query.taskId ? { taskId: query.taskId } : {}),
      ...(query.entryType ? { entryType: query.entryType } : {}),
      ...(canViewAll
        ? query.workspaceMembershipId
          ? { workspaceMembershipId: query.workspaceMembershipId }
          : {}
        : { workspaceMembershipId: ownMembershipId }),
      ...(from || to
        ? {
            startedAt: {
              ...(to ? (range.toExclusive ? { lt: to } : { lte: to }) : {}),
            },
            OR: [{ endedAt: null }, { endedAt: { ...(from ? { gte: from } : {}) } }],
          }
        : {}),
    };
    const asOf = new Date();
    const [items, total] = await this.prisma.$transaction([
      this.prisma.taskTimeEntry.findMany({
        where,
        select: timeEntrySelect,
        orderBy: { startedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.taskTimeEntry.count({ where }),
    ]);
    const totalDurationSeconds = await this.timeReportTotalSeconds(tenant, {
      taskId: query.taskId,
      workspaceMembershipId: canViewAll ? query.workspaceMembershipId : ownMembershipId,
      entryType: query.entryType,
      from,
      to,
      asOf,
    });
    return {
      items: items.map(serializeTimeEntry),
      page: query.page,
      pageSize: query.pageSize,
      total,
      summary: { totalDurationSeconds, asOf, timezone },
    };
  }

  async replaceWorkloadAllocations(
    tenant: WorkspaceTenantContext,
    taskId: string,
    dto: ReplaceTaskWorkloadAllocationsDto,
  ) {
    this.assertPermission(tenant, PermissionKeys.tasksManage);
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, workspaceId: tenant.workspaceId, deletedAt: null },
      select: { id: true, estimatedMinutes: true, assignees: { select: { membershipId: true } } },
    });
    if (!task) throw new NotFoundException('Task not found.');
    if (task.estimatedMinutes === null) throw new BadRequestException('ESTIMATE_REQUIRED');
    const allocationMemberIds = uniqueIds(
      dto.allocations.map((item) => item.workspaceMembershipId),
    );
    const assigneeIds = new Set(task.assignees.map((item) => item.membershipId));
    if (allocationMemberIds.some((membershipId) => !assigneeIds.has(membershipId))) {
      throw new BadRequestException('INVALID_ALLOCATION_MEMBER');
    }
    const totalPlanned = dto.allocations.reduce((sum, item) => sum + item.plannedMinutes, 0);
    if (totalPlanned > task.estimatedMinutes)
      throw new BadRequestException('ALLOCATION_EXCEEDS_ESTIMATE');
    await this.prisma.$transaction(async (tx) => {
      await tx.taskWorkloadAllocation.deleteMany({
        where: { workspaceId: tenant.workspaceId, taskId },
      });
      if (dto.allocations.length > 0) {
        await tx.taskWorkloadAllocation.createMany({
          data: dto.allocations.map((item) => ({
            workspaceId: tenant.workspaceId,
            taskId,
            workspaceMembershipId: item.workspaceMembershipId,
            plannedMinutes: item.plannedMinutes,
          })),
        });
      }
      await tx.auditLog.create({
        data: {
          superAgencyId: tenant.superAgencyId,
          agencyId: tenant.agencyId,
          workspaceId: tenant.workspaceId,
          userId: tenant.userId,
          action: 'task.workload_allocations_updated',
          entityType: 'Task',
          entityId: taskId,
          metadata: {
            taskId,
            allocationCount: dto.allocations.length,
            plannedMinutes: totalPlanned,
          },
        },
      });
    }, serializableTransaction);
    return this.getTaskWorkloadAllocations(tenant, taskId);
  }

  async getTaskWorkloadAllocations(tenant: WorkspaceTenantContext, taskId: string) {
    await this.assertTask(tenant.workspaceId, taskId);
    const allocations = await this.prisma.taskWorkloadAllocation.findMany({
      where: { workspaceId: tenant.workspaceId, taskId },
      select: { workspaceMembershipId: true, plannedMinutes: true, updatedAt: true },
      orderBy: { workspaceMembershipId: 'asc' },
    });
    return { taskId, allocations };
  }

  async updateMemberCapacity(
    tenant: WorkspaceTenantContext,
    workspaceMembershipId: string,
    dto: UpdateWorkspaceMemberCapacityDto,
  ) {
    this.assertPermission(tenant, PermissionKeys.tasksManage);
    const membership = await this.prisma.workspaceMembership.findFirst({
      where: {
        id: workspaceMembershipId,
        workspaceId: tenant.workspaceId,
        status: MembershipStatus.ACTIVE,
      },
      select: { id: true },
    });
    if (!membership) throw new NotFoundException('Workspace member not found.');
    const capacity = await this.prisma.workspaceMemberCapacity.upsert({
      where: {
        workspaceId_workspaceMembershipId: {
          workspaceId: tenant.workspaceId,
          workspaceMembershipId,
        },
      },
      create: {
        workspaceId: tenant.workspaceId,
        workspaceMembershipId,
        weeklyCapacityMinutes: dto.weeklyCapacityMinutes,
      },
      update: { weeklyCapacityMinutes: dto.weeklyCapacityMinutes },
      select: { workspaceMembershipId: true, weeklyCapacityMinutes: true, updatedAt: true },
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'task.workload_capacity_updated',
      entityType: 'WorkspaceMembership',
      entityId: workspaceMembershipId,
      metadata: {
        membershipId: workspaceMembershipId,
        weeklyCapacityMinutes: dto.weeklyCapacityMinutes,
      },
    });
    return capacity;
  }

  async workload(tenant: WorkspaceTenantContext, query: TaskWorkloadQueryDto) {
    this.assertPermission(tenant, PermissionKeys.tasksView);
    const timezone = await this.workspaceTimezone(tenant.workspaceId);
    const window = workloadWindow(query, timezone);
    const [members, tasks] = await this.prisma.$transaction([
      this.prisma.workspaceMembership.findMany({
        where: { workspaceId: tenant.workspaceId, status: MembershipStatus.ACTIVE },
        select: {
          id: true,
          user: { select: { id: true, name: true, email: true } },
          workspaceMemberCapacity: { select: { weeklyCapacityMinutes: true } },
        },
        orderBy: { createdAt: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.task.findMany({
        where: {
          workspaceId: tenant.workspaceId,
          deletedAt: null,
          estimatedMinutes: { not: null },
          statusDefinition: { isTerminal: false },
        },
        select: {
          id: true,
          title: true,
          dueAt: true,
          estimatedMinutes: true,
          assignees: { select: { membershipId: true } },
          workloadAllocations: { select: { workspaceMembershipId: true, plannedMinutes: true } },
        },
      }),
    ]);
    const memberIds = new Set(members.map((member) => member.id));
    const planned = new Map<string, number>();
    let unallocatedMinutes = 0;
    let unscheduledMinutes = 0;
    let overdueMinutes = 0;
    for (const task of tasks) {
      const estimate = task.estimatedMinutes ?? 0;
      if (estimate <= 0) continue;
      const distribution = distributePlannedMinutes(task, estimate);
      if (!task.dueAt) {
        unscheduledMinutes += estimate;
        continue;
      }
      if (task.dueAt < window.start) {
        overdueMinutes += estimate;
        continue;
      }
      if (task.dueAt < window.start || task.dueAt >= window.end) continue;
      for (const [membershipId, minutes] of distribution.byMember) {
        if (memberIds.has(membershipId))
          planned.set(membershipId, (planned.get(membershipId) ?? 0) + minutes);
      }
      unallocatedMinutes += distribution.unallocatedMinutes;
    }
    return {
      view: query.view,
      window,
      items: members.map((member) => {
        const weeklyCapacity = member.workspaceMemberCapacity?.weeklyCapacityMinutes ?? 2400;
        const capacityMinutes =
          query.view === 'DAY'
            ? dailyCapacityMinutes(weeklyCapacity, window.start, window.timezone)
            : weeklyCapacity;
        const plannedMinutes = planned.get(member.id) ?? 0;
        return {
          membershipId: member.id,
          user: member.user,
          plannedMinutes,
          capacityMinutes,
          weeklyCapacityMinutes: weeklyCapacity,
          utilization: utilizationPercent(plannedMinutes, capacityMinutes),
          state: workloadState(plannedMinutes, capacityMinutes),
        };
      }),
      page: query.page,
      pageSize: query.pageSize,
      total: await this.prisma.workspaceMembership.count({
        where: { workspaceId: tenant.workspaceId, status: MembershipStatus.ACTIVE },
      }),
      summary: { unallocatedMinutes, unscheduledMinutes, overdueMinutes },
    };
  }

  async calendar(tenant: WorkspaceTenantContext, query: TaskCalendarQueryDto) {
    const timezone = await this.workspaceTimezone(tenant.workspaceId);
    const window = calendarWindow(query.view, query.date, timezone);
    const where = {
      ...this.taskViewWhere(tenant, query),
      dueAt: { gte: window.start, lt: window.end },
    } satisfies Prisma.TaskWhereInput;
    const [summaryTasks, visibleTasks, total] = await this.prisma.$transaction([
      this.prisma.task.findMany({
        where,
        select: {
          id: true,
          priority: true,
          dueAt: true,
          statusDefinition: { select: { id: true, name: true, color: true, isTerminal: true } },
        },
        orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      }),
      query.view === 'MONTH'
        ? this.prisma.task.findMany({
            where: { id: { in: [] } },
            select: taskListSelect,
          })
        : this.prisma.task.findMany({
            where,
            select: taskListSelect,
            orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
            skip: (query.page - 1) * query.pageSize,
            take: query.pageSize,
          }),
      this.prisma.task.count({ where }),
    ]);
    const now = new Date();
    const days = calendarDays(window.start, window.end, timezone).map((date) => ({
      date,
      total: 0,
      open: 0,
      completed: 0,
      overdue: 0,
      priorityCounts: priorityCountSeed(),
      statusCounts: [] as { statusId: string; name: string; color: string; count: number }[],
      tasks: [] as (ReturnType<typeof serializeTaskListItem> & {
        urgency: 'SAFE' | 'WARNING' | 'OVERDUE';
      })[],
    }));
    const dayByDate = new Map(days.map((day) => [day.date, day]));
    for (const task of summaryTasks) {
      if (!task.dueAt) continue;
      const key = DateTime.fromJSDate(task.dueAt, { zone: timezone }).toISODate()!;
      const day = dayByDate.get(key);
      if (!day) continue;
      day.total += 1;
      if (task.statusDefinition.isTerminal) day.completed += 1;
      else day.open += 1;
      if (calendarUrgency(task.dueAt, task.statusDefinition.isTerminal, now) === 'OVERDUE') {
        day.overdue += 1;
      }
      day.priorityCounts[task.priority] += 1;
      const status = day.statusCounts.find((item) => item.statusId === task.statusDefinition.id);
      if (status) status.count += 1;
      else
        day.statusCounts.push({
          statusId: task.statusDefinition.id,
          name: task.statusDefinition.name,
          color: task.statusDefinition.color,
          count: 1,
        });
    }
    for (const task of visibleTasks) {
      if (!task.dueAt) continue;
      const key = DateTime.fromJSDate(task.dueAt, { zone: timezone }).toISODate()!;
      const day = dayByDate.get(key);
      if (!day) continue;
      const item = serializeTaskListItem(task, tenant) as ReturnType<
        typeof serializeTaskListItem
      > & {
        urgency: 'SAFE' | 'WARNING' | 'OVERDUE';
      };
      day.tasks.push({
        ...item,
        urgency: calendarUrgency(task.dueAt, task.statusDefinition.isTerminal, now),
      });
    }
    return {
      view: query.view,
      window: { ...window, timezone },
      days,
      page: query.view === 'MONTH' ? 1 : query.page,
      pageSize: query.view === 'MONTH' ? days.length : query.pageSize,
      total,
    };
  }

  async gantt(tenant: WorkspaceTenantContext, query: TaskGanttQueryDto) {
    const timezone = await this.workspaceTimezone(tenant.workspaceId);
    const from = parseRequiredDate(query.from, 'INVALID_GANTT_RANGE');
    const to = parseRequiredDate(query.to, 'INVALID_GANTT_RANGE');
    if (to <= from) throw new BadRequestException('INVALID_GANTT_RANGE');
    const baseWhere = this.taskViewWhere(tenant, query);
    const scheduledWhere = {
      ...baseWhere,
      plannedStartAt: { not: null, lt: to },
      dueAt: { not: null, gte: from },
    } satisfies Prisma.TaskWhereInput;
    const unscheduledWhere = {
      ...baseWhere,
      OR: [{ plannedStartAt: null }, { dueAt: null }],
    } satisfies Prisma.TaskWhereInput;
    const [items, total, unscheduledItems, unscheduledCount] = await this.prisma.$transaction([
      this.prisma.task.findMany({
        where: scheduledWhere,
        select: taskListSelect,
        orderBy: [{ plannedStartAt: 'asc' }, { dueAt: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.task.count({ where: scheduledWhere }),
      this.prisma.task.findMany({
        where: unscheduledWhere,
        select: taskListSelect,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        take: 10,
      }),
      this.prisma.task.count({
        where: unscheduledWhere,
      }),
    ]);
    const taskIds = items.map((task) => task.id);
    const dependencies = taskIds.length
      ? await this.prisma.taskDependency.findMany({
          where: {
            workspaceId: tenant.workspaceId,
            blockerTaskId: { in: taskIds },
            blockedTaskId: { in: taskIds },
            blockerTask: { deletedAt: null },
            blockedTask: { deletedAt: null },
          },
          select: { blockerTaskId: true, blockedTaskId: true },
        })
      : [];
    return {
      window: { from, to, timezone },
      items: items.map((task) => serializeTaskListItem(task, tenant)),
      dependencies,
      unscheduledItems: unscheduledItems.map((task) => serializeTaskListItem(task, tenant)),
      unscheduledCount,
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async updateSchedule(tenant: WorkspaceTenantContext, taskId: string, dto: UpdateTaskScheduleDto) {
    const task = await this.prisma
      .$transaction(async (tx) => {
        const existing = await this.assertTask(tenant.workspaceId, taskId, tx);
        const plannedStartAt =
          dto.plannedStartAt === undefined
            ? existing.plannedStartAt
            : parseOptionalDate(dto.plannedStartAt);
        const dueAt = dto.dueAt === undefined ? existing.dueAt : parseOptionalDate(dto.dueAt);
        validateTaskSchedule(plannedStartAt, dueAt);
        return tx.task.update({
          where: { id: taskId, workspaceId: tenant.workspaceId },
          data: {
            plannedStartAt: dto.plannedStartAt === undefined ? undefined : plannedStartAt,
            dueAt: dto.dueAt === undefined ? undefined : dueAt,
            updatedById: tenant.userId,
          },
          select: taskDetailSelect,
        });
      }, serializableTransaction)
      .catch(mapHierarchyWriteError);
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'task.schedule_updated',
      entityType: 'Task',
      entityId: taskId,
      metadata: {
        changed: Object.keys(dto).filter((key) => dto[key as keyof typeof dto] !== undefined),
      },
    });
    await this.scheduleTaskNotificationReminders(tenant.workspaceId, task);
    return serializeTaskDetail(task, tenant);
  }

  async reportsSummary(tenant: WorkspaceTenantContext, query: TaskReportsQueryDto) {
    const timezone = await this.workspaceTimezone(tenant.workspaceId);
    const where = this.reportWhere(tenant, query, timezone);
    const total = await this.prisma.task.count({ where });
    if (total > TASK_CSV_EXPORT_MAX_ROWS) {
      throw exportTooLarge();
    }
    const tasks = await this.prisma.task.findMany({
      where,
      select: {
        id: true,
        priority: true,
        estimatedMinutes: true,
        dueAt: true,
        pendingCompletionSubmissionId: true,
        statusDefinition: { select: { id: true, name: true, color: true, isTerminal: true } },
        department: { select: { id: true, name: true } },
        assignees: {
          select: {
            membershipId: true,
            membership: { select: { user: { select: { name: true, email: true } } } },
          },
        },
        projects: { select: { projectId: true, project: { select: { name: true } } } },
      },
    });
    const now = new Date();
    const totalTasks = tasks.length;
    const completed = tasks.filter((task) => task.statusDefinition.isTerminal).length;
    const open = totalTasks - completed;
    const overdue = tasks.filter(
      (task) => task.dueAt && task.dueAt < now && !task.statusDefinition.isTerminal,
    ).length;
    const pendingApproval = tasks.filter((task) => task.pendingCompletionSubmissionId).length;
    const taskIds = tasks.map((task) => task.id);
    const trackedSeconds = await this.reportTrackedSeconds(tenant, taskIds);
    return {
      timezone,
      kpis: {
        totalTasks,
        open,
        completed,
        overdue,
        pendingApproval,
        completionRate: totalTasks ? Math.round((completed / totalTasks) * 10000) / 100 : 0,
      },
      distributions: {
        status: aggregateBy(
          tasks,
          (task) => task.statusDefinition.id,
          (task) => ({
            statusId: task.statusDefinition.id,
            name: task.statusDefinition.name,
            color: task.statusDefinition.color,
          }),
        ),
        priority: priorityDistribution(tasks),
        assignees: assigneeBreakdown(tasks),
        departments: aggregateBy(
          tasks,
          (task) => task.department?.id ?? 'unassigned',
          (task) => ({
            departmentId: task.department?.id ?? null,
            name: task.department?.name ?? 'Unassigned',
          }),
        ),
        projects: projectBreakdown(tasks),
      },
      completionTrend: await this.completionTrend(
        tenant.workspaceId,
        query,
        timezone,
        tasks.map((task) => task.id),
      ),
      time: {
        estimatedMinutes: tasks.reduce((sum, task) => sum + (task.estimatedMinutes ?? 0), 0),
        trackedSeconds: trackedSeconds.value,
        trackedTimeRestricted: trackedSeconds.restricted,
      },
      semantics: {
        assigneeBreakdown: 'Counts Task assignments, not unique Tasks across all assignees.',
        projectBreakdown:
          'Counts Task-Project relationships, not unique Tasks across all Projects.',
        completionTrend: 'Counts immutable terminal completion events from audit history.',
      },
    };
  }

  async reportsCsv(tenant: WorkspaceTenantContext, query: TaskReportsQueryDto) {
    const summary = await this.reportsSummary(tenant, query);
    const timezone = await this.workspaceTimezone(tenant.workspaceId);
    const where = this.reportWhere(tenant, query, timezone);
    const tasks = await this.prisma.task.findMany({
      where,
      select: {
        title: true,
        priority: true,
        plannedStartAt: true,
        dueAt: true,
        estimatedMinutes: true,
        statusDefinition: { select: { name: true, category: true } },
      },
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: TASK_CSV_EXPORT_MAX_ROWS,
    });
    return {
      filename: 'task-report.csv',
      contentType: 'text/csv; charset=utf-8',
      csv: toCsv([
        ['Metric', 'Value'],
        ['Total Tasks', String(summary.kpis.totalTasks)],
        ['Open Tasks', String(summary.kpis.open)],
        ['Completed Tasks', String(summary.kpis.completed)],
        ['Overdue Tasks', String(summary.kpis.overdue)],
        ['Pending Approval', String(summary.kpis.pendingApproval)],
        ['Completion Rate', String(summary.kpis.completionRate)],
        ['Estimated Minutes', String(summary.time.estimatedMinutes)],
        [
          'Tracked Seconds',
          summary.time.trackedSeconds === null ? 'Restricted' : String(summary.time.trackedSeconds),
        ],
        [],
        [
          'Task Title',
          'Status',
          'Status Category',
          'Priority',
          'Planned Start',
          'Due',
          'Estimated Minutes',
        ],
        ...tasks.map((task) => [
          task.title,
          task.statusDefinition.name,
          task.statusDefinition.category,
          task.priority,
          task.plannedStartAt?.toISOString() ?? '',
          task.dueAt?.toISOString() ?? '',
          String(task.estimatedMinutes ?? ''),
        ]),
      ]),
    };
  }

  async activity(tenant: WorkspaceTenantContext, query: TaskActivityQueryDto) {
    const timezone = await this.workspaceTimezone(tenant.workspaceId);
    const where = activityWhere(tenant.workspaceId, query, timezone);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        select: {
          id: true,
          createdAt: true,
          action: true,
          entityType: true,
          entityId: true,
          metadata: true,
          user: { select: { id: true, email: true, name: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return {
      timezone,
      items: items.map(safeActivityItem),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async activityCsv(tenant: WorkspaceTenantContext, query: TaskActivityQueryDto) {
    const where = activityWhere(
      tenant.workspaceId,
      { ...query, page: 1, pageSize: 100 },
      await this.workspaceTimezone(tenant.workspaceId),
    );
    const total = await this.prisma.auditLog.count({ where });
    if (total > TASK_CSV_EXPORT_MAX_ROWS) {
      throw exportTooLarge();
    }
    const items = await this.prisma.auditLog.findMany({
      where,
      select: {
        createdAt: true,
        action: true,
        entityType: true,
        entityId: true,
        user: { select: { email: true, name: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: TASK_CSV_EXPORT_MAX_ROWS,
    });
    return {
      filename: 'task-activity.csv',
      contentType: 'text/csv; charset=utf-8',
      csv: toCsv([
        ['Timestamp', 'Actor', 'Task ID', 'Action', 'Safe Summary'],
        ...items.map((item) => [
          item.createdAt.toISOString(),
          item.user?.name ?? item.user?.email ?? '',
          item.entityType === 'Task' ? (item.entityId ?? '') : '',
          item.action,
          `${item.entityType} ${item.action}`,
        ]),
      ]),
    };
  }

  async listRecurrenceSeries(tenant: WorkspaceTenantContext, query: TaskRecurrenceQueryDto) {
    const where: Prisma.TaskRecurrenceSeriesWhereInput = {
      workspaceId: tenant.workspaceId,
      status: query.status,
      ...(query.search
        ? { title: { contains: query.search.trim(), mode: Prisma.QueryMode.insensitive } }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.taskRecurrenceSeries.findMany({
        where,
        select: taskRecurrenceSeriesSelect,
        orderBy: { [query.sortBy]: query.sortDirection },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.taskRecurrenceSeries.count({ where }),
    ]);
    return {
      items: items.map(serializeTaskRecurrenceSeries),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async makeRecurring(
    tenant: WorkspaceTenantContext,
    taskId: string,
    dto: UpdateTaskRecurrenceDto,
  ) {
    const recurrence = normalizeRecurrenceInput(
      dto,
      await this.workspaceTimezone(tenant.workspaceId),
    );
    const firstScheduledFor = firstOccurrence(recurrence);
    if (!firstScheduledFor)
      throw new BadRequestException('Recurrence schedule does not produce an occurrence.');
    const existing = await this.prisma.task.findFirst({
      where: { id: taskId, workspaceId: tenant.workspaceId, deletedAt: null },
      select: {
        id: true,
        title: true,
        description: true,
        priority: true,
        statusDefinitionId: true,
        departmentId: true,
        recurrenceSeriesId: true,
        assignees: { select: { membershipId: true } },
        followers: { select: { membershipId: true } },
        projects: { select: { projectId: true } },
        tags: { select: { tagId: true } },
      },
    });
    if (!existing) throw new NotFoundException('Task not found.');
    if (existing.recurrenceSeriesId) throw new ConflictException('Task is already recurring.');
    const assigneeIds = dto.assigneeMembershipIds
      ? await this.activeMembershipIds(tenant.workspaceId, dto.assigneeMembershipIds)
      : existing.assignees.map((item) => item.membershipId);
    const followerIds = dto.followerMembershipIds
      ? await this.activeMembershipIds(tenant.workspaceId, dto.followerMembershipIds)
      : existing.followers.map((item) => item.membershipId);
    const projectIds = dto.projectIds
      ? await this.activeProjectIds(tenant, dto.projectIds)
      : existing.projects.map((item) => item.projectId);
    const tagIds = dto.tagIds ? uniqueIds(dto.tagIds) : existing.tags.map((item) => item.tagId);
    if (tagIds.length > 0) await this.assertWorkspaceTags(tenant.workspaceId, tagIds, true);
    const status = dto.statusDefinitionId
      ? await this.taskStatus(tenant.workspaceId, dto.statusDefinitionId)
      : await this.taskStatus(tenant.workspaceId, existing.statusDefinitionId);
    if (status.isTerminal)
      throw new BadRequestException('Recurring tasks require a non-terminal status.');
    const department =
      'departmentId' in dto
        ? await this.activeDepartment(tenant.workspaceId, dto.departmentId)
        : existing.departmentId
          ? await this.activeDepartment(tenant.workspaceId, existing.departmentId)
          : null;

    const result = await this.prisma.$transaction(async (tx) => {
      const series = await tx.taskRecurrenceSeries.create({
        data: {
          workspaceId: tenant.workspaceId,
          title: dto.title === undefined ? existing.title : normalizeTitle(dto.title),
          description:
            dto.description === undefined
              ? existing.description
              : normalizeDescription(dto.description),
          priority: dto.priority ?? existing.priority,
          statusDefinitionId: status.id,
          departmentId: department?.id ?? null,
          timezone: recurrence.timezone,
          frequency: recurrence.frequency,
          interval: recurrence.interval,
          customIntervalUnit: recurrence.customIntervalUnit ?? null,
          startLocalDate: dateOnly(recurrence.startLocalDate),
          localTime: recurrence.localTime,
          selectedWeekdays: recurrence.selectedWeekdays ?? [],
          monthlyDay: recurrence.monthlyDay ?? null,
          endMode: recurrence.endMode,
          untilLocalDate: recurrence.untilLocalDate ? dateOnly(recurrence.untilLocalDate) : null,
          maxOccurrences: recurrence.maxOccurrences ?? null,
          generatedCount: 1,
          lastGeneratedAt: new Date(),
          nextOccurrenceAt:
            nextOccurrenceAfter(recurrence, firstScheduledFor.toJSDate(), 1)?.toJSDate() ?? null,
          status:
            recurrence.endMode === TaskRecurrenceEndMode.AFTER_COUNT &&
            recurrence.maxOccurrences === 1
              ? TaskRecurrenceStatus.ENDED
              : TaskRecurrenceStatus.ACTIVE,
          endedAt:
            recurrence.endMode === TaskRecurrenceEndMode.AFTER_COUNT &&
            recurrence.maxOccurrences === 1
              ? new Date()
              : null,
          createdById: tenant.userId,
        },
        select: { id: true },
      });
      await this.replaceRecurrenceRelations(
        tx,
        series.id,
        tenant.workspaceId,
        assigneeIds,
        followerIds,
        projectIds,
        tagIds,
      );
      const completionPolicy = await tx.taskCompletionPolicy.findFirst({
        where: { workspaceId: tenant.workspaceId, taskId },
        select: taskCompletionPolicySelect,
      });
      if (completionPolicy) {
        await this.syncRecurrenceCompletionBlueprint(tx, tenant.workspaceId, series.id, {
          proofRequirementMode: completionPolicy.proofRequirementMode,
          requiredProofTypes: completionPolicy.requiredProofTypes,
          approvalRequired: completionPolicy.approvalRequired,
          approverMode: completionPolicy.approverMode,
          includeTaskCreator: completionPolicy.includeTaskCreator,
          includePermissionApprovers: completionPolicy.includePermissionApprovers,
          includeProjectOwnersManagers: completionPolicy.includeProjectOwnersManagers,
          explicitApproverMembershipIds: completionPolicy.approvers.map(
            (approver) => approver.membershipId,
          ),
        });
      }
      const updated = await tx.task.update({
        where: { id: taskId },
        data: {
          recurrenceSeriesId: series.id,
          recurrenceScheduledFor: firstScheduledFor.toJSDate(),
          recurrenceSequence: 1,
          dueAt: firstScheduledFor.toJSDate(),
          updatedById: tenant.userId,
        },
        select: taskDetailSelect,
      });
      return { task: updated, seriesId: series.id };
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'task.recurrence_created',
      entityType: 'TaskRecurrenceSeries',
      entityId: result.seriesId,
      metadata: { taskId },
    });
    return serializeTaskDetail(result.task, tenant);
  }

  async pauseRecurrence(tenant: WorkspaceTenantContext, seriesId: string) {
    return this.changeRecurrenceStatus(tenant, seriesId, TaskRecurrenceStatus.PAUSED);
  }

  async resumeRecurrence(tenant: WorkspaceTenantContext, seriesId: string) {
    const now = new Date();
    const series = await this.findSeries(tenant.workspaceId, seriesId);
    if (series.status === TaskRecurrenceStatus.ACTIVE) return serializeTaskRecurrenceSeries(series);
    if (series.status === TaskRecurrenceStatus.ENDED)
      throw new ConflictException('Ended recurrence cannot be resumed.');
    const input = seriesToScheduleInput(series);
    const next = firstFutureOccurrenceAfter(input, now, series.generatedCount);
    const updated = await this.prisma.taskRecurrenceSeries.update({
      where: { id: seriesId },
      data: {
        status: next ? TaskRecurrenceStatus.ACTIVE : TaskRecurrenceStatus.ENDED,
        pausedAt: null,
        nextOccurrenceAt: next?.toJSDate() ?? null,
        updatedById: tenant.userId,
        endedAt: next ? null : now,
        lastErrorCode: null,
      },
      select: taskRecurrenceSeriesSelect,
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'task.recurrence_resumed',
      entityType: 'TaskRecurrenceSeries',
      entityId: seriesId,
      metadata: { nextOccurrenceAt: updated.nextOccurrenceAt },
    });
    return serializeTaskRecurrenceSeries(updated);
  }

  async endRecurrence(tenant: WorkspaceTenantContext, seriesId: string) {
    return this.changeRecurrenceStatus(tenant, seriesId, TaskRecurrenceStatus.ENDED);
  }

  async createTemplate(tenant: WorkspaceTenantContext, dto: CreateTaskTemplateDto) {
    const data = await this.templateData(tenant, dto);
    if (!data.name || !data.title || !data.statusDefinitionId) {
      throw new BadRequestException('Template name, title, and status are required.');
    }
    const name = data.name;
    const title = data.title;
    const statusDefinitionId = data.statusDefinitionId;
    const template = await this.prisma
      .$transaction(async (tx) => {
        const created = await tx.taskTemplate.create({
          data: {
            workspaceId: tenant.workspaceId,
            name,
            nameNormalized: normalizeName(name),
            title,
            description: data.description,
            priority: data.priority,
            statusDefinitionId,
            departmentId: data.departmentId,
            estimatedMinutes: data.estimatedMinutes,
            createdById: tenant.userId,
          },
          select: { id: true },
        });
        await this.replaceTemplateRelations(
          tx,
          created.id,
          tenant.workspaceId,
          data.assigneeIds,
          data.followerIds,
          data.projectIds,
          data.tagIds,
        );
        return tx.taskTemplate.findUniqueOrThrow({
          where: { id: created.id },
          select: taskTemplateSelect,
        });
      })
      .catch(mapTemplateWriteError);
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'task.template_created',
      entityType: 'TaskTemplate',
      entityId: template.id,
      metadata: {},
    });
    return serializeTaskTemplate(template);
  }

  async listTemplates(tenant: WorkspaceTenantContext, query: TaskTemplateQueryDto) {
    const where: Prisma.TaskTemplateWhereInput = {
      workspaceId: tenant.workspaceId,
      status: query.status,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search.trim(), mode: Prisma.QueryMode.insensitive } },
              { title: { contains: query.search.trim(), mode: Prisma.QueryMode.insensitive } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.taskTemplate.findMany({
        where,
        select: taskTemplateSelect,
        orderBy: { [query.sortBy]: query.sortDirection },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.taskTemplate.count({ where }),
    ]);
    return {
      items: items.map(serializeTaskTemplate),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async updateTemplate(
    tenant: WorkspaceTenantContext,
    templateId: string,
    dto: UpdateTaskTemplateDto,
  ) {
    await this.findTemplate(tenant.workspaceId, templateId);
    const data = await this.templateData(tenant, dto, true);
    const template = await this.prisma
      .$transaction(async (tx) => {
        await tx.taskTemplate.update({
          where: { id: templateId },
          data: {
            name: data.name,
            nameNormalized: data.name ? normalizeName(data.name) : undefined,
            title: data.title,
            description: data.description,
            priority: data.priority,
            statusDefinitionId: data.statusDefinitionId,
            departmentId: data.departmentId,
            estimatedMinutes: data.estimatedMinutes,
            updatedById: tenant.userId,
          },
        });
        if (data.replaceRelations) {
          await this.replaceTemplateRelations(
            tx,
            templateId,
            tenant.workspaceId,
            data.assigneeIds,
            data.followerIds,
            data.projectIds,
            data.tagIds,
          );
        }
        return tx.taskTemplate.findUniqueOrThrow({
          where: { id: templateId },
          select: taskTemplateSelect,
        });
      })
      .catch(mapTemplateWriteError);
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'task.template_updated',
      entityType: 'TaskTemplate',
      entityId: templateId,
      metadata: {},
    });
    return serializeTaskTemplate(template);
  }

  async archiveTemplate(tenant: WorkspaceTenantContext, templateId: string) {
    return this.setTemplateStatus(tenant, templateId, TaskTemplateStatus.ARCHIVED);
  }

  async reactivateTemplate(tenant: WorkspaceTenantContext, templateId: string) {
    return this.setTemplateStatus(tenant, templateId, TaskTemplateStatus.ACTIVE);
  }

  async createFromTemplate(
    tenant: WorkspaceTenantContext,
    templateId: string,
    dto: CreateTaskFromTemplateDto,
  ) {
    const template = await this.findTemplate(tenant.workspaceId, templateId);
    if (template.status !== TaskTemplateStatus.ACTIVE)
      throw new ConflictException('Archived templates cannot create tasks.');
    const createDto: CreateTaskDto = {
      title: template.title,
      priority: template.priority,
      statusDefinitionId: template.statusDefinitionId,
      departmentId: template.departmentId,
      estimatedMinutes: template.estimatedMinutes,
      assigneeMembershipIds: template.assignees.map((item) => item.membershipId),
      followerMembershipIds: template.followers.map((item) => item.membershipId),
      projectIds: template.projects.map((item) => item.projectId),
      tagIds: template.tags.map((item) => item.tagId),
    };
    if (template.description !== null) createDto.description = template.description;
    if (dto.dueAt !== undefined) createDto.dueAt = dto.dueAt;
    return this.create(tenant, createDto);
  }

  async saveTaskAsTemplate(
    tenant: WorkspaceTenantContext,
    taskId: string,
    dto: SaveTaskAsTemplateDto,
  ) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, workspaceId: tenant.workspaceId, deletedAt: null },
      select: {
        title: true,
        description: true,
        priority: true,
        statusDefinitionId: true,
        departmentId: true,
        estimatedMinutes: true,
        statusDefinition: { select: { isTerminal: true } },
        assignees: { select: { membershipId: true } },
        followers: { select: { membershipId: true } },
        projects: { select: { projectId: true } },
        tags: { select: { tagId: true } },
      },
    });
    if (!task) throw new NotFoundException('Task not found.');
    const fallbackStatus = task.statusDefinition.isTerminal
      ? await this.taskStatus(tenant.workspaceId)
      : null;
    return this.createTemplate(tenant, {
      name: dto.name,
      title: task.title,
      description: task.description,
      priority: task.priority,
      statusDefinitionId: fallbackStatus?.id ?? task.statusDefinitionId,
      departmentId: task.departmentId,
      estimatedMinutes: task.estimatedMinutes,
      assigneeMembershipIds: task.assignees.map((item) => item.membershipId),
      followerMembershipIds: task.followers.map((item) => item.membershipId),
      projectIds: task.projects.map((item) => item.projectId),
      tagIds: task.tags.map((item) => item.tagId),
    });
  }

  async getCompletionPolicy(tenant: WorkspaceTenantContext, taskId: string) {
    await this.assertTask(tenant.workspaceId, taskId);
    const policy = await this.prisma.taskCompletionPolicy.findFirst({
      where: { workspaceId: tenant.workspaceId, taskId },
      select: taskCompletionPolicySelect,
    });
    return policy ? serializeCompletionPolicy(policy) : defaultCompletionPolicy(taskId);
  }

  async upsertCompletionPolicy(
    tenant: WorkspaceTenantContext,
    taskId: string,
    dto: CompletionPolicyDto,
  ) {
    const task = await this.assertTask(tenant.workspaceId, taskId);
    const normalized = await this.normalizeCompletionPolicy(tenant.workspaceId, dto);
    const recurrenceEditScope = dto.recurrenceEditScope ?? 'THIS_OCCURRENCE';
    const updatesTaskPolicy = !task.recurrenceSeriesId || recurrenceEditScope !== 'ENTIRE_SERIES';
    const updatesSeriesBlueprint =
      Boolean(task.recurrenceSeriesId) &&
      (recurrenceEditScope === 'THIS_AND_FUTURE' || recurrenceEditScope === 'ENTIRE_SERIES');
    const policy = await this.prisma.$transaction(async (tx) => {
      let saved: { id: string } | null = null;
      if (updatesTaskPolicy) {
        saved = await tx.taskCompletionPolicy.upsert({
          where: { taskId },
          create: {
            workspaceId: tenant.workspaceId,
            taskId,
            proofRequirementMode: normalized.proofRequirementMode,
            requiredProofTypes: normalized.requiredProofTypes,
            approvalRequired: normalized.approvalRequired,
            approverMode: normalized.approverMode,
            includeTaskCreator: normalized.includeTaskCreator,
            includePermissionApprovers: normalized.includePermissionApprovers,
            includeProjectOwnersManagers: normalized.includeProjectOwnersManagers,
            createdById: tenant.userId,
            updatedById: tenant.userId,
          },
          update: {
            proofRequirementMode: normalized.proofRequirementMode,
            requiredProofTypes: normalized.requiredProofTypes,
            approvalRequired: normalized.approvalRequired,
            approverMode: normalized.approverMode,
            includeTaskCreator: normalized.includeTaskCreator,
            includePermissionApprovers: normalized.includePermissionApprovers,
            includeProjectOwnersManagers: normalized.includeProjectOwnersManagers,
            updatedById: tenant.userId,
          },
          select: { id: true },
        });
        await tx.taskCompletionPolicyApprover.deleteMany({
          where: { workspaceId: tenant.workspaceId, policyId: saved.id },
        });
        if (normalized.explicitApproverMembershipIds.length > 0) {
          await tx.taskCompletionPolicyApprover.createMany({
            data: normalized.explicitApproverMembershipIds.map((membershipId) => ({
              workspaceId: tenant.workspaceId,
              policyId: saved!.id,
              membershipId,
            })),
            skipDuplicates: true,
          });
        }
      }
      if (updatesSeriesBlueprint && task.recurrenceSeriesId) {
        await this.syncRecurrenceCompletionBlueprint(
          tx,
          tenant.workspaceId,
          task.recurrenceSeriesId,
          normalized,
        );
      }
      if (!saved) {
        return tx.taskCompletionPolicy.findFirst({
          where: { workspaceId: tenant.workspaceId, taskId },
          select: taskCompletionPolicySelect,
        });
      }
      return tx.taskCompletionPolicy.findUniqueOrThrow({
        where: { id: saved.id },
        select: taskCompletionPolicySelect,
      });
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'task.completion_policy_updated',
      entityType: 'Task',
      entityId: taskId,
      metadata: {
        proofRequirementMode: normalized.proofRequirementMode,
        approvalRequired: normalized.approvalRequired,
        recurrenceEditScope,
      },
    });
    return policy ? serializeCompletionPolicy(policy) : defaultCompletionPolicy(taskId);
  }

  async submitCompletion(
    tenant: WorkspaceTenantContext,
    taskId: string,
    statusDefinitionId: string,
    dto: SubmitTaskCompletionDto,
  ) {
    const status = await this.taskStatus(tenant.workspaceId, statusDefinitionId);
    if (!status.isTerminal) throw new BadRequestException('Completion requires a terminal status.');
    return this.submitCompletionForTerminalStatus(tenant, taskId, status, dto);
  }

  async listCompletionSubmissions(
    tenant: WorkspaceTenantContext,
    taskId: string,
    query: TaskCompletionQueryDto,
  ) {
    await this.assertTask(tenant.workspaceId, taskId);
    const where = { workspaceId: tenant.workspaceId, taskId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.taskCompletionSubmission.findMany({
        where,
        select: taskCompletionSubmissionSelect,
        orderBy: { version: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.taskCompletionSubmission.count({ where }),
    ]);
    return {
      items: items.map(serializeCompletionSubmission),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async listCompletionApprovalQueue(tenant: WorkspaceTenantContext, query: TaskCompletionQueryDto) {
    const membershipId = this.requireWorkspaceMembership(tenant);
    const where: Prisma.TaskCompletionSubmissionWhereInput = {
      workspaceId: tenant.workspaceId,
      status: TaskCompletionSubmissionStatus.PENDING_APPROVAL,
      approvers: { some: { membershipId, workspaceId: tenant.workspaceId } },
      decisions: { none: { approverMembershipId: membershipId } },
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.taskCompletionSubmission.findMany({
        where,
        select: taskCompletionSubmissionSelect,
        orderBy: { submittedAt: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.taskCompletionSubmission.count({ where }),
    ]);
    return {
      items: items.map(serializeCompletionSubmission),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async decideCompletion(
    tenant: WorkspaceTenantContext,
    taskId: string,
    submissionId: string,
    dto: TaskCompletionDecisionDto,
  ) {
    const membershipId = this.requireWorkspaceMembership(tenant);
    const reason =
      dto.decision === TaskCompletionDecision.REJECTED ? normalizeReason(dto.reason) : null;
    const result = await this.prisma
      .$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`
          SELECT id
          FROM task_completion_submissions
          WHERE id = ${submissionId}::uuid
            AND workspace_id = ${tenant.workspaceId}::uuid
            AND task_id = ${taskId}::uuid
          FOR UPDATE
        `);
        const membership = await tx.workspaceMembership.findFirst({
          where: {
            id: membershipId,
            workspaceId: tenant.workspaceId,
            status: MembershipStatus.ACTIVE,
          },
          select: { id: true },
        });
        if (!membership) throw new ForbiddenException('Approval no longer valid.');
        const submission = await tx.taskCompletionSubmission.findFirst({
          where: { id: submissionId, workspaceId: tenant.workspaceId, taskId },
          select: taskCompletionSubmissionSelect,
        });
        if (!submission) throw new NotFoundException('Completion submission not found.');
        if (submission.status !== TaskCompletionSubmissionStatus.PENDING_APPROVAL) {
          throw new ConflictException('SUBMISSION_ALREADY_RESOLVED');
        }
        const approver = submission.approvers.find((item) => item.membershipId === membershipId);
        if (!approver) throw new ForbiddenException('NOT_APPROVER');
        if (submission.decisions.some((item) => item.approverMembershipId === membershipId)) {
          throw new ConflictException('ALREADY_DECIDED');
        }
        await tx.taskCompletionApprovalDecision.create({
          data: {
            workspaceId: tenant.workspaceId,
            submissionId,
            approverMembershipId: membershipId,
            decision: dto.decision,
            reason,
          },
        });
        if (dto.decision === TaskCompletionDecision.REJECTED) {
          const rejected = await tx.taskCompletionSubmission.update({
            where: { id: submissionId },
            data: { status: TaskCompletionSubmissionStatus.REJECTED, resolvedAt: new Date() },
            select: taskCompletionSubmissionSelect,
          });
          await tx.task.updateMany({
            where: {
              id: taskId,
              workspaceId: tenant.workspaceId,
              pendingCompletionSubmissionId: submissionId,
            },
            data: { pendingCompletionSubmissionId: null, updatedById: tenant.userId },
          });
          return { submission: rejected, completed: false };
        }
        const allDecisions = await tx.taskCompletionApprovalDecision.findMany({
          where: { workspaceId: tenant.workspaceId, submissionId },
          select: { approverMembershipId: true, decision: true },
        });
        const approvedMembershipIds = new Set(
          allDecisions
            .filter((decision) => decision.decision === TaskCompletionDecision.APPROVED)
            .map((decision) => decision.approverMembershipId),
        );
        const shouldFinalize =
          submission.approverModeSnapshot === TaskCompletionApproverMode.ANY_ONE ||
          submission.approvers.every((item) => approvedMembershipIds.has(item.membershipId));
        if (!shouldFinalize) {
          return {
            submission: await tx.taskCompletionSubmission.findUniqueOrThrow({
              where: { id: submissionId },
              select: taskCompletionSubmissionSelect,
            }),
            completed: false,
          };
        }
        const target = await tx.statusDefinition.findFirst({
          where: {
            id: submission.requestedTerminalStatusDefinitionId,
            workspaceId: tenant.workspaceId,
            entityType: StatusEntityType.TASK,
            isActive: true,
            isTerminal: true,
          },
          select: { id: true, isTerminal: true },
        });
        if (!target) throw new ConflictException('TASK_TERMINAL_RULE_FAILED');
        await this.applyTaskStatusTransition(tx, tenant, taskId, target.id, target.isTerminal);
        const accepted = await tx.taskCompletionSubmission.update({
          where: { id: submissionId },
          data: { status: TaskCompletionSubmissionStatus.ACCEPTED, resolvedAt: new Date() },
          select: taskCompletionSubmissionSelect,
        });
        await tx.task.updateMany({
          where: {
            id: taskId,
            workspaceId: tenant.workspaceId,
            pendingCompletionSubmissionId: submissionId,
          },
          data: { pendingCompletionSubmissionId: null, updatedById: tenant.userId },
        });
        return { submission: accepted, completed: true };
      }, serializableTransaction)
      .catch(mapHierarchyWriteError);
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action:
        dto.decision === TaskCompletionDecision.APPROVED
          ? 'task.completion_approved'
          : 'task.completion_rejected',
      entityType: 'TaskCompletionSubmission',
      entityId: submissionId,
      metadata: { taskId, completed: result.completed },
    });
    if (result.completed) {
      await this.gamification.evaluateTaskCompletionAchievements(tenant.workspaceId, taskId);
      await this.gamification.handleTaskCompletionXp(
        tenant.workspaceId,
        taskId,
        tenant.workspaceMembershipId ?? null,
      );
    }
    return serializeCompletionSubmission(result.submission);
  }

  async listKanbanSettings(tenant: WorkspaceTenantContext) {
    const columns = await this.prisma.statusDefinition.findMany({
      where: {
        workspaceId: tenant.workspaceId,
        entityType: StatusEntityType.TASK,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        color: true,
        category: true,
        position: true,
        isTerminal: true,
        taskKanbanColumnSettings: {
          where: { workspaceId: tenant.workspaceId },
          select: { wipLimit: true },
          take: 1,
        },
      },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
    return {
      columns: columns.map((column) => ({
        status: {
          id: column.id,
          name: column.name,
          color: column.color,
          category: column.category,
          position: column.position,
          isTerminal: column.isTerminal,
        },
        wipLimit: column.taskKanbanColumnSettings[0]?.wipLimit ?? null,
      })),
    };
  }

  async updateKanbanColumnSetting(
    tenant: WorkspaceTenantContext,
    statusDefinitionId: string,
    dto: UpdateTaskKanbanColumnSettingDto,
  ) {
    await this.taskStatus(tenant.workspaceId, statusDefinitionId);
    const setting = await this.prisma.taskKanbanColumnSetting.upsert({
      where: {
        workspaceId_statusDefinitionId: {
          workspaceId: tenant.workspaceId,
          statusDefinitionId,
        },
      },
      create: {
        workspaceId: tenant.workspaceId,
        statusDefinitionId,
        wipLimit: dto.wipLimit ?? null,
      },
      update: { wipLimit: dto.wipLimit ?? null },
      select: { statusDefinitionId: true, wipLimit: true },
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'task.kanban_wip_changed',
      entityType: 'StatusDefinition',
      entityId: statusDefinitionId,
      metadata: { wipLimit: setting.wipLimit },
    });
    return setting;
  }

  async moveKanbanTask(tenant: WorkspaceTenantContext, taskId: string, dto: TaskKanbanMoveDto) {
    if (dto.beforeTaskId && dto.beforeTaskId === taskId)
      throw new BadRequestException('Task cannot be placed before itself.');
    if (dto.afterTaskId && dto.afterTaskId === taskId)
      throw new BadRequestException('Task cannot be placed after itself.');
    const destinationStatus = await this.taskStatus(tenant.workspaceId, dto.statusDefinitionId);
    if (destinationStatus.isTerminal) {
      const task = await this.assertTask(tenant.workspaceId, taskId);
      if (task.statusDefinitionId !== destinationStatus.id) {
        return this.updateStatus(tenant, taskId, destinationStatus.id, dto.completion);
      }
    }
    const result = await this.prisma
      .$transaction(async (tx) => {
        await lockTaskForKanban(tx, tenant.workspaceId, taskId);
        const task = await tx.task.findFirst({
          where: { id: taskId, workspaceId: tenant.workspaceId, deletedAt: null },
          select: {
            id: true,
            statusDefinitionId: true,
            kanbanRank: true,
            pendingCompletionSubmissionId: true,
            statusDefinition: { select: { isTerminal: true } },
          },
        });
        if (!task) throw new NotFoundException('Task not found.');
        if (task.pendingCompletionSubmissionId) {
          throw new ConflictException('COMPLETION_APPROVAL_PENDING');
        }
        if (
          task.statusDefinitionId === dto.statusDefinitionId &&
          !dto.beforeTaskId &&
          !dto.afterTaskId
        ) {
          return {
            task: await tx.task.findFirstOrThrow({
              where: { id: taskId, workspaceId: tenant.workspaceId },
              select: taskDetailSelect,
            }),
            changed: false,
            fromStatusDefinitionId: task.statusDefinitionId,
          };
        }
        await this.ensureKanbanRanksForColumn(tx, tenant.workspaceId, dto.statusDefinitionId);
        if (task.statusDefinitionId !== dto.statusDefinitionId) {
          if (
            task.statusDefinition.isTerminal &&
            !destinationStatus.isTerminal &&
            (await this.hasActiveCompletionXpAward(
              tenant.workspaceId,
              GamificationPointWorkType.TASK,
              taskId,
              tx,
            ))
          ) {
            throw new BadRequestException('TASK_REOPEN_REQUIRES_NEW_FUTURE_DUE_AT');
          }
          await this.assertStatusTransition(
            tenant.workspaceId,
            [taskId],
            destinationStatus.isTerminal,
            tx,
          );
        }
        const placement = await this.kanbanPlacement(
          tx,
          tenant.workspaceId,
          dto.statusDefinitionId,
          dto.beforeTaskId ?? null,
          dto.afterTaskId ?? null,
          taskId,
        );
        let kanbanRank = placement.rank;
        if (!kanbanRank) {
          await this.rebalanceKanbanColumn(tx, tenant.workspaceId, dto.statusDefinitionId);
          kanbanRank = (
            await this.kanbanPlacement(
              tx,
              tenant.workspaceId,
              dto.statusDefinitionId,
              dto.beforeTaskId ?? null,
              dto.afterTaskId ?? null,
              taskId,
            )
          ).rank;
        }
        if (!kanbanRank)
          throw new ConflictException('Kanban placement is stale. Refresh and try again.');
        const statusChanged = task.statusDefinitionId !== dto.statusDefinitionId;
        const rankChanged = !task.kanbanRank || !task.kanbanRank.equals(kanbanRank);
        if (!statusChanged && !rankChanged) {
          return {
            task: await tx.task.findFirstOrThrow({
              where: { id: taskId, workspaceId: tenant.workspaceId },
              select: taskDetailSelect,
            }),
            changed: false,
            fromStatusDefinitionId: task.statusDefinitionId,
          };
        }
        const updated = await tx.task.update({
          where: { id: taskId },
          data: {
            statusDefinitionId: dto.statusDefinitionId,
            kanbanRank,
            updatedById: tenant.userId,
          },
          select: taskDetailSelect,
        });
        await tx.auditLog.create({
          data: {
            superAgencyId: tenant.superAgencyId,
            agencyId: tenant.agencyId,
            workspaceId: tenant.workspaceId,
            userId: tenant.userId,
            action: 'task.kanban_moved',
            entityType: 'Task',
            entityId: taskId,
            metadata: {
              fromStatusDefinitionId: task.statusDefinitionId,
              toStatusDefinitionId: dto.statusDefinitionId,
              reordered: rankChanged,
              statusChanged,
            },
          },
        });
        return { task: updated, changed: true, fromStatusDefinitionId: task.statusDefinitionId };
      }, serializableTransaction)
      .catch(mapHierarchyWriteError);
    return serializeTaskDetail(result.task, tenant);
  }

  async bulkUpdateStatus(tenant: WorkspaceTenantContext, dto: BulkTaskStatusDto) {
    const status = await this.taskStatus(tenant.workspaceId, dto.statusDefinitionId);
    const tasks = await this.assertBulkTasks(tenant.workspaceId, dto.taskIds);
    if (
      !status.isTerminal &&
      tasks.some((task) => task.statusDefinition.isTerminal) &&
      (
        await Promise.all(
          tasks.map((task) =>
            this.hasActiveCompletionXpAward(
              tenant.workspaceId,
              GamificationPointWorkType.TASK,
              task.id,
            ),
          ),
        )
      ).some(Boolean)
    ) {
      throw new BadRequestException('TASK_REOPEN_REQUIRES_NEW_FUTURE_DUE_AT');
    }
    const changedTaskIds = tasks
      .filter((task) => task.statusDefinitionId !== status.id)
      .map((task) => task.id);
    if (changedTaskIds.length === 0) {
      return bulkResult(dto.taskIds.length, 0);
    }
    const pending = await this.findPendingCompletionTaskIds(tenant.workspaceId, changedTaskIds);
    if (pending.length > 0) {
      throw new ConflictException('COMPLETION_APPROVAL_PENDING');
    }
    if (status.isTerminal) {
      const required = await this.findCompletionRequiredTaskIds(tenant.workspaceId, changedTaskIds);
      if (required.length > 0) {
        throw this.completionFlowRequired({
          requestedTerminalStatusDefinitionId: status.id,
          taskIds: required,
        });
      }
    }

    await this.prisma
      .$transaction(async (tx) => {
        await this.assertBulkTasks(tenant.workspaceId, dto.taskIds, tx);
        await this.assertBulkStatusTransition(
          tenant.workspaceId,
          dto.taskIds,
          status.isTerminal,
          tx,
        );
        let nextRank = await this.nextKanbanRank(tx, tenant.workspaceId, status.id);
        for (const taskId of changedTaskIds) {
          const update = await tx.task.updateMany({
            where: { id: taskId, workspaceId: tenant.workspaceId, deletedAt: null },
            data: {
              statusDefinitionId: status.id,
              kanbanRank: nextRank,
              updatedById: tenant.userId,
            },
          });
          if (update.count !== 1) throw new NotFoundException('Task not found.');
          if (status.isTerminal) {
            await this.autoStopTaskTimers(
              tx,
              tenant,
              taskId,
              new Date(),
              TaskTimeEntryStopReason.TASK_TERMINAL,
            );
          }
          nextRank = nextRank.plus(KANBAN_RANK_STEP);
        }
        await tx.auditLog.create({
          data: {
            superAgencyId: tenant.superAgencyId,
            agencyId: tenant.agencyId,
            workspaceId: tenant.workspaceId,
            userId: tenant.userId,
            action: 'task.bulk_status_changed',
            entityType: 'Task',
            metadata: {
              requestedCount: dto.taskIds.length,
              changedCount: changedTaskIds.length,
              unchangedCount: dto.taskIds.length - changedTaskIds.length,
              statusDefinitionId: status.id,
              taskIds: changedTaskIds,
            },
          },
        });
      }, serializableTransaction)
      .catch(mapHierarchyWriteError);
    if (status.isTerminal) {
      for (const taskId of changedTaskIds) {
        await this.gamification.evaluateTaskCompletionAchievements(tenant.workspaceId, taskId);
        await this.gamification.handleTaskCompletionXp(
          tenant.workspaceId,
          taskId,
          tenant.workspaceMembershipId ?? null,
        );
      }
    }
    return bulkResult(dto.taskIds.length, changedTaskIds.length);
  }

  async bulkUpdatePriority(tenant: WorkspaceTenantContext, dto: BulkTaskPriorityDto) {
    const tasks = await this.assertBulkTasks(tenant.workspaceId, dto.taskIds);
    const changedTaskIds = tasks
      .filter((task) => task.priority !== dto.priority)
      .map((task) => task.id);
    if (changedTaskIds.length === 0) {
      return bulkResult(dto.taskIds.length, 0);
    }

    await this.prisma.$transaction(async (tx) => {
      const update = await tx.task.updateMany({
        where: { id: { in: changedTaskIds }, workspaceId: tenant.workspaceId, deletedAt: null },
        data: { priority: dto.priority, updatedById: tenant.userId },
      });
      if (update.count !== changedTaskIds.length) throw new NotFoundException('Task not found.');
      await tx.auditLog.create({
        data: {
          superAgencyId: tenant.superAgencyId,
          agencyId: tenant.agencyId,
          workspaceId: tenant.workspaceId,
          userId: tenant.userId,
          action: 'task.bulk_priority_changed',
          entityType: 'Task',
          metadata: {
            requestedCount: dto.taskIds.length,
            changedCount: changedTaskIds.length,
            unchangedCount: dto.taskIds.length - changedTaskIds.length,
            priority: dto.priority,
            taskIds: changedTaskIds,
          },
        },
      });
    });
    return bulkResult(dto.taskIds.length, changedTaskIds.length);
  }

  async bulkAddAssignees(tenant: WorkspaceTenantContext, dto: BulkTaskMembershipsDto) {
    await this.assertBulkTasks(tenant.workspaceId, dto.taskIds);
    const membershipIds = await this.activeMembershipIds(tenant.workspaceId, dto.membershipIds);
    const existing = await this.prisma.taskAssignee.findMany({
      where: {
        workspaceId: tenant.workspaceId,
        taskId: { in: dto.taskIds },
        membershipId: { in: membershipIds },
      },
      select: { taskId: true, membershipId: true },
    });
    const existingKeys = new Set(
      existing.map((assignee) => relationKey(assignee.taskId, assignee.membershipId)),
    );
    const rows = dto.taskIds.flatMap((taskId) =>
      membershipIds
        .filter((membershipId) => !existingKeys.has(relationKey(taskId, membershipId)))
        .map((membershipId) => ({ taskId, workspaceId: tenant.workspaceId, membershipId })),
    );
    if (rows.length === 0) {
      return bulkRelationResult(
        dto.taskIds.length,
        0,
        0,
        dto.taskIds.length * membershipIds.length,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await this.assertBulkTasks(tenant.workspaceId, dto.taskIds, tx);
      const createdRows = await insertTaskAssigneeRows(tx, rows);
      const createdCount = createdRows.length;
      const changedTaskIds = [...new Set(createdRows.map((row) => row.taskId))];
      if (createdCount === 0) {
        return { changedTaskIds, createdCount };
      }
      const update = await tx.task.updateMany({
        where: { id: { in: changedTaskIds }, workspaceId: tenant.workspaceId, deletedAt: null },
        data: { updatedById: tenant.userId },
      });
      if (update.count !== changedTaskIds.length) throw new NotFoundException('Task not found.');
      await tx.auditLog.create({
        data: {
          superAgencyId: tenant.superAgencyId,
          agencyId: tenant.agencyId,
          workspaceId: tenant.workspaceId,
          userId: tenant.userId,
          action: 'task.bulk_assignees_added',
          entityType: 'Task',
          metadata: {
            requestedCount: dto.taskIds.length,
            changedCount: changedTaskIds.length,
            unchangedCount: dto.taskIds.length - changedTaskIds.length,
            relationChangedCount: createdCount,
            relationUnchangedCount: dto.taskIds.length * membershipIds.length - createdCount,
            membershipIds,
            taskIds: changedTaskIds,
          },
        },
      });
      const tasks = await tx.task.findMany({
        where: { id: { in: changedTaskIds }, workspaceId: tenant.workspaceId },
        select: { id: true, title: true },
      });
      for (const task of tasks) {
        const recipients = createdRows
          .filter((row) => row.taskId === task.id)
          .map((row) => row.membershipId);
        await this.notifyTaskAssigneesInTransaction(tx, tenant, task.id, task.title, recipients);
      }
      return { changedTaskIds, createdCount };
    });
    return bulkRelationResult(
      dto.taskIds.length,
      result.changedTaskIds.length,
      result.createdCount,
      dto.taskIds.length * membershipIds.length - result.createdCount,
    );
  }

  async bulkRemoveAssignees(tenant: WorkspaceTenantContext, dto: BulkTaskMembershipsDto) {
    await this.assertBulkTasks(tenant.workspaceId, dto.taskIds);
    const membershipIds = await this.activeMembershipIds(tenant.workspaceId, dto.membershipIds);
    const existing = await this.prisma.taskAssignee.findMany({
      where: {
        workspaceId: tenant.workspaceId,
        taskId: { in: dto.taskIds },
        membershipId: { in: membershipIds },
      },
      select: { taskId: true, membershipId: true },
    });
    const changedTaskIds = [...new Set(existing.map((assignee) => assignee.taskId))];
    if (existing.length === 0) {
      return bulkRelationResult(
        dto.taskIds.length,
        0,
        0,
        dto.taskIds.length * membershipIds.length,
      );
    }

    const deletedCount = await this.prisma.$transaction(async (tx) => {
      await this.assertBulkTasks(tenant.workspaceId, dto.taskIds, tx);
      const deleted = await tx.taskAssignee.deleteMany({
        where: {
          workspaceId: tenant.workspaceId,
          taskId: { in: dto.taskIds },
          membershipId: { in: membershipIds },
        },
      });
      const update = await tx.task.updateMany({
        where: { id: { in: changedTaskIds }, workspaceId: tenant.workspaceId, deletedAt: null },
        data: { updatedById: tenant.userId },
      });
      if (update.count !== changedTaskIds.length) throw new NotFoundException('Task not found.');
      await tx.auditLog.create({
        data: {
          superAgencyId: tenant.superAgencyId,
          agencyId: tenant.agencyId,
          workspaceId: tenant.workspaceId,
          userId: tenant.userId,
          action: 'task.bulk_assignees_removed',
          entityType: 'Task',
          metadata: {
            requestedCount: dto.taskIds.length,
            changedCount: changedTaskIds.length,
            unchangedCount: dto.taskIds.length - changedTaskIds.length,
            relationChangedCount: deleted.count,
            relationUnchangedCount: dto.taskIds.length * membershipIds.length - deleted.count,
            membershipIds,
            taskIds: changedTaskIds,
          },
        },
      });
      return deleted.count;
    });
    return bulkRelationResult(
      dto.taskIds.length,
      changedTaskIds.length,
      deletedCount,
      dto.taskIds.length * membershipIds.length - deletedCount,
    );
  }

  async bulkRemove(tenant: WorkspaceTenantContext, dto: BulkTaskIdsDto) {
    await this.assertBulkTasks(tenant.workspaceId, dto.taskIds);
    const deletedAt = new Date();
    await this.prisma
      .$transaction(async (tx) => {
        const update = await tx.task.updateMany({
          where: { id: { in: dto.taskIds }, workspaceId: tenant.workspaceId, deletedAt: null },
          data: { deletedAt, updatedById: tenant.userId },
        });
        if (update.count !== dto.taskIds.length) throw new NotFoundException('Task not found.');
        const detach = await tx.task.updateMany({
          where: {
            workspaceId: tenant.workspaceId,
            deletedAt: null,
            parentTaskId: { in: dto.taskIds },
            id: { notIn: dto.taskIds },
          },
          data: { parentTaskId: null, updatedById: tenant.userId },
        });
        await tx.auditLog.create({
          data: {
            superAgencyId: tenant.superAgencyId,
            agencyId: tenant.agencyId,
            workspaceId: tenant.workspaceId,
            userId: tenant.userId,
            action: 'task.bulk_deleted',
            entityType: 'Task',
            metadata: {
              requestedCount: dto.taskIds.length,
              changedCount: update.count,
              unchangedCount: 0,
              taskIds: dto.taskIds,
              detachedChildCount: detach.count,
            },
          },
        });
      }, serializableTransaction)
      .catch(mapHierarchyWriteError);
    await this.realtime.publishWorkspace({
      eventType: 'TASK_DELETED',
      workspaceId: tenant.workspaceId,
      entityType: 'TASK',
      entityId: null,
      actorMembershipId: tenant.workspaceMembershipId,
      payload: { taskIds: dto.taskIds, changedCount: dto.taskIds.length },
    });
    return bulkResult(dto.taskIds.length, dto.taskIds.length);
  }

  async get(tenant: WorkspaceTenantContext, taskId: string) {
    return serializeTaskDetail(await this.findTask(tenant.workspaceId, taskId), tenant);
  }

  async listSubtasks(tenant: WorkspaceTenantContext, taskId: string, query: TaskQueryDto) {
    await this.assertTask(tenant.workspaceId, taskId);
    const where = { ...this.taskWhere(tenant, query), parentTaskId: taskId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.task.findMany({
        where,
        select: taskListSelect,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.task.count({ where }),
    ]);
    return {
      items: items.map((task) => serializeTaskListItem(task, tenant)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async updateParent(tenant: WorkspaceTenantContext, taskId: string, parentTaskId: string | null) {
    const result = await this.prisma
      .$transaction(async (tx) => {
        const task = await this.assertTask(tenant.workspaceId, taskId, tx);
        if (task.parentTaskId === parentTaskId) {
          return {
            task: await tx.task.findFirstOrThrow({
              where: { id: taskId, workspaceId: tenant.workspaceId },
              select: taskDetailSelect,
            }),
            oldParentTaskId: task.parentTaskId,
            changed: false,
          };
        }
        if (parentTaskId) {
          if (parentTaskId === taskId) throw new BadRequestException('Task cannot parent itself.');
          await this.assertCanReparent(tenant.workspaceId, taskId, parentTaskId, tx);
        }
        const updated = await tx.task.update({
          where: { id: taskId },
          data: { parentTaskId, updatedById: tenant.userId },
          select: taskDetailSelect,
        });
        await tx.auditLog.create({
          data: {
            superAgencyId: tenant.superAgencyId,
            agencyId: tenant.agencyId,
            workspaceId: tenant.workspaceId,
            userId: tenant.userId,
            action: parentTaskId ? 'task.parent_changed' : 'task.detached',
            entityType: 'Task',
            entityId: taskId,
            metadata: {
              taskId,
              oldParentTaskId: task.parentTaskId,
              newParentTaskId: parentTaskId,
            },
          },
        });
        return { task: updated, oldParentTaskId: task.parentTaskId, changed: true };
      }, serializableTransaction)
      .catch(mapHierarchyWriteError);
    return serializeTaskDetail(result.task, tenant);
  }

  async listBlockedBy(tenant: WorkspaceTenantContext, taskId: string, query: TaskQueryDto) {
    await this.assertTask(tenant.workspaceId, taskId);
    const where = {
      workspaceId: tenant.workspaceId,
      blockedTaskId: taskId,
      blockerTask: { deletedAt: null },
      blockedTask: { deletedAt: null },
    } satisfies Prisma.TaskDependencyWhereInput;
    const [edges, total] = await this.prisma.$transaction([
      this.prisma.taskDependency.findMany({
        where,
        select: { blockerTask: { select: taskRelationshipSelect } },
        orderBy: [{ createdAt: 'asc' }, { blockerTaskId: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.taskDependency.count({ where }),
    ]);
    return paginatedRelationship(
      edges.map((edge) => edge.blockerTask),
      query,
      total,
    );
  }

  async listBlocks(tenant: WorkspaceTenantContext, taskId: string, query: TaskQueryDto) {
    await this.assertTask(tenant.workspaceId, taskId);
    const where = {
      workspaceId: tenant.workspaceId,
      blockerTaskId: taskId,
      blockerTask: { deletedAt: null },
      blockedTask: { deletedAt: null },
    } satisfies Prisma.TaskDependencyWhereInput;
    const [edges, total] = await this.prisma.$transaction([
      this.prisma.taskDependency.findMany({
        where,
        select: { blockedTask: { select: taskRelationshipSelect } },
        orderBy: [{ createdAt: 'asc' }, { blockedTaskId: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.taskDependency.count({ where }),
    ]);
    return paginatedRelationship(
      edges.map((edge) => edge.blockedTask),
      query,
      total,
    );
  }

  async addBlockedBy(
    tenant: WorkspaceTenantContext,
    blockedTaskId: string,
    dto: TaskRelationshipIdsDto,
  ) {
    if (dto.taskIds.includes(blockedTaskId))
      throw new BadRequestException('Task cannot block itself.');
    const taskIds = uniqueIds([blockedTaskId, ...dto.taskIds]);
    await this.assertBulkTasks(tenant.workspaceId, taskIds);
    const result = await this.prisma
      .$transaction(async (tx) => {
        const tasks = await this.assertBulkTasks(tenant.workspaceId, taskIds, tx);
        const blockedTask = tasks.find((task) => task.id === blockedTaskId);
        if (
          blockedTask?.statusDefinition.isTerminal &&
          tasks.some((task) => task.id !== blockedTaskId && !task.statusDefinition.isTerminal)
        ) {
          throw new ConflictException('Terminal tasks cannot accept active non-terminal blockers.');
        }
        const edges = dto.taskIds.map((blockerTaskId) => ({ blockerTaskId, blockedTaskId }));
        await assertDependencyGraphAcyclic(tx, tenant.workspaceId, edges);
        const create = await tx.taskDependency.createMany({
          data: edges.map((edge) => ({
            workspaceId: tenant.workspaceId,
            blockerTaskId: edge.blockerTaskId,
            blockedTaskId: edge.blockedTaskId,
            createdById: tenant.userId,
          })),
          skipDuplicates: true,
        });
        if (create.count > 0) {
          await tx.auditLog.create({
            data: {
              superAgencyId: tenant.superAgencyId,
              agencyId: tenant.agencyId,
              workspaceId: tenant.workspaceId,
              userId: tenant.userId,
              action: 'task.dependencies_added',
              entityType: 'Task',
              entityId: blockedTaskId,
              metadata: {
                taskId: blockedTaskId,
                requestedCount: dto.taskIds.length,
                changedCount: create.count,
                unchangedCount: dto.taskIds.length - create.count,
                taskIds: dto.taskIds,
              },
            },
          });
        }
        return bulkResult(dto.taskIds.length, create.count);
      }, serializableTransaction)
      .catch(mapHierarchyWriteError);
    return result;
  }

  async removeBlockedBy(
    tenant: WorkspaceTenantContext,
    blockedTaskId: string,
    dto: TaskRelationshipIdsDto,
  ) {
    if (dto.taskIds.includes(blockedTaskId))
      throw new BadRequestException('Task cannot block itself.');
    const taskIds = uniqueIds([blockedTaskId, ...dto.taskIds]);
    await this.assertBulkTasks(tenant.workspaceId, taskIds);
    const result = await this.prisma.$transaction(async (tx) => {
      await this.assertBulkTasks(tenant.workspaceId, taskIds, tx);
      const removed = await tx.taskDependency.deleteMany({
        where: {
          workspaceId: tenant.workspaceId,
          blockedTaskId,
          blockerTaskId: { in: dto.taskIds },
        },
      });
      if (removed.count > 0) {
        await tx.auditLog.create({
          data: {
            superAgencyId: tenant.superAgencyId,
            agencyId: tenant.agencyId,
            workspaceId: tenant.workspaceId,
            userId: tenant.userId,
            action: 'task.dependencies_removed',
            entityType: 'Task',
            entityId: blockedTaskId,
            metadata: {
              taskId: blockedTaskId,
              requestedCount: dto.taskIds.length,
              changedCount: removed.count,
              unchangedCount: dto.taskIds.length - removed.count,
              taskIds: dto.taskIds,
            },
          },
        });
      }
      return bulkResult(dto.taskIds.length, removed.count);
    });
    return result;
  }

  async listRelated(tenant: WorkspaceTenantContext, taskId: string, query: TaskQueryDto) {
    await this.assertTask(tenant.workspaceId, taskId);
    const where = {
      workspaceId: tenant.workspaceId,
      OR: [
        { taskAId: taskId, taskB: { deletedAt: null } },
        { taskBId: taskId, taskA: { deletedAt: null } },
      ],
      taskA: { deletedAt: null },
      taskB: { deletedAt: null },
    } satisfies Prisma.TaskRelatedTaskWhereInput;
    const [links, total] = await this.prisma.$transaction([
      this.prisma.taskRelatedTask.findMany({
        where,
        select: {
          taskAId: true,
          taskA: { select: taskRelationshipSelect },
          taskB: { select: taskRelationshipSelect },
        },
        orderBy: [{ createdAt: 'asc' }, { taskAId: 'asc' }, { taskBId: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.taskRelatedTask.count({ where }),
    ]);
    const items = links.map((link) => (link.taskAId === taskId ? link.taskB : link.taskA));
    return paginatedRelationship(items, query, total);
  }

  async addRelated(tenant: WorkspaceTenantContext, taskId: string, dto: TaskRelationshipIdsDto) {
    if (dto.taskIds.includes(taskId))
      throw new BadRequestException('Task cannot relate to itself.');
    const taskIds = uniqueIds([taskId, ...dto.taskIds]);
    await this.assertBulkTasks(tenant.workspaceId, taskIds);
    const pairs = dto.taskIds.map((relatedTaskId) => canonicalRelatedPair(taskId, relatedTaskId));
    const result = await this.prisma
      .$transaction(async (tx) => {
        await this.assertBulkTasks(tenant.workspaceId, taskIds, tx);
        const create = await tx.taskRelatedTask.createMany({
          data: pairs.map((pair) => ({
            workspaceId: tenant.workspaceId,
            taskAId: pair.taskAId,
            taskBId: pair.taskBId,
            createdById: tenant.userId,
          })),
          skipDuplicates: true,
        });
        if (create.count > 0) {
          await tx.auditLog.create({
            data: {
              superAgencyId: tenant.superAgencyId,
              agencyId: tenant.agencyId,
              workspaceId: tenant.workspaceId,
              userId: tenant.userId,
              action: 'task.related_added',
              entityType: 'Task',
              entityId: taskId,
              metadata: {
                taskId,
                requestedCount: dto.taskIds.length,
                changedCount: create.count,
                unchangedCount: dto.taskIds.length - create.count,
                taskIds: dto.taskIds,
              },
            },
          });
        }
        return bulkResult(dto.taskIds.length, create.count);
      })
      .catch(mapHierarchyWriteError);
    return result;
  }

  async removeRelated(tenant: WorkspaceTenantContext, taskId: string, dto: TaskRelationshipIdsDto) {
    if (dto.taskIds.includes(taskId))
      throw new BadRequestException('Task cannot relate to itself.');
    const taskIds = uniqueIds([taskId, ...dto.taskIds]);
    await this.assertBulkTasks(tenant.workspaceId, taskIds);
    const pairs = dto.taskIds.map((relatedTaskId) => canonicalRelatedPair(taskId, relatedTaskId));
    const result = await this.prisma.$transaction(async (tx) => {
      await this.assertBulkTasks(tenant.workspaceId, taskIds, tx);
      const removed = await tx.taskRelatedTask.deleteMany({
        where: {
          workspaceId: tenant.workspaceId,
          OR: pairs.map((pair) => ({ taskAId: pair.taskAId, taskBId: pair.taskBId })),
        },
      });
      if (removed.count > 0) {
        await tx.auditLog.create({
          data: {
            superAgencyId: tenant.superAgencyId,
            agencyId: tenant.agencyId,
            workspaceId: tenant.workspaceId,
            userId: tenant.userId,
            action: 'task.related_removed',
            entityType: 'Task',
            entityId: taskId,
            metadata: {
              taskId,
              requestedCount: dto.taskIds.length,
              changedCount: removed.count,
              unchangedCount: dto.taskIds.length - removed.count,
              taskIds: dto.taskIds,
            },
          },
        });
      }
      return bulkResult(dto.taskIds.length, removed.count);
    });
    return result;
  }

  async createComment(tenant: WorkspaceTenantContext, taskId: string, dto: CreateTaskCommentDto) {
    return this.createTaskComment(tenant, taskId, null, dto, 'task.comment_created');
  }

  async createCommentReply(
    tenant: WorkspaceTenantContext,
    taskId: string,
    parentCommentId: string,
    dto: CreateTaskCommentDto,
  ) {
    return this.createTaskComment(tenant, taskId, parentCommentId, dto, 'task.comment_replied');
  }

  async listComments(tenant: WorkspaceTenantContext, taskId: string, query: TaskQueryDto) {
    await this.assertTask(tenant.workspaceId, taskId);
    return this.listCommentPage(tenant, taskId, null, query);
  }

  async listCommentReplies(
    tenant: WorkspaceTenantContext,
    taskId: string,
    parentCommentId: string,
    query: TaskQueryDto,
  ) {
    await this.assertVisibleComment(tenant, taskId, parentCommentId);
    return this.listCommentPage(tenant, taskId, parentCommentId, query);
  }

  async updateComment(
    tenant: WorkspaceTenantContext,
    taskId: string,
    commentId: string,
    dto: UpdateTaskCommentDto,
  ) {
    const comment = await this.assertVisibleComment(tenant, taskId, commentId, true);
    this.assertCanChangeComment(
      tenant,
      comment.authorMembershipId,
      PermissionKeys.taskCommentsUpdateOwn,
    );
    const body = normalizeCommentBody(dto.body);
    if (body === comment.body) return this.serializeCommentById(tenant, taskId, commentId);
    const updated = await this.prisma.taskComment.update({
      where: { id: commentId },
      data: { body, editedAt: new Date() },
      select: taskCommentSelect,
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'task.comment_updated',
      entityType: 'TaskComment',
      entityId: commentId,
      metadata: { taskId, visibility: comment.visibility },
    });
    return this.enrichAndSerializeComments(tenant, taskId, [updated]).then((items) => items[0]);
  }

  async deleteComment(tenant: WorkspaceTenantContext, taskId: string, commentId: string) {
    const comment = await this.assertVisibleComment(tenant, taskId, commentId, true);
    this.assertCanChangeComment(
      tenant,
      comment.authorMembershipId,
      PermissionKeys.taskCommentsDeleteOwn,
    );
    const deleted = await this.prisma
      .$transaction(async (tx) => {
        await this.lockCommentForWrite(tenant, taskId, commentId, tx);
        const deletedComment = await tx.taskComment.update({
          where: { id: commentId },
          data: { deletedAt: new Date() },
          select: taskCommentSelect,
        });
        await tx.auditLog.create({
          data: {
            superAgencyId: tenant.superAgencyId,
            agencyId: tenant.agencyId,
            workspaceId: tenant.workspaceId,
            userId: tenant.userId,
            action: 'task.comment_deleted',
            entityType: 'TaskComment',
            entityId: commentId,
            metadata: { taskId, visibility: comment.visibility },
          },
        });
        return deletedComment;
      }, serializableTransaction)
      .catch(mapHierarchyWriteError);
    return this.enrichAndSerializeComments(tenant, taskId, [deleted]).then((items) => items[0]);
  }

  async addCommentReaction(
    tenant: WorkspaceTenantContext,
    taskId: string,
    commentId: string,
    dto: TaskCommentReactionDto,
  ) {
    const membershipId = this.requireWorkspaceMembership(tenant);
    await this.assertVisibleComment(tenant, taskId, commentId, true);
    const created = await this.prisma.taskCommentReaction.createMany({
      data: {
        workspaceId: tenant.workspaceId,
        commentId,
        membershipId,
        reactionType: dto.reactionType,
      },
      skipDuplicates: true,
    });
    if (created.count > 0) {
      await this.audit.record({
        agencyId: tenant.agencyId,
        workspaceId: tenant.workspaceId,
        userId: tenant.userId,
        action: 'task.comment_reaction_added',
        entityType: 'TaskComment',
        entityId: commentId,
        metadata: { taskId, reactionType: dto.reactionType },
      });
    }
    return { changed: created.count > 0, reactionType: dto.reactionType };
  }

  async removeCommentReaction(
    tenant: WorkspaceTenantContext,
    taskId: string,
    commentId: string,
    dto: TaskCommentReactionDto,
  ) {
    const membershipId = this.requireWorkspaceMembership(tenant);
    await this.assertVisibleComment(tenant, taskId, commentId);
    const removed = await this.prisma.taskCommentReaction.deleteMany({
      where: {
        workspaceId: tenant.workspaceId,
        commentId,
        membershipId,
        reactionType: dto.reactionType,
      },
    });
    if (removed.count > 0) {
      await this.audit.record({
        agencyId: tenant.agencyId,
        workspaceId: tenant.workspaceId,
        userId: tenant.userId,
        action: 'task.comment_reaction_removed',
        entityType: 'TaskComment',
        entityId: commentId,
        metadata: { taskId, reactionType: dto.reactionType },
      });
    }
    return { changed: removed.count > 0, reactionType: dto.reactionType };
  }

  async listTaskTags(tenant: WorkspaceTenantContext, taskId: string) {
    await this.assertTask(tenant.workspaceId, taskId);
    const tags = await this.prisma.taskTag.findMany({
      where: { workspaceId: tenant.workspaceId, taskId },
      select: taskTagSelect,
      orderBy: [{ tag: { nameNormalized: 'asc' } }, { tagId: 'asc' }],
    });
    return tags.map(serializeTaskTag);
  }

  async addTaskTags(
    tenant: WorkspaceTenantContext,
    taskId: string,
    dto: TaskTagIdsDto,
    _automation?: AutomationMutationContext,
  ) {
    await this.assertTask(tenant.workspaceId, taskId);
    const tagIds = uniqueIds(dto.tagIds);
    const insertedTagIds = await this.prisma
      .$transaction(async (tx) => {
        await this.assertWorkspaceTags(tenant.workspaceId, tagIds, true, tx);
        const inserted = await tx.$queryRaw<Array<{ tag_id: string }>>(Prisma.sql`
          INSERT INTO task_tags (workspace_id, task_id, tag_id, created_by_id)
          SELECT
            ${tenant.workspaceId}::uuid,
            ${taskId}::uuid,
            requested.id,
            ${tenant.userId}::uuid
          FROM (VALUES ${uuidValues(tagIds)}) AS requested(id)
          JOIN workspace_tags wt
            ON wt.id = requested.id
           AND wt.workspace_id = ${tenant.workspaceId}::uuid
           AND wt.status = ${WorkspaceTagStatus.ACTIVE}::"WorkspaceTagStatus"
          ON CONFLICT DO NOTHING
          RETURNING tag_id
        `);
        return inserted.map((tag) => tag.tag_id);
      }, serializableTransaction)
      .catch(mapTaskTagWriteError);
    if (insertedTagIds.length > 0) {
      await this.audit.record({
        agencyId: tenant.agencyId,
        workspaceId: tenant.workspaceId,
        userId: tenant.userId,
        action: 'task.tags_added',
        entityType: 'Task',
        entityId: taskId,
        metadata: {
          requestedCount: tagIds.length,
          changedCount: insertedTagIds.length,
          unchangedCount: tagIds.length - insertedTagIds.length,
          tagIds: insertedTagIds,
        },
      });
    }
    return tagMutationResult(tagIds.length, insertedTagIds.length);
  }

  async removeTaskTags(tenant: WorkspaceTenantContext, taskId: string, dto: TaskTagIdsDto) {
    await this.assertTask(tenant.workspaceId, taskId);
    const tagIds = uniqueIds(dto.tagIds);
    const removed = await this.prisma.$transaction(async (tx) => {
      await this.assertWorkspaceTags(tenant.workspaceId, tagIds, false, tx);
      return tx.taskTag.deleteMany({
        where: { workspaceId: tenant.workspaceId, taskId, tagId: { in: tagIds } },
      });
    });
    if (removed.count > 0) {
      await this.audit.record({
        agencyId: tenant.agencyId,
        workspaceId: tenant.workspaceId,
        userId: tenant.userId,
        action: 'task.tags_removed',
        entityType: 'Task',
        entityId: taskId,
        metadata: {
          requestedCount: tagIds.length,
          changedCount: removed.count,
          unchangedCount: tagIds.length - removed.count,
          tagIds,
        },
      });
    }
    return tagMutationResult(tagIds.length, removed.count);
  }

  async listAttachments(tenant: WorkspaceTenantContext, taskId: string, query: TaskQueryDto) {
    await this.assertTask(tenant.workspaceId, taskId);
    const where: Prisma.TaskAttachmentWhereInput = {
      workspaceId: tenant.workspaceId,
      taskId,
      removedAt: null,
      attachment: { deletedAt: null },
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.taskAttachment.findMany({
        where,
        select: taskAttachmentSelect,
        orderBy: [{ createdAt: 'desc' }, { attachmentId: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.taskAttachment.count({ where }),
    ]);
    return {
      items: items.map(serializeTaskAttachment),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async initAttachmentUpload(
    tenant: WorkspaceTenantContext,
    taskId: string,
    dto: UploadInitDto,
    correlationId: string,
  ) {
    await this.billingEntitlements?.assertWorkspaceFeatureAvailable(
      tenant.workspaceId,
      'tasks.enabled',
    );
    await this.assertTask(tenant.workspaceId, taskId);
    const uploadedByMembershipId = requireUploadMembership(tenant);
    const filename = sanitizeFilename(dto.filename);
    const displayName = sanitizeFilename(dto.displayName ?? filename);
    const mimeType = sanitizeMimeType(dto.mimeType);
    if (!this.allowedMimeTypes.has(mimeType)) {
      throw new UnprocessableEntityException('File type is not allowed.');
    }
    if (dto.sizeBytes > TASK_ATTACHMENT_MAX_UPLOAD_BYTES) {
      throw new PayloadTooLargeException('File is too large.');
    }

    const assetId = randomUUID();
    const extension = extractExtension(filename);
    const storageKey = buildWorkspaceAssetStorageKey(tenant.workspaceId, assetId, extension);
    const uploadExpiresAt = new Date(Date.now() + this.env.UPLOAD_URL_TTL_SECONDS * 1000);
    const sizeBytes = BigInt(dto.sizeBytes);
    const created = await this.prisma.$transaction(async (tx) => {
      const managed = await this.billingEntitlements?.assertWorkspaceStorageAvailableTx(
        tx,
        tenant.workspaceId,
        sizeBytes,
      );
      if (!managed) await assertStorageQuotaAvailable(tx, tenant.workspaceId, sizeBytes);
      const asset = await tx.asset.create({
        data: {
          id: assetId,
          workspaceId: tenant.workspaceId,
          projectId: null,
          createdById: tenant.userId,
          uploadedByMembershipId,
          originalFilename: filename,
          displayName,
          storageBucket: this.env.MINIO_BUCKET,
          storageProvider: 'MINIO',
          storageKey,
          mimeType,
          extension,
          sizeBytes,
          status: AssetStatus.UPLOADING,
          uploadExpiresAt,
          sourceModule: 'TASK',
          sourceEntityType: 'TASK',
          sourceEntityId: taskId,
          metadata: { correlationId, taskId },
        },
        select: attachmentAssetSelect,
      });
      await tx.storageUploadReservation.create({
        data: {
          workspaceId: tenant.workspaceId,
          fileId: asset.id,
          membershipId: uploadedByMembershipId,
          reservedBytes: sizeBytes,
          expiresAt: uploadExpiresAt,
        },
      });
      const attachment = await tx.attachment.create({
        data: {
          id: assetId,
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
    taskId: string,
    attachmentId: string,
    dto: UploadCompleteDto,
    correlationId: string,
  ) {
    await this.assertTask(tenant.workspaceId, taskId);
    const attachment = await this.findFileAttachment(tenant.workspaceId, attachmentId);
    const asset = attachment.asset;
    if (!asset) throw new NotFoundException('Attachment not found.');
    if (asset.status === AssetStatus.DELETED) throw new NotFoundException('Attachment not found.');
    const metadata = isRecord(asset.metadata) ? asset.metadata : {};
    if (metadata.taskId !== taskId) {
      throw new NotFoundException('Attachment not found.');
    }
    if (asset.status === AssetStatus.UPLOADING) {
      if (!asset.uploadExpiresAt || asset.uploadExpiresAt <= new Date()) {
        await releaseUploadReservation(this.prisma, asset.id);
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
      await this.prisma.$transaction(async (tx) => {
        await consumeUploadReservation(tx, asset.id);
        await tx.asset.update({
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
      });
    } else if (asset.status !== AssetStatus.PROCESSING && asset.status !== AssetStatus.READY) {
      throw new ConflictException('Attachment file is not awaiting upload completion.');
    }

    const link = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.$queryRaw<Array<{ attachment_id: string }>>(Prisma.sql`
        INSERT INTO "task_attachments" ("workspace_id", "task_id", "attachment_id", "attached_by_id")
        VALUES (${tenant.workspaceId}::uuid, ${taskId}::uuid, ${attachmentId}::uuid, ${tenant.userId}::uuid)
        ON CONFLICT ("task_id", "attachment_id") DO UPDATE
        SET "removed_at" = NULL,
            "attached_by_id" = EXCLUDED."attached_by_id"
        WHERE "task_attachments"."removed_at" IS NOT NULL
        RETURNING "attachment_id"
      `);
      return tx.taskAttachment
        .findUniqueOrThrow({
          where: { taskId_attachmentId: { taskId, attachmentId } },
          select: taskAttachmentSelect,
        })
        .then((taskAttachment) => ({ taskAttachment, changedCount: changed.length }));
    });
    await this.ensureProcessingJob(asset, correlationId);
    if (link.changedCount > 0) {
      await this.audit.record({
        agencyId: tenant.agencyId,
        workspaceId: tenant.workspaceId,
        userId: tenant.userId,
        action: 'task.attachment_file_uploaded',
        entityType: 'Task',
        entityId: taskId,
        metadata: { attachmentId, assetId: asset.id, sizeBytes: Number(asset.sizeBytes) },
      });
    }
    return serializeTaskAttachment(link.taskAttachment);
  }

  async addUrlAttachment(
    tenant: WorkspaceTenantContext,
    taskId: string,
    dto: CreateTaskUrlAttachmentDto,
  ) {
    await this.billingEntitlements?.assertWorkspaceFeatureAvailable(
      tenant.workspaceId,
      'tasks.enabled',
    );
    await this.assertTask(tenant.workspaceId, taskId);
    const url = normalizeAttachmentUrl(dto.url);
    const displayName = normalizeAttachmentDisplayName(dto.displayName) ?? url;
    const link = await this.prisma.$transaction(async (tx) => {
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
      await tx.taskAttachment.create({
        data: {
          workspaceId: tenant.workspaceId,
          taskId,
          attachmentId: attachment.id,
          attachedById: tenant.userId,
        },
      });
      return tx.taskAttachment.findUniqueOrThrow({
        where: { taskId_attachmentId: { taskId, attachmentId: attachment.id } },
        select: taskAttachmentSelect,
      });
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'task.attachment_url_added',
      entityType: 'Task',
      entityId: taskId,
      metadata: { attachmentId: link.attachmentId },
    });
    return serializeTaskAttachment(link);
  }

  async linkAttachments(tenant: WorkspaceTenantContext, taskId: string, dto: TaskAttachmentIdsDto) {
    await this.billingEntitlements?.assertWorkspaceFeatureAvailable(
      tenant.workspaceId,
      'tasks.enabled',
    );
    await this.assertTask(tenant.workspaceId, taskId);
    const attachmentIds = uniqueIds(dto.attachmentIds);
    const attachments = await this.prisma.attachment.findMany({
      where: { id: { in: attachmentIds }, workspaceId: tenant.workspaceId, deletedAt: null },
      select: reusableAttachmentSelect,
    });
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

    const result = await this.prisma.$transaction(async (tx) => {
      const values = Prisma.join(
        attachmentIds.map(
          (attachmentId) =>
            Prisma.sql`(${tenant.workspaceId}::uuid, ${taskId}::uuid, ${attachmentId}::uuid, ${tenant.userId}::uuid)`,
        ),
      );
      const changed = await tx.$queryRaw<Array<{ attachment_id: string }>>(Prisma.sql`
        INSERT INTO "task_attachments" ("workspace_id", "task_id", "attachment_id", "attached_by_id")
        VALUES ${values}
        ON CONFLICT ("task_id", "attachment_id") DO UPDATE
        SET "removed_at" = NULL,
            "attached_by_id" = EXCLUDED."attached_by_id"
        WHERE "task_attachments"."removed_at" IS NOT NULL
        RETURNING "attachment_id"
      `);
      return { requestedCount: attachmentIds.length, changedCount: changed.length };
    });
    if (result.changedCount > 0) {
      await this.audit.record({
        agencyId: tenant.agencyId,
        workspaceId: tenant.workspaceId,
        userId: tenant.userId,
        action: 'task.attachments_linked',
        entityType: 'Task',
        entityId: taskId,
        metadata: {
          requestedCount: result.requestedCount,
          changedCount: result.changedCount,
          unchangedCount: result.requestedCount - result.changedCount,
          attachmentIds,
        },
      });
    }
    return tagMutationResult(result.requestedCount, result.changedCount);
  }

  async downloadAttachment(tenant: WorkspaceTenantContext, taskId: string, attachmentId: string) {
    await this.assertTask(tenant.workspaceId, taskId);
    const link = await this.findActiveTaskAttachment(tenant.workspaceId, taskId, attachmentId);
    if (link.attachment.type !== AttachmentType.FILE || !link.attachment.asset) {
      throw new ConflictException('Attachment is not a downloadable file.');
    }
    if (
      link.attachment.asset.deletedAt ||
      link.attachment.asset.status !== AssetStatus.READY ||
      !isAssetLifecycleDownloadable(link.attachment.asset.lifecycle)
    ) {
      throw new ConflictException('Attachment file is not ready for download.');
    }
    const downloadUrl = await this.storage.createPresignedDownloadUrl(
      link.attachment.asset.storageKey,
      this.env.DOWNLOAD_URL_TTL_SECONDS,
    );
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'task.attachment_download_authorized',
      entityType: 'Task',
      entityId: taskId,
      metadata: { attachmentId, assetId: link.attachment.asset.id },
    });
    return { downloadUrl, expiresInSeconds: this.env.DOWNLOAD_URL_TTL_SECONDS };
  }

  async removeAttachment(tenant: WorkspaceTenantContext, taskId: string, attachmentId: string) {
    await this.assertTask(tenant.workspaceId, taskId);
    await this.findActiveTaskAttachment(tenant.workspaceId, taskId, attachmentId);
    const removedAt = new Date();
    const removed = await this.prisma.taskAttachment.updateMany({
      where: { workspaceId: tenant.workspaceId, taskId, attachmentId, removedAt: null },
      data: { removedAt },
    });
    if (removed.count > 0) {
      await this.audit.record({
        agencyId: tenant.agencyId,
        workspaceId: tenant.workspaceId,
        userId: tenant.userId,
        action: 'task.attachment_removed',
        entityType: 'Task',
        entityId: taskId,
        metadata: { attachmentId },
      });
    }
    return { changed: removed.count > 0 };
  }

  async update(
    tenant: WorkspaceTenantContext,
    taskId: string,
    dto: UpdateTaskDto,
    automation?: AutomationMutationContext,
  ) {
    await this.billingEntitlements?.assertWorkspaceFeatureAvailable(
      tenant.workspaceId,
      'tasks.enabled',
    );
    const existing = await this.assertTask(tenant.workspaceId, taskId);
    const changedFields = Object.entries(dto)
      .filter(([key, value]) => key !== 'recurrenceEditScope' && value !== undefined)
      .map(([key]) => key);
    const recurrenceEditScope = dto.recurrenceEditScope ?? 'THIS_OCCURRENCE';
    if (
      changedFields.length === 1 &&
      dto.statusDefinitionId &&
      dto.statusDefinitionId === existing.statusDefinitionId
    ) {
      return serializeTaskDetail(await this.findTask(tenant.workspaceId, taskId), tenant);
    }
    const status = dto.statusDefinitionId
      ? await this.taskStatus(tenant.workspaceId, dto.statusDefinitionId)
      : null;
    const department =
      'departmentId' in dto
        ? await this.activeDepartment(tenant.workspaceId, dto.departmentId)
        : undefined;
    const data: Prisma.TaskUncheckedUpdateInput = {
      title: dto.title === undefined ? undefined : normalizeTitle(dto.title),
      description:
        dto.description === undefined ? undefined : normalizeDescription(dto.description),
      priority: dto.priority,
      statusDefinitionId: status?.id,
      departmentId: department === undefined ? undefined : (department?.id ?? null),
      estimatedMinutes:
        dto.estimatedMinutes === undefined ? undefined : (dto.estimatedMinutes ?? null),
      plannedStartAt:
        dto.plannedStartAt === undefined ? undefined : parseOptionalDate(dto.plannedStartAt),
      dueAt: dto.dueAt === undefined ? undefined : parseOptionalDate(dto.dueAt),
      updatedById: tenant.userId,
    };
    validateTaskSchedule(
      data.plannedStartAt === undefined
        ? existing.plannedStartAt
        : (data.plannedStartAt as Date | null),
      data.dueAt === undefined ? existing.dueAt : (data.dueAt as Date | null),
    );
    const reopensTask =
      Boolean(status) &&
      status!.id !== existing.statusDefinitionId &&
      existing.statusDefinition.isTerminal &&
      !status!.isTerminal;
    const reopensAwardedCompletion =
      reopensTask &&
      (await this.hasActiveCompletionXpAward(
        tenant.workspaceId,
        GamificationPointWorkType.TASK,
        taskId,
      ));
    if (reopensAwardedCompletion) {
      requireFutureReopenTarget(
        data.dueAt as Date | null | undefined,
        'TASK_REOPEN_REQUIRES_NEW_FUTURE_DUE_AT',
      );
    }
    const seriesUpdateData: Prisma.TaskRecurrenceSeriesUncheckedUpdateInput = {
      title: data.title,
      description: data.description,
      priority: data.priority,
      statusDefinitionId: data.statusDefinitionId,
      departmentId: data.departmentId,
      estimatedMinutes: data.estimatedMinutes,
      updatedById: tenant.userId,
      lastErrorCode: null,
    };
    const updatesRecurringBlueprint =
      Boolean(existing.recurrenceSeriesId) &&
      changedFields.some((field) =>
        [
          'title',
          'description',
          'priority',
          'statusDefinitionId',
          'departmentId',
          'estimatedMinutes',
        ].includes(field),
      );
    if (updatesRecurringBlueprint && status?.isTerminal) {
      throw new BadRequestException('Recurring task series require a non-terminal status.');
    }
    if (status?.isTerminal) {
      const gate = await this.completionGate(tenant.workspaceId, taskId);
      if (gate.required)
        throw this.completionFlowRequired({
          taskId,
          requestedTerminalStatusDefinitionId: status.id,
          gate,
        });
    }
    if (status && status.id !== existing.statusDefinitionId) {
      await this.assertNoPendingCompletion(tenant.workspaceId, taskId);
    }
    if (
      existing.recurrenceSeriesId &&
      recurrenceEditScope === 'THIS_OCCURRENCE' &&
      changedFields.length > 0
    ) {
      data.recurrenceIsException = true;
    }
    const { task, eventIds } = await this.prisma
      .$transaction(async (tx) => {
        if (status && status.id !== existing.statusDefinitionId) {
          await this.assertStatusTransition(tenant.workspaceId, [taskId], status.isTerminal, tx);
          data.kanbanRank = await this.nextKanbanRank(tx, tenant.workspaceId, status.id);
        }
        if (
          existing.recurrenceSeriesId &&
          recurrenceEditScope === 'ENTIRE_SERIES' &&
          updatesRecurringBlueprint
        ) {
          await tx.taskRecurrenceSeries.updateMany({
            where: { id: existing.recurrenceSeriesId, workspaceId: tenant.workspaceId },
            data: seriesUpdateData,
          });
          const unchanged = await tx.task.findFirstOrThrow({
            where: { id: taskId, workspaceId: tenant.workspaceId },
            select: taskDetailSelect,
          });
          return { task: unchanged, eventIds: [] };
        }
        const updated = await tx.task.update({
          where: { id: taskId },
          data,
          select: taskDetailSelect,
        });
        if (status?.isTerminal && status.id !== existing.statusDefinitionId) {
          await this.autoStopTaskTimers(
            tx,
            tenant,
            taskId,
            new Date(),
            TaskTimeEntryStopReason.TASK_TERMINAL,
          );
        }
        if (
          existing.recurrenceSeriesId &&
          recurrenceEditScope === 'THIS_AND_FUTURE' &&
          updatesRecurringBlueprint
        ) {
          await tx.taskRecurrenceSeries.updateMany({
            where: { id: existing.recurrenceSeriesId, workspaceId: tenant.workspaceId },
            data: seriesUpdateData,
          });
        }
        const eventIds =
          status && status.id !== existing.statusDefinitionId
            ? await this.recordTaskStatusAutomationEvents(
                tx,
                tenant,
                existing,
                {
                  ...updated,
                  statusDefinitionId: updated.statusDefinition.id,
                  departmentId: updated.department?.id ?? null,
                  assignees: updated.assignees.map((assignee) => ({
                    membershipId: assignee.membership.id,
                  })),
                },
                status.isTerminal,
                automation,
              )
            : [];
        return { task: updated, eventIds };
      }, serializableTransaction)
      .catch(mapHierarchyWriteError);
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action:
        dto.statusDefinitionId && dto.statusDefinitionId !== existing.statusDefinitionId
          ? 'task.status_changed'
          : 'task.updated',
      entityType: 'Task',
      entityId: taskId,
      metadata: { changed: changedFields, recurrenceEditScope },
    });
    if (status?.isTerminal && status.id !== existing.statusDefinitionId) {
      await this.gamification.evaluateTaskCompletionAchievements(tenant.workspaceId, taskId);
      await this.gamification.handleTaskCompletionXp(
        tenant.workspaceId,
        taskId,
        tenant.workspaceMembershipId ?? null,
      );
    } else if (reopensAwardedCompletion) {
      await this.gamification.handleWorkReopen(
        tenant.workspaceId,
        GamificationPointWorkType.TASK,
        taskId,
        tenant.workspaceMembershipId ?? null,
      );
    }
    await this.evaluateAutomationEvents(eventIds);
    await this.realtime.publishWorkspace({
      eventType:
        dto.statusDefinitionId && dto.statusDefinitionId !== existing.statusDefinitionId
          ? 'TASK_STATUS_CHANGED'
          : 'TASK_UPDATED',
      workspaceId: tenant.workspaceId,
      entityType: 'TASK',
      entityId: taskId,
      actorMembershipId: tenant.workspaceMembershipId,
      payload: {
        taskId,
        changedFields,
        statusDefinitionId: task.statusDefinition.id,
      },
    });
    await this.scheduleTaskNotificationReminders(tenant.workspaceId, task);
    return serializeTaskDetail(task, tenant);
  }

  async updateStatus(
    tenant: WorkspaceTenantContext,
    taskId: string,
    statusDefinitionId: string,
    completion?: SubmitTaskCompletionDto,
    reopenDueAtInput?: string | Date | null,
    automation?: AutomationMutationContext,
  ) {
    await this.billingEntitlements?.assertWorkspaceFeatureAvailable(
      tenant.workspaceId,
      'tasks.enabled',
    );
    const existing = await this.assertTask(tenant.workspaceId, taskId);
    if (existing.statusDefinitionId === statusDefinitionId) {
      return serializeTaskDetail(await this.findTask(tenant.workspaceId, taskId), tenant);
    }
    const status = await this.taskStatus(tenant.workspaceId, statusDefinitionId);
    const reopensTask = existing.statusDefinition.isTerminal && !status.isTerminal;
    const reopensAwardedCompletion =
      reopensTask &&
      (await this.hasActiveCompletionXpAward(
        tenant.workspaceId,
        GamificationPointWorkType.TASK,
        taskId,
      ));
    const reopenDueAt = reopensAwardedCompletion
      ? requireFutureReopenTarget(
          parseOptionalDate(reopenDueAtInput),
          'TASK_REOPEN_REQUIRES_NEW_FUTURE_DUE_AT',
        )
      : null;
    if (status.isTerminal) {
      const gate = await this.completionGate(tenant.workspaceId, taskId);
      if (gate.required) {
        if (!completion)
          throw this.completionFlowRequired({
            taskId,
            requestedTerminalStatusDefinitionId: status.id,
            gate,
          });
        return this.submitCompletionForTerminalStatus(tenant, taskId, status, completion);
      }
    }
    await this.assertNoPendingCompletion(tenant.workspaceId, taskId);
    const { task, eventIds } = await this.prisma
      .$transaction(async (tx) => {
        const transitioned = await this.applyTaskStatusTransition(
          tx,
          tenant,
          taskId,
          status.id,
          status.isTerminal,
        );
        const task = reopensAwardedCompletion
          ? await tx.task.update({
              where: { id: taskId },
              data: { dueAt: reopenDueAt, updatedById: tenant.userId },
              select: taskDetailSelect,
            })
          : transitioned;
        const eventIds = await this.recordTaskStatusAutomationEvents(
          tx,
          tenant,
          existing,
          {
            ...task,
            statusDefinitionId: task.statusDefinition.id,
            departmentId: task.department?.id ?? null,
            assignees: task.assignees.map((assignee) => ({
              membershipId: assignee.membership.id,
            })),
          },
          status.isTerminal,
          automation,
        );
        return { task, eventIds };
      }, serializableTransaction)
      .catch(mapHierarchyWriteError);
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'task.status_changed',
      entityType: 'Task',
      entityId: taskId,
      metadata: {
        fromStatusDefinitionId: existing.statusDefinitionId,
        toStatusDefinitionId: status.id,
      },
    });
    if (status.isTerminal) {
      await this.gamification.evaluateTaskCompletionAchievements(tenant.workspaceId, taskId);
      await this.gamification.handleTaskCompletionXp(
        tenant.workspaceId,
        taskId,
        tenant.workspaceMembershipId ?? null,
      );
    } else if (reopensAwardedCompletion) {
      await this.gamification.handleWorkReopen(
        tenant.workspaceId,
        GamificationPointWorkType.TASK,
        taskId,
        tenant.workspaceMembershipId ?? null,
      );
    }
    await this.evaluateAutomationEvents(eventIds);
    await this.realtime.publishWorkspace({
      eventType: 'TASK_STATUS_CHANGED',
      workspaceId: tenant.workspaceId,
      entityType: 'TASK',
      entityId: taskId,
      actorMembershipId: tenant.workspaceMembershipId,
      payload: {
        taskId,
        fromStatusDefinitionId: existing.statusDefinitionId,
        toStatusDefinitionId: status.id,
        terminal: status.isTerminal,
      },
    });
    await this.scheduleTaskNotificationReminders(tenant.workspaceId, task);
    return serializeTaskDetail(task, tenant);
  }

  async replaceAssignees(
    tenant: WorkspaceTenantContext,
    taskId: string,
    dto: ReplaceTaskMembershipsDto,
    _automation?: AutomationMutationContext,
  ) {
    await this.billingEntitlements?.assertWorkspaceFeatureAvailable(
      tenant.workspaceId,
      'tasks.enabled',
    );
    await this.assertTask(tenant.workspaceId, taskId);
    const membershipIds = await this.activeMembershipIds(tenant.workspaceId, dto.membershipIds);
    const existingAssignees = await this.prisma.taskAssignee.findMany({
      where: { taskId, workspaceId: tenant.workspaceId },
      select: { membershipId: true },
    });
    const existingIds = new Set(existingAssignees.map((assignee) => assignee.membershipId));
    const newlyAssignedIds = membershipIds.filter((membershipId) => !existingIds.has(membershipId));
    const task = await this.prisma.$transaction(async (tx) => {
      await tx.taskAssignee.deleteMany({ where: { taskId, workspaceId: tenant.workspaceId } });
      if (membershipIds.length > 0) {
        await tx.taskAssignee.createMany({
          data: membershipIds.map((membershipId) => ({
            taskId,
            workspaceId: tenant.workspaceId,
            membershipId,
          })),
        });
      }
      const updatedTask = await tx.task.findUniqueOrThrow({
        where: { id: taskId },
        select: taskDetailSelect,
      });
      await this.notifyTaskAssigneesInTransaction(
        tx,
        tenant,
        taskId,
        updatedTask.title,
        newlyAssignedIds,
      );
      return updatedTask;
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'task.assignees_changed',
      entityType: 'Task',
      entityId: taskId,
      metadata: { count: membershipIds.length },
    });
    await this.realtime.publishWorkspace({
      eventType: 'TASK_ASSIGNED',
      workspaceId: tenant.workspaceId,
      entityType: 'TASK',
      entityId: taskId,
      actorMembershipId: tenant.workspaceMembershipId,
      payload: {
        taskId,
        assigneeCount: membershipIds.length,
        newlyAssignedCount: newlyAssignedIds.length,
      },
    });
    await this.scheduleTaskNotificationReminders(tenant.workspaceId, task);
    return serializeTaskDetail(task, tenant);
  }

  private async notifyTaskAssigneesInTransaction(
    tx: Prisma.TransactionClient,
    tenant: WorkspaceTenantContext,
    taskId: string,
    title: string,
    membershipIds: string[],
  ) {
    const actorMembershipId = tenant.workspaceMembershipId ?? null;
    for (const membershipId of membershipIds) {
      if (actorMembershipId && membershipId === actorMembershipId) continue;
      await this.notifications.route({
        tx,
        workspaceId: tenant.workspaceId,
        recipientMembershipId: membershipId,
        actorMembershipId,
        category: NotificationCategory.TASK,
        type: NotificationType.TASK_ASSIGNED,
        title: 'Task assigned',
        message: `You were assigned to ${title}.`,
        entityType: NotificationEntityType.TASK,
        entityId: taskId,
        dedupeKey: `task:${taskId}:assigned:${membershipId}`,
        metadata: { taskId },
        emailTemplateData: { taskTitle: title, entityId: taskId },
      });
    }
  }

  private async scheduleTaskNotificationReminders(
    workspaceId: string,
    task: Pick<TaskDetailRecord, 'id' | 'title' | 'dueAt' | 'assignees' | 'statusDefinition'>,
  ) {
    await this.notificationReminders.scheduleTaskReminders({
      workspaceId,
      taskId: task.id,
      taskTitle: task.title,
      dueAt: task.dueAt,
      assigneeMembershipIds: task.assignees.map((assignee) => assignee.membership.id),
      terminal: task.statusDefinition.isTerminal,
    });
  }

  async replaceFollowers(
    tenant: WorkspaceTenantContext,
    taskId: string,
    dto: ReplaceTaskMembershipsDto,
  ) {
    await this.assertTask(tenant.workspaceId, taskId);
    const membershipIds = await this.activeMembershipIds(tenant.workspaceId, dto.membershipIds);
    const task = await this.prisma.$transaction(async (tx) => {
      await tx.taskFollower.deleteMany({ where: { taskId, workspaceId: tenant.workspaceId } });
      if (membershipIds.length > 0) {
        await tx.taskFollower.createMany({
          data: membershipIds.map((membershipId) => ({
            taskId,
            workspaceId: tenant.workspaceId,
            membershipId,
          })),
        });
      }
      return tx.task.findUniqueOrThrow({ where: { id: taskId }, select: taskDetailSelect });
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'task.followers_changed',
      entityType: 'Task',
      entityId: taskId,
      metadata: { count: membershipIds.length },
    });
    return serializeTaskDetail(task, tenant);
  }

  async replaceProjects(
    tenant: WorkspaceTenantContext,
    taskId: string,
    dto: ReplaceTaskProjectsDto,
  ) {
    await this.assertTask(tenant.workspaceId, taskId);
    const projectIds = await this.activeProjectIds(tenant, dto.projectIds);
    const task = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.task.findFirst({
        where: { id: taskId, workspaceId: tenant.workspaceId, deletedAt: null },
        select: { id: true },
      });
      if (!existing) throw new NotFoundException('Task not found.');
      await this.assertProjectsCanLinkTask(tx, tenant, projectIds);
      await tx.taskProject.deleteMany({ where: { taskId, workspaceId: tenant.workspaceId } });
      if (projectIds.length > 0) {
        await tx.taskProject.createMany({
          data: projectIds.map((projectId) => ({
            taskId,
            workspaceId: tenant.workspaceId,
            projectId,
          })),
        });
      }
      return tx.task.findUniqueOrThrow({ where: { id: taskId }, select: taskDetailSelect });
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'task.projects_changed',
      entityType: 'Task',
      entityId: taskId,
      metadata: { count: projectIds.length },
    });
    return serializeTaskDetail(task, tenant);
  }

  async remove(tenant: WorkspaceTenantContext, taskId: string) {
    const task = await this.prisma
      .$transaction(async (tx) => {
        const update = await tx.task.updateMany({
          where: { id: taskId, workspaceId: tenant.workspaceId, deletedAt: null },
          data: { deletedAt: new Date(), updatedById: tenant.userId },
        });
        if (update.count !== 1) throw new NotFoundException('Task not found.');
        await this.autoStopTaskTimers(
          tx,
          tenant,
          taskId,
          new Date(),
          TaskTimeEntryStopReason.TASK_DELETED,
        );
        const detach = await tx.task.updateMany({
          where: { parentTaskId: taskId, workspaceId: tenant.workspaceId, deletedAt: null },
          data: { parentTaskId: null, updatedById: tenant.userId },
        });
        const deletedTask = await tx.task.findFirstOrThrow({
          where: { id: taskId, workspaceId: tenant.workspaceId },
          select: taskDetailSelect,
        });
        await tx.auditLog.create({
          data: {
            superAgencyId: tenant.superAgencyId,
            agencyId: tenant.agencyId,
            workspaceId: tenant.workspaceId,
            userId: tenant.userId,
            action: 'task.deleted',
            entityType: 'Task',
            entityId: taskId,
            metadata: { detachedChildCount: detach.count },
          },
        });
        return deletedTask;
      }, serializableTransaction)
      .catch(mapHierarchyWriteError);
    await this.gamification.handleWorkCreationVoid(
      tenant.workspaceId,
      GamificationPointWorkType.TASK,
      taskId,
      tenant.workspaceMembershipId ?? null,
    );
    return serializeTaskDetail(task, tenant);
  }

  private async createTaskComment(
    tenant: WorkspaceTenantContext,
    taskId: string,
    parentCommentId: string | null,
    dto: CreateTaskCommentDto,
    action: 'task.comment_created' | 'task.comment_replied',
  ) {
    const authorMembershipId = this.requireWorkspaceMembership(tenant);
    const body = normalizeCommentBody(dto.body);
    const visibility = dto.visibility ?? TaskCommentVisibility.NORMAL;
    if (visibility === TaskCommentVisibility.INTERNAL)
      this.assertPermission(tenant, PermissionKeys.taskCommentsInternal);
    const mentionedMembershipIds = await this.activeMembershipIds(
      tenant.workspaceId,
      uniqueIds(dto.mentionedMembershipIds ?? []),
    );
    const commentId = await this.prisma
      .$transaction(async (tx) => {
        await this.assertTask(tenant.workspaceId, taskId, tx);
        if (parentCommentId) {
          const parent = await this.lockCommentForWrite(tenant, taskId, parentCommentId, tx);
          if (parent.visibility === TaskCommentVisibility.INTERNAL) {
            this.assertPermission(tenant, PermissionKeys.taskCommentsInternal);
          }
        }
        const created = await tx.taskComment.create({
          data: {
            workspaceId: tenant.workspaceId,
            taskId,
            parentCommentId,
            authorMembershipId,
            authorUserId: tenant.userId,
            body,
            visibility,
          },
          select: taskCommentSelect,
        });
        if (mentionedMembershipIds.length > 0) {
          await tx.taskCommentMention.createMany({
            data: mentionedMembershipIds.map((membershipId) => ({
              workspaceId: tenant.workspaceId,
              commentId: created.id,
              membershipId,
            })),
          });
        }
        await tx.auditLog.create({
          data: {
            superAgencyId: tenant.superAgencyId,
            agencyId: tenant.agencyId,
            workspaceId: tenant.workspaceId,
            userId: tenant.userId,
            action,
            entityType: 'TaskComment',
            entityId: created.id,
            metadata: {
              taskId,
              parentCommentId,
              visibility,
              mentionCount: mentionedMembershipIds.length,
              mentionedMembershipIds,
            },
          },
        });
        return created.id;
      }, serializableTransaction)
      .catch(mapHierarchyWriteError);
    return this.serializeCommentById(tenant, taskId, commentId);
  }

  private async listCommentPage(
    tenant: WorkspaceTenantContext,
    taskId: string,
    parentCommentId: string | null,
    query: TaskQueryDto,
  ) {
    const where = this.visibleCommentWhere(tenant, taskId, { parentCommentId });
    const [items, total] = await this.prisma.$transaction([
      this.prisma.taskComment.findMany({
        where,
        select: taskCommentSelect,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.taskComment.count({ where }),
    ]);
    return {
      items: await this.enrichAndSerializeComments(tenant, taskId, items),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  private async serializeCommentById(
    tenant: WorkspaceTenantContext,
    taskId: string,
    commentId: string,
  ) {
    const comment = await this.prisma.taskComment.findFirst({
      where: this.visibleCommentWhere(tenant, taskId, { id: commentId }),
      select: taskCommentSelect,
    });
    if (!comment) throw new NotFoundException('Comment not found.');
    const [serialized] = await this.enrichAndSerializeComments(tenant, taskId, [comment]);
    return serialized;
  }

  private async enrichAndSerializeComments(
    tenant: WorkspaceTenantContext,
    taskId: string,
    comments: TaskCommentRecord[],
  ) {
    if (comments.length === 0) return [];
    const ids = comments.map((comment) => comment.id);
    const visibleReplyWhere = this.visibleCommentWhere(tenant, taskId, {
      parentCommentId: { in: ids },
    });
    const [visibleReplies, reactions, currentReactions] = await this.prisma.$transaction([
      this.prisma.taskComment.findMany({
        where: visibleReplyWhere,
        select: { parentCommentId: true },
      }),
      this.prisma.taskCommentReaction.findMany({
        where: { workspaceId: tenant.workspaceId, commentId: { in: ids } },
        select: { commentId: true, reactionType: true },
      }),
      tenant.workspaceMembershipId
        ? this.prisma.taskCommentReaction.findMany({
            where: {
              workspaceId: tenant.workspaceId,
              commentId: { in: ids },
              membershipId: tenant.workspaceMembershipId,
            },
            select: { commentId: true, reactionType: true },
          })
        : this.prisma.taskCommentReaction.findMany({
            where: { workspaceId: tenant.workspaceId, commentId: { in: [] } },
            select: { commentId: true, reactionType: true },
          }),
    ]);
    const replyCountByParent = new Map<string, number>();
    for (const reply of visibleReplies) {
      if (!reply.parentCommentId) continue;
      replyCountByParent.set(
        reply.parentCommentId,
        (replyCountByParent.get(reply.parentCommentId) ?? 0) + 1,
      );
    }
    const reactionCountsByComment = new Map<string, Record<TaskCommentReactionType, number>>();
    for (const reaction of reactions) {
      const counts = reactionCountsByComment.get(reaction.commentId) ?? emptyReactionCounts();
      counts[reaction.reactionType] += 1;
      reactionCountsByComment.set(reaction.commentId, counts);
    }
    const currentReactionsByComment = new Map<string, TaskCommentReactionType[]>();
    for (const reaction of currentReactions) {
      const list = currentReactionsByComment.get(reaction.commentId) ?? [];
      list.push(reaction.reactionType);
      currentReactionsByComment.set(reaction.commentId, list);
    }
    return comments.map((comment) =>
      serializeTaskComment(comment, {
        directReplyCount: replyCountByParent.get(comment.id) ?? 0,
        reactionCounts: reactionCountsByComment.get(comment.id) ?? emptyReactionCounts(),
        currentUserReactions: currentReactionsByComment.get(comment.id) ?? [],
      }),
    );
  }

  private visibleCommentWhere(
    tenant: WorkspaceTenantContext,
    taskId: string,
    extra: Prisma.TaskCommentWhereInput = {},
  ): Prisma.TaskCommentWhereInput {
    return {
      workspaceId: tenant.workspaceId,
      taskId,
      ...extra,
      ...(this.canSeeInternal(tenant) ? {} : { visibility: TaskCommentVisibility.NORMAL }),
    };
  }

  private async assertVisibleComment(
    tenant: WorkspaceTenantContext,
    taskId: string,
    commentId: string,
    requireNotDeleted = false,
  ) {
    await this.assertTask(tenant.workspaceId, taskId);
    const comment = await this.prisma.taskComment.findFirst({
      where: this.visibleCommentWhere(tenant, taskId, {
        id: commentId,
        ...(requireNotDeleted ? { deletedAt: null } : {}),
      }),
      select: {
        id: true,
        body: true,
        authorMembershipId: true,
        visibility: true,
        deletedAt: true,
      },
    });
    if (!comment) throw new NotFoundException('Comment not found.');
    return comment;
  }

  private async lockCommentForWrite(
    tenant: WorkspaceTenantContext,
    taskId: string,
    commentId: string,
    tx: Prisma.TransactionClient,
  ) {
    const internalFilter = this.canSeeInternal(tenant)
      ? Prisma.empty
      : Prisma.sql`AND visibility = 'NORMAL'::"TaskCommentVisibility"`;
    const [comment] = await tx.$queryRaw<Array<{ id: string; visibility: TaskCommentVisibility }>>`
      SELECT id, visibility
      FROM task_comments
      WHERE workspace_id = ${tenant.workspaceId}::uuid
        AND task_id = ${taskId}::uuid
        AND id = ${commentId}::uuid
        AND deleted_at IS NULL
        ${internalFilter}
      FOR UPDATE
    `;
    if (!comment) throw new NotFoundException('Comment not found.');
    return comment;
  }

  private assertCanChangeComment(
    tenant: WorkspaceTenantContext,
    authorMembershipId: string,
    ownPermission: string,
  ) {
    if (this.hasPermission(tenant, PermissionKeys.taskCommentsModerate)) return;
    if (
      tenant.workspaceMembershipId === authorMembershipId &&
      this.hasPermission(tenant, ownPermission)
    ) {
      return;
    }
    throw new ForbiddenException('Insufficient comment permissions.');
  }

  private requireWorkspaceMembership(tenant: WorkspaceTenantContext) {
    if (!tenant.workspaceMembershipId) {
      throw new ForbiddenException('Workspace membership is required for task comments.');
    }
    return tenant.workspaceMembershipId;
  }

  private assertPermission(tenant: WorkspaceTenantContext, permission: string) {
    if (!this.hasPermission(tenant, permission))
      throw new ForbiddenException('Insufficient permissions.');
  }

  private assertTimeEntryMutationAllowed(
    tenant: WorkspaceTenantContext,
    ownerMembershipId: string,
    ownPermission: string,
  ) {
    if (this.hasPermission(tenant, PermissionKeys.taskTimeManage)) return;
    if (
      tenant.workspaceMembershipId === ownerMembershipId &&
      this.hasPermission(tenant, ownPermission)
    ) {
      return;
    }
    throw new ForbiddenException('Insufficient time entry permissions.');
  }

  private async stopTimeEntryInTransaction(
    tx: Prisma.TransactionClient,
    timeEntryId: string,
    stoppedAt: Date,
    stopReason: TaskTimeEntryStopReason,
    updatedByMembershipId: string | null,
  ) {
    const entry = await tx.taskTimeEntry.findFirst({
      where: { id: timeEntryId, endedAt: null, deletedAt: null },
      select: { id: true, startedAt: true },
    });
    if (!entry) throw new ConflictException('TIME_ENTRY_ALREADY_STOPPED');
    const durationSeconds = Math.max(
      0,
      Math.floor((stoppedAt.getTime() - entry.startedAt.getTime()) / 1000),
    );
    return tx.taskTimeEntry.update({
      where: { id: timeEntryId },
      data: { endedAt: stoppedAt, durationSeconds, stopReason, updatedByMembershipId },
      select: timeEntrySelect,
    });
  }

  private async autoStopTaskTimers(
    tx: Prisma.TransactionClient,
    tenant: WorkspaceTenantContext,
    taskId: string,
    stoppedAt: Date,
    stopReason: TaskTimeEntryStopReason,
  ) {
    const running = await tx.taskTimeEntry.findMany({
      where: {
        workspaceId: tenant.workspaceId,
        taskId,
        entryType: TaskTimeEntryType.TIMER,
        endedAt: null,
        deletedAt: null,
      },
      select: { id: true, startedAt: true, workspaceMembershipId: true },
    });
    for (const entry of running) {
      const durationSeconds = Math.max(
        0,
        Math.floor((stoppedAt.getTime() - entry.startedAt.getTime()) / 1000),
      );
      await tx.taskTimeEntry.update({
        where: { id: entry.id },
        data: {
          endedAt: stoppedAt,
          durationSeconds,
          stopReason,
          updatedByMembershipId: tenant.workspaceMembershipId,
        },
      });
      await tx.auditLog.create({
        data: {
          superAgencyId: tenant.superAgencyId,
          agencyId: tenant.agencyId,
          workspaceId: tenant.workspaceId,
          userId: tenant.userId,
          action: 'task.time_auto_stopped',
          entityType: 'TaskTimeEntry',
          entityId: entry.id,
          metadata: {
            taskId,
            timeEntryId: entry.id,
            membershipId: entry.workspaceMembershipId,
            durationSeconds,
            stopReason,
          },
        },
      });
    }
  }

  private hasPermission(tenant: WorkspaceTenantContext, permission: string) {
    return tenant.permissions.includes('*') || tenant.permissions.includes(permission);
  }

  private async workspaceTimezone(workspaceId: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { timezone: true },
    });
    return safeWorkspaceTimezone(workspace?.timezone, workspaceId);
  }

  private async evaluateAutomationEvents(eventIds: string[]) {
    for (const eventId of eventIds) {
      await this.automationEvents.evaluateDomainEvent(eventId);
    }
  }

  private async recordTaskStatusAutomationEvents(
    tx: Prisma.TransactionClient,
    tenant: WorkspaceTenantContext,
    previous: {
      id: string;
      statusDefinitionId: string;
      statusDefinition: { isTerminal: boolean };
      priority: TaskPriority;
      departmentId: string | null;
      dueAt: Date | null;
    },
    current: {
      id: string;
      statusDefinitionId: string;
      priority: TaskPriority;
      departmentId: string | null;
      dueAt: Date | null;
      assignees?: Array<{ membershipId: string }>;
    },
    statusIsTerminal: boolean,
    automation?: AutomationMutationContext,
  ) {
    if (previous.statusDefinitionId === current.statusDefinitionId) return [];

    const occurredAt = new Date();
    const statusSequence =
      (await tx.automationDomainEvent.count({
        where: {
          workspaceId: tenant.workspaceId,
          entityType: AutomationDomainEventEntityType.TASK,
          entityId: current.id,
          eventType: AutomationTriggerType.TASK_STATUS_CHANGED,
        },
      })) + 1;
    const correlationId = automationCorrelationId(
      automation,
      `task:${current.id}:status:${statusSequence}`,
    );
    const statusEvent = await this.automationEvents.recordDomainEventInTransaction(tx, {
      workspaceId: tenant.workspaceId,
      eventType: AutomationTriggerType.TASK_STATUS_CHANGED,
      entityType: AutomationDomainEventEntityType.TASK,
      entityId: current.id,
      actorMembershipId: tenant.workspaceMembershipId ?? null,
      occurredAt,
      correlationId,
      causationId: automationCausationId(automation),
      automationDepth: automationDepth(automation),
      payload: {
        taskId: current.id,
        workspaceId: tenant.workspaceId,
        previousStatusDefinitionId: previous.statusDefinitionId,
        newStatusDefinitionId: current.statusDefinitionId,
        priority: current.priority,
        departmentId: current.departmentId,
        changedByMembershipId: tenant.workspaceMembershipId ?? null,
        occurredAt: occurredAt.toISOString(),
      },
      idempotencyKey: `task:${current.id}:status:${statusSequence}`,
    });
    const eventIds = statusEvent.id ? [statusEvent.id] : [];
    if (statusIsTerminal && !previous.statusDefinition.isTerminal) {
      const completionCycle =
        (await tx.automationDomainEvent.count({
          where: {
            workspaceId: tenant.workspaceId,
            entityType: AutomationDomainEventEntityType.TASK,
            entityId: current.id,
            eventType: AutomationTriggerType.TASK_COMPLETED,
          },
        })) + 1;
      const completionEvent = await this.automationEvents.recordDomainEventInTransaction(tx, {
        workspaceId: tenant.workspaceId,
        eventType: AutomationTriggerType.TASK_COMPLETED,
        entityType: AutomationDomainEventEntityType.TASK,
        entityId: current.id,
        actorMembershipId: tenant.workspaceMembershipId ?? null,
        occurredAt,
        correlationId,
        causationId: automationCausationId(automation),
        automationDepth: automationDepth(automation),
        payload: {
          taskId: current.id,
          workspaceId: tenant.workspaceId,
          statusDefinitionId: current.statusDefinitionId,
          priority: current.priority,
          departmentId: current.departmentId,
          completedAt: occurredAt.toISOString(),
          dueAt: current.dueAt?.toISOString() ?? null,
          completionCycle,
          assigneeMembershipIds: current.assignees?.map((assignee) => assignee.membershipId) ?? [],
        },
        idempotencyKey: `task:${current.id}:completion:${completionCycle}`,
      });
      if (completionEvent.id) eventIds.push(completionEvent.id);
    }
    return eventIds;
  }

  private canSeeInternal(tenant: WorkspaceTenantContext) {
    return this.hasPermission(tenant, PermissionKeys.taskCommentsInternal);
  }

  private async completionGate(workspaceId: string, taskId: string) {
    const policy = await this.prisma.taskCompletionPolicy.findFirst({
      where: { workspaceId, taskId },
      select: {
        proofRequirementMode: true,
        approvalRequired: true,
      },
    });
    return {
      required:
        Boolean(policy?.approvalRequired) ||
        Boolean(policy && policy.proofRequirementMode !== TaskCompletionProofRequirementMode.NONE),
      proofRequirementMode: policy?.proofRequirementMode ?? TaskCompletionProofRequirementMode.NONE,
      approvalRequired: Boolean(policy?.approvalRequired),
    };
  }

  private completionFlowRequired({
    taskId,
    taskIds,
    requestedTerminalStatusDefinitionId,
    gate,
  }: {
    taskId?: string;
    taskIds?: string[];
    requestedTerminalStatusDefinitionId: string;
    gate?: {
      proofRequirementMode: TaskCompletionProofRequirementMode;
      approvalRequired: boolean;
    };
  }) {
    return new ConflictException({
      code: 'COMPLETION_FLOW_REQUIRED',
      message: 'COMPLETION_FLOW_REQUIRED',
      details: {
        ...(taskId ? { taskId } : {}),
        ...(taskIds ? { taskIds } : {}),
        requestedTerminalStatusDefinitionId,
        proofRequirementMode: gate?.proofRequirementMode,
        approvalRequired: gate?.approvalRequired,
      },
    });
  }

  private async findCompletionRequiredTaskIds(workspaceId: string, taskIds: string[]) {
    if (taskIds.length === 0) return [];
    const policies = await this.prisma.taskCompletionPolicy.findMany({
      where: {
        workspaceId,
        taskId: { in: taskIds },
        OR: [
          { approvalRequired: true },
          { proofRequirementMode: { not: TaskCompletionProofRequirementMode.NONE } },
        ],
      },
      select: { taskId: true },
    });
    return policies.map((policy) => policy.taskId);
  }

  private async findPendingCompletionTaskIds(workspaceId: string, taskIds: string[]) {
    if (taskIds.length === 0) return [];
    const tasks = await this.prisma.task.findMany({
      where: {
        workspaceId,
        id: { in: taskIds },
        pendingCompletionSubmissionId: { not: null },
      },
      select: { id: true },
    });
    return tasks.map((task) => task.id);
  }

  private async assertNoPendingCompletion(workspaceId: string, taskId: string) {
    const pending = await this.findPendingCompletionTaskIds(workspaceId, [taskId]);
    if (pending.length > 0) throw new ConflictException('COMPLETION_APPROVAL_PENDING');
  }

  private async normalizeCompletionPolicy(workspaceId: string, dto: CompletionPolicyDto) {
    const requiredProofTypes = [...new Set(dto.requiredProofTypes ?? [])];
    if (dto.proofRequirementMode === TaskCompletionProofRequirementMode.SPECIFIC) {
      if (requiredProofTypes.length === 0) {
        throw new BadRequestException('Specific completion proof requires at least one type.');
      }
    } else if (requiredProofTypes.length > 0) {
      throw new BadRequestException('Required proof types are only valid for specific proof.');
    }
    const approvalRequired = dto.approvalRequired === true;
    const approverMode = approvalRequired
      ? (dto.approverMode ?? TaskCompletionApproverMode.ANY_ONE)
      : null;
    const explicitApproverMembershipIds = dto.explicitApproverMembershipIds
      ? await this.activeMembershipIds(workspaceId, dto.explicitApproverMembershipIds)
      : [];
    return {
      proofRequirementMode: dto.proofRequirementMode,
      requiredProofTypes,
      approvalRequired,
      approverMode,
      includeTaskCreator: dto.includeTaskCreator === true,
      includePermissionApprovers: dto.includePermissionApprovers === true,
      includeProjectOwnersManagers: dto.includeProjectOwnersManagers === true,
      explicitApproverMembershipIds,
    };
  }

  private async syncRecurrenceCompletionBlueprint(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    seriesId: string,
    normalized: Awaited<ReturnType<TasksService['normalizeCompletionPolicy']>>,
  ) {
    await tx.taskRecurrenceSeries.updateMany({
      where: { id: seriesId, workspaceId },
      data: {
        completionProofRequirementMode: normalized.proofRequirementMode,
        completionRequiredProofTypes: normalized.requiredProofTypes,
        completionApprovalRequired: normalized.approvalRequired,
        completionApproverMode: normalized.approverMode,
        completionIncludeTaskCreator: normalized.includeTaskCreator,
        completionIncludePermissionApprovers: normalized.includePermissionApprovers,
        completionIncludeProjectOwnersManagers: normalized.includeProjectOwnersManagers,
        lastErrorCode: null,
      },
    });
    await tx.taskRecurrenceCompletionApprover.deleteMany({ where: { workspaceId, seriesId } });
    if (normalized.explicitApproverMembershipIds.length > 0) {
      await tx.taskRecurrenceCompletionApprover.createMany({
        data: normalized.explicitApproverMembershipIds.map((membershipId) => ({
          workspaceId,
          seriesId,
          membershipId,
        })),
        skipDuplicates: true,
      });
    }
  }

  private async submitCompletionForTerminalStatus(
    tenant: WorkspaceTenantContext,
    taskId: string,
    status: { id: string; isTerminal: boolean },
    dto: SubmitTaskCompletionDto,
  ) {
    const membershipId = this.requireWorkspaceMembership(tenant);
    if (!status.isTerminal) throw new BadRequestException('Completion requires a terminal status.');
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, workspaceId: tenant.workspaceId, deletedAt: null },
      select: {
        id: true,
        workspaceId: true,
        statusDefinitionId: true,
        pendingCompletionSubmissionId: true,
        createdById: true,
        statusDefinition: { select: { isTerminal: true } },
        projects: { select: { projectId: true } },
      },
    });
    if (!task) throw new NotFoundException('Task not found.');
    if (task.statusDefinition.isTerminal) throw new ConflictException('Task is already terminal.');
    if (task.pendingCompletionSubmissionId)
      throw new ConflictException('COMPLETION_APPROVAL_PENDING');
    const policy =
      (await this.prisma.taskCompletionPolicy.findFirst({
        where: { workspaceId: tenant.workspaceId, taskId },
        select: taskCompletionPolicySelect,
      })) ?? null;
    const effectivePolicy = policy ?? null;
    const proofItems = await this.normalizeCompletionProofItems(
      tenant.workspaceId,
      dto.proofItems ?? [],
    );
    this.assertProofSatisfiesPolicy(effectivePolicy, proofItems);
    const approvers =
      effectivePolicy?.approvalRequired === true
        ? await this.resolveCompletionApprovers(tenant.workspaceId, task, effectivePolicy)
        : [];
    if (effectivePolicy?.approvalRequired === true && approvers.length === 0) {
      throw new ConflictException('NO_ELIGIBLE_APPROVER');
    }
    const result = await this.prisma
      .$transaction(async (tx) => {
        await lockTaskForKanban(tx, tenant.workspaceId, taskId);
        const lockedTask = await tx.task.findFirst({
          where: { id: taskId, workspaceId: tenant.workspaceId, deletedAt: null },
          select: {
            id: true,
            workspaceId: true,
            statusDefinitionId: true,
            pendingCompletionSubmissionId: true,
            createdById: true,
            statusDefinition: { select: { isTerminal: true } },
            projects: { select: { projectId: true } },
          },
        });
        if (!lockedTask) throw new NotFoundException('Task not found.');
        if (lockedTask.statusDefinition.isTerminal)
          throw new ConflictException('Task is already terminal.');
        if (lockedTask.pendingCompletionSubmissionId) {
          throw new ConflictException('COMPLETION_APPROVAL_PENDING');
        }
        const latest = await tx.taskCompletionSubmission.findFirst({
          where: { workspaceId: tenant.workspaceId, taskId },
          select: { version: true },
          orderBy: { version: 'desc' },
        });
        const version = (latest?.version ?? 0) + 1;
        const approvalRequired = effectivePolicy?.approvalRequired === true;
        const submission = await tx.taskCompletionSubmission.create({
          data: {
            workspaceId: tenant.workspaceId,
            taskId,
            version,
            status: approvalRequired
              ? TaskCompletionSubmissionStatus.PENDING_APPROVAL
              : TaskCompletionSubmissionStatus.ACCEPTED,
            requestedTerminalStatusDefinitionId: status.id,
            previousStatusDefinitionId: lockedTask.statusDefinitionId,
            submittedByMembershipId: membershipId,
            proofRequirementModeSnapshot:
              effectivePolicy?.proofRequirementMode ?? TaskCompletionProofRequirementMode.NONE,
            requiredProofTypesSnapshot: effectivePolicy?.requiredProofTypes ?? [],
            approvalRequiredSnapshot: approvalRequired,
            approverModeSnapshot: approvalRequired
              ? (effectivePolicy?.approverMode ?? TaskCompletionApproverMode.ANY_ONE)
              : null,
            resolvedAt: approvalRequired ? null : new Date(),
          },
          select: { id: true },
        });
        await this.createCompletionProofItems(tx, tenant.workspaceId, submission.id, proofItems);
        if (approvalRequired) {
          await tx.taskCompletionSubmissionApprover.createMany({
            data: approvers.map((approver) => ({
              workspaceId: tenant.workspaceId,
              submissionId: submission.id,
              membershipId: approver.membershipId,
              sources: approver.sources,
            })),
            skipDuplicates: true,
          });
          await tx.task.update({
            where: { id: taskId },
            data: {
              pendingCompletionSubmissionId: submission.id,
              updatedById: tenant.userId,
            },
          });
        } else {
          await this.applyTaskStatusTransition(tx, tenant, taskId, status.id, status.isTerminal);
        }
        return {
          submission: await tx.taskCompletionSubmission.findUniqueOrThrow({
            where: { id: submission.id },
            select: taskCompletionSubmissionSelect,
          }),
          task: await tx.task.findFirstOrThrow({
            where: { id: taskId, workspaceId: tenant.workspaceId },
            select: taskDetailSelect,
          }),
        };
      }, serializableTransaction)
      .catch(mapHierarchyWriteError);
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action:
        result.submission.status === TaskCompletionSubmissionStatus.PENDING_APPROVAL
          ? 'task.completion_submitted'
          : 'task.completion_accepted',
      entityType: 'TaskCompletionSubmission',
      entityId: result.submission.id,
      metadata: { taskId, version: result.submission.version },
    });
    if (result.submission.status === TaskCompletionSubmissionStatus.ACCEPTED) {
      await this.gamification.evaluateTaskCompletionAchievements(tenant.workspaceId, taskId);
      await this.gamification.handleTaskCompletionXp(
        tenant.workspaceId,
        taskId,
        tenant.workspaceMembershipId ?? null,
      );
    }
    return serializeTaskDetail(result.task, tenant);
  }

  private async applyTaskStatusTransition(
    tx: Prisma.TransactionClient,
    tenant: WorkspaceTenantContext,
    taskId: string,
    toStatusDefinitionId: string,
    targetIsTerminal: boolean,
  ) {
    await this.assertStatusTransition(tenant.workspaceId, [taskId], targetIsTerminal, tx);
    const kanbanRank = await this.nextKanbanRank(tx, tenant.workspaceId, toStatusDefinitionId);
    const updated = await tx.task.update({
      where: { id: taskId },
      data: {
        statusDefinitionId: toStatusDefinitionId,
        kanbanRank,
        pendingCompletionSubmissionId: null,
        updatedById: tenant.userId,
      },
      select: taskDetailSelect,
    });
    if (targetIsTerminal) {
      await this.autoStopTaskTimers(
        tx,
        tenant,
        taskId,
        new Date(),
        TaskTimeEntryStopReason.TASK_TERMINAL,
      );
    }
    return updated;
  }

  private async normalizeCompletionProofItems(
    workspaceId: string,
    items: CompletionProofItemDto[],
  ): Promise<NormalizedCompletionProofItem[]> {
    const normalized = items.map((item) => {
      if (item.type === TaskCompletionProofType.TEXT) {
        const textValue = item.textValue?.trim() ?? '';
        if (!textValue) throw new BadRequestException('MISSING_PROOF');
        if (textValue.length > COMPLETION_TEXT_MAX_LENGTH) {
          throw new BadRequestException('Completion proof text is too long.');
        }
        return { type: 'TEXT', textValue } satisfies NormalizedCompletionProofItem;
      }
      if (item.type === TaskCompletionProofType.URL) {
        return {
          type: 'URL',
          url: normalizeProofUrl(item.url ?? ''),
        } satisfies NormalizedCompletionProofItem;
      }
      if (item.type === TaskCompletionProofType.CHECKLIST_CONFIRMATION) {
        if (item.checklistConfirmed !== true) throw new BadRequestException('MISSING_PROOF');
        return {
          type: 'CHECKLIST_CONFIRMATION',
          checklistConfirmed: true,
        } satisfies NormalizedCompletionProofItem;
      }
      if (!item.attachmentId) throw new BadRequestException('MISSING_PROOF');
      return {
        type: 'ATTACHMENT',
        attachmentId: item.attachmentId,
      } satisfies NormalizedCompletionProofItem;
    });
    const attachmentIds = normalized
      .filter(
        (item): item is { type: 'ATTACHMENT'; attachmentId: string } =>
          item.type === TaskCompletionProofType.ATTACHMENT,
      )
      .map((item) => item.attachmentId);
    if (attachmentIds.length > 0) {
      const attachments = await this.prisma.attachment.findMany({
        where: {
          id: { in: attachmentIds },
          workspaceId,
          deletedAt: null,
          type: AttachmentType.FILE,
          asset: { status: AssetStatus.READY, deletedAt: null },
        },
        select: { id: true },
      });
      if (attachments.length !== new Set(attachmentIds).size) {
        throw new NotFoundException('FOREIGN_ATTACHMENT');
      }
    }
    return normalized;
  }

  private assertProofSatisfiesPolicy(
    policy: TaskCompletionPolicyRecord | null,
    proofItems: NormalizedCompletionProofItem[],
  ) {
    const mode = policy?.proofRequirementMode ?? TaskCompletionProofRequirementMode.NONE;
    if (mode === TaskCompletionProofRequirementMode.NONE) return;
    if (proofItems.length === 0) throw new BadRequestException('MISSING_PROOF');
    if (mode === TaskCompletionProofRequirementMode.ANY) return;
    const suppliedTypes = new Set(proofItems.map((item) => item.type));
    const missing = (policy?.requiredProofTypes ?? []).filter((type) => !suppliedTypes.has(type));
    if (missing.length > 0) throw new BadRequestException('MISSING_PROOF');
  }

  private async resolveCompletionApprovers(
    workspaceId: string,
    task: {
      createdById: string;
      projects: { projectId: string }[];
    },
    policy: TaskCompletionPolicyRecord,
  ) {
    const candidates = new Map<string, Set<string>>();
    const add = (membershipId: string, source: string) => {
      const set = candidates.get(membershipId) ?? new Set<string>();
      set.add(source);
      candidates.set(membershipId, set);
    };
    for (const approver of policy.approvers) add(approver.membershipId, 'EXPLICIT');
    if (policy.includeTaskCreator) {
      const creatorMembership = await this.prisma.workspaceMembership.findFirst({
        where: { workspaceId, userId: task.createdById, status: MembershipStatus.ACTIVE },
        select: { id: true },
      });
      if (creatorMembership) add(creatorMembership.id, 'TASK_CREATOR');
    }
    if (policy.includePermissionApprovers) {
      const permissionApprovers = await this.prisma.workspaceMembership.findMany({
        where: {
          workspaceId,
          status: MembershipStatus.ACTIVE,
          role: {
            rolePermissions: {
              some: { permission: { key: PermissionKeys.taskCompletionApprove } },
            },
          },
        },
        select: { id: true },
      });
      for (const approver of permissionApprovers) add(approver.id, 'PERMISSION');
    }
    return [...candidates.entries()].map(([membershipId, sources]) => ({
      membershipId,
      sources: [...sources].sort(),
    }));
  }

  private async createCompletionProofItems(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    submissionId: string,
    proofItems: NormalizedCompletionProofItem[],
  ) {
    for (const item of proofItems) {
      const proof = await tx.taskCompletionProofItem.create({
        data: {
          workspaceId,
          submissionId,
          type: item.type,
          textValue: 'textValue' in item ? item.textValue : null,
          url: 'url' in item ? item.url : null,
          checklistConfirmed: 'checklistConfirmed' in item ? item.checklistConfirmed : null,
        },
        select: { id: true },
      });
      if ('attachmentId' in item) {
        await tx.taskCompletionProofAttachment.create({
          data: { workspaceId, proofItemId: proof.id, attachmentId: item.attachmentId },
        });
      }
    }
  }

  private taskWhere(tenant: WorkspaceTenantContext, query: TaskQueryDto): Prisma.TaskWhereInput {
    const workspaceId = tenant.workspaceId;
    return {
      workspaceId,
      deletedAt: null,
      statusDefinitionId: query.statusDefinitionId,
      priority: query.priority,
      departmentId: query.departmentId,
      createdById: query.createdById,
      ...(query.search
        ? { title: { contains: query.search.trim(), mode: Prisma.QueryMode.insensitive } }
        : {}),
      ...(query.assigneeMembershipId
        ? { assignees: { some: { membershipId: query.assigneeMembershipId, workspaceId } } }
        : {}),
      ...(query.projectId
        ? {
            projects: {
              some: {
                projectId: query.projectId,
                workspaceId,
                project: this.visibleProjectLinkWhere(tenant),
              },
            },
          }
        : {}),
      ...(query.tagId ? { tags: { some: { tagId: query.tagId, workspaceId } } } : {}),
      ...(query.dueFrom || query.dueTo
        ? {
            dueAt: {
              gte: query.dueFrom ? new Date(query.dueFrom) : undefined,
              lte: query.dueTo ? new Date(query.dueTo) : undefined,
            },
          }
        : {}),
    };
  }

  private taskViewWhere(
    tenant: WorkspaceTenantContext,
    query: TaskViewFilterQueryDtoLike,
  ): Prisma.TaskWhereInput {
    const workspaceId = tenant.workspaceId;
    return {
      workspaceId,
      deletedAt: null,
      priority: query.priority,
      departmentId: query.departmentId,
      ...(query.search
        ? { title: { contains: query.search.trim(), mode: Prisma.QueryMode.insensitive } }
        : {}),
      ...(query.assigneeMembershipId
        ? { assignees: { some: { membershipId: query.assigneeMembershipId, workspaceId } } }
        : {}),
      ...(query.projectId
        ? {
            projects: {
              some: {
                projectId: query.projectId,
                workspaceId,
                project: this.visibleProjectLinkWhere(tenant),
              },
            },
          }
        : {}),
      ...(query.tagId ? { tags: { some: { tagId: query.tagId, workspaceId } } } : {}),
    };
  }

  private reportWhere(
    tenant: WorkspaceTenantContext,
    query: TaskReportsQueryDto,
    timezone: string,
  ): Prisma.TaskWhereInput {
    const range = reportDateWindow(query, timezone);
    return {
      ...this.taskViewWhere(tenant, query),
      ...(range.from || range.to
        ? {
            dueAt: {
              ...(range.from ? { gte: range.from } : {}),
              ...(range.to ? (range.toExclusive ? { lt: range.to } : { lte: range.to }) : {}),
            },
          }
        : {}),
    };
  }

  private visibleProjectLinkWhere(tenant: WorkspaceTenantContext): Prisma.ProjectWhereInput {
    if (!this.hasPermission(tenant, PermissionKeys.projectsView))
      return { id: '00000000-0000-4000-8000-000000000000' };
    const base: Prisma.ProjectWhereInput = {
      workspaceId: tenant.workspaceId,
      status: { not: ProjectStatus.ARCHIVED },
      archivedAt: null,
    };
    if (this.hasPermission(tenant, PermissionKeys.projectsViewAll)) return base;
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

  private async reportTrackedSeconds(tenant: WorkspaceTenantContext, taskIds: string[]) {
    if (!taskIds.length) return { value: 0, restricted: false };
    if (!this.hasPermission(tenant, PermissionKeys.taskTimeViewAll)) {
      return { value: null, restricted: true };
    }
    const result = await this.prisma.taskTimeEntry.aggregate({
      where: {
        workspaceId: tenant.workspaceId,
        taskId: { in: taskIds },
        deletedAt: null,
        endedAt: { not: null },
      },
      _sum: { durationSeconds: true },
    });
    return { value: result._sum.durationSeconds ?? 0, restricted: false };
  }

  private async timeReportTotalSeconds(
    tenant: WorkspaceTenantContext,
    query: {
      taskId?: string;
      workspaceMembershipId?: string;
      entryType?: TaskTimeEntryType;
      from: Date | null;
      to: Date | null;
      asOf: Date;
    },
  ) {
    const filters: Prisma.Sql[] = [
      Prisma.sql`workspace_id = ${tenant.workspaceId}::uuid`,
      Prisma.sql`deleted_at IS NULL`,
    ];
    if (query.taskId) filters.push(Prisma.sql`task_id = ${query.taskId}::uuid`);
    if (query.workspaceMembershipId) {
      filters.push(Prisma.sql`workspace_membership_id = ${query.workspaceMembershipId}::uuid`);
    }
    if (query.entryType) {
      filters.push(Prisma.sql`entry_type = ${query.entryType}::"TaskTimeEntryType"`);
    }
    if (query.to) filters.push(Prisma.sql`started_at < ${query.to}`);
    if (query.from) filters.push(Prisma.sql`COALESCE(ended_at, ${query.asOf}) >= ${query.from}`);
    const [row] = await this.prisma.$queryRaw<Array<{ total: bigint | number | null }>>(
      Prisma.sql`
        SELECT COALESCE(
          SUM(
            GREATEST(
              0,
              FLOOR(
                EXTRACT(
                  EPOCH FROM (
                    LEAST(COALESCE(ended_at, ${query.asOf}), ${query.to ?? query.asOf})
                    - GREATEST(started_at, ${query.from ?? new Date(0)})
                  )
                )
              )
            )
          ),
          0
        )::bigint AS total
        FROM task_time_entries
        WHERE ${Prisma.join(filters, ' AND ')}
      `,
    );
    return Number(row?.total ?? 0);
  }

  private async completionTrend(
    workspaceId: string,
    query: TaskReportsQueryDto,
    timezone: string,
    taskIds: string[],
  ) {
    if (!taskIds.length) return [];
    const range = reportDateWindow(query, timezone);
    const terminalStatuses = await this.prisma.statusDefinition.findMany({
      where: {
        workspaceId,
        entityType: StatusEntityType.TASK,
        isTerminal: true,
      },
      select: { id: true },
    });
    const terminalStatusIds = new Set(terminalStatuses.map((status) => status.id));
    const rows = await this.prisma.auditLog.findMany({
      where: {
        workspaceId,
        OR: [
          { entityType: 'Task', entityId: { in: taskIds }, action: 'task.status_changed' },
          {
            entityType: 'TaskCompletionSubmission',
            action: 'task.completion_approved',
          },
        ],
        ...(range.from || range.to
          ? {
              createdAt: {
                ...(range.from ? { gte: range.from } : {}),
                ...(range.to ? (range.toExclusive ? { lt: range.to } : { lte: range.to }) : {}),
              },
            }
          : {}),
      },
      select: { action: true, entityId: true, metadata: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: 5000,
    });
    const buckets = new Map<string, number>();
    const approvedKeys = new Set<string>();
    const countedKeys = new Set<string>();
    for (const row of rows) {
      const metadata = isRecord(row.metadata) ? row.metadata : {};
      const key = DateTime.fromJSDate(row.createdAt, { zone: timezone }).toISODate()!;
      if (
        row.action === 'task.completion_approved' &&
        metadata.completed === true &&
        typeof metadata.taskId === 'string' &&
        taskIds.includes(metadata.taskId)
      ) {
        approvedKeys.add(`${metadata.taskId}:${key}`);
      }
    }
    for (const row of rows) {
      const metadata = isRecord(row.metadata) ? row.metadata : {};
      const dateKey = DateTime.fromJSDate(row.createdAt, { zone: timezone }).toISODate()!;
      const taskId =
        row.action === 'task.status_changed'
          ? row.entityId
          : typeof metadata.taskId === 'string'
            ? metadata.taskId
            : null;
      if (!taskId || !taskIds.includes(taskId)) continue;
      const eventKey = `${taskId}:${dateKey}`;
      const counts =
        row.action === 'task.status_changed'
          ? typeof metadata.toStatusDefinitionId === 'string' &&
            terminalStatusIds.has(metadata.toStatusDefinitionId) &&
            !approvedKeys.has(eventKey)
          : metadata.completed === true;
      if (!counts || countedKeys.has(eventKey)) continue;
      countedKeys.add(eventKey);
      buckets.set(dateKey, (buckets.get(dateKey) ?? 0) + 1);
    }
    return [...buckets.entries()].map(([date, count]) => ({ date, count }));
  }

  private async assertTask(
    workspaceId: string,
    taskId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    const task = await tx.task.findFirst({
      where: { id: taskId, workspaceId, deletedAt: null },
      select: {
        id: true,
        parentTaskId: true,
        priority: true,
        statusDefinitionId: true,
        departmentId: true,
        plannedStartAt: true,
        dueAt: true,
        recurrenceSeriesId: true,
        recurrenceSequence: true,
        statusDefinition: { select: { isTerminal: true } },
      },
    });
    if (!task) throw new NotFoundException('Task not found.');
    return task;
  }

  private async assertBulkTasks(
    workspaceId: string,
    taskIds: string[],
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    const tasks = await tx.task.findMany({
      where: { id: { in: taskIds }, workspaceId, deletedAt: null },
      select: {
        id: true,
        parentTaskId: true,
        statusDefinitionId: true,
        priority: true,
        statusDefinition: { select: { isTerminal: true } },
      },
    });
    if (tasks.length !== taskIds.length) {
      throw new NotFoundException('One or more tasks were not found.');
    }
    return tasks;
  }

  private async findTask(workspaceId: string, taskId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, workspaceId, deletedAt: null },
      select: taskDetailSelect,
    });
    if (!task) throw new NotFoundException('Task not found.');
    return task;
  }

  private async taskStatus(workspaceId: string, statusDefinitionId?: string) {
    const where: Prisma.StatusDefinitionWhereInput = statusDefinitionId
      ? {
          id: statusDefinitionId,
          workspaceId,
          entityType: StatusEntityType.TASK,
          isActive: true,
        }
      : {
          workspaceId,
          entityType: StatusEntityType.TASK,
          isActive: true,
          isDefault: true,
        };
    const status = await this.prisma.statusDefinition.findFirst({
      where,
      select: { id: true, isTerminal: true },
    });
    if (!status) {
      throw new ConflictException(
        statusDefinitionId
          ? 'Task status is not available for this workspace.'
          : 'No active default task status is configured for this workspace.',
      );
    }
    return status;
  }

  private async hasActiveCompletionXpAward(
    workspaceId: string,
    workType: GamificationPointWorkType,
    sourceEntityId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    const award = await tx.gamificationWorkXpEvent.findFirst({
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

  private async nextKanbanRank(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    statusDefinitionId: string,
  ) {
    const last = await tx.task.findFirst({
      where: { workspaceId, statusDefinitionId, deletedAt: null, kanbanRank: { not: null } },
      select: { kanbanRank: true },
      orderBy: { kanbanRank: 'desc' },
    });
    return (last?.kanbanRank ?? new Prisma.Decimal(0)).plus(KANBAN_RANK_STEP);
  }

  private async ensureKanbanRanksForColumn(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    statusDefinitionId: string,
  ) {
    const nullRankCount = await tx.task.count({
      where: { workspaceId, statusDefinitionId, deletedAt: null, kanbanRank: null },
    });
    if (nullRankCount === 0) return;
    let nextRank = await this.nextKanbanRank(tx, workspaceId, statusDefinitionId);
    const tasks = await tx.task.findMany({
      where: { workspaceId, statusDefinitionId, deletedAt: null, kanbanRank: null },
      select: { id: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    for (const task of tasks) {
      await tx.task.update({
        where: { id: task.id },
        data: { kanbanRank: nextRank },
      });
      nextRank = nextRank.plus(KANBAN_RANK_STEP);
    }
  }

  private async kanbanPlacement(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    statusDefinitionId: string,
    beforeTaskId: string | null,
    afterTaskId: string | null,
    movingTaskId?: string,
  ) {
    const beforeAnchor = beforeTaskId
      ? await this.kanbanNeighbor(tx, workspaceId, statusDefinitionId, beforeTaskId)
      : null;
    const afterAnchor = afterTaskId
      ? await this.kanbanNeighbor(tx, workspaceId, statusDefinitionId, afterTaskId)
      : null;
    if (beforeAnchor && afterAnchor && !afterAnchor.kanbanRank.lt(beforeAnchor.kanbanRank)) {
      throw new ConflictException('Kanban placement is stale. Refresh and try again.');
    }

    const lowerRank =
      afterAnchor?.kanbanRank ??
      (beforeAnchor
        ? await this.adjacentKanbanRank(
            tx,
            workspaceId,
            statusDefinitionId,
            beforeAnchor.kanbanRank,
            'previous',
            movingTaskId,
          )
        : null);
    const upperRank =
      beforeAnchor?.kanbanRank ??
      (afterAnchor
        ? await this.adjacentKanbanRank(
            tx,
            workspaceId,
            statusDefinitionId,
            afterAnchor.kanbanRank,
            'next',
            movingTaskId,
          )
        : null);

    if (lowerRank && upperRank) {
      const midpoint = lowerRank.plus(upperRank).div(2).toDecimalPlaces(KANBAN_RANK_SCALE);
      if (midpoint.equals(lowerRank) || midpoint.equals(upperRank)) {
        return { rank: null };
      }
      return { rank: midpoint };
    }
    if (lowerRank) {
      return { rank: lowerRank.plus(KANBAN_RANK_STEP) };
    }
    if (upperRank) {
      return { rank: upperRank.minus(KANBAN_RANK_STEP) };
    }
    return { rank: await this.nextKanbanRank(tx, workspaceId, statusDefinitionId) };
  }

  private async adjacentKanbanRank(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    statusDefinitionId: string,
    anchorRank: Prisma.Decimal,
    direction: 'previous' | 'next',
    movingTaskId?: string,
  ) {
    const task = await tx.task.findFirst({
      where: {
        workspaceId,
        statusDefinitionId,
        deletedAt: null,
        id: movingTaskId ? { not: movingTaskId } : undefined,
        kanbanRank: direction === 'previous' ? { lt: anchorRank } : { gt: anchorRank },
      },
      select: { kanbanRank: true },
      orderBy: { kanbanRank: direction === 'previous' ? 'desc' : 'asc' },
    });
    return task?.kanbanRank ?? null;
  }

  private async kanbanNeighbor(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    statusDefinitionId: string,
    taskId: string,
  ) {
    const task = await tx.task.findFirst({
      where: { id: taskId, workspaceId, deletedAt: null },
      select: { id: true, statusDefinitionId: true, kanbanRank: true },
    });
    if (!task) throw new NotFoundException('Kanban placement task was not found.');
    if (task.statusDefinitionId !== statusDefinitionId || !task.kanbanRank) {
      throw new ConflictException('Kanban placement is stale. Refresh and try again.');
    }
    return { ...task, kanbanRank: task.kanbanRank };
  }

  private async rebalanceKanbanColumn(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    statusDefinitionId: string,
  ) {
    const tasks = await tx.task.findMany({
      where: { workspaceId, statusDefinitionId, deletedAt: null },
      select: { id: true },
      orderBy: [{ kanbanRank: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    let rank = KANBAN_RANK_STEP;
    for (const task of tasks) {
      await tx.task.update({ where: { id: task.id }, data: { kanbanRank: rank } });
      rank = rank.plus(KANBAN_RANK_STEP);
    }
  }

  private async assertCanAttachToParent(
    workspaceId: string,
    parentTaskId: string,
    childStatusIsTerminal: boolean,
    tx: Prisma.TransactionClient,
  ) {
    const parent = await this.assertTask(workspaceId, parentTaskId, tx);
    if (parent.statusDefinition.isTerminal && !childStatusIsTerminal) {
      throw new ConflictException(
        'Terminal parent tasks cannot contain active non-terminal subtasks.',
      );
    }
  }

  private async assertCanReparent(
    workspaceId: string,
    taskId: string,
    parentTaskId: string,
    tx: Prisma.TransactionClient,
  ) {
    const parent = await this.assertTask(workspaceId, parentTaskId, tx);
    const descendants = await descendantTaskIds(tx, workspaceId, [taskId], true);
    if (descendants.includes(parentTaskId)) {
      throw new ConflictException('Task hierarchy cycles are not allowed.');
    }
    if (parent.statusDefinition.isTerminal) {
      const hasOpenMovedWork = await subtreeHasNonTerminalTask(tx, workspaceId, taskId);
      if (hasOpenMovedWork) {
        throw new ConflictException(
          'Terminal parent tasks cannot contain active non-terminal subtasks.',
        );
      }
    }
  }

  private async assertStatusTransition(
    workspaceId: string,
    taskIds: string[],
    targetIsTerminal: boolean,
    tx: Prisma.TransactionClient,
  ) {
    await this.assertBulkStatusTransition(workspaceId, taskIds, targetIsTerminal, tx);
  }

  private async assertBulkStatusTransition(
    workspaceId: string,
    taskIds: string[],
    targetIsTerminal: boolean,
    tx: Prisma.TransactionClient,
  ) {
    const selectedIds = [...new Set(taskIds)];
    if (targetIsTerminal) {
      const blocking = await nonTerminalDescendantsOutsideSelection(tx, workspaceId, selectedIds);
      if (blocking.length > 0) {
        throw new ConflictException(
          'Parent tasks cannot become terminal while active descendants remain non-terminal.',
        );
      }
      const dependencyBlocking = await nonTerminalBlockersOutsideSelection(
        tx,
        workspaceId,
        selectedIds,
      );
      if (dependencyBlocking.length > 0) {
        throw new ConflictException(
          'Blocked tasks cannot become terminal while active blockers remain non-terminal.',
        );
      }
      return;
    }
    const blocking = await terminalAncestorsOutsideSelection(tx, workspaceId, selectedIds);
    if (blocking.length > 0) {
      throw new ConflictException(
        'A task cannot become non-terminal while an active ancestor remains terminal.',
      );
    }
  }

  private async activeMembershipIds(workspaceId: string, membershipIds: string[]) {
    if (membershipIds.length === 0) return [];
    const memberships = await this.prisma.workspaceMembership.findMany({
      where: { id: { in: membershipIds }, workspaceId },
      select: { id: true, status: true },
    });
    if (memberships.length !== membershipIds.length) {
      throw new NotFoundException('One or more workspace memberships were not found.');
    }
    if (memberships.some((membership) => membership.status !== MembershipStatus.ACTIVE)) {
      throw new BadRequestException('Task memberships must be active.');
    }
    return membershipIds;
  }

  private async activeProjectIds(tenant: WorkspaceTenantContext, projectIds: string[]) {
    if (projectIds.length === 0) return [];
    const projects = await this.prisma.project.findMany({
      where: {
        id: { in: projectIds },
        workspaceId: tenant.workspaceId,
        ...this.visibleProjectRelationWhere(tenant),
      },
      select: { id: true, status: true },
    });
    if (projects.length !== projectIds.length) {
      throw new NotFoundException('One or more projects were not found.');
    }
    if (projects.some((project) => project.status === ProjectStatus.ARCHIVED)) {
      throw new BadRequestException('Archived projects cannot be linked to new task updates.');
    }
    return projectIds;
  }

  private async assertProjectsCanLinkTask(
    tx: Prisma.TransactionClient,
    tenant: WorkspaceTenantContext,
    projectIds: string[],
  ) {
    if (projectIds.length === 0) return;
    await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT "id"
      FROM "projects"
      WHERE "workspace_id" = ${tenant.workspaceId}::uuid
        AND "id" IN (${Prisma.join(uuidParams(projectIds))})
      FOR UPDATE
    `);
    const projects = await tx.project.findMany({
      where: {
        id: { in: projectIds },
        workspaceId: tenant.workspaceId,
        ...this.visibleProjectRelationWhere(tenant),
      },
      select: {
        id: true,
        status: true,
      },
    });
    if (projects.length !== projectIds.length) {
      throw new NotFoundException('One or more projects were not found.');
    }
    if (projects.some((project) => project.status === ProjectStatus.ARCHIVED)) {
      throw new BadRequestException('Archived projects cannot be linked to new task updates.');
    }
  }

  private visibleProjectRelationWhere(tenant: WorkspaceTenantContext): Prisma.ProjectWhereInput {
    if (this.hasPermission(tenant, PermissionKeys.projectsViewAll)) return {};
    const membershipId = tenant.workspaceMembershipId;
    return {
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

  private async assertWorkspaceTags(
    workspaceId: string,
    tagIds: string[],
    requireActive: boolean,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    if (tagIds.length === 0) return [];
    const tags = await tx.workspaceTag.findMany({
      where: { id: { in: tagIds }, workspaceId },
      select: { id: true, status: true },
    });
    if (tags.length !== tagIds.length) {
      throw new NotFoundException('One or more tags were not found.');
    }
    if (requireActive && tags.some((tag) => tag.status !== WorkspaceTagStatus.ACTIVE)) {
      throw new BadRequestException('Archived tags cannot be assigned to tasks.');
    }
    return tags;
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

  private async findActiveTaskAttachment(
    workspaceId: string,
    taskId: string,
    attachmentId: string,
  ) {
    const link = await this.prisma.taskAttachment.findFirst({
      where: {
        workspaceId,
        taskId,
        attachmentId,
        removedAt: null,
        attachment: { deletedAt: null },
      },
      select: taskAttachmentSelect,
    });
    if (!link) throw new NotFoundException('Attachment not found.');
    return link;
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

  private async activeDepartment(workspaceId: string, departmentId?: string | null) {
    if (!departmentId) return null;
    const department = await this.prisma.department.findFirst({
      where: { id: departmentId, workspaceId },
      select: { id: true, status: true },
    });
    if (!department) throw new NotFoundException('Department not found.');
    if (department.status !== DepartmentStatus.ACTIVE) {
      throw new BadRequestException('Department is not active.');
    }
    return department;
  }

  private async findSeries(workspaceId: string, seriesId: string) {
    const series = await this.prisma.taskRecurrenceSeries.findFirst({
      where: { id: seriesId, workspaceId },
      select: taskRecurrenceSeriesSelect,
    });
    if (!series) throw new NotFoundException('Recurrence series not found.');
    return series;
  }

  private async changeRecurrenceStatus(
    tenant: WorkspaceTenantContext,
    seriesId: string,
    status: 'PAUSED' | 'ENDED',
  ) {
    await this.findSeries(tenant.workspaceId, seriesId);
    const now = new Date();
    const updated = await this.prisma.taskRecurrenceSeries.update({
      where: { id: seriesId },
      data: {
        status,
        pausedAt: status === TaskRecurrenceStatus.PAUSED ? now : null,
        endedAt: status === TaskRecurrenceStatus.ENDED ? now : null,
        nextOccurrenceAt: status === TaskRecurrenceStatus.ENDED ? null : undefined,
        updatedById: tenant.userId,
      },
      select: taskRecurrenceSeriesSelect,
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action:
        status === TaskRecurrenceStatus.PAUSED ? 'task.recurrence_paused' : 'task.recurrence_ended',
      entityType: 'TaskRecurrenceSeries',
      entityId: seriesId,
      metadata: {},
    });
    return serializeTaskRecurrenceSeries(updated);
  }

  private async findTemplate(workspaceId: string, templateId: string) {
    const template = await this.prisma.taskTemplate.findFirst({
      where: { id: templateId, workspaceId },
      select: taskTemplateSelect,
    });
    if (!template) throw new NotFoundException('Task template not found.');
    return template;
  }

  private async setTemplateStatus(
    tenant: WorkspaceTenantContext,
    templateId: string,
    status: TaskTemplateStatus,
  ) {
    await this.findTemplate(tenant.workspaceId, templateId);
    const template = await this.prisma.taskTemplate.update({
      where: { id: templateId },
      data: {
        status,
        archivedAt: status === TaskTemplateStatus.ARCHIVED ? new Date() : null,
        updatedById: tenant.userId,
      },
      select: taskTemplateSelect,
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action:
        status === TaskTemplateStatus.ARCHIVED
          ? 'task.template_archived'
          : 'task.template_reactivated',
      entityType: 'TaskTemplate',
      entityId: templateId,
      metadata: {},
    });
    return serializeTaskTemplate(template);
  }

  private async templateData(
    tenant: WorkspaceTenantContext,
    dto: CreateTaskTemplateDto | UpdateTaskTemplateDto,
    partial = false,
  ) {
    const workspaceId = tenant.workspaceId;
    const status = dto.statusDefinitionId
      ? await this.taskStatus(workspaceId, dto.statusDefinitionId)
      : null;
    if (!partial && !status) throw new ConflictException('Template requires a task status.');
    if (status?.isTerminal)
      throw new BadRequestException('Task templates require a non-terminal status.');
    const department =
      'departmentId' in dto
        ? await this.activeDepartment(workspaceId, dto.departmentId)
        : undefined;
    const assigneeIds = dto.assigneeMembershipIds
      ? await this.activeMembershipIds(workspaceId, dto.assigneeMembershipIds)
      : [];
    const followerIds = dto.followerMembershipIds
      ? await this.activeMembershipIds(workspaceId, dto.followerMembershipIds)
      : [];
    const projectIds = dto.projectIds ? await this.activeProjectIds(tenant, dto.projectIds) : [];
    const tagIds = dto.tagIds ? uniqueIds(dto.tagIds) : [];
    if (tagIds.length > 0) await this.assertWorkspaceTags(workspaceId, tagIds, true);
    return {
      name: dto.name === undefined ? undefined : normalizeTemplateName(dto.name),
      title: dto.title === undefined ? undefined : normalizeTitle(dto.title),
      description:
        dto.description === undefined ? undefined : normalizeDescription(dto.description),
      priority: dto.priority,
      statusDefinitionId: status?.id,
      departmentId: department === undefined ? undefined : (department?.id ?? null),
      estimatedMinutes:
        dto.estimatedMinutes === undefined ? undefined : (dto.estimatedMinutes ?? null),
      assigneeIds,
      followerIds,
      projectIds,
      tagIds,
      replaceRelations:
        dto.assigneeMembershipIds !== undefined ||
        dto.followerMembershipIds !== undefined ||
        dto.projectIds !== undefined ||
        dto.tagIds !== undefined,
    };
  }

  private async replaceRecurrenceRelations(
    tx: Prisma.TransactionClient,
    seriesId: string,
    workspaceId: string,
    assigneeIds: string[],
    followerIds: string[],
    projectIds: string[],
    tagIds: string[],
  ) {
    await tx.taskRecurrenceAssignee.deleteMany({ where: { seriesId, workspaceId } });
    await tx.taskRecurrenceFollower.deleteMany({ where: { seriesId, workspaceId } });
    await tx.taskRecurrenceProject.deleteMany({ where: { seriesId, workspaceId } });
    await tx.taskRecurrenceTag.deleteMany({ where: { seriesId, workspaceId } });
    if (assigneeIds.length)
      await tx.taskRecurrenceAssignee.createMany({
        data: assigneeIds.map((membershipId) => ({ seriesId, workspaceId, membershipId })),
        skipDuplicates: true,
      });
    if (followerIds.length)
      await tx.taskRecurrenceFollower.createMany({
        data: followerIds.map((membershipId) => ({ seriesId, workspaceId, membershipId })),
        skipDuplicates: true,
      });
    if (projectIds.length)
      await tx.taskRecurrenceProject.createMany({
        data: projectIds.map((projectId) => ({ seriesId, workspaceId, projectId })),
        skipDuplicates: true,
      });
    if (tagIds.length)
      await tx.taskRecurrenceTag.createMany({
        data: tagIds.map((tagId) => ({ seriesId, workspaceId, tagId })),
        skipDuplicates: true,
      });
  }

  private async replaceTemplateRelations(
    tx: Prisma.TransactionClient,
    templateId: string,
    workspaceId: string,
    assigneeIds: string[],
    followerIds: string[],
    projectIds: string[],
    tagIds: string[],
  ) {
    await tx.taskTemplateAssignee.deleteMany({ where: { templateId, workspaceId } });
    await tx.taskTemplateFollower.deleteMany({ where: { templateId, workspaceId } });
    await tx.taskTemplateProject.deleteMany({ where: { templateId, workspaceId } });
    await tx.taskTemplateTag.deleteMany({ where: { templateId, workspaceId } });
    if (assigneeIds.length)
      await tx.taskTemplateAssignee.createMany({
        data: assigneeIds.map((membershipId) => ({ templateId, workspaceId, membershipId })),
        skipDuplicates: true,
      });
    if (followerIds.length)
      await tx.taskTemplateFollower.createMany({
        data: followerIds.map((membershipId) => ({ templateId, workspaceId, membershipId })),
        skipDuplicates: true,
      });
    if (projectIds.length)
      await tx.taskTemplateProject.createMany({
        data: projectIds.map((projectId) => ({ templateId, workspaceId, projectId })),
        skipDuplicates: true,
      });
    if (tagIds.length)
      await tx.taskTemplateTag.createMany({
        data: tagIds.map((tagId) => ({ templateId, workspaceId, tagId })),
        skipDuplicates: true,
      });
  }
}

const taskListSelect = {
  id: true,
  workspaceId: true,
  parentTaskId: true,
  title: true,
  priority: true,
  plannedStartAt: true,
  dueAt: true,
  estimatedMinutes: true,
  kanbanRank: true,
  pendingCompletionSubmissionId: true,
  createdAt: true,
  updatedAt: true,
  statusDefinition: {
    select: { id: true, name: true, color: true, category: true, isTerminal: true },
  },
  department: { select: { id: true, name: true, status: true } },
  assignees: {
    select: {
      membership: {
        select: {
          id: true,
          user: { select: { id: true, email: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
    take: 5,
  },
  projects: {
    select: {
      project: {
        select: {
          id: true,
          name: true,
          status: true,
          visibility: true,
          ownerMembershipId: true,
          members: { select: { workspaceMembershipId: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
    take: 5,
  },
  _count: { select: { assignees: true, followers: true, projects: true } },
} satisfies Prisma.TaskSelect;

const taskRelationshipSelect = {
  id: true,
  title: true,
  priority: true,
  plannedStartAt: true,
  dueAt: true,
  statusDefinition: {
    select: { id: true, name: true, color: true, category: true, isTerminal: true },
  },
  assignees: {
    select: {
      membership: {
        select: {
          id: true,
          user: { select: { id: true, email: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
    take: 3,
  },
} satisfies Prisma.TaskSelect;

const taskDetailSelect = {
  id: true,
  workspaceId: true,
  parentTaskId: true,
  title: true,
  description: true,
  priority: true,
  plannedStartAt: true,
  dueAt: true,
  estimatedMinutes: true,
  kanbanRank: true,
  recurrenceSeriesId: true,
  recurrenceScheduledFor: true,
  recurrenceSequence: true,
  recurrenceIsException: true,
  pendingCompletionSubmissionId: true,
  automationInvocationKey: true,
  archivedAt: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  statusDefinition: {
    select: {
      id: true,
      workspaceId: true,
      entityType: true,
      name: true,
      color: true,
      category: true,
      isDefault: true,
      isTerminal: true,
      isActive: true,
      position: true,
    },
  },
  parentTask: {
    select: {
      id: true,
      title: true,
      deletedAt: true,
      statusDefinition: {
        select: { id: true, name: true, color: true, category: true, isTerminal: true },
      },
    },
  },
  department: { select: { id: true, name: true, status: true } },
  createdBy: { select: { id: true, email: true, name: true } },
  updatedBy: { select: { id: true, email: true, name: true } },
  assignees: {
    select: {
      membership: {
        select: {
          id: true,
          status: true,
          user: { select: { id: true, email: true, name: true } },
          role: { select: { id: true, key: true, name: true } },
          department: { select: { id: true, name: true, status: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  },
  followers: {
    select: {
      membership: {
        select: {
          id: true,
          status: true,
          user: { select: { id: true, email: true, name: true } },
          role: { select: { id: true, key: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  },
  projects: {
    select: {
      project: {
        select: {
          id: true,
          name: true,
          status: true,
          visibility: true,
          ownerMembershipId: true,
          members: { select: { workspaceMembershipId: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  },
  _count: {
    select: {
      subtasks: { where: { deletedAt: null } },
      blockedByDependencies: {
        where: { blockerTask: { deletedAt: null }, blockedTask: { deletedAt: null } },
      },
      blockingDependencies: {
        where: { blockerTask: { deletedAt: null }, blockedTask: { deletedAt: null } },
      },
      relatedTaskALinks: { where: { taskA: { deletedAt: null }, taskB: { deletedAt: null } } },
      relatedTaskBLinks: { where: { taskA: { deletedAt: null }, taskB: { deletedAt: null } } },
    },
  },
} satisfies Prisma.TaskSelect;

const taskRecurrenceSeriesSelect = {
  id: true,
  workspaceId: true,
  status: true,
  title: true,
  description: true,
  priority: true,
  statusDefinitionId: true,
  departmentId: true,
  estimatedMinutes: true,
  timezone: true,
  frequency: true,
  interval: true,
  customIntervalUnit: true,
  startLocalDate: true,
  localTime: true,
  selectedWeekdays: true,
  monthlyDay: true,
  endMode: true,
  untilLocalDate: true,
  maxOccurrences: true,
  generatedCount: true,
  nextOccurrenceAt: true,
  lastGeneratedAt: true,
  pausedAt: true,
  endedAt: true,
  lastErrorCode: true,
  createdAt: true,
  updatedAt: true,
  statusDefinition: {
    select: { id: true, name: true, color: true, category: true, isTerminal: true, isActive: true },
  },
  department: { select: { id: true, name: true, status: true } },
  assignees: { select: { membershipId: true }, orderBy: { createdAt: 'asc' } },
  followers: { select: { membershipId: true }, orderBy: { createdAt: 'asc' } },
  projects: { select: { projectId: true }, orderBy: { createdAt: 'asc' } },
  tags: { select: { tagId: true }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.TaskRecurrenceSeriesSelect;

const taskTemplateSelect = {
  id: true,
  workspaceId: true,
  name: true,
  status: true,
  title: true,
  description: true,
  priority: true,
  statusDefinitionId: true,
  departmentId: true,
  estimatedMinutes: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  statusDefinition: {
    select: { id: true, name: true, color: true, category: true, isTerminal: true, isActive: true },
  },
  department: { select: { id: true, name: true, status: true } },
  assignees: { select: { membershipId: true }, orderBy: { createdAt: 'asc' } },
  followers: { select: { membershipId: true }, orderBy: { createdAt: 'asc' } },
  projects: { select: { projectId: true }, orderBy: { createdAt: 'asc' } },
  tags: { select: { tagId: true }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.TaskTemplateSelect;

const timeEntrySelect = {
  id: true,
  workspaceId: true,
  taskId: true,
  userId: true,
  workspaceMembershipId: true,
  entryType: true,
  startedAt: true,
  endedAt: true,
  durationSeconds: true,
  stopReason: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  workspace: {
    select: { id: true, name: true, agencyId: true, agency: { select: { superAgencyId: true } } },
  },
  task: {
    select: {
      id: true,
      title: true,
      statusDefinition: { select: { id: true, name: true, isTerminal: true } },
    },
  },
  workspaceMembership: {
    select: { id: true, user: { select: { id: true, name: true, email: true } } },
  },
} satisfies Prisma.TaskTimeEntrySelect;

const taskCommentSelect = {
  id: true,
  workspaceId: true,
  taskId: true,
  parentCommentId: true,
  body: true,
  visibility: true,
  editedAt: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  authorMembership: {
    select: {
      id: true,
      user: { select: { id: true, email: true, name: true } },
    },
  },
  mentions: {
    select: {
      membership: {
        select: {
          id: true,
          user: { select: { id: true, email: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
    take: 100,
  },
} satisfies Prisma.TaskCommentSelect;

const taskTagSelect = {
  tagId: true,
  createdAt: true,
  tag: {
    select: {
      id: true,
      workspaceId: true,
      name: true,
      color: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.TaskTagSelect;

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
  lifecycle: true,
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

const taskAttachmentSelect = {
  taskId: true,
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
} satisfies Prisma.TaskAttachmentSelect;

const reusableAttachmentSelect = {
  id: true,
  type: true,
  asset: { select: { id: true, status: true, lifecycle: true, deletedAt: true } },
} satisfies Prisma.AttachmentSelect;

const completionMembershipSelect = {
  id: true,
  user: { select: { id: true, email: true, name: true } },
} satisfies Prisma.WorkspaceMembershipSelect;

const taskCompletionPolicySelect = {
  id: true,
  workspaceId: true,
  taskId: true,
  proofRequirementMode: true,
  requiredProofTypes: true,
  approvalRequired: true,
  approverMode: true,
  includeTaskCreator: true,
  includePermissionApprovers: true,
  includeProjectOwnersManagers: true,
  createdAt: true,
  updatedAt: true,
  approvers: {
    select: {
      membershipId: true,
      membership: { select: completionMembershipSelect },
    },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.TaskCompletionPolicySelect;

const taskCompletionSubmissionSelect = {
  id: true,
  workspaceId: true,
  taskId: true,
  version: true,
  status: true,
  requestedTerminalStatusDefinitionId: true,
  previousStatusDefinitionId: true,
  submittedByMembershipId: true,
  submittedAt: true,
  proofRequirementModeSnapshot: true,
  requiredProofTypesSnapshot: true,
  approvalRequiredSnapshot: true,
  approverModeSnapshot: true,
  resolvedAt: true,
  createdAt: true,
  requestedTerminalStatusDefinition: {
    select: { id: true, name: true, color: true, category: true, isTerminal: true },
  },
  previousStatusDefinition: {
    select: { id: true, name: true, color: true, category: true, isTerminal: true },
  },
  submittedBy: { select: completionMembershipSelect },
  proofItems: {
    select: {
      id: true,
      type: true,
      textValue: true,
      url: true,
      checklistConfirmed: true,
      createdAt: true,
      attachments: {
        select: {
          attachmentId: true,
          attachment: { select: fileAttachmentSelect },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: { createdAt: 'asc' },
  },
  approvers: {
    select: {
      membershipId: true,
      sources: true,
      membership: { select: completionMembershipSelect },
    },
    orderBy: { createdAt: 'asc' },
  },
  decisions: {
    select: {
      id: true,
      approverMembershipId: true,
      decision: true,
      reason: true,
      decidedAt: true,
      approver: { select: completionMembershipSelect },
    },
    orderBy: { decidedAt: 'asc' },
  },
} satisfies Prisma.TaskCompletionSubmissionSelect;

type TaskListRecord = Prisma.TaskGetPayload<{ select: typeof taskListSelect }>;
type TaskRelationshipRecord = Prisma.TaskGetPayload<{ select: typeof taskRelationshipSelect }>;
type TaskDetailRecord = Prisma.TaskGetPayload<{ select: typeof taskDetailSelect }>;
type TaskRecurrenceSeriesRecord = Prisma.TaskRecurrenceSeriesGetPayload<{
  select: typeof taskRecurrenceSeriesSelect;
}>;
type TaskTemplateRecord = Prisma.TaskTemplateGetPayload<{ select: typeof taskTemplateSelect }>;
type TaskCommentRecord = Prisma.TaskCommentGetPayload<{ select: typeof taskCommentSelect }>;
type TaskTagRecord = Prisma.TaskTagGetPayload<{ select: typeof taskTagSelect }>;
type AttachmentAssetRecord = Prisma.AssetGetPayload<{ select: typeof attachmentAssetSelect }>;
type AttachmentCoreRecord = Prisma.AttachmentGetPayload<{ select: typeof attachmentCoreSelect }>;
type TaskAttachmentRecord = Prisma.TaskAttachmentGetPayload<{
  select: typeof taskAttachmentSelect;
}>;
type TaskCompletionPolicyRecord = Prisma.TaskCompletionPolicyGetPayload<{
  select: typeof taskCompletionPolicySelect;
}>;
type TaskCompletionSubmissionRecord = Prisma.TaskCompletionSubmissionGetPayload<{
  select: typeof taskCompletionSubmissionSelect;
}>;
type TaskTimeEntryRecord = Prisma.TaskTimeEntryGetPayload<{
  select: typeof timeEntrySelect;
}>;
type NormalizedCompletionProofItem =
  | { type: 'TEXT'; textValue: string }
  | { type: 'URL'; url: string }
  | { type: 'CHECKLIST_CONFIRMATION'; checklistConfirmed: true }
  | { type: 'ATTACHMENT'; attachmentId: string };

function serializeTaskListItem(task: TaskListRecord, tenant: WorkspaceTenantContext) {
  return {
    ...task,
    kanbanRank: task.kanbanRank?.toString() ?? null,
    status: task.statusDefinition,
    assignees: task.assignees.map((item) => item.membership),
    projects: visibleTaskProjects(task.projects, tenant),
    counts: task._count,
    completion: completionSummary(task.pendingCompletionSubmissionId),
    statusDefinition: undefined,
    _count: undefined,
  };
}

function serializeTaskDetail(task: TaskDetailRecord, tenant: WorkspaceTenantContext) {
  return {
    ...task,
    kanbanRank: task.kanbanRank?.toString() ?? null,
    status: task.statusDefinition,
    assignees: task.assignees.map((item) => item.membership),
    followers: task.followers.map((item) => item.membership),
    projects: visibleTaskProjects(task.projects, tenant),
    parent:
      task.parentTask && !task.parentTask.deletedAt
        ? {
            id: task.parentTask.id,
            title: task.parentTask.title,
            status: task.parentTask.statusDefinition,
            statusDefinition: undefined,
          }
        : null,
    directSubtaskCount: task._count.subtasks,
    blockedByCount: task._count.blockedByDependencies,
    blocksCount: task._count.blockingDependencies,
    relatedTaskCount: task._count.relatedTaskALinks + task._count.relatedTaskBLinks,
    completion: completionSummary(task.pendingCompletionSubmissionId),
    statusDefinition: undefined,
    parentTask: undefined,
    _count: undefined,
  };
}

function visibleTaskProjects(
  links: {
    project: {
      id: string;
      name: string;
      status: ProjectStatus;
      visibility: ProjectVisibility;
      ownerMembershipId: string;
      members: { workspaceMembershipId: string }[];
    };
  }[],
  tenant: WorkspaceTenantContext,
) {
  const canViewAll =
    tenant.permissions.includes('*') || tenant.permissions.includes(PermissionKeys.projectsViewAll);
  const membershipId = tenant.workspaceMembershipId;
  return links
    .map((item) => item.project)
    .filter(
      (project) =>
        project.visibility === ProjectVisibility.WORKSPACE ||
        canViewAll ||
        (membershipId &&
          (project.ownerMembershipId === membershipId ||
            project.members.some((member) => member.workspaceMembershipId === membershipId))),
    )
    .map(
      ({
        members: _members,
        ownerMembershipId: _ownerMembershipId,
        visibility: _visibility,
        ...project
      }) => project,
    );
}

function completionSummary(pendingCompletionSubmissionId: string | null) {
  return {
    pendingApproval: Boolean(pendingCompletionSubmissionId),
    pendingSubmissionId: pendingCompletionSubmissionId,
  };
}

function defaultCompletionPolicy(taskId: string) {
  return {
    id: null,
    taskId,
    proofRequirementMode: TaskCompletionProofRequirementMode.NONE,
    requiredProofTypes: [],
    approvalRequired: false,
    approverMode: null,
    includeTaskCreator: false,
    includePermissionApprovers: false,
    includeProjectOwnersManagers: false,
    explicitApproverMembershipIds: [],
    approvers: [],
  };
}

function serializeCompletionPolicy(policy: TaskCompletionPolicyRecord) {
  return {
    id: policy.id,
    workspaceId: policy.workspaceId,
    taskId: policy.taskId,
    proofRequirementMode: policy.proofRequirementMode,
    requiredProofTypes: policy.requiredProofTypes,
    approvalRequired: policy.approvalRequired,
    approverMode: policy.approverMode,
    includeTaskCreator: policy.includeTaskCreator,
    includePermissionApprovers: policy.includePermissionApprovers,
    includeProjectOwnersManagers: policy.includeProjectOwnersManagers,
    explicitApproverMembershipIds: policy.approvers.map((approver) => approver.membershipId),
    approvers: policy.approvers.map((approver) =>
      serializeCompletionMembership(approver.membership),
    ),
    createdAt: policy.createdAt,
    updatedAt: policy.updatedAt,
  };
}

function serializeCompletionSubmission(submission: TaskCompletionSubmissionRecord) {
  const approvedCount = submission.decisions.filter(
    (decision) => decision.decision === TaskCompletionDecision.APPROVED,
  ).length;
  const rejectedCount = submission.decisions.filter(
    (decision) => decision.decision === TaskCompletionDecision.REJECTED,
  ).length;
  return {
    id: submission.id,
    workspaceId: submission.workspaceId,
    taskId: submission.taskId,
    version: submission.version,
    status: submission.status,
    requestedTerminalStatusDefinitionId: submission.requestedTerminalStatusDefinitionId,
    previousStatusDefinitionId: submission.previousStatusDefinitionId,
    requestedTerminalStatus: submission.requestedTerminalStatusDefinition,
    previousStatus: submission.previousStatusDefinition,
    submittedBy: serializeCompletionMembership(submission.submittedBy),
    submittedAt: submission.submittedAt,
    proofRequirementMode: submission.proofRequirementModeSnapshot,
    requiredProofTypes: submission.requiredProofTypesSnapshot,
    approvalRequired: submission.approvalRequiredSnapshot,
    approverMode: submission.approverModeSnapshot,
    resolvedAt: submission.resolvedAt,
    proofItems: submission.proofItems.map((item) => ({
      id: item.id,
      type: item.type,
      textValue: item.textValue,
      url: item.url,
      checklistConfirmed: item.checklistConfirmed,
      attachments: item.attachments.map((attachment) =>
        serializeTaskAttachmentProof(attachment.attachment),
      ),
      createdAt: item.createdAt,
    })),
    approvers: submission.approvers.map((approver) => ({
      membership: serializeCompletionMembership(approver.membership),
      membershipId: approver.membershipId,
      sources: approver.sources,
    })),
    decisions: submission.decisions.map((decision) => ({
      id: decision.id,
      approverMembershipId: decision.approverMembershipId,
      decision: decision.decision,
      reason: decision.reason,
      decidedAt: decision.decidedAt,
      approver: serializeCompletionMembership(decision.approver),
    })),
    approvalProgress: {
      approvedCount,
      rejectedCount,
      totalApproverCount: submission.approvers.length,
      mode: submission.approverModeSnapshot,
    },
    createdAt: submission.createdAt,
  };
}

function serializeCompletionMembership(
  membership: Prisma.WorkspaceMembershipGetPayload<{
    select: typeof completionMembershipSelect;
  }>,
) {
  return {
    membershipId: membership.id,
    userId: membership.user.id,
    name: membership.user.name,
    email: membership.user.email,
  };
}

function serializeTaskAttachmentProof(
  attachment: Prisma.AttachmentGetPayload<{
    select: typeof fileAttachmentSelect;
  }>,
) {
  return {
    id: attachment.id,
    workspaceId: attachment.workspaceId,
    type: attachment.type,
    displayName: attachment.displayName ?? attachment.asset?.displayName ?? attachment.url,
    url: attachment.type === AttachmentType.URL ? attachment.url : null,
    file: attachment.asset ? serializeAttachmentAsset(attachment.asset) : null,
    createdAt: attachment.createdAt,
    updatedAt: attachment.updatedAt,
  };
}

function serializeTaskRecurrenceSeries(series: TaskRecurrenceSeriesRecord) {
  return {
    ...series,
    startLocalDate: localDateString(series.startLocalDate, series.timezone),
    untilLocalDate: series.untilLocalDate
      ? localDateString(series.untilLocalDate, series.timezone)
      : null,
    assigneeMembershipIds: series.assignees.map((item) => item.membershipId),
    followerMembershipIds: series.followers.map((item) => item.membershipId),
    projectIds: series.projects.map((item) => item.projectId),
    tagIds: series.tags.map((item) => item.tagId),
    assignees: undefined,
    followers: undefined,
    projects: undefined,
    tags: undefined,
  };
}

function serializeTaskTemplate(template: TaskTemplateRecord) {
  return {
    ...template,
    assigneeMembershipIds: template.assignees.map((item) => item.membershipId),
    followerMembershipIds: template.followers.map((item) => item.membershipId),
    projectIds: template.projects.map((item) => item.projectId),
    tagIds: template.tags.map((item) => item.tagId),
    assignees: undefined,
    followers: undefined,
    projects: undefined,
    tags: undefined,
  };
}

function serializeTimeEntry(entry: TaskTimeEntryRecord) {
  return {
    id: entry.id,
    workspaceId: entry.workspaceId,
    taskId: entry.taskId,
    userId: entry.userId,
    workspaceMembershipId: entry.workspaceMembershipId,
    entryType: entry.entryType,
    startedAt: entry.startedAt,
    endedAt: entry.endedAt,
    durationSeconds: entry.durationSeconds,
    stopReason: entry.stopReason,
    deletedAt: entry.deletedAt,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    task: {
      id: entry.task.id,
      title: entry.task.title,
      status: entry.task.statusDefinition,
    },
    workspace: {
      id: entry.workspace.id,
      name: entry.workspace.name,
    },
    member: {
      membershipId: entry.workspaceMembership.id,
      userId: entry.workspaceMembership.user.id,
      name: entry.workspaceMembership.user.name,
      email: entry.workspaceMembership.user.email,
    },
  };
}

function safeActiveTimerSummary(entry: TaskTimeEntryRecord) {
  return {
    timeEntryId: entry.id,
    workspaceId: entry.workspaceId,
    workspaceName: entry.workspace.name,
    taskId: entry.taskId,
    taskTitle: entry.task.title,
    startedAt: entry.startedAt,
  };
}

function serializeTaskRelationship(task: TaskRelationshipRecord) {
  return {
    ...task,
    status: task.statusDefinition,
    assignees: task.assignees.map((item) => item.membership),
    statusDefinition: undefined,
  };
}

function paginatedRelationship(
  items: TaskRelationshipRecord[],
  query: TaskQueryDto,
  total: number,
) {
  return {
    items: items.map(serializeTaskRelationship),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

function serializeTaskComment(
  comment: TaskCommentRecord,
  summary: {
    directReplyCount: number;
    reactionCounts: Record<TaskCommentReactionType, number>;
    currentUserReactions: TaskCommentReactionType[];
  },
) {
  const deleted = Boolean(comment.deletedAt);
  return {
    id: comment.id,
    workspaceId: comment.workspaceId,
    taskId: comment.taskId,
    parentCommentId: comment.parentCommentId,
    body: deleted ? null : comment.body,
    visibility: comment.visibility,
    deleted,
    editedAt: deleted ? null : comment.editedAt,
    deletedAt: comment.deletedAt,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    author: {
      membershipId: comment.authorMembership.id,
      userId: comment.authorMembership.user.id,
      name: comment.authorMembership.user.name,
      email: comment.authorMembership.user.email,
    },
    mentions: deleted
      ? []
      : comment.mentions.map((mention) => ({
          membershipId: mention.membership.id,
          userId: mention.membership.user.id,
          name: mention.membership.user.name,
          email: mention.membership.user.email,
        })),
    directReplyCount: summary.directReplyCount,
    reactionCounts: summary.reactionCounts,
    currentUserReactions: summary.currentUserReactions,
  };
}

function serializeTaskTag(taskTag: TaskTagRecord) {
  return {
    id: taskTag.tag.id,
    workspaceId: taskTag.tag.workspaceId,
    name: taskTag.tag.name,
    color: taskTag.tag.color,
    status: taskTag.tag.status,
    attachedAt: taskTag.createdAt,
    createdAt: taskTag.tag.createdAt,
    updatedAt: taskTag.tag.updatedAt,
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

function serializeTaskAttachment(link: TaskAttachmentRecord) {
  const attachment = link.attachment;
  return {
    id: attachment.id,
    workspaceId: attachment.workspaceId,
    taskId: link.taskId,
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

function taskOrderBy(sortBy: TaskQueryDto['sortBy'], sortDirection: Prisma.SortOrder) {
  if (sortBy === 'kanbanRank') {
    return [
      { kanbanRank: { sort: sortDirection, nulls: 'last' } },
      { createdAt: 'asc' },
      { id: 'asc' },
    ] satisfies Prisma.TaskOrderByWithRelationInput[];
  }
  return { [sortBy]: sortDirection } as Prisma.TaskOrderByWithRelationInput;
}

async function lockTaskForKanban(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  taskId: string,
) {
  await tx.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "tasks"
    WHERE "id" = ${taskId}::uuid
      AND "workspace_id" = ${workspaceId}::uuid
      AND "deleted_at" IS NULL
    FOR UPDATE
  `);
}

function normalizeTitle(title: string) {
  const normalized = title.trim().replace(/\s+/g, ' ');
  if (!normalized) throw new BadRequestException('Task title is required.');
  return normalized;
}

function normalizeTemplateName(name: string) {
  const normalized = name.trim().replace(/\s+/g, ' ');
  if (!normalized) throw new BadRequestException('Template name is required.');
  return normalized;
}

function normalizeName(name: string) {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

type RecurrenceScheduleInputWithOptionalTimezone = Omit<RecurrenceScheduleInput, 'timezone'> & {
  timezone?: string;
};

type TaskViewFilterQueryDtoLike = {
  search?: string;
  priority?: TaskPriority;
  assigneeMembershipId?: string;
  departmentId?: string;
  projectId?: string;
  tagId?: string;
};

type ReportTaskAggregateRecord = {
  id: string;
  priority: TaskPriority;
  estimatedMinutes: number | null;
  dueAt: Date | null;
  pendingCompletionSubmissionId: string | null;
  statusDefinition: { id: string; name: string; color: string; isTerminal: boolean };
  department: { id: string; name: string } | null;
  assignees: {
    membershipId: string;
    membership: { user: { name: string | null; email: string } };
  }[];
  projects: { projectId: string; project: { name: string } }[];
};

function normalizeRecurrenceInput(
  input: RecurrenceScheduleInputWithOptionalTimezone,
  defaultTimezone = 'UTC',
): RecurrenceScheduleInput {
  const normalized = {
    ...input,
    timezone: (input.timezone?.trim() || defaultTimezone).trim(),
    interval: input.interval ?? 1,
    selectedWeekdays: input.selectedWeekdays ?? [],
    customIntervalUnit: input.customIntervalUnit ?? null,
    monthlyDay: input.monthlyDay ?? null,
    untilLocalDate: input.untilLocalDate ?? null,
    maxOccurrences: input.maxOccurrences ?? null,
  };
  const schedule = validateRecurrenceSchedule(normalized);
  return {
    ...normalized,
    selectedWeekdays: schedule.selectedWeekdays,
    monthlyDay: schedule.monthlyDay,
  };
}

function validateTaskSchedule(
  plannedStartAt: Date | null | undefined,
  dueAt: Date | null | undefined,
) {
  if (plannedStartAt && dueAt && plannedStartAt > dueAt) {
    throw new BadRequestException('INVALID_TASK_SCHEDULE');
  }
}

function calendarWindow(
  view: 'MONTH' | 'WEEK' | 'DAY',
  value: string | undefined,
  timezone: string,
) {
  const anchor = value
    ? DateTime.fromISO(value, { zone: timezone })
    : DateTime.now().setZone(timezone);
  if (!anchor.isValid) throw new BadRequestException('INVALID_CALENDAR_DATE');
  const start =
    view === 'MONTH'
      ? anchor.startOf('month')
      : view === 'WEEK'
        ? anchor.startOf('week')
        : anchor.startOf('day');
  const end =
    view === 'MONTH'
      ? start.plus({ months: 1 })
      : view === 'WEEK'
        ? start.plus({ weeks: 1 })
        : start.plus({ days: 1 });
  return {
    start: start.toJSDate(),
    end: end.toJSDate(),
    startLocalDate: start.toISODate(),
    endLocalDate: end.minus({ days: 1 }).toISODate(),
  };
}

function calendarDays(startDate: Date, endDate: Date, timezone: string) {
  const days: string[] = [];
  let cursor = DateTime.fromJSDate(startDate, { zone: timezone }).startOf('day');
  const end = DateTime.fromJSDate(endDate, { zone: timezone });
  while (cursor < end) {
    days.push(cursor.toISODate()!);
    cursor = cursor.plus({ days: 1 });
  }
  return days;
}

function priorityCountSeed() {
  return { LOW: 0, MEDIUM: 0, HIGH: 0, URGENT: 0 } satisfies Record<TaskPriority, number>;
}

function priorityDistribution(tasks: ReportTaskAggregateRecord[]) {
  const counts = priorityCountSeed();
  for (const task of tasks) counts[task.priority] += 1;
  return Object.entries(counts).map(([priority, count]) => ({ priority, count }));
}

function calendarUrgency(dueAt: Date, isTerminal: boolean, now: Date) {
  if (isTerminal) return 'SAFE';
  const diff = dueAt.getTime() - now.getTime();
  if (diff < 0) return 'OVERDUE';
  if (diff <= 24 * 60 * 60 * 1000) return 'WARNING';
  return 'SAFE';
}

function aggregateBy<T, M extends Record<string, unknown>>(
  items: T[],
  key: (item: T) => string,
  metadata: (item: T) => M,
) {
  const map = new Map<string, M & { count: number }>();
  for (const item of items) {
    const id = key(item);
    const existing = map.get(id);
    if (existing) existing.count += 1;
    else map.set(id, { ...metadata(item), count: 1 });
  }
  return [...map.values()];
}

function assigneeBreakdown(tasks: ReportTaskAggregateRecord[]) {
  const map = new Map<
    string,
    { membershipId: string; name: string | null; email: string; count: number }
  >();
  for (const task of tasks) {
    for (const assignee of task.assignees) {
      const existing = map.get(assignee.membershipId);
      if (existing) existing.count += 1;
      else
        map.set(assignee.membershipId, {
          membershipId: assignee.membershipId,
          name: assignee.membership.user.name,
          email: assignee.membership.user.email,
          count: 1,
        });
    }
  }
  return [...map.values()];
}

function projectBreakdown(tasks: ReportTaskAggregateRecord[]) {
  const map = new Map<string, { projectId: string; name: string; count: number }>();
  for (const task of tasks) {
    for (const project of task.projects) {
      const existing = map.get(project.projectId);
      if (existing) existing.count += 1;
      else
        map.set(project.projectId, {
          projectId: project.projectId,
          name: project.project.name,
          count: 1,
        });
    }
  }
  return [...map.values()];
}

function reportDateWindow(query: { from?: string; to?: string }, timezone: string) {
  const from = query.from ? parseReportBoundary(query.from, timezone, 'from') : null;
  const to = query.to ? parseReportBoundary(query.to, timezone, 'to') : null;
  if (from?.date && to?.date && to.date <= from.date)
    throw new BadRequestException('INVALID_TIME_RANGE');
  return { from: from?.date ?? null, to: to?.date ?? null, toExclusive: Boolean(to?.exclusive) };
}

function activityWhere(
  workspaceId: string,
  query: TaskActivityQueryDto,
  timezone: string,
): Prisma.AuditLogWhereInput {
  const range = reportDateWindow(query, timezone);
  return {
    workspaceId,
    entityType: 'Task',
    ...(query.taskId ? { entityId: query.taskId } : {}),
    ...(query.userId ? { userId: query.userId } : {}),
    ...(query.action ? { action: query.action } : {}),
    ...(range.from || range.to
      ? {
          createdAt: {
            ...(range.from ? { gte: range.from } : {}),
            ...(range.to ? (range.toExclusive ? { lt: range.to } : { lte: range.to }) : {}),
          },
        }
      : {}),
  };
}

function safeActivityItem(item: {
  id: string;
  createdAt: Date;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Prisma.JsonValue;
  user: { id: string; email: string; name: string | null } | null;
}) {
  return {
    id: item.id,
    timestamp: item.createdAt,
    action: item.action,
    entityType: item.entityType,
    entityId: item.entityId,
    actor: item.user,
    summary: `${item.entityType} ${item.action}`,
  };
}

function toCsv(rows: string[][]) {
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\n')}`;
}

function exportTooLarge() {
  return new PayloadTooLargeException({
    code: 'TASK_EXPORT_TOO_LARGE',
    message: 'TASK_EXPORT_TOO_LARGE',
    details: { maxRows: TASK_CSV_EXPORT_MAX_ROWS },
  });
}

function csvCell(value: string) {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

function seriesToScheduleInput(series: TaskRecurrenceSeriesRecord): RecurrenceScheduleInput {
  return {
    timezone: series.timezone,
    frequency: series.frequency,
    interval: series.interval,
    customIntervalUnit: series.customIntervalUnit,
    startLocalDate: localDateString(series.startLocalDate, series.timezone),
    localTime: series.localTime,
    selectedWeekdays: series.selectedWeekdays,
    monthlyDay: series.monthlyDay,
    endMode: series.endMode,
    untilLocalDate: series.untilLocalDate
      ? localDateString(series.untilLocalDate, series.timezone)
      : null,
    maxOccurrences: series.maxOccurrences,
  };
}

function normalizeDescription(description: string | null | undefined) {
  if (description === undefined) return undefined;
  if (description === null) return null;
  const normalized = description.trim();
  return normalized ? normalized : null;
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

function normalizeProofUrl(value: string) {
  const normalized = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new UnprocessableEntityException('Completion proof URL is invalid.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new UnprocessableEntityException('Completion proof URL must use http or https.');
  }
  if (normalized.length > 2048) {
    throw new UnprocessableEntityException('Completion proof URL is too long.');
  }
  return parsed.toString();
}

function normalizeReason(value: string | null | undefined) {
  const normalized = value?.trim() ?? '';
  if (!normalized) throw new BadRequestException('A rejection reason is required.');
  if (normalized.length > COMPLETION_REASON_MAX_LENGTH) {
    throw new BadRequestException('Rejection reason is too long.');
  }
  return normalized;
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
  const suffix = extension ? `asset.${extension}` : 'asset.bin';
  return `workspace/${workspaceId}/assets/${assetId}/${suffix}`;
}

function hasControlCharacters(value: string) {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint < 32 || codePoint === 127);
  });
}

function isRecord(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function withoutUndefined(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, Prisma.InputJsonValue] => entry[1] !== undefined,
    ),
  );
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

function parseRequiredDate(value: string, errorCode: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new BadRequestException(errorCode);
  return date;
}

function parseReportBoundary(value: string, timezone: string, boundary: 'from' | 'to') {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const local = DateTime.fromISO(value, { zone: timezone });
    if (!local.isValid) throw new BadRequestException('INVALID_TIME_RANGE');
    const edge =
      boundary === 'from' ? local.startOf('day') : local.plus({ days: 1 }).startOf('day');
    return { date: edge.toJSDate(), exclusive: boundary === 'to' };
  }
  return { date: parseRequiredDate(value, 'INVALID_TIME_RANGE'), exclusive: false };
}

function normalizeCompletedTimeRange(dto: {
  startedAt: string;
  endedAt?: string;
  durationSeconds?: number;
}) {
  const startedAt = parseRequiredDate(dto.startedAt, 'INVALID_TIME_RANGE');
  const endedAt =
    dto.endedAt !== undefined
      ? parseRequiredDate(dto.endedAt, 'INVALID_TIME_RANGE')
      : new Date(startedAt.getTime() + (dto.durationSeconds ?? 0) * 1000);
  if (endedAt < startedAt) throw new BadRequestException('INVALID_TIME_RANGE');
  if (endedAt.getTime() - Date.now() > 60_000) throw new BadRequestException('FUTURE_TIME_ENTRY');
  const durationSeconds = Math.max(0, Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000));
  return { startedAt, endedAt, durationSeconds };
}

function workloadWindow(query: TaskWorkloadQueryDto, timezone: string) {
  const anchor = query.date
    ? DateTime.fromISO(query.date, { zone: timezone })
    : DateTime.now().setZone(timezone);
  if (!anchor.isValid) throw new BadRequestException('INVALID_TIME_RANGE');
  if (query.view === 'DAY') {
    const start = anchor.startOf('day');
    const end = start.plus({ days: 1 });
    return { start: start.toJSDate(), end: end.toJSDate(), timezone };
  }
  const start = anchor.startOf('week');
  const end = start.plus({ weeks: 1 });
  return { start: start.toJSDate(), end: end.toJSDate(), timezone };
}

function distributePlannedMinutes(
  task: {
    assignees: { membershipId: string }[];
    workloadAllocations: { workspaceMembershipId: string; plannedMinutes: number }[];
  },
  estimate: number,
) {
  const byMember = new Map<string, number>();
  const assigneeIds = task.assignees.map((item) => item.membershipId).sort();
  const explicitIds = new Set<string>();
  let explicitTotal = 0;
  for (const allocation of task.workloadAllocations) {
    if (!assigneeIds.includes(allocation.workspaceMembershipId)) continue;
    explicitIds.add(allocation.workspaceMembershipId);
    explicitTotal += allocation.plannedMinutes;
    byMember.set(allocation.workspaceMembershipId, allocation.plannedMinutes);
  }
  const remaining = Math.max(0, estimate - explicitTotal);
  const autoIds = assigneeIds.filter((membershipId) => !explicitIds.has(membershipId));
  let unallocatedMinutes = 0;
  if (autoIds.length === 0) {
    unallocatedMinutes = remaining;
  } else {
    const base = Math.floor(remaining / autoIds.length);
    let remainder = remaining % autoIds.length;
    for (const membershipId of autoIds) {
      const minutes = base + (remainder > 0 ? 1 : 0);
      remainder -= remainder > 0 ? 1 : 0;
      byMember.set(membershipId, minutes);
    }
  }
  if (assigneeIds.length === 0 && task.workloadAllocations.length === 0) {
    unallocatedMinutes = estimate;
  }
  return { byMember, unallocatedMinutes };
}

function dailyCapacityMinutes(weeklyCapacity: number, date: Date, timezone: string) {
  const weekday = DateTime.fromJSDate(date, { zone: timezone }).weekday;
  if (weekday === 6 || weekday === 7) return 0;
  return Math.floor(weeklyCapacity / 5);
}

function utilizationPercent(plannedMinutes: number, capacityMinutes: number) {
  if (capacityMinutes === 0) return plannedMinutes > 0 ? null : 0;
  return Math.round((plannedMinutes / capacityMinutes) * 10000) / 100;
}

function workloadState(plannedMinutes: number, capacityMinutes: number) {
  if (capacityMinutes === 0) return plannedMinutes > 0 ? 'OVER_CAPACITY' : 'AVAILABLE';
  const basisPoints = Math.floor((plannedMinutes * 10000) / capacityMinutes);
  if (basisPoints < 5000) return 'AVAILABLE';
  if (basisPoints < 8000) return 'BALANCED';
  if (basisPoints <= 10000) return 'NEAR_CAPACITY';
  return 'OVER_CAPACITY';
}

async function lockUser(tx: Prisma.TransactionClient, userId: string) {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`);
}

function dateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function relationCounts(assigneeIds: string[], followerIds: string[], projectIds: string[]) {
  return {
    assigneeCount: assigneeIds.length,
    followerCount: followerIds.length,
    projectCount: projectIds.length,
  };
}

function relationKey(taskId: string, membershipId: string) {
  return `${taskId}:${membershipId}`;
}

function uniqueIds(ids: string[]) {
  return [...new Set(ids)];
}

function tagMutationResult(requestedCount: number, changedCount: number) {
  return {
    requestedCount,
    changedCount,
    unchangedCount: requestedCount - changedCount,
  };
}

function emptyReactionCounts(): Record<TaskCommentReactionType, number> {
  return {
    LIKE: 0,
    LOVE: 0,
    CELEBRATE: 0,
    EYES: 0,
    CHECK: 0,
  };
}

function normalizeCommentBody(body: string) {
  const normalized = body.trim();
  if (!normalized) throw new BadRequestException('Comment body is required.');
  return normalized;
}

function canonicalRelatedPair(taskId: string, relatedTaskId: string) {
  return taskId < relatedTaskId
    ? { taskAId: taskId, taskBId: relatedTaskId }
    : { taskAId: relatedTaskId, taskBId: taskId };
}

const serializableTransaction = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
};

function mapHierarchyWriteError(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2034' || error.meta?.code === '40001')
  ) {
    throw new ConflictException('Task relationship changed concurrently. Retry the request.');
  }
  throw error;
}

function mapTaskTagWriteError(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2002' || error.code === 'P2034' || error.meta?.code === '40001')
  ) {
    throw new ConflictException('Task tags changed concurrently. Retry the request.');
  }
  throw error;
}

function mapTemplateWriteError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new ConflictException('A task template with this name already exists.');
  }
  throw error;
}

function mapTimeWriteError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new ConflictException('ACTIVE_TIMER_EXISTS');
  }
  throw error;
}

function uuidValues(ids: string[]) {
  return Prisma.join(ids.map((id) => Prisma.sql`(${id}::uuid)`));
}

async function descendantTaskIds(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  rootIds: string[],
  includeSelf = false,
) {
  if (rootIds.length === 0) return [];
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    WITH RECURSIVE roots(id) AS (
      VALUES ${uuidValues(rootIds)}
    ),
    descendants(id, path) AS (
      ${
        includeSelf
          ? Prisma.sql`
            SELECT t.id, ARRAY[t.id]
            FROM tasks t
            JOIN roots r ON r.id = t.id
            WHERE t.workspace_id = ${workspaceId}::uuid
              AND t.deleted_at IS NULL
          `
          : Prisma.sql`
            SELECT child.id, ARRAY[child.id]
            FROM tasks child
            JOIN roots r ON child.parent_task_id = r.id
            WHERE child.workspace_id = ${workspaceId}::uuid
              AND child.deleted_at IS NULL
          `
      }
      UNION ALL
      SELECT child.id, descendants.path || child.id
      FROM tasks child
      JOIN descendants ON child.parent_task_id = descendants.id
      WHERE child.workspace_id = ${workspaceId}::uuid
        AND child.deleted_at IS NULL
        AND NOT child.id = ANY(descendants.path)
    )
    SELECT id FROM descendants
  `);
  return rows.map((row) => row.id);
}

async function nonTerminalDescendantsOutsideSelection(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  selectedIds: string[],
) {
  if (selectedIds.length === 0) return [];
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    WITH RECURSIVE selected(id) AS (
      VALUES ${uuidValues(selectedIds)}
    ),
    descendants(id, path) AS (
      SELECT child.id, ARRAY[child.id]
      FROM tasks child
      JOIN selected ON child.parent_task_id = selected.id
      WHERE child.workspace_id = ${workspaceId}::uuid
        AND child.deleted_at IS NULL
      UNION ALL
      SELECT child.id, descendants.path || child.id
      FROM tasks child
      JOIN descendants ON child.parent_task_id = descendants.id
      WHERE child.workspace_id = ${workspaceId}::uuid
        AND child.deleted_at IS NULL
        AND NOT child.id = ANY(descendants.path)
    )
    SELECT d.id
    FROM descendants d
    JOIN tasks t ON t.id = d.id AND t.workspace_id = ${workspaceId}::uuid
    JOIN status_definitions s
      ON s.id = t.status_definition_id
      AND s.workspace_id = t.workspace_id
      AND s.entity_type = 'TASK'::"StatusEntityType"
    WHERE s.is_terminal = false
      AND NOT EXISTS (SELECT 1 FROM selected WHERE selected.id = d.id)
    LIMIT 1
  `);
  return rows.map((row) => row.id);
}

async function terminalAncestorsOutsideSelection(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  selectedIds: string[],
) {
  if (selectedIds.length === 0) return [];
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    WITH RECURSIVE selected(id) AS (
      VALUES ${uuidValues(selectedIds)}
    ),
    ancestors(id, parent_task_id, path) AS (
      SELECT parent.id, parent.parent_task_id, ARRAY[parent.id]
      FROM tasks child
      JOIN selected ON selected.id = child.id
      JOIN tasks parent
        ON parent.id = child.parent_task_id
        AND parent.workspace_id = child.workspace_id
        AND parent.deleted_at IS NULL
      WHERE child.workspace_id = ${workspaceId}::uuid
        AND child.deleted_at IS NULL
      UNION ALL
      SELECT parent.id, parent.parent_task_id, ancestors.path || parent.id
      FROM tasks parent
      JOIN ancestors
        ON parent.id = ancestors.parent_task_id
        AND parent.workspace_id = ${workspaceId}::uuid
        AND parent.deleted_at IS NULL
      WHERE NOT parent.id = ANY(ancestors.path)
    )
    SELECT a.id
    FROM ancestors a
    JOIN tasks t ON t.id = a.id AND t.workspace_id = ${workspaceId}::uuid
    JOIN status_definitions s
      ON s.id = t.status_definition_id
      AND s.workspace_id = t.workspace_id
      AND s.entity_type = 'TASK'::"StatusEntityType"
    WHERE s.is_terminal = true
      AND NOT EXISTS (SELECT 1 FROM selected WHERE selected.id = a.id)
    LIMIT 1
  `);
  return rows.map((row) => row.id);
}

async function subtreeHasNonTerminalTask(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  taskId: string,
) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    WITH RECURSIVE subtree(id, path) AS (
      SELECT t.id, ARRAY[t.id]
      FROM tasks t
      WHERE t.id = ${taskId}::uuid
        AND t.workspace_id = ${workspaceId}::uuid
        AND t.deleted_at IS NULL
      UNION ALL
      SELECT child.id, subtree.path || child.id
      FROM tasks child
      JOIN subtree ON child.parent_task_id = subtree.id
      WHERE child.workspace_id = ${workspaceId}::uuid
        AND child.deleted_at IS NULL
        AND NOT child.id = ANY(subtree.path)
    )
    SELECT subtree.id
    FROM subtree
    JOIN tasks t ON t.id = subtree.id AND t.workspace_id = ${workspaceId}::uuid
    JOIN status_definitions s
      ON s.id = t.status_definition_id
      AND s.workspace_id = t.workspace_id
      AND s.entity_type = 'TASK'::"StatusEntityType"
    WHERE s.is_terminal = false
    LIMIT 1
  `);
  return rows.length > 0;
}

async function nonTerminalBlockersOutsideSelection(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  selectedIds: string[],
) {
  if (selectedIds.length === 0) return [];
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    WITH selected(id) AS (
      VALUES ${uuidValues(selectedIds)}
    )
    SELECT blocker.id
    FROM task_dependencies dependency
    JOIN selected ON selected.id = dependency.blocked_task_id
    JOIN tasks blocked
      ON blocked.id = dependency.blocked_task_id
      AND blocked.workspace_id = ${workspaceId}::uuid
      AND blocked.deleted_at IS NULL
    JOIN tasks blocker
      ON blocker.id = dependency.blocker_task_id
      AND blocker.workspace_id = ${workspaceId}::uuid
      AND blocker.deleted_at IS NULL
    JOIN status_definitions status
      ON status.id = blocker.status_definition_id
      AND status.workspace_id = blocker.workspace_id
      AND status.entity_type = 'TASK'::"StatusEntityType"
    WHERE dependency.workspace_id = ${workspaceId}::uuid
      AND status.is_terminal = false
      AND NOT EXISTS (SELECT 1 FROM selected WHERE selected.id = blocker.id)
    LIMIT 1
  `);
  return rows.map((row) => row.id);
}

async function assertDependencyGraphAcyclic(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  newEdges: { blockerTaskId: string; blockedTaskId: string }[],
) {
  if (newEdges.length === 0) return;
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    WITH RECURSIVE new_edges(blocker_task_id, blocked_task_id) AS (
      VALUES ${Prisma.join(
        newEdges.map(
          (edge) => Prisma.sql`(${edge.blockerTaskId}::uuid, ${edge.blockedTaskId}::uuid)`,
        ),
      )}
    ),
    active_edges(blocker_task_id, blocked_task_id) AS (
      SELECT dependency.blocker_task_id, dependency.blocked_task_id
      FROM task_dependencies dependency
      JOIN tasks blocker
        ON blocker.id = dependency.blocker_task_id
        AND blocker.workspace_id = ${workspaceId}::uuid
        AND blocker.deleted_at IS NULL
      JOIN tasks blocked
        ON blocked.id = dependency.blocked_task_id
        AND blocked.workspace_id = ${workspaceId}::uuid
        AND blocked.deleted_at IS NULL
      WHERE dependency.workspace_id = ${workspaceId}::uuid
      UNION
      SELECT blocker_task_id, blocked_task_id FROM new_edges
    ),
    paths(start_id, current_id, path, cycle) AS (
      SELECT blocker_task_id, blocked_task_id, ARRAY[blocker_task_id, blocked_task_id], blocker_task_id = blocked_task_id
      FROM active_edges
      UNION ALL
      SELECT paths.start_id, edge.blocked_task_id, paths.path || edge.blocked_task_id, edge.blocked_task_id = ANY(paths.path)
      FROM paths
      JOIN active_edges edge ON edge.blocker_task_id = paths.current_id
      WHERE paths.cycle = false
    )
    SELECT current_id AS id
    FROM paths
    WHERE cycle = true
    LIMIT 1
  `);
  if (rows.length > 0) {
    throw new ConflictException('Task dependency cycles are not allowed.');
  }
}

async function insertTaskAssigneeRows(
  tx: Prisma.TransactionClient,
  rows: { taskId: string; workspaceId: string; membershipId: string }[],
) {
  if (rows.length === 0) return [];
  return tx.$queryRaw<Array<{ taskId: string; membershipId: string }>>(Prisma.sql`
    INSERT INTO task_assignees (task_id, workspace_id, membership_id)
    VALUES ${Prisma.join(
      rows.map(
        (row) =>
          Prisma.sql`(${row.taskId}::uuid, ${row.workspaceId}::uuid, ${row.membershipId}::uuid)`,
      ),
    )}
    ON CONFLICT (task_id, membership_id) DO NOTHING
    RETURNING task_id AS "taskId", membership_id AS "membershipId"
  `);
}

function bulkResult(requestedCount: number, changedCount: number) {
  return {
    requestedCount,
    changedCount,
    unchangedCount: requestedCount - changedCount,
  };
}

function requireUploadMembership(tenant: WorkspaceTenantContext) {
  if (!tenant.workspaceMembershipId) {
    throw new BadRequestException('WORKSPACE_MEMBERSHIP_REQUIRED');
  }
  return tenant.workspaceMembershipId;
}

function isAssetLifecycleDownloadable(lifecycle: AssetLifecycle) {
  return lifecycle === AssetLifecycle.ACTIVE || lifecycle === AssetLifecycle.ARCHIVED;
}

async function assertStorageQuotaAvailable(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  requestedBytes: bigint,
) {
  await tx.$queryRaw<Array<{ lock: string }>>`
    SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))::text AS lock
  `;
  const workspace = await tx.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { storageLimitBytes: true },
  });
  const [used, reserved] = await Promise.all([
    tx.asset.aggregate({
      where: {
        workspaceId,
        deletedAt: null,
        status: { in: [AssetStatus.UPLOADED, AssetStatus.PROCESSING, AssetStatus.READY] },
      },
      _sum: { sizeBytes: true },
    }),
    tx.storageUploadReservation.aggregate({
      where: {
        workspaceId,
        consumedAt: null,
        releasedAt: null,
        expiresAt: { gt: new Date() },
      },
      _sum: { reservedBytes: true },
    }),
  ]);
  if (
    (used._sum.sizeBytes ?? 0n) + (reserved._sum.reservedBytes ?? 0n) + requestedBytes >
    workspace.storageLimitBytes
  ) {
    throw new PayloadTooLargeException('STORAGE_QUOTA_EXCEEDED');
  }
}

async function consumeUploadReservation(tx: Prisma.TransactionClient, fileId: string) {
  const reservation = await tx.storageUploadReservation.findUnique({
    where: { fileId },
    select: { id: true, expiresAt: true, consumedAt: true, releasedAt: true },
  });
  if (!reservation || reservation.releasedAt || reservation.expiresAt <= new Date()) {
    throw new GoneException('UPLOAD_RESERVATION_EXPIRED');
  }
  if (!reservation.consumedAt) {
    await tx.storageUploadReservation.update({
      where: { id: reservation.id },
      data: { consumedAt: new Date() },
    });
  }
}

async function releaseUploadReservation(prisma: PrismaService, fileId: string) {
  await prisma.storageUploadReservation.updateMany({
    where: { fileId, consumedAt: null, releasedAt: null },
    data: { releasedAt: new Date() },
  });
}

function uuidParams(ids: string[]) {
  return ids.map((id) => Prisma.sql`${id}::uuid`);
}

function bulkRelationResult(
  requestedCount: number,
  changedCount: number,
  relationChangedCount: number,
  relationUnchangedCount: number,
) {
  return {
    ...bulkResult(requestedCount, changedCount),
    relationChangedCount,
    relationUnchangedCount,
  };
}

function automationCorrelationId(
  automation: AutomationMutationContext | undefined,
  fallback: string,
) {
  return automation?.correlationId ?? fallback;
}

function automationCausationId(automation: AutomationMutationContext | undefined) {
  return automation?.causationId ?? automation?.triggerDomainEventId ?? null;
}

function automationDepth(automation: AutomationMutationContext | undefined) {
  return automation ? (automation.parentAutomationDepth ?? 0) + 1 : 0;
}
