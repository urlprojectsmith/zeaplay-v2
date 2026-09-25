import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import {
  AgencyStatus,
  NotificationCategory,
  NotificationEntityType,
  NotificationPriority,
  NotificationReminderStatus,
  NotificationReminderType,
  NotificationType,
  Prisma,
  ProjectStatus,
  SuperAgencyStatus,
  WorkspaceStatus,
} from '@prisma/client';
import type { Job } from 'bullmq';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  NOTIFICATION_REMINDER_QUEUE,
  NOTIFICATION_REMINDER_SCAN_JOB_TYPE,
} from '../../infrastructure/queue/queue.constants';
import { NotificationEmailDeliveryService } from './notification-email-delivery.service';
import { NotificationRouterService } from './notification-router.service';

const TASK_DUE_SOON_MS = 24 * 60 * 60 * 1000;
const PROJECT_DUE_SOON_MS = 24 * 60 * 60 * 1000;
const TICKET_SLA_WARNING_MS = 60 * 60 * 1000;
const SCAN_LIMIT = 100;

@Injectable()
export class NotificationReminderService {
  constructor(private readonly prisma: PrismaService) {}

  async scheduleTaskReminders(input: {
    workspaceId: string;
    taskId: string;
    taskTitle: string;
    dueAt: Date | null;
    assigneeMembershipIds: string[];
    terminal: boolean;
    tx?: Prisma.TransactionClient;
  }) {
    const db = input.tx ?? this.prisma;
    await db.notificationReminder.updateMany({
      where: {
        workspaceId: input.workspaceId,
        entityType: NotificationEntityType.TASK,
        entityId: input.taskId,
        status: NotificationReminderStatus.PENDING,
      },
      data: { status: NotificationReminderStatus.CANCELLED, cancelledAt: new Date() },
    });
    if (!input.dueAt || input.terminal || input.assigneeMembershipIds.length === 0) return;
    for (const membershipId of input.assigneeMembershipIds) {
      await upsertReminder(db, {
        workspaceId: input.workspaceId,
        recipientMembershipId: membershipId,
        reminderType: NotificationReminderType.TASK_DUE_SOON,
        category: NotificationCategory.TASK,
        type: NotificationType.TASK_DUE_SOON,
        entityType: NotificationEntityType.TASK,
        entityId: input.taskId,
        scheduledFor: scheduledBefore(input.dueAt, TASK_DUE_SOON_MS),
        dedupeKey: `task:${input.taskId}:due-soon:${membershipId}`,
      });
      await upsertReminder(db, {
        workspaceId: input.workspaceId,
        recipientMembershipId: membershipId,
        reminderType: NotificationReminderType.TASK_OVERDUE,
        category: NotificationCategory.TASK,
        type: NotificationType.TASK_OVERDUE,
        entityType: NotificationEntityType.TASK,
        entityId: input.taskId,
        scheduledFor: input.dueAt,
        dedupeKey: `task:${input.taskId}:overdue:${membershipId}`,
      });
    }
  }

  async scheduleProjectReminder(input: {
    workspaceId: string;
    projectId: string;
    projectName: string;
    dueAt: Date | null;
    ownerMembershipId: string | null;
    terminal: boolean;
    tx?: Prisma.TransactionClient;
  }) {
    const db = input.tx ?? this.prisma;
    await db.notificationReminder.updateMany({
      where: {
        workspaceId: input.workspaceId,
        entityType: NotificationEntityType.PROJECT,
        entityId: input.projectId,
        status: NotificationReminderStatus.PENDING,
      },
      data: { status: NotificationReminderStatus.CANCELLED, cancelledAt: new Date() },
    });
    if (!input.dueAt || input.terminal || !input.ownerMembershipId) return;
    await upsertReminder(db, {
      workspaceId: input.workspaceId,
      recipientMembershipId: input.ownerMembershipId,
      reminderType: NotificationReminderType.PROJECT_DUE_SOON,
      category: NotificationCategory.PROJECT,
      type: NotificationType.PROJECT_DUE_SOON,
      entityType: NotificationEntityType.PROJECT,
      entityId: input.projectId,
      scheduledFor: scheduledBefore(input.dueAt, PROJECT_DUE_SOON_MS),
      dedupeKey: `project:${input.projectId}:due-soon:${input.ownerMembershipId}`,
    });
  }

  async scheduleTicketSlaReminder(input: {
    workspaceId: string;
    ticketId: string;
    assignedToMembershipId: string | null;
    resolutionDueAt: Date | null;
    terminal: boolean;
    tx?: Prisma.TransactionClient;
  }) {
    const db = input.tx ?? this.prisma;
    await db.notificationReminder.updateMany({
      where: {
        workspaceId: input.workspaceId,
        entityType: NotificationEntityType.TICKET,
        entityId: input.ticketId,
        reminderType: NotificationReminderType.TICKET_SLA_WARNING,
        status: NotificationReminderStatus.PENDING,
      },
      data: { status: NotificationReminderStatus.CANCELLED, cancelledAt: new Date() },
    });
    if (!input.resolutionDueAt || input.terminal || !input.assignedToMembershipId) return;
    await upsertReminder(db, {
      workspaceId: input.workspaceId,
      recipientMembershipId: input.assignedToMembershipId,
      reminderType: NotificationReminderType.TICKET_SLA_WARNING,
      category: NotificationCategory.TICKET,
      type: NotificationType.TICKET_SLA_WARNING,
      entityType: NotificationEntityType.TICKET,
      entityId: input.ticketId,
      scheduledFor: scheduledBefore(input.resolutionDueAt, TICKET_SLA_WARNING_MS),
      dedupeKey: `ticket:${input.ticketId}:sla-warning:${input.assignedToMembershipId}`,
    });
  }
}

@Injectable()
@Processor(NOTIFICATION_REMINDER_QUEUE)
export class NotificationReminderProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationReminderProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly router: NotificationRouterService,
    private readonly emailDelivery: NotificationEmailDeliveryService,
  ) {
    super();
  }

  async process(job: Job<{ type: string; version: 1 }>) {
    if (job.name !== NOTIFICATION_REMINDER_SCAN_JOB_TYPE) return;
    const fired = await this.dispatchDueReminders(new Date());
    await this.emailDelivery.dispatchPending();
    if (fired > 0) this.logger.log({ fired, message: 'Notification reminder scanner fired rows' });
  }

  async dispatchDueReminders(now = new Date()) {
    const rows = await this.prisma.notificationReminder.findMany({
      where: { status: NotificationReminderStatus.PENDING, scheduledFor: { lte: now } },
      select: {
        id: true,
        workspaceId: true,
        recipientMembershipId: true,
        reminderType: true,
        category: true,
        type: true,
        entityType: true,
        entityId: true,
        scheduledFor: true,
        dedupeKey: true,
      },
      orderBy: [{ scheduledFor: 'asc' }, { id: 'asc' }],
      take: SCAN_LIMIT,
    });
    let fired = 0;
    for (const row of rows) {
      const claimed = await this.prisma.notificationReminder.updateMany({
        where: {
          id: row.id,
          status: NotificationReminderStatus.PENDING,
          scheduledFor: { lte: now },
        },
        data: { status: NotificationReminderStatus.FIRED, firedAt: now },
      });
      if (claimed.count !== 1) continue;
      try {
        const hierarchyActive = await this.workspaceHierarchyActive(row.workspaceId);
        if (!hierarchyActive) {
          await this.prisma.notificationReminder.update({
            where: { id: row.id },
            data: { status: NotificationReminderStatus.SKIPPED, skippedAt: now },
          });
          continue;
        }
        const intent = await this.intentForReminder(row, now);
        if (!intent) {
          await this.prisma.notificationReminder.update({
            where: { id: row.id },
            data: { status: NotificationReminderStatus.SKIPPED, skippedAt: now },
          });
          continue;
        }
        await this.router.route(intent);
        fired += 1;
      } catch {
        await this.prisma.notificationReminder.update({
          where: { id: row.id },
          data: { status: NotificationReminderStatus.PENDING, firedAt: null },
        });
      }
    }
    return fired;
  }

  private async workspaceHierarchyActive(workspaceId: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        status: true,
        agency: {
          select: {
            status: true,
            superAgency: { select: { status: true } },
          },
        },
      },
    });
    return (
      workspace?.status === WorkspaceStatus.ACTIVE &&
      workspace.agency.status === AgencyStatus.ACTIVE &&
      workspace.agency.superAgency.status === SuperAgencyStatus.ACTIVE
    );
  }

  private async intentForReminder(row: DueReminder, now: Date) {
    if (row.reminderType === NotificationReminderType.TASK_DUE_SOON) {
      const task = await this.prisma.task.findFirst({
        where: {
          id: row.entityId,
          workspaceId: row.workspaceId,
          deletedAt: null,
          archivedAt: null,
          assignees: { some: { membershipId: row.recipientMembershipId } },
          statusDefinition: { isTerminal: false },
        },
        select: { id: true, title: true, dueAt: true },
      });
      if (!task?.dueAt || task.dueAt <= now) return null;
      if (!scheduledTargetMatches(row.scheduledFor, task.dueAt, TASK_DUE_SOON_MS, now)) {
        return null;
      }
      return {
        workspaceId: row.workspaceId,
        recipientMembershipId: row.recipientMembershipId,
        category: row.category,
        type: row.type,
        title: 'Task due soon',
        message: `${task.title} is due soon.`,
        entityType: row.entityType,
        entityId: row.entityId,
        priority: NotificationPriority.IMPORTANT,
        dedupeKey: `reminder:${row.dedupeKey}`,
        metadata: { taskId: task.id },
        emailTemplateData: {
          taskTitle: task.title,
          dueAt: task.dueAt.toISOString(),
          entityId: task.id,
        },
      };
    }
    if (row.reminderType === NotificationReminderType.TASK_OVERDUE) {
      const task = await this.prisma.task.findFirst({
        where: {
          id: row.entityId,
          workspaceId: row.workspaceId,
          deletedAt: null,
          archivedAt: null,
          assignees: { some: { membershipId: row.recipientMembershipId } },
          statusDefinition: { isTerminal: false },
          dueAt: { lt: now },
        },
        select: { id: true, title: true, dueAt: true },
      });
      if (!task) return null;
      if (task.dueAt && !sameTime(row.scheduledFor, task.dueAt)) return null;
      return {
        workspaceId: row.workspaceId,
        recipientMembershipId: row.recipientMembershipId,
        category: row.category,
        type: row.type,
        title: 'Task overdue',
        message: `${task.title} is overdue.`,
        entityType: row.entityType,
        entityId: row.entityId,
        priority: NotificationPriority.URGENT,
        dedupeKey: `reminder:${row.dedupeKey}`,
        metadata: { taskId: task.id },
        emailTemplateData: { taskTitle: task.title, entityId: task.id },
      };
    }
    if (row.reminderType === NotificationReminderType.PROJECT_DUE_SOON) {
      const project = await this.prisma.project.findFirst({
        where: {
          id: row.entityId,
          workspaceId: row.workspaceId,
          ownerMembershipId: row.recipientMembershipId,
          archivedAt: null,
          status: { not: ProjectStatus.ARCHIVED },
        },
        select: { id: true, name: true, dueAt: true },
      });
      if (!project?.dueAt || project.dueAt <= now) return null;
      if (!scheduledTargetMatches(row.scheduledFor, project.dueAt, PROJECT_DUE_SOON_MS, now)) {
        return null;
      }
      return {
        workspaceId: row.workspaceId,
        recipientMembershipId: row.recipientMembershipId,
        category: row.category,
        type: row.type,
        title: 'Project due soon',
        message: `${project.name} is due soon.`,
        entityType: row.entityType,
        entityId: row.entityId,
        priority: NotificationPriority.IMPORTANT,
        dedupeKey: `reminder:${row.dedupeKey}`,
        metadata: { projectId: project.id },
        emailTemplateData: {
          projectName: project.name,
          dueAt: project.dueAt.toISOString(),
          entityId: project.id,
        },
      };
    }
    const ticket = await this.prisma.ticket.findFirst({
      where: {
        id: row.entityId,
        workspaceId: row.workspaceId,
        deletedAt: null,
        assignedToMembershipId: row.recipientMembershipId,
        statusDefinition: { isTerminal: false },
        slaState: {
          resolutionDueAt: { gt: now },
          resolutionCompletedAt: null,
          resolutionBreachedAt: null,
          resolutionPausedAt: null,
        },
      },
      select: {
        id: true,
        ticketNumber: true,
        subject: true,
        slaState: { select: { resolutionDueAt: true } },
      },
    });
    if (!ticket?.slaState?.resolutionDueAt) return null;
    if (
      !scheduledTargetMatches(
        row.scheduledFor,
        ticket.slaState.resolutionDueAt,
        TICKET_SLA_WARNING_MS,
        now,
      )
    ) {
      return null;
    }
    return {
      workspaceId: row.workspaceId,
      recipientMembershipId: row.recipientMembershipId,
      category: row.category,
      type: row.type,
      title: 'Ticket SLA warning',
      message: `${ticket.ticketNumber} is approaching its SLA deadline.`,
      entityType: row.entityType,
      entityId: row.entityId,
      priority: NotificationPriority.URGENT,
      dedupeKey: `reminder:${row.dedupeKey}`,
      metadata: { ticketId: ticket.id, ticketNumber: ticket.ticketNumber },
      emailTemplateData: {
        ticketNumber: ticket.ticketNumber,
        ticketSubject: ticket.subject,
        dueAt: ticket.slaState.resolutionDueAt.toISOString(),
        entityId: ticket.id,
      },
    };
  }
}

type DueReminder = Prisma.NotificationReminderGetPayload<{
  select: {
    id: true;
    workspaceId: true;
    recipientMembershipId: true;
    reminderType: true;
    category: true;
    type: true;
    entityType: true;
    entityId: true;
    scheduledFor: true;
    dedupeKey: true;
  };
}>;

async function upsertReminder(
  db: Prisma.TransactionClient | PrismaService,
  data: {
    workspaceId: string;
    recipientMembershipId: string;
    reminderType: NotificationReminderType;
    category: NotificationCategory;
    type: NotificationType;
    entityType: NotificationEntityType;
    entityId: string;
    scheduledFor: Date;
    dedupeKey: string;
  },
) {
  await db.notificationReminder.upsert({
    where: {
      workspaceId_recipientMembershipId_dedupeKey: {
        workspaceId: data.workspaceId,
        recipientMembershipId: data.recipientMembershipId,
        dedupeKey: data.dedupeKey,
      },
    },
    create: data,
    update: {
      scheduledFor: data.scheduledFor,
      status: NotificationReminderStatus.PENDING,
      firedAt: null,
      skippedAt: null,
      cancelledAt: null,
    },
  });
}

function scheduledBefore(dueAt: Date, offsetMs: number) {
  const candidate = new Date(dueAt.getTime() - offsetMs);
  return candidate < new Date() ? new Date() : candidate;
}

function scheduledTargetMatches(scheduledFor: Date, targetAt: Date, offsetMs: number, now: Date) {
  const expected = new Date(targetAt.getTime() - offsetMs);
  if (expected <= now) return scheduledFor <= now;
  return sameTime(scheduledFor, expected);
}

function sameTime(left: Date, right: Date) {
  return left.getTime() === right.getTime();
}
