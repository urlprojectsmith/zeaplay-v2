import { calculateCompletionPoints } from './point-calculator';

describe('calculateCompletionPoints', () => {
  const rule = {
    isEnabled: true,
    baseXp: 100,
    earlyBonusXp: 20,
    earlyThresholdMinutes: 30,
    latePenaltyPercent: 10,
    penaltyIntervalMinutes: 15,
    maxPenaltyXp: 60,
  };

  it('returns base XP when no deadline exists or completion is exactly at the deadline', () => {
    const completedAt = new Date('2026-01-01T10:00:00.000Z');
    expect(calculateCompletionPoints(rule, completedAt, null)).toMatchObject({
      timing: 'NO_DEADLINE',
      netCompletionXp: 100,
      earlyBonusXp: 0,
      penaltyXp: 0,
    });
    expect(calculateCompletionPoints(rule, completedAt, completedAt)).toMatchObject({
      timing: 'ON_TIME',
      netCompletionXp: 100,
      earlyBonusXp: 0,
      penaltyXp: 0,
    });
  });

  it('applies the fixed early bonus only when the threshold is met', () => {
    expect(
      calculateCompletionPoints(
        rule,
        new Date('2026-01-01T09:29:00.000Z'),
        new Date('2026-01-01T10:00:00.000Z'),
      ),
    ).toMatchObject({ timing: 'EARLY', earlyBonusXp: 20, netCompletionXp: 120 });
    expect(
      calculateCompletionPoints(
        rule,
        new Date('2026-01-01T09:45:00.000Z'),
        new Date('2026-01-01T10:00:00.000Z'),
      ),
    ).toMatchObject({ timing: 'EARLY', earlyBonusXp: 0, netCompletionXp: 100 });
  });

  it('ceil-rounds late minutes and intervals, caps penalty, and never drops below zero', () => {
    expect(
      calculateCompletionPoints(
        rule,
        new Date('2026-01-01T10:15:01.000Z'),
        new Date('2026-01-01T10:00:00.000Z'),
      ),
    ).toMatchObject({
      timing: 'LATE',
      lateMinutes: 16,
      lateIntervals: 2,
      penaltyXp: 20,
      netCompletionXp: 80,
    });
    expect(
      calculateCompletionPoints(
        { ...rule, maxPenaltyXp: 100 },
        new Date('2026-01-01T13:00:00.000Z'),
        new Date('2026-01-01T10:00:00.000Z'),
      ),
    ).toMatchObject({ penaltyXp: 100, netCompletionXp: 0 });
  });
});
