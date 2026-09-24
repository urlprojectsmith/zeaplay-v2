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
import { ApiKeysService } from './api-keys.service';
import {
  ApiKeyIdParamDto,
  ApiKeyListQueryDto,
  CreateApiKeyDto,
  UpdateApiKeyDto,
} from './dto/api-key.dto';

@ApiTags('workspace api keys')
@ApiBearerAuth()
@ApiHeader({ name: AGENCY_HEADER, required: true })
@ApiHeader({ name: WORKSPACE_HEADER, required: true })
@UseGuards(JwtAuthGuard, WorkspaceTenantGuard, PermissionGuard)
@Controller('workspaces/:workspaceId/api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Get()
  @RequirePermissions(PermissionKeys.apiKeysView)
  list(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Query() query: ApiKeyListQueryDto,
  ) {
    return this.apiKeys.list(tenant, query);
  }

  @Post()
  @RequirePermissions(PermissionKeys.apiKeysCreate)
  create(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext, @Body() dto: CreateApiKeyDto) {
    return this.apiKeys.create(tenant, dto);
  }

  @Patch(':apiKeyId')
  @RequirePermissions(PermissionKeys.apiKeysManage)
  update(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: ApiKeyIdParamDto,
    @Body() dto: UpdateApiKeyDto,
  ) {
    return this.apiKeys.update(tenant, params.apiKeyId, dto);
  }

  @Post(':apiKeyId/revoke')
  @RequirePermissions(PermissionKeys.apiKeysManage)
  revoke(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: ApiKeyIdParamDto,
  ) {
    return this.apiKeys.revoke(tenant, params.apiKeyId);
  }
}
