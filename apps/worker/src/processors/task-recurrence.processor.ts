import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  ProjectStatus,
  StatusEntityType,
  TaskCompletionProofRequirementMode,
  TaskRecurrenceCustomUnit,
  TaskRecurrenceEndMode,
  TaskRecurrenceFrequency,
  TaskRecurrenceStatus,
  WorkspaceTagStatus,
} from '@prisma/client';
import type { Job } from 'bullmq';
import { DateTime } from 'luxon';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { TASK_RECURRENCE_DISPATCH_JOB_TYPE, TASK_RECURRENCE_QUEUE } from '../queue/queue.constants';

const SCAN_LIMIT = 25;
const CATCH_UP_LIMIT = 100;
const KANBAN_RANK_STEP = new Prisma.Decimal(1024);

@Injectable()
@Processor(TASK_RECURRENCE_QUEUE)
export class TaskRecurrenceProcessor extends WorkerHost {
  private readonly logger = new Logger(TaskRecurrenceProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<{ type: string; version: 1 }>) {
    if (job.name !== TASK_RECURRENCE_DISPATCH_JOB_TYPE) return;
    const now = new Date();
    const seriesIds = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM task_recurrence_series
      WHERE status = ${TaskRecurrenceStatus.ACTIVE}::"TaskRecurrenceStatus"
        AND next_occurrence_at IS NOT NULL
        AND next_occurrence_at <= ${now}
      ORDER BY next_occurrence_at ASC, id ASC
      LIMIT ${SCAN_LIMIT}
    `);
    let generated = 0;
    for (const row of seriesIds) {
      generated += await this.processSeries(row.id, now);
    }
    if (generated > 0) {
      this.logger.log({ generated, message: 'Task recurrence scanner generated occurrences' });
    }
  }

  async processSeries(seriesId: string, now = new Date()) {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id
        FROM task_recurrence_series
        WHERE id = ${seriesId}::uuid
        FOR UPDATE SKIP LOCKED
      `);
      if (claimed.length === 0) return 0;
      const series = await tx.taskRecurrenceSeries.findFirst({
        where: {
          id: seriesId,
          status: TaskRecurrenceStatus.ACTIVE,
          nextOccurrenceAt: { lte: now },
        },
        select: recurrenceWorkerSeriesSelect,
      });
      if (!series || !series.nextOccurrenceAt) return 0;
      if (!(await referencesAreValid(tx, series))) {
        await tx.taskRecurrenceSeries.update({
          where: { id: series.id },
          data: { status: TaskRecurrenceStatus.ERROR, lastErrorCode: 'STALE_REFERENCE' },
        });
        return 0;
      }
      let cursor = series.nextOccurrenceAt;
      let generated = 0;
      let generatedCount = series.generatedCount;
      let nextOccurrenceAt: Date | null = cursor;
      while (nextOccurrenceAt && nextOccurrenceAt <= now && generated < CATCH_UP_LIMIT) {
        generatedCount += 1;
        const kanbanRank = await nextKanbanRank(tx, series.workspaceId, series.statusDefinitionId);
        const task = await tx.task.create({
          data: {
            workspaceId: series.workspaceId,
            title: series.title,
            description: series.description,
            priority: series.priority,
            statusDefinitionId: series.statusDefinitionId,
            departmentId: series.departmentId,
            estimatedMinutes: series.estimatedMinutes,
            dueAt: nextOccurrenceAt,
            kanbanRank,
            recurrenceSeriesId: series.id,
            recurrenceScheduledFor: nextOccurrenceAt,
            recurrenceSequence: generatedCount,
            createdById: series.createdById,
          },
          select: { id: true },
        });
        if (series.assignees.length) {
          await tx.taskAssignee.createMany({
            data: series.assignees.map((item) => ({
              taskId: task.id,
              workspaceId: series.workspaceId,
              membershipId: item.membershipId,
            })),
          });
        }
        if (series.followers.length) {
          await tx.taskFollower.createMany({
            data: series.followers.map((item) => ({
              taskId: task.id,
              workspaceId: series.workspaceId,
              membershipId: item.membershipId,
            })),
          });
        }
        if (series.projects.length) {
          await tx.taskProject.createMany({
            data: series.projects.map((item) => ({
              taskId: task.id,
              workspaceId: series.workspaceId,
              projectId: item.projectId,
            })),
          });
        }
        if (series.tags.length) {
          await tx.taskTag.createMany({
            data: series.tags.map((item) => ({
              taskId: task.id,
              workspaceId: series.workspaceId,
              tagId: item.tagId,
              createdById: series.createdById,
            })),
            skipDuplicates: true,
          });
        }
        if (shouldCreateCompletionPolicy(series)) {
          const policy = await tx.taskCompletionPolicy.create({
            data: {
              workspaceId: series.workspaceId,
              taskId: task.id,
              proofRequirementMode: series.completionProofRequirementMode,
              requiredProofTypes: series.completionRequiredProofTypes,
              approvalRequired: series.completionApprovalRequired,
              approverMode: series.completionApproverMode,
              includeTaskCreator: series.completionIncludeTaskCreator,
              includePermissionApprovers: series.completionIncludePermissionApprovers,
              includeProjectOwnersManagers: series.completionIncludeProjectOwnersManagers,
              createdById: series.createdById,
              updatedById: series.createdById,
            },
            select: { id: true },
          });
          if (series.completionApprovers.length) {
            await tx.taskCompletionPolicyApprover.createMany({
              data: series.completionApprovers.map((approver) => ({
                workspaceId: series.workspaceId,
                policyId: policy.id,
                membershipId: approver.membershipId,
              })),
              skipDuplicates: true,
            });
          }
        }
        generated += 1;
        cursor = nextOccurrenceAt;
        nextOccurrenceAt = nextOccurrence(series, cursor, generatedCount);
      }
      const ended =
        !nextOccurrenceAt ||
        (series.endMode === TaskRecurrenceEndMode.AFTER_COUNT &&
          series.maxOccurrences !== null &&
          generatedCount >= series.maxOccurrences);
      await tx.taskRecurrenceSeries.update({
        where: { id: series.id },
        data: {
          generatedCount,
          lastGeneratedAt: generated > 0 ? now : series.lastGeneratedAt,
          nextOccurrenceAt: ended ? null : nextOccurrenceAt,
          status: ended ? TaskRecurrenceStatus.ENDED : TaskRecurrenceStatus.ACTIVE,
          endedAt: ended ? now : null,
          lastErrorCode: null,
        },
      });
      return generated;
    });
  }
}

const recurrenceWorkerSeriesSelect = {
  id: true,
  workspaceId: true,
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
  completionProofRequirementMode: true,
  completionRequiredProofTypes: true,
  completionApprovalRequired: true,
  completionApproverMode: true,
  completionIncludeTaskCreator: true,
  completionIncludePermissionApprovers: true,
  completionIncludeProjectOwnersManagers: true,
  generatedCount: true,
  nextOccurrenceAt: true,
  lastGeneratedAt: true,
  createdById: true,
  statusDefinition: { select: { isActive: true, isTerminal: true, entityType: true } },
  department: { select: { status: true } },
  assignees: { select: { membershipId: true, membership: { select: { status: true } } } },
  followers: { select: { membershipId: true, membership: { select: { status: true } } } },
  projects: { select: { projectId: true, project: { select: { status: true } } } },
  tags: { select: { tagId: true, tag: { select: { status: true } } } },
  completionApprovers: { select: { membershipId: true, membership: { select: { status: true } } } },
} satisfies Prisma.TaskRecurrenceSeriesSelect;

type WorkerSeries = Prisma.TaskRecurrenceSeriesGetPayload<{
  select: typeof recurrenceWorkerSeriesSelect;
}>;

async function referencesAreValid(tx: Prisma.TransactionClient, series: WorkerSeries) {
  if (
    !series.statusDefinition.isActive ||
    series.statusDefinition.isTerminal ||
    series.statusDefinition.entityType !== StatusEntityType.TASK
  ) {
    return false;
  }
  if (series.department?.status !== undefined && series.department.status !== 'ACTIVE')
    return false;
  if (series.assignees.some((item) => item.membership.status !== 'ACTIVE')) return false;
  if (series.followers.some((item) => item.membership.status !== 'ACTIVE')) return false;
  if (series.completionApprovers.some((item) => item.membership.status !== 'ACTIVE')) return false;
  if (series.projects.some((item) => item.project.status === ProjectStatus.ARCHIVED)) return false;
  if (series.tags.some((item) => item.tag.status !== WorkspaceTagStatus.ACTIVE)) return false;
  await tx.statusDefinition.findFirstOrThrow({
    where: { id: series.statusDefinitionId, workspaceId: series.workspaceId },
    select: { id: true },
  });
  return true;
}

function shouldCreateCompletionPolicy(series: WorkerSeries) {
  return (
    series.completionProofRequirementMode !== TaskCompletionProofRequirementMode.NONE ||
    series.completionApprovalRequired ||
    series.completionRequiredProofTypes.length > 0 ||
    series.completionApprovers.length > 0 ||
    series.completionIncludeTaskCreator ||
    series.completionIncludePermissionApprovers ||
    series.completionIncludeProjectOwnersManagers
  );
}

async function nextKanbanRank(
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

function nextOccurrence(series: WorkerSeries, previous: Date, generatedCount: number) {
  if (
    series.endMode === TaskRecurrenceEndMode.AFTER_COUNT &&
    series.maxOccurrences !== null &&
    generatedCount >= series.maxOccurrences
  ) {
    return null;
  }
  const cursor = DateTime.fromJSDate(previous, { zone: series.timezone });
  let candidate: DateTime;
  if (series.frequency === TaskRecurrenceFrequency.DAILY) {
    candidate = atLocal(series, cursor.plus({ days: series.interval }));
  } else if (series.frequency === TaskRecurrenceFrequency.WEEKDAYS) {
    let next = cursor.plus({ days: 1 });
    while (next.weekday > 5) next = next.plus({ days: 1 });
    candidate = atLocal(series, next);
  } else if (series.frequency === TaskRecurrenceFrequency.WEEKLY) {
    candidate = nextWeekly(series, cursor);
  } else if (series.frequency === TaskRecurrenceFrequency.MONTHLY) {
    candidate = monthly(series, cursor.plus({ months: series.interval }));
  } else if (series.customIntervalUnit === TaskRecurrenceCustomUnit.DAY) {
    candidate = atLocal(series, cursor.plus({ days: series.interval }));
  } else if (series.customIntervalUnit === TaskRecurrenceCustomUnit.WEEK) {
    candidate = atLocal(series, cursor.plus({ weeks: series.interval }));
  } else {
    candidate = monthly(series, cursor.plus({ months: series.interval }));
  }
  if (series.endMode === TaskRecurrenceEndMode.ON_DATE && series.untilLocalDate) {
    const until = DateTime.fromJSDate(series.untilLocalDate, { zone: series.timezone }).endOf(
      'day',
    );
    if (candidate > until) return null;
  }
  return candidate.toJSDate();
}

function nextWeekly(series: WorkerSeries, cursor: DateTime) {
  let candidate = cursor.plus({ days: 1 });
  const startWeek = DateTime.fromJSDate(series.startLocalDate, { zone: series.timezone }).startOf(
    'week',
  );
  for (let index = 0; index < 370; index += 1) {
    const weeks = Math.floor(candidate.startOf('week').diff(startWeek, 'weeks').weeks);
    if (
      weeks >= 0 &&
      weeks % series.interval === 0 &&
      series.selectedWeekdays.includes(candidate.weekday)
    ) {
      return atLocal(series, candidate);
    }
    candidate = candidate.plus({ days: 1 });
  }
  throw new Error('Unable to calculate weekly recurrence.');
}

function monthly(series: WorkerSeries, candidate: DateTime) {
  const day =
    series.monthlyDay ?? DateTime.fromJSDate(series.startLocalDate, { zone: series.timezone }).day;
  const end = DateTime.local(candidate.year, candidate.month).endOf('month').day;
  return atLocal(series, candidate.set({ day: Math.min(day, end) }));
}

function atLocal(series: WorkerSeries, date: DateTime) {
  return DateTime.fromISO(`${date.toISODate()}T${series.localTime}`, { zone: series.timezone });
}
