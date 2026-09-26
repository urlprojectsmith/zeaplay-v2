import {
  AutomationDomainEventEntityType,
  AutomationTriggerType,
  GoalMetricType,
  GoalOwnerType,
  GoalPeriodType,
  GoalProgressSourceType,
  GoalStatus,
} from '@prisma/client';
import type { WorkspaceTenantContext } from '../../common/auth/auth.types';
import { GoalsService } from './goals.service';

describe('GoalsService focused invariants', () => {
  it('applies a manual progress idempotency key once and emits completion through the transaction', async () => {
    const goal = goalRecord({ currentProgress: 0, targetValue: 3 });
    const completed = goalRecord({
      currentProgress: 3,
      targetValue: 3,
      status: GoalStatus.COMPLETED,
    });
    let existingEvent: { goal: typeof completed } | null = null;
    const tx = {
      $queryRaw: jest.fn(),
      goalProgressEvent: {
        findFirst: jest.fn(() => Promise.resolve(existingEvent)),
        create: jest.fn(() => {
          existingEvent = { goal: completed };
          return Promise.resolve();
        }),
      },
      goal: {
        findFirst: jest.fn(() => Promise.resolve(goal)),
        update: jest.fn(() => Promise.resolve(completed)),
      },
    };
    const automation = {
      recordDomainEventInTransaction: jest.fn(() => Promise.resolve({ id: 'domain-event-1' })),
      evaluateDomainEvent: jest.fn(),
    };
    const service = new GoalsService(
      {
        $transaction: (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
      } as never,
      { record: jest.fn() } as never,
      automation as never,
    );

    await service.recordManualProgress(tenant(), goal.id, {
      delta: 3,
      idempotencyKey: 'manual-once',
    });
    await service.recordManualProgress(tenant(), goal.id, {
      delta: 3,
      idempotencyKey: 'manual-once',
    });

    expect(tx.goal.update).toHaveBeenCalledTimes(1);
    expect(tx.goalProgressEvent.create).toHaveBeenCalledTimes(1);
    expect(automation.recordDomainEventInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        eventType: AutomationTriggerType.GOAL_COMPLETED,
        entityType: AutomationDomainEventEntityType.GOAL,
        idempotencyKey: `goal-completed:${goal.id}`,
      }),
    );
    expect(automation.evaluateDomainEvent).toHaveBeenCalledTimes(1);
  });

  it('rejects manual progress before the authoritative period starts', async () => {
    const futureGoal = goalRecord({
      metricType: GoalMetricType.MANUAL_NUMERIC,
      periodStart: new Date(Date.now() + 60_000),
      periodEnd: new Date(Date.now() + 120_000),
    });
    const tx = {
      $queryRaw: jest.fn(),
      goalProgressEvent: {
        findFirst: jest.fn(() => Promise.resolve(null)),
        create: jest.fn(),
      },
      goal: {
        findFirst: jest.fn(() => Promise.resolve(futureGoal)),
        update: jest.fn(),
      },
    };
    const service = new GoalsService(
      {
        $transaction: (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
      } as never,
      { record: jest.fn() } as never,
      { recordDomainEventInTransaction: jest.fn(), evaluateDomainEvent: jest.fn() } as never,
    );

    await expect(
      service.recordManualProgress(tenant(), futureGoal.id, { delta: 1, idempotencyKey: 'future' }),
    ).rejects.toThrow('GOAL_PERIOD_NOT_STARTED');
    expect(tx.goal.update).not.toHaveBeenCalled();
    expect(tx.goalProgressEvent.create).not.toHaveBeenCalled();
  });

  it('requires active same-workspace departments for new department goals', async () => {
    const prisma = {
      workspace: {
        findFirst: jest.fn(() => Promise.resolve({ id: 'workspace-1', timezone: 'UTC' })),
      },
      department: { findFirst: jest.fn(() => Promise.resolve(null)) },
    };
    const service = new GoalsService(
      prisma as never,
      { record: jest.fn() } as never,
      { recordDomainEventInTransaction: jest.fn(), evaluateDomainEvent: jest.fn() } as never,
    );

    await expect(
      service.createGoal(tenant(), {
        title: 'Department goal',
        ownerType: GoalOwnerType.DEPARTMENT,
        departmentId: '00000000-0000-4000-8000-000000000010',
        metricType: GoalMetricType.TASKS_COMPLETED,
        periodType: GoalPeriodType.MONTHLY,
        targetValue: 1,
      }),
    ).rejects.toThrow('GOAL_OWNER_NOT_FOUND');
    expect(prisma.department.findFirst).toHaveBeenCalledWith({
      where: {
        id: '00000000-0000-4000-8000-000000000010',
        workspaceId: 'workspace-1',
        status: 'ACTIVE',
      },
      select: { id: true },
    });
  });

  it('keeps manual progress restricted to MANUAL_NUMERIC', async () => {
    const automaticGoal = goalRecord({ metricType: GoalMetricType.TASKS_COMPLETED });
    const tx = {
      $queryRaw: jest.fn(),
      goalProgressEvent: {
        findFirst: jest.fn(() => Promise.resolve(null)),
        create: jest.fn(),
      },
      goal: {
        findFirst: jest.fn(() => Promise.resolve(automaticGoal)),
        update: jest.fn(),
      },
    };
    const service = new GoalsService(
      {
        $transaction: (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
      } as never,
      { record: jest.fn() } as never,
      { recordDomainEventInTransaction: jest.fn(), evaluateDomainEvent: jest.fn() } as never,
    );

    await expect(
      service.recordManualProgress(tenant(), automaticGoal.id, {
        delta: 1,
        idempotencyKey: 'manual',
      }),
    ).rejects.toThrow('GOAL_METRIC_PROGRESS_SOURCE_MISMATCH');
    expect(tx.goal.update).not.toHaveBeenCalled();
  });
});

function tenant(): WorkspaceTenantContext {
  return {
    userId: 'user-1',
    agencyId: 'agency-1',
    workspaceId: 'workspace-1',
    workspaceMembershipId: 'membership-1',
    agencyMembershipId: null,
    roleId: 'role-1',
    roleName: 'Owner',
    permissions: ['goals.progress.update'],
    accessSource: 'WORKSPACE_MEMBERSHIP',
  };
}

function goalRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    workspaceId: 'workspace-1',
    ownerType: GoalOwnerType.WORKSPACE,
    ownerMembershipId: null,
    departmentId: null,
    metricType: GoalMetricType.MANUAL_NUMERIC,
    periodType: GoalPeriodType.MONTHLY,
    title: 'Goal',
    description: null,
    targetValue: 10,
    currentProgress: 0,
    status: GoalStatus.ACTIVE,
    periodStart: new Date(Date.now() - 60_000),
    periodEnd: new Date(Date.now() + 60_000),
    completedAt: null,
    expiredAt: null,
    archivedAt: null,
    createdByMembershipId: 'membership-1',
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    progressEvents: [],
    percentComplete: 0,
    sourceType: GoalProgressSourceType.MANUAL,
    ...overrides,
  };
}
