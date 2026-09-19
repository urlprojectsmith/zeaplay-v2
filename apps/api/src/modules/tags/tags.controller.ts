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
import { CreateTagDto, TagParamsDto, TagQueryDto, UpdateTagDto } from './dto/tag.dto';
import { TagsService } from './tags.service';

@ApiTags('workspace tags')
@ApiBearerAuth()
@ApiHeader({ name: AGENCY_HEADER, required: true })
@ApiHeader({ name: WORKSPACE_HEADER, required: true })
@UseGuards(JwtAuthGuard, WorkspaceTenantGuard, PermissionGuard)
@Controller('workspaces/:workspaceId/tags')
export class TagsController {
  constructor(private readonly tags: TagsService) {}

  @Get()
  @RequirePermissions(PermissionKeys.tagsView)
  list(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext, @Query() query: TagQueryDto) {
    return this.tags.list(tenant, query);
  }

  @Post()
  @RequirePermissions(PermissionKeys.tagsCreate)
  create(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext, @Body() dto: CreateTagDto) {
    return this.tags.create(tenant, dto);
  }

  @Get(':tagId')
  @RequirePermissions(PermissionKeys.tagsView)
  get(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext, @Param() params: TagParamsDto) {
    return this.tags.get(tenant, params.tagId);
  }

  @Patch(':tagId')
  @RequirePermissions(PermissionKeys.tagsUpdate)
  update(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TagParamsDto,
    @Body() dto: UpdateTagDto,
  ) {
    return this.tags.update(tenant, params.tagId, dto);
  }

  @Post(':tagId/archive')
  @RequirePermissions(PermissionKeys.tagsArchive)
  archive(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext, @Param() params: TagParamsDto) {
    return this.tags.archive(tenant, params.tagId);
  }

  @Post(':tagId/reactivate')
  @RequirePermissions(PermissionKeys.tagsArchive)
  reactivate(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: TagParamsDto,
  ) {
    return this.tags.reactivate(tenant, params.tagId);
  }
}
