import {
  AutomationActionType,
  AutomationExecutionStatus,
  AutomationStepExecutionStatus,
  AutomationTriggerType,
  AutomationWorkflowNodeType,
} from '@prisma/client';
import { AutomationExecutionService } from './automation-execution.service';

describe('AutomationExecutionService', () => {
  it('does not create executions for historical trigger matches', async () => {
    const prisma = prismaForMatch({ runtimeEligibleAt: null });
    const service = new AutomationExecutionService(prisma as never, {} as never);

    await expect(service.createForTriggerMatch('match-1')).resolves.toBeNull();

    expect(prisma.automationExecution.create).not.toHaveBeenCalled();
  });

  it('creates one pending execution without pre-creating unselected path steps', async () => {
    const prisma = prismaForMatch({
      nodesDefinition: [
        triggerNode(),
        actionNode('action-1', AutomationActionType.CREATE_TASK),
        actionNode('action-2', AutomationActionType.CHANGE_TASK_STATUS),
      ],
      edgesDefinition: [
        { sourceNodeId: 'trigger', targetNodeId: 'action-1' },
        { sourceNodeId: 'action-1', targetNodeId: 'action-2' },
      ],
    });
    const service = new AutomationExecutionService(prisma as never, {} as never);

    await service.createForTriggerMatch('match-1');

    expect(prisma.automationExecution.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          triggerMatchId: 'match-1',
          status: AutomationExecutionStatus.PENDING_QUEUE,
          workflowVersionId: 'version-1',
        }),
      }),
    );
    expect(prisma.automationExecution.create.mock.calls[0][0].data).not.toHaveProperty('steps');
  });

  it('blocks unsupported runtime graphs without creating partial steps', async () => {
    const prisma = prismaForMatch({
      nodesDefinition: [
        triggerNode(),
        actionNode('action-1', AutomationActionType.CREATE_TASK),
        {
          nodeId: 'condition-1',
          type: AutomationWorkflowNodeType.CONDITION,
          config: {},
        },
      ],
      edgesDefinition: [
        { sourceNodeId: 'trigger', targetNodeId: 'action-1' },
        { sourceNodeId: 'action-1', targetNodeId: 'condition-1' },
      ],
    });
    const service = new AutomationExecutionService(prisma as never, {} as never);

    await service.createForTriggerMatch('match-1');

    expect(prisma.automationExecution.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: AutomationExecutionStatus.BLOCKED,
          failureCode: 'AUTOMATION_RUNTIME_UNSUPPORTED_GRAPH',
        }),
      }),
    );
  });

  it('blocks malformed reachable condition graphs before any action step is created', async () => {
    const prisma = prismaForMatch({
      nodesDefinition: [
        triggerNode(),
        actionNode('action-1', AutomationActionType.CREATE_TASK),
        {
          nodeId: 'condition-1',
          type: AutomationWorkflowNodeType.CONDITION,
          config: {
            left: '{{trigger.task.priority}}',
            operator: 'EQUALS',
            right: 'HIGH',
          },
        },
      ],
      edgesDefinition: [
        { fromNodeId: 'trigger', targetNodeId: 'action-1' },
        { fromNodeId: 'action-1', targetNodeId: 'condition-1' },
      ],
    });
    const service = new AutomationExecutionService(prisma as never, {} as never);

    await service.createForTriggerMatch('match-1');

    expect(prisma.automationExecution.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: AutomationExecutionStatus.BLOCKED,
          failureCode: 'AUTOMATION_RUNTIME_UNSUPPORTED_GRAPH',
        }),
      }),
    );
    expect(prisma.automationExecution.create.mock.calls[0][0].data).not.toHaveProperty('steps');
  });

  it('succeeds zero-action workflows with no invented step', async () => {
    const prisma = prismaForMatch({ nodesDefinition: [triggerNode()], edgesDefinition: [] });
    const service = new AutomationExecutionService(prisma as never, {} as never);

    await service.createForTriggerMatch('match-1');

    expect(prisma.automationExecution.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: AutomationExecutionStatus.SUCCEEDED,
          finishedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('dispatches pending executions with deterministic job ids and minimal payloads', async () => {
    const queue = { add: jest.fn().mockResolvedValue({}) };
    const prisma = {
      automationExecution: {
        findMany: jest.fn().mockResolvedValue([{ id: 'execution-1' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = new AutomationExecutionService(prisma as never, {} as never, queue as never);

    await service.dispatchPendingExecutions();

    expect(queue.add).toHaveBeenCalledWith(
      'automation.execution',
      { executionId: 'execution-1' },
      expect.objectContaining({ jobId: 'execution-1' }),
    );
    expect(Object.keys(queue.add.mock.calls[0][1])).toEqual(['executionId']);
    expect(prisma.automationExecution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: {
            in: [AutomationExecutionStatus.PENDING_QUEUE, AutomationExecutionStatus.QUEUED],
          },
        },
        take: 50,
      }),
    );
  });

  it('recovers an ambiguous running CREATE_TASK step from the invocation key without rerunning action', async () => {
    const actions = { executeAction: jest.fn() };
    const prisma = {
      $transaction: jest.fn(async (input: unknown) => {
        if (typeof input === 'function') {
          return input({
            $queryRaw: jest.fn().mockResolvedValue([{ id: 'execution-1' }]),
            automationExecution: {
              update: jest.fn().mockResolvedValue(executionRecord()),
            },
          });
        }
        return Promise.all(input as Array<Promise<unknown>>);
      }),
      automationStepExecution: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'step-1',
          nodeId: 'action-1',
          nodeType: AutomationWorkflowNodeType.ACTION,
          sequence: 1,
          actionType: AutomationActionType.CREATE_TASK,
          selectedBranchKey: null,
          conditionResult: null,
          status: AutomationStepExecutionStatus.RUNNING,
          invocationKey: 'automation-step:execution-1:action-1',
        }),
        aggregate: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
      task: {
        findFirst: jest.fn().mockResolvedValue({ id: 'task-1' }),
      },
      automationExecution: {
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = new AutomationExecutionService(prisma as never, actions as never);

    await service.processExecution('execution-1');

    expect(actions.executeAction).not.toHaveBeenCalled();
    expect(prisma.task.findFirst).toHaveBeenCalledWith({
      where: {
        workspaceId: 'workspace-1',
        automationInvocationKey: 'automation-step:execution-1:action-1',
        deletedAt: null,
      },
      select: { id: true },
    });
    expect(prisma.automationStepExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'step-1' },
        data: expect.objectContaining({
          status: AutomationStepExecutionStatus.SUCCEEDED,
          result: expect.objectContaining({
            entityId: 'task-1',
            recoveredFromInvocationKey: true,
          }),
        }),
      }),
    );
    expect(prisma.automationExecution.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'execution-1', status: AutomationExecutionStatus.RUNNING },
        data: expect.objectContaining({ status: AutomationExecutionStatus.SUCCEEDED }),
      }),
    );
  });

  it('persists a CONDITION decision and executes only the selected TRUE branch', async () => {
    const actions = {
      executeAction: jest.fn().mockResolvedValue({
        actionType: AutomationActionType.CREATE_TASK,
        status: 'SUCCEEDED',
        entityType: 'TASK',
        entityId: 'task-created',
        changed: true,
        generatedDomainEventIds: [],
      }),
    };
    const prisma = traversalPrisma(conditionExecutionRecord());
    const service = new AutomationExecutionService(prisma as never, actions as never);

    await service.processExecution('execution-1');

    expect(actions.executeAction).toHaveBeenCalledTimes(1);
    expect(actions.executeAction.mock.calls[0][1].actionNodeId).toBe('true-action');
    expect(prisma.automationStepExecution.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ nodeId: 'false-action' }) }),
    );
    expect(prisma.automationStepExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'step-condition' },
        data: expect.objectContaining({
          status: AutomationStepExecutionStatus.SUCCEEDED,
          conditionResult: true,
          selectedBranchKey: 'TRUE',
        }),
      }),
    );
  });
});

function executionRecord() {
  return {
    id: 'execution-1',
    workspaceId: 'workspace-1',
    triggerMatchId: 'match-1',
    domainEventId: 'event-1',
    workflowId: 'workflow-1',
    workflowVersionId: 'version-1',
    correlationId: 'correlation-1',
    automationDepth: 0,
    workflowVersion: {
      nodesDefinition: [triggerNode(), actionNode('action-1', AutomationActionType.CREATE_TASK)],
      edgesDefinition: [{ fromNodeId: 'trigger', toNodeId: 'action-1' }],
    },
    domainEvent: {
      id: 'event-1',
      eventType: AutomationTriggerType.TASK_CREATED,
      entityType: 'TASK',
      entityId: 'task-source-1',
      occurredAt: new Date('2026-01-01T00:00:00.000Z'),
      actorMembershipId: 'member-1',
      payload: { taskId: 'task-source-1', priority: 'HIGH' },
    },
  };
}

function conditionExecutionRecord() {
  return {
    ...executionRecord(),
    workflowVersion: {
      nodesDefinition: [
        triggerNode(),
        {
          nodeId: 'condition',
          type: AutomationWorkflowNodeType.CONDITION,
          config: {
            left: '{{trigger.task.priority}}',
            operator: 'EQUALS',
            right: 'HIGH',
          },
        },
        actionNode('true-action', AutomationActionType.CREATE_TASK),
        actionNode('false-action', AutomationActionType.CREATE_TASK),
      ],
      edgesDefinition: [
        { fromNodeId: 'trigger', toNodeId: 'condition' },
        { fromNodeId: 'condition', toNodeId: 'true-action', branchKey: 'TRUE' },
        { fromNodeId: 'condition', toNodeId: 'false-action', branchKey: 'FALSE' },
      ],
    },
  };
}

function traversalPrisma(record: Record<string, unknown>) {
  let sequence = 0;
  const txStepUpdate = jest.fn().mockResolvedValue({ id: 'claimed-step' });
  return {
    $transaction: jest.fn(async (input: unknown) => {
      if (typeof input === 'function') {
        return input({
          $queryRaw: jest.fn().mockResolvedValue([{ id: 'execution-1' }]),
          automationExecution: {
            update: jest.fn().mockResolvedValue(record),
          },
          automationStepExecution: {
            update: txStepUpdate,
          },
        });
      }
      return Promise.all(input as Array<Promise<unknown>>);
    }),
    automationStepExecution: {
      findUnique: jest.fn().mockResolvedValue(null),
      aggregate: jest.fn(() => Promise.resolve({ _max: { sequence } })),
      create: jest.fn(
        ({ data }: { data: { nodeId: string; nodeType: AutomationWorkflowNodeType } }) => {
          sequence += 1;
          return Promise.resolve({
            id: `step-${data.nodeId}`,
            nodeId: data.nodeId,
            nodeType: data.nodeType,
            sequence,
            actionType:
              data.nodeType === AutomationWorkflowNodeType.ACTION
                ? AutomationActionType.CREATE_TASK
                : null,
            selectedBranchKey: null,
            conditionResult: null,
            status: AutomationStepExecutionStatus.PENDING,
            invocationKey: `automation-step:execution-1:${data.nodeId}`,
          });
        },
      ),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
    },
    automationExecution: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue({ attemptCount: 1, maxAttempts: 3 }),
    },
    task: { findFirst: jest.fn() },
  };
}

function prismaForMatch(
  overrides: {
    runtimeEligibleAt?: Date | null;
    nodesDefinition?: unknown[];
    edgesDefinition?: unknown[];
    automationDepth?: number;
  } = {},
) {
  const match = {
    id: 'match-1',
    workspaceId: 'workspace-1',
    domainEventId: 'event-1',
    workflowId: 'workflow-1',
    workflowVersionId: 'version-1',
    runtimeEligibleAt:
      overrides.runtimeEligibleAt === undefined ? new Date() : overrides.runtimeEligibleAt,
    domainEvent: {
      id: 'event-1',
      workspaceId: 'workspace-1',
      correlationId: 'correlation-1',
      automationDepth: overrides.automationDepth ?? 0,
    },
    workflowVersion: {
      id: 'version-1',
      workspaceId: 'workspace-1',
      nodesDefinition: overrides.nodesDefinition ?? [triggerNode()],
      edgesDefinition: overrides.edgesDefinition ?? [],
    },
  };
  return {
    automationTriggerMatch: { findUnique: jest.fn().mockResolvedValue(match) },
    automationExecution: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'execution-1' }),
    },
  };
}

function triggerNode() {
  return {
    nodeId: 'trigger',
    type: AutomationWorkflowNodeType.TRIGGER,
    config: { triggerType: AutomationTriggerType.TASK_CREATED },
  };
}

function actionNode(nodeId: string, actionType: AutomationActionType) {
  if (actionType === AutomationActionType.CREATE_TASK) {
    return {
      nodeId,
      type: AutomationWorkflowNodeType.ACTION,
      config: { actionType, title: 'Task title' },
    };
  }
  return {
    nodeId,
    type: AutomationWorkflowNodeType.ACTION,
    config: {
      actionType,
      taskId: '11111111-1111-4111-8111-111111111111',
      statusDefinitionId: '22222222-2222-4222-8222-222222222222',
    },
  };
}
