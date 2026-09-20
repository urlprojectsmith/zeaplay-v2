import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  TICKET_SLA_QUEUE,
  TICKET_SLA_SCAN_JOB_TYPE,
} from '../../infrastructure/queue/queue.constants';

const TICKET_SLA_SCAN_JOB_ID = 'ticket-sla-scan';

@Injectable()
export class TicketSlaSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(TicketSlaSchedulerService.name);

  constructor(@InjectQueue(TICKET_SLA_QUEUE) private readonly queue: Queue) {}

  async onModuleInit() {
    await this.queue.add(
      TICKET_SLA_SCAN_JOB_TYPE,
      { version: 1, type: TICKET_SLA_SCAN_JOB_TYPE },
      {
        jobId: TICKET_SLA_SCAN_JOB_ID,
        repeat: { every: 60_000 },
        removeOnComplete: { age: 3_600, count: 100 },
        removeOnFail: { age: 86_400, count: 500 },
      },
    );
    this.logger.log('Ticket SLA breach scanner registered.');
  }
}
