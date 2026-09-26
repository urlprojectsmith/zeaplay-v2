import { AnalyticsRollupProcessor } from './analytics-rollup.processor';
import type { PrismaService } from '../infrastructure/database/prisma.service';

describe('AnalyticsRollupProcessor', () => {
  const queue = { add: jest.fn().mockResolvedValue(undefined) };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registers one repeatable analytics scan job', async () => {
    const processor = new AnalyticsRollupProcessor(
      minimalPrisma() as unknown as PrismaService,
      queue as never,
    );

    await processor.onModuleInit();

    expect(queue.add).toHaveBeenCalledWith(
      'analytics.rollup.scan',
      { type: 'analytics.rollup.scan', version: 1 },
      expect.objectContaining({ jobId: 'analytics-rollup-scan' }),
    );
  });

  it('returns without rebuilding when another worker holds the lock', async () => {
    const prisma = minimalPrisma({
      $queryRaw: jest.fn().mockResolvedValue([{ locked: false }]),
    });
    const processor = new AnalyticsRollupProcessor(
      prisma as unknown as PrismaService,
      queue as never,
    );

    await expect(processor.rebuildRecentApiRequestRollups(new Date())).resolves.toEqual({
      rebuilt: 0,
      locked: true,
    });
    expect(prisma.analyticsRollup.create).not.toHaveBeenCalled();
  });

  it('rebuilds recent Workspace API request buckets idempotently', async () => {
    const prisma = minimalPrisma();
    const processor = new AnalyticsRollupProcessor(
      prisma as unknown as PrismaService,
      queue as never,
    );

    const result = await processor.rebuildRecentApiRequestRollups(
      new Date('2026-09-26T12:00:00.000Z'),
    );

    expect(result).toEqual({ rebuilt: 3, locked: false });
    expect(prisma.analyticsRollup.deleteMany).toHaveBeenCalledTimes(3);
    expect(prisma.analyticsRollup.create).toHaveBeenCalledTimes(3);
  });
});

function minimalPrisma(overrides: Record<string, unknown> = {}) {
  const base = {
    $queryRaw: jest
      .fn()
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([{ unlocked: true }]),
    workspace: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: '00000000-0000-4000-8000-000000000003',
          agencyId: '00000000-0000-4000-8000-000000000002',
          agency: { superAgencyId: '00000000-0000-4000-8000-000000000001' },
        },
      ]),
    },
    billingUsageCounter: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { used: 5n } }),
    },
    analyticsRollup: {
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockResolvedValue({ id: 'rollup-1' }),
    },
  };
  return Object.assign(base, overrides) as unknown as typeof base;
}
