import {
  AutomationDomainEventEntityType,
  AutomationTriggerMatchStatus,
  AutomationTriggerType,
  AutomationWorkflowNodeType,
} from '@prisma/client';
import { NotFoundException } from '@nestjs/common';
import { AutomationDomainEventsService } from './automation-domain-events.service';

describe('AutomationDomainEventsService', () => {
  it('records a trusted domain event idempotently', async () => {
    const event = domainEvent({ id: 'event-1' });
    const prisma = {
      automationDomainEvent: {
        create: jest.fn().mockResolvedValue(event),
        findUnique: jest.fn().mockResolvedValue(event),
      },
      automationWorkflow: { findMany: jest.fn().mockResolvedValue([]) },
      automationTriggerMatch: { createMany: jest.fn() },
    };
    const service = new AutomationDomainEventsService(prisma as never);

    const result = await service.recordDomainEvent({
      workspaceId: 'workspace-1',
      eventType: AutomationTriggerType.TASK_CREATED,
      entityType: AutomationDomainEventEntityType.TASK,
      entityId: 'task-1',
      actorMembershipId: 'member-1',
      payload: { taskId: 'task-1', workspaceId: 'workspace-1' },
      idempotencyKey: 'task:task-1:created',
    });

    expect(result.id).toBe('event-1');
    expect(prisma.automationDomainEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workspaceId: 'workspace-1',
          eventType: AutomationTriggerType.TASK_CREATED,
          idempotencyKey: 'task:task-1:created',
          schemaVersion: 1,
          automationDepth: 0,
        }),
      }),
    );
  });

  it('matches only same-workspace active published workflow versions and snapshots the version id', async () => {
    const event = domainEvent({
      eventType: AutomationTriggerType.TASK_STATUS_CHANGED,
      payload: {
        previousStatusDefinitionId: '00000000-0000-4000-8000-000000000001',
        newStatusDefinitionId: '00000000-0000-4000-8000-000000000002',
      },
    });
    const workflows = [
      workflow({
        workflowId: 'workflow-active',
        versionId: 'version-active',
        triggerType: AutomationTriggerType.TASK_STATUS_CHANGED,
        toStatusId: '00000000-0000-4000-8000-000000000002',
      }),
      workflow({
        workflowId: 'workflow-filter-miss',
        versionId: 'version-filter-miss',
        triggerType: AutomationTriggerType.TASK_STATUS_CHANGED,
        toStatusId: '00000000-0000-4000-8000-000000000099',
      }),
      workflow({
        workflowId: 'workflow-wrong-trigger',
        versionId: 'version-wrong-trigger',
        triggerType: AutomationTriggerType.PROJECT_CREATED,
      }),
    ];
    const prisma = {
      automationDomainEvent: {
        findUnique: jest.fn().mockResolvedValue(event),
      },
      automationWorkflow: {
        findMany: jest.fn().mockResolvedValue(workflows),
      },
      automationTriggerMatch: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = new AutomationDomainEventsService(prisma as never);

    const result = await service.evaluateDomainEvent(event.id);

    expect(result).toEqual({ domainEventId: event.id, matched: 1 });
    expect(prisma.automationWorkflow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: event.workspaceId,
          status: 'PUBLISHED',
          archivedAt: null,
          activePublishedVersionId: { not: null },
        }),
        take: 500,
      }),
    );
    expect(prisma.automationTriggerMatch.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          workspaceId: event.workspaceId,
          domainEventId: event.id,
          workflowId: 'workflow-active',
          workflowVersionId: 'version-active',
          triggerNodeId: 'trigger',
          status: AutomationTriggerMatchStatus.MATCHED,
          runtimeEligibleAt: expect.any(Date),
        }),
      ],
      skipDuplicates: true,
    });
  });

  it('keeps duplicate matcher evaluation retry-safe', async () => {
    const event = domainEvent({ eventType: AutomationTriggerType.PROJECT_COMPLETED });
    const prisma = {
      automationDomainEvent: {
        findUnique: jest.fn().mockResolvedValue(event),
      },
      automationWorkflow: {
        findMany: jest.fn().mockResolvedValue([
          workflow({
            workflowId: 'workflow-active',
            versionId: 'version-active',
            triggerType: AutomationTriggerType.PROJECT_COMPLETED,
          }),
        ]),
      },
      automationTriggerMatch: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const service = new AutomationDomainEventsService(prisma as never);

    await service.evaluateDomainEvent(event.id);
    await service.evaluateDomainEvent(event.id);

    expect(prisma.automationTriggerMatch.createMany).toHaveBeenCalledTimes(2);
    expect(prisma.automationTriggerMatch.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true }),
    );
  });

  it('uses active published workflow filtering and does not query current entities for status filters', async () => {
    const event = domainEvent({
      eventType: AutomationTriggerType.TICKET_STATUS_CHANGED,
      payload: {
        previousStatusDefinitionId: '00000000-0000-4000-8000-000000000001',
        newStatusDefinitionId: '00000000-0000-4000-8000-000000000002',
      },
    });
    const prisma = {
      automationDomainEvent: {
        findUnique: jest.fn().mockResolvedValue(event),
      },
      automationWorkflow: {
        findMany: jest.fn().mockResolvedValue([
          workflow({
            workflowId: 'workflow-active',
            versionId: 'version-active',
            triggerType: AutomationTriggerType.TICKET_STATUS_CHANGED,
            fromStatusId: '00000000-0000-4000-8000-000000000001',
            toStatusId: '00000000-0000-4000-8000-000000000002',
          }),
          workflow({
            workflowId: 'workflow-filter-miss',
            versionId: 'version-filter-miss',
            triggerType: AutomationTriggerType.TICKET_STATUS_CHANGED,
            fromStatusId: '00000000-0000-4000-8000-000000000099',
          }),
        ]),
      },
      automationTriggerMatch: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      task: { findUnique: jest.fn() },
      project: { findUnique: jest.fn() },
      ticket: { findUnique: jest.fn() },
    };
    const service = new AutomationDomainEventsService(prisma as never);

    await service.evaluateDomainEvent(event.id);

    expect(prisma.automationWorkflow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: event.workspaceId,
          status: 'PUBLISHED',
          archivedAt: null,
          activePublishedVersionId: { not: null },
          activePublishedVersion: { is: { state: 'PUBLISHED', workspaceId: event.workspaceId } },
        }),
        select: expect.objectContaining({
          activePublishedVersion: expect.any(Object),
        }),
        take: 500,
      }),
    );
    expect(prisma.ticket.findUnique).not.toHaveBeenCalled();
    expect(prisma.automationTriggerMatch.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            workflowId: 'workflow-active',
            workflowVersionId: 'version-active',
          }),
        ],
      }),
    );
  });

  it('keeps event and match read APIs workspace-scoped and bounded', async () => {
    const event = domainEvent();
    const match = {
      id: 'match-1',
      workspaceId: event.workspaceId,
      domainEventId: event.id,
      workflowId: 'workflow-1',
      workflowVersionId: 'version-1',
      triggerNodeId: 'trigger',
      status: AutomationTriggerMatchStatus.MATCHED,
      reasonCode: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const prisma = {
      $transaction: jest.fn((queries: Array<Promise<unknown>>) => Promise.all(queries)),
      automationDomainEvent: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([{ ...event, _count: { triggerMatches: 1 } }]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      automationTriggerMatch: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([match]),
      },
    };
    const service = new AutomationDomainEventsService(prisma as never);
    const tenant = {
      workspaceId: event.workspaceId,
    };

    await expect(service.getEvent(tenant as never, 'foreign-event')).rejects.toThrow(
      NotFoundException,
    );
    const events = await service.listEvents(tenant as never, {
      page: 2,
      pageSize: 100,
      sortBy: 'createdAt',
      sortDirection: 'desc',
    });
    const matches = await service.listTriggerMatches(tenant as never, {
      page: 1,
      pageSize: 100,
      sortBy: 'createdAt',
      sortDirection: 'asc',
      domainEventId: event.id,
    });

    expect(prisma.automationDomainEvent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'foreign-event', workspaceId: event.workspaceId } }),
    );
    expect(prisma.automationDomainEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceId: event.workspaceId }),
        skip: 100,
        take: 100,
      }),
    );
    expect(prisma.automationTriggerMatch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: event.workspaceId,
          domainEventId: event.id,
        }),
        take: 100,
      }),
    );
    expect(events.items[0]?.matchedWorkflowCount).toBe(1);
    expect(matches.items).toEqual([match]);
  });
});

function domainEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'event-1',
    workspaceId: 'workspace-1',
    eventType: AutomationTriggerType.TASK_CREATED,
    entityType: AutomationDomainEventEntityType.TASK,
    entityId: 'task-1',
    actorMembershipId: 'member-1',
    occurredAt: new Date('2026-01-01T00:00:00.000Z'),
    schemaVersion: 1,
    correlationId: 'correlation-1',
    causationId: null,
    automationDepth: 0,
    payload: {},
    idempotencyKey: 'idempotency-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function workflow(input: {
  workflowId: string;
  versionId: string;
  triggerType: AutomationTriggerType;
  fromStatusId?: string;
  toStatusId?: string;
}) {
  return {
    id: input.workflowId,
    activePublishedVersion: {
      id: input.versionId,
      workspaceId: 'workspace-1',
      triggerDefinition: { triggerType: input.triggerType },
      nodesDefinition: [
        {
          nodeId: 'trigger',
          type: AutomationWorkflowNodeType.TRIGGER,
          config: {
            triggerType: input.triggerType,
            ...(input.fromStatusId ? { fromStatusId: input.fromStatusId } : {}),
            ...(input.toStatusId ? { toStatusId: input.toStatusId } : {}),
          },
        },
      ],
    },
  };
}
