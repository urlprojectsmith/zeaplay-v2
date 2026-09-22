export interface CompletionPointRuleConfig {
  isEnabled: boolean;
  baseXp: number;
  earlyBonusXp: number;
  earlyThresholdMinutes: number | null;
  latePenaltyPercent: number;
  penaltyIntervalMinutes: number | null;
  maxPenaltyXp: number;
}

export interface CompletionPointCalculation {
  enabled: boolean;
  timing: 'NO_DEADLINE' | 'EARLY' | 'ON_TIME' | 'LATE';
  baseXp: number;
  earlyBonusXp: number;
  penaltyXp: number;
  netCompletionXp: number;
  lateMinutes: number;
  lateIntervals: number;
}

export function calculateCompletionPoints(
  rule: CompletionPointRuleConfig,
  completedAt: Date,
  dueAt?: Date | null,
): CompletionPointCalculation {
  if (!rule.isEnabled) {
    return emptyCalculation(false);
  }
  if (!dueAt) {
    return {
      ...emptyCalculation(true),
      timing: 'NO_DEADLINE',
      baseXp: rule.baseXp,
      netCompletionXp: rule.baseXp,
    };
  }
  const diffMs = completedAt.getTime() - dueAt.getTime();
  if (diffMs === 0) {
    return {
      ...emptyCalculation(true),
      timing: 'ON_TIME',
      baseXp: rule.baseXp,
      netCompletionXp: rule.baseXp,
    };
  }
  if (diffMs < 0) {
    const earlyMinutes = Math.floor(Math.abs(diffMs) / 60_000);
    const earnsBonus =
      rule.earlyBonusXp > 0 &&
      rule.earlyThresholdMinutes !== null &&
      earlyMinutes >= rule.earlyThresholdMinutes;
    return {
      ...emptyCalculation(true),
      timing: 'EARLY',
      baseXp: rule.baseXp,
      earlyBonusXp: earnsBonus ? rule.earlyBonusXp : 0,
      netCompletionXp: rule.baseXp + (earnsBonus ? rule.earlyBonusXp : 0),
    };
  }
  if (rule.latePenaltyPercent <= 0 || !rule.penaltyIntervalMinutes) {
    return {
      ...emptyCalculation(true),
      timing: 'LATE',
      baseXp: rule.baseXp,
      netCompletionXp: rule.baseXp,
      lateMinutes: Math.ceil(diffMs / 60_000),
    };
  }
  const lateMinutes = Math.ceil(diffMs / 60_000);
  const lateIntervals = Math.ceil(lateMinutes / rule.penaltyIntervalMinutes);
  const penaltyPerInterval = Math.ceil((rule.baseXp * rule.latePenaltyPercent) / 100);
  const penaltyXp = Math.min(rule.maxPenaltyXp, lateIntervals * penaltyPerInterval);
  return {
    enabled: true,
    timing: 'LATE',
    baseXp: rule.baseXp,
    earlyBonusXp: 0,
    penaltyXp,
    netCompletionXp: Math.max(0, rule.baseXp - penaltyXp),
    lateMinutes,
    lateIntervals,
  };
}

function emptyCalculation(enabled: boolean): CompletionPointCalculation {
  return {
    enabled,
    timing: 'NO_DEADLINE',
    baseXp: 0,
    earlyBonusXp: 0,
    penaltyXp: 0,
    netCompletionXp: 0,
    lateMinutes: 0,
    lateIntervals: 0,
  };
}
