import { apiClient } from './api';
import { superAgencyHeaders } from './super-agencies';

const AGENCY_HEADER = 'x-agency-id';

export type GoalOwnerType = 'USER' | 'DEPARTMENT' | 'WORKSPACE';
export type GoalMetricType =
  | 'TASKS_COMPLETED'
  | 'PROJECTS_COMPLETED'
  | 'TICKETS_RESOLVED'
  | 'XP_EARNED'
  | 'GLOBAL_SCORE'
  | 'CUSTOM_NUMERIC'
  | 'MANUAL_NUMERIC';
export type GoalPeriodType = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'CUSTOM';
export type GoalStatus = 'ACTIVE' | 'COMPLETED' | 'EXPIRED' | 'ARCHIVED';

export interface WorkspaceGoal {
  id: string;
  workspaceId: string;
  ownerType: GoalOwnerType;
  ownerMembershipId: string | null;
  departmentId: string | null;
  metricType: GoalMetricType;
  periodType: GoalPeriodType;
  title: string;
  description: string | null;
  targetValue: number;
  currentProgress: number;
  percentComplete: number;
  status: GoalStatus;
  periodStart: string;
  periodEnd: string;
  completedAt: string | null;
  archivedAt: string | null;
  progressEvents?: GoalProgressEvent[];
}

export interface GoalProgressEvent {
  id: string;
  sourceType: string;
  delta: number;
  valueAfter: number;
  occurredAt: string;
  note: string | null;
}

export interface GoalListParams {
  search?: string;
  status?: GoalStatus;
  ownerType?: GoalOwnerType;
  metricType?: GoalMetricType;
  agencyId?: string;
  workspaceId?: string;
  page?: number;
  pageSize?: number;
}

export const workspaceGoalKeys = {
  all: (workspaceId: string | null) => ['workspace', workspaceId, 'goals'],
  list: (workspaceId: string | null, params: GoalListParams) => [
    'workspace',
    workspaceId,
    'goals',
    normalizeParams(params),
  ],
  detail: (workspaceId: string | null, goalId: string | null) => [
    'workspace',
    workspaceId,
    'goals',
    goalId,
  ],
};

export const parentGoalKeys = {
  agency: (agencyId: string | null, params: GoalListParams) =>
    ['agency', agencyId, 'goals', normalizeParams(params)] as const,
  superAgency: (superAgencyId: string | null, params: GoalListParams) =>
    ['super-agency', superAgencyId, 'goals', normalizeParams(params)] as const,
};

export async function listWorkspaceGoals(workspaceId: string, params: GoalListParams) {
  const response = await apiClient.request<{
    items: WorkspaceGoal[];
    total: number;
    page: number;
    pageSize: number;
  }>(`/workspaces/${workspaceId}/goals${toSearchParams(params)}`);
  return response.data;
}

export async function getWorkspaceGoal(workspaceId: string, goalId: string) {
  const response = await apiClient.request<WorkspaceGoal>(
    `/workspaces/${workspaceId}/goals/${goalId}`,
  );
  return response.data;
}

export async function createWorkspaceGoal(workspaceId: string, input: Partial<WorkspaceGoal>) {
  const response = await apiClient.request<WorkspaceGoal>(`/workspaces/${workspaceId}/goals`, {
    method: 'POST',
    body: JSON.stringify({
      title: input.title ?? 'New Goal',
      description: input.description ?? null,
      ownerType: input.ownerType ?? 'WORKSPACE',
      ownerMembershipId: input.ownerMembershipId ?? null,
      departmentId: input.departmentId ?? null,
      metricType: input.metricType ?? 'TASKS_COMPLETED',
      periodType: input.periodType ?? 'MONTHLY',
      targetValue: input.targetValue ?? 10,
    }),
  });
  return response.data;
}

export async function addManualGoalProgress(
  workspaceId: string,
  goalId: string,
  delta: number,
  note?: string,
) {
  const response = await apiClient.request<WorkspaceGoal>(
    `/workspaces/${workspaceId}/goals/${goalId}/manual-progress`,
    {
      method: 'POST',
      body: JSON.stringify({ delta, note, idempotencyKey: crypto.randomUUID() }),
    },
  );
  return response.data;
}

export async function reconcileWorkspaceGoal(workspaceId: string, goalId: string) {
  const response = await apiClient.request<WorkspaceGoal>(
    `/workspaces/${workspaceId}/goals/${goalId}/reconcile`,
    { method: 'POST', body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }) },
  );
  return response.data;
}

export async function archiveWorkspaceGoal(workspaceId: string, goalId: string) {
  const response = await apiClient.request<WorkspaceGoal>(
    `/workspaces/${workspaceId}/goals/${goalId}/archive`,
    { method: 'PATCH' },
  );
  return response.data;
}

export async function listAgencyParentGoals(agencyId: string, params: GoalListParams) {
  const response = await apiClient.request<{
    items: ParentGoalAggregate[];
    page: number;
    pageSize: number;
    privacy: 'AGGREGATED_WORKSPACE_ONLY';
  }>(`/agencies/${agencyId}/parent/goals${toSearchParams(params)}`, {
    headers: agencyHeaders(agencyId),
    skipTenantContext: true,
  });
  return response.data;
}

export async function listSuperAgencyParentGoals(superAgencyId: string, params: GoalListParams) {
  const response = await apiClient.request<{
    items: ParentGoalAggregate[];
    page: number;
    pageSize: number;
    privacy: 'AGGREGATED_WORKSPACE_ONLY';
  }>(`/super-agencies/${superAgencyId}/parent/goals${toSearchParams(params)}`, {
    headers: superAgencyHeaders(superAgencyId),
    skipTenantContext: true,
  });
  return response.data;
}

export interface ParentGoalAggregate {
  workspaceId: string;
  status: GoalStatus;
  ownerType: GoalOwnerType;
  metricType: GoalMetricType;
  _count: { _all: number };
  _sum: { currentProgress: number | null; targetValue: number | null };
}

function toSearchParams(params: GoalListParams) {
  const query = new URLSearchParams();
  const normalized = normalizeParams(params);
  if (normalized.search) query.set('search', normalized.search);
  if (normalized.status) query.set('status', normalized.status);
  if (normalized.ownerType) query.set('ownerType', normalized.ownerType);
  if (normalized.metricType) query.set('metricType', normalized.metricType);
  if (normalized.agencyId) query.set('agencyId', normalized.agencyId);
  if (normalized.workspaceId) query.set('workspaceId', normalized.workspaceId);
  query.set('page', String(normalized.page ?? 1));
  query.set('pageSize', String(normalized.pageSize ?? 30));
  const text = query.toString();
  return text ? `?${text}` : '';
}

function normalizeParams(params: GoalListParams) {
  return {
    ...params,
    search: params.search?.trim() || undefined,
    page: params.page ?? 1,
    pageSize: params.pageSize ?? 30,
  };
}

function agencyHeaders(agencyId: string) {
  return { [AGENCY_HEADER]: agencyId };
}
