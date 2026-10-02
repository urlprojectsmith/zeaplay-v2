import { HttpException, HttpStatus, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { validateEnvironment } from '@zea-play/config';
import { RedisService } from '../../infrastructure/redis/redis.service';

@Injectable()
export class CustomDomainRateLimitService {
  private readonly env = validateEnvironment(process.env);
  private readonly fallback = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly redis: RedisService) {}

  async assertVerifyAllowed(scopeKey: string, userId: string) {
    await this.assertWithinLimit(
      'verify',
      scopeKey,
      userId,
      60,
      this.env.CUSTOM_DOMAIN_VERIFY_RATE_LIMIT_PER_MINUTE,
    );
  }

  async assertTokenAllowed(scopeKey: string, userId: string) {
    await this.assertWithinLimit(
      'token',
      scopeKey,
      userId,
      3600,
      this.env.CUSTOM_DOMAIN_TOKEN_RATE_LIMIT_PER_HOUR,
    );
  }

  private async assertWithinLimit(
    action: string,
    scopeKey: string,
    userId: string,
    windowSeconds: number,
    limit: number,
  ) {
    const [scope, user] = await Promise.all([
      this.consume(`${action}:scope:${scopeKey}`, windowSeconds, limit),
      this.consume(`${action}:user:${userId}`, windowSeconds, limit),
    ]);
    if (!scope.allowed || !user.allowed) {
      throw new HttpException(
        {
          code: 'CUSTOM_DOMAIN_RATE_LIMITED',
          message: 'Custom-domain action rate limit exceeded.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async consume(identifier: string, windowSeconds: number, limit: number) {
    const bucket = Math.floor(Date.now() / 1000 / windowSeconds);
    const key = `custom-domain:${identifier}:${bucket}`;
    try {
      const result = await this.redis.rateLimit.multi().incr(key).expire(key, windowSeconds).exec();
      const count = Number(result?.[0]?.[1] ?? 0);
      if (!count) throw new Error('RATE_LIMIT_COUNTER_FAILED');
      return { allowed: count <= limit };
    } catch {
      return this.consumeFallback(identifier, windowSeconds, limit);
    }
  }

  private consumeFallback(identifier: string, windowSeconds: number, limit: number) {
    if (process.env.NODE_ENV === 'production') {
      throw new ServiceUnavailableException('CUSTOM_DOMAIN_RATE_LIMIT_UNAVAILABLE');
    }
    const now = Date.now();
    const current = this.fallback.get(identifier);
    if (!current || current.resetAt <= now) {
      this.fallback.set(identifier, { count: 1, resetAt: now + windowSeconds * 1000 });
      return { allowed: true };
    }
    current.count += 1;
    return { allowed: current.count <= limit };
  }
}
