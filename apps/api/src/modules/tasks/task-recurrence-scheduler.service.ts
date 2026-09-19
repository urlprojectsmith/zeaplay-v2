import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  TASK_RECURRENCE_DISPATCH_JOB_TYPE,
  TASK_RECURRENCE_QUEUE,
} from '../../infrastructure/queue/queue.constants';

const RECURRENCE_DISPATCH_JOB_ID = 'task-recurrence-dispatch';

@Injectable()
export class TaskRecurrenceSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(TaskRecurrenceSchedulerService.name);

  constructor(@InjectQueue(TASK_RECURRENCE_QUEUE) private readonly queue: Queue) {}

  async onModuleInit() {
    await this.queue.add(
      TASK_RECURRENCE_DISPATCH_JOB_TYPE,
      { version: 1, type: TASK_RECURRENCE_DISPATCH_JOB_TYPE },
      {
        jobId: RECURRENCE_DISPATCH_JOB_ID,
        repeat: { every: 60_000 },
        removeOnComplete: { age: 3_600, count: 100 },
        removeOnFail: { age: 86_400, count: 500 },
      },
    );
    this.logger.log('Task recurrence dispatch scheduler registered.');
  }
}
