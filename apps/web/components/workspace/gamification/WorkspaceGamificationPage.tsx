'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { Button, EmptyState, Skeleton } from '@zea-play/ui';
import { useLanguage } from '../../../contexts/language-provider';
import { translate as t } from '../../../lib/i18n';
import type { Locale } from '../../../lib/i18n';
import { useSessionStore } from '../../../stores/session';
import { listWorkspaceRoles, rolesKeys } from '../../../services/workspace-roles';
import {
  gamificationKeys,
  adjustGamificationAdminBalance,
  cancelGamificationRewardRedemption,
  createGamificationAchievement,
  createGamificationBadge,
  createGamificationLevel,
  createGamificationResetStepUpGrant,
  createGamificationReward,
  fulfillGamificationRewardRedemption,
  getGamificationAdminMemberBalance,
  getGamificationXpControlDetail,
  getGamificationLeaderboardConfig,
  getGamificationPointManagement,
  getMyGamificationLeaderboardPreference,
  getMyDepartmentGamificationLeaderboard,
  getMyGamificationRewardPointSummary,
  getMyGamificationStreakHistory,
  getMyGamificationStreakSummary,
  getMyGamificationXpHistory,
  getMyGamificationXpSummary,
  getGamificationStreakConfig,
  listGamificationAdminActions,
  listGamificationAchievements,
  listGamificationBadges,
  listGamificationXpControl,
  listGamificationXpControlLog,
  listGamificationLevels,
  listGamificationRewardRedemptions,
  listGamificationRewards,
  listMyGamificationRewardRedemptions,
  previewGamificationCompletionPoints,
  previewGamificationXpReconciliation,
  redeemGamificationReward,
  resetGamificationAdminBalance,
  searchGamificationAdminMembers,
  upsertGamificationCompletionPointRule,
  upsertGamificationCreationPointRule,
  updateGamificationLeaderboardConfig,
  updateMyGamificationLeaderboardPreference,
  updateGamificationStreakConfig,
  updateGamificationAchievement,
  updateGamificationBadge,
  updateGamificationLevel,
  updateGamificationReward,
  verifyGamificationResetEmailOtp,
  applyGamificationXpReconciliation,
  type GamificationAdminAction,
  type GamificationAdminAdjustmentOperation,
  type GamificationAdminEconomy,
  type GamificationAchievement,
  type GamificationAchievementCriterionType,
  type GamificationBadge,
  type GamificationBadgeAward,
  type GamificationLeaderboardConfig,
  type GamificationLeaderboardPreference,
  type GamificationLeaderboardPrivacyMode,
  type GamificationLeaderboardResponse,
  type GamificationPointCategory,
  type GamificationCompletionPointPreview,
  type GamificationPointManagement,
  type GamificationPointScopeType,
  type GamificationPointWorkType,
  type GamificationRewardDefinition,
  type GamificationRewardInventoryMode,
  type GamificationRewardPointSummary,
  type GamificationRewardRedemption,
  type GamificationStreakDay,
  type GamificationStreakSummary,
  type GamificationXpEntry,
  type GamificationXpEntryType,
  type GamificationXpSourceType,
  type GamificationXpControlLogEntry,
  type GamificationXpSourceBreakdown,
  type GamificationXpControlStatus,
  type GamificationXpLogCategory,
  type GamificationXpReconciliationPreview,
  type GamificationLevel,
  type GamificationXpSummary,
  getWorkspaceGamificationLeaderboard,
} from '../../../services/workspace-gamification';

const pageSize = 10;
const tabs = [
  'overview',
  'levels',
  'badges',
  'achievements',
  'streaks',
  'rewards',
  'leaderboard',
  'points',
  'xpControl',
  'admin',
  'history',
] as const;
const criterionTypes: GamificationAchievementCriterionType[] = [
  'XP_TOTAL_AT_LEAST',
  'TASK_COMPLETED_COUNT',
  'PROJECT_COMPLETED_COUNT',
  'TICKET_RESOLVED_COUNT',
];
type GamificationTab = (typeof tabs)[number];

const pointWorkTypes: GamificationPointWorkType[] = ['TASK', 'PROJECT', 'TICKET'];
const pointCategories: Record<GamificationPointWorkType, GamificationPointCategory[]> = {
  TASK: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'],
  PROJECT: ['MEDIUM', 'HIGH', 'LONG_TERM'],
  TICKET: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'],
};
const xpControlStatuses: Array<'ALL' | GamificationXpControlStatus> = [
  'ALL',
  'MISMATCH',
  'NEEDS_REVIEW',
  'RECONCILED',
  'BALANCED',
];
const xpLogCategories: GamificationXpLogCategory[] = [
  'ALL',
  'TASKS',
  'PROJECTS',
  'TICKETS',
  'ACHIEVEMENTS',
  'STREAKS',
  'MANUAL_ADJUSTMENTS',
  'RESETS',
  'RECONCILIATION',
  'LEGACY',
];

export function WorkspaceGamificationPage() {
  const { locale } = useLanguage();
  const accessToken = useSessionStore((state) => state.accessToken);
  const selectedWorkspaceId = useSessionStore((state) => state.selectedWorkspaceId);
  const selectedWorkspace = useSessionStore((state) =>
    state.agencies
      .flatMap((agency) => agency.workspaces)
      .find((workspace) => workspace.id === state.selectedWorkspaceId),
  );
  const [activeTab, setActiveTab] = useState<GamificationTab>('overview');
  const [page, setPage] = useState(1);

  useEffect(() => {
    setActiveTab('overview');
    setPage(1);
  }, [selectedWorkspaceId]);

  const rolesQuery = useQuery({
    queryKey: rolesKeys.all(selectedWorkspaceId),
    queryFn: () => listWorkspaceRoles(selectedWorkspaceId as string),
    enabled: Boolean(accessToken && selectedWorkspaceId),
  });
  const permissions = useMemo(() => {
    const role = rolesQuery.data?.find(
      (item) => item.id === selectedWorkspace?.role || item.key === selectedWorkspace?.role,
    );
    return new Set(role?.permissions.map((permission) => permission.key) ?? []);
  }, [rolesQuery.data, selectedWorkspace?.role]);
  const canView = permissions.has('*') || permissions.has('gamification.view');
  const canManageLevels = permissions.has('*') || permissions.has('gamification.levels.manage');
  const canManageAchievements =
    permissions.has('*') || permissions.has('gamification.achievements.manage');
  const canManageStreaks = permissions.has('*') || permissions.has('gamification.streaks.manage');
  const canRedeemRewards = permissions.has('*') || permissions.has('gamification.rewards.redeem');
  const canManageRewards = permissions.has('*') || permissions.has('gamification.rewards.manage');
  const canViewLeaderboards =
    permissions.has('*') || permissions.has('gamification.leaderboards.view');
  const canManageLeaderboards =
    permissions.has('*') || permissions.has('gamification.leaderboards.manage');
  const canManageAdjustments =
    permissions.has('*') || permissions.has('gamification.adjustments.manage');
  const canResetGamification = permissions.has('*') || permissions.has('gamification.reset');
  const canViewPoints = permissions.has('*') || permissions.has('gamification.points.view');
  const canManageWorkspacePoints =
    permissions.has('*') || permissions.has('gamification.points.manage_workspace');
  const canManageDepartmentPoints =
    permissions.has('*') || permissions.has('gamification.points.manage_department');
  const canUseAdminControls = canManageAdjustments || canResetGamification;
  const canManagePoints = canManageWorkspacePoints || canManageDepartmentPoints;
  const canUsePointManagement = canViewPoints || canManagePoints;
  const canViewXpControl = permissions.has('*') || permissions.has('gamification.xp_control.view');
  const canReconcileXpControl =
    permissions.has('*') || permissions.has('gamification.xp_control.reconcile');
  const canShowSelfTabs = !rolesQuery.isFetched || canView;
  const [pointDepartmentId, setPointDepartmentId] = useState<string | null>(null);
  const visibleTabs = useMemo(
    () =>
      tabs.filter((tab) =>
        tab === 'admin'
          ? canUseAdminControls
          : tab === 'points'
            ? canUsePointManagement
            : tab === 'xpControl'
              ? canViewXpControl
              : canShowSelfTabs,
      ),
    [canShowSelfTabs, canUseAdminControls, canUsePointManagement, canViewXpControl],
  );

  useEffect(() => {
    if (rolesQuery.isFetched && !canView && canViewXpControl) {
      setActiveTab('xpControl');
    } else if (rolesQuery.isFetched && !canView && canUseAdminControls) {
      setActiveTab('admin');
    } else if (rolesQuery.isFetched && !canView && canUsePointManagement) {
      setActiveTab('points');
    } else if (activeTab === 'admin' && !canUseAdminControls) {
      setActiveTab('overview');
    } else if (activeTab === 'xpControl' && !canViewXpControl) {
      setActiveTab('overview');
    } else if (activeTab === 'points' && !canUsePointManagement) {
      setActiveTab('overview');
    }
  }, [
    activeTab,
    canUseAdminControls,
    canUsePointManagement,
    canView,
    canViewXpControl,
    rolesQuery.isFetched,
  ]);

  const summaryQuery = useQuery({
    queryKey: gamificationKeys.summary(selectedWorkspaceId),
    queryFn: () => getMyGamificationXpSummary(selectedWorkspaceId as string),
    enabled: Boolean(accessToken && selectedWorkspaceId && canView),
  });
  const historyQuery = useQuery({
    queryKey: gamificationKeys.history(selectedWorkspaceId, { page, pageSize }),
    queryFn: () => getMyGamificationXpHistory(selectedWorkspaceId as string, { page, pageSize }),
    enabled: Boolean(accessToken && selectedWorkspaceId && canView && activeTab === 'history'),
  });
  const levelsQuery = useQuery({
    queryKey: gamificationKeys.levels(selectedWorkspaceId, canManageLevels),
    queryFn: () => listGamificationLevels(selectedWorkspaceId as string, canManageLevels),
    enabled: Boolean(accessToken && selectedWorkspaceId && canView && activeTab === 'levels'),
  });
  const badgesQuery = useQuery({
    queryKey: gamificationKeys.badges(selectedWorkspaceId, canManageAchievements),
    queryFn: () => listGamificationBadges(selectedWorkspaceId as string, canManageAchievements),
    enabled: Boolean(
      accessToken &&
      selectedWorkspaceId &&
      canView &&
      (activeTab === 'badges' || (activeTab === 'achievements' && canManageAchievements)),
    ),
  });
  const achievementsQuery = useQuery({
    queryKey: gamificationKeys.achievements(selectedWorkspaceId, canManageAchievements),
    queryFn: () =>
      listGamificationAchievements(selectedWorkspaceId as string, canManageAchievements),
    enabled: Boolean(accessToken && selectedWorkspaceId && canView && activeTab === 'achievements'),
  });
  const streakSummaryQuery = useQuery({
    queryKey: gamificationKeys.streakSummary(selectedWorkspaceId),
    queryFn: () => getMyGamificationStreakSummary(selectedWorkspaceId as string),
    enabled: Boolean(
      accessToken &&
      selectedWorkspaceId &&
      canView &&
      (activeTab === 'overview' || activeTab === 'streaks'),
    ),
  });
  const streakHistoryQuery = useQuery({
    queryKey: gamificationKeys.streakHistory(selectedWorkspaceId, { page, pageSize }),
    queryFn: () =>
      getMyGamificationStreakHistory(selectedWorkspaceId as string, { page, pageSize }),
    enabled: Boolean(accessToken && selectedWorkspaceId && canView && activeTab === 'streaks'),
  });
  const streakConfigQuery = useQuery({
    queryKey: gamificationKeys.streakConfig(selectedWorkspaceId),
    queryFn: () => getGamificationStreakConfig(selectedWorkspaceId as string),
    enabled: Boolean(accessToken && selectedWorkspaceId && canView && activeTab === 'streaks'),
  });
  const rewardPointSummaryQuery = useQuery({
    queryKey: gamificationKeys.rewardPointSummary(selectedWorkspaceId),
    queryFn: () => getMyGamificationRewardPointSummary(selectedWorkspaceId as string),
    enabled: Boolean(
      accessToken &&
      selectedWorkspaceId &&
      canView &&
      (activeTab === 'overview' || activeTab === 'rewards'),
    ),
  });
  const rewardsQuery = useQuery({
    queryKey: gamificationKeys.rewards(selectedWorkspaceId, {
      includeInactive: canManageRewards,
      page: 1,
      pageSize: 50,
    }),
    queryFn: () =>
      listGamificationRewards(selectedWorkspaceId as string, {
        includeInactive: canManageRewards,
        page: 1,
        pageSize: 50,
      }),
    enabled: Boolean(accessToken && selectedWorkspaceId && canView && activeTab === 'rewards'),
  });
  const myRewardRedemptionsQuery = useQuery({
    queryKey: gamificationKeys.myRewardRedemptions(selectedWorkspaceId, { page: 1, pageSize: 10 }),
    queryFn: () =>
      listMyGamificationRewardRedemptions(selectedWorkspaceId as string, { page: 1, pageSize: 10 }),
    enabled: Boolean(accessToken && selectedWorkspaceId && canView && activeTab === 'rewards'),
  });
  const rewardRedemptionsQuery = useQuery({
    queryKey: gamificationKeys.rewardRedemptions(selectedWorkspaceId, {
      status: 'PENDING',
      page: 1,
      pageSize: 10,
    }),
    queryFn: () =>
      listGamificationRewardRedemptions(selectedWorkspaceId as string, {
        status: 'PENDING',
        page: 1,
        pageSize: 10,
      }),
    enabled: Boolean(
      accessToken && selectedWorkspaceId && canView && canManageRewards && activeTab === 'rewards',
    ),
  });
  const leaderboardConfigQuery = useQuery({
    queryKey: gamificationKeys.leaderboardConfig(selectedWorkspaceId),
    queryFn: () => getGamificationLeaderboardConfig(selectedWorkspaceId as string),
    enabled: Boolean(
      accessToken && selectedWorkspaceId && canManageLeaderboards && activeTab === 'leaderboard',
    ),
  });
  const leaderboardPreferenceQuery = useQuery({
    queryKey: gamificationKeys.leaderboardPreference(selectedWorkspaceId),
    queryFn: () => getMyGamificationLeaderboardPreference(selectedWorkspaceId as string),
    enabled: Boolean(accessToken && selectedWorkspaceId && canView && activeTab === 'leaderboard'),
  });
  const workspaceLeaderboardQuery = useQuery({
    queryKey: gamificationKeys.workspaceLeaderboard(selectedWorkspaceId),
    queryFn: () => getWorkspaceGamificationLeaderboard(selectedWorkspaceId as string),
    enabled: Boolean(
      accessToken && selectedWorkspaceId && canViewLeaderboards && activeTab === 'leaderboard',
    ),
  });
  const departmentLeaderboardQuery = useQuery({
    queryKey: gamificationKeys.myDepartmentLeaderboard(selectedWorkspaceId),
    queryFn: () => getMyDepartmentGamificationLeaderboard(selectedWorkspaceId as string),
    enabled: Boolean(
      accessToken && selectedWorkspaceId && canViewLeaderboards && activeTab === 'leaderboard',
    ),
  });
  const pointManagementQuery = useQuery({
    queryKey: gamificationKeys.pointRules(selectedWorkspaceId, pointDepartmentId),
    queryFn: () => getGamificationPointManagement(selectedWorkspaceId as string, pointDepartmentId),
    enabled: Boolean(
      accessToken && selectedWorkspaceId && canUsePointManagement && activeTab === 'points',
    ),
  });

  if (!selectedWorkspaceId) {
    return (
      <EmptyState
        title={t(locale, 'states.permissionDenied')}
        description={t(locale, 'states.permissionDeniedDescription')}
      />
    );
  }
  if (
    rolesQuery.isFetched &&
    !canView &&
    !canUseAdminControls &&
    !canUsePointManagement &&
    !canViewXpControl
  ) {
    return (
      <EmptyState
        title={t(locale, 'states.permissionDenied')}
        description={t(locale, 'states.permissionDeniedDescription')}
      />
    );
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold tracking-normal">
            {t(locale, 'gamification.title')}
          </h1>
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t(locale, 'gamification.description')}
        </p>
      </header>

      <nav
        role="tablist"
        aria-label={t(locale, 'gamification.tabs')}
        className="flex gap-2 overflow-x-auto border-b pb-2"
      >
        {visibleTabs.map((tab) => (
          <button
            key={tab}
            id={`gamification-tab-${tab}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls={`gamification-panel-${tab}`}
            tabIndex={activeTab === tab ? 0 : -1}
            className={[
              'whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors',
              activeTab === tab ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
            ].join(' ')}
            onClick={() => {
              setActiveTab(tab);
              setPage(1);
            }}
          >
            {tab === 'overview'
              ? t(locale, 'gamification.overview')
              : tab === 'levels'
                ? t(locale, 'gamification.levels')
                : tab === 'badges'
                  ? t(locale, 'gamification.badges')
                  : tab === 'achievements'
                    ? t(locale, 'gamification.achievements')
                    : tab === 'streaks'
                      ? t(locale, 'gamification.streaks')
                      : tab === 'rewards'
                        ? t(locale, 'gamification.rewards')
                        : tab === 'leaderboard'
                          ? t(locale, 'gamification.leaderboard')
                          : tab === 'points'
                            ? t(locale, 'gamification.points')
                            : tab === 'xpControl'
                              ? t(locale, 'gamification.xpControlCenter')
                              : tab === 'admin'
                                ? t(locale, 'gamification.admin')
                                : t(locale, 'gamification.history')}
          </button>
        ))}
      </nav>

      <div
        id={`gamification-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`gamification-tab-${activeTab}`}
      >
        {activeTab === 'overview' ? (
          <OverviewPanel
            summary={summaryQuery.data}
            rewardPointSummary={rewardPointSummaryQuery.data}
            streakSummary={streakSummaryQuery.data}
            isLoading={
              summaryQuery.isLoading || rewardPointSummaryQuery.isLoading || rolesQuery.isLoading
            }
            isError={summaryQuery.isError || rewardPointSummaryQuery.isError}
          />
        ) : activeTab === 'levels' ? (
          <LevelsPanel
            workspaceId={selectedWorkspaceId}
            items={levelsQuery.data?.items ?? []}
            canManageLevels={canManageLevels}
            isLoading={levelsQuery.isLoading}
            isError={levelsQuery.isError}
          />
        ) : activeTab === 'badges' ? (
          <BadgesPanel
            workspaceId={selectedWorkspaceId}
            items={badgesQuery.data?.items ?? []}
            earned={badgesQuery.data?.earned ?? []}
            canManage={canManageAchievements}
            isLoading={badgesQuery.isLoading}
            isError={badgesQuery.isError}
          />
        ) : activeTab === 'achievements' ? (
          <AchievementsPanel
            workspaceId={selectedWorkspaceId}
            items={achievementsQuery.data?.items ?? []}
            badges={badgesQuery.data?.items ?? []}
            canManage={canManageAchievements}
            isLoading={achievementsQuery.isLoading}
            isError={achievementsQuery.isError}
          />
        ) : activeTab === 'streaks' ? (
          <StreaksPanel
            workspaceId={selectedWorkspaceId}
            summary={streakSummaryQuery.data}
            config={streakConfigQuery.data ?? streakSummaryQuery.data?.config}
            history={streakHistoryQuery.data?.items ?? []}
            page={streakHistoryQuery.data?.page ?? page}
            pageSize={streakHistoryQuery.data?.pageSize ?? pageSize}
            total={streakHistoryQuery.data?.total ?? 0}
            canManage={canManageStreaks}
            isLoading={streakSummaryQuery.isLoading || streakConfigQuery.isLoading}
            isError={streakSummaryQuery.isError || streakConfigQuery.isError}
            onPageChange={setPage}
          />
        ) : activeTab === 'rewards' ? (
          <RewardsPanel
            workspaceId={selectedWorkspaceId}
            summary={rewardPointSummaryQuery.data}
            rewards={rewardsQuery.data?.items ?? []}
            myRedemptions={myRewardRedemptionsQuery.data?.items ?? []}
            pendingRedemptions={rewardRedemptionsQuery.data?.items ?? []}
            canRedeem={canRedeemRewards}
            canManage={canManageRewards}
            isLoading={
              rewardPointSummaryQuery.isLoading ||
              rewardsQuery.isLoading ||
              myRewardRedemptionsQuery.isLoading ||
              rewardRedemptionsQuery.isLoading
            }
            isError={
              rewardPointSummaryQuery.isError ||
              rewardsQuery.isError ||
              myRewardRedemptionsQuery.isError ||
              rewardRedemptionsQuery.isError
            }
          />
        ) : activeTab === 'leaderboard' ? (
          <LeaderboardPanel
            workspaceId={selectedWorkspaceId}
            workspaceLeaderboard={workspaceLeaderboardQuery.data}
            departmentLeaderboard={departmentLeaderboardQuery.data}
            config={leaderboardConfigQuery.data ?? workspaceLeaderboardQuery.data?.config}
            preference={
              leaderboardPreferenceQuery.data ??
              workspaceLeaderboardQuery.data?.me ??
              departmentLeaderboardQuery.data?.me
            }
            canView={canViewLeaderboards}
            canManage={canManageLeaderboards}
            isLoading={
              workspaceLeaderboardQuery.isLoading ||
              departmentLeaderboardQuery.isLoading ||
              leaderboardPreferenceQuery.isLoading ||
              leaderboardConfigQuery.isLoading
            }
            isError={
              workspaceLeaderboardQuery.isError ||
              departmentLeaderboardQuery.isError ||
              leaderboardPreferenceQuery.isError ||
              leaderboardConfigQuery.isError
            }
          />
        ) : activeTab === 'points' ? (
          <PointManagementPanel
            workspaceId={selectedWorkspaceId}
            data={pointManagementQuery.data}
            selectedDepartmentId={pointDepartmentId}
            canManageWorkspace={canManageWorkspacePoints}
            canManageDepartment={canManageDepartmentPoints}
            isLoading={pointManagementQuery.isLoading}
            isError={pointManagementQuery.isError}
            onDepartmentChange={setPointDepartmentId}
          />
        ) : activeTab === 'xpControl' ? (
          <XpControlPanel workspaceId={selectedWorkspaceId} canReconcile={canReconcileXpControl} />
        ) : activeTab === 'admin' ? (
          <AdminControlsPanel
            workspaceId={selectedWorkspaceId}
            canAdjust={canManageAdjustments}
            canReset={canResetGamification}
          />
        ) : (
          <HistoryPanel
            items={historyQuery.data?.items ?? []}
            page={historyQuery.data?.page ?? page}
            pageSize={historyQuery.data?.pageSize ?? pageSize}
            total={historyQuery.data?.total ?? 0}
            isLoading={historyQuery.isLoading}
            isError={historyQuery.isError}
            onPageChange={setPage}
          />
        )}
      </div>
    </section>
  );
}

function PointManagementPanel({
  workspaceId,
  data,
  selectedDepartmentId,
  canManageWorkspace,
  canManageDepartment,
  isLoading,
  isError,
  onDepartmentChange,
}: {
  workspaceId: string;
  data?: GamificationPointManagement;
  selectedDepartmentId: string | null;
  canManageWorkspace: boolean;
  canManageDepartment: boolean;
  isLoading: boolean;
  isError: boolean;
  onDepartmentChange: (departmentId: string | null) => void;
}) {
  const { locale } = useLanguage();
  const queryClient = useQueryClient();
  const [scopeType, setScopeType] = useState<GamificationPointScopeType>('WORKSPACE');
  const [completion, setCompletion] = useState({
    workType: 'TASK' as GamificationPointWorkType,
    category: 'MEDIUM' as GamificationPointCategory,
    baseXp: 25,
    earlyBonusXp: 0,
    earlyThresholdMinutes: '',
    latePenaltyPercent: 0,
    penaltyIntervalMinutes: '',
    maxPenaltyXp: 0,
    isEnabled: true,
  });
  const [creation, setCreation] = useState({
    workType: 'TASK' as GamificationPointWorkType,
    category: 'MEDIUM' as GamificationPointCategory,
    roleId: '',
    creationXp: 0,
    isEnabled: true,
  });
  const [preview, setPreview] = useState({
    completedAt: '',
    dueAt: '',
    result: null as GamificationCompletionPointPreview | null,
  });
  const canSubmitWorkspace = scopeType === 'WORKSPACE' && canManageWorkspace;
  const canSubmitDepartment =
    scopeType === 'DEPARTMENT' &&
    Boolean(selectedDepartmentId) &&
    (canManageWorkspace || canManageDepartment);
  const canSubmit = canSubmitWorkspace || canSubmitDepartment;
  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: gamificationKeys.pointRulesForWorkspace(workspaceId),
    });
  const completionMutation = useMutation({
    mutationFn: () =>
      upsertGamificationCompletionPointRule(workspaceId, {
        scopeType,
        departmentId: scopeType === 'DEPARTMENT' ? selectedDepartmentId : null,
        workType: completion.workType,
        category: completion.category,
        isEnabled: completion.isEnabled,
        baseXp: Number(completion.baseXp),
        earlyBonusXp: Number(completion.earlyBonusXp),
        earlyThresholdMinutes: completion.earlyThresholdMinutes
          ? Number(completion.earlyThresholdMinutes)
          : null,
        latePenaltyPercent: Number(completion.latePenaltyPercent),
        penaltyIntervalMinutes: completion.penaltyIntervalMinutes
          ? Number(completion.penaltyIntervalMinutes)
          : null,
        maxPenaltyXp: Number(completion.maxPenaltyXp),
      }),
    onSuccess: invalidate,
  });
  const creationMutation = useMutation({
    mutationFn: () =>
      upsertGamificationCreationPointRule(workspaceId, {
        scopeType,
        departmentId: scopeType === 'DEPARTMENT' ? selectedDepartmentId : null,
        workType: creation.workType,
        category: creation.category,
        roleId: creation.roleId,
        isEnabled: creation.isEnabled,
        creationXp: Number(creation.creationXp),
      }),
    onSuccess: invalidate,
  });
  const previewMutation = useMutation({
    mutationFn: () =>
      previewGamificationCompletionPoints(workspaceId, {
        isEnabled: completion.isEnabled,
        baseXp: Number(completion.baseXp),
        earlyBonusXp: Number(completion.earlyBonusXp),
        earlyThresholdMinutes: completion.earlyThresholdMinutes
          ? Number(completion.earlyThresholdMinutes)
          : null,
        latePenaltyPercent: Number(completion.latePenaltyPercent),
        penaltyIntervalMinutes: completion.penaltyIntervalMinutes
          ? Number(completion.penaltyIntervalMinutes)
          : null,
        maxPenaltyXp: Number(completion.maxPenaltyXp),
        completedAt: localDateTimeToIso(preview.completedAt),
        dueAt: preview.dueAt ? localDateTimeToIso(preview.dueAt) : null,
      }),
    onSuccess: (result) => setPreview((value) => ({ ...value, result })),
  });

  useEffect(() => {
    if (!creation.roleId && data?.roles[0]) {
      setCreation((value) => ({ ...value, roleId: data.roles[0]!.id }));
    }
  }, [creation.roleId, data?.roles]);

  useEffect(() => {
    if (!pointCategories[completion.workType].includes(completion.category)) {
      setCompletion((value) => ({ ...value, category: pointCategories[value.workType][0]! }));
    }
    if (!pointCategories[creation.workType].includes(creation.category)) {
      setCreation((value) => ({ ...value, category: pointCategories[value.workType][0]! }));
    }
  }, [completion.workType, completion.category, creation.workType, creation.category]);

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (isError) return <EmptyState title={t(locale, 'gamification.unableToLoadPoints')} />;
  const effectiveCompletion = data?.effectiveCompletionRules ?? [];
  const effectiveCreation = data?.effectiveCreationRules ?? [];
  const selectedDepartmentName =
    data?.departments.find((department) => department.id === selectedDepartmentId)?.name ?? null;
  return (
    <div className="space-y-5">
      <div className="grid gap-3 rounded-md border p-4 md:grid-cols-3">
        <label className="grid gap-1 text-sm font-medium">
          {t(locale, 'gamification.scope')}
          <select
            className="rounded-md border bg-background px-3 py-2 text-sm"
            value={scopeType}
            onChange={(event) => setScopeType(event.target.value as GamificationPointScopeType)}
          >
            <option value="WORKSPACE">{t(locale, 'gamification.workspaceDefault')}</option>
            <option value="DEPARTMENT">{t(locale, 'gamification.departmentOverride')}</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium md:col-span-2">
          {t(locale, 'gamification.department')}
          <select
            className="rounded-md border bg-background px-3 py-2 text-sm"
            value={selectedDepartmentId ?? ''}
            onChange={(event) => onDepartmentChange(event.target.value || null)}
          >
            <option value="">{t(locale, 'gamification.workspaceDefault')}</option>
            {data?.departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <form
          className="space-y-3 rounded-md border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            completionMutation.mutate();
          }}
        >
          <h2 className="text-lg font-semibold">{t(locale, 'gamification.completionXp')}</h2>
          <PointRuleSelectors
            workType={completion.workType}
            category={completion.category}
            onWorkTypeChange={(workType) =>
              setCompletion((value) => ({
                ...value,
                workType,
                category: pointCategories[workType][0]!,
              }))
            }
            onCategoryChange={(category) => setCompletion((value) => ({ ...value, category }))}
            locale={locale}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <NumberField
              label={t(locale, 'gamification.baseXp')}
              value={completion.baseXp}
              onChange={(baseXp) =>
                setCompletion((value) => ({ ...value, baseXp: Number(baseXp) }))
              }
            />
            <NumberField
              label={t(locale, 'gamification.earlyBonus')}
              value={completion.earlyBonusXp}
              onChange={(earlyBonusXp) =>
                setCompletion((value) => ({ ...value, earlyBonusXp: Number(earlyBonusXp) }))
              }
            />
            <NumberField
              label={t(locale, 'gamification.earlyThreshold')}
              value={completion.earlyThresholdMinutes}
              onChange={(earlyThresholdMinutes) =>
                setCompletion((value) => ({ ...value, earlyThresholdMinutes }))
              }
            />
            <NumberField
              label={t(locale, 'gamification.latePenalty')}
              value={completion.latePenaltyPercent}
              onChange={(latePenaltyPercent) =>
                setCompletion((value) => ({
                  ...value,
                  latePenaltyPercent: Number(latePenaltyPercent),
                }))
              }
            />
            <NumberField
              label={t(locale, 'gamification.penaltyInterval')}
              value={completion.penaltyIntervalMinutes}
              onChange={(penaltyIntervalMinutes) =>
                setCompletion((value) => ({ ...value, penaltyIntervalMinutes }))
              }
            />
            <NumberField
              label={t(locale, 'gamification.maxPenalty')}
              value={completion.maxPenaltyXp}
              onChange={(maxPenaltyXp) =>
                setCompletion((value) => ({ ...value, maxPenaltyXp: Number(maxPenaltyXp) }))
              }
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={completion.isEnabled}
              onChange={(event) =>
                setCompletion((value) => ({ ...value, isEnabled: event.target.checked }))
              }
            />
            {t(locale, 'gamification.enabled')}
          </label>
          <Button type="submit" disabled={!canSubmit || completionMutation.isPending}>
            {t(locale, 'gamification.savePointRule')}
          </Button>
        </form>

        <form
          className="space-y-3 rounded-md border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            creationMutation.mutate();
          }}
        >
          <h2 className="text-lg font-semibold">{t(locale, 'gamification.creationXp')}</h2>
          <PointRuleSelectors
            workType={creation.workType}
            category={creation.category}
            onWorkTypeChange={(workType) =>
              setCreation((value) => ({
                ...value,
                workType,
                category: pointCategories[workType][0]!,
              }))
            }
            onCategoryChange={(category) => setCreation((value) => ({ ...value, category }))}
            locale={locale}
          />
          <label className="grid gap-1 text-sm font-medium">
            {t(locale, 'gamification.role')}
            <select
              className="rounded-md border bg-background px-3 py-2 text-sm"
              value={creation.roleId}
              onChange={(event) =>
                setCreation((value) => ({ ...value, roleId: event.target.value }))
              }
            >
              {data?.roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </label>
          <NumberField
            label={t(locale, 'gamification.creationXp')}
            value={creation.creationXp}
            onChange={(creationXp) =>
              setCreation((value) => ({ ...value, creationXp: Number(creationXp) }))
            }
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={creation.isEnabled}
              onChange={(event) =>
                setCreation((value) => ({ ...value, isEnabled: event.target.checked }))
              }
            />
            {t(locale, 'gamification.enabled')}
          </label>
          <Button
            type="submit"
            disabled={!canSubmit || !creation.roleId || creationMutation.isPending}
          >
            {t(locale, 'gamification.savePointRule')}
          </Button>
        </form>
      </div>

      <section className="grid gap-4 rounded-md border p-4 lg:grid-cols-[1fr_1fr]">
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            previewMutation.mutate();
          }}
        >
          <h2 className="sm:col-span-2 text-lg font-semibold">
            {t(locale, 'gamification.pointPreview')}
          </h2>
          <label className="grid gap-1 text-sm font-medium">
            {t(locale, 'gamification.completedAt')}
            <input
              className="rounded-md border bg-background px-3 py-2 text-sm"
              type="datetime-local"
              value={preview.completedAt}
              onChange={(event) =>
                setPreview((value) => ({
                  ...value,
                  completedAt: event.target.value,
                  result: null,
                }))
              }
              required
            />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            {t(locale, 'gamification.dueAt')}
            <input
              className="rounded-md border bg-background px-3 py-2 text-sm"
              type="datetime-local"
              value={preview.dueAt}
              onChange={(event) =>
                setPreview((value) => ({ ...value, dueAt: event.target.value, result: null }))
              }
            />
          </label>
          <Button
            type="submit"
            className="sm:col-span-2"
            disabled={!preview.completedAt || previewMutation.isPending}
          >
            {t(locale, 'gamification.previewXp')}
          </Button>
        </form>
        <div className="grid gap-3 sm:grid-cols-2">
          <PreviewStat
            label={t(locale, 'gamification.baseXp')}
            value={preview.result?.baseXp ?? 0}
          />
          <PreviewStat
            label={t(locale, 'gamification.bonusXp')}
            value={preview.result?.earlyBonusXp ?? 0}
          />
          <PreviewStat
            label={t(locale, 'gamification.penaltyXp')}
            value={preview.result?.penaltyXp ?? 0}
          />
          <PreviewStat
            label={t(locale, 'gamification.estimatedXp')}
            value={preview.result?.netCompletionXp ?? 0}
          />
          <PreviewStat
            label={t(locale, 'gamification.timingState')}
            value={
              preview.result
                ? timingLabel(preview.result.timing)
                : t(locale, 'gamification.notConfigured')
            }
          />
          <PreviewStat
            label={t(locale, 'gamification.ruleSource')}
            value={previewSourceLabel(completion, effectiveCompletion)}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          {selectedDepartmentName ?? t(locale, 'gamification.workspaceDefault')}
        </h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {effectiveCompletion.map((item) => (
            <div key={`${item.workType}-${item.category}`} className="rounded-md border p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">
                    {workTypeLabel(item.workType)} / {categoryLabel(item.category)}
                  </p>
                  <p className="text-xs text-muted-foreground">{sourceLabel(item.source)}</p>
                </div>
                <span className="rounded-md bg-muted px-2 py-1 text-xs">
                  {item.rule?.isEnabled
                    ? t(locale, 'gamification.enabled')
                    : item.rule
                      ? t(locale, 'gamification.disabled')
                      : t(locale, 'gamification.notConfigured')}
                </span>
              </div>
              <p className="mt-3 text-sm">
                {item.rule
                  ? `${item.rule.baseXp} XP / +${item.rule.earlyBonusXp} / -${item.rule.maxPenaltyXp}`
                  : t(locale, 'gamification.notConfigured')}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="overflow-x-auto rounded-md border">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="px-3 py-2">{t(locale, 'gamification.role')}</th>
              <th className="px-3 py-2">{t(locale, 'gamification.rule')}</th>
              <th className="px-3 py-2">XP</th>
              <th className="px-3 py-2">{t(locale, 'gamification.source')}</th>
            </tr>
          </thead>
          <tbody>
            {effectiveCreation.slice(0, 24).map((item) => {
              const role = data?.roles.find((entry) => entry.id === item.roleId);
              return (
                <tr key={`${item.roleId}-${item.workType}-${item.category}`} className="border-t">
                  <td className="px-3 py-2">{role?.name ?? item.roleId}</td>
                  <td className="px-3 py-2">
                    {workTypeLabel(item.workType)} / {categoryLabel(item.category)}
                  </td>
                  <td className="px-3 py-2">{item.rule?.isEnabled ? item.rule.creationXp : 0}</td>
                  <td className="px-3 py-2">{sourceLabel(item.source)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function PointRuleSelectors({
  workType,
  category,
  onWorkTypeChange,
  onCategoryChange,
  locale,
}: {
  workType: GamificationPointWorkType;
  category: GamificationPointCategory;
  onWorkTypeChange: (workType: GamificationPointWorkType) => void;
  onCategoryChange: (category: GamificationPointCategory) => void;
  locale: Locale;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1 text-sm font-medium">
        {t(locale, 'gamification.workType')}
        <select
          className="rounded-md border bg-background px-3 py-2 text-sm"
          value={workType}
          onChange={(event) => onWorkTypeChange(event.target.value as GamificationPointWorkType)}
        >
          {pointWorkTypes.map((value) => (
            <option key={value} value={value}>
              {workTypeLabel(value)}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm font-medium">
        {t(locale, 'gamification.category')}
        <select
          className="rounded-md border bg-background px-3 py-2 text-sm"
          value={category}
          onChange={(event) => onCategoryChange(event.target.value as GamificationPointCategory)}
        >
          {pointCategories[workType].map((value) => (
            <option key={value} value={value}>
              {categoryLabel(value)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-sm font-medium">
      {label}
      <input
        className="rounded-md border bg-background px-3 py-2 text-sm"
        type="number"
        min="0"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function workTypeLabel(value: GamificationPointWorkType) {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

function categoryLabel(value: GamificationPointCategory) {
  if (value === 'URGENT') return 'Emergency';
  if (value === 'LONG_TERM') return 'Long Term';
  return value.charAt(0) + value.slice(1).toLowerCase();
}

function sourceLabel(value: string) {
  if (value === 'DEPARTMENT_OVERRIDE') return 'Department override';
  if (value === 'WORKSPACE_DEFAULT') return 'Workspace default';
  return 'Not configured';
}

function PreviewStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function timingLabel(value: GamificationCompletionPointPreview['timing']) {
  if (value === 'NO_DEADLINE') return 'No deadline';
  if (value === 'ON_TIME') return 'On time';
  return value.charAt(0) + value.slice(1).toLowerCase();
}

function previewSourceLabel(
  completion: { workType: GamificationPointWorkType; category: GamificationPointCategory },
  effectiveCompletion: Array<{
    workType: GamificationPointWorkType;
    category: GamificationPointCategory;
    source: string;
  }>,
) {
  const source =
    effectiveCompletion.find(
      (item) => item.workType === completion.workType && item.category === completion.category,
    )?.source ?? 'NOT_CONFIGURED';
  return sourceLabel(source);
}

function localDateTimeToIso(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString();
}

function OverviewPanel({
  summary,
  rewardPointSummary,
  streakSummary,
  isLoading,
  isError,
}: {
  summary: GamificationXpSummary | undefined;
  rewardPointSummary: GamificationRewardPointSummary | undefined;
  streakSummary: GamificationStreakSummary | undefined;
  isLoading: boolean;
  isError: boolean;
}) {
  const { locale } = useLanguage();
  if (isLoading) return <Skeleton className="h-32 w-full" />;
  if (isError) return <EmptyState title={t(locale, 'gamification.unableToLoad')} />;
  const data = summary ?? {
    currentXp: 0,
    lifetimeEarnedXp: 0,
    lifetimeDeductedXp: 0,
    entryCount: 0,
    lastXpChangeAt: null,
    levelsConfigured: false,
    currentLevel: null,
    nextLevel: null,
    xpIntoCurrentLevel: null,
    xpToNextLevel: null,
    progressPercent: null,
    isMaxLevel: false,
    earnedAchievementCount: 0,
    earnedBadgeCount: 0,
  };
  return (
    <div className="space-y-4">
      <LevelProgress summary={data} />
      <div className="grid gap-4 md:grid-cols-3">
        <XpCard label={t(locale, 'gamification.currentXp')} value={`${data.currentXp} XP`} />
        <XpCard
          label={t(locale, 'gamification.lifetimeEarned')}
          value={`${data.lifetimeEarnedXp} XP`}
        />
        <XpCard
          label={t(locale, 'gamification.lifetimeDeducted')}
          value={`${data.lifetimeDeductedXp} XP`}
        />
        <XpCard
          label={t(locale, 'gamification.currentRewardPoints')}
          value={`${rewardPointSummary?.currentRewardPoints ?? 0} RP`}
        />
        <XpCard label={t(locale, 'gamification.entryCount')} value={String(data.entryCount)} />
        <XpCard
          label={t(locale, 'gamification.earnedAchievements')}
          value={String(data.earnedAchievementCount)}
        />
        <XpCard
          label={t(locale, 'gamification.earnedBadges')}
          value={String(data.earnedBadgeCount)}
        />
        <XpCard
          label={t(locale, 'gamification.currentStreak')}
          value={`${streakSummary?.currentStreak ?? 0} ${t(locale, 'gamification.days')}`}
        />
        <XpCard
          label={t(locale, 'gamification.longestStreak')}
          value={`${streakSummary?.longestStreak ?? 0} ${t(locale, 'gamification.days')}`}
        />
        <XpCard
          label={t(locale, 'gamification.today')}
          value={
            streakSummary?.qualifiedToday
              ? t(locale, 'gamification.qualifiedToday')
              : streakSummary?.needsActionToday
                ? t(locale, 'gamification.needsActionToday')
                : t(locale, 'gamification.noStreakToday')
          }
        />
        <XpCard
          label={t(locale, 'gamification.lastChange')}
          value={
            data.lastXpChangeAt
              ? formatDate(data.lastXpChangeAt)
              : t(locale, 'gamification.noXpActivity')
          }
        />
      </div>
    </div>
  );
}

function LevelProgress({ summary }: { summary: GamificationXpSummary }) {
  const { locale } = useLanguage();
  if (!summary.levelsConfigured) {
    return (
      <div className="rounded-md border bg-card p-4">
        <p className="text-sm text-muted-foreground">{t(locale, 'gamification.currentLevel')}</p>
        <p className="mt-2 text-xl font-semibold tracking-normal">
          {t(locale, 'gamification.noLevelsConfigured')}
        </p>
      </div>
    );
  }
  const current = summary.currentLevel;
  const progress = summary.progressPercent ?? 0;
  return (
    <div className="rounded-md border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{t(locale, 'gamification.currentLevel')}</p>
          <p className="mt-1 text-2xl font-semibold tracking-normal">
            {current ? levelLabel(current) : t(locale, 'gamification.noLevelsConfigured')}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {summary.isMaxLevel
              ? t(locale, 'gamification.maxLevelReached')
              : summary.nextLevel
                ? `${summary.xpToNextLevel ?? 0} XP ${t(locale, 'gamification.toNextLevel')}: ${levelLabel(summary.nextLevel)}`
                : t(locale, 'gamification.noLevelsConfigured')}
          </p>
        </div>
        <span className="text-sm font-medium">{progress}%</span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        className="mt-4 h-3 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}

function XpCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 break-words text-2xl font-semibold tracking-normal">{value}</p>
    </div>
  );
}

function LevelsPanel({
  workspaceId,
  items,
  canManageLevels,
  isLoading,
  isError,
}: {
  workspaceId: string;
  items: GamificationLevel[];
  canManageLevels: boolean;
  isLoading: boolean;
  isError: boolean;
}) {
  const { locale } = useLanguage();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: '', levelNumber: '', xpThreshold: '', description: '' });
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: gamificationKeys.all(workspaceId) }),
    ]);
  };
  const createMutation = useMutation({
    mutationFn: () =>
      createGamificationLevel(workspaceId, {
        name: form.name,
        levelNumber: Number(form.levelNumber),
        xpThreshold: Number(form.xpThreshold),
        description: form.description || null,
      }),
    onSuccess: async () => {
      setForm({ name: '', levelNumber: '', xpThreshold: '', description: '' });
      await invalidate();
    },
  });
  const updateMutation = useMutation({
    mutationFn: ({ levelId, isActive }: { levelId: string; isActive: boolean }) =>
      updateGamificationLevel(workspaceId, levelId, { isActive }),
    onSuccess: invalidate,
  });

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (isError) return <EmptyState title={t(locale, 'gamification.unableToLoadLevels')} />;

  return (
    <div className="space-y-4">
      {canManageLevels ? (
        <form
          className="grid gap-3 rounded-md border bg-card p-4 md:grid-cols-5"
          onSubmit={(event) => {
            event.preventDefault();
            createMutation.mutate();
          }}
        >
          <label className="space-y-1 md:col-span-1">
            <span className="text-sm font-medium">{t(locale, 'gamification.levelName')}</span>
            <input
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={form.name}
              maxLength={80}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              required
            />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium">{t(locale, 'gamification.levelNumber')}</span>
            <input
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              type="number"
              min={1}
              max={1000}
              value={form.levelNumber}
              onChange={(event) =>
                setForm((current) => ({ ...current, levelNumber: event.target.value }))
              }
              required
            />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium">{t(locale, 'gamification.xpThreshold')}</span>
            <input
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              type="number"
              min={0}
              max={1_000_000_000}
              value={form.xpThreshold}
              onChange={(event) =>
                setForm((current) => ({ ...current, xpThreshold: event.target.value }))
              }
              required
            />
          </label>
          <label className="space-y-1 md:col-span-1">
            <span className="text-sm font-medium">
              {t(locale, 'gamification.descriptionField')}
            </span>
            <input
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={form.description}
              maxLength={500}
              onChange={(event) =>
                setForm((current) => ({ ...current, description: event.target.value }))
              }
            />
          </label>
          <div className="flex items-end">
            <Button type="submit" disabled={createMutation.isPending}>
              {t(locale, 'gamification.createLevel')}
            </Button>
          </div>
          {createMutation.isError ? (
            <p className="text-sm text-destructive md:col-span-5">
              {t(locale, 'gamification.levelSaveFailed')}
            </p>
          ) : null}
        </form>
      ) : null}

      {items.length === 0 ? (
        <EmptyState title={t(locale, 'gamification.noLevelsConfigured')} />
      ) : (
        <div className="grid gap-3">
          {items.map((level) => (
            <article key={level.id} className="rounded-md border bg-card p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-semibold">{levelLabel(level)}</p>
                  <p className="text-sm text-muted-foreground">
                    {level.xpThreshold} XP
                    {level.description ? ` / ${level.description}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md border px-2 py-1 text-xs">
                    {level.isActive
                      ? t(locale, 'gamification.activeLevel')
                      : t(locale, 'gamification.inactiveLevel')}
                  </span>
                  {canManageLevels ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={updateMutation.isPending}
                      onClick={() =>
                        updateMutation.mutate({ levelId: level.id, isActive: !level.isActive })
                      }
                    >
                      {level.isActive
                        ? t(locale, 'gamification.archiveLevel')
                        : t(locale, 'gamification.reactivateLevel')}
                    </Button>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function BadgesPanel({
  workspaceId,
  items,
  earned,
  canManage,
  isLoading,
  isError,
}: {
  workspaceId: string;
  items: GamificationBadge[];
  earned: GamificationBadgeAward[];
  canManage: boolean;
  isLoading: boolean;
  isError: boolean;
}) {
  const { locale } = useLanguage();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: '', description: '', iconKey: '' });
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: gamificationKeys.badges(workspaceId, canManage) }),
      queryClient.invalidateQueries({ queryKey: gamificationKeys.summary(workspaceId) }),
    ]);
  };
  const createMutation = useMutation({
    mutationFn: () =>
      createGamificationBadge(workspaceId, {
        name: form.name,
        description: form.description || null,
        iconKey: form.iconKey || null,
      }),
    onSuccess: async () => {
      setForm({ name: '', description: '', iconKey: '' });
      await invalidate();
    },
  });
  const updateMutation = useMutation({
    mutationFn: ({ badgeId, isActive }: { badgeId: string; isActive: boolean }) =>
      updateGamificationBadge(workspaceId, badgeId, { isActive }),
    onSuccess: invalidate,
  });
  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (isError) return <EmptyState title={t(locale, 'gamification.unableToLoadBadges')} />;
  return (
    <div className="space-y-4">
      {canManage ? (
        <form
          className="grid gap-3 rounded-md border bg-card p-4 md:grid-cols-4"
          onSubmit={(event) => {
            event.preventDefault();
            createMutation.mutate();
          }}
        >
          <DefinitionInput
            label={t(locale, 'gamification.badgeName')}
            value={form.name}
            required
            onChange={(name) => setForm((current) => ({ ...current, name }))}
          />
          <DefinitionInput
            label={t(locale, 'gamification.badgeDescription')}
            value={form.description}
            onChange={(description) => setForm((current) => ({ ...current, description }))}
          />
          <DefinitionInput
            label={t(locale, 'gamification.badgeIcon')}
            value={form.iconKey}
            onChange={(iconKey) => setForm((current) => ({ ...current, iconKey }))}
          />
          <div className="flex items-end">
            <Button type="submit" disabled={createMutation.isPending}>
              {t(locale, 'gamification.createBadge')}
            </Button>
          </div>
        </form>
      ) : null}
      {earned.length === 0 ? (
        <EmptyState title={t(locale, 'gamification.noBadgesEarned')} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {earned.map((award) => (
            <BadgeTile key={award.id} name={award.badgeNameSnapshot} earnedAt={award.earnedAt} />
          ))}
        </div>
      )}
      {canManage && items.length > 0 ? (
        <div className="grid gap-3">
          {items.map((badge) => (
            <article key={badge.id} className="rounded-md border bg-card p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold">{badge.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {badge.description || t(locale, 'gamification.badge')}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={updateMutation.isPending}
                  onClick={() =>
                    updateMutation.mutate({ badgeId: badge.id, isActive: !badge.isActive })
                  }
                >
                  {badge.isActive
                    ? t(locale, 'gamification.archiveBadge')
                    : t(locale, 'gamification.reactivateBadge')}
                </Button>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AchievementsPanel({
  workspaceId,
  items,
  badges,
  canManage,
  isLoading,
  isError,
}: {
  workspaceId: string;
  items: GamificationAchievement[];
  badges: GamificationBadge[];
  canManage: boolean;
  isLoading: boolean;
  isError: boolean;
}) {
  const { locale } = useLanguage();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: '',
    description: '',
    criterionType: 'XP_TOTAL_AT_LEAST' as GamificationAchievementCriterionType,
    criterionValue: '',
    badgeDefinitionId: '',
    xpReward: '0',
    rewardPointsReward: '0',
  });
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: gamificationKeys.achievements(workspaceId, canManage),
      }),
      queryClient.invalidateQueries({ queryKey: gamificationKeys.summary(workspaceId) }),
    ]);
  };
  const createMutation = useMutation({
    mutationFn: () =>
      createGamificationAchievement(workspaceId, {
        name: form.name,
        description: form.description || null,
        criterionType: form.criterionType,
        criterionValue: Number(form.criterionValue),
        badgeDefinitionId: form.badgeDefinitionId || null,
        xpReward: Number(form.xpReward || 0),
        rewardPointsReward: Number(form.rewardPointsReward || 0),
      }),
    onSuccess: async () => {
      setForm({
        name: '',
        description: '',
        criterionType: 'XP_TOTAL_AT_LEAST',
        criterionValue: '',
        badgeDefinitionId: '',
        xpReward: '0',
        rewardPointsReward: '0',
      });
      await invalidate();
    },
  });
  const updateMutation = useMutation({
    mutationFn: ({ achievementId, isActive }: { achievementId: string; isActive: boolean }) =>
      updateGamificationAchievement(workspaceId, achievementId, { isActive }),
    onSuccess: invalidate,
  });
  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (isError) return <EmptyState title={t(locale, 'gamification.unableToLoadAchievements')} />;
  return (
    <div className="space-y-4">
      {canManage ? (
        <form
          className="grid gap-3 rounded-md border bg-card p-4 lg:grid-cols-6"
          onSubmit={(event) => {
            event.preventDefault();
            createMutation.mutate();
          }}
        >
          <DefinitionInput
            label={t(locale, 'gamification.achievementName')}
            value={form.name}
            required
            onChange={(name) => setForm((current) => ({ ...current, name }))}
          />
          <label className="space-y-1">
            <span className="text-sm font-medium">{t(locale, 'gamification.criterion')}</span>
            <select
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={form.criterionType}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  criterionType: event.target.value as GamificationAchievementCriterionType,
                }))
              }
            >
              {criterionTypes.map((type) => (
                <option key={type} value={type}>
                  {criterionLabel(locale, type)}
                </option>
              ))}
            </select>
          </label>
          <DefinitionInput
            label={t(locale, 'gamification.target')}
            value={form.criterionValue}
            type="number"
            required
            onChange={(criterionValue) => setForm((current) => ({ ...current, criterionValue }))}
          />
          <label className="space-y-1">
            <span className="text-sm font-medium">{t(locale, 'gamification.badge')}</span>
            <select
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={form.badgeDefinitionId}
              onChange={(event) =>
                setForm((current) => ({ ...current, badgeDefinitionId: event.target.value }))
              }
            >
              <option value="">{t(locale, 'gamification.noBadge')}</option>
              {badges
                .filter((badge) => badge.isActive)
                .map((badge) => (
                  <option key={badge.id} value={badge.id}>
                    {badge.name}
                  </option>
                ))}
            </select>
          </label>
          <DefinitionInput
            label={t(locale, 'gamification.xpReward')}
            value={form.xpReward}
            type="number"
            onChange={(xpReward) => setForm((current) => ({ ...current, xpReward }))}
          />
          <DefinitionInput
            label={t(locale, 'gamification.rewardPointsReward')}
            value={form.rewardPointsReward}
            type="number"
            onChange={(rewardPointsReward) =>
              setForm((current) => ({ ...current, rewardPointsReward }))
            }
          />
          <div className="flex items-end">
            <Button type="submit" disabled={createMutation.isPending}>
              {t(locale, 'gamification.createAchievement')}
            </Button>
          </div>
        </form>
      ) : null}
      {items.length === 0 ? (
        <EmptyState title={t(locale, 'gamification.noAchievements')} />
      ) : (
        <div className="grid gap-3">
          {items.map((item) => (
            <article key={item.id} className="rounded-md border bg-card p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-semibold">{item.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {item.description || criterionLabel(locale, item.criterionType)}
                  </p>
                  <p className="mt-2 text-sm">
                    {item.earned
                      ? `${t(locale, 'gamification.earned')} ${item.earnedAt ? formatDate(item.earnedAt) : ''}`
                      : `${t(locale, 'gamification.inProgress')}: ${item.progress.currentValue} / ${item.progress.targetValue}`}
                  </p>
                  <div
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={item.progress.percent}
                    className="mt-3 h-2 overflow-hidden rounded-full bg-muted"
                  >
                    <div
                      className="h-full bg-primary"
                      style={{ width: `${item.progress.percent}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {item.badgeDefinition
                      ? `${t(locale, 'gamification.badge')}: ${item.badgeDefinition.name}`
                      : t(locale, 'gamification.noBadge')}{' '}
                    /{' '}
                    {item.xpReward > 0
                      ? `${item.xpReward} ${t(locale, 'gamification.xpReward')}`
                      : t(locale, 'gamification.noXpReward')}{' '}
                    /{' '}
                    {item.rewardPointsReward > 0
                      ? `${item.rewardPointsReward} ${t(locale, 'gamification.rewardPoints')}`
                      : t(locale, 'gamification.noRewardPointsReward')}
                  </p>
                </div>
                {canManage ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={updateMutation.isPending}
                    onClick={() =>
                      updateMutation.mutate({
                        achievementId: item.id,
                        isActive: !item.isActive,
                      })
                    }
                  >
                    {item.isActive
                      ? t(locale, 'gamification.archiveAchievement')
                      : t(locale, 'gamification.reactivateAchievement')}
                  </Button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function BadgeTile({ name, earnedAt }: { name: string; earnedAt: string }) {
  const { locale } = useLanguage();
  return (
    <article className="rounded-md border bg-card p-4">
      <p className="font-semibold">{name}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {t(locale, 'gamification.earnedOn')} {formatDate(earnedAt)}
      </p>
    </article>
  );
}

function DefinitionInput({
  label,
  value,
  onChange,
  required,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="space-y-1">
      <span className="text-sm font-medium">{label}</span>
      <input
        className="h-10 w-full rounded-md border bg-background px-3 text-sm"
        type={type}
        min={type === 'number' ? 0 : undefined}
        value={value}
        maxLength={type === 'number' ? undefined : 80}
        required={required}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function StreaksPanel({
  workspaceId,
  summary,
  config,
  history,
  page,
  pageSize,
  total,
  canManage,
  isLoading,
  isError,
  onPageChange,
}: {
  workspaceId: string;
  summary: GamificationStreakSummary | undefined;
  config: GamificationStreakSummary['config'] | undefined;
  history: GamificationStreakDay[];
  page: number;
  pageSize: number;
  total: number;
  canManage: boolean;
  isLoading: boolean;
  isError: boolean;
  onPageChange: (page: number) => void;
}) {
  const { locale } = useLanguage();
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(false);
  const [dailyXpReward, setDailyXpReward] = useState('0');
  const [dailyRewardPoints, setDailyRewardPoints] = useState('0');
  useEffect(() => {
    setEnabled(config?.enabled ?? false);
    setDailyXpReward(String(config?.dailyXpReward ?? 0));
    setDailyRewardPoints(String(config?.dailyRewardPoints ?? 0));
  }, [config?.enabled, config?.dailyXpReward, config?.dailyRewardPoints]);
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: gamificationKeys.streakSummary(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: gamificationKeys.streakConfig(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: gamificationKeys.summary(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: gamificationKeys.rewardPointSummary(workspaceId) }),
    ]);
  };
  const updateMutation = useMutation({
    mutationFn: () =>
      updateGamificationStreakConfig(workspaceId, {
        enabled,
        dailyXpReward: Number(dailyXpReward || 0),
        dailyRewardPoints: Number(dailyRewardPoints || 0),
      }),
    onSuccess: invalidate,
  });
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (isError) return <EmptyState title={t(locale, 'gamification.unableToLoadStreaks')} />;
  const data = summary;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-4">
        <XpCard
          label={t(locale, 'gamification.currentStreak')}
          value={`${data?.currentStreak ?? 0} ${t(locale, 'gamification.days')}`}
        />
        <XpCard
          label={t(locale, 'gamification.longestStreak')}
          value={`${data?.longestStreak ?? 0} ${t(locale, 'gamification.days')}`}
        />
        <XpCard
          label={t(locale, 'gamification.today')}
          value={
            data?.qualifiedToday
              ? t(locale, 'gamification.qualifiedToday')
              : data?.needsActionToday
                ? t(locale, 'gamification.needsActionToday')
                : t(locale, 'gamification.noStreakToday')
          }
        />
        <XpCard
          label={t(locale, 'gamification.dailyXpReward')}
          value={`+${config?.dailyXpReward ?? 0} XP`}
        />
        <XpCard
          label={t(locale, 'gamification.dailyRewardPoints')}
          value={`+${config?.dailyRewardPoints ?? 0} RP`}
        />
      </div>
      <div className="rounded-md border bg-card p-4">
        <p className="text-sm text-muted-foreground">{t(locale, 'gamification.streakStatus')}</p>
        <p className="mt-1 font-medium">
          {config?.enabled
            ? t(locale, 'gamification.streaksEnabled')
            : t(locale, 'gamification.streaksDisabled')}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(locale, 'gamification.timezone')}: {data?.timezone ?? 'UTC'} /{' '}
          {t(locale, 'gamification.lastQualifiedDate')}: {data?.lastQualifiedDate ?? '-'}
        </p>
      </div>
      {canManage ? (
        <form
          className="grid gap-3 rounded-md border bg-card p-4 sm:grid-cols-4"
          onSubmit={(event) => {
            event.preventDefault();
            updateMutation.mutate();
          }}
        >
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            {t(locale, 'gamification.enableStreaks')}
          </label>
          <DefinitionInput
            label={t(locale, 'gamification.dailyXpReward')}
            value={dailyXpReward}
            type="number"
            onChange={setDailyXpReward}
          />
          <DefinitionInput
            label={t(locale, 'gamification.dailyRewardPoints')}
            value={dailyRewardPoints}
            type="number"
            onChange={setDailyRewardPoints}
          />
          <div className="flex items-end">
            <Button type="submit" disabled={updateMutation.isPending}>
              {t(locale, 'gamification.saveStreakSettings')}
            </Button>
          </div>
        </form>
      ) : null}
      {history.length === 0 ? (
        <EmptyState title={t(locale, 'gamification.noStreakDays')} />
      ) : (
        <div className="space-y-3">
          {history.map((day) => (
            <article key={day.id} className="rounded-md border bg-card p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-medium">{formatLocalDate(day.localDate)}</p>
                  <p className="text-sm text-muted-foreground">
                    {streakQualificationLabel(locale, day.qualificationType)} /{' '}
                    {day.dailyXpRewardSnapshot > 0
                      ? `+${day.dailyXpRewardSnapshot} XP`
                      : t(locale, 'gamification.noXpReward')}{' '}
                    /{' '}
                    {day.dailyRewardPointsSnapshot > 0
                      ? `+${day.dailyRewardPointsSnapshot} RP`
                      : t(locale, 'gamification.noRewardPointsReward')}
                  </p>
                </div>
                <time className="text-sm text-muted-foreground">{formatDate(day.qualifiedAt)}</time>
              </div>
            </article>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {t(locale, 'gamification.page')} {page} / {pageCount}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={page <= 1}
                onClick={() => onPageChange(Math.max(1, page - 1))}
              >
                {t(locale, 'gamification.previous')}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={page >= pageCount}
                onClick={() => onPageChange(Math.min(pageCount, page + 1))}
              >
                {t(locale, 'gamification.next')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RewardsPanel({
  workspaceId,
  summary,
  rewards,
  myRedemptions,
  pendingRedemptions,
  canRedeem,
  canManage,
  isLoading,
  isError,
}: {
  workspaceId: string;
  summary: GamificationRewardPointSummary | undefined;
  rewards: GamificationRewardDefinition[];
  myRedemptions: GamificationRewardRedemption[];
  pendingRedemptions: GamificationRewardRedemption[];
  canRedeem: boolean;
  canManage: boolean;
  isLoading: boolean;
  isError: boolean;
}) {
  const { locale } = useLanguage();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: '',
    description: '',
    pointsCost: '',
    inventoryMode: 'UNLIMITED' as GamificationRewardInventoryMode,
    availableQuantity: '',
  });
  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: gamificationKeys.all(workspaceId) });
  };
  const createMutation = useMutation({
    mutationFn: () =>
      createGamificationReward(workspaceId, {
        name: form.name,
        description: form.description || null,
        pointsCost: Number(form.pointsCost),
        inventoryMode: form.inventoryMode,
        availableQuantity:
          form.inventoryMode === 'LIMITED' ? Number(form.availableQuantity || 0) : null,
      }),
    onSuccess: async () => {
      setForm({
        name: '',
        description: '',
        pointsCost: '',
        inventoryMode: 'UNLIMITED',
        availableQuantity: '',
      });
      await invalidate();
    },
  });
  const redeemMutation = useMutation({
    mutationFn: (rewardId: string) => redeemGamificationReward(workspaceId, rewardId),
    onSuccess: invalidate,
  });
  const updateMutation = useMutation({
    mutationFn: ({ rewardId, isActive }: { rewardId: string; isActive: boolean }) =>
      updateGamificationReward(workspaceId, rewardId, { isActive }),
    onSuccess: invalidate,
  });
  const fulfillMutation = useMutation({
    mutationFn: (redemptionId: string) =>
      fulfillGamificationRewardRedemption(workspaceId, redemptionId),
    onSuccess: invalidate,
  });
  const cancelMutation = useMutation({
    mutationFn: (redemptionId: string) =>
      cancelGamificationRewardRedemption(
        workspaceId,
        redemptionId,
        t(locale, 'gamification.managerCancelled'),
      ),
    onSuccess: invalidate,
  });
  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (isError) return <EmptyState title={t(locale, 'gamification.unableToLoadRewards')} />;
  const currentRewardPoints = summary?.currentRewardPoints ?? 0;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-4">
        <XpCard
          label={t(locale, 'gamification.currentRewardPoints')}
          value={`${currentRewardPoints} RP`}
        />
        <XpCard
          label={t(locale, 'gamification.lifetimeEarnedRewardPoints')}
          value={`${summary?.lifetimeEarnedRewardPoints ?? 0} RP`}
        />
        <XpCard
          label={t(locale, 'gamification.lifetimeSpentRewardPoints')}
          value={`${summary?.lifetimeSpentRewardPoints ?? 0} RP`}
        />
        <XpCard
          label={t(locale, 'gamification.lifetimeRefundedRewardPoints')}
          value={`${summary?.lifetimeRefundedRewardPoints ?? 0} RP`}
        />
      </div>
      {canManage ? (
        <form
          className="grid gap-3 rounded-md border bg-card p-4 lg:grid-cols-6"
          onSubmit={(event) => {
            event.preventDefault();
            createMutation.mutate();
          }}
        >
          <DefinitionInput
            label={t(locale, 'gamification.rewardName')}
            value={form.name}
            required
            onChange={(name) => setForm((current) => ({ ...current, name }))}
          />
          <DefinitionInput
            label={t(locale, 'gamification.rewardDescription')}
            value={form.description}
            onChange={(description) => setForm((current) => ({ ...current, description }))}
          />
          <DefinitionInput
            label={t(locale, 'gamification.rewardPointsCost')}
            value={form.pointsCost}
            type="number"
            required
            onChange={(pointsCost) => setForm((current) => ({ ...current, pointsCost }))}
          />
          <label className="space-y-1">
            <span className="text-sm font-medium">{t(locale, 'gamification.inventory')}</span>
            <select
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={form.inventoryMode}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  inventoryMode: event.target.value as GamificationRewardInventoryMode,
                }))
              }
            >
              <option value="UNLIMITED">{t(locale, 'gamification.unlimited')}</option>
              <option value="LIMITED">{t(locale, 'gamification.limited')}</option>
            </select>
          </label>
          <DefinitionInput
            label={t(locale, 'gamification.availableQuantity')}
            value={form.availableQuantity}
            type="number"
            onChange={(availableQuantity) =>
              setForm((current) => ({ ...current, availableQuantity }))
            }
          />
          <div className="flex items-end">
            <Button type="submit" disabled={createMutation.isPending}>
              {t(locale, 'gamification.createReward')}
            </Button>
          </div>
        </form>
      ) : null}
      {rewards.length === 0 ? (
        <EmptyState title={t(locale, 'gamification.noRewards')} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rewards.map((reward) => {
            const outOfStock =
              reward.inventoryMode === 'LIMITED' && (reward.availableQuantity ?? 0) <= 0;
            return (
              <article key={reward.id} className="rounded-md border bg-card p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-semibold">{reward.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {reward.description || t(locale, 'gamification.reward')}
                    </p>
                    <p className="mt-2 text-sm">
                      {reward.pointsCost} {t(locale, 'gamification.rewardPoints')} /{' '}
                      {reward.inventoryMode === 'LIMITED'
                        ? `${reward.availableQuantity ?? 0} ${t(locale, 'gamification.available')}`
                        : t(locale, 'gamification.unlimited')}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {canRedeem && reward.isActive ? (
                      <Button
                        type="button"
                        disabled={
                          redeemMutation.isPending ||
                          outOfStock ||
                          currentRewardPoints < reward.pointsCost
                        }
                        onClick={() => redeemMutation.mutate(reward.id)}
                      >
                        {t(locale, 'gamification.redeem')}
                      </Button>
                    ) : null}
                    {canManage ? (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={updateMutation.isPending}
                        onClick={() =>
                          updateMutation.mutate({
                            rewardId: reward.id,
                            isActive: !reward.isActive,
                          })
                        }
                      >
                        {reward.isActive
                          ? t(locale, 'gamification.archiveReward')
                          : t(locale, 'gamification.reactivateReward')}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-normal">
          {t(locale, 'gamification.myRedemptions')}
        </h2>
        {myRedemptions.length === 0 ? (
          <EmptyState title={t(locale, 'gamification.noRedemptions')} />
        ) : (
          <div className="grid gap-3">
            {myRedemptions.map((redemption) => (
              <RedemptionRow key={redemption.id} redemption={redemption} />
            ))}
          </div>
        )}
      </section>
      {canManage ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-normal">
            {t(locale, 'gamification.pendingRedemptions')}
          </h2>
          {pendingRedemptions.length === 0 ? (
            <EmptyState title={t(locale, 'gamification.noPendingRedemptions')} />
          ) : (
            <div className="grid gap-3">
              {pendingRedemptions.map((redemption) => (
                <RedemptionRow
                  key={redemption.id}
                  redemption={redemption}
                  actions={
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        disabled={fulfillMutation.isPending}
                        onClick={() => fulfillMutation.mutate(redemption.id)}
                      >
                        {t(locale, 'gamification.fulfill')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={cancelMutation.isPending}
                        onClick={() => cancelMutation.mutate(redemption.id)}
                      >
                        {t(locale, 'gamification.cancel')}
                      </Button>
                    </div>
                  }
                />
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

function RedemptionRow({
  redemption,
  actions,
}: {
  redemption: GamificationRewardRedemption;
  actions?: ReactNode;
}) {
  const { locale } = useLanguage();
  return (
    <article className="rounded-md border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-semibold">{redemption.rewardNameSnapshot}</p>
          <p className="text-sm text-muted-foreground">
            {redemption.pointsCostSnapshot} {t(locale, 'gamification.rewardPoints')} /{' '}
            {redemption.status}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(locale, 'gamification.requestedAt')} {formatDate(redemption.requestedAt)}
          </p>
        </div>
        {actions}
      </div>
    </article>
  );
}

function LeaderboardPanel({
  workspaceId,
  workspaceLeaderboard,
  departmentLeaderboard,
  config,
  preference,
  canView,
  canManage,
  isLoading,
  isError,
}: {
  workspaceId: string;
  workspaceLeaderboard: GamificationLeaderboardResponse | undefined;
  departmentLeaderboard: GamificationLeaderboardResponse | undefined;
  config: GamificationLeaderboardConfig | undefined;
  preference: Pick<GamificationLeaderboardPreference, 'privacyMode'> | undefined;
  canView: boolean;
  canManage: boolean;
  isLoading: boolean;
  isError: boolean;
}) {
  const { locale } = useLanguage();
  const queryClient = useQueryClient();
  const [privacyMode, setPrivacyMode] = useState<GamificationLeaderboardPrivacyMode>(
    preference?.privacyMode ?? 'ANONYMOUS',
  );
  const [enabled, setEnabled] = useState(false);
  const [workspaceEnabled, setWorkspaceEnabled] = useState(false);
  const [departmentEnabled, setDepartmentEnabled] = useState(false);

  useEffect(() => {
    setPrivacyMode(preference?.privacyMode ?? 'ANONYMOUS');
  }, [preference?.privacyMode]);
  useEffect(() => {
    setEnabled(config?.enabled ?? false);
    setWorkspaceEnabled(config?.workspaceLeaderboardEnabled ?? false);
    setDepartmentEnabled(config?.departmentLeaderboardEnabled ?? false);
  }, [config?.enabled, config?.workspaceLeaderboardEnabled, config?.departmentLeaderboardEnabled]);

  const privacyMutation = useMutation({
    mutationFn: () => updateMyGamificationLeaderboardPreference(workspaceId, privacyMode),
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: gamificationKeys.all(workspaceId) }),
  });
  const configMutation = useMutation({
    mutationFn: () =>
      updateGamificationLeaderboardConfig(workspaceId, {
        enabled,
        workspaceLeaderboardEnabled: workspaceEnabled,
        departmentLeaderboardEnabled: departmentEnabled,
      }),
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: gamificationKeys.all(workspaceId) }),
  });

  if (!canView) {
    return (
      <EmptyState
        title={t(locale, 'states.permissionDenied')}
        description={t(locale, 'states.permissionDeniedDescription')}
      />
    );
  }
  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (isError) return <EmptyState title={t(locale, 'gamification.unableToLoadLeaderboard')} />;

  return (
    <div className="space-y-6">
      <section className="rounded-md border bg-card p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <label className="grid gap-2 text-sm">
            <span className="font-medium">{t(locale, 'gamification.leaderboardPrivacy')}</span>
            <select
              className="rounded-md border bg-background px-3 py-2"
              value={privacyMode}
              onChange={(event) =>
                setPrivacyMode(event.target.value as GamificationLeaderboardPrivacyMode)
              }
            >
              <option value="ANONYMOUS">{t(locale, 'gamification.privacyAnonymous')}</option>
              <option value="SHOW_NAME">{t(locale, 'gamification.privacyShowName')}</option>
              <option value="SHOW_DISPLAY_NAME">
                {t(locale, 'gamification.privacyShowDisplayName')}
              </option>
              <option value="OPT_OUT">{t(locale, 'gamification.privacyOptOut')}</option>
            </select>
          </label>
          <Button
            type="button"
            disabled={privacyMutation.isPending || privacyMode === preference?.privacyMode}
            onClick={() => privacyMutation.mutate()}
          >
            {t(locale, 'gamification.savePrivacy')}
          </Button>
        </div>
      </section>

      {canManage ? (
        <section className="rounded-md border bg-card p-4">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
              />
              {t(locale, 'gamification.enableLeaderboards')}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={workspaceEnabled}
                onChange={(event) => setWorkspaceEnabled(event.target.checked)}
              />
              {t(locale, 'gamification.enableWorkspaceLeaderboard')}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={departmentEnabled}
                onChange={(event) => setDepartmentEnabled(event.target.checked)}
              />
              {t(locale, 'gamification.enableDepartmentLeaderboard')}
            </label>
          </div>
          <Button
            type="button"
            className="mt-4"
            disabled={configMutation.isPending}
            onClick={() => configMutation.mutate()}
          >
            {t(locale, 'gamification.saveLeaderboardConfig')}
          </Button>
        </section>
      ) : null}

      <LeaderboardScopeSection
        title={t(locale, 'gamification.workspaceLeaderboard')}
        leaderboard={workspaceLeaderboard}
      />
      <LeaderboardScopeSection
        title={t(locale, 'gamification.myDepartmentLeaderboard')}
        leaderboard={departmentLeaderboard}
      />
    </div>
  );
}

function LeaderboardScopeSection({
  title,
  leaderboard,
}: {
  title: string;
  leaderboard: GamificationLeaderboardResponse | undefined;
}) {
  const { locale } = useLanguage();
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{t(locale, 'gamification.allTimeXp')}</p>
      </div>
      {!leaderboard?.available ? (
        <EmptyState
          title={t(locale, 'gamification.leaderboardUnavailable')}
          description={leaderboard?.reason ?? t(locale, 'gamification.leaderboardDisabled')}
        />
      ) : (
        <div className="space-y-3">
          <YourPositionCard leaderboard={leaderboard} />
          <div className="overflow-x-auto rounded-md border">
            <table className="min-w-full divide-y text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-3 py-2">{t(locale, 'gamification.rank')}</th>
                  <th className="px-3 py-2">{t(locale, 'gamification.member')}</th>
                  <th className="px-3 py-2">{t(locale, 'gamification.currentXp')}</th>
                  <th className="px-3 py-2">{t(locale, 'gamification.currentLevel')}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {leaderboard.entries.map((entry) => (
                  <tr key={entry.key} className={entry.isCurrentUser ? 'bg-primary/10' : ''}>
                    <td className="px-3 py-2 font-medium">#{entry.rank}</td>
                    <td className="px-3 py-2">{entry.displayName}</td>
                    <td className="px-3 py-2">{entry.currentXp} XP</td>
                    <td className="px-3 py-2">
                      {entry.currentLevel ? levelLabel(entry.currentLevel) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function YourPositionCard({ leaderboard }: { leaderboard: GamificationLeaderboardResponse }) {
  const { locale } = useLanguage();
  const me = leaderboard.me;
  return (
    <div className="rounded-md border bg-card p-4">
      <p className="text-sm font-medium">{t(locale, 'gamification.yourPosition')}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {me.included && me.rank
          ? `#${me.rank} / ${me.currentXp ?? 0} XP`
          : t(locale, 'gamification.notIncluded')}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {t(locale, 'gamification.leaderboardPrivacy')}: {privacyLabel(locale, me.privacyMode)}
      </p>
    </div>
  );
}

function XpControlPanel({
  workspaceId,
  canReconcile,
}: {
  workspaceId: string;
  canReconcile: boolean;
}) {
  const { locale } = useLanguage();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'ALL' | GamificationXpControlStatus>('ALL');
  const [hasDelta, setHasDelta] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedMembershipId, setSelectedMembershipId] = useState<string | null>(null);
  const [logCategory, setLogCategory] = useState<GamificationXpLogCategory>('ALL');
  const [logPage, setLogPage] = useState(1);
  const [preview, setPreview] = useState<GamificationXpReconciliationPreview | null>(null);
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');

  const params = useMemo(
    () => ({
      page,
      pageSize,
      search: search.trim() || undefined,
      status: status === 'ALL' ? undefined : status,
      hasDelta: hasDelta ? true : undefined,
      sortBy: 'delta' as const,
      sortDirection: 'desc' as const,
    }),
    [hasDelta, page, search, status],
  );
  const analyzerQuery = useQuery({
    queryKey: gamificationKeys.xpControl(workspaceId, params),
    queryFn: () => listGamificationXpControl(workspaceId, params),
  });
  const detailQuery = useQuery({
    queryKey: gamificationKeys.xpControlDetail(workspaceId, selectedMembershipId),
    queryFn: () => getGamificationXpControlDetail(workspaceId, selectedMembershipId as string),
    enabled: Boolean(selectedMembershipId),
  });
  const logQuery = useQuery({
    queryKey: gamificationKeys.xpControlLog(
      workspaceId,
      selectedMembershipId,
      logCategory,
      logPage,
    ),
    queryFn: () =>
      listGamificationXpControlLog(workspaceId, selectedMembershipId as string, {
        category: logCategory,
        page: logPage,
        pageSize,
      }),
    enabled: Boolean(selectedMembershipId),
  });

  useEffect(() => {
    setSearch('');
    setStatus('ALL');
    setHasDelta(false);
    setPage(1);
    setSelectedMembershipId(null);
    setLogCategory('ALL');
    setLogPage(1);
    setPreview(null);
    setReason('');
    setConfirmation('');
  }, [workspaceId]);
  useEffect(() => {
    setPreview(null);
    setReason('');
    setConfirmation('');
    setLogPage(1);
  }, [selectedMembershipId]);

  const previewMutation = useMutation({
    mutationFn: () =>
      previewGamificationXpReconciliation(workspaceId, selectedMembershipId as string),
    onSuccess: (result) => setPreview(result),
  });
  const applyMutation = useMutation({
    mutationFn: () =>
      applyGamificationXpReconciliation(workspaceId, {
        targetMembershipId: preview?.targetMembershipId ?? '',
        previewToken: preview?.previewToken ?? '',
        reason,
        confirmation,
        idempotencyKey: createIdempotencyKey(),
      }),
    onSuccess: async () => {
      setPreview(null);
      setReason('');
      setConfirmation('');
      await queryClient.invalidateQueries({ queryKey: gamificationKeys.all(workspaceId) });
    },
    onError: (error) => {
      const message = getMutationErrorMessage(error) ?? '';
      if (message.includes('RECONCILIATION_STALE')) {
        setPreview(null);
        setConfirmation('');
      }
    },
  });

  const selectedRow =
    detailQuery.data?.member ??
    analyzerQuery.data?.items.find((item) => item.membershipId === selectedMembershipId) ??
    null;
  const pageCount = Math.max(1, Math.ceil((analyzerQuery.data?.total ?? 0) / pageSize));
  const logPageCount = Math.max(1, Math.ceil((logQuery.data?.total ?? 0) / pageSize));

  if (analyzerQuery.isLoading) return <Skeleton className="h-64 w-full" />;
  if (analyzerQuery.isError)
    return <EmptyState title={t(locale, 'gamification.unableToLoadXpControl')} />;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(20rem,0.9fr)]">
      <section className="space-y-3">
        <div className="grid gap-3 rounded-md border bg-card p-4 md:grid-cols-[1fr_auto_auto]">
          <label className="grid gap-1 text-sm font-medium">
            {t(locale, 'gamification.searchMembers')}
            <input
              className="h-10 rounded-md border bg-background px-3 text-sm"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            {t(locale, 'gamification.status')}
            <select
              className="h-10 rounded-md border bg-background px-3 text-sm"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as 'ALL' | GamificationXpControlStatus);
                setPage(1);
              }}
            >
              {xpControlStatuses.map((item) => (
                <option key={item} value={item}>
                  {item === 'ALL'
                    ? t(locale, 'gamification.allStatuses')
                    : xpControlStatusLabel(locale, item)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-end gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={hasDelta}
              onChange={(event) => {
                setHasDelta(event.target.checked);
                setPage(1);
              }}
            />
            {t(locale, 'gamification.onlyMismatches')}
          </label>
        </div>

        <div className="overflow-x-auto rounded-md border">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2">{t(locale, 'gamification.member')}</th>
                <th className="px-3 py-2" title={t(locale, 'gamification.claimedXpTooltip')}>
                  {t(locale, 'gamification.claimedXp')}
                </th>
                <th className="px-3 py-2" title={t(locale, 'gamification.storedXpTooltip')}>
                  {t(locale, 'gamification.storedXp')}
                </th>
                <th className="px-3 py-2" title={t(locale, 'gamification.currentXpTooltip')}>
                  {t(locale, 'gamification.currentXp')}
                </th>
                <th className="px-3 py-2">{t(locale, 'gamification.delta')}</th>
                <th className="px-3 py-2">{t(locale, 'gamification.status')}</th>
                <th className="px-3 py-2">{t(locale, 'gamification.action')}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(analyzerQuery.data?.items ?? []).map((row) => (
                <tr key={row.membershipId} className={row.delta !== 0 ? 'bg-destructive/5' : ''}>
                  <td className="px-3 py-2">
                    <p className="font-medium">{row.displayName}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.departmentName ?? t(locale, 'workspaceUsers.noDepartment')}
                    </p>
                  </td>
                  <td className="px-3 py-2">{row.claimedXp}</td>
                  <td className="px-3 py-2">{row.storedXp}</td>
                  <td className="px-3 py-2">{row.currentXp}</td>
                  <td
                    className={[
                      'px-3 py-2 font-medium',
                      row.delta === 0 ? '' : 'text-destructive',
                    ].join(' ')}
                  >
                    {formatXpAmount(row.delta)}
                  </td>
                  <td className="px-3 py-2">{xpControlStatusLabel(locale, row.status)}</td>
                  <td className="px-3 py-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setSelectedMembershipId(row.membershipId)}
                    >
                      {t(locale, 'gamification.inspect')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(analyzerQuery.data?.items ?? []).length === 0 ? (
          <EmptyState title={t(locale, 'gamification.noXpControlRows')} />
        ) : null}
        <Pager page={page} pageCount={pageCount} onPageChange={setPage} />
      </section>

      <aside className="space-y-4">
        {!selectedRow ? (
          <EmptyState title={t(locale, 'gamification.selectMember')} />
        ) : (
          <>
            <section className="space-y-3 rounded-md border bg-card p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold">{selectedRow.displayName}</h2>
                  <p className="text-sm text-muted-foreground">
                    {selectedRow.departmentName ?? t(locale, 'workspaceUsers.noDepartment')}
                  </p>
                </div>
                <span className="rounded-md border px-2 py-1 text-xs">
                  {xpControlStatusLabel(locale, selectedRow.status)}
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <AdminBalanceCard
                  label={t(locale, 'gamification.claimedXp')}
                  value={selectedRow.claimedXp}
                  suffix="XP"
                />
                <AdminBalanceCard
                  label={t(locale, 'gamification.storedXp')}
                  value={selectedRow.storedXp}
                  suffix="XP"
                />
                <AdminBalanceCard
                  label={t(locale, 'gamification.currentXp')}
                  value={selectedRow.currentXp}
                  suffix="XP"
                />
                <AdminBalanceCard
                  label={t(locale, 'gamification.delta')}
                  value={selectedRow.delta}
                  suffix="XP"
                />
              </div>
            </section>

            {detailQuery.data ? (
              <XpBreakdownCard detail={detailQuery.data.breakdown} />
            ) : (
              <Skeleton className="h-32 w-full" />
            )}

            {canReconcile && selectedRow.status === 'MISMATCH' ? (
              <section className="space-y-3 rounded-md border bg-card p-4">
                <h2 className="text-lg font-semibold">
                  {t(locale, 'gamification.reconciliation')}
                </h2>
                <Button
                  type="button"
                  variant="outline"
                  disabled={previewMutation.isPending}
                  onClick={() => previewMutation.mutate()}
                >
                  {t(locale, 'gamification.previewReconciliation')}
                </Button>
                {preview ? (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      {preview.proposedDirection} {preview.proposedCorrectionAmount} XP.{' '}
                      {t(locale, 'gamification.expectedCurrentXp')}: {preview.expectedCurrentXp}
                    </p>
                    <div className="grid gap-2 rounded-md border p-3 text-sm sm:grid-cols-2">
                      <span>
                        {t(locale, 'gamification.claimedXp')}: {preview.claimedXp}
                      </span>
                      <span>
                        {t(locale, 'gamification.storedXp')}: {preview.storedXp}
                      </span>
                      <span>
                        {t(locale, 'gamification.currentXp')}: {preview.currentXp}
                      </span>
                      <span>
                        {t(locale, 'gamification.delta')}: {formatXpAmount(preview.delta)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t(locale, 'gamification.reconciliationAppendOnly')}
                    </p>
                    <label className="grid gap-1 text-sm font-medium">
                      {t(locale, 'gamification.reason')}
                      <textarea
                        className="min-h-20 rounded-md border bg-background px-3 py-2 text-sm"
                        value={reason}
                        maxLength={500}
                        onChange={(event) => setReason(event.target.value)}
                      />
                    </label>
                    <label className="grid gap-1 text-sm font-medium">
                      {t(locale, 'gamification.confirmReconcile')}
                      <input
                        className="h-10 rounded-md border bg-background px-3 text-sm"
                        value={confirmation}
                        onChange={(event) => setConfirmation(event.target.value)}
                      />
                    </label>
                    <Button
                      type="button"
                      variant="danger"
                      disabled={
                        applyMutation.isPending || confirmation !== 'RECONCILE' || !reason.trim()
                      }
                      onClick={() => applyMutation.mutate()}
                    >
                      {t(locale, 'gamification.applyReconciliation')}
                    </Button>
                  </div>
                ) : null}
                {previewMutation.isError || applyMutation.isError ? (
                  <p className="text-sm text-destructive">
                    {getMutationErrorMessage(previewMutation.error ?? applyMutation.error) ??
                      t(locale, 'gamification.reconciliationFailed')}
                  </p>
                ) : null}
              </section>
            ) : null}

            <section className="space-y-3 rounded-md border bg-card p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <h2 className="text-lg font-semibold">{t(locale, 'gamification.xpLog')}</h2>
                <select
                  className="h-10 rounded-md border bg-background px-3 text-sm"
                  value={logCategory}
                  onChange={(event) => {
                    setLogCategory(event.target.value as GamificationXpLogCategory);
                    setLogPage(1);
                  }}
                >
                  {xpLogCategories.map((item) => (
                    <option key={item} value={item}>
                      {xpLogCategoryLabel(locale, item)}
                    </option>
                  ))}
                </select>
              </div>
              {logQuery.isLoading ? (
                <Skeleton className="h-28 w-full" />
              ) : (
                <XpLogList entries={logQuery.data?.items ?? []} />
              )}
              <Pager page={logPage} pageCount={logPageCount} onPageChange={setLogPage} />
            </section>
          </>
        )}
      </aside>
    </div>
  );
}

function XpBreakdownCard({ detail }: { detail: GamificationXpSourceBreakdown }) {
  const { locale } = useLanguage();
  const rows = [
    [t(locale, 'gamification.tasksCompleted'), detail.taskXp],
    [t(locale, 'gamification.projectsCompleted'), detail.projectXp],
    [t(locale, 'gamification.ticketsResolved'), detail.ticketXp],
    [t(locale, 'gamification.achievements'), detail.achievementXp],
    [t(locale, 'gamification.streaks'), detail.streakXp],
    [t(locale, 'gamification.adminAdjustments'), detail.manualXp],
    [t(locale, 'gamification.adminReset'), detail.resetXp],
    [t(locale, 'gamification.reconciliation'), detail.reconciliationXp],
    [t(locale, 'gamification.legacyXp'), detail.legacyXp],
  ];
  return (
    <section className="space-y-3 rounded-md border bg-card p-4">
      <h2 className="text-lg font-semibold">{t(locale, 'gamification.sourceBreakdown')}</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div
            key={String(label)}
            className="flex justify-between gap-3 rounded-md border px-3 py-2 text-sm"
          >
            <span>{label}</span>
            <span className="font-medium">{value} XP</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function XpLogList({ entries }: { entries: GamificationXpControlLogEntry[] }) {
  const { locale } = useLanguage();
  if (entries.length === 0)
    return (
      <p className="text-sm text-muted-foreground">{t(locale, 'gamification.noXpActivity')}</p>
    );
  return (
    <div className="space-y-2">
      {entries.map((entry) => (
        <article key={entry.id} className="rounded-md border p-3 text-sm">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
            <p className="font-medium">
              {formatXpAmount(entry.amount)} / {xpLogCategoryLabel(locale, entry.category)}
            </p>
            <time className="text-muted-foreground">{formatDate(entry.timestamp)}</time>
          </div>
          <p className="mt-1 text-muted-foreground">
            {entry.work?.sourceLabel ?? sourceEventLabel(locale, entry.sourceEvent)}
            {entry.reason ? ` / ${entry.reason}` : ''}
          </p>
        </article>
      ))}
    </div>
  );
}

function Pager({
  page,
  pageCount,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
}) {
  const { locale } = useLanguage();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">
        {t(locale, 'gamification.page')} {page} / {pageCount}
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          {t(locale, 'gamification.previous')}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          {t(locale, 'gamification.next')}
        </Button>
      </div>
    </div>
  );
}

function AdminControlsPanel({
  workspaceId,
  canAdjust,
  canReset,
}: {
  workspaceId: string;
  canAdjust: boolean;
  canReset: boolean;
}) {
  const { locale } = useLanguage();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedMembershipId, setSelectedMembershipId] = useState<string | null>(null);
  const [economy, setEconomy] = useState<GamificationAdminEconomy>('XP');
  const [operation, setOperation] = useState<GamificationAdminAdjustmentOperation>('ADD');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [resetReason, setResetReason] = useState('');
  const [resetConfirmation, setResetConfirmation] = useState('');
  const [stepUpPassword, setStepUpPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpChallenge, setOtpChallenge] = useState<{
    challengeId: string;
    economy: GamificationAdminEconomy;
    targetMembershipId: string;
    expiresAt: string;
    resendAvailableAt: string;
    maskedDestination: string;
  } | null>(null);
  const [stepUpGrant, setStepUpGrant] = useState<{
    id: string;
    economy: GamificationAdminEconomy;
    targetMembershipId: string;
    expiresAt: string;
  } | null>(null);

  const membersQuery = useQuery({
    queryKey: gamificationKeys.adminMembers(workspaceId, search),
    queryFn: () => searchGamificationAdminMembers(workspaceId, search),
    enabled: Boolean(canAdjust || canReset),
  });
  const balanceQuery = useQuery({
    queryKey: gamificationKeys.adminBalance(workspaceId, selectedMembershipId),
    queryFn: () => getGamificationAdminMemberBalance(workspaceId, selectedMembershipId as string),
    enabled: Boolean(selectedMembershipId && (canAdjust || canReset)),
  });
  const actionsQuery = useQuery({
    queryKey: gamificationKeys.adminActions(workspaceId),
    queryFn: () => listGamificationAdminActions(workspaceId),
    enabled: Boolean(canAdjust || canReset),
  });

  useEffect(() => {
    setSelectedMembershipId(null);
    setOtpChallenge(null);
    setOtpCode('');
    setStepUpGrant(null);
  }, [workspaceId]);

  useEffect(() => {
    setOtpChallenge(null);
    setOtpCode('');
    setStepUpGrant(null);
    setStepUpPassword('');
    setResetConfirmation('');
  }, [economy, selectedMembershipId]);

  const invalidateAdminState = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: gamificationKeys.all(workspaceId) }),
      queryClient.invalidateQueries({
        queryKey: gamificationKeys.adminBalance(workspaceId, selectedMembershipId),
      }),
      queryClient.invalidateQueries({ queryKey: gamificationKeys.adminActions(workspaceId) }),
    ]);
  };

  const adjustmentMutation = useMutation({
    mutationFn: () =>
      adjustGamificationAdminBalance(workspaceId, {
        targetMembershipId: selectedMembershipId as string,
        economy,
        operation,
        amount: Number(amount),
        reason,
        idempotencyKey: createIdempotencyKey(),
      }),
    onSuccess: async () => {
      setAmount('');
      setReason('');
      await invalidateAdminState();
    },
  });
  const stepUpMutation = useMutation({
    mutationFn: () =>
      createGamificationResetStepUpGrant(workspaceId, {
        targetMembershipId: selectedMembershipId as string,
        economy,
        password: stepUpPassword,
      }),
    onSuccess: (challenge) => {
      setOtpChallenge(challenge);
      setOtpCode('');
      setStepUpGrant(null);
      setStepUpPassword('');
    },
  });
  const otpVerifyMutation = useMutation({
    mutationFn: () => verifyGamificationResetEmailOtp(otpChallenge?.challengeId ?? '', otpCode),
    onSuccess: (grant) => {
      setStepUpGrant(grant);
      setOtpChallenge(null);
      setOtpCode('');
    },
  });
  const resetMutation = useMutation({
    mutationFn: () =>
      resetGamificationAdminBalance(workspaceId, {
        targetMembershipId: selectedMembershipId as string,
        economy,
        reason: resetReason,
        confirmation: resetConfirmation,
        stepUpGrantId: stepUpGrant?.id ?? '',
        idempotencyKey: createIdempotencyKey(),
      }),
    onSuccess: async () => {
      setResetReason('');
      setResetConfirmation('');
      setOtpChallenge(null);
      setOtpCode('');
      setStepUpGrant(null);
      await invalidateAdminState();
    },
  });

  const selectedMember =
    balanceQuery.data?.member ??
    membersQuery.data?.items.find((member) => member.membershipId === selectedMembershipId) ??
    null;
  const grantReady =
    stepUpGrant?.targetMembershipId === selectedMembershipId && stepUpGrant.economy === economy;
  const challengeReady =
    otpChallenge?.targetMembershipId === selectedMembershipId && otpChallenge.economy === economy;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(16rem,22rem)_1fr]">
      <section className="space-y-3 rounded-md border bg-card p-4">
        <label className="space-y-1">
          <span className="text-sm font-medium">{t(locale, 'gamification.searchMembers')}</span>
          <input
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        {membersQuery.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : membersQuery.isError ? (
          <EmptyState title={t(locale, 'gamification.unableToLoadAdmin')} />
        ) : (
          <div className="space-y-2">
            {(membersQuery.data?.items ?? []).map((member) => (
              <button
                key={member.membershipId}
                type="button"
                className={[
                  'w-full rounded-md border px-3 py-2 text-left text-sm transition-colors',
                  selectedMembershipId === member.membershipId
                    ? 'border-primary bg-primary/10'
                    : 'hover:bg-muted',
                ].join(' ')}
                onClick={() => setSelectedMembershipId(member.membershipId)}
              >
                <span className="block font-medium">{member.displayName}</span>
                <span className="block text-xs text-muted-foreground">
                  {member.departmentName ?? t(locale, 'workspaceUsers.noDepartment')}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <div className="space-y-4">
        {selectedMember ? (
          <section className="rounded-md border bg-card p-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold">{selectedMember.displayName}</h2>
                <p className="text-sm text-muted-foreground">
                  {selectedMember.departmentName ?? t(locale, 'workspaceUsers.noDepartment')}
                </p>
              </div>
              <span className="rounded-md border px-2 py-1 text-xs">{selectedMember.status}</span>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <AdminBalanceCard
                label={t(locale, 'gamification.currentXp')}
                value={balanceQuery.data?.balances.currentXp ?? 0}
                suffix="XP"
              />
              <AdminBalanceCard
                label={t(locale, 'gamification.currentRewardPoints')}
                value={balanceQuery.data?.balances.currentRewardPoints ?? 0}
                suffix="RP"
              />
            </div>
          </section>
        ) : (
          <EmptyState title={t(locale, 'gamification.selectMember')} />
        )}

        {canAdjust ? (
          <section className="space-y-3 rounded-md border bg-card p-4">
            <h2 className="text-lg font-semibold">{t(locale, 'gamification.adminAdjustments')}</h2>
            <div className="grid gap-3 md:grid-cols-4">
              <label className="space-y-1">
                <span className="text-sm font-medium">{t(locale, 'gamification.economy')}</span>
                <select
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={economy}
                  onChange={(event) => setEconomy(event.target.value as GamificationAdminEconomy)}
                >
                  <option value="XP">{t(locale, 'gamification.xp')}</option>
                  <option value="REWARD_POINTS">{t(locale, 'gamification.rewardPoints')}</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-sm font-medium">{t(locale, 'gamification.operation')}</span>
                <select
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={operation}
                  onChange={(event) =>
                    setOperation(event.target.value as GamificationAdminAdjustmentOperation)
                  }
                >
                  <option value="ADD">{t(locale, 'gamification.add')}</option>
                  <option value="DEDUCT">{t(locale, 'gamification.deduct')}</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-sm font-medium">{t(locale, 'gamification.amount')}</span>
                <input
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  type="number"
                  min={1}
                  max={1000000}
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </label>
              <div className="flex items-end">
                <Button
                  type="button"
                  disabled={
                    !selectedMembershipId ||
                    !reason.trim() ||
                    Number(amount) <= 0 ||
                    adjustmentMutation.isPending
                  }
                  onClick={() => adjustmentMutation.mutate()}
                >
                  {t(locale, 'gamification.applyAdjustment')}
                </Button>
              </div>
            </div>
            <label className="space-y-1">
              <span className="text-sm font-medium">{t(locale, 'gamification.reason')}</span>
              <textarea
                className="min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={reason}
                maxLength={500}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            {adjustmentMutation.isError ? (
              <p className="text-sm text-destructive">
                {t(locale, 'gamification.adminActionFailed')}
              </p>
            ) : null}
          </section>
        ) : null}

        {canReset ? (
          <section className="space-y-3 rounded-md border bg-card p-4">
            <h2 className="text-lg font-semibold">{t(locale, 'gamification.adminReset')}</h2>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="space-y-1">
                <span className="text-sm font-medium">{t(locale, 'gamification.economy')}</span>
                <select
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={economy}
                  onChange={(event) => setEconomy(event.target.value as GamificationAdminEconomy)}
                >
                  <option value="XP">{t(locale, 'gamification.xp')}</option>
                  <option value="REWARD_POINTS">{t(locale, 'gamification.rewardPoints')}</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-sm font-medium">
                  {t(locale, 'gamification.verifyIdentity')}
                </span>
                <input
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  type="password"
                  value={stepUpPassword}
                  onChange={(event) => setStepUpPassword(event.target.value)}
                />
              </label>
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="outline"
                  disabled={!selectedMembershipId || !stepUpPassword || stepUpMutation.isPending}
                  onClick={() => stepUpMutation.mutate()}
                >
                  Send code
                </Button>
              </div>
            </div>
            {challengeReady ? (
              <div className="space-y-2 rounded-md border p-3">
                <p className="text-sm text-muted-foreground">
                  Code sent to {otpChallenge.maskedDestination}. Expires{' '}
                  {formatDate(otpChallenge.expiresAt)}.
                </p>
                <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                  <label className="space-y-1">
                    <span className="text-sm font-medium">Verification code</span>
                    <input
                      className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      value={otpCode}
                      onChange={(event) =>
                        setOtpCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                      }
                    />
                  </label>
                  <div className="flex items-end">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={otpCode.length !== 6 || otpVerifyMutation.isPending}
                      onClick={() => otpVerifyMutation.mutate()}
                    >
                      Verify code
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1">
                <span className="text-sm font-medium">
                  {t(locale, 'gamification.confirmReset')}
                </span>
                <input
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={resetConfirmation}
                  onChange={(event) => setResetConfirmation(event.target.value)}
                />
              </label>
              <label className="space-y-1">
                <span className="text-sm font-medium">{t(locale, 'gamification.reason')}</span>
                <input
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  value={resetReason}
                  maxLength={500}
                  onChange={(event) => setResetReason(event.target.value)}
                />
              </label>
            </div>
            {grantReady ? (
              <p className="text-sm text-muted-foreground">
                {t(locale, 'gamification.stepUpReady')}: {formatDate(stepUpGrant.expiresAt)}
              </p>
            ) : null}
            <Button
              type="button"
              variant="danger"
              disabled={
                !selectedMembershipId ||
                !grantReady ||
                resetConfirmation !== 'RESET' ||
                !resetReason.trim() ||
                resetMutation.isPending
              }
              onClick={() => resetMutation.mutate()}
            >
              {t(locale, 'gamification.resetToZero')}
            </Button>
            {stepUpMutation.isError || otpVerifyMutation.isError || resetMutation.isError ? (
              <p className="text-sm text-destructive">
                {t(locale, 'gamification.adminActionFailed')}
              </p>
            ) : null}
          </section>
        ) : null}

        <AdminActionsList
          actions={actionsQuery.data?.items ?? []}
          isLoading={actionsQuery.isLoading}
        />
      </div>
    </div>
  );
}

function AdminBalanceCard({
  label,
  value,
  suffix,
}: {
  label: string;
  value: number;
  suffix: string;
}) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-normal">
        {value} {suffix}
      </p>
    </div>
  );
}

function AdminActionsList({
  actions,
  isLoading,
}: {
  actions: GamificationAdminAction[];
  isLoading: boolean;
}) {
  const { locale } = useLanguage();
  if (isLoading) return <Skeleton className="h-24 w-full" />;
  return (
    <section className="space-y-3 rounded-md border bg-card p-4">
      <h2 className="text-lg font-semibold">{t(locale, 'gamification.recentAdminActions')}</h2>
      {actions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(locale, 'gamification.noAdminActions')}</p>
      ) : (
        <div className="space-y-2">
          {actions.map((action) => (
            <article key={action.id} className="rounded-md border p-3 text-sm">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                <p className="font-medium">{adminActionLabel(locale, action.action)}</p>
                <time className="text-muted-foreground">{formatDate(action.createdAt)}</time>
              </div>
              <p className="mt-1 text-muted-foreground">
                {safeAdminMetadataValue(action.metadata.economy)}
                {safeAdminMetadataValue(action.metadata.amount)
                  ? ` / ${safeAdminMetadataValue(action.metadata.amount)}`
                  : ''}
                {action.metadata.reason ? ` / ${action.metadata.reason}` : ''}
              </p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function HistoryPanel({
  items,
  page,
  pageSize,
  total,
  isLoading,
  isError,
  onPageChange,
}: {
  items: GamificationXpEntry[];
  page: number;
  pageSize: number;
  total: number;
  isLoading: boolean;
  isError: boolean;
  onPageChange: (page: number) => void;
}) {
  const { locale } = useLanguage();
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (isError) return <EmptyState title={t(locale, 'gamification.unableToLoadHistory')} />;
  if (items.length === 0) return <EmptyState title={t(locale, 'gamification.noXpActivity')} />;
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {items.map((item) => (
          <article key={item.id} className="rounded-md border bg-card p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="font-medium">{formatXpAmount(item.amount)}</p>
                <p className="text-sm text-muted-foreground">
                  {entryTypeLabel(locale, item.entryType)} /{' '}
                  {sourceTypeLabel(locale, item.sourceType)}
                </p>
              </div>
              <time className="text-sm text-muted-foreground">{formatDate(item.createdAt)}</time>
            </div>
            <p className="mt-2 text-sm">
              {sourceEventLabel(locale, item.sourceEvent)}
              {item.reason ? ` - ${item.reason}` : ''}
            </p>
          </article>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {t(locale, 'gamification.page')} {page} / {pageCount}
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={page <= 1}
            onClick={() => onPageChange(Math.max(1, page - 1))}
          >
            {t(locale, 'gamification.previous')}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={page >= pageCount}
            onClick={() => onPageChange(Math.min(pageCount, page + 1))}
          >
            {t(locale, 'gamification.next')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function formatXpAmount(amount: number) {
  return `${amount > 0 ? '+' : ''}${amount} XP`;
}

function levelLabel(level: GamificationLevel) {
  return `Level ${level.levelNumber} - ${level.name}`;
}

function privacyLabel(locale: 'en' | 'ta', mode: GamificationLeaderboardPrivacyMode) {
  const labels = {
    SHOW_NAME: t(locale, 'gamification.privacyShowName'),
    SHOW_DISPLAY_NAME: t(locale, 'gamification.privacyShowDisplayName'),
    ANONYMOUS: t(locale, 'gamification.privacyAnonymous'),
    OPT_OUT: t(locale, 'gamification.privacyOptOut'),
  };
  return labels[mode];
}

function entryTypeLabel(locale: 'en' | 'ta', type: GamificationXpEntryType) {
  const labels = {
    EARN: t(locale, 'gamification.earnedXp'),
    DEDUCT: t(locale, 'gamification.xpDeduction'),
    REVERSAL: t(locale, 'gamification.xpReversal'),
    ADJUSTMENT: t(locale, 'gamification.xpAdjustment'),
  };
  return labels[type];
}

function sourceTypeLabel(locale: 'en' | 'ta', type: GamificationXpSourceType) {
  const labels = {
    TASK: t(locale, 'navigation.tasks'),
    PROJECT: t(locale, 'navigation.projects'),
    TICKET: t(locale, 'navigation.tickets'),
    STREAK: t(locale, 'gamification.xpChange'),
    ACHIEVEMENT: t(locale, 'gamification.xpChange'),
    MANUAL: t(locale, 'gamification.xpChange'),
    SYSTEM: t(locale, 'gamification.system'),
  };
  return labels[type];
}

function sourceEventLabel(locale: 'en' | 'ta', event: string) {
  const labels: Record<string, string> = {
    XP_REVERSAL: t(locale, 'gamification.xpReversal'),
    MANUAL_XP_ADJUSTMENT: t(locale, 'gamification.adminAdjustment'),
    MANUAL_REWARD_POINT_ADJUSTMENT: t(locale, 'gamification.adminAdjustment'),
    MANUAL_XP_RESET: t(locale, 'gamification.adminReset'),
    MANUAL_REWARD_POINT_RESET: t(locale, 'gamification.adminReset'),
  };
  return labels[event] ?? t(locale, 'gamification.xpChange');
}

function adminActionLabel(locale: 'en' | 'ta', action: string) {
  const labels: Record<string, string> = {
    'gamification.admin.adjustment': t(locale, 'gamification.adminAdjustment'),
    'gamification.admin.reset': t(locale, 'gamification.adminReset'),
  };
  return labels[action] ?? action;
}

function safeAdminMetadataValue(value: unknown) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

function xpControlStatusLabel(locale: 'en' | 'ta', status: GamificationXpControlStatus) {
  const labels: Record<GamificationXpControlStatus, string> = {
    BALANCED: t(locale, 'gamification.statusBalanced'),
    MISMATCH: t(locale, 'gamification.statusMismatch'),
    NEEDS_REVIEW: t(locale, 'gamification.statusNeedsReview'),
    RECONCILED: t(locale, 'gamification.statusReconciled'),
  };
  return labels[status];
}

function xpLogCategoryLabel(locale: 'en' | 'ta', category: GamificationXpLogCategory) {
  const labels: Record<GamificationXpLogCategory, string> = {
    ALL: t(locale, 'gamification.allActivity'),
    TASKS: t(locale, 'gamification.tasksCompleted'),
    PROJECTS: t(locale, 'gamification.projectsCompleted'),
    TICKETS: t(locale, 'gamification.ticketsResolved'),
    CREATION_XP: t(locale, 'gamification.creationXp'),
    BONUS_XP: t(locale, 'gamification.bonusXp'),
    PENALTY_XP: t(locale, 'gamification.penaltyXp'),
    REVERSALS: t(locale, 'gamification.xpReversal'),
    ACHIEVEMENTS: t(locale, 'gamification.achievements'),
    STREAKS: t(locale, 'gamification.streaks'),
    MANUAL_ADJUSTMENTS: t(locale, 'gamification.adminAdjustments'),
    RESETS: t(locale, 'gamification.adminReset'),
    RECONCILIATION: t(locale, 'gamification.reconciliation'),
    LEGACY: t(locale, 'gamification.legacyXp'),
  };
  return labels[category];
}

function getMutationErrorMessage(error: unknown) {
  if (!error || typeof error !== 'object') return null;
  if ('message' in error && typeof error.message === 'string') return error.message;
  return null;
}

function criterionLabel(locale: 'en' | 'ta', type: GamificationAchievementCriterionType) {
  const labels = {
    XP_TOTAL_AT_LEAST: t(locale, 'gamification.totalXpReached'),
    TASK_COMPLETED_COUNT: t(locale, 'gamification.tasksCompleted'),
    PROJECT_COMPLETED_COUNT: t(locale, 'gamification.projectsCompleted'),
    TICKET_RESOLVED_COUNT: t(locale, 'gamification.ticketsResolved'),
  };
  return labels[type];
}

function streakQualificationLabel(
  locale: 'en' | 'ta',
  type: GamificationStreakDay['qualificationType'],
) {
  const labels = {
    TASK_COMPLETED: t(locale, 'gamification.tasksCompleted'),
    TICKET_RESOLVED: t(locale, 'gamification.ticketsResolved'),
  };
  return labels[type];
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

function formatLocalDate(value: string) {
  return value;
}

function createIdempotencyKey() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
