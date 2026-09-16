import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
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
import {
  CreateTaskDto,
  ReplaceTaskMembershipsDto,
  ReplaceTaskProjectsDto,
  TaskParamsDto,
  TaskQueryDto,
  UpdateTaskDto,
  UpdateTaskStatusDto,
} from './dto/task.dto';
import { TasksService } from './tasks.service';

@ApiTags('workspace tasks')
@ApiBearerAuth()
@ApiHeader({ name: AGENCY_HEADER, required: true })
@ApiHeader({ name: WORKSPACE_HEADER, required: true })
@UseGuards(JwtAuthGuard, WorkspaceTenantGuard, PermissionGuard)
@Controller('workspaces/:workspaceId/tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Post()
  @RequirePermissions(PermissionKeys.tasksCreate)
  create(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext, @Body() dto: CreateTaskDto) {
    return this.tasks.create(tenant, dto);
  }

  @Get()
  @RequirePermissions(PermissionKeys.tasksView)
  list(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext, @Query() query: TaskQueryDto) {
    return this.tasks.list(tenant, query);
  }

  @Get(':taskId')
  @RequirePermissions(PermissionKeys.tasksView)
  get(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext, @Param() params: TaskParamsDto) {
    return this.tasks.get(tenant, params.taskId);
  }

  @Patch(':taskId')
  @RequirePermissions(PermissionKeys.tasksUpdate)
  update(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskParamsDto,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.tasks.update(tenant, params.taskId, dto);
  }

  @Patch(':taskId/status')
  @RequirePermissions(PermissionKeys.tasksUpdate)
  updateStatus(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskParamsDto,
    @Body() dto: UpdateTaskStatusDto,
  ) {
    return this.tasks.updateStatus(tenant, params.taskId, dto.statusDefinitionId);
  }

  @Put(':taskId/assignees')
  @RequirePermissions(PermissionKeys.tasksAssign)
  replaceAssignees(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskParamsDto,
    @Body() dto: ReplaceTaskMembershipsDto,
  ) {
    return this.tasks.replaceAssignees(tenant, params.taskId, dto);
  }

  @Put(':taskId/followers')
  @RequirePermissions(PermissionKeys.tasksAssign)
  replaceFollowers(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskParamsDto,
    @Body() dto: ReplaceTaskMembershipsDto,
  ) {
    return this.tasks.replaceFollowers(tenant, params.taskId, dto);
  }

  @Put(':taskId/projects')
  @RequirePermissions(PermissionKeys.tasksAssign)
  replaceProjects(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskParamsDto,
    @Body() dto: ReplaceTaskProjectsDto,
  ) {
    return this.tasks.replaceProjects(tenant, params.taskId, dto);
  }

  @Delete(':taskId')
  @RequirePermissions(PermissionKeys.tasksDelete)
  remove(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext, @Param() params: TaskParamsDto) {
    return this.tasks.remove(tenant, params.taskId);
  }
}
