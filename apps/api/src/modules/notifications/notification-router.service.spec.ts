import {
  NotificationCategory,
  NotificationEmailDeliveryStatus,
  NotificationEntityType,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { NotificationRouterService } from './notification-router.service';

describe('NotificationRouterService', () => {
  function createPrisma(emailEnabled: boolean, mutedUntil: Date | null = null) {
    return {
      notificationPreference: {
        findUnique: jest.fn().mockResolvedValue({ emailEnabled, mutedUntil }),
      },
      notificationEmailDelivery: {
        create: jest.fn().mockImplementation(({ data }) => ({
          id: 'delivery-1',
          status: data.status,
        })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn(),
      },
    };
  }

  it('routes in-app and queues email when the category email channel is enabled', async () => {
    const prisma = createPrisma(true);
    const notifications = { createNotification: jest.fn().mockResolvedValue({ id: 'n-1' }) };
    const emailDelivery = { enqueueDelivery: jest.fn().mockResolvedValue(undefined) };
    const service = new NotificationRouterService(
      prisma as never,
      notifications as never,
      emailDelivery as never,
    );

    await service.route({
      workspaceId: 'workspace-1',
      recipientMembershipId: 'member-1',
      category: NotificationCategory.TASK,
      type: NotificationType.TASK_ASSIGNED,
      title: 'Task assigned',
      message: 'You were assigned.',
      entityType: NotificationEntityType.TASK,
      entityId: '00000000-0000-4000-8000-000000000001',
      dedupeKey: 'task:1:assigned:member-1',
      emailTemplateData: { taskTitle: 'Launch' },
    });

    expect(notifications.createNotification).toHaveBeenCalled();
    expect(prisma.notificationEmailDelivery.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: NotificationEmailDeliveryStatus.PENDING,
          templateKey: 'task.assigned',
        }),
      }),
    );
    expect(emailDelivery.enqueueDelivery).toHaveBeenCalledWith('delivery-1');
  });

  it('keeps email independent by persisting skipped delivery when email is disabled', async () => {
    const prisma = createPrisma(false);
    const service = new NotificationRouterService(
      prisma as never,
      { createNotification: jest.fn().mockResolvedValue({ id: 'n-1' }) } as never,
      { enqueueDelivery: jest.fn() } as never,
    );

    await service.route({
      workspaceId: 'workspace-1',
      recipientMembershipId: 'member-1',
      category: NotificationCategory.TICKET,
      type: NotificationType.TICKET_ASSIGNED,
      title: 'Ticket assigned',
      message: 'You were assigned.',
      entityType: NotificationEntityType.TICKET,
      entityId: '00000000-0000-4000-8000-000000000002',
      dedupeKey: 'ticket:1:assigned:member-1',
    });

    expect(prisma.notificationEmailDelivery.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: NotificationEmailDeliveryStatus.SKIPPED,
          failureCode: 'EMAIL_DISABLED',
        }),
      }),
    );
  });

  it('supports email-only routing when in-app preferences suppress the in-app row', async () => {
    const prisma = createPrisma(true);
    const notifications = { createNotification: jest.fn().mockResolvedValue(null) };
    const emailDelivery = { enqueueDelivery: jest.fn().mockResolvedValue(undefined) };
    const service = new NotificationRouterService(
      prisma as never,
      notifications as never,
      emailDelivery as never,
    );

    await service.route({
      workspaceId: 'workspace-1',
      recipientMembershipId: 'member-1',
      category: NotificationCategory.TASK,
      type: NotificationType.TASK_ASSIGNED,
      title: 'Task assigned',
      message: 'You were assigned.',
      entityType: NotificationEntityType.TASK,
      entityId: '00000000-0000-4000-8000-000000000001',
      dedupeKey: 'task:1:assigned:member-1',
    });

    expect(notifications.createNotification).toHaveBeenCalled();
    expect(emailDelivery.enqueueDelivery).toHaveBeenCalledWith('delivery-1');
  });

  it('suppresses ordinary email routing while muted', async () => {
    const prisma = createPrisma(true, new Date('2999-01-01T00:00:00.000Z'));
    const emailDelivery = { enqueueDelivery: jest.fn() };
    const service = new NotificationRouterService(
      prisma as never,
      { createNotification: jest.fn().mockResolvedValue(null) } as never,
      emailDelivery as never,
    );

    await service.route({
      workspaceId: 'workspace-1',
      recipientMembershipId: 'member-1',
      category: NotificationCategory.TASK,
      type: NotificationType.TASK_ASSIGNED,
      title: 'Task assigned',
      message: 'You were assigned.',
      entityType: NotificationEntityType.TASK,
      entityId: '00000000-0000-4000-8000-000000000001',
      dedupeKey: 'task:1:assigned:member-1',
    });

    expect(emailDelivery.enqueueDelivery).not.toHaveBeenCalled();
    expect(prisma.notificationEmailDelivery.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: NotificationEmailDeliveryStatus.SKIPPED,
          failureCode: 'EMAIL_DISABLED',
        }),
      }),
    );
  });

  it('allows explicitly critical system email to bypass disabled and muted preferences', async () => {
    const prisma = createPrisma(false, new Date('2999-01-01T00:00:00.000Z'));
    const emailDelivery = { enqueueDelivery: jest.fn().mockResolvedValue(undefined) };
    const service = new NotificationRouterService(
      prisma as never,
      { createNotification: jest.fn().mockResolvedValue({ id: 'n-1' }) } as never,
      emailDelivery as never,
    );

    await service.route({
      workspaceId: 'workspace-1',
      recipientMembershipId: 'member-1',
      category: NotificationCategory.SYSTEM,
      type: NotificationType.SYSTEM_ANNOUNCEMENT,
      title: 'Critical notice',
      message: 'System notice.',
      dedupeKey: 'system:critical:member-1',
      critical: true,
      emailTemplateKey: 'automation.failed',
      emailTemplateData: { workflowName: 'System' },
    });

    expect(prisma.notificationEmailDelivery.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: NotificationEmailDeliveryStatus.PENDING,
          failureCode: null,
        }),
      }),
    );
    expect(emailDelivery.enqueueDelivery).toHaveBeenCalledWith('delivery-1');
  });

  it('dedupes durable email delivery rows for repeated logical source retries', async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const prisma = createPrisma(true);
    prisma.notificationEmailDelivery.create.mockRejectedValue(duplicate);
    prisma.notificationEmailDelivery.findFirst.mockResolvedValue({
      id: 'existing-delivery',
      status: NotificationEmailDeliveryStatus.QUEUED,
    });
    const emailDelivery = { enqueueDelivery: jest.fn() };
    const service = new NotificationRouterService(
      prisma as never,
      { createNotification: jest.fn().mockResolvedValue({ id: 'n-1' }) } as never,
      emailDelivery as never,
    );

    await expect(
      service.route({
        workspaceId: 'workspace-1',
        recipientMembershipId: 'member-1',
        category: NotificationCategory.TASK,
        type: NotificationType.TASK_ASSIGNED,
        title: 'Task assigned',
        message: 'You were assigned.',
        entityType: NotificationEntityType.TASK,
        entityId: '00000000-0000-4000-8000-000000000001',
        dedupeKey: 'task:1:assigned:member-1',
      }),
    ).resolves.toEqual({ inApp: { id: 'n-1' }, emailDeliveryId: 'existing-delivery' });
    expect(emailDelivery.enqueueDelivery).not.toHaveBeenCalled();
  });
});
