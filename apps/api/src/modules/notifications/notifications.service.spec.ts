import {
  NotificationCategory,
  NotificationEntityType,
  NotificationPriority,
  NotificationType,
  Prisma,
} from '@prisma/client';
import type { WorkspaceTenantContext } from '../../common/auth/auth.types';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  const tenant: WorkspaceTenantContext = {
    agencyId: 'agency-1',
    workspaceId: 'workspace-1',
    workspaceMembershipId: 'member-1',
    agencyMembershipId: null,
    roleId: 'role-1',
    roleName: 'MEMBER',
    permissions: ['notifications.view'],
    accessSource: 'WORKSPACE_MEMBERSHIP',
    userId: 'user-1',
  };

  function createPrisma(overrides: Record<string, unknown> = {}) {
    return {
      workspaceMembership: {
        findFirst: jest.fn().mockResolvedValue({ id: 'member-1' }),
      },
      notificationPreference: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
      },
      notification: {
        create: jest.fn().mockImplementation(({ data }) => ({
          id: 'notification-1',
          createdAt: new Date('2026-09-24T00:00:00.000Z'),
          readAt: null,
          ...data,
        })),
        findFirst: jest.fn().mockResolvedValue({
          id: 'notification-1',
          workspaceId: 'workspace-1',
          recipientMembershipId: 'member-1',
          category: NotificationCategory.TASK,
          type: NotificationType.TASK_ASSIGNED,
          title: 'Task assigned',
          message: 'You were assigned.',
          entityType: NotificationEntityType.TASK,
          entityId: '00000000-0000-4000-8000-000000000001',
          actorMembershipId: null,
          priority: NotificationPriority.NORMAL,
          readAt: null,
          metadata: {},
          dedupeKey: 'task:1',
          createdAt: new Date('2026-09-24T00:00:00.000Z'),
          expiresAt: null,
        }),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn().mockImplementation(({ data }) => ({
          id: 'notification-1',
          workspaceId: 'workspace-1',
          recipientMembershipId: 'member-1',
          category: NotificationCategory.TASK,
          type: NotificationType.TASK_ASSIGNED,
          title: 'Task assigned',
          message: 'You were assigned.',
          entityType: NotificationEntityType.TASK,
          entityId: '00000000-0000-4000-8000-000000000001',
          actorMembershipId: null,
          priority: NotificationPriority.NORMAL,
          readAt: data.readAt,
          metadata: {},
          dedupeKey: 'task:1',
          createdAt: new Date('2026-09-24T00:00:00.000Z'),
          expiresAt: null,
        })),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      $transaction: jest.fn().mockImplementation((operations) => Promise.all(operations)),
      ...overrides,
    };
  }

  it('creates a workspace-membership scoped durable notification', async () => {
    const prisma = createPrisma();
    const service = new NotificationsService(prisma as never);

    await service.createNotification({
      workspaceId: 'workspace-1',
      recipientMembershipId: 'member-1',
      category: NotificationCategory.TASK,
      type: NotificationType.TASK_ASSIGNED,
      title: 'Task assigned',
      message: 'You were assigned to Launch.',
      entityType: NotificationEntityType.TASK,
      entityId: '00000000-0000-4000-8000-000000000001',
      dedupeKey: 'task:1:assigned:member-1',
      metadata: { taskId: '00000000-0000-4000-8000-000000000001' },
    });

    expect(prisma.workspaceMembership.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceId: 'workspace-1', id: 'member-1' }),
      }),
    );
    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recipientMembershipId: 'member-1',
          dedupeKey: 'task:1:assigned:member-1',
        }),
      }),
    );
  });

  it('rejects foreign recipients', async () => {
    const prisma = createPrisma({
      workspaceMembership: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    const service = new NotificationsService(prisma as never);

    await expect(
      service.createNotification({
        workspaceId: 'workspace-1',
        recipientMembershipId: 'foreign-member',
        category: NotificationCategory.TASK,
        type: NotificationType.TASK_ASSIGNED,
        title: 'Task assigned',
        message: 'You were assigned.',
      }),
    ).rejects.toThrow('INVALID_NOTIFICATION_RECIPIENT');
  });

  it('dedupes retried notification creation', async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const prisma = createPrisma({
      notification: {
        ...createPrisma().notification,
        create: jest.fn().mockRejectedValue(duplicate),
        findFirst: jest.fn().mockResolvedValue({ id: 'existing' }),
      },
    });
    const service = new NotificationsService(prisma as never);

    await expect(
      service.createNotification({
        workspaceId: 'workspace-1',
        recipientMembershipId: 'member-1',
        category: NotificationCategory.TASK,
        type: NotificationType.TASK_ASSIGNED,
        title: 'Task assigned',
        message: 'You were assigned.',
        dedupeKey: 'task:1',
      }),
    ).resolves.toEqual({ id: 'existing' });
  });

  it('rejects sensitive metadata', async () => {
    const service = new NotificationsService(createPrisma() as never);

    await expect(
      service.createNotification({
        workspaceId: 'workspace-1',
        recipientMembershipId: 'member-1',
        category: NotificationCategory.SYSTEM,
        type: NotificationType.SYSTEM_ANNOUNCEMENT,
        title: 'Security',
        message: 'Important notice.',
        metadata: { authorizationHeader: 'Bearer secret' },
      }),
    ).rejects.toThrow('NOTIFICATION_METADATA_SENSITIVE');
  });

  it('uses DB count for unread count and scopes to current membership', async () => {
    const prisma = createPrisma();
    const service = new NotificationsService(prisma as never);

    await service.getUnreadCount(tenant);

    expect(prisma.notification.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        workspaceId: 'workspace-1',
        recipientMembershipId: 'member-1',
        readAt: null,
      }),
    });
  });

  it('marks only owned notifications read and mark-all only affects current membership', async () => {
    const prisma = createPrisma();
    const service = new NotificationsService(prisma as never);

    await service.markRead(tenant, 'notification-1');
    await service.markAllRead(tenant);

    expect(prisma.notification.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'notification-1',
        workspaceId: 'workspace-1',
        recipientMembershipId: 'member-1',
      },
      select: { id: true },
    });
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: {
        workspaceId: 'workspace-1',
        recipientMembershipId: 'member-1',
        readAt: null,
      },
      data: { readAt: expect.any(Date) },
    });
  });

  it('respects disabled and muted category preferences for ordinary notifications', async () => {
    const prisma = createPrisma({
      notificationPreference: {
        findUnique: jest.fn().mockResolvedValue({
          inAppEnabled: true,
          mutedUntil: new Date('2999-01-01T00:00:00.000Z'),
        }),
      },
    });
    const service = new NotificationsService(prisma as never);

    await expect(
      service.createNotification({
        workspaceId: 'workspace-1',
        recipientMembershipId: 'member-1',
        category: NotificationCategory.TASK,
        type: NotificationType.TASK_ASSIGNED,
        title: 'Task assigned',
        message: 'You were assigned.',
      }),
    ).resolves.toBeNull();
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });
});
