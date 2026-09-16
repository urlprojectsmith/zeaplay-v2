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
  CreateStatusDto,
  ReorderStatusesDto,
  StatusEntityTypeParamsDto,
  StatusParamsDto,
  StatusQueryDto,
  UpdateStatusDto,
} from './dto/status.dto';
import { StatusesService } from './statuses.service';

@ApiTags('workspace statuses')
@ApiBearerAuth()
@ApiHeader({ name: AGENCY_HEADER, required: true })
@ApiHeader({ name: WORKSPACE_HEADER, required: true })
@UseGuards(JwtAuthGuard, WorkspaceTenantGuard, PermissionGuard)
@Controller('workspaces/:workspaceId/statuses')
export class StatusesController {
  constructor(private readonly statuses: StatusesService) {}

  @Post('initialize-defaults')
  @RequirePermissions(PermissionKeys.statusesManage)
  initializeDefaults(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext) {
    return this.statuses.initializeDefaults(tenant);
  }

  @Get()
  @RequirePermissions(PermissionKeys.statusesView)
  list(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext, @Query() query: StatusQueryDto) {
    return this.statuses.list(tenant, query);
  }

  @Get(':entityType')
  @RequirePermissions(PermissionKeys.statusesView)
  listForEntity(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: StatusEntityTypeParamsDto,
  ) {
    return this.statuses.listForEntity(tenant, params.entityType);
  }

  @Post(':entityType')
  @RequirePermissions(PermissionKeys.statusesCreate)
  create(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: StatusEntityTypeParamsDto,
    @Body() dto: CreateStatusDto,
  ) {
    return this.statuses.create(tenant, params.entityType, dto);
  }

  @Patch(':entityType/reorder')
  @RequirePermissions(PermissionKeys.statusesReorder)
  reorder(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: StatusEntityTypeParamsDto,
    @Body() dto: ReorderStatusesDto,
  ) {
    return this.statuses.reorder(tenant, params.entityType, dto);
  }

  @Get(':entityType/:statusId')
  @RequirePermissions(PermissionKeys.statusesView)
  get(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext, @Param() params: StatusParamsDto) {
    return this.statuses.get(tenant, params.entityType, params.statusId);
  }

  @Patch(':entityType/:statusId')
  @RequirePermissions(PermissionKeys.statusesUpdate)
  update(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: StatusParamsDto,
    @Body() dto: UpdateStatusDto,
  ) {
    return this.statuses.update(tenant, params.entityType, params.statusId, dto);
  }

  @Post(':entityType/:statusId/set-default')
  @RequirePermissions(PermissionKeys.statusesManage)
  setDefault(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: StatusParamsDto,
  ) {
    return this.statuses.setDefault(tenant, params.entityType, params.statusId);
  }
}
