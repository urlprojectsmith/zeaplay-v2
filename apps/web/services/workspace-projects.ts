import { apiClient } from './api';
import type { Department, PageResult } from './workspace-management';

export type ProjectPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type ProjectSortBy =
  'createdAt' | 'updatedAt' | 'name' | 'dueAt' | 'plannedStartAt' | 'priority';
export type ProjectSortDirection = 'asc' | 'desc';

export interface WorkspaceProjectSummary {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  statusDefinitionId: string | null;
  status: { id: string; name: string; color: string; terminal: boolean } | null;
  priority: ProjectPriority;
  plannedStartAt: string | null;
  dueAt: string | null;
  departmentId: string | null;
  department: Pick<Department, 'id' | 'name' | 'status'> | null;
  createdById?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectPayload {
  name: string;
  description?: string | null;
  statusDefinitionId?: string;
  priority?: ProjectPriority;
  plannedStartAt?: string | null;
  dueAt?: string | null;
  departmentId?: string | null;
}

export interface ListWorkspaceProjectsParams {
  page?: number;
  pageSize?: number;
  search?: string;
  statusDefinitionId?: string;
  priority?: ProjectPriority;
  departmentId?: string;
  plannedFrom?: string;
  plannedTo?: string;
  dueFrom?: string;
  dueTo?: string;
  sortBy?: ProjectSortBy;
  sortDirection?: ProjectSortDirection;
}

export type NormalizedProjectListParams = Required<
  Pick<ListWorkspaceProjectsParams, 'page' | 'pageSize' | 'sortBy' | 'sortDirection'>
> &
  Partial<
    Pick<
      ListWorkspaceProjectsParams,
      | 'search'
      | 'statusDefinitionId'
      | 'priority'
      | 'departmentId'
      | 'plannedFrom'
      | 'plannedTo'
      | 'dueFrom'
      | 'dueTo'
    >
  >;

export const projectKeys = {
  all: (workspaceId: string | null) => ['workspace', workspaceId, 'projects'] as const,
  list: (workspaceId: string | null, params: NormalizedProjectListParams) =>
    ['workspace', workspaceId, 'projects', 'list', params] as const,
  detail: (workspaceId: string | null, projectId: string | null) =>
    ['workspace', workspaceId, 'projects', 'detail', projectId] as const,
};

export async function listWorkspaceProjects(
  workspaceId: string,
  params: ListWorkspaceProjectsParams = {},
) {
  const normalized = normalizeProjectListParams(params);
  const response = await apiClient.request<PageResult<WorkspaceProjectSummary>>(
    `/workspaces/${workspaceId}/projects?${projectListQueryString(normalized)}`,
  );
  return response.data;
}

export async function getWorkspaceProject(workspaceId: string, projectId: string) {
  const response = await apiClient.request<WorkspaceProjectSummary>(
    `/workspaces/${workspaceId}/projects/${projectId}`,
  );
  return response.data;
}

export async function createWorkspaceProject(workspaceId: string, body: ProjectPayload) {
  const response = await apiClient.request<WorkspaceProjectSummary>(
    `/workspaces/${workspaceId}/projects`,
    { method: 'POST', body: JSON.stringify(compactProjectPayload(body)) },
  );
  return response.data;
}

export async function updateWorkspaceProject(
  workspaceId: string,
  projectId: string,
  body: ProjectPayload,
) {
  const response = await apiClient.request<WorkspaceProjectSummary>(
    `/workspaces/${workspaceId}/projects/${projectId}`,
    { method: 'PATCH', body: JSON.stringify(compactProjectPayload(body)) },
  );
  return response.data;
}

export async function updateWorkspaceProjectStatus(
  workspaceId: string,
  projectId: string,
  statusDefinitionId: string,
) {
  const response = await apiClient.request<WorkspaceProjectSummary>(
    `/workspaces/${workspaceId}/projects/${projectId}/status`,
    { method: 'PATCH', body: JSON.stringify({ statusDefinitionId }) },
  );
  return response.data;
}

export async function deleteWorkspaceProject(workspaceId: string, projectId: string) {
  const response = await apiClient.request<{ id: string; deleted: boolean }>(
    `/workspaces/${workspaceId}/projects/${projectId}`,
    { method: 'DELETE' },
  );
  return response.data;
}

export function normalizeProjectListParams(
  params: ListWorkspaceProjectsParams,
): NormalizedProjectListParams {
  return {
    page: clampNumber(params.page, 1, Number.MAX_SAFE_INTEGER, 1),
    pageSize: [10, 20, 50, 100].includes(Number(params.pageSize)) ? Number(params.pageSize) : 20,
    sortBy: isProjectSortBy(params.sortBy) ? params.sortBy : 'updatedAt',
    sortDirection: params.sortDirection === 'asc' ? 'asc' : 'desc',
    ...(params.search?.trim() ? { search: params.search.trim() } : {}),
    ...(params.statusDefinitionId ? { statusDefinitionId: params.statusDefinitionId } : {}),
    ...(params.priority ? { priority: params.priority } : {}),
    ...(params.departmentId ? { departmentId: params.departmentId } : {}),
    ...(isIsoDateString(params.plannedFrom) ? { plannedFrom: params.plannedFrom } : {}),
    ...(isIsoDateString(params.plannedTo) ? { plannedTo: params.plannedTo } : {}),
    ...(isIsoDateString(params.dueFrom) ? { dueFrom: params.dueFrom } : {}),
    ...(isIsoDateString(params.dueTo) ? { dueTo: params.dueTo } : {}),
  };
}

function compactProjectPayload(body: ProjectPayload) {
  return {
    name: body.name.trim(),
    ...(body.description !== undefined ? { description: body.description?.trim() || null } : {}),
    ...(body.statusDefinitionId ? { statusDefinitionId: body.statusDefinitionId } : {}),
    ...(body.priority ? { priority: body.priority } : {}),
    ...(body.plannedStartAt !== undefined ? { plannedStartAt: body.plannedStartAt } : {}),
    ...(body.dueAt !== undefined ? { dueAt: body.dueAt } : {}),
    ...(body.departmentId !== undefined ? { departmentId: body.departmentId || null } : {}),
  };
}

function projectListQueryString(params: NormalizedProjectListParams) {
  const query = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
    sortBy: params.sortBy,
    sortDirection: params.sortDirection,
  });
  for (const key of [
    'search',
    'statusDefinitionId',
    'priority',
    'departmentId',
    'plannedFrom',
    'plannedTo',
    'dueFrom',
    'dueTo',
  ] as const) {
    if (params[key]) query.set(key, params[key]);
  }
  return query.toString();
}

function isProjectSortBy(value: unknown): value is ProjectSortBy {
  return (
    value === 'createdAt' ||
    value === 'updatedAt' ||
    value === 'name' ||
    value === 'dueAt' ||
    value === 'plannedStartAt' ||
    value === 'priority'
  );
}

function clampNumber(value: number | undefined, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value as number)));
}

function isIsoDateString(value: string | undefined) {
  return Boolean(value && !Number.isNaN(Date.parse(value)));
}
