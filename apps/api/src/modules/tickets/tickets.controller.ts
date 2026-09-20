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
import type { RequestContext } from '@zea-play/types';
import { IsUUID } from 'class-validator';
import type { WorkspaceTenantContext } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { ReqContext } from '../../common/decorators/request-context.decorator';
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
import { CreateTicketDto } from './dto/create-ticket.dto';
import { UploadCompleteDto } from '../assets/dto/upload-complete.dto';
import { UploadInitDto } from '../assets/dto/upload-init.dto';
import {
  CreateTicketConversationEntryDto,
  TicketConversationQueryDto,
} from './dto/ticket-conversation.dto';
import {
  CreateTicketUrlAttachmentDto,
  TicketActivityQueryDto,
  TicketAttachmentIdsDto,
  TicketAttachmentParamsDto,
  TicketAttachmentQueryDto,
  TicketConversationAttachmentParamsDto,
} from './dto/ticket-attachments.dto';
import { TicketQueryDto } from './dto/ticket-query.dto';
import { TicketReportQueryDto } from './dto/ticket-reports.dto';
import { TicketSavedViewDto, UpdateTicketSavedViewDto } from './dto/ticket-saved-view.dto';
import {
  ClaimTicketDto,
  UpdateTicketEscalationDto,
  UpdateTicketAssignmentDto,
  UpdateTicketDto,
  UpdateTicketRequesterDto,
  UpdateTicketStatusDto,
} from './dto/update-ticket.dto';
import { TicketSlaPolicyDto, UpdateTicketSlaPolicyDto } from './dto/ticket-sla.dto';
import { TicketSlaService } from './ticket-sla.service';
import { TicketsService } from './tickets.service';

class WorkspaceTicketParamDto extends UuidParamDto {
  @IsUUID()
  workspaceId!: string;
}

@ApiTags('tickets')
@ApiBearerAuth()
@ApiHeader({ name: AGENCY_HEADER, required: true })
@ApiHeader({ name: WORKSPACE_HEADER, required: true })
@UseGuards(JwtAuthGuard, WorkspaceTenantGuard, PermissionGuard)
@Controller('workspaces/:workspaceId/tickets')
export class TicketsController {
  constructor(
    private readonly tickets: TicketsService,
    private readonly ticketSla: TicketSlaService,
  ) {}

  @Post()
  @RequirePermissions(PermissionKeys.ticketsCreate)
  create(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext, @Body() dto: CreateTicketDto) {
    return this.tickets.create(tenant, dto);
  }

  @Get()
  @RequirePermissions(PermissionKeys.ticketsView)
  list(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext, @Query() query: TicketQueryDto) {
    return this.tickets.list(tenant, query);
  }

  @Get('queue-summary')
  @RequirePermissions(PermissionKeys.ticketsView)
  queueSummary(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext) {
    return this.tickets.queueSummary(tenant);
  }

  @Get('saved-views')
  @RequirePermissions(PermissionKeys.ticketsView)
  listSavedViews(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext) {
    return this.tickets.listSavedViews(tenant);
  }

  @Post('saved-views')
  @RequirePermissions(PermissionKeys.ticketsView)
  createSavedView(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Body() dto: TicketSavedViewDto,
  ) {
    return this.tickets.createSavedView(tenant, dto);
  }

  @Patch('saved-views/:viewId')
  @RequirePermissions(PermissionKeys.ticketsView)
  updateSavedView(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('viewId') viewId: string,
    @Body() dto: UpdateTicketSavedViewDto,
  ) {
    return this.tickets.updateSavedView(tenant, viewId, dto);
  }

  @Delete('saved-views/:viewId')
  @RequirePermissions(PermissionKeys.ticketsView)
  deleteSavedView(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('viewId') viewId: string,
  ) {
    return this.tickets.deleteSavedView(tenant, viewId);
  }

  @Get('reports')
  @RequirePermissions(PermissionKeys.ticketsView, PermissionKeys.ticketsReportsView)
  reports(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Query() query: TicketReportQueryDto,
  ) {
    return this.tickets.reports(tenant, query);
  }

  @Get('reports/export')
  @RequirePermissions(PermissionKeys.ticketsView, PermissionKeys.ticketsReportsExport)
  reportsExport(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Query() query: TicketReportQueryDto,
  ) {
    return this.tickets.reportsCsv(tenant, query);
  }

  @Get('sla/policies')
  listSlaPolicies(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext) {
    return this.ticketSla.listPolicies(tenant);
  }

  @Post('sla/policies')
  @RequirePermissions(PermissionKeys.ticketsSlaManage)
  createSlaPolicy(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Body() dto: TicketSlaPolicyDto,
  ) {
    return this.ticketSla.createPolicy(tenant, dto);
  }

  @Patch('sla/policies/:policyId')
  @RequirePermissions(PermissionKeys.ticketsSlaManage)
  updateSlaPolicy(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('policyId') policyId: string,
    @Body() dto: UpdateTicketSlaPolicyDto,
  ) {
    return this.ticketSla.updatePolicy(tenant, policyId, dto);
  }

  @Get(':id')
  @RequirePermissions(PermissionKeys.ticketsView)
  get(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WorkspaceTicketParamDto,
  ) {
    return this.tickets.get(tenant, params.id);
  }

  @Get(':id/sla')
  @RequirePermissions(PermissionKeys.ticketsView, PermissionKeys.ticketsSlaView)
  getTicketSla(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WorkspaceTicketParamDto,
  ) {
    return this.ticketSla.getTicketSla(tenant, params.id);
  }

  @Get(':id/conversation')
  @RequirePermissions(PermissionKeys.ticketsView)
  listConversation(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WorkspaceTicketParamDto,
    @Query() query: TicketConversationQueryDto,
  ) {
    return this.tickets.listConversation(tenant, params.id, query);
  }

  @Post(':id/conversation')
  @RequirePermissions(PermissionKeys.ticketsView)
  createConversationEntry(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WorkspaceTicketParamDto,
    @Body() dto: CreateTicketConversationEntryDto,
  ) {
    return this.tickets.createConversationEntry(tenant, params.id, dto);
  }

  @Get(':id/attachments')
  @RequirePermissions(PermissionKeys.ticketsView, PermissionKeys.ticketsAttachmentsView)
  listAttachments(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WorkspaceTicketParamDto,
    @Query() query: TicketAttachmentQueryDto,
  ) {
    return this.tickets.listAttachments(tenant, params.id, query);
  }

  @Post(':id/attachments/upload-init')
  @RequirePermissions(PermissionKeys.ticketsView, PermissionKeys.ticketsAttachmentsAdd)
  initAttachmentUpload(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WorkspaceTicketParamDto,
    @Body() dto: UploadInitDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.tickets.initAttachmentUpload(tenant, params.id, dto, context.correlationId);
  }

  @Post(':id/attachments/:attachmentId/upload-complete')
  @RequirePermissions(PermissionKeys.ticketsView, PermissionKeys.ticketsAttachmentsAdd)
  completeAttachmentUpload(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TicketAttachmentParamsDto,
    @Body() dto: UploadCompleteDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.tickets.completeAttachmentUpload(
      tenant,
      params.id,
      params.attachmentId,
      dto,
      context.correlationId,
    );
  }

  @Post(':id/attachments/url')
  @RequirePermissions(PermissionKeys.ticketsView, PermissionKeys.ticketsAttachmentsAdd)
  addUrlAttachment(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WorkspaceTicketParamDto,
    @Body() dto: CreateTicketUrlAttachmentDto,
  ) {
    return this.tickets.addUrlAttachment(tenant, params.id, dto);
  }

  @Post(':id/attachments/link')
  @RequirePermissions(PermissionKeys.ticketsView, PermissionKeys.ticketsAttachmentsAdd)
  linkAttachments(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WorkspaceTicketParamDto,
    @Body() dto: TicketAttachmentIdsDto,
  ) {
    return this.tickets.linkAttachments(tenant, params.id, dto);
  }

  @Get(':id/attachments/:attachmentId/download')
  @RequirePermissions(PermissionKeys.ticketsView, PermissionKeys.ticketsAttachmentsView)
  downloadAttachment(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TicketAttachmentParamsDto,
  ) {
    return this.tickets.downloadAttachment(tenant, params.id, params.attachmentId);
  }

  @Delete(':id/attachments/:attachmentId')
  @RequirePermissions(PermissionKeys.ticketsView, PermissionKeys.ticketsAttachmentsRemove)
  removeAttachment(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TicketAttachmentParamsDto,
  ) {
    return this.tickets.removeAttachment(tenant, params.id, params.attachmentId);
  }

  @Get(':id/conversation/:entryId/attachments/:attachmentId/download')
  @RequirePermissions(PermissionKeys.ticketsView, PermissionKeys.ticketsAttachmentsView)
  downloadConversationAttachment(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TicketConversationAttachmentParamsDto,
  ) {
    return this.tickets.downloadConversationAttachment(
      tenant,
      params.id,
      params.entryId,
      params.attachmentId,
    );
  }

  @Get(':id/activity')
  @RequirePermissions(PermissionKeys.ticketsView, PermissionKeys.ticketsActivityView)
  activity(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WorkspaceTicketParamDto,
    @Query() query: TicketActivityQueryDto,
  ) {
    return this.tickets.activity(tenant, params.id, query);
  }

  @Patch(':id')
  @RequirePermissions(PermissionKeys.ticketsView, PermissionKeys.ticketsUpdate)
  update(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WorkspaceTicketParamDto,
    @Body() dto: UpdateTicketDto,
  ) {
    return this.tickets.update(tenant, params.id, dto);
  }

  @Patch(':id/status')
  @RequirePermissions(PermissionKeys.ticketsView, PermissionKeys.ticketsUpdate)
  updateStatus(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WorkspaceTicketParamDto,
    @Body() dto: UpdateTicketStatusDto,
  ) {
    return this.tickets.updateStatus(tenant, params.id, dto.statusDefinitionId);
  }

  @Patch(':id/requester')
  @RequirePermissions(PermissionKeys.ticketsView, PermissionKeys.ticketsManageRequester)
  updateRequester(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WorkspaceTicketParamDto,
    @Body() dto: UpdateTicketRequesterDto,
  ) {
    return this.tickets.updateRequester(tenant, params.id, dto.requester);
  }

  @Patch(':id/assignment')
  @RequirePermissions(PermissionKeys.ticketsView, PermissionKeys.ticketsAssign)
  updateAssignment(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WorkspaceTicketParamDto,
    @Body() dto: UpdateTicketAssignmentDto,
  ) {
    return this.tickets.updateAssignment(tenant, params.id, dto);
  }

  @Post(':id/claim')
  @RequirePermissions(PermissionKeys.ticketsView)
  claim(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WorkspaceTicketParamDto,
    @Body() _dto: ClaimTicketDto,
  ) {
    return this.tickets.claim(tenant, params.id);
  }

  @Post(':id/escalation')
  @RequirePermissions(PermissionKeys.ticketsView)
  updateEscalation(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WorkspaceTicketParamDto,
    @Body() dto: UpdateTicketEscalationDto,
  ) {
    return this.tickets.updateEscalation(tenant, params.id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PermissionKeys.ticketsView, PermissionKeys.ticketsDelete)
  delete(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: WorkspaceTicketParamDto,
  ) {
    return this.tickets.delete(tenant, params.id);
  }
}
