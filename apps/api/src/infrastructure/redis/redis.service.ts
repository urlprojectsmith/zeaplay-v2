import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { validateEnvironment } from '@zea-play/config';
import { createRedisOptions } from './redis-options';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly env = validateEnvironment(process.env);
  readonly cache = new Redis(this.env.REDIS_CACHE_URL, createRedisOptions('cache'));
  readonly queue = new Redis(this.env.REDIS_QUEUE_URL, createRedisOptions('queue'));
  readonly realtime = new Redis(this.env.REDIS_REALTIME_URL, createRedisOptions('realtime'));
  readonly rateLimit = new Redis(this.env.REDIS_RATE_LIMIT_URL, createRedisOptions('rate-limit'));

  async ping(client: Redis) {
    if (client.status === 'end' || client.status === 'wait') {
      await client.connect();
    }
    return client.ping();
  }

  async onModuleDestroy() {
    await Promise.all([
      this.cache.quit(),
      this.queue.quit(),
      this.realtime.quit(),
      this.rateLimit.quit(),
    ]);
  }
}
