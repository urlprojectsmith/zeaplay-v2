import { apiClient } from './api';
import type { Department, PageResult } from './workspace-management';
import type { WorkspaceStatusDefinition } from './workspace-statuses';

export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type TaskSortBy = 'createdAt' | 'updatedAt' | 'dueAt' | 'title' | 'kanbanRank';
export type TaskSortDirection = 'asc' | 'desc';
export type TaskCommentVisibility = 'NORMAL' | 'INTERNAL';
export type TaskCommentReactionType = 'LIKE' | 'LOVE' | 'CELEBRATE' | 'EYES' | 'CHECK';
export type WorkspaceTagStatus = 'ACTIVE' | 'ARCHIVED';
export type WorkspaceTagSortBy = 'createdAt' | 'updatedAt' | 'name';
export type TaskAttachmentType = 'FILE' | 'URL';
export type TaskCompletionProofRequirementMode = 'NONE' | 'ANY' | 'SPECIFIC';
export type TaskCompletionProofType = 'TEXT' | 'ATTACHMENT' | 'URL' | 'CHECKLIST_CONFIRMATION';
export type TaskCompletionApproverMode = 'ANY_ONE' | 'ALL_REQUIRED';
export type TaskCompletionSubmissionStatus = 'PENDING_APPROVAL' | 'ACCEPTED' | 'REJECTED';
export type TaskCompletionDecision = 'APPROVED' | 'REJECTED';
export type TaskTimeEntryType = 'TIMER' | 'MANUAL';
export type TaskTimeEntryStopReason =
  'USER' | 'SWITCHED_TASK' | 'TASK_TERMINAL' | 'TASK_DELETED' | 'ADMIN';
export type TaskRecurrenceFrequency = 'DAILY' | 'WEEKDAYS' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM';
export type TaskRecurrenceCustomUnit = 'DAY' | 'WEEK' | 'MONTH';
export type TaskRecurrenceEndMode = 'NEVER' | 'ON_DATE' | 'AFTER_COUNT';
export type TaskRecurrenceStatus = 'ACTIVE' | 'PAUSED' | 'ENDED' | 'ERROR';
export type TaskTemplateStatus = 'ACTIVE' | 'ARCHIVED';
export type TaskRecurrenceEditScope = 'THIS_OCCURRENCE' | 'THIS_AND_FUTURE' | 'ENTIRE_SERIES';

export interface WorkspaceProject {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  status: string | { id: string; name: string; color: string; terminal: boolean } | null;
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
  kanbanRank: string | null;
  status: WorkspaceStatusDefinition;
  parent?: { id: string; title: string; status: WorkspaceStatusDefinition } | null;
  department: Department | null;
  plannedStartAt: string | null;
  dueAt: string | null;
  estimatedMinutes?: number | null;
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
  recurrenceSeriesId?: string | null;
  recurrenceScheduledFor?: string | null;
  recurrenceSequence?: number | null;
  recurrenceIsException?: boolean;
  pendingCompletionSubmissionId?: string | null;
  completion?: {
    pendingApproval: boolean;
    pendingSubmissionId: string | null;
  };
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

export interface TaskRecurrencePayload {
  timezone: string;
  frequency: TaskRecurrenceFrequency;
  interval?: number;
  customIntervalUnit?: TaskRecurrenceCustomUnit;
  startLocalDate: string;
  localTime: string;
  selectedWeekdays?: number[];
  monthlyDay?: number;
  endMode: TaskRecurrenceEndMode;
  untilLocalDate?: string | null;
  maxOccurrences?: number | null;
}

export interface CreateTaskPayload {
  title: string;
  plannedStartAt?: string | null;
  dueAt: string;
  assigneeMembershipIds: string[];
  description?: string;
  priority?: TaskPriority;
  statusDefinitionId?: string;
  departmentId?: string;
  followerMembershipIds?: string[];
  projectIds?: string[];
  tagIds?: string[];
  recurrence?: TaskRecurrencePayload;
  estimatedMinutes?: number | null;
}

export type UpdateTaskPayload = Partial<
  Pick<
    CreateTaskPayload,
    | 'title'
    | 'plannedStartAt'
    | 'dueAt'
    | 'description'
    | 'priority'
    | 'statusDefinitionId'
    | 'departmentId'
    | 'assigneeMembershipIds'
    | 'followerMembershipIds'
    | 'projectIds'
    | 'estimatedMinutes'
  >
> & { recurrenceEditScope?: TaskRecurrenceEditScope };

export interface TaskTimeEntry {
  id: string;
  workspaceId: string;
  taskId: string;
  userId: string;
  workspaceMembershipId: string;
  entryType: TaskTimeEntryType;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  stopReason: TaskTimeEntryStopReason | null;
  task: { id: string; title: string; status: WorkspaceStatusDefinition };
  workspace: { id: string; name: string };
  member: {
    membershipId: string;
    userId: string;
    name: string | null;
    email: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface TimeReportParams {
  page?: number;
  pageSize?: number;
  from?: string;
  to?: string;
  taskId?: string;
  workspaceMembershipId?: string;
  entryType?: TaskTimeEntryType;
}

export interface TaskWorkloadMember {
  membershipId: string;
  user: { id: string; name: string | null; email: string };
  plannedMinutes: number;
  capacityMinutes: number;
  weeklyCapacityMinutes: number;
  utilization: number | null;
  state: 'AVAILABLE' | 'BALANCED' | 'NEAR_CAPACITY' | 'OVER_CAPACITY';
}

export interface TaskWorkloadParams {
  view?: 'DAY' | 'WEEK';
  date?: string;
  page?: number;
  pageSize?: number;
}

export interface TaskViewFilters {
  search?: string;
  priority?: TaskPriority;
  assigneeMembershipId?: string;
  departmentId?: string;
  projectId?: string;
  tagId?: string;
}

export type CalendarUrgency = 'SAFE' | 'WARNING' | 'OVERDUE';

export interface TaskCalendarParams extends TaskViewFilters {
  view?: 'MONTH' | 'WEEK' | 'DAY';
  date?: string;
  page?: number;
  pageSize?: number;
}

export interface TaskCalendarDay {
  date: string;
  total: number;
  open: number;
  completed: number;
  overdue: number;
  priorityCounts: Record<TaskPriority, number>;
  statusCounts: { statusId: string; name: string; color: string; count: number }[];
  tasks: (WorkspaceTask & { urgency: CalendarUrgency })[];
}

export interface TaskCalendarResult {
  view: 'MONTH' | 'WEEK' | 'DAY';
  window: {
    start: string;
    end: string;
    startLocalDate: string;
    endLocalDate: string;
    timezone: string;
  };
  days: TaskCalendarDay[];
  page: number;
  pageSize: number;
  total: number;
}

export interface TaskGanttParams extends TaskViewFilters {
  from: string;
  to: string;
  page?: number;
  pageSize?: number;
}

export interface TaskGanttResult {
  window: { from: string; to: string; timezone: string };
  items: WorkspaceTask[];
  dependencies: { blockerTaskId: string; blockedTaskId: string }[];
  unscheduledItems: WorkspaceTask[];
  unscheduledCount: number;
  page: number;
  pageSize: number;
  total: number;
}

export interface TaskReportsParams extends TaskViewFilters {
  from?: string;
  to?: string;
}

export interface TaskReportsSummary {
  timezone: string;
  kpis: {
    totalTasks: number;
    open: number;
    completed: number;
    overdue: number;
    pendingApproval: number;
    completionRate: number;
  };
  distributions: Record<string, unknown>;
  completionTrend: { date: string; count: number }[];
  time: {
    estimatedMinutes: number;
    trackedSeconds: number | null;
    trackedTimeRestricted: boolean;
  };
  semantics: Record<string, string>;
}

export interface TaskActivityParams {
  page?: number;
  pageSize?: number;
  taskId?: string;
  userId?: string;
  action?: string;
  from?: string;
  to?: string;
}

export interface TaskActivityResult {
  timezone: string;
  items: {
    id: string;
    timestamp: string;
    action: string;
    entityType: string;
    entityId: string | null;
    actor: { id: string; email: string; name: string | null } | null;
    summary: string;
  }[];
  page: number;
  pageSize: number;
  total: number;
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

export interface TaskCommentAuthor {
  membershipId: string;
  userId: string;
  name: string | null;
  email: string;
}

export interface TaskCommentMention {
  membershipId: string;
  userId: string;
  name: string | null;
  email: string;
}

export interface TaskCommentSummary {
  id: string;
  workspaceId: string;
  taskId: string;
  parentCommentId: string | null;
  body: string | null;
  visibility: TaskCommentVisibility;
  deleted: boolean;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  author: TaskCommentAuthor;
  mentions: TaskCommentMention[];
  directReplyCount: number;
  reactionCounts: Record<TaskCommentReactionType, number>;
  currentUserReactions: TaskCommentReactionType[];
}

export interface TaskCommentPayload {
  body: string;
  visibility?: TaskCommentVisibility;
  mentionedMembershipIds?: string[];
}

export interface TaskCommentReactionResult {
  changed: boolean;
  reactionType: TaskCommentReactionType;
}

export interface WorkspaceTagSummary {
  id: string;
  workspaceId: string;
  name: string;
  color: string | null;
  status: WorkspaceTagStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ListWorkspaceTagsParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: WorkspaceTagStatus;
  sortBy?: WorkspaceTagSortBy;
  sortDirection?: TaskSortDirection;
}

export interface TaskTagMutationResult {
  requestedCount: number;
  changedCount: number;
  unchangedCount: number;
}

export interface TaskAttachmentAsset {
  id: string;
  workspaceId: string;
  projectId: string | null;
  originalFilename: string;
  displayName: string;
  mimeType: string;
  extension: string | null;
  sizeBytes: number;
  checksum: string | null;
  status: 'UPLOADING' | 'PROCESSING' | 'READY' | 'FAILED' | 'DELETED';
  uploadExpiresAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskAttachmentSummary {
  id: string;
  workspaceId: string;
  taskId?: string;
  type: TaskAttachmentType;
  displayName: string;
  url: string | null;
  file: TaskAttachmentAsset | null;
  attachedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskAttachmentUploadInit {
  attachment: TaskAttachmentSummary;
  uploadUrl: string;
  expiresAt: string;
}

export interface TaskRecurrenceSeries {
  id: string;
  workspaceId: string;
  status: TaskRecurrenceStatus;
  title: string;
  description: string | null;
  priority: TaskPriority;
  statusDefinitionId: string;
  departmentId: string | null;
  timezone: string;
  frequency: TaskRecurrenceFrequency;
  interval: number;
  customIntervalUnit: TaskRecurrenceCustomUnit | null;
  startLocalDate: string;
  localTime: string;
  selectedWeekdays: number[];
  monthlyDay: number | null;
  endMode: TaskRecurrenceEndMode;
  untilLocalDate: string | null;
  maxOccurrences: number | null;
  nextOccurrenceAt: string | null;
  lastGeneratedAt: string | null;
  generatedCount: number;
  endedAt: string | null;
  lastErrorCode: string | null;
  assigneeMembershipIds: string[];
  followerMembershipIds: string[];
  projectIds: string[];
  tagIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskTemplate {
  id: string;
  workspaceId: string;
  name: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskTemplateStatus;
  statusDefinitionId: string;
  departmentId: string | null;
  assigneeMembershipIds: string[];
  followerMembershipIds: string[];
  projectIds: string[];
  tagIds: string[];
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskTemplatePayload {
  name: string;
  title: string;
  description?: string | null;
  priority?: TaskPriority;
  statusDefinitionId?: string;
  departmentId?: string | null;
  assigneeMembershipIds?: string[];
  followerMembershipIds?: string[];
  projectIds?: string[];
  tagIds?: string[];
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
  tagId?: string;
}

export interface ListTaskRecurrenceSeriesParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: TaskRecurrenceStatus;
}

export interface ListTaskTemplatesParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: TaskTemplateStatus;
}

export interface TaskKanbanColumn {
  status: WorkspaceStatusDefinition & { position?: number };
  wipLimit: number | null;
}

export interface TaskKanbanSettings {
  columns: TaskKanbanColumn[];
}

export interface MoveTaskKanbanPayload {
  statusDefinitionId: string;
  beforeTaskId?: string | null;
  afterTaskId?: string | null;
  completion?: SubmitTaskCompletionPayload;
}

export interface TaskCompletionPolicy {
  id: string | null;
  workspaceId?: string;
  taskId: string;
  proofRequirementMode: TaskCompletionProofRequirementMode;
  requiredProofTypes: TaskCompletionProofType[];
  approvalRequired: boolean;
  approverMode: TaskCompletionApproverMode | null;
  includeTaskCreator: boolean;
  includePermissionApprovers: boolean;
  includeProjectOwnersManagers: boolean;
  explicitApproverMembershipIds: string[];
  approvers: TaskCompletionMembership[];
  createdAt?: string;
  updatedAt?: string;
}

export interface TaskCompletionMembership {
  membershipId: string;
  userId: string;
  name: string | null;
  email: string;
}

export interface CompletionProofItemPayload {
  type: TaskCompletionProofType;
  textValue?: string;
  url?: string;
  checklistConfirmed?: boolean;
  attachmentId?: string;
}

export interface SubmitTaskCompletionPayload {
  proofItems?: CompletionProofItemPayload[];
}

export interface TaskCompletionSubmission {
  id: string;
  workspaceId: string;
  taskId: string;
  version: number;
  status: TaskCompletionSubmissionStatus;
  requestedTerminalStatusDefinitionId: string;
  previousStatusDefinitionId: string;
  requestedTerminalStatus: WorkspaceStatusDefinition;
  previousStatus: WorkspaceStatusDefinition;
  submittedBy: TaskCompletionMembership;
  submittedAt: string;
  proofRequirementMode: TaskCompletionProofRequirementMode;
  requiredProofTypes: TaskCompletionProofType[];
  approvalRequired: boolean;
  approverMode: TaskCompletionApproverMode | null;
  resolvedAt: string | null;
  proofItems: {
    id: string;
    type: TaskCompletionProofType;
    textValue: string | null;
    url: string | null;
    checklistConfirmed: boolean | null;
    attachments: TaskAttachmentSummary[];
    createdAt: string;
  }[];
  approvers: {
    membershipId: string;
    membership: TaskCompletionMembership;
    sources: string[];
  }[];
  decisions: {
    id: string;
    approverMembershipId: string;
    decision: TaskCompletionDecision;
    reason: string | null;
    decidedAt: string;
    approver: TaskCompletionMembership;
  }[];
  approvalProgress: {
    approvedCount: number;
    rejectedCount: number;
    totalApproverCount: number;
    mode: TaskCompletionApproverMode | null;
  };
  createdAt: string;
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
      | 'tagId'
    >
  >;

export const taskKeys = {
  all: (workspaceId: string | null) => ['workspace', workspaceId, 'tasks'] as const,
  list: (workspaceId: string | null, params: NormalizedTaskListParams) =>
    ['workspace', workspaceId, 'tasks', 'list', params] as const,
  kanbanSettings: (workspaceId: string | null) =>
    ['workspace', workspaceId, 'tasks', 'kanban', 'settings'] as const,
  kanbanColumns: (workspaceId: string | null) =>
    ['workspace', workspaceId, 'tasks', 'kanban', 'column'] as const,
  kanbanColumn: (
    workspaceId: string | null,
    statusDefinitionId: string | null,
    params: NormalizedTaskListParams,
  ) => [...taskKeys.kanbanColumns(workspaceId), statusDefinitionId, params] as const,
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
  commentsBase: (workspaceId: string | null, taskId: string | null) =>
    ['workspace', workspaceId, 'tasks', 'detail', taskId, 'comments'] as const,
  comments: (
    workspaceId: string | null,
    taskId: string | null,
    params: Pick<NormalizedTaskListParams, 'page' | 'pageSize'>,
  ) => [...taskKeys.commentsBase(workspaceId, taskId), params] as const,
  attachmentsBase: (workspaceId: string | null, taskId: string | null) =>
    ['workspace', workspaceId, 'tasks', 'detail', taskId, 'attachments'] as const,
  attachments: (
    workspaceId: string | null,
    taskId: string | null,
    params: Pick<NormalizedTaskListParams, 'page' | 'pageSize'>,
  ) => [...taskKeys.attachmentsBase(workspaceId, taskId), params] as const,
  completionPolicy: (workspaceId: string | null, taskId: string | null) =>
    ['workspace', workspaceId, 'tasks', 'detail', taskId, 'completion-policy'] as const,
  completionSubmissions: (
    workspaceId: string | null,
    taskId: string | null,
    params: Pick<NormalizedTaskListParams, 'page' | 'pageSize'>,
  ) =>
    [
      'workspace',
      workspaceId,
      'tasks',
      'detail',
      taskId,
      'completion-submissions',
      params,
    ] as const,
  completionApprovals: (
    workspaceId: string | null,
    params: Pick<NormalizedTaskListParams, 'page' | 'pageSize'>,
  ) => ['workspace', workspaceId, 'tasks', 'completion-approvals', params] as const,
  repliesBase: (workspaceId: string | null, taskId: string | null, commentId: string | null) =>
    [
      'workspace',
      workspaceId,
      'tasks',
      'detail',
      taskId,
      'comments',
      commentId,
      'replies',
    ] as const,
  replies: (
    workspaceId: string | null,
    taskId: string | null,
    commentId: string | null,
    params: Pick<NormalizedTaskListParams, 'page' | 'pageSize'>,
  ) => [...taskKeys.repliesBase(workspaceId, taskId, commentId), params] as const,
  relationshipSearch: (
    workspaceId: string | null,
    taskId: string | null,
    search: string,
    params: Pick<NormalizedTaskListParams, 'page' | 'pageSize'>,
  ) => ['workspace', workspaceId, 'tasks', 'relationship-search', taskId, search, params] as const,
  tags: (workspaceId: string | null, taskId: string | null) =>
    ['workspace', workspaceId, 'tasks', 'detail', taskId, 'tags'] as const,
  tagCatalogBase: (workspaceId: string | null) => ['workspace', workspaceId, 'tags'] as const,
  tagCatalog: (workspaceId: string | null, params: NormalizedWorkspaceTagListParams) =>
    [...taskKeys.tagCatalogBase(workspaceId), params] as const,
  recurrenceBase: (workspaceId: string | null) =>
    ['workspace', workspaceId, 'tasks', 'recurrence'] as const,
  recurrenceList: (workspaceId: string | null, params: NormalizedTaskRecurrenceListParams) =>
    [...taskKeys.recurrenceBase(workspaceId), 'list', params] as const,
  templatesBase: (workspaceId: string | null) =>
    ['workspace', workspaceId, 'tasks', 'templates'] as const,
  templatesList: (workspaceId: string | null, params: NormalizedTaskTemplateListParams) =>
    [...taskKeys.templatesBase(workspaceId), 'list', params] as const,
  activeTimer: () => ['me', 'time-tracking', 'active'] as const,
  timeReport: (workspaceId: string | null, params: TimeReportParams) =>
    ['workspace', workspaceId, 'tasks', 'time-report', params] as const,
  workload: (workspaceId: string | null, params: TaskWorkloadParams) =>
    ['workspace', workspaceId, 'tasks', 'workload', params] as const,
  calendar: (workspaceId: string | null, params: TaskCalendarParams) =>
    ['workspace', workspaceId, 'tasks', 'calendar', params] as const,
  gantt: (workspaceId: string | null, params: TaskGanttParams) =>
    ['workspace', workspaceId, 'tasks', 'gantt', params] as const,
  reports: (workspaceId: string | null, params: TaskReportsParams) =>
    ['workspace', workspaceId, 'tasks', 'reports', params] as const,
  activity: (workspaceId: string | null, params: TaskActivityParams) =>
    ['workspace', workspaceId, 'tasks', 'activity', params] as const,
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

export async function getActiveTimer() {
  const response = await apiClient.request<TaskTimeEntry | null>('/me/time-tracking/active');
  return response.data;
}

export async function stopActiveTimer() {
  const response = await apiClient.request<TaskTimeEntry | null>('/me/time-tracking/active/stop', {
    method: 'POST',
  });
  return response.data;
}

export async function startTaskTimer(
  workspaceId: string,
  taskId: string,
  body: { replaceRunning?: boolean } = {},
) {
  const response = await apiClient.request<TaskTimeEntry>(
    `/workspaces/${workspaceId}/tasks/${taskId}/time/start`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  return response.data;
}

export async function addManualTaskTime(
  workspaceId: string,
  taskId: string,
  body: {
    startedAt: string;
    endedAt?: string;
    durationSeconds?: number;
    workspaceMembershipId?: string;
  },
) {
  const response = await apiClient.request<TaskTimeEntry>(
    `/workspaces/${workspaceId}/tasks/${taskId}/time`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  return response.data;
}

export async function listTaskTimeEntries(
  workspaceId: string,
  taskId: string,
  params: TimeReportParams,
) {
  const response = await apiClient.request<
    PageResult<TaskTimeEntry> & {
      summary: { totalDurationSeconds: number; asOf: string; timezone: string };
    }
  >(`/workspaces/${workspaceId}/tasks/${taskId}/time?${timeReportQueryString(params)}`);
  return response.data;
}

export async function listWorkspaceTimeReport(workspaceId: string, params: TimeReportParams) {
  const response = await apiClient.request<
    PageResult<TaskTimeEntry> & {
      summary: { totalDurationSeconds: number; asOf: string; timezone: string };
    }
  >(`/workspaces/${workspaceId}/tasks/time/report?${timeReportQueryString(params)}`);
  return response.data;
}

export async function listWorkspaceWorkload(workspaceId: string, params: TaskWorkloadParams) {
  const response = await apiClient.request<
    PageResult<TaskWorkloadMember> & {
      window: { start: string; end: string; timezone: string };
      summary: {
        unallocatedMinutes: number;
        unscheduledMinutes: number;
        overdueMinutes: number;
      };
    }
  >(`/workspaces/${workspaceId}/tasks/workload?${workloadQueryString(params)}`);
  return response.data;
}

export async function getTaskCalendar(workspaceId: string, params: TaskCalendarParams = {}) {
  const response = await apiClient.request<TaskCalendarResult>(
    `/workspaces/${workspaceId}/tasks/calendar?${taskViewsQueryString(params as unknown as Record<string, unknown>)}`,
  );
  return response.data;
}

export async function getTaskGantt(workspaceId: string, params: TaskGanttParams) {
  const response = await apiClient.request<TaskGanttResult>(
    `/workspaces/${workspaceId}/tasks/gantt?${taskViewsQueryString(params as unknown as Record<string, unknown>)}`,
  );
  return response.data;
}

export async function updateTaskSchedule(
  workspaceId: string,
  taskId: string,
  body: { plannedStartAt?: string | null; dueAt?: string | null },
) {
  const response = await apiClient.request<WorkspaceTask>(
    `/workspaces/${workspaceId}/tasks/${taskId}/schedule`,
    { method: 'PATCH', body: JSON.stringify(body) },
  );
  return response.data;
}

export async function getTaskReportsSummary(workspaceId: string, params: TaskReportsParams = {}) {
  const response = await apiClient.request<TaskReportsSummary>(
    `/workspaces/${workspaceId}/tasks/reports/summary?${taskViewsQueryString(params as unknown as Record<string, unknown>)}`,
  );
  return response.data;
}

export async function exportTaskReportsCsv(workspaceId: string, params: TaskReportsParams = {}) {
  const response = await apiClient.request<{ filename: string; contentType: string; csv: string }>(
    `/workspaces/${workspaceId}/tasks/reports/export?${taskViewsQueryString(params as unknown as Record<string, unknown>)}`,
  );
  return response.data;
}

export async function getTaskActivity(workspaceId: string, params: TaskActivityParams = {}) {
  const response = await apiClient.request<TaskActivityResult>(
    `/workspaces/${workspaceId}/tasks/activity?${taskViewsQueryString(params as unknown as Record<string, unknown>)}`,
  );
  return response.data;
}

export async function exportTaskActivityCsv(workspaceId: string, params: TaskActivityParams = {}) {
  const response = await apiClient.request<{ filename: string; contentType: string; csv: string }>(
    `/workspaces/${workspaceId}/tasks/activity/export?${taskViewsQueryString(params as unknown as Record<string, unknown>)}`,
  );
  return response.data;
}

export async function updateWorkspaceMemberCapacity(
  workspaceId: string,
  membershipId: string,
  body: { weeklyCapacityMinutes: number },
) {
  const response = await apiClient.request<{
    workspaceMembershipId: string;
    weeklyCapacityMinutes: number;
    updatedAt: string;
  }>(`/workspaces/${workspaceId}/tasks/workload/capacity/${membershipId}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  return response.data;
}

export async function getTaskKanbanSettings(workspaceId: string) {
  const response = await apiClient.request<TaskKanbanSettings>(
    `/workspaces/${workspaceId}/tasks/kanban/settings`,
  );
  return response.data;
}

export async function updateTaskKanbanColumnSetting(
  workspaceId: string,
  statusDefinitionId: string,
  body: { wipLimit: number | null },
) {
  const response = await apiClient.request<{ statusDefinitionId: string; wipLimit: number | null }>(
    `/workspaces/${workspaceId}/tasks/kanban/columns/${statusDefinitionId}`,
    { method: 'PATCH', body: JSON.stringify(body) },
  );
  return response.data;
}

export async function moveWorkspaceTaskKanban(
  workspaceId: string,
  taskId: string,
  body: MoveTaskKanbanPayload,
) {
  const response = await apiClient.request<WorkspaceTask>(
    `/workspaces/${workspaceId}/tasks/${taskId}/kanban-position`,
    { method: 'PATCH', body: JSON.stringify(body) },
  );
  return response.data;
}

export async function getWorkspaceTask(workspaceId: string, taskId: string) {
  const response = await apiClient.request<WorkspaceTask>(
    `/workspaces/${workspaceId}/tasks/${taskId}`,
  );
  return response.data;
}

export async function updateWorkspaceTaskStatus(
  workspaceId: string,
  taskId: string,
  body: { statusDefinitionId: string; completion?: SubmitTaskCompletionPayload },
) {
  const response = await apiClient.request<WorkspaceTask>(
    `/workspaces/${workspaceId}/tasks/${taskId}/status`,
    { method: 'PATCH', body: JSON.stringify(body) },
  );
  return response.data;
}

export async function getTaskCompletionPolicy(workspaceId: string, taskId: string) {
  const response = await apiClient.request<TaskCompletionPolicy>(
    `/workspaces/${workspaceId}/tasks/${taskId}/completion-policy`,
  );
  return response.data;
}

export async function updateTaskCompletionPolicy(
  workspaceId: string,
  taskId: string,
  body: TaskCompletionPolicy,
) {
  const response = await apiClient.request<TaskCompletionPolicy>(
    `/workspaces/${workspaceId}/tasks/${taskId}/completion-policy`,
    { method: 'PUT', body: JSON.stringify(compactCompletionPolicyPayload(body)) },
  );
  return response.data;
}

export async function submitTaskCompletion(
  workspaceId: string,
  taskId: string,
  statusDefinitionId: string,
  body: SubmitTaskCompletionPayload,
) {
  const query = new URLSearchParams({ statusDefinitionId });
  const response = await apiClient.request<WorkspaceTask>(
    `/workspaces/${workspaceId}/tasks/${taskId}/completion-submissions?${query}`,
    { method: 'POST', body: JSON.stringify(compactCompletionSubmissionPayload(body)) },
  );
  return response.data;
}

export async function listTaskCompletionSubmissions(
  workspaceId: string,
  taskId: string,
  params: Pick<ListWorkspaceTasksParams, 'page' | 'pageSize'> = {},
) {
  const normalized = normalizeSubtaskPagination(params);
  const query = new URLSearchParams({
    page: String(normalized.page),
    pageSize: String(normalized.pageSize),
  });
  const response = await apiClient.request<PageResult<TaskCompletionSubmission>>(
    `/workspaces/${workspaceId}/tasks/${taskId}/completion-submissions?${query}`,
  );
  return response.data;
}

export async function listTaskCompletionApprovals(
  workspaceId: string,
  params: Pick<ListWorkspaceTasksParams, 'page' | 'pageSize'> = {},
) {
  const normalized = normalizeSubtaskPagination(params);
  const query = new URLSearchParams({
    page: String(normalized.page),
    pageSize: String(normalized.pageSize),
  });
  const response = await apiClient.request<PageResult<TaskCompletionSubmission>>(
    `/workspaces/${workspaceId}/tasks/completion/approvals?${query}`,
  );
  return response.data;
}

export async function decideTaskCompletion(
  workspaceId: string,
  taskId: string,
  submissionId: string,
  body: { decision: TaskCompletionDecision; reason?: string },
) {
  const response = await apiClient.request<TaskCompletionSubmission>(
    `/workspaces/${workspaceId}/tasks/${taskId}/completion-submissions/${submissionId}/decisions`,
    {
      method: 'POST',
      body: JSON.stringify({ decision: body.decision, reason: body.reason?.trim() }),
    },
  );
  return response.data;
}

export async function updateWorkspaceTask(
  workspaceId: string,
  taskId: string,
  body: UpdateTaskPayload,
) {
  const response = await apiClient.request<WorkspaceTask>(
    `/workspaces/${workspaceId}/tasks/${taskId}`,
    { method: 'PATCH', body: JSON.stringify(compactUpdateTaskPayload(body)) },
  );
  return response.data;
}

export async function makeWorkspaceTaskRecurring(
  workspaceId: string,
  taskId: string,
  body: TaskRecurrencePayload,
) {
  const response = await apiClient.request<WorkspaceTask>(
    `/workspaces/${workspaceId}/tasks/${taskId}/recurrence`,
    { method: 'POST', body: JSON.stringify(compactRecurrencePayload(body)) },
  );
  return response.data;
}

export async function listTaskRecurrenceSeries(
  workspaceId: string,
  params: ListTaskRecurrenceSeriesParams = {},
) {
  const normalized = normalizeTaskRecurrenceListParams(params);
  const query = new URLSearchParams({
    page: String(normalized.page),
    pageSize: String(normalized.pageSize),
    sortBy: 'createdAt',
    sortDirection: 'desc',
  });
  if (normalized.search) query.set('search', normalized.search);
  if (normalized.status) query.set('status', normalized.status);
  const response = await apiClient.request<PageResult<TaskRecurrenceSeries>>(
    `/workspaces/${workspaceId}/tasks/recurrence?${query}`,
  );
  return response.data;
}

export async function pauseTaskRecurrence(workspaceId: string, seriesId: string) {
  const response = await apiClient.request<TaskRecurrenceSeries>(
    `/workspaces/${workspaceId}/tasks/recurrence/${seriesId}/pause`,
    { method: 'PATCH' },
  );
  return response.data;
}

export async function resumeTaskRecurrence(workspaceId: string, seriesId: string) {
  const response = await apiClient.request<TaskRecurrenceSeries>(
    `/workspaces/${workspaceId}/tasks/recurrence/${seriesId}/resume`,
    { method: 'PATCH' },
  );
  return response.data;
}

export async function endTaskRecurrence(workspaceId: string, seriesId: string) {
  const response = await apiClient.request<TaskRecurrenceSeries>(
    `/workspaces/${workspaceId}/tasks/recurrence/${seriesId}/end`,
    { method: 'PATCH' },
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

export async function listWorkspaceTaskComments(
  workspaceId: string,
  taskId: string,
  params: Pick<ListWorkspaceTasksParams, 'page' | 'pageSize'>,
) {
  const normalized = normalizeCommentPagination(params);
  const query = new URLSearchParams({
    page: String(normalized.page),
    pageSize: String(normalized.pageSize),
  });
  const response = await apiClient.request<PageResult<TaskCommentSummary>>(
    `/workspaces/${workspaceId}/tasks/${taskId}/comments?${query}`,
  );
  return response.data;
}

export async function listWorkspaceTaskCommentReplies(
  workspaceId: string,
  taskId: string,
  commentId: string,
  params: Pick<ListWorkspaceTasksParams, 'page' | 'pageSize'>,
) {
  const normalized = normalizeCommentPagination(params);
  const query = new URLSearchParams({
    page: String(normalized.page),
    pageSize: String(normalized.pageSize),
  });
  const response = await apiClient.request<PageResult<TaskCommentSummary>>(
    `/workspaces/${workspaceId}/tasks/${taskId}/comments/${commentId}/replies?${query}`,
  );
  return response.data;
}

export async function createWorkspaceTaskComment(
  workspaceId: string,
  taskId: string,
  body: TaskCommentPayload,
) {
  const response = await apiClient.request<TaskCommentSummary>(
    `/workspaces/${workspaceId}/tasks/${taskId}/comments`,
    { method: 'POST', body: JSON.stringify(compactCommentPayload(body)) },
  );
  return response.data;
}

export async function createWorkspaceTaskCommentReply(
  workspaceId: string,
  taskId: string,
  commentId: string,
  body: TaskCommentPayload,
) {
  const response = await apiClient.request<TaskCommentSummary>(
    `/workspaces/${workspaceId}/tasks/${taskId}/comments/${commentId}/replies`,
    { method: 'POST', body: JSON.stringify(compactCommentPayload(body)) },
  );
  return response.data;
}

export async function updateWorkspaceTaskComment(
  workspaceId: string,
  taskId: string,
  commentId: string,
  body: { body: string },
) {
  const response = await apiClient.request<TaskCommentSummary>(
    `/workspaces/${workspaceId}/tasks/${taskId}/comments/${commentId}`,
    { method: 'PATCH', body: JSON.stringify({ body: body.body.trim() }) },
  );
  return response.data;
}

export async function deleteWorkspaceTaskComment(
  workspaceId: string,
  taskId: string,
  commentId: string,
) {
  const response = await apiClient.request<TaskCommentSummary>(
    `/workspaces/${workspaceId}/tasks/${taskId}/comments/${commentId}`,
    { method: 'DELETE' },
  );
  return response.data;
}

export async function addWorkspaceTaskCommentReaction(
  workspaceId: string,
  taskId: string,
  commentId: string,
  reactionType: TaskCommentReactionType,
) {
  const response = await apiClient.request<TaskCommentReactionResult>(
    `/workspaces/${workspaceId}/tasks/${taskId}/comments/${commentId}/reactions`,
    { method: 'POST', body: JSON.stringify({ reactionType }) },
  );
  return response.data;
}

export async function removeWorkspaceTaskCommentReaction(
  workspaceId: string,
  taskId: string,
  commentId: string,
  reactionType: TaskCommentReactionType,
) {
  const response = await apiClient.request<TaskCommentReactionResult>(
    `/workspaces/${workspaceId}/tasks/${taskId}/comments/${commentId}/reactions/remove`,
    { method: 'POST', body: JSON.stringify({ reactionType }) },
  );
  return response.data;
}

export async function listWorkspaceTags(workspaceId: string, params: ListWorkspaceTagsParams = {}) {
  const normalized = normalizeWorkspaceTagListParams(params);
  const query = new URLSearchParams({
    page: String(normalized.page),
    pageSize: String(normalized.pageSize),
    sortBy: normalized.sortBy,
    sortDirection: normalized.sortDirection,
  });
  if (normalized.search) query.set('search', normalized.search);
  if (normalized.status) query.set('status', normalized.status);
  const response = await apiClient.request<PageResult<WorkspaceTagSummary>>(
    `/workspaces/${workspaceId}/tags?${query}`,
  );
  return response.data;
}

export async function createWorkspaceTag(
  workspaceId: string,
  body: { name: string; color?: string | null },
) {
  const response = await apiClient.request<WorkspaceTagSummary>(`/workspaces/${workspaceId}/tags`, {
    method: 'POST',
    body: JSON.stringify(compactWorkspaceTagPayload(body)),
  });
  return response.data;
}

export async function updateWorkspaceTag(
  workspaceId: string,
  tagId: string,
  body: { name?: string; color?: string | null },
) {
  const response = await apiClient.request<WorkspaceTagSummary>(
    `/workspaces/${workspaceId}/tags/${tagId}`,
    { method: 'PATCH', body: JSON.stringify(compactWorkspaceTagPayload(body)) },
  );
  return response.data;
}

export async function archiveWorkspaceTag(workspaceId: string, tagId: string) {
  const response = await apiClient.request<WorkspaceTagSummary>(
    `/workspaces/${workspaceId}/tags/${tagId}/archive`,
    { method: 'POST' },
  );
  return response.data;
}

export async function reactivateWorkspaceTag(workspaceId: string, tagId: string) {
  const response = await apiClient.request<WorkspaceTagSummary>(
    `/workspaces/${workspaceId}/tags/${tagId}/reactivate`,
    { method: 'POST' },
  );
  return response.data;
}

export async function getTaskTags(workspaceId: string, taskId: string) {
  const response = await apiClient.request<WorkspaceTagSummary[]>(
    `/workspaces/${workspaceId}/tasks/${taskId}/tags`,
  );
  return response.data;
}

export async function addTaskTags(workspaceId: string, taskId: string, tagIds: string[]) {
  const response = await apiClient.request<TaskTagMutationResult>(
    `/workspaces/${workspaceId}/tasks/${taskId}/tags/add`,
    { method: 'POST', body: JSON.stringify({ tagIds: uniqueIds(tagIds) }) },
  );
  return response.data;
}

export async function removeTaskTags(workspaceId: string, taskId: string, tagIds: string[]) {
  const response = await apiClient.request<TaskTagMutationResult>(
    `/workspaces/${workspaceId}/tasks/${taskId}/tags/remove`,
    { method: 'POST', body: JSON.stringify({ tagIds: uniqueIds(tagIds) }) },
  );
  return response.data;
}

export async function listTaskAttachments(
  workspaceId: string,
  taskId: string,
  params: Pick<ListWorkspaceTasksParams, 'page' | 'pageSize'>,
) {
  const normalized = normalizeSubtaskPagination(params);
  const query = new URLSearchParams({
    page: String(normalized.page),
    pageSize: String(normalized.pageSize),
  });
  const response = await apiClient.request<PageResult<TaskAttachmentSummary>>(
    `/workspaces/${workspaceId}/tasks/${taskId}/attachments?${query}`,
  );
  return response.data;
}

export async function initTaskAttachmentUpload(
  workspaceId: string,
  taskId: string,
  body: { filename: string; mimeType: string; sizeBytes: number; displayName?: string },
) {
  const response = await apiClient.request<TaskAttachmentUploadInit>(
    `/workspaces/${workspaceId}/tasks/${taskId}/attachments/upload-init`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  return response.data;
}

export async function completeTaskAttachmentUpload(
  workspaceId: string,
  taskId: string,
  attachmentId: string,
  body: { sizeBytes: number },
) {
  const response = await apiClient.request<TaskAttachmentSummary>(
    `/workspaces/${workspaceId}/tasks/${taskId}/attachments/${attachmentId}/upload-complete`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  return response.data;
}

export async function addTaskUrlAttachment(
  workspaceId: string,
  taskId: string,
  body: { url: string; displayName?: string },
) {
  const response = await apiClient.request<TaskAttachmentSummary>(
    `/workspaces/${workspaceId}/tasks/${taskId}/attachments/url`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  return response.data;
}

export async function downloadTaskAttachment(
  workspaceId: string,
  taskId: string,
  attachmentId: string,
) {
  const response = await apiClient.request<{ downloadUrl: string; expiresInSeconds: number }>(
    `/workspaces/${workspaceId}/tasks/${taskId}/attachments/${attachmentId}/download`,
  );
  return response.data;
}

export async function removeTaskAttachment(
  workspaceId: string,
  taskId: string,
  attachmentId: string,
) {
  const response = await apiClient.request<{ changed: boolean }>(
    `/workspaces/${workspaceId}/tasks/${taskId}/attachments/${attachmentId}`,
    { method: 'DELETE' },
  );
  return response.data;
}

export async function listTaskTemplates(workspaceId: string, params: ListTaskTemplatesParams = {}) {
  const normalized = normalizeTaskTemplateListParams(params);
  const query = new URLSearchParams({
    page: String(normalized.page),
    pageSize: String(normalized.pageSize),
    sortBy: 'createdAt',
    sortDirection: 'desc',
  });
  if (normalized.search) query.set('search', normalized.search);
  if (normalized.status) query.set('status', normalized.status);
  const response = await apiClient.request<PageResult<TaskTemplate>>(
    `/workspaces/${workspaceId}/tasks/templates?${query}`,
  );
  return response.data;
}

export async function createTaskTemplate(workspaceId: string, body: TaskTemplatePayload) {
  const response = await apiClient.request<TaskTemplate>(
    `/workspaces/${workspaceId}/tasks/templates`,
    { method: 'POST', body: JSON.stringify(compactTemplatePayload(body)) },
  );
  return response.data;
}

export async function updateTaskTemplate(
  workspaceId: string,
  templateId: string,
  body: TaskTemplatePayload,
) {
  const response = await apiClient.request<TaskTemplate>(
    `/workspaces/${workspaceId}/tasks/templates/${templateId}`,
    { method: 'PATCH', body: JSON.stringify(compactTemplatePayload(body)) },
  );
  return response.data;
}

export async function archiveTaskTemplate(workspaceId: string, templateId: string) {
  const response = await apiClient.request<TaskTemplate>(
    `/workspaces/${workspaceId}/tasks/templates/${templateId}/archive`,
    { method: 'PATCH' },
  );
  return response.data;
}

export async function reactivateTaskTemplate(workspaceId: string, templateId: string) {
  const response = await apiClient.request<TaskTemplate>(
    `/workspaces/${workspaceId}/tasks/templates/${templateId}/reactivate`,
    { method: 'PATCH' },
  );
  return response.data;
}

export async function saveTaskAsTemplate(workspaceId: string, taskId: string, name: string) {
  const response = await apiClient.request<TaskTemplate>(
    `/workspaces/${workspaceId}/tasks/${taskId}/templates`,
    { method: 'POST', body: JSON.stringify({ name: name.trim() }) },
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
  const response = await apiClient.request<PageResult<WorkspaceProject>>(
    `/workspaces/${params.workspaceId}/projects?${query}`,
  );
  return response.data;
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
    ...(params.tagId ? { tagId: params.tagId } : {}),
  };
}

export type NormalizedWorkspaceTagListParams = Required<
  Pick<ListWorkspaceTagsParams, 'page' | 'pageSize' | 'sortBy' | 'sortDirection'>
> &
  Partial<Pick<ListWorkspaceTagsParams, 'search' | 'status'>>;

export type NormalizedTaskRecurrenceListParams = Required<
  Pick<ListTaskRecurrenceSeriesParams, 'page' | 'pageSize'>
> &
  Partial<Pick<ListTaskRecurrenceSeriesParams, 'search' | 'status'>>;

export type NormalizedTaskTemplateListParams = Required<
  Pick<ListTaskTemplatesParams, 'page' | 'pageSize'>
> &
  Partial<Pick<ListTaskTemplatesParams, 'search' | 'status'>>;

export function normalizeWorkspaceTagListParams(
  params: ListWorkspaceTagsParams,
): NormalizedWorkspaceTagListParams {
  return {
    page: clampNumber(params.page, 1, Number.MAX_SAFE_INTEGER, 1),
    pageSize: [10, 20, 50, 100].includes(Number(params.pageSize)) ? Number(params.pageSize) : 20,
    sortBy: isWorkspaceTagSortBy(params.sortBy) ? params.sortBy : 'createdAt',
    sortDirection: params.sortDirection === 'asc' ? 'asc' : 'desc',
    ...(params.search?.trim() ? { search: params.search.trim() } : {}),
    ...(params.status === 'ACTIVE' || params.status === 'ARCHIVED'
      ? { status: params.status }
      : {}),
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

function normalizeCommentPagination(params: Pick<ListWorkspaceTasksParams, 'page' | 'pageSize'>) {
  return {
    page: clampNumber(params.page, 1, Number.MAX_SAFE_INTEGER, 1),
    pageSize: [5, 10, 25, 50].includes(Number(params.pageSize)) ? Number(params.pageSize) : 10,
  };
}

function compactCommentPayload(body: TaskCommentPayload) {
  return {
    body: body.body.trim(),
    visibility: body.visibility ?? 'NORMAL',
    mentionedMembershipIds: uniqueIds(body.mentionedMembershipIds ?? []),
  };
}

function compactWorkspaceTagPayload(body: { name?: string; color?: string | null }) {
  return {
    ...(body.name !== undefined ? { name: body.name.trim() } : {}),
    ...(body.color !== undefined ? { color: body.color } : {}),
  };
}

function compactCompletionPolicyPayload(body: TaskCompletionPolicy) {
  return {
    proofRequirementMode: body.proofRequirementMode,
    requiredProofTypes:
      body.proofRequirementMode === 'SPECIFIC' ? uniqueIds(body.requiredProofTypes) : [],
    approvalRequired: body.approvalRequired,
    approverMode: body.approvalRequired ? (body.approverMode ?? 'ANY_ONE') : null,
    includeTaskCreator: body.approvalRequired && body.includeTaskCreator,
    includePermissionApprovers: body.approvalRequired && body.includePermissionApprovers,
    includeProjectOwnersManagers: body.approvalRequired && body.includeProjectOwnersManagers,
    explicitApproverMembershipIds: body.approvalRequired
      ? uniqueIds(body.explicitApproverMembershipIds)
      : [],
  };
}

function compactCompletionSubmissionPayload(body: SubmitTaskCompletionPayload) {
  return {
    proofItems: (body.proofItems ?? []).map((item) => ({
      type: item.type,
      ...(item.textValue?.trim() ? { textValue: item.textValue.trim() } : {}),
      ...(item.url?.trim() ? { url: item.url.trim() } : {}),
      ...(item.checklistConfirmed !== undefined
        ? { checklistConfirmed: item.checklistConfirmed }
        : {}),
      ...(item.attachmentId ? { attachmentId: item.attachmentId } : {}),
    })),
  };
}

function compactTaskPayload(body: CreateTaskPayload) {
  return {
    title: body.title.trim(),
    ...(body.plannedStartAt !== undefined ? { plannedStartAt: body.plannedStartAt } : {}),
    dueAt: body.dueAt,
    assigneeMembershipIds: body.assigneeMembershipIds,
    ...(body.description?.trim() ? { description: body.description.trim() } : {}),
    ...(body.priority ? { priority: body.priority } : {}),
    ...(body.statusDefinitionId ? { statusDefinitionId: body.statusDefinitionId } : {}),
    ...(body.departmentId ? { departmentId: body.departmentId } : {}),
    ...(body.estimatedMinutes !== undefined ? { estimatedMinutes: body.estimatedMinutes } : {}),
    ...(body.followerMembershipIds?.length
      ? { followerMembershipIds: body.followerMembershipIds }
      : {}),
    ...(body.projectIds?.length ? { projectIds: body.projectIds } : {}),
    ...(body.tagIds?.length ? { tagIds: body.tagIds } : {}),
    ...(body.recurrence ? { recurrence: compactRecurrencePayload(body.recurrence) } : {}),
  };
}

function compactUpdateTaskPayload(body: UpdateTaskPayload) {
  return {
    ...(body.title !== undefined ? { title: body.title.trim() } : {}),
    ...(body.plannedStartAt !== undefined ? { plannedStartAt: body.plannedStartAt } : {}),
    ...(body.dueAt !== undefined ? { dueAt: body.dueAt } : {}),
    ...(body.description !== undefined ? { description: body.description?.trim() ?? null } : {}),
    ...(body.priority ? { priority: body.priority } : {}),
    ...(body.statusDefinitionId !== undefined
      ? { statusDefinitionId: body.statusDefinitionId }
      : {}),
    ...(body.departmentId !== undefined ? { departmentId: body.departmentId || null } : {}),
    ...(body.estimatedMinutes !== undefined ? { estimatedMinutes: body.estimatedMinutes } : {}),
    ...(body.assigneeMembershipIds
      ? { assigneeMembershipIds: uniqueIds(body.assigneeMembershipIds) }
      : {}),
    ...(body.followerMembershipIds
      ? { followerMembershipIds: uniqueIds(body.followerMembershipIds) }
      : {}),
    ...(body.projectIds ? { projectIds: uniqueIds(body.projectIds) } : {}),
    ...(body.recurrenceEditScope ? { recurrenceEditScope: body.recurrenceEditScope } : {}),
  };
}

function compactRecurrencePayload(body: TaskRecurrencePayload) {
  return {
    timezone: body.timezone,
    frequency: body.frequency,
    interval: body.interval ?? 1,
    ...(body.customIntervalUnit ? { customIntervalUnit: body.customIntervalUnit } : {}),
    startLocalDate: body.startLocalDate,
    localTime: body.localTime,
    ...(body.selectedWeekdays?.length
      ? { selectedWeekdays: uniqueNumbers(body.selectedWeekdays) }
      : {}),
    ...(body.monthlyDay ? { monthlyDay: body.monthlyDay } : {}),
    endMode: body.endMode,
    ...(body.untilLocalDate ? { untilLocalDate: body.untilLocalDate } : {}),
    ...(body.maxOccurrences ? { maxOccurrences: body.maxOccurrences } : {}),
  };
}

function compactTemplatePayload(body: TaskTemplatePayload) {
  return {
    name: body.name.trim(),
    title: body.title.trim(),
    ...(body.description !== undefined ? { description: body.description?.trim() || null } : {}),
    ...(body.priority ? { priority: body.priority } : {}),
    ...(body.statusDefinitionId ? { statusDefinitionId: body.statusDefinitionId } : {}),
    ...(body.departmentId !== undefined ? { departmentId: body.departmentId || null } : {}),
    ...(body.assigneeMembershipIds?.length
      ? { assigneeMembershipIds: uniqueIds(body.assigneeMembershipIds) }
      : {}),
    ...(body.followerMembershipIds?.length
      ? { followerMembershipIds: uniqueIds(body.followerMembershipIds) }
      : {}),
    ...(body.projectIds?.length ? { projectIds: uniqueIds(body.projectIds) } : {}),
    ...(body.tagIds?.length ? { tagIds: uniqueIds(body.tagIds) } : {}),
  };
}

function uniqueIds(ids: string[]) {
  return [...new Set(ids.filter(Boolean))];
}

function uniqueNumbers(values: number[]) {
  return [...new Set(values.filter((value) => Number.isInteger(value)))];
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
    'tagId',
  ] as const) {
    if (params[key]) query.set(key, params[key]);
  }
  return query.toString();
}

function timeReportQueryString(params: TimeReportParams) {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  if (params.taskId) query.set('taskId', params.taskId);
  if (params.workspaceMembershipId)
    query.set('workspaceMembershipId', params.workspaceMembershipId);
  if (params.entryType) query.set('entryType', params.entryType);
  return query.toString();
}

function workloadQueryString(params: TaskWorkloadParams) {
  const query = new URLSearchParams();
  if (params.view) query.set('view', params.view);
  if (params.date) query.set('date', params.date);
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  return query.toString();
}

function taskViewsQueryString(params: Record<string, unknown>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      query.set(key, String(value));
    }
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
  return (
    value === 'createdAt' ||
    value === 'updatedAt' ||
    value === 'dueAt' ||
    value === 'title' ||
    value === 'kanbanRank'
  );
}

function isWorkspaceTagSortBy(value: unknown): value is WorkspaceTagSortBy {
  return value === 'createdAt' || value === 'updatedAt' || value === 'name';
}

function normalizeTaskRecurrenceListParams(
  params: ListTaskRecurrenceSeriesParams,
): NormalizedTaskRecurrenceListParams {
  return {
    page: clampNumber(params.page, 1, Number.MAX_SAFE_INTEGER, 1),
    pageSize: [10, 20, 50, 100].includes(Number(params.pageSize)) ? Number(params.pageSize) : 20,
    ...(params.search?.trim() ? { search: params.search.trim() } : {}),
    ...(isTaskRecurrenceStatus(params.status) ? { status: params.status } : {}),
  };
}

function normalizeTaskTemplateListParams(
  params: ListTaskTemplatesParams,
): NormalizedTaskTemplateListParams {
  return {
    page: clampNumber(params.page, 1, Number.MAX_SAFE_INTEGER, 1),
    pageSize: [10, 20, 50, 100].includes(Number(params.pageSize)) ? Number(params.pageSize) : 20,
    ...(params.search?.trim() ? { search: params.search.trim() } : {}),
    ...(params.status === 'ACTIVE' || params.status === 'ARCHIVED'
      ? { status: params.status }
      : {}),
  };
}

function isTaskRecurrenceStatus(value: unknown): value is TaskRecurrenceStatus {
  return value === 'ACTIVE' || value === 'PAUSED' || value === 'ENDED' || value === 'ERROR';
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
