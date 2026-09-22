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
  levelsConfigured: boolean;
  currentLevel: GamificationLevel | null;
  nextLevel: GamificationLevel | null;
  xpIntoCurrentLevel: number | null;
  xpToNextLevel: number | null;
  progressPercent: number | null;
  isMaxLevel: boolean;
  earnedAchievementCount: number;
  earnedBadgeCount: number;
}

export interface GamificationStreakConfig {
  id: string | null;
  workspaceId: string;
  enabled: boolean;
  dailyXpReward: number;
  dailyRewardPoints: number;
  enabledAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export type GamificationStreakQualificationType = 'TASK_COMPLETED' | 'TICKET_RESOLVED';

export interface GamificationStreakDay {
  id: string;
  workspaceId: string;
  membershipId: string;
  localDate: string;
  qualificationType: GamificationStreakQualificationType;
  sourceEntityId: string;
  qualifiedAt: string;
  timezoneSnapshot: string;
  dailyXpRewardSnapshot: number;
  dailyRewardPointsSnapshot: number;
  createdAt: string;
}

export interface GamificationStreakSummary {
  config: GamificationStreakConfig;
  timezone: string;
  currentStreak: number;
  longestStreak: number;
  qualifiedToday: boolean;
  needsActionToday: boolean;
  lastQualifiedDate: string | null;
  recentDays: GamificationStreakDay[];
}

export interface GamificationStreakHistoryParams {
  page?: number;
  pageSize?: number;
}

export interface UpdateGamificationStreakConfigInput {
  enabled?: boolean;
  dailyXpReward?: number;
  dailyRewardPoints?: number;
}

export interface GamificationLevel {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  levelNumber: number;
  xpThreshold: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
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

export interface UpsertGamificationLevelInput {
  name?: string;
  description?: string | null;
  levelNumber?: number;
  xpThreshold?: number;
  isActive?: boolean;
}

export type GamificationAchievementCriterionType =
  | 'XP_TOTAL_AT_LEAST'
  | 'TASK_COMPLETED_COUNT'
  | 'PROJECT_COMPLETED_COUNT'
  | 'TICKET_RESOLVED_COUNT';

export interface GamificationBadge {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  iconKey: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GamificationBadgeAward {
  id: string;
  badgeDefinitionId: string;
  badgeNameSnapshot: string;
  badgeIconKeySnapshot: string | null;
  achievementAwardId: string | null;
  earnedAt: string;
  badgeDefinition?: Pick<GamificationBadge, 'id' | 'name' | 'description' | 'iconKey' | 'isActive'>;
}

export interface GamificationAchievement {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  criterionType: GamificationAchievementCriterionType;
  criterionValue: number;
  badgeDefinitionId: string | null;
  xpReward: number;
  rewardPointsReward: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  badgeDefinition: Pick<GamificationBadge, 'id' | 'name' | 'iconKey' | 'isActive'> | null;
  earned: boolean;
  earnedAt: string | null;
  progress: { currentValue: number; targetValue: number; percent: number };
}

export interface GamificationAchievementAward {
  id: string;
  achievementDefinitionId: string;
  achievementNameSnapshot: string;
  criterionTypeSnapshot: GamificationAchievementCriterionType;
  criterionValueSnapshot: number;
  badgeDefinitionIdSnapshot: string | null;
  xpRewardSnapshot: number;
  rewardPointsRewardSnapshot: number;
  earnedAt: string;
}

export interface UpsertGamificationBadgeInput {
  name?: string;
  description?: string | null;
  iconKey?: string | null;
  isActive?: boolean;
}

export interface UpsertGamificationAchievementInput {
  name?: string;
  description?: string | null;
  criterionType?: GamificationAchievementCriterionType;
  criterionValue?: number;
  badgeDefinitionId?: string | null;
  xpReward?: number;
  rewardPointsReward?: number;
  isActive?: boolean;
}

export type GamificationRewardPointEntryType =
  'EARN' | 'SPEND' | 'REFUND' | 'ADJUSTMENT' | 'REVERSAL';
export type GamificationRewardPointSourceType =
  'ACHIEVEMENT' | 'STREAK' | 'REWARD_REDEMPTION' | 'MANUAL' | 'SYSTEM';
export type GamificationRewardInventoryMode = 'UNLIMITED' | 'LIMITED';
export type GamificationRewardRedemptionStatus = 'PENDING' | 'FULFILLED' | 'CANCELLED';
export type GamificationLeaderboardPrivacyMode =
  'SHOW_NAME' | 'SHOW_DISPLAY_NAME' | 'ANONYMOUS' | 'OPT_OUT';
export type GamificationAdminEconomy = 'XP' | 'REWARD_POINTS';
export type GamificationAdminAdjustmentOperation = 'ADD' | 'DEDUCT';
export type GamificationPointScopeType = 'WORKSPACE' | 'DEPARTMENT';
export type GamificationPointWorkType = 'TASK' | 'PROJECT' | 'TICKET';
export type GamificationPointCategory = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' | 'LONG_TERM';
export type GamificationPointRuleSource =
  'WORKSPACE_DEFAULT' | 'DEPARTMENT_OVERRIDE' | 'NOT_CONFIGURED';

export interface GamificationRewardPointSummary {
  currentRewardPoints: number;
  lifetimeEarnedRewardPoints: number;
  lifetimeSpentRewardPoints: number;
  lifetimeRefundedRewardPoints: number;
  entryCount: number;
  lastRewardPointChangeAt: string | null;
}

export interface GamificationRewardPointEntry {
  id: string;
  amount: number;
  entryType: GamificationRewardPointEntryType;
  sourceType: GamificationRewardPointSourceType;
  sourceEvent: string;
  sourceEntityId: string | null;
  reason: string | null;
  createdAt: string;
}

export interface GamificationRewardDefinition {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  pointsCost: number;
  inventoryMode: GamificationRewardInventoryMode;
  availableQuantity: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GamificationRewardRedemption {
  id: string;
  workspaceId: string;
  membershipId: string;
  rewardDefinitionId: string;
  status: GamificationRewardRedemptionStatus;
  rewardNameSnapshot: string;
  pointsCostSnapshot: number;
  inventoryModeSnapshot: GamificationRewardInventoryMode;
  requestedAt: string;
  fulfilledAt: string | null;
  cancelledAt: string | null;
  fulfilledByMembershipId: string | null;
  cancelledByMembershipId: string | null;
  cancelReason: string | null;
  rewardDefinition: Pick<GamificationRewardDefinition, 'id' | 'name' | 'isActive'> | null;
}

export interface GamificationRewardHistoryParams {
  page?: number;
  pageSize?: number;
}

export interface GamificationRewardDefinitionParams {
  includeInactive?: boolean;
  page?: number;
  pageSize?: number;
}

export interface GamificationRewardRedemptionParams {
  status?: GamificationRewardRedemptionStatus;
  page?: number;
  pageSize?: number;
}

export interface UpsertGamificationRewardInput {
  name?: string;
  description?: string | null;
  pointsCost?: number;
  inventoryMode?: GamificationRewardInventoryMode;
  availableQuantity?: number | null;
  isActive?: boolean;
}

export interface GamificationLeaderboardConfig {
  id: string | null;
  workspaceId: string;
  enabled: boolean;
  workspaceLeaderboardEnabled: boolean;
  departmentLeaderboardEnabled: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface GamificationLeaderboardPreference {
  id: string | null;
  workspaceId: string;
  membershipId: string;
  privacyMode: GamificationLeaderboardPrivacyMode;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface GamificationLeaderboardEntry {
  key: string;
  rank: number;
  displayName: string;
  currentXp: number;
  currentLevel: GamificationLevel | null;
  isCurrentUser: boolean;
  privacyMode: GamificationLeaderboardPrivacyMode;
  departmentName: string | null;
}

export interface GamificationLeaderboardSelf {
  included: boolean;
  rank: number | null;
  currentXp: number | null;
  currentLevel: GamificationLevel | null;
  privacyMode: GamificationLeaderboardPrivacyMode;
  inTopEntries: boolean;
  displayName?: string;
}

export interface GamificationLeaderboardResponse {
  scope: 'WORKSPACE' | 'DEPARTMENT';
  period: 'ALL_TIME';
  available: boolean;
  reason: string | null;
  config: GamificationLeaderboardConfig;
  entries: GamificationLeaderboardEntry[];
  me: GamificationLeaderboardSelf;
}

export interface UpdateGamificationLeaderboardConfigInput {
  enabled?: boolean;
  workspaceLeaderboardEnabled?: boolean;
  departmentLeaderboardEnabled?: boolean;
}

export interface GamificationAdminMember {
  membershipId: string;
  displayName: string;
  departmentName: string | null;
  status: string;
}

export interface GamificationAdminBalance {
  member: GamificationAdminMember;
  balances: {
    currentXp: number;
    currentRewardPoints: number;
  };
}

export interface GamificationAdminAdjustmentInput {
  targetMembershipId: string;
  economy: GamificationAdminEconomy;
  operation: GamificationAdminAdjustmentOperation;
  amount: number;
  reason: string;
  idempotencyKey: string;
}

export interface GamificationResetStepUpInput {
  targetMembershipId: string;
  economy: GamificationAdminEconomy;
  password: string;
}

export interface GamificationEmailOtpChallenge {
  challengeId: string;
  expiresAt: string;
  resendAvailableAt: string;
  maskedDestination: string;
  purpose: 'GAMIFICATION_RESET';
  economy: GamificationAdminEconomy;
  targetMembershipId: string;
}

export interface GamificationResetStepUpGrant {
  id: string;
  expiresAt: string;
  purpose: 'GAMIFICATION_RESET';
  economy: GamificationAdminEconomy;
  targetMembershipId: string;
}

export interface GamificationAdminResetInput {
  targetMembershipId: string;
  economy: GamificationAdminEconomy;
  reason: string;
  confirmation: string;
  stepUpGrantId: string;
  idempotencyKey: string;
}

export interface GamificationAdminMutationResult {
  changed: boolean;
  member: GamificationAdminMember;
  economy: GamificationAdminEconomy;
  operation?: GamificationAdminAdjustmentOperation;
  amount?: number;
  before: number;
  after: number;
  entryId?: string;
  entryIds?: string[];
}

export interface GamificationAdminAction {
  id: string;
  action: string;
  targetMembershipId: string | null;
  createdAt: string;
  metadata: {
    targetMembershipId?: string | null;
    economy?: unknown;
    operation?: unknown;
    amount?: unknown;
    before?: unknown;
    after?: unknown;
    reason?: string | null;
    changed?: unknown;
  };
}

export interface GamificationPointRule {
  id: string;
  workspaceId: string;
  departmentId: string | null;
  scopeType: GamificationPointScopeType;
  workType: GamificationPointWorkType;
  category: GamificationPointCategory;
  isEnabled: boolean;
  baseXp: number;
  earlyBonusXp: number;
  earlyThresholdMinutes: number | null;
  latePenaltyPercent: number;
  penaltyIntervalMinutes: number | null;
  maxPenaltyXp: number;
  createdAt: string;
  updatedAt: string;
}

export interface GamificationCreationPointRule {
  id: string;
  workspaceId: string;
  departmentId: string | null;
  scopeType: GamificationPointScopeType;
  workType: GamificationPointWorkType;
  category: GamificationPointCategory;
  roleId: string;
  isEnabled: boolean;
  creationXp: number;
  createdAt: string;
  updatedAt: string;
}

export interface GamificationPointManagement {
  workTypes: GamificationPointWorkType[];
  categories: GamificationPointCategory[];
  departmentId: string | null;
  departments: Array<{ id: string; name: string; status: string }>;
  roles: Array<{
    id: string;
    key: string;
    name: string;
    isSystem: boolean;
    workspaceId: string | null;
  }>;
  completionRules: GamificationPointRule[];
  creationRules: GamificationCreationPointRule[];
  effectiveCompletionRules: Array<{
    workType: GamificationPointWorkType;
    category: GamificationPointCategory;
    source: GamificationPointRuleSource;
    rule: GamificationPointRule | null;
  }>;
  effectiveCreationRules: Array<{
    roleId: string;
    workType: GamificationPointWorkType;
    category: GamificationPointCategory;
    source: GamificationPointRuleSource;
    rule: GamificationCreationPointRule | null;
  }>;
  projectXpCategoryRequiredForNewProjects: boolean;
  projectXpCategoryRollout: string;
}

export interface UpsertGamificationCompletionPointRuleInput {
  scopeType: GamificationPointScopeType;
  departmentId?: string | null;
  workType: GamificationPointWorkType;
  category: GamificationPointCategory;
  isEnabled: boolean;
  baseXp: number;
  earlyBonusXp: number;
  earlyThresholdMinutes?: number | null;
  latePenaltyPercent: number;
  penaltyIntervalMinutes?: number | null;
  maxPenaltyXp: number;
}

export interface PreviewGamificationCompletionPointInput {
  isEnabled: boolean;
  baseXp: number;
  earlyBonusXp: number;
  earlyThresholdMinutes?: number | null;
  latePenaltyPercent: number;
  penaltyIntervalMinutes?: number | null;
  maxPenaltyXp: number;
  completedAt: string;
  dueAt?: string | null;
}

export interface GamificationCompletionPointPreview {
  enabled: boolean;
  timing: 'NO_DEADLINE' | 'EARLY' | 'ON_TIME' | 'LATE';
  baseXp: number;
  earlyBonusXp: number;
  penaltyXp: number;
  netCompletionXp: number;
  lateMinutes: number;
  lateIntervals: number;
}

export interface UpsertGamificationCreationPointRuleInput {
  scopeType: GamificationPointScopeType;
  departmentId?: string | null;
  workType: GamificationPointWorkType;
  category: GamificationPointCategory;
  roleId: string;
  isEnabled: boolean;
  creationXp: number;
}

export const gamificationKeys = {
  all: (workspaceId: string | null) => ['workspace-gamification', workspaceId] as const,
  summary: (workspaceId: string | null) =>
    [...gamificationKeys.all(workspaceId), 'my-xp-summary'] as const,
  history: (workspaceId: string | null, params: GamificationXpHistoryParams) =>
    [...gamificationKeys.all(workspaceId), 'my-xp-history', params] as const,
  levels: (workspaceId: string | null, includeInactive: boolean) =>
    [...gamificationKeys.all(workspaceId), 'levels', includeInactive] as const,
  badges: (workspaceId: string | null, includeInactive: boolean) =>
    [...gamificationKeys.all(workspaceId), 'badges', includeInactive] as const,
  achievements: (workspaceId: string | null, includeInactive: boolean) =>
    [...gamificationKeys.all(workspaceId), 'achievements', includeInactive] as const,
  streakSummary: (workspaceId: string | null) =>
    [...gamificationKeys.all(workspaceId), 'streak-summary'] as const,
  streakHistory: (workspaceId: string | null, params: GamificationStreakHistoryParams) =>
    [...gamificationKeys.all(workspaceId), 'streak-history', params] as const,
  streakConfig: (workspaceId: string | null) =>
    [...gamificationKeys.all(workspaceId), 'streak-config'] as const,
  rewardPointSummary: (workspaceId: string | null) =>
    [...gamificationKeys.all(workspaceId), 'my-reward-point-summary'] as const,
  rewardPointHistory: (workspaceId: string | null, params: GamificationRewardHistoryParams) =>
    [...gamificationKeys.all(workspaceId), 'my-reward-point-history', params] as const,
  rewards: (workspaceId: string | null, params: GamificationRewardDefinitionParams) =>
    [...gamificationKeys.all(workspaceId), 'rewards', params] as const,
  myRewardRedemptions: (workspaceId: string | null, params: GamificationRewardRedemptionParams) =>
    [...gamificationKeys.all(workspaceId), 'my-reward-redemptions', params] as const,
  rewardRedemptions: (workspaceId: string | null, params: GamificationRewardRedemptionParams) =>
    [...gamificationKeys.all(workspaceId), 'reward-redemptions', params] as const,
  leaderboardConfig: (workspaceId: string | null) =>
    [...gamificationKeys.all(workspaceId), 'leaderboard-config'] as const,
  leaderboardPreference: (workspaceId: string | null) =>
    [...gamificationKeys.all(workspaceId), 'leaderboard-preference'] as const,
  workspaceLeaderboard: (workspaceId: string | null) =>
    [...gamificationKeys.all(workspaceId), 'leaderboard', 'workspace'] as const,
  myDepartmentLeaderboard: (workspaceId: string | null) =>
    [...gamificationKeys.all(workspaceId), 'leaderboard', 'department', 'me'] as const,
  adminMembers: (workspaceId: string | null, search: string) =>
    [...gamificationKeys.all(workspaceId), 'admin-members', search] as const,
  adminBalance: (workspaceId: string | null, membershipId: string | null) =>
    [...gamificationKeys.all(workspaceId), 'admin-balance', membershipId] as const,
  adminActions: (workspaceId: string | null) =>
    [...gamificationKeys.all(workspaceId), 'admin-actions'] as const,
  pointRules: (workspaceId: string | null, departmentId: string | null) =>
    [...gamificationKeys.all(workspaceId), 'point-rules', departmentId] as const,
  pointRulesForWorkspace: (workspaceId: string | null) =>
    [...gamificationKeys.all(workspaceId), 'point-rules'] as const,
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

export async function listGamificationLevels(workspaceId: string, includeInactive = false) {
  const search = new URLSearchParams();
  if (includeInactive) search.set('includeInactive', 'true');
  const suffix = search.toString();
  const response = await apiClient.request<{ items: GamificationLevel[] }>(
    `/workspaces/${workspaceId}/gamification/levels${suffix ? `?${suffix}` : ''}`,
  );
  return response.data;
}

export async function createGamificationLevel(
  workspaceId: string,
  input: Required<Pick<UpsertGamificationLevelInput, 'name' | 'levelNumber' | 'xpThreshold'>> &
    UpsertGamificationLevelInput,
) {
  const response = await apiClient.request<GamificationLevel>(
    `/workspaces/${workspaceId}/gamification/levels`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return response.data;
}

export async function updateGamificationLevel(
  workspaceId: string,
  levelId: string,
  input: UpsertGamificationLevelInput,
) {
  const response = await apiClient.request<GamificationLevel>(
    `/workspaces/${workspaceId}/gamification/levels/${levelId}`,
    { method: 'PATCH', body: JSON.stringify(input) },
  );
  return response.data;
}

export async function listGamificationBadges(workspaceId: string, includeInactive = false) {
  const search = new URLSearchParams();
  if (includeInactive) search.set('includeInactive', 'true');
  const suffix = search.toString();
  const response = await apiClient.request<{
    items: GamificationBadge[];
    earned: GamificationBadgeAward[];
  }>(`/workspaces/${workspaceId}/gamification/badges${suffix ? `?${suffix}` : ''}`);
  return response.data;
}

export async function createGamificationBadge(
  workspaceId: string,
  input: Required<Pick<UpsertGamificationBadgeInput, 'name'>> & UpsertGamificationBadgeInput,
) {
  const response = await apiClient.request<GamificationBadge>(
    `/workspaces/${workspaceId}/gamification/badges`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return response.data;
}

export async function updateGamificationBadge(
  workspaceId: string,
  badgeId: string,
  input: UpsertGamificationBadgeInput,
) {
  const response = await apiClient.request<GamificationBadge>(
    `/workspaces/${workspaceId}/gamification/badges/${badgeId}`,
    { method: 'PATCH', body: JSON.stringify(input) },
  );
  return response.data;
}

export async function listGamificationAchievements(workspaceId: string, includeInactive = false) {
  const search = new URLSearchParams();
  if (includeInactive) search.set('includeInactive', 'true');
  const suffix = search.toString();
  const response = await apiClient.request<{
    items: GamificationAchievement[];
    earned: GamificationAchievementAward[];
  }>(`/workspaces/${workspaceId}/gamification/achievements${suffix ? `?${suffix}` : ''}`);
  return response.data;
}

export async function createGamificationAchievement(
  workspaceId: string,
  input: Required<
    Pick<UpsertGamificationAchievementInput, 'name' | 'criterionType' | 'criterionValue'>
  > &
    UpsertGamificationAchievementInput,
) {
  const response = await apiClient.request<GamificationAchievement>(
    `/workspaces/${workspaceId}/gamification/achievements`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return response.data;
}

export async function updateGamificationAchievement(
  workspaceId: string,
  achievementId: string,
  input: UpsertGamificationAchievementInput,
) {
  const response = await apiClient.request<GamificationAchievement>(
    `/workspaces/${workspaceId}/gamification/achievements/${achievementId}`,
    { method: 'PATCH', body: JSON.stringify(input) },
  );
  return response.data;
}

export async function getMyGamificationStreakSummary(workspaceId: string) {
  const response = await apiClient.request<GamificationStreakSummary>(
    `/workspaces/${workspaceId}/gamification/streaks/me`,
  );
  return response.data;
}

export async function getMyGamificationStreakHistory(
  workspaceId: string,
  params: GamificationStreakHistoryParams,
) {
  const search = new URLSearchParams();
  if (params.page) search.set('page', String(params.page));
  if (params.pageSize) search.set('pageSize', String(params.pageSize));
  const suffix = search.toString();
  const response = await apiClient.request<PageResult<GamificationStreakDay>>(
    `/workspaces/${workspaceId}/gamification/streaks/me/history${suffix ? `?${suffix}` : ''}`,
  );
  return response.data;
}

export async function getGamificationStreakConfig(workspaceId: string) {
  const response = await apiClient.request<GamificationStreakConfig>(
    `/workspaces/${workspaceId}/gamification/streaks/config`,
  );
  return response.data;
}

export async function updateGamificationStreakConfig(
  workspaceId: string,
  input: UpdateGamificationStreakConfigInput,
) {
  const response = await apiClient.request<GamificationStreakConfig>(
    `/workspaces/${workspaceId}/gamification/streaks/config`,
    { method: 'PATCH', body: JSON.stringify(input) },
  );
  return response.data;
}

export async function getMyGamificationRewardPointSummary(workspaceId: string) {
  const response = await apiClient.request<GamificationRewardPointSummary>(
    `/workspaces/${workspaceId}/gamification/me/reward-points`,
  );
  return response.data;
}

export async function getMyGamificationRewardPointHistory(
  workspaceId: string,
  params: GamificationRewardHistoryParams,
) {
  const search = new URLSearchParams();
  if (params.page) search.set('page', String(params.page));
  if (params.pageSize) search.set('pageSize', String(params.pageSize));
  const suffix = search.toString();
  const response = await apiClient.request<PageResult<GamificationRewardPointEntry>>(
    `/workspaces/${workspaceId}/gamification/me/reward-points/history${suffix ? `?${suffix}` : ''}`,
  );
  return response.data;
}

export async function listGamificationRewards(
  workspaceId: string,
  params: GamificationRewardDefinitionParams = {},
) {
  const search = new URLSearchParams();
  if (params.includeInactive) search.set('includeInactive', 'true');
  if (params.page) search.set('page', String(params.page));
  if (params.pageSize) search.set('pageSize', String(params.pageSize));
  const suffix = search.toString();
  const response = await apiClient.request<PageResult<GamificationRewardDefinition>>(
    `/workspaces/${workspaceId}/gamification/rewards${suffix ? `?${suffix}` : ''}`,
  );
  return response.data;
}

export async function createGamificationReward(
  workspaceId: string,
  input: Required<Pick<UpsertGamificationRewardInput, 'name' | 'pointsCost' | 'inventoryMode'>> &
    UpsertGamificationRewardInput,
) {
  const response = await apiClient.request<GamificationRewardDefinition>(
    `/workspaces/${workspaceId}/gamification/rewards`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return response.data;
}

export async function updateGamificationReward(
  workspaceId: string,
  rewardId: string,
  input: UpsertGamificationRewardInput,
) {
  const response = await apiClient.request<GamificationRewardDefinition>(
    `/workspaces/${workspaceId}/gamification/rewards/${rewardId}`,
    { method: 'PATCH', body: JSON.stringify(input) },
  );
  return response.data;
}

export async function redeemGamificationReward(workspaceId: string, rewardId: string) {
  const response = await apiClient.request<GamificationRewardRedemption>(
    `/workspaces/${workspaceId}/gamification/rewards/${rewardId}/redemptions`,
    { method: 'POST', body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }) },
  );
  return response.data;
}

export async function listMyGamificationRewardRedemptions(
  workspaceId: string,
  params: GamificationRewardRedemptionParams = {},
) {
  const search = new URLSearchParams();
  if (params.status) search.set('status', params.status);
  if (params.page) search.set('page', String(params.page));
  if (params.pageSize) search.set('pageSize', String(params.pageSize));
  const suffix = search.toString();
  const response = await apiClient.request<PageResult<GamificationRewardRedemption>>(
    `/workspaces/${workspaceId}/gamification/rewards/redemptions/me${suffix ? `?${suffix}` : ''}`,
  );
  return response.data;
}

export async function listGamificationRewardRedemptions(
  workspaceId: string,
  params: GamificationRewardRedemptionParams = {},
) {
  const search = new URLSearchParams();
  if (params.status) search.set('status', params.status);
  if (params.page) search.set('page', String(params.page));
  if (params.pageSize) search.set('pageSize', String(params.pageSize));
  const suffix = search.toString();
  const response = await apiClient.request<PageResult<GamificationRewardRedemption>>(
    `/workspaces/${workspaceId}/gamification/rewards/redemptions${suffix ? `?${suffix}` : ''}`,
  );
  return response.data;
}

export async function fulfillGamificationRewardRedemption(
  workspaceId: string,
  redemptionId: string,
) {
  const response = await apiClient.request<GamificationRewardRedemption>(
    `/workspaces/${workspaceId}/gamification/rewards/redemptions/${redemptionId}/fulfill`,
    { method: 'PATCH' },
  );
  return response.data;
}

export async function cancelGamificationRewardRedemption(
  workspaceId: string,
  redemptionId: string,
  reason?: string,
) {
  const response = await apiClient.request<GamificationRewardRedemption>(
    `/workspaces/${workspaceId}/gamification/rewards/redemptions/${redemptionId}/cancel`,
    { method: 'PATCH', body: JSON.stringify({ reason: reason || null }) },
  );
  return response.data;
}

export async function getGamificationLeaderboardConfig(workspaceId: string) {
  const response = await apiClient.request<GamificationLeaderboardConfig>(
    `/workspaces/${workspaceId}/gamification/leaderboards/config`,
  );
  return response.data;
}

export async function updateGamificationLeaderboardConfig(
  workspaceId: string,
  input: UpdateGamificationLeaderboardConfigInput,
) {
  const response = await apiClient.request<GamificationLeaderboardConfig>(
    `/workspaces/${workspaceId}/gamification/leaderboards/config`,
    { method: 'PATCH', body: JSON.stringify(input) },
  );
  return response.data;
}

export async function getMyGamificationLeaderboardPreference(workspaceId: string) {
  const response = await apiClient.request<GamificationLeaderboardPreference>(
    `/workspaces/${workspaceId}/gamification/leaderboards/me/preferences`,
  );
  return response.data;
}

export async function updateMyGamificationLeaderboardPreference(
  workspaceId: string,
  privacyMode: GamificationLeaderboardPrivacyMode,
) {
  const response = await apiClient.request<GamificationLeaderboardPreference>(
    `/workspaces/${workspaceId}/gamification/leaderboards/me/preferences`,
    { method: 'PATCH', body: JSON.stringify({ privacyMode }) },
  );
  return response.data;
}

export async function getWorkspaceGamificationLeaderboard(workspaceId: string) {
  const response = await apiClient.request<GamificationLeaderboardResponse>(
    `/workspaces/${workspaceId}/gamification/leaderboards/workspace`,
  );
  return response.data;
}

export async function getMyDepartmentGamificationLeaderboard(workspaceId: string) {
  const response = await apiClient.request<GamificationLeaderboardResponse>(
    `/workspaces/${workspaceId}/gamification/leaderboards/department/me`,
  );
  return response.data;
}

export async function getGamificationPointManagement(
  workspaceId: string,
  departmentId?: string | null,
) {
  const search = new URLSearchParams();
  if (departmentId) search.set('departmentId', departmentId);
  const suffix = search.toString();
  const response = await apiClient.request<GamificationPointManagement>(
    `/workspaces/${workspaceId}/gamification/points/rules${suffix ? `?${suffix}` : ''}`,
  );
  return response.data;
}

export async function upsertGamificationCompletionPointRule(
  workspaceId: string,
  input: UpsertGamificationCompletionPointRuleInput,
) {
  const response = await apiClient.request<GamificationPointRule>(
    `/workspaces/${workspaceId}/gamification/points/completion-rules`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return response.data;
}

export async function removeGamificationCompletionPointOverride(
  workspaceId: string,
  input: {
    departmentId: string;
    workType: GamificationPointWorkType;
    category: GamificationPointCategory;
  },
) {
  const response = await apiClient.request<{ removed: boolean }>(
    `/workspaces/${workspaceId}/gamification/points/completion-rules/remove-override`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return response.data;
}

export async function upsertGamificationCreationPointRule(
  workspaceId: string,
  input: UpsertGamificationCreationPointRuleInput,
) {
  const response = await apiClient.request<GamificationCreationPointRule>(
    `/workspaces/${workspaceId}/gamification/points/creation-rules`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return response.data;
}

export async function previewGamificationCompletionPoints(
  workspaceId: string,
  input: PreviewGamificationCompletionPointInput,
) {
  const response = await apiClient.request<GamificationCompletionPointPreview>(
    `/workspaces/${workspaceId}/gamification/points/preview`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return response.data;
}

export async function removeGamificationCreationPointOverride(
  workspaceId: string,
  input: {
    departmentId: string;
    workType: GamificationPointWorkType;
    category: GamificationPointCategory;
    roleId: string;
  },
) {
  const response = await apiClient.request<{ removed: boolean }>(
    `/workspaces/${workspaceId}/gamification/points/creation-rules/remove-override`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return response.data;
}

export async function searchGamificationAdminMembers(workspaceId: string, search: string) {
  const params = new URLSearchParams();
  if (search.trim()) params.set('search', search.trim());
  params.set('pageSize', '20');
  const response = await apiClient.request<{ items: GamificationAdminMember[] }>(
    `/workspaces/${workspaceId}/gamification/admin/members?${params.toString()}`,
  );
  return response.data;
}

export async function getGamificationAdminMemberBalance(workspaceId: string, membershipId: string) {
  const response = await apiClient.request<GamificationAdminBalance>(
    `/workspaces/${workspaceId}/gamification/admin/members/${membershipId}/balances`,
  );
  return response.data;
}

export async function adjustGamificationAdminBalance(
  workspaceId: string,
  input: GamificationAdminAdjustmentInput,
) {
  const response = await apiClient.request<GamificationAdminMutationResult>(
    `/workspaces/${workspaceId}/gamification/admin/adjustments`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return response.data;
}

export async function createGamificationResetStepUpGrant(
  workspaceId: string,
  input: GamificationResetStepUpInput,
) {
  const response = await apiClient.request<GamificationEmailOtpChallenge>(
    `/auth/step-up/email-otp/start`,
    {
      method: 'POST',
      body: JSON.stringify({
        workspaceId,
        purpose: 'GAMIFICATION_RESET',
        ...input,
      }),
    },
  );
  return response.data;
}

export async function verifyGamificationResetEmailOtp(challengeId: string, code: string) {
  const response = await apiClient.request<GamificationResetStepUpGrant>(
    `/auth/step-up/email-otp/verify`,
    { method: 'POST', body: JSON.stringify({ challengeId, code }) },
  );
  return response.data;
}

export async function resetGamificationAdminBalance(
  workspaceId: string,
  input: GamificationAdminResetInput,
) {
  const response = await apiClient.request<GamificationAdminMutationResult>(
    `/workspaces/${workspaceId}/gamification/admin/resets`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return response.data;
}

export async function listGamificationAdminActions(workspaceId: string) {
  const response = await apiClient.request<{ items: GamificationAdminAction[] }>(
    `/workspaces/${workspaceId}/gamification/admin/actions`,
  );
  return response.data;
}
