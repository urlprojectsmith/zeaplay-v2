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
import { ReqContext } from '../../common/decorators/request-context.decorator';
import { UuidParamDto } from '../../common/dto/uuid-param.dto';
import {
  AGENCY_HEADER,
  CurrentWorkspaceTenant,
  WORKSPACE_HEADER,
} from '../../common/tenant/tenant-context.decorator';
import { WorkspaceTenantGuard } from '../../common/tenant/tenant-context.guard';
import { CreateProjectDto } from './dto/create-project.dto';
import { ProjectQueryDto } from './dto/project-query.dto';
import { UploadCompleteDto } from '../assets/dto/upload-complete.dto';
import { UploadInitDto } from '../assets/dto/upload-init.dto';
import {
  CreateProjectUrlAttachmentDto,
  ProjectActivityQueryDto,
  ProjectAttachmentIdsDto,
  ProjectMemberQueryDto,
  ProjectMembersDto,
  ProjectReportQueryDto,
  ProjectTaskIdsDto,
  ProjectTagIdsDto,
  UpdateProjectDto,
  UpdateProjectOwnerDto,
  UpdateProjectProgressDto,
  UpdateProjectStatusDto,
} from './dto/update-project.dto';
import { ProjectsService } from './projects.service';
import type { RequestContext } from '@zea-play/types';

class WorkspaceProjectParamDto extends UuidParamDto {
  @IsUUID()
  workspaceId!: string;
}

class WorkspaceProjectMemberParamDto extends WorkspaceProjectParamDto {
  @IsUUID()
  membershipId!: string;
}

class WorkspaceProjectAttachmentParamDto extends WorkspaceProjectParamDto {
  @IsUUID()
  attachmentId!: string;
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
    return this.projects.updateStatus(tenant, params.id, dto.statusDefinitionId, dto.dueAt);
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

  @Post(':id/tasks')
  @RequirePermissions(PermissionKeys.projectsUpdate, PermissionKeys.tasksAssign)
  linkTasks(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WorkspaceProjectParamDto,
    @Body() dto: ProjectTaskIdsDto,
  ) {
    return this.projects.linkTasks(tenant, params.id, dto);
  }

  @Post(':id/tasks/remove')
  @RequirePermissions(PermissionKeys.projectsUpdate, PermissionKeys.tasksAssign)
  unlinkTasks(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WorkspaceProjectParamDto,
    @Body() dto: ProjectTaskIdsDto,
  ) {
    return this.projects.unlinkTasks(tenant, params.id, dto);
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

  @Get(':id/attachments')
  @RequirePermissions(PermissionKeys.projectsView, PermissionKeys.projectsFilesView)
  attachments(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WorkspaceProjectParamDto,
    @Query() query: ProjectMemberQueryDto,
  ) {
    return this.projects.listAttachments(tenant, params.id, query);
  }

  @Post(':id/attachments/upload-init')
  @RequirePermissions(PermissionKeys.projectsView, PermissionKeys.projectsFilesAdd)
  initAttachmentUpload(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WorkspaceProjectParamDto,
    @Body() dto: UploadInitDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.projects.initAttachmentUpload(tenant, params.id, dto, context.correlationId);
  }

  @Post(':id/attachments/:attachmentId/upload-complete')
  @RequirePermissions(PermissionKeys.projectsView, PermissionKeys.projectsFilesAdd)
  completeAttachmentUpload(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WorkspaceProjectAttachmentParamDto,
    @Body() dto: UploadCompleteDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.projects.completeAttachmentUpload(
      tenant,
      params.id,
      params.attachmentId,
      dto,
      context.correlationId,
    );
  }

  @Post(':id/attachments/url')
  @RequirePermissions(PermissionKeys.projectsView, PermissionKeys.projectsFilesAdd)
  addUrlAttachment(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WorkspaceProjectParamDto,
    @Body() dto: CreateProjectUrlAttachmentDto,
  ) {
    return this.projects.addUrlAttachment(tenant, params.id, dto);
  }

  @Post(':id/attachments/link')
  @RequirePermissions(PermissionKeys.projectsView, PermissionKeys.projectsFilesAdd)
  linkAttachments(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WorkspaceProjectParamDto,
    @Body() dto: ProjectAttachmentIdsDto,
  ) {
    return this.projects.linkAttachments(tenant, params.id, dto);
  }

  @Get(':id/attachments/:attachmentId/download')
  @RequirePermissions(
    PermissionKeys.projectsView,
    PermissionKeys.projectsFilesView,
    PermissionKeys.projectsFilesDownload,
  )
  downloadAttachment(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WorkspaceProjectAttachmentParamDto,
  ) {
    return this.projects.downloadAttachment(tenant, params.id, params.attachmentId);
  }

  @Delete(':id/attachments/:attachmentId')
  @RequirePermissions(PermissionKeys.projectsView, PermissionKeys.projectsFilesRemove)
  removeAttachment(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WorkspaceProjectAttachmentParamDto,
  ) {
    return this.projects.removeAttachment(tenant, params.id, params.attachmentId);
  }

  @Get(':id/activity')
  @RequirePermissions(PermissionKeys.projectsView, PermissionKeys.projectsActivityView)
  activity(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WorkspaceProjectParamDto,
    @Query() query: ProjectActivityQueryDto,
  ) {
    return this.projects.listActivity(tenant, params.id, query);
  }

  @Get(':id/reports')
  @RequirePermissions(
    PermissionKeys.projectsView,
    PermissionKeys.projectsReportsView,
    PermissionKeys.tasksView,
  )
  reports(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WorkspaceProjectParamDto,
    @Query() query: ProjectReportQueryDto,
  ) {
    return this.projects.reports(tenant, params.id, query);
  }

  @Get(':id/reports/export')
  @RequirePermissions(
    PermissionKeys.projectsView,
    PermissionKeys.projectsReportsView,
    PermissionKeys.tasksView,
  )
  reportsExport(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WorkspaceProjectParamDto,
    @Query() query: ProjectReportQueryDto,
  ) {
    return this.projects.reportsCsv(tenant, params.id, query);
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
  get(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext, @Param() params: UuidParamDto) {
    return this.projects.get(tenant, params.id);
  }

  @Patch(':id')
  @RequirePermissions(PermissionKeys.projectsUpdate)
  update(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: UuidParamDto,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projects.update(tenant, params.id, dto);
  }

  @Patch(':id/status')
  @RequirePermissions(PermissionKeys.projectsUpdate, PermissionKeys.projectsManageStatus)
  updateStatus(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: UuidParamDto,
    @Body() dto: UpdateProjectStatusDto,
  ) {
    return this.projects.updateStatus(tenant, params.id, dto.statusDefinitionId, dto.dueAt);
  }

  @Delete(':id')
  @RequirePermissions(PermissionKeys.projectsDelete)
  remove(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext, @Param() params: UuidParamDto) {
    return this.projects.archive(tenant, params.id);
  }
}
