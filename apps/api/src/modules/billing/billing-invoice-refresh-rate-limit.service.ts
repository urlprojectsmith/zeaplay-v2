import { HttpException, HttpStatus, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { RedisService } from '../../infrastructure/redis/redis.service';

const BILLING_INVOICE_REFRESH_LIMIT = 5;
const BILLING_INVOICE_REFRESH_WINDOW_SECONDS = 60;

const BILLING_ACTION_LIMITS = {
  checkout: { limit: 3, windowSeconds: 60 },
  portal: { limit: 5, windowSeconds: 60 },
  subscriptionChange: { limit: 5, windowSeconds: 300 },
  subscriptionCancel: { limit: 3, windowSeconds: 300 },
  trialActivation: { limit: 5, windowSeconds: 300 },
  invoiceRefresh: {
    limit: BILLING_INVOICE_REFRESH_LIMIT,
    windowSeconds: BILLING_INVOICE_REFRESH_WINDOW_SECONDS,
  },
} as const;

type BillingAction = keyof typeof BILLING_ACTION_LIMITS;

@Injectable()
export class BillingInvoiceRefreshRateLimitService {
  private readonly fallback = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly redis: RedisService) {}

  async assertWithinLimit(superAgencyId: string, userId: string) {
    await this.assertActionWithinLimit('invoiceRefresh', superAgencyId, userId);
  }

  async assertActionWithinLimit(action: BillingAction, superAgencyId: string, userId: string) {
    const config = BILLING_ACTION_LIMITS[action];
    const [tenantResult, userResult] = await Promise.all([
      this.consume(`${action}:super-agency:${superAgencyId}`, config),
      this.consume(`${action}:user:${userId}`, config),
    ]);
    if (!tenantResult.allowed || !userResult.allowed) {
      throw new HttpException(
        {
          code:
            action === 'invoiceRefresh'
              ? 'BILLING_INVOICE_REFRESH_RATE_LIMITED'
              : 'BILLING_ACTION_RATE_LIMITED',
          message:
            action === 'invoiceRefresh'
              ? 'Invoice refresh rate limit exceeded.'
              : 'Billing action rate limit exceeded.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async consume(identifier: string, config: { limit: number; windowSeconds: number }) {
    const bucket = Math.floor(Date.now() / 1000 / config.windowSeconds);
    const key = `billing:invoice-refresh:${identifier}:${bucket}`;
    try {
      const results = await this.redis.rateLimit
        .multi()
        .incr(key)
        .expire(key, config.windowSeconds)
        .exec();
      const count = Number(results?.[0]?.[1] ?? 0);
      if (!count) throw new Error('RATE_LIMIT_COUNTER_FAILED');
      return { allowed: count <= config.limit };
    } catch {
      return this.consumeFallback(identifier, config);
    }
  }

  private consumeFallback(identifier: string, config: { limit: number; windowSeconds: number }) {
    if (process.env.NODE_ENV === 'production') {
      throw new ServiceUnavailableException('BILLING_ACTION_RATE_LIMIT_UNAVAILABLE');
    }
    const now = Date.now();
    const current = this.fallback.get(identifier);
    if (!current || current.resetAt <= now) {
      this.fallback.set(identifier, {
        count: 1,
        resetAt: now + config.windowSeconds * 1000,
      });
      return { allowed: true };
    }
    current.count += 1;
    return { allowed: current.count <= config.limit };
  }
}
