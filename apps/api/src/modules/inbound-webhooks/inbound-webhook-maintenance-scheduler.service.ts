import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  INBOUND_WEBHOOK_CLEANUP_JOB_TYPE,
  INBOUND_WEBHOOK_MAINTENANCE_QUEUE,
} from '../../infrastructure/queue/queue.constants';

const INBOUND_WEBHOOK_CLEANUP_JOB_ID = 'inbound-webhook-cleanup';
const INBOUND_WEBHOOK_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

@Injectable()
export class InboundWebhookMaintenanceSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(InboundWebhookMaintenanceSchedulerService.name);

  constructor(@InjectQueue(INBOUND_WEBHOOK_MAINTENANCE_QUEUE) private readonly queue: Queue) {}

  async onModuleInit() {
    try {
      await this.queue.add(
        INBOUND_WEBHOOK_CLEANUP_JOB_TYPE,
        { version: 1, type: INBOUND_WEBHOOK_CLEANUP_JOB_TYPE },
        {
          jobId: INBOUND_WEBHOOK_CLEANUP_JOB_ID,
          repeat: { every: INBOUND_WEBHOOK_CLEANUP_INTERVAL_MS },
          removeOnComplete: { age: 86_400, count: 100 },
          removeOnFail: { age: 604_800, count: 500 },
        },
      );
      this.logger.log('Inbound webhook cleanup scheduler registered.');
    } catch (error) {
      this.logger.warn(
        `Inbound webhook cleanup scheduler registration failed: ${
          error instanceof Error ? error.message : 'UNKNOWN'
        }`,
      );
    }
  }
}
