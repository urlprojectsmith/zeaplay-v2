import { TicketSlaProcessor } from './ticket-sla.processor';

describe('TicketSlaProcessor', () => {
  it('marks due running metrics breached at the logical due time', async () => {
    const now = new Date('2026-01-01T12:00:00.000Z');
    const due = new Date('2026-01-01T11:55:00.000Z');
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'state-1' }]),
      ticketSlaState: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'state-1',
          firstResponseCompletedAt: null,
          firstResponseNotApplicableAt: null,
          firstResponseBreachedAt: null,
          firstResponsePausedAt: null,
          firstResponseDueAt: due,
          resolutionCompletedAt: null,
          resolutionBreachedAt: null,
          resolutionPausedAt: null,
          resolutionDueAt: due,
        }),
        update: jest.fn(),
      },
    };
    const prisma = {
      ticketSlaState: {
        findMany: jest.fn().mockResolvedValue([{ id: 'state-1' }]),
      },
      $transaction: jest.fn((callback) => callback(tx)),
    };

    const processor = new TicketSlaProcessor(prisma as never);
    await expect(processor.scan(now)).resolves.toBe(2);
    expect(tx.ticketSlaState.update).toHaveBeenCalledWith({
      where: { id: 'state-1' },
      data: { firstResponseBreachedAt: due, resolutionBreachedAt: due },
    });
  });

  it('does not breach paused or completed metrics', async () => {
    const now = new Date('2026-01-01T12:00:00.000Z');
    const due = new Date('2026-01-01T11:55:00.000Z');
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'state-1' }]),
      ticketSlaState: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'state-1',
          firstResponseCompletedAt: null,
          firstResponseNotApplicableAt: null,
          firstResponseBreachedAt: null,
          firstResponsePausedAt: now,
          firstResponseDueAt: due,
          resolutionCompletedAt: now,
          resolutionBreachedAt: null,
          resolutionPausedAt: null,
          resolutionDueAt: due,
        }),
        update: jest.fn(),
      },
    };
    const prisma = {
      ticketSlaState: {
        findMany: jest.fn().mockResolvedValue([{ id: 'state-1' }]),
      },
      $transaction: jest.fn((callback) => callback(tx)),
    };

    const processor = new TicketSlaProcessor(prisma as never);
    await expect(processor.scan(now)).resolves.toBe(0);
    expect(tx.ticketSlaState.update).not.toHaveBeenCalled();
  });
});
