import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { validateEnvironment } from '@zea-play/config';
import { PrismaService } from '../infrastructure/database/prisma.service';
import {
  INBOUND_WEBHOOK_CLEANUP_JOB_TYPE,
  INBOUND_WEBHOOK_MAINTENANCE_QUEUE,
} from '../queue/queue.constants';

const CLEANUP_LIMIT = 500;

@Injectable()
@Processor(INBOUND_WEBHOOK_MAINTENANCE_QUEUE)
export class InboundWebhookMaintenanceProcessor extends WorkerHost {
  private readonly env = validateEnvironment(process.env);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job) {
    if (job.name !== INBOUND_WEBHOOK_CLEANUP_JOB_TYPE) return;
    await this.cleanupRetainedEvents();
  }

  async cleanupRetainedEvents(now = new Date()) {
    const locked = await this.prisma.$queryRaw<Array<{ locked: boolean }>>`
      SELECT pg_try_advisory_lock(hashtext('inbound-webhook-cleanup')) AS locked
    `;
    if (!locked[0]?.locked) return { eventsDeleted: 0, normalizedEventsDeleted: 0 };
    try {
      const cutoff = new Date(
        now.getTime() - this.env.INBOUND_WEBHOOK_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
      );
      const events = await this.prisma.inboundWebhookEvent.findMany({
        where: { receivedAt: { lt: cutoff } },
        select: { id: true },
        orderBy: { receivedAt: 'asc' },
        take: CLEANUP_LIMIT,
      });
      if (events.length === 0) return { eventsDeleted: 0, normalizedEventsDeleted: 0 };
      const ids = events.map((event) => event.id);
      const normalized = await this.prisma.normalizedInboundEvent.deleteMany({
        where: { inboundEventId: { in: ids } },
      });
      const deleted = await this.prisma.inboundWebhookEvent.deleteMany({
        where: { id: { in: ids } },
      });
      return { eventsDeleted: deleted.count, normalizedEventsDeleted: normalized.count };
    } finally {
      await this.prisma.$queryRaw`SELECT pg_advisory_unlock(hashtext('inbound-webhook-cleanup'))`;
    }
  }
}
