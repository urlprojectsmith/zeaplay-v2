import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AutomationActionType, AutomationDomainEventEntityType } from '@prisma/client';
import { AutomationActionService } from './automation-action.service';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const otherWorkspaceId = '22222222-2222-4222-8222-222222222222';
const taskId = '33333333-3333-4333-8333-333333333333';
const statusId = '44444444-4444-4444-8444-444444444444';
const memberId = '66666666-6666-4666-8666-666666666666';
const tagId = '77777777-7777-4777-8777-777777777777';

describe('AutomationActionService', () => {
  const tenant = {
    agencyId: 'agency',
    agencyMembershipId: 'agency-member',
    workspaceId,
    userId: 'user',
    workspaceMembershipId: memberId,
    roleId: 'role',
    roleName: 'Owner',
    accessSource: 'WORKSPACE_MEMBERSHIP' as const,
    permissions: ['*'],
  };

  const context = {
    workspaceId,
    actionNodeId: 'action-1',
    mutation: {
      workflowId: 'workflow-1',
      workflowVersionId: 'version-1',
      triggerDomainEventId: '88888888-8888-4888-8888-888888888888',
      correlationId: 'corr-1',
      parentAutomationDepth: 0,
    },
  };

  it('delegates CREATE_TASK to the task domain service and returns a safe result', async () => {
    const prisma = prismaMock();
    const tasks = { create: jest.fn().mockResolvedValue({ id: taskId }) };
    const service = new AutomationActionService(prisma as never, tasks as never);

    const result = await service.executeAction(tenant, context, {
      actionType: AutomationActionType.CREATE_TASK,
      title: 'Follow up',
      assigneeMembershipIds: [memberId],
    });

    expect(tasks.create).toHaveBeenCalledWith(
      tenant,
      { title: 'Follow up', assigneeMembershipIds: [memberId] },
      expect.objectContaining({ correlationId: 'corr-1', actionNodeId: 'action-1' }),
    );
    expect(result).toEqual({
      actionType: AutomationActionType.CREATE_TASK,
      status: 'SUCCEEDED',
      entityType: AutomationDomainEventEntityType.TASK,
      entityId: taskId,
      changed: true,
      generatedDomainEventIds: [],
    });
  });

  it('returns NO_OP without calling task status update when status is unchanged', async () => {
    const prisma = prismaMock({
      task: {
        findFirst: jest.fn().mockResolvedValue({ id: taskId, statusDefinitionId: statusId }),
      },
    });
    const tasks = { updateStatus: jest.fn() };
    const service = new AutomationActionService(prisma as never, tasks as never);

    const result = await service.executeAction(tenant, context, {
      actionType: AutomationActionType.CHANGE_TASK_STATUS,
      taskId,
      statusDefinitionId: statusId,
    });

    expect(tasks.updateStatus).not.toHaveBeenCalled();
    expect(result.status).toBe('NO_OP');
    expect(result.changed).toBe(false);
  });

  it('delegates CHANGE_TASK_STATUS to the canonical task transition path', async () => {
    const prisma = prismaMock({
      task: {
        findFirst: jest.fn().mockResolvedValue({ id: taskId, statusDefinitionId: statusId }),
      },
    });
    const tasks = { updateStatus: jest.fn().mockResolvedValue({ id: taskId }) };
    const service = new AutomationActionService(prisma as never, tasks as never);

    const result = await service.executeAction(tenant, context, {
      actionType: AutomationActionType.CHANGE_TASK_STATUS,
      taskId,
      statusDefinitionId: '55555555-5555-4555-8555-555555555555',
    });

    expect(tasks.updateStatus).toHaveBeenCalledWith(
      tenant,
      taskId,
      '55555555-5555-4555-8555-555555555555',
      undefined,
      undefined,
      expect.objectContaining({ correlationId: 'corr-1' }),
    );
    expect(result.status).toBe('SUCCEEDED');
  });

  it('delegates ASSIGN_TASK only when assignment membership set changes', async () => {
    const prisma = prismaMock({
      task: {
        findFirst: jest.fn().mockResolvedValue({ id: taskId, statusDefinitionId: statusId }),
      },
      taskAssignee: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    });
    const tasks = { replaceAssignees: jest.fn().mockResolvedValue({ id: taskId }) };
    const service = new AutomationActionService(prisma as never, tasks as never);

    const result = await service.executeAction(tenant, context, {
      actionType: AutomationActionType.ASSIGN_TASK,
      taskId,
      membershipIds: [memberId],
    });

    expect(tasks.replaceAssignees).toHaveBeenCalledWith(
      tenant,
      taskId,
      { membershipIds: [memberId] },
      expect.objectContaining({ triggerDomainEventId: context.mutation.triggerDomainEventId }),
    );
    expect(result.status).toBe('SUCCEEDED');
  });

  it('returns NO_OP for duplicate task tags before calling the task tag domain method', async () => {
    const prisma = prismaMock({
      task: {
        findFirst: jest.fn().mockResolvedValue({ id: taskId, statusDefinitionId: statusId }),
      },
      taskTag: {
        count: jest.fn().mockResolvedValue(1),
      },
    });
    const tasks = { addTaskTags: jest.fn() };
    const service = new AutomationActionService(prisma as never, tasks as never);

    const result = await service.executeAction(tenant, context, {
      actionType: AutomationActionType.ADD_TASK_TAG,
      taskId,
      tagIds: [tagId],
    });

    expect(tasks.addTaskTags).not.toHaveBeenCalled();
    expect(result.status).toBe('NO_OP');
  });

  it('rejects foreign or missing task targets before domain mutation', async () => {
    const prisma = prismaMock({
      task: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    });
    const tasks = { update: jest.fn() };
    const service = new AutomationActionService(prisma as never, tasks as never);

    await expect(
      service.executeAction(tenant, context, {
        actionType: AutomationActionType.UPDATE_TASK,
        taskId,
        title: 'Changed',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(tasks.update).not.toHaveBeenCalled();
  });

  it('rejects unresolved template variables at execution time', async () => {
    const service = new AutomationActionService(prismaMock() as never, {} as never);

    await expect(
      service.executeAction(tenant, context, {
        actionType: AutomationActionType.CREATE_TASK,
        title: '{{trigger.title}}',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects workspace mismatches before action execution', async () => {
    const service = new AutomationActionService(prismaMock() as never, {} as never);

    await expect(
      service.executeAction(
        tenant,
        { ...context, workspaceId: otherWorkspaceId },
        { actionType: AutomationActionType.CREATE_TASK, title: 'Follow up' },
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects ADD_TICKET_TAG as unavailable until a canonical ticket tag service exists', async () => {
    const service = new AutomationActionService(prismaMock() as never);

    await expectNotAvailable(
      service.executeAction(tenant, context, {
        actionType: AutomationActionType.ADD_TICKET_TAG,
        ticketId: taskId,
        tagIds: [tagId],
      }),
    );
  });
});

function prismaMock(overrides: Record<string, unknown> = {}) {
  return {
    task: { findFirst: jest.fn().mockResolvedValue({ id: taskId, statusDefinitionId: statusId }) },
    taskAssignee: { findMany: jest.fn().mockResolvedValue([{ membershipId: memberId }]) },
    taskTag: { count: jest.fn().mockResolvedValue(1) },
    project: { findFirst: jest.fn() },
    ticket: { findFirst: jest.fn() },
    ...overrides,
  };
}

async function expectNotAvailable(promise: Promise<unknown>) {
  try {
    await promise;
    throw new Error('Expected action to be unavailable.');
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({
      code: 'AUTOMATION_ACTION_NOT_AVAILABLE',
    });
  }
}
