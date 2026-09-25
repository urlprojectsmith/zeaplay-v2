import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { BillingHistoryEventType, Prisma, SuperAgencySubscriptionStatus } from '@prisma/client';
import type { Job, Queue } from 'bullmq';
import { PrismaService } from '../infrastructure/database/prisma.service';
import { BILLING_LIFECYCLE_QUEUE, BILLING_LIFECYCLE_SCAN_JOB_TYPE } from '../queue/queue.constants';

const BILLING_SCAN_BATCH_SIZE = 100;
const BILLING_SCAN_INTERVAL_MS = 60_000;
const BILLING_GRACE_PERIOD_DAYS = 7;

@Injectable()
@Processor(BILLING_LIFECYCLE_QUEUE)
export class BillingLifecycleProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(BillingLifecycleProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(BILLING_LIFECYCLE_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit() {
    await this.queue.add(
      BILLING_LIFECYCLE_SCAN_JOB_TYPE,
      { type: BILLING_LIFECYCLE_SCAN_JOB_TYPE, version: 1 },
      {
        jobId: 'billing-lifecycle-scan',
        repeat: { every: BILLING_SCAN_INTERVAL_MS },
        removeOnComplete: { age: 3600, count: 100 },
        removeOnFail: { age: 86_400 },
      },
    );
  }

  async process(job: Job<{ type: string; version: 1 }>) {
    if (job.name !== BILLING_LIFECYCLE_SCAN_JOB_TYPE) return;
    const result = await this.scan(new Date());
    if (result.trialGraceStarted > 0 || result.restricted > 0) {
      this.logger.log({ ...result, message: 'Billing lifecycle scan applied transitions' });
    }
  }

  async scan(now: Date) {
    const claimed = await this.prisma.$queryRaw<Array<{ locked: boolean }>>(Prisma.sql`
      SELECT pg_try_advisory_lock(hashtext('billing-lifecycle-scan')) AS locked
    `);
    if (!claimed[0]?.locked) return { trialGraceStarted: 0, restricted: 0 };
    try {
      return await this.prisma.$transaction(async (tx) => {
        const trialing = await tx.superAgencySubscription.findMany({
          where: {
            isCurrent: true,
            status: SuperAgencySubscriptionStatus.TRIALING,
            trialEndsAt: { lte: now },
          },
          select: { id: true, superAgencyId: true, masterPlanId: true, planVersionId: true },
          orderBy: { trialEndsAt: 'asc' },
          take: BILLING_SCAN_BATCH_SIZE,
        });
        for (const subscription of trialing) {
          await tx.superAgencySubscription.update({
            where: { id: subscription.id },
            data: {
              status: SuperAgencySubscriptionStatus.TRIAL_GRACE,
              graceStartedAt: now,
              graceEndsAt: addDays(now, BILLING_GRACE_PERIOD_DAYS),
            },
          });
          await tx.billingHistory.create({
            data: {
              superAgencyId: subscription.superAgencyId,
              masterPlanId: subscription.masterPlanId,
              planVersionId: subscription.planVersionId,
              subscriptionId: subscription.id,
              eventType: BillingHistoryEventType.TRIAL_GRACE_STARTED,
              metadata: { source: 'WORKER', graceDays: BILLING_GRACE_PERIOD_DAYS },
            },
          });
        }

        const graceExpired = await tx.superAgencySubscription.findMany({
          where: {
            isCurrent: true,
            status: {
              in: [
                SuperAgencySubscriptionStatus.GRACE_PERIOD,
                SuperAgencySubscriptionStatus.TRIAL_GRACE,
                SuperAgencySubscriptionStatus.PAYMENT_GRACE,
                SuperAgencySubscriptionStatus.PAST_DUE,
              ],
            },
            graceEndsAt: { lte: now },
          },
          select: { id: true, superAgencyId: true, masterPlanId: true, planVersionId: true },
          orderBy: { graceEndsAt: 'asc' },
          take: BILLING_SCAN_BATCH_SIZE,
        });
        for (const subscription of graceExpired) {
          await tx.superAgencySubscription.update({
            where: { id: subscription.id },
            data: {
              status: SuperAgencySubscriptionStatus.RESTRICTED,
              restrictedAt: now,
            },
          });
          await tx.billingHistory.create({
            data: {
              superAgencyId: subscription.superAgencyId,
              masterPlanId: subscription.masterPlanId,
              planVersionId: subscription.planVersionId,
              subscriptionId: subscription.id,
              eventType: BillingHistoryEventType.RESTRICTED,
              metadata: { source: 'WORKER' },
            },
          });
        }

        return { trialGraceStarted: trialing.length, restricted: graceExpired.length };
      });
    } finally {
      await this.prisma.$queryRaw`SELECT pg_advisory_unlock(hashtext('billing-lifecycle-scan'))`;
    }
  }
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}
