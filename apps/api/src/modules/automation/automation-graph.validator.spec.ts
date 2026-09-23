import { BadRequestException } from '@nestjs/common';
import {
  AutomationActionType,
  AutomationConditionOperator,
  AutomationTriggerType,
  AutomationWorkflowNodeType,
} from '@prisma/client';
import { AUTOMATION_MAX_EDGES, AUTOMATION_MAX_NODES } from './automation.constants';
import { AutomationDefinition, validateAutomationDefinition } from './automation-graph.validator';

describe('automation graph validator', () => {
  it('accepts a valid single-trigger workflow definition', () => {
    const result = validateAutomationDefinition(validDefinition());
    expect(result.definition.nodes).toHaveLength(1);
    expect(result.definitionSizeBytes).toBeGreaterThan(0);
  });

  it('rejects definitions without a trigger node', () => {
    expect(() =>
      validateAutomationDefinition({
        ...validDefinition(),
        nodes: [],
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects multiple trigger nodes', () => {
    expect(() =>
      validateAutomationDefinition({
        ...validDefinition(),
        nodes: [
          triggerNode('trigger-a', AutomationTriggerType.TASK_CREATED),
          triggerNode('trigger-b', AutomationTriggerType.TASK_CREATED),
        ],
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects invalid edge references and duplicate edge identity', () => {
    expect(() =>
      validateAutomationDefinition({
        ...validDefinition(),
        edges: [{ fromNodeId: 'trigger', toNodeId: 'missing' }],
      }),
    ).toThrow(BadRequestException);

    expect(() =>
      validateAutomationDefinition({
        ...definitionWithAction(),
        edges: [
          { fromNodeId: 'trigger', toNodeId: 'action' },
          { fromNodeId: 'trigger', toNodeId: 'action' },
        ],
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects graph cycles', () => {
    expect(() =>
      validateAutomationDefinition({
        ...definitionWithAction(),
        edges: [
          { fromNodeId: 'trigger', toNodeId: 'action' },
          { fromNodeId: 'action', toNodeId: 'trigger' },
        ],
      }),
    ).toThrow(BadRequestException);
  });

  it('enforces node and edge size limits', () => {
    expect(() =>
      validateAutomationDefinition({
        ...validDefinition(),
        nodes: Array.from({ length: AUTOMATION_MAX_NODES + 1 }, (_value, index) =>
          triggerNode(`trigger-${index}`, AutomationTriggerType.TASK_CREATED),
        ),
      }),
    ).toThrow(BadRequestException);

    expect(() =>
      validateAutomationDefinition({
        ...definitionWithAction(),
        edges: Array.from({ length: AUTOMATION_MAX_EDGES + 1 }, () => ({
          fromNodeId: 'trigger',
          toNodeId: 'action',
        })),
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects unsupported trigger, node, and action types', () => {
    expect(() =>
      validateAutomationDefinition({
        ...validDefinition(),
        trigger: { triggerType: 'WEBHOOK_RECEIVED' },
        nodes: [triggerNode('trigger', 'WEBHOOK_RECEIVED' as AutomationTriggerType)],
      }),
    ).toThrow(BadRequestException);

    expect(() =>
      validateAutomationDefinition({
        ...validDefinition(),
        nodes: [
          triggerNode('trigger', AutomationTriggerType.TASK_CREATED),
          {
            nodeId: 'action',
            type: AutomationWorkflowNodeType.ACTION,
            config: { actionType: 'SEND_EMAIL' },
          },
        ],
        edges: [{ fromNodeId: 'trigger', toNodeId: 'action' }],
      }),
    ).toThrow(BadRequestException);

    expect(() =>
      validateAutomationDefinition({
        ...validDefinition(),
        nodes: [
          triggerNode('trigger', AutomationTriggerType.TASK_CREATED),
          {
            nodeId: 'webhook',
            type: 'WEBHOOK' as AutomationWorkflowNodeType,
            config: {},
          },
        ],
        edges: [{ fromNodeId: 'trigger', toNodeId: 'webhook' }],
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects unsupported config keys by node type', () => {
    expect(() =>
      validateAutomationDefinition({
        ...validDefinition(),
        trigger: {
          triggerType: AutomationTriggerType.TASK_CREATED,
          displayName: 'Unexpected',
        },
      }),
    ).toThrow(BadRequestException);

    expect(() =>
      validateAutomationDefinition({
        ...definitionWithAction(),
        nodes: [
          triggerNode('trigger', AutomationTriggerType.TASK_CREATED),
          {
            nodeId: 'action',
            type: AutomationWorkflowNodeType.ACTION,
            config: {
              actionType: AutomationActionType.CREATE_TASK,
              template: 'not part of the Phase 11.1 contract',
            },
          },
        ],
      }),
    ).toThrow(BadRequestException);

    expect(() =>
      validateAutomationDefinition({
        ...validDefinition(),
        nodes: [
          triggerNode('trigger', AutomationTriggerType.TASK_CREATED),
          {
            nodeId: 'delay',
            type: AutomationWorkflowNodeType.DELAY,
            config: { minutes: 5 },
          },
        ],
        edges: [{ fromNodeId: 'trigger', toNodeId: 'delay' }],
      }),
    ).toThrow(BadRequestException);
  });

  it('validates condition operators without arbitrary expressions', () => {
    expect(() =>
      validateAutomationDefinition({
        ...validDefinition(),
        nodes: [
          triggerNode('trigger', AutomationTriggerType.TASK_CREATED),
          {
            nodeId: 'condition',
            type: AutomationWorkflowNodeType.CONDITION,
            config: {
              operator: AutomationConditionOperator.EQUALS,
              field: '{{trigger.task.status}}',
              value: 'Done',
            },
          },
          {
            nodeId: 'true-action',
            type: AutomationWorkflowNodeType.ACTION,
            config: { actionType: AutomationActionType.CREATE_TASK, title: 'True task' },
          },
          {
            nodeId: 'false-action',
            type: AutomationWorkflowNodeType.ACTION,
            config: { actionType: AutomationActionType.CREATE_TASK, title: 'False task' },
          },
        ],
        edges: [
          { fromNodeId: 'trigger', toNodeId: 'condition' },
          { fromNodeId: 'condition', toNodeId: 'true-action', branchKey: 'TRUE' },
          { fromNodeId: 'condition', toNodeId: 'false-action', branchKey: 'FALSE' },
        ],
      }),
    ).not.toThrow();

    expect(() =>
      validateAutomationDefinition({
        ...validDefinition(),
        nodes: [
          triggerNode('trigger', AutomationTriggerType.TASK_CREATED),
          {
            nodeId: 'condition',
            type: AutomationWorkflowNodeType.CONDITION,
            config: {
              operator: AutomationConditionOperator.EQUALS,
              field: 'task.status === "Done"',
              value: 'Done',
            },
          },
        ],
        edges: [{ fromNodeId: 'trigger', toNodeId: 'condition' }],
      }),
    ).toThrow(BadRequestException);
  });

  it('accepts supported action payload fields and trigger variable references', () => {
    expect(() =>
      validateAutomationDefinition({
        ...validDefinition(),
        nodes: [
          triggerNode('trigger', AutomationTriggerType.TASK_CREATED),
          {
            nodeId: 'action',
            type: AutomationWorkflowNodeType.ACTION,
            config: {
              actionType: AutomationActionType.CHANGE_TASK_STATUS,
              taskId: '{{trigger.task.id}}',
              statusDefinitionId: '11111111-1111-4111-8111-111111111111',
            },
          },
        ],
        edges: [{ fromNodeId: 'trigger', toNodeId: 'action' }],
      }),
    ).not.toThrow();
  });

  it('rejects unavailable action identifiers as publish-valid executable actions', () => {
    expect(() =>
      validateAutomationDefinition({
        ...validDefinition(),
        nodes: [
          triggerNode('trigger', AutomationTriggerType.TASK_CREATED),
          {
            nodeId: 'action',
            type: AutomationWorkflowNodeType.ACTION,
            config: {
              actionType: AutomationActionType.ADD_TICKET_TAG,
              ticketId: '11111111-1111-4111-8111-111111111111',
              tagIds: ['22222222-2222-4222-8222-222222222222'],
            },
          },
        ],
        edges: [{ fromNodeId: 'trigger', toNodeId: 'action' }],
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects malformed action variable references and overlong strings', () => {
    expect(() =>
      validateAutomationDefinition({
        ...definitionWithAction(),
        nodes: [
          triggerNode('trigger', AutomationTriggerType.TASK_CREATED),
          {
            nodeId: 'action',
            type: AutomationWorkflowNodeType.ACTION,
            config: {
              actionType: AutomationActionType.CREATE_TASK,
              title: 'Bad {{task.id}}',
            },
          },
        ],
      }),
    ).toThrow(BadRequestException);

    expect(() =>
      validateAutomationDefinition({
        ...definitionWithAction(),
        nodes: [
          triggerNode('trigger', AutomationTriggerType.TASK_CREATED),
          {
            nodeId: 'action',
            type: AutomationWorkflowNodeType.ACTION,
            config: {
              actionType: AutomationActionType.CREATE_TASK,
              title: 'x'.repeat(161),
            },
          },
        ],
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects secret-like configuration keys', () => {
    expect(() =>
      validateAutomationDefinition({
        ...definitionWithAction(),
        nodes: [
          triggerNode('trigger', AutomationTriggerType.TASK_CREATED),
          {
            nodeId: 'action',
            type: AutomationWorkflowNodeType.ACTION,
            config: {
              actionType: AutomationActionType.CREATE_TASK,
              apiKey: 'never-store-this',
            },
          },
        ],
      }),
    ).toThrow(BadRequestException);
  });
});

function validDefinition(): AutomationDefinition {
  return {
    trigger: { triggerType: AutomationTriggerType.TASK_CREATED },
    nodes: [triggerNode('trigger', AutomationTriggerType.TASK_CREATED)],
    edges: [],
    settings: {},
  };
}

function definitionWithAction(): AutomationDefinition {
  return {
    ...validDefinition(),
    nodes: [
      triggerNode('trigger', AutomationTriggerType.TASK_CREATED),
      {
        nodeId: 'action',
        type: AutomationWorkflowNodeType.ACTION,
        config: { actionType: AutomationActionType.CREATE_TASK, title: 'Follow up' },
      },
    ],
    edges: [{ fromNodeId: 'trigger', toNodeId: 'action' }],
  };
}

function triggerNode(nodeId: string, triggerType: AutomationTriggerType) {
  return {
    nodeId,
    type: AutomationWorkflowNodeType.TRIGGER,
    config: { triggerType },
  };
}
