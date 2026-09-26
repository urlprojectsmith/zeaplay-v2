import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AnalyticsBucket, AnalyticsScopeType, BillingUsageScope, Prisma } from '@prisma/client';
import type { Job, Queue } from 'bullmq';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { ANALYTICS_ROLLUP_QUEUE, ANALYTICS_ROLLUP_SCAN_JOB_TYPE } from '../queue/queue.constants';

const ANALYTICS_ROLLUP_INTERVAL_MS = 5 * 60_000;
const ANALYTICS_ROLLUP_LOOKBACK_DAYS = 2;
const API_REQUEST_METRIC_KEY = 'api.requests';

@Injectable()
@Processor(ANALYTICS_ROLLUP_QUEUE)
export class AnalyticsRollupProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(AnalyticsRollupProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(ANALYTICS_ROLLUP_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit() {
    await this.queue.add(
      ANALYTICS_ROLLUP_SCAN_JOB_TYPE,
      { type: ANALYTICS_ROLLUP_SCAN_JOB_TYPE, version: 1 },
      {
        jobId: 'analytics-rollup-scan',
        repeat: { every: ANALYTICS_ROLLUP_INTERVAL_MS },
        removeOnComplete: { age: 3600, count: 100 },
        removeOnFail: { age: 86_400 },
      },
    );
  }

  async process(job: Job<{ type: string; version: 1 }>) {
    if (job.name !== ANALYTICS_ROLLUP_SCAN_JOB_TYPE) return;
    const result = await this.rebuildRecentApiRequestRollups(new Date());
    if (result.rebuilt > 0) {
      this.logger.log({ ...result, message: 'Analytics rollup scan rebuilt buckets' });
    }
  }

  async rebuildRecentApiRequestRollups(now: Date) {
    const claimed = await this.prisma.$queryRaw<Array<{ locked: boolean }>>(Prisma.sql`
      SELECT pg_try_advisory_lock(hashtext('analytics-rollup-scan')) AS locked
    `);
    if (!claimed[0]?.locked) return { rebuilt: 0, locked: true };
    try {
      const start = startOfUtcDay(addDays(now, -ANALYTICS_ROLLUP_LOOKBACK_DAYS));
      const end = startOfUtcDay(addDays(now, 1));
      const workspaces = await this.prisma.workspace.findMany({
        select: { id: true, agencyId: true, agency: { select: { superAgencyId: true } } },
      });
      let rebuilt = 0;
      for (const workspace of workspaces) {
        let cursor = start;
        while (cursor < end) {
          const next = addDays(cursor, 1);
          const used = await this.apiRequestUsage(workspace.id, cursor, next);
          await this.prisma.analyticsRollup.deleteMany({
            where: {
              scopeType: AnalyticsScopeType.WORKSPACE,
              scopeId: workspace.id,
              workspaceId: workspace.id,
              metricKey: API_REQUEST_METRIC_KEY,
              bucket: AnalyticsBucket.DAY,
              bucketStart: cursor,
            },
          });
          await this.prisma.analyticsRollup.create({
            data: {
              scopeType: AnalyticsScopeType.WORKSPACE,
              scopeId: workspace.id,
              workspaceId: workspace.id,
              metricKey: API_REQUEST_METRIC_KEY,
              bucket: AnalyticsBucket.DAY,
              bucketStart: cursor,
              bucketEnd: next,
              value: new Prisma.Decimal(used),
              version: 1,
              rebuiltAt: now,
            },
          });
          rebuilt += 1;
          cursor = next;
        }
      }
      return { rebuilt, locked: false };
    } finally {
      await this.prisma.$queryRaw`SELECT pg_advisory_unlock(hashtext('analytics-rollup-scan'))`;
    }
  }

  private async apiRequestUsage(workspaceId: string, start: Date, end: Date) {
    const result = await this.prisma.billingUsageCounter.aggregate({
      where: {
        scope: BillingUsageScope.WORKSPACE,
        scopeId: workspaceId,
        resourceKey: 'API_REQUESTS',
        periodStart: { lt: end },
        periodEnd: { gt: start },
      },
      _sum: { used: true },
    });
    return Number(result._sum.used ?? 0n);
  }
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}
