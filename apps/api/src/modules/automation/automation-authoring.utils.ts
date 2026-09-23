import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { AutomationDefinition } from './automation-graph.validator';

export interface AutomationVersionSnapshot {
  definitionVersion: string;
  triggerDefinition: Prisma.JsonValue;
  nodesDefinition: Prisma.JsonValue;
  edgesDefinition: Prisma.JsonValue;
  settingsDefinition: Prisma.JsonValue;
  definitionSizeBytes: number;
}

export function definitionFromVersionSnapshot(
  version: Pick<
    AutomationVersionSnapshot,
    'triggerDefinition' | 'nodesDefinition' | 'edgesDefinition' | 'settingsDefinition'
  >,
): AutomationDefinition {
  return {
    trigger: cloneJson(version.triggerDefinition) as Record<string, unknown>,
    nodes: cloneJson(version.nodesDefinition) as AutomationDefinition['nodes'],
    edges: cloneJson(version.edgesDefinition) as AutomationDefinition['edges'],
    settings: cloneJson(version.settingsDefinition) as Record<string, unknown>,
  };
}

export function cloneAutomationDefinitionForAuthoring(definition: AutomationDefinition) {
  const idMap = new Map<string, string>();
  for (const node of definition.nodes) idMap.set(node.nodeId, nextNodeId());

  const remapped: AutomationDefinition = {
    trigger: rewriteStepReferences(cloneJson(definition.trigger), idMap) as Record<string, unknown>,
    nodes: definition.nodes.map((node) => ({
      ...node,
      nodeId: idMap.get(node.nodeId) ?? node.nodeId,
      config: rewriteStepReferences(cloneJson(node.config), idMap) as Record<string, unknown>,
    })),
    edges: definition.edges.map((edge) => ({
      ...edge,
      fromNodeId: idMap.get(edge.fromNodeId) ?? edge.fromNodeId,
      toNodeId: idMap.get(edge.toNodeId) ?? edge.toNodeId,
    })),
    settings: rewriteStepReferences(cloneJson(definition.settings), idMap) as Record<
      string,
      unknown
    >,
  };

  return { definition: remapped, nodeIdMap: Object.fromEntries(idMap) };
}

function nextNodeId() {
  return `n_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

function rewriteStepReferences(value: unknown, idMap: Map<string, string>): unknown {
  if (typeof value === 'string') {
    return value.replace(
      /(\{\{\s*steps\.)([A-Za-z0-9_-]{1,80})(?=\.)/g,
      (match, prefix, nodeId) => {
        const nextId = idMap.get(nodeId);
        return nextId ? `${prefix}${nextId}` : match;
      },
    );
  }
  if (Array.isArray(value)) return value.map((item) => rewriteStepReferences(item, idMap));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, rewriteStepReferences(child, idMap)]),
  );
}

function cloneJson(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as unknown;
}
