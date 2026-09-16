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
  BulkTaskIdsDto,
  BulkTaskMembershipsDto,
  BulkTaskPriorityDto,
  BulkTaskStatusDto,
  CreateTaskDto,
  ReplaceTaskMembershipsDto,
  ReplaceTaskProjectsDto,
  TaskParamsDto,
  TaskQueryDto,
  TaskRelationshipIdsDto,
  UpdateTaskDto,
  UpdateTaskParentDto,
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

  @Patch('bulk/status')
  @RequirePermissions(PermissionKeys.tasksUpdate)
  bulkUpdateStatus(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Body() dto: BulkTaskStatusDto,
  ) {
    return this.tasks.bulkUpdateStatus(tenant, dto);
  }

  @Patch('bulk/priority')
  @RequirePermissions(PermissionKeys.tasksUpdate)
  bulkUpdatePriority(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Body() dto: BulkTaskPriorityDto,
  ) {
    return this.tasks.bulkUpdatePriority(tenant, dto);
  }

  @Post('bulk/assignees/add')
  @RequirePermissions(PermissionKeys.tasksAssign)
  bulkAddAssignees(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Body() dto: BulkTaskMembershipsDto,
  ) {
    return this.tasks.bulkAddAssignees(tenant, dto);
  }

  @Post('bulk/assignees/remove')
  @RequirePermissions(PermissionKeys.tasksAssign)
  bulkRemoveAssignees(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Body() dto: BulkTaskMembershipsDto,
  ) {
    return this.tasks.bulkRemoveAssignees(tenant, dto);
  }

  @Delete('bulk')
  @RequirePermissions(PermissionKeys.tasksDelete)
  bulkRemove(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Body() dto: BulkTaskIdsDto,
  ) {
    return this.tasks.bulkRemove(tenant, dto);
  }

  @Post(':taskId/subtasks')
  @RequirePermissions(PermissionKeys.tasksCreate)
  createSubtask(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskParamsDto,
    @Body() dto: CreateTaskDto,
  ) {
    return this.tasks.createSubtask(tenant, params.taskId, dto);
  }

  @Get(':taskId/subtasks')
  @RequirePermissions(PermissionKeys.tasksView)
  listSubtasks(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskParamsDto,
    @Query() query: TaskQueryDto,
  ) {
    return this.tasks.listSubtasks(tenant, params.taskId, query);
  }

  @Patch(':taskId/parent')
  @RequirePermissions(PermissionKeys.tasksUpdate)
  updateParent(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskParamsDto,
    @Body() dto: UpdateTaskParentDto,
  ) {
    return this.tasks.updateParent(tenant, params.taskId, dto.parentTaskId ?? null);
  }

  @Get(':taskId/blocked-by')
  @RequirePermissions(PermissionKeys.tasksView)
  listBlockedBy(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskParamsDto,
    @Query() query: TaskQueryDto,
  ) {
    return this.tasks.listBlockedBy(tenant, params.taskId, query);
  }

  @Post(':taskId/blocked-by')
  @RequirePermissions(PermissionKeys.tasksUpdate)
  addBlockedBy(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskParamsDto,
    @Body() dto: TaskRelationshipIdsDto,
  ) {
    return this.tasks.addBlockedBy(tenant, params.taskId, dto);
  }

  @Post(':taskId/blocked-by/remove')
  @RequirePermissions(PermissionKeys.tasksUpdate)
  removeBlockedBy(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskParamsDto,
    @Body() dto: TaskRelationshipIdsDto,
  ) {
    return this.tasks.removeBlockedBy(tenant, params.taskId, dto);
  }

  @Get(':taskId/blocks')
  @RequirePermissions(PermissionKeys.tasksView)
  listBlocks(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskParamsDto,
    @Query() query: TaskQueryDto,
  ) {
    return this.tasks.listBlocks(tenant, params.taskId, query);
  }

  @Get(':taskId/related')
  @RequirePermissions(PermissionKeys.tasksView)
  listRelated(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskParamsDto,
    @Query() query: TaskQueryDto,
  ) {
    return this.tasks.listRelated(tenant, params.taskId, query);
  }

  @Post(':taskId/related')
  @RequirePermissions(PermissionKeys.tasksUpdate)
  addRelated(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskParamsDto,
    @Body() dto: TaskRelationshipIdsDto,
  ) {
    return this.tasks.addRelated(tenant, params.taskId, dto);
  }

  @Post(':taskId/related/remove')
  @RequirePermissions(PermissionKeys.tasksUpdate)
  removeRelated(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskParamsDto,
    @Body() dto: TaskRelationshipIdsDto,
  ) {
    return this.tasks.removeRelated(tenant, params.taskId, dto);
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
