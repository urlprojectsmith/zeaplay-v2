import { Injectable, Optional } from '@nestjs/common';
import {
  NotificationCategory,
  NotificationEmailDeliveryStatus,
  NotificationEntityType,
  NotificationPriority,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { NotificationEmailDeliveryService } from './notification-email-delivery.service';
import {
  NotificationEmailTemplateData,
  NotificationEmailTemplateKey,
} from './notification-email-templates';
import { NotificationsService } from './notifications.service';

export interface NotificationRouteIntent {
  workspaceId: string;
  recipientMembershipId: string;
  category: NotificationCategory;
  type: NotificationType;
  title: string;
  message: string;
  entityType?: NotificationEntityType | null;
  entityId?: string | null;
  actorMembershipId?: string | null;
  priority?: NotificationPriority;
  metadata?: Prisma.InputJsonValue | null;
  dedupeKey: string;
  expiresAt?: Date | null;
  critical?: boolean;
  emailTemplateKey?: NotificationEmailTemplateKey;
  emailTemplateData?: NotificationEmailTemplateData;
  tx?: Prisma.TransactionClient;
}

const missingEmailDelivery = {
  enqueueDelivery: () => Promise.resolve(undefined),
} as unknown as NotificationEmailDeliveryService;

@Injectable()
export class NotificationRouterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @Optional()
    private readonly emailDelivery: NotificationEmailDeliveryService = missingEmailDelivery,
  ) {}

  async route(intent: NotificationRouteIntent) {
    const db = intent.tx ?? this.prisma;
    const inApp = await this.notifications.createNotification(intent);
    const email = await this.persistEmailDelivery(db, intent);
    if (email?.status === NotificationEmailDeliveryStatus.PENDING && !intent.tx) {
      const queued = await this.prisma.notificationEmailDelivery.updateMany({
        where: { id: email.id, status: NotificationEmailDeliveryStatus.PENDING },
        data: {
          status: NotificationEmailDeliveryStatus.QUEUED,
          queuedAt: new Date(),
          failureCode: null,
        },
      });
      if (queued.count === 1) await this.emailDelivery.enqueueDelivery(email.id);
    }
    return { inApp, emailDeliveryId: email?.id ?? null };
  }

  private async persistEmailDelivery(
    db: Prisma.TransactionClient | PrismaService,
    intent: NotificationRouteIntent,
  ) {
    const templateKey = intent.emailTemplateKey ?? templateForType(intent.type);
    if (!templateKey) return null;
    const preference = await db.notificationPreference.findUnique({
      where: {
        membershipId_category: {
          membershipId: intent.recipientMembershipId,
          category: intent.category,
        },
      },
      select: { emailEnabled: true, mutedUntil: true },
    });
    const now = new Date();
    const emailEnabled = preference?.emailEnabled ?? false;
    const muted = preference?.mutedUntil ? preference.mutedUntil > now : false;
    const bypass = Boolean(
      intent.critical &&
      intent.category === NotificationCategory.SYSTEM &&
      intent.type === NotificationType.SYSTEM_ANNOUNCEMENT,
    );
    const status =
      bypass || (emailEnabled && !muted)
        ? NotificationEmailDeliveryStatus.PENDING
        : NotificationEmailDeliveryStatus.SKIPPED;
    const templateData = toTemplateJsonObject({
      ...intent.emailTemplateData,
      entityId: intent.entityId ?? intent.emailTemplateData?.entityId ?? null,
    } satisfies NotificationEmailTemplateData);
    try {
      return await db.notificationEmailDelivery.create({
        data: {
          workspaceId: intent.workspaceId,
          recipientMembershipId: intent.recipientMembershipId,
          category: intent.category,
          type: intent.type,
          templateKey,
          templateData,
          entityType: intent.entityType ?? null,
          entityId: intent.entityId ?? null,
          status,
          idempotencyKey: intent.dedupeKey,
          scheduledAt: now,
          failureCode: status === NotificationEmailDeliveryStatus.SKIPPED ? 'EMAIL_DISABLED' : null,
        },
        select: { id: true, status: true },
      });
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      return db.notificationEmailDelivery.findFirst({
        where: {
          workspaceId: intent.workspaceId,
          recipientMembershipId: intent.recipientMembershipId,
          idempotencyKey: intent.dedupeKey,
        },
        select: { id: true, status: true },
      });
    }
  }
}

export function templateForType(type: NotificationType): NotificationEmailTemplateKey | null {
  switch (type) {
    case NotificationType.TASK_ASSIGNED:
      return 'task.assigned';
    case NotificationType.TASK_DUE_SOON:
      return 'task.due_soon';
    case NotificationType.TASK_OVERDUE:
      return 'task.overdue';
    case NotificationType.PROJECT_DUE_SOON:
      return 'project.due_soon';
    case NotificationType.TICKET_ASSIGNED:
      return 'ticket.assigned';
    case NotificationType.TICKET_SLA_WARNING:
      return 'ticket.sla_warning';
    case NotificationType.AUTOMATION_EXECUTION_FAILED:
      return 'automation.failed';
    case NotificationType.AUTOMATION_DEAD_LETTERED:
      return 'automation.dead_lettered';
    case NotificationType.GAMIFICATION_ACHIEVEMENT_EARNED:
      return 'gamification.achievement_earned';
    case NotificationType.GAMIFICATION_BADGE_EARNED:
      return 'gamification.badge_earned';
    default:
      return null;
  }
}

function toTemplateJsonObject(data: NotificationEmailTemplateData): Prisma.InputJsonObject {
  return Object.fromEntries(
    Object.entries(data).filter((entry): entry is [string, string | null] => {
      const value = entry[1];
      return typeof value === 'string' || value === null;
    }),
  );
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
