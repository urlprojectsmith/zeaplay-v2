import { Body, Controller, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
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
import { CreateRoleDto, ReplaceRolePermissionsDto, UpdateRoleDto } from './dto/role.dto';
import { RoleParamsDto } from './dto/role-params.dto';
import { RolesService } from './roles.service';

@ApiTags('workspace roles')
@ApiBearerAuth()
@ApiHeader({ name: AGENCY_HEADER, required: true })
@ApiHeader({ name: WORKSPACE_HEADER, required: true })
@UseGuards(JwtAuthGuard, WorkspaceTenantGuard, PermissionGuard)
@Controller('workspaces/:workspaceId/roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermissions(PermissionKeys.rolesView)
  list(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext) {
    return this.roles.list(tenant);
  }

  @Post()
  @RequirePermissions(PermissionKeys.rolesCreate)
  create(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext, @Body() dto: CreateRoleDto) {
    return this.roles.create(tenant, dto);
  }

  @Get(':roleId')
  @RequirePermissions(PermissionKeys.rolesView)
  get(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext, @Param() params: RoleParamsDto) {
    return this.roles.get(tenant, params.roleId);
  }

  @Patch(':roleId')
  @RequirePermissions(PermissionKeys.rolesUpdate)
  update(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: RoleParamsDto,
    @Body() dto: UpdateRoleDto,
  ) {
    return this.roles.update(tenant, params.roleId, dto);
  }

  @Post(':roleId/clone')
  @RequirePermissions(PermissionKeys.rolesCreate)
  clone(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext, @Param() params: RoleParamsDto) {
    return this.roles.clone(tenant, params.roleId);
  }

  @Put(':roleId/permissions')
  @RequirePermissions(PermissionKeys.rolesManagePermissions)
  replacePermissions(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: RoleParamsDto,
    @Body() dto: ReplaceRolePermissionsDto,
  ) {
    return this.roles.replacePermissions(tenant, params.roleId, dto);
  }
}
