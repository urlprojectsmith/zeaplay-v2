import { describe, expect, it } from 'vitest';
import { validateEnvironment } from './index';

const validEnv = {
  WEB_APP_URL: 'http://localhost:3000',
  API_PUBLIC_URL: 'http://localhost:4000/api/v1',
  REQUEST_BODY_LIMIT: '1mb',
  DATABASE_URL: 'postgresql://user:pass@localhost:6432/db',
  DIRECT_DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  REDIS_CACHE_URL: 'redis://localhost:6379',
  REDIS_QUEUE_URL: 'redis://localhost:6380',
  REDIS_REALTIME_URL: 'redis://localhost:6381',
  REDIS_RATE_LIMIT_URL: 'redis://localhost:6382',
  JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters',
  MINIO_ENDPOINT: 'localhost',
  MINIO_USE_SSL: 'false',
  MINIO_ACCESS_KEY: 'minio',
  MINIO_SECRET_KEY: 'minio',
  MINIO_BUCKET: 'zea',
  SMTP_HOST: 'localhost',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
};

describe('validateEnvironment', () => {
  it('accepts the Phase 1 required environment variables', () => {
    expect(validateEnvironment(validEnv).APP_ENV).toBe('development');
  });

  it('parses explicit boolean environment strings safely', () => {
    expect(validateEnvironment(validEnv).MINIO_USE_SSL).toBe(false);
    expect(validateEnvironment({ ...validEnv, MINIO_USE_SSL: 'true' }).MINIO_USE_SSL).toBe(true);
  });

  it('rejects missing required variables', () => {
    expect(() => validateEnvironment({})).toThrow();
  });

  it('rejects unsafe production secrets', () => {
    expect(() =>
      validateEnvironment({
        ...validEnv,
        APP_ENV: 'production',
        JWT_ACCESS_SECRET: 'replace-me',
      }),
    ).toThrow();
  });
});
