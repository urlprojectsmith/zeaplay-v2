import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
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
import { AssetsService } from './assets.service';
import {
  StorageRetentionPolicyUpdateDto,
  WorkspaceFileBulkActionDto,
  WorkspaceFileCompleteDto,
  WorkspaceFileQueryDto,
  WorkspaceFileUploadInitDto,
} from './dto/workspace-file.dto';

@ApiTags('workspace-files')
@ApiBearerAuth()
@ApiHeader({ name: AGENCY_HEADER, required: true })
@ApiHeader({ name: WORKSPACE_HEADER, required: true })
@UseGuards(JwtAuthGuard, WorkspaceTenantGuard, PermissionGuard)
@Controller('workspaces/:workspaceId')
export class WorkspaceFilesController {
  constructor(private readonly assets: AssetsService) {}

  @Post('files/uploads')
  @RequirePermissions(PermissionKeys.storageUpload)
  initUpload(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Body() dto: WorkspaceFileUploadInitDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.assets.initWorkspaceUpload(tenant, dto, context.correlationId);
  }

  @Post('files/:fileId/complete')
  @RequirePermissions(PermissionKeys.storageUpload)
  completeUpload(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('fileId') fileId: string,
    @Body() dto: WorkspaceFileCompleteDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.assets.completeWorkspaceUpload(tenant, fileId, dto, context.correlationId);
  }

  @Get('files')
  @RequirePermissions(PermissionKeys.storageView)
  list(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Query() query: WorkspaceFileQueryDto,
  ) {
    return this.assets.listWorkspaceFiles(tenant, query);
  }

  @Post('files/bulk')
  @RequirePermissions(PermissionKeys.storageManage)
  bulkAction(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Body() dto: WorkspaceFileBulkActionDto,
  ) {
    return this.assets.bulkWorkspaceFileAction(tenant, dto);
  }

  @Get('files/:fileId')
  @RequirePermissions(PermissionKeys.storageView)
  get(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext, @Param('fileId') fileId: string) {
    return this.assets.getWorkspaceFile(tenant, fileId);
  }

  @Post('files/:fileId/download-url')
  @RequirePermissions(PermissionKeys.storageDownload)
  downloadUrl(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('fileId') fileId: string,
  ) {
    return this.assets.createWorkspaceDownloadUrl(tenant, fileId);
  }

  @Post('files/:fileId/archive')
  @RequirePermissions(PermissionKeys.storageManage)
  archive(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('fileId') fileId: string,
  ) {
    return this.assets.archiveWorkspaceFile(tenant, fileId);
  }

  @Post('files/:fileId/delete')
  @RequirePermissions(PermissionKeys.storageManage)
  delete(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('fileId') fileId: string,
  ) {
    return this.assets.requestWorkspaceFileDelete(tenant, fileId);
  }

  @Post('files/:fileId/restore')
  @RequirePermissions(PermissionKeys.storageManage)
  restore(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('fileId') fileId: string,
  ) {
    return this.assets.restoreWorkspaceFile(tenant, fileId);
  }

  @Get('files/:fileId/download-url')
  @RequirePermissions(PermissionKeys.storageDownload)
  getDownloadUrl(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param('fileId') fileId: string,
  ) {
    return this.assets.createWorkspaceDownloadUrl(tenant, fileId);
  }

  @Get('storage/usage')
  @RequirePermissions(PermissionKeys.storageView)
  usage(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext) {
    return this.assets.storageUsage(tenant);
  }

  @Get('storage/retention-policy')
  @RequirePermissions(PermissionKeys.storageView)
  retentionPolicy(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext) {
    return this.assets.getRetentionPolicy(tenant);
  }

  @Patch('storage/retention-policy')
  @RequirePermissions(PermissionKeys.storageManage)
  updateRetentionPolicy(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Body() dto: StorageRetentionPolicyUpdateDto,
  ) {
    return this.assets.updateRetentionPolicy(tenant, dto);
  }
}
