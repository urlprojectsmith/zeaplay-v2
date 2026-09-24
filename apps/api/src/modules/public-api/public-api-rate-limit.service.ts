import { HttpException, HttpStatus, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { validateEnvironment } from '@zea-play/config';
import { RedisService } from '../../infrastructure/redis/redis.service';
import type { PublicApiPrincipal } from './public-api.types';

@Injectable()
export class PublicApiRateLimitService {
  private readonly env = validateEnvironment(process.env);
  private readonly fallback = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly redis: RedisService) {}

  async assertWithinLimit(principal: PublicApiPrincipal) {
    const [keyResult, workspaceResult] = await Promise.all([
      this.consume(`key:${principal.apiKeyId}`, this.env.PUBLIC_API_KEY_RATE_LIMIT_PER_MINUTE),
      this.consume(
        `workspace:${principal.workspaceId}`,
        this.env.PUBLIC_API_WORKSPACE_RATE_LIMIT_PER_MINUTE,
      ),
    ]);
    const exceeded = [keyResult, workspaceResult].find((result) => !result.allowed);
    if (exceeded) {
      throw new HttpException(
        {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Public API rate limit exceeded.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async consume(identifier: string, limit: number) {
    const windowSeconds = 60;
    try {
      const key = `public-api:${identifier}:${Math.floor(Date.now() / 1000 / windowSeconds)}`;
      const results = await this.redis.rateLimit
        .multi()
        .incr(key)
        .expire(key, windowSeconds)
        .exec();
      const count = Number(results?.[0]?.[1] ?? 0);
      if (!count) throw new Error('RATE_LIMIT_COUNTER_FAILED');
      return { allowed: count <= limit, retryAfter: windowSeconds };
    } catch {
      return this.consumeFallback(identifier, limit, windowSeconds);
    }
  }

  private consumeFallback(identifier: string, limit: number, windowSeconds: number) {
    if (process.env.NODE_ENV === 'production') {
      throw new ServiceUnavailableException('PUBLIC_API_RATE_LIMIT_UNAVAILABLE');
    }
    const now = Date.now();
    const current = this.fallback.get(identifier);
    if (!current || current.resetAt <= now) {
      this.fallback.set(identifier, { count: 1, resetAt: now + windowSeconds * 1000 });
      return { allowed: true, retryAfter: windowSeconds };
    }
    current.count += 1;
    return {
      allowed: current.count <= limit,
      retryAfter: Math.ceil((current.resetAt - now) / 1000),
    };
  }
}
