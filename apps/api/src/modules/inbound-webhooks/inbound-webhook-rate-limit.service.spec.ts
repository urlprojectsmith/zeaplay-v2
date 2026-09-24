import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { InboundWebhookRateLimitService } from './inbound-webhook-rate-limit.service';

describe('InboundWebhookRateLimitService', () => {
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

  afterEach(() => {
    process.env.NODE_ENV = 'test';
  });

  it('checks source and workspace counters without placing secrets in Redis keys', async () => {
    const exec = jest
      .fn()
      .mockResolvedValueOnce([[null, 1]])
      .mockResolvedValueOnce([[null, 1]]);
    const expire = jest.fn().mockReturnThis();
    const incr = jest.fn().mockReturnThis();
    const multi = jest.fn(() => ({ incr, expire, exec }));
    const service = new InboundWebhookRateLimitService({
      rateLimit: { multi },
    } as never);

    await expect(service.assertWithinLimit('source-1', 'workspace-1')).resolves.toBeUndefined();

    expect(incr).toHaveBeenCalledWith(expect.stringMatching(/^inbound-webhook:source:source-1:/));
    expect(incr).toHaveBeenCalledWith(
      expect.stringMatching(/^inbound-webhook:workspace:workspace-1:/),
    );
    expect(incr).not.toHaveBeenCalledWith(expect.stringContaining('ziwhsec_'));
    expect(expire).toHaveBeenCalledWith(expect.any(String), 60);
  });

  it('rejects when either source or workspace limit is exceeded', async () => {
    const exec = jest
      .fn()
      .mockResolvedValueOnce([[null, 121]])
      .mockResolvedValueOnce([[null, 1]]);
    const service = new InboundWebhookRateLimitService({
      rateLimit: {
        multi: jest.fn(() => ({
          incr: jest.fn().mockReturnThis(),
          expire: jest.fn().mockReturnThis(),
          exec,
        })),
      },
    } as never);

    await expect(service.assertWithinLimit('source-1', 'workspace-1')).rejects.toThrow(
      HttpException,
    );
  });

  it('fails closed in production when Redis rate limiting is unavailable', async () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_ENV = 'production';
    process.env.JWT_ACCESS_SECRET = 'production-jwt-secret-value-000001';
    process.env.MINIO_ACCESS_KEY = 'production-minio-access-key-00001';
    process.env.MINIO_SECRET_KEY = 'production-minio-secret-key-00001';
    process.env.OTP_PEPPER = 'production-otp-pepper-value-000001';
    process.env.RESEND_API_KEY = 'production-resend-api-key-000001';
    const service = new InboundWebhookRateLimitService({
      rateLimit: {
        multi: jest.fn(() => ({
          incr: jest.fn().mockReturnThis(),
          expire: jest.fn().mockReturnThis(),
          exec: jest.fn().mockRejectedValue(new Error('redis')),
        })),
      },
    } as never);

    await expect(service.assertWithinLimit('source-1', 'workspace-1')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});
