import { apiClient } from './api';
import { superAgencyHeaders } from './super-agencies';
import type { AnalyticsDatePreset, AnalyticsScopeType } from './analytics';

export type ReportType = 'SUMMARY' | 'TABLE' | 'TIME_SERIES';
export type ReportVisibility = 'PRIVATE' | 'SELECTED_MEMBERS' | 'SCOPE';
export type ReportExportFormat = 'CSV' | 'XLSX';

export interface ReportConfig {
  metricKeys: string[];
  datePreset?: AnalyticsDatePreset;
  bucket?: 'HOUR' | 'DAY' | 'WEEK' | 'MONTH';
  dimension?: string;
}

export interface ReportDefinition {
  id: string;
  scopeType: AnalyticsScopeType;
  scopeId: string;
  name: string;
  description?: string | null;
  type: ReportType;
  visibility: ReportVisibility;
  configuration: ReportConfig;
  revision: number;
  status: 'ACTIVE' | 'ARCHIVED';
  accessCount: number;
  scheduleCount: number;
  updatedAt: string;
}

export interface ReportExport {
  id: string;
  reportId: string;
  format: ReportExportFormat;
  status: 'QUEUED' | 'RUNNING' | 'READY' | 'FAILED' | 'EXPIRED' | 'DELETED' | 'CANCELLED';
  filename: string;
  rowCount?: number | null;
  expiresAt: string;
}

export const reportKeys = {
  list: (scope: AnalyticsScopeType, scopeId: string | null) => ['reports', scope, scopeId] as const,
};

export async function listReports(scope: AnalyticsScopeType, scopeId: string) {
  const response = await apiClient.request<{ reports: ReportDefinition[] }>(
    `${basePath(scope, scopeId)}/reports`,
    requestOptions(scope, scopeId),
  );
  return response.data;
}

export async function createReport(
  scope: AnalyticsScopeType,
  scopeId: string,
  input: {
    name: string;
    type: ReportType;
    visibility: ReportVisibility;
    configuration: ReportConfig;
  },
) {
  const response = await apiClient.request<{ report: ReportDefinition }>(
    `${basePath(scope, scopeId)}/reports`,
    {
      ...requestOptions(scope, scopeId),
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
  return response.data.report;
}

export async function previewReport(scope: AnalyticsScopeType, scopeId: string, reportId: string) {
  const response = await apiClient.request<{ table: { columns: string[]; rows: unknown[][] } }>(
    `${basePath(scope, scopeId)}/reports/${reportId}/preview`,
    { ...requestOptions(scope, scopeId), method: 'POST' },
  );
  return response.data;
}

export async function exportReport(
  scope: AnalyticsScopeType,
  scopeId: string,
  reportId: string,
  format: ReportExportFormat,
) {
  const response = await apiClient.request<{ export: ReportExport; queued: boolean }>(
    `${basePath(scope, scopeId)}/reports/${reportId}/exports`,
    {
      ...requestOptions(scope, scopeId),
      method: 'POST',
      body: JSON.stringify({ format }),
    },
  );
  return response.data;
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
