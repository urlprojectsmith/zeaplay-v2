import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { MetricsService } from '../../infrastructure/monitoring/metrics.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import type { StorageAdapter } from '../../infrastructure/storage/storage-adapter';
import { STORAGE_ADAPTER } from '../../infrastructure/storage/storage.tokens';
import { RealtimeService } from '../realtime/realtime.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly metrics: MetricsService,
    private readonly realtime: RealtimeService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
  ) {}

  basic() {
    return { status: 'ok', service: 'zea-play-api', timestamp: new Date().toISOString() };
  }

  live() {
    return { status: 'live', timestamp: new Date().toISOString() };
  }

  async ready() {
    const checks = {
      postgres: await this.check('postgres', () => this.prisma.isHealthy()),
      redisCache: await this.check('redis-cache', () => this.redis.ping(this.redis.cache)),
      redisQueue: await this.check('redis-queue', () => this.redis.ping(this.redis.queue)),
      realtimeFanout: this.realtimeFanout(),
      minio: await this.check('minio', () => this.storage.isHealthy()),
    };

    const status = Object.values(checks).every((check) => check.status === 'ok')
      ? 'ready'
      : 'degraded';
    return { status, checks, timestamp: new Date().toISOString() };
  }

  private async check(name: string, fn: () => Promise<unknown>) {
    try {
      await fn();
      this.metrics.dependencyHealth.set({ dependency: name }, 1);
      return { status: 'ok' };
    } catch {
      this.metrics.dependencyHealth.set({ dependency: name }, 0);
      return { status: 'unavailable' };
    }
  }

  private realtimeFanout() {
    const healthy = this.realtime.isRedisFanoutHealthy();
    this.metrics.dependencyHealth.set({ dependency: 'realtime-fanout' }, healthy ? 1 : 0);
    return healthy ? { status: 'ok' } : { status: 'degraded', mode: 'process-local-sockets' };
  }
}
