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

export interface AutomationListResponse {
  items: AutomationWorkflow[];
  total: number;
  page: number;
  pageSize: number;
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

export const automationKeys = {
  all: (workspaceId: string | null) => ['workspace', workspaceId, 'automations'] as const,
  list: (workspaceId: string | null, page: number) =>
    ['workspace', workspaceId, 'automations', page] as const,
};

export async function listWorkspaceAutomations(workspaceId: string, page = 1) {
  const response = await apiClient.request<AutomationListResponse>(
    `/workspaces/${workspaceId}/automations?page=${page}&pageSize=20`,
  );
  return response.data;
}

export async function createWorkspaceAutomation(
  workspaceId: string,
  body: { name: string; description?: string | null; triggerType: AutomationTriggerType },
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

export async function updateAutomationDraft(
  workspaceId: string,
  workflowId: string,
  triggerType: AutomationTriggerType,
) {
  const response = await apiClient.request<AutomationWorkflowVersion>(
    `/workspaces/${workspaceId}/automations/${workflowId}/draft`,
    { method: 'PATCH', body: JSON.stringify(definitionPayload({ triggerType })) },
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
}) {
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
    ],
    edges: [],
    settings: {},
  };
}
