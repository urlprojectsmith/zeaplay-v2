import { apiClient } from './api';
import type { PageResult } from './workspace-management';

export type GamificationXpEntryType = 'EARN' | 'DEDUCT' | 'REVERSAL' | 'ADJUSTMENT';
export type GamificationXpSourceType =
  'TASK' | 'PROJECT' | 'TICKET' | 'STREAK' | 'ACHIEVEMENT' | 'MANUAL' | 'SYSTEM';

export interface GamificationXpSummary {
  currentXp: number;
  lifetimeEarnedXp: number;
  lifetimeDeductedXp: number;
  entryCount: number;
  lastXpChangeAt: string | null;
}

export interface GamificationXpEntry {
  id: string;
  amount: number;
  entryType: GamificationXpEntryType;
  sourceType: GamificationXpSourceType;
  sourceEvent: string;
  sourceEntityId: string | null;
  reason: string | null;
  createdAt: string;
}

export interface GamificationXpHistoryParams {
  page?: number;
  pageSize?: number;
  entryType?: GamificationXpEntryType;
  sourceType?: GamificationXpSourceType;
}

export const gamificationKeys = {
  all: (workspaceId: string | null) => ['workspace-gamification', workspaceId] as const,
  summary: (workspaceId: string | null) =>
    [...gamificationKeys.all(workspaceId), 'my-xp-summary'] as const,
  history: (workspaceId: string | null, params: GamificationXpHistoryParams) =>
    [...gamificationKeys.all(workspaceId), 'my-xp-history', params] as const,
};

export async function getMyGamificationXpSummary(workspaceId: string) {
  const response = await apiClient.request<GamificationXpSummary>(
    `/workspaces/${workspaceId}/gamification/me/xp`,
  );
  return response.data;
}

export async function getMyGamificationXpHistory(
  workspaceId: string,
  params: GamificationXpHistoryParams,
) {
  const search = new URLSearchParams();
  if (params.page) search.set('page', String(params.page));
  if (params.pageSize) search.set('pageSize', String(params.pageSize));
  if (params.entryType) search.set('entryType', params.entryType);
  if (params.sourceType) search.set('sourceType', params.sourceType);
  const suffix = search.toString();
  const response = await apiClient.request<PageResult<GamificationXpEntry>>(
    `/workspaces/${workspaceId}/gamification/me/xp/history${suffix ? `?${suffix}` : ''}`,
  );
  return response.data;
}
