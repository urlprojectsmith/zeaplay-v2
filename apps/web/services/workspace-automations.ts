import { apiClient } from './api';

export type AutomationWorkflowStatus = 'DRAFT' | 'PUBLISHED' | 'DISABLED' | 'ARCHIVED';
export type AutomationTriggerType =
  | 'TASK_CREATED'
  | 'TASK_STATUS_CHANGED'
  | 'TASK_COMPLETED'
  | 'PROJECT_CREATED'
  | 'PROJECT_STATUS_CHANGED'
  | 'PROJECT_COMPLETED'
  | 'TICKET_CREATED'
  | 'TICKET_STATUS_CHANGED'
  | 'TICKET_RESOLVED';
export type AutomationActionType =
  | 'CREATE_TASK'
  | 'UPDATE_TASK'
  | 'ASSIGN_TASK'
  | 'CHANGE_TASK_STATUS'
  | 'ADD_TASK_TAG'
  | 'UPDATE_PROJECT'
  | 'CHANGE_PROJECT_STATUS'
  | 'ASSIGN_TICKET'
  | 'CHANGE_TICKET_STATUS'
  | 'ADD_TICKET_TAG';

export interface AutomationActionDraft {
  actionType: AutomationActionType;
  title?: string;
  targetId?: string;
  statusDefinitionId?: string;
}

export type AutomationConditionOperator =
  'EQUALS' | 'NOT_EQUALS' | 'IN' | 'NOT_IN' | 'EXISTS' | 'NOT_EXISTS';

export interface AutomationConditionDraft {
  left: string;
  operator: AutomationConditionOperator;
  right?: string;
}

export interface AutomationBranchCaseDraft extends AutomationConditionDraft {
  key: string;
}

export interface AutomationBranchDraft {
  cases: AutomationBranchCaseDraft[];
  defaultKey: string;
}

export interface AutomationWorkflow {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  status: AutomationWorkflowStatus;
  activePublishedVersionId: string | null;
  currentVersion: number | null;
  hasDraft: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  versions?: AutomationWorkflowVersion[];
}

export interface AutomationWorkflowVersion {
  id: string;
  workflowId: string;
  workspaceId: string;
  versionNumber: number | null;
  state: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  triggerDefinition: { triggerType?: AutomationTriggerType };
  nodesDefinition: { nodeId: string; type: string; config: Record<string, unknown> }[];
  edgesDefinition: { fromNodeId: string; toNodeId: string; branchKey?: string | null }[];
  settingsDefinition: Record<string, unknown>;
  definitionSizeBytes: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface AutomationWorkflowTemplate {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  definitionVersion: string;
  triggerDefinition?: { triggerType?: AutomationTriggerType };
  nodesDefinition?: AutomationNodeDefinition[];
  edgesDefinition?: AutomationEdgeDefinition[];
  settingsDefinition?: Record<string, unknown>;
  definitionSizeBytes: number;
  sourceWorkflowId: string | null;
  sourceWorkflowVersionId: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AutomationNodeType = 'TRIGGER' | 'ACTION' | 'CONDITION' | 'BRANCH' | 'DELAY';

export interface AutomationNodeDefinition {
  nodeId: string;
  type: AutomationNodeType;
  config: Record<string, unknown>;
}

export interface AutomationEdgeDefinition {
  fromNodeId: string;
  toNodeId: string;
  branchKey?: string | null;
}

export interface AutomationDefinitionPayload {
  trigger: Record<string, unknown>;
  nodes: AutomationNodeDefinition[];
  edges: AutomationEdgeDefinition[];
  settings: Record<string, unknown>;
  expectedUpdatedAtMs?: number;
}

export interface AutomationListResponse {
  items: AutomationWorkflow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AutomationTemplateListResponse {
  items: AutomationWorkflowTemplate[];
  total: number;
  page: number;
  pageSize: number;
}

export type AutomationExecutionStatus =
  | 'PENDING_QUEUE'
  | 'QUEUED'
  | 'RUNNING'
  | 'RETRYING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'DEAD_LETTERED'
  | 'BLOCKED';

export interface AutomationExecutionSummary {
  id: string;
  shortRef: string;
  workflowId: string;
  workflowName: string;
  workflowVersion: number | null;
  workflowVersionId: string;
  triggerEvent: AutomationTriggerType;
  status: AutomationExecutionStatus;
  correlationId: string;
  attemptCount: number;
  maxAttempts: number;
  failureCode: string | null;
  failureMessage: string | null;
  replayOfExecutionId: string | null;
  createdAt: string;
  queuedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
}

export interface AutomationExecutionDetail extends AutomationExecutionSummary {
  automationDepth: number;
  domainEvent: {
    id: string;
    eventType: AutomationTriggerType;
    entityType: string;
    entityId: string;
    occurredAt: string;
  };
  triggerMatch: { id: string; triggerNodeId: string; status: string; reasonCode: string | null };
  replayReason: string | null;
  steps: Array<{
    id: string;
    nodeId: string;
    nodeType: AutomationNodeType;
    sequence: number;
    actionType: AutomationActionType | null;
    selectedBranchKey: string | null;
    conditionResult: boolean | null;
    status: string;
    attemptCount: number;
    resultSummary: Record<string, unknown> | null;
    failureSummary: { code: string; message: string | null } | null;
    startedAt: string | null;
    finishedAt: string | null;
    durationMs: number | null;
  }>;
}

export interface AutomationRuntimePolicy {
  effective: {
    maxPublishedWorkflows: number;
    maxExecutionsPerMinute: number;
    maxConcurrentExecutions: number;
    maxActionsPerExecution: number;
    maxReplaysPerHour: number;
  };
  source: 'PLATFORM_DEFAULT' | 'WORKSPACE_OVERRIDE';
  override: AutomationRuntimePolicy['effective'] | null;
  platformCaps: AutomationRuntimePolicy['effective'] & {
    maxRetryAttempts: number;
    maxAutomationDepth: number;
  };
}

export const automationTriggerTypes: AutomationTriggerType[] = [
  'TASK_CREATED',
  'TASK_STATUS_CHANGED',
  'TASK_COMPLETED',
  'PROJECT_CREATED',
  'PROJECT_STATUS_CHANGED',
  'PROJECT_COMPLETED',
  'TICKET_CREATED',
  'TICKET_STATUS_CHANGED',
  'TICKET_RESOLVED',
];

export const automationActionTypes: AutomationActionType[] = [
  'CREATE_TASK',
  'UPDATE_TASK',
  'ASSIGN_TASK',
  'CHANGE_TASK_STATUS',
  'ADD_TASK_TAG',
  'UPDATE_PROJECT',
  'CHANGE_PROJECT_STATUS',
  'ASSIGN_TICKET',
  'CHANGE_TICKET_STATUS',
];

export const automationKeys = {
  all: (workspaceId: string | null) => ['workspace', workspaceId, 'automations'] as const,
  list: (workspaceId: string | null, page: number) =>
    ['workspace', workspaceId, 'automations', page] as const,
  detail: (workspaceId: string | null, workflowId: string | null) =>
    ['workspace', workspaceId, 'automations', workflowId] as const,
  templates: (workspaceId: string | null, page: number) =>
    ['workspace', workspaceId, 'automation-templates', page] as const,
  templateDetail: (workspaceId: string | null, templateId: string | null) =>
    ['workspace', workspaceId, 'automation-templates', templateId] as const,
  executions: (workspaceId: string | null, page: number, status?: string) =>
    ['workspace', workspaceId, 'automation-executions', page, status ?? 'all'] as const,
  executionDetail: (workspaceId: string | null, executionId: string | null) =>
    ['workspace', workspaceId, 'automation-executions', executionId] as const,
  runtimePolicy: (workspaceId: string | null) =>
    ['workspace', workspaceId, 'automation-runtime-policy'] as const,
  health: (workspaceId: string | null) => ['workspace', workspaceId, 'automation-health'] as const,
};

export async function listWorkspaceAutomations(workspaceId: string, page = 1) {
  const response = await apiClient.request<AutomationListResponse>(
    `/workspaces/${workspaceId}/automations?page=${page}&pageSize=20`,
  );
  return response.data;
}

export async function getWorkspaceAutomation(workspaceId: string, workflowId: string) {
  const response = await apiClient.request<AutomationWorkflow>(
    `/workspaces/${workspaceId}/automations/${workflowId}`,
  );
  return response.data;
}

export async function listAutomationVersions(workspaceId: string, workflowId: string, page = 1) {
  const response = await apiClient.request<{
    items: AutomationWorkflowVersion[];
    total: number;
    page: number;
    pageSize: number;
  }>(`/workspaces/${workspaceId}/automations/${workflowId}/versions?page=${page}&pageSize=50`);
  return response.data;
}

export async function createWorkspaceAutomation(
  workspaceId: string,
  body: {
    name: string;
    description?: string | null;
    triggerType: AutomationTriggerType;
    action?: AutomationActionDraft | null;
    condition?: AutomationConditionDraft | null;
    branch?: AutomationBranchDraft | null;
  },
) {
  const response = await apiClient.request<AutomationWorkflow>(
    `/workspaces/${workspaceId}/automations`,
    {
      method: 'POST',
      body: JSON.stringify(definitionPayload(body)),
    },
  );
  return response.data;
}

export async function cloneWorkspaceAutomation(
  workspaceId: string,
  workflowId: string,
  body: { name?: string; sourceVersionId?: string },
) {
  const response = await apiClient.request<AutomationWorkflow>(
    `/workspaces/${workspaceId}/automations/${workflowId}/clone`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  return response.data;
}

export async function createAutomationDraftFromVersion(
  workspaceId: string,
  workflowId: string,
  versionId: string,
) {
  const response = await apiClient.request<AutomationWorkflowVersion>(
    `/workspaces/${workspaceId}/automations/${workflowId}/versions/${versionId}/create-draft`,
    { method: 'POST' },
  );
  return response.data;
}

export async function listAutomationTemplates(workspaceId: string, page = 1) {
  const response = await apiClient.request<AutomationTemplateListResponse>(
    `/workspaces/${workspaceId}/automation-templates?page=${page}&pageSize=20`,
  );
  return response.data;
}

export async function getAutomationTemplate(workspaceId: string, templateId: string) {
  const response = await apiClient.request<AutomationWorkflowTemplate>(
    `/workspaces/${workspaceId}/automation-templates/${templateId}`,
  );
  return response.data;
}

export async function createAutomationTemplate(
  workspaceId: string,
  body: {
    name: string;
    description?: string | null;
    sourceWorkflowId: string;
    sourceWorkflowVersionId?: string;
  },
) {
  const response = await apiClient.request<AutomationWorkflowTemplate>(
    `/workspaces/${workspaceId}/automation-templates`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  return response.data;
}

export async function useAutomationTemplate(
  workspaceId: string,
  templateId: string,
  body: { name?: string; description?: string | null },
) {
  const response = await apiClient.request<AutomationWorkflow>(
    `/workspaces/${workspaceId}/automation-templates/${templateId}/use`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  return response.data;
}

export async function archiveAutomationTemplate(workspaceId: string, templateId: string) {
  const response = await apiClient.request<AutomationWorkflowTemplate>(
    `/workspaces/${workspaceId}/automation-templates/${templateId}`,
    { method: 'DELETE' },
  );
  return response.data;
}

export async function listAutomationExecutions(
  workspaceId: string,
  params: { page?: number; status?: AutomationExecutionStatus; workflowId?: string } = {},
) {
  const query = new URLSearchParams({
    page: String(params.page ?? 1),
    pageSize: '20',
  });
  if (params.status) query.set('status', params.status);
  if (params.workflowId) query.set('workflowId', params.workflowId);
  const response = await apiClient.request<{
    items: AutomationExecutionSummary[];
    total: number;
    page: number;
    pageSize: number;
  }>(`/workspaces/${workspaceId}/automations/executions?${query.toString()}`);
  return response.data;
}

export async function getAutomationExecution(workspaceId: string, executionId: string) {
  const response = await apiClient.request<AutomationExecutionDetail>(
    `/workspaces/${workspaceId}/automations/executions/${executionId}`,
  );
  return response.data;
}

export async function replayAutomationExecution(
  workspaceId: string,
  executionId: string,
  body: { reason: string; confirmation: 'REPLAY'; idempotencyKey: string },
) {
  const response = await apiClient.request<AutomationExecutionDetail>(
    `/workspaces/${workspaceId}/automations/executions/${executionId}/replay`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  return response.data;
}

export async function getAutomationRuntimePolicy(workspaceId: string) {
  const response = await apiClient.request<AutomationRuntimePolicy>(
    `/workspaces/${workspaceId}/automations/runtime-policy`,
  );
  return response.data;
}

export async function updateAutomationRuntimePolicy(
  workspaceId: string,
  body: AutomationRuntimePolicy['effective'],
) {
  const response = await apiClient.request<AutomationRuntimePolicy>(
    `/workspaces/${workspaceId}/automations/runtime-policy`,
    { method: 'PATCH', body: JSON.stringify(body) },
  );
  return response.data;
}

export async function getAutomationHealth(workspaceId: string) {
  const response = await apiClient.request<{
    publishedWorkflows: number;
    executionsLast24h: number;
    succeeded: number;
    failed: number;
    deadLettered: number;
    running: number;
    successRate: number | null;
    averageDurationMs: number | null;
    replaysLast24h: number;
  }>(`/workspaces/${workspaceId}/automations/automation-health`);
  return response.data;
}

export async function updateAutomationDraft(
  workspaceId: string,
  workflowId: string,
  triggerType: AutomationTriggerType,
  action?: AutomationActionDraft | null,
  condition?: AutomationConditionDraft | null,
  branch?: AutomationBranchDraft | null,
) {
  const response = await apiClient.request<AutomationWorkflowVersion>(
    `/workspaces/${workspaceId}/automations/${workflowId}/draft`,
    {
      method: 'PATCH',
      body: JSON.stringify(definitionPayload({ triggerType, action, condition, branch })),
    },
  );
  return response.data;
}

export async function updateAutomationDraftDefinition(
  workspaceId: string,
  workflowId: string,
  body: AutomationDefinitionPayload,
) {
  const response = await apiClient.request<AutomationWorkflowVersion>(
    `/workspaces/${workspaceId}/automations/${workflowId}/draft`,
    { method: 'PATCH', body: JSON.stringify(body) },
  );
  return response.data;
}

export async function publishAutomation(workspaceId: string, workflowId: string) {
  const response = await apiClient.request<AutomationWorkflowVersion>(
    `/workspaces/${workspaceId}/automations/${workflowId}/publish`,
    { method: 'POST' },
  );
  return response.data;
}

export async function disableAutomation(workspaceId: string, workflowId: string) {
  const response = await apiClient.request<AutomationWorkflow>(
    `/workspaces/${workspaceId}/automations/${workflowId}/disable`,
    { method: 'POST' },
  );
  return response.data;
}

export async function enableAutomation(workspaceId: string, workflowId: string) {
  const response = await apiClient.request<AutomationWorkflow>(
    `/workspaces/${workspaceId}/automations/${workflowId}/enable`,
    { method: 'POST' },
  );
  return response.data;
}

function definitionPayload(input: {
  name?: string;
  description?: string | null;
  triggerType: AutomationTriggerType;
  action?: AutomationActionDraft | null;
  condition?: AutomationConditionDraft | null;
  branch?: AutomationBranchDraft | null;
}) {
  const actionConfig = input.action ? actionConfigFromDraft(input.action) : null;
  const trueAction = actionConfig ?? {
    actionType: 'CREATE_TASK' as const,
    title: 'Automation task',
  };
  if (input.condition) {
    return {
      name: input.name,
      description: input.description,
      trigger: { triggerType: input.triggerType },
      nodes: [
        { nodeId: 'trigger', type: 'TRIGGER', config: { triggerType: input.triggerType } },
        { nodeId: 'condition', type: 'CONDITION', config: compactConfig(input.condition) },
        { nodeId: 'true-action', type: 'ACTION', config: trueAction },
        {
          nodeId: 'false-action',
          type: 'ACTION',
          config: { actionType: 'CREATE_TASK', title: 'Automation condition fallback' },
        },
      ],
      edges: [
        { fromNodeId: 'trigger', toNodeId: 'condition' },
        { fromNodeId: 'condition', toNodeId: 'true-action', branchKey: 'TRUE' },
        { fromNodeId: 'condition', toNodeId: 'false-action', branchKey: 'FALSE' },
      ],
      settings: {},
    };
  }
  if (input.branch) {
    return {
      name: input.name,
      description: input.description,
      trigger: { triggerType: input.triggerType },
      nodes: [
        { nodeId: 'trigger', type: 'TRIGGER', config: { triggerType: input.triggerType } },
        { nodeId: 'branch', type: 'BRANCH', config: input.branch },
        { nodeId: 'case-action', type: 'ACTION', config: trueAction },
        {
          nodeId: 'default-action',
          type: 'ACTION',
          config: { actionType: 'CREATE_TASK', title: 'Automation branch default' },
        },
      ],
      edges: [
        { fromNodeId: 'trigger', toNodeId: 'branch' },
        {
          fromNodeId: 'branch',
          toNodeId: 'case-action',
          branchKey: input.branch.cases[0]?.key ?? 'HIGH',
        },
        { fromNodeId: 'branch', toNodeId: 'default-action', branchKey: input.branch.defaultKey },
      ],
      settings: {},
    };
  }
  return {
    name: input.name,
    description: input.description,
    trigger: { triggerType: input.triggerType },
    nodes: [
      {
        nodeId: 'trigger',
        type: 'TRIGGER',
        config: { triggerType: input.triggerType },
      },
      ...(actionConfig
        ? [
            {
              nodeId: 'action',
              type: 'ACTION',
              config: actionConfig,
            },
          ]
        : []),
    ],
    edges: actionConfig ? [{ fromNodeId: 'trigger', toNodeId: 'action' }] : [],
    settings: {},
  };
}

function compactConfig(value: object) {
  return Object.fromEntries(
    Object.entries(value).filter((entry) => entry[1] !== undefined && entry[1] !== ''),
  );
}

function actionConfigFromDraft(action: AutomationActionDraft) {
  const targetId = action.targetId?.trim();
  const statusDefinitionId = action.statusDefinitionId?.trim();
  if (action.actionType === 'CREATE_TASK') {
    return { actionType: action.actionType, title: action.title?.trim() || 'Automation task' };
  }
  if (action.actionType === 'UPDATE_TASK' && targetId)
    return { actionType: action.actionType, taskId: targetId };
  if (action.actionType === 'ASSIGN_TASK' && targetId) {
    return { actionType: action.actionType, taskId: targetId, membershipIds: [] };
  }
  if (action.actionType === 'CHANGE_TASK_STATUS' && targetId && statusDefinitionId) {
    return { actionType: action.actionType, taskId: targetId, statusDefinitionId };
  }
  if (action.actionType === 'ADD_TASK_TAG' && targetId) {
    return { actionType: action.actionType, taskId: targetId, tagIds: [] };
  }
  if (action.actionType === 'UPDATE_PROJECT' && targetId) {
    return { actionType: action.actionType, projectId: targetId };
  }
  if (action.actionType === 'CHANGE_PROJECT_STATUS' && targetId && statusDefinitionId) {
    return { actionType: action.actionType, projectId: targetId, statusDefinitionId };
  }
  if (action.actionType === 'ASSIGN_TICKET' && targetId) {
    return { actionType: action.actionType, ticketId: targetId };
  }
  if (action.actionType === 'CHANGE_TICKET_STATUS' && targetId && statusDefinitionId) {
    return { actionType: action.actionType, ticketId: targetId, statusDefinitionId };
  }
  return { actionType: 'CREATE_TASK' as const, title: action.title?.trim() || 'Automation task' };
}
