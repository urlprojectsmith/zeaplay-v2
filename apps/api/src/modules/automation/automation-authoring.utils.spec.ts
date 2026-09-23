import {
  AutomationActionType,
  AutomationTriggerType,
  AutomationWorkflowNodeType,
} from '@prisma/client';
import { cloneAutomationDefinitionForAuthoring } from './automation-authoring.utils';

describe('automation authoring utilities', () => {
  it('remaps cloned node ids, edges, and steps variable references', () => {
    const clone = cloneAutomationDefinitionForAuthoring({
      trigger: { triggerType: AutomationTriggerType.TASK_CREATED },
      nodes: [
        {
          nodeId: 'trigger',
          type: AutomationWorkflowNodeType.TRIGGER,
          config: { triggerType: AutomationTriggerType.TASK_CREATED },
        },
        {
          nodeId: 'action',
          type: AutomationWorkflowNodeType.ACTION,
          config: {
            actionType: AutomationActionType.CREATE_TASK,
            title: '{{steps.trigger.result.title}}',
          },
        },
      ],
      edges: [{ fromNodeId: 'trigger', toNodeId: 'action' }],
      settings: { note: '{{steps.action.result.id}}' },
    });

    const triggerId = clone.nodeIdMap.trigger;
    const actionId = clone.nodeIdMap.action;

    expect(triggerId).toMatch(/^n_[a-f0-9]{24}$/);
    expect(actionId).toMatch(/^n_[a-f0-9]{24}$/);
    expect(triggerId).not.toBe('trigger');
    expect(actionId).not.toBe('action');
    expect(clone.definition.nodes.map((node) => node.nodeId)).toEqual([triggerId, actionId]);
    expect(clone.definition.edges).toEqual([{ fromNodeId: triggerId, toNodeId: actionId }]);
    expect(clone.definition.nodes[1]?.config.title).toBe(`{{steps.${triggerId}.result.title}}`);
    expect(clone.definition.settings.note).toBe(`{{steps.${actionId}.result.id}}`);
  });

  it('does not rewrite non-step variables or unknown step references', () => {
    const clone = cloneAutomationDefinitionForAuthoring({
      trigger: { triggerType: AutomationTriggerType.TASK_CREATED },
      nodes: [
        {
          nodeId: 'trigger',
          type: AutomationWorkflowNodeType.TRIGGER,
          config: { triggerType: AutomationTriggerType.TASK_CREATED },
        },
      ],
      edges: [],
      settings: {
        triggerVariable: '{{trigger.task.id}}',
        unknownStep: '{{steps.external.result.id}}',
      },
    });

    expect(clone.definition.settings.triggerVariable).toBe('{{trigger.task.id}}');
    expect(clone.definition.settings.unknownStep).toBe('{{steps.external.result.id}}');
  });

  it('remaps multiple step references in action, condition, branch, and interpolated strings', () => {
    const clone = cloneAutomationDefinitionForAuthoring({
      trigger: { triggerType: AutomationTriggerType.TASK_CREATED },
      nodes: [
        {
          nodeId: 'trigger',
          type: AutomationWorkflowNodeType.TRIGGER,
          config: { triggerType: AutomationTriggerType.TASK_CREATED },
        },
        {
          nodeId: 'action-a',
          type: AutomationWorkflowNodeType.ACTION,
          config: {
            actionType: AutomationActionType.CREATE_TASK,
            title:
              'Created from {{steps.trigger.result.entityId}} and {{steps.trigger.result.kind}}',
          },
        },
        {
          nodeId: 'condition-a',
          type: AutomationWorkflowNodeType.CONDITION,
          config: {
            left: '{{steps.action-a.result.id}}',
            operator: 'EQUALS',
            right: '{{trigger.task.id}}',
          },
        },
        {
          nodeId: 'branch-a',
          type: AutomationWorkflowNodeType.BRANCH,
          config: {
            cases: [
              {
                key: 'MATCHED',
                left: '{{steps.condition-a.result.value}}',
                operator: 'EQUALS',
                right: 'yes',
              },
            ],
            defaultKey: 'DEFAULT',
          },
        },
      ],
      edges: [
        { fromNodeId: 'trigger', toNodeId: 'action-a' },
        { fromNodeId: 'action-a', toNodeId: 'condition-a' },
        { fromNodeId: 'condition-a', toNodeId: 'branch-a', branchKey: 'TRUE' },
      ],
      settings: { untouched: '{{event.entityId}} {{execution.id}}' },
    });

    const triggerId = clone.nodeIdMap.trigger;
    const actionId = clone.nodeIdMap['action-a'];
    const conditionId = clone.nodeIdMap['condition-a'];
    const branchId = clone.nodeIdMap['branch-a'];

    expect(clone.definition.edges).toEqual([
      { fromNodeId: triggerId, toNodeId: actionId },
      { fromNodeId: actionId, toNodeId: conditionId },
      { fromNodeId: conditionId, toNodeId: branchId, branchKey: 'TRUE' },
    ]);
    expect(clone.definition.nodes[1]?.config.title).toBe(
      `Created from {{steps.${triggerId}.result.entityId}} and {{steps.${triggerId}.result.kind}}`,
    );
    expect(clone.definition.nodes[2]?.config.left).toBe(`{{steps.${actionId}.result.id}}`);
    expect(clone.definition.nodes[2]?.config.right).toBe('{{trigger.task.id}}');
    const branchCases = clone.definition.nodes[3]?.config.cases as Array<Record<string, unknown>>;
    expect(branchCases[0]?.left).toBe(`{{steps.${conditionId}.result.value}}`);
    expect(clone.definition.settings.untouched).toBe('{{event.entityId}} {{execution.id}}');
  });
});
