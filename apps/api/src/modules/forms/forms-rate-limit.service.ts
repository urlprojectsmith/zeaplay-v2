import { HttpException, HttpStatus, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { RedisService } from '../../infrastructure/redis/redis.service';

const PUBLIC_FORM_LIMIT_PER_MINUTE = 30;
const PUBLIC_FORM_WORKSPACE_LIMIT_PER_MINUTE = 300;
const PUBLIC_FORM_UPLOAD_LIMIT_PER_MINUTE = 20;

@Injectable()
export class FormsRateLimitService {
  private readonly fallback = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly redis: RedisService) {}

  async assertPublicSubmitAllowed(publicId: string, workspaceId: string, clientKey: string) {
    const [client, workspace] = await Promise.all([
      this.consume(`form:${publicId}:client:${clientKey}`, PUBLIC_FORM_LIMIT_PER_MINUTE),
      this.consume(`workspace:${workspaceId}`, PUBLIC_FORM_WORKSPACE_LIMIT_PER_MINUTE),
    ]);
    if (!client.allowed || !workspace.allowed) {
      throw new HttpException(
        { code: 'PUBLIC_FORM_RATE_LIMITED', message: 'Public form rate limit exceeded.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async assertPublicUploadAllowed(publicId: string, workspaceId: string, clientKey: string) {
    const [client, workspace] = await Promise.all([
      this.consume(
        `form:${publicId}:upload-client:${clientKey}`,
        PUBLIC_FORM_UPLOAD_LIMIT_PER_MINUTE,
      ),
      this.consume(`workspace:${workspaceId}:uploads`, PUBLIC_FORM_WORKSPACE_LIMIT_PER_MINUTE),
    ]);
    if (!client.allowed || !workspace.allowed) {
      throw new HttpException(
        {
          code: 'PUBLIC_FORM_UPLOAD_RATE_LIMITED',
          message: 'Public form upload rate limit exceeded.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async consume(identifier: string, limit: number) {
    const windowSeconds = 60;
    try {
      const key = `forms:${identifier}:${Math.floor(Date.now() / 1000 / windowSeconds)}`;
      const result = await this.redis.rateLimit.multi().incr(key).expire(key, windowSeconds).exec();
      const count = Number(result?.[0]?.[1] ?? 0);
      if (!count) throw new Error('RATE_LIMIT_COUNTER_FAILED');
      return { allowed: count <= limit };
    } catch {
      return this.consumeFallback(identifier, limit, windowSeconds);
    }
  }

  private consumeFallback(identifier: string, limit: number, windowSeconds: number) {
    if (process.env.NODE_ENV === 'production') {
      throw new ServiceUnavailableException('PUBLIC_FORM_RATE_LIMIT_UNAVAILABLE');
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
