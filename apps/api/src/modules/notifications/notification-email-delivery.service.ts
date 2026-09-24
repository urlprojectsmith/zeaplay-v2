import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  MembershipStatus,
  NotificationEmailDeliveryStatus,
  Prisma,
  UserStatus,
} from '@prisma/client';
import type { Job, Queue } from 'bullmq';
import { validateEnvironment } from '@zea-play/config';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { MailService } from '../../infrastructure/mail/mail.service';
import {
  NOTIFICATION_EMAIL_QUEUE,
  NOTIFICATION_EMAIL_SEND_JOB_TYPE,
} from '../../infrastructure/queue/queue.constants';
import {
  NotificationEmailTemplateData,
  NotificationEmailTemplateKey,
  renderNotificationEmailTemplate,
} from './notification-email-templates';

const DISPATCH_LIMIT = 100;
const STALE_SENDING_MS = 15 * 60 * 1000;
const missingQueue = {
  add: () => Promise.resolve(undefined),
} as unknown as Queue<{ deliveryId: string }>;

@Injectable()
export class NotificationEmailDeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @InjectQueue(NOTIFICATION_EMAIL_QUEUE)
    private readonly queue: Queue<{ deliveryId: string }> = missingQueue,
  ) {}

  async enqueueDelivery(deliveryId: string) {
    await this.queue.add(
      NOTIFICATION_EMAIL_SEND_JOB_TYPE,
      { deliveryId },
      { jobId: `notification-email:${deliveryId}` },
    );
  }

  async dispatchPending(limit = DISPATCH_LIMIT, now = new Date()) {
    await this.prisma.notificationEmailDelivery.updateMany({
      where: {
        status: NotificationEmailDeliveryStatus.SENDING,
        updatedAt: { lte: new Date(now.getTime() - STALE_SENDING_MS) },
      },
      data: {
        status: NotificationEmailDeliveryStatus.AMBIGUOUS,
        failureCode: 'STALE_SENDING',
      },
    });
    const rows = await this.prisma.notificationEmailDelivery.findMany({
      where: {
        status: NotificationEmailDeliveryStatus.PENDING,
        scheduledAt: { lte: now },
      },
      select: { id: true },
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    let queued = 0;
    for (const row of rows) {
      const claimed = await this.prisma.notificationEmailDelivery.updateMany({
        where: { id: row.id, status: NotificationEmailDeliveryStatus.PENDING },
        data: { status: NotificationEmailDeliveryStatus.QUEUED, queuedAt: now, failureCode: null },
      });
      if (claimed.count !== 1) continue;
      await this.enqueueDelivery(row.id);
      queued += 1;
    }
    return queued;
  }
}

@Injectable()
@Processor(NOTIFICATION_EMAIL_QUEUE)
export class NotificationEmailProcessor extends WorkerHost {
  private readonly env = validateEnvironment(process.env);
  private readonly logger = new Logger(NotificationEmailProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {
    super();
  }

  async process(job: Job<{ deliveryId: string }>) {
    if (job.name !== NOTIFICATION_EMAIL_SEND_JOB_TYPE) return;
    await this.sendDelivery(job.data.deliveryId);
  }

  async sendDelivery(deliveryId: string, now = new Date()) {
    const delivery = await this.prisma.notificationEmailDelivery.findUnique({
      where: { id: deliveryId },
      select: deliverySelect,
    });
    if (!delivery) return;
    if (delivery.status === NotificationEmailDeliveryStatus.SENT) return;
    if (delivery.status === NotificationEmailDeliveryStatus.SENDING) {
      if (now.getTime() - delivery.updatedAt.getTime() >= STALE_SENDING_MS) {
        await this.mark(delivery.id, NotificationEmailDeliveryStatus.AMBIGUOUS, 'STALE_SENDING');
      }
      return;
    }
    if (
      delivery.status === NotificationEmailDeliveryStatus.FAILED ||
      delivery.status === NotificationEmailDeliveryStatus.AMBIGUOUS ||
      delivery.status === NotificationEmailDeliveryStatus.SKIPPED
    ) {
      return;
    }
    if (delivery.attemptCount >= delivery.maxAttempts) {
      await this.mark(delivery.id, NotificationEmailDeliveryStatus.FAILED, 'MAX_ATTEMPTS');
      return;
    }
    const claimed = await this.prisma.notificationEmailDelivery.updateMany({
      where: {
        id: delivery.id,
        status: {
          in: [NotificationEmailDeliveryStatus.PENDING, NotificationEmailDeliveryStatus.QUEUED],
        },
      },
      data: {
        status: NotificationEmailDeliveryStatus.SENDING,
        attemptCount: { increment: 1 },
        failureCode: null,
      },
    });
    if (claimed.count !== 1) return;
    const recipient = await this.prisma.workspaceMembership.findFirst({
      where: {
        id: delivery.recipientMembershipId,
        workspaceId: delivery.workspaceId,
        status: MembershipStatus.ACTIVE,
        user: { status: UserStatus.ACTIVE },
      },
      select: { user: { select: { email: true } } },
    });
    if (!recipient || !isValidEmail(recipient.user.email)) {
      await this.mark(delivery.id, NotificationEmailDeliveryStatus.SKIPPED, 'INVALID_RECIPIENT');
      return;
    }
    try {
      const templateData = jsonTemplateData(delivery.templateData);
      const rendered = renderNotificationEmailTemplate(
        delivery.templateKey as NotificationEmailTemplateKey,
        templateData,
        this.env.WEB_APP_URL,
      );
      await this.mail.send({ to: recipient.user.email, ...rendered });
      await this.prisma.notificationEmailDelivery.update({
        where: { id: delivery.id },
        data: {
          status: NotificationEmailDeliveryStatus.SENT,
          sentAt: new Date(),
          provider: this.env.EMAIL_PROVIDER,
          failureCode: null,
        },
      });
    } catch (error) {
      await this.handleSendError(
        delivery.id,
        delivery.attemptCount + 1,
        delivery.maxAttempts,
        error,
      );
    }
  }

  private async handleSendError(
    deliveryId: string,
    attemptedCount: number,
    maxAttempts: number,
    error: unknown,
  ) {
    const permanent = isPermanentDeliveryError(error);
    const status =
      permanent || attemptedCount >= maxAttempts
        ? NotificationEmailDeliveryStatus.FAILED
        : NotificationEmailDeliveryStatus.PENDING;
    await this.prisma.notificationEmailDelivery.update({
      where: { id: deliveryId },
      data: {
        status,
        failureCode: permanent ? permanentFailureCode(error) : 'MAIL_DELIVERY_FAILED',
      },
    });
    if (status === NotificationEmailDeliveryStatus.PENDING) {
      this.logger.warn({ deliveryId, message: 'Notification email delivery will retry' });
    }
  }

  private async mark(
    deliveryId: string,
    status: NotificationEmailDeliveryStatus,
    failureCode: string,
  ) {
    await this.prisma.notificationEmailDelivery.update({
      where: { id: deliveryId },
      data: { status, failureCode },
    });
  }
}

const deliverySelect = {
  id: true,
  workspaceId: true,
  recipientMembershipId: true,
  templateKey: true,
  templateData: true,
  status: true,
  attemptCount: true,
  maxAttempts: true,
  updatedAt: true,
} satisfies Prisma.NotificationEmailDeliverySelect;

function jsonTemplateData(value: Prisma.JsonValue | null): NotificationEmailTemplateData {
  if (!value) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('TEMPLATE_DATA_INVALID');
  }
  const data = value as Record<string, unknown>;
  return {
    title: stringValue(data.title),
    taskTitle: stringValue(data.taskTitle),
    projectName: stringValue(data.projectName),
    ticketNumber: stringValue(data.ticketNumber),
    ticketSubject: stringValue(data.ticketSubject),
    workflowName: stringValue(data.workflowName),
    achievementName: stringValue(data.achievementName),
    badgeName: stringValue(data.badgeName),
    dueAt: stringValue(data.dueAt),
    entityId: stringValue(data.entityId),
  };
}

function isPermanentDeliveryError(error: unknown) {
  if (error instanceof Error && error.message === 'UNKNOWN_NOTIFICATION_EMAIL_TEMPLATE') {
    return true;
  }
  if (error instanceof Error && error.message === 'TEMPLATE_DATA_INVALID') return true;
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { retryable?: unknown; permanent?: unknown };
  return candidate.retryable === false || candidate.permanent === true;
}

function permanentFailureCode(error: unknown) {
  if (error instanceof Error && error.message === 'TEMPLATE_DATA_INVALID') {
    return 'TEMPLATE_DATA_INVALID';
  }
  if (error instanceof Error && error.message === 'UNKNOWN_NOTIFICATION_EMAIL_TEMPLATE') {
    return 'TEMPLATE_INVALID';
  }
  return 'MAIL_DELIVERY_PERMANENT';
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
