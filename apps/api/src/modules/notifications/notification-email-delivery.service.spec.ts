import { NotificationEmailDeliveryStatus } from '@prisma/client';
import {
  NotificationEmailDeliveryService,
  NotificationEmailProcessor,
} from './notification-email-delivery.service';

describe('NotificationEmailProcessor', () => {
  beforeAll(() => {
    process.env.WEB_APP_URL = 'http://localhost:3000';
    process.env.API_PUBLIC_URL = 'http://localhost:4000/api/v1';
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    process.env.DIRECT_DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    process.env.REDIS_CACHE_URL = 'redis://localhost:6379';
    process.env.REDIS_QUEUE_URL = 'redis://localhost:6379';
    process.env.REDIS_REALTIME_URL = 'redis://localhost:6379';
    process.env.REDIS_RATE_LIMIT_URL = 'redis://localhost:6379';
    process.env.JWT_ACCESS_SECRET = 'access-secret-at-least-32-characters';
    process.env.JWT_REFRESH_SECRET = 'refresh-secret-at-least-32-characters';
    process.env.MINIO_ENDPOINT = 'localhost';
    process.env.MINIO_ACCESS_KEY = 'minio-access';
    process.env.MINIO_SECRET_KEY = 'minio-secret';
    process.env.MINIO_BUCKET = 'zea-play';
    process.env.EMAIL_PROVIDER = 'smtp';
    process.env.EMAIL_FROM = 'noreply@example.com';
    process.env.EMAIL_FROM_NAME = 'ZeaPlay';
    process.env.SMTP_HOST = 'localhost';
    process.env.SMTP_PORT = '1025';
    process.env.SMTP_SECURE = 'false';
    process.env.OTP_PEPPER = 'otp-pepper-at-least-32-characters';
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318';
  });

  it('sweeps stale sending deliveries to ambiguous during durable dispatch', async () => {
    const prisma = {
      notificationEmailDelivery: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([{ id: 'pending-delivery' }]),
      },
    };
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    const service = new NotificationEmailDeliveryService(prisma as never, queue as never);
    const now = new Date('2026-09-24T00:20:00.000Z');

    await expect(service.dispatchPending(100, now)).resolves.toBe(1);

    expect(prisma.notificationEmailDelivery.updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        status: NotificationEmailDeliveryStatus.SENDING,
        updatedAt: { lte: new Date('2026-09-24T00:05:00.000Z') },
      },
      data: {
        status: NotificationEmailDeliveryStatus.AMBIGUOUS,
        failureCode: 'STALE_SENDING',
      },
    });
    expect(queue.add).toHaveBeenCalledWith(
      'notification-email.send',
      { deliveryId: 'pending-delivery' },
      { jobId: 'notification-email:pending-delivery' },
    );
  });

  it('skips deliveries with missing active email recipients', async () => {
    const prisma = {
      notificationEmailDelivery: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'delivery-1',
          workspaceId: 'workspace-1',
          recipientMembershipId: 'member-1',
          templateKey: 'task.assigned',
          templateData: { taskTitle: 'Launch' },
          status: NotificationEmailDeliveryStatus.QUEUED,
          attemptCount: 0,
          maxAttempts: 3,
          updatedAt: new Date(),
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      workspaceMembership: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const processor = new NotificationEmailProcessor(prisma as never, { send: jest.fn() } as never);

    await processor.sendDelivery('delivery-1');

    expect(prisma.workspaceMembership.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'member-1',
        workspaceId: 'workspace-1',
        status: 'ACTIVE',
        user: { status: 'ACTIVE' },
      },
      select: { user: { select: { email: true } } },
    });

    expect(prisma.notificationEmailDelivery.update).toHaveBeenCalledWith({
      where: { id: 'delivery-1' },
      data: {
        status: NotificationEmailDeliveryStatus.SKIPPED,
        failureCode: 'INVALID_RECIPIENT',
      },
    });
  });

  it('marks stale sending deliveries ambiguous instead of resending', async () => {
    const prisma = {
      notificationEmailDelivery: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'delivery-1',
          status: NotificationEmailDeliveryStatus.SENDING,
          updatedAt: new Date('2026-09-24T00:00:00.000Z'),
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const mail = { send: jest.fn() };
    const processor = new NotificationEmailProcessor(prisma as never, mail as never);

    await processor.sendDelivery('delivery-1', new Date('2026-09-24T00:20:00.000Z'));

    expect(mail.send).not.toHaveBeenCalled();
    expect(prisma.notificationEmailDelivery.update).toHaveBeenCalledWith({
      where: { id: 'delivery-1' },
      data: {
        status: NotificationEmailDeliveryStatus.AMBIGUOUS,
        failureCode: 'STALE_SENDING',
      },
    });
  });

  it('does not resend terminal or ambiguous deliveries', async () => {
    for (const status of [
      NotificationEmailDeliveryStatus.SENT,
      NotificationEmailDeliveryStatus.FAILED,
      NotificationEmailDeliveryStatus.AMBIGUOUS,
      NotificationEmailDeliveryStatus.SKIPPED,
    ]) {
      const prisma = {
        notificationEmailDelivery: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'delivery-1',
            status,
            updatedAt: new Date(),
          }),
          update: jest.fn(),
        },
      };
      const mail = { send: jest.fn() };
      const processor = new NotificationEmailProcessor(prisma as never, mail as never);

      await processor.sendDelivery('delivery-1');

      expect(mail.send).not.toHaveBeenCalled();
      expect(prisma.notificationEmailDelivery.update).not.toHaveBeenCalled();
    }
  });

  it('retries transient provider errors but fails permanent provider errors', async () => {
    const baseDelivery = {
      id: 'delivery-1',
      workspaceId: 'workspace-1',
      recipientMembershipId: 'member-1',
      templateKey: 'task.assigned',
      templateData: { taskTitle: 'Launch' },
      status: NotificationEmailDeliveryStatus.QUEUED,
      attemptCount: 0,
      maxAttempts: 3,
      updatedAt: new Date(),
    };
    const recipient = { user: { email: 'member@example.com' } };
    const transientPrisma = {
      notificationEmailDelivery: {
        findUnique: jest.fn().mockResolvedValue(baseDelivery),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      workspaceMembership: { findFirst: jest.fn().mockResolvedValue(recipient) },
    };
    await new NotificationEmailProcessor(
      transientPrisma as never,
      { send: jest.fn().mockRejectedValue(new Error('MAIL_DOWN')) } as never,
    ).sendDelivery('delivery-1');
    expect(transientPrisma.notificationEmailDelivery.update).toHaveBeenCalledWith({
      where: { id: 'delivery-1' },
      data: {
        status: NotificationEmailDeliveryStatus.PENDING,
        failureCode: 'MAIL_DELIVERY_FAILED',
      },
    });

    const permanentPrisma = {
      notificationEmailDelivery: {
        findUnique: jest.fn().mockResolvedValue(baseDelivery),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      workspaceMembership: { findFirst: jest.fn().mockResolvedValue(recipient) },
    };
    await new NotificationEmailProcessor(
      permanentPrisma as never,
      { send: jest.fn().mockRejectedValue({ retryable: false }) } as never,
    ).sendDelivery('delivery-1');
    expect(permanentPrisma.notificationEmailDelivery.update).toHaveBeenCalledWith({
      where: { id: 'delivery-1' },
      data: {
        status: NotificationEmailDeliveryStatus.FAILED,
        failureCode: 'MAIL_DELIVERY_PERMANENT',
      },
    });
  });

  it('sends committed deliveries when the recipient membership and user remain active', async () => {
    const prisma = {
      notificationEmailDelivery: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'delivery-1',
          workspaceId: 'workspace-1',
          recipientMembershipId: 'member-1',
          templateKey: 'task.assigned',
          templateData: { taskTitle: 'Launch' },
          status: NotificationEmailDeliveryStatus.QUEUED,
          attemptCount: 0,
          maxAttempts: 3,
          updatedAt: new Date(),
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      workspaceMembership: {
        findFirst: jest.fn().mockResolvedValue({ user: { email: 'member@example.com' } }),
      },
    };
    const mail = { send: jest.fn().mockResolvedValue(undefined) };

    await new NotificationEmailProcessor(prisma as never, mail as never).sendDelivery('delivery-1');

    expect(mail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'member@example.com',
        subject: expect.stringContaining('Task assigned'),
      }),
    );
    expect(prisma.notificationEmailDelivery.update).toHaveBeenCalledWith({
      where: { id: 'delivery-1' },
      data: expect.objectContaining({ status: NotificationEmailDeliveryStatus.SENT }),
    });
  });

  it('fails malformed stored template data without sending', async () => {
    const prisma = {
      notificationEmailDelivery: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'delivery-1',
          workspaceId: 'workspace-1',
          recipientMembershipId: 'member-1',
          templateKey: 'task.assigned',
          templateData: 'not-an-object',
          status: NotificationEmailDeliveryStatus.QUEUED,
          attemptCount: 0,
          maxAttempts: 3,
          updatedAt: new Date(),
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      workspaceMembership: {
        findFirst: jest.fn().mockResolvedValue({ user: { email: 'member@example.com' } }),
      },
    };
    const mail = { send: jest.fn() };

    await new NotificationEmailProcessor(prisma as never, mail as never).sendDelivery('delivery-1');

    expect(mail.send).not.toHaveBeenCalled();
    expect(prisma.notificationEmailDelivery.update).toHaveBeenCalledWith({
      where: { id: 'delivery-1' },
      data: {
        status: NotificationEmailDeliveryStatus.FAILED,
        failureCode: 'TEMPLATE_DATA_INVALID',
      },
    });
  });
});
