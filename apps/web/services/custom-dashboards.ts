import { apiClient } from './api';
import { superAgencyHeaders } from './super-agencies';
import type { AnalyticsDatePreset, AnalyticsScopeType } from './analytics';

export type DashboardVisibility = 'PRIVATE' | 'SELECTED_MEMBERS' | 'WORKSPACE' | 'SCOPE';
export type DashboardWidgetType =
  | 'METRIC_CARD'
  | 'LINE_CHART'
  | 'BAR_CHART'
  | 'AREA_CHART'
  | 'PIE_CHART'
  | 'DONUT_CHART'
  | 'TABLE'
  | 'GOAL_PROGRESS'
  | 'GAMIFICATION_SUMMARY';
export type DashboardWidgetDataSourceType = 'ANALYTICS_QUERY' | 'SAVED_REPORT';

export interface DashboardWidgetConfig {
  metricKeys?: string[];
  datePreset?: AnalyticsDatePreset;
  bucket?: 'HOUR' | 'DAY' | 'WEEK' | 'MONTH';
  dimension?: string;
  inheritGlobalFilters?: boolean;
  reportId?: string;
}

export interface DashboardLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  breakpoint?: 'desktop' | 'tablet' | 'mobile';
  order?: number;
}

export interface DashboardWidget {
  id: string;
  dashboardId: string;
  type: DashboardWidgetType;
  title: string;
  description?: string | null;
  dataSourceType: DashboardWidgetDataSourceType;
  configuration: DashboardWidgetConfig;
  layout: DashboardLayout;
  refreshSeconds?: number | null;
}

export interface CustomDashboard {
  id: string;
  scopeType: AnalyticsScopeType;
  scopeId: string;
  name: string;
  description?: string | null;
  visibility: DashboardVisibility;
  globalFilters: { datePreset?: AnalyticsDatePreset };
  revision: number;
  status: 'ACTIVE' | 'ARCHIVED';
  widgets: DashboardWidget[];
  accessCount: number;
  isFavorite: boolean;
  isDefault: boolean;
  updatedAt: string;
}

export interface DashboardTemplate {
  key: string;
  name: string;
  description: string;
  widgetCount: number;
}

export interface RenderedWidget {
  widget: DashboardWidget;
  status: 'SUCCESS' | 'ACCESS_REVOKED' | 'UNAVAILABLE' | 'ERROR';
  errorCode?: string;
  data?: {
    metrics?: Array<{
      key: string;
      displayName: string;
      value: number | string | null;
      unit: string;
    }>;
    timeSeries?: { points: Array<{ start: string; value: number | string | null }> };
    dimension?: { items: Array<{ key: string; label: string; value: number | string | null }> };
    table?: { columns: string[]; rows: unknown[][] };
    result?: unknown;
  };
}

export const dashboardKeys = {
  list: (scope: AnalyticsScopeType, scopeId: string | null) =>
    ['custom-dashboards', scope, scopeId] as const,
  render: (scope: AnalyticsScopeType, scopeId: string | null, dashboardId: string | null) =>
    ['custom-dashboards', scope, scopeId, dashboardId, 'render'] as const,
  templates: (scope: AnalyticsScopeType, scopeId: string | null) =>
    ['custom-dashboards', scope, scopeId, 'templates'] as const,
};

export async function listDashboards(scope: AnalyticsScopeType, scopeId: string) {
  const response = await apiClient.request<{ dashboards: CustomDashboard[] }>(
    `${basePath(scope, scopeId)}/dashboards`,
    requestOptions(scope, scopeId),
  );
  return response.data;
}

export async function listDashboardTemplates(scope: AnalyticsScopeType, scopeId: string) {
  const response = await apiClient.request<{ templates: DashboardTemplate[] }>(
    `${basePath(scope, scopeId)}/dashboards/templates`,
    requestOptions(scope, scopeId),
  );
  return response.data;
}

export async function createDashboardFromTemplate(
  scope: AnalyticsScopeType,
  scopeId: string,
  templateKey: string,
) {
  const response = await apiClient.request<{ dashboard: CustomDashboard }>(
    `${basePath(scope, scopeId)}/dashboards/from-template`,
    {
      ...requestOptions(scope, scopeId),
      method: 'POST',
      body: JSON.stringify({ templateKey }),
    },
  );
  return response.data.dashboard;
}

export async function createDashboard(
  scope: AnalyticsScopeType,
  scopeId: string,
  input: {
    name: string;
    visibility: DashboardVisibility;
    globalFilters?: { datePreset?: AnalyticsDatePreset };
    widgets?: Array<{
      type: DashboardWidgetType;
      title: string;
      dataSourceType: DashboardWidgetDataSourceType;
      configuration: DashboardWidgetConfig;
      layout: DashboardLayout;
      refreshSeconds?: number | null;
    }>;
  },
) {
  const response = await apiClient.request<{ dashboard: CustomDashboard }>(
    `${basePath(scope, scopeId)}/dashboards`,
    {
      ...requestOptions(scope, scopeId),
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
  return response.data.dashboard;
}

export async function renderDashboard(
  scope: AnalyticsScopeType,
  scopeId: string,
  dashboardId: string,
) {
  const response = await apiClient.request<{
    dashboard: CustomDashboard;
    widgets: RenderedWidget[];
  }>(
    `${basePath(scope, scopeId)}/dashboards/${dashboardId}/render`,
    requestOptions(scope, scopeId),
  );
  return response.data;
}

export async function updateDashboardLayout(
  scope: AnalyticsScopeType,
  scopeId: string,
  dashboard: CustomDashboard,
  layouts: Array<{ widgetId: string; layout: DashboardLayout }>,
) {
  const response = await apiClient.request<{ dashboard: CustomDashboard }>(
    `${basePath(scope, scopeId)}/dashboards/${dashboard.id}/layout`,
    {
      ...requestOptions(scope, scopeId),
      method: 'PATCH',
      body: JSON.stringify({ expectedRevision: dashboard.revision, layouts }),
    },
  );
  return response.data.dashboard;
}

export async function addDashboardWidget(
  scope: AnalyticsScopeType,
  scopeId: string,
  dashboardId: string,
  input: {
    type: DashboardWidgetType;
    title: string;
    dataSourceType: DashboardWidgetDataSourceType;
    configuration: DashboardWidgetConfig;
    layout: DashboardLayout;
    refreshSeconds?: number | null;
  },
) {
  const response = await apiClient.request<{ widget: DashboardWidget }>(
    `${basePath(scope, scopeId)}/dashboards/${dashboardId}/widgets`,
    {
      ...requestOptions(scope, scopeId),
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
  return response.data.widget;
}

export async function removeDashboardWidget(
  scope: AnalyticsScopeType,
  scopeId: string,
  dashboardId: string,
  widgetId: string,
) {
  await apiClient.request(
    `${basePath(scope, scopeId)}/dashboards/${dashboardId}/widgets/${widgetId}`,
    {
      ...requestOptions(scope, scopeId),
      method: 'DELETE',
    },
  );
}

export async function duplicateDashboard(
  scope: AnalyticsScopeType,
  scopeId: string,
  dashboardId: string,
) {
  const response = await apiClient.request<{ dashboard: CustomDashboard }>(
    `${basePath(scope, scopeId)}/dashboards/${dashboardId}/duplicate`,
    { ...requestOptions(scope, scopeId), method: 'POST' },
  );
  return response.data.dashboard;
}

export async function archiveDashboard(
  scope: AnalyticsScopeType,
  scopeId: string,
  dashboardId: string,
) {
  const response = await apiClient.request<{ dashboard: CustomDashboard }>(
    `${basePath(scope, scopeId)}/dashboards/${dashboardId}/archive`,
    { ...requestOptions(scope, scopeId), method: 'POST' },
  );
  return response.data.dashboard;
}

export async function restoreDashboard(
  scope: AnalyticsScopeType,
  scopeId: string,
  dashboardId: string,
) {
  const response = await apiClient.request<{ dashboard: CustomDashboard }>(
    `${basePath(scope, scopeId)}/dashboards/${dashboardId}/restore`,
    { ...requestOptions(scope, scopeId), method: 'POST' },
  );
  return response.data.dashboard;
}

export async function favoriteDashboard(
  scope: AnalyticsScopeType,
  scopeId: string,
  dashboardId: string,
  enabled: boolean,
) {
  const response = await apiClient.request<{ dashboard: CustomDashboard }>(
    `${basePath(scope, scopeId)}/dashboards/${dashboardId}/favorite`,
    {
      ...requestOptions(scope, scopeId),
      method: 'POST',
      body: JSON.stringify({ enabled }),
    },
  );
  return response.data.dashboard;
}

export async function setDefaultDashboard(
  scope: AnalyticsScopeType,
  scopeId: string,
  dashboardId: string,
) {
  const response = await apiClient.request<{ dashboard: CustomDashboard }>(
    `${basePath(scope, scopeId)}/dashboards/${dashboardId}/default`,
    { ...requestOptions(scope, scopeId), method: 'POST' },
  );
  return response.data.dashboard;
}

function basePath(scope: AnalyticsScopeType, scopeId: string) {
  if (scope === 'WORKSPACE') return `/workspaces/${scopeId}`;
  if (scope === 'AGENCY') return `/agencies/${scopeId}`;
  if (scope === 'SUPER_AGENCY') return `/super-agencies/${scopeId}`;
  return '/platform';
}

function requestOptions(scope: AnalyticsScopeType, scopeId: string) {
  if (scope === 'SUPER_AGENCY') {
    return { headers: superAgencyHeaders(scopeId), skipTenantContext: true };
  }
  if (scope === 'PLATFORM') return { skipTenantContext: true };
  return {};
}
