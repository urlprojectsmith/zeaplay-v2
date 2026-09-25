import { AssetLifecycle, AssetStatus } from '@prisma/client';
import { StorageRetentionProcessor } from './storage-retention.processor';

describe('StorageRetentionProcessor', () => {
  it('claims due files, deletes the object, and marks PURGED after object deletion', async () => {
    const { processor, prisma, storage } = buildProcessor();
    const due = dueAsset();
    prisma.asset.findMany.mockResolvedValue([due]);
    prisma.asset.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 1 });
    storage.deleteObject.mockResolvedValue(undefined);

    await expect(processor.purgeDueFiles(new Date())).resolves.toMatchObject({
      scanned: 1,
      purged: 1,
    });

    expect(prisma.asset.updateMany.mock.calls[0][0].data).toMatchObject({
      lifecycle: AssetLifecycle.PURGING,
    });
    expect(storage.deleteObject).toHaveBeenCalledWith(due.storageKey);
    expect(prisma.asset.updateMany.mock.calls[1][0].data).toMatchObject({
      lifecycle: AssetLifecycle.PURGED,
      purgedAt: expect.any(Date),
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          superAgencyId: 'super-agency-1',
          agencyId: 'agency-1',
          workspaceId: 'workspace-1',
          action: 'storage.file_purged',
          entityId: due.id,
        }),
      }),
    );
  });

  it('does not double purge when another worker wins the claim', async () => {
    const { processor, prisma, storage } = buildProcessor();
    prisma.asset.findMany.mockResolvedValue([dueAsset()]);
    prisma.asset.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(processor.purgeDueFiles(new Date())).resolves.toMatchObject({
      scanned: 1,
      purged: 0,
      failed: 0,
    });
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it('treats missing objects as idempotently purged and recovers transient failures', async () => {
    const { processor, prisma, storage } = buildProcessor();
    prisma.asset.findMany.mockResolvedValue([dueAsset()]);
    prisma.asset.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 1 });
    storage.deleteObject.mockRejectedValueOnce(
      Object.assign(new Error('not found'), { statusCode: 404 }),
    );

    await expect(processor.purgeDueFiles(new Date())).resolves.toMatchObject({ purged: 1 });

    prisma.asset.findMany.mockResolvedValueOnce([dueAsset()]);
    prisma.asset.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 1 });
    storage.deleteObject.mockRejectedValueOnce(new Error('network'));

    await expect(processor.purgeDueFiles(new Date())).resolves.toMatchObject({ failed: 1 });
    expect(prisma.asset.updateMany.mock.calls.at(-1)?.[0].data).toMatchObject({
      lifecycle: AssetLifecycle.PENDING_DELETE,
      purgeFailureCode: 'STORAGE_UNAVAILABLE',
      metadata: expect.objectContaining({ storagePurgeAttempts: 1 }),
    });
  });

  it('bounds transient purge retries and excludes exhausted rows from due scans', async () => {
    const { processor, prisma, storage } = buildProcessor();
    prisma.asset.findMany.mockResolvedValue([dueAsset({ metadata: { storagePurgeAttempts: 2 } })]);
    prisma.asset.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 1 });
    storage.deleteObject.mockRejectedValueOnce(new Error('network'));

    await expect(processor.purgeDueFiles(new Date())).resolves.toMatchObject({
      scanned: 1,
      failed: 1,
    });

    expect(prisma.asset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { purgeFailureCode: null },
            { purgeFailureCode: { not: 'PURGE_RETRIES_EXHAUSTED' } },
          ],
        }),
      }),
    );
    expect(prisma.asset.updateMany.mock.calls.at(-1)?.[0].data).toMatchObject({
      lifecycle: AssetLifecycle.PENDING_DELETE,
      purgeFailureCode: 'PURGE_RETRIES_EXHAUSTED',
      metadata: expect.objectContaining({ storagePurgeAttempts: 3 }),
    });
  });

  it('releases expired upload reservations and does not delete ready active objects', async () => {
    const { processor, prisma, storage } = buildProcessor();
    const upload = {
      id: 'reservation-1',
      fileId: 'file-1',
      workspaceId: 'workspace-1',
      file: {
        id: 'file-1',
        workspaceId: 'workspace-1',
        storageKey: 'workspaces/workspace-1/files/file-1/original',
        status: AssetStatus.UPLOADING,
        lifecycle: AssetLifecycle.ACTIVE,
      },
    };
    const ready = {
      ...upload,
      id: 'reservation-2',
      fileId: 'file-2',
      file: { ...upload.file, id: 'file-2', status: AssetStatus.READY },
    };
    prisma.storageUploadReservation.findMany.mockResolvedValue([upload, ready]);
    prisma.storageUploadReservation.updateMany.mockResolvedValue({ count: 1 });

    await expect(processor.releaseExpiredReservations(new Date())).resolves.toMatchObject({
      scanned: 2,
      released: 2,
    });

    expect(prisma.asset.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'file-1', status: AssetStatus.UPLOADING }),
        data: { status: AssetStatus.FAILED },
      }),
    );
    expect(storage.deleteObject).toHaveBeenCalledTimes(1);
  });
});

function buildProcessor() {
  const prisma = {
    asset: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    storageUploadReservation: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
    $transaction: jest.fn((operations) => Promise.all(operations)),
  };
  const storage = {
    deleteObject: jest.fn().mockResolvedValue(undefined),
  };
  return {
    processor: new StorageRetentionProcessor(prisma as never, storage as never),
    prisma,
    storage,
  };
}

function dueAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: 'file-1',
    workspaceId: 'workspace-1',
    storageKey: 'workspaces/workspace-1/files/file-1/original',
    metadata: {},
    sourceModule: 'GENERAL',
    sourceEntityType: null,
    sourceEntityId: null,
    purgeAfter: new Date(Date.now() - 60_000),
    workspace: {
      agencyId: 'agency-1',
      agency: { superAgencyId: 'super-agency-1' },
    },
    ...overrides,
  };
}
