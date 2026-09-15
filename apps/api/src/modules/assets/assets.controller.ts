import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { TenantContext } from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionGuard } from '../../common/authorization/permission.guard';
import { PermissionKeys } from '../../common/authorization/permissions';
import { RequirePermissions } from '../../common/authorization/require-permissions.decorator';
import { ReqContext } from '../../common/decorators/request-context.decorator';
import type { RequestContext } from '@zea-play/types';
import { CurrentTenant, ORGANIZATION_HEADER } from '../../common/tenant/tenant-context.decorator';
import { TenantContextGuard } from '../../common/tenant/tenant-context.guard';
import { AssetsService } from './assets.service';
import { AssetQueryDto } from './dto/asset-query.dto';
import { ProjectAssetParamsDto } from './dto/project-asset-params.dto';
import { ProjectParamDto } from './dto/project-param.dto';
import { UploadCompleteDto } from './dto/upload-complete.dto';
import { UploadInitDto } from './dto/upload-init.dto';

@ApiTags('assets')
@ApiBearerAuth()
@ApiHeader({ name: ORGANIZATION_HEADER, required: true })
@UseGuards(JwtAuthGuard, TenantContextGuard, PermissionGuard)
@Controller('projects/:projectId/assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Post('upload-init')
  @RequirePermissions(PermissionKeys.assetCreate)
  initUpload(
    @CurrentTenant() tenant: TenantContext,
    @Param() params: ProjectParamDto,
    @Body() dto: UploadInitDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.assets.initUpload(tenant, params.projectId, dto, context.correlationId);
  }

  @Post(':assetId/upload-complete')
  @RequirePermissions(PermissionKeys.assetCreate)
  completeUpload(
    @CurrentTenant() tenant: TenantContext,
    @Param() params: ProjectAssetParamsDto,
    @Body() dto: UploadCompleteDto,
    @ReqContext() context: RequestContext,
  ) {
    return this.assets.completeUpload(
      tenant,
      params.projectId,
      params.assetId,
      dto,
      context.correlationId,
    );
  }

  @Get()
  @RequirePermissions(PermissionKeys.assetRead)
  list(
    @CurrentTenant() tenant: TenantContext,
    @Param() params: ProjectParamDto,
    @Query() query: AssetQueryDto,
  ) {
    return this.assets.list(tenant, params.projectId, query);
  }

  @Get(':assetId')
  @RequirePermissions(PermissionKeys.assetRead)
  get(@CurrentTenant() tenant: TenantContext, @Param() params: ProjectAssetParamsDto) {
    return this.assets.get(tenant, params.projectId, params.assetId);
  }

  @Get(':assetId/download')
  @RequirePermissions(PermissionKeys.assetDownload)
  download(@CurrentTenant() tenant: TenantContext, @Param() params: ProjectAssetParamsDto) {
    return this.assets.download(tenant, params.projectId, params.assetId);
  }

  @Delete(':assetId')
  @RequirePermissions(PermissionKeys.assetDelete)
  remove(@CurrentTenant() tenant: TenantContext, @Param() params: ProjectAssetParamsDto) {
    return this.assets.remove(tenant, params.projectId, params.assetId);
  }
}
