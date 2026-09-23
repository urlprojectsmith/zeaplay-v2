import {
  AutomationActionType,
  AutomationExecutionStatus,
  AutomationStepExecutionStatus,
  AutomationTriggerType,
  AutomationWorkflowNodeType,
} from '@prisma/client';
import type { WorkspaceTenantContext } from '../../common/auth/auth.types';
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

  it('checks dispatch concurrency with the current pending execution excluded', async () => {
    const queue = { add: jest.fn().mockResolvedValue({}) };
    const tx = {};
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
      automationExecution: {
        findMany: jest.fn().mockResolvedValue([{ id: 'execution-1', workspaceId: 'workspace-1' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const policy = {
      withWorkspaceQuotaLock: jest.fn((_workspaceId, _tx, _suffix, callback) => callback()),
      assertConcurrentExecutionLimit: jest.fn().mockResolvedValue(undefined),
    };
    const service = new AutomationExecutionService(
      prisma as never,
      {} as never,
      queue as never,
      policy as never,
    );

    await service.dispatchPendingExecutions();

    expect(policy.assertConcurrentExecutionLimit).toHaveBeenCalledWith(
      'workspace-1',
      tx,
      'execution-1',
    );
    expect(queue.add).toHaveBeenCalledTimes(1);
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

  it('replays a failed execution by creating a new pending execution from stored context', async () => {
    const tx = replayTx(AutomationExecutionStatus.FAILED);
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
      automationExecution: {
        findFirst: jest.fn().mockResolvedValue(replayDetail('replay-1')),
      },
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new AutomationExecutionService(
      prisma as never,
      {} as never,
      undefined,
      undefined,
      audit as never,
    );

    await service.replayExecution(tenantContext(), 'execution-1', {
      reason: 'Operator approved replay',
      confirmation: 'REPLAY',
      idempotencyKey: 'replay-key-1',
    });

    expect(tx.automationExecution.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          triggerMatchId: 'match-1',
          domainEventId: 'event-1',
          workflowVersionId: 'version-1',
          replayOfExecutionId: 'execution-1',
          replayReason: 'Operator approved replay',
          replayIdempotencyKey: 'replay-key-1',
        }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'automation.execution_replayed',
        entityId: 'replay-1',
      }),
    );
    expect(tx).not.toHaveProperty('automationStepExecution');
  });

  it('returns an existing replay for the same idempotency key and payload without duplicate audit', async () => {
    const tx = replayTx(AutomationExecutionStatus.FAILED, {
      idempotent: {
        id: 'replay-1',
        replayOfExecutionId: 'execution-1',
        replayReason: 'Operator approved replay',
      },
    });
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
      automationExecution: {
        findFirst: jest.fn().mockResolvedValue(replayDetail('replay-1')),
      },
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new AutomationExecutionService(
      prisma as never,
      {} as never,
      undefined,
      undefined,
      audit as never,
    );

    await service.replayExecution(tenantContext(), 'execution-1', {
      reason: 'Operator approved replay',
      confirmation: 'REPLAY',
      idempotencyKey: 'replay-key-1',
    });

    expect(tx.automationExecution.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('rejects replay for succeeded executions', async () => {
    const tx = replayTx(AutomationExecutionStatus.SUCCEEDED);
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };
    const service = new AutomationExecutionService(prisma as never, {} as never);

    await expect(
      service.replayExecution(tenantContext(), 'execution-1', {
        reason: 'No replay',
        confirmation: 'REPLAY',
        idempotencyKey: 'replay-key-1',
      }),
    ).rejects.toThrow('AUTOMATION_REPLAY_NOT_ALLOWED');
    expect(tx.automationExecution.create).not.toHaveBeenCalled();
  });

  it('rejects conflicting replay idempotency keys', async () => {
    const tx = replayTx(AutomationExecutionStatus.FAILED, {
      idempotent: {
        id: 'replay-1',
        replayOfExecutionId: 'other-execution',
        replayReason: 'Different payload',
      },
    });
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };
    const service = new AutomationExecutionService(prisma as never, {} as never);

    await expect(
      service.replayExecution(tenantContext(), 'execution-1', {
        reason: 'Operator approved replay',
        confirmation: 'REPLAY',
        idempotencyKey: 'replay-key-1',
      }),
    ).rejects.toThrow('AUTOMATION_REPLAY_IDEMPOTENCY_CONFLICT');
    expect(tx.automationExecution.create).not.toHaveBeenCalled();
  });

  it('lists executions with workspace, pagination, date, status, event, entity, and correlation filters', async () => {
    const prisma = {
      $transaction: jest.fn(async (queries: Array<Promise<unknown>>) => Promise.all(queries)),
      automationExecution: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new AutomationExecutionService(prisma as never, {} as never);

    await service.listExecutions(tenantContext(), {
      page: 2,
      pageSize: 10,
      sortDirection: 'asc',
      sortBy: 'createdAt',
      status: AutomationExecutionStatus.DEAD_LETTERED,
      workflowId: '11111111-1111-4111-8111-111111111111',
      eventType: AutomationTriggerType.TASK_CREATED,
      entityType: 'TASK' as never,
      correlationId: 'correlation-1',
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-01-02T00:00:00.000Z',
    });

    expect(prisma.automationExecution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: 'workspace-1',
          status: AutomationExecutionStatus.DEAD_LETTERED,
          workflowId: '11111111-1111-4111-8111-111111111111',
          correlationId: 'correlation-1',
          domainEvent: expect.objectContaining({
            eventType: AutomationTriggerType.TASK_CREATED,
            entityType: 'TASK',
          }),
        }),
        skip: 10,
        take: 10,
      }),
    );
    expect(prisma.automationExecution.findMany.mock.calls[0][0].where.createdAt).toEqual({
      gte: new Date('2026-01-01T00:00:00.000Z'),
      lte: new Date('2026-01-02T00:00:00.000Z'),
    });
  });

  it('bounds execution monitoring queries to a finite date window', async () => {
    const prisma = {
      $transaction: jest.fn(async (queries: Array<Promise<unknown>>) => Promise.all(queries)),
      automationExecution: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new AutomationExecutionService(prisma as never, {} as never);

    await service.listExecutions(tenantContext(), {
      page: 1,
      pageSize: 20,
      sortDirection: 'desc',
      sortBy: 'createdAt',
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-06-01T00:00:00.000Z',
    });

    expect(prisma.automationExecution.findMany.mock.calls[0][0].where.createdAt).toEqual({
      gte: new Date('2026-01-01T00:00:00.000Z'),
      lte: new Date('2026-02-01T00:00:00.000Z'),
    });
  });

  it('rejects execution monitoring ranges where to is before from', async () => {
    const prisma = {
      $transaction: jest.fn(),
      automationExecution: {
        count: jest.fn(),
        findMany: jest.fn(),
      },
    };
    const service = new AutomationExecutionService(prisma as never, {} as never);

    await expect(
      service.listExecutions(tenantContext(), {
        page: 1,
        pageSize: 20,
        sortDirection: 'desc',
        sortBy: 'createdAt',
        from: '2026-02-01T00:00:00.000Z',
        to: '2026-01-01T00:00:00.000Z',
      }),
    ).rejects.toThrow('AUTOMATION_MONITORING_DATE_RANGE_INVALID');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

function tenantContext(): WorkspaceTenantContext {
  return {
    agencyId: 'agency-1',
    workspaceId: 'workspace-1',
    workspaceMembershipId: 'member-1',
    agencyMembershipId: null,
    roleId: 'role-1',
    roleName: 'ADMIN',
    permissions: [],
    accessSource: 'WORKSPACE_MEMBERSHIP',
    userId: 'user-1',
  };
}

function replayTx(
  status: AutomationExecutionStatus,
  options: {
    idempotent?: { id: string; replayOfExecutionId: string | null; replayReason: string | null };
  } = {},
) {
  return {
    automationExecution: {
      findFirst: jest
        .fn()
        .mockResolvedValueOnce(options.idempotent ?? null)
        .mockResolvedValueOnce({
          id: 'execution-1',
          workspaceId: 'workspace-1',
          triggerMatchId: 'match-1',
          domainEventId: 'event-1',
          workflowId: 'workflow-1',
          workflowVersionId: 'version-1',
          status,
          correlationId: 'correlation-1',
          automationDepth: 0,
          workflowVersion: {
            id: 'version-1',
            nodesDefinition: [
              triggerNode(),
              actionNode('action-1', AutomationActionType.CREATE_TASK),
            ],
            edgesDefinition: [{ fromNodeId: 'trigger', toNodeId: 'action-1' }],
          },
        }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: 'replay-1',
        workflowId: 'workflow-1',
        workflowVersionId: 'version-1',
      }),
      create: jest.fn().mockResolvedValue({
        id: 'replay-1',
        workflowId: 'workflow-1',
        workflowVersionId: 'version-1',
      }),
    },
  };
}

function replayDetail(id: string) {
  return {
    id,
    shortRef: id,
    workspaceId: 'workspace-1',
    triggerMatchId: 'match-1',
    domainEventId: 'event-1',
    workflowId: 'workflow-1',
    workflowName: 'Workflow',
    workflowVersionId: 'version-1',
    triggerEvent: AutomationTriggerType.TASK_CREATED,
    entityType: 'TASK',
    entityId: 'task-1',
    status: AutomationExecutionStatus.PENDING_QUEUE,
    correlationId: 'correlation-1',
    automationDepth: 0,
    attemptCount: 0,
    maxAttempts: 3,
    failureCode: null,
    failureMessage: null,
    replayOfExecutionId: 'execution-1',
    replayReason: 'Operator approved replay',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    queuedAt: null,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    workflow: { id: 'workflow-1', name: 'Workflow' },
    workflowVersion: { versionNumber: 1 },
    domainEvent: {
      id: 'event-1',
      eventType: AutomationTriggerType.TASK_CREATED,
      entityType: 'TASK',
      entityId: 'task-1',
      occurredAt: new Date('2026-01-01T00:00:00.000Z'),
    },
    triggerMatch: {
      id: 'match-1',
      triggerNodeId: 'trigger',
      status: 'MATCHED',
      reasonCode: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    },
    steps: [],
  };
}

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
      findFirst: jest.fn().mockResolvedValue(null),
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
