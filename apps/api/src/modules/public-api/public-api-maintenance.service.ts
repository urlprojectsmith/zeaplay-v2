import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PublicApiIdempotencyService } from './public-api-idempotency.service';

const IDEMPOTENCY_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

@Injectable()
export class PublicApiMaintenanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PublicApiMaintenanceService.name);
  private interval: NodeJS.Timeout | undefined;

  constructor(private readonly idempotency: PublicApiIdempotencyService) {}

  onModuleInit() {
    this.interval = setInterval(
      () => void this.cleanupExpiredIdempotency(),
      IDEMPOTENCY_CLEANUP_INTERVAL_MS,
    );
    this.interval.unref?.();
    void this.cleanupExpiredIdempotency();
  }

  onModuleDestroy() {
    if (this.interval) clearInterval(this.interval);
  }

  private async cleanupExpiredIdempotency() {
    try {
      await this.idempotency.cleanupExpired();
    } catch (error) {
      this.logger.warn(
        `Public API idempotency cleanup failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }
}
