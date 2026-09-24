import { HttpException, HttpStatus, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { validateEnvironment } from '@zea-play/config';
import { RedisService } from '../../infrastructure/redis/redis.service';

@Injectable()
export class InboundWebhookRateLimitService {
  private readonly env = validateEnvironment(process.env);
  private readonly fallback = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly redis: RedisService) {}

  async assertWithinLimit(sourceId: string, workspaceId: string) {
    const [sourceResult, workspaceResult] = await Promise.all([
      this.consume(`source:${sourceId}`, this.env.INBOUND_WEBHOOK_SOURCE_RATE_LIMIT_PER_MINUTE),
      this.consume(
        `workspace:${workspaceId}`,
        this.env.INBOUND_WEBHOOK_WORKSPACE_RATE_LIMIT_PER_MINUTE,
      ),
    ]);
    if (!sourceResult.allowed || !workspaceResult.allowed) {
      throw new HttpException(
        { code: 'INBOUND_RATE_LIMIT_EXCEEDED', message: 'Inbound webhook rate limit exceeded.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async consume(identifier: string, limit: number) {
    const windowSeconds = 60;
    try {
      const key = `inbound-webhook:${identifier}:${Math.floor(Date.now() / 1000 / windowSeconds)}`;
      const results = await this.redis.rateLimit
        .multi()
        .incr(key)
        .expire(key, windowSeconds)
        .exec();
      const count = Number(results?.[0]?.[1] ?? 0);
      if (!count) throw new Error('RATE_LIMIT_COUNTER_FAILED');
      return { allowed: count <= limit };
    } catch {
      return this.consumeFallback(identifier, limit, windowSeconds);
    }
  }

  private consumeFallback(identifier: string, limit: number, windowSeconds: number) {
    if (process.env.NODE_ENV === 'production') {
      throw new ServiceUnavailableException('INBOUND_RATE_LIMIT_UNAVAILABLE');
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
