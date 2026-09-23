import { BadRequestException } from '@nestjs/common';
import {
  AutomationActionType,
  AutomationConditionOperator,
  AutomationTriggerType,
  AutomationWorkflowNodeType,
  Prisma,
  ProjectVisibility,
  ProjectXpCategory,
  TaskPriority,
} from '@prisma/client';
import {
  AUTOMATION_MAX_DEFINITION_BYTES,
  AUTOMATION_MAX_EDGES,
  AUTOMATION_MAX_NODES,
  automationActionTypes,
  automationConditionOperators,
  automationNodeTypes,
  automationTriggerTypes,
} from './automation.constants';
import { variablePathsInValue } from './automation-variable-resolver';

export interface AutomationNodeDefinition {
  nodeId: string;
  type: AutomationWorkflowNodeType;
  config: Record<string, unknown>;
}

export interface AutomationEdgeDefinition {
  fromNodeId: string;
  toNodeId: string;
  branchKey?: string | null;
}

export interface AutomationDefinition {
  trigger: Record<string, unknown>;
  nodes: AutomationNodeDefinition[];
  edges: AutomationEdgeDefinition[];
  settings: Record<string, unknown>;
}

const nodeIdPattern = /^[A-Za-z0-9_-]{1,80}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const variablePattern = /^\{\{\s*(event|trigger|execution|steps)\.[A-Za-z0-9_.-]{1,150}\s*\}\}$/;
const secretKeyPattern =
  /(api[_-]?key|password|secret|token|access[_-]?token|refresh[_-]?token|smtp|credential)/i;
const branchKeyPattern = /^[A-Za-z0-9_-]{1,80}$/;
const maxBranchCases = 10;

type ActionFieldType =
  | 'short-string'
  | 'long-string'
  | 'uuid'
  | 'uuid-array'
  | 'date'
  | 'priority'
  | 'project-visibility'
  | 'xp-category';

interface ActionSchema {
  allowedKeys: string[];
  requiredKeys: string[];
  fields: Partial<Record<string, ActionFieldType>>;
}

const actionSchemas: Record<AutomationActionType, ActionSchema> = {
  [AutomationActionType.CREATE_TASK]: {
    allowedKeys: [
      'actionType',
      'title',
      'description',
      'priority',
      'statusDefinitionId',
      'departmentId',
      'assigneeMembershipIds',
      'plannedStartAt',
      'dueAt',
      'tagIds',
    ],
    requiredKeys: ['title'],
    fields: {
      title: 'short-string',
      description: 'long-string',
      priority: 'priority',
      statusDefinitionId: 'uuid',
      departmentId: 'uuid',
      assigneeMembershipIds: 'uuid-array',
      plannedStartAt: 'date',
      dueAt: 'date',
      tagIds: 'uuid-array',
    },
  },
  [AutomationActionType.UPDATE_TASK]: {
    allowedKeys: [
      'actionType',
      'taskId',
      'title',
      'description',
      'priority',
      'departmentId',
      'plannedStartAt',
      'dueAt',
    ],
    requiredKeys: ['taskId'],
    fields: {
      taskId: 'uuid',
      title: 'short-string',
      description: 'long-string',
      priority: 'priority',
      departmentId: 'uuid',
      plannedStartAt: 'date',
      dueAt: 'date',
    },
  },
  [AutomationActionType.ASSIGN_TASK]: {
    allowedKeys: ['actionType', 'taskId', 'membershipIds'],
    requiredKeys: ['taskId', 'membershipIds'],
    fields: { taskId: 'uuid', membershipIds: 'uuid-array' },
  },
  [AutomationActionType.CHANGE_TASK_STATUS]: {
    allowedKeys: ['actionType', 'taskId', 'statusDefinitionId', 'reopenDueAt'],
    requiredKeys: ['taskId', 'statusDefinitionId'],
    fields: { taskId: 'uuid', statusDefinitionId: 'uuid', reopenDueAt: 'date' },
  },
  [AutomationActionType.ADD_TASK_TAG]: {
    allowedKeys: ['actionType', 'taskId', 'tagIds'],
    requiredKeys: ['taskId', 'tagIds'],
    fields: { taskId: 'uuid', tagIds: 'uuid-array' },
  },
  [AutomationActionType.UPDATE_PROJECT]: {
    allowedKeys: [
      'actionType',
      'projectId',
      'name',
      'description',
      'priority',
      'xpCategory',
      'plannedStartAt',
      'dueAt',
      'departmentId',
      'visibility',
    ],
    requiredKeys: ['projectId'],
    fields: {
      projectId: 'uuid',
      name: 'short-string',
      description: 'long-string',
      priority: 'priority',
      xpCategory: 'xp-category',
      plannedStartAt: 'date',
      dueAt: 'date',
      departmentId: 'uuid',
      visibility: 'project-visibility',
    },
  },
  [AutomationActionType.CHANGE_PROJECT_STATUS]: {
    allowedKeys: ['actionType', 'projectId', 'statusDefinitionId', 'dueAt'],
    requiredKeys: ['projectId', 'statusDefinitionId'],
    fields: { projectId: 'uuid', statusDefinitionId: 'uuid', dueAt: 'date' },
  },
  [AutomationActionType.ASSIGN_TICKET]: {
    allowedKeys: ['actionType', 'ticketId', 'departmentId', 'assignedToMembershipId'],
    requiredKeys: ['ticketId'],
    fields: { ticketId: 'uuid', departmentId: 'uuid', assignedToMembershipId: 'uuid' },
  },
  [AutomationActionType.CHANGE_TICKET_STATUS]: {
    allowedKeys: ['actionType', 'ticketId', 'statusDefinitionId', 'gamificationResolutionTargetAt'],
    requiredKeys: ['ticketId', 'statusDefinitionId'],
    fields: {
      ticketId: 'uuid',
      statusDefinitionId: 'uuid',
      gamificationResolutionTargetAt: 'date',
    },
  },
  [AutomationActionType.ADD_TICKET_TAG]: {
    allowedKeys: ['actionType', 'ticketId', 'tagIds'],
    requiredKeys: ['ticketId', 'tagIds'],
    fields: { ticketId: 'uuid', tagIds: 'uuid-array' },
  },
};
const unavailableActionTypes = new Set<AutomationActionType>([AutomationActionType.ADD_TICKET_TAG]);

export function validateAutomationDefinition(input: AutomationDefinition): {
  definition: AutomationDefinition;
  definitionSizeBytes: number;
} {
  const trigger = ensurePlainObject(input.trigger, 'trigger');
  validateTriggerConfig(trigger, 'trigger');
  const definition = {
    trigger,
    nodes: validateNodes(input.nodes),
    edges: validateEdges(input.edges),
    settings: ensurePlainObject(input.settings ?? {}, 'settings'),
  };
  validateNoSecretLikeKeys(definition, []);
  validateTriggerVariableNamespaces(definition);
  validateGraph(definition);
  const definitionSizeBytes = Buffer.byteLength(JSON.stringify(definition), 'utf8');
  if (definitionSizeBytes > AUTOMATION_MAX_DEFINITION_BYTES) {
    throw new BadRequestException('Workflow definition is too large.');
  }
  return { definition, definitionSizeBytes };
}

export function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function validateNodes(nodes: unknown): AutomationNodeDefinition[] {
  if (!Array.isArray(nodes)) throw new BadRequestException('Workflow nodes must be an array.');
  if (nodes.length > AUTOMATION_MAX_NODES) {
    throw new BadRequestException(`Workflow cannot exceed ${AUTOMATION_MAX_NODES} nodes.`);
  }
  return nodes.map((rawNode, index) => {
    const node = ensurePlainObject(rawNode, `nodes[${index}]`);
    const nodeId = stringValue(node.nodeId, `nodes[${index}].nodeId`);
    if (!nodeIdPattern.test(nodeId)) {
      throw new BadRequestException(`Invalid node id at nodes[${index}].`);
    }
    const type = enumValue(
      node.type,
      automationNodeTypes,
      `nodes[${index}].type`,
    ) as AutomationWorkflowNodeType;
    const config = ensurePlainObject(node.config ?? {}, `nodes[${index}].config`);
    validateNodeConfig(type, config, index);
    return { nodeId, type, config };
  });
}

function validateEdges(edges: unknown): AutomationEdgeDefinition[] {
  if (!Array.isArray(edges)) throw new BadRequestException('Workflow edges must be an array.');
  if (edges.length > AUTOMATION_MAX_EDGES) {
    throw new BadRequestException(`Workflow cannot exceed ${AUTOMATION_MAX_EDGES} edges.`);
  }
  return edges.map((rawEdge, index) => {
    const edge = ensurePlainObject(rawEdge, `edges[${index}]`);
    const fromNodeId = stringValue(edge.fromNodeId, `edges[${index}].fromNodeId`);
    const toNodeId = stringValue(edge.toNodeId, `edges[${index}].toNodeId`);
    if (!nodeIdPattern.test(fromNodeId) || !nodeIdPattern.test(toNodeId)) {
      throw new BadRequestException(`Invalid edge node id at edges[${index}].`);
    }
    const branchKey =
      edge.branchKey === undefined || edge.branchKey === null
        ? null
        : stringValue(edge.branchKey, `edges[${index}].branchKey`);
    if (branchKey && branchKey.length > 80) {
      throw new BadRequestException(`Invalid branch key at edges[${index}].`);
    }
    return { fromNodeId, toNodeId, branchKey };
  });
}

function validateNodeConfig(
  type: AutomationWorkflowNodeType,
  config: Record<string, unknown>,
  index: number,
) {
  if (type === AutomationWorkflowNodeType.TRIGGER) {
    validateTriggerConfig(config, `nodes[${index}].config`);
    return;
  }
  if (type === AutomationWorkflowNodeType.ACTION) {
    validateAutomationActionConfig(config, `nodes[${index}].config`);
    return;
  }
  if (type === AutomationWorkflowNodeType.CONDITION) {
    assertAllowedKeys(
      config,
      ['operator', 'field', 'left', 'value', 'right'],
      `nodes[${index}].config`,
    );
    validateConditionRule(config, `nodes[${index}].config`);
    return;
  }
  if (type === AutomationWorkflowNodeType.BRANCH) {
    assertAllowedKeys(config, ['cases', 'defaultKey'], `nodes[${index}].config`);
    validateBranchConfig(config, `nodes[${index}].config`);
    return;
  }
  assertAllowedKeys(config, [], `nodes[${index}].config`);
}

function validateConditionRule(config: Record<string, unknown>, path: string) {
  const operator = enumValue(
    config.operator,
    automationConditionOperators,
    `${path}.operator`,
  ) as AutomationConditionOperator;
  const left = config.left ?? config.field;
  if (left === undefined) throw new BadRequestException(`${path}.left is required.`);
  validateOperand(left, `${path}.left`);
  if (
    operator === AutomationConditionOperator.EXISTS ||
    operator === AutomationConditionOperator.NOT_EXISTS
  ) {
    return;
  }
  const right = config.right ?? config.value;
  if (right === undefined) throw new BadRequestException(`${path}.right is required.`);
  validateOperand(right, `${path}.right`);
  if (
    operator === AutomationConditionOperator.IN ||
    operator === AutomationConditionOperator.NOT_IN
  ) {
    if (!Array.isArray(right) && !isVariableReference(right)) {
      throw new BadRequestException(`${path}.right must be an array or variable reference.`);
    }
  }
}

function validateBranchConfig(config: Record<string, unknown>, path: string) {
  const cases = config.cases;
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new BadRequestException(`${path}.cases must be a non-empty array.`);
  }
  if (cases.length > maxBranchCases) {
    throw new BadRequestException(`${path}.cases cannot exceed ${maxBranchCases}.`);
  }
  const keys = new Set<string>();
  cases.forEach((rawCase, index) => {
    const branchCase = ensurePlainObject(rawCase, `${path}.cases[${index}]`);
    assertAllowedKeys(
      branchCase,
      ['key', 'operator', 'field', 'left', 'value', 'right'],
      `${path}.cases[${index}]`,
    );
    const key = stringValue(branchCase.key, `${path}.cases[${index}].key`);
    if (!branchKeyPattern.test(key))
      throw new BadRequestException(`${path}.cases[${index}].key is invalid.`);
    if (keys.has(key)) throw new BadRequestException(`${path}.cases contains duplicate keys.`);
    keys.add(key);
    validateConditionRule(branchCase, `${path}.cases[${index}]`);
  });
  const defaultKey = stringValue(config.defaultKey, `${path}.defaultKey`);
  if (!branchKeyPattern.test(defaultKey))
    throw new BadRequestException(`${path}.defaultKey is invalid.`);
  if (keys.has(defaultKey))
    throw new BadRequestException(`${path}.defaultKey cannot duplicate a case key.`);
}

function validateOperand(value: unknown, path: string) {
  if (value === null) return;
  if (typeof value === 'string') {
    validateNoMalformedReference(value, path);
    return;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateOperand(item, `${path}[${index}]`));
    return;
  }
  throw new BadRequestException(`${path} must be a scalar, array, or variable reference.`);
}

function isVariableReference(value: unknown) {
  return typeof value === 'string' && variablePattern.test(value);
}

function validateTriggerVariableNamespaces(definition: AutomationDefinition) {
  const triggerNode = definition.nodes.find(
    (node) => node.type === AutomationWorkflowNodeType.TRIGGER,
  );
  const triggerType = triggerNode?.config.triggerType;
  const allowedNamespace = triggerNamespace(triggerType);
  for (const path of variablePathsInValue(definition)) {
    validateVariablePath(path);
    if (
      path.startsWith('trigger.') &&
      allowedNamespace &&
      !path.startsWith(`trigger.${allowedNamespace}.`)
    ) {
      throw new BadRequestException(`Variable ${path} is not valid for the selected trigger.`);
    }
  }
}

function triggerNamespace(triggerType: unknown) {
  if (typeof triggerType !== 'string') return null;
  if (triggerType.startsWith('TASK_')) return 'task';
  if (triggerType.startsWith('PROJECT_')) return 'project';
  if (triggerType.startsWith('TICKET_')) return 'ticket';
  return null;
}

function validateVariablePath(path: string) {
  if (path.length > 160 || /[()[\]+*/\\'"`]/.test(path)) {
    throw new BadRequestException('Variable path is invalid.');
  }
  const segments = path.split('.');
  if (segments.length < 2 || segments.length > 12)
    throw new BadRequestException('Variable path is invalid.');
  const root = segments[0];
  if (!root || !['event', 'trigger', 'execution', 'steps'].includes(root)) {
    throw new BadRequestException('Variable root is not supported.');
  }
  for (const segment of segments) {
    if (
      !/^[A-Za-z0-9_-]{1,80}$/.test(segment) ||
      ['__proto__', 'prototype', 'constructor'].includes(segment)
    ) {
      throw new BadRequestException('Variable path is not safe.');
    }
  }
}

function validateTriggerConfig(config: Record<string, unknown>, path: string) {
  assertAllowedKeys(config, ['triggerType', 'fromStatusId', 'toStatusId'], path);
  const triggerType = enumValue(
    config.triggerType,
    automationTriggerTypes,
    `${path}.triggerType`,
  ) as AutomationTriggerType;
  const supportsStatusFilters =
    triggerType === AutomationTriggerType.TASK_STATUS_CHANGED ||
    triggerType === AutomationTriggerType.PROJECT_STATUS_CHANGED ||
    triggerType === AutomationTriggerType.TICKET_STATUS_CHANGED;
  for (const key of ['fromStatusId', 'toStatusId'] as const) {
    if (config[key] === undefined || config[key] === null) continue;
    if (!supportsStatusFilters) {
      throw new BadRequestException(`${path}.${key} is only supported for status triggers.`);
    }
    const value = stringValue(config[key], `${path}.${key}`);
    if (!uuidPattern.test(value)) throw new BadRequestException(`${path}.${key} must be a UUID.`);
  }
}

export function validateAutomationActionConfig(
  config: Record<string, unknown>,
  path = 'action.config',
) {
  const actionType = enumValue(config.actionType, automationActionTypes, `${path}.actionType`);
  if (unavailableActionTypes.has(actionType as AutomationActionType)) {
    throw new BadRequestException({
      code: 'AUTOMATION_ACTION_NOT_AVAILABLE',
      message: `${path}.actionType is not available.`,
    });
  }
  const schema = actionSchemas[actionType as AutomationActionType];
  assertAllowedKeys(config, schema.allowedKeys, path);
  for (const key of schema.requiredKeys) {
    if (config[key] === undefined || config[key] === null) {
      throw new BadRequestException(`${path}.${key} is required.`);
    }
  }
  for (const [key, fieldType] of Object.entries(schema.fields) as Array<
    [string, ActionFieldType]
  >) {
    if (config[key] === undefined || config[key] === null) continue;
    validateActionField(config[key], fieldType, `${path}.${key}`);
  }
  return config as Record<string, unknown> & { actionType: AutomationActionType };
}

function validateGraph(definition: AutomationDefinition) {
  const nodeIds = new Set<string>();
  for (const node of definition.nodes) {
    if (nodeIds.has(node.nodeId))
      throw new BadRequestException('Duplicate node ids are not allowed.');
    nodeIds.add(node.nodeId);
  }
  const triggerNodes = definition.nodes.filter(
    (node) => node.type === AutomationWorkflowNodeType.TRIGGER,
  );
  if (triggerNodes.length !== 1) {
    throw new BadRequestException('Exactly one trigger node is required.');
  }
  const triggerType = triggerNodes[0]?.config.triggerType;
  if (definition.trigger.triggerType !== triggerType) {
    throw new BadRequestException('Trigger definition must match the trigger node.');
  }
  const nodesById = new Map(definition.nodes.map((node) => [node.nodeId, node]));
  const outgoing = new Map<string, AutomationEdgeDefinition[]>();
  const edgeKeys = new Set<string>();
  for (const edge of definition.edges) {
    if (!nodeIds.has(edge.fromNodeId) || !nodeIds.has(edge.toNodeId)) {
      throw new BadRequestException('Workflow edges must reference existing nodes.');
    }
    const edgeKey = `${edge.fromNodeId}->${edge.toNodeId}:${edge.branchKey ?? ''}`;
    if (edgeKeys.has(edgeKey)) {
      throw new BadRequestException('Duplicate workflow edges are not allowed.');
    }
    edgeKeys.add(edgeKey);
    outgoing.set(edge.fromNodeId, [...(outgoing.get(edge.fromNodeId) ?? []), edge]);
  }
  for (const node of definition.nodes) {
    const edges = outgoing.get(node.nodeId) ?? [];
    if (
      node.type === AutomationWorkflowNodeType.TRIGGER ||
      node.type === AutomationWorkflowNodeType.ACTION
    ) {
      if (edges.length > 1 || edges.some((edge) => edge.branchKey)) {
        throw new BadRequestException('Workflow graph cannot contain parallel action fan-out.');
      }
      continue;
    }
    if (node.type === AutomationWorkflowNodeType.CONDITION) {
      const keys = edges.map((edge) => edge.branchKey);
      if (
        edges.length !== 2 ||
        keys.filter((key) => key === 'TRUE').length !== 1 ||
        keys.filter((key) => key === 'FALSE').length !== 1
      ) {
        throw new BadRequestException('Condition nodes require TRUE and FALSE edges.');
      }
      continue;
    }
    if (node.type === AutomationWorkflowNodeType.BRANCH) {
      const cases = Array.isArray(node.config.cases) ? node.config.cases : [];
      const requiredKeys = new Set<string>(
        cases
          .map((item) => String((item as { key?: unknown }).key))
          .concat(String(node.config.defaultKey)),
      );
      const edgeBranchKeys = edges.map((edge) => edge.branchKey).filter(Boolean) as string[];
      if (edgeBranchKeys.length !== edges.length || edgeBranchKeys.length !== requiredKeys.size) {
        throw new BadRequestException('Branch edges must match configured branch keys.');
      }
      for (const key of edgeBranchKeys) {
        if (!requiredKeys.has(key)) throw new BadRequestException('Branch edge key is invalid.');
        requiredKeys.delete(key);
      }
      if (requiredKeys.size > 0) throw new BadRequestException('Branch edges are incomplete.');
    }
    if (
      node.type === AutomationWorkflowNodeType.DELAY &&
      (outgoing.get(node.nodeId) ?? []).length > 0
    ) {
      const target = nodesById.get((outgoing.get(node.nodeId) ?? [])[0]?.toNodeId ?? '');
      if (!target) throw new BadRequestException('Workflow edges must reference existing nodes.');
    }
  }
  assertAcyclic(
    definition.nodes.map((node) => node.nodeId),
    definition.edges,
  );
}

function assertAcyclic(nodeIds: string[], edges: AutomationEdgeDefinition[]) {
  const graph = new Map(nodeIds.map((nodeId) => [nodeId, [] as string[]]));
  for (const edge of edges) graph.get(edge.fromNodeId)?.push(edge.toNodeId);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(nodeId: string) {
    if (visiting.has(nodeId))
      throw new BadRequestException('Workflow graph cannot contain cycles.');
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    for (const next of graph.get(nodeId) ?? []) visit(next);
    visiting.delete(nodeId);
    visited.add(nodeId);
  }
  for (const nodeId of nodeIds) visit(nodeId);
}

function validateActionField(value: unknown, fieldType: ActionFieldType, path: string) {
  if (fieldType === 'uuid-array') {
    if (!Array.isArray(value)) throw new BadRequestException(`${path} must be an array.`);
    for (const [index, item] of value.entries()) validateUuidOrReference(item, `${path}[${index}]`);
    return;
  }
  if (fieldType === 'uuid') {
    validateUuidOrReference(value, path);
    return;
  }
  if (fieldType === 'priority') {
    validateEnumOrReference(value, Object.values(TaskPriority), path);
    return;
  }
  if (fieldType === 'project-visibility') {
    validateEnumOrReference(value, Object.values(ProjectVisibility), path);
    return;
  }
  if (fieldType === 'xp-category') {
    validateEnumOrReference(value, Object.values(ProjectXpCategory), path);
    return;
  }
  if (fieldType === 'date') {
    validateDateOrReference(value, path);
    return;
  }
  validateBoundedStringOrReference(value, path, fieldType === 'short-string' ? 160 : 1000);
}

function validateUuidOrReference(value: unknown, path: string) {
  const text = stringValue(value, path);
  if (uuidPattern.test(text) || variablePattern.test(text)) return;
  throw new BadRequestException(`${path} must be a UUID or supported trigger variable reference.`);
}

function validateEnumOrReference(value: unknown, allowed: readonly string[], path: string) {
  const text = stringValue(value, path);
  if (variablePattern.test(text) || allowed.includes(text)) return;
  throw new BadRequestException(`${path} is not supported.`);
}

function validateDateOrReference(value: unknown, path: string) {
  const text = stringValue(value, path);
  if (variablePattern.test(text)) return;
  validateNoMalformedReference(text, path);
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw new BadRequestException(`${path} must be a date string.`);
}

function validateBoundedStringOrReference(value: unknown, path: string, maxLength: number) {
  const text = stringValue(value, path);
  validateNoMalformedReference(text, path);
  if (text.length > maxLength) {
    throw new BadRequestException(`${path} cannot exceed ${maxLength} characters.`);
  }
}

function validateNoMalformedReference(text: string, path: string) {
  if (text.includes('{{') && !variablePattern.test(text)) {
    throw new BadRequestException(`${path} contains an unsupported variable reference.`);
  }
}

function validateNoSecretLikeKeys(value: unknown, path: string[]) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateNoSecretLikeKeys(item, [...path, String(index)]));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (secretKeyPattern.test(key)) {
      throw new BadRequestException(
        `Secret-like workflow config is not allowed at ${[...path, key].join('.')}.`,
      );
    }
    validateNoSecretLikeKeys(child, [...path, key]);
  }
}

function ensurePlainObject(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertAllowedKeys(value: Record<string, unknown>, allowedKeys: string[], path: string) {
  const allowed = new Set(allowedKeys);
  const unsupportedKeys = Object.keys(value).filter((key) => !allowed.has(key));
  if (unsupportedKeys.length > 0) {
    throw new BadRequestException(`${path} contains unsupported configuration keys.`);
  }
}

function stringValue(value: unknown, path: string) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BadRequestException(`${path} must be a non-empty string.`);
  }
  return value.trim();
}

function enumValue(value: unknown, allowed: readonly string[], path: string) {
  const text = stringValue(value, path);
  if (!allowed.includes(text)) throw new BadRequestException(`${path} is not supported.`);
  return text;
}
