import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { AgencyTenantContext, WorkspaceTenantContext } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionGuard } from '../../common/authorization/permission.guard';
import { PermissionKeys } from '../../common/authorization/permissions';
import { RequirePermissions } from '../../common/authorization/require-permissions.decorator';
import {
  AGENCY_HEADER,
  CurrentAgencyTenant,
  CurrentWorkspaceTenant,
  WORKSPACE_HEADER,
} from '../../common/tenant/tenant-context.decorator';
import { AgencyTenantGuard, WorkspaceTenantGuard } from '../../common/tenant/tenant-context.guard';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import { WorkspaceMembershipParamsDto } from './dto/workspace-params.dto';
import {
  CreateWorkspaceMembershipDto,
  UpdateWorkspaceMembershipDto,
} from './dto/workspace-membership.dto';
import { WorkspacesService } from './workspaces.service';

@ApiTags('workspaces')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Post('agencies/:agencyId/workspaces')
  @ApiHeader({ name: AGENCY_HEADER, required: true })
  @UseGuards(AgencyTenantGuard, PermissionGuard)
  @RequirePermissions(PermissionKeys.workspaceCreate)
  create(@CurrentAgencyTenant() tenant: AgencyTenantContext, @Body() dto: CreateWorkspaceDto) {
    return this.workspaces.create(tenant, dto);
  }

  @Get('agencies/:agencyId/workspaces')
  @ApiHeader({ name: AGENCY_HEADER, required: true })
  @UseGuards(AgencyTenantGuard, PermissionGuard)
  @RequirePermissions(PermissionKeys.workspaceRead)
  listForAgency(@CurrentAgencyTenant() tenant: AgencyTenantContext) {
    return this.workspaces.listForAgency(tenant);
  }

  @Get('workspaces/:workspaceId')
  @ApiHeader({ name: AGENCY_HEADER, required: true })
  @ApiHeader({ name: WORKSPACE_HEADER, required: true })
  @UseGuards(WorkspaceTenantGuard, PermissionGuard)
  @RequirePermissions(PermissionKeys.workspaceRead)
  get(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext) {
    return this.workspaces.get(tenant);
  }

  @Patch('workspaces/:workspaceId')
  @ApiHeader({ name: AGENCY_HEADER, required: true })
  @ApiHeader({ name: WORKSPACE_HEADER, required: true })
  @UseGuards(WorkspaceTenantGuard, PermissionGuard)
  @RequirePermissions(PermissionKeys.workspaceUpdate)
  update(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Body() dto: UpdateWorkspaceDto,
  ) {
    return this.workspaces.update(tenant, dto);
  }

  @Get('workspaces/:workspaceId/memberships')
  @ApiHeader({ name: AGENCY_HEADER, required: true })
  @ApiHeader({ name: WORKSPACE_HEADER, required: true })
  @UseGuards(WorkspaceTenantGuard, PermissionGuard)
  @RequirePermissions(PermissionKeys.workspaceMemberRead)
  listMemberships(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext) {
    return this.workspaces.listMemberships(tenant);
  }

  @Post('workspaces/:workspaceId/memberships')
  @ApiHeader({ name: AGENCY_HEADER, required: true })
  @ApiHeader({ name: WORKSPACE_HEADER, required: true })
  @UseGuards(WorkspaceTenantGuard, PermissionGuard)
  @RequirePermissions(PermissionKeys.workspaceMemberCreate)
  addMembership(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Body() dto: CreateWorkspaceMembershipDto,
  ) {
    return this.workspaces.addMembership(tenant, dto);
  }

  @Patch('workspaces/:workspaceId/memberships/:id')
  @ApiHeader({ name: AGENCY_HEADER, required: true })
  @ApiHeader({ name: WORKSPACE_HEADER, required: true })
  @UseGuards(WorkspaceTenantGuard, PermissionGuard)
  @RequirePermissions(PermissionKeys.workspaceMemberUpdate)
  updateMembership(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WorkspaceMembershipParamsDto,
    @Body() dto: UpdateWorkspaceMembershipDto,
  ) {
    return this.workspaces.updateMembership(tenant, params.id, dto);
  }
}
