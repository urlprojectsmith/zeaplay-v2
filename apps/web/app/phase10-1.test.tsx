import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../contexts/language-provider';
import { ThemeProvider } from '../contexts/theme-provider';
import { WorkspaceGamificationPage } from '../components/workspace/gamification/WorkspaceGamificationPage';
import { useSessionStore } from '../stores/session';

const listWorkspaceRoles = vi.fn();
const getMyGamificationXpSummary = vi.fn();
const getMyGamificationXpHistory = vi.fn();
const getMyGamificationRewardPointSummary = vi.fn();
const getMyGamificationStreakSummary = vi.fn();
const getMyGamificationStreakHistory = vi.fn();
const getGamificationStreakConfig = vi.fn();
const updateGamificationStreakConfig = vi.fn();
const listGamificationLevels = vi.fn();
const createGamificationLevel = vi.fn();
const updateGamificationLevel = vi.fn();
const listGamificationBadges = vi.fn();
const createGamificationBadge = vi.fn();
const updateGamificationBadge = vi.fn();
const listGamificationAchievements = vi.fn();
const createGamificationAchievement = vi.fn();
const updateGamificationAchievement = vi.fn();
const listGamificationRewards = vi.fn();
const listMyGamificationRewardRedemptions = vi.fn();
const listGamificationRewardRedemptions = vi.fn();
const createGamificationReward = vi.fn();
const updateGamificationReward = vi.fn();
const redeemGamificationReward = vi.fn();
const fulfillGamificationRewardRedemption = vi.fn();
const cancelGamificationRewardRedemption = vi.fn();
const getGamificationLeaderboardConfig = vi.fn();
const updateGamificationLeaderboardConfig = vi.fn();
const getMyGamificationLeaderboardPreference = vi.fn();
const updateMyGamificationLeaderboardPreference = vi.fn();
const getWorkspaceGamificationLeaderboard = vi.fn();
const getMyDepartmentGamificationLeaderboard = vi.fn();
const searchGamificationAdminMembers = vi.fn();
const getGamificationAdminMemberBalance = vi.fn();
const adjustGamificationAdminBalance = vi.fn();
const createGamificationResetStepUpGrant = vi.fn();
const verifyGamificationResetEmailOtp = vi.fn();
const resetGamificationAdminBalance = vi.fn();
const listGamificationAdminActions = vi.fn();
const getGamificationPointManagement = vi.fn();
const upsertGamificationCompletionPointRule = vi.fn();
const upsertGamificationCreationPointRule = vi.fn();
const previewGamificationCompletionPoints = vi.fn();

vi.mock('../services/workspace-roles', () => ({
  rolesKeys: {
    all: (workspaceId: string | null) => ['workspace', workspaceId, 'roles'],
  },
  listWorkspaceRoles: (...args: unknown[]) => listWorkspaceRoles(...args),
}));

vi.mock('../services/workspace-gamification', () => ({
  gamificationKeys: {
    summary: (workspaceId: string | null) => ['workspace', workspaceId, 'gamification', 'xp'],
    history: (workspaceId: string | null, params: unknown) => [
      'workspace',
      workspaceId,
      'gamification',
      'xp',
      'history',
      params,
    ],
    levels: (workspaceId: string | null, includeInactive: boolean) => [
      'workspace',
      workspaceId,
      'gamification',
      'levels',
      includeInactive,
    ],
    badges: (workspaceId: string | null, includeInactive: boolean) => [
      'workspace',
      workspaceId,
      'gamification',
      'badges',
      includeInactive,
    ],
    achievements: (workspaceId: string | null, includeInactive: boolean) => [
      'workspace',
      workspaceId,
      'gamification',
      'achievements',
      includeInactive,
    ],
    streakSummary: (workspaceId: string | null) => [
      'workspace',
      workspaceId,
      'gamification',
      'streaks',
      'summary',
    ],
    streakHistory: (workspaceId: string | null, params: unknown) => [
      'workspace',
      workspaceId,
      'gamification',
      'streaks',
      'history',
      params,
    ],
    streakConfig: (workspaceId: string | null) => [
      'workspace',
      workspaceId,
      'gamification',
      'streaks',
      'config',
    ],
    rewardPointSummary: (workspaceId: string | null) => [
      'workspace',
      workspaceId,
      'gamification',
      'reward-points',
      'summary',
    ],
    rewardPointHistory: (workspaceId: string | null, params: unknown) => [
      'workspace',
      workspaceId,
      'gamification',
      'reward-points',
      'history',
      params,
    ],
    rewards: (workspaceId: string | null, params: unknown) => [
      'workspace',
      workspaceId,
      'gamification',
      'rewards',
      params,
    ],
    myRewardRedemptions: (workspaceId: string | null, params: unknown) => [
      'workspace',
      workspaceId,
      'gamification',
      'rewards',
      'mine',
      params,
    ],
    rewardRedemptions: (workspaceId: string | null, params: unknown) => [
      'workspace',
      workspaceId,
      'gamification',
      'rewards',
      'redemptions',
      params,
    ],
    leaderboardConfig: (workspaceId: string | null) => [
      'workspace',
      workspaceId,
      'gamification',
      'leaderboards',
      'config',
    ],
    leaderboardPreference: (workspaceId: string | null) => [
      'workspace',
      workspaceId,
      'gamification',
      'leaderboards',
      'preference',
    ],
    workspaceLeaderboard: (workspaceId: string | null) => [
      'workspace',
      workspaceId,
      'gamification',
      'leaderboards',
      'workspace',
    ],
    myDepartmentLeaderboard: (workspaceId: string | null) => [
      'workspace',
      workspaceId,
      'gamification',
      'leaderboards',
      'department',
      'me',
    ],
    adminMembers: (workspaceId: string | null, search: string) => [
      'workspace',
      workspaceId,
      'gamification',
      'admin',
      'members',
      search,
    ],
    adminBalance: (workspaceId: string | null, membershipId: string | null) => [
      'workspace',
      workspaceId,
      'gamification',
      'admin',
      'balance',
      membershipId,
    ],
    adminActions: (workspaceId: string | null) => [
      'workspace',
      workspaceId,
      'gamification',
      'admin',
      'actions',
    ],
    pointRules: (workspaceId: string | null, departmentId: string | null) => [
      'workspace',
      workspaceId,
      'gamification',
      'points',
      departmentId,
    ],
    all: (workspaceId: string | null) => ['workspace-gamification', workspaceId],
  },
  getMyGamificationXpSummary: (...args: unknown[]) => getMyGamificationXpSummary(...args),
  getMyGamificationXpHistory: (...args: unknown[]) => getMyGamificationXpHistory(...args),
  getMyGamificationRewardPointSummary: (...args: unknown[]) =>
    getMyGamificationRewardPointSummary(...args),
  getMyGamificationStreakSummary: (...args: unknown[]) => getMyGamificationStreakSummary(...args),
  getMyGamificationStreakHistory: (...args: unknown[]) => getMyGamificationStreakHistory(...args),
  getGamificationStreakConfig: (...args: unknown[]) => getGamificationStreakConfig(...args),
  updateGamificationStreakConfig: (...args: unknown[]) => updateGamificationStreakConfig(...args),
  listGamificationLevels: (...args: unknown[]) => listGamificationLevels(...args),
  createGamificationLevel: (...args: unknown[]) => createGamificationLevel(...args),
  updateGamificationLevel: (...args: unknown[]) => updateGamificationLevel(...args),
  listGamificationBadges: (...args: unknown[]) => listGamificationBadges(...args),
  createGamificationBadge: (...args: unknown[]) => createGamificationBadge(...args),
  updateGamificationBadge: (...args: unknown[]) => updateGamificationBadge(...args),
  listGamificationAchievements: (...args: unknown[]) => listGamificationAchievements(...args),
  createGamificationAchievement: (...args: unknown[]) => createGamificationAchievement(...args),
  updateGamificationAchievement: (...args: unknown[]) => updateGamificationAchievement(...args),
  listGamificationRewards: (...args: unknown[]) => listGamificationRewards(...args),
  listMyGamificationRewardRedemptions: (...args: unknown[]) =>
    listMyGamificationRewardRedemptions(...args),
  listGamificationRewardRedemptions: (...args: unknown[]) =>
    listGamificationRewardRedemptions(...args),
  createGamificationReward: (...args: unknown[]) => createGamificationReward(...args),
  updateGamificationReward: (...args: unknown[]) => updateGamificationReward(...args),
  redeemGamificationReward: (...args: unknown[]) => redeemGamificationReward(...args),
  fulfillGamificationRewardRedemption: (...args: unknown[]) =>
    fulfillGamificationRewardRedemption(...args),
  cancelGamificationRewardRedemption: (...args: unknown[]) =>
    cancelGamificationRewardRedemption(...args),
  getGamificationLeaderboardConfig: (...args: unknown[]) =>
    getGamificationLeaderboardConfig(...args),
  updateGamificationLeaderboardConfig: (...args: unknown[]) =>
    updateGamificationLeaderboardConfig(...args),
  getMyGamificationLeaderboardPreference: (...args: unknown[]) =>
    getMyGamificationLeaderboardPreference(...args),
  updateMyGamificationLeaderboardPreference: (...args: unknown[]) =>
    updateMyGamificationLeaderboardPreference(...args),
  getWorkspaceGamificationLeaderboard: (...args: unknown[]) =>
    getWorkspaceGamificationLeaderboard(...args),
  getMyDepartmentGamificationLeaderboard: (...args: unknown[]) =>
    getMyDepartmentGamificationLeaderboard(...args),
  searchGamificationAdminMembers: (...args: unknown[]) => searchGamificationAdminMembers(...args),
  getGamificationAdminMemberBalance: (...args: unknown[]) =>
    getGamificationAdminMemberBalance(...args),
  adjustGamificationAdminBalance: (...args: unknown[]) => adjustGamificationAdminBalance(...args),
  createGamificationResetStepUpGrant: (...args: unknown[]) =>
    createGamificationResetStepUpGrant(...args),
  verifyGamificationResetEmailOtp: (...args: unknown[]) => verifyGamificationResetEmailOtp(...args),
  resetGamificationAdminBalance: (...args: unknown[]) => resetGamificationAdminBalance(...args),
  listGamificationAdminActions: (...args: unknown[]) => listGamificationAdminActions(...args),
  getGamificationPointManagement: (...args: unknown[]) => getGamificationPointManagement(...args),
  upsertGamificationCompletionPointRule: (...args: unknown[]) =>
    upsertGamificationCompletionPointRule(...args),
  upsertGamificationCreationPointRule: (...args: unknown[]) =>
    upsertGamificationCreationPointRule(...args),
  previewGamificationCompletionPoints: (...args: unknown[]) =>
    previewGamificationCompletionPoints(...args),
}));

describe('Phase 10 gamification page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({
      accessToken: 'access-token',
      csrfToken: 'csrf-token',
      user: { id: 'user-1', email: 'owner@zeaplay.test', name: 'Owner' },
      agencies: [
        {
          id: 'agency-1',
          name: 'Agency One',
          slug: 'agency-one',
          status: 'active',
          role: 'owner',
          membershipId: 'agency-membership-1',
          workspaces: [
            {
              id: 'workspace-1',
              agencyId: 'agency-1',
              name: 'Workspace One',
              slug: 'workspace-one',
              timezone: 'UTC',
              status: 'active',
              role: 'role-member',
              membershipId: 'workspace-membership-1',
            },
          ],
        },
      ],
      selectedAgencyId: 'agency-1',
      selectedWorkspaceId: 'workspace-1',
      hydrated: true,
    });
    listWorkspaceRoles.mockResolvedValue([
      {
        id: 'role-member',
        key: 'MEMBER',
        name: 'Member',
        description: null,
        scope: 'WORKSPACE',
        isSystem: true,
        isActive: true,
        workspaceId: null,
        permissions: [
          { id: 'permission-gamification-view', key: 'gamification.view' },
          { id: 'permission-gamification-levels-manage', key: 'gamification.levels.manage' },
          { id: 'permission-gamification-rewards-redeem', key: 'gamification.rewards.redeem' },
          { id: 'permission-gamification-rewards-manage', key: 'gamification.rewards.manage' },
          {
            id: 'permission-gamification-leaderboards-view',
            key: 'gamification.leaderboards.view',
          },
          {
            id: 'permission-gamification-leaderboards-manage',
            key: 'gamification.leaderboards.manage',
          },
          {
            id: 'permission-gamification-adjustments-manage',
            key: 'gamification.adjustments.manage',
          },
          {
            id: 'permission-gamification-reset',
            key: 'gamification.reset',
          },
          {
            id: 'permission-gamification-achievements-manage',
            key: 'gamification.achievements.manage',
          },
          { id: 'permission-gamification-streaks-manage', key: 'gamification.streaks.manage' },
          { id: 'permission-gamification-points-view', key: 'gamification.points.view' },
          {
            id: 'permission-gamification-points-manage-workspace',
            key: 'gamification.points.manage_workspace',
          },
        ],
        createdAt: '',
        updatedAt: '',
      },
    ]);
    getMyGamificationXpSummary.mockResolvedValue({
      currentXp: 125,
      lifetimeEarnedXp: 150,
      lifetimeDeductedXp: 25,
      entryCount: 3,
      lastXpChangeAt: '2026-01-01T00:00:00.000Z',
      levelsConfigured: true,
      currentLevel: {
        id: 'level-2',
        workspaceId: 'workspace-1',
        name: 'Builder',
        description: null,
        levelNumber: 2,
        xpThreshold: 100,
        isActive: true,
        createdAt: '',
        updatedAt: '',
      },
      nextLevel: {
        id: 'level-3',
        workspaceId: 'workspace-1',
        name: 'Expert',
        description: null,
        levelNumber: 3,
        xpThreshold: 250,
        isActive: true,
        createdAt: '',
        updatedAt: '',
      },
      xpIntoCurrentLevel: 25,
      xpToNextLevel: 125,
      progressPercent: 16,
      isMaxLevel: false,
      earnedAchievementCount: 1,
      earnedBadgeCount: 1,
    });
    getMyGamificationRewardPointSummary.mockResolvedValue({
      currentRewardPoints: 50,
      lifetimeEarnedRewardPoints: 75,
      lifetimeSpentRewardPoints: 25,
      lifetimeRefundedRewardPoints: 0,
      entryCount: 2,
      lastRewardPointChangeAt: '2026-01-01T00:00:00.000Z',
    });
    getMyGamificationStreakSummary.mockResolvedValue({
      config: {
        id: 'streak-config-1',
        workspaceId: 'workspace-1',
        enabled: true,
        dailyXpReward: 25,
        dailyRewardPoints: 5,
        enabledAt: '2026-01-01T00:00:00.000Z',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      timezone: 'UTC',
      currentStreak: 2,
      longestStreak: 5,
      qualifiedToday: false,
      needsActionToday: true,
      lastQualifiedDate: '2026-01-02',
      recentDays: [],
    });
    getMyGamificationStreakHistory.mockResolvedValue({
      items: [
        {
          id: 'streak-day-1',
          workspaceId: 'workspace-1',
          membershipId: 'workspace-membership-1',
          localDate: '2026-01-02',
          qualificationType: 'TASK_COMPLETED',
          sourceEntityId: 'task-1',
          qualifiedAt: '2026-01-02T10:00:00.000Z',
          timezoneSnapshot: 'UTC',
          dailyXpRewardSnapshot: 25,
          dailyRewardPointsSnapshot: 5,
          createdAt: '2026-01-02T10:00:00.000Z',
        },
      ],
      page: 1,
      pageSize: 10,
      total: 1,
    });
    getGamificationStreakConfig.mockResolvedValue({
      id: 'streak-config-1',
      workspaceId: 'workspace-1',
      enabled: true,
      dailyXpReward: 25,
      dailyRewardPoints: 5,
      enabledAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    updateGamificationStreakConfig.mockResolvedValue({
      id: 'streak-config-1',
      workspaceId: 'workspace-1',
      enabled: true,
      dailyXpReward: 25,
      dailyRewardPoints: 5,
      enabledAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    getGamificationPointManagement.mockResolvedValue({
      workTypes: ['TASK', 'PROJECT', 'TICKET'],
      categories: ['LOW', 'MEDIUM', 'HIGH', 'URGENT', 'LONG_TERM'],
      departmentId: null,
      departments: [{ id: 'department-1', name: 'Support', status: 'ACTIVE' }],
      roles: [
        {
          id: 'role-member',
          key: 'MEMBER',
          name: 'Member',
          isSystem: true,
          workspaceId: null,
        },
      ],
      completionRules: [],
      creationRules: [],
      effectiveCompletionRules: [
        {
          workType: 'TASK',
          category: 'MEDIUM',
          source: 'WORKSPACE_DEFAULT',
          rule: {
            id: 'point-rule-1',
            workspaceId: 'workspace-1',
            departmentId: null,
            scopeType: 'WORKSPACE',
            workType: 'TASK',
            category: 'MEDIUM',
            isEnabled: true,
            baseXp: 25,
            earlyBonusXp: 5,
            earlyThresholdMinutes: 60,
            latePenaltyPercent: 10,
            penaltyIntervalMinutes: 30,
            maxPenaltyXp: 20,
            createdAt: '',
            updatedAt: '',
          },
        },
      ],
      effectiveCreationRules: [
        {
          roleId: 'role-member',
          workType: 'TASK',
          category: 'MEDIUM',
          source: 'NOT_CONFIGURED',
          rule: null,
        },
      ],
      projectXpCategoryRequiredForNewProjects: false,
      projectXpCategoryRollout: 'NULLABLE_COMPATIBILITY_STAGE',
    });
    upsertGamificationCompletionPointRule.mockResolvedValue({});
    upsertGamificationCreationPointRule.mockResolvedValue({});
    previewGamificationCompletionPoints.mockResolvedValue({
      enabled: true,
      timing: 'EARLY',
      baseXp: 25,
      earlyBonusXp: 5,
      penaltyXp: 0,
      netCompletionXp: 30,
      lateMinutes: 0,
      lateIntervals: 0,
    });
    getGamificationLeaderboardConfig.mockResolvedValue({
      id: 'leaderboard-config-1',
      workspaceId: 'workspace-1',
      enabled: true,
      workspaceLeaderboardEnabled: true,
      departmentLeaderboardEnabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    updateGamificationLeaderboardConfig.mockResolvedValue({
      id: 'leaderboard-config-1',
      workspaceId: 'workspace-1',
      enabled: true,
      workspaceLeaderboardEnabled: true,
      departmentLeaderboardEnabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    getMyGamificationLeaderboardPreference.mockResolvedValue({
      id: 'leaderboard-preference-1',
      workspaceId: 'workspace-1',
      membershipId: 'workspace-membership-1',
      privacyMode: 'ANONYMOUS',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    updateMyGamificationLeaderboardPreference.mockResolvedValue({
      id: 'leaderboard-preference-1',
      workspaceId: 'workspace-1',
      membershipId: 'workspace-membership-1',
      privacyMode: 'SHOW_NAME',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    getWorkspaceGamificationLeaderboard.mockResolvedValue(leaderboardResponse('WORKSPACE'));
    getMyDepartmentGamificationLeaderboard.mockResolvedValue(leaderboardResponse('DEPARTMENT'));
    searchGamificationAdminMembers.mockResolvedValue({
      items: [
        {
          membershipId: 'target-membership-1',
          displayName: 'Target Member',
          departmentName: 'Support',
          status: 'ACTIVE',
        },
      ],
    });
    getGamificationAdminMemberBalance.mockResolvedValue({
      member: {
        membershipId: 'target-membership-1',
        displayName: 'Target Member',
        departmentName: 'Support',
        status: 'ACTIVE',
      },
      balances: { currentXp: 125, currentRewardPoints: 50 },
    });
    adjustGamificationAdminBalance.mockResolvedValue({
      changed: true,
      member: {
        membershipId: 'target-membership-1',
        displayName: 'Target Member',
        departmentName: 'Support',
        status: 'ACTIVE',
      },
      economy: 'XP',
      operation: 'ADD',
      amount: 10,
      before: 125,
      after: 135,
      entryId: 'xp-entry-1',
    });
    createGamificationResetStepUpGrant.mockResolvedValue({
      challengeId: 'challenge-1',
      expiresAt: '2026-01-01T00:05:00.000Z',
      resendAvailableAt: '2026-01-01T00:01:00.000Z',
      maskedDestination: 'o***@zeaplay.test',
      purpose: 'GAMIFICATION_RESET',
      economy: 'XP',
      targetMembershipId: 'target-membership-1',
    });
    verifyGamificationResetEmailOtp.mockResolvedValue({
      id: 'step-up-1',
      expiresAt: '2026-01-01T00:05:00.000Z',
      purpose: 'GAMIFICATION_RESET',
      economy: 'XP',
      targetMembershipId: 'target-membership-1',
    });
    resetGamificationAdminBalance.mockResolvedValue({
      changed: true,
      member: {
        membershipId: 'target-membership-1',
        displayName: 'Target Member',
        departmentName: 'Support',
        status: 'ACTIVE',
      },
      economy: 'XP',
      before: 125,
      after: 0,
      entryIds: ['xp-reset-1'],
    });
    listGamificationAdminActions.mockResolvedValue({ items: [] });
    listGamificationLevels.mockResolvedValue({
      items: [
        {
          id: 'level-1',
          workspaceId: 'workspace-1',
          name: 'Starter',
          description: null,
          levelNumber: 1,
          xpThreshold: 0,
          isActive: true,
          createdAt: '',
          updatedAt: '',
        },
        {
          id: 'level-2',
          workspaceId: 'workspace-1',
          name: 'Builder',
          description: null,
          levelNumber: 2,
          xpThreshold: 100,
          isActive: true,
          createdAt: '',
          updatedAt: '',
        },
      ],
    });
    createGamificationLevel.mockResolvedValue({
      id: 'level-3',
      workspaceId: 'workspace-1',
      name: 'Expert',
      description: null,
      levelNumber: 3,
      xpThreshold: 250,
      isActive: true,
      createdAt: '',
      updatedAt: '',
    });
    getMyGamificationXpHistory.mockResolvedValue({
      items: [
        {
          id: 'xp-1',
          amount: 25,
          entryType: 'EARN',
          sourceType: 'TASK',
          sourceEvent: 'TASK_COMPLETED',
          sourceEntityId: 'task-1',
          reason: null,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      page: 1,
      pageSize: 10,
      total: 1,
    });
    listGamificationBadges.mockResolvedValue({
      items: [
        {
          id: 'badge-1',
          workspaceId: 'workspace-1',
          name: 'Closer',
          description: null,
          iconKey: 'sparkles',
          isActive: true,
          createdAt: '',
          updatedAt: '',
        },
      ],
      earned: [
        {
          id: 'badge-award-1',
          badgeDefinitionId: 'badge-1',
          badgeNameSnapshot: 'Closer',
          badgeIconKeySnapshot: 'sparkles',
          achievementAwardId: 'achievement-award-1',
          earnedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    listGamificationAchievements.mockResolvedValue({
      items: [
        {
          id: 'achievement-1',
          workspaceId: 'workspace-1',
          name: 'Task Starter',
          description: null,
          criterionType: 'TASK_COMPLETED_COUNT',
          criterionValue: 10,
          badgeDefinitionId: 'badge-1',
          xpReward: 25,
          rewardPointsReward: 5,
          isActive: true,
          createdAt: '',
          updatedAt: '',
          badgeDefinition: { id: 'badge-1', name: 'Closer', iconKey: 'sparkles', isActive: true },
          earned: false,
          earnedAt: null,
          progress: { currentValue: 7, targetValue: 10, percent: 70 },
        },
      ],
      earned: [],
    });
    listGamificationRewards.mockResolvedValue({ items: [], page: 1, pageSize: 50, total: 0 });
    listMyGamificationRewardRedemptions.mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 10,
      total: 0,
    });
    listGamificationRewardRedemptions.mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 10,
      total: 0,
    });
  });

  it('renders server XP summary and fetches history only when the history tab opens', async () => {
    renderGamificationPage();

    expect(await screen.findByRole('heading', { name: 'Gamification' })).toBeInTheDocument();
    expect(await screen.findByText('125 XP')).toBeInTheDocument();
    expect(await screen.findByText('Level 2 - Builder')).toBeInTheDocument();
    expect(await screen.findByText('2 days')).toBeInTheDocument();
    expect(getMyGamificationXpSummary).toHaveBeenCalledWith('workspace-1');
    expect(getMyGamificationXpHistory).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('tab', { name: 'History' }));

    await waitFor(() =>
      expect(getMyGamificationXpHistory).toHaveBeenCalledWith('workspace-1', {
        page: 1,
        pageSize: 10,
      }),
    );
    expect(await screen.findByText('+25 XP')).toBeInTheDocument();
  });

  it('shows streak summary, history, and manager settings on the Streaks tab', async () => {
    renderGamificationPage();

    fireEvent.click(await screen.findByRole('tab', { name: 'Streaks' }));

    expect(await screen.findByText('Streaks Enabled')).toBeInTheDocument();
    expect(await screen.findByText('Action Needed Today')).toBeInTheDocument();
    expect(await screen.findByText('+25 XP')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Daily XP Reward'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Streak Settings' }));

    await waitFor(() =>
      expect(updateGamificationStreakConfig).toHaveBeenCalledWith('workspace-1', {
        enabled: true,
        dailyXpReward: 30,
        dailyRewardPoints: 5,
      }),
    );
  });

  it('lazy-loads point management with a single batched rules request', async () => {
    renderGamificationPage();

    expect(getGamificationPointManagement).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('tab', { name: 'Points' }));

    await waitFor(() =>
      expect(getGamificationPointManagement).toHaveBeenCalledWith('workspace-1', null),
    );
    expect(await screen.findAllByText('Task / Medium')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Save Point Rule' })).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Early Bonus'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Early Threshold'), { target: { value: '60' } });
    fireEvent.change(screen.getByLabelText('Completed At'), {
      target: { value: '2026-01-01T09:00' },
    });
    fireEvent.change(screen.getByLabelText('Due At'), { target: { value: '2026-01-01T10:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview XP' }));

    await waitFor(() =>
      expect(previewGamificationCompletionPoints).toHaveBeenCalledWith(
        'workspace-1',
        expect.objectContaining({
          baseXp: 25,
          earlyBonusXp: 5,
          earlyThresholdMinutes: 60,
          completedAt: expect.any(String),
          dueAt: expect.any(String),
        }),
      ),
    );
    expect(await screen.findByText('30')).toBeInTheDocument();
    expect(screen.getAllByText('Workspace default').length).toBeGreaterThanOrEqual(1);
  });

  it('shows level definitions and manager controls on the Levels tab', async () => {
    renderGamificationPage();

    fireEvent.click(await screen.findByRole('tab', { name: 'Levels' }));

    expect(await screen.findByText('Level 1 - Starter')).toBeInTheDocument();
    expect(listGamificationLevels).toHaveBeenCalledWith('workspace-1', true);
    fireEvent.change(screen.getByLabelText('Level Name'), { target: { value: 'Expert' } });
    fireEvent.change(screen.getByLabelText('Level Number'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('XP Threshold'), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Level' }));

    await waitFor(() =>
      expect(createGamificationLevel).toHaveBeenCalledWith('workspace-1', {
        name: 'Expert',
        levelNumber: 3,
        xpThreshold: 250,
        description: null,
      }),
    );
  });

  it('lazy-loads Leaderboard tab data and avoids duplicate self rendering', async () => {
    getMyDepartmentGamificationLeaderboard.mockResolvedValue({
      ...leaderboardResponse('DEPARTMENT'),
      entries: [],
      me: {
        ...leaderboardResponse('DEPARTMENT').me,
        inTopEntries: false,
      },
    });
    renderGamificationPage();

    expect(await screen.findByRole('heading', { name: 'Gamification' })).toBeInTheDocument();
    expect(getWorkspaceGamificationLeaderboard).not.toHaveBeenCalled();
    expect(getMyDepartmentGamificationLeaderboard).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('tab', { name: 'Leaderboard' }));

    expect(await screen.findByText('Workspace Leaderboard')).toBeInTheDocument();
    expect(getWorkspaceGamificationLeaderboard).toHaveBeenCalledWith('workspace-1');
    expect(getMyDepartmentGamificationLeaderboard).toHaveBeenCalledWith('workspace-1');
    expect(screen.getAllByText('Your Position')).toHaveLength(2);
    expect(screen.getAllByText('You')).toHaveLength(1);
  });

  it('shows admin adjustment and reset controls only for matching permissions', async () => {
    renderGamificationPage();

    fireEvent.click(await screen.findByRole('tab', { name: 'Admin' }));

    expect(await screen.findByText('Target Member')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Target Member Support' }));

    expect(await screen.findByText('125 XP')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Admin Adjustments' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Admin Reset' })).toBeInTheDocument();

    const [adjustmentReasonInput, resetReasonInput] = screen.getAllByLabelText('Reason');
    expect(adjustmentReasonInput).toBeDefined();
    expect(resetReasonInput).toBeDefined();

    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '10' } });
    fireEvent.change(adjustmentReasonInput as HTMLElement, {
      target: { value: 'Manual credit' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply Adjustment' }));

    await waitFor(() =>
      expect(adjustGamificationAdminBalance).toHaveBeenCalledWith(
        'workspace-1',
        expect.objectContaining({
          targetMembershipId: 'target-membership-1',
          economy: 'XP',
          operation: 'ADD',
          amount: 10,
          reason: 'Manual credit',
        }),
      ),
    );

    fireEvent.change(screen.getByLabelText('Verify Identity'), {
      target: { value: 'DevelopmentPassword123!' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));

    await waitFor(() =>
      expect(createGamificationResetStepUpGrant).toHaveBeenCalledWith('workspace-1', {
        targetMembershipId: 'target-membership-1',
        economy: 'XP',
        password: 'DevelopmentPassword123!',
      }),
    );

    fireEvent.change(await screen.findByLabelText('Verification code'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify code' }));

    await waitFor(() =>
      expect(verifyGamificationResetEmailOtp).toHaveBeenCalledWith('challenge-1', '123456'),
    );

    fireEvent.change(screen.getByLabelText('Type RESET'), { target: { value: 'RESET' } });
    fireEvent.change(resetReasonInput as HTMLElement, { target: { value: 'Policy reset' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reset to Zero' }));

    await waitFor(() =>
      expect(resetGamificationAdminBalance).toHaveBeenCalledWith(
        'workspace-1',
        expect.objectContaining({
          targetMembershipId: 'target-membership-1',
          economy: 'XP',
          reason: 'Policy reset',
          confirmation: 'RESET',
          stepUpGrantId: 'step-up-1',
        }),
      ),
    );
  });

  it('allows reset-only admins without exposing adjustment controls', async () => {
    listWorkspaceRoles.mockResolvedValue([
      {
        id: 'role-member',
        key: 'MEMBER',
        name: 'Member',
        description: null,
        scope: 'WORKSPACE',
        isSystem: true,
        isActive: true,
        workspaceId: null,
        permissions: [{ id: 'permission-gamification-reset', key: 'gamification.reset' }],
        createdAt: '',
        updatedAt: '',
      },
    ]);

    renderGamificationPage();

    expect(await screen.findByRole('tab', { name: 'Admin' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Overview' })).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Admin Reset' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Admin Adjustments' })).not.toBeInTheDocument();
    expect(getMyGamificationXpSummary).not.toHaveBeenCalled();
  });

  it('does not call XP APIs when the selected role lacks gamification.view', async () => {
    listWorkspaceRoles.mockResolvedValue([
      {
        id: 'role-member',
        key: 'MEMBER',
        name: 'Member',
        description: null,
        scope: 'WORKSPACE',
        isSystem: true,
        isActive: true,
        workspaceId: null,
        permissions: [],
        createdAt: '',
        updatedAt: '',
      },
    ]);

    renderGamificationPage();

    expect(await screen.findByText('Permission denied')).toBeInTheDocument();
    expect(getMyGamificationXpSummary).not.toHaveBeenCalled();
    expect(getMyGamificationXpHistory).not.toHaveBeenCalled();
    expect(getMyGamificationRewardPointSummary).not.toHaveBeenCalled();
    expect(listGamificationLevels).not.toHaveBeenCalled();
    expect(listGamificationBadges).not.toHaveBeenCalled();
    expect(listGamificationAchievements).not.toHaveBeenCalled();
    expect(getMyGamificationStreakSummary).not.toHaveBeenCalled();
  });
});

function leaderboardResponse(scope: 'WORKSPACE' | 'DEPARTMENT') {
  return {
    scope,
    period: 'ALL_TIME',
    available: true,
    reason: null,
    config: {
      id: 'leaderboard-config-1',
      workspaceId: 'workspace-1',
      enabled: true,
      workspaceLeaderboardEnabled: true,
      departmentLeaderboardEnabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    entries: [
      {
        key: `${scope}-1`,
        rank: 1,
        displayName: 'You',
        currentXp: 125,
        currentLevel: {
          id: 'level-2',
          workspaceId: 'workspace-1',
          name: 'Builder',
          description: null,
          levelNumber: 2,
          xpThreshold: 100,
          isActive: true,
          createdAt: '',
          updatedAt: '',
        },
        isCurrentUser: true,
        privacyMode: 'ANONYMOUS',
        departmentName: null,
      },
    ],
    me: {
      included: true,
      rank: 1,
      currentXp: 125,
      currentLevel: {
        id: 'level-2',
        workspaceId: 'workspace-1',
        name: 'Builder',
        description: null,
        levelNumber: 2,
        xpThreshold: 100,
        isActive: true,
        createdAt: '',
        updatedAt: '',
      },
      privacyMode: 'ANONYMOUS',
      inTopEntries: true,
      displayName: 'You',
    },
  };
}

function renderGamificationPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <LanguageProvider>
          <WorkspaceGamificationPage />
        </LanguageProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}
