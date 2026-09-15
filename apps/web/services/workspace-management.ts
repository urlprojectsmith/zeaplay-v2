import { apiClient } from './api';

export interface PageResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface WorkspaceUser {
  id: string;
  membershipId: string;
  workspaceId: string;
  email: string;
  name: string | null;
  userStatus: string;
  membershipStatus: string;
  role: { id: string; key: string; name: string };
  department: { id: string; name: string; status: string } | null;
  joinedAt: string;
  createdAt: string;
}

export interface Department {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  manager: { id: string; email: string; name: string | null } | null;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ListUsersParams {
  workspaceId: string;
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  role?: string;
  departmentId?: string;
}

export interface ListDepartmentsParams {
  workspaceId: string;
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
}

export async function listWorkspaceUsers(params: ListUsersParams) {
  const response = await apiClient.request<PageResult<WorkspaceUser>>(
    `/workspaces/${params.workspaceId}/users?${queryString(params)}`,
  );
  return response.data;
}

export async function updateWorkspaceUser(
  workspaceId: string,
  userId: string,
  body: { role?: string; roleId?: string; status?: string; departmentId?: string | null },
) {
  const response = await apiClient.request<WorkspaceUser>(
    `/workspaces/${workspaceId}/users/${userId}/membership`,
    { method: 'PATCH', body: JSON.stringify(body) },
  );
  return response.data;
}

export async function listDepartments(params: ListDepartmentsParams) {
  const response = await apiClient.request<PageResult<Department>>(
    `/workspaces/${params.workspaceId}/departments?${queryString(params)}`,
  );
  return response.data;
}

export async function createDepartment(
  workspaceId: string,
  body: { name: string; description?: string; status?: string; managerUserId?: string },
) {
  const response = await apiClient.request<Department>(`/workspaces/${workspaceId}/departments`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return response.data;
}

export async function updateDepartment(
  workspaceId: string,
  departmentId: string,
  body: { name?: string; description?: string; status?: string; managerUserId?: string | null },
) {
  const response = await apiClient.request<Department>(
    `/workspaces/${workspaceId}/departments/${departmentId}`,
    { method: 'PATCH', body: JSON.stringify(body) },
  );
  return response.data;
}

function queryString(params: Record<string, string | number | undefined> | object) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params) as [string, string | number | undefined][]) {
    if (key === 'workspaceId' || value === undefined || value === '') continue;
    query.set(key, String(value));
  }
  return query.toString();
}
