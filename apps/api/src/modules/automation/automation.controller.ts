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
import { AutomationDomainEventsService } from './automation-domain-events.service';
import { AutomationExecutionService } from './automation-execution.service';
import { AutomationPolicyService } from './automation-policy.service';
import { AutomationService } from './automation.service';
import {
  AutomationDomainEventParamsDto,
  AutomationDomainEventQueryDto,
  AutomationExecutionParamsDto,
  AutomationExecutionQueryDto,
  AutomationTriggerMatchQueryDto,
  AutomationVersionQueryDto,
  AutomationWorkflowParamsDto,
  AutomationWorkflowQueryDto,
  AutomationWorkflowVersionParamsDto,
  CloneAutomationWorkflowDto,
  CreateAutomationWorkflowDto,
  ReplayAutomationExecutionDto,
  UpdateAutomationRuntimePolicyDto,
  UpdateAutomationDraftDto,
  UpdateAutomationWorkflowDto,
} from './dto/automation.dto';

@ApiTags('workspace automations')
@ApiBearerAuth()
@ApiHeader({ name: AGENCY_HEADER, required: true })
@ApiHeader({ name: WORKSPACE_HEADER, required: true })
@UseGuards(JwtAuthGuard, WorkspaceTenantGuard, PermissionGuard)
@Controller('workspaces/:workspaceId/automations')
export class AutomationController {
  constructor(
    private readonly automation: AutomationService,
    private readonly domainEvents: AutomationDomainEventsService,
    private readonly executions: AutomationExecutionService,
    private readonly policy: AutomationPolicyService,
  ) {}

  @Get()
  @RequirePermissions(PermissionKeys.automationView)
  list(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Query() query: AutomationWorkflowQueryDto,
  ) {
    return this.automation.list(tenant, query);
  }

  @Post()
  @RequirePermissions(PermissionKeys.automationCreate)
  create(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Body() dto: CreateAutomationWorkflowDto,
  ) {
    return this.automation.create(tenant, dto);
  }

  @Post(':workflowId/clone')
  @RequirePermissions(PermissionKeys.automationView, PermissionKeys.automationCreate)
  clone(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: AutomationWorkflowParamsDto,
    @Body() dto: CloneAutomationWorkflowDto,
  ) {
    return this.automation.cloneWorkflow(tenant, params.workflowId, dto);
  }

  @Get('events')
  @RequirePermissions(PermissionKeys.automationView)
  events(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Query() query: AutomationDomainEventQueryDto,
  ) {
    return this.domainEvents.listEvents(tenant, query);
  }

  @Get('events/:eventId')
  @RequirePermissions(PermissionKeys.automationView)
  event(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: AutomationDomainEventParamsDto,
  ) {
    return this.domainEvents.getEvent(tenant, params.eventId);
  }

  @Get('trigger-matches')
  @RequirePermissions(PermissionKeys.automationView)
  triggerMatches(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Query() query: AutomationTriggerMatchQueryDto,
  ) {
    return this.domainEvents.listTriggerMatches(tenant, query);
  }

  @Get('executions')
  @RequirePermissions(PermissionKeys.automationExecutionsView)
  executionsList(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Query() query: AutomationExecutionQueryDto,
  ) {
    return this.executions.listExecutions(tenant, query);
  }

  @Get('automation-health')
  @RequirePermissions(PermissionKeys.automationExecutionsView)
  automationHealth(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext) {
    return this.executions.healthSummary(tenant);
  }

  @Get('runtime-policy')
  @RequirePermissions(PermissionKeys.automationLimitsView)
  runtimePolicy(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext) {
    return this.policy.getRuntimePolicy(tenant);
  }

  @Patch('runtime-policy')
  @RequirePermissions(PermissionKeys.automationLimitsManage)
  updateRuntimePolicy(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Body() dto: UpdateAutomationRuntimePolicyDto,
  ) {
    return this.policy.updateRuntimePolicy(tenant, dto);
  }

  @Get('executions/:executionId')
  @RequirePermissions(PermissionKeys.automationExecutionsView)
  execution(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: AutomationExecutionParamsDto,
  ) {
    return this.executions.getExecution(tenant, params.executionId);
  }

  @Post('executions/:executionId/replay')
  @RequirePermissions(PermissionKeys.automationExecutionsReplay)
  replayExecution(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: AutomationExecutionParamsDto,
    @Body() dto: ReplayAutomationExecutionDto,
  ) {
    return this.executions.replayExecution(tenant, params.executionId, dto);
  }

  @Get(':workflowId')
  @RequirePermissions(PermissionKeys.automationView)
  get(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: AutomationWorkflowParamsDto,
  ) {
    return this.automation.get(tenant, params.workflowId);
  }

  @Patch(':workflowId')
  @RequirePermissions(PermissionKeys.automationEdit)
  update(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: AutomationWorkflowParamsDto,
    @Body() dto: UpdateAutomationWorkflowDto,
  ) {
    return this.automation.update(tenant, params.workflowId, dto);
  }

  @Patch(':workflowId/draft')
  @RequirePermissions(PermissionKeys.automationEdit)
  updateDraft(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: AutomationWorkflowParamsDto,
    @Body() dto: UpdateAutomationDraftDto,
  ) {
    return this.automation.updateDraft(tenant, params.workflowId, dto);
  }

  @Post(':workflowId/publish')
  @RequirePermissions(PermissionKeys.automationPublish)
  publish(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: AutomationWorkflowParamsDto,
  ) {
    return this.automation.publish(tenant, params.workflowId);
  }

  @Post(':workflowId/disable')
  @RequirePermissions(PermissionKeys.automationDisable)
  disable(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: AutomationWorkflowParamsDto,
  ) {
    return this.automation.disable(tenant, params.workflowId);
  }

  @Post(':workflowId/enable')
  @RequirePermissions(PermissionKeys.automationDisable)
  enable(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: AutomationWorkflowParamsDto,
  ) {
    return this.automation.enable(tenant, params.workflowId);
  }

  @Delete(':workflowId')
  @RequirePermissions(PermissionKeys.automationDisable)
  archive(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: AutomationWorkflowParamsDto,
  ) {
    return this.automation.archive(tenant, params.workflowId);
  }

  @Get(':workflowId/versions')
  @RequirePermissions(PermissionKeys.automationView)
  versions(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: AutomationWorkflowParamsDto,
    @Query() query: AutomationVersionQueryDto,
  ) {
    return this.automation.versions(tenant, params.workflowId, query);
  }

  @Get(':workflowId/versions/:versionId')
  @RequirePermissions(PermissionKeys.automationView)
  version(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: AutomationWorkflowVersionParamsDto,
  ) {
    return this.automation.version(tenant, params.workflowId, params.versionId);
  }

  @Post(':workflowId/versions/:versionId/create-draft')
  @RequirePermissions(PermissionKeys.automationEdit)
  createDraftFromVersion(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: AutomationWorkflowVersionParamsDto,
  ) {
    return this.automation.createDraftFromVersion(tenant, params.workflowId, params.versionId);
  }
}
