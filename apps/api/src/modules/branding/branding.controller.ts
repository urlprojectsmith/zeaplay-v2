import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type {
  AgencyTenantContext,
  AuthenticatedUser,
  SuperAgencyTenantContext,
  WorkspaceTenantContext,
} from '../../common/auth/auth.types';
import { CurrentUser } from '../../common/auth/current-user.decorator';
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
import { BrandingPlatformGuard } from './branding-platform.guard';
import { BrandingService } from './branding.service';
import { UpdateWhiteLabelBrandingDto } from './dto/branding.dto';

@ApiTags('branding')
@ApiBearerAuth()
@Controller()
export class BrandingController {
  constructor(private readonly branding: BrandingService) {}

  @Get('branding/fields')
  getRegistry() {
    return this.branding.getRegistry();
  }

  @Get('branding/public')
  getPublicBranding(@Req() request: Request) {
    return this.branding.resolvePublicForHost(request.get('host'));
  }

  @Get('platform/branding/effective')
  @UseGuards(JwtAuthGuard, BrandingPlatformGuard)
  getPlatformEffective() {
    return this.branding.resolveForScope(this.branding.platformScope());
  }

  @Get('platform/branding/config')
  @UseGuards(JwtAuthGuard, BrandingPlatformGuard)
  getPlatformConfig() {
    return this.branding.getConfig(this.branding.platformScope());
  }

  @Patch('platform/branding/config')
  @UseGuards(JwtAuthGuard, BrandingPlatformGuard)
  updatePlatformConfig(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Body() dto: UpdateWhiteLabelBrandingDto,
  ) {
    return this.branding.updateForScope(this.branding.platformScope(), user, dto);
  }

  @Get('super-agencies/:superAgencyId/branding/effective')
  @ApiHeader({ name: SUPER_AGENCY_HEADER, required: true })
  @UseGuards(JwtAuthGuard, SuperAgencyTenantGuard)
  getSuperAgencyEffective(@CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext) {
    return this.branding.resolveForScope(this.branding.superAgencyScope(tenant));
  }

  @Get('super-agencies/:superAgencyId/branding/config')
  @ApiHeader({ name: SUPER_AGENCY_HEADER, required: true })
  @UseGuards(JwtAuthGuard, SuperAgencyTenantGuard, PermissionGuard)
  @RequirePermissions(PermissionKeys.brandingManage)
  getSuperAgencyConfig(@CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext) {
    return this.branding.getConfig(this.branding.superAgencyScope(tenant));
  }

  @Patch('super-agencies/:superAgencyId/branding/config')
  @ApiHeader({ name: SUPER_AGENCY_HEADER, required: true })
  @UseGuards(JwtAuthGuard, SuperAgencyTenantGuard, PermissionGuard)
  @RequirePermissions(PermissionKeys.brandingManage)
  updateSuperAgencyConfig(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Body() dto: UpdateWhiteLabelBrandingDto,
  ) {
    return this.branding.updateForScope(this.branding.superAgencyScope(tenant), user, dto);
  }

  @Get('agencies/:agencyId/branding/effective')
  @ApiHeader({ name: AGENCY_HEADER, required: true })
  @UseGuards(JwtAuthGuard, AgencyTenantGuard)
  getAgencyEffective(@CurrentAgencyTenant() tenant: AgencyTenantContext) {
    return this.branding.resolveForScope(this.branding.agencyScope(tenant));
  }

  @Get('agencies/:agencyId/branding/config')
  @ApiHeader({ name: AGENCY_HEADER, required: true })
  @UseGuards(JwtAuthGuard, AgencyTenantGuard, PermissionGuard)
  @RequirePermissions(PermissionKeys.brandingManage)
  getAgencyConfig(@CurrentAgencyTenant() tenant: AgencyTenantContext) {
    return this.branding.getConfig(this.branding.agencyScope(tenant));
  }

  @Patch('agencies/:agencyId/branding/config')
  @ApiHeader({ name: AGENCY_HEADER, required: true })
  @UseGuards(JwtAuthGuard, AgencyTenantGuard, PermissionGuard)
  @RequirePermissions(PermissionKeys.brandingManage)
  updateAgencyConfig(
    @CurrentAgencyTenant() tenant: AgencyTenantContext,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Body() dto: UpdateWhiteLabelBrandingDto,
  ) {
    return this.branding.updateForScope(this.branding.agencyScope(tenant), user, dto);
  }

  @Get('workspaces/:workspaceId/branding/effective')
  @ApiHeader({ name: AGENCY_HEADER, required: true })
  @ApiHeader({ name: WORKSPACE_HEADER, required: true })
  @UseGuards(JwtAuthGuard, WorkspaceTenantGuard)
  getWorkspaceEffective(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext) {
    return this.branding.resolveForScope(this.branding.workspaceScope(tenant));
  }

  @Get('workspaces/:workspaceId/branding/config')
  @ApiHeader({ name: AGENCY_HEADER, required: true })
  @ApiHeader({ name: WORKSPACE_HEADER, required: true })
  @UseGuards(JwtAuthGuard, WorkspaceTenantGuard, PermissionGuard)
  @RequirePermissions(PermissionKeys.brandingManage)
  getWorkspaceConfig(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext) {
    return this.branding.getConfig(this.branding.workspaceScope(tenant));
  }

  @Patch('workspaces/:workspaceId/branding/config')
  @ApiHeader({ name: AGENCY_HEADER, required: true })
  @ApiHeader({ name: WORKSPACE_HEADER, required: true })
  @UseGuards(JwtAuthGuard, WorkspaceTenantGuard, PermissionGuard)
  @RequirePermissions(PermissionKeys.brandingManage)
  updateWorkspaceConfig(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Body() dto: UpdateWhiteLabelBrandingDto,
  ) {
    return this.branding.updateForScope(this.branding.workspaceScope(tenant), user, dto);
  }
}
