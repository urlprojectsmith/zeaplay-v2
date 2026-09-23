import { BadRequestException } from '@nestjs/common';
import { AutomationVariableResolver } from './automation-variable-resolver';

describe('AutomationVariableResolver', () => {
  const resolver = new AutomationVariableResolver();
  const context = {
    event: {
      id: 'event-1',
      eventType: 'TASK_CREATED',
      entityType: 'TASK',
      entityId: 'task-1',
      occurredAt: '2026-01-01T00:00:00.000Z',
      actorMembershipId: 'member-1',
    },
    trigger: {
      task: {
        id: 'task-1',
        priority: 'HIGH',
        statusDefinitionId: '11111111-1111-4111-8111-111111111111',
        tagIds: ['tag-1', 'tag-2'],
      },
    },
    execution: {
      id: 'execution-1',
      workspaceId: 'workspace-1',
      correlationId: 'correlation-1',
      automationDepth: 1,
    },
    steps: {
      'create-task': {
        result: {
          actionType: 'CREATE_TASK',
          status: 'SUCCEEDED',
          entityType: 'TASK',
          entityId: 'task-2',
          changed: true,
          generatedDomainEventIds: ['event-2'],
        },
      },
    },
  };

  it('resolves trusted trigger, event, execution, and prior step values', () => {
    expect(resolver.resolveConfig('{{trigger.task.id}}', context)).toBe('task-1');
    expect(resolver.resolveConfig('{{event.entityId}}', context)).toBe('task-1');
    expect(resolver.resolveConfig('{{execution.correlationId}}', context)).toBe('correlation-1');
    expect(resolver.resolveConfig('{{steps.create-task.result.entityId}}', context)).toBe('task-2');
  });

  it('preserves full-reference primitive and array values', () => {
    expect(resolver.resolveConfig('{{execution.automationDepth}}', context)).toBe(1);
    expect(resolver.resolveConfig('{{trigger.task.tagIds}}', context)).toEqual(['tag-1', 'tag-2']);
  });

  it('supports scalar string interpolation only', () => {
    expect(resolver.resolveConfig('Follow up {{trigger.task.id}}', context)).toBe(
      'Follow up task-1',
    );
    expect(() => resolver.resolveConfig('Bad {{trigger.task}}', context)).toThrow(
      BadRequestException,
    );
  });

  it('fails safely for missing required variables and supports exists checks', () => {
    expect(() => resolver.resolveConfig('{{trigger.task.missing}}', context)).toThrow(
      BadRequestException,
    );
    expect(resolver.pathExists('trigger.task.missing', context)).toBe(false);
    expect(resolver.pathExists('trigger.task.id', context)).toBe(true);
  });

  it('rejects dangerous paths and arbitrary expressions', () => {
    for (const value of [
      '{{trigger.__proto__.polluted}}',
      '{{trigger.constructor.name}}',
      '{{trigger.prototype.value}}',
      '{{1 + 1}}',
      '{{process.env.SECRET}}',
      '{{Date.now()}}',
      '{{Math.random()}}',
    ]) {
      expect(() => resolver.resolveConfig(value, context)).toThrow(BadRequestException);
    }
  });

  it('rejects resolved configs that exceed the bounded size limit', () => {
    const largeContext = {
      ...context,
      trigger: { task: { id: 'task-1', large: 'x'.repeat(20_000) } },
    };

    expect(() => resolver.resolveConfig({ title: '{{trigger.task.large}}' }, largeContext)).toThrow(
      BadRequestException,
    );
  });
});
