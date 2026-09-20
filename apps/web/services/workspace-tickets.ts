import { apiClient } from './api';
import type { PageResult } from './workspace-management';

export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type TicketSortBy = 'createdAt' | 'updatedAt' | 'ticketNumber' | 'priority';
export type TicketSortDirection = 'asc' | 'desc';
export type TicketBuiltInQueue =
  | 'ALL_VISIBLE'
  | 'MY_ASSIGNED'
  | 'MY_REQUESTED'
  | 'MY_DEPARTMENT'
  | 'UNASSIGNED_MY_DEPARTMENT'
  | 'SLA_BREACHED';
export type TicketAssignmentState = 'ANY' | 'ASSIGNED' | 'UNASSIGNED';
export type TicketRequesterTypeFilter = 'INTERNAL' | 'EXTERNAL' | 'UNSET';
export type TicketSlaMetricFilter = 'ANY' | 'FIRST_RESPONSE' | 'RESOLUTION';
export type TicketConversationEntryType = 'PUBLIC_REPLY' | 'INTERNAL_NOTE';
export type TicketAttachmentType = 'FILE' | 'URL';
export type TicketSlaBusinessMode = 'ALWAYS' | 'BUSINESS_HOURS';
export type TicketSlaMetricState =
  'NOT_CONFIGURED' | 'RUNNING' | 'PAUSED' | 'MET' | 'BREACHED' | 'NOT_APPLICABLE';
export type TicketSavedViewScope = 'PERSONAL' | 'WORKSPACE';
export type TicketEscalationLevel = 'NONE' | 'LEVEL_1' | 'LEVEL_2' | 'LEVEL_3';
export type TicketEscalationAction = 'ESCALATE' | 'DEESCALATE' | 'CLEAR';
export type TicketRequesterPayload =
  | { type: 'INTERNAL'; membershipId: string }
  | { type: 'EXTERNAL'; name: string; email?: string; phone?: string };

export interface TicketRequesterSummary {
  id: string;
  type: 'INTERNAL' | 'EXTERNAL';
  internalMembershipId?: string | null;
  displayName: string | null;
  externalName?: string | null;
  externalEmail?: string | null;
  externalPhone?: string | null;
  internalMembership?: {
    id: string;
    status: string;
    departmentId: string | null;
    user: { id: string; email: string; name: string | null; status?: string };
  } | null;
}

export interface WorkspaceTicketSummary {
  id: string;
  workspaceId: string;
  sequenceNumber: number;
  ticketNumber: string;
  subject: string;
  description?: string | null;
  statusDefinitionId: string;
  status: { id: string; name: string; color: string; terminal: boolean; active: boolean };
  priority: TicketPriority;
  requester: TicketRequesterSummary | null;
  departmentId: string | null;
  department: { id: string; name: string; status: string } | null;
  assignedToMembershipId: string | null;
  assignedTo: {
    id: string;
    status: string;
    departmentId: string | null;
    user: { id: string; email: string; name: string | null; status?: string };
  } | null;
  escalationLevel: TicketEscalationLevel;
  escalationChangedAt?: string | null;
  escalationChangedBy?: {
    id: string;
    status: string;
    user: { id: string; email: string; name: string | null };
  } | null;
  createdBy: {
    id: string;
    status: string;
    user: { id: string; email: string; name: string | null };
  } | null;
  createdAt: string;
  updatedAt: string;
  sla?: {
    firstResponse: { state: TicketSlaMetricState; dueAt: string | null };
    resolution: { state: TicketSlaMetricState; dueAt: string | null };
  };
}

export interface TicketPayload {
  subject?: string;
  description?: string | null;
  statusDefinitionId?: string;
  priority?: TicketPriority;
  requester?: TicketRequesterPayload;
  departmentId?: string | null;
  assignedToMembershipId?: string | null;
}

export interface TicketAssignmentPayload {
  departmentId?: string | null;
  assignedToMembershipId?: string | null;
}

export interface TicketEscalationPayload {
  action: TicketEscalationAction;
  expectedLevel: TicketEscalationLevel;
  reason: string;
}

export interface TicketConversationEntry {
  id: string;
  workspaceId: string;
  ticketId: string;
  type: TicketConversationEntryType;
  body: string;
  author: { membershipId: string; displayName: string; inactive: boolean };
  attachments: TicketAttachmentSummary[];
  createdAt: string;
}

export interface TicketConversationPayload {
  type: TicketConversationEntryType;
  body: string;
  attachmentIds?: string[];
}

export interface TicketAttachmentAsset {
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

export interface TicketAttachmentSummary {
  id: string;
  workspaceId: string;
  ticketId?: string;
  type: TicketAttachmentType;
  displayName: string;
  url: string | null;
  file: TicketAttachmentAsset | null;
  attachedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TicketAttachmentUploadInit {
  attachment: TicketAttachmentSummary;
  uploadUrl: string;
  expiresAt: string;
}

export interface TicketActivityParams {
  page?: number;
  pageSize?: number;
  action?: string;
  actorMembershipId?: string;
  from?: string;
  to?: string;
}

export interface TicketActivityItem {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actor: { id: string; displayName: string; email: string } | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface TicketSlaPolicyPayload {
  name: string;
  description?: string | null;
  isActive?: boolean;
  isDefault?: boolean;
  timezone: string;
  businessMode?: TicketSlaBusinessMode;
  businessHours?: Record<string, Array<{ start: string; end: string }>>;
  holidayDates?: string[];
  rules: Array<{
    priority: TicketPriority;
    firstResponseMinutes: number;
    resolutionMinutes: number;
  }>;
  pauseStatuses?: Array<{
    statusDefinitionId: string;
    pauseFirstResponse?: boolean;
    pauseResolution?: boolean;
  }>;
}

export interface TicketSlaPolicy extends TicketSlaPolicyPayload {
  id: string;
  workspaceId: string;
  isActive: boolean;
  isDefault: boolean;
  businessMode: TicketSlaBusinessMode;
  holidayDates: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TicketSlaState {
  configured: boolean;
  policy?: { id: string; name: string };
  priority?: TicketPriority;
  timezone?: string;
  businessMode?: TicketSlaBusinessMode;
  firstResponse: {
    state: TicketSlaMetricState;
    targetMinutes?: number;
    remainingMinutes?: number;
    dueAt?: string | null;
    pausedAt?: string | null;
    completedAt?: string | null;
    breachedAt?: string | null;
    notApplicableAt?: string | null;
  };
  resolution: {
    state: TicketSlaMetricState;
    targetMinutes?: number;
    remainingMinutes?: number;
    dueAt?: string | null;
    pausedAt?: string | null;
    completedAt?: string | null;
    breachedAt?: string | null;
  };
}

export interface ListTicketConversationParams {
  page?: number;
  pageSize?: number;
}

export interface ListWorkspaceTicketsParams {
  page?: number;
  pageSize?: number;
  search?: string;
  statusDefinitionId?: string;
  priority?: TicketPriority;
  queue?: TicketBuiltInQueue;
  requesterType?: TicketRequesterTypeFilter;
  internalRequesterMembershipId?: string;
  departmentId?: string;
  assignedToMembershipId?: string;
  assignmentState?: TicketAssignmentState;
  createdFrom?: string;
  createdTo?: string;
  updatedFrom?: string;
  updatedTo?: string;
  slaMetric?: TicketSlaMetricFilter;
  slaState?: TicketSlaMetricState;
  slaDueFrom?: string;
  slaDueTo?: string;
  sortBy?: TicketSortBy;
  sortDirection?: TicketSortDirection;
}

export type NormalizedTicketListParams = Required<
  Pick<ListWorkspaceTicketsParams, 'page' | 'pageSize' | 'sortBy' | 'sortDirection' | 'queue'>
> &
  Partial<
    Pick<
      ListWorkspaceTicketsParams,
      | 'search'
      | 'statusDefinitionId'
      | 'priority'
      | 'requesterType'
      | 'internalRequesterMembershipId'
      | 'departmentId'
      | 'assignedToMembershipId'
      | 'assignmentState'
      | 'createdFrom'
      | 'createdTo'
      | 'updatedFrom'
      | 'updatedTo'
      | 'slaMetric'
      | 'slaState'
      | 'slaDueFrom'
      | 'slaDueTo'
    >
  >;

export type TicketQueueSummary = Record<TicketBuiltInQueue, number>;

export interface TicketSavedView {
  id: string;
  workspaceId: string;
  name: string;
  scope: TicketSavedViewScope;
  ownerMembershipId: string | null;
  filterSchemaVersion: number;
  filters: Partial<ListWorkspaceTicketsParams>;
  sort: Pick<NormalizedTicketListParams, 'sortBy' | 'sortDirection'>;
  createdAt: string;
  updatedAt: string;
}

export type TicketReportBucket = 'DAY' | 'WEEK' | 'MONTH';
export interface TicketReportParams extends ListWorkspaceTicketsParams {
  trendFrom?: string;
  trendTo?: string;
  bucket?: TicketReportBucket;
}

export interface TicketReportSummary {
  timezone: string;
  kpis: {
    totalTickets: number;
    openTickets: number;
    terminalTickets: number;
    unassignedTickets: number;
    escalatedTickets: number;
    slaBreachedTickets: number;
    slaNotConfiguredTickets: number;
  };
  distributions: {
    status: Array<{
      statusDefinitionId: string;
      name: string;
      color: string;
      isTerminal: boolean;
      count: number;
    }>;
    priority: Array<{ priority: TicketPriority; count: number }>;
    requesterType: Array<{ type: 'INTERNAL' | 'EXTERNAL' | 'UNSET'; count: number }>;
    escalation: Array<{ level: TicketEscalationLevel; count: number }>;
    departments: Array<{ departmentId: string | null; name: string; ticketCount: number }>;
    assignees: Array<{
      membershipId: string | null;
      displayName: string;
      inactive: boolean;
      ticketCount: number;
    }>;
  };
  trends: {
    created: Array<{ date: string; count: number }>;
    firstTerminalResolution: Array<{ date: string; count: number }>;
  };
  sla: {
    firstResponse: TicketReportSlaSummary;
    resolution: TicketReportSlaSummary;
  };
  semantics: Record<string, string>;
}

export interface TicketReportSlaSummary {
  NOT_CONFIGURED: number;
  RUNNING: number;
  PAUSED: number;
  MET: number;
  BREACHED: number;
  NOT_APPLICABLE: number;
  complianceRate: number | null;
}

export const ticketKeys = {
  all: (workspaceId: string | null) => ['workspace', workspaceId, 'tickets'] as const,
  list: (workspaceId: string | null, params: NormalizedTicketListParams) =>
    ['workspace', workspaceId, 'tickets', 'list', params] as const,
  queueSummary: (workspaceId: string | null) =>
    ['workspace', workspaceId, 'tickets', 'queue-summary'] as const,
  savedViews: (workspaceId: string | null) =>
    ['workspace', workspaceId, 'tickets', 'saved-views'] as const,
  detail: (workspaceId: string | null, ticketId: string | null) =>
    ['workspace', workspaceId, 'tickets', 'detail', ticketId] as const,
  conversationBase: (workspaceId: string | null, ticketId: string | null) =>
    ['workspace', workspaceId, 'tickets', 'detail', ticketId, 'conversation'] as const,
  conversation: (
    workspaceId: string | null,
    ticketId: string | null,
    params: Required<ListTicketConversationParams> & { notesView?: boolean },
  ) => [...ticketKeys.conversationBase(workspaceId, ticketId), params] as const,
  sla: (workspaceId: string | null, ticketId: string | null) =>
    ['workspace', workspaceId, 'tickets', 'detail', ticketId, 'sla'] as const,
  slaPolicies: (workspaceId: string | null) =>
    ['workspace', workspaceId, 'tickets', 'sla', 'policies'] as const,
  attachmentsBase: (workspaceId: string | null, ticketId: string | null) =>
    ['workspace', workspaceId, 'tickets', 'detail', ticketId, 'attachments'] as const,
  attachments: (
    workspaceId: string | null,
    ticketId: string | null,
    params: Required<Pick<ListTicketConversationParams, 'page' | 'pageSize'>>,
  ) => [...ticketKeys.attachmentsBase(workspaceId, ticketId), params] as const,
  activityBase: (workspaceId: string | null, ticketId: string | null) =>
    ['workspace', workspaceId, 'tickets', 'detail', ticketId, 'activity'] as const,
  activity: (workspaceId: string | null, ticketId: string | null, params: TicketActivityParams) =>
    [...ticketKeys.activityBase(workspaceId, ticketId), params] as const,
  reports: (workspaceId: string | null, params: TicketReportParams) =>
    ['workspace', workspaceId, 'tickets', 'reports', params] as const,
};

export async function listWorkspaceTickets(
  workspaceId: string,
  params: ListWorkspaceTicketsParams = {},
) {
  const normalized = normalizeTicketListParams(params);
  const response = await apiClient.request<PageResult<WorkspaceTicketSummary>>(
    `/workspaces/${workspaceId}/tickets?${ticketListQueryString(normalized)}`,
  );
  return response.data;
}

export async function getWorkspaceTicketQueueSummary(workspaceId: string) {
  const response = await apiClient.request<TicketQueueSummary>(
    `/workspaces/${workspaceId}/tickets/queue-summary`,
  );
  return response.data;
}

export async function listWorkspaceTicketSavedViews(workspaceId: string) {
  const response = await apiClient.request<TicketSavedView[]>(
    `/workspaces/${workspaceId}/tickets/saved-views`,
  );
  return response.data;
}

export async function getWorkspaceTicketReports(
  workspaceId: string,
  params: TicketReportParams = {},
) {
  const response = await apiClient.request<TicketReportSummary>(
    `/workspaces/${workspaceId}/tickets/reports?${ticketReportQueryString(params)}`,
  );
  return response.data;
}

export async function exportWorkspaceTicketReportsCsv(
  workspaceId: string,
  params: TicketReportParams = {},
) {
  const response = await apiClient.request<{ filename: string; contentType: string; csv: string }>(
    `/workspaces/${workspaceId}/tickets/reports/export?${ticketReportQueryString(params)}`,
  );
  return response.data;
}

export async function createWorkspaceTicketSavedView(
  workspaceId: string,
  body: {
    name: string;
    scope: TicketSavedViewScope;
    filters: Partial<ListWorkspaceTicketsParams>;
    sort: Pick<NormalizedTicketListParams, 'sortBy' | 'sortDirection'>;
  },
) {
  const response = await apiClient.request<TicketSavedView>(
    `/workspaces/${workspaceId}/tickets/saved-views`,
    { method: 'POST', body: JSON.stringify(compactTicketPayload(body)) },
  );
  return response.data;
}

export async function updateWorkspaceTicketSavedView(
  workspaceId: string,
  viewId: string,
  body: {
    name?: string;
    filters?: Partial<ListWorkspaceTicketsParams>;
    sort?: Pick<NormalizedTicketListParams, 'sortBy' | 'sortDirection'>;
  },
) {
  const response = await apiClient.request<TicketSavedView>(
    `/workspaces/${workspaceId}/tickets/saved-views/${viewId}`,
    { method: 'PATCH', body: JSON.stringify(compactTicketPayload(body)) },
  );
  return response.data;
}

export async function deleteWorkspaceTicketSavedView(workspaceId: string, viewId: string) {
  const response = await apiClient.request<{ id: string; deleted: boolean }>(
    `/workspaces/${workspaceId}/tickets/saved-views/${viewId}`,
    { method: 'DELETE' },
  );
  return response.data;
}

export async function getWorkspaceTicket(workspaceId: string, ticketId: string) {
  const response = await apiClient.request<WorkspaceTicketSummary>(
    `/workspaces/${workspaceId}/tickets/${ticketId}`,
  );
  return response.data;
}

export async function createWorkspaceTicket(workspaceId: string, body: TicketPayload) {
  const response = await apiClient.request<WorkspaceTicketSummary>(
    `/workspaces/${workspaceId}/tickets`,
    { method: 'POST', body: JSON.stringify(compactTicketPayload(body)) },
  );
  return response.data;
}

export async function updateWorkspaceTicket(
  workspaceId: string,
  ticketId: string,
  body: TicketPayload,
) {
  const response = await apiClient.request<WorkspaceTicketSummary>(
    `/workspaces/${workspaceId}/tickets/${ticketId}`,
    { method: 'PATCH', body: JSON.stringify(compactTicketPayload(body)) },
  );
  return response.data;
}

export async function updateWorkspaceTicketStatus(
  workspaceId: string,
  ticketId: string,
  statusDefinitionId: string,
) {
  const response = await apiClient.request<WorkspaceTicketSummary>(
    `/workspaces/${workspaceId}/tickets/${ticketId}/status`,
    { method: 'PATCH', body: JSON.stringify({ statusDefinitionId }) },
  );
  return response.data;
}

export async function updateWorkspaceTicketRequester(
  workspaceId: string,
  ticketId: string,
  requester: TicketRequesterPayload,
) {
  const response = await apiClient.request<WorkspaceTicketSummary>(
    `/workspaces/${workspaceId}/tickets/${ticketId}/requester`,
    { method: 'PATCH', body: JSON.stringify(compactTicketPayload({ requester })) },
  );
  return response.data;
}

export async function updateWorkspaceTicketAssignment(
  workspaceId: string,
  ticketId: string,
  body: TicketAssignmentPayload,
) {
  const response = await apiClient.request<WorkspaceTicketSummary>(
    `/workspaces/${workspaceId}/tickets/${ticketId}/assignment`,
    { method: 'PATCH', body: JSON.stringify(compactTicketPayload(body)) },
  );
  return response.data;
}

export async function claimWorkspaceTicket(workspaceId: string, ticketId: string) {
  const response = await apiClient.request<WorkspaceTicketSummary>(
    `/workspaces/${workspaceId}/tickets/${ticketId}/claim`,
    { method: 'POST', body: JSON.stringify({}) },
  );
  return response.data;
}

export async function updateWorkspaceTicketEscalation(
  workspaceId: string,
  ticketId: string,
  body: TicketEscalationPayload,
) {
  const response = await apiClient.request<WorkspaceTicketSummary>(
    `/workspaces/${workspaceId}/tickets/${ticketId}/escalation`,
    { method: 'POST', body: JSON.stringify(compactTicketPayload(body)) },
  );
  return response.data;
}

export async function deleteWorkspaceTicket(workspaceId: string, ticketId: string) {
  const response = await apiClient.request<{ id: string; deleted: boolean }>(
    `/workspaces/${workspaceId}/tickets/${ticketId}`,
    { method: 'DELETE' },
  );
  return response.data;
}

export async function listWorkspaceTicketConversation(
  workspaceId: string,
  ticketId: string,
  params: ListTicketConversationParams = {},
) {
  const normalized = {
    page: params.page ?? 1,
    pageSize: params.pageSize ?? 20,
  };
  const query = new URLSearchParams({
    page: String(normalized.page),
    pageSize: String(normalized.pageSize),
  });
  const response = await apiClient.request<PageResult<TicketConversationEntry>>(
    `/workspaces/${workspaceId}/tickets/${ticketId}/conversation?${query.toString()}`,
  );
  return response.data;
}

export async function createWorkspaceTicketConversationEntry(
  workspaceId: string,
  ticketId: string,
  body: TicketConversationPayload,
) {
  const response = await apiClient.request<TicketConversationEntry>(
    `/workspaces/${workspaceId}/tickets/${ticketId}/conversation`,
    { method: 'POST', body: JSON.stringify(compactTicketPayload(body)) },
  );
  return response.data;
}

export async function listWorkspaceTicketAttachments(
  workspaceId: string,
  ticketId: string,
  params: ListTicketConversationParams = {},
) {
  const normalized = {
    page: params.page ?? 1,
    pageSize: params.pageSize ?? 20,
  };
  const query = new URLSearchParams({
    page: String(normalized.page),
    pageSize: String(normalized.pageSize),
  });
  const response = await apiClient.request<PageResult<TicketAttachmentSummary>>(
    `/workspaces/${workspaceId}/tickets/${ticketId}/attachments?${query.toString()}`,
  );
  return response.data;
}

export async function initTicketAttachmentUpload(
  workspaceId: string,
  ticketId: string,
  body: { filename: string; mimeType: string; sizeBytes: number; displayName?: string },
) {
  const response = await apiClient.request<TicketAttachmentUploadInit>(
    `/workspaces/${workspaceId}/tickets/${ticketId}/attachments/upload-init`,
    { method: 'POST', body: JSON.stringify(compactTicketPayload(body)) },
  );
  return response.data;
}

export async function completeTicketAttachmentUpload(
  workspaceId: string,
  ticketId: string,
  attachmentId: string,
  body: { sizeBytes: number },
) {
  const response = await apiClient.request<TicketAttachmentSummary>(
    `/workspaces/${workspaceId}/tickets/${ticketId}/attachments/${attachmentId}/upload-complete`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  return response.data;
}

export async function addTicketUrlAttachment(
  workspaceId: string,
  ticketId: string,
  body: { url: string; displayName?: string },
) {
  const response = await apiClient.request<TicketAttachmentSummary>(
    `/workspaces/${workspaceId}/tickets/${ticketId}/attachments/url`,
    { method: 'POST', body: JSON.stringify(compactTicketPayload(body)) },
  );
  return response.data;
}

export async function downloadTicketAttachment(
  workspaceId: string,
  ticketId: string,
  attachmentId: string,
) {
  const response = await apiClient.request<{ downloadUrl: string; expiresInSeconds: number }>(
    `/workspaces/${workspaceId}/tickets/${ticketId}/attachments/${attachmentId}/download`,
  );
  return response.data;
}

export async function downloadTicketConversationAttachment(
  workspaceId: string,
  ticketId: string,
  entryId: string,
  attachmentId: string,
) {
  const response = await apiClient.request<{ downloadUrl: string; expiresInSeconds: number }>(
    `/workspaces/${workspaceId}/tickets/${ticketId}/conversation/${entryId}/attachments/${attachmentId}/download`,
  );
  return response.data;
}

export async function removeTicketAttachment(
  workspaceId: string,
  ticketId: string,
  attachmentId: string,
) {
  const response = await apiClient.request<{ changed: boolean }>(
    `/workspaces/${workspaceId}/tickets/${ticketId}/attachments/${attachmentId}`,
    { method: 'DELETE' },
  );
  return response.data;
}

export async function getWorkspaceTicketActivity(
  workspaceId: string,
  ticketId: string,
  params: TicketActivityParams = {},
) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  }
  const response = await apiClient.request<PageResult<TicketActivityItem>>(
    `/workspaces/${workspaceId}/tickets/${ticketId}/activity?${query.toString()}`,
  );
  return response.data;
}

export async function getWorkspaceTicketSla(workspaceId: string, ticketId: string) {
  const response = await apiClient.request<TicketSlaState>(
    `/workspaces/${workspaceId}/tickets/${ticketId}/sla`,
  );
  return response.data;
}

export async function listWorkspaceTicketSlaPolicies(workspaceId: string) {
  const response = await apiClient.request<TicketSlaPolicy[]>(
    `/workspaces/${workspaceId}/tickets/sla/policies`,
  );
  return response.data;
}

export async function createWorkspaceTicketSlaPolicy(
  workspaceId: string,
  body: TicketSlaPolicyPayload,
) {
  const response = await apiClient.request<TicketSlaPolicy>(
    `/workspaces/${workspaceId}/tickets/sla/policies`,
    { method: 'POST', body: JSON.stringify(compactTicketPayload(body)) },
  );
  return response.data;
}

export function normalizeTicketListParams(
  params: ListWorkspaceTicketsParams,
): NormalizedTicketListParams {
  const normalized: NormalizedTicketListParams = {
    page: params.page ?? 1,
    pageSize: params.pageSize ?? 20,
    queue: params.queue ?? 'ALL_VISIBLE',
    sortBy: params.sortBy ?? 'createdAt',
    sortDirection: params.sortDirection ?? 'desc',
  };
  const optionalKeys = [
    'search',
    'statusDefinitionId',
    'priority',
    'requesterType',
    'internalRequesterMembershipId',
    'departmentId',
    'assignedToMembershipId',
    'assignmentState',
    'createdFrom',
    'createdTo',
    'updatedFrom',
    'updatedTo',
    'slaMetric',
    'slaState',
    'slaDueFrom',
    'slaDueTo',
  ] as const;
  for (const key of optionalKeys) {
    const value = params[key];
    if (typeof value === 'string' && value.trim()) {
      normalized[key] = value.trim() as never;
    }
  }
  return normalized;
}

function ticketListQueryString(params: NormalizedTicketListParams) {
  const query = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
    queue: params.queue,
    sortBy: params.sortBy,
    sortDirection: params.sortDirection,
  });
  for (const [key, value] of Object.entries(params)) {
    if (!['page', 'pageSize', 'queue', 'sortBy', 'sortDirection'].includes(key) && value) {
      query.set(key, String(value));
    }
  }
  return query.toString();
}

function ticketReportQueryString(params: TicketReportParams) {
  const normalized = normalizeTicketListParams({
    ...params,
    page: params.page ?? 1,
    pageSize: params.pageSize ?? 100,
  });
  const query = new URLSearchParams(ticketListQueryString(normalized));
  if (params.trendFrom) query.set('trendFrom', params.trendFrom);
  if (params.trendTo) query.set('trendTo', params.trendTo);
  if (params.bucket) query.set('bucket', params.bucket);
  return query.toString();
}

function compactTicketPayload<T>(body: T): T {
  if (!body || typeof body !== 'object' || body instanceof Date) return body;
  if (Array.isArray(body)) return body.map((item) => compactTicketPayload(item)) as T;
  return Object.fromEntries(
    Object.entries(body)
      .filter(([, value]) => value !== undefined && value !== '')
      .map(([key, value]) => [key, compactTicketPayload(value)]),
  ) as T;
}
