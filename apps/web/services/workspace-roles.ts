import { apiClient } from './api';

export interface WorkspacePermission {
  id: string;
  key: string;
  description: string | null;
  createdAt: string;
}

export interface WorkspaceRole {
  id: string;
  key: string;
  name: string;
  description: string | null;
  scope: 'WORKSPACE';
  isSystem: boolean;
  isActive: boolean;
  workspaceId: string | null;
  permissions: WorkspacePermission[];
  createdAt: string;
  updatedAt: string;
}

export const rolesKeys = {
  all: (workspaceId: string | null) => ['workspace', workspaceId, 'roles'] as const,
  detail: (workspaceId: string | null, roleId: string | null) =>
    ['workspace', workspaceId, 'roles', roleId] as const,
};

export const permissionsKeys = {
  catalog: (workspaceId: string | null) => ['workspace', workspaceId, 'permissions'] as const,
};

export async function listWorkspaceRoles(workspaceId: string) {
  const response = await apiClient.request<WorkspaceRole[]>(`/workspaces/${workspaceId}/roles`);
  return response.data;
}

export async function getWorkspaceRole(workspaceId: string, roleId: string) {
  const response = await apiClient.request<WorkspaceRole>(
    `/workspaces/${workspaceId}/roles/${roleId}`,
  );
  return response.data;
}

export async function createWorkspaceRole(
  workspaceId: string,
  body: { name: string; description?: string; permissionIds?: string[] },
) {
  const response = await apiClient.request<WorkspaceRole>(`/workspaces/${workspaceId}/roles`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return response.data;
}

export async function updateWorkspaceRole(
  workspaceId: string,
  roleId: string,
  body: { name?: string; description?: string | null; isActive?: boolean },
) {
  const response = await apiClient.request<WorkspaceRole>(
    `/workspaces/${workspaceId}/roles/${roleId}`,
    { method: 'PATCH', body: JSON.stringify(body) },
  );
  return response.data;
}

export async function cloneWorkspaceRole(workspaceId: string, roleId: string) {
  const response = await apiClient.request<WorkspaceRole>(
    `/workspaces/${workspaceId}/roles/${roleId}/clone`,
    { method: 'POST' },
  );
  return response.data;
}

export async function replaceWorkspaceRolePermissions(
  workspaceId: string,
  roleId: string,
  permissionIds: string[],
) {
  const response = await apiClient.request<WorkspaceRole>(
    `/workspaces/${workspaceId}/roles/${roleId}/permissions`,
    { method: 'PUT', body: JSON.stringify({ permissionIds }) },
  );
  return response.data;
}

export async function listWorkspacePermissions(workspaceId: string) {
  const response = await apiClient.request<WorkspacePermission[]>(
    `/workspaces/${workspaceId}/permissions`,
  );
  return response.data;
}
