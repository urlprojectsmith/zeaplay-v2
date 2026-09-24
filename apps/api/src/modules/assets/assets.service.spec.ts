import {
  BadRequestException,
  ConflictException,
  GoneException,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AssetLifecycle, AssetStatus, MembershipStatus } from '@prisma/client';
import { validate } from 'class-validator';
import { AssetsService } from './assets.service';
import {
  StorageRetentionPolicyUpdateDto,
  WorkspaceFileBulkActionDto,
  WorkspaceFileQueryDto,
} from './dto/workspace-file.dto';

const tenant = {
  userId: '00000000-0000-4000-8000-000000000001',
  agencyId: '00000000-0000-4000-8000-000000000002',
  workspaceId: '00000000-0000-4000-8000-000000000003',
  workspaceMembershipId: '00000000-0000-4000-8000-000000000004',
  agencyMembershipId: '00000000-0000-4000-8000-000000000005',
  roleId: '00000000-0000-4000-8000-000000000006',
  roleName: 'MEMBER',
  permissions: [],
  accessSource: 'WORKSPACE_MEMBERSHIP' as const,
};

describe('AssetsService Phase 13.1 storage core', () => {
  beforeEach(() => {
    Object.assign(process.env, {
      NODE_ENV: 'test',
      APP_ENV: 'test',
      WEB_APP_URL: 'http://localhost:3000',
      API_PUBLIC_URL: 'http://localhost:4000',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      DIRECT_DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      REDIS_CACHE_URL: 'redis://localhost:6379/0',
      REDIS_QUEUE_URL: 'redis://localhost:6379/1',
      REDIS_REALTIME_URL: 'redis://localhost:6379/2',
      REDIS_RATE_LIMIT_URL: 'redis://localhost:6379/3',
      JWT_ACCESS_SECRET: 'x'.repeat(32),
      MAX_UPLOAD_BYTES: '1024',
      STORAGE_DELETE_GRACE_DAYS: '30',
      ALLOWED_MIME_TYPES: 'text/plain,image/png',
      UPLOAD_URL_TTL_SECONDS: '600',
      DOWNLOAD_URL_TTL_SECONDS: '300',
      DEFAULT_STORAGE_LIMIT_BYTES: '1000',
      MINIO_ENDPOINT: 'localhost',
      MINIO_ACCESS_KEY: 'minio-test-access-key',
      MINIO_SECRET_KEY: 'minio-test-secret-key',
      MINIO_BUCKET: 'test-bucket',
      EMAIL_FROM: 'noreply@example.com',
      RESEND_API_KEY: 'test-resend-key',
      OTP_PEPPER: 'y'.repeat(32),
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
    });
  });

  it('creates a server-keyed pending file and durable quota reservation', async () => {
    const { service, prisma, tx, storage } = buildService();
    tx.workspace.findUniqueOrThrow.mockResolvedValue({ storageLimitBytes: 1000n });
    tx.asset.aggregate.mockResolvedValue({ _sum: { sizeBytes: 100n } });
    tx.storageUploadReservation.aggregate.mockResolvedValue({ _sum: { reservedBytes: 200n } });
    tx.asset.create.mockImplementation(({ data }) => Promise.resolve(assetRecord(data)));
    prisma.workspaceMembership.findUnique.mockResolvedValue({
      id: tenant.workspaceMembershipId,
      status: MembershipStatus.ACTIVE,
    });

    const result = await service.initWorkspaceUpload(
      tenant,
      {
        filename: 'safe.txt',
        mimeType: 'text/plain',
        sizeBytes: 100,
      },
      'corr-1',
    );

    expect(result.file.storageKey).toBeUndefined();
    expect(result.file.storageBucket).toBeUndefined();
    expect(tx.storageUploadReservation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workspaceId: tenant.workspaceId,
          membershipId: tenant.workspaceMembershipId,
          reservedBytes: 100n,
        }),
      }),
    );
    const createData = tx.asset.create.mock.calls[0][0].data;
    expect(createData.storageKey).toMatch(
      new RegExp(`^workspaces/${tenant.workspaceId}/files/.+/original$`),
    );
    expect(createData.storageKey).not.toContain('safe.txt');
    expect(storage.createPresignedUploadUrl).toHaveBeenCalledWith(createData.storageKey, 600);
    expect(tx.$queryRaw).toHaveBeenCalled();
  });

  it.each(['..\\evil.txt', '../evil.txt', '/absolute.txt', 'folder/file.txt', '%2e%2e.txt'])(
    'rejects unsafe filename %s before object-key generation',
    async (filename) => {
      const { service, prisma } = buildService();
      prisma.workspaceMembership.findUnique.mockResolvedValue({
        id: tenant.workspaceMembershipId,
        status: MembershipStatus.ACTIVE,
      });

      await expect(
        service.initWorkspaceUpload(
          tenant,
          { filename, mimeType: 'text/plain', sizeBytes: 100 },
          'corr-1',
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    },
  );

  it('keeps very long display filenames out of the object key', async () => {
    const { service, prisma, tx } = buildService();
    tx.workspace.findUniqueOrThrow.mockResolvedValue({ storageLimitBytes: 1000n });
    tx.asset.aggregate.mockResolvedValue({ _sum: { sizeBytes: 0n } });
    tx.storageUploadReservation.aggregate.mockResolvedValue({ _sum: { reservedBytes: 0n } });
    tx.asset.create.mockImplementation(({ data }) => Promise.resolve(assetRecord(data)));
    prisma.workspaceMembership.findUnique.mockResolvedValue({
      id: tenant.workspaceMembershipId,
      status: MembershipStatus.ACTIVE,
    });
    const filename = `${'a'.repeat(300)}.txt`;

    await service.initWorkspaceUpload(
      tenant,
      { filename, mimeType: 'text/plain', sizeBytes: 100 },
      'corr-1',
    );

    const createData = tx.asset.create.mock.calls[0][0].data;
    expect(createData.originalFilename).toHaveLength(255);
    expect(createData.storageKey).not.toContain('a'.repeat(20));
  });

  it('rejects inactive uploader membership before reservation', async () => {
    const { service, prisma } = buildService();
    prisma.workspaceMembership.findUnique.mockResolvedValue({
      id: tenant.workspaceMembershipId,
      status: MembershipStatus.SUSPENDED,
    });

    await expect(
      service.initWorkspaceUpload(
        tenant,
        { filename: 'safe.txt', mimeType: 'text/plain', sizeBytes: 100 },
        'corr-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects disallowed MIME and oversized files before reservation', async () => {
    const { service, prisma } = buildService();
    prisma.workspaceMembership.findUnique.mockResolvedValue({
      id: tenant.workspaceMembershipId,
      status: MembershipStatus.ACTIVE,
    });

    await expect(
      service.initWorkspaceUpload(
        tenant,
        { filename: 'safe.exe', mimeType: 'application/x-msdownload', sizeBytes: 100 },
        'corr-1',
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(
      service.initWorkspaceUpload(
        tenant,
        { filename: 'safe.txt', mimeType: 'text/plain', sizeBytes: 2048 },
        'corr-1',
      ),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('validates source metadata against same-Workspace entities', async () => {
    const { service, prisma, tx } = buildService();
    tx.workspace.findUniqueOrThrow.mockResolvedValue({ storageLimitBytes: 1000n });
    tx.asset.aggregate.mockResolvedValue({ _sum: { sizeBytes: 0n } });
    tx.storageUploadReservation.aggregate.mockResolvedValue({ _sum: { reservedBytes: 0n } });
    tx.asset.create.mockImplementation(({ data }) => Promise.resolve(assetRecord(data)));
    prisma.workspaceMembership.findUnique.mockResolvedValue({
      id: tenant.workspaceMembershipId,
      status: MembershipStatus.ACTIVE,
    });
    prisma.project.findFirst.mockResolvedValue({ id: '00000000-0000-4000-8000-000000000099' });

    await service.initWorkspaceUpload(
      tenant,
      {
        filename: 'safe.txt',
        mimeType: 'text/plain',
        sizeBytes: 100,
        sourceModule: 'PROJECT',
        sourceEntityId: '00000000-0000-4000-8000-000000000099',
      },
      'corr-1',
    );

    expect(prisma.project.findFirst).toHaveBeenCalledWith({
      where: {
        id: '00000000-0000-4000-8000-000000000099',
        workspaceId: tenant.workspaceId,
        status: { not: 'ARCHIVED' },
      },
      select: { id: true },
    });
    expect(tx.asset.create.mock.calls[0][0].data).toMatchObject({
      sourceModule: 'PROJECT',
      sourceEntityType: 'PROJECT',
      sourceEntityId: '00000000-0000-4000-8000-000000000099',
    });
  });

  it('rejects forged or inconsistent source metadata', async () => {
    const { service, prisma } = buildService();
    prisma.workspaceMembership.findUnique.mockResolvedValue({
      id: tenant.workspaceMembershipId,
      status: MembershipStatus.ACTIVE,
    });
    prisma.project.findFirst.mockResolvedValue(null);

    await expect(
      service.initWorkspaceUpload(
        tenant,
        {
          filename: 'safe.txt',
          mimeType: 'text/plain',
          sizeBytes: 100,
          sourceModule: 'GENERAL',
          sourceEntityId: '00000000-0000-4000-8000-000000000099',
        },
        'corr-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.initWorkspaceUpload(
        tenant,
        {
          filename: 'safe.txt',
          mimeType: 'text/plain',
          sizeBytes: 100,
          sourceModule: 'PROJECT',
          sourceEntityType: 'TASK',
          sourceEntityId: '00000000-0000-4000-8000-000000000099',
        },
        'corr-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.initWorkspaceUpload(
        tenant,
        {
          filename: 'safe.txt',
          mimeType: 'text/plain',
          sizeBytes: 100,
          sourceModule: 'PROJECT',
          sourceEntityId: '00000000-0000-4000-8000-000000000099',
        },
        'corr-1',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('counts active bytes plus unexpired reservations before allowing uploads', async () => {
    const { service, prisma, tx } = buildService();
    prisma.workspaceMembership.findUnique.mockResolvedValue({
      id: tenant.workspaceMembershipId,
      status: MembershipStatus.ACTIVE,
    });
    tx.workspace.findUniqueOrThrow.mockResolvedValue({ storageLimitBytes: 250n });
    tx.asset.aggregate.mockResolvedValue({ _sum: { sizeBytes: 100n } });
    tx.storageUploadReservation.aggregate.mockResolvedValue({ _sum: { reservedBytes: 100n } });

    await expect(
      service.initWorkspaceUpload(
        tenant,
        { filename: 'safe.txt', mimeType: 'text/plain', sizeBytes: 100 },
        'corr-1',
      ),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(tx.asset.create).not.toHaveBeenCalled();
  });

  it('finalizes only after object-store metadata verifies size and consumes reservation once', async () => {
    const { service, prisma, tx, storage } = buildService();
    const pending = assetRecord({
      id: '00000000-0000-4000-8000-000000000010',
      status: AssetStatus.UPLOADING,
      sizeBytes: 100n,
      storageKey: 'workspaces/ws/files/file/original',
      uploadExpiresAt: new Date(Date.now() + 60_000),
    });
    prisma.asset.findFirst.mockResolvedValue(pending);
    storage.getMetadata.mockResolvedValue({ key: pending.storageKey, size: 100, etag: 'etag-1' });
    tx.asset.findUniqueOrThrow.mockResolvedValue(pending);
    tx.storageUploadReservation.findUnique.mockResolvedValue({
      id: 'reservation-1',
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      releasedAt: null,
    });
    tx.asset.update.mockResolvedValue(assetRecord({ ...pending, status: AssetStatus.READY }));

    const result = await service.completeWorkspaceUpload(
      tenant,
      pending.id,
      { sizeBytes: 100 },
      'corr-2',
    );

    expect(result.status).toBe(AssetStatus.READY);
    expect(tx.storageUploadReservation.update).toHaveBeenCalledWith({
      where: { id: 'reservation-1' },
      data: { consumedAt: expect.any(Date) },
    });
  });

  it('rejects finalize when object is missing or actual size differs', async () => {
    const { service, prisma, storage } = buildService();
    const pending = assetRecord({
      status: AssetStatus.UPLOADING,
      sizeBytes: 100n,
      uploadExpiresAt: new Date(Date.now() + 60_000),
    });
    prisma.asset.findFirst.mockResolvedValue(pending);
    storage.getMetadata.mockRejectedValueOnce(new Error('missing'));

    await expect(
      service.completeWorkspaceUpload(tenant, pending.id, { sizeBytes: 100 }, 'corr-2'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    storage.getMetadata.mockResolvedValueOnce({ key: pending.storageKey, size: 101 });
    await expect(
      service.completeWorkspaceUpload(tenant, pending.id, { sizeBytes: 100 }, 'corr-2'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('is idempotent when finalize is retried for an active file', async () => {
    const { service, prisma, storage } = buildService();
    prisma.asset.findFirst.mockResolvedValue(
      assetRecord({ status: AssetStatus.READY, sizeBytes: 100n }),
    );

    await service.completeWorkspaceUpload(
      tenant,
      '00000000-0000-4000-8000-000000000010',
      { sizeBytes: 100 },
      'corr-2',
    );

    expect(storage.getMetadata).not.toHaveBeenCalled();
  });

  it('rejects expired pending reservations and releases them', async () => {
    const { service, prisma } = buildService();
    prisma.asset.findFirst.mockResolvedValue(
      assetRecord({
        status: AssetStatus.UPLOADING,
        uploadExpiresAt: new Date(Date.now() - 60_000),
      }),
    );

    await expect(
      service.completeWorkspaceUpload(
        tenant,
        '00000000-0000-4000-8000-000000000010',
        { sizeBytes: 100 },
        'corr-2',
      ),
    ).rejects.toBeInstanceOf(GoneException);
    expect(prisma.storageUploadReservation.updateMany).toHaveBeenCalled();
  });

  it('returns usage derived from active files and pending reservations', async () => {
    const { service, prisma } = buildService();
    prisma.asset.aggregate.mockResolvedValue({ _sum: { sizeBytes: 250n } });
    prisma.storageUploadReservation.aggregate.mockResolvedValue({ _sum: { reservedBytes: 125n } });
    prisma.workspace.findUniqueOrThrow.mockResolvedValue({ storageLimitBytes: 1000n });

    await expect(service.storageUsage(tenant)).resolves.toMatchObject({
      usedBytes: 250,
      reservedBytes: 125,
      quotaBytes: 1000,
      availableBytes: 625,
      usagePercent: 37.5,
    });
  });

  it('denies pending or failed downloads and supports historical active assets without reservations', async () => {
    const { service, prisma, storage } = buildService();
    prisma.asset.findFirst.mockResolvedValueOnce(assetRecord({ status: AssetStatus.UPLOADING }));
    await expect(
      service.createWorkspaceDownloadUrl(tenant, '00000000-0000-4000-8000-000000000010'),
    ).rejects.toBeInstanceOf(ConflictException);

    prisma.asset.findFirst.mockResolvedValueOnce(assetRecord({ status: AssetStatus.FAILED }));
    await expect(
      service.createWorkspaceDownloadUrl(tenant, '00000000-0000-4000-8000-000000000010'),
    ).rejects.toBeInstanceOf(ConflictException);

    prisma.asset.findFirst.mockResolvedValueOnce(assetRecord({ status: AssetStatus.READY }));
    await expect(
      service.createWorkspaceDownloadUrl(tenant, '00000000-0000-4000-8000-000000000010'),
    ).resolves.toMatchObject({ expiresInSeconds: 300 });
    expect(storage.createPresignedDownloadUrl).toHaveBeenCalledWith(
      'workspaces/ws/files/file/original',
      300,
    );
  });

  it('archives active files idempotently and excludes archived files from the default list', async () => {
    const { service, prisma, audit } = buildService();
    const active = assetRecord({ status: AssetStatus.READY, lifecycle: AssetLifecycle.ACTIVE });
    const archived = assetRecord({
      ...active,
      lifecycle: AssetLifecycle.ARCHIVED,
      archivedAt: new Date(),
    });
    prisma.asset.findFirst.mockResolvedValueOnce(active);
    prisma.asset.update.mockResolvedValueOnce(archived);

    await expect(service.archiveWorkspaceFile(tenant, active.id)).resolves.toMatchObject({
      lifecycle: AssetLifecycle.ARCHIVED,
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'storage.file_archived' }),
    );

    prisma.asset.findFirst.mockResolvedValueOnce(archived);
    await service.archiveWorkspaceFile(tenant, active.id);
    expect(prisma.asset.update).toHaveBeenCalledTimes(1);

    prisma.asset.findMany.mockResolvedValue([]);
    prisma.asset.count.mockResolvedValue(0);
    await service.listWorkspaceFiles(tenant, {
      page: 1,
      pageSize: 20,
      sortBy: 'createdAt',
      sortDirection: 'desc',
    });
    expect(prisma.asset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ lifecycle: AssetLifecycle.ACTIVE }),
      }),
    );
  });

  it('applies server-side workspace search, filters, category, sorting, and page bounds safely', async () => {
    const { service, prisma } = buildService();
    prisma.asset.findMany.mockResolvedValue([]);
    prisma.asset.count.mockResolvedValue(0);
    prisma.workspaceMembership.findUnique.mockResolvedValue({
      id: tenant.workspaceMembershipId,
      status: MembershipStatus.ACTIVE,
    });

    await service.listWorkspaceFiles(tenant, {
      page: 2,
      pageSize: 500,
      search: 'Brief',
      lifecycle: AssetLifecycle.ARCHIVED,
      sourceModule: 'PROJECT',
      category: 'PDF',
      uploader: tenant.workspaceMembershipId,
      createdFrom: '2026-09-01T00:00:00.000Z',
      createdTo: '2026-09-30T23:59:59.000Z',
      sort: 'NAME_ASC',
      sortBy: 'createdAt',
      sortDirection: 'desc',
    });

    expect(prisma.asset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: tenant.workspaceId,
          lifecycle: AssetLifecycle.ARCHIVED,
          sourceModule: 'PROJECT',
          mimeType: 'application/pdf',
          uploadedByMembershipId: tenant.workspaceMembershipId,
          OR: expect.arrayContaining([
            expect.objectContaining({
              originalFilename: expect.objectContaining({
                contains: 'Brief',
                mode: 'insensitive',
              }),
            }),
            expect.objectContaining({
              displayName: expect.objectContaining({ contains: 'Brief', mode: 'insensitive' }),
            }),
          ]),
        }),
        orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
        skip: 100,
        take: 100,
      }),
    );
    expect(prisma.workspaceMembership.findUnique).toHaveBeenCalledWith({
      where: {
        id_workspaceId: {
          id: tenant.workspaceMembershipId,
          workspaceId: tenant.workspaceId,
        },
      },
      select: { id: true },
    });
  });

  it('validates metadata search length and bulk action limits at the DTO boundary', async () => {
    const longSearch = Object.assign(new WorkspaceFileQueryDto(), {
      search: 'x'.repeat(151),
    });
    const unsafeSort = Object.assign(new WorkspaceFileQueryDto(), {
      sort: 'storageKey',
    });
    const tooMany = Object.assign(new WorkspaceFileBulkActionDto(), {
      action: 'ARCHIVE',
      fileIds: Array.from(
        { length: 51 },
        (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      ),
    });
    const empty = Object.assign(new WorkspaceFileBulkActionDto(), {
      action: 'ARCHIVE',
      fileIds: [],
    });

    await expect(validate(longSearch)).resolves.not.toHaveLength(0);
    await expect(validate(unsafeSort)).resolves.not.toHaveLength(0);
    await expect(validate(tooMany)).resolves.not.toHaveLength(0);
    await expect(validate(empty)).resolves.not.toHaveLength(0);
  });

  it('rejects foreign uploader filters and inverted date ranges before listing', async () => {
    const { service, prisma } = buildService();
    prisma.workspaceMembership.findUnique.mockResolvedValue(null);

    await expect(
      service.listWorkspaceFiles(tenant, {
        page: 1,
        pageSize: 20,
        sortBy: 'createdAt',
        sortDirection: 'desc',
        uploader: '00000000-0000-4000-8000-000000000099',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.asset.findMany).not.toHaveBeenCalled();

    await expect(
      service.listWorkspaceFiles(tenant, {
        page: 1,
        pageSize: 20,
        sortBy: 'createdAt',
        sortDirection: 'desc',
        createdFrom: '2026-10-01T00:00:00.000Z',
        createdTo: '2026-09-01T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('performs bounded bulk actions with per-file workspace validation', async () => {
    const { service, prisma, storage, tx } = buildService();
    const active = assetRecord({ status: AssetStatus.READY, lifecycle: AssetLifecycle.ARCHIVED });
    prisma.asset.findMany.mockResolvedValue([{ id: active.id }]);
    prisma.asset.findFirst.mockResolvedValueOnce(active);
    storage.getMetadata.mockResolvedValueOnce({ key: active.storageKey, size: 100 });
    tx.asset.updateMany.mockResolvedValueOnce({ count: 1 });
    tx.asset.findUniqueOrThrow.mockResolvedValueOnce(
      assetRecord({ ...active, lifecycle: AssetLifecycle.ACTIVE }),
    );

    await expect(
      service.bulkWorkspaceFileAction(tenant, {
        action: 'RESTORE',
        fileIds: [active.id, '00000000-0000-4000-8000-000000000099'],
      }),
    ).resolves.toMatchObject({
      action: 'RESTORE',
      results: [
        { fileId: active.id, ok: true },
        { fileId: '00000000-0000-4000-8000-000000000099', ok: false, code: 'FILE_NOT_FOUND' },
      ],
    });
  });

  it('soft deletes active or archived files without extending grace on retry', async () => {
    const { service, prisma, audit } = buildService();
    const active = assetRecord({ status: AssetStatus.READY, lifecycle: AssetLifecycle.ACTIVE });
    const pending = assetRecord({
      ...active,
      lifecycle: AssetLifecycle.PENDING_DELETE,
      deleteRequestedAt: new Date('2026-09-24T00:00:00.000Z'),
      pendingDeleteAt: new Date('2026-09-24T00:00:00.000Z'),
      purgeAfter: new Date('2026-10-24T00:00:00.000Z'),
    });
    prisma.asset.findFirst.mockResolvedValueOnce(active);
    prisma.storageRetentionPolicy.findUnique.mockResolvedValueOnce({ deleteGraceDays: 7 });
    prisma.asset.update.mockResolvedValueOnce(pending);

    await expect(service.requestWorkspaceFileDelete(tenant, active.id)).resolves.toMatchObject({
      lifecycle: AssetLifecycle.PENDING_DELETE,
    });
    const deleteData = prisma.asset.update.mock.calls[0][0].data;
    expect(deleteData.purgeAfter.getTime() - deleteData.deleteRequestedAt.getTime()).toBe(
      7 * 86_400_000,
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'storage.file_delete_requested' }),
    );

    prisma.asset.findFirst.mockResolvedValueOnce(pending);
    await service.requestWorkspaceFileDelete(tenant, active.id);
    expect(prisma.asset.update).toHaveBeenCalledTimes(1);
  });

  it('restores archived and pending-delete files only while object exists and state is recoverable', async () => {
    const { service, prisma, tx, storage } = buildService();
    const pending = assetRecord({
      status: AssetStatus.READY,
      lifecycle: AssetLifecycle.PENDING_DELETE,
      purgeAfter: new Date(Date.now() + 60_000),
    });
    const restored = assetRecord({ ...pending, lifecycle: AssetLifecycle.ACTIVE });
    prisma.asset.findFirst.mockResolvedValueOnce(pending);
    storage.getMetadata.mockResolvedValueOnce({ key: pending.storageKey, size: 100 });
    tx.asset.updateMany.mockResolvedValueOnce({ count: 1 });
    tx.asset.findUniqueOrThrow.mockResolvedValueOnce(restored);

    await expect(service.restoreWorkspaceFile(tenant, pending.id)).resolves.toMatchObject({
      lifecycle: AssetLifecycle.ACTIVE,
    });

    prisma.asset.findFirst.mockResolvedValueOnce(
      assetRecord({ status: AssetStatus.READY, lifecycle: AssetLifecycle.PURGING }),
    );
    await expect(service.restoreWorkspaceFile(tenant, pending.id)).rejects.toBeInstanceOf(
      ConflictException,
    );

    prisma.asset.findFirst.mockResolvedValueOnce(
      assetRecord({ status: AssetStatus.READY, lifecycle: AssetLifecycle.ARCHIVED }),
    );
    storage.getMetadata.mockRejectedValueOnce(new Error('missing'));
    await expect(service.restoreWorkspaceFile(tenant, pending.id)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    prisma.asset.findFirst.mockResolvedValueOnce(
      assetRecord({ status: AssetStatus.READY, lifecycle: AssetLifecycle.PURGED }),
    );
    await expect(service.restoreWorkspaceFile(tenant, pending.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('makes restore-vs-purge deterministic when purge wins the DB claim first', async () => {
    const { service, prisma, tx, storage } = buildService();
    const pending = assetRecord({
      status: AssetStatus.READY,
      lifecycle: AssetLifecycle.PENDING_DELETE,
      purgeAfter: new Date(Date.now() - 60_000),
    });
    prisma.asset.findFirst.mockResolvedValueOnce(pending);
    storage.getMetadata.mockResolvedValueOnce({ key: pending.storageKey, size: 100 });
    tx.asset.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(service.restoreWorkspaceFile(tenant, pending.id)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.asset.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('blocks pending-delete downloads while archived downloads remain authorized', async () => {
    const { service, prisma, storage } = buildService();
    prisma.asset.findFirst.mockResolvedValueOnce(
      assetRecord({ status: AssetStatus.READY, lifecycle: AssetLifecycle.PENDING_DELETE }),
    );
    await expect(service.createWorkspaceDownloadUrl(tenant, 'file-1')).rejects.toBeInstanceOf(
      ConflictException,
    );

    prisma.asset.findFirst.mockResolvedValueOnce(
      assetRecord({ status: AssetStatus.READY, lifecycle: AssetLifecycle.ARCHIVED }),
    );
    await expect(service.createWorkspaceDownloadUrl(tenant, 'file-1')).resolves.toMatchObject({
      expiresInSeconds: 300,
    });
    expect(storage.createPresignedDownloadUrl).toHaveBeenCalled();
  });

  it('counts archived, pending-delete, and purging bytes but excludes purged bytes', async () => {
    const { service, prisma } = buildService();
    prisma.asset.aggregate.mockResolvedValue({ _sum: { sizeBytes: 400n } });
    prisma.storageUploadReservation.aggregate.mockResolvedValue({ _sum: { reservedBytes: 0n } });
    prisma.workspace.findUniqueOrThrow.mockResolvedValue({ storageLimitBytes: 1000n });

    await service.storageUsage(tenant);

    expect(prisma.asset.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          lifecycle: {
            in: [
              AssetLifecycle.ACTIVE,
              AssetLifecycle.ARCHIVED,
              AssetLifecycle.PENDING_DELETE,
              AssetLifecycle.PURGING,
            ],
          },
        }),
      }),
    );
  });

  it('releases expired upload reservations and never deletes active objects during cleanup', async () => {
    const { service, prisma, storage } = buildService();
    const expiredUpload = assetRecord({
      status: AssetStatus.UPLOADING,
      lifecycle: AssetLifecycle.ACTIVE,
    });
    const activeReady = assetRecord({
      id: '00000000-0000-4000-8000-000000000011',
      status: AssetStatus.READY,
      lifecycle: AssetLifecycle.ACTIVE,
    });
    prisma.storageUploadReservation.findMany.mockResolvedValue([
      { id: 'r1', fileId: expiredUpload.id, workspaceId: tenant.workspaceId, file: expiredUpload },
      { id: 'r2', fileId: activeReady.id, workspaceId: tenant.workspaceId, file: activeReady },
    ]);
    prisma.storageUploadReservation.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.cleanupExpiredUploadReservations()).resolves.toMatchObject({
      scanned: 2,
      released: 2,
    });
    expect(prisma.asset.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: expiredUpload.id, status: AssetStatus.UPLOADING }),
        data: { status: AssetStatus.FAILED },
      }),
    );
    expect(storage.deleteObject).toHaveBeenCalledTimes(1);
    expect(storage.deleteObject).toHaveBeenCalledWith(expiredUpload.storageKey);
  });

  it('claims due purges once, deletes object before PURGED, and recovers transient failures', async () => {
    const { service, prisma, storage, audit } = buildService();
    const due = assetRecord({
      status: AssetStatus.READY,
      lifecycle: AssetLifecycle.PENDING_DELETE,
      purgeAfter: new Date(Date.now() - 60_000),
    });
    prisma.asset.findMany.mockResolvedValue([due]);
    prisma.asset.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 1 });
    storage.deleteObject.mockResolvedValueOnce(undefined);

    await expect(service.purgeDueFiles()).resolves.toMatchObject({ scanned: 1, purged: 1 });
    expect(prisma.asset.updateMany.mock.calls[0][0].data).toMatchObject({
      lifecycle: AssetLifecycle.PURGING,
    });
    expect(storage.deleteObject).toHaveBeenCalledWith(due.storageKey);
    expect(prisma.asset.updateMany.mock.calls[1][0].data).toMatchObject({
      lifecycle: AssetLifecycle.PURGED,
      purgedAt: expect.any(Date),
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'storage.file_purged' }),
    );

    prisma.asset.findMany.mockResolvedValueOnce([due]);
    prisma.asset.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 1 });
    storage.deleteObject.mockRejectedValueOnce(new Error('storage down'));
    await expect(service.purgeDueFiles()).resolves.toMatchObject({ scanned: 1, failed: 1 });
    expect(prisma.asset.updateMany.mock.calls.at(-1)?.[0].data).toMatchObject({
      lifecycle: AssetLifecycle.PENDING_DELETE,
      purgeFailureCode: 'STORAGE_UNAVAILABLE',
      metadata: expect.objectContaining({ storagePurgeAttempts: 1 }),
    });
  });

  it('bounds purge retries and stops reselecting exhausted failures', async () => {
    const { service, prisma, storage } = buildService();
    const due = assetRecord({
      status: AssetStatus.READY,
      lifecycle: AssetLifecycle.PENDING_DELETE,
      purgeAfter: new Date(Date.now() - 60_000),
      metadata: { storagePurgeAttempts: 2 },
    });
    prisma.asset.findMany.mockResolvedValue([due]);
    prisma.asset.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 1 });
    storage.deleteObject.mockRejectedValueOnce(new Error('storage down'));

    await expect(service.purgeDueFiles()).resolves.toMatchObject({ scanned: 1, failed: 1 });
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

  it('returns default and workspace retention policy safely', async () => {
    const { service, prisma, audit } = buildService();
    prisma.storageRetentionPolicy.findUnique.mockResolvedValueOnce(null);
    await expect(service.getRetentionPolicy(tenant)).resolves.toMatchObject({
      deleteGraceDays: 30,
      source: 'DEFAULT',
    });

    prisma.storageRetentionPolicy.upsert.mockResolvedValue({
      workspaceId: tenant.workspaceId,
      deleteGraceDays: 14,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await expect(
      service.updateRetentionPolicy(tenant, { deleteGraceDays: 14 }),
    ).resolves.toMatchObject({ deleteGraceDays: 14, source: 'WORKSPACE' });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'storage.retention_policy_updated' }),
    );
  });

  it('validates retention policy grace days range at the DTO boundary', async () => {
    const tooLow = Object.assign(new StorageRetentionPolicyUpdateDto(), { deleteGraceDays: 0 });
    const tooHigh = Object.assign(new StorageRetentionPolicyUpdateDto(), { deleteGraceDays: 366 });
    const valid = Object.assign(new StorageRetentionPolicyUpdateDto(), { deleteGraceDays: 365 });

    await expect(validate(tooLow)).resolves.not.toHaveLength(0);
    await expect(validate(tooHigh)).resolves.not.toHaveLength(0);
    await expect(validate(valid)).resolves.toHaveLength(0);
  });
});

function buildService() {
  const tx = mockPrismaCore();
  const prisma = {
    ...mockPrismaCore(),
    $transaction: jest.fn((input) => (Array.isArray(input) ? Promise.all(input) : input(tx))),
  };
  const audit = { record: jest.fn() };
  const storage = {
    createPresignedUploadUrl: jest.fn().mockResolvedValue('https://storage/upload'),
    createPresignedDownloadUrl: jest.fn().mockResolvedValue('https://storage/download'),
    getMetadata: jest.fn(),
    deleteObject: jest.fn().mockResolvedValue(undefined),
  };
  const queue = { add: jest.fn() };
  return {
    service: new AssetsService(prisma as never, audit as never, storage as never, queue as never),
    prisma,
    tx,
    audit,
    storage,
  };
}

function mockPrismaCore() {
  return {
    $queryRaw: jest.fn(),
    workspaceMembership: { findUnique: jest.fn() },
    workspace: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
    asset: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      aggregate: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
    storageUploadReservation: {
      create: jest.fn(),
      aggregate: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    storageRetentionPolicy: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    attachment: { create: jest.fn() },
    projectAttachment: {
      create: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    project: { findFirst: jest.fn() },
    task: { findFirst: jest.fn() },
    ticket: { findFirst: jest.fn() },
    processingJob: { upsert: jest.fn() },
  };
}

function assetRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000010',
    workspaceId: tenant.workspaceId,
    projectId: null,
    createdById: tenant.userId,
    uploadedByMembershipId: tenant.workspaceMembershipId,
    originalFilename: 'safe.txt',
    displayName: 'safe.txt',
    storageBucket: 'test-bucket',
    storageProvider: 'MINIO',
    storageKey: 'workspaces/ws/files/file/original',
    mimeType: 'text/plain',
    extension: 'txt',
    sizeBytes: 100n,
    checksum: null,
    status: AssetStatus.UPLOADING,
    lifecycle: AssetLifecycle.ACTIVE,
    sourceModule: 'GENERAL',
    sourceEntityType: null,
    sourceEntityId: null,
    metadata: {},
    uploadExpiresAt: new Date(Date.now() + 60_000),
    archivedAt: null,
    pendingDeleteAt: null,
    deleteRequestedAt: null,
    purgeAfter: null,
    purgingStartedAt: null,
    purgedAt: null,
    purgeFailureCode: null,
    purgeFailureAt: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}
