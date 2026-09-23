import { apiClient } from './api';

export interface DeveloperPage<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface DeveloperHealthCard {
  title: string;
  status: 'HEALTHY' | 'WARNING' | 'ERROR';
  value: number;
  summary: string;
}

export interface DeveloperHealth {
  generatedAt: string;
  cards: DeveloperHealthCard[];
  metrics: Record<string, unknown>;
}

export interface DeveloperQueryParams {
  page?: number;
  pageSize?: number;
  workspaceId?: string;
  agencyId?: string;
  membershipId?: string;
  from?: string;
  to?: string;
  search?: string;
  [key: string]: string | number | undefined;
}

export const developerGamificationKeys = {
  health: () => ['developer-gamification', 'health'] as const,
  tab: (tab: string, params: DeveloperQueryParams = {}) =>
    ['developer-gamification', tab, params] as const,
};

export async function getDeveloperGamificationHealth() {
  const response = await apiClient.request<DeveloperHealth>('/developer/gamification/health');
  return response.data;
}

export async function getDeveloperPointRules(params: DeveloperQueryParams) {
  const response = await apiClient.request<{
    completionRules: unknown[];
    creationRules: unknown[];
  }>(`/developer/gamification/point-rules${queryString(params)}`);
  return response.data;
}

export async function getDeveloperXpEvents(params: DeveloperQueryParams) {
  const response = await apiClient.request<DeveloperPage<Record<string, unknown>>>(
    `/developer/gamification/xp-events${queryString(params)}`,
  );
  return response.data;
}

export async function getDeveloperNormalizationEvents(params: DeveloperQueryParams) {
  const response = await apiClient.request<DeveloperPage<Record<string, unknown>>>(
    `/developer/gamification/normalization/events${queryString(params)}`,
  );
  return response.data;
}

export async function getDeveloperBaselines(params: DeveloperQueryParams) {
  const response = await apiClient.request<DeveloperPage<Record<string, unknown>>>(
    `/developer/gamification/normalization/baselines${queryString(params)}`,
  );
  return response.data;
}

export async function getDeveloperLeaderboardDiagnostics(params: DeveloperQueryParams) {
  const response = await apiClient.request<Record<string, unknown>>(
    `/developer/gamification/leaderboards/diagnostics${queryString(params)}`,
  );
  return response.data;
}

export async function getDeveloperReconciliation(params: DeveloperQueryParams) {
  const response = await apiClient.request<DeveloperPage<Record<string, unknown>>>(
    `/developer/gamification/reconciliation${queryString(params)}`,
  );
  return response.data;
}

export async function getDeveloperLedgerHealth() {
  const response = await apiClient.request<Record<string, unknown>>(
    '/developer/gamification/ledgers/health',
  );
  return response.data;
}

export async function getDeveloperAchievementsStreaksHealth() {
  const response = await apiClient.request<Record<string, unknown>>(
    '/developer/gamification/achievements-streaks/health',
  );
  return response.data;
}

export async function getDeveloperSecurityHealth() {
  const response = await apiClient.request<Record<string, unknown>>(
    '/developer/gamification/security',
  );
  return response.data;
}

export async function getDeveloperAudit(params: DeveloperQueryParams) {
  const response = await apiClient.request<DeveloperPage<Record<string, unknown>>>(
    `/developer/gamification/audit${queryString(params)}`,
  );
  return response.data;
}

function queryString(params: DeveloperQueryParams) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const suffix = search.toString();
  return suffix ? `?${suffix}` : '';
}
