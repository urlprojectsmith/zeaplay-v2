import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { validateEnvironment } from '@zea-play/config';
import type { Request } from 'express';
import type { WorkspaceTenantContext } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionGuard } from '../../common/authorization/permission.guard';
import { PermissionKeys } from '../../common/authorization/permissions';
import { RequirePermissions } from '../../common/authorization/require-permissions.decorator';
import {
  AGENCY_HEADER,
  CurrentWorkspaceTenant,
  WORKSPACE_HEADER,
} from '../../common/tenant/tenant-context.decorator';
import { WorkspaceTenantGuard } from '../../common/tenant/tenant-context.guard';
import {
  GamificationAdminAdjustmentDto,
  GamificationAdminMemberQueryDto,
  GamificationAdminResetDto,
  GamificationResetStepUpDto,
} from './dto/gamification-admin.dto';
import {
  CreateGamificationAchievementDto,
  CreateGamificationBadgeDto,
  GamificationDefinitionQueryDto,
  UpdateGamificationAchievementDto,
  UpdateGamificationBadgeDto,
} from './dto/gamification-achievement.dto';
import {
  CreateGamificationLevelDto,
  GamificationLevelQueryDto,
  UpdateGamificationLevelDto,
} from './dto/gamification-level.dto';
import {
  GamificationDepartmentLeaderboardParamsDto,
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
  GamificationPointPreviewDto,
  GamificationPointRulesQueryDto,
  RemoveGamificationPointRuleOverrideDto,
  UpsertGamificationCompletionPointRuleDto,
  UpsertGamificationCreationPointRuleDto,
} from './dto/gamification-point-rule.dto';
import { GamificationService } from './gamification.service';
import { AuthService } from '../auth/auth.service';

@ApiTags('gamification')
@ApiBearerAuth()
@ApiHeader({ name: AGENCY_HEADER, required: true })
@ApiHeader({ name: WORKSPACE_HEADER, required: true })
@UseGuards(JwtAuthGuard, WorkspaceTenantGuard, PermissionGuard)
@Controller('workspaces/:workspaceId/gamification')
export class GamificationController {
  private readonly env = validateEnvironment(process.env);

  constructor(
    private readonly gamification: GamificationService,
    private readonly auth: AuthService,
  ) {}

  @Get('me/xp')
  @RequirePermissions(PermissionKeys.gamificationView)
  getMyXpSummary(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext) {
    return this.gamification.getMyXpSummary(tenant);
  }

  @Get('me/xp/history')
  @RequirePermissions(PermissionKeys.gamificationView)
  getMyXpHistory(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Query() query: GamificationXpHistoryQueryDto,
  ) {
    return this.gamification.getMyXpHistory(tenant, query);
  }

  @Get('me/reward-points')
  @RequirePermissions(PermissionKeys.gamificationView)
  getMyRewardPointSummary(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext) {
    return this.gamification.getMyRewardPointSummary(tenant);
  }

  @Get('me/reward-points/history')
  @RequirePermissions(PermissionKeys.gamificationView)
  getMyRewardPointHistory(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Query() query: GamificationRewardPointHistoryQueryDto,
  ) {
    return this.gamification.getMyRewardPointHistory(tenant, query);
  }

  @Get('levels')
  @RequirePermissions(PermissionKeys.gamificationView)
  listLevels(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Query() query: GamificationLevelQueryDto,
  ) {
    return this.gamification.listLevels(tenant, query);
  }

  @Post('levels')
  @RequirePermissions(PermissionKeys.gamificationLevelsManage)
  createLevel(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Body() dto: CreateGamificationLevelDto,
  ) {
    return this.gamification.createLevel(tenant, dto);
  }

  @Patch('levels/:levelId')
  @RequirePermissions(PermissionKeys.gamificationLevelsManage)
  updateLevel(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('levelId') levelId: string,
    @Body() dto: UpdateGamificationLevelDto,
  ) {
    return this.gamification.updateLevel(tenant, levelId, dto);
  }

  @Get('badges')
  @RequirePermissions(PermissionKeys.gamificationView)
  listBadges(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Query() query: GamificationDefinitionQueryDto,
  ) {
    return this.gamification.listBadges(tenant, query);
  }

  @Post('badges')
  @RequirePermissions(PermissionKeys.gamificationAchievementsManage)
  createBadge(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Body() dto: CreateGamificationBadgeDto,
  ) {
    return this.gamification.createBadge(tenant, dto);
  }

  @Patch('badges/:badgeId')
  @RequirePermissions(PermissionKeys.gamificationAchievementsManage)
  updateBadge(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('badgeId') badgeId: string,
    @Body() dto: UpdateGamificationBadgeDto,
  ) {
    return this.gamification.updateBadge(tenant, badgeId, dto);
  }

  @Get('achievements')
  @RequirePermissions(PermissionKeys.gamificationView)
  listAchievements(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Query() query: GamificationDefinitionQueryDto,
  ) {
    return this.gamification.listAchievements(tenant, query);
  }

  @Post('achievements')
  @RequirePermissions(PermissionKeys.gamificationAchievementsManage)
  createAchievement(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Body() dto: CreateGamificationAchievementDto,
  ) {
    return this.gamification.createAchievement(tenant, dto);
  }

  @Patch('achievements/:achievementId')
  @RequirePermissions(PermissionKeys.gamificationAchievementsManage)
  updateAchievement(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('achievementId') achievementId: string,
    @Body() dto: UpdateGamificationAchievementDto,
  ) {
    return this.gamification.updateAchievement(tenant, achievementId, dto);
  }

  @Get('rewards')
  @RequirePermissions(PermissionKeys.gamificationView)
  listRewards(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Query() query: GamificationRewardDefinitionQueryDto,
  ) {
    return this.gamification.listRewards(tenant, query);
  }

  @Post('rewards')
  @RequirePermissions(PermissionKeys.gamificationRewardsManage)
  createReward(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Body() dto: CreateGamificationRewardDto,
  ) {
    return this.gamification.createReward(tenant, dto);
  }

  @Patch('rewards/:rewardId')
  @RequirePermissions(PermissionKeys.gamificationRewardsManage)
  updateReward(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('rewardId') rewardId: string,
    @Body() dto: UpdateGamificationRewardDto,
  ) {
    return this.gamification.updateReward(tenant, rewardId, dto);
  }

  @Post('rewards/:rewardId/redemptions')
  @RequirePermissions(PermissionKeys.gamificationRewardsRedeem)
  redeemReward(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('rewardId') rewardId: string,
    @Body() dto: RedeemGamificationRewardDto,
  ) {
    return this.gamification.redeemReward(tenant, rewardId, dto);
  }

  @Get('rewards/redemptions/me')
  @RequirePermissions(PermissionKeys.gamificationView)
  listMyRewardRedemptions(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Query() query: GamificationRewardRedemptionQueryDto,
  ) {
    return this.gamification.listMyRewardRedemptions(tenant, query);
  }

  @Get('rewards/redemptions')
  @RequirePermissions(PermissionKeys.gamificationRewardsManage)
  listRewardRedemptions(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Query() query: GamificationRewardRedemptionQueryDto,
  ) {
    return this.gamification.listRewardRedemptions(tenant, query);
  }

  @Patch('rewards/redemptions/:redemptionId/fulfill')
  @RequirePermissions(PermissionKeys.gamificationRewardsManage)
  fulfillRewardRedemption(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('redemptionId') redemptionId: string,
  ) {
    return this.gamification.fulfillRewardRedemption(tenant, redemptionId);
  }

  @Patch('rewards/redemptions/:redemptionId/cancel')
  @RequirePermissions(PermissionKeys.gamificationRewardsManage)
  cancelRewardRedemption(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('redemptionId') redemptionId: string,
    @Body() dto: CancelGamificationRewardRedemptionDto,
  ) {
    return this.gamification.cancelRewardRedemption(tenant, redemptionId, dto);
  }

  @Get('streaks/me')
  @RequirePermissions(PermissionKeys.gamificationView)
  getMyStreakSummary(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext) {
    return this.gamification.getMyStreakSummary(tenant);
  }

  @Get('streaks/me/history')
  @RequirePermissions(PermissionKeys.gamificationView)
  getMyStreakHistory(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Query() query: GamificationStreakHistoryQueryDto,
  ) {
    return this.gamification.getMyStreakHistory(tenant, query);
  }

  @Get('streaks/config')
  @RequirePermissions(PermissionKeys.gamificationView)
  getStreakConfig(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext) {
    return this.gamification.getStreakConfig(tenant);
  }

  @Patch('streaks/config')
  @RequirePermissions(PermissionKeys.gamificationStreaksManage)
  updateStreakConfig(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Body() dto: UpdateGamificationStreakConfigDto,
  ) {
    return this.gamification.updateStreakConfig(tenant, dto);
  }

  @Get('leaderboards/config')
  @RequirePermissions(PermissionKeys.gamificationLeaderboardsManage)
  getLeaderboardConfig(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext) {
    return this.gamification.getLeaderboardConfig(tenant);
  }

  @Patch('leaderboards/config')
  @RequirePermissions(PermissionKeys.gamificationLeaderboardsManage)
  updateLeaderboardConfig(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Body() dto: UpdateGamificationLeaderboardConfigDto,
  ) {
    return this.gamification.updateLeaderboardConfig(tenant, dto);
  }

  @Get('leaderboards/me/preferences')
  @RequirePermissions(PermissionKeys.gamificationView)
  getMyLeaderboardPreference(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext) {
    return this.gamification.getMyLeaderboardPreference(tenant);
  }

  @Patch('leaderboards/me/preferences')
  @RequirePermissions(PermissionKeys.gamificationView)
  updateMyLeaderboardPreference(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Body() dto: UpdateGamificationLeaderboardPreferenceDto,
  ) {
    return this.gamification.updateMyLeaderboardPreference(tenant, dto);
  }

  @Get('leaderboards/workspace')
  @RequirePermissions(PermissionKeys.gamificationLeaderboardsView)
  getWorkspaceLeaderboard(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext) {
    return this.gamification.getWorkspaceLeaderboard(tenant);
  }

  @Get('leaderboards/department/me')
  @RequirePermissions(PermissionKeys.gamificationLeaderboardsView)
  getMyDepartmentLeaderboard(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext) {
    return this.gamification.getMyDepartmentLeaderboard(tenant);
  }

  @Get('leaderboards/departments/:departmentId')
  @RequirePermissions(PermissionKeys.gamificationLeaderboardsManage)
  getDepartmentLeaderboard(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: GamificationDepartmentLeaderboardParamsDto,
  ) {
    return this.gamification.getDepartmentLeaderboard(tenant, params.departmentId);
  }

  @Get('points/rules')
  listPointRules(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Query() query: GamificationPointRulesQueryDto,
  ) {
    return this.gamification.listPointRules(tenant, query);
  }

  @Post('points/completion-rules')
  upsertCompletionPointRule(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Body() dto: UpsertGamificationCompletionPointRuleDto,
  ) {
    return this.gamification.upsertCompletionPointRule(tenant, dto);
  }

  @Post('points/completion-rules/remove-override')
  removeCompletionPointRuleOverride(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Body() dto: RemoveGamificationPointRuleOverrideDto,
  ) {
    return this.gamification.removeCompletionPointRuleOverride(tenant, dto);
  }

  @Post('points/creation-rules')
  upsertCreationPointRule(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Body() dto: UpsertGamificationCreationPointRuleDto,
  ) {
    return this.gamification.upsertCreationPointRule(tenant, dto);
  }

  @Post('points/creation-rules/remove-override')
  removeCreationPointRuleOverride(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Body() dto: RemoveGamificationPointRuleOverrideDto,
  ) {
    return this.gamification.removeCreationPointRuleOverride(tenant, dto);
  }

  @Post('points/preview')
  previewCompletionPoints(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Body() dto: GamificationPointPreviewDto,
  ) {
    return this.gamification.previewCompletionPoints(tenant, dto);
  }

  @Get('admin/members')
  listAdminMembers(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Query() query: GamificationAdminMemberQueryDto,
  ) {
    return this.gamification.listAdminMembers(tenant, query);
  }

  @Get('admin/members/:membershipId/balances')
  getAdminMemberBalance(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('membershipId') membershipId: string,
  ) {
    return this.gamification.getAdminMemberBalance(tenant, membershipId);
  }

  @Post('admin/adjustments')
  @RequirePermissions(PermissionKeys.gamificationAdjustmentsManage)
  adjustAdminBalance(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Body() dto: GamificationAdminAdjustmentDto,
  ) {
    return this.gamification.adjustAdminBalance(tenant, dto);
  }

  @Post('admin/resets/step-up')
  @RequirePermissions(PermissionKeys.gamificationReset)
  createResetStepUpGrant(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Body() dto: GamificationResetStepUpDto,
    @Req() request: Request,
  ) {
    const refreshToken = readCookie(request, this.env.REFRESH_TOKEN_COOKIE_NAME);
    if (!refreshToken) throw new UnauthorizedException('STEP_UP_SESSION_INVALID');
    return this.auth.createGamificationResetStepUpGrant({
      userId: tenant.userId,
      refreshToken,
      workspaceId: tenant.workspaceId,
      targetMembershipId: dto.targetMembershipId,
      economy: dto.economy,
      password: dto.password,
      meta: requestMeta(request),
    });
  }

  @Post('admin/resets')
  @RequirePermissions(PermissionKeys.gamificationReset)
  resetAdminBalance(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Body() dto: GamificationAdminResetDto,
    @Req() request: Request,
  ) {
    const refreshToken = readCookie(request, this.env.REFRESH_TOKEN_COOKIE_NAME);
    if (!refreshToken) throw new UnauthorizedException('STEP_UP_SESSION_INVALID');
    return this.gamification.resetAdminBalance(tenant, dto, refreshToken);
  }

  @Get('admin/actions')
  listRecentAdminActions(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext) {
    return this.gamification.listRecentAdminActions(tenant);
  }

  @Get('xp-control/analyzer')
  @RequirePermissions(PermissionKeys.gamificationXpControlView)
  getXpControlAnalyzer(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Query() query: GamificationXpControlQueryDto,
  ) {
    return this.gamification.getXpControlAnalyzer(tenant, query);
  }

  @Get('xp-control/members/:membershipId')
  @RequirePermissions(PermissionKeys.gamificationXpControlView)
  getXpControlMemberDetail(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('membershipId') membershipId: string,
  ) {
    return this.gamification.getXpControlMemberDetail(tenant, membershipId);
  }

  @Get('xp-control/members/:membershipId/log')
  @RequirePermissions(PermissionKeys.gamificationXpControlView)
  getXpControlMemberLog(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('membershipId') membershipId: string,
    @Query() query: GamificationXpLogQueryDto,
  ) {
    return this.gamification.getXpControlMemberLog(tenant, membershipId, query);
  }

  @Post('xp-control/reconciliation/preview')
  @RequirePermissions(PermissionKeys.gamificationXpControlReconcile)
  previewXpReconciliation(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Body() dto: GamificationXpReconciliationPreviewDto,
  ) {
    return this.gamification.previewXpReconciliation(tenant, dto);
  }

  @Post('xp-control/reconciliation/apply')
  @RequirePermissions(PermissionKeys.gamificationXpControlReconcile)
  applyXpReconciliation(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Body() dto: GamificationXpReconciliationApplyDto,
  ) {
    return this.gamification.applyXpReconciliation(tenant, dto);
  }
}

function readCookie(request: Request, name: string) {
  const cookieHeader = request.headers.cookie ?? '';
  for (const segment of cookieHeader.split(';')) {
    const [rawKey, ...rawValue] = segment.trim().split('=');
    if (rawKey === name) {
      try {
        return decodeURIComponent(rawValue.join('='));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function requestMeta(request: Request) {
  return {
    ipAddress: request.ip,
    userAgent: request.get('user-agent'),
  };
}
