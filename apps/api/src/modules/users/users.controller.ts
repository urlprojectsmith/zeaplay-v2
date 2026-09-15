import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
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
import { UpdateWorkspaceUserMembershipDto } from './dto/update-workspace-user.dto';
import { WorkspaceUserParamsDto } from './dto/workspace-user-params.dto';
import { WorkspaceUserQueryDto } from './dto/workspace-user-query.dto';
import { UsersService } from './users.service';

@ApiTags('workspace users')
@ApiBearerAuth()
@ApiHeader({ name: AGENCY_HEADER, required: true })
@ApiHeader({ name: WORKSPACE_HEADER, required: true })
@UseGuards(JwtAuthGuard, WorkspaceTenantGuard, PermissionGuard)
@Controller('workspaces/:workspaceId/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions(PermissionKeys.usersView)
  list(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Query() query: WorkspaceUserQueryDto,
  ) {
    return this.users.listWorkspaceUsers(tenant, query);
  }

  @Get(':userId')
  @RequirePermissions(PermissionKeys.usersView)
  get(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WorkspaceUserParamsDto,
  ) {
    return this.users.getWorkspaceUser(tenant, params.userId);
  }

  @Patch(':userId/membership')
  @RequirePermissions(PermissionKeys.usersManage)
  updateMembership(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WorkspaceUserParamsDto,
    @Body() dto: UpdateWorkspaceUserMembershipDto,
  ) {
    return this.users.updateWorkspaceUser(tenant, params.userId, dto);
  }
}
