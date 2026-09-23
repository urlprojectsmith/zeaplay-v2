import {
  AutomationDomainEventEntityType,
  AutomationTriggerType,
  TaskPriority,
} from '@prisma/client';
import { ProjectsService } from '../projects/projects.service';
import { TasksService } from '../tasks/tasks.service';
import { TicketsService } from '../tickets/tickets.service';

const tenant = {
  userId: '00000000-0000-4000-8000-000000000001',
  agencyId: '00000000-0000-4000-8000-000000000002',
  workspaceId: '00000000-0000-4000-8000-000000000003',
  workspaceMembershipId: '00000000-0000-4000-8000-000000000004',
  agencyMembershipId: null,
  roleId: '00000000-0000-4000-8000-000000000005',
  roleName: 'OWNER',
  permissions: ['*'],
  accessSource: 'WORKSPACE_MEMBERSHIP' as const,
};

describe('Phase 11.2 lifecycle domain-event semantics', () => {
  it('records Task status and completion as distinct facts, with reopen status only and recompletion as a new cycle', async () => {
    const automationEvents = automationEventsMock();
    const service = new TasksService(
      {} as never,
      { record: jest.fn() } as never,
      {} as never,
      {} as never,
      undefined,
      automationEvents as never,
    );
    const record = privateRecorder(service, 'recordTaskStatusAutomationEvents');
    const tx = txMock({
      [AutomationTriggerType.TASK_STATUS_CHANGED]: 0,
      [AutomationTriggerType.TASK_COMPLETED]: 0,
    });

    const first = await record(tx, tenant, taskState('todo', false), taskState('done', true), true);
    const same = await record(tx, tenant, taskState('done', true), taskState('done', true), true);
    const reopen = await record(
      tx,
      tenant,
      taskState('done', true),
      taskState('todo', false),
      false,
    );
    tx.automationDomainEvent.count.mockImplementation(
      ({ where }: { where: { eventType: string } }) =>
        Promise.resolve(where.eventType === AutomationTriggerType.TASK_COMPLETED ? 1 : 2),
    );
    const recomplete = await record(
      tx,
      tenant,
      taskState('todo', false),
      taskState('done', true),
      true,
    );

    expect(first).toEqual(['task:task-1:status:1', 'task:task-1:completion:1']);
    expect(same).toEqual([]);
    expect(reopen).toEqual(['task:task-1:status:1']);
    expect(recomplete).toEqual(['task:task-1:status:3', 'task:task-1:completion:2']);
    expect(automationEvents.recordDomainEventInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        eventType: AutomationTriggerType.TASK_COMPLETED,
        entityType: AutomationDomainEventEntityType.TASK,
        correlationId: 'task:task-1:status:1',
        idempotencyKey: 'task:task-1:completion:1',
        payload: expect.objectContaining({
          completionCycle: 1,
          assigneeMembershipIds: ['assignee-1'],
        }),
      }),
    );
  });

  it('records Project completion with an immutable xpCategory snapshot and suppresses same-status writes', async () => {
    const automationEvents = automationEventsMock();
    const service = new ProjectsService(
      {} as never,
      { record: jest.fn() } as never,
      {} as never,
      {} as never,
      undefined,
      automationEvents as never,
    );
    const record = privateRecorder(service, 'recordProjectStatusAutomationEvents');
    const tx = txMock({
      [AutomationTriggerType.PROJECT_STATUS_CHANGED]: 0,
      [AutomationTriggerType.PROJECT_COMPLETED]: 0,
    });

    const eventIds = await record(
      tx,
      tenant,
      projectState('open', false, 'CLIENT'),
      projectState('done', true, 'CLIENT'),
      true,
    );
    const same = await record(
      tx,
      tenant,
      projectState('done', true, 'CLIENT'),
      projectState('done', true, 'INTERNAL'),
      true,
    );

    expect(eventIds).toEqual(['project:project-1:status:1', 'project:project-1:completion:1']);
    expect(same).toEqual([]);
    expect(automationEvents.recordDomainEventInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        eventType: AutomationTriggerType.PROJECT_COMPLETED,
        idempotencyKey: 'project:project-1:completion:1',
        payload: expect.objectContaining({
          xpCategory: 'CLIENT',
          completionCycle: 1,
        }),
      }),
    );
  });

  it('records Ticket resolution only on terminal entry and uses a new resolution cycle after reopen', async () => {
    const automationEvents = automationEventsMock();
    const service = new TicketsService(
      {} as never,
      { record: jest.fn() } as never,
      {} as never,
      undefined,
      undefined,
      undefined,
      automationEvents as never,
    );
    const record = privateRecorder(service, 'recordTicketStatusAutomationEvents');
    const tx = txMock({
      [AutomationTriggerType.TICKET_STATUS_CHANGED]: 0,
      [AutomationTriggerType.TICKET_RESOLVED]: 0,
    });

    const first = await record(
      tx,
      tenant,
      ticketState('open', false),
      ticketState('resolved', true),
      true,
    );
    const reopen = await record(
      tx,
      tenant,
      ticketState('resolved', true),
      ticketState('open', false),
      false,
    );
    tx.automationDomainEvent.count.mockImplementation(
      ({ where }: { where: { eventType: string } }) =>
        Promise.resolve(where.eventType === AutomationTriggerType.TICKET_RESOLVED ? 1 : 2),
    );
    const reresolved = await record(
      tx,
      tenant,
      ticketState('open', false),
      ticketState('resolved', true),
      true,
    );

    expect(first).toEqual(['ticket:ticket-1:status:1', 'ticket:ticket-1:resolution:1']);
    expect(reopen).toEqual(['ticket:ticket-1:status:1']);
    expect(reresolved).toEqual(['ticket:ticket-1:status:3', 'ticket:ticket-1:resolution:2']);
    expect(automationEvents.recordDomainEventInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        eventType: AutomationTriggerType.TICKET_RESOLVED,
        idempotencyKey: 'ticket:ticket-1:resolution:1',
        payload: expect.objectContaining({
          resolverMembershipId: 'resolver-1',
          resolutionCycle: 1,
          resolutionTargetAt: '2026-01-03T00:00:00.000Z',
        }),
      }),
    );
  });

  it('propagates automation lineage into Task, Project, and Ticket domain events', async () => {
    const automation = {
      correlationId: 'automation-correlation',
      triggerDomainEventId: '00000000-0000-4000-8000-000000000999',
      parentAutomationDepth: 2,
    };
    const taskEvents = automationEventsMock();
    const projectEvents = automationEventsMock();
    const ticketEvents = automationEventsMock();
    const taskService = new TasksService(
      {} as never,
      { record: jest.fn() } as never,
      {} as never,
      {} as never,
      undefined,
      taskEvents as never,
    );
    const projectService = new ProjectsService(
      {} as never,
      { record: jest.fn() } as never,
      {} as never,
      {} as never,
      undefined,
      projectEvents as never,
    );
    const ticketService = new TicketsService(
      {} as never,
      { record: jest.fn() } as never,
      {} as never,
      undefined,
      undefined,
      undefined,
      ticketEvents as never,
    );

    await privateRecorder(taskService, 'recordTaskStatusAutomationEvents')(
      txMock({ [AutomationTriggerType.TASK_STATUS_CHANGED]: 0 }),
      tenant,
      taskState('todo', false),
      taskState('doing', false),
      false,
      automation,
    );
    await privateRecorder(projectService, 'recordProjectStatusAutomationEvents')(
      txMock({ [AutomationTriggerType.PROJECT_STATUS_CHANGED]: 0 }),
      tenant,
      projectState('open', false, 'HIGH'),
      projectState('doing', false, 'HIGH'),
      false,
      automation,
    );
    await privateRecorder(ticketService, 'recordTicketStatusAutomationEvents')(
      txMock({ [AutomationTriggerType.TICKET_STATUS_CHANGED]: 0 }),
      tenant,
      ticketState('open', false),
      ticketState('waiting', false),
      false,
      automation,
    );

    for (const events of [taskEvents, projectEvents, ticketEvents]) {
      expect(events.recordDomainEventInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          correlationId: 'automation-correlation',
          causationId: '00000000-0000-4000-8000-000000000999',
          automationDepth: 3,
        }),
      );
    }
  });
});

function automationEventsMock() {
  return {
    recordDomainEventInTransaction: jest.fn((_tx, input: { idempotencyKey: string }) =>
      Promise.resolve({ id: input.idempotencyKey }),
    ),
  };
}

function txMock(counts: Record<string, number>) {
  return {
    automationDomainEvent: {
      count: jest.fn(({ where }: { where: { eventType: string } }) =>
        Promise.resolve(counts[where.eventType] ?? 0),
      ),
    },
  };
}

function privateRecorder(service: unknown, key: string) {
  const method = (service as unknown as Record<string, (...args: unknown[]) => Promise<string[]>>)[
    key
  ];
  if (!method) throw new Error(`Missing private recorder ${key}`);
  return method.bind(service) as (...args: unknown[]) => Promise<string[]>;
}

function taskState(statusDefinitionId: string, isTerminal: boolean) {
  return {
    id: 'task-1',
    statusDefinitionId,
    statusDefinition: { isTerminal },
    priority: TaskPriority.HIGH,
    departmentId: 'department-1',
    dueAt: new Date('2026-01-02T00:00:00.000Z'),
    assignees: [{ membershipId: 'assignee-1' }],
  };
}

function projectState(statusDefinitionId: string, isTerminal: boolean, xpCategory: string | null) {
  return {
    id: 'project-1',
    statusDefinitionId,
    statusDefinition: { isTerminal },
    priority: TaskPriority.MEDIUM,
    xpCategory,
    departmentId: 'department-1',
    ownerMembershipId: 'owner-1',
    dueAt: new Date('2026-01-02T00:00:00.000Z'),
  };
}

function ticketState(statusDefinitionId: string, isTerminal: boolean) {
  return {
    id: 'ticket-1',
    statusDefinitionId,
    statusDefinition: { isTerminal },
    priority: TaskPriority.URGENT,
    departmentId: 'department-1',
    assignedToMembershipId: 'resolver-1',
    gamificationResolutionTargetAt: new Date('2026-01-03T00:00:00.000Z'),
    slaState: {
      resolutionDueAt: new Date('2026-01-04T00:00:00.000Z'),
      resolutionCompletedAt: new Date('2026-01-02T00:00:00.000Z'),
    },
  };
}
