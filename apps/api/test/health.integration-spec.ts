import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { RedisService } from '../src/infrastructure/redis/redis.service';
import { STORAGE_ADAPTER } from '../src/infrastructure/storage/storage.tokens';

describe('HealthController', () => {
  let app: INestApplication;

  beforeAll(async () => {
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
      MINIO_ACCESS_KEY: 'minio',
      MINIO_SECRET_KEY: 'minio',
      MINIO_BUCKET: 'zea',
      SMTP_HOST: 'localhost',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
    };

    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ isHealthy: jest.fn().mockResolvedValue(true) })
      .overrideProvider(RedisService)
      .useValue({
        cache: {},
        queue: {},
        realtime: {},
        rateLimit: {},
        ping: jest.fn().mockResolvedValue('PONG'),
      })
      .overrideProvider(STORAGE_ADAPTER)
      .useValue({ isHealthy: jest.fn().mockResolvedValue(true) })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await drainTeardown();
  });

  it('returns health status', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe('ok');
      });
  });

  it('propagates correlation headers', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/health')
      .set('x-correlation-id', 'corr-test')
      .expect('x-correlation-id', 'corr-test');
  });
});

function drainTeardown() {
  return new Promise((resolve) => setTimeout(resolve, 100));
}
