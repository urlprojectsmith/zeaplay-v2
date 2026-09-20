import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Job } from 'bullmq';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { TICKET_SLA_QUEUE, TICKET_SLA_SCAN_JOB_TYPE } from '../queue/queue.constants';

const SCAN_LIMIT = 50;

@Injectable()
@Processor(TICKET_SLA_QUEUE)
export class TicketSlaProcessor extends WorkerHost {
  private readonly logger = new Logger(TicketSlaProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<{ type: string; version: 1 }>) {
    if (job.name !== TICKET_SLA_SCAN_JOB_TYPE) return;
    const breached = await this.scan(new Date());
    if (breached > 0) {
      this.logger.log({ breached, message: 'Ticket SLA scanner marked breaches' });
    }
  }

  async scan(now = new Date()) {
    const dueStates = await this.prisma.ticketSlaState.findMany({
      where: {
        OR: [
          {
            firstResponseCompletedAt: null,
            firstResponseNotApplicableAt: null,
            firstResponseBreachedAt: null,
            firstResponsePausedAt: null,
            firstResponseDueAt: { lte: now },
          },
          {
            resolutionCompletedAt: null,
            resolutionBreachedAt: null,
            resolutionPausedAt: null,
            resolutionDueAt: { lte: now },
          },
        ],
      },
      select: { id: true },
      orderBy: { updatedAt: 'asc' },
      take: SCAN_LIMIT,
    });
    let breached = 0;
    for (const row of dueStates) breached += await this.markState(row.id, now);
    return breached;
  }

  private async markState(stateId: string, now: Date) {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id
        FROM ticket_sla_states
        WHERE id = ${stateId}::uuid
        FOR UPDATE SKIP LOCKED
      `);
      if (locked.length === 0) return 0;
      const state = await tx.ticketSlaState.findUniqueOrThrow({
        where: { id: stateId },
        select: {
          id: true,
          firstResponseCompletedAt: true,
          firstResponseNotApplicableAt: true,
          firstResponseBreachedAt: true,
          firstResponsePausedAt: true,
          firstResponseDueAt: true,
          resolutionCompletedAt: true,
          resolutionBreachedAt: true,
          resolutionPausedAt: true,
          resolutionDueAt: true,
        },
      });
      const data: Prisma.TicketSlaStateUpdateInput = {};
      let count = 0;
      if (
        !state.firstResponseCompletedAt &&
        !state.firstResponseNotApplicableAt &&
        !state.firstResponseBreachedAt &&
        !state.firstResponsePausedAt &&
        state.firstResponseDueAt &&
        state.firstResponseDueAt <= now
      ) {
        data.firstResponseBreachedAt = state.firstResponseDueAt;
        count += 1;
      }
      if (
        !state.resolutionCompletedAt &&
        !state.resolutionBreachedAt &&
        !state.resolutionPausedAt &&
        state.resolutionDueAt &&
        state.resolutionDueAt <= now
      ) {
        data.resolutionBreachedAt = state.resolutionDueAt;
        count += 1;
      }
      if (count > 0) await tx.ticketSlaState.update({ where: { id: state.id }, data });
      return count;
    });
  }
}
