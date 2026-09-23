import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
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
import { AutomationService } from './automation.service';
import {
  AutomationTemplateQueryDto,
  AutomationWorkflowTemplateParamsDto,
  CreateAutomationTemplateDto,
  UseAutomationTemplateDto,
} from './dto/automation.dto';

@ApiTags('workspace automation templates')
@ApiBearerAuth()
@ApiHeader({ name: AGENCY_HEADER, required: true })
@ApiHeader({ name: WORKSPACE_HEADER, required: true })
@UseGuards(JwtAuthGuard, WorkspaceTenantGuard, PermissionGuard)
@Controller('workspaces/:workspaceId/automation-templates')
export class AutomationTemplateController {
  constructor(private readonly automation: AutomationService) {}

  @Get()
  @RequirePermissions(PermissionKeys.automationTemplatesView)
  list(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Query() query: AutomationTemplateQueryDto,
  ) {
    return this.automation.listTemplates(tenant, query);
  }

  @Post()
  @RequirePermissions(PermissionKeys.automationTemplatesManage, PermissionKeys.automationView)
  create(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Body() dto: CreateAutomationTemplateDto,
  ) {
    return this.automation.createTemplate(tenant, dto);
  }

  @Get(':templateId')
  @RequirePermissions(PermissionKeys.automationTemplatesView)
  get(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: AutomationWorkflowTemplateParamsDto,
  ) {
    return this.automation.getTemplate(tenant, params.templateId);
  }

  @Post(':templateId/use')
  @RequirePermissions(PermissionKeys.automationTemplatesView, PermissionKeys.automationCreate)
  use(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: AutomationWorkflowTemplateParamsDto,
    @Body() dto: UseAutomationTemplateDto,
  ) {
    return this.automation.useTemplate(tenant, params.templateId, dto);
  }

  @Delete(':templateId')
  @RequirePermissions(PermissionKeys.automationTemplatesManage)
  archive(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: AutomationWorkflowTemplateParamsDto,
  ) {
    return this.automation.archiveTemplate(tenant, params.templateId);
  }
}
