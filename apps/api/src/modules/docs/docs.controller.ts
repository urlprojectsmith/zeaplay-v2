import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type {
  AgencyTenantContext,
  SuperAgencyTenantContext,
  WorkspaceTenantContext,
} from '../../common/auth/auth.types';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionGuard } from '../../common/authorization/permission.guard';
import { PermissionKeys } from '../../common/authorization/permissions';
import { RequirePermissions } from '../../common/authorization/require-permissions.decorator';
import {
  AGENCY_HEADER,
  CurrentAgencyTenant,
  CurrentSuperAgencyTenant,
  CurrentWorkspaceTenant,
  SUPER_AGENCY_HEADER,
  WORKSPACE_HEADER,
} from '../../common/tenant/tenant-context.decorator';
import {
  AgencyTenantGuard,
  SuperAgencyTenantGuard,
  WorkspaceTenantGuard,
} from '../../common/tenant/tenant-context.guard';
import {
  AttachAssetDto,
  AttachmentParamsDto,
  CommentParamsDto,
  CreateCommentDto,
  CreateDocDto,
  CreateDocFromTemplateDto,
  CreateFolderDto,
  CreateShareDto,
  DocListQueryDto,
  DocParamsDto,
  FavoriteDto,
  FolderParamsDto,
  ParentDocsQueryDto,
  PublicShareQueryDto,
  ReplaceDocAccessDto,
  ShareParamsDto,
  UpdateCommentDto,
  UpdateDocDto,
  UpdateFolderDto,
  VerifySharePasswordDto,
  VersionParamsDto,
} from './dto/docs.dto';
import { DocsService } from './docs.service';

@ApiTags('workspace docs')
@ApiBearerAuth()
@ApiHeader({ name: AGENCY_HEADER, required: true })
@ApiHeader({ name: WORKSPACE_HEADER, required: true })
@UseGuards(JwtAuthGuard, WorkspaceTenantGuard, PermissionGuard)
@Controller('workspaces/:workspaceId/docs')
export class WorkspaceDocsController {
  constructor(private readonly docs: DocsService) {}

  @Get()
  @RequirePermissions(PermissionKeys.docsView)
  list(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext, @Query() query: DocListQueryDto) {
    return this.docs.listDocs(tenant, query);
  }

  @Post()
  @RequirePermissions(PermissionKeys.docsCreate)
  create(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext, @Body() dto: CreateDocDto) {
    return this.docs.createDoc(tenant, dto);
  }

  @Post('from-template')
  @RequirePermissions(PermissionKeys.docsCreate)
  fromTemplate(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Body() dto: CreateDocFromTemplateDto,
  ) {
    return this.docs.createFromTemplate(tenant, dto);
  }

  @Get('folders')
  @RequirePermissions(PermissionKeys.docsView)
  folders(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext) {
    return this.docs.listFolders(tenant);
  }

  @Post('folders')
  @RequirePermissions(PermissionKeys.docsManage)
  createFolder(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Body() dto: CreateFolderDto,
  ) {
    return this.docs.createFolder(tenant, dto);
  }

  @Patch('folders/:folderId')
  @RequirePermissions(PermissionKeys.docsManage)
  updateFolder(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: FolderParamsDto,
    @Body() dto: UpdateFolderDto,
  ) {
    return this.docs.updateFolder(tenant, params.folderId, dto);
  }

  @Post('folders/:folderId/archive')
  @RequirePermissions(PermissionKeys.docsManage)
  archiveFolder(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: FolderParamsDto,
  ) {
    return this.docs.archiveFolder(tenant, params.folderId);
  }

  @Get(':docId')
  @RequirePermissions(PermissionKeys.docsView)
  get(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext, @Param() params: DocParamsDto) {
    return this.docs.getDoc(tenant, params.docId);
  }

  @Patch(':docId')
  @RequirePermissions(PermissionKeys.docsEdit)
  update(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: DocParamsDto,
    @Body() dto: UpdateDocDto,
  ) {
    return this.docs.updateDoc(tenant, params.docId, dto);
  }

  @Post(':docId/access')
  @RequirePermissions(PermissionKeys.docsShareManage)
  access(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: DocParamsDto,
    @Body() dto: ReplaceDocAccessDto,
  ) {
    return this.docs.replaceAccess(tenant, params.docId, dto);
  }

  @Post(':docId/archive')
  @RequirePermissions(PermissionKeys.docsEdit)
  archive(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext, @Param() params: DocParamsDto) {
    return this.docs.archiveDoc(tenant, params.docId);
  }

  @Post(':docId/restore')
  @RequirePermissions(PermissionKeys.docsEdit)
  restore(@CurrentWorkspaceTenant() tenant: WorkspaceTenantContext, @Param() params: DocParamsDto) {
    return this.docs.restoreDoc(tenant, params.docId);
  }

  @Post(':docId/favorite')
  @RequirePermissions(PermissionKeys.docsView)
  favorite(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: DocParamsDto,
    @Body() dto: FavoriteDto,
  ) {
    return this.docs.setFavorite(tenant, params.docId, dto);
  }

  @Get(':docId/versions')
  @RequirePermissions(PermissionKeys.docsVersionsView)
  versions(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: DocParamsDto,
  ) {
    return this.docs.listVersions(tenant, params.docId);
  }

  @Post(':docId/versions/:revision/restore')
  @RequirePermissions(PermissionKeys.docsVersionsRestore)
  restoreVersion(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: DocParamsDto & VersionParamsDto,
  ) {
    return this.docs.restoreVersion(tenant, params.docId, params.revision);
  }

  @Get(':docId/comments')
  @RequirePermissions(PermissionKeys.docsCommentsView)
  comments(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: DocParamsDto,
  ) {
    return this.docs.listComments(tenant, params.docId);
  }

  @Post(':docId/comments')
  @RequirePermissions(PermissionKeys.docsCommentsCreate)
  createComment(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: DocParamsDto,
    @Body() dto: CreateCommentDto,
  ) {
    return this.docs.createComment(tenant, params.docId, dto);
  }

  @Patch(':docId/comments/:commentId')
  @RequirePermissions(PermissionKeys.docsCommentsUpdateOwn)
  updateComment(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: DocParamsDto & CommentParamsDto,
    @Body() dto: UpdateCommentDto,
  ) {
    return this.docs.updateComment(tenant, params.docId, params.commentId, dto);
  }

  @Post(':docId/comments/:commentId/resolve')
  @RequirePermissions(PermissionKeys.docsCommentsCreate)
  resolveComment(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: DocParamsDto & CommentParamsDto,
  ) {
    return this.docs.resolveComment(tenant, params.docId, params.commentId, true);
  }

  @Post(':docId/comments/:commentId/reopen')
  @RequirePermissions(PermissionKeys.docsCommentsCreate)
  reopenComment(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: DocParamsDto & CommentParamsDto,
  ) {
    return this.docs.resolveComment(tenant, params.docId, params.commentId, false);
  }

  @Post(':docId/attachments')
  @RequirePermissions(PermissionKeys.docsEdit)
  attach(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: DocParamsDto,
    @Body() dto: AttachAssetDto,
  ) {
    return this.docs.attachAsset(tenant, params.docId, dto);
  }

  @Post(':docId/attachments/:attachmentId/download-url')
  @RequirePermissions(PermissionKeys.docsView)
  attachmentDownload(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: DocParamsDto & AttachmentParamsDto,
  ) {
    return this.docs.attachmentDownload(tenant, params.docId, params.attachmentId);
  }

  @Post(':docId/shares')
  @RequirePermissions(PermissionKeys.docsShareManage)
  createShare(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: DocParamsDto,
    @Body() dto: CreateShareDto,
  ) {
    return this.docs.createShare(tenant, params.docId, dto);
  }

  @Post(':docId/shares/:shareId/revoke')
  @RequirePermissions(PermissionKeys.docsShareManage)
  revokeShare(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: DocParamsDto & ShareParamsDto,
  ) {
    return this.docs.revokeShare(tenant, params.docId, params.shareId);
  }

  @Post(':docId/shares/:shareId/regenerate')
  @RequirePermissions(PermissionKeys.docsShareManage)
  regenerateShare(
    @CurrentWorkspaceTenant() tenant: WorkspaceTenantContext,
    @Param() params: DocParamsDto & ShareParamsDto,
  ) {
    return this.docs.regenerateShare(tenant, params.docId, params.shareId);
  }
}

@ApiTags('public docs')
@Controller('docs/share/:token')
export class PublicDocsController {
  constructor(private readonly docs: DocsService) {}

  @Get()
  get(@Param('token') token: string, @Query() query: PublicShareQueryDto) {
    return this.docs.publicShare(token, query.access);
  }

  @Post('password')
  password(@Param('token') token: string, @Body() dto: VerifySharePasswordDto) {
    return this.docs.verifySharePassword(token, dto.password);
  }

  @Post('attachments/:attachmentId/download-url')
  attachment(
    @Param('token') token: string,
    @Param() params: AttachmentParamsDto,
    @Query() query: PublicShareQueryDto,
  ) {
    return this.docs.publicAttachmentDownload(token, params.attachmentId, query.access);
  }
}

@ApiTags('agency docs oversight')
@ApiBearerAuth()
@ApiHeader({ name: AGENCY_HEADER, required: true })
@UseGuards(JwtAuthGuard, AgencyTenantGuard, PermissionGuard)
@Controller('agencies/:agencyId/parent/docs')
export class AgencyDocsOversightController {
  constructor(private readonly docs: DocsService) {}

  @Get()
  @RequirePermissions(PermissionKeys.docsParentRead)
  list(@CurrentAgencyTenant() tenant: AgencyTenantContext, @Query() query: ParentDocsQueryDto) {
    return this.docs.listAgencyDocs(tenant, query);
  }
}

@ApiTags('super agency docs oversight')
@ApiBearerAuth()
@ApiHeader({ name: SUPER_AGENCY_HEADER, required: true })
@UseGuards(JwtAuthGuard, SuperAgencyTenantGuard, PermissionGuard)
@Controller('super-agencies/:superAgencyId/parent/docs')
export class SuperAgencyDocsOversightController {
  constructor(private readonly docs: DocsService) {}

  @Get()
  @RequirePermissions(PermissionKeys.docsParentRead)
  list(
    @CurrentSuperAgencyTenant() tenant: SuperAgencyTenantContext,
    @Query() query: ParentDocsQueryDto,
  ) {
    return this.docs.listSuperAgencyDocs(tenant, query);
  }
}
