import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
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
import { CreateCustomDomainDto, CustomDomainRevisionDto } from './dto/custom-domain.dto';
import { CustomDomainsService } from './custom-domains.service';

@ApiTags('custom-domains')
@ApiBearerAuth()
@Controller()
export class CustomDomainsController {
  constructor(private readonly domains: CustomDomainsService) {}

  @Get('host-resolution')
  @UseGuards(JwtAuthGuard)
  resolveHost(@Req() request: Request) {
    return this.domains.resolveForHost(request.get('host') ?? '');
  }

  @Get('super-agencies/:superAgencyId/custom-domains')
  @ApiHeader({ name: SUPER_AGENCY_HEADER, required: true })
  @UseGuards(JwtAuthGuard, SuperAgencyTenantGuard, PermissionGuard)
  @RequirePermissions(PermissionKeys.customDomainsManage)
  listSuperAgency(@CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext) {
    return this.domains.list(this.domains.superAgencyScope(tenant));
  }

  @Post('super-agencies/:superAgencyId/custom-domains')
  @ApiHeader({ name: SUPER_AGENCY_HEADER, required: true })
  @UseGuards(JwtAuthGuard, SuperAgencyTenantGuard, PermissionGuard)
  @RequirePermissions(PermissionKeys.customDomainsManage)
  createSuperAgency(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Body() dto: CreateCustomDomainDto,
  ) {
    return this.domains.create(this.domains.superAgencyScope(tenant), user, dto);
  }

  @Post('super-agencies/:superAgencyId/custom-domains/:domainId/verify')
  @ApiHeader({ name: SUPER_AGENCY_HEADER, required: true })
  @UseGuards(JwtAuthGuard, SuperAgencyTenantGuard, PermissionGuard)
  @RequirePermissions(PermissionKeys.customDomainsManage)
  verifySuperAgency(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('domainId') domainId: string,
  ) {
    return this.domains.verify(this.domains.superAgencyScope(tenant), user, domainId);
  }

  @Post('super-agencies/:superAgencyId/custom-domains/:domainId/verification-token')
  @ApiHeader({ name: SUPER_AGENCY_HEADER, required: true })
  @UseGuards(JwtAuthGuard, SuperAgencyTenantGuard, PermissionGuard)
  @RequirePermissions(PermissionKeys.customDomainsManage)
  rotateSuperAgency(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('domainId') domainId: string,
  ) {
    return this.domains.rotateToken(this.domains.superAgencyScope(tenant), user, domainId);
  }

  @Delete('super-agencies/:superAgencyId/custom-domains/:domainId')
  @ApiHeader({ name: SUPER_AGENCY_HEADER, required: true })
  @UseGuards(JwtAuthGuard, SuperAgencyTenantGuard, PermissionGuard)
  @RequirePermissions(PermissionKeys.customDomainsManage)
  removeSuperAgency(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('domainId') domainId: string,
    @Body() dto: CustomDomainRevisionDto,
  ) {
    return this.domains.remove(this.domains.superAgencyScope(tenant), user, domainId, dto);
  }

  @Get('agencies/:agencyId/custom-domains')
  @ApiHeader({ name: AGENCY_HEADER, required: true })
  @UseGuards(JwtAuthGuard, AgencyTenantGuard, PermissionGuard)
  @RequirePermissions(PermissionKeys.customDomainsManage)
  listAgency(@CurrentAgencyTenant() tenant: AgencyTenantContext) {
    return this.domains.list(this.domains.agencyScope(tenant));
  }

  @Post('agencies/:agencyId/custom-domains')
  @ApiHeader({ name: AGENCY_HEADER, required: true })
  @UseGuards(JwtAuthGuard, AgencyTenantGuard, PermissionGuard)
  @RequirePermissions(PermissionKeys.customDomainsManage)
  createAgency(
    @CurrentAgencyTenant() tenant: AgencyTenantContext,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Body() dto: CreateCustomDomainDto,
  ) {
    return this.domains.create(this.domains.agencyScope(tenant), user, dto);
  }

  @Post('agencies/:agencyId/custom-domains/:domainId/verify')
  @ApiHeader({ name: AGENCY_HEADER, required: true })
  @UseGuards(JwtAuthGuard, AgencyTenantGuard, PermissionGuard)
  @RequirePermissions(PermissionKeys.customDomainsManage)
  verifyAgency(
    @CurrentAgencyTenant() tenant: AgencyTenantContext,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('domainId') domainId: string,
  ) {
    return this.domains.verify(this.domains.agencyScope(tenant), user, domainId);
  }

  @Post('agencies/:agencyId/custom-domains/:domainId/verification-token')
  @ApiHeader({ name: AGENCY_HEADER, required: true })
  @UseGuards(JwtAuthGuard, AgencyTenantGuard, PermissionGuard)
  @RequirePermissions(PermissionKeys.customDomainsManage)
  rotateAgency(
    @CurrentAgencyTenant() tenant: AgencyTenantContext,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('domainId') domainId: string,
  ) {
    return this.domains.rotateToken(this.domains.agencyScope(tenant), user, domainId);
  }

  @Delete('agencies/:agencyId/custom-domains/:domainId')
  @ApiHeader({ name: AGENCY_HEADER, required: true })
  @UseGuards(JwtAuthGuard, AgencyTenantGuard, PermissionGuard)
  @RequirePermissions(PermissionKeys.customDomainsManage)
  removeAgency(
    @CurrentAgencyTenant() tenant: AgencyTenantContext,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('domainId') domainId: string,
    @Body() dto: CustomDomainRevisionDto,
  ) {
    return this.domains.remove(this.domains.agencyScope(tenant), user, domainId, dto);
  }

  @Get('workspaces/:workspaceId/custom-domains')
  @ApiHeader({ name: AGENCY_HEADER, required: true })
  @ApiHeader({ name: WORKSPACE_HEADER, required: true })
  @UseGuards(JwtAuthGuard, WorkspaceTenantGuard, PermissionGuard)
  @RequirePermissions(PermissionKeys.customDomainsManage)
  listWorkspace(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext) {
    return this.domains.list(this.domains.workspaceScope(tenant));
  }

  @Post('workspaces/:workspaceId/custom-domains')
  @ApiHeader({ name: AGENCY_HEADER, required: true })
  @ApiHeader({ name: WORKSPACE_HEADER, required: true })
  @UseGuards(JwtAuthGuard, WorkspaceTenantGuard, PermissionGuard)
  @RequirePermissions(PermissionKeys.customDomainsManage)
  createWorkspace(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Body() dto: CreateCustomDomainDto,
  ) {
    return this.domains.create(this.domains.workspaceScope(tenant), user, dto);
  }

  @Post('workspaces/:workspaceId/custom-domains/:domainId/verify')
  @ApiHeader({ name: AGENCY_HEADER, required: true })
  @ApiHeader({ name: WORKSPACE_HEADER, required: true })
  @UseGuards(JwtAuthGuard, WorkspaceTenantGuard, PermissionGuard)
  @RequirePermissions(PermissionKeys.customDomainsManage)
  verifyWorkspace(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('domainId') domainId: string,
  ) {
    return this.domains.verify(this.domains.workspaceScope(tenant), user, domainId);
  }

  @Post('workspaces/:workspaceId/custom-domains/:domainId/verification-token')
  @ApiHeader({ name: AGENCY_HEADER, required: true })
  @ApiHeader({ name: WORKSPACE_HEADER, required: true })
  @UseGuards(JwtAuthGuard, WorkspaceTenantGuard, PermissionGuard)
  @RequirePermissions(PermissionKeys.customDomainsManage)
  rotateWorkspace(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('domainId') domainId: string,
  ) {
    return this.domains.rotateToken(this.domains.workspaceScope(tenant), user, domainId);
  }

  @Delete('workspaces/:workspaceId/custom-domains/:domainId')
  @ApiHeader({ name: AGENCY_HEADER, required: true })
  @ApiHeader({ name: WORKSPACE_HEADER, required: true })
  @UseGuards(JwtAuthGuard, WorkspaceTenantGuard, PermissionGuard)
  @RequirePermissions(PermissionKeys.customDomainsManage)
  removeWorkspace(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('domainId') domainId: string,
    @Body() dto: CustomDomainRevisionDto,
  ) {
    return this.domains.remove(this.domains.workspaceScope(tenant), user, domainId, dto);
  }
}
