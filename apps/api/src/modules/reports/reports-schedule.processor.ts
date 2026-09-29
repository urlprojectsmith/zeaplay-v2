import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import {
  REPORT_SCHEDULE_SCAN_JOB_TYPE,
  REPORTS_QUEUE,
} from '../../infrastructure/queue/queue.constants';
import { ReportsService } from './reports.service';

@Processor(REPORTS_QUEUE)
@Injectable()
export class ReportsScheduleProcessor extends WorkerHost {
  private readonly logger = new Logger(ReportsScheduleProcessor.name);

  constructor(private readonly reports: ReportsService) {
    super();
  }

  async process(job: Job<{ type: string; version: 1 }>) {
    if (job.name !== REPORT_SCHEDULE_SCAN_JOB_TYPE) return;
    const result = await this.reports.dispatchDueSchedules(new Date());
    if (result.dispatched > 0) {
      this.logger.log({
        scanned: result.scanned,
        dispatched: result.dispatched,
        message: 'Report schedule scanner dispatched rows',
      });
    }
  }
}
