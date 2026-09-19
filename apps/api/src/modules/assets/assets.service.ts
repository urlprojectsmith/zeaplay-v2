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
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import {
  AssetStatus,
  AttachmentType,
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
import {
  ASSET_PROCESSING_JOB_TYPE,
  ASSET_PROCESSING_QUEUE,
} from '../../infrastructure/queue/queue.constants';
import { UploadInitDto } from './dto/upload-init.dto';
import { UploadCompleteDto } from './dto/upload-complete.dto';
import { AssetQueryDto } from './dto/asset-query.dto';

const ASSET_JOB_VERSION = 1;

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
  ) {}

  async initUpload(
    tenant: WorkspaceTenantContext,
    projectId: string,
    dto: UploadInitDto,
    correlationId: string,
  ) {
    await this.assertProject(tenant.workspaceId, projectId);
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
      const workspace = await tx.workspace.findUniqueOrThrow({
        where: { id: tenant.workspaceId },
        select: { storageUsedBytes: true, storageLimitBytes: true },
      });
      if (workspace.storageUsedBytes + sizeBytes > workspace.storageLimitBytes) {
        throw new PayloadTooLargeException('Workspace storage limit would be exceeded.');
      }
      await tx.workspace.update({
        where: { id: tenant.workspaceId },
        data: { storageUsedBytes: { increment: sizeBytes } },
      });
      const asset = await tx.asset.create({
        data: {
          id: assetId,
          workspaceId: tenant.workspaceId,
          projectId,
          createdById: tenant.userId,
          originalFilename: filename,
          displayName,
          storageBucket: this.env.MINIO_BUCKET,
          storageKey,
          mimeType,
          extension,
          sizeBytes,
          status: AssetStatus.UPLOADING,
          uploadExpiresAt,
          metadata: { correlationId },
        },
        select: assetSelect,
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

  async completeUpload(
    tenant: WorkspaceTenantContext,
    projectId: string,
    assetId: string,
    dto: UploadCompleteDto,
    correlationId: string,
  ) {
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
      throw new GoneException('Upload authorization has expired.');
    }

    const object = await this.statOwnedObject(asset).catch(() => {
      throw new ServiceUnavailableException('Uploaded object is not available for verification.');
    });
    if (object.size !== dto.sizeBytes || BigInt(object.size) !== asset.sizeBytes) {
      throw new BadRequestException('Uploaded object size does not match the authorized size.');
    }

    const updated = await this.prisma.asset.update({
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
    await this.assertProject(tenant.workspaceId, projectId);
    return serializeAsset(await this.findAsset(tenant.workspaceId, projectId, assetId));
  }

  async download(tenant: WorkspaceTenantContext, projectId: string, assetId: string) {
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
  originalFilename: true,
  displayName: true,
  storageBucket: true,
  storageKey: true,
  mimeType: true,
  extension: true,
  sizeBytes: true,
  checksum: true,
  status: true,
  metadata: true,
  uploadExpiresAt: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
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

function isRecord(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasControlCharacters(value: string) {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint < 32 || codePoint === 127);
  });
}

function withoutUndefined(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, Prisma.InputJsonValue] => entry[1] !== undefined,
    ),
  );
}
