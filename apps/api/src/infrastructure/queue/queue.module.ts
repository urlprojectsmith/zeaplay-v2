import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { validateEnvironment } from '@zea-play/config';
import { ASSET_PROCESSING_QUEUE } from './queue.constants';

const env = validateEnvironment(process.env);

@Global()
@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        url: env.REDIS_QUEUE_URL,
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
    BullModule.registerQueue({ name: ASSET_PROCESSING_QUEUE }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
