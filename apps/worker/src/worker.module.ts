import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from '@zea-play/config';
import { HealthModule } from './modules/health/health.module';
import { QueueModule } from './queue/queue.module';
import { DatabaseModule } from './infrastructure/database/database.module';
import { StorageModule } from './infrastructure/storage/storage.module';
import { AssetProcessingProcessor } from './processors/asset-processing.processor';
import { StorageRetentionProcessor } from './processors/storage-retention.processor';
import { TaskRecurrenceProcessor } from './processors/task-recurrence.processor';
import { TicketSlaProcessor } from './processors/ticket-sla.processor';
import { WebhookDeliveryProcessor } from './processors/webhook-delivery.processor';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    BullModule.forRoot({
      connection: {
        url: process.env.REDIS_QUEUE_URL,
        connectTimeout: 5_000,
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
      },
      prefix: 'zea:queue',
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1_000 },
        removeOnComplete: { age: 86_400, count: 1_000 },
        removeOnFail: { age: 604_800 },
      },
    }),
    DatabaseModule,
    StorageModule,
    QueueModule,
    HealthModule,
  ],
  providers: [
    AssetProcessingProcessor,
    TaskRecurrenceProcessor,
    TicketSlaProcessor,
    StorageRetentionProcessor,
    WebhookDeliveryProcessor,
  ],
})
export class WorkerModule {}
