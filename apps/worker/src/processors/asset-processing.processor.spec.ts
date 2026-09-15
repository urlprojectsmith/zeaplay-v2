import { Readable } from 'node:stream';
import { AssetProcessingProcessor } from './asset-processing.processor';

const envelope = {
  version: 1,
  jobId: '00000000-0000-4000-8000-000000000001',
  correlationId: 'correlation-id',
  workspaceId: '00000000-0000-4000-8000-000000000002',
  projectId: '00000000-0000-4000-8000-000000000003',
  assetId: '00000000-0000-4000-8000-000000000004',
  type: 'asset.metadata',
  createdAt: new Date().toISOString(),
} as const;

describe('AssetProcessingProcessor', () => {
  it('marks a processing asset ready after verifying object metadata', async () => {
    const prisma = prismaMock({
      asset: {
        id: envelope.assetId,
        projectId: envelope.projectId,
        workspaceId: envelope.workspaceId,
        storageKey: 'asset-key',
        sizeBytes: BigInt(5),
        status: 'PROCESSING',
        metadata: {},
      },
    });
    const storage = {
      statObject: jest.fn().mockResolvedValue({ size: 5, etag: 'etag' }),
      getObject: jest.fn().mockResolvedValue(Readable.from(Buffer.from('hello'))),
    };
    const processor = new AssetProcessingProcessor(prisma as never, storage as never);

    await processor.process({ data: envelope, attemptsMade: 0 } as never);

    expect(prisma.asset.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'READY',
          checksum: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
        }),
      }),
    );
    expect(prisma.processingJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SUCCEEDED' }) }),
    );
  });

  it('fails safely when the asset is missing or tenant scoped lookup does not match', async () => {
    const prisma = prismaMock({ asset: null });
    const processor = new AssetProcessingProcessor(prisma as never, {} as never);

    await processor.process({ data: envelope, attemptsMade: 0 } as never);

    expect(prisma.processingJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    );
  });

  it('rejects invalid job envelopes', async () => {
    const processor = new AssetProcessingProcessor(
      prismaMock({ asset: null }) as never,
      {} as never,
    );
    await expect(
      processor.process({ data: { version: 2 }, attemptsMade: 0 } as never),
    ).rejects.toThrow('Invalid asset job envelope.');
  });

  it('tolerates duplicate execution for already ready assets', async () => {
    const prisma = prismaMock({
      asset: {
        id: envelope.assetId,
        projectId: envelope.projectId,
        workspaceId: envelope.workspaceId,
        storageKey: 'asset-key',
        sizeBytes: BigInt(5),
        status: 'READY',
        metadata: {},
      },
    });
    const processor = new AssetProcessingProcessor(prisma as never, {} as never);

    await processor.process({ data: envelope, attemptsMade: 1 } as never);

    expect(prisma.asset.update).not.toHaveBeenCalled();
    expect(prisma.processingJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SUCCEEDED' }) }),
    );
  });

  it('defers retryable storage errors without marking the asset failed before the final attempt', async () => {
    const prisma = prismaMock({
      asset: {
        id: envelope.assetId,
        projectId: envelope.projectId,
        workspaceId: envelope.workspaceId,
        storageKey: 'asset-key',
        sizeBytes: BigInt(5),
        status: 'PROCESSING',
        metadata: {},
      },
    });
    const storage = {
      statObject: jest.fn().mockRejectedValue(new Error('temporary outage with token-like data')),
    };
    const processor = new AssetProcessingProcessor(prisma as never, storage as never);

    await expect(
      processor.process({ data: envelope, attemptsMade: 0, opts: { attempts: 3 } } as never),
    ).rejects.toThrow('temporary outage');
    expect(prisma.processingJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'QUEUED',
          errorCode: 'STORAGE_UNAVAILABLE',
          errorMessage: 'Storage operation failed.',
        }),
      }),
    );
    expect(prisma.asset.updateMany).not.toHaveBeenCalled();
  });

  it('records terminal storage failure state on the final attempt', async () => {
    const prisma = prismaMock({
      asset: {
        id: envelope.assetId,
        projectId: envelope.projectId,
        workspaceId: envelope.workspaceId,
        storageKey: 'asset-key',
        sizeBytes: BigInt(5),
        status: 'PROCESSING',
        metadata: {},
      },
    });
    const storage = {
      statObject: jest.fn().mockRejectedValue(new Error('temporary outage with token-like data')),
    };
    const processor = new AssetProcessingProcessor(prisma as never, storage as never);

    await expect(
      processor.process({ data: envelope, attemptsMade: 2, opts: { attempts: 3 } } as never),
    ).rejects.toThrow('temporary outage');
    expect(prisma.processingJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          errorCode: 'STORAGE_UNAVAILABLE',
          errorMessage: 'Storage operation failed.',
        }),
      }),
    );
  });
});

function prismaMock({ asset }: { asset: unknown }) {
  const mock = {
    processingJob: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
    asset: {
      findFirst: jest.fn().mockResolvedValue(asset),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn(async (operations: unknown[]) => Promise.all(operations)),
  };
  return mock;
}
