import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AssetLifecycle,
  AssetStatus,
  DocAccessRole,
  DocCommentStatus,
  DocShareStatus,
  DocStatus,
  DocType,
  DocVisibility,
  MembershipStatus,
  NotificationCategory,
  NotificationEntityType,
  NotificationPriority,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type {
  AgencyTenantContext,
  SuperAgencyTenantContext,
  WorkspaceTenantContext,
} from '../../common/auth/auth.types';
import { PasswordService } from '../../common/auth/password.service';
import type { StorageAdapter } from '../../infrastructure/storage/storage-adapter';
import { STORAGE_ADAPTER } from '../../infrastructure/storage/storage.tokens';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  AttachAssetDto,
  CreateCommentDto,
  CreateDocDto,
  CreateDocFromTemplateDto,
  CreateFolderDto,
  CreateShareDto,
  DocListQueryDto,
  FavoriteDto,
  ParentDocsQueryDto,
  ReplaceDocAccessDto,
  UpdateCommentDto,
  UpdateDocDto,
  UpdateFolderDto,
} from './dto/docs.dto';

const DOC_CONTENT_MAX_BYTES = 768 * 1024;
const DOC_TREE_MAX_DEPTH = 8;
const DOC_VERSION_SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000;
const PUBLIC_SHARE_ACCESS_TTL_MS = 15 * 60 * 1000;
const SHARE_PASSWORD_WINDOW_MS = 10 * 60 * 1000;
const SHARE_PASSWORD_MAX_ATTEMPTS = 8;
const SHARE_TOKEN_BYTES = 32;
const DOWNLOAD_TTL_SECONDS = 900;
const passwordAttempts = new Map<string, { count: number; resetAt: number }>();

type Db = PrismaService | Prisma.TransactionClient;
type ParentScope =
  { kind: 'AGENCY'; agencyId: string } | { kind: 'SUPER_AGENCY'; superAgencyId: string };

@Injectable()
export class DocsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly passwords: PasswordService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
  ) {}

  async listDocs(tenant: WorkspaceTenantContext, query: DocListQueryDto) {
    const membershipId = requireWorkspaceMembership(tenant);
    const where: Prisma.DocWhereInput = {
      workspaceId: tenant.workspaceId,
      status: query.status,
      ...(query.type ? { type: query.type } : {}),
      ...(query.folderId ? { folderId: query.folderId } : {}),
      ...(query.parentDocId ? { parentDocId: query.parentDocId } : {}),
      ...(query.search?.trim()
        ? { title: { contains: query.search.trim(), mode: Prisma.QueryMode.insensitive } }
        : {}),
      OR: [
        { visibility: DocVisibility.WORKSPACE },
        { createdByMembershipId: membershipId },
        { accessList: { some: { membershipId } } },
      ],
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.doc.findMany({
        where,
        select: docListSelect(membershipId),
        orderBy: [{ sortOrder: 'asc' }, { updatedAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.doc.count({ where }),
    ]);
    return {
      items: items.map(serializeDocListItem),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async listFolders(tenant: WorkspaceTenantContext) {
    requireWorkspaceMembership(tenant);
    return this.prisma.docFolder.findMany({
      where: { workspaceId: tenant.workspaceId, archivedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async createFolder(tenant: WorkspaceTenantContext, dto: CreateFolderDto) {
    const membershipId = requireWorkspaceMembership(tenant);
    await this.assertFolderParent(tenant.workspaceId, dto.parentFolderId ?? null);
    const folder = await this.prisma.docFolder.create({
      data: {
        workspaceId: tenant.workspaceId,
        parentFolderId: dto.parentFolderId ?? null,
        name: normalizeTitle(dto.name, 160),
        createdByMembershipId: membershipId,
      },
    });
    await this.audit.record({
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'doc.folder_create',
      entityType: 'DocFolder',
      entityId: folder.id,
    });
    return folder;
  }

  async updateFolder(tenant: WorkspaceTenantContext, folderId: string, dto: UpdateFolderDto) {
    const membershipId = requireWorkspaceMembership(tenant);
    const folder = await this.prisma.docFolder.findFirst({
      where: { id: folderId, workspaceId: tenant.workspaceId, archivedAt: null },
    });
    if (!folder) throw new NotFoundException('DOC_FOLDER_NOT_FOUND');
    if (dto.parentFolderId === folderId) throw new BadRequestException('DOC_TREE_CYCLE');
    await this.assertFolderParent(tenant.workspaceId, dto.parentFolderId ?? null, folderId);
    return this.prisma.docFolder.update({
      where: { id_workspaceId: { id: folderId, workspaceId: tenant.workspaceId } },
      data: {
        name: normalizeTitle(dto.name, 160),
        parentFolderId: dto.parentFolderId ?? null,
        updatedByMembershipId: membershipId,
      },
    });
  }

  async archiveFolder(tenant: WorkspaceTenantContext, folderId: string) {
    requireWorkspaceMembership(tenant);
    return this.prisma.docFolder.update({
      where: { id_workspaceId: { id: folderId, workspaceId: tenant.workspaceId } },
      data: { archivedAt: new Date() },
    });
  }

  async createDoc(tenant: WorkspaceTenantContext, dto: CreateDocDto) {
    const membershipId = requireWorkspaceMembership(tenant);
    const content = validateContent(dto.content);
    await this.assertFolderParent(tenant.workspaceId, dto.folderId ?? null);
    await this.assertDocParent(tenant.workspaceId, dto.parentDocId ?? null);
    const access = await this.normalizeAccess(tenant.workspaceId, dto.access ?? [], membershipId);
    const doc = await this.prisma.$transaction(async (tx) => {
      const created = await tx.doc.create({
        data: {
          workspaceId: tenant.workspaceId,
          folderId: dto.folderId ?? null,
          parentDocId: dto.parentDocId ?? null,
          title: normalizeTitle(dto.title, 220),
          content,
          visibility: dto.visibility,
          type: dto.type,
          sortOrder: dto.sortOrder ?? 0,
          createdByMembershipId: membershipId,
          updatedByMembershipId: membershipId,
          lastSnapshotAt: new Date(),
          accessList: access.length
            ? {
                create: access.map((item) => ({
                  workspaceId: tenant.workspaceId,
                  membershipId: item.membershipId,
                  role: item.role,
                  grantedByMembershipId: membershipId,
                })),
              }
            : undefined,
        },
        select: docDetailSelect(membershipId),
      });
      await tx.docVersion.create({
        data: {
          workspaceId: tenant.workspaceId,
          docId: created.id,
          revision: created.contentRevision,
          titleSnapshot: created.title,
          contentSnapshot: toInputJson(created.content),
          source: 'CREATE',
          createdByMembershipId: membershipId,
        },
      });
      await this.recordMentions(tx, tenant.workspaceId, created.id, null, membershipId, content);
      return created;
    });
    await this.audit.record({
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'doc.create',
      entityType: 'Doc',
      entityId: doc.id,
      metadata: { visibility: doc.visibility, type: doc.type },
    });
    return serializeDocDetail(doc);
  }

  async createFromTemplate(tenant: WorkspaceTenantContext, dto: CreateDocFromTemplateDto) {
    const membershipId = requireWorkspaceMembership(tenant);
    const template = await this.loadAuthorizedDoc(tenant, dto.templateId, 'read', {
      id: true,
      title: true,
      content: true,
      type: true,
    });
    if (template.type !== DocType.TEMPLATE) throw new BadRequestException('DOC_TEMPLATE_REQUIRED');
    return this.createDoc(tenant, {
      title: dto.title ?? template.title,
      content: template.content as Record<string, unknown>,
      folderId: dto.folderId ?? null,
      visibility: DocVisibility.PRIVATE,
      type: DocType.PAGE,
      access: [{ membershipId, role: DocAccessRole.EDITOR }],
    });
  }

  async getDoc(tenant: WorkspaceTenantContext, docId: string) {
    const membershipId = requireWorkspaceMembership(tenant);
    const doc = await this.loadAuthorizedDoc(tenant, docId, 'read', docDetailSelect(membershipId));
    return serializeDocDetail(doc);
  }

  async updateDoc(tenant: WorkspaceTenantContext, docId: string, dto: UpdateDocDto) {
    const membershipId = requireWorkspaceMembership(tenant);
    const content = dto.content ? validateContent(dto.content) : undefined;
    const updated = await this.prisma.$transaction(async (tx) => {
      const existing = await this.loadAuthorizedDoc(
        tenant,
        docId,
        'edit',
        {
          id: true,
          workspaceId: true,
          title: true,
          content: true,
          contentRevision: true,
          status: true,
          visibility: true,
          type: true,
          createdByMembershipId: true,
          lastSnapshotAt: true,
        },
        tx,
      );
      if (existing.status === DocStatus.ARCHIVED) throw new ConflictException('DOC_ARCHIVED');
      if (existing.contentRevision !== dto.expectedRevision) {
        throw new ConflictException({
          code: 'DOC_VERSION_CONFLICT',
          message: 'Document has a newer revision.',
          currentRevision: existing.contentRevision,
        });
      }
      if (dto.folderId !== undefined)
        await this.assertFolderParent(tenant.workspaceId, dto.folderId, undefined, tx);
      if (dto.parentDocId !== undefined) {
        await this.assertDocParent(tenant.workspaceId, dto.parentDocId, docId, tx);
      }
      const nextRevision = existing.contentRevision + 1;
      const snapshotDue =
        !existing.lastSnapshotAt ||
        Date.now() - existing.lastSnapshotAt.getTime() >= DOC_VERSION_SNAPSHOT_INTERVAL_MS;
      if (snapshotDue) {
        await tx.docVersion
          .create({
            data: {
              workspaceId: tenant.workspaceId,
              docId,
              revision: existing.contentRevision,
              titleSnapshot: existing.title,
              contentSnapshot: toInputJson(existing.content),
              source: 'AUTOSAVE_INTERVAL',
              createdByMembershipId: membershipId,
            },
          })
          .catch(ignoreDuplicateVersion);
      }
      const doc = await tx.doc.update({
        where: { id_workspaceId: { id: docId, workspaceId: tenant.workspaceId } },
        data: {
          ...(dto.title !== undefined ? { title: normalizeTitle(dto.title, 220) } : {}),
          ...(content !== undefined ? { content } : {}),
          ...(dto.visibility !== undefined ? { visibility: dto.visibility } : {}),
          ...(dto.folderId !== undefined ? { folderId: dto.folderId } : {}),
          ...(dto.parentDocId !== undefined ? { parentDocId: dto.parentDocId } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
          contentRevision: nextRevision,
          updatedByMembershipId: membershipId,
          lastSnapshotAt: snapshotDue ? new Date() : existing.lastSnapshotAt,
        },
        select: docDetailSelect(membershipId),
      });
      if (content !== undefined) {
        await this.recordMentions(tx, tenant.workspaceId, docId, null, membershipId, content);
      }
      return doc;
    });
    return serializeDocDetail(updated);
  }

  async replaceAccess(tenant: WorkspaceTenantContext, docId: string, dto: ReplaceDocAccessDto) {
    const membershipId = requireWorkspaceMembership(tenant);
    await this.loadAuthorizedDoc(tenant, docId, 'share');
    const access = await this.normalizeAccess(tenant.workspaceId, dto.members, membershipId);
    await this.prisma.$transaction([
      this.prisma.docAccess.deleteMany({ where: { workspaceId: tenant.workspaceId, docId } }),
      this.prisma.docAccess.createMany({
        data: access.map((item) => ({
          workspaceId: tenant.workspaceId,
          docId,
          membershipId: item.membershipId,
          role: item.role,
          grantedByMembershipId: membershipId,
        })),
        skipDuplicates: true,
      }),
    ]);
    await this.audit.record({
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'doc.access_replace',
      entityType: 'Doc',
      entityId: docId,
      metadata: { memberCount: access.length },
    });
    return this.getDoc(tenant, docId);
  }

  async archiveDoc(tenant: WorkspaceTenantContext, docId: string) {
    const membershipId = requireWorkspaceMembership(tenant);
    await this.loadAuthorizedDoc(tenant, docId, 'edit');
    const doc = await this.prisma.doc.update({
      where: { id_workspaceId: { id: docId, workspaceId: tenant.workspaceId } },
      data: {
        status: DocStatus.ARCHIVED,
        archivedAt: new Date(),
        archivedByMembershipId: membershipId,
      },
      select: docDetailSelect(membershipId),
    });
    await this.audit.record({
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'doc.archive',
      entityType: 'Doc',
      entityId: docId,
    });
    return serializeDocDetail(doc);
  }

  async restoreDoc(tenant: WorkspaceTenantContext, docId: string) {
    const membershipId = requireWorkspaceMembership(tenant);
    await this.loadAuthorizedDoc(tenant, docId, 'edit');
    const doc = await this.prisma.doc.update({
      where: { id_workspaceId: { id: docId, workspaceId: tenant.workspaceId } },
      data: { status: DocStatus.ACTIVE, archivedAt: null, archivedByMembershipId: null },
      select: docDetailSelect(membershipId),
    });
    await this.audit.record({
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'doc.restore',
      entityType: 'Doc',
      entityId: docId,
    });
    return serializeDocDetail(doc);
  }

  async setFavorite(tenant: WorkspaceTenantContext, docId: string, dto: FavoriteDto) {
    const membershipId = requireWorkspaceMembership(tenant);
    await this.loadAuthorizedDoc(tenant, docId, 'read');
    if (dto.favorite) {
      await this.prisma.docFavorite.upsert({
        where: { membershipId_docId: { membershipId, docId } },
        create: { workspaceId: tenant.workspaceId, membershipId, docId },
        update: {},
      });
    } else {
      await this.prisma.docFavorite
        .delete({ where: { membershipId_docId: { membershipId, docId } } })
        .catch(ignoreNotFound);
    }
    return { favorite: dto.favorite };
  }

  async listVersions(tenant: WorkspaceTenantContext, docId: string) {
    await this.loadAuthorizedDoc(tenant, docId, 'version');
    return this.prisma.docVersion.findMany({
      where: { workspaceId: tenant.workspaceId, docId },
      select: {
        id: true,
        revision: true,
        titleSnapshot: true,
        source: true,
        createdAt: true,
        createdByMembership: {
          select: { id: true, user: { select: { id: true, name: true, email: true } } },
        },
      },
      orderBy: { revision: 'desc' },
      take: 100,
    });
  }

  async restoreVersion(tenant: WorkspaceTenantContext, docId: string, revision: number) {
    const membershipId = requireWorkspaceMembership(tenant);
    const restored = await this.prisma.$transaction(async (tx) => {
      const current = await this.loadAuthorizedDoc(
        tenant,
        docId,
        'restore',
        { id: true, title: true, content: true, contentRevision: true },
        tx,
      );
      const version = await tx.docVersion.findFirst({
        where: { workspaceId: tenant.workspaceId, docId, revision },
      });
      if (!version) throw new NotFoundException('DOC_VERSION_NOT_FOUND');
      await tx.docVersion
        .create({
          data: {
            workspaceId: tenant.workspaceId,
            docId,
            revision: current.contentRevision,
            titleSnapshot: current.title,
            contentSnapshot: toInputJson(current.content),
            source: 'BEFORE_RESTORE',
            createdByMembershipId: membershipId,
          },
        })
        .catch(ignoreDuplicateVersion);
      return tx.doc.update({
        where: { id_workspaceId: { id: docId, workspaceId: tenant.workspaceId } },
        data: {
          title: version.titleSnapshot,
          content: toInputJson(version.contentSnapshot),
          contentRevision: current.contentRevision + 1,
          updatedByMembershipId: membershipId,
          lastSnapshotAt: new Date(),
        },
        select: docDetailSelect(membershipId),
      });
    });
    await this.audit.record({
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'doc.version_restore',
      entityType: 'Doc',
      entityId: docId,
      metadata: { restoredRevision: revision },
    });
    return serializeDocDetail(restored);
  }

  async listComments(tenant: WorkspaceTenantContext, docId: string) {
    await this.loadAuthorizedDoc(tenant, docId, 'read');
    return this.prisma.docComment.findMany({
      where: { workspaceId: tenant.workspaceId, docId, status: { not: DocCommentStatus.ARCHIVED } },
      select: commentSelect,
      orderBy: { createdAt: 'asc' },
    });
  }

  async createComment(tenant: WorkspaceTenantContext, docId: string, dto: CreateCommentDto) {
    const membershipId = requireWorkspaceMembership(tenant);
    await this.loadAuthorizedDoc(tenant, docId, 'comment');
    const mentions = [...new Set(dto.mentionMembershipIds ?? [])];
    await this.assertMentionTargets(tenant.workspaceId, mentions);
    const comment = await this.prisma.$transaction(async (tx) => {
      if (dto.parentCommentId) {
        const parent = await tx.docComment.findFirst({
          where: { id: dto.parentCommentId, workspaceId: tenant.workspaceId, docId },
          select: { id: true },
        });
        if (!parent) throw new BadRequestException('DOC_COMMENT_PARENT_INVALID');
      }
      const created = await tx.docComment.create({
        data: {
          workspaceId: tenant.workspaceId,
          docId,
          parentCommentId: dto.parentCommentId ?? null,
          body: dto.body.trim(),
          anchor: dto.anchor ? validateSmallJson(dto.anchor, 3000) : Prisma.JsonNull,
          createdByMembershipId: membershipId,
        },
        select: commentSelect,
      });
      for (const target of mentions) {
        await this.recordMentionTarget(
          tx,
          tenant.workspaceId,
          docId,
          created.id,
          membershipId,
          target,
          'COMMENT',
        );
      }
      return created;
    });
    return comment;
  }

  async updateComment(
    tenant: WorkspaceTenantContext,
    docId: string,
    commentId: string,
    dto: UpdateCommentDto,
  ) {
    const membershipId = requireWorkspaceMembership(tenant);
    const comment = await this.prisma.docComment.findFirst({
      where: { id: commentId, workspaceId: tenant.workspaceId, docId },
      select: { createdByMembershipId: true },
    });
    if (!comment) throw new NotFoundException('DOC_COMMENT_NOT_FOUND');
    if (
      comment.createdByMembershipId !== membershipId &&
      !tenant.permissions.includes('docs.comments.moderate')
    ) {
      throw new ForbiddenException('DOC_ACCESS_DENIED');
    }
    return this.prisma.docComment.update({
      where: { id_workspaceId: { id: commentId, workspaceId: tenant.workspaceId } },
      data: { body: dto.body.trim(), updatedByMembershipId: membershipId },
      select: commentSelect,
    });
  }

  async resolveComment(
    tenant: WorkspaceTenantContext,
    docId: string,
    commentId: string,
    resolved: boolean,
  ) {
    requireWorkspaceMembership(tenant);
    await this.loadAuthorizedDoc(tenant, docId, 'comment');
    return this.prisma.docComment.update({
      where: { id_workspaceId: { id: commentId, workspaceId: tenant.workspaceId } },
      data: { status: resolved ? 'RESOLVED' : 'ACTIVE', resolvedAt: resolved ? new Date() : null },
      select: commentSelect,
    });
  }

  async attachAsset(tenant: WorkspaceTenantContext, docId: string, dto: AttachAssetDto) {
    const membershipId = requireWorkspaceMembership(tenant);
    await this.loadAuthorizedDoc(tenant, docId, 'edit');
    const asset = await this.prisma.asset.findFirst({
      where: {
        id: dto.assetId,
        workspaceId: tenant.workspaceId,
        status: AssetStatus.READY,
        lifecycle: { in: [AssetLifecycle.ACTIVE, AssetLifecycle.ARCHIVED] },
      },
      select: { id: true },
    });
    if (!asset) throw new NotFoundException('DOC_ATTACHMENT_NOT_FOUND');
    return this.prisma.docAttachment.upsert({
      where: { docId_assetId: { docId, assetId: dto.assetId } },
      create: {
        workspaceId: tenant.workspaceId,
        docId,
        assetId: dto.assetId,
        linkedByMembershipId: membershipId,
      },
      update: {},
    });
  }

  async attachmentDownload(tenant: WorkspaceTenantContext, docId: string, attachmentId: string) {
    await this.loadAuthorizedDoc(tenant, docId, 'read');
    const attachment = await this.prisma.docAttachment.findFirst({
      where: { id: attachmentId, workspaceId: tenant.workspaceId, docId },
      select: {
        asset: {
          select: {
            storageKey: true,
            status: true,
            lifecycle: true,
          },
        },
      },
    });
    if (!attachment) throw new NotFoundException('DOC_ATTACHMENT_NOT_FOUND');
    if (
      attachment.asset.status !== AssetStatus.READY ||
      !isDownloadableAssetLifecycle(attachment.asset.lifecycle)
    ) {
      throw new ConflictException('DOC_ATTACHMENT_NOT_READY');
    }
    return {
      downloadUrl: await this.storage.createPresignedDownloadUrl(
        attachment.asset.storageKey,
        DOWNLOAD_TTL_SECONDS,
      ),
      expiresInSeconds: DOWNLOAD_TTL_SECONDS,
    };
  }

  async createShare(tenant: WorkspaceTenantContext, docId: string, dto: CreateShareDto) {
    const membershipId = requireWorkspaceMembership(tenant);
    await this.loadAuthorizedDoc(tenant, docId, 'share');
    const token = randomBytes(SHARE_TOKEN_BYTES).toString('base64url');
    const tokenHash = hashToken(token);
    const share = await this.prisma.docShare.create({
      data: {
        workspaceId: tenant.workspaceId,
        docId,
        tokenHash,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        passwordHash: dto.password ? this.passwords.hash(dto.password) : null,
        createdByMembershipId: membershipId,
      },
    });
    await this.audit.record({
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'doc.share_create',
      entityType: 'DocShare',
      entityId: share.id,
      metadata: {
        docId,
        expiresAt: share.expiresAt?.toISOString() ?? null,
        passwordProtected: Boolean(share.passwordHash),
      },
    });
    return { ...share, token, url: `/docs/share/${token}` };
  }

  async revokeShare(tenant: WorkspaceTenantContext, docId: string, shareId: string) {
    await this.loadAuthorizedDoc(tenant, docId, 'share');
    const share = await this.prisma.docShare.update({
      where: { id: shareId },
      data: { status: DocShareStatus.REVOKED, revokedAt: new Date() },
    });
    await this.audit.record({
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'doc.share_revoke',
      entityType: 'DocShare',
      entityId: share.id,
      metadata: { docId },
    });
    return share;
  }

  async regenerateShare(tenant: WorkspaceTenantContext, docId: string, shareId: string) {
    const old = await this.revokeShare(tenant, docId, shareId);
    const next = await this.createShare(tenant, docId, {
      expiresAt: old.expiresAt?.toISOString() ?? null,
    });
    await this.audit.record({
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'doc.share_regenerate',
      entityType: 'DocShare',
      entityId: next.id,
      metadata: { docId, previousShareId: shareId },
    });
    return next;
  }

  async publicShare(token: string, access?: string) {
    const share = await this.resolveShare(token);
    if (share.passwordHash && !verifyAccessGrant(access, share.tokenHash, share.passwordHash)) {
      throw new ForbiddenException('SHARE_PASSWORD_REQUIRED');
    }
    await this.prisma.docShare.update({
      where: { id: share.id },
      data: { lastAccessedAt: new Date() },
    });
    return publicDocPayload(share.doc);
  }

  async verifySharePassword(token: string, password: string) {
    const tokenHash = hashToken(token);
    throttleSharePassword(tokenHash);
    const share = await this.resolveShare(token);
    if (!share.passwordHash) return { access: createAccessGrant(share.tokenHash, null) };
    if (!this.passwords.verify(share.passwordHash, password)) {
      throw new ForbiddenException('SHARE_ACCESS_DENIED');
    }
    return { access: createAccessGrant(share.tokenHash, share.passwordHash) };
  }

  async publicAttachmentDownload(token: string, attachmentId: string, access?: string) {
    const share = await this.resolveShare(token);
    if (share.passwordHash && !verifyAccessGrant(access, share.tokenHash, share.passwordHash)) {
      throw new ForbiddenException('SHARE_PASSWORD_REQUIRED');
    }
    const attachment = share.doc.attachments.find((item) => item.id === attachmentId);
    if (!attachment) throw new NotFoundException('DOC_ATTACHMENT_NOT_FOUND');
    if (
      attachment.asset.status !== AssetStatus.READY ||
      !isDownloadableAssetLifecycle(attachment.asset.lifecycle)
    ) {
      throw new ConflictException('DOC_ATTACHMENT_NOT_READY');
    }
    return {
      downloadUrl: await this.storage.createPresignedDownloadUrl(
        attachment.asset.storageKey,
        DOWNLOAD_TTL_SECONDS,
      ),
      expiresInSeconds: DOWNLOAD_TTL_SECONDS,
    };
  }

  async listAgencyDocs(tenant: AgencyTenantContext, query: ParentDocsQueryDto) {
    return this.listParentDocs({ kind: 'AGENCY', agencyId: tenant.agencyId }, query);
  }

  async listSuperAgencyDocs(tenant: SuperAgencyTenantContext, query: ParentDocsQueryDto) {
    return this.listParentDocs(
      { kind: 'SUPER_AGENCY', superAgencyId: tenant.superAgencyId },
      query,
    );
  }

  private async listParentDocs(scope: ParentScope, query: ParentDocsQueryDto) {
    const where: Prisma.DocWhereInput = {
      status: DocStatus.ACTIVE,
      type: query.type ?? undefined,
      visibility: DocVisibility.WORKSPACE,
      workspace: parentWorkspaceFence(scope, query),
      ...(query.search?.trim()
        ? { title: { contains: query.search.trim(), mode: Prisma.QueryMode.insensitive } }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.doc.findMany({
        where,
        select: parentDocSelect,
        orderBy: { updatedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.doc.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  private async resolveShare(token: string) {
    const tokenHash = hashToken(token);
    const share = await this.prisma.docShare.findUnique({
      where: { tokenHash },
      select: publicShareSelect,
    });
    if (!share || share.status !== DocShareStatus.ACTIVE || share.revokedAt) {
      throw new NotFoundException('SHARE_NOT_FOUND');
    }
    if (share.expiresAt && share.expiresAt.getTime() <= Date.now()) {
      throw new GoneException('SHARE_EXPIRED');
    }
    if (share.doc.status !== DocStatus.ACTIVE) throw new GoneException('DOC_ARCHIVED');
    return share;
  }

  private async loadAuthorizedDoc<T extends Prisma.DocSelect>(
    tenant: WorkspaceTenantContext,
    docId: string,
    action: 'read' | 'edit' | 'share' | 'version' | 'restore' | 'comment',
    select?: T,
    db: Db = this.prisma,
  ) {
    const membershipId = requireWorkspaceMembership(tenant);
    const authDoc = await db.doc.findFirst({
      where: { id: docId, workspaceId: tenant.workspaceId },
      select: {
        id: true,
        visibility: true,
        createdByMembershipId: true,
        accessList: { select: { membershipId: true, role: true } },
      },
    });
    if (!authDoc) throw new NotFoundException('DOC_NOT_FOUND');
    if (!canAccessDoc(authDoc, membershipId, action, tenant.permissions)) {
      throw new NotFoundException('DOC_NOT_FOUND');
    }
    if (!select) {
      return authDoc as Prisma.DocGetPayload<{ select: T }>;
    }
    const doc = await db.doc.findFirst({
      where: { id: docId, workspaceId: tenant.workspaceId },
      select,
    });
    if (!doc) throw new NotFoundException('DOC_NOT_FOUND');
    return doc as Prisma.DocGetPayload<{ select: T }>;
  }

  private async assertFolderParent(
    workspaceId: string,
    parentFolderId: string | null | undefined,
    movingFolderId?: string,
    db: Db = this.prisma,
  ) {
    if (!parentFolderId) return;
    if (parentFolderId === movingFolderId) throw new BadRequestException('DOC_TREE_CYCLE');
    let current: string | null = parentFolderId;
    for (let depth = 0; current; depth += 1) {
      if (depth >= DOC_TREE_MAX_DEPTH) throw new BadRequestException('DOC_TREE_DEPTH_EXCEEDED');
      const folder: { id: string; parentFolderId: string | null } | null =
        await db.docFolder.findFirst({
          where: { id: current, workspaceId, archivedAt: null },
          select: { id: true, parentFolderId: true },
        });
      if (!folder) throw new BadRequestException('DOC_FOLDER_PARENT_INVALID');
      if (folder.parentFolderId === movingFolderId) throw new BadRequestException('DOC_TREE_CYCLE');
      current = folder.parentFolderId;
    }
  }

  private async assertDocParent(
    workspaceId: string,
    parentDocId: string | null | undefined,
    movingDocId?: string,
    db: Db = this.prisma,
  ) {
    if (!parentDocId) return;
    if (parentDocId === movingDocId) throw new BadRequestException('DOC_TREE_CYCLE');
    let current: string | null = parentDocId;
    for (let depth = 0; current; depth += 1) {
      if (depth >= DOC_TREE_MAX_DEPTH) throw new BadRequestException('DOC_TREE_DEPTH_EXCEEDED');
      const doc: { id: string; parentDocId: string | null } | null = await db.doc.findFirst({
        where: { id: current, workspaceId },
        select: { id: true, parentDocId: true },
      });
      if (!doc) throw new BadRequestException('DOC_PARENT_INVALID');
      if (doc.parentDocId === movingDocId) throw new BadRequestException('DOC_TREE_CYCLE');
      current = doc.parentDocId;
    }
  }

  private async normalizeAccess(
    workspaceId: string,
    access: Array<{ membershipId: string; role?: DocAccessRole }>,
    actorMembershipId: string,
  ) {
    const ids = [...new Set([...access.map((item) => item.membershipId), actorMembershipId])];
    await this.assertMentionTargets(workspaceId, ids);
    return ids.map((membershipId) => ({
      membershipId,
      role:
        membershipId === actorMembershipId
          ? DocAccessRole.EDITOR
          : (access.find((item) => item.membershipId === membershipId)?.role ??
            DocAccessRole.VIEWER),
    }));
  }

  private async assertMentionTargets(workspaceId: string, membershipIds: string[]) {
    if (!membershipIds.length) return;
    const count = await this.prisma.workspaceMembership.count({
      where: { workspaceId, id: { in: membershipIds }, status: MembershipStatus.ACTIVE },
    });
    if (count !== new Set(membershipIds).size)
      throw new BadRequestException('DOC_MENTION_TARGET_INVALID');
  }

  private async recordMentions(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    docId: string,
    commentId: string | null,
    actorMembershipId: string,
    content: unknown,
  ) {
    const targets = extractMentionTargets(content);
    await this.assertMentionTargets(workspaceId, targets);
    for (const target of targets) {
      await this.recordMentionTarget(
        tx,
        workspaceId,
        docId,
        commentId,
        actorMembershipId,
        target,
        'CONTENT',
      );
    }
  }

  private async recordMentionTarget(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    docId: string,
    commentId: string | null,
    actorMembershipId: string,
    targetMembershipId: string,
    source: 'CONTENT' | 'COMMENT',
  ) {
    if (targetMembershipId === actorMembershipId) return;
    const dedupeKey = `${source.toLowerCase()}:${docId}:${commentId ?? 'content'}:${targetMembershipId}`;
    await tx.docMention
      .create({
        data: {
          workspaceId,
          docId,
          commentId,
          targetMembershipId,
          createdByMembershipId: actorMembershipId,
          source,
          dedupeKey,
        },
      })
      .catch(ignoreDuplicate);
    await this.notifications.createNotification({
      tx,
      workspaceId,
      recipientMembershipId: targetMembershipId,
      actorMembershipId,
      category: NotificationCategory.DOCS,
      type:
        source === 'COMMENT'
          ? NotificationType.DOC_COMMENT_MENTIONED
          : NotificationType.DOC_MENTIONED,
      entityType:
        source === 'COMMENT' ? NotificationEntityType.DOC_COMMENT : NotificationEntityType.DOC,
      entityId: commentId ?? docId,
      title: 'You were mentioned in a Doc',
      message: source === 'COMMENT' ? 'A comment mentioned you.' : 'A document mentioned you.',
      priority: NotificationPriority.NORMAL,
      dedupeKey,
      metadata: { docId, source },
    });
  }
}

const memberSelect = { id: true, user: { select: { id: true, name: true, email: true } } };

function docListSelect(membershipId: string) {
  return {
    id: true,
    workspaceId: true,
    folderId: true,
    parentDocId: true,
    title: true,
    contentRevision: true,
    visibility: true,
    type: true,
    status: true,
    sortOrder: true,
    archivedAt: true,
    createdAt: true,
    updatedAt: true,
    createdByMembershipId: true,
    createdByMembership: { select: memberSelect },
    favorites: { where: { membershipId }, select: { id: true }, take: 1 },
    _count: { select: { comments: true, attachments: true } },
  } satisfies Prisma.DocSelect;
}

function docDetailSelect(membershipId: string) {
  return {
    ...docListSelect(membershipId),
    content: true,
    updatedByMembership: { select: memberSelect },
    accessList: {
      select: { membershipId: true, role: true, membership: { select: memberSelect } },
    },
    attachments: {
      select: {
        id: true,
        createdAt: true,
        asset: {
          select: {
            id: true,
            displayName: true,
            mimeType: true,
            sizeBytes: true,
            status: true,
            lifecycle: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    },
    shares: {
      select: {
        id: true,
        status: true,
        expiresAt: true,
        revokedAt: true,
        lastAccessedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    },
  } satisfies Prisma.DocSelect;
}

const parentDocSelect = {
  id: true,
  workspaceId: true,
  title: true,
  content: true,
  contentRevision: true,
  type: true,
  visibility: true,
  status: true,
  updatedAt: true,
  createdByMembership: { select: memberSelect },
  workspace: {
    select: {
      id: true,
      name: true,
      slug: true,
      agency: { select: { id: true, name: true, slug: true, superAgencyId: true } },
    },
  },
  _count: { select: { attachments: true } },
} satisfies Prisma.DocSelect;

const commentSelect = {
  id: true,
  docId: true,
  parentCommentId: true,
  body: true,
  anchor: true,
  status: true,
  resolvedAt: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  createdByMembership: { select: memberSelect },
} satisfies Prisma.DocCommentSelect;

const publicShareSelect = {
  id: true,
  tokenHash: true,
  status: true,
  expiresAt: true,
  passwordHash: true,
  revokedAt: true,
  doc: {
    select: {
      id: true,
      title: true,
      content: true,
      contentRevision: true,
      status: true,
      updatedAt: true,
      attachments: {
        select: {
          id: true,
          asset: {
            select: {
              id: true,
              displayName: true,
              mimeType: true,
              sizeBytes: true,
              status: true,
              lifecycle: true,
              storageKey: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.DocShareSelect;

interface DocAuthShape {
  visibility?: DocVisibility;
  createdByMembershipId?: string;
  accessList?: Array<{ membershipId: string; role: DocAccessRole }>;
}

function canAccessDoc(
  doc: DocAuthShape,
  membershipId: string,
  action: 'read' | 'edit' | 'share' | 'version' | 'restore' | 'comment',
  permissions: string[],
) {
  if (!permissions.includes('docs.view') && action === 'read') return false;
  const isOwner = doc.createdByMembershipId === membershipId;
  const access = doc.accessList?.find((item) => item.membershipId === membershipId);
  if (action === 'read' || action === 'comment') {
    if (doc.visibility === DocVisibility.WORKSPACE && permissions.includes('docs.view'))
      return true;
    return Boolean(isOwner || access);
  }
  if (action === 'version')
    return (
      permissions.includes('docs.versions.view') &&
      Boolean(isOwner || access?.role === DocAccessRole.EDITOR)
    );
  if (action === 'restore')
    return (
      permissions.includes('docs.versions.restore') &&
      Boolean(isOwner || access?.role === DocAccessRole.EDITOR)
    );
  if (action === 'share')
    return (
      permissions.includes('docs.share.manage') &&
      Boolean(isOwner || access?.role === DocAccessRole.EDITOR)
    );
  return (
    permissions.includes('docs.edit') && Boolean(isOwner || access?.role === DocAccessRole.EDITOR)
  );
}

function serializeDocListItem(doc: Record<string, unknown>) {
  return {
    ...doc,
    favorite: Array.isArray(doc.favorites) && doc.favorites.length > 0,
    favorites: undefined,
  };
}

function serializeDocDetail(doc: Record<string, unknown>) {
  return serializeDocListItem(doc);
}

function publicDocPayload(doc: unknown) {
  const item = doc as {
    attachments: Array<{ asset: { storageKey?: string } }>;
    [key: string]: unknown;
  };
  return {
    ...item,
    attachments: item.attachments.map(({ asset, ...attachment }) => ({
      ...attachment,
      asset: { ...asset, storageKey: undefined },
    })),
  };
}

function requireWorkspaceMembership(tenant: WorkspaceTenantContext) {
  if (!tenant.workspaceMembershipId || tenant.accessSource !== 'WORKSPACE_MEMBERSHIP') {
    throw new ForbiddenException('WORKSPACE_MEMBERSHIP_REQUIRED');
  }
  return tenant.workspaceMembershipId;
}

function normalizeTitle(value: string, max: number) {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) throw new BadRequestException('DOC_TITLE_REQUIRED');
  return normalized.slice(0, max);
}

function validateContent(content: Record<string, unknown>) {
  const bytes = Buffer.byteLength(JSON.stringify(content), 'utf8');
  if (bytes > DOC_CONTENT_MAX_BYTES)
    throw new UnprocessableEntityException('DOC_CONTENT_TOO_LARGE');
  assertSafeContent(content);
  return content as Prisma.InputJsonValue;
}

function validateSmallJson(value: Record<string, unknown>, maxBytes: number) {
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
  if (bytes > maxBytes) throw new UnprocessableEntityException('DOC_METADATA_TOO_LARGE');
  assertSafeContent(value);
  return value as Prisma.InputJsonValue;
}

function toInputJson(value: Prisma.JsonValue): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

function isDownloadableAssetLifecycle(lifecycle: AssetLifecycle) {
  return lifecycle === AssetLifecycle.ACTIVE || lifecycle === AssetLifecycle.ARCHIVED;
}

function assertSafeContent(value: unknown, path: string[] = []) {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    if (/javascript:/i.test(value) || /<script/i.test(value) || /on\w+=/i.test(value)) {
      throw new UnprocessableEntityException('DOC_CONTENT_UNSAFE');
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeContent(item, [...path, String(index)]));
    return;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (/^on/i.test(key) || key === 'html' || key === 'script') {
        throw new UnprocessableEntityException('DOC_CONTENT_UNSAFE');
      }
      assertSafeContent(child, [...path, key]);
    }
    return;
  }
  throw new UnprocessableEntityException('DOC_CONTENT_UNSAFE');
}

function extractMentionTargets(value: unknown, output = new Set<string>()) {
  if (!value || typeof value !== 'object') return [...output];
  if (Array.isArray(value)) {
    value.forEach((item) => extractMentionTargets(item, output));
    return [...output];
  }
  const record = value as Record<string, unknown>;
  const attrs = record.attrs as Record<string, unknown> | undefined;
  const target = attrs?.membershipId ?? attrs?.id;
  if (record.type === 'mention' && typeof target === 'string') output.add(target);
  Object.values(record).forEach((item) => extractMentionTargets(item, output));
  return [...output];
}

function hashToken(token: string) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function createAccessGrant(tokenHash: string, passwordHash: string | null) {
  const expiresAt = Date.now() + PUBLIC_SHARE_ACCESS_TTL_MS;
  const body = `${tokenHash}.${passwordHash ?? 'none'}.${expiresAt}`;
  const signature = createHash('sha256').update(body).digest('hex');
  return Buffer.from(`${body}.${signature}`).toString('base64url');
}

function verifyAccessGrant(access: string | undefined, tokenHash: string, passwordHash: string) {
  if (!access) return false;
  try {
    const decoded = Buffer.from(access, 'base64url').toString('utf8');
    const [grantTokenHash, grantPasswordHash, expiresAtRaw, signature] = decoded.split('.');
    if (grantTokenHash !== tokenHash || grantPasswordHash !== passwordHash) return false;
    const expiresAt = Number(expiresAtRaw);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
    if (!signature) return false;
    const body = `${grantTokenHash}.${grantPasswordHash}.${expiresAtRaw}`;
    const expected = createHash('sha256').update(body).digest('hex');
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

function throttleSharePassword(key: string) {
  const now = Date.now();
  const current = passwordAttempts.get(key);
  if (!current || current.resetAt <= now) {
    passwordAttempts.set(key, { count: 1, resetAt: now + SHARE_PASSWORD_WINDOW_MS });
    return;
  }
  if (current.count >= SHARE_PASSWORD_MAX_ATTEMPTS) {
    throw new HttpException('SHARE_PASSWORD_RATE_LIMITED', HttpStatus.TOO_MANY_REQUESTS);
  }
  current.count += 1;
}

function parentWorkspaceFence(
  scope: ParentScope,
  query: { agencyId?: string; workspaceId?: string },
) {
  return {
    ...(query.workspaceId ? { id: query.workspaceId } : {}),
    ...(scope.kind === 'AGENCY'
      ? {
          agencyId: scope.agencyId,
          ...(query.agencyId && query.agencyId !== scope.agencyId
            ? { id: '00000000-0000-4000-8000-000000000000' }
            : {}),
        }
      : {
          ...(query.agencyId ? { agencyId: query.agencyId } : {}),
          agency: { superAgencyId: scope.superAgencyId },
        }),
  };
}

function ignoreDuplicate(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return;
  throw error;
}

function ignoreDuplicateVersion(error: unknown) {
  ignoreDuplicate(error);
}

function ignoreNotFound(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') return;
  throw error;
}
