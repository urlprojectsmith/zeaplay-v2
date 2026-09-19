import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import type { WorkspaceTenantContext } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionGuard } from '../../common/authorization/permission.guard';
import { PermissionKeys } from '../../common/authorization/permissions';
import { RequirePermissions } from '../../common/authorization/require-permissions.decorator';
import { UuidParamDto } from '../../common/dto/uuid-param.dto';
import {
  AGENCY_HEADER,
  CurrentWorkspaceTenant,
  WORKSPACE_HEADER,
} from '../../common/tenant/tenant-context.decorator';
import { WorkspaceTenantGuard } from '../../common/tenant/tenant-context.guard';
import { CreateProjectDto } from './dto/create-project.dto';
import { ProjectQueryDto } from './dto/project-query.dto';
import {
  ProjectMemberQueryDto,
  ProjectMembersDto,
  ProjectTagIdsDto,
  UpdateProjectDto,
  UpdateProjectOwnerDto,
  UpdateProjectProgressDto,
  UpdateProjectStatusDto,
} from './dto/update-project.dto';
import { ProjectsService } from './projects.service';

class WorkspaceProjectParamDto extends UuidParamDto {
  @IsUUID()
  workspaceId!: string;
}

class WorkspaceProjectMemberParamDto extends WorkspaceProjectParamDto {
  @IsUUID()
  membershipId!: string;
}

@ApiTags('projects')
@ApiBearerAuth()
@ApiHeader({ name: AGENCY_HEADER, required: true })
@ApiHeader({ name: WORKSPACE_HEADER, required: true })
@UseGuards(JwtAuthGuard, WorkspaceTenantGuard, PermissionGuard)
@Controller('workspaces/:workspaceId/projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Post()
  @RequirePermissions(PermissionKeys.projectsCreate)
  create(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext, @Body() dto: CreateProjectDto) {
    return this.projects.create(tenant, dto);
  }

  @Get()
  @RequirePermissions(PermissionKeys.projectsView)
  list(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext, @Query() query: ProjectQueryDto) {
    return this.projects.list(tenant, query);
  }

  @Get(':id')
  @RequirePermissions(PermissionKeys.projectsView)
  get(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WorkspaceProjectParamDto,
  ) {
    return this.projects.get(tenant, params.id);
  }

  @Patch(':id')
  @RequirePermissions(PermissionKeys.projectsUpdate)
  update(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WorkspaceProjectParamDto,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projects.update(tenant, params.id, dto);
  }

  @Patch(':id/status')
  @RequirePermissions(PermissionKeys.projectsUpdate, PermissionKeys.projectsManageStatus)
  updateStatus(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WorkspaceProjectParamDto,
    @Body() dto: UpdateProjectStatusDto,
  ) {
    return this.projects.updateStatus(tenant, params.id, dto.statusDefinitionId);
  }

  @Patch(':id/progress')
  @RequirePermissions(PermissionKeys.projectsManageProgress)
  updateProgress(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WorkspaceProjectParamDto,
    @Body() dto: UpdateProjectProgressDto,
  ) {
    return this.projects.updateProgress(tenant, params.id, dto);
  }

  @Get(':id/tags')
  @RequirePermissions(PermissionKeys.projectsView)
  tags(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WorkspaceProjectParamDto,
  ) {
    return this.projects.listTags(tenant, params.id);
  }

  @Post(':id/tags/add')
  @RequirePermissions(PermissionKeys.projectsUpdate, PermissionKeys.tagsAssign)
  addTags(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WorkspaceProjectParamDto,
    @Body() dto: ProjectTagIdsDto,
  ) {
    return this.projects.addTags(tenant, params.id, dto);
  }

  @Post(':id/tags/remove')
  @RequirePermissions(PermissionKeys.projectsUpdate, PermissionKeys.tagsAssign)
  removeTags(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WorkspaceProjectParamDto,
    @Body() dto: ProjectTagIdsDto,
  ) {
    return this.projects.removeTags(tenant, params.id, dto);
  }

  @Get(':id/members')
  @RequirePermissions(PermissionKeys.projectsView)
  members(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WorkspaceProjectParamDto,
    @Query() query: ProjectMemberQueryDto,
  ) {
    return this.projects.listMembers(tenant, params.id, query);
  }

  @Post(':id/members')
  @RequirePermissions(PermissionKeys.projectsUpdate, PermissionKeys.projectsManageMembers)
  addMembers(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WorkspaceProjectParamDto,
    @Body() dto: ProjectMembersDto,
  ) {
    return this.projects.addMembers(tenant, params.id, dto);
  }

  @Delete(':id/members/:membershipId')
  @RequirePermissions(PermissionKeys.projectsUpdate, PermissionKeys.projectsManageMembers)
  removeMember(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WorkspaceProjectMemberParamDto,
  ) {
    return this.projects.removeMember(tenant, params.id, params.membershipId);
  }

  @Patch(':id/owner')
  @RequirePermissions(PermissionKeys.projectsUpdate, PermissionKeys.projectsManageOwner)
  updateOwner(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WorkspaceProjectParamDto,
    @Body() dto: UpdateProjectOwnerDto,
  ) {
    return this.projects.updateOwner(tenant, params.id, dto.workspaceMembershipId);
  }

  @Delete(':id')
  @RequirePermissions(PermissionKeys.projectsDelete)
  remove(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WorkspaceProjectParamDto,
  ) {
    return this.projects.archive(tenant, params.id);
  }
}

@ApiTags('projects')
@ApiBearerAuth()
@ApiHeader({ name: AGENCY_HEADER, required: true })
@ApiHeader({ name: WORKSPACE_HEADER, required: true })
@UseGuards(JwtAuthGuard, WorkspaceTenantGuard, PermissionGuard)
@Controller('projects')
export class LegacyProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Post()
  @RequirePermissions(PermissionKeys.projectCreate)
  create(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext, @Body() dto: CreateProjectDto) {
    return this.projects.create(tenant, dto);
  }

  @Get()
  @RequirePermissions(PermissionKeys.projectRead)
  list(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext, @Query() query: ProjectQueryDto) {
    return this.projects.list(tenant, query);
  }

  @Get(':id')
  @RequirePermissions(PermissionKeys.projectRead)
  get(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext, @Param() params: UuidParamDto) {
    return this.projects.get(tenant, params.id);
  }

  @Patch(':id')
  @RequirePermissions(PermissionKeys.projectUpdate)
  update(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: UuidParamDto,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projects.update(tenant, params.id, dto);
  }

  @Patch(':id/status')
  @RequirePermissions(PermissionKeys.projectUpdate)
  updateStatus(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: UuidParamDto,
    @Body() dto: UpdateProjectStatusDto,
  ) {
    return this.projects.updateStatus(tenant, params.id, dto.statusDefinitionId);
  }

  @Delete(':id')
  @RequirePermissions(PermissionKeys.projectDelete)
  remove(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext, @Param() params: UuidParamDto) {
    return this.projects.archive(tenant, params.id);
  }
}
