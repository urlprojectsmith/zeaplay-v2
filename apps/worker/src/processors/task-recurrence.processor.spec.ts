import { TaskRecurrenceProcessor } from './task-recurrence.processor';

describe('TaskRecurrenceProcessor', () => {
  const activeHierarchy = {
    effectiveWorkspaceStatus: jest.fn().mockResolvedValue({
      operational: true,
      workspaceId: 'workspace-1',
      agencyId: 'agency-1',
      superAgencyId: 'super-agency-1',
    }),
  };

  it('does not generate when another worker already holds the recurrence row lock', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      taskRecurrenceSeries: {
        findFirst: jest.fn(),
      },
      task: {
        create: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<number>) =>
        callback(tx),
      ),
    };
    const processor = new TaskRecurrenceProcessor(prisma as never, activeHierarchy as never);

    await expect(processor.processSeries('00000000-0000-4000-8000-000000000001')).resolves.toBe(0);

    expect(tx.taskRecurrenceSeries.findFirst).not.toHaveBeenCalled();
    expect(tx.task.create).not.toHaveBeenCalled();
  });

  it('snapshots recurrence completion policy blueprint onto generated occurrences', async () => {
    const due = new Date('2026-09-18T04:00:00.000Z');
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'series-1' }]),
      statusDefinition: { findFirstOrThrow: jest.fn().mockResolvedValue({ id: 'status-1' }) },
      task: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'task-2' }),
      },
      taskAssignee: { createMany: jest.fn() },
      taskFollower: { createMany: jest.fn() },
      taskProject: { createMany: jest.fn() },
      taskTag: { createMany: jest.fn() },
      taskCompletionPolicy: { create: jest.fn().mockResolvedValue({ id: 'policy-1' }) },
      taskCompletionPolicyApprover: { createMany: jest.fn() },
      taskRecurrenceSeries: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'series-1',
          workspaceId: 'workspace-1',
          title: 'Recurring proof task',
          description: null,
          priority: 'MEDIUM',
          statusDefinitionId: 'status-1',
          departmentId: null,
          timezone: 'UTC',
          frequency: 'DAILY',
          interval: 1,
          customIntervalUnit: null,
          startLocalDate: new Date('2026-09-18T00:00:00.000Z'),
          localTime: '04:00',
          selectedWeekdays: [],
          monthlyDay: null,
          endMode: 'NEVER',
          untilLocalDate: null,
          maxOccurrences: null,
          completionProofRequirementMode: 'SPECIFIC',
          completionRequiredProofTypes: ['TEXT', 'ATTACHMENT'],
          completionApprovalRequired: true,
          completionApproverMode: 'ALL_REQUIRED',
          completionIncludeTaskCreator: false,
          completionIncludePermissionApprovers: false,
          completionIncludeProjectOwnersManagers: false,
          generatedCount: 1,
          nextOccurrenceAt: due,
          lastGeneratedAt: null,
          createdById: 'user-1',
          statusDefinition: { isActive: true, isTerminal: false, entityType: 'TASK' },
          department: null,
          assignees: [],
          followers: [],
          projects: [],
          tags: [],
          completionApprovers: [{ membershipId: 'membership-1', membership: { status: 'ACTIVE' } }],
        }),
        update: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<number>) =>
        callback(tx),
      ),
    };
    const processor = new TaskRecurrenceProcessor(prisma as never, activeHierarchy as never);

    await expect(processor.processSeries('series-1', due)).resolves.toBe(1);

    expect(tx.taskCompletionPolicy.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          taskId: 'task-2',
          proofRequirementMode: 'SPECIFIC',
          requiredProofTypes: ['TEXT', 'ATTACHMENT'],
          approvalRequired: true,
          approverMode: 'ALL_REQUIRED',
        }),
      }),
    );
    expect(tx.taskCompletionPolicyApprover.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          {
            workspaceId: 'workspace-1',
            policyId: 'policy-1',
            membershipId: 'membership-1',
          },
        ],
      }),
    );
  });

  it('blocks recurrence business mutation when effective hierarchy is suspended', async () => {
    const due = new Date('2026-09-18T04:00:00.000Z');
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'series-1' }]),
      statusDefinition: { findFirstOrThrow: jest.fn() },
      task: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      taskRecurrenceSeries: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'series-1',
          workspaceId: 'workspace-1',
          title: 'Recurring task',
          description: null,
          priority: 'MEDIUM',
          statusDefinitionId: 'status-1',
          departmentId: null,
          timezone: 'UTC',
          frequency: 'DAILY',
          interval: 1,
          customIntervalUnit: null,
          startLocalDate: new Date('2026-09-18T00:00:00.000Z'),
          localTime: '04:00',
          selectedWeekdays: [],
          monthlyDay: null,
          endMode: 'NEVER',
          untilLocalDate: null,
          maxOccurrences: null,
          completionProofRequirementMode: 'NONE',
          completionRequiredProofTypes: [],
          completionApprovalRequired: false,
          completionApproverMode: 'ANY',
          completionIncludeTaskCreator: false,
          completionIncludePermissionApprovers: false,
          completionIncludeProjectOwnersManagers: false,
          generatedCount: 0,
          nextOccurrenceAt: due,
          lastGeneratedAt: null,
          createdById: 'user-1',
          statusDefinition: { isActive: true, isTerminal: false, entityType: 'TASK' },
          department: null,
          assignees: [],
          followers: [],
          projects: [],
          tags: [],
          completionApprovers: [],
        }),
        update: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<number>) =>
        callback(tx),
      ),
    };
    const hierarchy = {
      effectiveWorkspaceStatus: jest.fn().mockResolvedValue({
        operational: false,
        code: 'TENANT_SUSPENDED',
        message: 'Super Agency is suspended.',
      }),
    };
    const processor = new TaskRecurrenceProcessor(prisma as never, hierarchy as never);

    await expect(processor.processSeries('series-1', due)).resolves.toBe(0);

    expect(hierarchy.effectiveWorkspaceStatus).toHaveBeenCalledWith('workspace-1', tx);
    expect(tx.task.create).not.toHaveBeenCalled();
    expect(tx.statusDefinition.findFirstOrThrow).not.toHaveBeenCalled();
    expect(tx.taskRecurrenceSeries.update).toHaveBeenCalledWith({
      where: { id: 'series-1' },
      data: { status: 'ERROR', lastErrorCode: 'TENANT_SUSPENDED' },
    });
  });
});
