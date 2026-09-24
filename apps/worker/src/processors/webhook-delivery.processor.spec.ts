import { WebhookDeliveryStatus, WebhookSubscriptionStatus } from '@prisma/client';
import { createCipheriv, randomBytes } from 'node:crypto';
import http from 'node:http';
import { WebhookDeliveryProcessor } from './webhook-delivery.processor';

const encryptionKey = Buffer.alloc(32, 7).toString('base64url');

describe('WebhookDeliveryProcessor', () => {
  beforeEach(() => {
    jest.useRealTimers();
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
      CLOUD_DRIVE_TOKEN_ENCRYPTION_KEY: encryptionKey,
      WEBHOOK_ALLOW_LOCAL_HTTP: 'true',
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

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('claims, signs, posts once, and marks a delivery succeeded', async () => {
    const { processor, prisma } = buildProcessor();
    const received: Array<{ body: string; headers: http.IncomingHttpHeaders; method?: string }> =
      [];
    const server = await startWebhookServer(204, '', received);
    prisma.webhookDelivery.findUnique.mockResolvedValue(deliveryRow({ endpointUrl: server.url }));

    try {
      await expect(processor.dispatch('delivery-1')).resolves.toMatchObject({
        status: 'SUCCEEDED',
      });
    } finally {
      await server.close();
    }

    expect(prisma.webhookDelivery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PROCESSING' }) }),
    );
    expect(received[0]).toMatchObject({
      method: 'POST',
      body: '{"id":"evt_1","type":"task.created"}',
    });
    expect(received[0]?.headers).toMatchObject({
      'x-zeaplay-event-id': 'event-1',
      'x-zeaplay-delivery-id': 'delivery-1',
      'x-zeaplay-event-type': 'task.created',
      'x-zeaplay-attempt': '1',
    });
    expect(received[0]?.headers['x-zeaplay-signature']).toMatch(/^v1=[a-f0-9]{64}$/);
    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: WebhookDeliveryStatus.SUCCEEDED }),
      }),
    );
  });

  it('does not POST disabled subscriptions and records a safe failure', async () => {
    const { processor, prisma } = buildProcessor();
    const received: Array<{ body: string; headers: http.IncomingHttpHeaders; method?: string }> =
      [];
    const server = await startWebhookServer(204, '', received);
    prisma.webhookDelivery.findUnique.mockResolvedValue(
      deliveryRow({
        endpointUrl: server.url,
        subscription: { status: WebhookSubscriptionStatus.DISABLED },
      }),
    );

    try {
      await processor.dispatch('delivery-1');
    } finally {
      await server.close();
    }

    expect(received).toHaveLength(0);
    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: WebhookDeliveryStatus.FAILED,
          safeErrorCode: 'WEBHOOK_SUBSCRIPTION_DISABLED',
        }),
      }),
    );
  });

  it('schedules bounded retries for retryable HTTP responses', async () => {
    const { processor, prisma, queue } = buildProcessor();
    const server = await startWebhookServer(500, 'temporary');
    prisma.webhookDelivery.findUnique.mockResolvedValue(deliveryRow({ endpointUrl: server.url }));

    try {
      await processor.dispatch('delivery-1');
    } finally {
      await server.close();
    }

    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: WebhookDeliveryStatus.RETRY_SCHEDULED,
          attemptCount: 1,
          safeErrorCode: 'HTTP_RETRYABLE_STATUS',
        }),
      }),
    );
    expect(queue.add).toHaveBeenCalledWith(
      'webhook.delivery.dispatch',
      { deliveryId: 'delivery-1' },
      expect.objectContaining({ delay: 60_000 }),
    );
  });

  it('classifies permanent 4xx responses as FAILED without retry', async () => {
    const { processor, prisma, queue } = buildProcessor();
    const server = await startWebhookServer(400, 'bad request');
    prisma.webhookDelivery.findUnique.mockResolvedValue(deliveryRow({ endpointUrl: server.url }));

    try {
      await processor.dispatch('delivery-1');
    } finally {
      await server.close();
    }

    expect(prisma.webhookDelivery.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: WebhookDeliveryStatus.FAILED,
          attemptCount: 1,
          safeErrorCode: 'HTTP_PERMANENT_STATUS',
        }),
      }),
    );
    expect(queue.add).not.toHaveBeenCalled();
  });
});

function buildProcessor() {
  const prisma = {
    webhookDelivery: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    webhookEvent: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    webhookSubscription: {
      update: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn((operations) => Promise.all(operations)),
  };
  const queue = { add: jest.fn().mockResolvedValue({}) };
  return {
    processor: new WebhookDeliveryProcessor(prisma as never, queue as never),
    prisma,
    queue,
  };
}

function deliveryRow(overrides: Record<string, unknown> = {}) {
  const { subscription: subscriptionOverrides, endpointUrl, ...rowOverrides } = overrides;
  const subscription = {
    id: 'subscription-1',
    workspaceId: 'workspace-1',
    status: WebhookSubscriptionStatus.ACTIVE,
    endpointUrl: typeof endpointUrl === 'string' ? endpointUrl : 'http://localhost/webhook',
    encryptedSecret: encryptSecret('whsec_test'),
    ...((subscriptionOverrides as Record<string, unknown> | undefined) ?? {}),
  };
  return {
    id: 'delivery-1',
    workspaceId: 'workspace-1',
    attemptCount: 0,
    subscription,
    event: {
      id: 'event-1',
      workspaceId: 'workspace-1',
      eventType: 'task.created',
      payloadJson: { id: 'evt_1', type: 'task.created' },
    },
    ...rowOverrides,
  };
}

async function startWebhookServer(
  status: number,
  body: string,
  received: Array<{ body: string; headers: http.IncomingHttpHeaders; method?: string }> = [],
) {
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      received.push({
        method: request.method,
        headers: request.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      response.statusCode = status;
      response.end(body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('TEST_SERVER_BIND_FAILED');
  return {
    url: `http://localhost:${address.port}/webhook`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function encryptSecret(secret: string) {
  const key = Buffer.from(encryptionKey, 'base64url');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}
