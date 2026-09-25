import { Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser, SuperAgencyTenantContext } from '../../common/auth/auth.types';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { DeveloperDiagnosticsGuard } from '../../common/authorization/developer-diagnostics.guard';
import { PermissionGuard } from '../../common/authorization/permission.guard';
import { PermissionKeys } from '../../common/authorization/permissions';
import { RequirePermissions } from '../../common/authorization/require-permissions.decorator';
import {
  CurrentSuperAgencyTenant,
  SUPER_AGENCY_HEADER,
} from '../../common/tenant/tenant-context.decorator';
import { SuperAgencyTenantGuard } from '../../common/tenant/tenant-context.guard';
import { AgenciesService } from '../agencies/agencies.service';
import {
  AgencyManagementListQueryDto,
  AgencyManagementParamsDto,
  WorkspaceManagementListQueryDto,
} from '../agencies/dto/agency-management.dto';
import { CreateAgencyDto } from '../agencies/dto/create-agency.dto';
import { UpdateAgencyDto } from '../agencies/dto/update-agency.dto';
import { WorkspacesService } from '../workspaces/workspaces.service';
import {
  CreateSuperAgencyDto,
  SuperAgencyListQueryDto,
  SuperAgencyParamsDto,
  UpdateSuperAgencyDto,
} from './dto/super-agency.dto';
import {
  AcceptSuperAgencyInvitationDto,
  CreateSuperAgencyInvitationDto,
  CreateSuperAgencyMembershipDto,
  CreateSuperAgencyRoleDto,
  ReplaceSuperAgencyRolePermissionsDto,
  SuperAgencyInvitationListQueryDto,
  SuperAgencyInvitationParamsDto,
  SuperAgencyMemberListQueryDto,
  SuperAgencyMembershipParamsDto,
  SuperAgencyRoleParamsDto,
  UpdateSuperAgencyMembershipDto,
} from './dto/super-agency-membership.dto';
import { SuperAgenciesService } from './super-agencies.service';

@ApiTags('platform-super-agencies')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, DeveloperDiagnosticsGuard)
@Controller('platform/super-agencies')
export class SuperAgenciesController {
  constructor(private readonly superAgencies: SuperAgenciesService) {}

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSuperAgencyDto) {
    return this.superAgencies.create(user, dto);
  }

  @Get()
  list(@Query() query: SuperAgencyListQueryDto) {
    return this.superAgencies.list(query);
  }

  @Get(':superAgencyId')
  get(@Param() params: SuperAgencyParamsDto) {
    return this.superAgencies.get(params.superAgencyId);
  }

  @Patch(':superAgencyId')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: SuperAgencyParamsDto,
    @Body() dto: UpdateSuperAgencyDto,
  ) {
    return this.superAgencies.update(user, params.superAgencyId, dto);
  }
}

@ApiTags('super-agencies')
@ApiBearerAuth()
@ApiHeader({ name: SUPER_AGENCY_HEADER, required: true })
@UseGuards(JwtAuthGuard, SuperAgencyTenantGuard, PermissionGuard)
@Controller('super-agencies/:superAgencyId')
export class SuperAgencyTenantController {
  constructor(
    private readonly superAgencies: SuperAgenciesService,
    private readonly agencies: AgenciesService,
    private readonly workspaces: WorkspacesService,
  ) {}

  @Get()
  @RequirePermissions(PermissionKeys.superAgencyView)
  getCurrent(@CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext) {
    return this.superAgencies.getCurrentTenant(tenant);
  }

  @Get('agencies')
  @RequirePermissions(PermissionKeys.agencyRead)
  listAgencies(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Query() query: AgencyManagementListQueryDto,
  ) {
    return this.agencies.listForSuperAgency(tenant, query);
  }

  @Post('agencies')
  @RequirePermissions(PermissionKeys.agencyCreate)
  createAgency(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Body() dto: CreateAgencyDto,
  ) {
    return this.agencies.create(user, dto, tenant);
  }

  @Get('agencies/:agencyId')
  @RequirePermissions(PermissionKeys.agencyRead)
  getAgency(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Param() params: AgencyManagementParamsDto,
  ) {
    return this.agencies.getForSuperAgency(tenant, params.agencyId);
  }

  @Patch('agencies/:agencyId')
  @RequirePermissions(PermissionKeys.agencyUpdate)
  updateAgency(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Param() params: AgencyManagementParamsDto,
    @Body() dto: UpdateAgencyDto,
  ) {
    return this.agencies.updateForSuperAgency(tenant, params.agencyId, dto);
  }

  @Get('agencies/:agencyId/workspaces')
  @RequirePermissions(PermissionKeys.workspaceRead)
  listAgencyWorkspaces(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Param() params: AgencyManagementParamsDto,
    @Query() query: WorkspaceManagementListQueryDto,
  ) {
    return this.workspaces.listForSuperAgencyAgency(tenant, params.agencyId, query);
  }

  @Get('memberships')
  @RequirePermissions(PermissionKeys.superAgencyMembersView)
  listMemberships(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Query() query: SuperAgencyMemberListQueryDto,
  ) {
    return this.superAgencies.listMemberships(tenant, query);
  }

  @Post('memberships')
  @RequirePermissions(PermissionKeys.superAgencyMembersManage)
  addMembership(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Body() dto: CreateSuperAgencyMembershipDto,
  ) {
    return this.superAgencies.addMembership(tenant, dto);
  }

  @Patch('memberships/:membershipId')
  @RequirePermissions(PermissionKeys.superAgencyMembersManage)
  updateMembership(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Param() params: SuperAgencyMembershipParamsDto,
    @Body() dto: UpdateSuperAgencyMembershipDto,
  ) {
    return this.superAgencies.updateMembership(tenant, params.membershipId, dto);
  }

  @Get('roles')
  @RequirePermissions(PermissionKeys.superAgencyRolesView)
  listRoles(@CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext) {
    return this.superAgencies.listRoles(tenant);
  }

  @Post('roles')
  @RequirePermissions(PermissionKeys.superAgencyRolesManage)
  createRole(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Body() dto: CreateSuperAgencyRoleDto,
  ) {
    return this.superAgencies.createRole(tenant, dto);
  }

  @Put('roles/:roleId/permissions')
  @RequirePermissions(PermissionKeys.superAgencyRolesManage)
  replaceRolePermissions(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Param() params: SuperAgencyRoleParamsDto,
    @Body() dto: ReplaceSuperAgencyRolePermissionsDto,
  ) {
    return this.superAgencies.replaceRolePermissions(tenant, params.roleId, dto);
  }

  @Post('invitations')
  @RequirePermissions(PermissionKeys.superAgencyMembersInvite)
  createInvitation(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Body() dto: CreateSuperAgencyInvitationDto,
  ) {
    return this.superAgencies.createInvitation(tenant, dto);
  }

  @Get('invitations')
  @RequirePermissions(PermissionKeys.superAgencyMembersInvite)
  listInvitations(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Query() query: SuperAgencyInvitationListQueryDto,
  ) {
    return this.superAgencies.listInvitations(tenant, query);
  }

  @Patch('invitations/:invitationId/revoke')
  @RequirePermissions(PermissionKeys.superAgencyMembersInvite)
  revokeInvitation(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Param() params: SuperAgencyInvitationParamsDto,
  ) {
    return this.superAgencies.revokeInvitation(tenant, params.invitationId);
  }
}

@ApiTags('super-agency invitations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('super-agency-invitations')
export class SuperAgencyInvitationsController {
  constructor(private readonly superAgencies: SuperAgenciesService) {}

  @Post('accept')
  accept(@CurrentUser() user: AuthenticatedUser, @Body() dto: AcceptSuperAgencyInvitationDto) {
    return this.superAgencies.acceptInvitation(user, dto);
  }
}
