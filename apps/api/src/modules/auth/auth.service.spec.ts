import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  beforeEach(() => {
    process.env = {
      ...process.env,
      WEB_APP_URL: 'http://localhost:3000',
      API_PUBLIC_URL: 'http://localhost:4000/api/v1',
      DATABASE_URL: 'postgresql://user:pass@localhost:6432/db',
      DIRECT_DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      REDIS_CACHE_URL: 'redis://localhost:6379',
      REDIS_QUEUE_URL: 'redis://localhost:6380',
      REDIS_REALTIME_URL: 'redis://localhost:6381',
      REDIS_RATE_LIMIT_URL: 'redis://localhost:6382',
      JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters',
      MINIO_ENDPOINT: 'localhost',
      MINIO_ACCESS_KEY: 'zea-play-dev-minio-access',
      MINIO_SECRET_KEY: 'zea-play-dev-minio-secret-at-least-32-chars',
      MINIO_BUCKET: 'zea-play-dev',
      SMTP_HOST: 'localhost',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
    };
  });

  it('uses a generic login failure message', async () => {
    const service = new AuthService(
      { user: { findUnique: jest.fn().mockResolvedValue(null) } } as never,
      {
        rateLimit: {
          get: jest.fn().mockResolvedValue(null),
          incr: jest.fn().mockResolvedValue(1),
          expire: jest.fn().mockResolvedValue(1),
        },
      } as never,
      {} as never,
      { verify: jest.fn() } as never,
      { record: jest.fn() } as never,
    );

    await expect(service.login('missing@zeaplay.test', 'DevelopmentPassword123!')).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
