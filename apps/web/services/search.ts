import { apiClient } from './api';
import type { AnalyticsScopeType } from './analytics';
import { superAgencyHeaders } from './super-agencies';

export type SearchResultType =
  | 'TASK'
  | 'PROJECT'
  | 'TICKET'
  | 'DOC'
  | 'FORM'
  | 'GOAL'
  | 'FILE'
  | 'MEMBER'
  | 'AUTOMATION'
  | 'API_KEY'
  | 'WEBHOOK'
  | 'INTEGRATION'
  | 'BILLING_METADATA'
  | 'SUPER_AGENCY'
  | 'AGENCY'
  | 'WORKSPACE';

export interface SearchResult {
  id: string;
  type: SearchResultType;
  entityId: string;
  title: string;
  subtitle: string | null;
  snippet: string | null;
  scope: { type: AnalyticsScopeType; id: string };
  route: { href?: string };
  metadata: Record<string, unknown>;
  archived: boolean;
  updatedAt: string;
  score: number;
}

export interface SearchResponse {
  query: string;
  scope: { type: AnalyticsScopeType; id: string };
  page: number;
  pageSize: number;
  hasMore: boolean;
  results: SearchResult[];
}

export interface RecentSearch {
  id: string;
  query: string;
  resultTypes: SearchResultType[];
  updatedAt: string;
}

export const searchKeys = {
  results: (scope: AnalyticsScopeType, scopeId: string | null, query: string) =>
    ['search', scope, scopeId, query] as const,
  recent: (scope: AnalyticsScopeType, scopeId: string | null) =>
    ['search', scope, scopeId, 'recent'] as const,
};

export async function globalSearch(
  scope: AnalyticsScopeType,
  scopeId: string,
  params: { q: string; types?: SearchResultType[]; pageSize?: number; saveRecent?: boolean },
) {
  const query = new URLSearchParams({
    q: params.q.trim(),
    pageSize: String(params.pageSize ?? 10),
    saveRecent: params.saveRecent === false ? 'false' : 'true',
  });
  if (params.types?.length) query.set('types', params.types.join(','));
  const response = await apiClient.request<SearchResponse>(
    `${basePath(scope, scopeId)}/search?${query}`,
    requestOptions(scope, scopeId),
  );
  return response.data;
}

export async function listRecentSearches(scope: AnalyticsScopeType, scopeId: string) {
  const response = await apiClient.request<{ searches: RecentSearch[] }>(
    `${basePath(scope, scopeId)}/search/recent`,
    requestOptions(scope, scopeId),
  );
  return response.data.searches;
}

export async function clearRecentSearches(scope: AnalyticsScopeType, scopeId: string) {
  const response = await apiClient.request<{ cleared: boolean }>(
    `${basePath(scope, scopeId)}/search/recent`,
    { ...requestOptions(scope, scopeId), method: 'DELETE' },
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
