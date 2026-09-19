import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AssetStatus, ProcessingJobStatus } from '@prisma/client';
import type { Job } from 'bullmq';
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { PrismaService } from '../infrastructure/database/prisma.service';
import type { StorageService } from '../infrastructure/storage/storage.service';
import { WORKER_STORAGE } from '../infrastructure/storage/storage.tokens';
import { ASSET_PROCESSING_JOB_TYPE, ASSET_PROCESSING_QUEUE } from '../queue/queue.constants';

interface AssetJobEnvelope {
  version: 1;
  jobId: string;
  correlationId: string;
  workspaceId: string;
  projectId?: string | null;
  assetId: string;
  type: typeof ASSET_PROCESSING_JOB_TYPE;
  createdAt: string;
}

@Injectable()
@Processor(ASSET_PROCESSING_QUEUE)
export class AssetProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(AssetProcessingProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WORKER_STORAGE)
    private readonly storage: StorageService,
  ) {
    super();
  }

  async process(job: Job<AssetJobEnvelope>) {
    const envelope = assertEnvelope(job.data);
    const claimed = await this.updateProcessingJob(envelope, {
      where: { status: ProcessingJobStatus.QUEUED },
      data: {
        status: ProcessingJobStatus.RUNNING,
        startedAt: new Date(),
        attempts: job.attemptsMade + 1,
      },
    });
    if (claimed.count !== 1) {
      this.logger.warn({
        ...logContext(envelope),
        message: 'Asset processing job envelope did not match a queued processing job',
      });
      return;
    }

    const asset = await this.prisma.asset.findFirst({
      where: {
        id: envelope.assetId,
        workspaceId: envelope.workspaceId,
        ...(envelope.projectId ? { projectId: envelope.projectId } : {}),
      },
      select: {
        id: true,
        projectId: true,
        workspaceId: true,
        storageKey: true,
        sizeBytes: true,
        status: true,
        metadata: true,
      },
    });
    if (!asset) return this.fail(envelope, 'ASSET_MISSING', 'Asset not found.', false);
    if (asset.status === AssetStatus.DELETED) return this.cancel(envelope);
    if (asset.status === AssetStatus.READY) return this.succeed(envelope);
    if (asset.status !== AssetStatus.PROCESSING) {
      return this.fail(envelope, 'INVALID_ASSET_STATE', 'Asset is not processing.', false);
    }

    try {
      const stat = await this.storage.statObject(asset.storageKey);
      if (BigInt(stat.size) !== asset.sizeBytes) {
        return this.fail(
          envelope,
          'SIZE_MISMATCH',
          'Object size does not match asset metadata.',
          false,
        );
      }
      const checksum = await sha256Stream(await this.storage.getObject(asset.storageKey));
      await this.prisma.$transaction([
        this.prisma.asset.update({
          where: {
            id_workspaceId: {
              id: asset.id,
              workspaceId: asset.workspaceId,
            },
          },
          data: {
            checksum,
            status: AssetStatus.READY,
            metadata: {
              ...(isObject(asset.metadata) ? asset.metadata : {}),
              etag: stat.etag,
              processedAt: new Date().toISOString(),
            },
          },
        }),
        this.updateProcessingJob(envelope, {
          data: {
            status: ProcessingJobStatus.SUCCEEDED,
            progress: 100,
            completedAt: new Date(),
            errorCode: null,
            errorMessage: null,
          },
        }),
      ]);
      this.logger.log({ ...logContext(envelope), message: 'Asset processing succeeded' });
    } catch (error) {
      if (isFinalAttempt(job)) {
        await this.fail(envelope, 'STORAGE_UNAVAILABLE', safeStorageFailureMessage(), true);
      } else {
        await this.deferRetry(envelope, job);
      }
      throw error;
    }
  }

  private async succeed(envelope: AssetJobEnvelope) {
    await this.updateProcessingJob(envelope, {
      data: { status: ProcessingJobStatus.SUCCEEDED, progress: 100, completedAt: new Date() },
    });
  }

  private async cancel(envelope: AssetJobEnvelope) {
    await this.updateProcessingJob(envelope, {
      data: { status: ProcessingJobStatus.CANCELLED, completedAt: new Date() },
    });
  }

  private async fail(
    envelope: AssetJobEnvelope,
    code: string,
    message: string,
    retryable: boolean,
  ) {
    await this.prisma.$transaction([
      this.updateProcessingJob(envelope, {
        data: {
          status: ProcessingJobStatus.FAILED,
          errorCode: code,
          errorMessage: message.slice(0, 512),
          completedAt: new Date(),
        },
      }),
      this.prisma.asset.updateMany({
        where: {
          id: envelope.assetId,
          workspaceId: envelope.workspaceId,
          ...(envelope.projectId ? { projectId: envelope.projectId } : {}),
        },
        data: { status: AssetStatus.FAILED },
      }),
    ]);
    this.logger.warn({
      ...logContext(envelope),
      code,
      retryable,
      message: 'Asset processing failed',
    });
  }

  private async deferRetry(envelope: AssetJobEnvelope, job: Job<AssetJobEnvelope>) {
    await this.updateProcessingJob(envelope, {
      data: {
        status: ProcessingJobStatus.QUEUED,
        attempts: job.attemptsMade + 1,
        errorCode: 'STORAGE_UNAVAILABLE',
        errorMessage: safeStorageFailureMessage(),
        completedAt: null,
      },
    });
    this.logger.warn({
      ...logContext(envelope),
      retryable: true,
      message: 'Asset processing deferred for retry',
    });
  }

  private updateProcessingJob(
    envelope: AssetJobEnvelope,
    options: {
      where?: { status?: ProcessingJobStatus };
      data: Parameters<PrismaService['processingJob']['updateMany']>[0]['data'];
    },
  ) {
    return this.prisma.processingJob.updateMany({
      where: {
        id: envelope.jobId,
        workspaceId: envelope.workspaceId,
        projectId: envelope.projectId ?? null,
        assetId: envelope.assetId,
        ...options.where,
      },
      data: options.data,
    });
  }
}

function assertEnvelope(value: unknown): AssetJobEnvelope {
  if (!isObject(value) || value.version !== 1 || value.type !== ASSET_PROCESSING_JOB_TYPE) {
    throw new Error('Invalid asset job envelope.');
  }
  for (const key of ['jobId', 'correlationId', 'workspaceId', 'assetId', 'createdAt']) {
    if (typeof value[key] !== 'string' || value[key].length === 0) {
      throw new Error('Invalid asset job envelope.');
    }
  }
  if (
    'projectId' in value &&
    value.projectId !== null &&
    value.projectId !== undefined &&
    (typeof value.projectId !== 'string' || value.projectId.length === 0)
  ) {
    throw new Error('Invalid asset job envelope.');
  }
  return value as unknown as AssetJobEnvelope;
}

async function sha256Stream(stream: Readable) {
  const hash = createHash('sha256');
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isFinalAttempt(job: Job<AssetJobEnvelope>) {
  const attempts = typeof job.opts?.attempts === 'number' ? job.opts.attempts : 1;
  return job.attemptsMade + 1 >= attempts;
}

function safeStorageFailureMessage() {
  return 'Storage operation failed.';
}

function logContext(envelope: AssetJobEnvelope) {
  return {
    correlationId: envelope.correlationId,
    jobId: envelope.jobId,
    workspaceId: envelope.workspaceId,
    projectId: envelope.projectId ?? null,
    assetId: envelope.assetId,
  };
}
