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
export const AUTOMATION_DOMAIN_EVENT_SCHEMA_VERSION = 1;
export const AUTOMATION_DOMAIN_EVENT_MAX_PAYLOAD_BYTES = 16 * 1024;
export const AUTOMATION_DEFAULT_MAX_ATTEMPTS = clampInteger(
  process.env.AUTOMATION_MAX_ATTEMPTS,
  3,
  1,
  10,
);
export const AUTOMATION_MAX_FUTURE_DEPTH = clampInteger(process.env.AUTOMATION_MAX_DEPTH, 5, 1, 20);
export const AUTOMATION_EXECUTION_QUEUE = 'automation-execution';
export const AUTOMATION_EXECUTION_JOB_TYPE = 'automation.execution';
export const AUTOMATION_DISPATCH_BATCH_SIZE = 50;

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

function clampInteger(value: string | undefined, fallback: number, min: number, max: number) {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
