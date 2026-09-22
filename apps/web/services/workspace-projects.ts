import { apiClient } from './api';
import type { Department, PageResult } from './workspace-management';

export type ProjectPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type ProjectXpCategory = 'HIGH' | 'MEDIUM' | 'LONG_TERM';
export type ProjectVisibility = 'WORKSPACE' | 'RESTRICTED';
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
  xpCategory: ProjectXpCategory | null;
  visibility: ProjectVisibility;
  calculatedProgress: number;
  manualProgressPercent: number | null;
  manualProgressUpdatedAt: string | null;
  effectiveProgress: number;
  taskCounts: {
    totalTasks: number;
    openTasks: number;
    completedTasks: number;
    overdueTasks: number;
  };
  plannedStartAt: string | null;
  dueAt: string | null;
  departmentId: string | null;
  department: Pick<Department, 'id' | 'name' | 'status'> | null;
  ownerMembershipId: string;
  owner: ProjectMembershipSummary;
  memberCount: number;
  createdById?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMembershipSummary {
  id: string;
  status: string;
  user: { id: string; email: string; name: string | null };
}

export interface ProjectMember {
  id: string;
  workspaceId: string;
  projectId: string;
  workspaceMembershipId: string;
  member: ProjectMembershipSummary;
  createdAt: string;
}

export interface ProjectTag {
  id: string;
  workspaceId: string;
  projectId: string;
  tagId: string;
  name: string;
  color: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
  createdAt: string;
}

export interface ProjectAttachmentSummary {
  id: string;
  workspaceId: string;
  projectId?: string;
  type: 'FILE' | 'URL';
  displayName: string;
  url: string | null;
  file: ProjectAttachmentFile | null;
  attachedAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy?: { id: string; email: string; name: string | null };
  attachedBy?: { id: string; email: string; name: string | null };
}

export interface ProjectAttachmentFile {
  id: string;
  workspaceId: string;
  projectId: string | null;
  originalFilename: string;
  displayName: string;
  mimeType: string;
  extension: string | null;
  sizeBytes: number;
  checksum: string | null;
  status: string;
  uploadExpiresAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectAttachmentUploadInit {
  attachment: ProjectAttachmentSummary;
  uploadUrl: string;
  expiresAt: string;
}

export interface ProjectActivityItem {
  id: string;
  action: string;
  entityType: 'Project';
  entityId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  actor: { id: string; email: string; name: string | null } | null;
}

export interface ProjectReportParams {
  from?: string;
  to?: string;
  statusDefinitionId?: string;
  priority?: ProjectPriority;
  assigneeMembershipId?: string;
  departmentId?: string;
  tagId?: string;
  search?: string;
}

export interface ProjectReportsSummary {
  project: { id: string; name: string };
  timezone: string;
  filters: ProjectReportParams;
  kpis: {
    totalTasks: number;
    openTasks: number;
    completedTasks: number;
    overdueTasks: number;
    pendingApprovalTasks: number;
    completionRate: number;
    estimatedMinutes: number;
    trackedSeconds: number | null;
    trackedTimeAvailable: boolean;
  };
  progress: {
    calculatedProgress: number;
    manualProgressPercent: number | null;
    effectiveProgress: number;
  };
  distributions: {
    status: Array<{
      statusDefinitionId: string;
      name: string;
      color: string;
      terminal: boolean;
      count: number;
    }>;
    priority: Array<{ priority: ProjectPriority; count: number }>;
    assignees: Array<{
      membershipId: string | null;
      displayName: string;
      taskAssignmentCount: number;
      openTaskCount: number;
      completedTaskCount: number;
      overdueTaskCount: number;
    }>;
    departments: Array<{ departmentId: string | null; name: string; count: number }>;
  };
  completionTrend: Array<{ date: string; count: number }>;
  semantics: {
    dateRange: string;
    assigneeBreakdown: string;
    completionTrend: string;
    multiProject: string;
  };
}

export interface ProjectMutationCount {
  requestedCount: number;
  changedCount: number;
  unchangedCount?: number;
}

export interface ProjectPayload {
  name: string;
  description?: string | null;
  statusDefinitionId?: string;
  priority?: ProjectPriority;
  xpCategory?: ProjectXpCategory | null;
  plannedStartAt?: string | null;
  dueAt?: string | null;
  departmentId?: string | null;
  ownerMembershipId?: string;
  visibility?: ProjectVisibility;
  memberMembershipIds?: string[];
}

export interface ListWorkspaceProjectsParams {
  page?: number;
  pageSize?: number;
  search?: string;
  statusDefinitionId?: string;
  priority?: ProjectPriority;
  tagId?: string;
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
      | 'tagId'
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
  members: (workspaceId: string | null, projectId: string | null, params: object) =>
    ['workspace', workspaceId, 'projects', 'detail', projectId, 'members', params] as const,
  tags: (workspaceId: string | null, projectId: string | null) =>
    ['workspace', workspaceId, 'projects', 'detail', projectId, 'tags'] as const,
  attachmentsBase: (workspaceId: string | null, projectId: string | null) =>
    ['workspace', workspaceId, 'projects', 'detail', projectId, 'attachments'] as const,
  attachments: (workspaceId: string | null, projectId: string | null, params: object) =>
    ['workspace', workspaceId, 'projects', 'detail', projectId, 'attachments', params] as const,
  activityBase: (workspaceId: string | null, projectId: string | null) =>
    ['workspace', workspaceId, 'projects', 'detail', projectId, 'activity'] as const,
  activity: (workspaceId: string | null, projectId: string | null, params: object) =>
    ['workspace', workspaceId, 'projects', 'detail', projectId, 'activity', params] as const,
  reports: (workspaceId: string | null, projectId: string | null, params: ProjectReportParams) =>
    ['workspace', workspaceId, 'projects', 'detail', projectId, 'reports', params] as const,
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

export async function listWorkspaceProjectMembers(
  workspaceId: string,
  projectId: string,
  params: { page?: number; pageSize?: number; search?: string } = {},
) {
  const query = new URLSearchParams({
    page: String(params.page ?? 1),
    pageSize: String(params.pageSize ?? 20),
  });
  if (params.search?.trim()) query.set('search', params.search.trim());
  const response = await apiClient.request<PageResult<ProjectMember>>(
    `/workspaces/${workspaceId}/projects/${projectId}/members?${query.toString()}`,
  );
  return response.data;
}

export async function addWorkspaceProjectMembers(
  workspaceId: string,
  projectId: string,
  membershipIds: string[],
) {
  const response = await apiClient.request<PageResult<ProjectMember>>(
    `/workspaces/${workspaceId}/projects/${projectId}/members`,
    { method: 'POST', body: JSON.stringify({ membershipIds }) },
  );
  return response.data;
}

export async function removeWorkspaceProjectMember(
  workspaceId: string,
  projectId: string,
  membershipId: string,
) {
  const response = await apiClient.request<{ id: string; membershipId: string; removed: boolean }>(
    `/workspaces/${workspaceId}/projects/${projectId}/members/${membershipId}`,
    { method: 'DELETE' },
  );
  return response.data;
}

export async function updateWorkspaceProjectOwner(
  workspaceId: string,
  projectId: string,
  workspaceMembershipId: string,
) {
  const response = await apiClient.request<WorkspaceProjectSummary>(
    `/workspaces/${workspaceId}/projects/${projectId}/owner`,
    { method: 'PATCH', body: JSON.stringify({ workspaceMembershipId }) },
  );
  return response.data;
}

export async function listWorkspaceProjectTags(workspaceId: string, projectId: string) {
  const response = await apiClient.request<ProjectTag[]>(
    `/workspaces/${workspaceId}/projects/${projectId}/tags`,
  );
  return response.data;
}

export async function addWorkspaceProjectTags(
  workspaceId: string,
  projectId: string,
  tagIds: string[],
) {
  const response = await apiClient.request<ProjectMutationCount>(
    `/workspaces/${workspaceId}/projects/${projectId}/tags/add`,
    { method: 'POST', body: JSON.stringify({ tagIds: uniqueIds(tagIds) }) },
  );
  return response.data;
}

export async function removeWorkspaceProjectTags(
  workspaceId: string,
  projectId: string,
  tagIds: string[],
) {
  const response = await apiClient.request<ProjectMutationCount>(
    `/workspaces/${workspaceId}/projects/${projectId}/tags/remove`,
    { method: 'POST', body: JSON.stringify({ tagIds: uniqueIds(tagIds) }) },
  );
  return response.data;
}

export async function linkWorkspaceProjectTasks(
  workspaceId: string,
  projectId: string,
  taskIds: string[],
) {
  const response = await apiClient.request<ProjectMutationCount>(
    `/workspaces/${workspaceId}/projects/${projectId}/tasks`,
    { method: 'POST', body: JSON.stringify({ taskIds: uniqueIds(taskIds) }) },
  );
  return response.data;
}

export async function unlinkWorkspaceProjectTasks(
  workspaceId: string,
  projectId: string,
  taskIds: string[],
) {
  const response = await apiClient.request<ProjectMutationCount>(
    `/workspaces/${workspaceId}/projects/${projectId}/tasks/remove`,
    { method: 'POST', body: JSON.stringify({ taskIds: uniqueIds(taskIds) }) },
  );
  return response.data;
}

export async function updateWorkspaceProjectProgress(
  workspaceId: string,
  projectId: string,
  manualProgressPercent: number | null,
) {
  const response = await apiClient.request<WorkspaceProjectSummary>(
    `/workspaces/${workspaceId}/projects/${projectId}/progress`,
    { method: 'PATCH', body: JSON.stringify({ manualProgressPercent }) },
  );
  return response.data;
}

export async function listWorkspaceProjectAttachments(
  workspaceId: string,
  projectId: string,
  params: { page?: number; pageSize?: number; search?: string } = {},
) {
  const query = paginatedQuery(params);
  const response = await apiClient.request<PageResult<ProjectAttachmentSummary>>(
    `/workspaces/${workspaceId}/projects/${projectId}/attachments?${query}`,
  );
  return response.data;
}

export async function initWorkspaceProjectAttachmentUpload(
  workspaceId: string,
  projectId: string,
  body: { filename: string; displayName?: string; mimeType: string; sizeBytes: number },
) {
  const response = await apiClient.request<ProjectAttachmentUploadInit>(
    `/workspaces/${workspaceId}/projects/${projectId}/attachments/upload-init`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  return response.data;
}

export async function completeWorkspaceProjectAttachmentUpload(
  workspaceId: string,
  projectId: string,
  attachmentId: string,
  body: { sizeBytes: number },
) {
  const response = await apiClient.request<ProjectAttachmentSummary>(
    `/workspaces/${workspaceId}/projects/${projectId}/attachments/${attachmentId}/upload-complete`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  return response.data;
}

export async function addWorkspaceProjectUrlAttachment(
  workspaceId: string,
  projectId: string,
  body: { url: string; displayName?: string },
) {
  const response = await apiClient.request<ProjectAttachmentSummary>(
    `/workspaces/${workspaceId}/projects/${projectId}/attachments/url`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  return response.data;
}

export async function downloadWorkspaceProjectAttachment(
  workspaceId: string,
  projectId: string,
  attachmentId: string,
) {
  const response = await apiClient.request<{ downloadUrl: string; expiresInSeconds: number }>(
    `/workspaces/${workspaceId}/projects/${projectId}/attachments/${attachmentId}/download`,
  );
  return response.data;
}

export async function removeWorkspaceProjectAttachment(
  workspaceId: string,
  projectId: string,
  attachmentId: string,
) {
  const response = await apiClient.request<{ changed: boolean }>(
    `/workspaces/${workspaceId}/projects/${projectId}/attachments/${attachmentId}`,
    { method: 'DELETE' },
  );
  return response.data;
}

export async function listWorkspaceProjectActivity(
  workspaceId: string,
  projectId: string,
  params: {
    page?: number;
    pageSize?: number;
    action?: string;
    userId?: string;
    from?: string;
    to?: string;
  } = {},
) {
  const query = paginatedQuery(params);
  if (params.action) query.set('action', params.action);
  if (params.userId) query.set('userId', params.userId);
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  const response = await apiClient.request<PageResult<ProjectActivityItem>>(
    `/workspaces/${workspaceId}/projects/${projectId}/activity?${query}`,
  );
  return response.data;
}

export async function getWorkspaceProjectReports(
  workspaceId: string,
  projectId: string,
  params: ProjectReportParams = {},
) {
  const response = await apiClient.request<ProjectReportsSummary>(
    `/workspaces/${workspaceId}/projects/${projectId}/reports?${projectReportQueryString(params)}`,
  );
  return response.data;
}

export async function exportWorkspaceProjectReportsCsv(
  workspaceId: string,
  projectId: string,
  params: ProjectReportParams = {},
) {
  const response = await apiClient.request<{ filename: string; contentType: string; csv: string }>(
    `/workspaces/${workspaceId}/projects/${projectId}/reports/export?${projectReportQueryString(params)}`,
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
    ...(params.tagId ? { tagId: params.tagId } : {}),
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
    ...(body.xpCategory !== undefined ? { xpCategory: body.xpCategory } : {}),
    ...(body.plannedStartAt !== undefined ? { plannedStartAt: body.plannedStartAt } : {}),
    ...(body.dueAt !== undefined ? { dueAt: body.dueAt } : {}),
    ...(body.departmentId !== undefined ? { departmentId: body.departmentId || null } : {}),
    ...(body.ownerMembershipId ? { ownerMembershipId: body.ownerMembershipId } : {}),
    ...(body.visibility ? { visibility: body.visibility } : {}),
    ...(body.memberMembershipIds ? { memberMembershipIds: body.memberMembershipIds } : {}),
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
    'tagId',
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

function paginatedQuery(params: { page?: number; pageSize?: number; search?: string }) {
  const query = new URLSearchParams({
    page: String(params.page ?? 1),
    pageSize: String(params.pageSize ?? 20),
  });
  if (params.search?.trim()) query.set('search', params.search.trim());
  return query;
}

function projectReportQueryString(params: ProjectReportParams) {
  const query = new URLSearchParams();
  for (const key of [
    'from',
    'to',
    'statusDefinitionId',
    'priority',
    'assigneeMembershipId',
    'departmentId',
    'tagId',
    'search',
  ] as const) {
    if (params[key]) query.set(key, String(params[key]));
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

function uniqueIds(ids: string[]) {
  return Array.from(new Set(ids.filter(Boolean)));
}
