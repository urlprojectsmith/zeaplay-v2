import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
import { ReqContext } from '../../common/decorators/request-context.decorator';
import type { RequestContext } from '@zea-play/types';
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
  CompletionPolicyDto,
  CreateTaskCommentDto,
  CreateTaskFromTemplateDto,
  CreateTaskTimeEntryDto,
  CreateTaskUrlAttachmentDto,
  CreateTaskDto,
  CreateTaskTemplateDto,
  ReplaceTaskMembershipsDto,
  ReplaceTaskProjectsDto,
  ReplaceTaskWorkloadAllocationsDto,
  SaveTaskAsTemplateDto,
  TaskActivityQueryDto,
  StartTaskTimerDto,
  TaskAttachmentIdsDto,
  TaskAttachmentParamsDto,
  TaskCalendarQueryDto,
  TaskCompletionDecisionDto,
  TaskCompletionQueryDto,
  TaskCompletionSubmissionParamsDto,
  TaskGanttQueryDto,
  TaskKanbanColumnParamsDto,
  TaskKanbanMoveDto,
  TaskCommentParamsDto,
  TaskParamsDto,
  TaskCommentReactionDto,
  TaskRecurrenceQueryDto,
  TaskTagIdsDto,
  TaskTimeEntryParamsDto,
  TaskTimeReportQueryDto,
  TaskTemplateQueryDto,
  TaskReportsQueryDto,
  TaskQueryDto,
  TaskRelationshipIdsDto,
  TaskWorkloadQueryDto,
  SubmitTaskCompletionDto,
  UpdateTaskScheduleDto,
  UpdateWorkspaceMemberCapacityDto,
  UpdateTaskKanbanColumnSettingDto,
  UpdateTaskCommentDto,
  UpdateTaskRecurrenceDto,
  UpdateTaskDto,
  UpdateTaskParentDto,
  UpdateTaskStatusDto,
  UpdateTaskTemplateDto,
  UpdateTaskTimeEntryDto,
} from './dto/task.dto';
import { TasksService } from './tasks.service';
import { UploadCompleteDto } from '../assets/dto/upload-complete.dto';
import { UploadInitDto } from '../assets/dto/upload-init.dto';

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

  @Get('recurrence')
  @RequirePermissions(PermissionKeys.tasksView)
  listRecurrenceSeries(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Query() query: TaskRecurrenceQueryDto,
  ) {
    return this.tasks.listRecurrenceSeries(tenant, query);
  }

  @Patch('recurrence/:seriesId/pause')
  @RequirePermissions(PermissionKeys.tasksUpdate)
  pauseRecurrence(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('seriesId') seriesId: string,
  ) {
    return this.tasks.pauseRecurrence(tenant, seriesId);
  }

  @Patch('recurrence/:seriesId/resume')
  @RequirePermissions(PermissionKeys.tasksUpdate)
  resumeRecurrence(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('seriesId') seriesId: string,
  ) {
    return this.tasks.resumeRecurrence(tenant, seriesId);
  }

  @Patch('recurrence/:seriesId/end')
  @RequirePermissions(PermissionKeys.tasksUpdate)
  endRecurrence(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('seriesId') seriesId: string,
  ) {
    return this.tasks.endRecurrence(tenant, seriesId);
  }

  @Get('templates')
  @RequirePermissions(PermissionKeys.tasksView)
  listTemplates(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Query() query: TaskTemplateQueryDto,
  ) {
    return this.tasks.listTemplates(tenant, query);
  }

  @Get('time/report')
  @RequirePermissions(PermissionKeys.tasksView)
  timeReport(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Query() query: TaskTimeReportQueryDto,
  ) {
    return this.tasks.timeReport(tenant, query);
  }

  @Get('workload')
  @RequirePermissions(PermissionKeys.tasksView)
  workload(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Query() query: TaskWorkloadQueryDto,
  ) {
    return this.tasks.workload(tenant, query);
  }

  @Get('calendar')
  @RequirePermissions(PermissionKeys.tasksView)
  calendar(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Query() query: TaskCalendarQueryDto,
  ) {
    return this.tasks.calendar(tenant, query);
  }

  @Get('gantt')
  @RequirePermissions(PermissionKeys.tasksView)
  gantt(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Query() query: TaskGanttQueryDto,
  ) {
    return this.tasks.gantt(tenant, query);
  }

  @Get('reports/summary')
  @RequirePermissions(PermissionKeys.tasksView)
  reportsSummary(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Query() query: TaskReportsQueryDto,
  ) {
    return this.tasks.reportsSummary(tenant, query);
  }

  @Get('reports/export')
  @RequirePermissions(PermissionKeys.tasksView)
  reportsExport(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Query() query: TaskReportsQueryDto,
  ) {
    return this.tasks.reportsCsv(tenant, query);
  }

  @Get('activity')
  @RequirePermissions(PermissionKeys.tasksView)
  activity(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Query() query: TaskActivityQueryDto,
  ) {
    return this.tasks.activity(tenant, query);
  }

  @Get('activity/export')
  @RequirePermissions(PermissionKeys.tasksView)
  activityExport(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Query() query: TaskActivityQueryDto,
  ) {
    return this.tasks.activityCsv(tenant, query);
  }

  @Put('workload/capacity/:membershipId')
  @RequirePermissions(PermissionKeys.tasksManage)
  updateCapacity(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('membershipId') membershipId: string,
    @Body() dto: UpdateWorkspaceMemberCapacityDto,
  ) {
    return this.tasks.updateMemberCapacity(tenant, membershipId, dto);
  }

  @Post('templates')
  @RequirePermissions(PermissionKeys.tasksCreate)
  createTemplate(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Body() dto: CreateTaskTemplateDto,
  ) {
    return this.tasks.createTemplate(tenant, dto);
  }

  @Patch('templates/:templateId')
  @RequirePermissions(PermissionKeys.tasksUpdate)
  updateTemplate(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('templateId') templateId: string,
    @Body() dto: UpdateTaskTemplateDto,
  ) {
    return this.tasks.updateTemplate(tenant, templateId, dto);
  }

  @Post('templates/:templateId/use')
  @RequirePermissions(PermissionKeys.tasksCreate)
  createFromTemplate(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('templateId') templateId: string,
    @Body() dto: CreateTaskFromTemplateDto,
  ) {
    return this.tasks.createFromTemplate(tenant, templateId, dto);
  }

  @Patch('templates/:templateId/archive')
  @RequirePermissions(PermissionKeys.tasksUpdate)
  archiveTemplate(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('templateId') templateId: string,
  ) {
    return this.tasks.archiveTemplate(tenant, templateId);
  }

  @Patch('templates/:templateId/reactivate')
  @RequirePermissions(PermissionKeys.tasksUpdate)
  reactivateTemplate(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('templateId') templateId: string,
  ) {
    return this.tasks.reactivateTemplate(tenant, templateId);
  }

  @Get('kanban/settings')
  @RequirePermissions(PermissionKeys.tasksView)
  listKanbanSettings(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext) {
    return this.tasks.listKanbanSettings(tenant);
  }

  @Patch('kanban/columns/:statusDefinitionId')
  @RequirePermissions(PermissionKeys.tasksManage)
  updateKanbanColumnSetting(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskKanbanColumnParamsDto,
    @Body() dto: UpdateTaskKanbanColumnSettingDto,
  ) {
    return this.tasks.updateKanbanColumnSetting(tenant, params.statusDefinitionId, dto);
  }

  @Patch('bulk/status')
  @RequirePermissions(PermissionKeys.tasksUpdate)
  bulkUpdateStatus(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Body() dto: BulkTaskStatusDto,
  ) {
    return this.tasks.bulkUpdateStatus(tenant, dto);
  }

  @Get('completion/approvals')
  @RequirePermissions(PermissionKeys.taskCompletionApprove)
  listApprovalQueue(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Query() query: TaskCompletionQueryDto,
  ) {
    return this.tasks.listCompletionApprovalQueue(tenant, query);
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

  @Patch(':taskId/kanban-position')
  @RequirePermissions(PermissionKeys.tasksUpdate)
  moveKanbanTask(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskParamsDto,
    @Body() dto: TaskKanbanMoveDto,
  ) {
    return this.tasks.moveKanbanTask(tenant, params.taskId, dto);
  }

  @Patch(':taskId/schedule')
  @RequirePermissions(PermissionKeys.tasksUpdate)
  updateSchedule(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskParamsDto,
    @Body() dto: UpdateTaskScheduleDto,
  ) {
    return this.tasks.updateSchedule(tenant, params.taskId, dto);
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

  @Post(':taskId/recurrence')
  @RequirePermissions(PermissionKeys.tasksUpdate)
  makeRecurring(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskParamsDto,
    @Body() dto: UpdateTaskRecurrenceDto,
  ) {
    return this.tasks.makeRecurring(tenant, params.taskId, dto);
  }

  @Post(':taskId/templates')
  @RequirePermissions(PermissionKeys.tasksCreate)
  saveTaskAsTemplate(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskParamsDto,
    @Body() dto: SaveTaskAsTemplateDto,
  ) {
    return this.tasks.saveTaskAsTemplate(tenant, params.taskId, dto);
  }

  @Post(':taskId/time/start')
  @RequirePermissions(PermissionKeys.taskTimeTrack)
  startTimer(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskParamsDto,
    @Body() dto: StartTaskTimerDto,
  ) {
    return this.tasks.startTimer(tenant, params.taskId, dto);
  }

  @Get(':taskId/time')
  @RequirePermissions(PermissionKeys.tasksView)
  listTaskTimeEntries(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskParamsDto,
    @Query() query: TaskTimeReportQueryDto,
  ) {
    return this.tasks.listTaskTimeEntries(tenant, params.taskId, query);
  }

  @Post(':taskId/time')
  @RequirePermissions(PermissionKeys.taskTimeTrack)
  addManualTime(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskParamsDto,
    @Body() dto: CreateTaskTimeEntryDto,
  ) {
    return this.tasks.createManualTimeEntry(tenant, params.taskId, dto);
  }

  @Patch(':taskId/time/:timeEntryId')
  @RequirePermissions(PermissionKeys.tasksView)
  updateTimeEntry(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskTimeEntryParamsDto,
    @Body() dto: UpdateTaskTimeEntryDto,
  ) {
    return this.tasks.updateTimeEntry(tenant, params.taskId, params.timeEntryId, dto);
  }

  @Delete(':taskId/time/:timeEntryId')
  @RequirePermissions(PermissionKeys.tasksView)
  deleteTimeEntry(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskTimeEntryParamsDto,
  ) {
    return this.tasks.deleteTimeEntry(tenant, params.taskId, params.timeEntryId);
  }

  @Get(':taskId/workload-allocations')
  @RequirePermissions(PermissionKeys.tasksView)
  getWorkloadAllocations(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskParamsDto,
  ) {
    return this.tasks.getTaskWorkloadAllocations(tenant, params.taskId);
  }

  @Put(':taskId/workload-allocations')
  @RequirePermissions(PermissionKeys.tasksManage)
  replaceWorkloadAllocations(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskParamsDto,
    @Body() dto: ReplaceTaskWorkloadAllocationsDto,
  ) {
    return this.tasks.replaceWorkloadAllocations(tenant, params.taskId, dto);
  }

  @Get(':taskId/completion-policy')
  @RequirePermissions(PermissionKeys.tasksView, PermissionKeys.taskCompletionView)
  getCompletionPolicy(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskParamsDto,
  ) {
    return this.tasks.getCompletionPolicy(tenant, params.taskId);
  }

  @Put(':taskId/completion-policy')
  @RequirePermissions(PermissionKeys.tasksUpdate, PermissionKeys.taskCompletionManagePolicy)
  upsertCompletionPolicy(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskParamsDto,
    @Body() dto: CompletionPolicyDto,
  ) {
    return this.tasks.upsertCompletionPolicy(tenant, params.taskId, dto);
  }

  @Post(':taskId/completion-submissions')
  @RequirePermissions(PermissionKeys.tasksUpdate, PermissionKeys.taskCompletionSubmit)
  submitCompletion(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskParamsDto,
    @Body() dto: SubmitTaskCompletionDto,
    @Query('statusDefinitionId') statusDefinitionId: string,
  ) {
    return this.tasks.submitCompletion(tenant, params.taskId, statusDefinitionId, dto);
  }

  @Get(':taskId/completion-submissions')
  @RequirePermissions(PermissionKeys.tasksView, PermissionKeys.taskCompletionView)
  listCompletionSubmissions(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskParamsDto,
    @Query() query: TaskCompletionQueryDto,
  ) {
    return this.tasks.listCompletionSubmissions(tenant, params.taskId, query);
  }

  @Post(':taskId/completion-submissions/:submissionId/decisions')
  @RequirePermissions(PermissionKeys.tasksUpdate, PermissionKeys.taskCompletionApprove)
  decideCompletion(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskCompletionSubmissionParamsDto,
    @Body() dto: TaskCompletionDecisionDto,
  ) {
    return this.tasks.decideCompletion(tenant, params.taskId, params.submissionId, dto);
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

  @Post(':taskId/comments')
  @RequirePermissions(PermissionKeys.tasksView, PermissionKeys.taskCommentsCreate)
  createComment(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskParamsDto,
    @Body() dto: CreateTaskCommentDto,
  ) {
    return this.tasks.createComment(tenant, params.taskId, dto);
  }

  @Get(':taskId/comments')
  @RequirePermissions(PermissionKeys.tasksView, PermissionKeys.taskCommentsView)
  listComments(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskParamsDto,
    @Query() query: TaskQueryDto,
  ) {
    return this.tasks.listComments(tenant, params.taskId, query);
  }

  @Post(':taskId/comments/:commentId/replies')
  @RequirePermissions(PermissionKeys.tasksView, PermissionKeys.taskCommentsCreate)
  createCommentReply(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskCommentParamsDto,
    @Body() dto: CreateTaskCommentDto,
  ) {
    return this.tasks.createCommentReply(tenant, params.taskId, params.commentId, dto);
  }

  @Get(':taskId/comments/:commentId/replies')
  @RequirePermissions(PermissionKeys.tasksView, PermissionKeys.taskCommentsView)
  listCommentReplies(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskCommentParamsDto,
    @Query() query: TaskQueryDto,
  ) {
    return this.tasks.listCommentReplies(tenant, params.taskId, params.commentId, query);
  }

  @Patch(':taskId/comments/:commentId')
  @RequirePermissions(PermissionKeys.tasksView, PermissionKeys.taskCommentsView)
  updateComment(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskCommentParamsDto,
    @Body() dto: UpdateTaskCommentDto,
  ) {
    return this.tasks.updateComment(tenant, params.taskId, params.commentId, dto);
  }

  @Delete(':taskId/comments/:commentId')
  @RequirePermissions(PermissionKeys.tasksView, PermissionKeys.taskCommentsView)
  deleteComment(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskCommentParamsDto,
  ) {
    return this.tasks.deleteComment(tenant, params.taskId, params.commentId);
  }

  @Post(':taskId/comments/:commentId/reactions')
  @RequirePermissions(PermissionKeys.tasksView, PermissionKeys.taskCommentsView)
  addCommentReaction(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskCommentParamsDto,
    @Body() dto: TaskCommentReactionDto,
  ) {
    return this.tasks.addCommentReaction(tenant, params.taskId, params.commentId, dto);
  }

  @Post(':taskId/comments/:commentId/reactions/remove')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(PermissionKeys.tasksView, PermissionKeys.taskCommentsView)
  removeCommentReaction(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskCommentParamsDto,
    @Body() dto: TaskCommentReactionDto,
  ) {
    return this.tasks.removeCommentReaction(tenant, params.taskId, params.commentId, dto);
  }

  @Get(':taskId/tags')
  @RequirePermissions(PermissionKeys.tasksView)
  listTaskTags(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskParamsDto,
  ) {
    return this.tasks.listTaskTags(tenant, params.taskId);
  }

  @Post(':taskId/tags/add')
  @RequirePermissions(PermissionKeys.tasksUpdate, PermissionKeys.tagsAssign)
  addTaskTags(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskParamsDto,
    @Body() dto: TaskTagIdsDto,
  ) {
    return this.tasks.addTaskTags(tenant, params.taskId, dto);
  }

  @Post(':taskId/tags/remove')
  @RequirePermissions(PermissionKeys.tasksUpdate, PermissionKeys.tagsAssign)
  removeTaskTags(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskParamsDto,
    @Body() dto: TaskTagIdsDto,
  ) {
    return this.tasks.removeTaskTags(tenant, params.taskId, dto);
  }

  @Get(':taskId/attachments')
  @RequirePermissions(PermissionKeys.tasksView, PermissionKeys.taskAttachmentsView)
  listAttachments(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskParamsDto,
    @Query() query: TaskQueryDto,
  ) {
    return this.tasks.listAttachments(tenant, params.taskId, query);
  }

  @Post(':taskId/attachments/upload-init')
  @RequirePermissions(PermissionKeys.tasksView, PermissionKeys.taskAttachmentsAdd)
  initAttachmentUpload(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskParamsDto,
    @Body() dto: UploadInitDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.tasks.initAttachmentUpload(tenant, params.taskId, dto, context.correlationId);
  }

  @Post(':taskId/attachments/:attachmentId/upload-complete')
  @RequirePermissions(PermissionKeys.tasksView, PermissionKeys.taskAttachmentsAdd)
  completeAttachmentUpload(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskAttachmentParamsDto,
    @Body() dto: UploadCompleteDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.tasks.completeAttachmentUpload(
      tenant,
      params.taskId,
      params.attachmentId,
      dto,
      context.correlationId,
    );
  }

  @Post(':taskId/attachments/url')
  @RequirePermissions(PermissionKeys.tasksView, PermissionKeys.taskAttachmentsAdd)
  addUrlAttachment(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskParamsDto,
    @Body() dto: CreateTaskUrlAttachmentDto,
  ) {
    return this.tasks.addUrlAttachment(tenant, params.taskId, dto);
  }

  @Post(':taskId/attachments/link')
  @RequirePermissions(PermissionKeys.tasksView, PermissionKeys.taskAttachmentsAdd)
  linkAttachments(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskParamsDto,
    @Body() dto: TaskAttachmentIdsDto,
  ) {
    return this.tasks.linkAttachments(tenant, params.taskId, dto);
  }

  @Get(':taskId/attachments/:attachmentId/download')
  @RequirePermissions(
    PermissionKeys.tasksView,
    PermissionKeys.taskAttachmentsView,
    PermissionKeys.taskAttachmentsDownload,
  )
  downloadAttachment(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskAttachmentParamsDto,
  ) {
    return this.tasks.downloadAttachment(tenant, params.taskId, params.attachmentId);
  }

  @Delete(':taskId/attachments/:attachmentId')
  @RequirePermissions(PermissionKeys.tasksView, PermissionKeys.taskAttachmentsRemove)
  removeAttachment(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TaskAttachmentParamsDto,
  ) {
    return this.tasks.removeAttachment(tenant, params.taskId, params.attachmentId);
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
    return this.tasks.updateStatus(
      tenant,
      params.taskId,
      dto.statusDefinitionId,
      dto.completion,
      dto.dueAt,
    );
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
