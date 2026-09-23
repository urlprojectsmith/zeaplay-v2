import {
  AutomationActionType,
  AutomationConditionOperator,
  AutomationTriggerType,
  AutomationWorkflowNodeType,
} from '@prisma/client';

export const AUTOMATION_DEFINITION_VERSION = '1';
export const AUTOMATION_MAX_NODES = 100;
export const AUTOMATION_MAX_EDGES = 200;
export const AUTOMATION_MAX_DEFINITION_BYTES = 64 * 1024;

export const automationNodeTypes = Object.values(AutomationWorkflowNodeType);
export const automationTriggerTypes = Object.values(AutomationTriggerType);
export const automationActionTypes = Object.values(AutomationActionType);
export const automationConditionOperators = Object.values(AutomationConditionOperator);

export const defaultAutomationDefinition = {
  trigger: { triggerType: AutomationTriggerType.TASK_CREATED },
  nodes: [
    {
      nodeId: 'trigger',
      type: AutomationWorkflowNodeType.TRIGGER,
      config: { triggerType: AutomationTriggerType.TASK_CREATED },
    },
  ],
  edges: [],
  settings: {},
};
