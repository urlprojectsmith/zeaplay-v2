import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
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
  CreateIntegrationConnectionDto,
  ExecuteIntegrationActionDto,
  IntegrationCapabilityParamDto,
  IntegrationIdParamDto,
  IntegrationListQueryDto,
  UpdateIntegrationConnectionDto,
} from './dto/integration.dto';
import { IntegrationsService } from './integrations.service';

@ApiTags('workspace integrations')
@ApiBearerAuth()
@ApiHeader({ name: AGENCY_HEADER, required: true })
@ApiHeader({ name: WORKSPACE_HEADER, required: true })
@UseGuards(JwtAuthGuard, WorkspaceTenantGuard, PermissionGuard)
@Controller('workspaces/:workspaceId/integrations')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get('providers')
  @RequirePermissions(PermissionKeys.integrationsView)
  listProviders() {
    return this.integrations.listProviders();
  }

  @Get()
  @RequirePermissions(PermissionKeys.integrationsView)
  list(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Query() query: IntegrationListQueryDto,
  ) {
    return this.integrations.list(tenant, query);
  }

  @Post()
  @RequirePermissions(PermissionKeys.integrationsCreate)
  create(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Body() dto: CreateIntegrationConnectionDto,
  ) {
    return this.integrations.create(tenant, dto);
  }

  @Get(':integrationId')
  @RequirePermissions(PermissionKeys.integrationsView)
  get(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: IntegrationIdParamDto,
  ) {
    return this.integrations.get(tenant, params.integrationId);
  }

  @Patch(':integrationId')
  @RequirePermissions(PermissionKeys.integrationsManage)
  update(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: IntegrationIdParamDto,
    @Body() dto: UpdateIntegrationConnectionDto,
  ) {
    return this.integrations.update(tenant, params.integrationId, dto);
  }

  @Post(':integrationId/test')
  @RequirePermissions(PermissionKeys.integrationsManage)
  test(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: IntegrationIdParamDto,
  ) {
    return this.integrations.testConnection(tenant, params.integrationId);
  }

  @Post(':integrationId/disconnect')
  @RequirePermissions(PermissionKeys.integrationsManage)
  disconnect(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: IntegrationIdParamDto,
  ) {
    return this.integrations.disconnect(tenant, params.integrationId);
  }

  @Post(':integrationId/actions/:capability')
  @RequirePermissions(PermissionKeys.integrationsExecute)
  execute(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: IntegrationCapabilityParamDto,
    @Body() dto: ExecuteIntegrationActionDto,
  ) {
    return this.integrations.execute(tenant, params.integrationId, params.capability, dto);
  }
}
