import {
  AssetLifecycle,
  AssetStatus,
  CloudDriveConnectionStatus,
  CloudDriveProvider,
  MembershipStatus,
} from '@prisma/client';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Readable } from 'node:stream';
import { CloudDriveProviderRegistry } from './cloud-drive-provider.registry';
import { CloudDriveTokenEncryptionService } from './cloud-drive-token-encryption.service';
import { CloudDrivesService } from './cloud-drives.service';
import { DropboxAdapter } from './providers/dropbox.adapter';
import { GoogleDriveAdapter } from './providers/google-drive.adapter';
import { OneDriveAdapter } from './providers/onedrive.adapter';
import { CloudProviderHttpError } from './providers/provider-http';

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

describe('CloudDrivesService Phase 13.3 foundation', () => {
  beforeEach(() => {
    Object.assign(process.env, {
      NODE_ENV: 'test',
      APP_ENV: 'test',
      WEB_APP_URL: 'http://localhost:3000',
      API_PUBLIC_URL: 'http://localhost:4000/api/v1',
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
      CLOUD_DRIVE_TOKEN_ENCRYPTION_KEY: '',
      GOOGLE_DRIVE_CLIENT_ID: '',
      GOOGLE_DRIVE_CLIENT_SECRET: '',
      ONEDRIVE_CLIENT_ID: '',
      ONEDRIVE_CLIENT_SECRET: '',
      DROPBOX_CLIENT_ID: '',
      DROPBOX_CLIENT_SECRET: '',
    } as never);
  });

  it('encrypts token material without storing plaintext', () => {
    process.env.CLOUD_DRIVE_TOKEN_ENCRYPTION_KEY = 'z'.repeat(32);
    const encryption = new CloudDriveTokenEncryptionService();

    const ciphertext = encryption.encrypt('access-token-secret');

    expect(ciphertext).not.toContain('access-token-secret');
    expect(encryption.decrypt(ciphertext)).toBe('access-token-secret');
  });

  it('rejects tampered ciphertext', () => {
    process.env.CLOUD_DRIVE_TOKEN_ENCRYPTION_KEY = 'z'.repeat(32);
    const encryption = new CloudDriveTokenEncryptionService();
    const ciphertext = encryption.encrypt('access-token-secret');
    const parts = ciphertext.split('.');
    parts[2] = (parts[2] as string).replace(/^./, (value) => (value === 'A' ? 'B' : 'A'));
    const tampered = parts.join('.');

    expect(() => encryption.decrypt(tampered)).toThrow();
  });

  it('reports providers unavailable unless credentials and encryption are configured', () => {
    const { service } = buildService();

    expect(service.providerStatuses()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: CloudDriveProvider.GOOGLE_DRIVE,
          configured: false,
          available: false,
          status: 'NOT_CONFIGURED',
        }),
      ]),
    );

    process.env.GOOGLE_DRIVE_CLIENT_ID = 'google-client';
    process.env.GOOGLE_DRIVE_CLIENT_SECRET = 'google-secret';
    expect(service.providerStatuses()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: CloudDriveProvider.GOOGLE_DRIVE,
          configured: true,
          available: false,
          status: 'UNAVAILABLE',
        }),
      ]),
    );

    process.env.CLOUD_DRIVE_TOKEN_ENCRYPTION_KEY = 'z'.repeat(32);
    expect(service.providerStatuses()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: CloudDriveProvider.GOOGLE_DRIVE,
          configured: true,
          available: true,
          status: 'AVAILABLE',
        }),
      ]),
    );
  });

  it('selects only safe connection fields for connection listing', async () => {
    const { service, prisma } = buildService();
    prisma.cloudDriveConnection.findMany.mockResolvedValue([]);

    await service.listConnections(tenant);

    expect(prisma.cloudDriveConnection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: tenant.workspaceId },
        select: expect.not.objectContaining({
          encryptedAccessToken: true,
          encryptedRefreshToken: true,
        }),
      }),
    );
  });

  it('stores OAuth state as a hash and encrypts the PKCE verifier', async () => {
    process.env.CLOUD_DRIVE_TOKEN_ENCRYPTION_KEY = 'z'.repeat(32);
    process.env.GOOGLE_DRIVE_CLIENT_ID = 'google-client';
    process.env.GOOGLE_DRIVE_CLIENT_SECRET = 'google-secret';
    const { service, prisma } = buildService();
    prisma.workspaceMembership.findUnique.mockResolvedValue({
      id: tenant.workspaceMembershipId,
      status: MembershipStatus.ACTIVE,
    } as never);
    prisma.cloudDriveOAuthState.findMany.mockResolvedValue([]);
    prisma.cloudDriveOAuthState.create.mockResolvedValue({});

    const result = await service.startConnection(
      tenant,
      CloudDriveProvider.GOOGLE_DRIVE,
      '/workspace/settings',
    );

    const data = prisma.cloudDriveOAuthState.create.mock.calls[0][0].data;
    const url = new URL(result.authorizationUrl);
    expect(data.stateHash).toHaveLength(64);
    expect(data.stateHash).not.toBe(url.searchParams.get('state'));
    expect(data.encryptedPkceVerifier).toMatch(/^v1\./);
    expect(data.encryptedPkceVerifier).not.toContain(url.searchParams.get('code_challenge') ?? '');
    expect(data.workspaceId).toBe(tenant.workspaceId);
    expect(data.actorMembershipId).toBe(tenant.workspaceMembershipId);
  });

  it.each([
    'https://evil.example',
    '//evil.example',
    '/%2f%2fevil.example',
    '/%5Cevil.example',
    '/javascript:alert(1)',
    '/data:text/html,evil',
  ])('rejects unsafe OAuth redirect path %s', async (redirectPath) => {
    process.env.CLOUD_DRIVE_TOKEN_ENCRYPTION_KEY = 'z'.repeat(32);
    process.env.GOOGLE_DRIVE_CLIENT_ID = 'google-client';
    process.env.GOOGLE_DRIVE_CLIENT_SECRET = 'google-secret';
    const { service, prisma } = buildService();
    prisma.workspaceMembership.findUnique.mockResolvedValue({
      id: tenant.workspaceMembershipId,
      status: MembershipStatus.ACTIVE,
    } as never);
    prisma.cloudDriveOAuthState.findMany.mockResolvedValue([]);

    await service.startConnection(tenant, CloudDriveProvider.GOOGLE_DRIVE, redirectPath);

    expect(prisma.cloudDriveOAuthState.create.mock.calls[0][0].data.redirectPath).toBeNull();
  });

  it('rejects expired OAuth state before code exchange', async () => {
    const { service, tx } = buildService();
    tx.cloudDriveOAuthState.findUnique.mockResolvedValue({
      id: 'state-id',
      workspaceId: tenant.workspaceId,
      provider: CloudDriveProvider.GOOGLE_DRIVE,
      actorMembershipId: tenant.workspaceMembershipId,
      encryptedPkceVerifier: null,
      expiresAt: new Date(Date.now() - 1_000),
      consumedAt: null,
      redirectPath: '/workspace/settings',
      workspace: { agencyId: tenant.agencyId },
      actorMembership: { userId: tenant.userId, status: MembershipStatus.ACTIVE },
    } as never);

    await expect(
      service.completeOAuthCallback({ code: 'code', state: 'state' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.cloudDriveOAuthState.updateMany).not.toHaveBeenCalled();
  });

  it('allows only one OAuth callback to consume a state', async () => {
    process.env.CLOUD_DRIVE_TOKEN_ENCRYPTION_KEY = 'z'.repeat(32);
    process.env.GOOGLE_DRIVE_CLIENT_ID = 'google-client';
    process.env.GOOGLE_DRIVE_CLIENT_SECRET = 'google-secret';
    const { service, tx } = buildService();
    tx.cloudDriveOAuthState.findUnique.mockResolvedValue({
      id: 'state-id',
      workspaceId: tenant.workspaceId,
      provider: CloudDriveProvider.GOOGLE_DRIVE,
      actorMembershipId: tenant.workspaceMembershipId,
      encryptedPkceVerifier: null,
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      redirectPath: '/workspace/settings',
      workspace: { agencyId: tenant.agencyId },
      actorMembership: { userId: tenant.userId, status: MembershipStatus.ACTIVE },
    } as never);
    tx.cloudDriveOAuthState.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(
      service.completeOAuthCallback({ code: 'code', state: 'state' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refreshes with a lock, preserves missing rotated refresh token, and encrypts replacement access token', async () => {
    process.env.CLOUD_DRIVE_TOKEN_ENCRYPTION_KEY = 'z'.repeat(32);
    const { service, tx, registry, encryption } = buildService();
    const oldRefresh = encryption.encrypt('old-refresh');
    tx.cloudDriveConnection.findUnique.mockResolvedValue({
      ...privateConnection(),
      encryptedRefreshToken: oldRefresh,
      tokenExpiresAt: new Date(Date.now() - 1_000),
    } as never);
    registry.get.mockReturnValue({
      refreshAccessToken: jest.fn().mockResolvedValue({
        accessToken: 'new-access',
        scopes: [],
        expiresAt: new Date(Date.now() + 60_000),
      }),
    } as never);
    tx.cloudDriveConnection.update.mockImplementation(({ data }) =>
      Promise.resolve({ ...privateConnection(), ...data }),
    );

    const result = await refreshConnectionTokenForTest(
      service,
      tenant.workspaceId,
      'connection-id',
    );

    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.cloudDriveConnection.update.mock.calls[0][0].data.encryptedRefreshToken).toBe(
      oldRefresh,
    );
    expect(
      encryption.decrypt(tx.cloudDriveConnection.update.mock.calls[0][0].data.encryptedAccessToken),
    ).toBe('new-access');
    expect(result.accessToken).toBe('new-access');
  });

  it('marks REAUTH_REQUIRED only for auth refresh failures, not transient provider failures', async () => {
    process.env.CLOUD_DRIVE_TOKEN_ENCRYPTION_KEY = 'z'.repeat(32);
    const { service, tx, registry } = buildService();
    tx.cloudDriveConnection.findUnique.mockResolvedValue(privateConnection());
    registry.get.mockReturnValue({
      refreshAccessToken: jest.fn().mockRejectedValue(new CloudProviderHttpError('TRANSIENT', 503)),
    } as never);

    await expect(
      refreshConnectionTokenForTest(service, tenant.workspaceId, 'connection-id'),
    ).rejects.toBeInstanceOf(CloudProviderHttpError);
    expect(tx.cloudDriveConnection.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: CloudDriveConnectionStatus.REAUTH_REQUIRED }),
      }),
    );

    registry.get.mockReturnValue({
      refreshAccessToken: jest.fn().mockRejectedValue(new CloudProviderHttpError('AUTH', 401)),
    } as never);
    await expect(
      refreshConnectionTokenForTest(service, tenant.workspaceId, 'connection-id'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.cloudDriveConnection.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: CloudDriveConnectionStatus.REAUTH_REQUIRED },
      }),
    );
  });

  it('reserves quota during import and releases reservation on storage verification failure', async () => {
    process.env.CLOUD_DRIVE_TOKEN_ENCRYPTION_KEY = 'z'.repeat(32);
    const { service, prisma, tx, registry, storage, encryption } = buildService();
    prisma.workspaceMembership.findUnique.mockResolvedValue({
      id: tenant.workspaceMembershipId,
      status: MembershipStatus.ACTIVE,
    } as never);
    prisma.cloudDriveConnection.findUnique.mockResolvedValue({
      ...privateConnection(),
      tokenExpiresAt: new Date(Date.now() + 300_000),
    } as never);
    prisma.asset.findFirst.mockResolvedValue(null);
    tx.workspace.findUniqueOrThrow.mockResolvedValue({ storageLimitBytes: 1_000n });
    tx.asset.aggregate.mockResolvedValue({ _sum: { sizeBytes: 0n } });
    tx.storageUploadReservation.aggregate.mockResolvedValue({ _sum: { reservedBytes: 0n } });
    tx.asset.create.mockResolvedValue({});
    tx.storageUploadReservation.create.mockResolvedValue({});
    registry.get.mockReturnValue({
      getFileMetadata: jest.fn().mockResolvedValue({
        providerFileId: 'provider-file',
        name: 'cloud.txt',
        mimeType: 'text/plain',
        sizeBytes: 10,
        isFolder: false,
        modifiedAt: null,
        parentId: null,
        providerWebUrl: null,
        downloadable: true,
      }),
      downloadFileStream: jest.fn().mockResolvedValue(Readable.from(['content'])),
    } as never);
    storage.upload.mockResolvedValue(undefined);
    storage.getMetadata.mockResolvedValue({ key: 'wrong', size: 10 });
    storage.deleteObject.mockResolvedValue(undefined);

    await expect(
      service.importFile(tenant, 'connection-id', {
        providerFileId: 'provider-file',
        idempotencyKey: 'retry-key',
      }),
    ).rejects.toThrow('CLOUD_IMPORT_STORAGE_VERIFY_FAILED');

    expect(tx.storageUploadReservation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          membershipId: tenant.workspaceMembershipId,
          reservedBytes: 10n,
        }),
      }),
    );
    expect(tx.storageUploadReservation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ releasedAt: expect.any(Date) }),
      }),
    );
    expect(tx.asset.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: AssetStatus.FAILED },
      }),
    );
    expect(storage.deleteObject).toHaveBeenCalled();
    expect(encryption.decrypt(privateConnection().encryptedAccessToken)).toBe('access-token');
  });

  it('locks cloud import idempotency before quota reservation', async () => {
    process.env.CLOUD_DRIVE_TOKEN_ENCRYPTION_KEY = 'z'.repeat(32);
    const { service, prisma, tx, registry } = buildService();
    const existing = assetRecord({ sourceProviderFileId: 'provider-file' });
    prisma.workspaceMembership.findUnique.mockResolvedValue({
      id: tenant.workspaceMembershipId,
      status: MembershipStatus.ACTIVE,
    } as never);
    prisma.cloudDriveConnection.findUnique.mockResolvedValue({
      ...privateConnection(),
      tokenExpiresAt: new Date(Date.now() + 300_000),
    } as never);
    registry.get.mockReturnValue({
      getFileMetadata: jest.fn().mockResolvedValue({
        providerFileId: 'provider-file',
        name: 'cloud.txt',
        mimeType: 'text/plain',
        sizeBytes: 10,
        isFolder: false,
        modifiedAt: null,
        parentId: null,
        providerWebUrl: null,
        downloadable: true,
      }),
      downloadFileStream: jest.fn(),
    } as never);
    tx.asset.findFirst.mockResolvedValue(existing);

    await expect(
      service.importFile(tenant, 'connection-id', {
        providerFileId: 'provider-file',
        idempotencyKey: 'retry-key',
      }),
    ).resolves.toMatchObject({ id: existing.id, sourceProviderFileId: 'provider-file' });

    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.workspace.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(tx.storageUploadReservation.create).not.toHaveBeenCalled();
    expect(tx.asset.create).not.toHaveBeenCalled();
  });

  it('builds provider authorization URLs with PKCE challenge parameters', () => {
    process.env.GOOGLE_DRIVE_CLIENT_ID = 'google-client';
    process.env.ONEDRIVE_CLIENT_ID = 'one-client';
    process.env.DROPBOX_CLIENT_ID = 'dropbox-client';

    for (const adapter of [new GoogleDriveAdapter(), new OneDriveAdapter(), new DropboxAdapter()]) {
      const url = new URL(
        adapter.getAuthorizationUrl({
          state: 'state',
          redirectUri: 'http://localhost:4000/api/v1/cloud-drives/oauth/callback',
          codeChallenge: 'challenge',
        }),
      );
      expect(url.searchParams.get('state')).toBe('state');
      expect(url.searchParams.get('code_challenge')).toBe('challenge');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    }
  });

  it('rejects arbitrary OneDrive cursor URLs before provider fetch', async () => {
    const originalFetch = global.fetch;
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as never;

    try {
      await expect(
        new OneDriveAdapter().listFiles({
          accessToken: 'access-token',
          cursor: 'https://evil.example/steal',
          pageSize: 50,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
    }
  });
});

function buildService() {
  const encryption = new CloudDriveTokenEncryptionService();
  const tx = {
    $queryRaw: jest.fn(),
    workspace: { findUniqueOrThrow: jest.fn() },
    asset: {
      aggregate: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    storageUploadReservation: {
      aggregate: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    cloudDriveConnection: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    cloudDriveOAuthState: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const prisma = {
    $transaction: jest.fn((callbackOrQueries) =>
      typeof callbackOrQueries === 'function'
        ? callbackOrQueries(tx)
        : Promise.all(callbackOrQueries),
    ),
    workspaceMembership: { findUnique: jest.fn() },
    asset: { findFirst: jest.fn() },
    cloudDriveConnection: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    cloudDriveOAuthState: {
      create: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
  const realRegistry = new CloudDriveProviderRegistry(
    new GoogleDriveAdapter(),
    new OneDriveAdapter(),
    new DropboxAdapter(),
    encryption,
  );
  const registry = {
    listStatus: () => realRegistry.listStatus(),
    get: jest.fn((provider: CloudDriveProvider) => realRegistry.get(provider)),
  };
  const audit = { record: jest.fn() };
  const storage = {
    upload: jest.fn(),
    getMetadata: jest.fn(),
    getObject: jest.fn(),
    deleteObject: jest.fn(),
  };
  return {
    prisma,
    tx,
    registry,
    encryption,
    storage,
    service: new CloudDrivesService(
      prisma as never,
      registry as never,
      encryption,
      audit as never,
      storage as never,
    ),
  };
}

function assetRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000099',
    workspaceId: tenant.workspaceId,
    projectId: null,
    createdById: tenant.userId,
    uploadedByMembershipId: tenant.workspaceMembershipId,
    originalFilename: 'cloud.txt',
    displayName: 'cloud.txt',
    mimeType: 'text/plain',
    extension: 'txt',
    sizeBytes: 10n,
    checksum: null,
    status: AssetStatus.READY,
    lifecycle: AssetLifecycle.ACTIVE,
    sourceModule: 'CLOUD_DRIVE',
    sourceEntityType: 'CLOUD_FILE',
    sourceEntityId: null,
    sourceProvider: CloudDriveProvider.GOOGLE_DRIVE,
    sourceConnectionId: 'connection-id',
    sourceProviderFileId: 'provider-file',
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function privateConnection() {
  const encryption = new CloudDriveTokenEncryptionService();
  return {
    id: 'connection-id',
    workspaceId: tenant.workspaceId,
    provider: CloudDriveProvider.GOOGLE_DRIVE,
    displayName: 'Google Drive',
    status: CloudDriveConnectionStatus.CONNECTED,
    providerAccountId: null,
    providerAccountLabel: null,
    encryptedAccessToken: encryption.encrypt('access-token'),
    encryptedRefreshToken: encryption.encrypt('refresh-token'),
    tokenExpiresAt: new Date(Date.now() - 1_000),
    scopes: [],
    rootFolderId: null,
    connectedByMembershipId: tenant.workspaceMembershipId,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastValidatedAt: null,
    revokedAt: null,
  };
}

function refreshConnectionTokenForTest(
  service: CloudDrivesService,
  workspaceId: string,
  connectionId: string,
): Promise<{ accessToken: string }> {
  return (
    service as unknown as {
      refreshConnectionToken: (
        workspaceId: string,
        connectionId: string,
      ) => Promise<{ accessToken: string }>;
    }
  ).refreshConnectionToken(workspaceId, connectionId);
}
