import { BadRequestException } from '@nestjs/common';
import { AutomationTriggerType, WebhookDeliveryStatus } from '@prisma/client';
import { WebhookSigningService } from './webhook-signing.service';
import { WebhookUrlValidatorService, isBlockedAddress } from './webhook-url-validator.service';
import { WebhooksService } from './webhooks.service';

const tenant = {
  userId: '00000000-0000-4000-8000-000000000001',
  agencyId: '00000000-0000-4000-8000-000000000002',
  workspaceId: '00000000-0000-4000-8000-000000000003',
  workspaceMembershipId: '00000000-0000-4000-8000-000000000004',
  agencyMembershipId: null,
  roleId: '00000000-0000-4000-8000-000000000005',
  roleName: 'ADMIN',
  permissions: ['webhooks.view', 'webhooks.create', 'webhooks.manage', 'webhooks.retry'],
  accessSource: 'WORKSPACE_MEMBERSHIP' as const,
};

describe('Phase 14.2 webhook security helpers', () => {
  it('signs exactly timestamp dot raw-body with HMAC SHA-256', () => {
    const signing = new WebhookSigningService();

    expect(signing.sign('secret', '1700000000', '{"id":"evt_1"}')).toBe(
      'af784f27423c462e20039559cd4264140f7b7ed4c9090e26fd663faa5eeb8dda',
    );
  });

  it('blocks private, loopback, link-local, metadata, multicast, and mapped addresses', () => {
    expect(isBlockedAddress('127.0.0.1')).toBe(true);
    expect(isBlockedAddress('10.0.0.1')).toBe(true);
    expect(isBlockedAddress('172.16.1.1')).toBe(true);
    expect(isBlockedAddress('192.168.1.1')).toBe(true);
    expect(isBlockedAddress('169.254.169.254')).toBe(true);
    expect(isBlockedAddress('::1')).toBe(true);
    expect(isBlockedAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedAddress('8.8.8.8')).toBe(false);
  });

  it('rejects non-HTTPS URLs by default before delivery', async () => {
    const validator = new WebhookUrlValidatorService();

    await expect(validator.assertSafeUrl('http://example.com/webhook')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('Phase 14.2 webhook service final guards', () => {
  beforeEach(() => {
    process.env = {
      ...process.env,
      NODE_ENV: 'test',
      APP_ENV: 'test',
      WEB_APP_URL: 'http://localhost:3000',
      API_PUBLIC_URL: 'http://localhost:4000/api/v1',
      CORS_ORIGINS: 'http://localhost:3000',
      DATABASE_URL: 'postgresql://user:pass@localhost:6432/db',
      DIRECT_DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      REDIS_CACHE_URL: 'redis://localhost:6379',
      REDIS_QUEUE_URL: 'redis://localhost:6380',
      REDIS_REALTIME_URL: 'redis://localhost:6381',
      REDIS_RATE_LIMIT_URL: 'redis://localhost:6382',
      JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters',
      CLOUD_DRIVE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64url'),
      WEBHOOK_ALLOW_LOCAL_HTTP: 'false',
      WEBHOOK_REQUEST_TIMEOUT_MS: '10000',
      WEBHOOK_DELIVERY_RETENTION_DAYS: '30',
      MINIO_ENDPOINT: 'localhost',
      MINIO_ACCESS_KEY: 'zea-play-dev-minio-access',
      MINIO_SECRET_KEY: 'zea-play-dev-minio-secret-at-least-32-chars',
      MINIO_BUCKET: 'zea-play-dev',
      EMAIL_FROM: 'no-reply@example.com',
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 'test-resend-api-key',
      OTP_PEPPER: 'test-otp-pepper-at-least-32-characters',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
    };
  });

  it('rejects wildcard and unsupported event subscriptions before persistence', async () => {
    const { service, prisma } = buildService();

    await expect(
      service.create(tenant, {
        name: 'Bad hook',
        endpointUrl: 'https://example.com/webhook',
        eventTypes: ['*'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.webhookSubscription.create).not.toHaveBeenCalled();
  });

  it('requires direct Workspace membership before listing webhook subscriptions', async () => {
    const { service, prisma } = buildService();

    await expect(
      service.list(
        {
          ...tenant,
          workspaceMembershipId: null,
          accessSource: 'AGENCY_ADMINISTRATION',
        },
        { page: 1, pageSize: 25 },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.webhookSubscription.findMany).not.toHaveBeenCalled();
  });

  it('deduplicates capture by source automation domain event', async () => {
    const { service, prisma, queue } = buildService();
    prisma.automationDomainEvent.findUnique.mockResolvedValue(domainEvent());
    prisma.webhookSubscription.findMany!.mockResolvedValue([{ id: 'subscription-1' }]);
    prisma.webhookEvent.findUnique!.mockResolvedValue({ id: 'event-existing' });

    await expect(service.captureAutomationDomainEvent('domain-event-1')).resolves.toMatchObject({
      captured: false,
      reason: 'DUPLICATE_DOMAIN_EVENT',
      eventId: 'event-existing',
    });

    expect(prisma.webhookEvent.create).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('manual retry atomically claims an eligible delivery and reuses the same delivery id', async () => {
    const { service, prisma, queue, audit } = buildService();
    prisma.webhookDelivery.findFirst!.mockResolvedValue({
      id: 'delivery-1',
      status: WebhookDeliveryStatus.FAILED,
      subscriptionId: 'subscription-1',
    });
    prisma.webhookDelivery.updateMany!.mockResolvedValue({ count: 1 });
    prisma.webhookDelivery.findUniqueOrThrow!.mockResolvedValue(deliveryRecord());

    await expect(service.retryDelivery(tenant, 'delivery-1')).resolves.toMatchObject({
      id: 'delivery-1',
      eventId: 'event-1',
    });

    expect(prisma.webhookDelivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'delivery-1',
          workspaceId: tenant.workspaceId,
          status: { in: [WebhookDeliveryStatus.FAILED, WebhookDeliveryStatus.DEAD_LETTERED] },
        }),
      }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      'webhook.delivery.dispatch',
      { deliveryId: 'delivery-1' },
      expect.any(Object),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'webhook_delivery.manual_retry_requested' }),
    );
  });
});

function buildService() {
  const prisma: {
    $transaction: jest.Mock;
    automationDomainEvent: { findUnique: jest.Mock };
    webhookSubscription: Record<string, jest.Mock>;
    webhookEvent: Record<string, jest.Mock>;
    webhookDelivery: Record<string, jest.Mock>;
  } = {
    $transaction: jest.fn((input) =>
      Promise.resolve(
        Array.isArray(input)
          ? Promise.all(input)
          : (input as (tx: typeof prisma) => unknown)(prisma),
      ),
    ),
    automationDomainEvent: { findUnique: jest.fn() },
    webhookSubscription: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    webhookEvent: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    webhookDelivery: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const encryption = {
    encrypt: jest.fn((value: string) => `encrypted:${value}`),
    decrypt: jest.fn(),
  };
  const signing = { generateSecret: jest.fn(() => 'whsec_test') };
  const urls = { assertSafeUrl: jest.fn((url: string) => Promise.resolve(url)) };
  const queue = { add: jest.fn().mockResolvedValue({}) };
  return {
    service: new WebhooksService(
      prisma as never,
      audit as never,
      encryption as never,
      signing as never,
      urls as never,
      queue as never,
    ),
    prisma,
    audit,
    queue,
  };
}

function domainEvent() {
  return {
    id: 'domain-event-1',
    workspaceId: tenant.workspaceId,
    eventType: AutomationTriggerType.TASK_CREATED,
    entityType: 'TASK',
    entityId: '00000000-0000-4000-8000-000000000010',
    occurredAt: new Date('2026-09-24T00:00:00.000Z'),
    correlationId: 'correlation-1',
    causationId: null,
    payload: { title: 'Original task title' },
  };
}

function deliveryRecord() {
  return {
    id: 'delivery-1',
    workspaceId: tenant.workspaceId,
    eventId: 'event-1',
    subscriptionId: 'subscription-1',
    status: WebhookDeliveryStatus.PENDING,
    attemptCount: 1,
    nextAttemptAt: new Date(),
    lastAttemptAt: null,
    deliveredAt: null,
    httpStatus: null,
    safeErrorCode: null,
    responseDurationMs: null,
    responseSnippet: null,
    createdAt: new Date('2026-09-24T00:00:00.000Z'),
    updatedAt: new Date('2026-09-24T00:00:00.000Z'),
    event: {
      id: 'event-1',
      eventType: 'task.created',
      eventVersion: 1,
      createdAt: new Date('2026-09-24T00:00:00.000Z'),
    },
  };
}
