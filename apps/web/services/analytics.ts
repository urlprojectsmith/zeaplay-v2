import { apiClient } from './api';

export type AnalyticsScopeType = 'WORKSPACE' | 'AGENCY' | 'SUPER_AGENCY' | 'PLATFORM';
export type AnalyticsDatePreset =
  | 'TODAY'
  | 'YESTERDAY'
  | 'LAST_7_DAYS'
  | 'LAST_30_DAYS'
  | 'THIS_WEEK'
  | 'LAST_WEEK'
  | 'THIS_MONTH'
  | 'LAST_MONTH'
  | 'THIS_QUARTER'
  | 'LAST_QUARTER'
  | 'THIS_YEAR'
  | 'CUSTOM';
export type AnalyticsBucket = 'HOUR' | 'DAY' | 'WEEK' | 'MONTH';

export interface AnalyticsQueryParams {
  metrics?: string[];
  datePreset?: AnalyticsDatePreset;
  start?: string;
  end?: string;
  bucket?: AnalyticsBucket;
  dimension?: string;
}

export interface AnalyticsSummary {
  scope: { type: AnalyticsScopeType; id: string; workspaceCount: number; agencyCount: number };
  range: { start: string; end: string; timezone: string; interval: string };
  metrics: {
    key: string;
    displayName: string;
    domain: string;
    valueType: string;
    unit: string;
    value: number | string | null;
    comparison: { previous: number | string | null; percentChange: number | null } | null;
    financialSensitivity: boolean;
  }[];
  timeSeries: {
    metricKey: string | null;
    bucket: AnalyticsBucket;
    points: { start: string; end: string; value: number | string | null }[];
  };
  privacy: { financialAllowed: boolean; parentSafeAggregateOnly: boolean };
}

export const analyticsKeys = {
  scope: (scope: AnalyticsScopeType, id: string | null) => ['analytics', scope, id] as const,
  summary: (scope: AnalyticsScopeType, id: string | null, params: AnalyticsQueryParams) =>
    ['analytics', scope, id, 'summary', normalizedParams(params)] as const,
};

export async function getWorkspaceAnalytics(workspaceId: string, params: AnalyticsQueryParams) {
  const response = await apiClient.request<AnalyticsSummary>(
    `/workspaces/${workspaceId}/analytics/summary?${queryString(params)}`,
  );
  return response.data;
}

export async function getAgencyAnalytics(agencyId: string, params: AnalyticsQueryParams) {
  const response = await apiClient.request<AnalyticsSummary>(
    `/agencies/${agencyId}/analytics/summary?${queryString(params)}`,
  );
  return response.data;
}

export async function getSuperAgencyAnalytics(superAgencyId: string, params: AnalyticsQueryParams) {
  const response = await apiClient.request<AnalyticsSummary>(
    `/super-agencies/${superAgencyId}/analytics/summary?${queryString(params)}`,
  );
  return response.data;
}

export async function getPlatformAnalytics(params: AnalyticsQueryParams) {
  const response = await apiClient.request<AnalyticsSummary>(
    `/platform/analytics/summary?${queryString(params)}`,
  );
  return response.data;
}

function queryString(params: AnalyticsQueryParams) {
  const normalized = normalizedParams(params);
  const query = new URLSearchParams({
    datePreset: normalized.datePreset,
    bucket: normalized.bucket,
  });
  if (normalized.metrics.length) query.set('metrics', normalized.metrics.join(','));
  if (normalized.dimension) query.set('dimension', normalized.dimension);
  if (normalized.start) query.set('start', normalized.start);
  if (normalized.end) query.set('end', normalized.end);
  return query.toString();
}

function normalizedParams(params: AnalyticsQueryParams) {
  return {
    metrics: params.metrics ?? [],
    datePreset: params.datePreset ?? 'LAST_30_DAYS',
    bucket: params.bucket ?? 'DAY',
    ...(params.dimension ? { dimension: params.dimension } : {}),
    ...(params.start ? { start: params.start } : {}),
    ...(params.end ? { end: params.end } : {}),
  };
}
