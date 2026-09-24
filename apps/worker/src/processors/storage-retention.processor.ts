import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AssetLifecycle, AssetStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import type { Job } from 'bullmq';
import { PrismaService } from '../infrastructure/database/prisma.service';
import type { StorageService } from '../infrastructure/storage/storage.service';
import { WORKER_STORAGE } from '../infrastructure/storage/storage.tokens';
import { STORAGE_RETENTION_QUEUE, STORAGE_RETENTION_SCAN_JOB_TYPE } from '../queue/queue.constants';

const BATCH_SIZE = 100;
const MAX_PURGE_ATTEMPTS = 3;
const PURGE_RETRIES_EXHAUSTED = 'PURGE_RETRIES_EXHAUSTED';

interface RetentionScanEnvelope {
  version: 1;
  createdAt: string;
}

@Injectable()
@Processor(STORAGE_RETENTION_QUEUE)
export class StorageRetentionProcessor extends WorkerHost {
  private readonly logger = new Logger(StorageRetentionProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WORKER_STORAGE)
    private readonly storage: StorageService,
  ) {
    super();
  }

  async process(job: Job<RetentionScanEnvelope>) {
    if (job.name !== STORAGE_RETENTION_SCAN_JOB_TYPE) return;
    assertEnvelope(job.data);
    const released = await this.releaseExpiredReservations();
    const purged = await this.purgeDueFiles();
    this.logger.log({
      message: 'Storage retention scan completed',
      releasedReservations: released.released,
      purgedFiles: purged.purged,
      failedPurges: purged.failed,
    });
  }

  async releaseExpiredReservations(now = new Date()) {
    const reservations = await this.prisma.storageUploadReservation.findMany({
      where: { consumedAt: null, releasedAt: null, expiresAt: { lte: now } },
      select: {
        id: true,
        fileId: true,
        workspaceId: true,
        file: {
          select: { id: true, workspaceId: true, storageKey: true, status: true, lifecycle: true },
        },
      },
      orderBy: { expiresAt: 'asc' },
      take: BATCH_SIZE,
    });
    let released = 0;
    for (const reservation of reservations) {
      const updated = await this.prisma.storageUploadReservation.updateMany({
        where: { id: reservation.id, consumedAt: null, releasedAt: null },
        data: { releasedAt: now },
      });
      if (updated.count !== 1) continue;
      released += 1;
      if (
        reservation.file.status === AssetStatus.UPLOADING &&
        reservation.file.lifecycle === AssetLifecycle.ACTIVE
      ) {
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

  async purgeDueFiles(now = new Date()) {
    const due = await this.prisma.asset.findMany({
      where: {
        lifecycle: AssetLifecycle.PENDING_DELETE,
        purgeAfter: { lte: now },
        OR: [{ purgeFailureCode: null }, { purgeFailureCode: { not: PURGE_RETRIES_EXHAUSTED } }],
      },
      select: {
        id: true,
        workspaceId: true,
        storageKey: true,
        metadata: true,
        sourceModule: true,
        sourceEntityType: true,
        sourceEntityId: true,
        purgeAfter: true,
      },
      orderBy: { purgeAfter: 'asc' },
      take: BATCH_SIZE,
    });
    let purged = 0;
    let failed = 0;
    for (const asset of due) {
      const result = await this.purgeOne(asset, now);
      if (result === 'PURGED') purged += 1;
      if (result === 'FAILED') failed += 1;
    }
    return { scanned: due.length, purged, failed };
  }

  private async purgeOne(
    asset: {
      id: string;
      workspaceId: string;
      storageKey: string;
      metadata: Prisma.JsonValue;
      sourceModule: string | null;
      sourceEntityType: string | null;
      sourceEntityId: string | null;
      purgeAfter: Date | null;
    },
    now: Date,
  ) {
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

    const purgedAt = new Date();
    await this.prisma.$transaction([
      this.prisma.asset.updateMany({
        where: { id: asset.id, workspaceId: asset.workspaceId, lifecycle: AssetLifecycle.PURGING },
        data: {
          lifecycle: AssetLifecycle.PURGED,
          purgedAt,
          purgeFailureCode: null,
          purgeFailureAt: null,
        },
      }),
      this.prisma.auditLog.create({
        data: {
          workspaceId: asset.workspaceId,
          action: 'storage.file_purged',
          entityType: 'Asset',
          entityId: asset.id,
          metadata: {
            fileId: asset.id,
            sourceModule: asset.sourceModule,
            sourceEntityType: asset.sourceEntityType,
            sourceEntityId: asset.sourceEntityId,
            purgeAfter: asset.purgeAfter?.toISOString(),
          },
        },
      }),
    ]);
    return 'PURGED' as const;
  }
}

function assertEnvelope(value: unknown): asserts value is RetentionScanEnvelope {
  if (!value || typeof value !== 'object') throw new Error('Invalid retention scan envelope.');
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1 || typeof candidate.createdAt !== 'string') {
    throw new Error('Invalid retention scan envelope.');
  }
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

function purgeAttempts(asset: { metadata: Prisma.JsonValue }) {
  if (!isRecord(asset.metadata)) return 0;
  const attempts = asset.metadata.storagePurgeAttempts;
  return typeof attempts === 'number' && Number.isInteger(attempts) && attempts > 0 ? attempts : 0;
}

function isRecord(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function withoutUndefined(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, Prisma.InputJsonValue] => entry[1] !== undefined,
    ),
  );
}
