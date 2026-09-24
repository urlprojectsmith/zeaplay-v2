import { InboundWebhookMaintenanceProcessor } from './inbound-webhook-maintenance.processor';

describe('InboundWebhookMaintenanceProcessor', () => {
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
  });

  it('uses an advisory lock and deletes only bounded expired inbound events', async () => {
    const { processor, prisma } = buildProcessor();
    prisma.$queryRaw
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([{ pg_advisory_unlock: true }]);
    prisma.inboundWebhookEvent.findMany.mockResolvedValue([{ id: 'event-1' }]);
    prisma.normalizedInboundEvent.deleteMany.mockResolvedValue({ count: 1 });
    prisma.inboundWebhookEvent.deleteMany.mockResolvedValue({ count: 1 });

    await expect(
      processor.cleanupRetainedEvents(new Date('2026-09-24T00:00:00Z')),
    ).resolves.toEqual({
      eventsDeleted: 1,
      normalizedEventsDeleted: 1,
    });

    expect(prisma.inboundWebhookEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { receivedAt: { lt: new Date('2026-08-25T00:00:00.000Z') } },
        orderBy: { receivedAt: 'asc' },
        take: 500,
      }),
    );
  });

  it('skips cleanup when another worker owns the advisory lock', async () => {
    const { processor, prisma } = buildProcessor();
    prisma.$queryRaw.mockResolvedValueOnce([{ locked: false }]);

    await expect(processor.cleanupRetainedEvents()).resolves.toEqual({
      eventsDeleted: 0,
      normalizedEventsDeleted: 0,
    });

    expect(prisma.inboundWebhookEvent.findMany).not.toHaveBeenCalled();
    expect(prisma.normalizedInboundEvent.deleteMany).not.toHaveBeenCalled();
  });
});

function buildProcessor() {
  const prisma = {
    $queryRaw: jest.fn(),
    inboundWebhookEvent: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    normalizedInboundEvent: {
      deleteMany: jest.fn(),
    },
  };
  return {
    processor: new InboundWebhookMaintenanceProcessor(prisma as never),
    prisma,
  };
}
