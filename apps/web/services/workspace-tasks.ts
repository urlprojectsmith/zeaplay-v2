import { apiClient } from './api';
import type { Department, PageResult } from './workspace-management';
import type { WorkspaceStatusDefinition } from './workspace-statuses';

export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type TaskSortBy = 'createdAt' | 'updatedAt' | 'dueAt' | 'title';
export type TaskSortDirection = 'asc' | 'desc';

export interface WorkspaceProject {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  status: string;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceTask {
  id: string;
  workspaceId: string;
  parentTaskId?: string | null;
  title: string;
  description?: string | null;
  priority: TaskPriority;
  status: WorkspaceStatusDefinition;
  parent?: { id: string; title: string; status: WorkspaceStatusDefinition } | null;
  department: Department | null;
  dueAt: string | null;
  assignees: {
    id?: string;
    membershipId?: string;
    user: { id: string; email: string; name: string | null };
  }[];
  followers?: {
    id?: string;
    membershipId?: string;
    user: { id: string; email: string; name: string | null };
  }[];
  projects: WorkspaceProject[];
  counts?: { assignees: number; followers: number; projects: number };
  directSubtaskCount?: number;
  blockedByCount?: number;
  blocksCount?: number;
  relatedTaskCount?: number;
  createdBy?: { id: string; email: string; name: string | null };
  updatedBy?: { id: string; email: string; name: string | null };
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskPayload {
  title: string;
  dueAt: string;
  assigneeMembershipIds: string[];
  description?: string;
  priority?: TaskPriority;
  statusDefinitionId?: string;
  departmentId?: string;
  followerMembershipIds?: string[];
  projectIds?: string[];
}

export interface BulkTaskResult {
  requestedCount: number;
  changedCount: number;
  unchangedCount: number;
  relationChangedCount?: number;
  relationUnchangedCount?: number;
}

export interface TaskRelationshipResult {
  requestedCount: number;
  changedCount: number;
  unchangedCount: number;
}

export type WorkspaceTaskRelationship = Pick<
  WorkspaceTask,
  'id' | 'title' | 'priority' | 'status' | 'dueAt' | 'assignees'
>;

export interface ListWorkspaceTasksParams {
  page?: number;
  pageSize?: number;
  search?: string;
  sortBy?: TaskSortBy;
  sortDirection?: TaskSortDirection;
  statusDefinitionId?: string;
  priority?: TaskPriority;
  assigneeMembershipId?: string;
  departmentId?: string;
  projectId?: string;
  createdById?: string;
  dueFrom?: string;
  dueTo?: string;
}

export type NormalizedTaskListParams = Required<
  Pick<ListWorkspaceTasksParams, 'page' | 'pageSize' | 'sortBy' | 'sortDirection'>
> &
  Partial<
    Pick<
      ListWorkspaceTasksParams,
      | 'search'
      | 'statusDefinitionId'
      | 'priority'
      | 'assigneeMembershipId'
      | 'departmentId'
      | 'projectId'
      | 'createdById'
      | 'dueFrom'
      | 'dueTo'
    >
  >;

export const taskKeys = {
  all: (workspaceId: string | null) => ['workspace', workspaceId, 'tasks'] as const,
  list: (workspaceId: string | null, params: NormalizedTaskListParams) =>
    ['workspace', workspaceId, 'tasks', 'list', params] as const,
  detail: (workspaceId: string | null, taskId: string | null) =>
    ['workspace', workspaceId, 'tasks', 'detail', taskId] as const,
  subtasksBase: (workspaceId: string | null, taskId: string | null) =>
    ['workspace', workspaceId, 'tasks', 'detail', taskId, 'subtasks'] as const,
  subtasks: (
    workspaceId: string | null,
    taskId: string | null,
    params: Pick<NormalizedTaskListParams, 'page' | 'pageSize'>,
  ) => [...taskKeys.subtasksBase(workspaceId, taskId), params] as const,
  blockedByBase: (workspaceId: string | null, taskId: string | null) =>
    ['workspace', workspaceId, 'tasks', 'detail', taskId, 'blocked-by'] as const,
  blockedBy: (
    workspaceId: string | null,
    taskId: string | null,
    params: Pick<NormalizedTaskListParams, 'page' | 'pageSize'>,
  ) => [...taskKeys.blockedByBase(workspaceId, taskId), params] as const,
  blocksBase: (workspaceId: string | null, taskId: string | null) =>
    ['workspace', workspaceId, 'tasks', 'detail', taskId, 'blocks'] as const,
  blocks: (
    workspaceId: string | null,
    taskId: string | null,
    params: Pick<NormalizedTaskListParams, 'page' | 'pageSize'>,
  ) => [...taskKeys.blocksBase(workspaceId, taskId), params] as const,
  relatedBase: (workspaceId: string | null, taskId: string | null) =>
    ['workspace', workspaceId, 'tasks', 'detail', taskId, 'related'] as const,
  related: (
    workspaceId: string | null,
    taskId: string | null,
    params: Pick<NormalizedTaskListParams, 'page' | 'pageSize'>,
  ) => [...taskKeys.relatedBase(workspaceId, taskId), params] as const,
  relationshipSearch: (
    workspaceId: string | null,
    taskId: string | null,
    search: string,
    params: Pick<NormalizedTaskListParams, 'page' | 'pageSize'>,
  ) => ['workspace', workspaceId, 'tasks', 'relationship-search', taskId, search, params] as const,
};

export const taskCreationKeys = {
  users: (workspaceId: string | null, search: string) =>
    ['workspace', workspaceId, 'task-creation', 'users', search] as const,
  departments: (workspaceId: string | null) =>
    ['workspace', workspaceId, 'task-creation', 'departments'] as const,
  statuses: (workspaceId: string | null) =>
    ['workspace', workspaceId, 'task-creation', 'statuses', 'TASK'] as const,
  projects: (workspaceId: string | null, search: string) =>
    ['workspace', workspaceId, 'task-creation', 'projects', search] as const,
};

export async function createWorkspaceTask(workspaceId: string, body: CreateTaskPayload) {
  const response = await apiClient.request<WorkspaceTask>(`/workspaces/${workspaceId}/tasks`, {
    method: 'POST',
    body: JSON.stringify(compactTaskPayload(body)),
  });
  return response.data;
}

export async function createWorkspaceSubtask(
  workspaceId: string,
  parentTaskId: string,
  body: CreateTaskPayload,
) {
  const response = await apiClient.request<WorkspaceTask>(
    `/workspaces/${workspaceId}/tasks/${parentTaskId}/subtasks`,
    {
      method: 'POST',
      body: JSON.stringify(compactTaskPayload(body)),
    },
  );
  return response.data;
}

export async function listRecentWorkspaceTasks(workspaceId: string) {
  const response = await listWorkspaceTasks(workspaceId, {
    page: 1,
    pageSize: 5,
    sortBy: 'createdAt',
    sortDirection: 'desc',
  });
  return response;
}

export async function listWorkspaceTasks(workspaceId: string, params: ListWorkspaceTasksParams) {
  const normalized = normalizeTaskListParams(params);
  const response = await apiClient.request<PageResult<WorkspaceTask>>(
    `/workspaces/${workspaceId}/tasks?${taskListQueryString(normalized)}`,
  );
  return response.data;
}

export async function getWorkspaceTask(workspaceId: string, taskId: string) {
  const response = await apiClient.request<WorkspaceTask>(
    `/workspaces/${workspaceId}/tasks/${taskId}`,
  );
  return response.data;
}

export async function listWorkspaceSubtasks(
  workspaceId: string,
  taskId: string,
  params: Pick<ListWorkspaceTasksParams, 'page' | 'pageSize'>,
) {
  const normalized = normalizeSubtaskPagination(params);
  const query = new URLSearchParams({
    page: String(normalized.page),
    pageSize: String(normalized.pageSize),
  });
  const response = await apiClient.request<PageResult<WorkspaceTask>>(
    `/workspaces/${workspaceId}/tasks/${taskId}/subtasks?${query}`,
  );
  return response.data;
}

export async function updateWorkspaceTaskParent(
  workspaceId: string,
  taskId: string,
  parentTaskId: string | null,
) {
  const response = await apiClient.request<WorkspaceTask>(
    `/workspaces/${workspaceId}/tasks/${taskId}/parent`,
    {
      method: 'PATCH',
      body: JSON.stringify({ parentTaskId }),
    },
  );
  return response.data;
}

export async function listWorkspaceTaskBlockedBy(
  workspaceId: string,
  taskId: string,
  params: Pick<ListWorkspaceTasksParams, 'page' | 'pageSize'>,
) {
  return listWorkspaceTaskRelationship(workspaceId, taskId, 'blocked-by', params);
}

export async function listWorkspaceTaskBlocks(
  workspaceId: string,
  taskId: string,
  params: Pick<ListWorkspaceTasksParams, 'page' | 'pageSize'>,
) {
  return listWorkspaceTaskRelationship(workspaceId, taskId, 'blocks', params);
}

export async function listWorkspaceTaskRelated(
  workspaceId: string,
  taskId: string,
  params: Pick<ListWorkspaceTasksParams, 'page' | 'pageSize'>,
) {
  return listWorkspaceTaskRelationship(workspaceId, taskId, 'related', params);
}

export async function addWorkspaceTaskBlockedBy(
  workspaceId: string,
  taskId: string,
  taskIds: string[],
) {
  const response = await apiClient.request<TaskRelationshipResult>(
    `/workspaces/${workspaceId}/tasks/${taskId}/blocked-by`,
    { method: 'POST', body: JSON.stringify({ taskIds: uniqueIds(taskIds) }) },
  );
  return response.data;
}

export async function removeWorkspaceTaskBlockedBy(
  workspaceId: string,
  taskId: string,
  taskIds: string[],
) {
  const response = await apiClient.request<TaskRelationshipResult>(
    `/workspaces/${workspaceId}/tasks/${taskId}/blocked-by/remove`,
    { method: 'POST', body: JSON.stringify({ taskIds: uniqueIds(taskIds) }) },
  );
  return response.data;
}

export async function addWorkspaceTaskRelated(
  workspaceId: string,
  taskId: string,
  taskIds: string[],
) {
  const response = await apiClient.request<TaskRelationshipResult>(
    `/workspaces/${workspaceId}/tasks/${taskId}/related`,
    { method: 'POST', body: JSON.stringify({ taskIds: uniqueIds(taskIds) }) },
  );
  return response.data;
}

export async function removeWorkspaceTaskRelated(
  workspaceId: string,
  taskId: string,
  taskIds: string[],
) {
  const response = await apiClient.request<TaskRelationshipResult>(
    `/workspaces/${workspaceId}/tasks/${taskId}/related/remove`,
    { method: 'POST', body: JSON.stringify({ taskIds: uniqueIds(taskIds) }) },
  );
  return response.data;
}

export async function bulkUpdateTaskStatus(
  workspaceId: string,
  body: { taskIds: string[]; statusDefinitionId: string },
) {
  const response = await apiClient.request<BulkTaskResult>(
    `/workspaces/${workspaceId}/tasks/bulk/status`,
    { method: 'PATCH', body: JSON.stringify(body) },
  );
  return response.data;
}

export async function bulkUpdateTaskPriority(
  workspaceId: string,
  body: { taskIds: string[]; priority: TaskPriority },
) {
  const response = await apiClient.request<BulkTaskResult>(
    `/workspaces/${workspaceId}/tasks/bulk/priority`,
    { method: 'PATCH', body: JSON.stringify(body) },
  );
  return response.data;
}

export async function bulkAddTaskAssignees(
  workspaceId: string,
  body: { taskIds: string[]; membershipIds: string[] },
) {
  const response = await apiClient.request<BulkTaskResult>(
    `/workspaces/${workspaceId}/tasks/bulk/assignees/add`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  return response.data;
}

export async function bulkRemoveTaskAssignees(
  workspaceId: string,
  body: { taskIds: string[]; membershipIds: string[] },
) {
  const response = await apiClient.request<BulkTaskResult>(
    `/workspaces/${workspaceId}/tasks/bulk/assignees/remove`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  return response.data;
}

export async function bulkDeleteTasks(workspaceId: string, body: { taskIds: string[] }) {
  const response = await apiClient.request<BulkTaskResult>(
    `/workspaces/${workspaceId}/tasks/bulk`,
    { method: 'DELETE', body: JSON.stringify(body) },
  );
  return response.data;
}

export async function listWorkspaceProjects(params: {
  workspaceId: string;
  page?: number;
  pageSize?: number;
  search?: string;
}) {
  const query = new URLSearchParams({
    page: String(params.page ?? 1),
    pageSize: String(params.pageSize ?? 10),
    sortBy: 'name',
    sortDirection: 'asc',
  });
  if (params.search?.trim()) query.set('search', params.search.trim());
  const response = await apiClient.request<PageResult<WorkspaceProject>>(`/projects?${query}`);
  return {
    ...response.data,
    items: response.data.items.filter((project) => project.workspaceId === params.workspaceId),
  };
}

export function taskDueAtFromLocalDate(date: string, time?: string) {
  if (!date) return '';
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  const [hour = 23, minute = 59] = time ? time.split(':').map(Number) : [23, 59];
  const localDate = new Date(year, month - 1, day, hour, minute, time ? 0 : 59, time ? 0 : 999);
  return localDate.toISOString();
}

export function taskDueBoundaryFromLocalDate(date: string, boundary: 'start' | 'end') {
  if (!isLocalDateString(date)) return '';
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  const localDate =
    boundary === 'start'
      ? new Date(year, month - 1, day, 0, 0, 0, 0)
      : new Date(year, month - 1, day, 23, 59, 59, 999);
  return localDate.toISOString();
}

export function normalizeTaskListParams(
  params: ListWorkspaceTasksParams,
): NormalizedTaskListParams {
  const pageSize = normalizePageSize(params.pageSize);
  return {
    page: clampNumber(params.page, 1, Number.MAX_SAFE_INTEGER, 1),
    pageSize,
    sortBy: isTaskSortBy(params.sortBy) ? params.sortBy : 'createdAt',
    sortDirection: params.sortDirection === 'asc' ? 'asc' : 'desc',
    ...(params.search?.trim() ? { search: params.search.trim() } : {}),
    ...(params.statusDefinitionId ? { statusDefinitionId: params.statusDefinitionId } : {}),
    ...(params.priority ? { priority: params.priority } : {}),
    ...(params.assigneeMembershipId ? { assigneeMembershipId: params.assigneeMembershipId } : {}),
    ...(params.departmentId ? { departmentId: params.departmentId } : {}),
    ...(params.projectId ? { projectId: params.projectId } : {}),
    ...(params.createdById ? { createdById: params.createdById } : {}),
    ...(isIsoDateString(params.dueFrom) ? { dueFrom: params.dueFrom } : {}),
    ...(isIsoDateString(params.dueTo) ? { dueTo: params.dueTo } : {}),
  };
}

function normalizeSubtaskPagination(params: Pick<ListWorkspaceTasksParams, 'page' | 'pageSize'>) {
  return {
    page: clampNumber(params.page, 1, Number.MAX_SAFE_INTEGER, 1),
    pageSize: [5, 10, 25, 50].includes(Number(params.pageSize)) ? Number(params.pageSize) : 10,
  };
}

async function listWorkspaceTaskRelationship(
  workspaceId: string,
  taskId: string,
  relation: 'blocked-by' | 'blocks' | 'related',
  params: Pick<ListWorkspaceTasksParams, 'page' | 'pageSize'>,
) {
  const normalized = normalizeRelationshipPagination(params);
  const query = new URLSearchParams({
    page: String(normalized.page),
    pageSize: String(normalized.pageSize),
  });
  const response = await apiClient.request<PageResult<WorkspaceTaskRelationship>>(
    `/workspaces/${workspaceId}/tasks/${taskId}/${relation}?${query}`,
  );
  return response.data;
}

function normalizeRelationshipPagination(
  params: Pick<ListWorkspaceTasksParams, 'page' | 'pageSize'>,
) {
  return {
    page: clampNumber(params.page, 1, Number.MAX_SAFE_INTEGER, 1),
    pageSize: [5, 10, 25, 50].includes(Number(params.pageSize)) ? Number(params.pageSize) : 10,
  };
}

function compactTaskPayload(body: CreateTaskPayload) {
  return {
    title: body.title.trim(),
    dueAt: body.dueAt,
    assigneeMembershipIds: body.assigneeMembershipIds,
    ...(body.description?.trim() ? { description: body.description.trim() } : {}),
    ...(body.priority ? { priority: body.priority } : {}),
    ...(body.statusDefinitionId ? { statusDefinitionId: body.statusDefinitionId } : {}),
    ...(body.departmentId ? { departmentId: body.departmentId } : {}),
    ...(body.followerMembershipIds?.length
      ? { followerMembershipIds: body.followerMembershipIds }
      : {}),
    ...(body.projectIds?.length ? { projectIds: body.projectIds } : {}),
  };
}

function uniqueIds(ids: string[]) {
  return [...new Set(ids.filter(Boolean))];
}

function taskListQueryString(params: NormalizedTaskListParams) {
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
    'assigneeMembershipId',
    'departmentId',
    'projectId',
    'createdById',
    'dueFrom',
    'dueTo',
  ] as const) {
    if (params[key]) query.set(key, params[key]);
  }
  return query.toString();
}

function clampNumber(value: number | undefined, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value as number)));
}

function normalizePageSize(value: number | undefined) {
  return value === 10 || value === 25 || value === 50 ? value : 25;
}

function isTaskSortBy(value: unknown): value is TaskSortBy {
  return value === 'createdAt' || value === 'updatedAt' || value === 'dueAt' || value === 'title';
}

function isLocalDateString(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year = 0, month = 1, day = 1] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function isIsoDateString(value: string | undefined) {
  return Boolean(value && !Number.isNaN(Date.parse(value)));
}
