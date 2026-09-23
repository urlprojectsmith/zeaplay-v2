import { apiClient } from './api';

export interface GlobalLeaderboardPage<T> {
  scope: string;
  period: 'ALL_TIME';
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface GlobalAgencySubaccountsResponse {
  scope: string;
  period: 'ALL_TIME';
  agencyId: string;
  globalScore: number;
  items: GlobalSubaccountLeaderboardItem[];
}

export interface GlobalAgencyLeaderboardItem {
  rank: number;
  agencyId: string;
  agencyName: string;
  globalScore: number;
  subaccounts: number;
  scoredUsers: number;
}

export interface GlobalSubaccountLeaderboardItem {
  rank: number;
  workspaceId: string;
  workspaceName: string;
  agencyId: string | null;
  agencyName: string | null;
  globalScore: number;
  scoredUsers: number;
}

export interface GlobalUserLeaderboardItem {
  rank: number;
  membershipId: string | null;
  displayName: string;
  workspaceId: string;
  workspaceName: string;
  agencyId: string;
  agencyName: string;
  departmentName: string | null;
  privacyMode: 'SHOW_NAME' | 'SHOW_DISPLAY_NAME' | 'ANONYMOUS' | 'OPT_OUT';
  globalScore: number;
}

export interface GlobalLeaderboardParams {
  page?: number;
  pageSize?: number;
  search?: string;
  agencyId?: string;
  workspaceId?: string;
}

export const globalGamificationKeys = {
  agencySubaccounts: (agencyId: string | null, search: string) =>
    ['global-gamification', 'agency', agencyId, 'subaccounts', search] as const,
  agencyUsers: (
    agencyId: string | null,
    workspaceId: string | null,
    params: GlobalLeaderboardParams,
  ) => ['global-gamification', 'agency', agencyId, 'users', workspaceId, params] as const,
  platform: (contextAgencyId: string | null, tab: string, params: GlobalLeaderboardParams) =>
    ['global-gamification', 'platform', contextAgencyId, tab, params] as const,
};

export async function getAgencyGlobalSubaccounts(agencyId: string, search = '') {
  const params = new URLSearchParams();
  if (search.trim()) params.set('search', search.trim());
  const suffix = params.toString();
  const response = await apiClient.request<GlobalAgencySubaccountsResponse>(
    `/agencies/${agencyId}/gamification/global-leaderboard/subaccounts${suffix ? `?${suffix}` : ''}`,
  );
  return response.data;
}

export async function getAgencyGlobalUsers(
  agencyId: string,
  workspaceId: string,
  params: GlobalLeaderboardParams,
) {
  const suffix = globalLeaderboardSearch(params);
  const response = await apiClient.request<GlobalLeaderboardPage<GlobalUserLeaderboardItem>>(
    `/agencies/${agencyId}/gamification/global-leaderboard/subaccounts/${workspaceId}/users${suffix}`,
  );
  return response.data;
}

export async function getPlatformGlobalAgencies(params: GlobalLeaderboardParams) {
  const suffix = globalLeaderboardSearch(params);
  const response = await apiClient.request<GlobalLeaderboardPage<GlobalAgencyLeaderboardItem>>(
    `/platform/gamification/global-leaderboard/agencies${suffix}`,
  );
  return response.data;
}

export async function getPlatformGlobalSubaccounts(params: GlobalLeaderboardParams) {
  const suffix = globalLeaderboardSearch(params);
  const response = await apiClient.request<GlobalLeaderboardPage<GlobalSubaccountLeaderboardItem>>(
    `/platform/gamification/global-leaderboard/subaccounts${suffix}`,
  );
  return response.data;
}

export async function getPlatformGlobalUsers(params: GlobalLeaderboardParams) {
  const suffix = globalLeaderboardSearch(params);
  const response = await apiClient.request<GlobalLeaderboardPage<GlobalUserLeaderboardItem>>(
    `/platform/gamification/global-leaderboard/users${suffix}`,
  );
  return response.data;
}

function globalLeaderboardSearch(params: GlobalLeaderboardParams) {
  const search = new URLSearchParams();
  if (params.page) search.set('page', String(params.page));
  if (params.pageSize) search.set('pageSize', String(params.pageSize));
  if (params.search?.trim()) search.set('search', params.search.trim());
  if (params.agencyId) search.set('agencyId', params.agencyId);
  if (params.workspaceId) search.set('workspaceId', params.workspaceId);
  const suffix = search.toString();
  return suffix ? `?${suffix}` : '';
}
