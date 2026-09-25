import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { DateTime } from 'luxon';
import {
  GamificationAchievementCriterionType,
  GamificationAchievementDefinition,
  GamificationAdminEconomy,
  GamificationGlobalScoreBaselineScoreType,
  GamificationGlobalScoreBaselineStatus,
  GamificationGlobalScoreEventScoreType,
  GamificationGlobalScoreEventStatus,
  GamificationLeaderboardPrivacyMode,
  GamificationPointCategory,
  GamificationPointScopeType,
  GamificationPointWorkType,
  GamificationWorkXpEventOutcome,
  GamificationWorkXpEventType,
  GamificationWorkXpSkipReason,
  GamificationXpReconciliationStatus,
  GamificationRewardInventoryMode,
  GamificationRewardPointEntry,
  GamificationRewardPointEntryType,
  GamificationRewardPointSourceType,
  GamificationRewardRedemptionStatus,
  GamificationStreakQualificationType,
  GamificationXpEntry,
  GamificationXpEntryType,
  GamificationXpSourceType,
  MembershipStatus,
  NotificationCategory,
  NotificationEntityType,
  NotificationPriority,
  NotificationType,
  Prisma,
  SecurityStepUpPurpose,
  StatusEntityType,
  RoleScope,
  WorkspaceStatus,
} from '@prisma/client';
import type {
  AgencyTenantContext,
  SuperAgencyTenantContext,
  WorkspaceTenantContext,
} from '../../common/auth/auth.types';
import { JwtTokenService } from '../../common/auth/jwt.service';
import { PermissionKeys } from '../../common/authorization/permissions';
import { safeWorkspaceTimezone } from '../../common/timezones';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BillingEntitlementService } from '../billing/billing-entitlement.service';
import { NotificationRouterService } from '../notifications/notification-router.service';
import { RealtimeService } from '../realtime/realtime.service';
import {
  CreateGamificationAchievementDto,
  CreateGamificationBadgeDto,
  GamificationDefinitionQueryDto,
  UpdateGamificationAchievementDto,
  UpdateGamificationBadgeDto,
} from './dto/gamification-achievement.dto';
import {
  GamificationAdminAdjustmentDto,
  GamificationAdminAdjustmentOperation,
  GamificationAdminMemberQueryDto,
  GamificationAdminResetDto,
} from './dto/gamification-admin.dto';
import {
  CreateGamificationLevelDto,
  GamificationLevelQueryDto,
  UpdateGamificationLevelDto,
} from './dto/gamification-level.dto';
import {
  GamificationGlobalLeaderboardQueryDto,
  UpdateGamificationLeaderboardConfigDto,
  UpdateGamificationLeaderboardPreferenceDto,
} from './dto/gamification-leaderboard.dto';
import {
  CancelGamificationRewardRedemptionDto,
  CreateGamificationRewardDto,
  GamificationRewardDefinitionQueryDto,
  GamificationRewardPointHistoryQueryDto,
  GamificationRewardRedemptionQueryDto,
  RedeemGamificationRewardDto,
  UpdateGamificationRewardDto,
} from './dto/gamification-reward.dto';
import {
  GamificationStreakHistoryQueryDto,
  UpdateGamificationStreakConfigDto,
} from './dto/gamification-streak.dto';
import { GamificationXpHistoryQueryDto } from './dto/gamification-xp-query.dto';
import {
  GamificationXpControlQueryDto,
  GamificationXpLogQueryDto,
  GamificationXpReconciliationApplyDto,
  GamificationXpReconciliationPreviewDto,
} from './dto/gamification-xp-control.dto';
import {
  DeveloperAuditQueryDto,
  DeveloperGamificationPageQueryDto,
  DeveloperLeaderboardDiagnosticsQueryDto,
  DeveloperNormalizationEventsQueryDto,
  DeveloperPointRuleInspectorQueryDto,
  DeveloperReconciliationQueryDto,
  DeveloperXpEventMonitorQueryDto,
} from './dto/developer-gamification.dto';
import {
  GamificationPointPreviewDto,
  GamificationPointRulesQueryDto,
  RemoveGamificationPointRuleOverrideDto,
  UpsertGamificationCompletionPointRuleDto,
  UpsertGamificationCreationPointRuleDto,
} from './dto/gamification-point-rule.dto';
import { calculateCompletionPoints } from './point-calculator';

const MAX_XP_AMOUNT = 1_000_000;
const MAX_LEVEL_XP_THRESHOLD = 1_000_000_000;
const MAX_LEVEL_NUMBER = 1000;
const LEVEL_NAME_MAX_LENGTH = 80;
const LEVEL_DESCRIPTION_MAX_LENGTH = 500;
const DEFINITION_NAME_MAX_LENGTH = 80;
const DEFINITION_DESCRIPTION_MAX_LENGTH = 500;
const BADGE_ICON_MAX_LENGTH = 80;
const MAX_ACHIEVEMENT_CRITERION_VALUE = 1_000_000_000;
const MAX_ACHIEVEMENT_XP_REWARD = 100_000;
const MAX_ACHIEVEMENT_REWARD_POINTS_REWARD = 100_000;
const MAX_ACHIEVEMENT_CHAIN_DEPTH = 20;
const MAX_STREAK_DAILY_XP_REWARD = 100_000;
const MAX_STREAK_DAILY_REWARD_POINTS = 100_000;
const MAX_REWARD_POINT_AMOUNT = 1_000_000;
const MAX_REWARD_POINTS_REWARD_COST = 1_000_000;
const MAX_REWARD_AVAILABLE_QUANTITY = 1_000_000;
const REWARD_NAME_MAX_LENGTH = 80;
const REWARD_DESCRIPTION_MAX_LENGTH = 500;
const SOURCE_EVENT_MAX_LENGTH = 80;
const IDEMPOTENCY_KEY_MAX_LENGTH = 160;
const REASON_MAX_LENGTH = 500;
const LEADERBOARD_TOP_LIMIT = 100;
const POINT_RULE_MAX_XP = 1_000_000;
const GLOBAL_SCORE_CALCULATION_VERSION = 'phase10.11.v1';
const GLOBAL_SCORE_MIN_WORKSPACES = 2;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ApplyXpChangeInput {
  workspaceId: string;
  membershipId: string;
  amount: number;
  entryType: GamificationXpEntryType;
  sourceType: GamificationXpSourceType;
  sourceEvent: string;
  sourceEntityId?: string | null;
  idempotencyKey?: string | null;
  workXpEventId?: string | null;
  reconciliationId?: string | null;
  actorMembershipId?: string | null;
  reason?: string | null;
  achievementEvaluationDepth?: number;
}

export interface ReverseXpEntryInput {
  workspaceId: string;
  membershipId: string;
  entryId: string;
  idempotencyKey?: string | null;
  actorMembershipId?: string | null;
  reason?: string | null;
}

export interface ApplyRewardPointChangeInput {
  workspaceId: string;
  membershipId: string;
  amount: number;
  entryType: GamificationRewardPointEntryType;
  sourceType: GamificationRewardPointSourceType;
  sourceEvent: string;
  sourceEntityId?: string | null;
  idempotencyKey?: string | null;
  actorMembershipId?: string | null;
  reason?: string | null;
}

export interface ReverseRewardPointEntryInput {
  workspaceId: string;
  membershipId: string;
  entryId: string;
  idempotencyKey?: string | null;
  actorMembershipId?: string | null;
  reason?: string | null;
}

const missingRealtimeService = {
  publishWorkspace: () => Promise.resolve(undefined),
  publishMember: () => Promise.resolve(undefined),
} as unknown as RealtimeService;

@Injectable()
export class GamificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tokens: JwtTokenService,
    @Optional() private readonly realtime: RealtimeService = missingRealtimeService,
    @Optional() private readonly notifications?: NotificationRouterService,
    @Optional() private readonly billingEntitlements?: BillingEntitlementService,
  ) {}

  private async assertGamificationFeatureAvailable(tenant: WorkspaceTenantContext) {
    await this.billingEntitlements?.assertWorkspaceFeatureAvailable(
      tenant.workspaceId,
      'gamification.enabled',
    );
  }

  async getMyXpSummary(tenant: WorkspaceTenantContext) {
    const membershipId = requireWorkspaceMembership(tenant);
    const where = { workspaceId: tenant.workspaceId, membershipId };
    const [balance, earned, deducted, count, last, activeLevels, achievementCount, badgeCount] =
      await Promise.all([
        this.prisma.gamificationXpEntry.aggregate({ where, _sum: { amount: true } }),
        this.prisma.gamificationXpEntry.aggregate({
          where: { ...where, entryType: GamificationXpEntryType.EARN, amount: { gt: 0 } },
          _sum: { amount: true },
        }),
        this.prisma.gamificationXpEntry.aggregate({
          where: { ...where, entryType: GamificationXpEntryType.DEDUCT, amount: { lt: 0 } },
          _sum: { amount: true },
        }),
        this.prisma.gamificationXpEntry.count({ where }),
        this.prisma.gamificationXpEntry.findFirst({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { createdAt: true },
        }),
        this.prisma.gamificationLevel.findMany({
          where: { workspaceId: tenant.workspaceId, isActive: true },
          orderBy: [{ levelNumber: 'asc' }, { id: 'asc' }],
          select: gamificationLevelSelect,
        }),
        this.prisma.gamificationAchievementAward.count({ where }),
        this.prisma.gamificationBadgeAward.count({ where }),
      ]);
    const currentXp = Math.max(0, balance._sum.amount ?? 0);
    return {
      currentXp,
      lifetimeEarnedXp: earned._sum.amount ?? 0,
      lifetimeDeductedXp: Math.abs(deducted._sum.amount ?? 0),
      entryCount: count,
      lastXpChangeAt: last?.createdAt ?? null,
      earnedAchievementCount: achievementCount,
      earnedBadgeCount: badgeCount,
      ...deriveLevelProgress(currentXp, activeLevels),
    };
  }

  async getMyStreakSummary(tenant: WorkspaceTenantContext) {
    const membershipId = requireWorkspaceMembership(tenant);
    const [config, timezone] = await Promise.all([
      this.getStreakConfigData(tenant.workspaceId),
      this.workspaceTimezone(tenant.workspaceId),
    ]);
    const today = localDateString(new Date(), timezone);
    const days = await this.prisma.gamificationStreakDay.findMany({
      where: { workspaceId: tenant.workspaceId, membershipId },
      orderBy: [{ localDate: 'desc' }, { id: 'desc' }],
      take: 366,
      select: gamificationStreakDaySelect,
    });
    const streak = deriveStreakStats(
      days.map((day) => dateOnlyString(day.localDate)),
      today,
    );
    const lastQualifiedDate = days[0] ? dateOnlyString(days[0].localDate) : null;
    return {
      config,
      timezone,
      currentStreak: streak.currentStreak,
      longestStreak: streak.longestStreak,
      qualifiedToday: lastQualifiedDate === today,
      needsActionToday: config.enabled && lastQualifiedDate !== today,
      lastQualifiedDate,
      recentDays: days.slice(0, 10),
    };
  }

  async getMyStreakHistory(
    tenant: WorkspaceTenantContext,
    query: GamificationStreakHistoryQueryDto,
  ) {
    const membershipId = requireWorkspaceMembership(tenant);
    const page = query.page;
    const pageSize = query.pageSize;
    const where = { workspaceId: tenant.workspaceId, membershipId };
    const [items, total] = await Promise.all([
      this.prisma.gamificationStreakDay.findMany({
        where,
        orderBy: [{ localDate: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: gamificationStreakDaySelect,
      }),
      this.prisma.gamificationStreakDay.count({ where }),
    ]);
    return { items, page, pageSize, total };
  }

  async getStreakConfig(tenant: WorkspaceTenantContext) {
    return this.getStreakConfigData(tenant.workspaceId);
  }

  async updateStreakConfig(tenant: WorkspaceTenantContext, dto: UpdateGamificationStreakConfigDto) {
    await this.assertGamificationFeatureAvailable(tenant);
    if (
      dto.enabled === undefined &&
      dto.dailyXpReward === undefined &&
      dto.dailyRewardPoints === undefined
    )
      throw new BadRequestException('STREAK_CONFIG_UPDATE_EMPTY');
    const dailyXpReward =
      dto.dailyXpReward === undefined
        ? undefined
        : requireBoundedInt(
            dto.dailyXpReward,
            0,
            MAX_STREAK_DAILY_XP_REWARD,
            'STREAK_DAILY_XP_REWARD_INVALID',
          );
    const dailyRewardPoints =
      dto.dailyRewardPoints === undefined
        ? undefined
        : requireBoundedInt(
            dto.dailyRewardPoints,
            0,
            MAX_STREAK_DAILY_REWARD_POINTS,
            'STREAK_DAILY_REWARD_POINTS_INVALID',
          );
    const updated = await this.prisma.$transaction(async (tx) => {
      await lockWorkspace(tx, tenant.workspaceId);
      const existing = await tx.gamificationStreakConfig.findUnique({
        where: { workspaceId: tenant.workspaceId },
      });
      const enableNow = dto.enabled === true && existing?.enabled !== true;
      const data = {
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(dailyXpReward !== undefined ? { dailyXpReward } : {}),
        ...(dailyRewardPoints !== undefined ? { dailyRewardPoints } : {}),
        ...(enableNow ? { enabledAt: new Date() } : {}),
      };
      return tx.gamificationStreakConfig.upsert({
        where: { workspaceId: tenant.workspaceId },
        create: {
          workspaceId: tenant.workspaceId,
          enabled: dto.enabled ?? false,
          dailyXpReward: dailyXpReward ?? 0,
          dailyRewardPoints: dailyRewardPoints ?? 0,
          enabledAt: dto.enabled === true ? new Date() : null,
        },
        update: data,
        select: gamificationStreakConfigSelect,
      });
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'gamification.streak_config.updated',
      entityType: 'GamificationStreakConfig',
      entityId: updated.id,
      metadata: {
        enabled: updated.enabled,
        dailyXpReward: updated.dailyXpReward,
        dailyRewardPoints: updated.dailyRewardPoints,
      },
    });
    return updated;
  }

  async getLeaderboardConfig(tenant: WorkspaceTenantContext) {
    assertPermission(tenant, PermissionKeys.gamificationLeaderboardsManage);
    return this.getLeaderboardConfigData(tenant.workspaceId);
  }

  async updateLeaderboardConfig(
    tenant: WorkspaceTenantContext,
    dto: UpdateGamificationLeaderboardConfigDto,
  ) {
    await this.assertGamificationFeatureAvailable(tenant);
    assertPermission(tenant, PermissionKeys.gamificationLeaderboardsManage);
    if (
      dto.enabled === undefined &&
      dto.workspaceLeaderboardEnabled === undefined &&
      dto.departmentLeaderboardEnabled === undefined
    ) {
      throw new BadRequestException('LEADERBOARD_CONFIG_UPDATE_EMPTY');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      await lockWorkspace(tx, tenant.workspaceId);
      return tx.gamificationLeaderboardConfig.upsert({
        where: { workspaceId: tenant.workspaceId },
        create: {
          workspaceId: tenant.workspaceId,
          enabled: dto.enabled ?? false,
          workspaceLeaderboardEnabled: dto.workspaceLeaderboardEnabled ?? false,
          departmentLeaderboardEnabled: dto.departmentLeaderboardEnabled ?? false,
        },
        update: {
          ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
          ...(dto.workspaceLeaderboardEnabled !== undefined
            ? { workspaceLeaderboardEnabled: dto.workspaceLeaderboardEnabled }
            : {}),
          ...(dto.departmentLeaderboardEnabled !== undefined
            ? { departmentLeaderboardEnabled: dto.departmentLeaderboardEnabled }
            : {}),
        },
        select: gamificationLeaderboardConfigSelect,
      });
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'gamification.leaderboard_config.updated',
      entityType: 'GamificationLeaderboardConfig',
      entityId: updated.id,
      metadata: {
        enabled: updated.enabled,
        workspaceLeaderboardEnabled: updated.workspaceLeaderboardEnabled,
        departmentLeaderboardEnabled: updated.departmentLeaderboardEnabled,
      },
    });
    return updated;
  }

  async getMyLeaderboardPreference(tenant: WorkspaceTenantContext) {
    const membershipId = requireWorkspaceMembership(tenant);
    return this.getLeaderboardPreferenceData(tenant.workspaceId, membershipId);
  }

  async updateMyLeaderboardPreference(
    tenant: WorkspaceTenantContext,
    dto: UpdateGamificationLeaderboardPreferenceDto,
  ) {
    await this.assertGamificationFeatureAvailable(tenant);
    const membershipId = requireWorkspaceMembership(tenant);
    const updated = await this.prisma.gamificationLeaderboardPreference.upsert({
      where: {
        workspaceId_membershipId: {
          workspaceId: tenant.workspaceId,
          membershipId,
        },
      },
      create: {
        workspaceId: tenant.workspaceId,
        membershipId,
        privacyMode: dto.privacyMode,
      },
      update: { privacyMode: dto.privacyMode },
      select: gamificationLeaderboardPreferenceSelect,
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'gamification.leaderboard_privacy.updated',
      entityType: 'GamificationLeaderboardPreference',
      entityId: updated.id,
      metadata: { privacyMode: updated.privacyMode },
    });
    return updated;
  }

  async getWorkspaceLeaderboard(tenant: WorkspaceTenantContext) {
    return this.getLeaderboard(tenant, 'WORKSPACE');
  }

  async getMyDepartmentLeaderboard(tenant: WorkspaceTenantContext) {
    const membershipId = requireWorkspaceMembership(tenant);
    const membership = await this.prisma.workspaceMembership.findFirst({
      where: { id: membershipId, workspaceId: tenant.workspaceId },
      select: { departmentId: true },
    });
    if (!membership?.departmentId) {
      const [config, preference] = await Promise.all([
        this.getLeaderboardConfigData(tenant.workspaceId),
        this.getLeaderboardPreferenceData(tenant.workspaceId, membershipId),
      ]);
      return unavailableLeaderboard('DEPARTMENT', 'NO_DEPARTMENT', config, preference);
    }
    return this.getLeaderboard(tenant, 'DEPARTMENT', membership.departmentId);
  }

  async getDepartmentLeaderboard(tenant: WorkspaceTenantContext, departmentId: string) {
    const department = await this.prisma.department.findFirst({
      where: { id: departmentId, workspaceId: tenant.workspaceId },
      select: { id: true },
    });
    if (!department) throw new ForbiddenException('DEPARTMENT_NOT_FOUND');
    return this.getLeaderboard(tenant, 'DEPARTMENT', department.id);
  }

  async listPointRules(tenant: WorkspaceTenantContext, query: GamificationPointRulesQueryDto) {
    assertAnyPermission(tenant, [
      PermissionKeys.gamificationPointsView,
      PermissionKeys.gamificationPointsManageWorkspace,
      PermissionKeys.gamificationPointsManageDepartment,
    ]);
    const departmentId = query.departmentId ?? null;
    if (departmentId)
      await assertDepartmentInWorkspace(this.prisma, tenant.workspaceId, departmentId);
    const [completionRules, creationRules, departments, roles] = await Promise.all([
      this.prisma.gamificationPointRule.findMany({
        where: {
          workspaceId: tenant.workspaceId,
          OR: [{ scopeType: GamificationPointScopeType.WORKSPACE }, { departmentId }],
        },
        orderBy: pointRuleOrderBy,
        select: gamificationPointRuleSelect,
      }),
      this.prisma.gamificationCreationPointRule.findMany({
        where: {
          workspaceId: tenant.workspaceId,
          OR: [{ scopeType: GamificationPointScopeType.WORKSPACE }, { departmentId }],
        },
        orderBy: creationPointRuleOrderBy,
        select: gamificationCreationPointRuleSelect,
      }),
      this.prisma.department.findMany({
        where: { workspaceId: tenant.workspaceId },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: { id: true, name: true, status: true },
      }),
      this.prisma.role.findMany({
        where: {
          isActive: true,
          scope: RoleScope.WORKSPACE,
          OR: [{ isSystem: true, workspaceId: null }, { workspaceId: tenant.workspaceId }],
        },
        orderBy: [{ isSystem: 'desc' }, { name: 'asc' }, { id: 'asc' }],
        select: { id: true, key: true, name: true, isSystem: true, workspaceId: true },
      }),
    ]);
    return {
      workTypes: Object.values(GamificationPointWorkType),
      categories: Object.values(GamificationPointCategory),
      departmentId,
      departments,
      roles,
      completionRules,
      creationRules,
      effectiveCompletionRules: buildEffectiveCompletionRules(completionRules, departmentId),
      effectiveCreationRules: buildEffectiveCreationRules(creationRules, departmentId, roles),
      projectXpCategoryRequiredForNewProjects: false,
      projectXpCategoryRollout: 'NULLABLE_COMPATIBILITY_STAGE',
    };
  }

  async upsertCompletionPointRule(
    tenant: WorkspaceTenantContext,
    dto: UpsertGamificationCompletionPointRuleDto,
  ) {
    await this.assertGamificationFeatureAvailable(tenant);
    await this.assertPointRuleManagementScope(tenant, dto.scopeType, dto.departmentId ?? null);
    validatePointCategory(dto.workType, dto.category);
    const data = normalizeCompletionPointRule(dto);
    const updated = await this.prisma.$transaction(async (tx) => {
      await lockWorkspace(tx, tenant.workspaceId);
      if (dto.scopeType === GamificationPointScopeType.DEPARTMENT) {
        await assertDepartmentInWorkspace(tx, tenant.workspaceId, dto.departmentId ?? null);
      }
      const where = pointRuleKeyWhere(
        tenant.workspaceId,
        dto.scopeType,
        dto.departmentId ?? null,
        dto.workType,
        dto.category,
      );
      const existing = await tx.gamificationPointRule.findFirst({ where, select: { id: true } });
      if (existing) {
        return tx.gamificationPointRule.update({
          where: { id: existing.id },
          data,
          select: gamificationPointRuleSelect,
        });
      }
      return tx.gamificationPointRule.create({
        data: {
          workspaceId: tenant.workspaceId,
          departmentId:
            dto.scopeType === GamificationPointScopeType.DEPARTMENT ? dto.departmentId : null,
          scopeType: dto.scopeType,
          workType: dto.workType,
          category: dto.category,
          ...data,
        },
        select: gamificationPointRuleSelect,
      });
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'gamification.point_rule.upserted',
      entityType: 'GamificationPointRule',
      entityId: updated.id,
      metadata: pointRuleAuditMetadata(updated),
    });
    if (dto.scopeType === GamificationPointScopeType.WORKSPACE) {
      await this.recalculateGlobalCompletionScoreBaseline(dto.workType, dto.category);
    }
    return updated;
  }

  async removeCompletionPointRuleOverride(
    tenant: WorkspaceTenantContext,
    dto: RemoveGamificationPointRuleOverrideDto,
  ) {
    await this.assertGamificationFeatureAvailable(tenant);
    await this.assertPointRuleManagementScope(
      tenant,
      GamificationPointScopeType.DEPARTMENT,
      dto.departmentId,
    );
    validatePointCategory(dto.workType, dto.category);
    const removed = await this.prisma.$transaction(async (tx) => {
      await lockWorkspace(tx, tenant.workspaceId);
      await assertDepartmentInWorkspace(tx, tenant.workspaceId, dto.departmentId);
      const existing = await tx.gamificationPointRule.findFirst({
        where: pointRuleKeyWhere(
          tenant.workspaceId,
          GamificationPointScopeType.DEPARTMENT,
          dto.departmentId,
          dto.workType,
          dto.category,
        ),
        select: gamificationPointRuleSelect,
      });
      if (!existing) return null;
      await tx.gamificationPointRule.delete({ where: { id: existing.id } });
      return existing;
    });
    if (removed) {
      await this.audit.record({
        agencyId: tenant.agencyId,
        workspaceId: tenant.workspaceId,
        userId: tenant.userId,
        action: 'gamification.point_rule.override_removed',
        entityType: 'GamificationPointRule',
        entityId: removed.id,
        metadata: pointRuleAuditMetadata(removed),
      });
    }
    return { removed: Boolean(removed) };
  }

  async upsertCreationPointRule(
    tenant: WorkspaceTenantContext,
    dto: UpsertGamificationCreationPointRuleDto,
  ) {
    await this.assertGamificationFeatureAvailable(tenant);
    await this.assertPointRuleManagementScope(tenant, dto.scopeType, dto.departmentId ?? null);
    validatePointCategory(dto.workType, dto.category);
    const role = await this.assertWorkspaceRole(tenant.workspaceId, dto.roleId);
    const creationXp = requireBoundedInt(
      dto.creationXp,
      0,
      POINT_RULE_MAX_XP,
      'CREATION_XP_INVALID',
    );
    const updated = await this.prisma.$transaction(async (tx) => {
      await lockWorkspace(tx, tenant.workspaceId);
      if (dto.scopeType === GamificationPointScopeType.DEPARTMENT) {
        await assertDepartmentInWorkspace(tx, tenant.workspaceId, dto.departmentId ?? null);
      }
      const where = creationPointRuleKeyWhere(
        tenant.workspaceId,
        dto.scopeType,
        dto.departmentId ?? null,
        dto.workType,
        dto.category,
        dto.roleId,
      );
      const existing = await tx.gamificationCreationPointRule.findFirst({
        where,
        select: { id: true },
      });
      if (existing) {
        return tx.gamificationCreationPointRule.update({
          where: { id: existing.id },
          data: { isEnabled: dto.isEnabled, creationXp },
          select: gamificationCreationPointRuleSelect,
        });
      }
      return tx.gamificationCreationPointRule.create({
        data: {
          workspaceId: tenant.workspaceId,
          departmentId:
            dto.scopeType === GamificationPointScopeType.DEPARTMENT ? dto.departmentId : null,
          scopeType: dto.scopeType,
          workType: dto.workType,
          category: dto.category,
          roleId: role.id,
          isEnabled: dto.isEnabled,
          creationXp,
        },
        select: gamificationCreationPointRuleSelect,
      });
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'gamification.creation_point_rule.upserted',
      entityType: 'GamificationCreationPointRule',
      entityId: updated.id,
      metadata: creationPointRuleAuditMetadata(updated),
    });
    if (dto.scopeType === GamificationPointScopeType.WORKSPACE) {
      await this.recalculateGlobalCreationScoreBaseline(dto.workType, dto.category);
    }
    return updated;
  }

  async removeCreationPointRuleOverride(
    tenant: WorkspaceTenantContext,
    dto: RemoveGamificationPointRuleOverrideDto,
  ) {
    await this.assertGamificationFeatureAvailable(tenant);
    await this.assertPointRuleManagementScope(
      tenant,
      GamificationPointScopeType.DEPARTMENT,
      dto.departmentId,
    );
    validatePointCategory(dto.workType, dto.category);
    if (!dto.roleId) throw new BadRequestException('ROLE_REQUIRED');
    const roleId = dto.roleId;
    await this.assertWorkspaceRole(tenant.workspaceId, roleId);
    const removed = await this.prisma.$transaction(async (tx) => {
      await lockWorkspace(tx, tenant.workspaceId);
      await assertDepartmentInWorkspace(tx, tenant.workspaceId, dto.departmentId);
      const existing = await tx.gamificationCreationPointRule.findFirst({
        where: creationPointRuleKeyWhere(
          tenant.workspaceId,
          GamificationPointScopeType.DEPARTMENT,
          dto.departmentId,
          dto.workType,
          dto.category,
          roleId,
        ),
        select: gamificationCreationPointRuleSelect,
      });
      if (!existing) return null;
      await tx.gamificationCreationPointRule.delete({ where: { id: existing.id } });
      return existing;
    });
    if (removed) {
      await this.audit.record({
        agencyId: tenant.agencyId,
        workspaceId: tenant.workspaceId,
        userId: tenant.userId,
        action: 'gamification.creation_point_rule.override_removed',
        entityType: 'GamificationCreationPointRule',
        entityId: removed.id,
        metadata: creationPointRuleAuditMetadata(removed),
      });
    }
    return { removed: Boolean(removed) };
  }

  async previewCompletionPoints(tenant: WorkspaceTenantContext, dto: GamificationPointPreviewDto) {
    await this.assertGamificationFeatureAvailable(tenant);
    assertAnyPermission(tenant, [
      PermissionKeys.gamificationPointsView,
      PermissionKeys.gamificationPointsManageWorkspace,
      PermissionKeys.gamificationPointsManageDepartment,
    ]);
    const rule = normalizeCompletionPointRule(dto);
    return calculateCompletionPoints(
      { isEnabled: dto.isEnabled, ...rule },
      new Date(dto.completedAt),
      dto.dueAt ? new Date(dto.dueAt) : null,
    );
  }

  async getMyXpHistory(tenant: WorkspaceTenantContext, query: GamificationXpHistoryQueryDto) {
    const membershipId = requireWorkspaceMembership(tenant);
    const page = query.page;
    const pageSize = query.pageSize;
    const where: Prisma.GamificationXpEntryWhereInput = {
      workspaceId: tenant.workspaceId,
      membershipId,
      ...(query.entryType ? { entryType: query.entryType } : {}),
      ...(query.sourceType ? { sourceType: query.sourceType } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.gamificationXpEntry.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: xpEntrySelect,
      }),
      this.prisma.gamificationXpEntry.count({ where }),
    ]);
    return { items, page, pageSize, total };
  }

  async getMyRewardPointSummary(tenant: WorkspaceTenantContext) {
    const membershipId = requireWorkspaceMembership(tenant);
    const where = { workspaceId: tenant.workspaceId, membershipId };
    const [balance, earned, spent, refunded, count, last] = await Promise.all([
      this.prisma.gamificationRewardPointEntry.aggregate({ where, _sum: { amount: true } }),
      this.prisma.gamificationRewardPointEntry.aggregate({
        where: { ...where, entryType: GamificationRewardPointEntryType.EARN, amount: { gt: 0 } },
        _sum: { amount: true },
      }),
      this.prisma.gamificationRewardPointEntry.aggregate({
        where: { ...where, entryType: GamificationRewardPointEntryType.SPEND, amount: { lt: 0 } },
        _sum: { amount: true },
      }),
      this.prisma.gamificationRewardPointEntry.aggregate({
        where: { ...where, entryType: GamificationRewardPointEntryType.REFUND, amount: { gt: 0 } },
        _sum: { amount: true },
      }),
      this.prisma.gamificationRewardPointEntry.count({ where }),
      this.prisma.gamificationRewardPointEntry.findFirst({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { createdAt: true },
      }),
    ]);
    return {
      currentRewardPoints: Math.max(0, balance._sum.amount ?? 0),
      lifetimeEarnedRewardPoints: earned._sum.amount ?? 0,
      lifetimeSpentRewardPoints: Math.abs(spent._sum.amount ?? 0),
      lifetimeRefundedRewardPoints: refunded._sum.amount ?? 0,
      entryCount: count,
      lastRewardPointChangeAt: last?.createdAt ?? null,
    };
  }

  async getMyRewardPointHistory(
    tenant: WorkspaceTenantContext,
    query: GamificationRewardPointHistoryQueryDto,
  ) {
    const membershipId = requireWorkspaceMembership(tenant);
    const page = query.page;
    const pageSize = query.pageSize;
    const where = { workspaceId: tenant.workspaceId, membershipId };
    const [items, total] = await Promise.all([
      this.prisma.gamificationRewardPointEntry.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: rewardPointEntrySelect,
      }),
      this.prisma.gamificationRewardPointEntry.count({ where }),
    ]);
    return { items, page, pageSize, total };
  }

  async listAdminMembers(tenant: WorkspaceTenantContext, query: GamificationAdminMemberQueryDto) {
    assertAnyPermission(tenant, [
      PermissionKeys.gamificationAdjustmentsManage,
      PermissionKeys.gamificationReset,
    ]);
    const search = normalizeOptionalSearch(query.search);
    const members = await this.prisma.workspaceMembership.findMany({
      where: {
        workspaceId: tenant.workspaceId,
        status: MembershipStatus.ACTIVE,
        ...(search
          ? {
              OR: [
                { user: { name: { contains: search, mode: 'insensitive' } } },
                { user: { email: { contains: search, mode: 'insensitive' } } },
                { department: { name: { contains: search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      orderBy: [{ user: { name: 'asc' } }, { id: 'asc' }],
      take: query.pageSize,
      select: adminMemberSelect,
    });
    return {
      items: members.map((member) => ({
        membershipId: member.id,
        displayName: safeMemberDisplayName(member.user.name),
        departmentName: member.department?.name ?? null,
        status: member.status,
      })),
    };
  }

  async getAdminMemberBalance(tenant: WorkspaceTenantContext, targetMembershipId: string) {
    assertAnyPermission(tenant, [
      PermissionKeys.gamificationAdjustmentsManage,
      PermissionKeys.gamificationReset,
    ]);
    const member = await this.requireActiveTargetMembership(tenant.workspaceId, targetMembershipId);
    const [xp, rewardPoints] = await Promise.all([
      this.currentXpBalance(tenant.workspaceId, targetMembershipId),
      this.currentRewardPointBalance(tenant.workspaceId, targetMembershipId),
    ]);
    return {
      member,
      balances: {
        currentXp: xp,
        currentRewardPoints: rewardPoints,
      },
    };
  }

  async adjustAdminBalance(tenant: WorkspaceTenantContext, dto: GamificationAdminAdjustmentDto) {
    await this.assertGamificationFeatureAvailable(tenant);
    assertPermission(tenant, PermissionKeys.gamificationAdjustmentsManage);
    const actorMembershipId = requireWorkspaceMembership(tenant);
    const amount = signedAdminAmount(dto);
    const reason = requireBoundedText(dto.reason, REASON_MAX_LENGTH, 'GAMIFICATION_REASON_INVALID');
    const idempotencyKey = requireBoundedText(
      dto.idempotencyKey,
      IDEMPOTENCY_KEY_MAX_LENGTH,
      'GAMIFICATION_IDEMPOTENCY_KEY_INVALID',
    );
    const replay = await this.findAdminAdjustmentReplay(
      tenant,
      dto.targetMembershipId,
      dto.economy,
      dto.operation,
      Math.abs(amount),
      amount,
      reason,
      idempotencyKey,
    );
    if (replay)
      return {
        ...replay,
        member: await this.requireReplayTargetMembership(
          tenant.workspaceId,
          dto.targetMembershipId,
        ),
      };
    const target = await this.requireActiveTargetMembership(
      tenant.workspaceId,
      dto.targetMembershipId,
    );
    const before =
      dto.economy === GamificationAdminEconomy.XP
        ? await this.currentXpBalance(tenant.workspaceId, dto.targetMembershipId)
        : await this.currentRewardPointBalance(tenant.workspaceId, dto.targetMembershipId);
    const entry =
      dto.economy === GamificationAdminEconomy.XP
        ? await this.applyXpChange({
            workspaceId: tenant.workspaceId,
            membershipId: dto.targetMembershipId,
            amount,
            entryType: GamificationXpEntryType.ADJUSTMENT,
            sourceType: GamificationXpSourceType.MANUAL,
            sourceEvent: 'MANUAL_XP_ADJUSTMENT',
            actorMembershipId,
            reason,
            idempotencyKey,
          })
        : await this.applyRewardPointChange({
            workspaceId: tenant.workspaceId,
            membershipId: dto.targetMembershipId,
            amount,
            entryType: GamificationRewardPointEntryType.ADJUSTMENT,
            sourceType: GamificationRewardPointSourceType.MANUAL,
            sourceEvent: 'MANUAL_REWARD_POINT_ADJUSTMENT',
            actorMembershipId,
            reason,
            idempotencyKey,
          });
    const after =
      dto.economy === GamificationAdminEconomy.XP
        ? await this.currentXpBalance(tenant.workspaceId, dto.targetMembershipId)
        : await this.currentRewardPointBalance(tenant.workspaceId, dto.targetMembershipId);
    await this.recordAdminAuditIfMissing({
      tenant,
      action: 'gamification.admin.adjusted',
      entityId: entry.id,
      targetMembershipId: dto.targetMembershipId,
      economy: dto.economy,
      operation: dto.operation,
      amount: Math.abs(amount),
      signedAmount: amount,
      before,
      after,
      reason,
      idempotencyKey,
    });
    return {
      changed: true,
      member: target,
      economy: dto.economy,
      operation: dto.operation,
      amount: Math.abs(amount),
      before,
      after,
      entryId: entry.id,
    };
  }

  async resetAdminBalance(
    tenant: WorkspaceTenantContext,
    dto: GamificationAdminResetDto,
    refreshToken: string,
  ) {
    await this.assertGamificationFeatureAvailable(tenant);
    assertPermission(tenant, PermissionKeys.gamificationReset);
    const actorMembershipId = requireWorkspaceMembership(tenant);
    if (dto.confirmation !== 'RESET') throw new BadRequestException('RESET_CONFIRMATION_INVALID');
    const reason = requireBoundedText(dto.reason, REASON_MAX_LENGTH, 'GAMIFICATION_REASON_INVALID');
    const idempotencyKey = requireBoundedText(
      dto.idempotencyKey,
      120,
      'GAMIFICATION_IDEMPOTENCY_KEY_INVALID',
    );
    const replay = await this.findAdminOperationReplay(
      tenant,
      'gamification.admin.reset',
      dto.targetMembershipId,
      dto.economy,
      reason,
      idempotencyKey,
    );
    if (replay) return replay;
    return this.prisma.$transaction(async (tx) => {
      await this.consumeResetStepUpGrant(tx, tenant, dto, refreshToken);
      await lockMembership(tx, tenant.workspaceId, dto.targetMembershipId);
      const target = await assertActiveMembership(tx, tenant.workspaceId, dto.targetMembershipId);
      const before =
        dto.economy === GamificationAdminEconomy.XP
          ? await currentXpBalanceInTransaction(tx, tenant.workspaceId, dto.targetMembershipId)
          : await currentRewardPointBalanceInTransaction(
              tx,
              tenant.workspaceId,
              dto.targetMembershipId,
            );
      const chunks = resetChunks(before);
      const entryIds: string[] = [];
      for (const [index, chunk] of chunks.entries()) {
        const chunkKey = `${idempotencyKey}:reset:${index + 1}`;
        if (dto.economy === GamificationAdminEconomy.XP) {
          const entry = await tx.gamificationXpEntry.create({
            data: {
              workspaceId: tenant.workspaceId,
              membershipId: dto.targetMembershipId,
              amount: chunk,
              entryType: GamificationXpEntryType.ADJUSTMENT,
              sourceType: GamificationXpSourceType.MANUAL,
              sourceEvent: 'MANUAL_XP_RESET',
              idempotencyKey: chunkKey,
              actorMembershipId,
              reason,
            },
          });
          entryIds.push(entry.id);
        } else {
          const entry = await applyRewardPointChangeInTransaction(tx, {
            workspaceId: tenant.workspaceId,
            membershipId: dto.targetMembershipId,
            amount: chunk,
            entryType: GamificationRewardPointEntryType.ADJUSTMENT,
            sourceType: GamificationRewardPointSourceType.MANUAL,
            sourceEvent: 'MANUAL_REWARD_POINT_RESET',
            sourceEntityId: null,
            idempotencyKey: chunkKey,
            reversalOfEntryId: null,
            actorMembershipId,
            reason,
          });
          entryIds.push(entry.id);
        }
      }
      const after =
        dto.economy === GamificationAdminEconomy.XP
          ? await currentXpBalanceInTransaction(tx, tenant.workspaceId, dto.targetMembershipId)
          : await currentRewardPointBalanceInTransaction(
              tx,
              tenant.workspaceId,
              dto.targetMembershipId,
            );
      if (after !== 0) throw new ConflictException('RESET_DID_NOT_REACH_ZERO');
      const result = {
        changed: chunks.length > 0,
        member: adminMemberFromMembership(target),
        economy: dto.economy,
        before,
        after,
        entryIds,
      };
      await tx.auditLog.create({
        data: {
          superAgencyId: tenant.superAgencyId,
          agencyId: tenant.agencyId,
          workspaceId: tenant.workspaceId,
          userId: tenant.userId,
          action: 'gamification.admin.reset',
          entityType: 'WorkspaceMembership',
          entityId: dto.targetMembershipId,
          metadata: {
            targetMembershipId: dto.targetMembershipId,
            economy: dto.economy,
            before,
            after,
            reason,
            idempotencyKey,
            changed: result.changed,
            entryIds,
            stepUpVerified: true,
          },
        },
      });
      return result;
    });
  }

  async listRecentAdminActions(tenant: WorkspaceTenantContext) {
    assertAnyPermission(tenant, [
      PermissionKeys.gamificationAdjustmentsManage,
      PermissionKeys.gamificationReset,
    ]);
    const rows = await this.prisma.auditLog.findMany({
      where: {
        workspaceId: tenant.workspaceId,
        action: { in: ['gamification.admin.adjusted', 'gamification.admin.reset'] },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 10,
      select: {
        id: true,
        action: true,
        entityId: true,
        metadata: true,
        createdAt: true,
      },
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        action: row.action,
        targetMembershipId: row.entityId,
        createdAt: row.createdAt,
        metadata: safeAdminAuditMetadata(row.metadata),
      })),
    };
  }

  async getXpControlAnalyzer(tenant: WorkspaceTenantContext, query: GamificationXpControlQueryDto) {
    assertPermission(tenant, PermissionKeys.gamificationXpControlView);
    const rows = await this.computeXpControlRows(tenant.workspaceId);
    const search = normalizeOptionalSearch(query.search);
    let filtered = rows.filter((row) => {
      if (search && !row.displayName.toLowerCase().includes(search.toLowerCase())) return false;
      if (query.departmentId && row.departmentId !== query.departmentId) return false;
      if (query.status && row.status !== query.status) return false;
      if (query.hasDelta === true && row.delta === 0) return false;
      if (query.hasDelta === false && row.delta !== 0) return false;
      return true;
    });
    filtered = sortXpControlRows(filtered, query.sortBy, query.sortDirection);
    const pageSize = clampPageSize(query.pageSize, 100);
    const page = Math.max(1, query.page);
    const start = (page - 1) * pageSize;
    return {
      items: filtered.slice(start, start + pageSize),
      page,
      pageSize,
      total: filtered.length,
    };
  }

  async getXpControlMemberDetail(tenant: WorkspaceTenantContext, membershipId: string) {
    assertPermission(tenant, PermissionKeys.gamificationXpControlView);
    const row = (await this.computeXpControlRows(tenant.workspaceId)).find(
      (item) => item.membershipId === membershipId,
    );
    if (!row) throw new ForbiddenException('TARGET_MEMBERSHIP_NOT_FOUND');
    const breakdown = await this.xpSourceBreakdown(tenant.workspaceId, membershipId);
    return { member: row, breakdown };
  }

  async getXpControlMemberLog(
    tenant: WorkspaceTenantContext,
    membershipId: string,
    query: GamificationXpLogQueryDto,
  ) {
    assertPermission(tenant, PermissionKeys.gamificationXpControlView);
    await this.requireReplayTargetMembership(tenant.workspaceId, membershipId);
    const where: Prisma.GamificationXpEntryWhereInput = {
      workspaceId: tenant.workspaceId,
      membershipId,
      ...xpLogCategoryWhere(query.category),
    };
    const pageSize = clampPageSize(query.pageSize, 100);
    const page = Math.max(1, query.page);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.gamificationXpEntry.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          workXpEvent: true,
          reconciliation: true,
          actorMembership: { select: adminMemberSelect },
        },
      }),
      this.prisma.gamificationXpEntry.count({ where }),
    ]);
    return {
      items: items.map(serializeXpControlLogEntry),
      page,
      pageSize,
      total,
    };
  }

  async previewXpReconciliation(
    tenant: WorkspaceTenantContext,
    dto: GamificationXpReconciliationPreviewDto,
  ) {
    await this.assertGamificationFeatureAvailable(tenant);
    assertPermission(tenant, PermissionKeys.gamificationXpControlReconcile);
    const row = await this.xpControlRowForMembership(tenant.workspaceId, dto.targetMembershipId);
    if (row.memberStatus !== MembershipStatus.ACTIVE)
      throw new ForbiddenException('TARGET_MEMBERSHIP_INACTIVE');
    return reconciliationPreviewFromRow(row);
  }

  async applyXpReconciliation(
    tenant: WorkspaceTenantContext,
    dto: GamificationXpReconciliationApplyDto,
  ) {
    await this.assertGamificationFeatureAvailable(tenant);
    assertPermission(tenant, PermissionKeys.gamificationXpControlReconcile);
    const actorMembershipId = requireWorkspaceMembership(tenant);
    if (dto.confirmation !== 'RECONCILE')
      throw new BadRequestException('RECONCILIATION_CONFIRMATION_INVALID');
    const reason = requireBoundedText(dto.reason, REASON_MAX_LENGTH, 'GAMIFICATION_REASON_INVALID');
    const idempotencyKey = requireBoundedText(
      dto.idempotencyKey,
      IDEMPOTENCY_KEY_MAX_LENGTH,
      'GAMIFICATION_IDEMPOTENCY_KEY_INVALID',
    );
    return this.prisma.$transaction(async (tx) => {
      const preview = parseXpControlPreviewToken(dto.previewToken);
      if (preview.targetMembershipId !== dto.targetMembershipId) {
        throw new ConflictException('RECONCILIATION_IDEMPOTENCY_CONFLICT');
      }
      await lockMembership(tx, tenant.workspaceId, dto.targetMembershipId);
      const target = await assertActiveMembership(tx, tenant.workspaceId, dto.targetMembershipId);
      const existing = await tx.gamificationXpReconciliation.findUnique({
        where: {
          workspaceId_membershipId_idempotencyKey: {
            workspaceId: tenant.workspaceId,
            membershipId: dto.targetMembershipId,
            idempotencyKey,
          },
        },
        include: { xpEntries: true },
      });
      if (existing) {
        if (
          existing.claimedXpSnapshot !== preview.claimedXp ||
          existing.storedXpSnapshot !== preview.storedXp ||
          existing.currentXpBeforeSnapshot !== preview.currentXp ||
          existing.deltaSnapshot !== preview.delta ||
          existing.evidenceHash !== preview.evidenceHash ||
          existing.reason !== reason
        ) {
          throw new ConflictException('RECONCILIATION_IDEMPOTENCY_CONFLICT');
        }
        return reconciliationResult(existing, adminMemberFromMembership(target));
      }
      const row = await this.xpControlRowForMembershipInTransaction(
        tx,
        tenant.workspaceId,
        dto.targetMembershipId,
      );
      if (row.sourceAnomalyCount > 0 || row.status === 'NEEDS_REVIEW') {
        throw new ConflictException('RECONCILIATION_NEEDS_REVIEW');
      }
      if (
        row.claimedXp !== preview.claimedXp ||
        row.storedXp !== preview.storedXp ||
        row.currentXp !== preview.currentXp ||
        row.delta !== preview.delta ||
        row.status !== preview.status ||
        row.sourceAnomalyCount !== preview.sourceAnomalyCount
      ) {
        throw new ConflictException('RECONCILIATION_STALE');
      }
      if (row.delta === 0) throw new ConflictException('RECONCILIATION_NO_CHANGE');
      if (row.currentXp + row.delta < 0)
        throw new ConflictException('RECONCILIATION_FLOOR_CONFLICT');
      await assertWorkspaceMembership(tx, tenant.workspaceId, actorMembershipId);
      const reconciliation = await tx.gamificationXpReconciliation.create({
        data: {
          workspaceId: tenant.workspaceId,
          membershipId: dto.targetMembershipId,
          claimedXpSnapshot: row.claimedXp,
          storedXpSnapshot: row.storedXp,
          currentXpBeforeSnapshot: row.currentXp,
          deltaSnapshot: row.delta,
          adjustmentAmount: row.delta,
          currentXpAfterSnapshot: row.currentXp + row.delta,
          status: GamificationXpReconciliationStatus.APPLIED,
          reason,
          actorMembershipId,
          idempotencyKey,
          evidenceHash: preview.evidenceHash,
        },
        include: { xpEntries: true },
      });
      const entry = await applyXpChangeInTransaction(tx, {
        workspaceId: tenant.workspaceId,
        membershipId: dto.targetMembershipId,
        amount: row.delta,
        entryType: GamificationXpEntryType.ADJUSTMENT,
        sourceType: GamificationXpSourceType.SYSTEM,
        sourceEvent: 'XP_RECONCILIATION_ADJUSTMENT',
        sourceEntityId: reconciliation.id,
        idempotencyKey: `${idempotencyKey}:xp`,
        reversalOfEntryId: null,
        workXpEventId: null,
        reconciliationId: reconciliation.id,
        actorMembershipId,
        reason,
      });
      await tx.auditLog.create({
        data: {
          superAgencyId: tenant.superAgencyId,
          agencyId: tenant.agencyId,
          workspaceId: tenant.workspaceId,
          userId: tenant.userId,
          action: 'gamification.xp_control.reconciled',
          entityType: 'GamificationXpReconciliation',
          entityId: reconciliation.id,
          metadata: {
            targetMembershipId: dto.targetMembershipId,
            claimedXp: row.claimedXp,
            storedXp: row.storedXp,
            currentXpBefore: row.currentXp,
            delta: row.delta,
            currentXpAfter: row.currentXp + row.delta,
            reason,
            idempotencyKey,
            entryId: entry.id,
          },
        },
      });
      return reconciliationResult(
        { ...reconciliation, xpEntries: [entry] },
        adminMemberFromMembership(target),
      );
    });
  }

  private async xpControlRowForMembership(workspaceId: string, membershipId: string) {
    const row = (await this.computeXpControlRows(workspaceId)).find(
      (item) => item.membershipId === membershipId,
    );
    if (!row) throw new ForbiddenException('TARGET_MEMBERSHIP_NOT_FOUND');
    return row;
  }

  private async xpControlRowForMembershipInTransaction(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    membershipId: string,
  ) {
    const rows = await this.computeXpControlRows(workspaceId, tx);
    const row = rows.find((item) => item.membershipId === membershipId);
    if (!row) throw new ForbiddenException('TARGET_MEMBERSHIP_NOT_FOUND');
    return row;
  }

  private async computeXpControlRows(
    workspaceId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const [members, workEvents, workStored, current, lastActivity, reconciliations, activeLevels] =
      await Promise.all([
        client.workspaceMembership.findMany({
          where: { workspaceId },
          select: {
            id: true,
            status: true,
            departmentId: true,
            user: { select: { name: true, email: true } },
            department: { select: { name: true } },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: 1000,
        }),
        client.gamificationWorkXpEvent.findMany({
          where: { workspaceId, recipientMembershipId: { not: null } },
          select: {
            recipientMembershipId: true,
            outcome: true,
            skipReason: true,
            netXpSnapshot: true,
          },
        }),
        client.gamificationXpEntry.groupBy({
          by: ['membershipId'],
          where: {
            workspaceId,
            OR: [{ workXpEventId: { not: null } }, { reconciliationId: { not: null } }],
          },
          _sum: { amount: true },
        }),
        client.gamificationXpEntry.groupBy({
          by: ['membershipId'],
          where: { workspaceId },
          _sum: { amount: true },
        }),
        client.gamificationXpEntry.groupBy({
          by: ['membershipId'],
          where: { workspaceId },
          _max: { createdAt: true },
        }),
        client.gamificationXpReconciliation.groupBy({
          by: ['membershipId'],
          where: { workspaceId, status: GamificationXpReconciliationStatus.APPLIED },
          _count: { _all: true },
        }),
        client.gamificationLevel.findMany({
          where: { workspaceId, isActive: true },
          orderBy: [{ levelNumber: 'asc' }, { id: 'asc' }],
          select: gamificationLevelSelect,
        }),
      ]);
    const claimed = new Map<string, number>();
    const reviewCounts = new Map<string, number>();
    for (const event of workEvents) {
      const membershipId = event.recipientMembershipId;
      if (!membershipId) continue;
      if (event.outcome === GamificationWorkXpEventOutcome.APPLIED) {
        claimed.set(membershipId, (claimed.get(membershipId) ?? 0) + event.netXpSnapshot);
      } else if (event.skipReason === GamificationWorkXpSkipReason.AMBIGUOUS_ROLE) {
        reviewCounts.set(membershipId, (reviewCounts.get(membershipId) ?? 0) + 1);
      }
    }
    const stored = new Map(workStored.map((row) => [row.membershipId, row._sum.amount ?? 0]));
    const currentXp = new Map(current.map((row) => [row.membershipId, row._sum.amount ?? 0]));
    const last = new Map(lastActivity.map((row) => [row.membershipId, row._max.createdAt ?? null]));
    const reconciliationCount = new Map(
      reconciliations.map((row) => [row.membershipId, row._count._all]),
    );
    return members.map((member) => {
      const claimedXp = claimed.get(member.id) ?? 0;
      const storedXp = stored.get(member.id) ?? 0;
      const completeCurrentXp = Math.max(0, currentXp.get(member.id) ?? 0);
      const delta = claimedXp - storedXp;
      const sourceAnomalyCount = reviewCounts.get(member.id) ?? 0;
      const status =
        sourceAnomalyCount > 0
          ? 'NEEDS_REVIEW'
          : delta !== 0
            ? 'MISMATCH'
            : (reconciliationCount.get(member.id) ?? 0) > 0
              ? 'RECONCILED'
              : 'BALANCED';
      return {
        membershipId: member.id,
        displayName: safeMemberDisplayName(member.user.name || member.user.email),
        departmentId: member.departmentId,
        departmentName: member.department?.name ?? null,
        memberStatus: member.status,
        claimedXp,
        storedXp,
        currentXp: completeCurrentXp,
        delta,
        status,
        sourceAnomalyCount,
        lastActivityAt: last.get(member.id),
        currentLevel: deriveLevelProgress(completeCurrentXp, activeLevels).currentLevel,
      };
    });
  }

  async recalculateGlobalCompletionScoreBaseline(
    workType: GamificationPointWorkType,
    category: GamificationPointCategory,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    validatePointCategory(workType, category);
    const rules = await client.gamificationPointRule.findMany({
      where: {
        workType,
        category,
        scopeType: GamificationPointScopeType.WORKSPACE,
        departmentId: null,
        isEnabled: true,
        workspace: { status: WorkspaceStatus.ACTIVE },
      },
      select: gamificationPointRuleSelect,
      orderBy: [{ workspaceId: 'asc' }, { updatedAt: 'desc' }, { id: 'desc' }],
    });
    const byWorkspace = new Map<string, (typeof rules)[number]>();
    for (const rule of rules) {
      if (!byWorkspace.has(rule.workspaceId)) byWorkspace.set(rule.workspaceId, rule);
    }
    const contributions = [...byWorkspace.values()];
    const calculatedAt = new Date();
    if (contributions.length < GLOBAL_SCORE_MIN_WORKSPACES) {
      return client.gamificationGlobalScoreBaseline.create({
        data: {
          baselineVersion: randomUUID(),
          workType,
          category,
          scoreType: GamificationGlobalScoreBaselineScoreType.COMPLETION,
          status: GamificationGlobalScoreBaselineStatus.INSUFFICIENT_SAMPLE,
          eligibleWorkspaceCount: contributions.length,
          calculatedAt,
          calculationVersion: GLOBAL_SCORE_CALCULATION_VERSION,
        },
      });
    }
    return client.gamificationGlobalScoreBaseline.create({
      data: {
        baselineVersion: randomUUID(),
        workType,
        category,
        scoreType: GamificationGlobalScoreBaselineScoreType.COMPLETION,
        status: GamificationGlobalScoreBaselineStatus.READY,
        eligibleWorkspaceCount: contributions.length,
        normalizedBaseXp: roundHalfUpAverage(contributions.map((rule) => rule.baseXp)),
        normalizedEarlyBonusXp: roundHalfUpAverage(contributions.map((rule) => rule.earlyBonusXp)),
        normalizedEarlyThresholdMinutes: roundHalfUpAverage(
          contributions.map((rule) => rule.earlyThresholdMinutes ?? 0),
        ),
        normalizedLatePenaltyPercent: roundHalfUpAverage(
          contributions.map((rule) => rule.latePenaltyPercent),
        ),
        normalizedPenaltyIntervalMinutes: roundHalfUpAverage(
          contributions.map((rule) => rule.penaltyIntervalMinutes ?? 0),
        ),
        normalizedMaxPenaltyXp: roundHalfUpAverage(contributions.map((rule) => rule.maxPenaltyXp)),
        calculatedAt,
        calculationVersion: GLOBAL_SCORE_CALCULATION_VERSION,
      },
    });
  }

  async recalculateGlobalCreationScoreBaseline(
    workType: GamificationPointWorkType,
    category: GamificationPointCategory,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    validatePointCategory(workType, category);
    const rules = await client.gamificationCreationPointRule.findMany({
      where: {
        workType,
        category,
        scopeType: GamificationPointScopeType.WORKSPACE,
        departmentId: null,
        isEnabled: true,
        workspace: { status: WorkspaceStatus.ACTIVE },
      },
      select: gamificationCreationPointRuleSelect,
      orderBy: [{ workspaceId: 'asc' }, { roleId: 'asc' }, { updatedAt: 'desc' }, { id: 'desc' }],
    });
    const byWorkspace = new Map<string, number[]>();
    for (const rule of rules) {
      const bucket = byWorkspace.get(rule.workspaceId) ?? [];
      bucket.push(rule.creationXp);
      byWorkspace.set(rule.workspaceId, bucket);
    }
    const workspaceAverages = [...byWorkspace.values()].map((values) => roundHalfUpAverage(values));
    const calculatedAt = new Date();
    if (workspaceAverages.length < GLOBAL_SCORE_MIN_WORKSPACES) {
      return client.gamificationGlobalScoreBaseline.create({
        data: {
          baselineVersion: randomUUID(),
          workType,
          category,
          scoreType: GamificationGlobalScoreBaselineScoreType.CREATION,
          status: GamificationGlobalScoreBaselineStatus.INSUFFICIENT_SAMPLE,
          eligibleWorkspaceCount: workspaceAverages.length,
          calculatedAt,
          calculationVersion: GLOBAL_SCORE_CALCULATION_VERSION,
        },
      });
    }
    return client.gamificationGlobalScoreBaseline.create({
      data: {
        baselineVersion: randomUUID(),
        workType,
        category,
        scoreType: GamificationGlobalScoreBaselineScoreType.CREATION,
        status: GamificationGlobalScoreBaselineStatus.READY,
        eligibleWorkspaceCount: workspaceAverages.length,
        normalizedCreationXp: roundHalfUpAverage(workspaceAverages),
        calculatedAt,
        calculationVersion: GLOBAL_SCORE_CALCULATION_VERSION,
      },
    });
  }

  async getUserGlobalScore(workspaceId: string, membershipId: string) {
    const result = await this.prisma.gamificationGlobalScoreEvent.aggregate({
      where: {
        workspaceId,
        recipientMembershipId: membershipId,
        status: GamificationGlobalScoreEventStatus.APPLIED,
      },
      _sum: { normalizedScore: true },
    });
    return result._sum.normalizedScore ?? 0;
  }

  async getWorkspaceGlobalScore(workspaceId: string) {
    const result = await this.prisma.gamificationGlobalScoreEvent.aggregate({
      where: { workspaceId, status: GamificationGlobalScoreEventStatus.APPLIED },
      _sum: { normalizedScore: true },
    });
    return result._sum.normalizedScore ?? 0;
  }

  async getAgencyGlobalScoreFoundation(agencyId: string) {
    const result = await this.prisma.gamificationGlobalScoreEvent.aggregate({
      where: { workspace: { agencyId }, status: GamificationGlobalScoreEventStatus.APPLIED },
      _sum: { normalizedScore: true },
    });
    return result._sum.normalizedScore ?? 0;
  }

  async getAgencyGlobalLeaderboardSubaccounts(
    tenant: AgencyTenantContext,
    query: Pick<GamificationGlobalLeaderboardQueryDto, 'search'> = {},
  ) {
    assertPermission(tenant, PermissionKeys.gamificationGlobalLeaderboardViewAgency);
    const search = normalizedSearch(query.search);
    const searchFilter = search
      ? Prisma.sql`AND w.name ILIKE ${`%${escapeLike(search)}%`}`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<GlobalSubaccountLeaderboardSqlRow[]>(Prisma.sql`
      WITH workspace_scores AS (
        SELECT
          w.id AS workspace_id,
          w.name AS workspace_name,
          COALESCE(SUM(gse.normalized_score), 0)::int AS global_score,
          COUNT(DISTINCT gse.recipient_membership_id)::int AS scored_users
        FROM workspaces w
        JOIN gamification_global_score_events gse
          ON gse.workspace_id = w.id
         AND gse.status = 'APPLIED'
         AND gse.normalized_score IS NOT NULL
        WHERE w.agency_id = ${tenant.agencyId}::uuid
          ${searchFilter}
        GROUP BY w.id, w.name
      ),
      ranked AS (
        SELECT
          workspace_id,
          workspace_name,
          global_score,
          scored_users,
          DENSE_RANK() OVER (ORDER BY global_score DESC) AS rank
        FROM workspace_scores
      )
      SELECT
        workspace_id AS "workspaceId",
        workspace_name AS "workspaceName",
        global_score AS "globalScore",
        scored_users AS "scoredUsers",
        rank::int AS rank
      FROM ranked
      ORDER BY rank ASC, workspace_name ASC, workspace_id ASC
      LIMIT 10
    `);
    return {
      scope: 'AGENCY_SUBACCOUNTS',
      period: 'ALL_TIME',
      agencyId: tenant.agencyId,
      globalScore: await this.getAgencyGlobalScoreFoundation(tenant.agencyId),
      items: rows.map(globalSubaccountRow),
    };
  }

  async getAgencyGlobalLeaderboardUsers(
    tenant: AgencyTenantContext,
    workspaceId: string,
    query: GamificationGlobalLeaderboardQueryDto,
  ) {
    assertPermission(tenant, PermissionKeys.gamificationGlobalLeaderboardViewAgency);
    await this.assertWorkspaceInAgency(tenant.agencyId, workspaceId);
    return this.getGlobalUserLeaderboard({
      scope: 'AGENCY_SUBACCOUNT_USERS',
      agencyId: tenant.agencyId,
      workspaceId,
      query,
    });
  }

  async getSuperAgencyGlobalLeaderboardAgencies(
    tenant: SuperAgencyTenantContext,
    query: GamificationGlobalLeaderboardQueryDto,
  ) {
    assertPermission(tenant, PermissionKeys.gamificationGlobalLeaderboardViewSuperAgency);
    return this.getSuperAgencyGlobalAgencies(tenant.superAgencyId, query);
  }

  async getSuperAgencyGlobalLeaderboardSubaccounts(
    tenant: SuperAgencyTenantContext,
    query: GamificationGlobalLeaderboardQueryDto,
  ) {
    assertPermission(tenant, PermissionKeys.gamificationGlobalLeaderboardViewSuperAgency);
    return this.getSuperAgencyGlobalSubaccounts(tenant.superAgencyId, query);
  }

  async getSuperAgencyGlobalLeaderboardUsers(
    tenant: SuperAgencyTenantContext,
    query: GamificationGlobalLeaderboardQueryDto,
  ) {
    assertPermission(tenant, PermissionKeys.gamificationGlobalLeaderboardViewSuperAgency);
    return this.getGlobalUserLeaderboard({
      scope: 'SUPER_AGENCY_USERS',
      superAgencyId: tenant.superAgencyId,
      agencyId: query.agencyId,
      workspaceId: query.workspaceId,
      query,
    });
  }

  async getPlatformGlobalLeaderboard(
    tab: 'super-agencies' | 'agencies' | 'subaccounts' | 'users',
    query: GamificationGlobalLeaderboardQueryDto,
  ) {
    if (tab === 'super-agencies') return this.getPlatformGlobalSuperAgencies(query);
    if (tab === 'agencies') return this.getPlatformGlobalAgencies(query);
    if (tab === 'subaccounts') return this.getPlatformGlobalSubaccounts(query);
    return this.getGlobalUserLeaderboard({
      scope: 'PLATFORM_USERS',
      agencyId: query.agencyId,
      workspaceId: query.workspaceId,
      query,
    });
  }

  async getDeveloperGamificationHealth() {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [
      workTotal,
      workSkipped,
      xpEntries,
      rewardPointEntries,
      globalApplied,
      globalSkipped,
      insufficientBaselines,
      latestBaseline,
      reconciliations,
      achievementAwards,
      streakDays,
      leaderboardConfigs,
      otpChallenges,
      resetGrants,
    ] = await Promise.all([
      this.prisma.gamificationWorkXpEvent.count(),
      this.prisma.gamificationWorkXpEvent.count({
        where: { outcome: GamificationWorkXpEventOutcome.SKIPPED },
      }),
      this.prisma.gamificationXpEntry.count(),
      this.prisma.gamificationRewardPointEntry.count(),
      this.prisma.gamificationGlobalScoreEvent.count({
        where: { status: GamificationGlobalScoreEventStatus.APPLIED },
      }),
      this.prisma.gamificationGlobalScoreEvent.count({
        where: { status: { not: GamificationGlobalScoreEventStatus.APPLIED } },
      }),
      this.prisma.gamificationGlobalScoreBaseline.count({
        where: { status: GamificationGlobalScoreBaselineStatus.INSUFFICIENT_SAMPLE },
      }),
      this.prisma.gamificationGlobalScoreBaseline.findFirst({
        orderBy: { calculatedAt: 'desc' },
        select: { calculatedAt: true, status: true },
      }),
      this.prisma.gamificationXpReconciliation.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
      this.prisma.gamificationAchievementAward.count(),
      this.prisma.gamificationStreakDay.count(),
      this.prisma.gamificationLeaderboardConfig.count(),
      this.prisma.securityOtpChallenge.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
      this.prisma.securityStepUpGrant.count({
        where: {
          purpose: SecurityStepUpPurpose.GAMIFICATION_RESET,
          createdAt: { gte: sevenDaysAgo },
        },
      }),
    ]);
    const failedReconciliations =
      reconciliations.find((item) => item.status === GamificationXpReconciliationStatus.FAILED)
        ?._count._all ?? 0;
    return {
      generatedAt: new Date().toISOString(),
      cards: [
        healthCard('XP Engine', 'HEALTHY', workTotal, 'Work XP Events total'),
        healthCard(
          'Work XP Events',
          workSkipped > 0 ? 'WARNING' : 'HEALTHY',
          workSkipped,
          'Skipped work events',
        ),
        healthCard('XP Ledger', 'HEALTHY', xpEntries, 'XP ledger entries'),
        healthCard(
          'Reward Point Ledger',
          'HEALTHY',
          rewardPointEntries,
          'Reward Point ledger entries',
        ),
        healthCard(
          'Global Normalization',
          insufficientBaselines > 0 ? 'WARNING' : 'HEALTHY',
          insufficientBaselines,
          'Insufficient-sample baselines',
        ),
        healthCard(
          'Global Score Events',
          globalSkipped > 0 ? 'WARNING' : 'HEALTHY',
          globalApplied,
          'Applied global score events',
        ),
        healthCard(
          'XP Reconciliation',
          failedReconciliations > 0 ? 'WARNING' : 'HEALTHY',
          failedReconciliations,
          'Failed reconciliation attempts',
        ),
        healthCard('Achievement Evaluator', 'HEALTHY', achievementAwards, 'Achievement awards'),
        healthCard('Streak Evaluator', 'HEALTHY', streakDays, 'Streak days'),
        healthCard('Local Leaderboards', 'HEALTHY', leaderboardConfigs, 'Leaderboard configs'),
        healthCard(
          'Global Leaderboards',
          'HEALTHY',
          globalApplied,
          'Normalized score authority rows',
        ),
        healthCard(
          'OTP / Reset Security',
          'HEALTHY',
          otpChallenges + resetGrants,
          'Recent OTP challenges and reset grants',
        ),
      ],
      metrics: {
        workTotal,
        workSkipped,
        globalApplied,
        globalSkipped,
        insufficientBaselines,
        latestBaselineCalculatedAt: latestBaseline?.calculatedAt ?? null,
        reconciliationStatusCounts: reconciliations,
        recentOtpChallenges: otpChallenges,
        recentResetGrants: resetGrants,
      },
    };
  }

  async getDeveloperPointRules(query: DeveloperPointRuleInspectorQueryDto) {
    const where = developerPointRuleWhere(query);
    const [completionRules, creationRules] = await Promise.all([
      this.prisma.gamificationPointRule.findMany({
        where,
        orderBy: [
          { workspaceId: 'asc' },
          { departmentId: 'asc' },
          { workType: 'asc' },
          { category: 'asc' },
        ],
        take: 100,
        select: developerCompletionPointRuleSelect,
      }),
      this.prisma.gamificationCreationPointRule.findMany({
        where,
        orderBy: [
          { workspaceId: 'asc' },
          { departmentId: 'asc' },
          { workType: 'asc' },
          { category: 'asc' },
          { role: { name: 'asc' } },
        ],
        take: 100,
        select: developerCreationPointRuleSelect,
      }),
    ]);
    const mappedCompletionRules = completionRules.map((rule) => ({
      ...rule,
      effectiveSource: rule.departmentId ? 'DEPARTMENT_OVERRIDE' : 'WORKSPACE_DEFAULT',
    }));
    const mappedCreationRules = creationRules.map((rule) => ({
      ...rule,
      effectiveSource: rule.departmentId ? 'DEPARTMENT_OVERRIDE' : 'WORKSPACE_DEFAULT',
    }));
    return {
      completionRules: mappedCompletionRules,
      creationRules: mappedCreationRules,
      effectiveCompletionRules: buildDeveloperEffectiveRules(mappedCompletionRules, [
        'workspaceId',
        'workType',
        'category',
      ]),
      effectiveCreationRules: buildDeveloperEffectiveRules(mappedCreationRules, [
        'workspaceId',
        'workType',
        'category',
        'roleId',
      ]),
    };
  }

  async getDeveloperXpEvents(query: DeveloperXpEventMonitorQueryDto) {
    const paging = developerPaging(query);
    const where = developerWorkXpWhere(query);
    const [items, total] = await Promise.all([
      this.prisma.gamificationWorkXpEvent.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: paging.offset,
        take: paging.pageSize,
        select: developerWorkXpEventSelect,
      }),
      this.prisma.gamificationWorkXpEvent.count({ where }),
    ]);
    return developerPage(items, total, paging);
  }

  async getDeveloperXpEventDetail(id: string) {
    const event = await this.prisma.gamificationWorkXpEvent.findUnique({
      where: { id },
      select: developerWorkXpEventDetailSelect,
    });
    if (!event) throw new ForbiddenException('EVENT_NOT_FOUND');
    return event;
  }

  async getDeveloperNormalizationBaselines(query: DeveloperGamificationPageQueryDto) {
    const paging = developerPaging(query);
    const [items, total] = await Promise.all([
      this.prisma.gamificationGlobalScoreBaseline.findMany({
        orderBy: [{ calculatedAt: 'desc' }, { id: 'desc' }],
        skip: paging.offset,
        take: paging.pageSize,
      }),
      this.prisma.gamificationGlobalScoreBaseline.count(),
    ]);
    return developerPage(items, total, paging);
  }

  async getDeveloperNormalizationEvents(query: DeveloperNormalizationEventsQueryDto) {
    const paging = developerPaging(query);
    const where = developerGlobalScoreWhere(query);
    const [items, total] = await Promise.all([
      this.prisma.gamificationGlobalScoreEvent.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: paging.offset,
        take: paging.pageSize,
        select: developerGlobalScoreEventSelect,
      }),
      this.prisma.gamificationGlobalScoreEvent.count({ where }),
    ]);
    return developerPage(items, total, paging);
  }

  getDeveloperLeaderboardDiagnostics(query: DeveloperLeaderboardDiagnosticsQueryDto) {
    const scope = query.scope ?? 'workspace';
    return {
      scope,
      authority:
        scope === 'workspace' || scope === 'department' ? 'LOCAL XP' : 'NORMALIZED GLOBAL SCORE',
      rankSource:
        scope === 'workspace' || scope === 'department'
          ? 'Gamification XP ledger current balance'
          : 'SUM of signed APPLIED GamificationGlobalScoreEvent.normalizedScore',
      privacyBehavior:
        scope === 'workspace' || scope === 'department'
          ? 'Phase 10.6 local leaderboard privacy'
          : 'Phase 10.12 global leaderboard privacy',
      mutation: 'READ_ONLY_DIAGNOSTIC',
    };
  }

  async getDeveloperReconciliation(query: DeveloperReconciliationQueryDto) {
    const paging = developerPaging(query);
    const where: Prisma.GamificationXpReconciliationWhereInput = {
      ...(query.workspaceId ? { workspaceId: query.workspaceId } : {}),
      ...(query.membershipId ? { membershipId: query.membershipId } : {}),
      ...(query.status ? { status: query.status } : {}),
      createdAt: developerDateRange(query),
    };
    const [items, total, statusCounts] = await Promise.all([
      this.prisma.gamificationXpReconciliation.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: paging.offset,
        take: paging.pageSize,
        select: developerReconciliationSelect,
      }),
      this.prisma.gamificationXpReconciliation.count({ where }),
      this.prisma.gamificationXpReconciliation.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    return { ...developerPage(items, total, paging), statusCounts };
  }

  async getDeveloperLedgerHealth() {
    const [
      xpEntries,
      rewardPointEntries,
      duplicateXpKeys,
      duplicateRewardKeys,
      xpNegative,
      rpNegative,
    ] = await Promise.all([
      this.prisma.gamificationXpEntry.count(),
      this.prisma.gamificationRewardPointEntry.count(),
      this.prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
          SELECT COUNT(*)::bigint AS count FROM (
            SELECT workspace_id, membership_id, idempotency_key
            FROM gamification_xp_entries
            WHERE idempotency_key IS NOT NULL
            GROUP BY workspace_id, membership_id, idempotency_key
            HAVING COUNT(*) > 1
          ) duplicates
        `),
      this.prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
          SELECT COUNT(*)::bigint AS count FROM (
            SELECT workspace_id, membership_id, idempotency_key
            FROM gamification_reward_point_entries
            WHERE idempotency_key IS NOT NULL
            GROUP BY workspace_id, membership_id, idempotency_key
            HAVING COUNT(*) > 1
          ) duplicates
        `),
      this.prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
          SELECT COUNT(*)::bigint AS count FROM (
            SELECT workspace_id, membership_id, SUM(amount) AS balance
            FROM gamification_xp_entries
            GROUP BY workspace_id, membership_id
            HAVING SUM(amount) < 0
          ) negatives
        `),
      this.prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
          SELECT COUNT(*)::bigint AS count FROM (
            SELECT workspace_id, membership_id, SUM(amount) AS balance
            FROM gamification_reward_point_entries
            GROUP BY workspace_id, membership_id
            HAVING SUM(amount) < 0
          ) negatives
        `),
    ]);
    return {
      xp: {
        status: Number(xpNegative[0]?.count ?? 0) > 0 ? 'ERROR' : 'HEALTHY',
        entries: xpEntries,
        duplicateIdempotencyKeys: Number(duplicateXpKeys[0]?.count ?? 0),
        negativeBalances: Number(xpNegative[0]?.count ?? 0),
      },
      rewardPoints: {
        status: Number(rpNegative[0]?.count ?? 0) > 0 ? 'ERROR' : 'HEALTHY',
        entries: rewardPointEntries,
        duplicateIdempotencyKeys: Number(duplicateRewardKeys[0]?.count ?? 0),
        negativeBalances: Number(rpNegative[0]?.count ?? 0),
      },
      mutation: 'READ_ONLY_NO_AUTO_REPAIR',
    };
  }

  async getDeveloperAchievementsStreaksHealth() {
    const [achievementDefinitions, achievementAwards, badgeAwards, streakConfigs, streakDays] =
      await Promise.all([
        this.prisma.gamificationAchievementDefinition.count(),
        this.prisma.gamificationAchievementAward.count(),
        this.prisma.gamificationBadgeAward.count(),
        this.prisma.gamificationStreakConfig.count(),
        this.prisma.gamificationStreakDay.count(),
      ]);
    return {
      status: 'HEALTHY',
      achievementDefinitions,
      achievementAwards,
      badgeAwards,
      streakConfigs,
      streakDays,
      mutation: 'READ_ONLY_NO_AUTO_AWARD',
    };
  }

  async getDeveloperSecurityHealth() {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [otpTotal, expired, consumed, invalidated, resetGrants] = await Promise.all([
      this.prisma.securityOtpChallenge.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
      this.prisma.securityOtpChallenge.count({
        where: {
          createdAt: { gte: sevenDaysAgo },
          expiresAt: { lt: new Date() },
          consumedAt: null,
        },
      }),
      this.prisma.securityOtpChallenge.count({
        where: { createdAt: { gte: sevenDaysAgo }, consumedAt: { not: null } },
      }),
      this.prisma.securityOtpChallenge.count({
        where: { createdAt: { gte: sevenDaysAgo }, invalidatedAt: { not: null } },
      }),
      this.prisma.securityStepUpGrant.count({
        where: {
          purpose: SecurityStepUpPurpose.GAMIFICATION_RESET,
          createdAt: { gte: sevenDaysAgo },
        },
      }),
    ]);
    return {
      status: 'HEALTHY',
      windowDays: 7,
      otpChallenges: otpTotal,
      expiredChallenges: expired,
      consumedChallenges: consumed,
      invalidatedChallenges: invalidated,
      resetGrants,
      redactedFields: [
        'otpDigest',
        'otpCode',
        'otpPepper',
        'providerSecrets',
        'jwt',
        'passwordHash',
      ],
    };
  }

  async getDeveloperAudit(query: DeveloperAuditQueryDto) {
    const paging = developerPaging(query);
    const where: Prisma.AuditLogWhereInput = {
      ...(query.workspaceId ? { workspaceId: query.workspaceId } : {}),
      ...(query.agencyId ? { agencyId: query.agencyId } : {}),
      ...(query.action ? { action: { contains: query.action, mode: 'insensitive' } } : {}),
      createdAt: developerDateRange(query),
      OR: [
        { entityType: { contains: 'gamification', mode: 'insensitive' } },
        { action: { contains: 'gamification', mode: 'insensitive' } },
        { action: { contains: 'xp', mode: 'insensitive' } },
        { action: { contains: 'reward', mode: 'insensitive' } },
      ],
    };
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: paging.offset,
        take: paging.pageSize,
        select: {
          id: true,
          agencyId: true,
          workspaceId: true,
          userId: true,
          action: true,
          entityType: true,
          entityId: true,
          createdAt: true,
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return developerPage(items, total, paging);
  }

  private async xpSourceBreakdown(workspaceId: string, membershipId: string) {
    const entries = await this.prisma.gamificationXpEntry.findMany({
      where: { workspaceId, membershipId },
      select: {
        amount: true,
        sourceType: true,
        sourceEvent: true,
        workXpEvent: { select: { workType: true } },
        reconciliationId: true,
      },
    });
    const result = {
      taskXp: 0,
      projectXp: 0,
      ticketXp: 0,
      achievementXp: 0,
      streakXp: 0,
      manualXp: 0,
      resetXp: 0,
      reconciliationXp: 0,
      legacyXp: 0,
      currentXp: 0,
    };
    for (const entry of entries) {
      result.currentXp += entry.amount;
      if (entry.reconciliationId) result.reconciliationXp += entry.amount;
      else if (entry.workXpEvent?.workType === GamificationPointWorkType.TASK)
        result.taskXp += entry.amount;
      else if (entry.workXpEvent?.workType === GamificationPointWorkType.PROJECT)
        result.projectXp += entry.amount;
      else if (entry.workXpEvent?.workType === GamificationPointWorkType.TICKET)
        result.ticketXp += entry.amount;
      else if (entry.sourceType === GamificationXpSourceType.ACHIEVEMENT)
        result.achievementXp += entry.amount;
      else if (entry.sourceType === GamificationXpSourceType.STREAK)
        result.streakXp += entry.amount;
      else if (entry.sourceEvent.includes('RESET')) result.resetXp += entry.amount;
      else if (entry.sourceType === GamificationXpSourceType.MANUAL)
        result.manualXp += entry.amount;
      else result.legacyXp += entry.amount;
    }
    result.currentXp = Math.max(0, result.currentXp);
    return result;
  }

  private async requireActiveTargetMembership(workspaceId: string, membershipId: string) {
    const member = await this.prisma.workspaceMembership.findFirst({
      where: { id: membershipId, workspaceId, status: MembershipStatus.ACTIVE },
      select: adminMemberSelect,
    });
    if (!member) throw new ForbiddenException('TARGET_MEMBERSHIP_NOT_FOUND');
    return adminMemberFromMembership(member);
  }

  private async requireReplayTargetMembership(workspaceId: string, membershipId: string) {
    const member = await this.prisma.workspaceMembership.findFirst({
      where: { id: membershipId, workspaceId },
      select: adminMemberSelect,
    });
    if (!member) throw new ForbiddenException('TARGET_MEMBERSHIP_NOT_FOUND');
    return adminMemberFromMembership(member);
  }

  private async currentXpBalance(workspaceId: string, membershipId: string) {
    const aggregate = await this.prisma.gamificationXpEntry.aggregate({
      where: { workspaceId, membershipId },
      _sum: { amount: true },
    });
    return Math.max(0, aggregate._sum.amount ?? 0);
  }

  private async currentRewardPointBalance(workspaceId: string, membershipId: string) {
    const aggregate = await this.prisma.gamificationRewardPointEntry.aggregate({
      where: { workspaceId, membershipId },
      _sum: { amount: true },
    });
    return Math.max(0, aggregate._sum.amount ?? 0);
  }

  private async recordAdminAuditIfMissing(input: {
    tenant: WorkspaceTenantContext;
    action: string;
    entityId: string;
    targetMembershipId: string;
    economy: GamificationAdminEconomy;
    operation: string;
    amount: number;
    signedAmount: number;
    before: number;
    after: number;
    reason: string;
    idempotencyKey: string;
  }) {
    const existing = await this.prisma.auditLog.findFirst({
      where: {
        workspaceId: input.tenant.workspaceId,
        action: input.action,
        entityId: input.targetMembershipId,
        metadata: { path: ['idempotencyKey'], equals: input.idempotencyKey },
      },
      select: { id: true },
    });
    if (existing) return;
    await this.audit.record({
      agencyId: input.tenant.agencyId,
      workspaceId: input.tenant.workspaceId,
      userId: input.tenant.userId,
      action: input.action,
      entityType: 'WorkspaceMembership',
      entityId: input.targetMembershipId,
      metadata: {
        targetMembershipId: input.targetMembershipId,
        economy: input.economy,
        operation: input.operation,
        amount: input.amount,
        signedAmount: input.signedAmount,
        before: input.before,
        after: input.after,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
        entryId: input.entityId,
      },
    });
  }

  private async findAdminOperationReplay(
    tenant: WorkspaceTenantContext,
    action: string,
    targetMembershipId: string,
    economy: GamificationAdminEconomy,
    reason: string,
    idempotencyKey: string,
  ) {
    const existing = await this.prisma.auditLog.findFirst({
      where: {
        workspaceId: tenant.workspaceId,
        userId: tenant.userId,
        action,
        metadata: { path: ['idempotencyKey'], equals: idempotencyKey },
      },
      select: { metadata: true },
    });
    if (!existing?.metadata || typeof existing.metadata !== 'object') return null;
    const metadata = existing.metadata as Record<string, unknown>;
    if (
      metadata.targetMembershipId !== targetMembershipId ||
      metadata.economy !== economy ||
      metadata.reason !== reason
    ) {
      throw new ConflictException('ADMIN_IDEMPOTENCY_CONFLICT');
    }
    return {
      changed: Boolean(metadata.changed),
      member: await this.requireReplayTargetMembership(tenant.workspaceId, targetMembershipId),
      economy,
      before: Number(metadata.before ?? 0),
      after: Number(metadata.after ?? 0),
      entryIds: Array.isArray(metadata.entryIds) ? metadata.entryIds : [],
    };
  }

  private async findAdminAdjustmentReplay(
    tenant: WorkspaceTenantContext,
    targetMembershipId: string,
    economy: GamificationAdminEconomy,
    operation: GamificationAdminAdjustmentOperation,
    amount: number,
    signedAmount: number,
    reason: string,
    idempotencyKey: string,
  ) {
    const existing = await this.prisma.auditLog.findFirst({
      where: {
        workspaceId: tenant.workspaceId,
        userId: tenant.userId,
        action: 'gamification.admin.adjusted',
        metadata: { path: ['idempotencyKey'], equals: idempotencyKey },
      },
      select: { metadata: true },
    });
    if (!existing?.metadata || typeof existing.metadata !== 'object') return null;
    const metadata = existing.metadata as Record<string, unknown>;
    if (
      metadata.targetMembershipId !== targetMembershipId ||
      metadata.economy !== economy ||
      metadata.operation !== operation ||
      Number(metadata.amount) !== amount ||
      Number(metadata.signedAmount) !== signedAmount ||
      metadata.reason !== reason
    ) {
      throw new ConflictException('ADMIN_IDEMPOTENCY_CONFLICT');
    }
    return {
      changed: true,
      economy,
      operation,
      amount,
      before: Number(metadata.before ?? 0),
      after: Number(metadata.after ?? 0),
      entryId: typeof metadata.entryId === 'string' ? metadata.entryId : undefined,
    };
  }

  private async consumeResetStepUpGrant(
    tx: Prisma.TransactionClient,
    tenant: WorkspaceTenantContext,
    dto: GamificationAdminResetDto,
    refreshToken: string,
  ) {
    const session = await tx.refreshToken.findUnique({
      where: { tokenHash: this.tokens.createTokenHash(refreshToken) },
      select: { id: true, userId: true, expiresAt: true, revokedAt: true },
    });
    const now = new Date();
    if (
      !session ||
      session.userId !== tenant.userId ||
      session.revokedAt ||
      session.expiresAt <= now
    )
      throw new UnauthorizedException('STEP_UP_SESSION_INVALID');
    const update = await tx.securityStepUpGrant.updateMany({
      where: {
        id: dto.stepUpGrantId,
        userId: tenant.userId,
        refreshTokenId: session.id,
        workspaceId: tenant.workspaceId,
        targetMembershipId: dto.targetMembershipId,
        purpose: SecurityStepUpPurpose.GAMIFICATION_RESET,
        economy: dto.economy,
        usedAt: null,
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
    });
    if (update.count !== 1) throw new UnauthorizedException('STEP_UP_GRANT_INVALID');
  }

  async listLevels(tenant: WorkspaceTenantContext, query: GamificationLevelQueryDto) {
    const includeInactive =
      query.includeInactive === true &&
      (hasPermission(tenant, PermissionKeys.gamificationLevelsManage) ||
        hasPermission(tenant, '*'));
    const items = await this.prisma.gamificationLevel.findMany({
      where: {
        workspaceId: tenant.workspaceId,
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ levelNumber: 'asc' }, { id: 'asc' }],
      select: gamificationLevelSelect,
    });
    return { items };
  }

  async createLevel(tenant: WorkspaceTenantContext, dto: CreateGamificationLevelDto) {
    await this.assertGamificationFeatureAvailable(tenant);
    const input = normalizeLevelCreateInput(dto);
    const created = await this.prisma.$transaction(async (tx) => {
      await lockWorkspace(tx, tenant.workspaceId);
      try {
        const level = await tx.gamificationLevel.create({
          data: { workspaceId: tenant.workspaceId, ...input },
          select: gamificationLevelSelect,
        });
        await validateActiveLevelConfiguration(tx, tenant.workspaceId);
        return level;
      } catch (error) {
        if (isUniqueConstraintError(error)) throw new ConflictException('LEVEL_ALREADY_EXISTS');
        throw error;
      }
    });
    await this.recordLevelAudit(tenant, 'gamification.level.created', created.id, {
      levelNumber: created.levelNumber,
      xpThreshold: created.xpThreshold,
      isActive: created.isActive,
    });
    return created;
  }

  async updateLevel(
    tenant: WorkspaceTenantContext,
    levelId: string,
    dto: UpdateGamificationLevelDto,
  ) {
    await this.assertGamificationFeatureAvailable(tenant);
    const input = normalizeLevelUpdateInput(dto);
    if (Object.keys(input).length === 0) throw new BadRequestException('LEVEL_UPDATE_EMPTY');
    const updated = await this.prisma.$transaction(async (tx) => {
      await lockWorkspace(tx, tenant.workspaceId);
      const existing = await tx.gamificationLevel.findFirst({
        where: { id: levelId, workspaceId: tenant.workspaceId },
        select: { id: true },
      });
      if (!existing) throw new ConflictException('LEVEL_NOT_FOUND');
      try {
        const level = await tx.gamificationLevel.update({
          where: { id: levelId },
          data: input,
          select: gamificationLevelSelect,
        });
        await validateActiveLevelConfiguration(tx, tenant.workspaceId);
        return level;
      } catch (error) {
        if (isUniqueConstraintError(error)) throw new ConflictException('LEVEL_ALREADY_EXISTS');
        throw error;
      }
    });
    await this.recordLevelAudit(tenant, 'gamification.level.updated', updated.id, {
      levelNumber: updated.levelNumber,
      xpThreshold: updated.xpThreshold,
      isActive: updated.isActive,
    });
    return updated;
  }

  async listBadges(tenant: WorkspaceTenantContext, query: GamificationDefinitionQueryDto) {
    const includeInactive = canManageAchievements(tenant) && query.includeInactive === true;
    const [items, earned] = await Promise.all([
      this.prisma.gamificationBadgeDefinition.findMany({
        where: { workspaceId: tenant.workspaceId, ...(includeInactive ? {} : { isActive: true }) },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: gamificationBadgeSelect,
      }),
      this.prisma.gamificationBadgeAward.findMany({
        where: {
          workspaceId: tenant.workspaceId,
          membershipId: requireWorkspaceMembership(tenant),
        },
        orderBy: [{ earnedAt: 'desc' }, { id: 'desc' }],
        take: 100,
        select: gamificationBadgeAwardSelect,
      }),
    ]);
    return { items, earned };
  }

  async createBadge(tenant: WorkspaceTenantContext, dto: CreateGamificationBadgeDto) {
    await this.assertGamificationFeatureAvailable(tenant);
    const input = normalizeBadgeCreateInput(dto);
    const created = await this.prisma.$transaction(async (tx) => {
      await lockWorkspace(tx, tenant.workspaceId);
      try {
        return await tx.gamificationBadgeDefinition.create({
          data: { workspaceId: tenant.workspaceId, ...input },
          select: gamificationBadgeSelect,
        });
      } catch (error) {
        if (isUniqueConstraintError(error)) throw new ConflictException('BADGE_ALREADY_EXISTS');
        throw error;
      }
    });
    await this.recordDefinitionAudit(
      tenant,
      'gamification.badge_created',
      'GamificationBadgeDefinition',
      created.id,
      {
        definitionId: created.id,
        isActive: created.isActive,
      },
    );
    return created;
  }

  async updateBadge(
    tenant: WorkspaceTenantContext,
    badgeId: string,
    dto: UpdateGamificationBadgeDto,
  ) {
    await this.assertGamificationFeatureAvailable(tenant);
    const input = normalizeBadgeUpdateInput(dto);
    if (Object.keys(input).length === 0) throw new BadRequestException('BADGE_UPDATE_EMPTY');
    const updated = await this.prisma.$transaction(async (tx) => {
      await lockWorkspace(tx, tenant.workspaceId);
      const existing = await tx.gamificationBadgeDefinition.findFirst({
        where: { id: badgeId, workspaceId: tenant.workspaceId },
        select: { id: true, isActive: true },
      });
      if (!existing) throw new ConflictException('BADGE_NOT_FOUND');
      if (input.isActive === false && existing.isActive) {
        const activeAchievementCount = await tx.gamificationAchievementDefinition.count({
          where: { workspaceId: tenant.workspaceId, badgeDefinitionId: badgeId, isActive: true },
        });
        if (activeAchievementCount > 0)
          throw new ConflictException('BADGE_REFERENCED_BY_ACTIVE_ACHIEVEMENT');
      }
      try {
        return await tx.gamificationBadgeDefinition.update({
          where: { id: badgeId },
          data: input,
          select: gamificationBadgeSelect,
        });
      } catch (error) {
        if (isUniqueConstraintError(error)) throw new ConflictException('BADGE_ALREADY_EXISTS');
        throw error;
      }
    });
    await this.recordDefinitionAudit(
      tenant,
      updated.isActive ? 'gamification.badge_updated' : 'gamification.badge_archived',
      'GamificationBadgeDefinition',
      updated.id,
      {
        definitionId: updated.id,
        isActive: updated.isActive,
      },
    );
    return updated;
  }

  async listAchievements(tenant: WorkspaceTenantContext, query: GamificationDefinitionQueryDto) {
    const membershipId = requireWorkspaceMembership(tenant);
    const includeInactive = canManageAchievements(tenant) && query.includeInactive === true;
    const [definitions, awards] = await Promise.all([
      this.prisma.gamificationAchievementDefinition.findMany({
        where: { workspaceId: tenant.workspaceId, ...(includeInactive ? {} : { isActive: true }) },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: gamificationAchievementSelect,
      }),
      this.prisma.gamificationAchievementAward.findMany({
        where: { workspaceId: tenant.workspaceId, membershipId },
        orderBy: [{ earnedAt: 'desc' }, { id: 'desc' }],
        take: 100,
        select: gamificationAchievementAwardSelect,
      }),
    ]);
    const awardByDefinition = new Map(
      awards.map((award) => [award.achievementDefinitionId, award]),
    );
    const progressByType = await this.progressValuesForCriteria(tenant.workspaceId, membershipId, [
      ...new Set(definitions.map((definition) => definition.criterionType)),
    ]);
    return {
      items: definitions.map((definition) => {
        const award = awardByDefinition.get(definition.id) ?? null;
        const currentValue = progressByType.get(definition.criterionType) ?? 0;
        return {
          ...definition,
          earned: Boolean(award),
          earnedAt: award?.earnedAt ?? null,
          progress: {
            currentValue,
            targetValue: definition.criterionValue,
            percent: clampPercent(
              Math.floor(
                (Math.min(currentValue, definition.criterionValue) / definition.criterionValue) *
                  100,
              ),
            ),
          },
        };
      }),
      earned: awards,
    };
  }

  async createAchievement(tenant: WorkspaceTenantContext, dto: CreateGamificationAchievementDto) {
    await this.assertGamificationFeatureAvailable(tenant);
    const input = normalizeAchievementCreateInput(dto);
    const created = await this.prisma.$transaction(async (tx) => {
      await lockWorkspace(tx, tenant.workspaceId);
      if (input.badgeDefinitionId)
        await assertActiveBadge(tx, tenant.workspaceId, input.badgeDefinitionId);
      try {
        return await tx.gamificationAchievementDefinition.create({
          data: { workspaceId: tenant.workspaceId, ...input },
          select: gamificationAchievementSelect,
        });
      } catch (error) {
        if (isUniqueConstraintError(error))
          throw new ConflictException('ACHIEVEMENT_ALREADY_EXISTS');
        throw error;
      }
    });
    await this.recordDefinitionAudit(
      tenant,
      'gamification.achievement_created',
      'GamificationAchievementDefinition',
      created.id,
      achievementAuditMetadata(created),
    );
    return created;
  }

  async updateAchievement(
    tenant: WorkspaceTenantContext,
    achievementId: string,
    dto: UpdateGamificationAchievementDto,
  ) {
    await this.assertGamificationFeatureAvailable(tenant);
    const input = normalizeAchievementUpdateInput(dto);
    if (Object.keys(input).length === 0) throw new BadRequestException('ACHIEVEMENT_UPDATE_EMPTY');
    const updated = await this.prisma.$transaction(async (tx) => {
      await lockWorkspace(tx, tenant.workspaceId);
      const existing = await tx.gamificationAchievementDefinition.findFirst({
        where: { id: achievementId, workspaceId: tenant.workspaceId },
        select: { id: true },
      });
      if (!existing) throw new ConflictException('ACHIEVEMENT_NOT_FOUND');
      const badgeId = input.badgeDefinitionId === undefined ? undefined : input.badgeDefinitionId;
      if (badgeId) await assertActiveBadge(tx, tenant.workspaceId, badgeId as string);
      try {
        return await tx.gamificationAchievementDefinition.update({
          where: { id: achievementId },
          data: input,
          select: gamificationAchievementSelect,
        });
      } catch (error) {
        if (isUniqueConstraintError(error))
          throw new ConflictException('ACHIEVEMENT_ALREADY_EXISTS');
        throw error;
      }
    });
    await this.recordDefinitionAudit(
      tenant,
      updated.isActive ? 'gamification.achievement_updated' : 'gamification.achievement_archived',
      'GamificationAchievementDefinition',
      updated.id,
      achievementAuditMetadata(updated),
    );
    return updated;
  }

  async listRewards(tenant: WorkspaceTenantContext, query: GamificationRewardDefinitionQueryDto) {
    const canManage = hasPermission(tenant, PermissionKeys.gamificationRewardsManage);
    const includeInactive = canManage && query.includeInactive === true;
    const page = query.page;
    const pageSize = query.pageSize;
    const where = {
      workspaceId: tenant.workspaceId,
      ...(includeInactive ? {} : { isActive: true }),
    };
    const [items, total] = await Promise.all([
      this.prisma.gamificationRewardDefinition.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: gamificationRewardSelect,
      }),
      this.prisma.gamificationRewardDefinition.count({ where }),
    ]);
    return { items, page, pageSize, total };
  }

  async createReward(tenant: WorkspaceTenantContext, dto: CreateGamificationRewardDto) {
    await this.assertGamificationFeatureAvailable(tenant);
    const input = normalizeRewardCreateInput(dto);
    const created = await this.prisma.$transaction(async (tx) => {
      await lockWorkspace(tx, tenant.workspaceId);
      try {
        return await tx.gamificationRewardDefinition.create({
          data: { workspaceId: tenant.workspaceId, ...input },
          select: gamificationRewardSelect,
        });
      } catch (error) {
        if (isUniqueConstraintError(error)) throw new ConflictException('REWARD_ALREADY_EXISTS');
        throw error;
      }
    });
    await this.recordDefinitionAudit(
      tenant,
      'gamification.reward_created',
      'GamificationRewardDefinition',
      created.id,
      rewardAuditMetadata(created),
    );
    return created;
  }

  async updateReward(
    tenant: WorkspaceTenantContext,
    rewardId: string,
    dto: UpdateGamificationRewardDto,
  ) {
    await this.assertGamificationFeatureAvailable(tenant);
    const input = normalizeRewardUpdateInput(dto);
    if (Object.keys(input).length === 0) throw new BadRequestException('REWARD_UPDATE_EMPTY');
    const updated = await this.prisma.$transaction(async (tx) => {
      await lockWorkspace(tx, tenant.workspaceId);
      const existing = await tx.gamificationRewardDefinition.findFirst({
        where: { id: rewardId, workspaceId: tenant.workspaceId },
        select: { id: true, inventoryMode: true, availableQuantity: true },
      });
      if (!existing) throw new ConflictException('REWARD_NOT_FOUND');
      if (input.inventoryMode !== undefined && input.inventoryMode !== existing.inventoryMode) {
        const pending = await tx.gamificationRewardRedemption.count({
          where: {
            workspaceId: tenant.workspaceId,
            rewardDefinitionId: rewardId,
            status: GamificationRewardRedemptionStatus.PENDING,
          },
        });
        if (pending > 0) throw new ConflictException('REWARD_PENDING_REDEMPTIONS_EXIST');
      }
      const finalInventoryMode =
        (input.inventoryMode as GamificationRewardInventoryMode | undefined) ??
        existing.inventoryMode;
      const finalAvailableQuantity =
        input.availableQuantity === undefined
          ? existing.availableQuantity
          : (input.availableQuantity as number | null);
      if (finalInventoryMode === GamificationRewardInventoryMode.UNLIMITED) {
        input.availableQuantity = null;
      } else if (finalAvailableQuantity === null) {
        throw new BadRequestException('REWARD_AVAILABLE_QUANTITY_INVALID');
      }
      try {
        return await tx.gamificationRewardDefinition.update({
          where: { id: rewardId },
          data: input,
          select: gamificationRewardSelect,
        });
      } catch (error) {
        if (isUniqueConstraintError(error)) throw new ConflictException('REWARD_ALREADY_EXISTS');
        throw error;
      }
    });
    await this.recordDefinitionAudit(
      tenant,
      updated.isActive ? 'gamification.reward_updated' : 'gamification.reward_archived',
      'GamificationRewardDefinition',
      updated.id,
      rewardAuditMetadata(updated),
    );
    return updated;
  }

  async redeemReward(
    tenant: WorkspaceTenantContext,
    rewardId: string,
    dto: RedeemGamificationRewardDto,
  ) {
    await this.assertGamificationFeatureAvailable(tenant);
    const membershipId = requireWorkspaceMembership(tenant);
    const idempotencyKey = requireBoundedText(
      dto.idempotencyKey,
      IDEMPOTENCY_KEY_MAX_LENGTH,
      'REWARD_REDEMPTION_IDEMPOTENCY_KEY_INVALID',
    );
    return this.prisma.$transaction(async (tx) => {
      await lockMembership(tx, tenant.workspaceId, membershipId);
      await lockRewardDefinition(tx, tenant.workspaceId, rewardId);
      const existing = await tx.gamificationRewardRedemption.findFirst({
        where: { workspaceId: tenant.workspaceId, membershipId, idempotencyKey },
        select: gamificationRewardRedemptionSelect,
      });
      if (existing) {
        if (existing.rewardDefinitionId !== rewardId)
          throw new ConflictException('REWARD_REDEMPTION_IDEMPOTENCY_CONFLICT');
        return existing;
      }
      await assertActiveMembership(tx, tenant.workspaceId, membershipId);
      const reward = await tx.gamificationRewardDefinition.findFirst({
        where: { id: rewardId, workspaceId: tenant.workspaceId, isActive: true },
        select: gamificationRewardSelect,
      });
      if (!reward) throw new ConflictException('REWARD_NOT_REDEEMABLE');
      if (
        reward.inventoryMode === GamificationRewardInventoryMode.LIMITED &&
        (reward.availableQuantity ?? 0) <= 0
      ) {
        throw new ConflictException('REWARD_OUT_OF_STOCK');
      }
      await assertRewardPointBalanceFloor(tx, tenant.workspaceId, membershipId, -reward.pointsCost);
      const redemption = await tx.gamificationRewardRedemption.create({
        data: {
          workspaceId: tenant.workspaceId,
          membershipId,
          rewardDefinitionId: reward.id,
          status: GamificationRewardRedemptionStatus.PENDING,
          rewardNameSnapshot: reward.name,
          pointsCostSnapshot: reward.pointsCost,
          inventoryModeSnapshot: reward.inventoryMode,
          idempotencyKey,
        },
        select: gamificationRewardRedemptionSelect,
      });
      await applyRewardPointChangeInTransaction(tx, {
        workspaceId: tenant.workspaceId,
        membershipId,
        amount: -reward.pointsCost,
        entryType: GamificationRewardPointEntryType.SPEND,
        sourceType: GamificationRewardPointSourceType.REWARD_REDEMPTION,
        sourceEvent: 'REWARD_REDEEMED',
        sourceEntityId: redemption.id,
        idempotencyKey: `reward-redemption:${redemption.id}:spend`,
        actorMembershipId: membershipId,
        reason: 'Reward redeemed',
      });
      if (reward.inventoryMode === GamificationRewardInventoryMode.LIMITED) {
        await tx.gamificationRewardDefinition.update({
          where: { id: reward.id },
          data: { availableQuantity: { decrement: 1 } },
        });
      }
      return redemption;
    });
  }

  async listMyRewardRedemptions(
    tenant: WorkspaceTenantContext,
    query: GamificationRewardRedemptionQueryDto,
  ) {
    const membershipId = requireWorkspaceMembership(tenant);
    return this.listRewardRedemptionsForWhere(query, {
      workspaceId: tenant.workspaceId,
      membershipId,
      ...(query.status ? { status: query.status } : {}),
    });
  }

  async listRewardRedemptions(
    tenant: WorkspaceTenantContext,
    query: GamificationRewardRedemptionQueryDto,
  ) {
    return this.listRewardRedemptionsForWhere(query, {
      workspaceId: tenant.workspaceId,
      ...(query.status ? { status: query.status } : {}),
    });
  }

  async fulfillRewardRedemption(tenant: WorkspaceTenantContext, redemptionId: string) {
    await this.assertGamificationFeatureAvailable(tenant);
    const actorMembershipId = requireWorkspaceMembership(tenant);
    return this.prisma.$transaction(async (tx) => {
      await lockMembership(tx, tenant.workspaceId, actorMembershipId);
      await lockRedemption(tx, tenant.workspaceId, redemptionId);
      await assertWorkspaceMembership(tx, tenant.workspaceId, actorMembershipId);
      const redemption = await tx.gamificationRewardRedemption.findFirst({
        where: { id: redemptionId, workspaceId: tenant.workspaceId },
        select: { id: true, status: true },
      });
      if (!redemption) throw new ConflictException('REDEMPTION_NOT_FOUND');
      if (redemption.status !== GamificationRewardRedemptionStatus.PENDING)
        throw new ConflictException('REDEMPTION_NOT_PENDING');
      return tx.gamificationRewardRedemption.update({
        where: { id: redemptionId },
        data: {
          status: GamificationRewardRedemptionStatus.FULFILLED,
          fulfilledAt: new Date(),
          fulfilledByMembershipId: actorMembershipId,
        },
        select: gamificationRewardRedemptionSelect,
      });
    });
  }

  async cancelRewardRedemption(
    tenant: WorkspaceTenantContext,
    redemptionId: string,
    dto: CancelGamificationRewardRedemptionDto,
  ) {
    await this.assertGamificationFeatureAvailable(tenant);
    const actorMembershipId = requireWorkspaceMembership(tenant);
    const reason = normalizeBoundedText(
      dto.reason,
      REASON_MAX_LENGTH,
      'REDEMPTION_CANCEL_REASON_INVALID',
    );
    return this.prisma.$transaction(async (tx) => {
      await lockMembership(tx, tenant.workspaceId, actorMembershipId);
      await lockRedemption(tx, tenant.workspaceId, redemptionId);
      await assertWorkspaceMembership(tx, tenant.workspaceId, actorMembershipId);
      const redemption = await tx.gamificationRewardRedemption.findFirst({
        where: { id: redemptionId, workspaceId: tenant.workspaceId },
        select: gamificationRewardRedemptionSelect,
      });
      if (!redemption) throw new ConflictException('REDEMPTION_NOT_FOUND');
      if (redemption.status !== GamificationRewardRedemptionStatus.PENDING)
        throw new ConflictException('REDEMPTION_NOT_PENDING');
      const cancelled = await tx.gamificationRewardRedemption.update({
        where: { id: redemptionId },
        data: {
          status: GamificationRewardRedemptionStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledByMembershipId: actorMembershipId,
          cancelReason: reason,
        },
        select: gamificationRewardRedemptionSelect,
      });
      await applyRewardPointChangeInTransaction(tx, {
        workspaceId: tenant.workspaceId,
        membershipId: redemption.membershipId,
        amount: redemption.pointsCostSnapshot,
        entryType: GamificationRewardPointEntryType.REFUND,
        sourceType: GamificationRewardPointSourceType.REWARD_REDEMPTION,
        sourceEvent: 'REWARD_REDEMPTION_CANCELLED',
        sourceEntityId: redemption.id,
        idempotencyKey: `reward-redemption:${redemption.id}:refund`,
        actorMembershipId,
        reason: reason ?? 'Reward redemption cancelled',
      });
      if (redemption.inventoryModeSnapshot === GamificationRewardInventoryMode.LIMITED) {
        await tx.gamificationRewardDefinition.update({
          where: { id: redemption.rewardDefinitionId },
          data: { availableQuantity: { increment: 1 } },
        });
      }
      return cancelled;
    });
  }

  private async listRewardRedemptionsForWhere(
    query: GamificationRewardRedemptionQueryDto,
    where: Prisma.GamificationRewardRedemptionWhereInput,
  ) {
    const page = query.page;
    const pageSize = query.pageSize;
    const [items, total] = await Promise.all([
      this.prisma.gamificationRewardRedemption.findMany({
        where,
        orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: gamificationRewardRedemptionSelect,
      }),
      this.prisma.gamificationRewardRedemption.count({ where }),
    ]);
    return { items, page, pageSize, total };
  }

  async applyXpChange(input: ApplyXpChangeInput) {
    const normalized = normalizeApplyInput(input);
    const entry = await this.prisma.$transaction(async (tx) => {
      await lockMembership(tx, normalized.workspaceId, normalized.membershipId);
      const existing = normalized.idempotencyKey
        ? await tx.gamificationXpEntry.findFirst({
            where: {
              workspaceId: normalized.workspaceId,
              membershipId: normalized.membershipId,
              idempotencyKey: normalized.idempotencyKey,
            },
          })
        : null;
      if (existing) return assertIdempotentReplay(existing, normalized);
      await assertActiveMembership(tx, normalized.workspaceId, normalized.membershipId);
      if (normalized.actorMembershipId)
        await assertWorkspaceMembership(tx, normalized.workspaceId, normalized.actorMembershipId);
      await assertBalanceFloor(
        tx,
        normalized.workspaceId,
        normalized.membershipId,
        normalized.amount,
      );
      try {
        return await tx.gamificationXpEntry.create({ data: normalized });
      } catch (error) {
        if (isUniqueConstraintError(error) && normalized.idempotencyKey) {
          const replay = await tx.gamificationXpEntry.findFirstOrThrow({
            where: {
              workspaceId: normalized.workspaceId,
              membershipId: normalized.membershipId,
              idempotencyKey: normalized.idempotencyKey,
            },
          });
          return assertIdempotentReplay(replay, normalized);
        }
        throw error;
      }
    });
    const depth = input.achievementEvaluationDepth ?? 0;
    if (depth < MAX_ACHIEVEMENT_CHAIN_DEPTH) {
      await this.evaluateXpAchievements({
        workspaceId: normalized.workspaceId,
        membershipId: normalized.membershipId,
        sourceEventId: normalized.idempotencyKey ?? entry.id,
        depth,
      });
    }
    await this.realtime.publishMember(normalized.workspaceId, normalized.membershipId, {
      eventType: 'GAMIFICATION_XP_CHANGED',
      entityType: 'GAMIFICATION',
      entityId: entry.id,
      actorMembershipId: normalized.actorMembershipId ?? null,
      payload: {
        entryId: entry.id,
        membershipId: normalized.membershipId,
        amount: normalized.amount,
        sourceType: normalized.sourceType,
        sourceEntityId: normalized.sourceEntityId,
      },
    });
    await this.realtime.publishWorkspace({
      eventType: 'GAMIFICATION_LEADERBOARD_CHANGED',
      workspaceId: normalized.workspaceId,
      entityType: 'GAMIFICATION',
      entityId: entry.id,
      actorMembershipId: normalized.actorMembershipId ?? null,
      payload: { membershipId: normalized.membershipId, sourceType: normalized.sourceType },
    });
    return entry;
  }

  async evaluateTaskCompletionAchievements(workspaceId: string, taskId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, workspaceId, deletedAt: null, statusDefinition: { isTerminal: true } },
      select: {
        id: true,
        assignees: {
          where: { membership: { status: MembershipStatus.ACTIVE } },
          select: { membershipId: true },
        },
      },
    });
    if (!task) return;
    const occurredAt = await this.firstTaskCompletionAt(workspaceId, task.id);
    for (const assignee of task.assignees) {
      await this.evaluateAchievementsForCriterion({
        workspaceId,
        membershipId: assignee.membershipId,
        criterionType: GamificationAchievementCriterionType.TASK_COMPLETED_COUNT,
        sourceEventId: `task:${task.id}:completed`,
        depth: 0,
      });
      await this.qualifyStreakDay({
        workspaceId,
        membershipId: assignee.membershipId,
        qualificationType: GamificationStreakQualificationType.TASK_COMPLETED,
        sourceEntityId: task.id,
        occurredAt,
      });
    }
  }

  async evaluateProjectCompletionAchievements(workspaceId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        workspaceId,
        archivedAt: null,
        statusDefinition: { isTerminal: true },
        ownerMembership: { status: MembershipStatus.ACTIVE },
      },
      select: { id: true, ownerMembershipId: true },
    });
    if (!project) return;
    await this.evaluateAchievementsForCriterion({
      workspaceId,
      membershipId: project.ownerMembershipId,
      criterionType: GamificationAchievementCriterionType.PROJECT_COMPLETED_COUNT,
      sourceEventId: `project:${project.id}:completed`,
      depth: 0,
    });
  }

  async evaluateTicketResolutionAchievements(
    workspaceId: string,
    ticketId: string,
    assignedToMembershipId: string | null,
  ) {
    const firstResolution = await this.firstTicketResolution(workspaceId, ticketId);
    const creditedMembershipId = firstResolution?.membershipId ?? assignedToMembershipId;
    if (!creditedMembershipId) return;
    await this.evaluateAchievementsForCriterion({
      workspaceId,
      membershipId: creditedMembershipId,
      criterionType: GamificationAchievementCriterionType.TICKET_RESOLVED_COUNT,
      sourceEventId: `ticket:${ticketId}:resolved`,
      depth: 0,
    });
    if (firstResolution?.membershipId) {
      await this.qualifyStreakDay({
        workspaceId,
        membershipId: firstResolution.membershipId,
        qualificationType: GamificationStreakQualificationType.TICKET_RESOLVED,
        sourceEntityId: ticketId,
        occurredAt: firstResolution.occurredAt,
      });
    }
  }

  async handleTaskCreationXp(
    workspaceId: string,
    taskId: string,
    triggeredByMembershipId: string | null,
  ) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, workspaceId, deletedAt: null },
      select: {
        id: true,
        title: true,
        priority: true,
        departmentId: true,
        department: { select: { name: true } },
      },
    });
    if (!task) return;
    await this.applyWorkCreationXp({
      workspaceId,
      workType: GamificationPointWorkType.TASK,
      sourceEntityId: task.id,
      sourceLabel: task.title,
      category: categoryFrom(task.priority),
      departmentId: task.departmentId,
      departmentName: task.department?.name ?? null,
      creatorMembershipId: triggeredByMembershipId,
      occurredAt: new Date(),
    });
  }

  async handleProjectCreationXp(
    workspaceId: string,
    projectId: string,
    triggeredByMembershipId: string | null,
  ) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId, archivedAt: null },
      select: {
        id: true,
        name: true,
        xpCategory: true,
        departmentId: true,
        department: { select: { name: true } },
      },
    });
    if (!project) return;
    await this.applyWorkCreationXp({
      workspaceId,
      workType: GamificationPointWorkType.PROJECT,
      sourceEntityId: project.id,
      sourceLabel: project.name,
      category: categoryFrom(project.xpCategory),
      departmentId: project.departmentId,
      departmentName: project.department?.name ?? null,
      creatorMembershipId: triggeredByMembershipId,
      occurredAt: new Date(),
    });
  }

  async handleTicketCreationXp(
    workspaceId: string,
    ticketId: string,
    triggeredByMembershipId: string | null,
  ) {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id: ticketId, workspaceId, deletedAt: null },
      select: {
        id: true,
        ticketNumber: true,
        subject: true,
        priority: true,
        departmentId: true,
        department: { select: { name: true } },
      },
    });
    if (!ticket) return;
    await this.applyWorkCreationXp({
      workspaceId,
      workType: GamificationPointWorkType.TICKET,
      sourceEntityId: ticket.id,
      sourceLabel: `${ticket.ticketNumber} ${ticket.subject}`,
      category: categoryFrom(ticket.priority),
      departmentId: ticket.departmentId,
      departmentName: ticket.department?.name ?? null,
      creatorMembershipId: triggeredByMembershipId,
      occurredAt: new Date(),
    });
  }

  async handleTaskCompletionXp(
    workspaceId: string,
    taskId: string,
    triggeredByMembershipId: string | null,
  ) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, workspaceId, deletedAt: null, statusDefinition: { isTerminal: true } },
      select: {
        id: true,
        title: true,
        priority: true,
        dueAt: true,
        departmentId: true,
        department: { select: { name: true } },
        assignees: {
          select: {
            membershipId: true,
            membership: { select: { status: true } },
          },
        },
      },
    });
    if (!task) return;
    await this.applyWorkCompletionXpToRecipients({
      workspaceId,
      workType: GamificationPointWorkType.TASK,
      sourceEntityId: task.id,
      sourceLabel: task.title,
      category: categoryFrom(task.priority),
      departmentId: task.departmentId,
      departmentName: task.department?.name ?? null,
      recipients: task.assignees.map((assignee) => ({
        membershipId: assignee.membershipId,
        active: assignee.membership.status === MembershipStatus.ACTIVE,
      })),
      triggeredByMembershipId,
      dueAt: task.dueAt,
      completedAt: new Date(),
    });
  }

  async handleProjectCompletionXp(
    workspaceId: string,
    projectId: string,
    triggeredByMembershipId: string | null,
  ) {
    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        workspaceId,
        archivedAt: null,
        statusDefinition: { isTerminal: true },
      },
      select: {
        id: true,
        name: true,
        xpCategory: true,
        dueAt: true,
        departmentId: true,
        department: { select: { name: true } },
        ownerMembershipId: true,
        ownerMembership: { select: { status: true } },
      },
    });
    if (!project) return;
    await this.applyWorkCompletionXpToRecipients({
      workspaceId,
      workType: GamificationPointWorkType.PROJECT,
      sourceEntityId: project.id,
      sourceLabel: project.name,
      category: categoryFrom(project.xpCategory),
      departmentId: project.departmentId,
      departmentName: project.department?.name ?? null,
      recipients: [
        {
          membershipId: project.ownerMembershipId,
          active: project.ownerMembership.status === MembershipStatus.ACTIVE,
        },
      ],
      triggeredByMembershipId,
      dueAt: project.dueAt,
      completedAt: new Date(),
    });
  }

  async handleTicketCompletionXp(
    workspaceId: string,
    ticketId: string,
    resolverMembershipId: string | null,
    triggeredByMembershipId: string | null,
  ) {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id: ticketId, workspaceId, deletedAt: null, statusDefinition: { isTerminal: true } },
      select: {
        id: true,
        ticketNumber: true,
        subject: true,
        priority: true,
        departmentId: true,
        department: { select: { name: true } },
        gamificationResolutionTargetAt: true,
        slaState: { select: { resolutionDueAt: true } },
        assignedToMembership: { select: { status: true } },
      },
    });
    if (!ticket) return;
    await this.applyWorkCompletionXpToRecipients({
      workspaceId,
      workType: GamificationPointWorkType.TICKET,
      sourceEntityId: ticket.id,
      sourceLabel: `${ticket.ticketNumber} ${ticket.subject}`,
      category: categoryFrom(ticket.priority),
      departmentId: ticket.departmentId,
      departmentName: ticket.department?.name ?? null,
      recipients: resolverMembershipId
        ? [
            {
              membershipId: resolverMembershipId,
              active: ticket.assignedToMembership?.status === MembershipStatus.ACTIVE,
            },
          ]
        : [],
      triggeredByMembershipId,
      dueAt: ticket.gamificationResolutionTargetAt ?? ticket.slaState?.resolutionDueAt ?? null,
      completedAt: new Date(),
      emptyRecipientSkipReason: GamificationWorkXpSkipReason.INACTIVE_RECIPIENT,
    });
  }

  async handleWorkCreationVoid(
    workspaceId: string,
    workType: GamificationPointWorkType,
    sourceEntityId: string,
    triggeredByMembershipId: string | null,
  ) {
    await this.reverseWorkXpEvents({
      workspaceId,
      workType,
      sourceEntityId,
      eventType: GamificationWorkXpEventType.CREATION_AWARD,
      reversalType: GamificationWorkXpEventType.CREATION_REVERSAL,
      triggeredByMembershipId,
    });
  }

  async handleWorkReopen(
    workspaceId: string,
    workType: GamificationPointWorkType,
    sourceEntityId: string,
    triggeredByMembershipId: string | null,
  ) {
    await this.reverseWorkXpEvents({
      workspaceId,
      workType,
      sourceEntityId,
      eventType: GamificationWorkXpEventType.COMPLETION_AWARD,
      reversalType: GamificationWorkXpEventType.COMPLETION_REVERSAL,
      triggeredByMembershipId,
    });
  }

  private async normalizeGlobalScoreForWorkXpEvent(
    client: Prisma.TransactionClient | PrismaService,
    event: GlobalScoreWorkXpEvent,
  ) {
    const existing = await client.gamificationGlobalScoreEvent.findUnique({
      where: { workXpEventId: event.id },
    });
    if (existing) return existing;
    const idempotencyKey = `global-score:${event.id}`;
    try {
      if (isWorkXpReversal(event.eventType)) {
        return this.normalizeGlobalScoreReversal(client, event, idempotencyKey);
      }
      if (!isGloballyEligibleWorkXpEvent(event)) {
        return client.gamificationGlobalScoreEvent.create({
          data: globalScoreEventBase(
            event,
            event.eventType === GamificationWorkXpEventType.CREATION_AWARD
              ? GamificationGlobalScoreEventScoreType.CREATION
              : GamificationGlobalScoreEventScoreType.COMPLETION,
            GamificationGlobalScoreEventStatus.SKIPPED_UNSUPPORTED_EVENT,
            idempotencyKey,
          ),
        });
      }
      if (!event.categorySnapshot || !event.recipientMembershipId) {
        return client.gamificationGlobalScoreEvent.create({
          data: globalScoreEventBase(
            event,
            event.eventType === GamificationWorkXpEventType.CREATION_AWARD
              ? GamificationGlobalScoreEventScoreType.CREATION
              : GamificationGlobalScoreEventScoreType.COMPLETION,
            GamificationGlobalScoreEventStatus.SKIPPED_UNSUPPORTED_EVENT,
            idempotencyKey,
          ),
        });
      }
      const baselineScoreType =
        event.eventType === GamificationWorkXpEventType.CREATION_AWARD
          ? GamificationGlobalScoreBaselineScoreType.CREATION
          : GamificationGlobalScoreBaselineScoreType.COMPLETION;
      const eventScoreType =
        event.eventType === GamificationWorkXpEventType.CREATION_AWARD
          ? GamificationGlobalScoreEventScoreType.CREATION
          : GamificationGlobalScoreEventScoreType.COMPLETION;
      const baseline = await client.gamificationGlobalScoreBaseline.findFirst({
        where: {
          workType: event.workType,
          category: event.categorySnapshot,
          scoreType: baselineScoreType,
          status: GamificationGlobalScoreBaselineStatus.READY,
        },
        orderBy: [{ calculatedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      });
      if (!baseline) {
        const latest = await client.gamificationGlobalScoreBaseline.findFirst({
          where: {
            workType: event.workType,
            category: event.categorySnapshot,
            scoreType: baselineScoreType,
          },
          orderBy: [{ calculatedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        });
        return client.gamificationGlobalScoreEvent.create({
          data: globalScoreEventBase(
            event,
            eventScoreType,
            latest?.status === GamificationGlobalScoreBaselineStatus.INSUFFICIENT_SAMPLE
              ? GamificationGlobalScoreEventStatus.SKIPPED_INSUFFICIENT_SAMPLE
              : GamificationGlobalScoreEventStatus.SKIPPED_NO_BASELINE,
            idempotencyKey,
          ),
        });
      }
      if (baselineScoreType === GamificationGlobalScoreBaselineScoreType.CREATION) {
        return client.gamificationGlobalScoreEvent.create({
          data: {
            ...globalScoreEventBase(
              event,
              eventScoreType,
              GamificationGlobalScoreEventStatus.APPLIED,
              idempotencyKey,
            ),
            ...globalScoreBaselineSnapshots(baseline),
            normalizedScore: baseline.normalizedCreationXp ?? 0,
          },
        });
      }
      const calculation = calculateCompletionPoints(
        {
          isEnabled: true,
          baseXp: baseline.normalizedBaseXp ?? 0,
          earlyBonusXp: baseline.normalizedEarlyBonusXp ?? 0,
          earlyThresholdMinutes: zeroToNull(baseline.normalizedEarlyThresholdMinutes),
          latePenaltyPercent: baseline.normalizedLatePenaltyPercent ?? 0,
          penaltyIntervalMinutes: zeroToNull(baseline.normalizedPenaltyIntervalMinutes),
          maxPenaltyXp: baseline.normalizedMaxPenaltyXp ?? 0,
        },
        event.completedAtSnapshot ?? event.occurredAt,
        event.dueAtSnapshot ?? null,
      );
      return client.gamificationGlobalScoreEvent.create({
        data: {
          ...globalScoreEventBase(
            event,
            eventScoreType,
            GamificationGlobalScoreEventStatus.APPLIED,
            idempotencyKey,
          ),
          ...globalScoreBaselineSnapshots(baseline),
          normalizedBaseXpSnapshot: calculation.baseXp,
          normalizedBonusXpSnapshot: calculation.earlyBonusXp,
          normalizedPenaltyXpSnapshot: calculation.penaltyXp,
          normalizedScore: calculation.netCompletionXp,
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return client.gamificationGlobalScoreEvent.findUnique({
          where: { workXpEventId: event.id },
        });
      }
      throw error;
    }
  }

  private async normalizeGlobalScoreReversal(
    client: Prisma.TransactionClient | PrismaService,
    event: GlobalScoreWorkXpEvent,
    idempotencyKey: string,
  ) {
    if (
      event.outcome !== GamificationWorkXpEventOutcome.APPLIED ||
      !event.reversalOfEventId ||
      !event.recipientMembershipId
    ) {
      return client.gamificationGlobalScoreEvent.create({
        data: globalScoreEventBase(
          event,
          GamificationGlobalScoreEventScoreType.REVERSAL,
          GamificationGlobalScoreEventStatus.SKIPPED_UNSUPPORTED_EVENT,
          idempotencyKey,
        ),
      });
    }
    const prior = await client.gamificationGlobalScoreEvent.findUnique({
      where: { workXpEventId: event.reversalOfEventId },
    });
    if (!prior || prior.status !== GamificationGlobalScoreEventStatus.APPLIED) {
      return client.gamificationGlobalScoreEvent.create({
        data: globalScoreEventBase(
          event,
          GamificationGlobalScoreEventScoreType.REVERSAL,
          GamificationGlobalScoreEventStatus.SKIPPED_NO_BASELINE,
          idempotencyKey,
        ),
      });
    }
    return client.gamificationGlobalScoreEvent.create({
      data: {
        ...globalScoreEventBase(
          event,
          GamificationGlobalScoreEventScoreType.REVERSAL,
          GamificationGlobalScoreEventStatus.APPLIED,
          idempotencyKey,
        ),
        baselineId: prior.baselineId,
        baselineVersionSnapshot: prior.baselineVersionSnapshot,
        eligibleWorkspaceCountSnapshot: prior.eligibleWorkspaceCountSnapshot,
        normalizedCreationXpSnapshot: negateNullable(prior.normalizedCreationXpSnapshot),
        normalizedBaseXpSnapshot: negateNullable(prior.normalizedBaseXpSnapshot),
        normalizedBonusXpSnapshot: negateNullable(prior.normalizedBonusXpSnapshot),
        normalizedPenaltyXpSnapshot: negateNullable(prior.normalizedPenaltyXpSnapshot),
        normalizedScore: -(prior.normalizedScore ?? 0),
        reversalOfGlobalScoreEventId: prior.id,
      },
    });
  }

  private async applyWorkCreationXp(input: WorkCreationInput) {
    const eventBase = workEventBase(input, GamificationWorkXpEventType.CREATION_AWARD);
    if (!input.creatorMembershipId) {
      await this.recordSkippedWorkXpEvent({
        ...input,
        ...eventBase,
        recipientMembershipId: null,
        skipReason: GamificationWorkXpSkipReason.NO_ELIGIBLE_CREATOR,
      });
      return;
    }
    if (!input.category) {
      await this.recordSkippedWorkXpEvent({
        ...input,
        ...eventBase,
        recipientMembershipId: input.creatorMembershipId,
        skipReason: GamificationWorkXpSkipReason.MISSING_CATEGORY,
      });
      return;
    }
    const creator = await this.prisma.workspaceMembership.findFirst({
      where: { id: input.creatorMembershipId, workspaceId: input.workspaceId },
      select: { id: true, status: true, roleId: true, role: { select: { name: true } } },
    });
    if (!creator || creator.status !== MembershipStatus.ACTIVE) {
      await this.recordSkippedWorkXpEvent({
        ...input,
        ...eventBase,
        recipientMembershipId: input.creatorMembershipId,
        roleId: creator?.roleId ?? null,
        roleName: creator?.role.name ?? null,
        skipReason: GamificationWorkXpSkipReason.NO_ELIGIBLE_CREATOR,
      });
      return;
    }
    const effective = await this.resolveCreationPointRule(
      input.workspaceId,
      input.departmentId,
      input.workType,
      input.category,
      creator.roleId,
    );
    if (!effective.rule) {
      await this.recordSkippedWorkXpEvent({
        ...input,
        ...eventBase,
        recipientMembershipId: creator.id,
        roleId: creator.roleId,
        roleName: creator.role.name,
        ruleSource: effective.source,
        skipReason: GamificationWorkXpSkipReason.NOT_CONFIGURED,
      });
      return;
    }
    if (!effective.rule.isEnabled || effective.rule.creationXp <= 0) {
      await this.recordSkippedWorkXpEvent({
        ...input,
        ...eventBase,
        recipientMembershipId: creator.id,
        roleId: creator.roleId,
        roleName: creator.role.name,
        ruleId: effective.rule.id,
        ruleSource: effective.source,
        skipReason: GamificationWorkXpSkipReason.RULE_DISABLED,
      });
      return;
    }
    await this.createAppliedWorkXpEvent({
      ...input,
      ...eventBase,
      recipientMembershipId: creator.id,
      roleId: creator.roleId,
      roleName: creator.role.name,
      ruleId: effective.rule.id,
      ruleSource: effective.source,
      creationXp: effective.rule.creationXp,
      netXp: effective.rule.creationXp,
      components: [{ label: 'CREATION', amount: effective.rule.creationXp }],
    });
  }

  private async applyWorkCompletionXpToRecipients(input: WorkCompletionInput) {
    const eventBase = workEventBase(input, GamificationWorkXpEventType.COMPLETION_AWARD);
    if (input.recipients.length === 0) {
      await this.recordSkippedWorkXpEvent({
        ...input,
        ...eventBase,
        recipientMembershipId: null,
        skipReason:
          input.emptyRecipientSkipReason ?? GamificationWorkXpSkipReason.INACTIVE_RECIPIENT,
      });
      return;
    }
    if (!input.category) {
      for (const recipient of input.recipients) {
        await this.recordSkippedWorkXpEvent({
          ...input,
          ...eventBase,
          recipientMembershipId: recipient.membershipId,
          skipReason: GamificationWorkXpSkipReason.MISSING_CATEGORY,
        });
      }
      return;
    }
    const effective = await this.resolveCompletionPointRule(
      input.workspaceId,
      input.departmentId,
      input.workType,
      input.category,
    );
    const cycle = await this.nextCompletionCycle(
      input.workspaceId,
      input.workType,
      input.sourceEntityId,
    );
    if (!effective.rule) {
      for (const recipient of input.recipients) {
        await this.recordSkippedWorkXpEvent({
          ...input,
          ...eventBase,
          recipientMembershipId: recipient.membershipId,
          completionCycle: cycle,
          ruleSource: effective.source,
          skipReason: GamificationWorkXpSkipReason.NOT_CONFIGURED,
        });
      }
      return;
    }
    if (!effective.rule.isEnabled) {
      for (const recipient of input.recipients) {
        await this.recordSkippedWorkXpEvent({
          ...input,
          ...eventBase,
          recipientMembershipId: recipient.membershipId,
          completionCycle: cycle,
          ruleId: effective.rule.id,
          ruleSource: effective.source,
          skipReason: GamificationWorkXpSkipReason.RULE_DISABLED,
        });
      }
      return;
    }
    const calculation = calculateCompletionPoints(effective.rule, input.completedAt, input.dueAt);
    const components = [{ label: 'BASE', amount: calculation.baseXp }];
    if (calculation.earlyBonusXp > 0) {
      components.push({ label: 'BONUS', amount: calculation.earlyBonusXp });
    }
    if (calculation.penaltyXp > 0) {
      components.push({ label: 'PENALTY', amount: -calculation.penaltyXp });
    }
    for (const recipient of input.recipients) {
      if (!recipient.active) {
        await this.recordSkippedWorkXpEvent({
          ...input,
          ...eventBase,
          recipientMembershipId: recipient.membershipId,
          completionCycle: cycle,
          ruleId: effective.rule.id,
          ruleSource: effective.source,
          skipReason: GamificationWorkXpSkipReason.INACTIVE_RECIPIENT,
        });
        continue;
      }
      await this.createAppliedWorkXpEvent({
        ...input,
        ...eventBase,
        recipientMembershipId: recipient.membershipId,
        completionCycle: cycle,
        ruleId: effective.rule.id,
        ruleSource: effective.source,
        ruleSnapshot: effective.rule,
        baseXp: calculation.baseXp,
        bonusXp: calculation.earlyBonusXp,
        penaltyXp: calculation.penaltyXp,
        netXp: calculation.netCompletionXp,
        dueAt: input.dueAt,
        completedAt: input.completedAt,
        components,
      });
    }
  }

  private async recordSkippedWorkXpEvent(input: WorkSkippedEventInput) {
    const correlationKey = workEventKey(input, input.recipientMembershipId, input.completionCycle);
    const idempotencyKey = `${correlationKey}:${input.skipReason}`;
    const existing = await this.prisma.gamificationWorkXpEvent.findUnique({
      where: { workspaceId_idempotencyKey: { workspaceId: input.workspaceId, idempotencyKey } },
      select: { id: true },
    });
    if (existing) return;
    const event = await this.prisma.gamificationWorkXpEvent.create({
      data: {
        workspaceId: input.workspaceId,
        recipientMembershipId: input.recipientMembershipId,
        triggeredByMembershipId: input.triggeredByMembershipId ?? null,
        workType: input.workType,
        sourceEntityId: input.sourceEntityId,
        sourceLabelSnapshot: safeWorkLabel(input.sourceLabel),
        eventType: input.eventType,
        completionCycle: input.completionCycle ?? null,
        correlationKey,
        idempotencyKey,
        departmentIdSnapshot: input.departmentId,
        departmentNameSnapshot: safeWorkLabel(input.departmentName),
        categorySnapshot: input.category,
        roleIdSnapshot: input.roleId ?? null,
        roleNameSnapshot: safeWorkLabel(input.roleName),
        ruleIdSnapshot: input.ruleId ?? null,
        ruleSourceSnapshot: input.ruleSource ?? 'NOT_CONFIGURED',
        outcome: GamificationWorkXpEventOutcome.SKIPPED,
        skipReason: input.skipReason,
        occurredAt: input.occurredAt,
      },
    });
    await this.normalizeGlobalScoreForWorkXpEvent(this.prisma, event);
  }

  private async createAppliedWorkXpEvent(input: WorkAppliedEventInput) {
    const correlationKey = workEventKey(input, input.recipientMembershipId, input.completionCycle);
    const idempotencyKey = correlationKey;
    const netAmount = input.components.reduce((sum, component) => sum + component.amount, 0);
    const created = await this.prisma.$transaction(async (tx) => {
      await lockMembership(tx, input.workspaceId, input.recipientMembershipId);
      const existing = await tx.gamificationWorkXpEvent.findUnique({
        where: { workspaceId_idempotencyKey: { workspaceId: input.workspaceId, idempotencyKey } },
        select: { id: true },
      });
      if (existing) return null;
      await assertActiveMembership(tx, input.workspaceId, input.recipientMembershipId);
      if (input.triggeredByMembershipId) {
        await assertWorkspaceMembership(tx, input.workspaceId, input.triggeredByMembershipId);
      }
      await assertBalanceFloor(tx, input.workspaceId, input.recipientMembershipId, netAmount);
      const event = await tx.gamificationWorkXpEvent.create({
        data: {
          workspaceId: input.workspaceId,
          recipientMembershipId: input.recipientMembershipId,
          triggeredByMembershipId: input.triggeredByMembershipId ?? null,
          workType: input.workType,
          sourceEntityId: input.sourceEntityId,
          sourceLabelSnapshot: safeWorkLabel(input.sourceLabel),
          eventType: input.eventType,
          completionCycle: input.completionCycle ?? null,
          correlationKey,
          idempotencyKey,
          departmentIdSnapshot: input.departmentId,
          departmentNameSnapshot: safeWorkLabel(input.departmentName),
          categorySnapshot: input.category,
          roleIdSnapshot: input.roleId ?? null,
          roleNameSnapshot: safeWorkLabel(input.roleName),
          ruleIdSnapshot: input.ruleId ?? null,
          ruleSourceSnapshot: input.ruleSource ?? 'NOT_CONFIGURED',
          outcome: GamificationWorkXpEventOutcome.APPLIED,
          creationXpSnapshot: input.creationXp ?? null,
          baseXpSnapshot: input.baseXp ?? 0,
          bonusXpSnapshot: input.bonusXp ?? 0,
          penaltyXpSnapshot: input.penaltyXp ?? 0,
          netXpSnapshot: input.netXp ?? netAmount,
          earlyThresholdMinutesSnapshot: input.ruleSnapshot?.earlyThresholdMinutes ?? null,
          latePenaltyPercentSnapshot: input.ruleSnapshot?.latePenaltyPercent ?? null,
          penaltyIntervalMinutesSnapshot: input.ruleSnapshot?.penaltyIntervalMinutes ?? null,
          maxPenaltyXpSnapshot: input.ruleSnapshot?.maxPenaltyXp ?? null,
          dueAtSnapshot: input.dueAt ?? null,
          completedAtSnapshot: input.completedAt ?? null,
          occurredAt: input.occurredAt,
        },
      });
      await this.normalizeGlobalScoreForWorkXpEvent(tx, event);
      for (const component of input.components) {
        if (component.amount === 0) continue;
        await tx.gamificationXpEntry.create({
          data: {
            workspaceId: input.workspaceId,
            membershipId: input.recipientMembershipId,
            amount: component.amount,
            entryType:
              component.amount > 0 ? GamificationXpEntryType.EARN : GamificationXpEntryType.DEDUCT,
            sourceType: workXpSourceType(input.workType),
            sourceEvent: `${input.eventType}:${component.label}`,
            sourceEntityId: input.sourceEntityId,
            idempotencyKey: `${idempotencyKey}:${component.label}`,
            workXpEventId: event.id,
            actorMembershipId: input.triggeredByMembershipId ?? null,
            reason: 'Work XP Engine',
          },
        });
      }
      return event.id;
    });
    if (created && netAmount > 0) {
      await this.evaluateXpAchievements({
        workspaceId: input.workspaceId,
        membershipId: input.recipientMembershipId,
        sourceEventId: idempotencyKey,
        depth: 0,
      });
    }
  }

  private async reverseWorkXpEvents(input: WorkReverseInput) {
    const awards = await this.prisma.gamificationWorkXpEvent.findMany({
      where: {
        workspaceId: input.workspaceId,
        workType: input.workType,
        sourceEntityId: input.sourceEntityId,
        eventType: input.eventType,
        outcome: GamificationWorkXpEventOutcome.APPLIED,
        reversalEvents: { none: {} },
      },
      orderBy: [{ completionCycle: 'desc' }, { occurredAt: 'desc' }, { id: 'desc' }],
      include: { xpEntries: true },
    });
    const targetAwards =
      input.eventType === GamificationWorkXpEventType.COMPLETION_AWARD
        ? awards.filter((award) => award.completionCycle === awards[0]?.completionCycle)
        : awards;
    if (targetAwards.length === 0) {
      await this.recordSkippedWorkXpEvent({
        workspaceId: input.workspaceId,
        workType: input.workType,
        sourceEntityId: input.sourceEntityId,
        sourceLabel: null,
        departmentId: null,
        departmentName: null,
        category: null,
        eventType: input.reversalType,
        recipientMembershipId: null,
        triggeredByMembershipId: input.triggeredByMembershipId,
        occurredAt: new Date(),
        skipReason: GamificationWorkXpSkipReason.NO_PRIOR_AWARD,
      });
      return;
    }
    for (const award of targetAwards) {
      if (!award.recipientMembershipId) continue;
      const resetAfterAward = await this.prisma.gamificationXpEntry.findFirst({
        where: {
          workspaceId: input.workspaceId,
          membershipId: award.recipientMembershipId,
          sourceType: GamificationXpSourceType.MANUAL,
          sourceEvent: { contains: 'RESET' },
          createdAt: { gt: award.createdAt },
        },
        select: { id: true },
      });
      if (resetAfterAward) {
        await this.recordSkippedWorkXpEvent({
          workspaceId: input.workspaceId,
          workType: input.workType,
          sourceEntityId: input.sourceEntityId,
          sourceLabel: award.sourceLabelSnapshot,
          departmentId: award.departmentIdSnapshot,
          departmentName: award.departmentNameSnapshot,
          category: award.categorySnapshot,
          eventType: input.reversalType,
          recipientMembershipId: award.recipientMembershipId,
          triggeredByMembershipId: input.triggeredByMembershipId,
          completionCycle: award.completionCycle,
          occurredAt: new Date(),
          skipReason: GamificationWorkXpSkipReason.ALREADY_NEUTRALIZED_BY_RESET,
        });
        continue;
      }
      await this.createWorkXpReversalEvent(input, award);
    }
  }

  private async createWorkXpReversalEvent(
    input: WorkReverseInput,
    award: Prisma.GamificationWorkXpEventGetPayload<{ include: { xpEntries: true } }>,
  ) {
    const idempotencyKey = `${input.reversalType}:${award.id}`;
    const netAmount = award.xpEntries.reduce((sum, entry) => sum - entry.amount, 0);
    await this.prisma.$transaction(async (tx) => {
      await lockMembership(tx, input.workspaceId, award.recipientMembershipId!);
      const existing = await tx.gamificationWorkXpEvent.findUnique({
        where: { workspaceId_idempotencyKey: { workspaceId: input.workspaceId, idempotencyKey } },
        select: { id: true },
      });
      if (existing) return;
      await assertBalanceFloor(tx, input.workspaceId, award.recipientMembershipId!, netAmount);
      const event = await tx.gamificationWorkXpEvent.create({
        data: {
          workspaceId: input.workspaceId,
          recipientMembershipId: award.recipientMembershipId,
          triggeredByMembershipId: input.triggeredByMembershipId ?? null,
          workType: input.workType,
          sourceEntityId: input.sourceEntityId,
          sourceLabelSnapshot: award.sourceLabelSnapshot,
          eventType: input.reversalType,
          completionCycle: award.completionCycle,
          correlationKey: idempotencyKey,
          idempotencyKey,
          departmentIdSnapshot: award.departmentIdSnapshot,
          departmentNameSnapshot: award.departmentNameSnapshot,
          categorySnapshot: award.categorySnapshot,
          roleIdSnapshot: award.roleIdSnapshot,
          roleNameSnapshot: award.roleNameSnapshot,
          ruleIdSnapshot: award.ruleIdSnapshot,
          ruleSourceSnapshot: award.ruleSourceSnapshot,
          outcome: GamificationWorkXpEventOutcome.APPLIED,
          creationXpSnapshot: award.creationXpSnapshot === null ? null : -award.creationXpSnapshot,
          baseXpSnapshot: -award.baseXpSnapshot,
          bonusXpSnapshot: -award.bonusXpSnapshot,
          penaltyXpSnapshot: -award.penaltyXpSnapshot,
          netXpSnapshot: -award.netXpSnapshot,
          dueAtSnapshot: award.dueAtSnapshot,
          completedAtSnapshot: award.completedAtSnapshot,
          occurredAt: new Date(),
          reversalOfEventId: award.id,
        },
      });
      await this.normalizeGlobalScoreForWorkXpEvent(tx, event);
      for (const entry of award.xpEntries) {
        await tx.gamificationXpEntry.create({
          data: {
            workspaceId: input.workspaceId,
            membershipId: award.recipientMembershipId!,
            amount: -entry.amount,
            entryType: GamificationXpEntryType.REVERSAL,
            sourceType: entry.sourceType,
            sourceEvent: `${input.reversalType}:${entry.sourceEvent}`,
            sourceEntityId: entry.sourceEntityId,
            idempotencyKey: `${idempotencyKey}:${entry.id}`,
            reversalOfEntryId: entry.id,
            workXpEventId: event.id,
            actorMembershipId: input.triggeredByMembershipId ?? null,
            reason: 'Work XP Engine reversal',
          },
        });
      }
    });
  }

  private async resolveCompletionPointRule(
    workspaceId: string,
    departmentId: string | null,
    workType: GamificationPointWorkType,
    category: GamificationPointCategory,
  ) {
    const rules = await this.prisma.gamificationPointRule.findMany({
      where: {
        workspaceId,
        workType,
        category,
        OR: [{ scopeType: GamificationPointScopeType.WORKSPACE }, { departmentId }],
      },
      select: gamificationPointRuleSelect,
    });
    const override = departmentId
      ? rules.find((rule) => rule.scopeType === GamificationPointScopeType.DEPARTMENT)
      : null;
    const workspaceDefault = rules.find(
      (rule) => rule.scopeType === GamificationPointScopeType.WORKSPACE,
    );
    return {
      rule: override ?? workspaceDefault ?? null,
      source: override
        ? 'DEPARTMENT_OVERRIDE'
        : workspaceDefault
          ? 'WORKSPACE_DEFAULT'
          : 'NOT_CONFIGURED',
    };
  }

  private async resolveCreationPointRule(
    workspaceId: string,
    departmentId: string | null,
    workType: GamificationPointWorkType,
    category: GamificationPointCategory,
    roleId: string,
  ) {
    const rules = await this.prisma.gamificationCreationPointRule.findMany({
      where: {
        workspaceId,
        workType,
        category,
        roleId,
        OR: [{ scopeType: GamificationPointScopeType.WORKSPACE }, { departmentId }],
      },
      select: gamificationCreationPointRuleSelect,
    });
    const override = departmentId
      ? rules.find((rule) => rule.scopeType === GamificationPointScopeType.DEPARTMENT)
      : null;
    const workspaceDefault = rules.find(
      (rule) => rule.scopeType === GamificationPointScopeType.WORKSPACE,
    );
    return {
      rule: override ?? workspaceDefault ?? null,
      source: override
        ? 'DEPARTMENT_OVERRIDE'
        : workspaceDefault
          ? 'WORKSPACE_DEFAULT'
          : 'NOT_CONFIGURED',
    };
  }

  private async nextCompletionCycle(
    workspaceId: string,
    workType: GamificationPointWorkType,
    sourceEntityId: string,
  ) {
    const last = await this.prisma.gamificationWorkXpEvent.findFirst({
      where: {
        workspaceId,
        workType,
        sourceEntityId,
        eventType: GamificationWorkXpEventType.COMPLETION_AWARD,
      },
      orderBy: [{ completionCycle: 'desc' }, { createdAt: 'desc' }],
      select: { completionCycle: true },
    });
    return (last?.completionCycle ?? 0) + 1;
  }

  async awardSystemXp(input: Omit<ApplyXpChangeInput, 'entryType'>) {
    return this.applyXpChange({ ...input, entryType: GamificationXpEntryType.EARN });
  }

  async deductSystemXp(input: Omit<ApplyXpChangeInput, 'entryType'>) {
    return this.applyXpChange({ ...input, entryType: GamificationXpEntryType.DEDUCT });
  }

  async applyRewardPointChange(input: ApplyRewardPointChangeInput) {
    const normalized = normalizeRewardPointApplyInput(input);
    const entry = await this.prisma.$transaction(async (tx) =>
      applyRewardPointChangeInTransaction(tx, normalized),
    );
    await this.realtime.publishMember(normalized.workspaceId, normalized.membershipId, {
      eventType: 'GAMIFICATION_REWARD_POINTS_CHANGED',
      entityType: 'GAMIFICATION',
      entityId: entry.id,
      actorMembershipId: normalized.actorMembershipId ?? null,
      payload: {
        entryId: entry.id,
        membershipId: normalized.membershipId,
        amount: normalized.amount,
        sourceType: normalized.sourceType,
        sourceEntityId: normalized.sourceEntityId,
      },
    });
    return entry;
  }

  async earnRewardPoints(input: Omit<ApplyRewardPointChangeInput, 'entryType'>) {
    return this.applyRewardPointChange({
      ...input,
      entryType: GamificationRewardPointEntryType.EARN,
    });
  }

  async spendRewardPoints(input: Omit<ApplyRewardPointChangeInput, 'entryType'>) {
    return this.applyRewardPointChange({
      ...input,
      entryType: GamificationRewardPointEntryType.SPEND,
    });
  }

  async refundRewardPoints(input: Omit<ApplyRewardPointChangeInput, 'entryType'>) {
    return this.applyRewardPointChange({
      ...input,
      entryType: GamificationRewardPointEntryType.REFUND,
    });
  }

  async reverseRewardPointEntry(input: ReverseRewardPointEntryInput) {
    const reason = normalizeBoundedText(
      input.reason,
      REASON_MAX_LENGTH,
      'REWARD_POINT_REASON_INVALID',
    );
    const idempotencyKey = normalizeBoundedText(
      input.idempotencyKey ?? `reward-point-reversal:${input.entryId}`,
      IDEMPOTENCY_KEY_MAX_LENGTH,
      'REWARD_POINT_IDEMPOTENCY_KEY_INVALID',
    );
    return this.prisma.$transaction(async (tx) => {
      await lockMembership(tx, input.workspaceId, input.membershipId);
      const original = await tx.gamificationRewardPointEntry.findFirst({
        where: {
          id: input.entryId,
          workspaceId: input.workspaceId,
          membershipId: input.membershipId,
        },
      });
      if (!original) throw new ConflictException('REWARD_POINT_ENTRY_NOT_FOUND');
      if (original.entryType === GamificationRewardPointEntryType.REVERSAL)
        throw new ConflictException('REWARD_POINT_REVERSAL_CHAIN_UNSUPPORTED');
      const existingReversal = await tx.gamificationRewardPointEntry.findFirst({
        where: { reversalOfEntryId: original.id },
      });
      if (existingReversal) throw new ConflictException('REWARD_POINT_ENTRY_ALREADY_REVERSED');
      await assertActiveMembership(tx, input.workspaceId, input.membershipId);
      if (input.actorMembershipId)
        await assertWorkspaceMembership(tx, input.workspaceId, input.actorMembershipId);
      const amount = -original.amount;
      await assertRewardPointBalanceFloor(tx, input.workspaceId, input.membershipId, amount);
      return tx.gamificationRewardPointEntry.create({
        data: {
          workspaceId: input.workspaceId,
          membershipId: input.membershipId,
          amount,
          entryType: GamificationRewardPointEntryType.REVERSAL,
          sourceType: original.sourceType,
          sourceEvent: 'REWARD_POINT_REVERSAL',
          sourceEntityId: original.sourceEntityId,
          idempotencyKey,
          reversalOfEntryId: original.id,
          actorMembershipId: input.actorMembershipId ?? null,
          reason,
        },
      });
    });
  }

  async reverseXpEntry(input: ReverseXpEntryInput) {
    const reason = normalizeBoundedText(input.reason, REASON_MAX_LENGTH, 'XP_REASON_INVALID');
    const idempotencyKey = normalizeBoundedText(
      input.idempotencyKey ?? `reversal:${input.entryId}`,
      IDEMPOTENCY_KEY_MAX_LENGTH,
      'XP_IDEMPOTENCY_KEY_INVALID',
    );
    return this.prisma.$transaction(async (tx) => {
      await lockMembership(tx, input.workspaceId, input.membershipId);
      const original = await tx.gamificationXpEntry.findFirst({
        where: {
          id: input.entryId,
          workspaceId: input.workspaceId,
          membershipId: input.membershipId,
        },
      });
      if (!original) throw new ConflictException('XP_ENTRY_NOT_FOUND');
      if (original.entryType === GamificationXpEntryType.REVERSAL)
        throw new ConflictException('XP_REVERSAL_CHAIN_UNSUPPORTED');
      const existingReversal = await tx.gamificationXpEntry.findFirst({
        where: { reversalOfEntryId: original.id },
      });
      if (existingReversal) throw new ConflictException('XP_ENTRY_ALREADY_REVERSED');
      await assertActiveMembership(tx, input.workspaceId, input.membershipId);
      if (input.actorMembershipId)
        await assertWorkspaceMembership(tx, input.workspaceId, input.actorMembershipId);
      const amount = -original.amount;
      await assertBalanceFloor(tx, input.workspaceId, input.membershipId, amount);
      return tx.gamificationXpEntry.create({
        data: {
          workspaceId: input.workspaceId,
          membershipId: input.membershipId,
          amount,
          entryType: GamificationXpEntryType.REVERSAL,
          sourceType: original.sourceType,
          sourceEvent: 'XP_REVERSAL',
          sourceEntityId: original.sourceEntityId,
          idempotencyKey,
          reversalOfEntryId: original.id,
          actorMembershipId: input.actorMembershipId ?? null,
          reason,
        },
      });
    });
  }

  private async recordLevelAudit(
    tenant: WorkspaceTenantContext,
    action: string,
    levelId: string,
    metadata: Prisma.InputJsonObject,
  ) {
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action,
      entityType: 'GamificationLevel',
      entityId: levelId,
      metadata,
    });
  }

  private async recordDefinitionAudit(
    tenant: WorkspaceTenantContext,
    action: string,
    entityType: string,
    entityId: string,
    metadata: Prisma.InputJsonObject,
  ) {
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action,
      entityType,
      entityId,
      metadata,
    });
  }

  private async evaluateXpAchievements(input: {
    workspaceId: string;
    membershipId: string;
    sourceEventId: string;
    depth: number;
  }) {
    await this.evaluateAchievementsForCriterion({
      ...input,
      criterionType: GamificationAchievementCriterionType.XP_TOTAL_AT_LEAST,
    });
  }

  private async evaluateAchievementsForCriterion(input: {
    workspaceId: string;
    membershipId: string;
    criterionType: GamificationAchievementCriterionType;
    sourceEventId: string;
    depth: number;
  }) {
    if (input.depth >= MAX_ACHIEVEMENT_CHAIN_DEPTH) return;
    const progress = await this.progressValue(
      input.workspaceId,
      input.membershipId,
      input.criterionType,
    );
    const definitions = await this.prisma.gamificationAchievementDefinition.findMany({
      where: {
        workspaceId: input.workspaceId,
        criterionType: input.criterionType,
        criterionValue: { lte: progress },
        isActive: true,
      },
      orderBy: [{ criterionValue: 'asc' }, { id: 'asc' }],
      select: gamificationAchievementSelect,
    });
    for (const definition of definitions) {
      await this.awardAchievement(
        input.workspaceId,
        input.membershipId,
        definition,
        input.sourceEventId,
        input.depth,
      );
    }
  }

  private async awardAchievement(
    workspaceId: string,
    membershipId: string,
    definition: SelectedGamificationAchievement,
    sourceEventId: string,
    depth: number,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      await lockMembership(tx, workspaceId, membershipId);
      await assertActiveMembership(tx, workspaceId, membershipId);
      const freshDefinition = await tx.gamificationAchievementDefinition.findFirst({
        where: { id: definition.id, workspaceId, isActive: true },
        select: gamificationAchievementSelect,
      });
      if (!freshDefinition) return null;
      let badge: SelectedGamificationBadge | null = null;
      if (freshDefinition.badgeDefinitionId) {
        badge = await tx.gamificationBadgeDefinition.findFirst({
          where: { id: freshDefinition.badgeDefinitionId, workspaceId, isActive: true },
          select: gamificationBadgeSelect,
        });
        if (!badge) return null;
      }
      try {
        const award = await tx.gamificationAchievementAward.create({
          data: {
            workspaceId,
            membershipId,
            achievementDefinitionId: freshDefinition.id,
            achievementNameSnapshot: freshDefinition.name,
            criterionTypeSnapshot: freshDefinition.criterionType,
            criterionValueSnapshot: freshDefinition.criterionValue,
            badgeDefinitionIdSnapshot: freshDefinition.badgeDefinitionId,
            xpRewardSnapshot: freshDefinition.xpReward,
            rewardPointsRewardSnapshot: freshDefinition.rewardPointsReward,
            sourceEventId: normalizeBoundedText(
              sourceEventId,
              IDEMPOTENCY_KEY_MAX_LENGTH,
              'ACHIEVEMENT_SOURCE_EVENT_INVALID',
            ),
          },
          select: { id: true },
        });
        if (badge) {
          await tx.gamificationBadgeAward.createMany({
            data: [
              {
                workspaceId,
                membershipId,
                badgeDefinitionId: badge.id,
                achievementAwardId: award.id,
                badgeNameSnapshot: badge.name,
                badgeIconKeySnapshot: badge.iconKey,
              },
            ],
            skipDuplicates: true,
          });
        }
        return {
          awardId: award.id,
          achievementName: freshDefinition.name,
          badgeName: badge?.name ?? null,
          xpReward: freshDefinition.xpReward,
          rewardPointsReward: freshDefinition.rewardPointsReward,
        };
      } catch (error) {
        if (isUniqueConstraintError(error)) return null;
        throw error;
      }
    });
    if (result?.xpReward && result.xpReward > 0) {
      await this.awardSystemXp({
        workspaceId,
        membershipId,
        amount: result.xpReward,
        sourceType: GamificationXpSourceType.ACHIEVEMENT,
        sourceEvent: 'ACHIEVEMENT_EARNED',
        sourceEntityId: result.awardId,
        idempotencyKey: `achievement:${result.awardId}:xp`,
        reason: 'Achievement XP reward',
        achievementEvaluationDepth: depth + 1,
      });
    }
    if (result?.rewardPointsReward && result.rewardPointsReward > 0) {
      await this.earnRewardPoints({
        workspaceId,
        membershipId,
        amount: result.rewardPointsReward,
        sourceType: GamificationRewardPointSourceType.ACHIEVEMENT,
        sourceEvent: 'ACHIEVEMENT_EARNED',
        sourceEntityId: result.awardId,
        idempotencyKey: `achievement:${result.awardId}:reward-points`,
        reason: 'Achievement Reward Points reward',
      });
    }
    if (result) {
      await this.realtime.publishMember(workspaceId, membershipId, {
        eventType: 'GAMIFICATION_ACHIEVEMENT_EARNED',
        entityType: 'GAMIFICATION',
        entityId: result.awardId,
        payload: {
          awardId: result.awardId,
          membershipId,
          xpReward: result.xpReward,
          rewardPointsReward: result.rewardPointsReward,
        },
      });
      await this.notifyGamificationAward(workspaceId, membershipId, result);
    }
  }

  private async notifyGamificationAward(
    workspaceId: string,
    membershipId: string,
    result: {
      awardId: string;
      achievementName: string;
      badgeName: string | null;
      xpReward: number;
      rewardPointsReward: number;
    },
  ) {
    if (!this.notifications) return;
    await this.notifications.route({
      workspaceId,
      recipientMembershipId: membershipId,
      category: NotificationCategory.GAMIFICATION,
      type: NotificationType.GAMIFICATION_ACHIEVEMENT_EARNED,
      title: 'Achievement earned',
      message: `You earned ${result.achievementName}.`,
      entityType: NotificationEntityType.ACHIEVEMENT,
      entityId: result.awardId,
      priority: NotificationPriority.IMPORTANT,
      dedupeKey: `gamification:achievement:${result.awardId}`,
      metadata: { awardId: result.awardId },
      emailTemplateData: {
        achievementName: result.achievementName,
        entityId: result.awardId,
      },
    });
    if (!result.badgeName) return;
    await this.notifications.route({
      workspaceId,
      recipientMembershipId: membershipId,
      category: NotificationCategory.GAMIFICATION,
      type: NotificationType.GAMIFICATION_BADGE_EARNED,
      title: 'Badge earned',
      message: `You earned ${result.badgeName}.`,
      entityType: NotificationEntityType.ACHIEVEMENT,
      entityId: result.awardId,
      priority: NotificationPriority.IMPORTANT,
      dedupeKey: `gamification:badge:${result.awardId}`,
      metadata: { awardId: result.awardId },
      emailTemplateData: {
        badgeName: result.badgeName,
        entityId: result.awardId,
      },
    });
  }

  private async progressValuesForCriteria(
    workspaceId: string,
    membershipId: string,
    criteria: GamificationAchievementCriterionType[],
  ) {
    const result = new Map<GamificationAchievementCriterionType, number>();
    await Promise.all(
      criteria.map(async (criterion) =>
        result.set(criterion, await this.progressValue(workspaceId, membershipId, criterion)),
      ),
    );
    return result;
  }

  private async progressValue(
    workspaceId: string,
    membershipId: string,
    criterion: GamificationAchievementCriterionType,
  ) {
    if (criterion === GamificationAchievementCriterionType.XP_TOTAL_AT_LEAST) {
      const aggregate = await this.prisma.gamificationXpEntry.aggregate({
        where: { workspaceId, membershipId },
        _sum: { amount: true },
      });
      return Math.max(0, aggregate._sum.amount ?? 0);
    }
    if (criterion === GamificationAchievementCriterionType.TASK_COMPLETED_COUNT) {
      return this.prisma.task.count({
        where: {
          workspaceId,
          deletedAt: null,
          statusDefinition: { isTerminal: true },
          assignees: { some: { membershipId, workspaceId } },
        },
      });
    }
    if (criterion === GamificationAchievementCriterionType.PROJECT_COMPLETED_COUNT) {
      return this.prisma.project.count({
        where: {
          workspaceId,
          archivedAt: null,
          ownerMembershipId: membershipId,
          statusDefinition: { isTerminal: true },
        },
      });
    }
    const terminalStatuses = await this.prisma.statusDefinition.findMany({
      where: { workspaceId, entityType: StatusEntityType.TICKET, isTerminal: true },
      select: { id: true },
    });
    if (terminalStatuses.length === 0) return 0;
    const rows = await this.prisma.auditLog.findMany({
      where: {
        workspaceId,
        entityType: 'Ticket',
        action: 'ticket.status_changed',
        OR: terminalStatuses.map((status) => ({
          metadata: { path: ['toStatusDefinitionId'], equals: status.id },
        })),
      },
      select: { entityId: true, metadata: true, createdAt: true, id: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 10_000,
    });
    const firstByTicket = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      if (row.entityId && !firstByTicket.has(row.entityId)) firstByTicket.set(row.entityId, row);
    }
    return [...firstByTicket.values()].filter(
      (row) => metadataAssignedToMembershipId(row.metadata) === membershipId,
    ).length;
  }

  private async getStreakConfigData(workspaceId: string) {
    const config = await this.prisma.gamificationStreakConfig.findUnique({
      where: { workspaceId },
      select: gamificationStreakConfigSelect,
    });
    return (
      config ?? {
        id: null,
        workspaceId,
        enabled: false,
        dailyXpReward: 0,
        dailyRewardPoints: 0,
        enabledAt: null,
        createdAt: null,
        updatedAt: null,
      }
    );
  }

  private async qualifyStreakDay(input: {
    workspaceId: string;
    membershipId: string;
    qualificationType: GamificationStreakQualificationType;
    sourceEntityId: string;
    occurredAt: Date;
  }) {
    const created = await this.prisma.$transaction(async (tx) => {
      await lockMembership(tx, input.workspaceId, input.membershipId);
      await assertActiveMembership(tx, input.workspaceId, input.membershipId);
      const config = await tx.gamificationStreakConfig.findUnique({
        where: { workspaceId: input.workspaceId },
        select: { enabled: true, enabledAt: true, dailyXpReward: true, dailyRewardPoints: true },
      });
      if (!config?.enabled || !config.enabledAt) return null;
      if (input.occurredAt < config.enabledAt) return null;
      const workspace = await tx.workspace.findUnique({
        where: { id: input.workspaceId },
        select: { timezone: true },
      });
      const timezone = safeWorkspaceTimezone(workspace?.timezone, input.workspaceId);
      const localDate = localDateAsDatabaseDate(input.occurredAt, timezone);
      try {
        return await tx.gamificationStreakDay.create({
          data: {
            workspaceId: input.workspaceId,
            membershipId: input.membershipId,
            localDate,
            qualificationType: input.qualificationType,
            sourceEntityId: input.sourceEntityId,
            qualifiedAt: input.occurredAt,
            timezoneSnapshot: timezone,
            dailyXpRewardSnapshot: config.dailyXpReward,
            dailyRewardPointsSnapshot: config.dailyRewardPoints,
          },
          select: { id: true, dailyXpRewardSnapshot: true, dailyRewardPointsSnapshot: true },
        });
      } catch (error) {
        if (isUniqueConstraintError(error)) return null;
        throw error;
      }
    });
    if (created?.dailyXpRewardSnapshot && created.dailyXpRewardSnapshot > 0) {
      await this.awardSystemXp({
        workspaceId: input.workspaceId,
        membershipId: input.membershipId,
        amount: created.dailyXpRewardSnapshot,
        sourceType: GamificationXpSourceType.STREAK,
        sourceEvent: 'STREAK_DAY_QUALIFIED',
        sourceEntityId: created.id,
        idempotencyKey: `streak-day:${created.id}:xp`,
        reason: 'Daily streak XP reward',
      });
    }
    if (created?.dailyRewardPointsSnapshot && created.dailyRewardPointsSnapshot > 0) {
      await this.earnRewardPoints({
        workspaceId: input.workspaceId,
        membershipId: input.membershipId,
        amount: created.dailyRewardPointsSnapshot,
        sourceType: GamificationRewardPointSourceType.STREAK,
        sourceEvent: 'STREAK_DAY_QUALIFIED',
        sourceEntityId: created.id,
        idempotencyKey: `streak-day:${created.id}:reward-points`,
        reason: 'Daily streak Reward Points reward',
      });
    }
    if (created) {
      await this.realtime.publishMember(input.workspaceId, input.membershipId, {
        eventType: 'GAMIFICATION_STREAK_CHANGED',
        entityType: 'GAMIFICATION',
        entityId: created.id,
        payload: {
          streakDayId: created.id,
          membershipId: input.membershipId,
          qualificationType: input.qualificationType,
          sourceEntityId: input.sourceEntityId,
        },
      });
    }
  }

  private async firstTaskCompletionAt(workspaceId: string, taskId: string) {
    const terminalStatuses = await this.prisma.statusDefinition.findMany({
      where: { workspaceId, entityType: StatusEntityType.TASK, isTerminal: true },
      select: { id: true },
    });
    if (terminalStatuses.length === 0) return new Date();
    const row = await this.prisma.auditLog.findFirst({
      where: {
        workspaceId,
        entityType: 'Task',
        entityId: taskId,
        action: 'task.status_changed',
        OR: [
          ...terminalStatuses.map((status) => ({
            metadata: { path: ['toStatusDefinitionId'], equals: status.id },
          })),
          { metadata: { path: ['completed'], equals: true } },
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { createdAt: true },
    });
    return row?.createdAt ?? new Date();
  }

  private async firstTicketResolution(workspaceId: string, ticketId: string) {
    const terminalStatuses = await this.prisma.statusDefinition.findMany({
      where: { workspaceId, entityType: StatusEntityType.TICKET, isTerminal: true },
      select: { id: true },
    });
    if (terminalStatuses.length === 0) return null;
    const row = await this.prisma.auditLog.findFirst({
      where: {
        workspaceId,
        entityType: 'Ticket',
        entityId: ticketId,
        action: 'ticket.status_changed',
        OR: terminalStatuses.map((status) => ({
          metadata: { path: ['toStatusDefinitionId'], equals: status.id },
        })),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { metadata: true, createdAt: true },
    });
    if (!row) return null;
    return {
      membershipId: metadataAssignedToMembershipId(row.metadata),
      occurredAt: row.createdAt,
    };
  }

  private async workspaceTimezone(workspaceId: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { timezone: true },
    });
    return safeWorkspaceTimezone(workspace?.timezone, workspaceId);
  }

  private async assertPointRuleManagementScope(
    tenant: WorkspaceTenantContext,
    scopeType: GamificationPointScopeType,
    departmentId: string | null,
  ) {
    if (scopeType === GamificationPointScopeType.WORKSPACE) {
      assertPermission(tenant, PermissionKeys.gamificationPointsManageWorkspace);
      if (departmentId) throw new BadRequestException('WORKSPACE_POINT_RULE_DEPARTMENT_INVALID');
      return;
    }
    if (!departmentId) throw new BadRequestException('DEPARTMENT_POINT_RULE_DEPARTMENT_REQUIRED');
    if (hasPermission(tenant, PermissionKeys.gamificationPointsManageWorkspace)) return;
    assertPermission(tenant, PermissionKeys.gamificationPointsManageDepartment);
    const membershipId = requireWorkspaceMembership(tenant);
    const membership = await this.prisma.workspaceMembership.findFirst({
      where: { id: membershipId, workspaceId: tenant.workspaceId },
      select: { departmentId: true, status: true },
    });
    if (
      !membership ||
      membership.status !== MembershipStatus.ACTIVE ||
      membership.departmentId !== departmentId
    ) {
      throw new ForbiddenException('DEPARTMENT_POINT_RULE_SCOPE_DENIED');
    }
  }

  private async assertWorkspaceRole(workspaceId: string, roleId: string) {
    const role = await this.prisma.role.findFirst({
      where: {
        id: roleId,
        isActive: true,
        scope: RoleScope.WORKSPACE,
        OR: [{ isSystem: true, workspaceId: null }, { workspaceId }],
      },
      select: { id: true, key: true, name: true, isSystem: true, workspaceId: true },
    });
    if (!role) throw new ForbiddenException('ROLE_NOT_FOUND');
    return role;
  }

  private async getLeaderboard(
    tenant: WorkspaceTenantContext,
    scope: 'WORKSPACE' | 'DEPARTMENT',
    departmentId?: string,
  ) {
    assertPermission(tenant, PermissionKeys.gamificationLeaderboardsView);
    const membershipId = requireWorkspaceMembership(tenant);
    const [config, preference] = await Promise.all([
      this.getLeaderboardConfigData(tenant.workspaceId),
      this.getLeaderboardPreferenceData(tenant.workspaceId, membershipId),
    ]);
    if (!config.enabled) return unavailableLeaderboard(scope, 'DISABLED', config, preference);
    if (scope === 'WORKSPACE' && !config.workspaceLeaderboardEnabled)
      return unavailableLeaderboard(scope, 'WORKSPACE_DISABLED', config, preference);
    if (scope === 'DEPARTMENT' && !config.departmentLeaderboardEnabled)
      return unavailableLeaderboard(scope, 'DEPARTMENT_DISABLED', config, preference);
    const [topRows, meRows, activeLevels] = await Promise.all([
      this.fetchLeaderboardRows(tenant.workspaceId, membershipId, scope, departmentId, true),
      this.fetchLeaderboardRows(tenant.workspaceId, membershipId, scope, departmentId, false),
      this.prisma.gamificationLevel.findMany({
        where: { workspaceId: tenant.workspaceId, isActive: true },
        orderBy: [{ levelNumber: 'asc' }, { id: 'asc' }],
        select: gamificationLevelSelect,
      }),
    ]);
    const entries = topRows.map((row, index) =>
      leaderboardEntryFromRow(row, activeLevels, index, membershipId),
    );
    const meRow = meRows[0] ?? null;
    const me = meRow
      ? leaderboardSelfFromRow(
          meRow,
          activeLevels,
          entries.some((entry) => entry.isCurrentUser),
          membershipId,
        )
      : {
          included: false,
          rank: null,
          currentXp: null,
          currentLevel: null,
          privacyMode: preference.privacyMode,
          inTopEntries: false,
        };
    return {
      scope,
      period: 'ALL_TIME',
      available: true,
      reason: null,
      config,
      entries,
      me,
    };
  }

  private async fetchLeaderboardRows(
    workspaceId: string,
    currentMembershipId: string,
    scope: 'WORKSPACE' | 'DEPARTMENT',
    departmentId: string | undefined,
    topOnly: boolean,
  ) {
    const departmentFilter =
      scope === 'DEPARTMENT'
        ? Prisma.sql`AND wm.department_id = ${departmentId}::uuid`
        : Prisma.empty;
    const finalClause = topOnly
      ? Prisma.sql`ORDER BY rank ASC, membership_id ASC LIMIT ${LEADERBOARD_TOP_LIMIT}`
      : Prisma.sql`WHERE membership_id = ${currentMembershipId}::uuid ORDER BY rank ASC, membership_id ASC`;
    return this.prisma.$queryRaw<LeaderboardSqlRow[]>(Prisma.sql`
      WITH eligible AS (
        SELECT
          wm.id AS membership_id,
          wm.department_id,
          COALESCE(u.name, '') AS name,
          d.name AS department_name,
          COALESCE(pref.privacy_mode, 'ANONYMOUS') AS privacy_mode,
          COALESCE(SUM(xp.amount), 0)::int AS current_xp
        FROM workspace_memberships wm
        JOIN users u ON u.id = wm.user_id
        LEFT JOIN departments d
          ON d.id = wm.department_id
         AND d.workspace_id = wm.workspace_id
        LEFT JOIN gamification_leaderboard_preferences pref
          ON pref.workspace_id = wm.workspace_id
         AND pref.membership_id = wm.id
        LEFT JOIN gamification_xp_entries xp
          ON xp.workspace_id = wm.workspace_id
         AND xp.membership_id = wm.id
        WHERE wm.workspace_id = ${workspaceId}::uuid
          AND wm.status = 'ACTIVE'
          ${departmentFilter}
        GROUP BY wm.id, wm.department_id, u.name, d.name, pref.privacy_mode
      ),
      ranked AS (
        SELECT
          membership_id,
          department_id,
          name,
          department_name,
          privacy_mode,
          current_xp,
          DENSE_RANK() OVER (ORDER BY current_xp DESC) AS rank
        FROM eligible
        WHERE privacy_mode <> 'OPT_OUT'
      )
      SELECT
        membership_id AS "membershipId",
        department_id AS "departmentId",
        department_name AS "departmentName",
        name,
        privacy_mode AS "privacyMode",
        current_xp AS "currentXp",
        rank::int AS rank
      FROM ranked
      ${finalClause}
    `);
  }

  private async assertWorkspaceInAgency(agencyId: string, workspaceId: string) {
    const workspace = await this.prisma.workspace.findFirst({
      where: { id: workspaceId, agencyId },
      select: { id: true },
    });
    if (!workspace) throw new ForbiddenException('WORKSPACE_NOT_IN_AGENCY');
  }

  private async getPlatformGlobalAgencies(query: GamificationGlobalLeaderboardQueryDto) {
    const page = boundedPage(query.page);
    const pageSize = boundedGlobalPageSize(query.pageSize);
    const offset = (page - 1) * pageSize;
    const search = normalizedSearch(query.search);
    const searchFilter = search
      ? Prisma.sql`AND a.name ILIKE ${`%${escapeLike(search)}%`}`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<GlobalAgencyLeaderboardSqlRow[]>(Prisma.sql`
      WITH agency_scores AS (
        SELECT
          a.id AS agency_id,
          a.name AS agency_name,
          COALESCE(SUM(gse.normalized_score), 0)::int AS global_score,
          COUNT(DISTINCT w.id)::int AS subaccounts,
          COUNT(DISTINCT gse.recipient_membership_id)::int AS scored_users
        FROM agencies a
        JOIN workspaces w ON w.agency_id = a.id
        JOIN gamification_global_score_events gse
          ON gse.workspace_id = w.id
         AND gse.status = 'APPLIED'
         AND gse.normalized_score IS NOT NULL
        WHERE 1 = 1
          ${searchFilter}
        GROUP BY a.id, a.name
      ),
      ranked AS (
        SELECT
          agency_id,
          agency_name,
          global_score,
          subaccounts,
          scored_users,
          DENSE_RANK() OVER (ORDER BY global_score DESC) AS rank,
          COUNT(*) OVER ()::int AS total_count
        FROM agency_scores
      )
      SELECT
        agency_id AS "agencyId",
        agency_name AS "agencyName",
        global_score AS "globalScore",
        subaccounts,
        scored_users AS "scoredUsers",
        rank::int AS rank,
        total_count AS "totalCount"
      FROM ranked
      ORDER BY rank ASC, agency_name ASC, agency_id ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `);
    return pagedGlobalLeaderboard(
      'PLATFORM_AGENCIES',
      page,
      pageSize,
      rows.map(globalAgencyRow),
      totalFromRows(rows),
    );
  }

  private async getSuperAgencyGlobalAgencies(
    superAgencyId: string,
    query: GamificationGlobalLeaderboardQueryDto,
  ) {
    const page = boundedPage(query.page);
    const pageSize = boundedGlobalPageSize(query.pageSize);
    const offset = (page - 1) * pageSize;
    const search = normalizedSearch(query.search);
    const searchFilter = search
      ? Prisma.sql`AND a.name ILIKE ${`%${escapeLike(search)}%`}`
      : Prisma.empty;
    const agencyFilter = query.agencyId
      ? Prisma.sql`AND a.id = ${query.agencyId}::uuid`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<GlobalAgencyLeaderboardSqlRow[]>(Prisma.sql`
      WITH agency_scores AS (
        SELECT
          a.id AS agency_id,
          a.name AS agency_name,
          COALESCE(SUM(gse.normalized_score), 0)::int AS global_score,
          COUNT(DISTINCT w.id)::int AS subaccounts,
          COUNT(DISTINCT gse.recipient_membership_id)::int AS scored_users
        FROM agencies a
        JOIN workspaces w ON w.agency_id = a.id
        JOIN gamification_global_score_events gse
          ON gse.workspace_id = w.id
         AND gse.status = 'APPLIED'
         AND gse.normalized_score IS NOT NULL
        WHERE a.super_agency_id = ${superAgencyId}::uuid
          ${agencyFilter}
          ${searchFilter}
        GROUP BY a.id, a.name
      ),
      ranked AS (
        SELECT
          agency_id,
          agency_name,
          global_score,
          subaccounts,
          scored_users,
          DENSE_RANK() OVER (ORDER BY global_score DESC) AS rank,
          COUNT(*) OVER ()::int AS total_count
        FROM agency_scores
      )
      SELECT
        agency_id AS "agencyId",
        agency_name AS "agencyName",
        global_score AS "globalScore",
        subaccounts,
        scored_users AS "scoredUsers",
        rank::int AS rank,
        total_count AS "totalCount"
      FROM ranked
      ORDER BY rank ASC, agency_name ASC, agency_id ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `);
    return pagedGlobalLeaderboard(
      'SUPER_AGENCY_AGENCIES',
      page,
      pageSize,
      rows.map(globalAgencyRow),
      totalFromRows(rows),
    );
  }

  private async getPlatformGlobalSuperAgencies(query: GamificationGlobalLeaderboardQueryDto) {
    const page = boundedPage(query.page);
    const pageSize = boundedGlobalPageSize(query.pageSize);
    const offset = (page - 1) * pageSize;
    const search = normalizedSearch(query.search);
    const searchFilter = search
      ? Prisma.sql`AND sa.name ILIKE ${`%${escapeLike(search)}%`}`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<GlobalSuperAgencyLeaderboardSqlRow[]>(Prisma.sql`
      WITH super_agency_scores AS (
        SELECT
          sa.id AS super_agency_id,
          sa.name AS super_agency_name,
          COALESCE(SUM(gse.normalized_score), 0)::int AS global_score,
          COUNT(DISTINCT a.id)::int AS agencies,
          COUNT(DISTINCT w.id)::int AS subaccounts,
          COUNT(DISTINCT gse.recipient_membership_id)::int AS scored_users
        FROM super_agencies sa
        JOIN agencies a ON a.super_agency_id = sa.id
        JOIN workspaces w ON w.agency_id = a.id
        JOIN gamification_global_score_events gse
          ON gse.workspace_id = w.id
         AND gse.status = 'APPLIED'
         AND gse.normalized_score IS NOT NULL
        WHERE 1 = 1
          ${searchFilter}
        GROUP BY sa.id, sa.name
      ),
      ranked AS (
        SELECT
          super_agency_id,
          super_agency_name,
          global_score,
          agencies,
          subaccounts,
          scored_users,
          DENSE_RANK() OVER (ORDER BY global_score DESC) AS rank,
          COUNT(*) OVER ()::int AS total_count
        FROM super_agency_scores
      )
      SELECT
        super_agency_id AS "superAgencyId",
        super_agency_name AS "superAgencyName",
        global_score AS "globalScore",
        agencies,
        subaccounts,
        scored_users AS "scoredUsers",
        rank::int AS rank,
        total_count AS "totalCount"
      FROM ranked
      ORDER BY rank ASC, super_agency_name ASC, super_agency_id ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `);
    return pagedGlobalLeaderboard(
      'PLATFORM_SUPER_AGENCIES',
      page,
      pageSize,
      rows.map(globalSuperAgencyRow),
      totalFromRows(rows),
    );
  }

  private async getPlatformGlobalSubaccounts(query: GamificationGlobalLeaderboardQueryDto) {
    const page = boundedPage(query.page);
    const pageSize = boundedGlobalPageSize(query.pageSize);
    const offset = (page - 1) * pageSize;
    const search = normalizedSearch(query.search);
    const searchFilter = search
      ? Prisma.sql`AND w.name ILIKE ${`%${escapeLike(search)}%`}`
      : Prisma.empty;
    const agencyFilter = query.agencyId
      ? Prisma.sql`AND a.id = ${query.agencyId}::uuid`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<GlobalSubaccountLeaderboardSqlRow[]>(Prisma.sql`
      WITH workspace_scores AS (
        SELECT
          w.id AS workspace_id,
          w.name AS workspace_name,
          a.id AS agency_id,
          a.name AS agency_name,
          COALESCE(SUM(gse.normalized_score), 0)::int AS global_score,
          COUNT(DISTINCT gse.recipient_membership_id)::int AS scored_users
        FROM workspaces w
        JOIN agencies a ON a.id = w.agency_id
        JOIN gamification_global_score_events gse
          ON gse.workspace_id = w.id
         AND gse.status = 'APPLIED'
         AND gse.normalized_score IS NOT NULL
        WHERE 1 = 1
          ${searchFilter}
          ${agencyFilter}
        GROUP BY w.id, w.name, a.id, a.name
      ),
      ranked AS (
        SELECT
          workspace_id,
          workspace_name,
          agency_id,
          agency_name,
          global_score,
          scored_users,
          DENSE_RANK() OVER (ORDER BY global_score DESC) AS rank,
          COUNT(*) OVER ()::int AS total_count
        FROM workspace_scores
      )
      SELECT
        workspace_id AS "workspaceId",
        workspace_name AS "workspaceName",
        agency_id AS "agencyId",
        agency_name AS "agencyName",
        global_score AS "globalScore",
        scored_users AS "scoredUsers",
        rank::int AS rank,
        total_count AS "totalCount"
      FROM ranked
      ORDER BY rank ASC, workspace_name ASC, workspace_id ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `);
    return pagedGlobalLeaderboard(
      'PLATFORM_SUBACCOUNTS',
      page,
      pageSize,
      rows.map(globalSubaccountRow),
      totalFromRows(rows),
    );
  }

  private async getSuperAgencyGlobalSubaccounts(
    superAgencyId: string,
    query: GamificationGlobalLeaderboardQueryDto,
  ) {
    const page = boundedPage(query.page);
    const pageSize = boundedGlobalPageSize(query.pageSize);
    const offset = (page - 1) * pageSize;
    const search = normalizedSearch(query.search);
    const searchFilter = search
      ? Prisma.sql`AND w.name ILIKE ${`%${escapeLike(search)}%`}`
      : Prisma.empty;
    const agencyFilter = query.agencyId
      ? Prisma.sql`AND a.id = ${query.agencyId}::uuid`
      : Prisma.empty;
    const workspaceFilter = query.workspaceId
      ? Prisma.sql`AND w.id = ${query.workspaceId}::uuid`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<GlobalSubaccountLeaderboardSqlRow[]>(Prisma.sql`
      WITH workspace_scores AS (
        SELECT
          w.id AS workspace_id,
          w.name AS workspace_name,
          a.id AS agency_id,
          a.name AS agency_name,
          COALESCE(SUM(gse.normalized_score), 0)::int AS global_score,
          COUNT(DISTINCT gse.recipient_membership_id)::int AS scored_users
        FROM workspaces w
        JOIN agencies a ON a.id = w.agency_id
        JOIN gamification_global_score_events gse
          ON gse.workspace_id = w.id
         AND gse.status = 'APPLIED'
         AND gse.normalized_score IS NOT NULL
        WHERE a.super_agency_id = ${superAgencyId}::uuid
          ${agencyFilter}
          ${workspaceFilter}
          ${searchFilter}
        GROUP BY w.id, w.name, a.id, a.name
      ),
      ranked AS (
        SELECT
          workspace_id,
          workspace_name,
          agency_id,
          agency_name,
          global_score,
          scored_users,
          DENSE_RANK() OVER (ORDER BY global_score DESC) AS rank,
          COUNT(*) OVER ()::int AS total_count
        FROM workspace_scores
      )
      SELECT
        workspace_id AS "workspaceId",
        workspace_name AS "workspaceName",
        agency_id AS "agencyId",
        agency_name AS "agencyName",
        global_score AS "globalScore",
        scored_users AS "scoredUsers",
        rank::int AS rank,
        total_count AS "totalCount"
      FROM ranked
      ORDER BY rank ASC, workspace_name ASC, workspace_id ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `);
    return pagedGlobalLeaderboard(
      'SUPER_AGENCY_SUBACCOUNTS',
      page,
      pageSize,
      rows.map(globalSubaccountRow),
      totalFromRows(rows),
    );
  }

  private async getGlobalUserLeaderboard(input: {
    scope: 'AGENCY_SUBACCOUNT_USERS' | 'SUPER_AGENCY_USERS' | 'PLATFORM_USERS';
    superAgencyId?: string | null;
    agencyId?: string | null;
    workspaceId?: string | null;
    query: GamificationGlobalLeaderboardQueryDto;
  }) {
    const page = boundedPage(input.query.page);
    const pageSize = boundedGlobalPageSize(input.query.pageSize);
    const offset = (page - 1) * pageSize;
    const search = normalizedSearch(input.query.search);
    const searchFilter = search
      ? Prisma.sql`
          AND (
            (COALESCE(pref.privacy_mode, 'ANONYMOUS') IN ('SHOW_NAME', 'SHOW_DISPLAY_NAME')
              AND COALESCE(u.name, '') ILIKE ${`%${escapeLike(search)}%`})
            OR w.name ILIKE ${`%${escapeLike(search)}%`}
            OR a.name ILIKE ${`%${escapeLike(search)}%`}
          )
        `
      : Prisma.empty;
    const agencyFilter = input.agencyId
      ? Prisma.sql`AND a.id = ${input.agencyId}::uuid`
      : Prisma.empty;
    const superAgencyFilter = input.superAgencyId
      ? Prisma.sql`AND a.super_agency_id = ${input.superAgencyId}::uuid`
      : Prisma.empty;
    const workspaceFilter = input.workspaceId
      ? Prisma.sql`AND w.id = ${input.workspaceId}::uuid`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<GlobalUserLeaderboardSqlRow[]>(Prisma.sql`
      WITH member_scores AS (
        SELECT
          wm.id AS membership_id,
          w.id AS workspace_id,
          w.name AS workspace_name,
          a.id AS agency_id,
          a.name AS agency_name,
          COALESCE(u.name, '') AS name,
          d.name AS department_name,
          COALESCE(pref.privacy_mode, 'ANONYMOUS') AS privacy_mode,
          COALESCE(SUM(gse.normalized_score), 0)::int AS global_score
        FROM workspace_memberships wm
        JOIN users u ON u.id = wm.user_id
        JOIN workspaces w ON w.id = wm.workspace_id
        JOIN agencies a ON a.id = w.agency_id
        JOIN gamification_global_score_events gse
          ON gse.workspace_id = wm.workspace_id
         AND gse.recipient_membership_id = wm.id
         AND gse.status = 'APPLIED'
         AND gse.normalized_score IS NOT NULL
        LEFT JOIN departments d
          ON d.id = wm.department_id
         AND d.workspace_id = wm.workspace_id
        LEFT JOIN gamification_leaderboard_preferences pref
          ON pref.workspace_id = wm.workspace_id
         AND pref.membership_id = wm.id
        WHERE wm.status = 'ACTIVE'
          AND COALESCE(pref.privacy_mode, 'ANONYMOUS') <> 'OPT_OUT'
          ${superAgencyFilter}
          ${agencyFilter}
          ${workspaceFilter}
          ${searchFilter}
        GROUP BY wm.id, w.id, w.name, a.id, a.name, u.name, d.name, pref.privacy_mode
      ),
      ranked AS (
        SELECT
          membership_id,
          workspace_id,
          workspace_name,
          agency_id,
          agency_name,
          name,
          department_name,
          privacy_mode,
          global_score,
          DENSE_RANK() OVER (ORDER BY global_score DESC) AS rank,
          COUNT(*) OVER ()::int AS total_count
        FROM member_scores
      )
      SELECT
        membership_id AS "membershipId",
        workspace_id AS "workspaceId",
        workspace_name AS "workspaceName",
        agency_id AS "agencyId",
        agency_name AS "agencyName",
        name,
        department_name AS "departmentName",
        privacy_mode AS "privacyMode",
        global_score AS "globalScore",
        rank::int AS rank,
        total_count AS "totalCount"
      FROM ranked
      ORDER BY rank ASC, name ASC, membership_id ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `);
    return pagedGlobalLeaderboard(
      input.scope,
      page,
      pageSize,
      rows.map(globalUserRow),
      totalFromRows(rows),
    );
  }

  private async getLeaderboardConfigData(workspaceId: string) {
    const config = await this.prisma.gamificationLeaderboardConfig.findUnique({
      where: { workspaceId },
      select: gamificationLeaderboardConfigSelect,
    });
    return (
      config ?? {
        id: null,
        workspaceId,
        enabled: false,
        workspaceLeaderboardEnabled: false,
        departmentLeaderboardEnabled: false,
        createdAt: null,
        updatedAt: null,
      }
    );
  }

  private async getLeaderboardPreferenceData(workspaceId: string, membershipId: string) {
    const preference = await this.prisma.gamificationLeaderboardPreference.findUnique({
      where: { workspaceId_membershipId: { workspaceId, membershipId } },
      select: gamificationLeaderboardPreferenceSelect,
    });
    return (
      preference ?? {
        id: null,
        workspaceId,
        membershipId,
        privacyMode: GamificationLeaderboardPrivacyMode.ANONYMOUS,
        createdAt: null,
        updatedAt: null,
      }
    );
  }
}

const gamificationLeaderboardConfigSelect = {
  id: true,
  workspaceId: true,
  enabled: true,
  workspaceLeaderboardEnabled: true,
  departmentLeaderboardEnabled: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.GamificationLeaderboardConfigSelect;

const gamificationLeaderboardPreferenceSelect = {
  id: true,
  workspaceId: true,
  membershipId: true,
  privacyMode: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.GamificationLeaderboardPreferenceSelect;

interface GlobalLeaderboardSqlBase {
  globalScore: number | bigint | null;
  rank: number | bigint;
  totalCount?: number | bigint;
}

interface GlobalAgencyLeaderboardSqlRow extends GlobalLeaderboardSqlBase {
  agencyId: string;
  agencyName: string;
  subaccounts: number | bigint;
  scoredUsers: number | bigint;
}

interface GlobalSuperAgencyLeaderboardSqlRow extends GlobalLeaderboardSqlBase {
  superAgencyId: string;
  superAgencyName: string;
  agencies: number | bigint;
  subaccounts: number | bigint;
  scoredUsers: number | bigint;
}

interface GlobalSubaccountLeaderboardSqlRow extends GlobalLeaderboardSqlBase {
  workspaceId: string;
  workspaceName: string;
  agencyId?: string | null;
  agencyName?: string | null;
  scoredUsers: number | bigint;
}

interface GlobalUserLeaderboardSqlRow extends GlobalLeaderboardSqlBase {
  membershipId: string;
  workspaceId: string;
  workspaceName: string;
  agencyId: string;
  agencyName: string;
  name: string | null;
  departmentName: string | null;
  privacyMode: GamificationLeaderboardPrivacyMode;
}

function pagedGlobalLeaderboard<T>(
  scope: string,
  page: number,
  pageSize: number,
  items: T[],
  total: number,
) {
  return {
    scope,
    period: 'ALL_TIME',
    items,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

function globalAgencyRow(row: GlobalAgencyLeaderboardSqlRow) {
  return {
    rank: toNumber(row.rank),
    agencyId: row.agencyId,
    agencyName: row.agencyName,
    globalScore: toNumber(row.globalScore),
    subaccounts: toNumber(row.subaccounts),
    scoredUsers: toNumber(row.scoredUsers),
  };
}

function globalSuperAgencyRow(row: GlobalSuperAgencyLeaderboardSqlRow) {
  return {
    rank: toNumber(row.rank),
    superAgencyId: row.superAgencyId,
    superAgencyName: row.superAgencyName,
    globalScore: toNumber(row.globalScore),
    agencies: toNumber(row.agencies),
    subaccounts: toNumber(row.subaccounts),
    scoredUsers: toNumber(row.scoredUsers),
  };
}

function globalSubaccountRow(row: GlobalSubaccountLeaderboardSqlRow) {
  return {
    rank: toNumber(row.rank),
    workspaceId: row.workspaceId,
    workspaceName: row.workspaceName,
    agencyId: row.agencyId ?? null,
    agencyName: row.agencyName ?? null,
    globalScore: toNumber(row.globalScore),
    scoredUsers: toNumber(row.scoredUsers),
  };
}

function globalUserRow(row: GlobalUserLeaderboardSqlRow) {
  const privacyMode = row.privacyMode ?? GamificationLeaderboardPrivacyMode.ANONYMOUS;
  const hidden = privacyMode === GamificationLeaderboardPrivacyMode.ANONYMOUS;
  return {
    rank: toNumber(row.rank),
    membershipId: hidden ? null : row.membershipId,
    displayName: hidden ? 'Anonymous User' : safeMemberDisplayName(row.name),
    workspaceId: row.workspaceId,
    workspaceName: row.workspaceName,
    agencyId: row.agencyId,
    agencyName: row.agencyName,
    departmentName: hidden ? null : row.departmentName,
    privacyMode,
    globalScore: toNumber(row.globalScore),
  };
}

function totalFromRows(rows: GlobalLeaderboardSqlBase[]) {
  return rows.length > 0 ? toNumber(rows[0]?.totalCount) : 0;
}

function boundedPage(page: number | undefined) {
  return Math.max(1, Number.isFinite(page) ? Number(page) : 1);
}

function boundedGlobalPageSize(pageSize: number | undefined) {
  return Math.min(100, Math.max(1, Number.isFinite(pageSize) ? Number(pageSize) : 20));
}

function toNumber(value: number | bigint | null | undefined) {
  if (typeof value === 'bigint') return Number(value);
  return Number(value ?? 0);
}

function normalizedSearch(search: string | undefined) {
  const trimmed = search?.trim();
  return trimmed ? trimmed.slice(0, 120) : '';
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function healthCard(
  title: string,
  status: 'HEALTHY' | 'WARNING' | 'ERROR',
  value: number,
  summary: string,
) {
  return { title, status, value, summary };
}

function developerPaging(query: Pick<DeveloperGamificationPageQueryDto, 'page' | 'pageSize'>) {
  const page = boundedPage(query.page);
  const pageSize = boundedGlobalPageSize(query.pageSize);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function developerPage<T>(items: T[], total: number, paging: ReturnType<typeof developerPaging>) {
  return {
    items,
    page: paging.page,
    pageSize: paging.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / paging.pageSize)),
  };
}

function buildDeveloperEffectiveRules<T extends { departmentId?: string | null }>(
  rules: T[],
  identityKeys: Array<keyof T>,
) {
  const effectiveRules: Array<{
    workspaceDefault: T | null;
    departmentOverride: T | null;
    effectiveRule: T;
    effectiveSource: 'WORKSPACE_DEFAULT' | 'DEPARTMENT_OVERRIDE';
  }> = [];
  const workspaceDefaults = new Map<string, T>();
  for (const rule of rules) {
    if (!rule.departmentId) workspaceDefaults.set(developerRuleIdentity(rule, identityKeys), rule);
  }
  for (const departmentOverride of rules.filter((rule) => Boolean(rule.departmentId))) {
    const workspaceDefault = workspaceDefaults.get(
      developerRuleIdentity(departmentOverride, identityKeys),
    );
    effectiveRules.push({
      workspaceDefault: workspaceDefault ?? null,
      departmentOverride,
      effectiveRule: departmentOverride,
      effectiveSource: 'DEPARTMENT_OVERRIDE',
    });
  }
  for (const workspaceDefault of workspaceDefaults.values()) {
    effectiveRules.push({
      workspaceDefault,
      departmentOverride: null,
      effectiveRule: workspaceDefault,
      effectiveSource: 'WORKSPACE_DEFAULT',
    });
  }
  return effectiveRules;
}

function developerRuleIdentity<T>(rule: T, keys: Array<keyof T>) {
  return keys.map((key) => String(rule[key] ?? '')).join('|');
}

function developerDateRange(query: Pick<DeveloperGamificationPageQueryDto, 'from' | 'to'>) {
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from ? new Date(query.from) : new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { gte: from, lte: to };
}

function developerPointRuleWhere(query: DeveloperPointRuleInspectorQueryDto) {
  return {
    ...(query.workspaceId ? { workspaceId: query.workspaceId } : {}),
    ...(query.departmentId ? { departmentId: query.departmentId } : {}),
    ...(query.workType ? { workType: query.workType } : {}),
    ...(query.category ? { category: query.category } : {}),
    workspace: query.agencyId ? { agencyId: query.agencyId } : undefined,
  } satisfies Prisma.GamificationPointRuleWhereInput &
    Prisma.GamificationCreationPointRuleWhereInput;
}

function developerWorkXpWhere(query: DeveloperXpEventMonitorQueryDto) {
  return {
    ...(query.workspaceId ? { workspaceId: query.workspaceId } : {}),
    ...(query.membershipId ? { recipientMembershipId: query.membershipId } : {}),
    ...(query.workType ? { workType: query.workType } : {}),
    ...(query.eventType ? { eventType: query.eventType } : {}),
    ...(query.outcome ? { outcome: query.outcome } : {}),
    occurredAt: developerDateRange(query),
    workspace: query.agencyId ? { agencyId: query.agencyId } : undefined,
  } satisfies Prisma.GamificationWorkXpEventWhereInput;
}

function developerGlobalScoreWhere(query: DeveloperNormalizationEventsQueryDto) {
  return {
    ...(query.workspaceId ? { workspaceId: query.workspaceId } : {}),
    ...(query.membershipId ? { recipientMembershipId: query.membershipId } : {}),
    ...(query.status ? { status: query.status } : {}),
    occurredAt: developerDateRange(query),
    workspace: query.agencyId ? { agencyId: query.agencyId } : undefined,
  } satisfies Prisma.GamificationGlobalScoreEventWhereInput;
}

const developerCompletionPointRuleSelect = {
  id: true,
  workspaceId: true,
  departmentId: true,
  scopeType: true,
  workType: true,
  category: true,
  isEnabled: true,
  baseXp: true,
  earlyBonusXp: true,
  earlyThresholdMinutes: true,
  latePenaltyPercent: true,
  penaltyIntervalMinutes: true,
  maxPenaltyXp: true,
  workspace: { select: { name: true, agency: { select: { id: true, name: true } } } },
  department: { select: { name: true } },
} satisfies Prisma.GamificationPointRuleSelect;

const developerCreationPointRuleSelect = {
  id: true,
  workspaceId: true,
  departmentId: true,
  scopeType: true,
  workType: true,
  category: true,
  roleId: true,
  isEnabled: true,
  creationXp: true,
  workspace: { select: { name: true, agency: { select: { id: true, name: true } } } },
  department: { select: { name: true } },
  role: { select: { name: true } },
} satisfies Prisma.GamificationCreationPointRuleSelect;

const developerWorkXpEventSelect = {
  id: true,
  workspaceId: true,
  recipientMembershipId: true,
  workType: true,
  sourceEntityId: true,
  sourceLabelSnapshot: true,
  eventType: true,
  categorySnapshot: true,
  departmentNameSnapshot: true,
  outcome: true,
  skipReason: true,
  netXpSnapshot: true,
  completionCycle: true,
  idempotencyKey: true,
  occurredAt: true,
  workspace: { select: { name: true, agency: { select: { id: true, name: true } } } },
  recipientMembership: { select: { user: { select: { name: true } } } },
  xpEntries: {
    select: { id: true, amount: true, sourceType: true, sourceEvent: true, createdAt: true },
  },
} satisfies Prisma.GamificationWorkXpEventSelect;

const developerWorkXpEventDetailSelect = {
  ...developerWorkXpEventSelect,
  ruleIdSnapshot: true,
  ruleSourceSnapshot: true,
  roleNameSnapshot: true,
  creationXpSnapshot: true,
  baseXpSnapshot: true,
  bonusXpSnapshot: true,
  penaltyXpSnapshot: true,
  earlyThresholdMinutesSnapshot: true,
  latePenaltyPercentSnapshot: true,
  penaltyIntervalMinutesSnapshot: true,
  maxPenaltyXpSnapshot: true,
  dueAtSnapshot: true,
  completedAtSnapshot: true,
  reversalOfEventId: true,
  reversalEvents: { select: { id: true, occurredAt: true } },
  globalScoreEvent: {
    select: {
      id: true,
      status: true,
      normalizedScore: true,
      baselineVersionSnapshot: true,
      reversalOfGlobalScoreEventId: true,
    },
  },
} satisfies Prisma.GamificationWorkXpEventSelect;

const developerGlobalScoreEventSelect = {
  id: true,
  workspaceId: true,
  recipientMembershipId: true,
  workXpEventId: true,
  workType: true,
  sourceEntityId: true,
  eventType: true,
  scoreType: true,
  categorySnapshot: true,
  baselineVersionSnapshot: true,
  eligibleWorkspaceCountSnapshot: true,
  normalizedScore: true,
  status: true,
  occurredAt: true,
  reversalOfGlobalScoreEventId: true,
  workspace: { select: { name: true, agency: { select: { id: true, name: true } } } },
} satisfies Prisma.GamificationGlobalScoreEventSelect;

const developerReconciliationSelect = {
  id: true,
  workspaceId: true,
  membershipId: true,
  claimedXpSnapshot: true,
  storedXpSnapshot: true,
  currentXpBeforeSnapshot: true,
  deltaSnapshot: true,
  adjustmentAmount: true,
  currentXpAfterSnapshot: true,
  status: true,
  createdAt: true,
  workspace: { select: { name: true, agency: { select: { id: true, name: true } } } },
  membership: { select: { user: { select: { name: true } } } },
} satisfies Prisma.GamificationXpReconciliationSelect;

const gamificationPointRuleSelect = {
  id: true,
  workspaceId: true,
  departmentId: true,
  scopeType: true,
  workType: true,
  category: true,
  isEnabled: true,
  baseXp: true,
  earlyBonusXp: true,
  earlyThresholdMinutes: true,
  latePenaltyPercent: true,
  penaltyIntervalMinutes: true,
  maxPenaltyXp: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.GamificationPointRuleSelect;

const gamificationCreationPointRuleSelect = {
  id: true,
  workspaceId: true,
  departmentId: true,
  scopeType: true,
  workType: true,
  category: true,
  roleId: true,
  isEnabled: true,
  creationXp: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.GamificationCreationPointRuleSelect;

const pointRuleOrderBy = [
  { scopeType: 'asc' },
  { workType: 'asc' },
  { category: 'asc' },
  { departmentId: 'asc' },
  { id: 'asc' },
] satisfies Prisma.GamificationPointRuleOrderByWithRelationInput[];

const creationPointRuleOrderBy = [
  { scopeType: 'asc' },
  { workType: 'asc' },
  { category: 'asc' },
  { roleId: 'asc' },
  { departmentId: 'asc' },
  { id: 'asc' },
] satisfies Prisma.GamificationCreationPointRuleOrderByWithRelationInput[];

const adminMemberSelect = {
  id: true,
  status: true,
  user: { select: { name: true } },
  department: { select: { name: true } },
} satisfies Prisma.WorkspaceMembershipSelect;

const gamificationStreakConfigSelect = {
  id: true,
  workspaceId: true,
  enabled: true,
  dailyXpReward: true,
  dailyRewardPoints: true,
  enabledAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.GamificationStreakConfigSelect;

const gamificationStreakDaySelect = {
  id: true,
  workspaceId: true,
  membershipId: true,
  localDate: true,
  qualificationType: true,
  sourceEntityId: true,
  qualifiedAt: true,
  timezoneSnapshot: true,
  dailyXpRewardSnapshot: true,
  dailyRewardPointsSnapshot: true,
  createdAt: true,
} satisfies Prisma.GamificationStreakDaySelect;

const gamificationLevelSelect = {
  id: true,
  workspaceId: true,
  name: true,
  description: true,
  levelNumber: true,
  xpThreshold: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.GamificationLevelSelect;

const gamificationBadgeSelect = {
  id: true,
  workspaceId: true,
  name: true,
  description: true,
  iconKey: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.GamificationBadgeDefinitionSelect;

const gamificationAchievementSelect = {
  id: true,
  workspaceId: true,
  name: true,
  description: true,
  criterionType: true,
  criterionValue: true,
  badgeDefinitionId: true,
  xpReward: true,
  rewardPointsReward: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  badgeDefinition: { select: { id: true, name: true, iconKey: true, isActive: true } },
} satisfies Prisma.GamificationAchievementDefinitionSelect;

const gamificationAchievementAwardSelect = {
  id: true,
  achievementDefinitionId: true,
  achievementNameSnapshot: true,
  criterionTypeSnapshot: true,
  criterionValueSnapshot: true,
  badgeDefinitionIdSnapshot: true,
  xpRewardSnapshot: true,
  rewardPointsRewardSnapshot: true,
  earnedAt: true,
} satisfies Prisma.GamificationAchievementAwardSelect;

const gamificationBadgeAwardSelect = {
  id: true,
  badgeDefinitionId: true,
  badgeNameSnapshot: true,
  badgeIconKeySnapshot: true,
  achievementAwardId: true,
  earnedAt: true,
  badgeDefinition: {
    select: { id: true, name: true, description: true, iconKey: true, isActive: true },
  },
} satisfies Prisma.GamificationBadgeAwardSelect;

const xpEntrySelect = {
  id: true,
  amount: true,
  entryType: true,
  sourceType: true,
  sourceEvent: true,
  sourceEntityId: true,
  reason: true,
  createdAt: true,
} satisfies Prisma.GamificationXpEntrySelect;

const rewardPointEntrySelect = {
  id: true,
  amount: true,
  entryType: true,
  sourceType: true,
  sourceEvent: true,
  sourceEntityId: true,
  reason: true,
  createdAt: true,
} satisfies Prisma.GamificationRewardPointEntrySelect;

const gamificationRewardSelect = {
  id: true,
  workspaceId: true,
  name: true,
  description: true,
  pointsCost: true,
  inventoryMode: true,
  availableQuantity: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.GamificationRewardDefinitionSelect;

const gamificationRewardRedemptionSelect = {
  id: true,
  workspaceId: true,
  membershipId: true,
  rewardDefinitionId: true,
  status: true,
  rewardNameSnapshot: true,
  pointsCostSnapshot: true,
  inventoryModeSnapshot: true,
  requestedAt: true,
  fulfilledAt: true,
  cancelledAt: true,
  fulfilledByMembershipId: true,
  cancelledByMembershipId: true,
  cancelReason: true,
  rewardDefinition: { select: { id: true, name: true, isActive: true } },
} satisfies Prisma.GamificationRewardRedemptionSelect;

type SelectedGamificationLevel = Prisma.GamificationLevelGetPayload<{
  select: typeof gamificationLevelSelect;
}>;

type SelectedGamificationAchievement = Prisma.GamificationAchievementDefinitionGetPayload<{
  select: typeof gamificationAchievementSelect;
}>;

type SelectedGamificationBadge = Prisma.GamificationBadgeDefinitionGetPayload<{
  select: typeof gamificationBadgeSelect;
}>;

type SelectedGamificationReward = Prisma.GamificationRewardDefinitionGetPayload<{
  select: typeof gamificationRewardSelect;
}>;

interface LeaderboardSqlRow {
  membershipId: string;
  departmentId: string | null;
  departmentName: string | null;
  name: string | null;
  privacyMode: GamificationLeaderboardPrivacyMode;
  currentXp: number;
  rank: number;
}

function deriveLevelProgress(currentXp: number, activeLevels: SelectedGamificationLevel[]) {
  if (activeLevels.length === 0) {
    return {
      levelsConfigured: false,
      currentLevel: null,
      nextLevel: null,
      xpIntoCurrentLevel: null,
      xpToNextLevel: null,
      progressPercent: null,
      isMaxLevel: false,
    };
  }
  const currentLevel =
    [...activeLevels].reverse().find((level) => level.xpThreshold <= currentXp) ?? activeLevels[0]!;
  const currentIndex = activeLevels.findIndex((level) => level.id === currentLevel.id);
  const nextLevel = activeLevels.find(
    (level, index) => index > currentIndex && level.xpThreshold > currentXp,
  );
  const xpIntoCurrentLevel = Math.max(0, currentXp - currentLevel.xpThreshold);
  if (!nextLevel) {
    return {
      levelsConfigured: true,
      currentLevel,
      nextLevel: null,
      xpIntoCurrentLevel,
      xpToNextLevel: null,
      progressPercent: 100,
      isMaxLevel: true,
    };
  }
  const span = nextLevel.xpThreshold - currentLevel.xpThreshold;
  const progressPercent = clampPercent(Math.floor((xpIntoCurrentLevel / span) * 100));
  return {
    levelsConfigured: true,
    currentLevel,
    nextLevel,
    xpIntoCurrentLevel,
    xpToNextLevel: Math.max(0, nextLevel.xpThreshold - currentXp),
    progressPercent,
    isMaxLevel: false,
  };
}

function leaderboardEntryFromRow(
  row: LeaderboardSqlRow,
  activeLevels: SelectedGamificationLevel[],
  index: number,
  currentMembershipId: string,
) {
  const isCurrentUser = row.membershipId === currentMembershipId;
  return {
    key: `rank-${row.rank}-${index + 1}`,
    rank: row.rank,
    displayName: leaderboardDisplayName(row, isCurrentUser),
    currentXp: row.currentXp,
    currentLevel: deriveLevelProgress(row.currentXp, activeLevels).currentLevel,
    isCurrentUser,
    privacyMode: row.privacyMode,
    departmentName:
      row.privacyMode === GamificationLeaderboardPrivacyMode.OPT_OUT ? null : row.departmentName,
  };
}

function leaderboardSelfFromRow(
  row: LeaderboardSqlRow,
  activeLevels: SelectedGamificationLevel[],
  inTopEntries: boolean,
  currentMembershipId: string,
) {
  return {
    included: true,
    rank: row.rank,
    currentXp: row.currentXp,
    currentLevel: deriveLevelProgress(row.currentXp, activeLevels).currentLevel,
    privacyMode: row.privacyMode,
    inTopEntries,
    displayName: leaderboardDisplayName(row, row.membershipId === currentMembershipId),
  };
}

function leaderboardDisplayName(row: LeaderboardSqlRow, isCurrentUser: boolean) {
  if (isCurrentUser) return 'You';
  if (row.privacyMode === GamificationLeaderboardPrivacyMode.ANONYMOUS) return 'Anonymous Member';
  if (row.privacyMode === GamificationLeaderboardPrivacyMode.OPT_OUT) return 'Hidden Member';
  const name = row.name?.trim();
  return name || 'Workspace Member';
}

function unavailableLeaderboard(
  scope: 'WORKSPACE' | 'DEPARTMENT',
  reason: string,
  config: Awaited<ReturnType<GamificationService['getLeaderboardConfig']>>,
  preference: Awaited<ReturnType<GamificationService['getMyLeaderboardPreference']>>,
) {
  return {
    scope,
    period: 'ALL_TIME',
    available: false,
    reason,
    config,
    entries: [],
    me: {
      included: false,
      rank: null,
      currentXp: null,
      currentLevel: null,
      privacyMode: preference.privacyMode,
      inTopEntries: false,
    },
  };
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

function localDateString(date: Date, timezone: string) {
  return DateTime.fromJSDate(date).setZone(timezone).toISODate()!;
}

function localDateAsDatabaseDate(date: Date, timezone: string) {
  return DateTime.fromISO(localDateString(date, timezone), { zone: 'UTC' }).toJSDate();
}

function dateOnlyString(value: Date) {
  return DateTime.fromJSDate(value, { zone: 'UTC' }).toISODate()!;
}

function deriveStreakStats(localDates: string[], today: string) {
  const unique = [...new Set(localDates)].sort();
  let longestStreak = 0;
  let run = 0;
  let previous: string | null = null;
  for (const date of unique) {
    const expected = previous
      ? DateTime.fromISO(previous, { zone: 'UTC' }).plus({ days: 1 }).toISODate()
      : null;
    run = expected === date ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
    previous = date;
  }
  const dates = new Set(unique);
  const yesterday = DateTime.fromISO(today, { zone: 'UTC' }).minus({ days: 1 }).toISODate()!;
  const anchor = dates.has(today) ? today : dates.has(yesterday) ? yesterday : null;
  let currentStreak = 0;
  if (anchor) {
    let cursor = anchor;
    while (dates.has(cursor)) {
      currentStreak += 1;
      cursor = DateTime.fromISO(cursor, { zone: 'UTC' }).minus({ days: 1 }).toISODate()!;
    }
  }
  return { currentStreak, longestStreak };
}

function requireWorkspaceMembership(tenant: WorkspaceTenantContext) {
  if (!tenant.workspaceMembershipId) throw new ForbiddenException('WORKSPACE_MEMBERSHIP_REQUIRED');
  return tenant.workspaceMembershipId;
}

interface WorkEventIdentity {
  workspaceId: string;
  workType: GamificationPointWorkType;
  sourceEntityId: string;
  sourceLabel: string | null;
  category: GamificationPointCategory | null;
  departmentId: string | null;
  departmentName: string | null;
}

interface WorkCreationInput extends WorkEventIdentity {
  creatorMembershipId: string | null;
  occurredAt: Date;
}

interface WorkCompletionInput extends WorkEventIdentity {
  recipients: Array<{ membershipId: string; active: boolean }>;
  triggeredByMembershipId: string | null;
  dueAt: Date | null;
  completedAt: Date;
  emptyRecipientSkipReason?: GamificationWorkXpSkipReason;
}

interface WorkEventBase {
  eventType: GamificationWorkXpEventType;
  occurredAt: Date;
}

interface WorkSkippedEventInput extends WorkEventIdentity, WorkEventBase {
  recipientMembershipId: string | null;
  triggeredByMembershipId?: string | null;
  completionCycle?: number | null;
  roleId?: string | null;
  roleName?: string | null;
  ruleId?: string | null;
  ruleSource?: string | null;
  skipReason: GamificationWorkXpSkipReason;
}

interface WorkAppliedEventInput extends WorkEventIdentity, WorkEventBase {
  recipientMembershipId: string;
  triggeredByMembershipId?: string | null;
  completionCycle?: number | null;
  roleId?: string | null;
  roleName?: string | null;
  ruleId?: string | null;
  ruleSource?: string | null;
  creationXp?: number | null;
  baseXp?: number;
  bonusXp?: number;
  penaltyXp?: number;
  netXp?: number;
  ruleSnapshot?: Prisma.GamificationPointRuleGetPayload<{
    select: typeof gamificationPointRuleSelect;
  }> | null;
  dueAt?: Date | null;
  completedAt?: Date | null;
  components: Array<{ label: string; amount: number }>;
}

interface WorkReverseInput {
  workspaceId: string;
  workType: GamificationPointWorkType;
  sourceEntityId: string;
  eventType: GamificationWorkXpEventType;
  reversalType: GamificationWorkXpEventType;
  triggeredByMembershipId: string | null;
}

type GlobalScoreWorkXpEvent = Prisma.GamificationWorkXpEventGetPayload<object>;
type GlobalScoreBaseline = Prisma.GamificationGlobalScoreBaselineGetPayload<object>;

function roundHalfUpAverage(values: number[]) {
  if (values.length === 0) return 0;
  return Math.floor(values.reduce((sum, value) => sum + value, 0) / values.length + 0.5);
}

function zeroToNull(value: number | null | undefined) {
  return value && value > 0 ? value : null;
}

function negateNullable(value: number | null | undefined) {
  return value === null || value === undefined ? null : -value;
}

function isWorkXpReversal(eventType: GamificationWorkXpEventType) {
  return (
    eventType === GamificationWorkXpEventType.CREATION_REVERSAL ||
    eventType === GamificationWorkXpEventType.COMPLETION_REVERSAL
  );
}

function isGloballyEligibleWorkXpEvent(event: GlobalScoreWorkXpEvent) {
  if (
    event.eventType !== GamificationWorkXpEventType.CREATION_AWARD &&
    event.eventType !== GamificationWorkXpEventType.COMPLETION_AWARD
  ) {
    return false;
  }
  if (event.outcome === GamificationWorkXpEventOutcome.APPLIED) return true;
  if (event.outcome !== GamificationWorkXpEventOutcome.SKIPPED) return false;
  return (
    event.skipReason === GamificationWorkXpSkipReason.NOT_CONFIGURED ||
    event.skipReason === GamificationWorkXpSkipReason.RULE_DISABLED ||
    (event.eventType === GamificationWorkXpEventType.CREATION_AWARD &&
      event.skipReason === GamificationWorkXpSkipReason.AMBIGUOUS_ROLE)
  );
}

function globalScoreBaselineSnapshots(
  baseline: GlobalScoreBaseline,
): Partial<Prisma.GamificationGlobalScoreEventUncheckedCreateInput> {
  return {
    baselineId: baseline.id,
    baselineVersionSnapshot: baseline.baselineVersion,
    eligibleWorkspaceCountSnapshot: baseline.eligibleWorkspaceCount,
    normalizedCreationXpSnapshot: baseline.normalizedCreationXp,
    normalizedBaseXpSnapshot: baseline.normalizedBaseXp,
    normalizedBonusXpSnapshot: baseline.normalizedEarlyBonusXp,
    normalizedPenaltyXpSnapshot: baseline.normalizedMaxPenaltyXp,
  };
}

function globalScoreEventBase(
  event: GlobalScoreWorkXpEvent,
  scoreType: GamificationGlobalScoreEventScoreType,
  status: GamificationGlobalScoreEventStatus,
  idempotencyKey: string,
): Prisma.GamificationGlobalScoreEventUncheckedCreateInput {
  return {
    workspaceId: event.workspaceId,
    recipientMembershipId: event.recipientMembershipId,
    workXpEventId: event.id,
    workType: event.workType,
    sourceEntityId: event.sourceEntityId,
    eventType: event.eventType,
    scoreType,
    categorySnapshot: event.categorySnapshot,
    status,
    occurredAt: event.occurredAt,
    idempotencyKey,
  };
}

function categoryFrom(value: string | null | undefined) {
  return value ? (value as GamificationPointCategory) : null;
}

function workEventBase(
  input: Pick<WorkEventIdentity, 'workType' | 'sourceEntityId'> & {
    occurredAt?: Date;
    completedAt?: Date;
  },
  eventType: GamificationWorkXpEventType,
): WorkEventBase {
  return { eventType, occurredAt: input.occurredAt ?? input.completedAt ?? new Date() };
}

function workEventKey(
  input: WorkEventIdentity & { eventType: GamificationWorkXpEventType },
  recipientMembershipId: string | null,
  completionCycle?: number | null,
) {
  return [
    input.eventType,
    input.workType,
    input.sourceEntityId,
    recipientMembershipId ?? 'none',
    completionCycle ?? 'none',
  ].join(':');
}

function workXpSourceType(workType: GamificationPointWorkType) {
  if (workType === GamificationPointWorkType.TASK) return GamificationXpSourceType.TASK;
  if (workType === GamificationPointWorkType.PROJECT) return GamificationXpSourceType.PROJECT;
  return GamificationXpSourceType.TICKET;
}

function safeWorkLabel(value: string | null | undefined) {
  if (!value) return null;
  return value.trim().replace(/\s+/g, ' ').slice(0, 160) || null;
}

function normalizeApplyInput(
  input: ApplyXpChangeInput,
): Prisma.GamificationXpEntryUncheckedCreateInput {
  if (
    !Number.isInteger(input.amount) ||
    input.amount === 0 ||
    Math.abs(input.amount) > MAX_XP_AMOUNT
  )
    throw new BadRequestException('XP_AMOUNT_INVALID');
  if (input.entryType === GamificationXpEntryType.EARN && input.amount <= 0)
    throw new BadRequestException('XP_EARN_AMOUNT_INVALID');
  if (input.entryType === GamificationXpEntryType.DEDUCT && input.amount >= 0)
    throw new BadRequestException('XP_DEDUCT_AMOUNT_INVALID');
  if (input.entryType === GamificationXpEntryType.REVERSAL)
    throw new BadRequestException('XP_REVERSAL_USE_REVERSE_METHOD');
  return {
    workspaceId: input.workspaceId,
    membershipId: input.membershipId,
    amount: input.amount,
    entryType: input.entryType,
    sourceType: input.sourceType,
    sourceEvent: requireBoundedText(
      input.sourceEvent,
      SOURCE_EVENT_MAX_LENGTH,
      'XP_SOURCE_EVENT_INVALID',
    ),
    sourceEntityId: input.sourceEntityId ?? null,
    idempotencyKey: normalizeBoundedText(
      input.idempotencyKey,
      IDEMPOTENCY_KEY_MAX_LENGTH,
      'XP_IDEMPOTENCY_KEY_INVALID',
    ),
    reversalOfEntryId: null,
    workXpEventId: input.workXpEventId ?? null,
    reconciliationId: input.reconciliationId ?? null,
    actorMembershipId: input.actorMembershipId ?? null,
    reason: normalizeBoundedText(input.reason, REASON_MAX_LENGTH, 'XP_REASON_INVALID'),
  };
}

function normalizeRewardPointApplyInput(
  input: ApplyRewardPointChangeInput,
): Prisma.GamificationRewardPointEntryUncheckedCreateInput {
  if (
    !Number.isInteger(input.amount) ||
    input.amount === 0 ||
    Math.abs(input.amount) > MAX_REWARD_POINT_AMOUNT
  )
    throw new BadRequestException('REWARD_POINT_AMOUNT_INVALID');
  if (
    (input.entryType === GamificationRewardPointEntryType.EARN ||
      input.entryType === GamificationRewardPointEntryType.REFUND) &&
    input.amount <= 0
  )
    throw new BadRequestException('REWARD_POINT_POSITIVE_AMOUNT_REQUIRED');
  if (input.entryType === GamificationRewardPointEntryType.SPEND && input.amount >= 0)
    throw new BadRequestException('REWARD_POINT_SPEND_AMOUNT_INVALID');
  if (input.entryType === GamificationRewardPointEntryType.REVERSAL)
    throw new BadRequestException('REWARD_POINT_REVERSAL_USE_REVERSE_METHOD');
  return {
    workspaceId: input.workspaceId,
    membershipId: input.membershipId,
    amount: input.amount,
    entryType: input.entryType,
    sourceType: input.sourceType,
    sourceEvent: requireBoundedText(
      input.sourceEvent,
      SOURCE_EVENT_MAX_LENGTH,
      'REWARD_POINT_SOURCE_EVENT_INVALID',
    ),
    sourceEntityId: input.sourceEntityId ?? null,
    idempotencyKey: normalizeBoundedText(
      input.idempotencyKey,
      IDEMPOTENCY_KEY_MAX_LENGTH,
      'REWARD_POINT_IDEMPOTENCY_KEY_INVALID',
    ),
    reversalOfEntryId: null,
    actorMembershipId: input.actorMembershipId ?? null,
    reason: normalizeBoundedText(input.reason, REASON_MAX_LENGTH, 'REWARD_POINT_REASON_INVALID'),
  };
}

function normalizeLevelCreateInput(dto: CreateGamificationLevelDto) {
  return {
    name: requireBoundedText(dto.name, LEVEL_NAME_MAX_LENGTH, 'LEVEL_NAME_INVALID'),
    normalizedName: normalizeLevelName(dto.name),
    description: normalizeBoundedText(
      dto.description,
      LEVEL_DESCRIPTION_MAX_LENGTH,
      'LEVEL_DESCRIPTION_INVALID',
    ),
    levelNumber: requireBoundedInt(dto.levelNumber, 1, MAX_LEVEL_NUMBER, 'LEVEL_NUMBER_INVALID'),
    xpThreshold: requireBoundedInt(
      dto.xpThreshold,
      0,
      MAX_LEVEL_XP_THRESHOLD,
      'LEVEL_XP_THRESHOLD_INVALID',
    ),
    isActive: dto.isActive ?? true,
  };
}

function normalizeLevelUpdateInput(dto: UpdateGamificationLevelDto) {
  const data: Prisma.GamificationLevelUncheckedUpdateInput = {};
  if (dto.name !== undefined) {
    data.name = requireBoundedText(dto.name, LEVEL_NAME_MAX_LENGTH, 'LEVEL_NAME_INVALID');
    data.normalizedName = normalizeLevelName(dto.name);
  }
  if (dto.description !== undefined) {
    data.description = normalizeBoundedText(
      dto.description,
      LEVEL_DESCRIPTION_MAX_LENGTH,
      'LEVEL_DESCRIPTION_INVALID',
    );
  }
  if (dto.levelNumber !== undefined) {
    data.levelNumber = requireBoundedInt(
      dto.levelNumber,
      1,
      MAX_LEVEL_NUMBER,
      'LEVEL_NUMBER_INVALID',
    );
  }
  if (dto.xpThreshold !== undefined) {
    data.xpThreshold = requireBoundedInt(
      dto.xpThreshold,
      0,
      MAX_LEVEL_XP_THRESHOLD,
      'LEVEL_XP_THRESHOLD_INVALID',
    );
  }
  if (dto.isActive !== undefined) data.isActive = dto.isActive;
  return data;
}

function normalizeLevelName(name: string) {
  return requireBoundedText(name, LEVEL_NAME_MAX_LENGTH, 'LEVEL_NAME_INVALID').toLocaleLowerCase();
}

function normalizeBadgeCreateInput(dto: CreateGamificationBadgeDto) {
  return {
    name: requireBoundedText(dto.name, DEFINITION_NAME_MAX_LENGTH, 'BADGE_NAME_INVALID'),
    normalizedName: normalizeDefinitionName(dto.name),
    description: normalizeBoundedText(
      dto.description,
      DEFINITION_DESCRIPTION_MAX_LENGTH,
      'BADGE_DESCRIPTION_INVALID',
    ),
    iconKey: normalizeBoundedText(dto.iconKey, BADGE_ICON_MAX_LENGTH, 'BADGE_ICON_INVALID'),
    isActive: dto.isActive ?? true,
  };
}

function normalizeBadgeUpdateInput(dto: UpdateGamificationBadgeDto) {
  const data: Prisma.GamificationBadgeDefinitionUncheckedUpdateInput = {};
  if (dto.name !== undefined) {
    data.name = requireBoundedText(dto.name, DEFINITION_NAME_MAX_LENGTH, 'BADGE_NAME_INVALID');
    data.normalizedName = normalizeDefinitionName(dto.name);
  }
  if (dto.description !== undefined)
    data.description = normalizeBoundedText(
      dto.description,
      DEFINITION_DESCRIPTION_MAX_LENGTH,
      'BADGE_DESCRIPTION_INVALID',
    );
  if (dto.iconKey !== undefined)
    data.iconKey = normalizeBoundedText(dto.iconKey, BADGE_ICON_MAX_LENGTH, 'BADGE_ICON_INVALID');
  if (dto.isActive !== undefined) data.isActive = dto.isActive;
  return data;
}

function normalizeAchievementCreateInput(dto: CreateGamificationAchievementDto) {
  return {
    name: requireBoundedText(dto.name, DEFINITION_NAME_MAX_LENGTH, 'ACHIEVEMENT_NAME_INVALID'),
    normalizedName: normalizeDefinitionName(dto.name),
    description: normalizeBoundedText(
      dto.description,
      DEFINITION_DESCRIPTION_MAX_LENGTH,
      'ACHIEVEMENT_DESCRIPTION_INVALID',
    ),
    criterionType: dto.criterionType,
    criterionValue: requireBoundedInt(
      dto.criterionValue,
      1,
      MAX_ACHIEVEMENT_CRITERION_VALUE,
      'ACHIEVEMENT_CRITERION_VALUE_INVALID',
    ),
    badgeDefinitionId: dto.badgeDefinitionId ?? null,
    xpReward: requireBoundedInt(
      dto.xpReward ?? 0,
      0,
      MAX_ACHIEVEMENT_XP_REWARD,
      'ACHIEVEMENT_XP_REWARD_INVALID',
    ),
    rewardPointsReward: requireBoundedInt(
      dto.rewardPointsReward ?? 0,
      0,
      MAX_ACHIEVEMENT_REWARD_POINTS_REWARD,
      'ACHIEVEMENT_REWARD_POINTS_REWARD_INVALID',
    ),
    isActive: dto.isActive ?? true,
  };
}

function normalizeAchievementUpdateInput(dto: UpdateGamificationAchievementDto) {
  const data: Prisma.GamificationAchievementDefinitionUncheckedUpdateInput = {};
  if (dto.name !== undefined) {
    data.name = requireBoundedText(
      dto.name,
      DEFINITION_NAME_MAX_LENGTH,
      'ACHIEVEMENT_NAME_INVALID',
    );
    data.normalizedName = normalizeDefinitionName(dto.name);
  }
  if (dto.description !== undefined)
    data.description = normalizeBoundedText(
      dto.description,
      DEFINITION_DESCRIPTION_MAX_LENGTH,
      'ACHIEVEMENT_DESCRIPTION_INVALID',
    );
  if (dto.criterionType !== undefined) data.criterionType = dto.criterionType;
  if (dto.criterionValue !== undefined)
    data.criterionValue = requireBoundedInt(
      dto.criterionValue,
      1,
      MAX_ACHIEVEMENT_CRITERION_VALUE,
      'ACHIEVEMENT_CRITERION_VALUE_INVALID',
    );
  if (dto.badgeDefinitionId !== undefined) data.badgeDefinitionId = dto.badgeDefinitionId;
  if (dto.xpReward !== undefined)
    data.xpReward = requireBoundedInt(
      dto.xpReward,
      0,
      MAX_ACHIEVEMENT_XP_REWARD,
      'ACHIEVEMENT_XP_REWARD_INVALID',
    );
  if (dto.rewardPointsReward !== undefined)
    data.rewardPointsReward = requireBoundedInt(
      dto.rewardPointsReward,
      0,
      MAX_ACHIEVEMENT_REWARD_POINTS_REWARD,
      'ACHIEVEMENT_REWARD_POINTS_REWARD_INVALID',
    );
  if (dto.isActive !== undefined) data.isActive = dto.isActive;
  return data;
}

function normalizeRewardCreateInput(dto: CreateGamificationRewardDto) {
  const inventory = normalizeRewardInventory(dto.inventoryMode, dto.availableQuantity);
  return {
    name: requireBoundedText(dto.name, REWARD_NAME_MAX_LENGTH, 'REWARD_NAME_INVALID'),
    normalizedName: normalizeDefinitionName(dto.name),
    description: normalizeBoundedText(
      dto.description,
      REWARD_DESCRIPTION_MAX_LENGTH,
      'REWARD_DESCRIPTION_INVALID',
    ),
    pointsCost: requireBoundedInt(
      dto.pointsCost,
      1,
      MAX_REWARD_POINTS_REWARD_COST,
      'REWARD_POINTS_COST_INVALID',
    ),
    ...inventory,
    isActive: dto.isActive ?? true,
  };
}

function normalizeRewardUpdateInput(dto: UpdateGamificationRewardDto) {
  const data: Prisma.GamificationRewardDefinitionUncheckedUpdateInput = {};
  if (dto.name !== undefined) {
    data.name = requireBoundedText(dto.name, REWARD_NAME_MAX_LENGTH, 'REWARD_NAME_INVALID');
    data.normalizedName = normalizeDefinitionName(dto.name);
  }
  if (dto.description !== undefined)
    data.description = normalizeBoundedText(
      dto.description,
      REWARD_DESCRIPTION_MAX_LENGTH,
      'REWARD_DESCRIPTION_INVALID',
    );
  if (dto.pointsCost !== undefined)
    data.pointsCost = requireBoundedInt(
      dto.pointsCost,
      1,
      MAX_REWARD_POINTS_REWARD_COST,
      'REWARD_POINTS_COST_INVALID',
    );
  if (dto.inventoryMode !== undefined) {
    Object.assign(data, normalizeRewardInventory(dto.inventoryMode, dto.availableQuantity));
  } else if (dto.availableQuantity !== undefined) {
    data.availableQuantity =
      dto.availableQuantity === null
        ? null
        : requireBoundedInt(
            dto.availableQuantity,
            0,
            MAX_REWARD_AVAILABLE_QUANTITY,
            'REWARD_AVAILABLE_QUANTITY_INVALID',
          );
  }
  if (dto.isActive !== undefined) data.isActive = dto.isActive;
  return data;
}

function normalizeRewardInventory(
  inventoryMode: GamificationRewardInventoryMode,
  availableQuantity: number | null | undefined,
) {
  if (inventoryMode === GamificationRewardInventoryMode.UNLIMITED) {
    return { inventoryMode, availableQuantity: null };
  }
  return {
    inventoryMode,
    availableQuantity: requireBoundedInt(
      availableQuantity ?? -1,
      0,
      MAX_REWARD_AVAILABLE_QUANTITY,
      'REWARD_AVAILABLE_QUANTITY_INVALID',
    ),
  };
}

function normalizeCompletionPointRule(
  dto: Pick<
    UpsertGamificationCompletionPointRuleDto,
    | 'isEnabled'
    | 'baseXp'
    | 'earlyBonusXp'
    | 'earlyThresholdMinutes'
    | 'latePenaltyPercent'
    | 'penaltyIntervalMinutes'
    | 'maxPenaltyXp'
  >,
) {
  const baseXp = requireBoundedInt(dto.baseXp, 0, POINT_RULE_MAX_XP, 'BASE_XP_INVALID');
  if (dto.isEnabled && baseXp <= 0) throw new BadRequestException('BASE_XP_REQUIRED');
  const earlyBonusXp = requireBoundedInt(
    dto.earlyBonusXp ?? 0,
    0,
    POINT_RULE_MAX_XP,
    'EARLY_BONUS_XP_INVALID',
  );
  const earlyThresholdMinutes = dto.earlyThresholdMinutes ?? null;
  if (earlyBonusXp > 0 && (!earlyThresholdMinutes || earlyThresholdMinutes <= 0)) {
    throw new BadRequestException('EARLY_THRESHOLD_REQUIRED');
  }
  const latePenaltyPercent = requireBoundedInt(
    dto.latePenaltyPercent ?? 0,
    0,
    100,
    'LATE_PENALTY_PERCENT_INVALID',
  );
  const penaltyIntervalMinutes = dto.penaltyIntervalMinutes ?? null;
  const maxPenaltyXp = requireBoundedInt(
    dto.maxPenaltyXp ?? 0,
    0,
    POINT_RULE_MAX_XP,
    'MAX_PENALTY_XP_INVALID',
  );
  if (latePenaltyPercent > 0 && (!penaltyIntervalMinutes || maxPenaltyXp <= 0)) {
    throw new BadRequestException('LATE_PENALTY_INTERVAL_REQUIRED');
  }
  if (latePenaltyPercent === 0 && maxPenaltyXp !== 0) {
    throw new BadRequestException('MAX_PENALTY_REQUIRES_PENALTY');
  }
  if (maxPenaltyXp > baseXp) throw new BadRequestException('MAX_PENALTY_EXCEEDS_BASE');
  return {
    baseXp,
    earlyBonusXp,
    earlyThresholdMinutes,
    latePenaltyPercent,
    penaltyIntervalMinutes,
    maxPenaltyXp,
  };
}

function validatePointCategory(
  workType: GamificationPointWorkType,
  category: GamificationPointCategory,
) {
  const valid: GamificationPointCategory[] =
    workType === GamificationPointWorkType.PROJECT
      ? [
          GamificationPointCategory.HIGH,
          GamificationPointCategory.MEDIUM,
          GamificationPointCategory.LONG_TERM,
        ]
      : [
          GamificationPointCategory.LOW,
          GamificationPointCategory.MEDIUM,
          GamificationPointCategory.HIGH,
          GamificationPointCategory.URGENT,
        ];
  if (!valid.includes(category)) throw new BadRequestException('POINT_CATEGORY_INVALID');
}

function pointRuleKeyWhere(
  workspaceId: string,
  scopeType: GamificationPointScopeType,
  departmentId: string | null,
  workType: GamificationPointWorkType,
  category: GamificationPointCategory,
) {
  return {
    workspaceId,
    scopeType,
    departmentId: scopeType === GamificationPointScopeType.WORKSPACE ? null : departmentId,
    workType,
    category,
  };
}

function creationPointRuleKeyWhere(
  workspaceId: string,
  scopeType: GamificationPointScopeType,
  departmentId: string | null,
  workType: GamificationPointWorkType,
  category: GamificationPointCategory,
  roleId: string,
) {
  return {
    ...pointRuleKeyWhere(workspaceId, scopeType, departmentId, workType, category),
    roleId,
  };
}

async function assertDepartmentInWorkspace(
  prisma: Pick<Prisma.TransactionClient, 'department'> | PrismaService,
  workspaceId: string,
  departmentId: string | null,
) {
  if (!departmentId) throw new BadRequestException('DEPARTMENT_REQUIRED');
  const department = await prisma.department.findFirst({
    where: { id: departmentId, workspaceId },
    select: { id: true },
  });
  if (!department) throw new ForbiddenException('DEPARTMENT_NOT_FOUND');
}

function buildEffectiveCompletionRules(
  rules: Array<
    Prisma.GamificationPointRuleGetPayload<{ select: typeof gamificationPointRuleSelect }>
  >,
  departmentId: string | null,
) {
  return pointRuleMatrixKeys().map(({ workType, category }) => {
    const override = departmentId
      ? rules.find(
          (rule) =>
            rule.scopeType === GamificationPointScopeType.DEPARTMENT &&
            rule.departmentId === departmentId &&
            rule.workType === workType &&
            rule.category === category,
        )
      : null;
    const workspaceDefault = rules.find(
      (rule) =>
        rule.scopeType === GamificationPointScopeType.WORKSPACE &&
        rule.workType === workType &&
        rule.category === category,
    );
    const rule = override ?? workspaceDefault ?? null;
    return {
      workType,
      category,
      source: override
        ? 'DEPARTMENT_OVERRIDE'
        : workspaceDefault
          ? 'WORKSPACE_DEFAULT'
          : 'NOT_CONFIGURED',
      rule,
    };
  });
}

function buildEffectiveCreationRules(
  rules: Array<
    Prisma.GamificationCreationPointRuleGetPayload<{
      select: typeof gamificationCreationPointRuleSelect;
    }>
  >,
  departmentId: string | null,
  roles: Array<{ id: string }>,
) {
  return roles.flatMap((role) =>
    pointRuleMatrixKeys().map(({ workType, category }) => {
      const override = departmentId
        ? rules.find(
            (rule) =>
              rule.scopeType === GamificationPointScopeType.DEPARTMENT &&
              rule.departmentId === departmentId &&
              rule.workType === workType &&
              rule.category === category &&
              rule.roleId === role.id,
          )
        : null;
      const workspaceDefault = rules.find(
        (rule) =>
          rule.scopeType === GamificationPointScopeType.WORKSPACE &&
          rule.workType === workType &&
          rule.category === category &&
          rule.roleId === role.id,
      );
      const rule = override ?? workspaceDefault ?? null;
      return {
        roleId: role.id,
        workType,
        category,
        source: override
          ? 'DEPARTMENT_OVERRIDE'
          : workspaceDefault
            ? 'WORKSPACE_DEFAULT'
            : 'NOT_CONFIGURED',
        rule,
      };
    }),
  );
}

function pointRuleMatrixKeys() {
  return [
    ...[
      GamificationPointCategory.LOW,
      GamificationPointCategory.MEDIUM,
      GamificationPointCategory.HIGH,
      GamificationPointCategory.URGENT,
    ].flatMap((category) => [
      { workType: GamificationPointWorkType.TASK, category },
      { workType: GamificationPointWorkType.TICKET, category },
    ]),
    { workType: GamificationPointWorkType.PROJECT, category: GamificationPointCategory.MEDIUM },
    { workType: GamificationPointWorkType.PROJECT, category: GamificationPointCategory.HIGH },
    { workType: GamificationPointWorkType.PROJECT, category: GamificationPointCategory.LONG_TERM },
  ];
}

function pointRuleAuditMetadata(
  rule: Prisma.GamificationPointRuleGetPayload<{ select: typeof gamificationPointRuleSelect }>,
) {
  return {
    scopeType: rule.scopeType,
    departmentId: rule.departmentId,
    workType: rule.workType,
    category: rule.category,
    isEnabled: rule.isEnabled,
    baseXp: rule.baseXp,
    earlyBonusXp: rule.earlyBonusXp,
    earlyThresholdMinutes: rule.earlyThresholdMinutes,
    latePenaltyPercent: rule.latePenaltyPercent,
    penaltyIntervalMinutes: rule.penaltyIntervalMinutes,
    maxPenaltyXp: rule.maxPenaltyXp,
  };
}

function creationPointRuleAuditMetadata(
  rule: Prisma.GamificationCreationPointRuleGetPayload<{
    select: typeof gamificationCreationPointRuleSelect;
  }>,
) {
  return {
    scopeType: rule.scopeType,
    departmentId: rule.departmentId,
    workType: rule.workType,
    category: rule.category,
    roleId: rule.roleId,
    isEnabled: rule.isEnabled,
    creationXp: rule.creationXp,
  };
}

function normalizeDefinitionName(name: string) {
  return requireBoundedText(
    name,
    DEFINITION_NAME_MAX_LENGTH,
    'DEFINITION_NAME_INVALID',
  ).toLocaleLowerCase();
}

function requireBoundedInt(value: number, min: number, max: number, error: string) {
  if (!Number.isInteger(value) || value < min || value > max) throw new BadRequestException(error);
  return value;
}

async function lockWorkspace(tx: Prisma.TransactionClient, workspaceId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id
    FROM workspaces
    WHERE id = ${workspaceId}::uuid
    FOR UPDATE
  `);
  if (rows.length !== 1) throw new ForbiddenException('WORKSPACE_NOT_FOUND');
}

async function validateActiveLevelConfiguration(tx: Prisma.TransactionClient, workspaceId: string) {
  const activeLevels = await tx.gamificationLevel.findMany({
    where: { workspaceId, isActive: true },
    orderBy: [{ levelNumber: 'asc' }, { id: 'asc' }],
    select: { id: true, levelNumber: true, xpThreshold: true },
  });
  if (activeLevels.length === 0) return;
  if (activeLevels[0]!.xpThreshold !== 0) throw new ConflictException('LEVEL_ZERO_BASE_REQUIRED');
  for (let index = 1; index < activeLevels.length; index += 1) {
    if (activeLevels[index]!.xpThreshold <= activeLevels[index - 1]!.xpThreshold) {
      throw new ConflictException('LEVEL_THRESHOLDS_NOT_INCREASING');
    }
  }
}

function assertIdempotentReplay(
  existing: GamificationXpEntry,
  input: Prisma.GamificationXpEntryUncheckedCreateInput,
) {
  if (
    existing.amount !== input.amount ||
    existing.entryType !== input.entryType ||
    existing.sourceType !== input.sourceType ||
    existing.sourceEvent !== input.sourceEvent ||
    existing.sourceEntityId !== input.sourceEntityId ||
    existing.reversalOfEntryId !== input.reversalOfEntryId ||
    existing.workXpEventId !== input.workXpEventId ||
    existing.reconciliationId !== input.reconciliationId
  ) {
    throw new ConflictException('XP_IDEMPOTENCY_CONFLICT');
  }
  return existing;
}

async function applyXpChangeInTransaction(
  tx: Prisma.TransactionClient,
  input: Prisma.GamificationXpEntryUncheckedCreateInput,
) {
  await lockMembership(tx, input.workspaceId, input.membershipId);
  const existing = input.idempotencyKey
    ? await tx.gamificationXpEntry.findFirst({
        where: {
          workspaceId: input.workspaceId,
          membershipId: input.membershipId,
          idempotencyKey: input.idempotencyKey,
        },
      })
    : null;
  if (existing) return assertIdempotentReplay(existing, input);
  await assertActiveMembership(tx, input.workspaceId, input.membershipId);
  if (input.actorMembershipId)
    await assertWorkspaceMembership(tx, input.workspaceId, input.actorMembershipId);
  await assertBalanceFloor(tx, input.workspaceId, input.membershipId, input.amount);
  try {
    return await tx.gamificationXpEntry.create({ data: input });
  } catch (error) {
    if (isUniqueConstraintError(error) && input.idempotencyKey) {
      const replay = await tx.gamificationXpEntry.findFirstOrThrow({
        where: {
          workspaceId: input.workspaceId,
          membershipId: input.membershipId,
          idempotencyKey: input.idempotencyKey,
        },
      });
      return assertIdempotentReplay(replay, input);
    }
    throw error;
  }
}

function assertRewardPointIdempotentReplay(
  existing: GamificationRewardPointEntry,
  input: Prisma.GamificationRewardPointEntryUncheckedCreateInput,
) {
  if (
    existing.amount !== input.amount ||
    existing.entryType !== input.entryType ||
    existing.sourceType !== input.sourceType ||
    existing.sourceEvent !== input.sourceEvent ||
    existing.sourceEntityId !== input.sourceEntityId ||
    existing.reversalOfEntryId !== input.reversalOfEntryId
  ) {
    throw new ConflictException('REWARD_POINT_IDEMPOTENCY_CONFLICT');
  }
  return existing;
}

async function applyRewardPointChangeInTransaction(
  tx: Prisma.TransactionClient,
  input: Prisma.GamificationRewardPointEntryUncheckedCreateInput,
) {
  await lockMembership(tx, input.workspaceId, input.membershipId);
  const existing = input.idempotencyKey
    ? await tx.gamificationRewardPointEntry.findFirst({
        where: {
          workspaceId: input.workspaceId,
          membershipId: input.membershipId,
          idempotencyKey: input.idempotencyKey,
        },
      })
    : null;
  if (existing) return assertRewardPointIdempotentReplay(existing, input);
  await assertActiveMembership(tx, input.workspaceId, input.membershipId);
  if (input.actorMembershipId)
    await assertWorkspaceMembership(tx, input.workspaceId, input.actorMembershipId);
  await assertRewardPointBalanceFloor(tx, input.workspaceId, input.membershipId, input.amount);
  try {
    return await tx.gamificationRewardPointEntry.create({ data: input });
  } catch (error) {
    if (isUniqueConstraintError(error) && input.idempotencyKey) {
      const replay = await tx.gamificationRewardPointEntry.findFirstOrThrow({
        where: {
          workspaceId: input.workspaceId,
          membershipId: input.membershipId,
          idempotencyKey: input.idempotencyKey,
        },
      });
      return assertRewardPointIdempotentReplay(replay, input);
    }
    throw error;
  }
}

async function lockMembership(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  membershipId: string,
) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id
    FROM workspace_memberships
    WHERE id = ${membershipId}::uuid
      AND workspace_id = ${workspaceId}::uuid
    FOR UPDATE
  `);
  if (rows.length !== 1) throw new ForbiddenException('WORKSPACE_MEMBERSHIP_NOT_FOUND');
}

async function lockRewardDefinition(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  rewardId: string,
) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id
    FROM gamification_reward_definitions
    WHERE id = ${rewardId}::uuid
      AND workspace_id = ${workspaceId}::uuid
    FOR UPDATE
  `);
  if (rows.length !== 1) throw new ConflictException('REWARD_NOT_FOUND');
}

async function lockRedemption(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  redemptionId: string,
) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id
    FROM gamification_reward_redemptions
    WHERE id = ${redemptionId}::uuid
      AND workspace_id = ${workspaceId}::uuid
    FOR UPDATE
  `);
  if (rows.length !== 1) throw new ConflictException('REDEMPTION_NOT_FOUND');
}

async function assertActiveMembership(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  membershipId: string,
) {
  const membership = await tx.workspaceMembership.findFirst({
    where: { id: membershipId, workspaceId },
    select: adminMemberSelect,
  });
  if (!membership) throw new ForbiddenException('WORKSPACE_MEMBERSHIP_NOT_FOUND');
  if (membership.status !== MembershipStatus.ACTIVE)
    throw new ForbiddenException('XP_TARGET_MEMBERSHIP_INACTIVE');
  return membership;
}

async function assertWorkspaceMembership(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  membershipId: string,
) {
  const count = await tx.workspaceMembership.count({ where: { id: membershipId, workspaceId } });
  if (count !== 1) throw new ForbiddenException('XP_ACTOR_MEMBERSHIP_INVALID');
}

async function assertActiveBadge(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  badgeDefinitionId: string,
) {
  const badge = await tx.gamificationBadgeDefinition.findFirst({
    where: { id: badgeDefinitionId, workspaceId, isActive: true },
    select: { id: true },
  });
  if (!badge) throw new ConflictException('BADGE_NOT_FOUND');
}

async function assertBalanceFloor(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  membershipId: string,
  delta: number,
) {
  const aggregate = await tx.gamificationXpEntry.aggregate({
    where: { workspaceId, membershipId },
    _sum: { amount: true },
  });
  if ((aggregate._sum.amount ?? 0) + delta < 0) throw new ConflictException('XP_BALANCE_FLOOR');
}

async function currentXpBalanceInTransaction(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  membershipId: string,
) {
  const aggregate = await tx.gamificationXpEntry.aggregate({
    where: { workspaceId, membershipId },
    _sum: { amount: true },
  });
  return Math.max(0, aggregate._sum.amount ?? 0);
}

async function currentRewardPointBalanceInTransaction(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  membershipId: string,
) {
  const aggregate = await tx.gamificationRewardPointEntry.aggregate({
    where: { workspaceId, membershipId },
    _sum: { amount: true },
  });
  return Math.max(0, aggregate._sum.amount ?? 0);
}

async function assertRewardPointBalanceFloor(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  membershipId: string,
  delta: number,
) {
  const aggregate = await tx.gamificationRewardPointEntry.aggregate({
    where: { workspaceId, membershipId },
    _sum: { amount: true },
  });
  if ((aggregate._sum.amount ?? 0) + delta < 0)
    throw new ConflictException('REWARD_POINT_BALANCE_FLOOR');
}

function requireBoundedText(value: string | undefined, max: number, error: string) {
  const normalized = value?.trim();
  if (!normalized || normalized.length > max) throw new BadRequestException(error);
  return normalized;
}

function normalizeBoundedText(value: string | null | undefined, max: number, error: string) {
  if (value == null || value === '') return null;
  return requireBoundedText(value, max, error);
}

const XP_CONTROL_ANALYSIS_VERSION = 'phase10.10.v2';

function xpControlPreviewSecret() {
  return (
    process.env.GAMIFICATION_XP_CONTROL_PREVIEW_SECRET ??
    process.env.JWT_ACCESS_SECRET ??
    'zea-play-xp-control-preview-development-secret'
  );
}

type XpControlPreviewSnapshot = {
  targetMembershipId: string;
  claimedXp: number;
  storedXp: number;
  currentXp: number;
  delta: number;
  status: string;
  sourceAnomalyCount: number;
  evidenceHash: string;
};

function createXpControlPreviewToken(snapshot: XpControlPreviewSnapshot) {
  const payload = JSON.stringify({
    version: XP_CONTROL_ANALYSIS_VERSION,
    ...snapshot,
  });
  const encodedPayload = Buffer.from(payload, 'utf8').toString('base64url');
  const signature = createHmac('sha256', xpControlPreviewSecret())
    .update(encodedPayload)
    .digest('base64url');
  return `${encodedPayload}.${signature}`;
}

function parseXpControlPreviewToken(token: string) {
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature)
    throw new BadRequestException('RECONCILIATION_PREVIEW_INVALID');
  const expected = createHmac('sha256', xpControlPreviewSecret())
    .update(encodedPayload)
    .digest('base64url');
  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    throw new BadRequestException('RECONCILIATION_PREVIEW_INVALID');
  }
  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as {
      version?: unknown;
      targetMembershipId?: unknown;
      claimedXp?: unknown;
      storedXp?: unknown;
      currentXp?: unknown;
      delta?: unknown;
      status?: unknown;
      sourceAnomalyCount?: unknown;
      evidenceHash?: unknown;
    };
    if (
      payload.version !== XP_CONTROL_ANALYSIS_VERSION ||
      typeof payload.targetMembershipId !== 'string' ||
      typeof payload.claimedXp !== 'number' ||
      typeof payload.storedXp !== 'number' ||
      typeof payload.currentXp !== 'number' ||
      typeof payload.delta !== 'number' ||
      typeof payload.status !== 'string' ||
      typeof payload.sourceAnomalyCount !== 'number' ||
      typeof payload.evidenceHash !== 'string'
    ) {
      throw new BadRequestException('RECONCILIATION_PREVIEW_INVALID');
    }
    return {
      targetMembershipId: payload.targetMembershipId,
      claimedXp: payload.claimedXp,
      storedXp: payload.storedXp,
      currentXp: payload.currentXp,
      delta: payload.delta,
      status: payload.status,
      sourceAnomalyCount: payload.sourceAnomalyCount,
      evidenceHash: payload.evidenceHash,
    };
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException('RECONCILIATION_PREVIEW_INVALID');
  }
}

function clampPageSize(value: number, max: number) {
  return Math.min(Math.max(1, value), max);
}

function sortXpControlRows<T extends { [key: string]: unknown; membershipId: string }>(
  rows: T[],
  sortBy: string,
  direction: 'asc' | 'desc',
) {
  const multiplier = direction === 'asc' ? 1 : -1;
  return [...rows].sort((left, right) => {
    const a = left[sortBy];
    const b = right[sortBy];
    const comparison =
      typeof a === 'number' && typeof b === 'number'
        ? a - b
        : xpControlSortText(a).localeCompare(xpControlSortText(b));
    if (comparison !== 0) return comparison * multiplier;
    return left.membershipId.localeCompare(right.membershipId);
  });
}

function xpControlSortText(value: unknown) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

function xpControlEvidenceHash(row: {
  membershipId: string;
  claimedXp: number;
  storedXp: number;
  currentXp: number;
  delta: number;
  status: string;
  sourceAnomalyCount: number;
}) {
  return [
    row.membershipId,
    row.claimedXp,
    row.storedXp,
    row.currentXp,
    row.delta,
    row.status,
    row.sourceAnomalyCount,
  ].join(':');
}

function reconciliationPreviewFromRow(row: {
  membershipId: string;
  displayName: string;
  claimedXp: number;
  storedXp: number;
  currentXp: number;
  delta: number;
  status: string;
  sourceAnomalyCount: number;
}) {
  if (row.delta === 0) throw new ConflictException('RECONCILIATION_NO_CHANGE');
  if (row.sourceAnomalyCount > 0) throw new ConflictException('RECONCILIATION_NEEDS_REVIEW');
  if (row.currentXp + row.delta < 0) throw new ConflictException('RECONCILIATION_FLOOR_CONFLICT');
  const evidenceHash = xpControlEvidenceHash(row);
  return {
    targetMembershipId: row.membershipId,
    displayName: row.displayName,
    claimedXp: row.claimedXp,
    storedXp: row.storedXp,
    currentXp: row.currentXp,
    delta: row.delta,
    proposedDirection: row.delta > 0 ? 'ADD' : 'DEDUCT',
    proposedCorrectionAmount: Math.abs(row.delta),
    expectedStoredXp: row.claimedXp,
    expectedCurrentXp: row.currentXp + row.delta,
    sourceAnomalyCount: row.sourceAnomalyCount,
    analysisVersion: XP_CONTROL_ANALYSIS_VERSION,
    previewToken: createXpControlPreviewToken({
      targetMembershipId: row.membershipId,
      claimedXp: row.claimedXp,
      storedXp: row.storedXp,
      currentXp: row.currentXp,
      delta: row.delta,
      status: row.status,
      sourceAnomalyCount: row.sourceAnomalyCount,
      evidenceHash,
    }),
    evidenceReferences: [
      `membership:${row.membershipId}`,
      `analysis:${XP_CONTROL_ANALYSIS_VERSION}`,
    ],
  };
}

function reconciliationResult(
  reconciliation: {
    id: string;
    claimedXpSnapshot: number;
    storedXpSnapshot: number;
    currentXpBeforeSnapshot: number;
    deltaSnapshot: number;
    adjustmentAmount: number;
    currentXpAfterSnapshot: number;
    status: GamificationXpReconciliationStatus;
    reason: string;
    createdAt: Date;
    xpEntries: Array<{ id: string }>;
  },
  member: ReturnType<typeof adminMemberFromMembership>,
) {
  return {
    id: reconciliation.id,
    member,
    claimedXp: reconciliation.claimedXpSnapshot,
    storedXp: reconciliation.storedXpSnapshot,
    currentXpBefore: reconciliation.currentXpBeforeSnapshot,
    delta: reconciliation.deltaSnapshot,
    adjustmentAmount: reconciliation.adjustmentAmount,
    currentXpAfter: reconciliation.currentXpAfterSnapshot,
    status: reconciliation.status,
    reason: reconciliation.reason,
    entryIds: reconciliation.xpEntries.map((entry) => entry.id),
    createdAt: reconciliation.createdAt,
  };
}

function xpLogCategoryWhere(category: string): Prisma.GamificationXpEntryWhereInput {
  switch (category) {
    case 'TASKS':
      return { workXpEvent: { is: { workType: GamificationPointWorkType.TASK } } };
    case 'PROJECTS':
      return { workXpEvent: { is: { workType: GamificationPointWorkType.PROJECT } } };
    case 'TICKETS':
      return { workXpEvent: { is: { workType: GamificationPointWorkType.TICKET } } };
    case 'CREATION_XP':
      return { sourceEvent: { contains: 'CREATION' } };
    case 'BONUS_XP':
      return { sourceEvent: { contains: 'BONUS' } };
    case 'PENALTY_XP':
      return { sourceEvent: { contains: 'PENALTY' } };
    case 'REVERSALS':
      return { entryType: GamificationXpEntryType.REVERSAL };
    case 'ACHIEVEMENTS':
      return { sourceType: GamificationXpSourceType.ACHIEVEMENT };
    case 'STREAKS':
      return { sourceType: GamificationXpSourceType.STREAK };
    case 'MANUAL_ADJUSTMENTS':
      return {
        sourceType: GamificationXpSourceType.MANUAL,
        sourceEvent: { contains: 'ADJUSTMENT' },
      };
    case 'RESETS':
      return { sourceEvent: { contains: 'RESET' } };
    case 'RECONCILIATION':
      return { reconciliationId: { not: null } };
    case 'LEGACY':
      return {
        workXpEventId: null,
        reconciliationId: null,
        sourceType: {
          notIn: [
            GamificationXpSourceType.ACHIEVEMENT,
            GamificationXpSourceType.STREAK,
            GamificationXpSourceType.MANUAL,
          ],
        },
        NOT: [
          { sourceEvent: { contains: 'RESET' } },
          { sourceEvent: { contains: 'RECONCILIATION' } },
        ],
      };
    default:
      return {};
  }
}

function serializeXpControlLogEntry(
  entry: Prisma.GamificationXpEntryGetPayload<{
    include: {
      workXpEvent: true;
      reconciliation: true;
      actorMembership: { select: typeof adminMemberSelect };
    };
  }>,
) {
  return {
    id: entry.id,
    timestamp: entry.createdAt,
    amount: entry.amount,
    entryType: entry.entryType,
    sourceType: entry.sourceType,
    sourceEvent: entry.sourceEvent,
    sourceEntityId: entry.sourceEntityId,
    category: xpLogCategory(entry),
    reason: entry.reason,
    actor: entry.actorMembership ? adminMemberFromMembership(entry.actorMembership) : null,
    work: entry.workXpEvent
      ? {
          workType: entry.workXpEvent.workType,
          sourceLabel: entry.workXpEvent.sourceLabelSnapshot,
          departmentName: entry.workXpEvent.departmentNameSnapshot,
          category: entry.workXpEvent.categorySnapshot,
          ruleSource: entry.workXpEvent.ruleSourceSnapshot,
          baseXp: entry.workXpEvent.baseXpSnapshot,
          bonusXp: entry.workXpEvent.bonusXpSnapshot,
          penaltyXp: entry.workXpEvent.penaltyXpSnapshot,
          netXp: entry.workXpEvent.netXpSnapshot,
          dueAt: entry.workXpEvent.dueAtSnapshot,
          completedAt: entry.workXpEvent.completedAtSnapshot,
          completionCycle: entry.workXpEvent.completionCycle,
          eventType: entry.workXpEvent.eventType,
          outcome: entry.workXpEvent.outcome,
          skipReason: entry.workXpEvent.skipReason,
          reversalOfEventId: entry.workXpEvent.reversalOfEventId,
        }
      : null,
    reconciliation: entry.reconciliation
      ? {
          id: entry.reconciliation.id,
          claimedXp: entry.reconciliation.claimedXpSnapshot,
          storedXp: entry.reconciliation.storedXpSnapshot,
          delta: entry.reconciliation.deltaSnapshot,
          currentXpBefore: entry.reconciliation.currentXpBeforeSnapshot,
          currentXpAfter: entry.reconciliation.currentXpAfterSnapshot,
          reason: entry.reconciliation.reason,
          createdAt: entry.reconciliation.createdAt,
        }
      : null,
  };
}

function xpLogCategory(entry: {
  sourceType: GamificationXpSourceType;
  sourceEvent: string;
  entryType: GamificationXpEntryType;
  reconciliationId: string | null;
}) {
  if (entry.reconciliationId) return 'RECONCILIATION';
  if (entry.entryType === GamificationXpEntryType.REVERSAL) return 'REVERSALS';
  if (entry.sourceType === GamificationXpSourceType.TASK) return 'TASKS';
  if (entry.sourceType === GamificationXpSourceType.PROJECT) return 'PROJECTS';
  if (entry.sourceType === GamificationXpSourceType.TICKET) return 'TICKETS';
  if (entry.sourceType === GamificationXpSourceType.ACHIEVEMENT) return 'ACHIEVEMENTS';
  if (entry.sourceType === GamificationXpSourceType.STREAK) return 'STREAKS';
  if (entry.sourceEvent.includes('RESET')) return 'RESETS';
  if (entry.sourceType === GamificationXpSourceType.MANUAL) return 'MANUAL_ADJUSTMENTS';
  return 'LEGACY';
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function hasPermission(
  tenant: WorkspaceTenantContext | AgencyTenantContext | SuperAgencyTenantContext,
  permission: string,
) {
  return tenant.permissions.includes('*') || tenant.permissions.includes(permission);
}

function assertPermission(
  tenant: WorkspaceTenantContext | AgencyTenantContext | SuperAgencyTenantContext,
  permission: string,
) {
  if (!hasPermission(tenant, permission)) throw new ForbiddenException('PERMISSION_DENIED');
}

function assertAnyPermission(
  tenant: WorkspaceTenantContext | AgencyTenantContext,
  permissions: string[],
) {
  if (!permissions.some((permission) => hasPermission(tenant, permission)))
    throw new ForbiddenException('PERMISSION_DENIED');
}

function signedAdminAmount(dto: GamificationAdminAdjustmentDto) {
  const amount = requireBoundedInt(dto.amount, 1, MAX_XP_AMOUNT, 'GAMIFICATION_AMOUNT_INVALID');
  return dto.operation === GamificationAdminAdjustmentOperation.ADD ? amount : -amount;
}

function resetChunks(balance: number) {
  const chunks: number[] = [];
  let remaining = balance;
  while (remaining > 0) {
    const amount = Math.min(remaining, MAX_XP_AMOUNT);
    chunks.push(-amount);
    remaining -= amount;
  }
  return chunks;
}

function normalizeOptionalSearch(value: string | undefined) {
  const normalized = value?.trim();
  if (!normalized) return null;
  if (normalized.length > 80) throw new BadRequestException('MEMBER_SEARCH_INVALID');
  return normalized;
}

function safeMemberDisplayName(name: string | null | undefined) {
  return name?.trim() || 'Workspace Member';
}

function adminMemberFromMembership(member: {
  id: string;
  status: MembershipStatus;
  user: { name: string | null };
  department: { name: string } | null;
}) {
  return {
    membershipId: member.id,
    displayName: safeMemberDisplayName(member.user.name),
    departmentName: member.department?.name ?? null,
    status: member.status,
  };
}

function safeAdminAuditMetadata(metadata: Prisma.JsonValue) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  const value = metadata as Record<string, unknown>;
  return {
    targetMembershipId:
      typeof value.targetMembershipId === 'string' ? value.targetMembershipId : null,
    economy: value.economy,
    operation: value.operation ?? null,
    amount: value.amount ?? null,
    before: value.before ?? null,
    after: value.after ?? null,
    reason: typeof value.reason === 'string' ? value.reason : null,
    changed: value.changed ?? null,
  };
}

function canManageAchievements(tenant: WorkspaceTenantContext) {
  return hasPermission(tenant, PermissionKeys.gamificationAchievementsManage);
}

function achievementAuditMetadata(
  definition: Pick<
    GamificationAchievementDefinition,
    | 'id'
    | 'criterionType'
    | 'criterionValue'
    | 'xpReward'
    | 'rewardPointsReward'
    | 'badgeDefinitionId'
    | 'isActive'
  >,
): Prisma.InputJsonObject {
  return {
    definitionId: definition.id,
    criterionType: definition.criterionType,
    criterionValue: definition.criterionValue,
    xpReward: definition.xpReward,
    rewardPointsReward: definition.rewardPointsReward,
    badgeId: definition.badgeDefinitionId,
    isActive: definition.isActive,
  };
}

function rewardAuditMetadata(definition: SelectedGamificationReward): Prisma.InputJsonObject {
  return {
    rewardId: definition.id,
    pointsCost: definition.pointsCost,
    inventoryMode: definition.inventoryMode,
    availableQuantity: definition.availableQuantity,
    isActive: definition.isActive,
  };
}

function metadataAssignedToMembershipId(metadata: Prisma.JsonValue) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const value = metadata.assignedToMembershipId;
  return typeof value === 'string' && uuidPattern.test(value) ? value : null;
}
