import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type {
  AgencyTenantContext,
  SuperAgencyTenantContext,
  WorkspaceTenantContext,
} from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionGuard } from '../../common/authorization/permission.guard';
import { PermissionKeys } from '../../common/authorization/permissions';
import { RequirePermissions } from '../../common/authorization/require-permissions.decorator';
import {
  AGENCY_HEADER,
  CurrentAgencyTenant,
  CurrentSuperAgencyTenant,
  CurrentWorkspaceTenant,
  SUPER_AGENCY_HEADER,
  WORKSPACE_HEADER,
} from '../../common/tenant/tenant-context.decorator';
import {
  AgencyTenantGuard,
  SuperAgencyTenantGuard,
  WorkspaceTenantGuard,
} from '../../common/tenant/tenant-context.guard';
import { AnalyticsPlatformGuard } from './analytics-platform.guard';
import { AnalyticsService } from './analytics.service';
import { AnalyticsQueryDto, AnalyticsRebuildDto } from './dto/analytics.dto';

@ApiTags('analytics registry')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('analytics')
export class AnalyticsRegistryController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('registry')
  registry() {
    return this.analytics.registry();
  }
}

@ApiTags('workspace analytics')
@ApiBearerAuth()
@ApiHeader({ name: AGENCY_HEADER, required: true })
@ApiHeader({ name: WORKSPACE_HEADER, required: true })
@UseGuards(JwtAuthGuard, WorkspaceTenantGuard, PermissionGuard)
@Controller('workspaces/:workspaceId/analytics')
export class WorkspaceAnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('summary')
  @RequirePermissions(PermissionKeys.analyticsView)
  summary(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analytics.workspaceSummary(tenant, query);
  }
}

@ApiTags('agency analytics')
@ApiBearerAuth()
@ApiHeader({ name: AGENCY_HEADER, required: true })
@UseGuards(JwtAuthGuard, AgencyTenantGuard, PermissionGuard)
@Controller('agencies/:agencyId/analytics')
export class AgencyAnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('summary')
  @RequirePermissions(PermissionKeys.analyticsParentRead)
  summary(@CurrentAgencyTenant() tenant: AgencyTenantContext, @Query() query: AnalyticsQueryDto) {
    return this.analytics.agencySummary(tenant, query);
  }
}

@ApiTags('super agency analytics')
@ApiBearerAuth()
@ApiHeader({ name: SUPER_AGENCY_HEADER, required: true })
@UseGuards(JwtAuthGuard, SuperAgencyTenantGuard, PermissionGuard)
@Controller('super-agencies/:superAgencyId/analytics')
export class SuperAgencyAnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('summary')
  @RequirePermissions(PermissionKeys.analyticsParentRead)
  summary(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analytics.superAgencySummary(tenant, query);
  }

  @Post('rollups/rebuild')
  @RequirePermissions(PermissionKeys.analyticsRebuild)
  async rebuild(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Body() dto: AnalyticsRebuildDto,
  ) {
    return this.analytics.rebuildSuperAgencyRollups(tenant, dto);
  }
}

@ApiTags('platform analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AnalyticsPlatformGuard)
@Controller('platform/analytics')
export class PlatformAnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('summary')
  summary(@Query() query: AnalyticsQueryDto) {
    return this.analytics.platformSummary(query);
  }
}
