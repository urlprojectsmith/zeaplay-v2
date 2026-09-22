import { MinioStorageAdapter } from './minio-storage.adapter';

const env = {
  WEB_APP_URL: 'http://localhost:3000',
  API_PUBLIC_URL: 'http://localhost:4000/api/v1',
  DATABASE_URL: 'postgresql://user:pass@localhost:6432/db',
  DIRECT_DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  REDIS_CACHE_URL: 'redis://localhost:6379',
  REDIS_QUEUE_URL: 'redis://localhost:6380',
  REDIS_REALTIME_URL: 'redis://localhost:6381',
  REDIS_RATE_LIMIT_URL: 'redis://localhost:6382',
  JWT_ACCESS_SECRET: 'dev-only-change-this-access-secret-at-least-32-chars',
  MINIO_ENDPOINT: 'localhost',
  MINIO_PORT: '9000',
  MINIO_USE_SSL: 'false',
  MINIO_ACCESS_KEY: 'zea-play-dev-minio-access',
  MINIO_SECRET_KEY: 'zea-play-dev-minio-secret-at-least-32-chars',
  MINIO_BUCKET: 'zea-play-dev',
  EMAIL_PROVIDER: 'resend',
  EMAIL_FROM: 'no-reply@example.com',
  RESEND_API_KEY: 'test-resend-api-key',
  OTP_PEPPER: 'test-otp-pepper-at-least-32-characters',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
};

describe('MinioStorageAdapter safety guards', () => {
  beforeEach(() => {
    process.env = { ...process.env, ...env };
  });

  it('rejects unsafe object keys before creating presigned URLs', () => {
    const storage = new MinioStorageAdapter();
    expect(() => storage.createPresignedUploadUrl('../tenant/file.txt')).toThrow(
      'Invalid storage object key.',
    );
  });

  it('rejects excessive presigned URL expirations', () => {
    const storage = new MinioStorageAdapter();
    expect(() => storage.createPresignedDownloadUrl('tenant/file.txt', 86_400)).toThrow(
      'Presigned URL expiry',
    );
  });
});
