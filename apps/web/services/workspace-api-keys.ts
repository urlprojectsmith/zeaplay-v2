import { apiClient } from './api';

export type PublicApiScope =
  | 'tasks.read'
  | 'tasks.write'
  | 'projects.read'
  | 'projects.write'
  | 'tickets.read'
  | 'tickets.write';

export interface WorkspaceApiKey {
  id: string;
  name: string;
  description: string | null;
  prefix: string;
  maskedKey: string;
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
  scopes: PublicApiScope[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  createdBy: {
    membershipId: string;
    userId: string;
    email: string;
    name: string | null;
  };
}

export interface WorkspaceApiKeyCreateResult extends WorkspaceApiKey {
  plaintextApiKey: string;
}

export const publicApiScopes: Array<{ value: PublicApiScope; labelKey: string }> = [
  { value: 'tasks.read', labelKey: 'scopeTasksRead' },
  { value: 'tasks.write', labelKey: 'scopeTasksWrite' },
  { value: 'projects.read', labelKey: 'scopeProjectsRead' },
  { value: 'projects.write', labelKey: 'scopeProjectsWrite' },
  { value: 'tickets.read', labelKey: 'scopeTicketsRead' },
  { value: 'tickets.write', labelKey: 'scopeTicketsWrite' },
];

export async function listWorkspaceApiKeys(workspaceId: string) {
  const response = await apiClient.request<{
    items: WorkspaceApiKey[];
    page: number;
    pageSize: number;
    total: number;
  }>(`/workspaces/${workspaceId}/api-keys`);
  return response.data;
}

export async function createWorkspaceApiKey(
  workspaceId: string,
  input: { name: string; scopes: PublicApiScope[]; expiresAt?: string | null },
) {
  const response = await apiClient.request<WorkspaceApiKeyCreateResult>(
    `/workspaces/${workspaceId}/api-keys`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return response.data;
}

export async function revokeWorkspaceApiKey(workspaceId: string, apiKeyId: string) {
  const response = await apiClient.request<WorkspaceApiKey>(
    `/workspaces/${workspaceId}/api-keys/${apiKeyId}/revoke`,
    { method: 'POST' },
  );
  return response.data;
}

export const workspaceApiKeyKeys = {
  list: (workspaceId: string | null) => ['workspace', workspaceId, 'api-keys'] as const,
};
