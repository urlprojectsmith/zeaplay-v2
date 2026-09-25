import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AgencyStatus,
  InboundWebhookEventStatus,
  InboundWebhookSourceStatus,
  SuperAgencyStatus,
  WorkspaceStatus,
} from '@prisma/client';
import type { WorkspaceTenantContext } from '../../common/auth/auth.types';
import { CloudDriveTokenEncryptionService } from '../cloud-drives/cloud-drive-token-encryption.service';
import {
  GenericHmacV1InboundWebhookAdapter,
  InboundWebhookAdapterRegistry,
} from './inbound-webhook-adapters';
import { InboundWebhookCryptoService } from './inbound-webhook-crypto.service';
import { InboundWebhooksService } from './inbound-webhooks.service';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const sourceId = '00000000-0000-4000-8000-000000000002';
const userId = '00000000-0000-4000-8000-000000000003';
const membershipId = '00000000-0000-4000-8000-000000000004';

describe('InboundWebhooksService', () => {
  let prisma: ReturnType<typeof createPrismaMock>;
  let service: InboundWebhooksService;
  let encryption: CloudDriveTokenEncryptionService;
  let crypto: InboundWebhookCryptoService;
  let rateLimit: { assertWithinLimit: jest.Mock };

  beforeEach(() => {
    Object.assign(process.env, {
      NODE_ENV: 'test',
      APP_ENV: 'test',
      WEB_APP_URL: 'http://localhost:3000',
      API_PUBLIC_URL: 'http://localhost:4000/api/v1',
      CORS_ORIGINS: 'http://localhost:3000',
      REQUEST_BODY_LIMIT: '1mb',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      DIRECT_DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      REDIS_CACHE_URL: 'redis://localhost:6379',
      REDIS_QUEUE_URL: 'redis://localhost:6380',
      REDIS_REALTIME_URL: 'redis://localhost:6381',
      REDIS_RATE_LIMIT_URL: 'redis://localhost:6382',
      JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters',
      CLOUD_DRIVE_TOKEN_ENCRYPTION_KEY: 'inbound-secret-encryption-key-32',
      PUBLIC_API_KEY_RATE_LIMIT_PER_MINUTE: '120',
      PUBLIC_API_WORKSPACE_RATE_LIMIT_PER_MINUTE: '600',
      PUBLIC_API_IDEMPOTENCY_TTL_HOURS: '24',
      WEBHOOK_REQUEST_TIMEOUT_MS: '10000',
      WEBHOOK_DELIVERY_RETENTION_DAYS: '30',
      WEBHOOK_ALLOW_LOCAL_HTTP: 'false',
      INBOUND_WEBHOOK_MAX_BODY_BYTES: '262144',
      INBOUND_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS: '300',
      INBOUND_WEBHOOK_SOURCE_RATE_LIMIT_PER_MINUTE: '120',
      INBOUND_WEBHOOK_WORKSPACE_RATE_LIMIT_PER_MINUTE: '600',
      INBOUND_WEBHOOK_EVENT_RETENTION_DAYS: '30',
      MINIO_ENDPOINT: 'localhost',
      MINIO_PORT: '9000',
      MINIO_USE_SSL: 'false',
      MINIO_ACCESS_KEY: 'minio-access-key',
      MINIO_SECRET_KEY: 'minio-secret-key',
      MINIO_BUCKET: 'bucket',
      EMAIL_PROVIDER: 'resend',
      EMAIL_FROM: 'no-reply@example.com',
      EMAIL_FROM_NAME: 'ZeaPlay',
      RESEND_API_KEY: 'resend-test-key',
      OTP_PEPPER: 'test-otp-pepper-at-least-32-characters',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
    });
    prisma = createPrismaMock();
    encryption = new CloudDriveTokenEncryptionService();
    crypto = new InboundWebhookCryptoService();
    rateLimit = { assertWithinLimit: jest.fn().mockResolvedValue(undefined) };
    service = new InboundWebhooksService(
      prisma as never,
      { record: jest.fn().mockResolvedValue(undefined) } as never,
      encryption,
      crypto,
      rateLimit as never,
      new InboundWebhookAdapterRegistry(new GenericHmacV1InboundWebhookAdapter()),
    );
  });

  it('creates a source with generated public id and one-time encrypted signing secret', async () => {
    prisma.$transaction.mockImplementation((callback: (tx: unknown) => unknown) =>
      callback({
        $queryRaw: jest.fn(),
        inboundWebhookSource: {
          count: jest.fn().mockResolvedValue(0),
          create: jest
            .fn()
            .mockImplementation(({ data }) =>
              Promise.resolve(sourceRow({ ...data, id: sourceId })),
            ),
        },
      }),
    );

    const result = await service.createSource(tenant(), {
      name: 'Generic CRM',
      type: 'GENERIC_HMAC_V1',
    });

    expect(result.publicIdentifier).toMatch(/^iw_/);
    expect(result.endpointUrl).toContain('/api/v1/inbound/iw_');
    expect(result.plaintextSecret).toMatch(/^ziwhsec_/);
  });

  it('requires direct Workspace membership before listing inbound webhook sources', async () => {
    await expect(
      service.listSources(
        {
          ...tenant(),
          workspaceMembershipId: null,
          accessSource: 'AGENCY_ADMINISTRATION',
        },
        { page: 1, pageSize: 25 },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.inboundWebhookSource.findMany).not.toHaveBeenCalled();
  });

  it('enforces the active source cap inside the workspace lock', async () => {
    prisma.$transaction.mockImplementation((callback: (tx: unknown) => unknown) =>
      callback({
        $queryRaw: jest.fn(),
        inboundWebhookSource: {
          count: jest.fn().mockResolvedValue(25),
          create: jest.fn(),
        },
      }),
    );

    await expect(
      service.createSource(tenant(), { name: 'Too many', type: 'GENERIC_HMAC_V1' }),
    ).rejects.toThrow(ConflictException);
  });

  it('accepts valid exact-byte HMAC and normalizes without business mutation', async () => {
    const secret = 'sender-secret';
    const body = Buffer.from(
      '{"type":"crm.contact.created","version":"1","data":{"workspaceId":"evil"}}',
    );
    const timestamp = nowSeconds();
    mockActiveSource(secret);
    prisma.inboundWebhookEvent.findUnique.mockResolvedValue(null);
    prisma.inboundWebhookEvent.create.mockResolvedValue({ id: 'event-1' });
    prisma.$transaction.mockImplementation((callback: (tx: unknown) => unknown) =>
      callback({
        normalizedInboundEvent: { create: jest.fn().mockResolvedValue({}) },
        inboundWebhookEvent: {
          update: jest.fn().mockResolvedValue({
            id: 'event-1',
            status: InboundWebhookEventStatus.NORMALIZED,
          }),
        },
      }),
    );

    const result = await service.receive('iw_public', signedHeaders(secret, timestamp, body), body);

    expect(result).toEqual({
      eventId: 'event-1',
      status: InboundWebhookEventStatus.NORMALIZED,
      replayed: false,
    });
    expect(rateLimit.assertWithinLimit).toHaveBeenCalledWith(sourceId, workspaceId);
  });

  it('rate-limits suspended hierarchy before signature verification or event persistence', async () => {
    const secret = 'sender-secret';
    const body = validBody();
    mockActiveSource(secret, {
      workspace: {
        status: WorkspaceStatus.ACTIVE,
        agency: {
          status: AgencyStatus.SUSPENDED,
          superAgency: { status: SuperAgencyStatus.ACTIVE },
        },
      },
    });

    await expect(
      service.receive('iw_public', signedHeaders(secret, nowSeconds(), body), body),
    ).rejects.toThrow(NotFoundException);

    expect(rateLimit.assertWithinLimit).toHaveBeenCalledWith(sourceId, workspaceId);
    expect(prisma.inboundWebhookEvent.findUnique).not.toHaveBeenCalled();
    expect(prisma.inboundWebhookEvent.create).not.toHaveBeenCalled();
  });

  it('rejects wrong signatures and byte changes after signing', async () => {
    const secret = 'sender-secret';
    const signedBody = Buffer.from('{"type":"crm.contact.created","version":"1","data":{"a":1}}');
    const sentBody = Buffer.from('{"version":"1","type":"crm.contact.created","data":{"a":1}}');
    mockActiveSource(secret);

    await expect(
      service.receive('iw_public', signedHeaders(secret, nowSeconds(), signedBody), sentBody),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects malformed signatures before unsafe compare', async () => {
    const secret = 'sender-secret';
    const body = validBody();
    mockActiveSource(secret);

    await expect(
      service.receive(
        'iw_public',
        {
          ...signedHeaders(secret, nowSeconds(), body),
          'x-zeaplay-inbound-signature': 'v1=not-hex',
        },
        body,
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects stale timestamps before returning duplicate replay responses', async () => {
    const secret = 'sender-secret';
    const body = validBody();
    mockActiveSource(secret);

    await expect(
      service.receive('iw_public', signedHeaders(secret, '100', body), body),
    ).rejects.toThrow(UnauthorizedException);

    expect(prisma.inboundWebhookEvent.findUnique).not.toHaveBeenCalled();
  });

  it('rejects malformed and far-future timestamps', async () => {
    const secret = 'sender-secret';
    const body = validBody();
    mockActiveSource(secret);

    await expect(
      service.receive('iw_public', signedHeaders(secret, 'not-a-time', body), body),
    ).rejects.toThrow(UnauthorizedException);

    const future = String(Math.floor(Date.now() / 1000) + 3_600);
    await expect(
      service.receive('iw_public', signedHeaders(secret, future, body), body),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('deduplicates same event id and body with a fresh new timestamp while rejecting body drift', async () => {
    const secret = 'sender-secret';
    const body = validBody();
    mockActiveSource(secret);
    prisma.inboundWebhookEvent.findUnique.mockResolvedValue({
      id: 'event-1',
      rawBodyHash: crypto.hashRawBody(body),
      status: InboundWebhookEventStatus.NORMALIZED,
    });

    await expect(
      service.receive('iw_public', signedHeaders(secret, nowSeconds(), body), body),
    ).resolves.toEqual({
      eventId: 'event-1',
      status: InboundWebhookEventStatus.NORMALIZED,
      replayed: true,
    });

    prisma.inboundWebhookEvent.findUnique.mockResolvedValue({
      id: 'event-1',
      rawBodyHash: crypto.hashRawBody(Buffer.from('{"different":true}')),
      status: InboundWebhookEventStatus.NORMALIZED,
    });
    await expect(
      service.receive('iw_public', signedHeaders(secret, nowSeconds(), body), body),
    ).rejects.toThrow(ConflictException);
  });

  it('allows the same literal external event id under a different source', async () => {
    const secret = 'sender-secret';
    const body = validBody();
    mockActiveSource(secret);
    prisma.inboundWebhookEvent.findUnique.mockResolvedValue(null);
    prisma.inboundWebhookEvent.create.mockResolvedValue({ id: 'event-2' });
    prisma.$transaction.mockImplementation((callback: (tx: unknown) => unknown) =>
      callback({
        normalizedInboundEvent: { create: jest.fn().mockResolvedValue({}) },
        inboundWebhookEvent: {
          update: jest.fn().mockResolvedValue({
            id: 'event-2',
            status: InboundWebhookEventStatus.NORMALIZED,
          }),
        },
      }),
    );

    await expect(
      service.receive(
        'iw_public_for_other_source',
        signedHeaders(secret, nowSeconds(), body),
        body,
      ),
    ).resolves.toMatchObject({ eventId: 'event-2', replayed: false });

    expect(prisma.inboundWebhookEvent.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sourceId_externalEventId: { sourceId, externalEventId: 'external-event-1' },
        },
      }),
    );
  });

  it('persists validly signed malformed JSON as failed normalization without duplicate rows', async () => {
    const secret = 'sender-secret';
    const body = Buffer.from('{"type":');
    mockActiveSource(secret);
    prisma.inboundWebhookEvent.findUnique.mockResolvedValue(null);
    prisma.inboundWebhookEvent.create.mockResolvedValue({ id: 'event-1' });

    await expect(
      service.receive('iw_public', signedHeaders(secret, nowSeconds(), body), body),
    ).rejects.toThrow(UnprocessableEntityException);

    expect(prisma.inboundWebhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'event-1' },
        data: expect.objectContaining({
          status: InboundWebhookEventStatus.FAILED_NORMALIZATION,
          safeErrorCode: 'INBOUND_JSON_INVALID',
        }),
      }),
    );
  });

  it('returns the stored failed-normalization state on same bad event retries', async () => {
    const secret = 'sender-secret';
    const body = Buffer.from('{"type":');
    mockActiveSource(secret);
    prisma.inboundWebhookEvent.findUnique.mockResolvedValue({
      id: 'event-1',
      rawBodyHash: crypto.hashRawBody(body),
      status: InboundWebhookEventStatus.FAILED_NORMALIZATION,
      safeErrorCode: 'INBOUND_JSON_INVALID',
    });

    await expect(
      service.receive('iw_public', signedHeaders(secret, nowSeconds(), body), body),
    ).rejects.toThrow('INBOUND_JSON_INVALID');

    expect(prisma.inboundWebhookEvent.create).not.toHaveBeenCalled();
    expect(prisma.normalizedInboundEvent.create).not.toHaveBeenCalled();
  });

  it('resolves concurrent duplicate creates through the database unique constraint', async () => {
    const secret = 'sender-secret';
    const body = validBody();
    mockActiveSource(secret);
    prisma.inboundWebhookEvent.findUnique.mockResolvedValueOnce(null);
    prisma.inboundWebhookEvent.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    prisma.inboundWebhookEvent.findUniqueOrThrow.mockResolvedValue({
      id: 'event-1',
      rawBodyHash: crypto.hashRawBody(body),
      status: InboundWebhookEventStatus.NORMALIZED,
      safeErrorCode: null,
    });

    await expect(
      service.receive('iw_public', signedHeaders(secret, nowSeconds(), body), body),
    ).resolves.toEqual({
      eventId: 'event-1',
      status: InboundWebhookEventStatus.NORMALIZED,
      replayed: true,
    });

    expect(prisma.normalizedInboundEvent.create).not.toHaveBeenCalled();
  });

  it('bounds invalid-signature traffic with source and workspace rate limits before crypto failure', async () => {
    const secret = 'sender-secret';
    const body = validBody();
    mockActiveSource(secret);
    rateLimit.assertWithinLimit.mockRejectedValue(
      new HttpException('INBOUND_RATE_LIMIT_EXCEEDED', 429),
    );

    await expect(
      service.receive('iw_public', signedHeaders('wrong-secret', nowSeconds(), body), body),
    ).rejects.toThrow(HttpException);

    expect(rateLimit.assertWithinLimit).toHaveBeenCalledWith(sourceId, workspaceId);
  });

  it('rejects old secrets after immediate rotation and disabled sources', async () => {
    const oldSecret = 'old-secret';
    const newSecret = 'new-secret';
    const body = validBody();
    mockActiveSource(newSecret);

    await expect(
      service.receive('iw_public', signedHeaders(oldSecret, nowSeconds(), body), body),
    ).rejects.toThrow(UnauthorizedException);

    prisma.inboundWebhookSource.findUnique.mockResolvedValue({
      id: sourceId,
      workspaceId,
      type: 'GENERIC_HMAC_V1',
      status: InboundWebhookSourceStatus.DISABLED,
      encryptedSigningSecret: encryption.encrypt(newSecret),
    });
    await expect(
      service.receive('iw_public', signedHeaders(newSecret, nowSeconds(), body), body),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects unsupported content type, content encoding, and oversized bodies', async () => {
    const secret = 'sender-secret';
    mockActiveSource(secret);
    const body = validBody();

    await expect(
      service.receive(
        'iw_public',
        { ...signedHeaders(secret, nowSeconds(), body), 'content-type': 'text/plain' },
        body,
      ),
    ).rejects.toThrow('INBOUND_CONTENT_TYPE_UNSUPPORTED');

    await expect(
      service.receive(
        'iw_public',
        { ...signedHeaders(secret, nowSeconds(), body), 'content-encoding': 'gzip' },
        body,
      ),
    ).rejects.toThrow('INBOUND_CONTENT_ENCODING_UNSUPPORTED');

    await expect(
      service.receive(
        'iw_public',
        signedHeaders(secret, nowSeconds(), Buffer.alloc(262145, 'a')),
        Buffer.alloc(262145, 'a'),
      ),
    ).rejects.toThrow('INBOUND_BODY_TOO_LARGE');
  });

  it('cleans old events in bounded batches', async () => {
    prisma.inboundWebhookEvent.findMany.mockResolvedValue([{ id: 'event-1' }]);
    prisma.normalizedInboundEvent.deleteMany.mockResolvedValue({ count: 1 });
    prisma.inboundWebhookEvent.deleteMany.mockResolvedValue({ count: 1 });

    await expect(
      service.cleanupRetainedEvents(1000, new Date('2026-09-24T00:00:00Z')),
    ).resolves.toEqual({
      eventsDeleted: 1,
      normalizedEventsDeleted: 1,
    });

    expect(prisma.inboundWebhookEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 500 }),
    );
  });

  function mockActiveSource(secret: string, overrides: Record<string, unknown> = {}) {
    prisma.inboundWebhookSource.findUnique.mockResolvedValue({
      id: sourceId,
      workspaceId,
      type: 'GENERIC_HMAC_V1',
      status: InboundWebhookSourceStatus.ACTIVE,
      encryptedSigningSecret: encryption.encrypt(secret),
      workspace: {
        status: WorkspaceStatus.ACTIVE,
        agency: {
          superAgencyId: '00000000-0000-4000-8000-000000000005',
          status: AgencyStatus.ACTIVE,
          superAgency: { status: SuperAgencyStatus.ACTIVE },
        },
      },
      ...overrides,
    });
  }

  function signedHeaders(secret: string, timestamp: string, body: Buffer) {
    return {
      'content-type': 'application/json',
      'x-zeaplay-inbound-event-id': 'external-event-1',
      'x-zeaplay-inbound-timestamp': timestamp,
      'x-zeaplay-inbound-signature': crypto.sign(timestamp, body, secret),
    };
  }
});

function createPrismaMock() {
  return {
    $transaction: jest
      .fn()
      .mockImplementation((input: unknown) =>
        typeof input === 'function' ? input({}) : Promise.all(input as Promise<unknown>[]),
      ),
    inboundWebhookSource: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    inboundWebhookEvent: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn(),
    },
    normalizedInboundEvent: {
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    superAgencySubscription: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
}

function sourceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: sourceId,
    workspaceId,
    name: 'Generic CRM',
    description: null,
    publicIdentifier: 'iw_public',
    type: 'GENERIC_HMAC_V1',
    status: InboundWebhookSourceStatus.ACTIVE,
    lastReceivedAt: null,
    lastVerifiedAt: null,
    lastFailureAt: null,
    createdAt: new Date('2026-09-24T00:00:00Z'),
    updatedAt: new Date('2026-09-24T00:00:00Z'),
    createdByMembership: {
      id: membershipId,
      user: { id: userId, email: 'owner@zeaplay.test', name: 'Owner' },
    },
    ...overrides,
  };
}

function tenant(): WorkspaceTenantContext {
  return {
    userId,
    agencyId: '00000000-0000-4000-8000-000000000005',
    workspaceId,
    workspaceMembershipId: membershipId,
    agencyMembershipId: null,
    roleId: 'role-owner',
    roleName: 'OWNER',
    permissions: ['*'],
    accessSource: 'WORKSPACE_MEMBERSHIP',
  };
}

function nowSeconds() {
  return String(Math.floor(Date.now() / 1000));
}

function validBody() {
  return Buffer.from('{"type":"crm.contact.created","version":"1","data":{"id":"contact-1"}}');
}
