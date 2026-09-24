import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { IntegrationsService } from './integrations.service';

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

@Injectable()
export class IntegrationMaintenanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IntegrationMaintenanceService.name);
  private interval: NodeJS.Timeout | undefined;

  constructor(private readonly integrations: IntegrationsService) {}

  onModuleInit() {
    this.interval = setInterval(() => void this.cleanup(), CLEANUP_INTERVAL_MS);
    this.interval.unref?.();
    void this.cleanup();
  }

  onModuleDestroy() {
    if (this.interval) clearInterval(this.interval);
  }

  private async cleanup() {
    try {
      await this.integrations.cleanupExpired();
    } catch (error) {
      this.logger.warn(
        `Integration cleanup failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
}
