import {
  AgencyStatus,
  NotificationCategory,
  NotificationEntityType,
  NotificationReminderStatus,
  NotificationReminderType,
  NotificationType,
  SuperAgencyStatus,
  WorkspaceStatus,
} from '@prisma/client';
import { NotificationReminderProcessor } from './notification-reminder.service';

describe('NotificationReminderProcessor', () => {
  it('fires due task reminders through the central router', async () => {
    const prisma = {
      notificationReminder: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'reminder-1',
            workspaceId: 'workspace-1',
            recipientMembershipId: 'member-1',
            reminderType: NotificationReminderType.TASK_DUE_SOON,
            category: NotificationCategory.TASK,
            type: NotificationType.TASK_DUE_SOON,
            entityType: NotificationEntityType.TASK,
            entityId: '00000000-0000-4000-8000-000000000001',
            scheduledFor: new Date('2026-09-24T00:00:00.000Z'),
            dedupeKey: 'task:1:due-soon:member-1',
          },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      workspace: { findUnique: jest.fn().mockResolvedValue(activeHierarchy()) },
      task: {
        findFirst: jest.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000001',
          title: 'Launch',
          dueAt: new Date('2026-09-25T00:00:00.000Z'),
        }),
      },
    };
    const router = { route: jest.fn().mockResolvedValue({}) };
    const processor = new NotificationReminderProcessor(
      prisma as never,
      router as never,
      { dispatchPending: jest.fn() } as never,
    );

    await expect(
      processor.dispatchDueReminders(new Date('2026-09-24T00:00:00.000Z')),
    ).resolves.toBe(1);

    expect(prisma.notificationReminder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: NotificationReminderStatus.PENDING,
          scheduledFor: { lte: expect.any(Date) },
        },
      }),
    );
    expect(prisma.notificationReminder.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'reminder-1',
        status: NotificationReminderStatus.PENDING,
        scheduledFor: { lte: new Date('2026-09-24T00:00:00.000Z') },
      },
      data: {
        status: NotificationReminderStatus.FIRED,
        firedAt: new Date('2026-09-24T00:00:00.000Z'),
      },
    });
    expect(router.route).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationType.TASK_DUE_SOON,
        dedupeKey: 'reminder:task:1:due-soon:member-1',
        emailTemplateData: expect.objectContaining({ taskTitle: 'Launch' }),
      }),
    );
  });

  it('skips stale reminders whose current deadline no longer matches the selected row', async () => {
    const prisma = {
      notificationReminder: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'reminder-1',
            workspaceId: 'workspace-1',
            recipientMembershipId: 'member-1',
            reminderType: NotificationReminderType.TASK_DUE_SOON,
            category: NotificationCategory.TASK,
            type: NotificationType.TASK_DUE_SOON,
            entityType: NotificationEntityType.TASK,
            entityId: '00000000-0000-4000-8000-000000000001',
            scheduledFor: new Date('2026-09-24T00:00:00.000Z'),
            dedupeKey: 'task:1:due-soon:member-1',
          },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      workspace: { findUnique: jest.fn().mockResolvedValue(activeHierarchy()) },
      task: {
        findFirst: jest.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000001',
          title: 'Launch',
          dueAt: new Date('2026-09-27T00:00:00.000Z'),
        }),
      },
    };
    const router = { route: jest.fn() };
    const processor = new NotificationReminderProcessor(
      prisma as never,
      router as never,
      { dispatchPending: jest.fn() } as never,
    );

    await expect(
      processor.dispatchDueReminders(new Date('2026-09-24T00:00:00.000Z')),
    ).resolves.toBe(0);

    expect(router.route).not.toHaveBeenCalled();
    expect(prisma.notificationReminder.update).toHaveBeenCalledWith({
      where: { id: 'reminder-1' },
      data: {
        status: NotificationReminderStatus.SKIPPED,
        skippedAt: new Date('2026-09-24T00:00:00.000Z'),
      },
    });
  });

  it('skips due reminders under an inactive parent hierarchy without routing or retrying', async () => {
    const now = new Date('2026-09-24T00:00:00.000Z');
    const prisma = {
      notificationReminder: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'reminder-1',
            workspaceId: 'workspace-1',
            recipientMembershipId: 'member-1',
            reminderType: NotificationReminderType.TASK_DUE_SOON,
            category: NotificationCategory.TASK,
            type: NotificationType.TASK_DUE_SOON,
            entityType: NotificationEntityType.TASK,
            entityId: '00000000-0000-4000-8000-000000000001',
            scheduledFor: now,
            dedupeKey: 'task:1:due-soon:member-1',
          },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      workspace: {
        findUnique: jest
          .fn()
          .mockResolvedValue(activeHierarchy({ superAgencyStatus: SuperAgencyStatus.SUSPENDED })),
      },
      task: { findFirst: jest.fn() },
    };
    const router = { route: jest.fn() };
    const processor = new NotificationReminderProcessor(
      prisma as never,
      router as never,
      { dispatchPending: jest.fn() } as never,
    );

    await expect(processor.dispatchDueReminders(now)).resolves.toBe(0);

    expect(prisma.task.findFirst).not.toHaveBeenCalled();
    expect(router.route).not.toHaveBeenCalled();
    expect(prisma.notificationReminder.update).toHaveBeenCalledWith({
      where: { id: 'reminder-1' },
      data: { status: NotificationReminderStatus.SKIPPED, skippedAt: now },
    });
  });

  it('skips blocked hierarchy variants deterministically without restoring pending state', async () => {
    const now = new Date('2026-09-24T00:00:00.000Z');
    for (const hierarchy of [
      activeHierarchy({ agencyStatus: AgencyStatus.SUSPENDED }),
      activeHierarchy({ agencyStatus: AgencyStatus.ARCHIVED }),
      activeHierarchy({ superAgencyStatus: SuperAgencyStatus.ARCHIVED }),
      { ...activeHierarchy(), status: WorkspaceStatus.SUSPENDED },
      null,
    ]) {
      const prisma = {
        notificationReminder: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'reminder-1',
              workspaceId: 'workspace-1',
              recipientMembershipId: 'member-1',
              reminderType: NotificationReminderType.TASK_OVERDUE,
              category: NotificationCategory.TASK,
              type: NotificationType.TASK_OVERDUE,
              entityType: NotificationEntityType.TASK,
              entityId: '00000000-0000-4000-8000-000000000001',
              scheduledFor: now,
              dedupeKey: 'task:1:overdue:member-1',
            },
          ]),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          update: jest.fn().mockResolvedValue({}),
        },
        workspace: { findUnique: jest.fn().mockResolvedValue(hierarchy) },
        task: { findFirst: jest.fn() },
      };
      const router = { route: jest.fn() };
      const processor = new NotificationReminderProcessor(
        prisma as never,
        router as never,
        { dispatchPending: jest.fn() } as never,
      );

      await expect(processor.dispatchDueReminders(now)).resolves.toBe(0);

      expect(router.route).not.toHaveBeenCalled();
      expect(prisma.task.findFirst).not.toHaveBeenCalled();
      expect(prisma.notificationReminder.update).toHaveBeenCalledWith({
        where: { id: 'reminder-1' },
        data: { status: NotificationReminderStatus.SKIPPED, skippedAt: now },
      });
      expect(prisma.notificationReminder.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: NotificationReminderStatus.PENDING,
            firedAt: null,
          }),
        }),
      );
    }
  });
});

function activeHierarchy(
  overrides: { agencyStatus?: AgencyStatus; superAgencyStatus?: SuperAgencyStatus } = {},
) {
  return {
    status: WorkspaceStatus.ACTIVE,
    agency: {
      status: overrides.agencyStatus ?? AgencyStatus.ACTIVE,
      superAgency: { status: overrides.superAgencyStatus ?? SuperAgencyStatus.ACTIVE },
    },
  };
}
