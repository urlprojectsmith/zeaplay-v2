import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
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
import { GamificationXpHistoryQueryDto } from './dto/gamification-xp-query.dto';
import { GamificationService } from './gamification.service';

@ApiTags('gamification')
@ApiBearerAuth()
@ApiHeader({ name: AGENCY_HEADER, required: true })
@ApiHeader({ name: WORKSPACE_HEADER, required: true })
@UseGuards(JwtAuthGuard, WorkspaceTenantGuard, PermissionGuard)
@Controller('workspaces/:workspaceId/gamification')
export class GamificationController {
  constructor(private readonly gamification: GamificationService) {}

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
}
