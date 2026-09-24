import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { CloudDriveProvider } from '@prisma/client';
import type { Response } from 'express';
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
import { CloudDrivesService } from './cloud-drives.service';
import {
  CloudConnectDto,
  CloudExportDto,
  CloudImportDto,
  CloudListQueryDto,
  CloudOAuthCallbackDto,
} from './dto/cloud-drive.dto';

@ApiTags('cloud-drives')
@ApiBearerAuth()
@ApiHeader({ name: AGENCY_HEADER, required: true })
@ApiHeader({ name: WORKSPACE_HEADER, required: true })
@UseGuards(JwtAuthGuard, WorkspaceTenantGuard, PermissionGuard)
@Controller('workspaces/:workspaceId/cloud-drives')
export class CloudDrivesController {
  constructor(private readonly cloudDrives: CloudDrivesService) {}

  @Get('providers')
  @RequirePermissions(PermissionKeys.storageCloudView)
  providers() {
    return this.cloudDrives.providerStatuses();
  }

  @Get('connections')
  @RequirePermissions(PermissionKeys.storageCloudView)
  connections(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext) {
    return this.cloudDrives.listConnections(tenant);
  }

  @Post(':provider/connect')
  @RequirePermissions(PermissionKeys.storageCloudConnect)
  connect(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('provider', new ParseEnumPipe(CloudDriveProvider)) provider: CloudDriveProvider,
    @Body() dto: CloudConnectDto,
  ) {
    return this.cloudDrives.startConnection(tenant, provider, dto.redirectPath);
  }

  @Post('connections/:id/disconnect')
  @RequirePermissions(PermissionKeys.storageCloudManage)
  disconnect(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('id') connectionId: string,
  ) {
    return this.cloudDrives.disconnect(tenant, connectionId);
  }

  @Get('connections/:id/files')
  @RequirePermissions(PermissionKeys.storageCloudView)
  listFiles(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('id') connectionId: string,
    @Query() query: CloudListQueryDto,
  ) {
    return this.cloudDrives.listFiles(tenant, connectionId, query);
  }

  @Get('connections/:id/folders')
  @RequirePermissions(PermissionKeys.storageCloudView)
  listFolders(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('id') connectionId: string,
    @Query() query: CloudListQueryDto,
  ) {
    return this.cloudDrives.listFiles(tenant, connectionId, { ...query, foldersOnly: true });
  }

  @Post('connections/:id/import')
  @RequirePermissions(PermissionKeys.storageCloudImport)
  importFile(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('id') connectionId: string,
    @Body() dto: CloudImportDto,
  ) {
    return this.cloudDrives.importFile(tenant, connectionId, dto);
  }

  @Post('connections/:id/export')
  @RequirePermissions(PermissionKeys.storageCloudExport)
  exportFile(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('id') connectionId: string,
    @Body() dto: CloudExportDto,
  ) {
    return this.cloudDrives.exportAsset(tenant, connectionId, dto);
  }
}

@ApiTags('cloud-drives')
@Controller('cloud-drives/oauth')
export class CloudDriveOAuthController {
  constructor(private readonly cloudDrives: CloudDrivesService) {}

  @Get('callback')
  async callbackGet(@Query() query: CloudOAuthCallbackDto, @Res() response: Response) {
    try {
      const result = await this.cloudDrives.completeOAuthCallback(query);
      response.redirect(
        303,
        buildSafeWebRedirect(result.redirectPath, { cloudDrive: 'connected' }),
      );
    } catch {
      response.redirect(303, buildSafeWebRedirect('/workspace/settings', { cloudDrive: 'error' }));
    }
  }

  @Post('callback')
  callbackPost(@Body() dto: CloudOAuthCallbackDto) {
    return this.cloudDrives.completeOAuthCallback(dto);
  }
}

function buildSafeWebRedirect(path: string | null | undefined, params: Record<string, string>) {
  const base = process.env.WEB_APP_URL ?? 'http://localhost:3000';
  const safePath =
    path && path.startsWith('/') && !path.startsWith('//') ? path : '/workspace/settings';
  const url = new URL(safePath, base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}
