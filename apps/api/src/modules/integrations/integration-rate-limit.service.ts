import { HttpException, HttpStatus, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { validateEnvironment } from '@zea-play/config';
import { RedisService } from '../../infrastructure/redis/redis.service';

@Injectable()
export class IntegrationRateLimitService {
  private readonly env = validateEnvironment(process.env);
  private readonly fallback = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly redis: RedisService) {}

  async assertWithinLimit(workspaceId: string, connectionId: string) {
    const [workspace, connection] = await Promise.all([
      this.consume(
        `workspace:${workspaceId}`,
        this.env.INTEGRATION_WORKSPACE_RATE_LIMIT_PER_MINUTE,
      ),
      this.consume(
        `connection:${connectionId}`,
        this.env.INTEGRATION_CONNECTION_RATE_LIMIT_PER_MINUTE,
      ),
    ]);
    if (!workspace.allowed || !connection.allowed) {
      throw new HttpException(
        { code: 'RATE_LIMIT_EXCEEDED', message: 'Integration action rate limit exceeded.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async consume(identifier: string, limit: number) {
    const windowSeconds = 60;
    try {
      const key = `integrations:${identifier}:${Math.floor(Date.now() / 1000 / windowSeconds)}`;
      const results = await this.redis.rateLimit
        .multi()
        .incr(key)
        .expire(key, windowSeconds)
        .exec();
      const count = Number(results?.[0]?.[1] ?? 0);
      if (!count) throw new Error('RATE_LIMIT_COUNTER_FAILED');
      return { allowed: count <= limit };
    } catch {
      if (process.env.NODE_ENV === 'production') {
        throw new ServiceUnavailableException('INTEGRATION_RATE_LIMIT_UNAVAILABLE');
      }
      return this.consumeFallback(identifier, limit, windowSeconds);
    }
  }

  private consumeFallback(identifier: string, limit: number, windowSeconds: number) {
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
