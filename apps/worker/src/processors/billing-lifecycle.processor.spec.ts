import { BillingHistoryEventType, SuperAgencySubscriptionStatus } from '@prisma/client';
import { BillingLifecycleProcessor } from './billing-lifecycle.processor';

describe('BillingLifecycleProcessor', () => {
  it('moves expired trials into seven-day grace and expired grace into restricted mode once', async () => {
    const { processor, prisma } = buildProcessor();
    const now = new Date('2026-10-16T00:00:00.000Z');

    await expect(processor.scan(now)).resolves.toEqual({ trialGraceStarted: 1, restricted: 1 });

    expect(prisma.superAgencySubscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'trial-subscription' },
        data: expect.objectContaining({
          status: SuperAgencySubscriptionStatus.TRIAL_GRACE,
          graceEndsAt: new Date('2026-10-23T00:00:00.000Z'),
        }),
      }),
    );
    expect(prisma.superAgencySubscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'grace-subscription' },
        data: expect.objectContaining({ status: SuperAgencySubscriptionStatus.RESTRICTED }),
      }),
    );
    expect(prisma.billingHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: BillingHistoryEventType.TRIAL_GRACE_STARTED,
          metadata: { source: 'WORKER', graceDays: 7 },
        }),
      }),
    );
    expect(prisma.billingHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: BillingHistoryEventType.RESTRICTED }),
      }),
    );
  });

  it('skips work when another worker owns the advisory lock', async () => {
    const { processor, prisma } = buildProcessor(false);

    await expect(processor.scan(new Date('2026-10-16T00:00:00.000Z'))).resolves.toEqual({
      trialGraceStarted: 0,
      restricted: 0,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

function buildProcessor(locked = true) {
  const tx = {
    superAgencySubscription: {
      findMany: jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: 'trial-subscription',
            superAgencyId: 'super-agency-1',
            masterPlanId: 'plan-1',
            planVersionId: 'version-1',
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 'grace-subscription',
            superAgencyId: 'super-agency-2',
            masterPlanId: 'plan-2',
            planVersionId: 'version-2',
          },
        ]),
      update: jest.fn().mockResolvedValue({ id: 'subscription' }),
    },
    billingHistory: { create: jest.fn().mockResolvedValue({ id: 'history' }) },
  };
  const prisma = {
    $queryRaw: jest
      .fn()
      .mockResolvedValueOnce([{ locked }])
      .mockResolvedValueOnce([{ unlocked: true }]),
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    ...tx,
  };
  const queue = { add: jest.fn().mockResolvedValue({ id: 'job' }) };
  return {
    processor: new BillingLifecycleProcessor(prisma as never, queue as never),
    prisma,
  };
}
