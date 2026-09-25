import {
  BadRequestException,
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnprocessableEntityException,
  Optional,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import {
  AssetLifecycle,
  AssetStatus,
  AttachmentType,
  MembershipStatus,
  Prisma,
  ProcessingJobStatus,
  ProjectStatus,
} from '@prisma/client';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { validateEnvironment } from '@zea-play/config';
import type { WorkspaceTenantContext } from '../../common/auth/auth.types';
import type { StorageAdapter } from '../../infrastructure/storage/storage-adapter';
import { STORAGE_ADAPTER } from '../../infrastructure/storage/storage.tokens';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BillingEntitlementService } from '../billing/billing-entitlement.service';
import {
  ASSET_PROCESSING_JOB_TYPE,
  ASSET_PROCESSING_QUEUE,
} from '../../infrastructure/queue/queue.constants';
import { UploadInitDto } from './dto/upload-init.dto';
import { UploadCompleteDto } from './dto/upload-complete.dto';
import { AssetQueryDto } from './dto/asset-query.dto';
import {
  StorageRetentionPolicyUpdateDto,
  WorkspaceFileBulkActionDto,
  WorkspaceFileCompleteDto,
  WorkspaceFileQueryDto,
  WorkspaceFileUploadInitDto,
} from './dto/workspace-file.dto';

const ASSET_JOB_VERSION = 1;
const STORAGE_PROVIDER_MINIO = 'MINIO';
const ACTIVE_STORAGE_STATUSES: AssetStatus[] = [
  AssetStatus.UPLOADED,
  AssetStatus.PROCESSING,
  AssetStatus.READY,
];
const QUOTA_COUNTING_LIFECYCLES: AssetLifecycle[] = [
  AssetLifecycle.ACTIVE,
  AssetLifecycle.ARCHIVED,
  AssetLifecycle.PENDING_DELETE,
  AssetLifecycle.PURGING,
];
const DOWNLOADABLE_LIFECYCLES: AssetLifecycle[] = [AssetLifecycle.ACTIVE, AssetLifecycle.ARCHIVED];
const PURGE_BATCH_SIZE = 100;
const MAX_PURGE_ATTEMPTS = 3;
const PURGE_RETRIES_EXHAUSTED = 'PURGE_RETRIES_EXHAUSTED';

@Injectable()
export class AssetsService {
  private readonly env = validateEnvironment(process.env);
  private readonly allowedMimeTypes = new Set(
    this.env.ALLOWED_MIME_TYPES.split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    @InjectQueue(ASSET_PROCESSING_QUEUE) private readonly queue: Queue,
    @Optional() private readonly billingEntitlements?: BillingEntitlementService,
  ) {}

  async initUpload(
    tenant: WorkspaceTenantContext,
    projectId: string,
    dto: UploadInitDto,
    correlationId: string,
  ) {
    await this.assertProject(tenant.workspaceId, projectId);
    const uploadedByMembershipId = await this.requireActiveWorkspaceMembership(tenant);
    const filename = sanitizeFilename(dto.filename);
    const displayName = sanitizeFilename(dto.displayName ?? filename);
    const mimeType = sanitizeMimeType(dto.mimeType);
    if (!this.allowedMimeTypes.has(mimeType)) {
      throw new UnprocessableEntityException('File type is not allowed.');
    }
    if (dto.sizeBytes > this.env.MAX_UPLOAD_BYTES) {
      throw new PayloadTooLargeException('File is too large.');
    }

    const assetId = randomUUID();
    const extension = extractExtension(filename);
    const storageKey = buildStorageKey(tenant.workspaceId, projectId, assetId, extension);
    const uploadExpiresAt = new Date(Date.now() + this.env.UPLOAD_URL_TTL_SECONDS * 1000);
    const sizeBytes = BigInt(dto.sizeBytes);
    const asset = await this.prisma.$transaction(async (tx) => {
      await this.assertQuotaAvailable(tx, tenant.workspaceId, sizeBytes);
      const asset = await tx.asset.create({
        data: {
          id: assetId,
          workspaceId: tenant.workspaceId,
          projectId,
          createdById: tenant.userId,
          uploadedByMembershipId,
          originalFilename: filename,
          displayName,
          storageBucket: this.env.MINIO_BUCKET,
          storageProvider: STORAGE_PROVIDER_MINIO,
          storageKey,
          mimeType,
          extension,
          sizeBytes,
          status: AssetStatus.UPLOADING,
          lifecycle: AssetLifecycle.ACTIVE,
          uploadExpiresAt,
          sourceModule: 'PROJECT',
          sourceEntityType: 'PROJECT',
          sourceEntityId: projectId,
          metadata: { correlationId },
        },
        select: assetSelect,
      });
      await tx.storageUploadReservation.create({
        data: {
          workspaceId: tenant.workspaceId,
          fileId: asset.id,
          membershipId: uploadedByMembershipId,
          reservedBytes: sizeBytes,
          expiresAt: uploadExpiresAt,
        },
      });
      await tx.attachment.create({
        data: {
          id: asset.id,
          workspaceId: tenant.workspaceId,
          type: AttachmentType.FILE,
          assetId: asset.id,
          displayName: asset.displayName,
          createdById: tenant.userId,
        },
      });
      await tx.projectAttachment.create({
        data: {
          workspaceId: tenant.workspaceId,
          projectId,
          attachmentId: asset.id,
          attachedById: tenant.userId,
        },
      });
      return asset;
    });

    const uploadUrl = await this.storage.createPresignedUploadUrl(
      storageKey,
      this.env.UPLOAD_URL_TTL_SECONDS,
    );
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'asset.upload_init',
      entityType: 'Asset',
      entityId: asset.id,
      metadata: { projectId, mimeType, sizeBytes: dto.sizeBytes },
    });
    return { asset: serializeAsset(asset), uploadUrl, expiresAt: uploadExpiresAt };
  }

  async initWorkspaceUpload(
    tenant: WorkspaceTenantContext,
    dto: WorkspaceFileUploadInitDto,
    correlationId: string,
  ) {
    const uploadedByMembershipId = await this.requireActiveWorkspaceMembership(tenant);
    const input = this.validateUploadInput(dto);
    const source = await this.resolveSourceMetadata(tenant.workspaceId, dto);
    const assetId = randomUUID();
    const storageKey = buildWorkspaceFileStorageKey(tenant.workspaceId, assetId);
    const uploadExpiresAt = new Date(Date.now() + this.env.UPLOAD_URL_TTL_SECONDS * 1000);
    const sizeBytes = BigInt(input.sizeBytes);

    const asset = await this.prisma.$transaction(async (tx) => {
      await this.assertQuotaAvailable(tx, tenant.workspaceId, sizeBytes);
      const created = await tx.asset.create({
        data: {
          id: assetId,
          workspaceId: tenant.workspaceId,
          projectId: null,
          createdById: tenant.userId,
          uploadedByMembershipId,
          originalFilename: input.filename,
          displayName: input.displayName,
          storageBucket: this.env.MINIO_BUCKET,
          storageProvider: STORAGE_PROVIDER_MINIO,
          storageKey,
          mimeType: input.mimeType,
          extension: input.extension,
          sizeBytes,
          status: AssetStatus.UPLOADING,
          lifecycle: AssetLifecycle.ACTIVE,
          uploadExpiresAt,
          sourceModule: source.sourceModule,
          sourceEntityType: source.sourceEntityType,
          sourceEntityId: source.sourceEntityId,
          metadata: { correlationId },
        },
        select: assetSelect,
      });
      await tx.storageUploadReservation.create({
        data: {
          workspaceId: tenant.workspaceId,
          fileId: created.id,
          membershipId: uploadedByMembershipId,
          reservedBytes: sizeBytes,
          expiresAt: uploadExpiresAt,
        },
      });
      return created;
    });

    const uploadUrl = await this.storage.createPresignedUploadUrl(
      storageKey,
      this.env.UPLOAD_URL_TTL_SECONDS,
    );
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'storage.upload_initiated',
      entityType: 'Asset',
      entityId: asset.id,
      metadata: { mimeType: input.mimeType, sizeBytes: input.sizeBytes },
    });
    return { file: serializeAsset(asset), uploadUrl, expiresAt: uploadExpiresAt };
  }

  async completeWorkspaceUpload(
    tenant: WorkspaceTenantContext,
    fileId: string,
    dto: WorkspaceFileCompleteDto,
    _correlationId: string,
  ) {
    await this.requireActiveWorkspaceMembership(tenant);
    const asset = await this.findWorkspaceFile(tenant.workspaceId, fileId);
    if (ACTIVE_STORAGE_STATUSES.includes(asset.status)) {
      return serializeAsset(asset);
    }
    if (asset.status !== AssetStatus.UPLOADING) {
      throw new ConflictException('UPLOAD_STATE_INVALID');
    }
    if (asset.uploadExpiresAt <= new Date()) {
      await this.releaseExpiredReservation(fileId);
      throw new GoneException('UPLOAD_RESERVATION_EXPIRED');
    }

    const object = await this.statOwnedObject(asset).catch(() => {
      throw new ServiceUnavailableException('UPLOAD_OBJECT_MISSING');
    });
    if (object.size !== dto.sizeBytes || BigInt(object.size) !== asset.sizeBytes) {
      throw new BadRequestException('UPLOAD_SIZE_MISMATCH');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await tx.asset.findUniqueOrThrow({
        where: { id_workspaceId: { id: fileId, workspaceId: tenant.workspaceId } },
        select: assetSelect,
      });
      if (ACTIVE_STORAGE_STATUSES.includes(current.status)) return current;
      const reservation = await tx.storageUploadReservation.findUnique({
        where: { fileId },
        select: { id: true, expiresAt: true, consumedAt: true, releasedAt: true },
      });
      if (!reservation || reservation.releasedAt || reservation.expiresAt <= new Date()) {
        throw new GoneException('UPLOAD_RESERVATION_EXPIRED');
      }
      if (!reservation.consumedAt) {
        await tx.storageUploadReservation.update({
          where: { id: reservation.id },
          data: { consumedAt: new Date() },
        });
      }
      return tx.asset.update({
        where: { id_workspaceId: { id: fileId, workspaceId: tenant.workspaceId } },
        data: {
          status: AssetStatus.READY,
          checksum: dto.checksum,
          metadata: {
            ...withoutUndefined({
              ...(isRecord(current.metadata) ? current.metadata : {}),
              etag: object.etag,
              uploadedContentType: object.contentType,
            }),
          },
        },
        select: assetSelect,
      });
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'storage.upload_completed',
      entityType: 'Asset',
      entityId: fileId,
      metadata: { sizeBytes: dto.sizeBytes },
    });
    return serializeAsset(updated);
  }

  async listWorkspaceFiles(tenant: WorkspaceTenantContext, query: WorkspaceFileQueryDto) {
    await this.requireActiveWorkspaceMembership(tenant);
    const pageSize = Math.min(query.pageSize, 100);
    if (query.uploader) await this.assertWorkspaceUploader(tenant.workspaceId, query.uploader);
    const createdRange = parseCreatedRange(query.createdFrom, query.createdTo);
    const where: Prisma.AssetWhereInput = {
      workspaceId: tenant.workspaceId,
      deletedAt: null,
      lifecycle: query.lifecycle ?? AssetLifecycle.ACTIVE,
      ...(query.status ? { status: query.status } : {}),
      ...(query.sourceModule ? { sourceModule: query.sourceModule } : {}),
      ...(query.sourceEntityType ? { sourceEntityType: query.sourceEntityType } : {}),
      ...(query.mimeType ? { mimeType: sanitizeMimeType(query.mimeType) } : {}),
      ...(query.category ? categoryWhere(query.category) : {}),
      ...(query.uploader ? { uploadedByMembershipId: query.uploader } : {}),
      ...(query.createdFrom || query.createdTo
        ? {
            createdAt: {
              ...(createdRange.from ? { gte: createdRange.from } : {}),
              ...(createdRange.to ? { lte: createdRange.to } : {}),
            },
          }
        : {}),
      ...(query.search?.trim()
        ? {
            OR: [
              {
                originalFilename: {
                  contains: query.search.trim(),
                  mode: Prisma.QueryMode.insensitive,
                },
              },
              {
                displayName: {
                  contains: query.search.trim(),
                  mode: Prisma.QueryMode.insensitive,
                },
              },
              {
                sourceEntityType: {
                  contains: query.search.trim(),
                  mode: Prisma.QueryMode.insensitive,
                },
              },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.asset.findMany({
        where,
        select: assetSelect,
        orderBy: workspaceFileOrderBy(query.sort),
        skip: (query.page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.asset.count({ where }),
    ]);
    return { items: items.map(serializeAsset), page: query.page, pageSize, total };
  }

  async bulkWorkspaceFileAction(tenant: WorkspaceTenantContext, dto: WorkspaceFileBulkActionDto) {
    await this.requireActiveWorkspaceMembership(tenant);
    const uniqueIds = Array.from(new Set(dto.fileIds));
    if (!uniqueIds.length) throw new BadRequestException('BULK_FILE_IDS_REQUIRED');
    if (uniqueIds.length > 50) throw new BadRequestException('BULK_FILE_LIMIT_EXCEEDED');
    const files = await this.prisma.asset.findMany({
      where: {
        workspaceId: tenant.workspaceId,
        id: { in: uniqueIds },
        deletedAt: null,
      },
      select: { id: true },
    });
    const visibleIds = new Set(files.map((file) => file.id));
    const results = [];
    for (const fileId of uniqueIds) {
      if (!visibleIds.has(fileId)) {
        results.push({ fileId, ok: false, code: 'FILE_NOT_FOUND' });
        continue;
      }
      try {
        const file =
          dto.action === 'ARCHIVE'
            ? await this.archiveWorkspaceFile(tenant, fileId)
            : dto.action === 'DELETE'
              ? await this.requestWorkspaceFileDelete(tenant, fileId)
              : await this.restoreWorkspaceFile(tenant, fileId);
        results.push({ fileId, ok: true, file });
      } catch (error) {
        results.push({ fileId, ok: false, code: safeErrorCode(error) });
      }
    }
    return { action: dto.action, results };
  }

  async getWorkspaceFile(tenant: WorkspaceTenantContext, fileId: string) {
    await this.requireActiveWorkspaceMembership(tenant);
    return serializeAsset(await this.findWorkspaceFile(tenant.workspaceId, fileId));
  }

  async createWorkspaceDownloadUrl(tenant: WorkspaceTenantContext, fileId: string) {
    await this.requireActiveWorkspaceMembership(tenant);
    const asset = await this.findWorkspaceFile(tenant.workspaceId, fileId);
    if (!ACTIVE_STORAGE_STATUSES.includes(asset.status)) {
      throw new ConflictException('FILE_NOT_ACTIVE');
    }
    if (!DOWNLOADABLE_LIFECYCLES.includes(asset.lifecycle)) {
      throw new ConflictException('FILE_NOT_DOWNLOADABLE');
    }
    const downloadUrl = await this.storage.createPresignedDownloadUrl(
      asset.storageKey,
      this.env.DOWNLOAD_URL_TTL_SECONDS,
    );
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'storage.download_url_requested',
      entityType: 'Asset',
      entityId: fileId,
      metadata: {},
    });
    return { downloadUrl, expiresInSeconds: this.env.DOWNLOAD_URL_TTL_SECONDS };
  }

  async storageUsage(tenant: WorkspaceTenantContext) {
    await this.requireActiveWorkspaceMembership(tenant);
    const usage = await this.calculateUsage(tenant.workspaceId);
    const quotaBytes = await this.quotaBytes(tenant.workspaceId);
    const usedBytes = Number(usage.usedBytes);
    const reservedBytes = Number(usage.reservedBytes);
    const quota = Number(quotaBytes);
    const availableBytes = Math.max(quota - usedBytes - reservedBytes, 0);
    return {
      usedBytes,
      reservedBytes,
      quotaBytes: quota,
      availableBytes,
      usagePercent: quota > 0 ? Math.round(((usedBytes + reservedBytes) / quota) * 10000) / 100 : 0,
    };
  }

  async getRetentionPolicy(tenant: WorkspaceTenantContext) {
    await this.requireActiveWorkspaceMembership(tenant);
    const policy = await this.prisma.storageRetentionPolicy.findUnique({
      where: { workspaceId: tenant.workspaceId },
      select: { workspaceId: true, deleteGraceDays: true, createdAt: true, updatedAt: true },
    });
    return {
      workspaceId: tenant.workspaceId,
      deleteGraceDays: policy?.deleteGraceDays ?? this.env.STORAGE_DELETE_GRACE_DAYS,
      source: policy ? 'WORKSPACE' : 'DEFAULT',
      createdAt: policy?.createdAt ?? null,
      updatedAt: policy?.updatedAt ?? null,
    };
  }

  async updateRetentionPolicy(
    tenant: WorkspaceTenantContext,
    dto: StorageRetentionPolicyUpdateDto,
  ) {
    await this.requireActiveWorkspaceMembership(tenant);
    const policy = await this.prisma.storageRetentionPolicy.upsert({
      where: { workspaceId: tenant.workspaceId },
      update: { deleteGraceDays: dto.deleteGraceDays },
      create: { workspaceId: tenant.workspaceId, deleteGraceDays: dto.deleteGraceDays },
      select: { workspaceId: true, deleteGraceDays: true, createdAt: true, updatedAt: true },
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'storage.retention_policy_updated',
      entityType: 'Workspace',
      entityId: tenant.workspaceId,
      metadata: { deleteGraceDays: policy.deleteGraceDays },
    });
    return { ...policy, source: 'WORKSPACE' };
  }

  async archiveWorkspaceFile(tenant: WorkspaceTenantContext, fileId: string) {
    await this.requireActiveWorkspaceMembership(tenant);
    const asset = await this.findWorkspaceFile(tenant.workspaceId, fileId);
    this.assertLifecycleMutable(asset, 'archive');
    if (asset.lifecycle === AssetLifecycle.ARCHIVED) return serializeAsset(asset);
    const updated = await this.prisma.asset.update({
      where: { id_workspaceId: { id: fileId, workspaceId: tenant.workspaceId } },
      data: {
        lifecycle: AssetLifecycle.ARCHIVED,
        archivedAt: new Date(),
        pendingDeleteAt: null,
        deleteRequestedAt: null,
        purgeAfter: null,
        purgingStartedAt: null,
        purgeFailureCode: null,
        purgeFailureAt: null,
      },
      select: assetSelect,
    });
    await this.auditFileLifecycle(tenant, updated, 'storage.file_archived');
    return serializeAsset(updated);
  }

  async requestWorkspaceFileDelete(tenant: WorkspaceTenantContext, fileId: string) {
    await this.requireActiveWorkspaceMembership(tenant);
    const asset = await this.findWorkspaceFile(tenant.workspaceId, fileId);
    if (asset.lifecycle === AssetLifecycle.PENDING_DELETE) return serializeAsset(asset);
    if (
      !([AssetLifecycle.ACTIVE, AssetLifecycle.ARCHIVED] as AssetLifecycle[]).includes(
        asset.lifecycle,
      )
    ) {
      throw new ConflictException('FILE_DELETE_STATE_INVALID');
    }
    if (!ACTIVE_STORAGE_STATUSES.includes(asset.status)) {
      throw new ConflictException('FILE_NOT_ACTIVE');
    }
    const deleteRequestedAt = new Date();
    const graceDays = await this.effectiveDeleteGraceDays(tenant.workspaceId);
    const purgeAfter = new Date(deleteRequestedAt.getTime() + graceDays * 86_400_000);
    const updated = await this.prisma.asset.update({
      where: { id_workspaceId: { id: fileId, workspaceId: tenant.workspaceId } },
      data: {
        lifecycle: AssetLifecycle.PENDING_DELETE,
        pendingDeleteAt: deleteRequestedAt,
        deleteRequestedAt,
        purgeAfter,
        purgingStartedAt: null,
        purgedAt: null,
        purgeFailureCode: null,
        purgeFailureAt: null,
      },
      select: assetSelect,
    });
    await this.auditFileLifecycle(tenant, updated, 'storage.file_delete_requested', {
      purgeAfter: purgeAfter.toISOString(),
    });
    return serializeAsset(updated);
  }

  async restoreWorkspaceFile(tenant: WorkspaceTenantContext, fileId: string) {
    await this.requireActiveWorkspaceMembership(tenant);
    const asset = await this.findWorkspaceFile(tenant.workspaceId, fileId);
    if (asset.lifecycle === AssetLifecycle.ACTIVE) return serializeAsset(asset);
    if (
      !([AssetLifecycle.ARCHIVED, AssetLifecycle.PENDING_DELETE] as AssetLifecycle[]).includes(
        asset.lifecycle,
      )
    ) {
      throw new ConflictException('FILE_RESTORE_STATE_INVALID');
    }
    if (!ACTIVE_STORAGE_STATUSES.includes(asset.status)) {
      throw new ConflictException('FILE_NOT_ACTIVE');
    }
    await this.statOwnedObject(asset).catch(() => {
      throw new ServiceUnavailableException('FILE_OBJECT_MISSING');
    });
    const updated = await this.prisma.$transaction(async (tx) => {
      const restored = await tx.asset.updateMany({
        where: {
          id: fileId,
          workspaceId: tenant.workspaceId,
          lifecycle: { in: [AssetLifecycle.ARCHIVED, AssetLifecycle.PENDING_DELETE] },
        },
        data: {
          lifecycle: AssetLifecycle.ACTIVE,
          archivedAt: null,
          pendingDeleteAt: null,
          deleteRequestedAt: null,
          purgeAfter: null,
          purgingStartedAt: null,
          purgeFailureCode: null,
          purgeFailureAt: null,
        },
      });
      if (restored.count !== 1) throw new ConflictException('FILE_RESTORE_STATE_INVALID');
      return tx.asset.findUniqueOrThrow({
        where: { id_workspaceId: { id: fileId, workspaceId: tenant.workspaceId } },
        select: assetSelect,
      });
    });
    await this.auditFileLifecycle(tenant, updated, 'storage.file_restored');
    return serializeAsset(updated);
  }

  async cleanupExpiredUploadReservations(limit = PURGE_BATCH_SIZE) {
    const now = new Date();
    const reservations = await this.prisma.storageUploadReservation.findMany({
      where: { consumedAt: null, releasedAt: null, expiresAt: { lte: now } },
      select: { id: true, fileId: true, workspaceId: true, file: { select: assetSelect } },
      orderBy: { expiresAt: 'asc' },
      take: Math.min(limit, PURGE_BATCH_SIZE),
    });
    let released = 0;
    for (const reservation of reservations) {
      const updated = await this.prisma.storageUploadReservation.updateMany({
        where: { id: reservation.id, consumedAt: null, releasedAt: null },
        data: { releasedAt: now },
      });
      if (updated.count !== 1) continue;
      released += 1;
      if (reservation.file.status === AssetStatus.UPLOADING) {
        await this.prisma.asset.updateMany({
          where: {
            id: reservation.fileId,
            workspaceId: reservation.workspaceId,
            status: AssetStatus.UPLOADING,
            lifecycle: AssetLifecycle.ACTIVE,
          },
          data: { status: AssetStatus.FAILED },
        });
        await this.storage.deleteObject(reservation.file.storageKey).catch(() => undefined);
      }
    }
    return { scanned: reservations.length, released };
  }

  async purgeDueFiles(limit = PURGE_BATCH_SIZE) {
    const now = new Date();
    const due = await this.prisma.asset.findMany({
      where: {
        lifecycle: AssetLifecycle.PENDING_DELETE,
        purgeAfter: { lte: now },
        OR: [{ purgeFailureCode: null }, { purgeFailureCode: { not: PURGE_RETRIES_EXHAUSTED } }],
      },
      select: assetSelect,
      orderBy: { purgeAfter: 'asc' },
      take: Math.min(limit, PURGE_BATCH_SIZE),
    });
    let purged = 0;
    let failed = 0;
    for (const asset of due) {
      const result = await this.purgeOneFile(asset, now);
      if (result === 'PURGED') purged += 1;
      if (result === 'FAILED') failed += 1;
    }
    return { scanned: due.length, purged, failed };
  }

  async completeUpload(
    tenant: WorkspaceTenantContext,
    projectId: string,
    assetId: string,
    dto: UploadCompleteDto,
    correlationId: string,
  ) {
    await this.requireActiveWorkspaceMembership(tenant);
    await this.assertProject(tenant.workspaceId, projectId);
    const asset = await this.findAsset(tenant.workspaceId, projectId, assetId);
    if (asset.status === AssetStatus.DELETED) throw new NotFoundException('Asset not found.');
    if (asset.status === AssetStatus.PROCESSING || asset.status === AssetStatus.READY) {
      await this.ensureProcessingJob(asset, correlationId);
      return serializeAsset(asset);
    }
    if (asset.status !== AssetStatus.UPLOADING) {
      throw new ConflictException('Asset is not awaiting upload completion.');
    }
    if (asset.uploadExpiresAt <= new Date()) {
      await this.releaseExpiredReservation(assetId);
      throw new GoneException('Upload authorization has expired.');
    }

    const object = await this.statOwnedObject(asset).catch(() => {
      throw new ServiceUnavailableException('Uploaded object is not available for verification.');
    });
    if (object.size !== dto.sizeBytes || BigInt(object.size) !== asset.sizeBytes) {
      throw new BadRequestException('Uploaded object size does not match the authorized size.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const reservation = await tx.storageUploadReservation.findUnique({
        where: { fileId: assetId },
        select: { id: true, expiresAt: true, consumedAt: true, releasedAt: true },
      });
      if (!reservation || reservation.releasedAt || reservation.expiresAt <= new Date()) {
        throw new GoneException('UPLOAD_RESERVATION_EXPIRED');
      }
      if (!reservation.consumedAt) {
        await tx.storageUploadReservation.update({
          where: { id: reservation.id },
          data: { consumedAt: new Date() },
        });
      }
      return tx.asset.update({
        where: {
          id_workspaceId: {
            id: assetId,
            workspaceId: tenant.workspaceId,
          },
        },
        data: {
          status: AssetStatus.PROCESSING,
          metadata: {
            ...withoutUndefined({
              ...(isRecord(asset.metadata) ? asset.metadata : {}),
              etag: object.etag,
              uploadedContentType: object.contentType,
            }),
          },
        },
        select: assetSelect,
      });
    });
    await this.ensureProcessingJob(updated, correlationId);
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'asset.upload_complete',
      entityType: 'Asset',
      entityId: assetId,
      metadata: { projectId },
    });
    return serializeAsset(updated);
  }

  async list(tenant: WorkspaceTenantContext, projectId: string, query: AssetQueryDto) {
    await this.requireActiveWorkspaceMembership(tenant);
    await this.assertProject(tenant.workspaceId, projectId);
    const assetWhere: Prisma.AssetWhereInput = {
      workspaceId: tenant.workspaceId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? { displayName: { contains: query.search.trim(), mode: Prisma.QueryMode.insensitive } }
        : {}),
    };
    const where: Prisma.ProjectAttachmentWhereInput = {
      workspaceId: tenant.workspaceId,
      projectId,
      removedAt: null,
      attachment: { deletedAt: null, asset: assetWhere },
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.projectAttachment.findMany({
        where,
        select: { attachment: { select: { asset: { select: assetSelect } } } },
        orderBy: {
          attachment: {
            asset: {
              [query.sortBy === 'name' ? 'displayName' : query.sortBy]: query.sortDirection,
            },
          },
        },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.projectAttachment.count({ where }),
    ]);
    return {
      items: items.flatMap((item) =>
        item.attachment.asset ? [serializeAsset(item.attachment.asset)] : [],
      ),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async get(tenant: WorkspaceTenantContext, projectId: string, assetId: string) {
    await this.requireActiveWorkspaceMembership(tenant);
    await this.assertProject(tenant.workspaceId, projectId);
    return serializeAsset(await this.findAsset(tenant.workspaceId, projectId, assetId));
  }

  async download(tenant: WorkspaceTenantContext, projectId: string, assetId: string) {
    await this.requireActiveWorkspaceMembership(tenant);
    await this.assertProject(tenant.workspaceId, projectId);
    const asset = await this.findAsset(tenant.workspaceId, projectId, assetId);
    if (asset.status !== AssetStatus.READY) {
      throw new ConflictException('Asset is not ready for download.');
    }
    const downloadUrl = await this.storage.createPresignedDownloadUrl(
      asset.storageKey,
      this.env.DOWNLOAD_URL_TTL_SECONDS,
    );
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'asset.download_authorized',
      entityType: 'Asset',
      entityId: assetId,
      metadata: { projectId },
    });
    return { downloadUrl, expiresInSeconds: this.env.DOWNLOAD_URL_TTL_SECONDS };
  }

  async remove(tenant: WorkspaceTenantContext, projectId: string, assetId: string) {
    await this.requireActiveWorkspaceMembership(tenant);
    await this.assertProject(tenant.workspaceId, projectId);
    await this.findAsset(tenant.workspaceId, projectId, assetId);
    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.projectAttachment.updateMany({
        where: {
          projectId,
          attachmentId: assetId,
          workspaceId: tenant.workspaceId,
          removedAt: null,
        },
        data: { removedAt: now },
      });
      return tx.asset.findUniqueOrThrow({
        where: {
          id_workspaceId: {
            id: assetId,
            workspaceId: tenant.workspaceId,
          },
        },
        select: assetSelect,
      });
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'asset.delete',
      entityType: 'Asset',
      entityId: assetId,
      metadata: { projectId },
    });
    return serializeAsset(updated);
  }

  private validateUploadInput(dto: UploadInitDto | WorkspaceFileUploadInitDto) {
    const filename = sanitizeFilename(dto.filename);
    const displayName = sanitizeFilename(dto.displayName ?? filename);
    const mimeType = sanitizeMimeType(dto.mimeType);
    if (!this.allowedMimeTypes.has(mimeType)) {
      throw new UnprocessableEntityException('FILE_TYPE_NOT_ALLOWED');
    }
    if (dto.sizeBytes > this.env.MAX_UPLOAD_BYTES) {
      throw new PayloadTooLargeException('FILE_TOO_LARGE');
    }
    return {
      filename,
      displayName,
      mimeType,
      sizeBytes: dto.sizeBytes,
      extension: extractExtension(filename),
    };
  }

  private async requireActiveWorkspaceMembership(tenant: WorkspaceTenantContext) {
    if (!tenant.workspaceMembershipId) {
      throw new BadRequestException('WORKSPACE_MEMBERSHIP_REQUIRED');
    }
    const membership = await this.prisma.workspaceMembership.findUnique({
      where: {
        id_workspaceId: {
          id: tenant.workspaceMembershipId,
          workspaceId: tenant.workspaceId,
        },
      },
      select: { id: true, status: true },
    });
    if (!membership || membership.status !== MembershipStatus.ACTIVE) {
      throw new BadRequestException('WORKSPACE_MEMBERSHIP_REQUIRED');
    }
    return membership.id;
  }

  private async assertWorkspaceUploader(workspaceId: string, membershipId: string) {
    const membership = await this.prisma.workspaceMembership.findUnique({
      where: { id_workspaceId: { id: membershipId, workspaceId } },
      select: { id: true },
    });
    if (!membership) throw new BadRequestException('UPLOADER_NOT_IN_WORKSPACE');
  }

  private async resolveSourceMetadata(workspaceId: string, dto: WorkspaceFileUploadInitDto) {
    const sourceModule = dto.sourceModule ?? 'GENERAL';
    if (sourceModule === 'GENERAL') {
      if (dto.sourceEntityType || dto.sourceEntityId) {
        throw new BadRequestException('INVALID_SOURCE_METADATA');
      }
      return { sourceModule, sourceEntityType: null, sourceEntityId: null };
    }

    if (!dto.sourceEntityId) {
      throw new BadRequestException('SOURCE_ENTITY_REQUIRED');
    }
    if (dto.sourceEntityType && dto.sourceEntityType !== sourceModule) {
      throw new BadRequestException('INVALID_SOURCE_ENTITY_TYPE');
    }

    await this.assertSourceEntity(workspaceId, sourceModule, dto.sourceEntityId);
    return {
      sourceModule,
      sourceEntityType: sourceModule,
      sourceEntityId: dto.sourceEntityId,
    };
  }

  private async assertSourceEntity(
    workspaceId: string,
    sourceModule: 'TASK' | 'PROJECT' | 'TICKET',
    sourceEntityId: string,
  ) {
    if (sourceModule === 'PROJECT') {
      const project = await this.prisma.project.findFirst({
        where: { id: sourceEntityId, workspaceId, status: { not: ProjectStatus.ARCHIVED } },
        select: { id: true },
      });
      if (!project) throw new NotFoundException('SOURCE_ENTITY_NOT_FOUND');
      return;
    }
    if (sourceModule === 'TASK') {
      const task = await this.prisma.task.findFirst({
        where: { id: sourceEntityId, workspaceId, deletedAt: null },
        select: { id: true },
      });
      if (!task) throw new NotFoundException('SOURCE_ENTITY_NOT_FOUND');
      return;
    }
    const ticket = await this.prisma.ticket.findFirst({
      where: { id: sourceEntityId, workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!ticket) throw new NotFoundException('SOURCE_ENTITY_NOT_FOUND');
  }

  private async assertQuotaAvailable(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    requestedBytes: bigint,
  ) {
    if (
      await this.billingEntitlements?.assertWorkspaceStorageAvailableTx(
        tx,
        workspaceId,
        requestedBytes,
      )
    ) {
      return;
    }
    await tx.$queryRaw<Array<{ lock: string }>>`
      SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))::text AS lock
    `;
    const workspace = await tx.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { storageLimitBytes: true },
    });
    const usage = await this.calculateUsage(workspaceId, tx);
    if (usage.usedBytes + usage.reservedBytes + requestedBytes > workspace.storageLimitBytes) {
      throw new PayloadTooLargeException('STORAGE_QUOTA_EXCEEDED');
    }
  }

  private async calculateUsage(workspaceId: string, tx: Prisma.TransactionClient = this.prisma) {
    const [used, reserved] = await Promise.all([
      tx.asset.aggregate({
        where: {
          workspaceId,
          deletedAt: null,
          status: { in: ACTIVE_STORAGE_STATUSES },
          lifecycle: { in: QUOTA_COUNTING_LIFECYCLES },
        },
        _sum: { sizeBytes: true },
      }),
      tx.storageUploadReservation.aggregate({
        where: {
          workspaceId,
          consumedAt: null,
          releasedAt: null,
          expiresAt: { gt: new Date() },
        },
        _sum: { reservedBytes: true },
      }),
    ]);
    return {
      usedBytes: used._sum.sizeBytes ?? 0n,
      reservedBytes: reserved._sum.reservedBytes ?? 0n,
    };
  }

  private async quotaBytes(workspaceId: string) {
    const workspace = await this.prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { storageLimitBytes: true },
    });
    return workspace.storageLimitBytes;
  }

  private async releaseExpiredReservation(fileId: string) {
    await this.prisma.storageUploadReservation.updateMany({
      where: { fileId, consumedAt: null, releasedAt: null },
      data: { releasedAt: new Date() },
    });
  }

  private async findWorkspaceFile(workspaceId: string, fileId: string) {
    const asset = await this.prisma.asset.findFirst({
      where: { id: fileId, workspaceId, deletedAt: null },
      select: assetSelect,
    });
    if (!asset || asset.status === AssetStatus.DELETED)
      throw new NotFoundException('FILE_NOT_FOUND');
    return asset;
  }

  private async effectiveDeleteGraceDays(workspaceId: string) {
    const policy = await this.prisma.storageRetentionPolicy.findUnique({
      where: { workspaceId },
      select: { deleteGraceDays: true },
    });
    return policy?.deleteGraceDays ?? this.env.STORAGE_DELETE_GRACE_DAYS;
  }

  private assertLifecycleMutable(asset: AssetRecord, action: 'archive') {
    if (action === 'archive') {
      if (asset.lifecycle === AssetLifecycle.PURGING || asset.lifecycle === AssetLifecycle.PURGED) {
        throw new ConflictException('FILE_ARCHIVE_STATE_INVALID');
      }
      if (asset.lifecycle === AssetLifecycle.PENDING_DELETE) {
        throw new ConflictException('FILE_ARCHIVE_STATE_INVALID');
      }
      if (!ACTIVE_STORAGE_STATUSES.includes(asset.status)) {
        throw new ConflictException('FILE_NOT_ACTIVE');
      }
    }
  }

  private async purgeOneFile(asset: AssetRecord, now: Date) {
    const claimed = await this.prisma.asset.updateMany({
      where: {
        id: asset.id,
        workspaceId: asset.workspaceId,
        lifecycle: AssetLifecycle.PENDING_DELETE,
        purgeAfter: { lte: now },
      },
      data: {
        lifecycle: AssetLifecycle.PURGING,
        purgingStartedAt: now,
        purgeFailureCode: null,
        purgeFailureAt: null,
      },
    });
    if (claimed.count !== 1) return 'SKIPPED' as const;

    try {
      await this.storage.deleteObject(asset.storageKey);
    } catch (error) {
      if (!isObjectMissingError(error)) {
        const attempts = purgeAttempts(asset) + 1;
        await this.prisma.asset.updateMany({
          where: {
            id: asset.id,
            workspaceId: asset.workspaceId,
            lifecycle: AssetLifecycle.PURGING,
          },
          data: {
            lifecycle: AssetLifecycle.PENDING_DELETE,
            purgingStartedAt: null,
            purgeFailureCode:
              attempts >= MAX_PURGE_ATTEMPTS ? PURGE_RETRIES_EXHAUSTED : 'STORAGE_UNAVAILABLE',
            purgeFailureAt: new Date(),
            metadata: {
              ...withoutUndefined({
                ...(isRecord(asset.metadata) ? asset.metadata : {}),
                storagePurgeAttempts: attempts,
              }),
            },
          },
        });
        return 'FAILED' as const;
      }
    }

    const purged = new Date();
    await this.prisma.asset.updateMany({
      where: {
        id: asset.id,
        workspaceId: asset.workspaceId,
        lifecycle: AssetLifecycle.PURGING,
      },
      data: {
        lifecycle: AssetLifecycle.PURGED,
        purgedAt: purged,
        purgeFailureCode: null,
        purgeFailureAt: null,
      },
    });
    await this.audit.record({
      agencyId: null,
      workspaceId: asset.workspaceId,
      userId: null,
      action: 'storage.file_purged',
      entityType: 'Asset',
      entityId: asset.id,
      metadata: this.lifecycleAuditMetadata(asset),
    });
    return 'PURGED' as const;
  }

  private async auditFileLifecycle(
    tenant: WorkspaceTenantContext,
    asset: AssetRecord,
    action: string,
    metadata: Record<string, unknown> = {},
  ) {
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action,
      entityType: 'Asset',
      entityId: asset.id,
      metadata: withoutUndefined({
        ...this.lifecycleAuditMetadata(asset),
        ...metadata,
      }) as Prisma.InputJsonValue,
    });
  }

  private lifecycleAuditMetadata(asset: AssetRecord) {
    return withoutUndefined({
      fileId: asset.id,
      sourceModule: asset.sourceModule,
      sourceEntityType: asset.sourceEntityType,
      sourceEntityId: asset.sourceEntityId,
      purgeAfter: asset.purgeAfter?.toISOString(),
    });
  }

  private async assertProject(workspaceId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId, status: { not: ProjectStatus.ARCHIVED } },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('Project not found.');
  }

  private async findAsset(workspaceId: string, projectId: string, assetId: string) {
    const link = await this.prisma.projectAttachment.findFirst({
      where: {
        workspaceId,
        projectId,
        attachmentId: assetId,
        removedAt: null,
        attachment: { deletedAt: null, asset: { deletedAt: null } },
      },
      select: { attachment: { select: { asset: { select: assetSelect } } } },
    });
    const asset = link?.attachment.asset;
    if (!asset || asset.status === AssetStatus.DELETED)
      throw new NotFoundException('Asset not found.');
    return asset;
  }

  private async statOwnedObject(asset: AssetRecord) {
    const object = await this.storage.getMetadata(asset.storageKey);
    if (object.key !== asset.storageKey) {
      throw new BadRequestException('Uploaded object key mismatch.');
    }
    return object;
  }

  private async ensureProcessingJob(asset: AssetRecord, correlationId: string) {
    const job = await this.prisma.processingJob.upsert({
      where: { assetId_type: { assetId: asset.id, type: ASSET_PROCESSING_JOB_TYPE } },
      update: {},
      create: {
        workspaceId: asset.workspaceId,
        projectId: asset.projectId,
        assetId: asset.id,
        type: ASSET_PROCESSING_JOB_TYPE,
        status: ProcessingJobStatus.QUEUED,
        correlationId,
      },
      select: { id: true, status: true },
    });
    if (job.status === ProcessingJobStatus.QUEUED) {
      await this.queue.add(
        ASSET_PROCESSING_JOB_TYPE,
        {
          version: ASSET_JOB_VERSION,
          jobId: job.id,
          correlationId,
          workspaceId: asset.workspaceId,
          projectId: asset.projectId,
          assetId: asset.id,
          type: ASSET_PROCESSING_JOB_TYPE,
          createdAt: new Date().toISOString(),
        },
        { jobId: job.id, attempts: 3, backoff: { type: 'exponential', delay: 1_000 } },
      );
    }
    return job;
  }
}

const assetSelect = {
  id: true,
  workspaceId: true,
  projectId: true,
  createdById: true,
  uploadedByMembershipId: true,
  originalFilename: true,
  displayName: true,
  storageBucket: true,
  storageProvider: true,
  storageKey: true,
  mimeType: true,
  extension: true,
  sizeBytes: true,
  checksum: true,
  status: true,
  lifecycle: true,
  sourceModule: true,
  sourceEntityType: true,
  sourceEntityId: true,
  sourceProvider: true,
  sourceConnectionId: true,
  sourceProviderFileId: true,
  metadata: true,
  uploadExpiresAt: true,
  archivedAt: true,
  pendingDeleteAt: true,
  deleteRequestedAt: true,
  purgeAfter: true,
  purgingStartedAt: true,
  purgedAt: true,
  purgeFailureCode: true,
  purgeFailureAt: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  uploadedByMembership: {
    select: {
      id: true,
      user: { select: { id: true, name: true, email: true } },
    },
  },
} satisfies Prisma.AssetSelect;

type AssetRecord = Prisma.AssetGetPayload<{ select: typeof assetSelect }>;

function serializeAsset(asset: AssetRecord) {
  const safe: Partial<AssetRecord> = { ...asset };
  delete safe.storageBucket;
  delete safe.storageKey;
  return { ...safe, sizeBytes: Number(asset.sizeBytes) };
}

function sanitizeFilename(value: string) {
  const normalized = value.normalize('NFKC').trim();
  if (
    !normalized ||
    normalized.includes('..') ||
    /%(?:25)*(?:2e|2f|5c)/i.test(normalized) ||
    /[\\/\u2044\u2215\u2216\u29f5\u29f8\uFE68\uFF0F\uFF3C]/u.test(normalized) ||
    hasControlCharacters(normalized)
  ) {
    throw new UnprocessableEntityException('Invalid filename.');
  }
  return normalized.slice(0, 255);
}

function sanitizeMimeType(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i.test(normalized)) {
    throw new UnprocessableEntityException('Invalid MIME type.');
  }
  return normalized;
}

function extractExtension(filename: string) {
  const last = filename.lastIndexOf('.');
  if (last <= 0 || last === filename.length - 1) return null;
  const extension = filename
    .slice(last + 1)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return extension ? extension.slice(0, 24) : null;
}

function buildStorageKey(
  workspaceId: string,
  projectId: string,
  assetId: string,
  extension: string | null,
) {
  const suffix = extension ? `asset.${extension}` : 'asset.bin';
  return `workspace/${workspaceId}/projects/${projectId}/assets/${assetId}/${suffix}`;
}

function buildWorkspaceFileStorageKey(workspaceId: string, fileId: string) {
  return `workspaces/${workspaceId}/files/${fileId}/original`;
}

function isRecord(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasControlCharacters(value: string) {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint < 32 || codePoint === 127);
  });
}

function isObjectMissingError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; statusCode?: unknown; message?: unknown };
  return (
    candidate.code === 'NoSuchKey' ||
    candidate.code === 'NotFound' ||
    candidate.statusCode === 404 ||
    (typeof candidate.message === 'string' && /not found|no such key/i.test(candidate.message))
  );
}

function parseCreatedRange(createdFrom?: string, createdTo?: string) {
  const from = createdFrom ? new Date(createdFrom) : null;
  const to = createdTo ? new Date(createdTo) : null;
  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
    throw new BadRequestException('INVALID_DATE_RANGE');
  }
  if (from && to && from > to) throw new BadRequestException('INVALID_DATE_RANGE');
  return { from, to };
}

function workspaceFileOrderBy(
  sort: WorkspaceFileQueryDto['sort'],
): Prisma.AssetOrderByWithRelationInput[] {
  if (sort === 'OLDEST') return [{ createdAt: 'asc' }, { id: 'asc' }];
  if (sort === 'NAME_ASC') return [{ displayName: 'asc' }, { id: 'asc' }];
  if (sort === 'NAME_DESC') return [{ displayName: 'desc' }, { id: 'desc' }];
  if (sort === 'SIZE_ASC') return [{ sizeBytes: 'asc' }, { id: 'asc' }];
  if (sort === 'SIZE_DESC') return [{ sizeBytes: 'desc' }, { id: 'desc' }];
  return [{ createdAt: 'desc' }, { id: 'desc' }];
}

function categoryWhere(
  category: NonNullable<WorkspaceFileQueryDto['category']>,
): Prisma.AssetWhereInput {
  if (category === 'IMAGE') return { mimeType: { startsWith: 'image/' } };
  if (category === 'PDF') return { mimeType: 'application/pdf' };
  if (category === 'DOCUMENT') {
    return {
      mimeType: {
        in: [
          'text/plain',
          'text/markdown',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/rtf',
        ],
      },
    };
  }
  if (category === 'SPREADSHEET') {
    return {
      mimeType: {
        in: [
          'text/csv',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ],
      },
    };
  }
  if (category === 'ARCHIVE') {
    return {
      mimeType: {
        in: [
          'application/zip',
          'application/x-zip-compressed',
          'application/x-tar',
          'application/gzip',
          'application/x-7z-compressed',
        ],
      },
    };
  }
  return {
    NOT: [
      { mimeType: { startsWith: 'image/' } },
      { mimeType: 'application/pdf' },
      {
        mimeType: {
          in: [
            'text/plain',
            'text/markdown',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/rtf',
            'text/csv',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/zip',
            'application/x-zip-compressed',
            'application/x-tar',
            'application/gzip',
            'application/x-7z-compressed',
          ],
        },
      },
    ],
  };
}

function safeErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return 'FILE_ACTION_FAILED';
  const response = (error as { getResponse?: () => unknown }).getResponse?.();
  if (typeof response === 'string') return response;
  if (response && typeof response === 'object' && 'message' in response) {
    const message = (response as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  if ('message' in error && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return 'FILE_ACTION_FAILED';
}

function purgeAttempts(asset: AssetRecord) {
  if (!isRecord(asset.metadata)) return 0;
  const attempts = asset.metadata.storagePurgeAttempts;
  return typeof attempts === 'number' && Number.isInteger(attempts) && attempts > 0 ? attempts : 0;
}

function withoutUndefined(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, Prisma.InputJsonValue] => entry[1] !== undefined,
    ),
  );
}
