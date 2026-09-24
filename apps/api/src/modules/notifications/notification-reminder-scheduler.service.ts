import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  NOTIFICATION_REMINDER_QUEUE,
  NOTIFICATION_REMINDER_SCAN_JOB_TYPE,
} from '../../infrastructure/queue/queue.constants';

const NOTIFICATION_REMINDER_SCAN_JOB_ID = 'notification-reminder-scan';

@Injectable()
export class NotificationReminderSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(NotificationReminderSchedulerService.name);

  constructor(@InjectQueue(NOTIFICATION_REMINDER_QUEUE) private readonly queue: Queue) {}

  async onModuleInit() {
    await this.queue.add(
      NOTIFICATION_REMINDER_SCAN_JOB_TYPE,
      { version: 1, type: NOTIFICATION_REMINDER_SCAN_JOB_TYPE },
      {
        jobId: NOTIFICATION_REMINDER_SCAN_JOB_ID,
        repeat: { every: 60_000 },
        removeOnComplete: { age: 3_600, count: 100 },
        removeOnFail: { age: 86_400, count: 500 },
      },
    );
    this.logger.log('Notification reminder scanner registered.');
  }
}
