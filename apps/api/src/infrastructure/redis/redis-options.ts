import type { RedisOptions } from 'ioredis';

export function createRedisOptions(role: string): RedisOptions {
  return {
    lazyConnect: true,
    keyPrefix: `zea:${role}:`,
    connectTimeout: 5_000,
    commandTimeout: 5_000,
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    retryStrategy(times) {
      return Math.min(times * 100, 2_000);
    },
  };
}
