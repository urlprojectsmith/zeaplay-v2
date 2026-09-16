import { apiClient } from './api';

export type StatusEntityType = 'TASK' | 'PROJECT' | 'TICKET';

export type StatusCategory =
  'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'COMPLETED' | 'CANCELLED';

export interface WorkspaceStatusDefinition {
  id: string;
  workspaceId: string;
  entityType: StatusEntityType;
  name: string;
  description: string | null;
  color: string;
  position: number;
  category: StatusCategory;
  isDefault: boolean;
  isTerminal: boolean;
  isActive: boolean;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StatusFormPayload {
  name: string;
  description?: string | null;
  color: string;
  category: StatusCategory;
  isTerminal?: boolean;
}

export const statusKeys = {
  all: (workspaceId: string | null) => ['workspace', workspaceId, 'statuses'] as const,
  list: (
    workspaceId: string | null,
    entityType: StatusEntityType | null,
    filter: 'ALL' | 'ACTIVE' | 'INACTIVE' = 'ALL',
  ) => ['workspace', workspaceId, 'statuses', entityType, filter] as const,
  detail: (
    workspaceId: string | null,
    entityType: StatusEntityType | null,
    statusId: string | null,
  ) => ['workspace', workspaceId, 'statuses', entityType, statusId] as const,
};

export async function listWorkspaceStatuses(
  workspaceId: string,
  entityType: StatusEntityType,
  filter: 'ALL' | 'ACTIVE' | 'INACTIVE' = 'ALL',
) {
  const activeQuery = filter === 'ALL' ? '' : `?isActive=${filter === 'ACTIVE' ? 'true' : 'false'}`;
  const response = await apiClient.request<WorkspaceStatusDefinition[]>(
    `/workspaces/${workspaceId}/statuses/${entityType}${activeQuery}`,
  );
  return response.data;
}

export async function createWorkspaceStatus(
  workspaceId: string,
  entityType: StatusEntityType,
  body: StatusFormPayload,
) {
  const response = await apiClient.request<WorkspaceStatusDefinition>(
    `/workspaces/${workspaceId}/statuses/${entityType}`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  return response.data;
}

export async function updateWorkspaceStatus(
  workspaceId: string,
  entityType: StatusEntityType,
  statusId: string,
  body: Partial<StatusFormPayload> & { isActive?: boolean },
) {
  const response = await apiClient.request<WorkspaceStatusDefinition>(
    `/workspaces/${workspaceId}/statuses/${entityType}/${statusId}`,
    { method: 'PATCH', body: JSON.stringify(body) },
  );
  return response.data;
}

export async function setWorkspaceStatusDefault(
  workspaceId: string,
  entityType: StatusEntityType,
  statusId: string,
) {
  const response = await apiClient.request<WorkspaceStatusDefinition>(
    `/workspaces/${workspaceId}/statuses/${entityType}/${statusId}/set-default`,
    { method: 'POST' },
  );
  return response.data;
}

export async function reorderWorkspaceStatuses(
  workspaceId: string,
  entityType: StatusEntityType,
  orderedStatusIds: string[],
) {
  const response = await apiClient.request<WorkspaceStatusDefinition[]>(
    `/workspaces/${workspaceId}/statuses/${entityType}/reorder`,
    { method: 'PATCH', body: JSON.stringify({ orderedStatusIds }) },
  );
  return response.data;
}

export async function initializeWorkspaceStatusDefaults(workspaceId: string) {
  const response = await apiClient.request<WorkspaceStatusDefinition[]>(
    `/workspaces/${workspaceId}/statuses/initialize-defaults`,
    { method: 'POST' },
  );
  return response.data;
}
