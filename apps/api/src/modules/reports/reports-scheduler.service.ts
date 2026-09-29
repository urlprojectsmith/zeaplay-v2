import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  REPORT_SCHEDULE_SCAN_JOB_TYPE,
  REPORTS_QUEUE,
} from '../../infrastructure/queue/queue.constants';

const REPORT_SCHEDULE_SCAN_JOB_ID = 'report-schedule-scan';

@Injectable()
export class ReportsSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(ReportsSchedulerService.name);

  constructor(@InjectQueue(REPORTS_QUEUE) private readonly queue: Queue) {}

  async onModuleInit() {
    await this.queue.add(
      REPORT_SCHEDULE_SCAN_JOB_TYPE,
      { type: REPORT_SCHEDULE_SCAN_JOB_TYPE, version: 1 },
      {
        jobId: REPORT_SCHEDULE_SCAN_JOB_ID,
        repeat: { every: 60_000 },
        removeOnComplete: { age: 3_600, count: 100 },
        removeOnFail: { age: 86_400, count: 500 },
      },
    );
    this.logger.log('Report schedule scanner registered.');
  }
}
