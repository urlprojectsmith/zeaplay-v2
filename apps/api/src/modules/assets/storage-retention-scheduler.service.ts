import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  STORAGE_RETENTION_QUEUE,
  STORAGE_RETENTION_SCAN_JOB_TYPE,
} from '../../infrastructure/queue/queue.constants';

@Injectable()
export class StorageRetentionSchedulerService implements OnModuleInit {
  constructor(
    @InjectQueue(STORAGE_RETENTION_QUEUE)
    private readonly queue: Queue,
  ) {}

  async onModuleInit() {
    await this.queue.add(
      STORAGE_RETENTION_SCAN_JOB_TYPE,
      { version: 1, createdAt: new Date().toISOString() },
      {
        jobId: STORAGE_RETENTION_SCAN_JOB_TYPE,
        repeat: { every: 300_000 },
        removeOnComplete: { age: 86_400, count: 100 },
        removeOnFail: { age: 604_800 },
      },
    );
  }
}
