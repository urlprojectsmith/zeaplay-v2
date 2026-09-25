import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { FOUNDATION_QUEUES } from './queue.constants';
import { QueueHealthService } from './queue-health.service';

@Module({
  imports: FOUNDATION_QUEUES.map((name) => BullModule.registerQueue({ name })),
  providers: [QueueHealthService],
  exports: [BullModule, QueueHealthService],
})
export class QueueModule {}
