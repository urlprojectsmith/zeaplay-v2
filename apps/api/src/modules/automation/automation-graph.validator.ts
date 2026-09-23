import { BadRequestException } from '@nestjs/common';
import { AutomationConditionOperator, AutomationWorkflowNodeType, Prisma } from '@prisma/client';
import {
  AUTOMATION_MAX_DEFINITION_BYTES,
  AUTOMATION_MAX_EDGES,
  AUTOMATION_MAX_NODES,
  automationActionTypes,
  automationConditionOperators,
  automationNodeTypes,
  automationTriggerTypes,
} from './automation.constants';

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
const variablePattern = /^\{\{trigger\.[A-Za-z0-9_.-]{1,120}\}\}$/;
const secretKeyPattern =
  /(api[_-]?key|password|secret|token|access[_-]?token|refresh[_-]?token|smtp|credential)/i;

export function validateAutomationDefinition(input: AutomationDefinition): {
  definition: AutomationDefinition;
  definitionSizeBytes: number;
} {
  const trigger = ensurePlainObject(input.trigger, 'trigger');
  assertAllowedKeys(trigger, ['triggerType'], 'trigger');
  const definition = {
    trigger,
    nodes: validateNodes(input.nodes),
    edges: validateEdges(input.edges),
    settings: ensurePlainObject(input.settings ?? {}, 'settings'),
  };
  validateNoSecretLikeKeys(definition, []);
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
    assertAllowedKeys(config, ['triggerType'], `nodes[${index}].config`);
    enumValue(config.triggerType, automationTriggerTypes, `nodes[${index}].config.triggerType`);
    return;
  }
  if (type === AutomationWorkflowNodeType.ACTION) {
    assertAllowedKeys(config, ['actionType'], `nodes[${index}].config`);
    enumValue(config.actionType, automationActionTypes, `nodes[${index}].config.actionType`);
    return;
  }
  if (type === AutomationWorkflowNodeType.CONDITION) {
    assertAllowedKeys(config, ['operator', 'field', 'value'], `nodes[${index}].config`);
    enumValue(config.operator, automationConditionOperators, `nodes[${index}].config.operator`);
    validateSafeReference(config.field, `nodes[${index}].config.field`);
    if (
      config.operator === AutomationConditionOperator.IN ||
      config.operator === AutomationConditionOperator.NOT_IN
    ) {
      if (!Array.isArray(config.value)) {
        throw new BadRequestException(`nodes[${index}].config.value must be an array.`);
      }
      return;
    }
    if (
      config.operator !== AutomationConditionOperator.EXISTS &&
      config.operator !== AutomationConditionOperator.NOT_EXISTS &&
      config.value === undefined
    ) {
      throw new BadRequestException(`nodes[${index}].config.value is required.`);
    }
    return;
  }
  assertAllowedKeys(config, [], `nodes[${index}].config`);
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

function validateSafeReference(value: unknown, path: string) {
  const reference = stringValue(value, path);
  if (!variablePattern.test(reference)) {
    throw new BadRequestException(`${path} must be a supported trigger variable reference.`);
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
