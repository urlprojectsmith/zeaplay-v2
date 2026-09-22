import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  GamificationAchievementCriterionType,
  GamificationAdminEconomy,
  GamificationLeaderboardPrivacyMode,
  GamificationPointCategory,
  GamificationPointScopeType,
  GamificationPointWorkType,
  GamificationRewardInventoryMode,
  GamificationRewardPointEntryType,
  GamificationRewardPointSourceType,
  GamificationRewardRedemptionStatus,
  GamificationStreakQualificationType,
  GamificationWorkXpEventOutcome,
  GamificationWorkXpEventType,
  GamificationWorkXpSkipReason,
  GamificationXpEntryType,
  GamificationXpSourceType,
  MembershipStatus,
  Prisma,
  RoleScope,
} from '@prisma/client';
import { GamificationService } from './gamification.service';
import { GamificationAdminAdjustmentOperation } from './dto/gamification-admin.dto';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const membershipId = '00000000-0000-4000-8000-000000000002';
const actorMembershipId = '00000000-0000-4000-8000-000000000003';
const otherWorkspaceId = '00000000-0000-4000-8000-000000000008';
const otherMembershipId = '00000000-0000-4000-8000-000000000009';
const ticketId = '00000000-0000-4000-8000-000000000010';
const laterAssigneeMembershipId = '00000000-0000-4000-8000-000000000012';
const departmentId = '00000000-0000-4000-8000-000000000013';

const tenant = {
  userId: '00000000-0000-4000-8000-000000000004',
  agencyId: '00000000-0000-4000-8000-000000000005',
  workspaceId,
  workspaceMembershipId: membershipId,
  agencyMembershipId: null,
  roleId: '00000000-0000-4000-8000-000000000006',
  roleName: 'MEMBER',
  permissions: ['gamification.view'],
  accessSource: 'WORKSPACE_MEMBERSHIP' as const,
};
const managerTenant = {
  ...tenant,
  permissions: [
    'gamification.view',
    'gamification.levels.manage',
    'gamification.achievements.manage',
    'gamification.streaks.manage',
  ],
};

describe('GamificationService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('aggregates current, earned, and deducted XP from immutable entries', async () => {
    const { service } = makeService();
    await service.awardSystemXp(baseInput({ amount: 50, idempotencyKey: 'earn:1' }));
    await service.deductSystemXp(
      baseInput({
        amount: -15,
        sourceEvent: 'TASK_PENALTY',
        idempotencyKey: 'deduct:1',
      }),
    );

    await expect(service.getMyXpSummary(tenant)).resolves.toMatchObject({
      currentXp: 35,
      lifetimeEarnedXp: 50,
      lifetimeDeductedXp: 15,
      entryCount: 2,
    });
  });

  it('replays matching idempotency keys without writing a duplicate ledger entry', async () => {
    const { service, entries } = makeService();
    const input = baseInput({ amount: 20, idempotencyKey: 'task:closed:1' });

    const first = await service.awardSystemXp(input);
    const replay = await service.awardSystemXp(input);

    expect(replay.id).toBe(first.id);
    expect(entries).toHaveLength(1);
  });

  it('rejects reused idempotency keys with different XP semantics', async () => {
    const { service } = makeService();
    await service.awardSystemXp(baseInput({ amount: 20, idempotencyKey: 'task:closed:1' }));

    await expect(
      service.awardSystemXp(baseInput({ amount: 25, idempotencyKey: 'task:closed:1' })),
    ).rejects.toThrow(ConflictException);
  });

  it('enforces nonzero signed amounts and the XP floor', async () => {
    const { service } = makeService();
    await expect(service.awardSystemXp(baseInput({ amount: 0 }))).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.deductSystemXp(baseInput({ amount: -1 }))).rejects.toThrow(
      ConflictException,
    );
  });

  it('rejects inactive target memberships and foreign actors', async () => {
    const inactive = makeService({
      memberships: [{ id: membershipId, workspaceId, status: MembershipStatus.SUSPENDED }],
    });
    await expect(inactive.service.awardSystemXp(baseInput({ amount: 10 }))).rejects.toThrow(
      ForbiddenException,
    );

    const foreignActor = makeService();
    await expect(
      foreignActor.service.awardSystemXp(
        baseInput({
          amount: 10,
          actorMembershipId: '00000000-0000-4000-8000-000000000099',
        }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('creates one bounded reversal entry and prevents reversal chains', async () => {
    const { service, entries } = makeService();
    const original = await service.awardSystemXp(
      baseInput({ amount: 40, idempotencyKey: 'earn:1' }),
    );

    const reversal = await service.reverseXpEntry({
      workspaceId,
      membershipId,
      entryId: original.id,
      actorMembershipId,
      reason: 'Correction',
    });

    expect(reversal.amount).toBe(-40);
    expect(reversal.entryType).toBe(GamificationXpEntryType.REVERSAL);
    expect(reversal.reversalOfEntryId).toBe(original.id);
    expect(entries).toHaveLength(2);
    await expect(
      service.reverseXpEntry({ workspaceId, membershipId, entryId: reversal.id, reason: 'Again' }),
    ).rejects.toThrow(ConflictException);
    await expect(
      service.reverseXpEntry({ workspaceId, membershipId, entryId: original.id, reason: 'Again' }),
    ).rejects.toThrow(ConflictException);
  });

  it('returns self-scoped history in deterministic descending order', async () => {
    const { service } = makeService();
    await service.awardSystemXp(baseInput({ amount: 10, idempotencyKey: 'earn:1' }));
    await service.awardSystemXp(baseInput({ amount: 5, idempotencyKey: 'earn:2' }));

    const history = await service.getMyXpHistory(tenant, { page: 1, pageSize: 10 });

    expect(history.total).toBe(2);
    expect(history.items.map((entry) => entry.amount)).toEqual([5, 10]);
  });

  it('keeps XP independent for the same user across workspace memberships', async () => {
    const { service } = makeService({
      memberships: [
        { id: membershipId, workspaceId, status: MembershipStatus.ACTIVE },
        { id: otherMembershipId, workspaceId: otherWorkspaceId, status: MembershipStatus.ACTIVE },
      ],
    });
    await service.awardSystemXp(baseInput({ amount: 30, idempotencyKey: 'workspace-a:earn' }));
    await service.awardSystemXp(
      baseInput({
        workspaceId: otherWorkspaceId,
        membershipId: otherMembershipId,
        amount: 70,
        idempotencyKey: 'workspace-b:earn',
      }),
    );

    await expect(service.getMyXpSummary(tenant)).resolves.toMatchObject({ currentXp: 30 });
    await expect(
      service.getMyXpSummary({
        ...tenant,
        workspaceId: otherWorkspaceId,
        workspaceMembershipId: otherMembershipId,
      }),
    ).resolves.toMatchObject({ currentXp: 70 });
  });

  it('keeps historical XP readable for inactive memberships while rejecting new XP', async () => {
    const { service } = makeService({
      memberships: [{ id: membershipId, workspaceId, status: MembershipStatus.SUSPENDED }],
      entries: [
        {
          id: '00000000-0000-4000-8000-000000000011',
          workspaceId,
          membershipId,
          amount: 45,
          entryType: GamificationXpEntryType.EARN,
          sourceType: GamificationXpSourceType.SYSTEM,
          sourceEvent: 'HISTORICAL_IMPORT',
          sourceEntityId: null,
          idempotencyKey: 'historical:1',
          reversalOfEntryId: null,
          actorMembershipId: null,
          reason: null,
          createdAt: new Date(Date.UTC(2026, 0, 1)),
        },
      ],
    });

    await expect(service.getMyXpSummary(tenant)).resolves.toMatchObject({ currentXp: 45 });
    await expect(service.getMyXpHistory(tenant, { page: 1, pageSize: 10 })).resolves.toMatchObject({
      total: 1,
    });
    await expect(service.awardSystemXp(baseInput({ amount: 10 }))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('keeps Reward Points in an immutable membership-scoped ledger with floor and idempotency', async () => {
    const { service, rewardPointEntries } = makeService();
    const input = rewardPointInput({ amount: 40, idempotencyKey: 'achievement:1:rp' });

    const first = await service.earnRewardPoints(input);
    const replay = await service.earnRewardPoints(input);

    expect(replay.id).toBe(first.id);
    expect(rewardPointEntries).toHaveLength(1);
    await expect(
      service.earnRewardPoints(
        rewardPointInput({ amount: 41, idempotencyKey: 'achievement:1:rp' }),
      ),
    ).rejects.toThrow(ConflictException);
    await expect(
      service.spendRewardPoints(
        rewardPointInput({ amount: -41, idempotencyKey: 'spend:too-much' }),
      ),
    ).rejects.toThrow(ConflictException);
    await expect(service.getMyRewardPointSummary(tenant)).resolves.toMatchObject({
      currentRewardPoints: 40,
      lifetimeEarnedRewardPoints: 40,
    });
  });

  it('awards Achievement Reward Points through the central ledger with a historical snapshot', async () => {
    const { service, rewardPointEntries } = makeService({
      achievements: [
        achievementDefinition({
          criterionType: GamificationAchievementCriterionType.XP_TOTAL_AT_LEAST,
          criterionValue: 10,
          rewardPointsReward: 15,
        }),
      ],
    });

    await service.awardSystemXp(baseInput({ amount: 10, idempotencyKey: 'xp:achievement' }));

    expect(rewardPointEntries).toEqual([
      expect.objectContaining({
        amount: 15,
        entryType: GamificationRewardPointEntryType.EARN,
        sourceType: GamificationRewardPointSourceType.ACHIEVEMENT,
        sourceEvent: 'ACHIEVEMENT_EARNED',
      }),
    ]);
  });

  it('awards daily Streak Reward Points once per Workspace-local day', async () => {
    const { service, rewardPointEntries } = makeService({
      streakConfig: enabledStreakConfig({ dailyRewardPoints: 7 }),
      statusDefinitions: [taskTerminalStatus()],
      auditRows: [taskTerminalAuditRow()],
    });

    await service.evaluateTaskCompletionAchievements(
      workspaceId,
      '00000000-0000-4000-8000-000000000030',
    );
    await service.evaluateTaskCompletionAchievements(
      workspaceId,
      '00000000-0000-4000-8000-000000000030',
    );

    expect(rewardPointEntries).toHaveLength(1);
    expect(rewardPointEntries[0]).toMatchObject({
      amount: 7,
      sourceType: GamificationRewardPointSourceType.STREAK,
      sourceEvent: 'STREAK_DAY_QUALIFIED',
    });
  });

  it('spends on redemption, preserves reward snapshots, and refunds cancellation with inventory restoration', async () => {
    const { service, rewardPointEntries, rewards } = makeService({
      rewards: [
        rewardDefinition({
          pointsCost: 25,
          inventoryMode: GamificationRewardInventoryMode.LIMITED,
          availableQuantity: 1,
        }),
      ],
    });
    await service.earnRewardPoints(rewardPointInput({ amount: 30, idempotencyKey: 'seed:rp' }));

    const redemption = await service.redeemReward(tenant, rewards[0]!.id as string, {
      idempotencyKey: '00000000-0000-4000-8000-000000000099',
    });
    const replay = await service.redeemReward(tenant, rewards[0]!.id as string, {
      idempotencyKey: '00000000-0000-4000-8000-000000000099',
    });

    expect(replay.id).toBe(redemption.id);
    expect(rewards[0]).toMatchObject({ availableQuantity: 0 });
    expect(rewardPointEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          amount: -25,
          entryType: GamificationRewardPointEntryType.SPEND,
          sourceEntityId: redemption.id,
        }),
      ]),
    );

    await service.cancelRewardRedemption(managerTenant, redemption.id, { reason: 'No stock' });

    expect(rewards[0]).toMatchObject({ availableQuantity: 1 });
    expect(rewardPointEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          amount: 25,
          entryType: GamificationRewardPointEntryType.REFUND,
          sourceEntityId: redemption.id,
        }),
      ]),
    );
  });

  it('blocks new redemption after archive while preserving existing pending redemption snapshots', async () => {
    const { service, rewards } = makeService({
      rewards: [
        rewardDefinition({
          pointsCost: 20,
          inventoryMode: GamificationRewardInventoryMode.UNLIMITED,
        }),
      ],
    });
    await service.earnRewardPoints(
      rewardPointInput({ amount: 50, idempotencyKey: 'seed:archive' }),
    );
    const redemption = await service.redeemReward(tenant, rewards[0]!.id as string, {
      idempotencyKey: '00000000-0000-4000-8000-000000000091',
    });

    await service.updateReward(managerTenant, rewards[0]!.id as string, { isActive: false });

    expect(redemption).toMatchObject({
      status: GamificationRewardRedemptionStatus.PENDING,
      rewardNameSnapshot: 'Coffee voucher',
      pointsCostSnapshot: 20,
    });
    await expect(
      service.redeemReward(tenant, rewards[0]!.id as string, {
        idempotencyKey: '00000000-0000-4000-8000-000000000092',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('fulfills without balance or stock mutation and prevents later cancellation', async () => {
    const { service, rewardPointEntries, rewards } = makeService({
      rewards: [
        rewardDefinition({
          pointsCost: 25,
          inventoryMode: GamificationRewardInventoryMode.LIMITED,
          availableQuantity: 1,
        }),
      ],
    });
    await service.earnRewardPoints(
      rewardPointInput({ amount: 30, idempotencyKey: 'seed:fulfill' }),
    );
    const redemption = await service.redeemReward(tenant, rewards[0]!.id as string, {
      idempotencyKey: '00000000-0000-4000-8000-000000000093',
    });
    const entriesAfterRedeem = rewardPointEntries.length;

    const fulfilled = await service.fulfillRewardRedemption(managerTenant, redemption.id);

    expect(fulfilled.status).toBe(GamificationRewardRedemptionStatus.FULFILLED);
    expect(rewardPointEntries).toHaveLength(entriesAfterRedeem);
    expect(rewards[0]).toMatchObject({ availableQuantity: 0 });
    await expect(
      service.cancelRewardRedemption(managerTenant, redemption.id, { reason: 'Too late' }),
    ).rejects.toThrow(ConflictException);
    expect(rewardPointEntries).toHaveLength(entriesAfterRedeem);
  });

  it('prevents double cancellation from double refunding or restoring stock twice', async () => {
    const { service, rewardPointEntries, rewards } = makeService({
      rewards: [
        rewardDefinition({
          pointsCost: 25,
          inventoryMode: GamificationRewardInventoryMode.LIMITED,
          availableQuantity: 1,
        }),
      ],
    });
    await service.earnRewardPoints(rewardPointInput({ amount: 30, idempotencyKey: 'seed:cancel' }));
    const redemption = await service.redeemReward(tenant, rewards[0]!.id as string, {
      idempotencyKey: '00000000-0000-4000-8000-000000000094',
    });

    await service.cancelRewardRedemption(managerTenant, redemption.id, { reason: 'Cancelled' });
    const entriesAfterCancel = rewardPointEntries.length;

    await expect(
      service.cancelRewardRedemption(managerTenant, redemption.id, { reason: 'Again' }),
    ).rejects.toThrow(ConflictException);
    expect(rewardPointEntries).toHaveLength(entriesAfterCancel);
    expect(rewards[0]).toMatchObject({ availableQuantity: 1 });
  });

  it('does not directly award Reward Points for Task, Project, or Ticket events', async () => {
    const { service, rewardPointEntries } = makeService({
      achievements: [
        achievementDefinition({
          criterionType: GamificationAchievementCriterionType.TASK_COMPLETED_COUNT,
          criterionValue: 999,
          rewardPointsReward: 10,
        }),
        achievementDefinition({
          id: '00000000-0000-4000-8000-000000000116',
          criterionType: GamificationAchievementCriterionType.PROJECT_COMPLETED_COUNT,
          criterionValue: 999,
          rewardPointsReward: 10,
        }),
        achievementDefinition({
          id: '00000000-0000-4000-8000-000000000216',
          criterionType: GamificationAchievementCriterionType.TICKET_RESOLVED_COUNT,
          criterionValue: 999,
          rewardPointsReward: 10,
        }),
      ],
      streakConfig: enabledStreakConfig({ dailyRewardPoints: 0 }),
      statusDefinitions: [taskTerminalStatus(), ticketTerminalStatus()],
      auditRows: [
        taskTerminalAuditRow(),
        ticketTerminalAuditRow({ assignedToMembershipId: membershipId }),
      ],
      project: { id: '00000000-0000-4000-8000-000000000040', ownerMembershipId: membershipId },
    });

    await service.evaluateTaskCompletionAchievements(
      workspaceId,
      '00000000-0000-4000-8000-000000000030',
    );
    await service.evaluateProjectCompletionAchievements(
      workspaceId,
      '00000000-0000-4000-8000-000000000040',
    );
    await service.evaluateTicketResolutionAchievements(workspaceId, ticketId, membershipId);

    expect(rewardPointEntries).toHaveLength(0);
  });

  it('applies manual XP and Reward Point adjustments with permissions, floors, idempotency, and audit', async () => {
    const adminTenant = { ...tenant, permissions: ['gamification.adjustments.manage'] };
    const { service, entries, rewardPointEntries, audit } = makeService({
      entries: [baseInput({ amount: 100, idempotencyKey: 'seed:xp' })],
      rewardPointEntries: [rewardPointInput({ amount: 75, idempotencyKey: 'seed:rp' })],
    });

    const xp = await service.adjustAdminBalance(adminTenant, {
      targetMembershipId: membershipId,
      economy: GamificationAdminEconomy.XP,
      operation: GamificationAdminAdjustmentOperation.ADD,
      amount: 25,
      reason: 'Quarterly correction',
      idempotencyKey: 'manual-xp-add',
    });
    const rp = await service.adjustAdminBalance(adminTenant, {
      targetMembershipId: membershipId,
      economy: GamificationAdminEconomy.REWARD_POINTS,
      operation: GamificationAdminAdjustmentOperation.DEDUCT,
      amount: 25,
      reason: 'Duplicate reward correction',
      idempotencyKey: 'manual-rp-deduct',
    });
    const xpDeduct = await service.adjustAdminBalance(adminTenant, {
      targetMembershipId: membershipId,
      economy: GamificationAdminEconomy.XP,
      operation: GamificationAdminAdjustmentOperation.DEDUCT,
      amount: 10,
      reason: 'XP debit correction',
      idempotencyKey: 'manual-xp-deduct',
    });
    const rpAdd = await service.adjustAdminBalance(adminTenant, {
      targetMembershipId: membershipId,
      economy: GamificationAdminEconomy.REWARD_POINTS,
      operation: GamificationAdminAdjustmentOperation.ADD,
      amount: 15,
      reason: 'Reward credit correction',
      idempotencyKey: 'manual-rp-add',
    });
    const replay = await service.adjustAdminBalance(adminTenant, {
      targetMembershipId: membershipId,
      economy: GamificationAdminEconomy.XP,
      operation: GamificationAdminAdjustmentOperation.ADD,
      amount: 25,
      reason: 'Quarterly correction',
      idempotencyKey: 'manual-xp-add',
    });

    expect(xp).toMatchObject({ before: 100, after: 125, amount: 25 });
    expect(rp).toMatchObject({ before: 75, after: 50, amount: 25 });
    expect(xpDeduct).toMatchObject({ before: 125, after: 115, amount: 10 });
    expect(rpAdd).toMatchObject({ before: 50, after: 65, amount: 15 });
    expect(replay.entryId).toBe(xp.entryId);
    expect(entries.filter((entry) => entry.idempotencyKey === 'manual-xp-add')).toHaveLength(1);
    expect(entries.find((entry) => entry.idempotencyKey === 'manual-xp-deduct')).toMatchObject({
      amount: -10,
      entryType: GamificationXpEntryType.ADJUSTMENT,
      sourceType: GamificationXpSourceType.MANUAL,
    });
    expect(
      rewardPointEntries.find((entry) => entry.idempotencyKey === 'manual-rp-add'),
    ).toMatchObject({
      amount: 15,
      entryType: GamificationRewardPointEntryType.ADJUSTMENT,
      sourceType: GamificationRewardPointSourceType.MANUAL,
    });
    expect(
      rewardPointEntries.find((entry) => entry.idempotencyKey === 'manual-rp-deduct'),
    ).toMatchObject({
      amount: -25,
      entryType: GamificationRewardPointEntryType.ADJUSTMENT,
      sourceType: GamificationRewardPointSourceType.MANUAL,
    });
    expect(audit.record).toHaveBeenCalledTimes(4);
    await expect(
      service.adjustAdminBalance(adminTenant, {
        targetMembershipId: membershipId,
        economy: GamificationAdminEconomy.REWARD_POINTS,
        operation: GamificationAdminAdjustmentOperation.DEDUCT,
        amount: 100,
        reason: 'Too much',
        idempotencyKey: 'manual-rp-too-much',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects conflicting admin adjustment idempotency keys before writing another ledger row', async () => {
    const adminTenant = { ...tenant, permissions: ['gamification.adjustments.manage'] };
    const sameWorkspaceTarget = '00000000-0000-4000-8000-000000000020';
    const { service, entries, auditRows } = makeService({
      memberships: [
        { id: membershipId, workspaceId, status: MembershipStatus.ACTIVE },
        { id: sameWorkspaceTarget, workspaceId, status: MembershipStatus.ACTIVE },
      ],
      entries: [baseInput({ amount: 100, idempotencyKey: 'seed:xp' })],
    });

    await service.adjustAdminBalance(adminTenant, {
      targetMembershipId: membershipId,
      economy: GamificationAdminEconomy.XP,
      operation: GamificationAdminAdjustmentOperation.ADD,
      amount: 25,
      reason: 'Correction',
      idempotencyKey: 'manual-conflict',
    });

    await expect(
      service.adjustAdminBalance(adminTenant, {
        targetMembershipId: sameWorkspaceTarget,
        economy: GamificationAdminEconomy.XP,
        operation: GamificationAdminAdjustmentOperation.ADD,
        amount: 25,
        reason: 'Correction',
        idempotencyKey: 'manual-conflict',
      }),
    ).rejects.toThrow(ConflictException);
    await expect(
      service.adjustAdminBalance(adminTenant, {
        targetMembershipId: membershipId,
        economy: GamificationAdminEconomy.XP,
        operation: GamificationAdminAdjustmentOperation.DEDUCT,
        amount: 25,
        reason: 'Correction',
        idempotencyKey: 'manual-conflict',
      }),
    ).rejects.toThrow(ConflictException);
    expect(entries.filter((entry) => entry.idempotencyKey === 'manual-conflict')).toHaveLength(1);
    expect(auditRows.filter((row) => row.action === 'gamification.admin.adjusted')).toHaveLength(1);
  });

  it('replays exact admin adjustment retries without requiring the target to remain active', async () => {
    const adminTenant = { ...tenant, permissions: ['gamification.adjustments.manage'] };
    const memberships: Array<{ id: string; workspaceId: string; status: MembershipStatus }> = [
      { id: membershipId, workspaceId, status: MembershipStatus.ACTIVE },
      { id: actorMembershipId, workspaceId, status: MembershipStatus.ACTIVE },
    ];
    const { service, entries, auditRows } = makeService({
      memberships,
      entries: [baseInput({ amount: 100, idempotencyKey: 'seed:xp' })],
    });

    const result = await service.adjustAdminBalance(adminTenant, {
      targetMembershipId: membershipId,
      economy: GamificationAdminEconomy.XP,
      operation: GamificationAdminAdjustmentOperation.DEDUCT,
      amount: 40,
      reason: 'Retry-safe correction',
      idempotencyKey: 'manual-replay-after-inactive',
    });
    memberships[0]!.status = MembershipStatus.SUSPENDED;

    const replay = await service.adjustAdminBalance(adminTenant, {
      targetMembershipId: membershipId,
      economy: GamificationAdminEconomy.XP,
      operation: GamificationAdminAdjustmentOperation.DEDUCT,
      amount: 40,
      reason: 'Retry-safe correction',
      idempotencyKey: 'manual-replay-after-inactive',
    });

    expect(replay).toMatchObject({
      amount: 40,
      before: result.before,
      after: result.after,
      member: { membershipId, status: MembershipStatus.SUSPENDED },
    });
    expect(
      entries.filter((entry) => entry.idempotencyKey === 'manual-replay-after-inactive'),
    ).toHaveLength(1);
    expect(auditRows.filter((row) => row.action === 'gamification.admin.adjusted')).toHaveLength(1);
  });

  it('requires separate reset permission and protected one-time step-up for XP reset', async () => {
    const resetTenant = { ...tenant, permissions: ['gamification.reset'] };
    const grant = resetGrant(GamificationAdminEconomy.XP);
    const { service, entries, stepUpGrants, auditRows } = makeService({
      entries: [baseInput({ amount: 245, idempotencyKey: 'seed:reset-xp' })],
      stepUpGrants: [grant],
    });

    await expect(
      service.adjustAdminBalance(resetTenant, {
        targetMembershipId: membershipId,
        economy: GamificationAdminEconomy.XP,
        operation: GamificationAdminAdjustmentOperation.ADD,
        amount: 1,
        reason: 'Not allowed',
        idempotencyKey: 'not-allowed',
      }),
    ).rejects.toThrow(ForbiddenException);

    const result = await service.resetAdminBalance(
      resetTenant,
      {
        targetMembershipId: membershipId,
        economy: GamificationAdminEconomy.XP,
        reason: 'Reset after audit',
        confirmation: 'RESET',
        stepUpGrantId: String(grant.id),
        idempotencyKey: 'reset-xp-1',
      },
      'refresh-token',
    );

    expect(result).toMatchObject({ changed: true, before: 245, after: 0 });
    expect(entries.at(-1)).toMatchObject({
      amount: -245,
      entryType: GamificationXpEntryType.ADJUSTMENT,
      sourceEvent: 'MANUAL_XP_RESET',
    });
    expect(stepUpGrants[0]?.usedAt).toBeInstanceOf(Date);
    expect(auditRows).toHaveLength(1);
    await expect(
      service.resetAdminBalance(
        resetTenant,
        {
          targetMembershipId: membershipId,
          economy: GamificationAdminEconomy.XP,
          reason: 'Replay with consumed grant and new key',
          confirmation: 'RESET',
          stepUpGrantId: String(grant.id),
          idempotencyKey: 'reset-xp-2',
        },
        'refresh-token',
      ),
    ).rejects.toThrow(UnauthorizedException);
    const replay = await service.resetAdminBalance(
      resetTenant,
      {
        targetMembershipId: membershipId,
        economy: GamificationAdminEconomy.XP,
        reason: 'Reset after audit',
        confirmation: 'RESET',
        stepUpGrantId: String(grant.id),
        idempotencyKey: 'reset-xp-1',
      },
      'refresh-token',
    );
    expect(replay).toMatchObject({ before: 245, after: 0 });
    expect(entries.filter((entry) => entry.sourceEvent === 'MANUAL_XP_RESET')).toHaveLength(1);
  });

  it('replays exact reset retries without requiring the target to remain active', async () => {
    const resetTenant = { ...tenant, permissions: ['gamification.reset'] };
    const grant = resetGrant(GamificationAdminEconomy.XP);
    const memberships: Array<{ id: string; workspaceId: string; status: MembershipStatus }> = [
      { id: membershipId, workspaceId, status: MembershipStatus.ACTIVE },
      { id: actorMembershipId, workspaceId, status: MembershipStatus.ACTIVE },
    ];
    const { service, entries, auditRows } = makeService({
      memberships,
      entries: [baseInput({ amount: 140, idempotencyKey: 'seed:reset-xp-inactive' })],
      stepUpGrants: [grant],
    });

    const result = await service.resetAdminBalance(
      resetTenant,
      {
        targetMembershipId: membershipId,
        economy: GamificationAdminEconomy.XP,
        reason: 'Reset with replay',
        confirmation: 'RESET',
        stepUpGrantId: String(grant.id),
        idempotencyKey: 'reset-replay-after-inactive',
      },
      'refresh-token',
    );
    memberships[0]!.status = MembershipStatus.SUSPENDED;

    const replay = await service.resetAdminBalance(
      resetTenant,
      {
        targetMembershipId: membershipId,
        economy: GamificationAdminEconomy.XP,
        reason: 'Reset with replay',
        confirmation: 'RESET',
        stepUpGrantId: String(grant.id),
        idempotencyKey: 'reset-replay-after-inactive',
      },
      'refresh-token',
    );

    expect(replay).toMatchObject({
      before: result.before,
      after: 0,
      member: { membershipId, status: MembershipStatus.SUSPENDED },
    });
    expect(entries.filter((entry) => entry.sourceEvent === 'MANUAL_XP_RESET')).toHaveLength(1);
    expect(auditRows.filter((row) => row.action === 'gamification.admin.reset')).toHaveLength(1);
  });

  it('rejects conflicting reset idempotency keys and stale step-up bindings', async () => {
    const resetTenant = { ...tenant, permissions: ['gamification.reset'] };
    const sameWorkspaceTarget = '00000000-0000-4000-8000-000000000020';
    const grant = resetGrant(GamificationAdminEconomy.XP);
    const wrongTargetGrant = resetGrant(GamificationAdminEconomy.XP, {
      id: '00000000-0000-4000-8000-000000000088',
      targetMembershipId: sameWorkspaceTarget,
    });
    const wrongEconomyGrant = resetGrant(GamificationAdminEconomy.REWARD_POINTS, {
      id: '00000000-0000-4000-8000-000000000089',
    });
    const { service, entries, auditRows } = makeService({
      memberships: [
        { id: membershipId, workspaceId, status: MembershipStatus.ACTIVE },
        { id: sameWorkspaceTarget, workspaceId, status: MembershipStatus.ACTIVE },
      ],
      entries: [baseInput({ amount: 245, idempotencyKey: 'seed:reset-xp' })],
      stepUpGrants: [grant, wrongTargetGrant, wrongEconomyGrant],
    });

    await expect(
      service.resetAdminBalance(
        resetTenant,
        {
          targetMembershipId: membershipId,
          economy: GamificationAdminEconomy.XP,
          reason: 'Wrong target grant',
          confirmation: 'RESET',
          stepUpGrantId: String(wrongTargetGrant.id),
          idempotencyKey: 'wrong-target-grant',
        },
        'refresh-token',
      ),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      service.resetAdminBalance(
        resetTenant,
        {
          targetMembershipId: membershipId,
          economy: GamificationAdminEconomy.XP,
          reason: 'Wrong economy grant',
          confirmation: 'RESET',
          stepUpGrantId: String(wrongEconomyGrant.id),
          idempotencyKey: 'wrong-economy-grant',
        },
        'refresh-token',
      ),
    ).rejects.toThrow(UnauthorizedException);

    await service.resetAdminBalance(
      resetTenant,
      {
        targetMembershipId: membershipId,
        economy: GamificationAdminEconomy.XP,
        reason: 'Reset after audit',
        confirmation: 'RESET',
        stepUpGrantId: String(grant.id),
        idempotencyKey: 'reset-conflict',
      },
      'refresh-token',
    );

    await expect(
      service.resetAdminBalance(
        resetTenant,
        {
          targetMembershipId: sameWorkspaceTarget,
          economy: GamificationAdminEconomy.XP,
          reason: 'Reset after audit',
          confirmation: 'RESET',
          stepUpGrantId: String(wrongTargetGrant.id),
          idempotencyKey: 'reset-conflict',
        },
        'refresh-token',
      ),
    ).rejects.toThrow(ConflictException);
    await expect(
      service.resetAdminBalance(
        resetTenant,
        {
          targetMembershipId: membershipId,
          economy: GamificationAdminEconomy.XP,
          reason: 'Changed reset reason',
          confirmation: 'RESET',
          stepUpGrantId: String(grant.id),
          idempotencyKey: 'reset-conflict',
        },
        'refresh-token',
      ),
    ).rejects.toThrow(ConflictException);
    expect(entries.filter((entry) => entry.sourceEvent === 'MANUAL_XP_RESET')).toHaveLength(1);
    expect(auditRows.filter((row) => row.action === 'gamification.admin.reset')).toHaveLength(1);
  });

  it('resets Reward Points without deleting redemption history and future refunds can increase balance', async () => {
    const resetTenant = { ...tenant, permissions: ['gamification.reset'] };
    const grant = resetGrant(GamificationAdminEconomy.REWARD_POINTS);
    const redemptionId = '00000000-0000-4000-8000-000000000060';
    const rewardId = '00000000-0000-4000-8000-000000000061';
    const { service, rewardPointEntries, redemptions } = makeService({
      rewardPointEntries: [rewardPointInput({ amount: 90, idempotencyKey: 'seed:reset-rp' })],
      rewards: [
        {
          id: rewardId,
          workspaceId,
          name: 'Coffee',
          normalizedName: 'coffee',
          description: null,
          pointsCost: 30,
          inventoryMode: GamificationRewardInventoryMode.UNLIMITED,
          availableQuantity: null,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      redemptions: [
        {
          id: redemptionId,
          workspaceId,
          membershipId,
          rewardDefinitionId: rewardId,
          status: GamificationRewardRedemptionStatus.PENDING,
          rewardNameSnapshot: 'Coffee',
          pointsCostSnapshot: 30,
          inventoryModeSnapshot: GamificationRewardInventoryMode.UNLIMITED,
          requestedAt: new Date(Date.UTC(2026, 0, 1)),
          fulfilledAt: null,
          cancelledAt: null,
          fulfilledByMembershipId: null,
          cancelledByMembershipId: null,
          cancelReason: null,
          idempotencyKey: 'redeem:coffee',
        },
      ],
      stepUpGrants: [grant],
    });

    const result = await service.resetAdminBalance(
      resetTenant,
      {
        targetMembershipId: membershipId,
        economy: GamificationAdminEconomy.REWARD_POINTS,
        reason: 'Reset points',
        confirmation: 'RESET',
        stepUpGrantId: String(grant.id),
        idempotencyKey: 'reset-rp-1',
      },
      'refresh-token',
    );
    expect(result).toMatchObject({ before: 90, after: 0 });
    expect(redemptions).toHaveLength(1);
    await service.cancelRewardRedemption(resetTenant, redemptionId, { reason: 'Cancelled later' });
    const balance = rewardPointEntries.reduce((sum, entry) => sum + Number(entry.amount), 0);
    expect(balance).toBe(30);
  });

  it('does not create amount-zero ledger entries for already-zero resets', async () => {
    const resetTenant = { ...tenant, permissions: ['gamification.reset'] };
    const grant = resetGrant(GamificationAdminEconomy.XP);
    const { service, entries, auditRows } = makeService({ stepUpGrants: [grant] });

    const result = await service.resetAdminBalance(
      resetTenant,
      {
        targetMembershipId: membershipId,
        economy: GamificationAdminEconomy.XP,
        reason: 'Already zero',
        confirmation: 'RESET',
        stepUpGrantId: String(grant.id),
        idempotencyKey: 'reset-zero',
      },
      'refresh-token',
    );

    expect(result).toMatchObject({ changed: false, before: 0, after: 0 });
    expect(entries).toHaveLength(0);
    expect(auditRows).toHaveLength(1);
  });

  it('returns a Workspace leaderboard using current XP, dense shared ranks, privacy, and zero-XP members', async () => {
    const topMemberId = '00000000-0000-4000-8000-000000000021';
    const tiedMemberId = '00000000-0000-4000-8000-000000000022';
    const zeroMemberId = '00000000-0000-4000-8000-000000000023';
    const optedOutMemberId = '00000000-0000-4000-8000-000000000024';
    const { service } = makeService({
      leaderboardConfig: {
        enabled: true,
        workspaceLeaderboardEnabled: true,
        departmentLeaderboardEnabled: true,
      },
      memberships: [
        { id: membershipId, workspaceId, status: MembershipStatus.ACTIVE, userName: 'Current' },
        { id: topMemberId, workspaceId, status: MembershipStatus.ACTIVE, userName: 'Top User' },
        { id: tiedMemberId, workspaceId, status: MembershipStatus.ACTIVE, userName: 'Tie User' },
        { id: zeroMemberId, workspaceId, status: MembershipStatus.ACTIVE, userName: 'Zero User' },
        {
          id: optedOutMemberId,
          workspaceId,
          status: MembershipStatus.ACTIVE,
          userName: 'Hidden User',
        },
      ],
      entries: [
        xpEntry({ membershipId: topMemberId, amount: 150 }),
        xpEntry({ membershipId: tiedMemberId, amount: 100 }),
        xpEntry({ membershipId, amount: 100 }),
        xpEntry({ membershipId: optedOutMemberId, amount: 999 }),
      ],
      leaderboardPreferences: [
        { membershipId: topMemberId, privacyMode: GamificationLeaderboardPrivacyMode.SHOW_NAME },
        { membershipId, privacyMode: GamificationLeaderboardPrivacyMode.ANONYMOUS },
        { membershipId: optedOutMemberId, privacyMode: GamificationLeaderboardPrivacyMode.OPT_OUT },
      ],
      levels: [level({ name: 'Starter', levelNumber: 1, xpThreshold: 0 })],
    });

    const result = await service.getWorkspaceLeaderboard({
      ...tenant,
      permissions: ['gamification.leaderboards.view'],
    });

    expect(result.available).toBe(true);
    expect(result.entries.map((entry) => [entry.rank, entry.displayName, entry.currentXp])).toEqual(
      [
        [1, 'Top User', 150],
        [2, 'You', 100],
        [2, 'Anonymous Member', 100],
        [3, 'Anonymous Member', 0],
      ],
    );
    expect(result.entries).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ displayName: 'Hidden User' })]),
    );
    expect(result.me).toMatchObject({ included: true, rank: 2, inTopEntries: true });
    expect(result.entries[0]!.currentLevel).toMatchObject({ name: 'Starter' });
  });

  it('uses dense rank semantics for repeated ties and deterministic tie display order', async () => {
    const members = [1500, 1500, 1200, 1200, 900, 0, 0].map((amount, index) => ({
      id: `00000000-0000-4000-8000-${String(3000 + index).padStart(12, '0')}`,
      workspaceId,
      status: MembershipStatus.ACTIVE,
      userName: `Member ${index}`,
      amount,
    }));
    const { service } = makeService({
      leaderboardConfig: { enabled: true, workspaceLeaderboardEnabled: true },
      memberships: [
        { id: membershipId, workspaceId, status: MembershipStatus.ACTIVE, userName: 'Current' },
        ...members,
      ],
      entries: [
        xpEntry({ membershipId, amount: 0 }),
        ...members
          .filter((member) => member.amount > 0)
          .map((member) => xpEntry({ membershipId: member.id, amount: member.amount })),
      ],
    });

    const result = await service.getWorkspaceLeaderboard(leaderboardViewTenant());

    expect(result.entries.map((entry) => entry.rank)).toEqual([1, 1, 2, 2, 3, 4, 4, 4]);
    const tiedRankOne = result.entries.filter((entry) => entry.rank === 1);
    expect(tiedRankOne.map((entry) => entry.currentXp)).toEqual([1500, 1500]);
  });

  it('returns Top 100 plus current user position without loading every prior row', async () => {
    const members = [
      { id: membershipId, workspaceId, status: MembershipStatus.ACTIVE, userName: 'Current' },
      ...Array.from({ length: 101 }, (_, index) => ({
        id: `00000000-0000-4000-8000-${String(2000 + index).padStart(12, '0')}`,
        workspaceId,
        status: MembershipStatus.ACTIVE,
        userName: `Member ${index}`,
      })),
    ];
    const { service } = makeService({
      leaderboardConfig: { enabled: true, workspaceLeaderboardEnabled: true },
      memberships: members,
      entries: members.map((member, index) =>
        xpEntry({ membershipId: member.id, amount: member.id === membershipId ? 1 : 1000 - index }),
      ),
    });

    const result = await service.getWorkspaceLeaderboard({
      ...tenant,
      permissions: ['gamification.leaderboards.view'],
    });

    expect(result.entries).toHaveLength(100);
    expect(result.me).toMatchObject({ included: true, rank: 102, inTopEntries: false });
  });

  it('caps Top 100 even when boundary users are tied and preserves outside tied self rank', async () => {
    const lateCurrentMembershipId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const members = Array.from({ length: 130 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(4000 + index).padStart(12, '0')}`,
      workspaceId,
      status: MembershipStatus.ACTIVE,
      userName: `Boundary ${index}`,
    }));
    const { service } = makeService({
      leaderboardConfig: { enabled: true, workspaceLeaderboardEnabled: true },
      memberships: [
        ...members,
        {
          id: lateCurrentMembershipId,
          workspaceId,
          status: MembershipStatus.ACTIVE,
          userName: 'Current',
        },
      ],
      entries: [
        ...members.map((member) => xpEntry({ membershipId: member.id, amount: 500 })),
        xpEntry({ membershipId: lateCurrentMembershipId, amount: 500 }),
      ],
    });

    const result = await service.getWorkspaceLeaderboard({
      ...leaderboardViewTenant(),
      workspaceMembershipId: lateCurrentMembershipId,
    });

    expect(result.entries).toHaveLength(100);
    expect(result.entries.every((entry) => entry.rank === 1)).toBe(true);
    expect(result.me).toMatchObject({ included: true, rank: 1, currentXp: 500 });
    expect(result.me.inTopEntries).toBe(false);
  });

  it('excludes inactive and OPT_OUT members before rank calculation and returns no rank for OPT_OUT self', async () => {
    const inactiveMemberId = '00000000-0000-4000-8000-000000000041';
    const visibleMemberId = '00000000-0000-4000-8000-000000000042';
    const { service } = makeService({
      leaderboardConfig: { enabled: true, workspaceLeaderboardEnabled: true },
      memberships: [
        { id: membershipId, workspaceId, status: MembershipStatus.ACTIVE, userName: 'Current' },
        {
          id: inactiveMemberId,
          workspaceId,
          status: MembershipStatus.SUSPENDED,
          userName: 'Inactive',
        },
        { id: visibleMemberId, workspaceId, status: MembershipStatus.ACTIVE, userName: 'Visible' },
      ],
      entries: [
        xpEntry({ membershipId: inactiveMemberId, amount: 2000 }),
        xpEntry({ membershipId, amount: 1800 }),
        xpEntry({ membershipId: visibleMemberId, amount: 1500 }),
      ],
      leaderboardPreferences: [
        { membershipId, privacyMode: GamificationLeaderboardPrivacyMode.OPT_OUT },
        {
          membershipId: visibleMemberId,
          privacyMode: GamificationLeaderboardPrivacyMode.SHOW_NAME,
        },
      ],
    });

    const result = await service.getWorkspaceLeaderboard(leaderboardViewTenant());

    expect(result.entries.map((entry) => [entry.rank, entry.displayName, entry.currentXp])).toEqual(
      [[1, 'Visible', 1500]],
    );
    expect(result.me).toMatchObject({
      included: false,
      rank: null,
      currentXp: null,
      privacyMode: GamificationLeaderboardPrivacyMode.OPT_OUT,
    });
  });

  it('keeps anonymous response rows free of raw identity and contact fields', async () => {
    const anonymousMemberId = '00000000-0000-4000-8000-000000000043';
    const { service } = makeService({
      leaderboardConfig: { enabled: true, workspaceLeaderboardEnabled: true },
      memberships: [
        { id: membershipId, workspaceId, status: MembershipStatus.ACTIVE, userName: 'Current' },
        {
          id: anonymousMemberId,
          workspaceId,
          status: MembershipStatus.ACTIVE,
          userName: 'Secret Person',
        },
      ],
      entries: [xpEntry({ membershipId: anonymousMemberId, amount: 100 })],
      leaderboardPreferences: [
        {
          membershipId: anonymousMemberId,
          privacyMode: GamificationLeaderboardPrivacyMode.ANONYMOUS,
        },
      ],
    });

    const result = await service.getWorkspaceLeaderboard(leaderboardViewTenant());
    const anonymous = result.entries.find((entry) => !entry.isCurrentUser)!;

    expect(anonymous).toMatchObject({
      displayName: 'Anonymous Member',
      privacyMode: GamificationLeaderboardPrivacyMode.ANONYMOUS,
    });
    expect(JSON.stringify(anonymous)).not.toContain(anonymousMemberId);
    expect(JSON.stringify(anonymous)).not.toContain('Secret Person');
    expect(anonymous).not.toHaveProperty('membershipId');
    expect(anonymous).not.toHaveProperty('userId');
    expect(anonymous).not.toHaveProperty('email');
    expect(anonymous).not.toHaveProperty('phone');
  });

  it('keeps Reward Point changes independent from rank', async () => {
    const peerId = '00000000-0000-4000-8000-000000000044';
    const { service } = makeService({
      leaderboardConfig: { enabled: true, workspaceLeaderboardEnabled: true },
      memberships: [
        { id: membershipId, workspaceId, status: MembershipStatus.ACTIVE, userName: 'Current' },
        { id: peerId, workspaceId, status: MembershipStatus.ACTIVE, userName: 'Peer' },
      ],
      entries: [
        xpEntry({ membershipId, amount: 100 }),
        xpEntry({ membershipId: peerId, amount: 100 }),
      ],
      rewardPointEntries: [
        rewardPointEntry({ membershipId, amount: 999999 }),
        rewardPointEntry({ membershipId: peerId, amount: 1 }),
      ],
    });

    const before = await service.getWorkspaceLeaderboard(leaderboardViewTenant());
    await service.spendRewardPoints(
      rewardPointInput({ amount: -500, idempotencyKey: 'spend:rank-independent' }),
    );
    const after = await service.getWorkspaceLeaderboard(leaderboardViewTenant());

    expect(after.entries.map((entry) => [entry.rank, entry.currentXp])).toEqual(
      before.entries.map((entry) => [entry.rank, entry.currentXp]),
    );
  });

  it('keeps Department leaderboard scoped to the current Department and unavailable without one', async () => {
    const salesPeerId = '00000000-0000-4000-8000-000000000031';
    const otherDepartmentMemberId = '00000000-0000-4000-8000-000000000032';
    const otherDepartmentId = '00000000-0000-4000-8000-000000000033';
    const { service } = makeService({
      leaderboardConfig: {
        enabled: true,
        workspaceLeaderboardEnabled: true,
        departmentLeaderboardEnabled: true,
      },
      memberships: [
        {
          id: membershipId,
          workspaceId,
          status: MembershipStatus.ACTIVE,
          departmentId,
          userName: 'Current',
        },
        {
          id: salesPeerId,
          workspaceId,
          status: MembershipStatus.ACTIVE,
          departmentId,
          userName: 'Sales Peer',
        },
        {
          id: otherDepartmentMemberId,
          workspaceId,
          status: MembershipStatus.ACTIVE,
          departmentId: otherDepartmentId,
          userName: 'Other Dept',
        },
      ],
      departments: [
        { id: departmentId, workspaceId, name: 'Sales' },
        { id: otherDepartmentId, workspaceId, name: 'Support' },
      ],
      entries: [
        xpEntry({ membershipId: salesPeerId, amount: 70 }),
        xpEntry({ membershipId, amount: 50 }),
        xpEntry({ membershipId: otherDepartmentMemberId, amount: 999 }),
      ],
    });

    const result = await service.getMyDepartmentLeaderboard({
      ...tenant,
      permissions: ['gamification.leaderboards.view'],
    });

    expect(result.entries.map((entry) => entry.currentXp)).toEqual([70, 50]);
    expect(result.entries).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ currentXp: 999 })]),
    );

    const unavailable = makeService({
      leaderboardConfig: { enabled: true, departmentLeaderboardEnabled: true },
    });
    await expect(
      unavailable.service.getMyDepartmentLeaderboard(leaderboardViewTenant()),
    ).resolves.toMatchObject({
      available: false,
      reason: 'NO_DEPARTMENT',
    });
  });

  it('defaults Leaderboards to disabled and lets users update only their own privacy', async () => {
    const { service, leaderboardPreferences, audit } = makeService();

    await expect(service.getWorkspaceLeaderboard(leaderboardViewTenant())).resolves.toMatchObject({
      available: false,
      reason: 'DISABLED',
      me: { privacyMode: GamificationLeaderboardPrivacyMode.ANONYMOUS },
    });

    const updated = await service.updateMyLeaderboardPreference(tenant, {
      privacyMode: GamificationLeaderboardPrivacyMode.OPT_OUT,
    });

    expect(updated).toMatchObject({
      membershipId,
      privacyMode: GamificationLeaderboardPrivacyMode.OPT_OUT,
    });
    expect(leaderboardPreferences).toHaveLength(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'gamification.leaderboard_privacy.updated',
        entityType: 'GamificationLeaderboardPreference',
      }),
    );
  });

  it('returns explicit unavailable states for independently disabled leaderboard scopes', async () => {
    const disabledWorkspace = makeService({
      leaderboardConfig: {
        enabled: true,
        workspaceLeaderboardEnabled: false,
        departmentLeaderboardEnabled: true,
      },
    });
    await expect(
      disabledWorkspace.service.getWorkspaceLeaderboard(leaderboardViewTenant()),
    ).resolves.toMatchObject({ available: false, reason: 'WORKSPACE_DISABLED' });

    const disabledDepartment = makeService({
      leaderboardConfig: {
        enabled: true,
        workspaceLeaderboardEnabled: true,
        departmentLeaderboardEnabled: false,
      },
      memberships: [
        { id: membershipId, workspaceId, status: MembershipStatus.ACTIVE, departmentId },
      ],
    });
    await expect(
      disabledDepartment.service.getMyDepartmentLeaderboard(leaderboardViewTenant()),
    ).resolves.toMatchObject({ available: false, reason: 'DEPARTMENT_DISABLED' });
  });

  it('enforces leaderboard view/manage permissions without role-name shortcuts', async () => {
    const { service } = makeService({
      leaderboardConfig: { enabled: true, workspaceLeaderboardEnabled: true },
    });

    await expect(service.getWorkspaceLeaderboard(tenant)).rejects.toThrow(ForbiddenException);
    await expect(service.getLeaderboardConfig(tenant)).rejects.toThrow(ForbiddenException);
    await expect(service.updateLeaderboardConfig(tenant, { enabled: true })).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('resolves point rules from workspace defaults, department overrides, and disabled overrides', async () => {
    const pointTenant = { ...tenant, permissions: ['gamification.points.view'] };
    const disabledDepartmentRule = pointRule({
      id: 'point-rule-2',
      departmentId,
      scopeType: GamificationPointScopeType.DEPARTMENT,
      isEnabled: false,
      baseXp: 0,
    });
    const { service } = makeService({
      departments: [{ id: departmentId, workspaceId, name: 'Support', status: 'ACTIVE' }],
      pointRules: [
        pointRule({
          id: 'point-rule-1',
          scopeType: GamificationPointScopeType.WORKSPACE,
          baseXp: 25,
          earlyBonusXp: 5,
          earlyThresholdMinutes: 30,
        }),
        disabledDepartmentRule,
      ],
    });

    const result = await service.listPointRules(pointTenant, { departmentId });
    const effective = result.effectiveCompletionRules.find(
      (rule) =>
        rule.workType === GamificationPointWorkType.TASK &&
        rule.category === GamificationPointCategory.MEDIUM,
    );

    expect(effective).toMatchObject({
      source: 'DEPARTMENT_OVERRIDE',
      rule: disabledDepartmentRule,
    });
  });

  it('upserts and removes department point overrides with scoped permissions and no XP ledger writes', async () => {
    const departmentManagerTenant = {
      ...tenant,
      permissions: ['gamification.points.manage_department'],
    };
    const { service, pointRules, entries, auditRows } = makeService({
      memberships: [
        { id: membershipId, workspaceId, status: MembershipStatus.ACTIVE, departmentId },
      ],
      departments: [{ id: departmentId, workspaceId, name: 'Support', status: 'ACTIVE' }],
    });

    const created = await service.upsertCompletionPointRule(departmentManagerTenant, {
      scopeType: GamificationPointScopeType.DEPARTMENT,
      departmentId,
      workType: GamificationPointWorkType.TICKET,
      category: GamificationPointCategory.URGENT,
      isEnabled: true,
      baseXp: 50,
      earlyBonusXp: 10,
      earlyThresholdMinutes: 20,
      latePenaltyPercent: 25,
      penaltyIntervalMinutes: 30,
      maxPenaltyXp: 50,
    });

    expect(created).toMatchObject({
      departmentId,
      workType: GamificationPointWorkType.TICKET,
      category: GamificationPointCategory.URGENT,
      baseXp: 50,
    });
    expect(pointRules).toHaveLength(1);
    expect(entries).toHaveLength(0);

    await service.removeCompletionPointRuleOverride(departmentManagerTenant, {
      departmentId,
      workType: GamificationPointWorkType.TICKET,
      category: GamificationPointCategory.URGENT,
    });
    expect(pointRules).toHaveLength(0);
    expect(auditRows.map((row) => row.action)).toEqual([
      'gamification.point_rule.upserted',
      'gamification.point_rule.override_removed',
    ]);
  });

  it('validates point category combinations and completion rule math fields', async () => {
    const admin = { ...tenant, permissions: ['gamification.points.manage_workspace'] };
    const { service } = makeService();
    await expect(
      service.upsertCompletionPointRule(admin, {
        scopeType: GamificationPointScopeType.WORKSPACE,
        workType: GamificationPointWorkType.PROJECT,
        category: GamificationPointCategory.LOW,
        isEnabled: true,
        baseXp: 10,
        earlyBonusXp: 0,
        latePenaltyPercent: 0,
        maxPenaltyXp: 0,
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.upsertCompletionPointRule(admin, {
        scopeType: GamificationPointScopeType.WORKSPACE,
        workType: GamificationPointWorkType.TASK,
        category: GamificationPointCategory.HIGH,
        isEnabled: true,
        baseXp: 10,
        earlyBonusXp: 5,
        latePenaltyPercent: 0,
        maxPenaltyXp: 0,
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.upsertCompletionPointRule(admin, {
        scopeType: GamificationPointScopeType.WORKSPACE,
        workType: GamificationPointWorkType.TASK,
        category: GamificationPointCategory.HIGH,
        isEnabled: true,
        baseXp: 10,
        earlyBonusXp: 0,
        latePenaltyPercent: 10,
        penaltyIntervalMinutes: 10,
        maxPenaltyXp: 20,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('manages creation XP by dynamic workspace roles and rejects foreign roles', async () => {
    const admin = { ...tenant, permissions: ['gamification.points.manage_workspace'] };
    const customRoleId = '00000000-0000-4000-8000-000000000111';
    const foreignRoleId = '00000000-0000-4000-8000-000000000112';
    const { service, creationPointRules, entries } = makeService({
      roles: [
        {
          id: customRoleId,
          key: 'workspace-custom',
          name: 'Custom Agent',
          scope: RoleScope.WORKSPACE,
          isSystem: false,
          isActive: true,
          workspaceId,
        },
        {
          id: foreignRoleId,
          key: 'foreign-custom',
          name: 'Foreign',
          scope: RoleScope.WORKSPACE,
          isSystem: false,
          isActive: true,
          workspaceId: otherWorkspaceId,
        },
      ],
    });

    await expect(
      service.upsertCreationPointRule(admin, {
        scopeType: GamificationPointScopeType.WORKSPACE,
        workType: GamificationPointWorkType.PROJECT,
        category: GamificationPointCategory.LONG_TERM,
        roleId: foreignRoleId,
        isEnabled: true,
        creationXp: 15,
      }),
    ).rejects.toThrow(ForbiddenException);

    const created = await service.upsertCreationPointRule(admin, {
      scopeType: GamificationPointScopeType.WORKSPACE,
      workType: GamificationPointWorkType.PROJECT,
      category: GamificationPointCategory.LONG_TERM,
      roleId: customRoleId,
      isEnabled: true,
      creationXp: 15,
    });

    expect(created).toMatchObject({ roleId: customRoleId, creationXp: 15 });
    expect(creationPointRules).toHaveLength(1);
    expect(entries).toHaveLength(0);
  });

  it('awards creation XP once to the creator through a durable linked work event', async () => {
    const { service, entries, workXpEvents } = makeService({
      memberships: [
        {
          id: membershipId,
          workspaceId,
          status: MembershipStatus.ACTIVE,
          roleId: tenant.roleId,
        },
        { id: actorMembershipId, workspaceId, status: MembershipStatus.ACTIVE },
      ],
      creationPointRules: [
        creationPointRule({
          workType: GamificationPointWorkType.TASK,
          category: GamificationPointCategory.HIGH,
          roleId: tenant.roleId,
          creationXp: 14,
        }),
      ],
      task: {
        id: '00000000-0000-4000-8000-000000000030',
        title: 'Create onboarding task',
        priority: GamificationPointCategory.HIGH,
        departmentId,
        department: { name: 'Support' },
      },
    });

    await service.handleTaskCreationXp(
      workspaceId,
      '00000000-0000-4000-8000-000000000030',
      membershipId,
    );
    await service.handleTaskCreationXp(
      workspaceId,
      '00000000-0000-4000-8000-000000000030',
      membershipId,
    );

    expect(workXpEvents).toHaveLength(1);
    expect(workXpEvents[0]).toMatchObject({
      eventType: GamificationWorkXpEventType.CREATION_AWARD,
      outcome: GamificationWorkXpEventOutcome.APPLIED,
      recipientMembershipId: membershipId,
      creationXpSnapshot: 14,
      workType: GamificationPointWorkType.TASK,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      amount: 14,
      membershipId,
      workXpEventId: workXpEvents[0]!.id,
      sourceType: GamificationXpSourceType.TASK,
      sourceEvent: 'CREATION_AWARD:CREATION',
    });
  });

  it('records explicit skipped work XP events without writing ledger rows', async () => {
    const { service, entries, workXpEvents } = makeService({
      creationPointRules: [],
      task: {
        id: '00000000-0000-4000-8000-000000000030',
        title: 'Unconfigured task',
        priority: GamificationPointCategory.MEDIUM,
      },
    });

    await service.handleTaskCreationXp(
      workspaceId,
      '00000000-0000-4000-8000-000000000030',
      membershipId,
    );

    expect(entries).toHaveLength(0);
    expect(workXpEvents).toHaveLength(1);
    expect(workXpEvents[0]).toMatchObject({
      outcome: GamificationWorkXpEventOutcome.SKIPPED,
      skipReason: GamificationWorkXpSkipReason.NOT_CONFIGURED,
    });
  });

  it('awards completion Base, Bonus, and Penalty as separate atomic ledger components', async () => {
    jest.useFakeTimers().setSystemTime(new Date(Date.UTC(2026, 0, 1, 12, 45)));
    const dueAt = new Date(Date.UTC(2026, 0, 1, 12, 0));
    const { service, entries, workXpEvents } = makeService({
      pointRules: [
        pointRule({
          workType: GamificationPointWorkType.TASK,
          category: GamificationPointCategory.URGENT,
          baseXp: 50,
          earlyBonusXp: 5,
          earlyThresholdMinutes: 30,
          latePenaltyPercent: 10,
          penaltyIntervalMinutes: 15,
          maxPenaltyXp: 20,
        }),
      ],
      task: {
        id: '00000000-0000-4000-8000-000000000030',
        title: 'Complete incident task',
        priority: GamificationPointCategory.URGENT,
        dueAt,
      },
    });

    await service.handleTaskCompletionXp(
      workspaceId,
      '00000000-0000-4000-8000-000000000030',
      actorMembershipId,
    );

    expect(workXpEvents).toHaveLength(1);
    expect(workXpEvents[0]).toMatchObject({
      eventType: GamificationWorkXpEventType.COMPLETION_AWARD,
      outcome: GamificationWorkXpEventOutcome.APPLIED,
      baseXpSnapshot: 50,
      bonusXpSnapshot: 0,
      penaltyXpSnapshot: 15,
      netXpSnapshot: 35,
      completionCycle: 1,
    });
    expect(entries.map((entry) => entry.amount)).toEqual([50, -15]);
    expect(entries.map((entry) => entry.workXpEventId)).toEqual([
      workXpEvents[0]!.id,
      workXpEvents[0]!.id,
    ]);
  });

  it('awards Base only when completed work has no deadline', async () => {
    jest.useFakeTimers().setSystemTime(new Date(Date.UTC(2026, 0, 1, 12, 0)));
    const { service, entries, workXpEvents } = makeService({
      pointRules: [
        pointRule({
          workType: GamificationPointWorkType.TASK,
          category: GamificationPointCategory.HIGH,
          baseXp: 40,
          earlyBonusXp: 10,
          earlyThresholdMinutes: 30,
          latePenaltyPercent: 50,
          penaltyIntervalMinutes: 15,
          maxPenaltyXp: 40,
        }),
      ],
      task: {
        id: '00000000-0000-4000-8000-000000000030',
        title: 'No deadline task',
        priority: GamificationPointCategory.HIGH,
        dueAt: null,
      },
    });

    await service.handleTaskCompletionXp(
      workspaceId,
      '00000000-0000-4000-8000-000000000030',
      actorMembershipId,
    );

    expect(workXpEvents[0]).toMatchObject({
      baseXpSnapshot: 40,
      bonusXpSnapshot: 0,
      penaltyXpSnapshot: 0,
      netXpSnapshot: 40,
    });
    expect(entries.map((entry) => entry.amount)).toEqual([40]);
  });

  it('reverses creation XP once and does not let restore farm another creation award', async () => {
    const taskId = '00000000-0000-4000-8000-000000000030';
    const { service, entries, workXpEvents } = makeService({
      creationPointRules: [
        creationPointRule({
          workType: GamificationPointWorkType.TASK,
          category: GamificationPointCategory.MEDIUM,
          roleId: tenant.roleId,
          creationXp: 12,
        }),
      ],
      task: {
        id: taskId,
        title: 'Creation reversal task',
        priority: GamificationPointCategory.MEDIUM,
      },
    });

    await service.handleTaskCreationXp(workspaceId, taskId, membershipId);
    await service.handleWorkCreationVoid(
      workspaceId,
      GamificationPointWorkType.TASK,
      taskId,
      actorMembershipId,
    );
    await service.handleWorkCreationVoid(
      workspaceId,
      GamificationPointWorkType.TASK,
      taskId,
      actorMembershipId,
    );
    await service.handleTaskCreationXp(workspaceId, taskId, membershipId);

    expect(workXpEvents.map((event) => event.eventType)).toEqual([
      GamificationWorkXpEventType.CREATION_AWARD,
      GamificationWorkXpEventType.CREATION_REVERSAL,
      GamificationWorkXpEventType.CREATION_REVERSAL,
    ]);
    expect(workXpEvents[2]).toMatchObject({
      outcome: GamificationWorkXpEventOutcome.SKIPPED,
      skipReason: GamificationWorkXpSkipReason.NO_PRIOR_AWARD,
    });
    expect(entries.map((entry) => entry.amount)).toEqual([12, -12]);
    expect(entries[1]).toMatchObject({
      entryType: GamificationXpEntryType.REVERSAL,
      reversalOfEntryId: entries[0]!.id,
    });
  });

  it('snapshots Department override rules without rewriting historical work XP events', async () => {
    const departmentRule = pointRule({
      id: 'department-point-rule-1',
      scopeType: GamificationPointScopeType.DEPARTMENT,
      departmentId,
      workType: GamificationPointWorkType.TASK,
      category: GamificationPointCategory.HIGH,
      baseXp: 22,
    });
    const { service, pointRules, workXpEvents } = makeService({
      pointRules: [
        pointRule({
          id: 'workspace-point-rule-1',
          workType: GamificationPointWorkType.TASK,
          category: GamificationPointCategory.HIGH,
          baseXp: 10,
        }),
        departmentRule,
      ],
      task: {
        id: '00000000-0000-4000-8000-000000000030',
        title: 'Department task',
        priority: GamificationPointCategory.HIGH,
        departmentId,
        department: { name: 'Support' },
      },
    });

    await service.handleTaskCompletionXp(
      workspaceId,
      '00000000-0000-4000-8000-000000000030',
      actorMembershipId,
    );
    pointRules[1]!.baseXp = 99;

    expect(workXpEvents[0]).toMatchObject({
      ruleIdSnapshot: departmentRule.id,
      ruleSourceSnapshot: 'DEPARTMENT_OVERRIDE',
      departmentIdSnapshot: departmentId,
      baseXpSnapshot: 22,
      netXpSnapshot: 22,
    });
  });

  it('reopens by reversing the latest completion cycle exactly once', async () => {
    jest.useFakeTimers().setSystemTime(new Date(Date.UTC(2026, 0, 1, 11, 0)));
    const taskId = '00000000-0000-4000-8000-000000000030';
    const { service, entries, workXpEvents } = makeService({
      pointRules: [
        pointRule({
          workType: GamificationPointWorkType.TASK,
          category: GamificationPointCategory.HIGH,
          baseXp: 30,
          earlyBonusXp: 10,
          earlyThresholdMinutes: 30,
        }),
      ],
      task: {
        id: taskId,
        title: 'Cycle task',
        priority: GamificationPointCategory.HIGH,
        dueAt: new Date(Date.UTC(2026, 0, 1, 12, 0)),
      },
    });

    await service.handleTaskCompletionXp(workspaceId, taskId, actorMembershipId);
    await service.handleWorkReopen(
      workspaceId,
      GamificationPointWorkType.TASK,
      taskId,
      actorMembershipId,
    );
    await service.handleWorkReopen(
      workspaceId,
      GamificationPointWorkType.TASK,
      taskId,
      actorMembershipId,
    );

    expect(workXpEvents).toHaveLength(3);
    expect(
      workXpEvents.filter((event) => event.outcome === GamificationWorkXpEventOutcome.APPLIED),
    ).toHaveLength(2);
    expect(workXpEvents.slice(0, 2).map((event) => event.eventType)).toEqual([
      GamificationWorkXpEventType.COMPLETION_AWARD,
      GamificationWorkXpEventType.COMPLETION_REVERSAL,
    ]);
    expect(workXpEvents[2]).toMatchObject({
      outcome: GamificationWorkXpEventOutcome.SKIPPED,
      skipReason: GamificationWorkXpSkipReason.NO_PRIOR_AWARD,
    });
    expect(entries.map((entry) => entry.amount)).toEqual([30, 10, -30, -10]);
    expect(entries.slice(2).map((entry) => entry.reversalOfEntryId)).toEqual([
      entries[0]!.id,
      entries[1]!.id,
    ]);
  });

  it('recompletion creates a new cycle using the current rule and new deadline', async () => {
    jest.useFakeTimers().setSystemTime(new Date(Date.UTC(2026, 0, 1, 11, 0)));
    const taskId = '00000000-0000-4000-8000-000000000030';
    const task = {
      id: taskId,
      title: 'Recompletion task',
      priority: GamificationPointCategory.HIGH,
      dueAt: new Date(Date.UTC(2026, 0, 1, 12, 0)),
    };
    const { service, entries, pointRules, workXpEvents } = makeService({
      pointRules: [
        pointRule({
          workType: GamificationPointWorkType.TASK,
          category: GamificationPointCategory.HIGH,
          baseXp: 20,
        }),
      ],
      task,
    });

    await service.handleTaskCompletionXp(workspaceId, taskId, actorMembershipId);
    await service.handleWorkReopen(
      workspaceId,
      GamificationPointWorkType.TASK,
      taskId,
      actorMembershipId,
    );
    pointRules[0]!.baseXp = 35;
    task.dueAt = new Date(Date.UTC(2026, 0, 2, 12, 0));
    await service.handleTaskCompletionXp(workspaceId, taskId, actorMembershipId);

    const completionAwards = workXpEvents.filter(
      (event) => event.eventType === GamificationWorkXpEventType.COMPLETION_AWARD,
    );
    expect(completionAwards.map((event) => event.completionCycle)).toEqual([1, 2]);
    expect(completionAwards.map((event) => event.baseXpSnapshot)).toEqual([20, 35]);
    expect(entries.map((entry) => entry.amount)).toEqual([20, -20, 35]);
  });

  it('does not deduct unrelated later XP when reopening after an admin reset', async () => {
    jest.useFakeTimers().setSystemTime(new Date(Date.UTC(2026, 0, 1, 11, 0)));
    const taskId = '00000000-0000-4000-8000-000000000030';
    const { service, entries, workXpEvents } = makeService({
      pointRules: [
        pointRule({
          workType: GamificationPointWorkType.TASK,
          category: GamificationPointCategory.HIGH,
          baseXp: 30,
        }),
      ],
      task: {
        id: taskId,
        title: 'Reset-safe task',
        priority: GamificationPointCategory.HIGH,
      },
    });

    await service.handleTaskCompletionXp(workspaceId, taskId, actorMembershipId);
    entries.push({
      id: '00000000-0000-4000-8000-000000000090',
      workspaceId,
      membershipId,
      amount: -30,
      entryType: GamificationXpEntryType.REVERSAL,
      sourceType: GamificationXpSourceType.MANUAL,
      sourceEvent: 'ADMIN_XP_RESET',
      sourceEntityId: null,
      idempotencyKey: 'admin-reset:1',
      reversalOfEntryId: null,
      actorMembershipId,
      reason: 'Reset',
      createdAt: new Date(Date.UTC(2026, 0, 1, 11, 30)),
    });
    await service.awardSystemXp(
      baseInput({ amount: 25, idempotencyKey: 'later-earn', sourceEvent: 'LATER_EARN' }),
    );
    await service.handleWorkReopen(
      workspaceId,
      GamificationPointWorkType.TASK,
      taskId,
      actorMembershipId,
    );

    expect(entries.map((entry) => entry.amount)).toEqual([30, -30, 25]);
    expect(workXpEvents[1]).toMatchObject({
      eventType: GamificationWorkXpEventType.COMPLETION_REVERSAL,
      outcome: GamificationWorkXpEventOutcome.SKIPPED,
      skipReason: GamificationWorkXpSkipReason.ALREADY_NEUTRALIZED_BY_RESET,
    });
  });

  it('uses Project XP category for creation and owner-only completion XP', async () => {
    const projectId = '00000000-0000-4000-8000-000000000040';
    const { service, entries, workXpEvents } = makeService({
      memberships: [
        {
          id: membershipId,
          workspaceId,
          status: MembershipStatus.ACTIVE,
          roleId: tenant.roleId,
        },
        { id: actorMembershipId, workspaceId, status: MembershipStatus.ACTIVE },
      ],
      creationPointRules: [
        creationPointRule({
          workType: GamificationPointWorkType.PROJECT,
          category: GamificationPointCategory.LONG_TERM,
          roleId: tenant.roleId,
          creationXp: 18,
        }),
      ],
      pointRules: [
        pointRule({
          workType: GamificationPointWorkType.PROJECT,
          category: GamificationPointCategory.LONG_TERM,
          baseXp: 70,
        }),
      ],
      project: {
        id: projectId,
        name: 'Long project',
        xpCategory: GamificationPointCategory.LONG_TERM,
        departmentId: null,
        department: null,
        dueAt: null,
        ownerMembershipId: membershipId,
        ownerMembership: { status: MembershipStatus.ACTIVE },
      },
    });

    await service.handleProjectCreationXp(workspaceId, projectId, membershipId);
    await service.handleProjectCompletionXp(workspaceId, projectId, actorMembershipId);

    expect(workXpEvents.map((event) => event.categorySnapshot)).toEqual([
      GamificationPointCategory.LONG_TERM,
      GamificationPointCategory.LONG_TERM,
    ]);
    expect(entries.map((entry) => entry.sourceType)).toEqual([
      GamificationXpSourceType.PROJECT,
      GamificationXpSourceType.PROJECT,
    ]);
    expect(entries.map((entry) => entry.amount)).toEqual([18, 70]);
  });

  it('awards Ticket completion XP to the resolver using the gamification target date', async () => {
    jest.useFakeTimers().setSystemTime(new Date(Date.UTC(2026, 0, 2, 10, 0)));
    const resolutionTarget = new Date(Date.UTC(2026, 0, 2, 11, 0));
    const { service, entries, workXpEvents } = makeService({
      memberships: [
        { id: membershipId, workspaceId, status: MembershipStatus.ACTIVE },
        { id: actorMembershipId, workspaceId, status: MembershipStatus.ACTIVE },
      ],
      pointRules: [
        pointRule({
          workType: GamificationPointWorkType.TICKET,
          category: GamificationPointCategory.URGENT,
          baseXp: 45,
          earlyBonusXp: 5,
          earlyThresholdMinutes: 30,
        }),
      ],
      ticket: {
        id: ticketId,
        ticketNumber: 'TCK-1',
        subject: 'Emergency ticket',
        priority: GamificationPointCategory.URGENT,
        departmentId: null,
        department: null,
        gamificationResolutionTargetAt: resolutionTarget,
        slaState: { resolutionDueAt: new Date(Date.UTC(2026, 0, 1, 10, 0)) },
        assignedToMembership: { status: MembershipStatus.ACTIVE },
      },
    });

    await service.handleTicketCompletionXp(workspaceId, ticketId, membershipId, actorMembershipId);

    expect(workXpEvents).toHaveLength(1);
    expect(workXpEvents[0]).toMatchObject({
      workType: GamificationPointWorkType.TICKET,
      recipientMembershipId: membershipId,
      dueAtSnapshot: resolutionTarget,
      baseXpSnapshot: 45,
      bonusXpSnapshot: 5,
      netXpSnapshot: 50,
    });
    expect(entries.map((entry) => entry.amount)).toEqual([45, 5]);
    expect(entries.every((entry) => entry.sourceType === GamificationXpSourceType.TICKET)).toBe(
      true,
    );
  });

  it('returns no level progression when a workspace has no configured active levels', async () => {
    const { service } = makeService();

    await expect(service.getMyXpSummary(tenant)).resolves.toMatchObject({
      currentXp: 0,
      levelsConfigured: false,
      currentLevel: null,
      nextLevel: null,
      progressPercent: null,
    });
  });

  it('derives current and next level from current workspace XP', async () => {
    const { service } = makeService({
      levels: [
        level({ name: 'Starter', levelNumber: 1, xpThreshold: 0 }),
        level({ name: 'Builder', levelNumber: 2, xpThreshold: 100 }),
        level({ name: 'Expert', levelNumber: 3, xpThreshold: 250 }),
      ],
    });
    await service.awardSystemXp(baseInput({ amount: 175, idempotencyKey: 'earn:progress' }));

    await expect(service.getMyXpSummary(tenant)).resolves.toMatchObject({
      currentXp: 175,
      levelsConfigured: true,
      currentLevel: expect.objectContaining({ name: 'Builder', levelNumber: 2 }),
      nextLevel: expect.objectContaining({ name: 'Expert', levelNumber: 3 }),
      xpIntoCurrentLevel: 75,
      xpToNextLevel: 75,
      progressPercent: 50,
      isMaxLevel: false,
    });
  });

  it('returns max-level progression at or above the highest active threshold', async () => {
    const { service } = makeService({
      levels: [
        level({ name: 'Starter', levelNumber: 1, xpThreshold: 0 }),
        level({ name: 'Expert', levelNumber: 3, xpThreshold: 250 }),
      ],
    });
    await service.awardSystemXp(baseInput({ amount: 300, idempotencyKey: 'earn:max' }));

    await expect(service.getMyXpSummary(tenant)).resolves.toMatchObject({
      currentLevel: expect.objectContaining({ name: 'Expert' }),
      nextLevel: null,
      progressPercent: 100,
      xpToNextLevel: null,
      isMaxLevel: true,
    });
  });

  it('selects the exact threshold level and derives lower levels after XP deductions', async () => {
    const { service } = makeService({
      levels: [
        level({ name: 'Starter', levelNumber: 1, xpThreshold: 0 }),
        level({ name: 'Builder', levelNumber: 2, xpThreshold: 100 }),
        level({ name: 'Expert', levelNumber: 3, xpThreshold: 250 }),
      ],
    });
    await service.awardSystemXp(baseInput({ amount: 250, idempotencyKey: 'earn:threshold' }));

    await expect(service.getMyXpSummary(tenant)).resolves.toMatchObject({
      currentXp: 250,
      currentLevel: expect.objectContaining({ name: 'Expert', levelNumber: 3 }),
      progressPercent: 100,
      isMaxLevel: true,
    });

    await service.deductSystemXp(
      baseInput({
        amount: -151,
        sourceEvent: 'TASK_PENALTY',
        idempotencyKey: 'deduct:level-down',
      }),
    );

    await expect(service.getMyXpSummary(tenant)).resolves.toMatchObject({
      currentXp: 99,
      currentLevel: expect.objectContaining({ name: 'Starter', levelNumber: 1 }),
      nextLevel: expect.objectContaining({ name: 'Builder', levelNumber: 2 }),
      xpToNextLevel: 1,
      progressPercent: 99,
      isMaxLevel: false,
    });
  });

  it('validates active progression atomically during level configuration changes', async () => {
    const { service } = makeService();

    await expect(
      service.createLevel(managerTenant, { name: 'Builder', levelNumber: 2, xpThreshold: 100 }),
    ).rejects.toThrow(ConflictException);

    await service.createLevel(managerTenant, { name: 'Starter', levelNumber: 1, xpThreshold: 0 });
    await expect(
      service.createLevel(managerTenant, { name: 'Flat', levelNumber: 2, xpThreshold: 0 }),
    ).rejects.toThrow(ConflictException);

    const builder = await service.createLevel(managerTenant, {
      name: 'Builder',
      levelNumber: 2,
      xpThreshold: 100,
    });
    await expect(
      service.updateLevel(managerTenant, builder.id, { xpThreshold: 0 }),
    ).rejects.toThrow(ConflictException);
  });

  it('keeps inactive levels out of viewer lists and progression', async () => {
    const { service } = makeService({
      levels: [
        level({ name: 'Starter', levelNumber: 1, xpThreshold: 0 }),
        level({ name: 'Archived', levelNumber: 2, xpThreshold: 50, isActive: false }),
      ],
    });

    await expect(service.listLevels(tenant, { includeInactive: true })).resolves.toMatchObject({
      items: [expect.objectContaining({ name: 'Starter' })],
    });
    await expect(
      service.listLevels(managerTenant, { includeInactive: true }),
    ).resolves.toMatchObject({
      items: [
        expect.objectContaining({ name: 'Starter' }),
        expect.objectContaining({ name: 'Archived' }),
      ],
    });
  });

  it('archives levels without modifying XP and rejects cross-workspace level mutation', async () => {
    const builder = level({ name: 'Builder', levelNumber: 2, xpThreshold: 100 });
    const { service, entries } = makeService({
      levels: [level({ name: 'Starter', levelNumber: 1, xpThreshold: 0 }), builder],
    });
    await service.awardSystemXp(baseInput({ amount: 125, idempotencyKey: 'earn:archive' }));

    await service.updateLevel(managerTenant, String(builder.id), { isActive: false });

    expect(entries).toHaveLength(1);
    await expect(service.getMyXpSummary(tenant)).resolves.toMatchObject({
      currentXp: 125,
      currentLevel: expect.objectContaining({ name: 'Starter' }),
      progressPercent: 100,
      isMaxLevel: true,
    });
    await expect(
      service.updateLevel({ ...managerTenant, workspaceId: otherWorkspaceId }, String(builder.id), {
        name: 'Foreign edit',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('credits ticket resolution progress from the first terminal transition before membership filtering', async () => {
    const definition = achievementDefinition({
      criterionType: GamificationAchievementCriterionType.TICKET_RESOLVED_COUNT,
      criterionValue: 1,
    });
    const { service } = makeService({
      memberships: [
        { id: membershipId, workspaceId, status: MembershipStatus.ACTIVE },
        { id: actorMembershipId, workspaceId, status: MembershipStatus.ACTIVE },
        { id: laterAssigneeMembershipId, workspaceId, status: MembershipStatus.ACTIVE },
      ],
      achievements: [definition],
      statusDefinitions: [
        {
          id: '00000000-0000-4000-8000-000000000013',
          workspaceId,
          entityType: 'TICKET',
          isTerminal: true,
        },
      ],
      auditRows: [
        ticketTerminalAuditRow({
          id: '00000000-0000-4000-8000-000000000014',
          assignedToMembershipId: membershipId,
          createdAt: new Date(Date.UTC(2026, 0, 1, 10)),
        }),
        ticketTerminalAuditRow({
          id: '00000000-0000-4000-8000-000000000015',
          assignedToMembershipId: laterAssigneeMembershipId,
          createdAt: new Date(Date.UTC(2026, 0, 2, 10)),
        }),
      ],
    });

    const firstResolverProgress = await service.listAchievements(tenant, {});
    const laterAssigneeProgress = await service.listAchievements(
      { ...tenant, workspaceMembershipId: laterAssigneeMembershipId },
      {},
    );

    expect(firstResolverProgress.items[0]).toMatchObject({
      id: definition.id,
      progress: { currentValue: 1, targetValue: 1, percent: 100 },
    });
    expect(laterAssigneeProgress.items[0]).toMatchObject({
      id: definition.id,
      progress: { currentValue: 0, targetValue: 1, percent: 0 },
    });
  });

  it('returns disabled zero streak summary when no config row exists', async () => {
    const { service } = makeService();

    await expect(service.getMyStreakSummary(tenant)).resolves.toMatchObject({
      config: { enabled: false, dailyXpReward: 0 },
      currentStreak: 0,
      longestStreak: 0,
      qualifiedToday: false,
    });
  });

  it('enables streaks without backfill and creates one rewarded local day per member date', async () => {
    const { service, streakDays, entries } = makeService({
      workspaceTimezone: 'Asia/Kolkata',
    });
    await service.updateStreakConfig(managerTenant, { enabled: true, dailyXpReward: 25 });
    const enabledAt = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));

    await service.evaluateTaskCompletionAchievements(
      workspaceId,
      '00000000-0000-4000-8000-000000000030',
    );
    await service.evaluateTicketResolutionAchievements(workspaceId, ticketId, membershipId);

    expect(streakDays).toHaveLength(1);
    expect(streakDays[0]).toMatchObject({
      workspaceId,
      membershipId,
      qualificationType: GamificationStreakQualificationType.TASK_COMPLETED,
      timezoneSnapshot: 'Asia/Kolkata',
      dailyXpRewardSnapshot: 25,
    });
    expect((streakDays[0]?.qualifiedAt as Date).getTime()).toBeGreaterThanOrEqual(
      enabledAt.getTime(),
    );
    expect(
      entries.filter((entry) => entry.sourceType === GamificationXpSourceType.STREAK),
    ).toHaveLength(1);
  });

  it('does not credit a later ticket assignee for first-resolution streak qualification', async () => {
    const { service, streakDays } = makeService({
      streakConfig: {
        id: '00000000-0000-4000-8000-000000000031',
        workspaceId,
        enabled: true,
        dailyXpReward: 0,
        enabledAt: new Date(Date.UTC(2025, 11, 31)),
        createdAt: new Date(Date.UTC(2025, 11, 31)),
        updatedAt: new Date(Date.UTC(2025, 11, 31)),
      },
      statusDefinitions: [
        {
          id: '00000000-0000-4000-8000-000000000013',
          workspaceId,
          entityType: 'TICKET',
          isTerminal: true,
        },
      ],
      auditRows: [
        ticketTerminalAuditRow({
          id: '00000000-0000-4000-8000-000000000032',
          assignedToMembershipId: membershipId,
          createdAt: new Date(Date.UTC(2026, 0, 1, 10)),
        }),
        ticketTerminalAuditRow({
          id: '00000000-0000-4000-8000-000000000033',
          assignedToMembershipId: laterAssigneeMembershipId,
          createdAt: new Date(Date.UTC(2026, 0, 2, 10)),
        }),
      ],
      memberships: [
        { id: membershipId, workspaceId, status: MembershipStatus.ACTIVE },
        { id: laterAssigneeMembershipId, workspaceId, status: MembershipStatus.ACTIVE },
      ],
    });

    await service.evaluateTicketResolutionAchievements(
      workspaceId,
      ticketId,
      laterAssigneeMembershipId,
    );

    expect(streakDays).toHaveLength(1);
    expect(streakDays[0]).toMatchObject({ membershipId });
  });

  it('derives current and longest streaks from immutable Workspace-local days', async () => {
    jest.useFakeTimers().setSystemTime(new Date(Date.UTC(2026, 0, 10, 4, 0)));
    const { service } = makeService({
      streakConfig: enabledStreakConfig(),
      streakDays: [
        streakDay({ localDate: new Date(Date.UTC(2026, 0, 4)) }),
        streakDay({ localDate: new Date(Date.UTC(2026, 0, 5)) }),
        streakDay({ localDate: new Date(Date.UTC(2026, 0, 8)) }),
        streakDay({ localDate: new Date(Date.UTC(2026, 0, 9)) }),
      ],
    });

    await expect(service.getMyStreakSummary(tenant)).resolves.toMatchObject({
      currentStreak: 2,
      longestStreak: 2,
      qualifiedToday: false,
      needsActionToday: true,
      lastQualifiedDate: '2026-01-09',
    });
  });

  it('resets current streak after a missed complete day while preserving longest streak', async () => {
    jest.useFakeTimers().setSystemTime(new Date(Date.UTC(2026, 0, 10, 12, 0)));
    const { service } = makeService({
      streakConfig: enabledStreakConfig(),
      streakDays: [
        streakDay({ localDate: new Date(Date.UTC(2026, 0, 2)) }),
        streakDay({ localDate: new Date(Date.UTC(2026, 0, 3)) }),
        streakDay({ localDate: new Date(Date.UTC(2026, 0, 4)) }),
        streakDay({ localDate: new Date(Date.UTC(2026, 0, 8)) }),
      ],
    });

    await expect(service.getMyStreakSummary(tenant)).resolves.toMatchObject({
      currentStreak: 0,
      longestStreak: 3,
      qualifiedToday: false,
      needsActionToday: true,
      lastQualifiedDate: '2026-01-08',
    });
  });

  it('uses Workspace timezone, not browser timezone, for the immutable local StreakDay date', async () => {
    const { service, streakDays } = makeService({
      workspaceTimezone: 'Asia/Kolkata',
      streakConfig: enabledStreakConfig({ enabledAt: new Date(Date.UTC(2025, 11, 31)) }),
      statusDefinitions: [taskTerminalStatus()],
      auditRows: [
        taskTerminalAuditRow({
          createdAt: new Date(Date.UTC(2026, 0, 1, 20, 30)),
        }),
      ],
    });

    await service.evaluateTaskCompletionAchievements(
      workspaceId,
      '00000000-0000-4000-8000-000000000030',
    );

    expect(streakDays).toHaveLength(1);
    expect(streakDays[0]).toMatchObject({
      timezoneSnapshot: 'Asia/Kolkata',
      localDate: new Date(Date.UTC(2026, 0, 2)),
    });
  });

  it('does not backfill events before enabledAt, including after re-enable', async () => {
    const { service, streakDays } = makeService({
      streakConfig: enabledStreakConfig({
        enabledAt: new Date(Date.UTC(2026, 0, 10)),
      }),
      statusDefinitions: [taskTerminalStatus()],
      auditRows: [
        taskTerminalAuditRow({
          createdAt: new Date(Date.UTC(2026, 0, 9, 12)),
        }),
      ],
    });

    await service.evaluateTaskCompletionAchievements(
      workspaceId,
      '00000000-0000-4000-8000-000000000030',
    );

    expect(streakDays).toHaveLength(0);
  });

  it('qualifies each active Task assignee independently and ignores non-assignee followers', async () => {
    const followerMembershipId = '00000000-0000-4000-8000-000000000040';
    const { service, streakDays } = makeService({
      memberships: [
        { id: membershipId, workspaceId, status: MembershipStatus.ACTIVE },
        { id: laterAssigneeMembershipId, workspaceId, status: MembershipStatus.ACTIVE },
        { id: followerMembershipId, workspaceId, status: MembershipStatus.ACTIVE },
      ],
      taskAssigneeMembershipIds: [membershipId, laterAssigneeMembershipId],
      streakConfig: enabledStreakConfig(),
      statusDefinitions: [taskTerminalStatus()],
      auditRows: [taskTerminalAuditRow()],
    });

    await service.evaluateTaskCompletionAchievements(
      workspaceId,
      '00000000-0000-4000-8000-000000000030',
    );

    expect(streakDays).toHaveLength(2);
    expect(streakDays.map((day) => day.membershipId).sort()).toEqual(
      [laterAssigneeMembershipId, membershipId].sort(),
    );
    expect(streakDays).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ membershipId: followerMembershipId })]),
    );
  });

  it('does not qualify inactive assignees for new StreakDays', async () => {
    const { service, streakDays } = makeService({
      memberships: [{ id: membershipId, workspaceId, status: MembershipStatus.SUSPENDED }],
      taskAssigneeMembershipIds: [membershipId],
      streakConfig: enabledStreakConfig(),
      statusDefinitions: [taskTerminalStatus()],
      auditRows: [taskTerminalAuditRow()],
    });

    await service.evaluateTaskCompletionAchievements(
      workspaceId,
      '00000000-0000-4000-8000-000000000030',
    );

    expect(streakDays).toHaveLength(0);
  });

  it('does not create StreakDays from Project completion', async () => {
    const { service, streakDays } = makeService({
      streakConfig: enabledStreakConfig(),
      project: {
        id: '00000000-0000-4000-8000-000000000050',
        workspaceId,
        ownerMembershipId: membershipId,
      },
    });

    await service.evaluateProjectCompletionAchievements(
      workspaceId,
      '00000000-0000-4000-8000-000000000050',
    );

    expect(streakDays).toHaveLength(0);
  });

  it('does not invent Streak credit for unassigned first Ticket resolution', async () => {
    const { service, streakDays } = makeService({
      memberships: [
        { id: membershipId, workspaceId, status: MembershipStatus.ACTIVE },
        { id: laterAssigneeMembershipId, workspaceId, status: MembershipStatus.ACTIVE },
      ],
      streakConfig: enabledStreakConfig(),
      statusDefinitions: [ticketTerminalStatus()],
      auditRows: [
        ticketTerminalAuditRow({
          assignedToMembershipId: null,
          createdAt: new Date(Date.UTC(2026, 0, 1, 10)),
        }),
      ],
    });

    await service.evaluateTicketResolutionAchievements(
      workspaceId,
      ticketId,
      laterAssigneeMembershipId,
    );

    expect(streakDays).toHaveLength(0);
  });

  it('prevents Task and Ticket source reuse from creating extra StreakDays or XP', async () => {
    const { service, streakDays, entries } = makeService({
      streakConfig: enabledStreakConfig({ dailyXpReward: 25 }),
      statusDefinitions: [taskTerminalStatus(), ticketTerminalStatus()],
      auditRows: [
        taskTerminalAuditRow({
          createdAt: new Date(Date.UTC(2026, 0, 1, 10)),
        }),
        ticketTerminalAuditRow({
          createdAt: new Date(Date.UTC(2026, 0, 2, 10)),
        }),
      ],
    });

    await service.evaluateTaskCompletionAchievements(
      workspaceId,
      '00000000-0000-4000-8000-000000000030',
    );
    await service.evaluateTaskCompletionAchievements(
      workspaceId,
      '00000000-0000-4000-8000-000000000030',
    );
    await service.evaluateTicketResolutionAchievements(workspaceId, ticketId, membershipId);
    await service.evaluateTicketResolutionAchievements(workspaceId, ticketId, membershipId);

    expect(streakDays).toHaveLength(2);
    expect(
      entries.filter((entry) => entry.sourceType === GamificationXpSourceType.STREAK),
    ).toHaveLength(2);
  });

  it('lets XP_TOTAL achievements react to Streak XP without adding a Streak criterion', async () => {
    const { service, tx } = makeService({
      streakConfig: enabledStreakConfig({ dailyXpReward: 25 }),
      statusDefinitions: [taskTerminalStatus()],
      auditRows: [taskTerminalAuditRow()],
      achievements: [
        achievementDefinition({
          criterionType: GamificationAchievementCriterionType.XP_TOTAL_AT_LEAST,
          criterionValue: 25,
          name: 'Streak starter',
        }),
      ],
    });

    await service.evaluateTaskCompletionAchievements(
      workspaceId,
      '00000000-0000-4000-8000-000000000030',
    );

    expect(tx.gamificationAchievementAward.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          membershipId,
          criterionTypeSnapshot: GamificationAchievementCriterionType.XP_TOTAL_AT_LEAST,
        }),
      }),
    );
  });

  it('derives XP Control analyzer from immutable work events, linked ledger, and non-work current XP', async () => {
    const workEventId = '00000000-0000-4000-8000-000000002001';
    const { service } = makeService({
      workXpEvents: [
        xpWorkEvent({ id: workEventId, netXpSnapshot: 32 }),
        xpWorkEvent({
          id: '00000000-0000-4000-8000-000000002002',
          outcome: GamificationWorkXpEventOutcome.SKIPPED,
          skipReason: GamificationWorkXpSkipReason.RULE_DISABLED,
          netXpSnapshot: 0,
        }),
      ],
      entries: [
        xpEntry({ amount: 40, workXpEventId: workEventId }),
        xpEntry({
          id: '00000000-0000-4000-8000-000000003002',
          amount: 10,
          sourceType: GamificationXpSourceType.ACHIEVEMENT,
          sourceEvent: 'ACHIEVEMENT_XP_REWARD',
        }),
        xpEntry({
          id: '00000000-0000-4000-8000-000000003003',
          amount: 5,
          sourceType: GamificationXpSourceType.STREAK,
          sourceEvent: 'STREAK_DAILY_XP_REWARD',
        }),
        xpEntry({
          id: '00000000-0000-4000-8000-000000003004',
          amount: -5,
          sourceType: GamificationXpSourceType.SYSTEM,
          sourceEvent: 'MANUAL_XP_RESET',
        }),
      ],
    });

    const result = await service.getXpControlAnalyzer(xpControlViewTenant(), {
      page: 1,
      pageSize: 20,
      sortBy: 'delta',
      sortDirection: 'desc',
    });

    const row = result.items.find((item) => item.membershipId === membershipId);
    expect(row).toMatchObject({
      membershipId,
      claimedXp: 32,
      storedXp: 40,
      currentXp: 50,
      delta: -8,
      status: 'MISMATCH',
    });
  });

  it('marks ambiguous XP Control sources as NEEDS_REVIEW and refuses preview', async () => {
    const { service } = makeService({
      workXpEvents: [
        xpWorkEvent({
          id: '00000000-0000-4000-8000-000000002011',
          netXpSnapshot: 20,
        }),
        xpWorkEvent({
          id: '00000000-0000-4000-8000-000000002012',
          outcome: GamificationWorkXpEventOutcome.SKIPPED,
          skipReason: GamificationWorkXpSkipReason.AMBIGUOUS_ROLE,
          netXpSnapshot: 0,
        }),
      ],
    });

    const result = await service.getXpControlAnalyzer(xpControlViewTenant(), {
      page: 1,
      pageSize: 20,
      sortBy: 'delta',
      sortDirection: 'desc',
    });

    expect(result.items[0]).toMatchObject({ delta: 20, status: 'NEEDS_REVIEW' });
    await expect(
      service.previewXpReconciliation(xpControlReconcileTenant(), {
        targetMembershipId: membershipId,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('applies XP Control reconciliation from a server preview token and replays idempotently', async () => {
    const workEventId = '00000000-0000-4000-8000-000000002021';
    const { service, entries, reconciliations, auditRows } = makeService({
      workXpEvents: [xpWorkEvent({ id: workEventId, netXpSnapshot: 40 })],
      entries: [xpEntry({ amount: 25, workXpEventId: workEventId })],
    });
    const admin = xpControlReconcileTenant();
    const preview = await service.previewXpReconciliation(admin, {
      targetMembershipId: membershipId,
    });

    const first = await service.applyXpReconciliation(admin, {
      targetMembershipId: membershipId,
      previewToken: preview.previewToken,
      reason: 'Repair missing work XP component',
      confirmation: 'RECONCILE',
      idempotencyKey: 'xp-control:repair:1',
    });
    const retry = await service.applyXpReconciliation(admin, {
      targetMembershipId: membershipId,
      previewToken: preview.previewToken,
      reason: 'Repair missing work XP component',
      confirmation: 'RECONCILE',
      idempotencyKey: 'xp-control:repair:1',
    });

    expect(first.id).toBe(retry.id);
    expect(reconciliations).toHaveLength(1);
    expect(entries.filter((entry) => entry.reconciliationId === first.id)).toHaveLength(1);
    expect(
      auditRows.filter((row) => row.action === 'gamification.xp_control.reconciled'),
    ).toHaveLength(1);
    const balanced = await service.getXpControlAnalyzer(xpControlViewTenant(), {
      page: 1,
      pageSize: 20,
      sortBy: 'delta',
      sortDirection: 'desc',
    });
    expect(balanced.items[0]).toMatchObject({ storedXp: 40, delta: 0, status: 'RECONCILED' });
  });

  it('rejects stale and floor-conflicting XP Control reconciliation previews', async () => {
    const staleEventId = '00000000-0000-4000-8000-000000002031';
    const stale = makeService({
      workXpEvents: [xpWorkEvent({ id: staleEventId, netXpSnapshot: 40 })],
      entries: [xpEntry({ amount: 25, workXpEventId: staleEventId })],
    });
    const admin = xpControlReconcileTenant();
    const preview = await stale.service.previewXpReconciliation(admin, {
      targetMembershipId: membershipId,
    });
    stale.entries.push(
      xpEntry({
        id: '00000000-0000-4000-8000-000000003031',
        amount: 1,
        workXpEventId: staleEventId,
      }),
    );

    await expect(
      stale.service.applyXpReconciliation(admin, {
        targetMembershipId: membershipId,
        previewToken: preview.previewToken,
        reason: 'Stale correction',
        confirmation: 'RECONCILE',
        idempotencyKey: 'xp-control:stale:1',
      }),
    ).rejects.toThrow(ConflictException);

    const floorEventId = '00000000-0000-4000-8000-000000002032';
    const floor = makeService({
      workXpEvents: [xpWorkEvent({ id: floorEventId, netXpSnapshot: 10 })],
      entries: [xpEntry({ amount: 30, workXpEventId: floorEventId })],
    });
    floor.entries.push(
      xpEntry({
        id: '00000000-0000-4000-8000-000000003032',
        amount: -20,
        sourceType: GamificationXpSourceType.SYSTEM,
        sourceEvent: 'MANUAL_XP_RESET',
      }),
    );

    await expect(
      floor.service.previewXpReconciliation(admin, { targetMembershipId: membershipId }),
    ).rejects.toThrow(ConflictException);
  });

  it('keeps XP Control log filters source-linked and legacy honest', async () => {
    const taskEventId = '00000000-0000-4000-8000-000000002041';
    const { service } = makeService({
      workXpEvents: [
        xpWorkEvent({
          id: taskEventId,
          workType: GamificationPointWorkType.TASK,
          netXpSnapshot: 10,
        }),
      ],
      entries: [
        xpEntry({
          amount: 10,
          workXpEventId: taskEventId,
          sourceType: GamificationXpSourceType.SYSTEM,
        }),
        xpEntry({
          id: '00000000-0000-4000-8000-000000003041',
          amount: -20,
          sourceType: GamificationXpSourceType.SYSTEM,
          sourceEvent: 'MANUAL_XP_RESET',
        }),
        xpEntry({
          id: '00000000-0000-4000-8000-000000003042',
          amount: 7,
          sourceType: GamificationXpSourceType.SYSTEM,
          sourceEvent: 'IMPORTED_XP',
        }),
      ],
    });

    const taskLog = await service.getXpControlMemberLog(xpControlViewTenant(), membershipId, {
      page: 1,
      pageSize: 20,
      category: 'TASKS',
    });
    const resetLog = await service.getXpControlMemberLog(xpControlViewTenant(), membershipId, {
      page: 1,
      pageSize: 20,
      category: 'RESETS',
    });
    const legacyLog = await service.getXpControlMemberLog(xpControlViewTenant(), membershipId, {
      page: 1,
      pageSize: 20,
      category: 'LEGACY',
    });

    expect(taskLog.items).toHaveLength(1);
    expect(taskLog.items[0]?.work?.workType).toBe(GamificationPointWorkType.TASK);
    expect(resetLog.items).toHaveLength(1);
    expect(legacyLog.items).toHaveLength(1);
    expect(legacyLog.items[0]?.sourceEvent).toBe('IMPORTED_XP');
  });
});

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId,
    membershipId,
    amount: 10,
    sourceType: GamificationXpSourceType.TASK,
    sourceEvent: 'TASK_COMPLETED',
    sourceEntityId: '00000000-0000-4000-8000-000000000007',
    idempotencyKey: null,
    actorMembershipId: null,
    reason: null,
    ...overrides,
  };
}

function xpControlViewTenant() {
  return { ...tenant, permissions: ['gamification.xp_control.view'] };
}

function xpControlReconcileTenant() {
  return { ...tenant, permissions: ['gamification.xp_control.reconcile'] };
}

function xpWorkEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000002001',
    workspaceId,
    recipientMembershipId: membershipId,
    workType: GamificationPointWorkType.TASK,
    outcome: GamificationWorkXpEventOutcome.APPLIED,
    skipReason: null,
    netXpSnapshot: 10,
    baseXpSnapshot: 10,
    bonusXpSnapshot: 0,
    penaltyXpSnapshot: 0,
    sourceLabelSnapshot: 'Task Alpha',
    departmentNameSnapshot: 'Support',
    categorySnapshot: GamificationPointCategory.MEDIUM,
    ruleSourceSnapshot: 'WORKSPACE_DEFAULT',
    dueAtSnapshot: null,
    completedAtSnapshot: null,
    completionCycle: null,
    eventType: GamificationWorkXpEventType.COMPLETION_AWARD,
    reversalOfEventId: null,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 1)),
    ...overrides,
  };
}

function rewardPointInput(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId,
    membershipId,
    amount: 10,
    sourceType: GamificationRewardPointSourceType.SYSTEM,
    sourceEvent: 'SYSTEM_REWARD_POINTS',
    sourceEntityId: '00000000-0000-4000-8000-000000000007',
    idempotencyKey: null,
    actorMembershipId: null,
    reason: null,
    ...overrides,
  };
}

function rewardPointEntry(overrides: Record<string, unknown>) {
  const targetMembershipId =
    typeof overrides.membershipId === 'string' ? overrides.membershipId : membershipId;
  const amount = Number(overrides.amount ?? 10);
  return {
    id: `00000000-0000-4000-8000-${String(
      Math.abs(hashString(`rp:${targetMembershipId}:${amount}`)),
    )
      .padStart(12, '0')
      .slice(-12)}`,
    workspaceId,
    membershipId: targetMembershipId,
    amount,
    entryType:
      amount < 0 ? GamificationRewardPointEntryType.SPEND : GamificationRewardPointEntryType.EARN,
    sourceType: GamificationRewardPointSourceType.SYSTEM,
    sourceEvent: 'TEST_REWARD_POINTS',
    sourceEntityId: null,
    idempotencyKey: null,
    reversalOfEntryId: null,
    actorMembershipId: null,
    reason: null,
    createdAt: new Date(Date.UTC(2026, 0, 1)),
    ...overrides,
  };
}

function xpEntry(overrides: Record<string, unknown> = {}) {
  const targetMembershipId =
    typeof overrides.membershipId === 'string' ? overrides.membershipId : membershipId;
  const amount = Number(overrides.amount ?? 10);
  const stableSuffix = String(Math.abs(hashString(`${targetMembershipId}:${amount}`))).padStart(
    12,
    '0',
  );
  return {
    id: `00000000-0000-4000-8000-${stableSuffix.slice(-12)}`,
    workspaceId,
    membershipId,
    amount,
    entryType: GamificationXpEntryType.EARN,
    sourceType: GamificationXpSourceType.SYSTEM,
    sourceEvent: 'TEST_XP',
    sourceEntityId: null,
    idempotencyKey: null,
    reversalOfEntryId: null,
    workXpEventId: null,
    reconciliationId: null,
    actorMembershipId: null,
    reason: null,
    createdAt: new Date(Date.UTC(2026, 0, 1)),
    ...overrides,
  };
}

function leaderboardViewTenant() {
  return { ...tenant, permissions: ['gamification.leaderboards.view'] };
}

function hashString(value: string) {
  return [...value].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) | 0, 7);
}

function level(overrides: Record<string, unknown>) {
  const levelNumber = Number(overrides.levelNumber ?? 1);
  const name = typeof overrides.name === 'string' ? overrides.name : `Level ${levelNumber}`;
  return {
    id: `00000000-0000-4000-8000-${String(200 + levelNumber).padStart(12, '0')}`,
    workspaceId,
    name,
    normalizedName: name.toLowerCase(),
    description: null,
    levelNumber,
    xpThreshold: Number(overrides.xpThreshold ?? 0),
    isActive: overrides.isActive ?? true,
    createdAt: new Date(Date.UTC(2026, 0, 1)),
    updatedAt: new Date(Date.UTC(2026, 0, 1)),
    ...overrides,
  };
}

function pointRule(overrides: Record<string, unknown>) {
  return {
    id: 'point-rule-1',
    workspaceId,
    departmentId: null,
    scopeType: GamificationPointScopeType.WORKSPACE,
    workType: GamificationPointWorkType.TASK,
    category: GamificationPointCategory.MEDIUM,
    isEnabled: true,
    baseXp: 10,
    earlyBonusXp: 0,
    earlyThresholdMinutes: null,
    latePenaltyPercent: 0,
    penaltyIntervalMinutes: null,
    maxPenaltyXp: 0,
    createdAt: new Date(Date.UTC(2026, 0, 1)),
    updatedAt: new Date(Date.UTC(2026, 0, 1)),
    ...overrides,
  };
}

function creationPointRule(overrides: Record<string, unknown>) {
  return {
    id: 'creation-point-rule-1',
    workspaceId,
    departmentId: null,
    scopeType: GamificationPointScopeType.WORKSPACE,
    workType: GamificationPointWorkType.TASK,
    category: GamificationPointCategory.MEDIUM,
    roleId: tenant.roleId,
    isEnabled: true,
    creationXp: 10,
    createdAt: new Date(Date.UTC(2026, 0, 1)),
    updatedAt: new Date(Date.UTC(2026, 0, 1)),
    ...overrides,
  };
}

function achievementDefinition(overrides: Record<string, unknown>) {
  return {
    id: '00000000-0000-4000-8000-000000000016',
    workspaceId,
    name: 'Ticket closer',
    description: null,
    criterionType: GamificationAchievementCriterionType.TICKET_RESOLVED_COUNT,
    criterionValue: 1,
    badgeDefinitionId: null,
    xpReward: 0,
    rewardPointsReward: 0,
    isActive: true,
    badgeDefinition: null,
    createdAt: new Date(Date.UTC(2026, 0, 1)),
    updatedAt: new Date(Date.UTC(2026, 0, 1)),
    ...overrides,
  };
}

function enabledStreakConfig(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000031',
    workspaceId,
    enabled: true,
    dailyXpReward: 0,
    dailyRewardPoints: 0,
    enabledAt: new Date(Date.UTC(2026, 0, 1)),
    createdAt: new Date(Date.UTC(2026, 0, 1)),
    updatedAt: new Date(Date.UTC(2026, 0, 1)),
    ...overrides,
  };
}

function streakDay(overrides: Record<string, unknown>) {
  return {
    id: '00000000-0000-4000-8000-000000000032',
    workspaceId,
    membershipId,
    localDate: new Date(Date.UTC(2026, 0, 1)),
    qualificationType: GamificationStreakQualificationType.TASK_COMPLETED,
    sourceEntityId: '00000000-0000-4000-8000-000000000030',
    qualifiedAt: new Date(Date.UTC(2026, 0, 1, 12)),
    timezoneSnapshot: 'UTC',
    dailyXpRewardSnapshot: 0,
    dailyRewardPointsSnapshot: 0,
    createdAt: new Date(Date.UTC(2026, 0, 1, 12)),
    ...overrides,
  };
}

function rewardDefinition(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000061',
    workspaceId,
    name: 'Coffee voucher',
    normalizedName: 'coffee voucher',
    description: null,
    pointsCost: 10,
    inventoryMode: GamificationRewardInventoryMode.UNLIMITED,
    availableQuantity: null,
    isActive: true,
    createdAt: new Date(Date.UTC(2026, 0, 1)),
    updatedAt: new Date(Date.UTC(2026, 0, 1)),
    ...overrides,
  };
}

function taskTerminalStatus(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000018',
    workspaceId,
    entityType: 'TASK',
    isTerminal: true,
    ...overrides,
  };
}

function ticketTerminalStatus(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000013',
    workspaceId,
    entityType: 'TICKET',
    isTerminal: true,
    ...overrides,
  };
}

function taskTerminalAuditRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000019',
    workspaceId,
    entityType: 'Task',
    entityId: '00000000-0000-4000-8000-000000000030',
    action: 'task.status_changed',
    createdAt: new Date(Date.UTC(2026, 0, 1, 12)),
    ...overrides,
    metadata: {
      toStatusDefinitionId:
        overrides.toStatusDefinitionId ?? '00000000-0000-4000-8000-000000000018',
      completed: true,
    },
  };
}

function uniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

function membershipResult(member: Record<string, unknown> | undefined) {
  if (!member) return null;
  const roleId = (member.roleId as string | null | undefined) ?? tenant.roleId;
  return {
    ...member,
    roleId,
    role: { name: (member.roleName as string | null | undefined) ?? 'Member' },
    user: { name: (member.userName as string | null | undefined) ?? 'Member' },
    department:
      typeof member.departmentId === 'string'
        ? { name: `Department ${String(member.departmentId).slice(-4)}` }
        : null,
  };
}

function resetGrant(economy: GamificationAdminEconomy, overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000098',
    userId: tenant.userId,
    refreshTokenId: '00000000-0000-4000-8000-000000000099',
    workspaceId,
    targetMembershipId: membershipId,
    purpose: 'GAMIFICATION_RESET',
    economy,
    expiresAt: new Date(Date.UTC(2099, 0, 1)),
    usedAt: null,
    createdAt: new Date(Date.UTC(2026, 0, 1)),
    ...overrides,
  };
}

function ticketTerminalAuditRow(overrides: Record<string, unknown>) {
  const hasAssignedToMembershipId = Object.prototype.hasOwnProperty.call(
    overrides,
    'assignedToMembershipId',
  );
  return {
    id: '00000000-0000-4000-8000-000000000017',
    workspaceId,
    entityType: 'Ticket',
    entityId: ticketId,
    action: 'ticket.status_changed',
    createdAt: new Date(Date.UTC(2026, 0, 1)),
    ...overrides,
    metadata: {
      toStatusDefinitionId: '00000000-0000-4000-8000-000000000013',
      assignedToMembershipId: hasAssignedToMembershipId
        ? overrides.assignedToMembershipId
        : membershipId,
    },
  };
}

function makeService(options?: {
  memberships?: Array<{
    id: string;
    workspaceId: string;
    status: MembershipStatus;
    userName?: string | null;
    departmentId?: string | null;
    roleId?: string | null;
    roleName?: string | null;
  }>;
  entries?: Array<Record<string, unknown>>;
  rewardPointEntries?: Array<Record<string, unknown>>;
  workXpEvents?: Array<Record<string, unknown>>;
  reconciliations?: Array<Record<string, unknown>>;
  levels?: Array<Record<string, unknown>>;
  achievements?: Array<Record<string, unknown>>;
  rewards?: Array<Record<string, unknown>>;
  redemptions?: Array<Record<string, unknown>>;
  departments?: Array<Record<string, unknown>>;
  roles?: Array<Record<string, unknown>>;
  pointRules?: Array<Record<string, unknown>>;
  creationPointRules?: Array<Record<string, unknown>>;
  leaderboardConfig?: Record<string, unknown> | null;
  leaderboardPreferences?: Array<Record<string, unknown>>;
  auditRows?: Array<Record<string, unknown>>;
  stepUpGrants?: Array<Record<string, unknown>>;
  statusDefinitions?: Array<Record<string, unknown>>;
  streakConfig?: Record<string, unknown> | null;
  streakDays?: Array<Record<string, unknown>>;
  workspaceTimezone?: string;
  taskAssigneeMembershipIds?: string[];
  task?: Record<string, unknown> | null;
  project?: Record<string, unknown> | null;
  ticket?: Record<string, unknown> | null;
}) {
  const memberships = options?.memberships ?? [
    { id: membershipId, workspaceId, status: MembershipStatus.ACTIVE },
    { id: actorMembershipId, workspaceId, status: MembershipStatus.ACTIVE },
  ];
  const entries: Array<Record<string, unknown>> = [...(options?.entries ?? [])];
  const rewardPointEntries: Array<Record<string, unknown>> = [
    ...(options?.rewardPointEntries ?? []),
  ];
  const workXpEvents: Array<Record<string, unknown>> = [...(options?.workXpEvents ?? [])];
  const reconciliations: Array<Record<string, unknown>> = [...(options?.reconciliations ?? [])];
  const levels: Array<Record<string, unknown>> = [...(options?.levels ?? [])];
  const achievements: Array<Record<string, unknown>> = [...(options?.achievements ?? [])];
  const rewards: Array<Record<string, unknown>> = [...(options?.rewards ?? [])];
  const redemptions: Array<Record<string, unknown>> = [...(options?.redemptions ?? [])];
  const departments: Array<Record<string, unknown>> = [...(options?.departments ?? [])];
  const roles: Array<Record<string, unknown>> = [
    {
      id: tenant.roleId,
      key: 'MEMBER',
      name: 'Member',
      scope: RoleScope.WORKSPACE,
      isSystem: true,
      isActive: true,
      workspaceId: null,
    },
    ...(options?.roles ?? []),
  ];
  const pointRules: Array<Record<string, unknown>> = [...(options?.pointRules ?? [])];
  const creationPointRules: Array<Record<string, unknown>> = [
    ...(options?.creationPointRules ?? []),
  ];
  let leaderboardConfig: Record<string, unknown> | null | undefined = options?.leaderboardConfig;
  const leaderboardPreferences: Array<Record<string, unknown>> = [
    ...(options?.leaderboardPreferences ?? []).map((preference) => ({
      workspaceId,
      ...preference,
    })),
  ];
  const auditRows: Array<Record<string, unknown>> = [...(options?.auditRows ?? [])];
  const stepUpGrants: Array<Record<string, unknown>> = [...(options?.stepUpGrants ?? [])];
  const statusDefinitions: Array<Record<string, unknown>> = [...(options?.statusDefinitions ?? [])];
  let streakConfig: Record<string, unknown> | null | undefined = options?.streakConfig;
  const streakDays: Array<Record<string, unknown>> = [...(options?.streakDays ?? [])];
  const workspaceTimezone = options?.workspaceTimezone ?? 'UTC';
  const taskAssigneeMembershipIds = options?.taskAssigneeMembershipIds ?? [membershipId];
  const task = options?.task ?? null;
  const project = options?.project ?? null;
  const ticket = options?.ticket ?? null;
  let sequence = 0;

  const matchesEntry = (entry: Record<string, unknown>, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([key, value]) => {
      if (key === 'OR' && Array.isArray(value)) {
        return value.some((candidate) => matchesEntry(entry, candidate as Record<string, unknown>));
      }
      if (key === 'NOT' && Array.isArray(value)) {
        return !value.some((candidate) =>
          matchesEntry(entry, candidate as Record<string, unknown>),
        );
      }
      if (key === 'workXpEvent' && value && typeof value === 'object' && 'is' in value) {
        const event = workXpEvents.find((candidate) => candidate.id === entry.workXpEventId);
        return Boolean(event && matchesEntry(event, (value as { is: Record<string, unknown> }).is));
      }
      if (value && typeof value === 'object' && 'not' in value) {
        const not = (value as { not: unknown }).not;
        return not === null ? entry[key] !== null && entry[key] !== undefined : entry[key] !== not;
      }
      if (value && typeof value === 'object' && 'notIn' in value) {
        return !(value as { notIn: unknown[] }).notIn.includes(entry[key]);
      }
      if (value && typeof value === 'object' && 'gt' in value)
        return Number(entry[key]) > Number((value as { gt: number }).gt);
      if (value && typeof value === 'object' && 'lt' in value)
        return Number(entry[key]) < Number((value as { lt: number }).lt);
      if (value && typeof value === 'object' && 'lte' in value)
        return Number(entry[key]) <= Number((value as { lte: number }).lte);
      if (value && typeof value === 'object' && 'gte' in value)
        return Number(entry[key]) >= Number((value as { gte: number }).gte);
      if (value && typeof value === 'object' && 'contains' in value) {
        const candidate = entry[key];
        return (
          typeof candidate === 'string' &&
          candidate.includes((value as { contains: string }).contains)
        );
      }
      return entry[key] === value;
    });

  const workEventMatches = (
    event: Record<string, unknown>,
    where: Record<string, unknown>,
  ): boolean =>
    Object.entries(where).every(([key, value]) => {
      if (key === 'reversalEvents' && value && typeof value === 'object' && 'none' in value) {
        return !workXpEvents.some((candidate) => candidate.reversalOfEventId === event.id);
      }
      return matchesEntry(event, { [key]: value });
    });

  const matchesAuditWhere = (
    entry: Record<string, unknown>,
    where: Record<string, unknown>,
  ): boolean =>
    Object.entries(where).every(([key, value]) => {
      if (key === 'OR' && Array.isArray(value)) {
        return value.some((candidate) =>
          matchesAuditWhere(entry, candidate as Record<string, unknown>),
        );
      }
      if (value && typeof value === 'object' && 'in' in value) {
        return (value as { in: unknown[] }).in.includes(entry[key]);
      }
      if (key === 'metadata' && value && typeof value === 'object' && 'path' in value) {
        const matcher = value as { path: string[]; equals: unknown };
        const metadata = entry.metadata as Record<string, unknown> | undefined;
        const [metadataKey] = matcher.path;
        if (!metadataKey) return false;
        return metadata?.[metadataKey] === matcher.equals;
      }
      return entry[key] === value;
    });

  const tx = {
    $queryRaw: jest.fn().mockImplementation((query: { values?: string[] }) => {
      const sql = String((query as { strings?: string[] }).strings?.join(' ') ?? '');
      if (sql.includes('WITH eligible AS')) {
        const values = query.values ?? [];
        const workspace = values[0]!;
        const isDepartment = sql.includes('wm.department_id =');
        const targetDepartment = isDepartment ? values[1] : undefined;
        const finalValue = values[isDepartment ? 2 : 1]!;
        const topOnly = sql.includes('LIMIT');
        const rows = leaderboardRows(
          memberships,
          entries,
          leaderboardPreferences,
          departments,
          workspace,
          isDepartment ? targetDepartment : undefined,
        );
        return Promise.resolve(
          topOnly
            ? rows.slice(0, Number(finalValue))
            : rows.filter((row) => row.membershipId === finalValue),
        );
      }
      const [lockedId, lockedWorkspaceId] = query.values ?? [];
      if (query.values?.length === 1) return Promise.resolve([{ id: query.values[0] }]);
      const locked =
        memberships.some(
          (item) => item.id === lockedId && item.workspaceId === lockedWorkspaceId,
        ) ||
        rewards.some((item) => item.id === lockedId && item.workspaceId === lockedWorkspaceId) ||
        redemptions.some((item) => item.id === lockedId && item.workspaceId === lockedWorkspaceId);
      return Promise.resolve(locked ? [{ id: lockedId }] : []);
    }),
    gamificationLevel: {
      findMany: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(
          levels
            .filter((item) => matchesEntry(item, where))
            .sort((left, right) => Number(left.levelNumber) - Number(right.levelNumber)),
        ),
      ),
      findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(levels.find((item) => matchesEntry(item, where)) ?? null),
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        if (
          levels.some(
            (item) =>
              item.workspaceId === data.workspaceId && item.levelNumber === data.levelNumber,
          ) ||
          levels.some(
            (item) =>
              item.workspaceId === data.workspaceId && item.normalizedName === data.normalizedName,
          )
        ) {
          throw uniqueConstraintError();
        }
        const created = {
          id: `00000000-0000-4000-8000-${String(100 + ++sequence).padStart(12, '0')}`,
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)),
          updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)),
          ...data,
        };
        levels.push(created);
        return Promise.resolve(created);
      }),
      update: jest.fn(
        ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const index = levels.findIndex((item) => item.id === where.id);
          if (index < 0) throw new Error('not found');
          const next: Record<string, unknown> = {
            ...levels[index],
            ...data,
            updatedAt: new Date(Date.UTC(2026, 0, 2)),
          };
          if (
            levels.some(
              (item) =>
                item.id !== where.id &&
                item.workspaceId === next.workspaceId &&
                item.levelNumber === next.levelNumber,
            ) ||
            levels.some(
              (item) =>
                item.id !== where.id &&
                item.workspaceId === next.workspaceId &&
                item.normalizedName === next.normalizedName,
            )
          ) {
            throw uniqueConstraintError();
          }
          levels[index] = next;
          return Promise.resolve(next);
        },
      ),
    },
    workspaceMembership: {
      findMany: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(
          memberships
            .filter((item) => matchesEntry(item, where))
            .map((item) => ({
              id: item.id,
              status: item.status,
              departmentId: item.departmentId ?? null,
              user: {
                name: item.userName ?? 'Member',
                email: 'member@zeaplay.test',
              },
              department:
                departments.find(
                  (department) =>
                    department.id === item.departmentId &&
                    department.workspaceId === item.workspaceId,
                ) ?? null,
            })),
        ),
      ),
      findFirst: jest.fn(({ where }: { where: { id: string; workspaceId: string } }) =>
        Promise.resolve(
          membershipResult(
            memberships.find(
              (item) => item.id === where.id && item.workspaceId === where.workspaceId,
            ),
          ),
        ),
      ),
      count: jest.fn(({ where }: { where: { id: string; workspaceId: string } }) =>
        Promise.resolve(
          memberships.filter(
            (item) => item.id === where.id && item.workspaceId === where.workspaceId,
          ).length,
        ),
      ),
    },
    department: {
      findFirst: jest.fn(({ where }: { where: { id: string; workspaceId: string } }) =>
        Promise.resolve(
          departments.find(
            (item) => item.id === where.id && item.workspaceId === where.workspaceId,
          ) ?? null,
        ),
      ),
      findMany: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(departments.filter((item) => matchesEntry(item, where))),
      ),
    },
    role: {
      findMany: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(roles.filter((item) => matchesEntry(item, where))),
      ),
      findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(roles.find((item) => matchesEntry(item, where)) ?? null),
      ),
    },
    gamificationPointRule: {
      findMany: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(pointRules.filter((item) => matchesEntry(item, where))),
      ),
      findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(pointRules.find((item) => matchesEntry(item, where)) ?? null),
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const created = {
          id: `00000000-0000-4000-8000-${String(1200 + ++sequence).padStart(12, '0')}`,
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)),
          updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)),
          ...data,
        };
        pointRules.push(created);
        return Promise.resolve(created);
      }),
      update: jest.fn(
        ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const index = pointRules.findIndex((item) => item.id === where.id);
          if (index < 0) throw new Error('not found');
          pointRules[index] = {
            ...pointRules[index],
            ...data,
            updatedAt: new Date(Date.UTC(2026, 0, 2)),
          };
          return Promise.resolve(pointRules[index]);
        },
      ),
      delete: jest.fn(({ where }: { where: { id: string } }) => {
        const index = pointRules.findIndex((item) => item.id === where.id);
        if (index < 0) throw new Error('not found');
        const [deleted] = pointRules.splice(index, 1);
        return Promise.resolve(deleted);
      }),
    },
    gamificationCreationPointRule: {
      findMany: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(creationPointRules.filter((item) => matchesEntry(item, where))),
      ),
      findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(creationPointRules.find((item) => matchesEntry(item, where)) ?? null),
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const created = {
          id: `00000000-0000-4000-8000-${String(1300 + ++sequence).padStart(12, '0')}`,
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)),
          updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)),
          ...data,
        };
        creationPointRules.push(created);
        return Promise.resolve(created);
      }),
      update: jest.fn(
        ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const index = creationPointRules.findIndex((item) => item.id === where.id);
          if (index < 0) throw new Error('not found');
          creationPointRules[index] = {
            ...creationPointRules[index],
            ...data,
            updatedAt: new Date(Date.UTC(2026, 0, 2)),
          };
          return Promise.resolve(creationPointRules[index]);
        },
      ),
      delete: jest.fn(({ where }: { where: { id: string } }) => {
        const index = creationPointRules.findIndex((item) => item.id === where.id);
        if (index < 0) throw new Error('not found');
        const [deleted] = creationPointRules.splice(index, 1);
        return Promise.resolve(deleted);
      }),
    },
    workspace: {
      findUnique: jest.fn(() => Promise.resolve({ timezone: workspaceTimezone })),
    },
    gamificationXpEntry: {
      groupBy: jest.fn(
        ({
          where,
        }: {
          by: string[];
          where: Record<string, unknown>;
          _sum?: unknown;
          _max?: unknown;
        }) => {
          const grouped = new Map<string, { amount: number; createdAt: Date | null }>();
          for (const entry of entries.filter((item) => matchesEntry(item, where))) {
            const membership = String(entry.membershipId);
            const current = grouped.get(membership) ?? { amount: 0, createdAt: null };
            current.amount += Number(entry.amount ?? 0);
            const createdAt = entry.createdAt instanceof Date ? entry.createdAt : null;
            if (createdAt && (!current.createdAt || createdAt > current.createdAt)) {
              current.createdAt = createdAt;
            }
            grouped.set(membership, current);
          }
          return Promise.resolve(
            [...grouped.entries()].map(([membershipId, value]) => ({
              membershipId,
              _sum: { amount: value.amount },
              _max: { createdAt: value.createdAt },
            })),
          );
        },
      ),
      aggregate: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve({
          _sum: {
            amount: entries
              .filter((entry) => matchesEntry(entry, where))
              .reduce((sum, entry) => sum + Number(entry.amount), 0),
          },
        }),
      ),
      count: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(entries.filter((entry) => matchesEntry(entry, where)).length),
      ),
      findFirst: jest.fn(
        ({ where, orderBy }: { where: Record<string, unknown>; orderBy?: unknown }) => {
          const found = entries.filter((entry) => matchesEntry(entry, where));
          if (orderBy) found.sort(sortNewestFirst);
          return Promise.resolve(found[0] ?? null);
        },
      ),
      findFirstOrThrow: jest.fn(({ where }: { where: Record<string, unknown> }) => {
        const found = entries.find((entry) => matchesEntry(entry, where));
        if (!found) throw new Error('not found');
        return Promise.resolve(found);
      }),
      findMany: jest.fn(
        ({
          where,
          skip = 0,
          take = entries.length,
          include,
        }: {
          where: Record<string, unknown>;
          skip?: number;
          take?: number;
          include?: Record<string, unknown>;
        }) =>
          Promise.resolve(
            entries
              .filter((entry) => matchesEntry(entry, where))
              .sort(sortNewestFirst)
              .slice(skip, skip + take)
              .map((entry) => ({
                ...entry,
                workXpEvent: include?.workXpEvent
                  ? (workXpEvents.find((event) => event.id === entry.workXpEventId) ?? null)
                  : undefined,
                reconciliation: include?.reconciliation
                  ? (reconciliations.find((item) => item.id === entry.reconciliationId) ?? null)
                  : undefined,
                actorMembership: include?.actorMembership
                  ? membershipResult(
                      memberships.find((member) => member.id === entry.actorMembershipId),
                    )
                  : undefined,
              })),
          ),
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        if (
          data.idempotencyKey &&
          entries.some(
            (entry) =>
              entry.workspaceId === data.workspaceId &&
              entry.membershipId === data.membershipId &&
              entry.idempotencyKey === data.idempotencyKey,
          )
        ) {
          throw uniqueConstraintError();
        }
        if (
          data.reversalOfEntryId &&
          entries.some((entry) => entry.reversalOfEntryId === data.reversalOfEntryId)
        ) {
          throw uniqueConstraintError();
        }
        const created = {
          id: `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)),
          ...data,
        };
        entries.push(created);
        return Promise.resolve(created);
      }),
    },
    gamificationWorkXpEvent: {
      findUnique: jest.fn(
        ({
          where,
        }: {
          where: { workspaceId_idempotencyKey?: { workspaceId: string; idempotencyKey: string } };
        }) => {
          const key = where.workspaceId_idempotencyKey;
          return Promise.resolve(
            key
              ? (workXpEvents.find(
                  (event) =>
                    event.workspaceId === key.workspaceId &&
                    event.idempotencyKey === key.idempotencyKey,
                ) ?? null)
              : null,
          );
        },
      ),
      findFirst: jest.fn(
        ({
          where,
          orderBy,
        }: {
          where: Record<string, unknown>;
          orderBy?: Array<Record<string, string>>;
        }) => {
          const found = workXpEvents.filter((event) => workEventMatches(event, where));
          if (orderBy) found.sort(sortWorkEventsNewestFirst);
          return Promise.resolve(found[0] ?? null);
        },
      ),
      findMany: jest.fn(
        ({
          where,
          include,
          orderBy,
        }: {
          where: Record<string, unknown>;
          include?: { xpEntries?: boolean };
          orderBy?: Array<Record<string, string>>;
        }) => {
          const found = workXpEvents.filter((event) => workEventMatches(event, where));
          if (orderBy) found.sort(sortWorkEventsNewestFirst);
          return Promise.resolve(
            found.map((event) =>
              include?.xpEntries
                ? {
                    ...event,
                    xpEntries: entries.filter((entry) => entry.workXpEventId === event.id),
                  }
                : event,
            ),
          );
        },
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        if (
          data.idempotencyKey &&
          workXpEvents.some(
            (event) =>
              event.workspaceId === data.workspaceId &&
              event.idempotencyKey === data.idempotencyKey,
          )
        ) {
          throw uniqueConstraintError();
        }
        const created = {
          id: `00000000-0000-4000-8000-${String(1500 + ++sequence).padStart(12, '0')}`,
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)),
          ...data,
        };
        workXpEvents.push(created);
        return Promise.resolve(created);
      }),
    },
    gamificationXpReconciliation: {
      groupBy: jest.fn(
        ({ where }: { by: string[]; where: Record<string, unknown>; _count?: unknown }) => {
          const grouped = new Map<string, number>();
          for (const item of reconciliations.filter((entry) => matchesEntry(entry, where))) {
            const membership = String(item.membershipId);
            grouped.set(membership, (grouped.get(membership) ?? 0) + 1);
          }
          return Promise.resolve(
            [...grouped.entries()].map(([membershipId, count]) => ({
              membershipId,
              _count: { _all: count },
            })),
          );
        },
      ),
      findUnique: jest.fn(
        ({
          where,
          include,
        }: {
          where: {
            workspaceId_membershipId_idempotencyKey?: {
              workspaceId: string;
              membershipId: string;
              idempotencyKey: string;
            };
          };
          include?: { xpEntries?: boolean };
        }) => {
          const key = where.workspaceId_membershipId_idempotencyKey;
          const found = key
            ? reconciliations.find(
                (item) =>
                  item.workspaceId === key.workspaceId &&
                  item.membershipId === key.membershipId &&
                  item.idempotencyKey === key.idempotencyKey,
              )
            : null;
          return Promise.resolve(
            found
              ? {
                  ...found,
                  xpEntries: include?.xpEntries
                    ? entries.filter((entry) => entry.reconciliationId === found.id)
                    : undefined,
                }
              : null,
          );
        },
      ),
      create: jest.fn(
        ({
          data,
          include,
        }: {
          data: Record<string, unknown>;
          include?: { xpEntries?: boolean };
        }) => {
          if (
            reconciliations.some(
              (item) =>
                item.workspaceId === data.workspaceId &&
                item.membershipId === data.membershipId &&
                item.idempotencyKey === data.idempotencyKey,
            )
          ) {
            throw uniqueConstraintError();
          }
          const created = {
            id: `00000000-0000-4000-8000-${String(1700 + ++sequence).padStart(12, '0')}`,
            createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)),
            analysisVersion: 'phase10.10.v2',
            ...data,
          };
          reconciliations.push(created);
          return Promise.resolve({
            ...created,
            xpEntries: include?.xpEntries ? [] : undefined,
          });
        },
      ),
    },
    gamificationRewardPointEntry: {
      aggregate: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve({
          _sum: {
            amount: rewardPointEntries
              .filter((entry) => matchesEntry(entry, where))
              .reduce((sum, entry) => sum + Number(entry.amount), 0),
          },
        }),
      ),
      count: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(rewardPointEntries.filter((entry) => matchesEntry(entry, where)).length),
      ),
      findFirst: jest.fn(
        ({ where, orderBy }: { where: Record<string, unknown>; orderBy?: unknown }) => {
          const found = rewardPointEntries.filter((entry) => matchesEntry(entry, where));
          if (orderBy) found.sort(sortNewestFirst);
          return Promise.resolve(found[0] ?? null);
        },
      ),
      findFirstOrThrow: jest.fn(({ where }: { where: Record<string, unknown> }) => {
        const found = rewardPointEntries.find((entry) => matchesEntry(entry, where));
        if (!found) throw new Error('not found');
        return Promise.resolve(found);
      }),
      findMany: jest.fn(
        ({ where, skip, take }: { where: Record<string, unknown>; skip: number; take: number }) =>
          Promise.resolve(
            rewardPointEntries
              .filter((entry) => matchesEntry(entry, where))
              .sort(sortNewestFirst)
              .slice(skip, skip + take),
          ),
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        if (
          data.idempotencyKey &&
          rewardPointEntries.some(
            (entry) =>
              entry.workspaceId === data.workspaceId &&
              entry.membershipId === data.membershipId &&
              entry.idempotencyKey === data.idempotencyKey,
          )
        ) {
          throw uniqueConstraintError();
        }
        if (
          data.reversalOfEntryId &&
          rewardPointEntries.some((entry) => entry.reversalOfEntryId === data.reversalOfEntryId)
        ) {
          throw uniqueConstraintError();
        }
        const created = {
          id: `00000000-0000-4000-8000-${String(800 + ++sequence).padStart(12, '0')}`,
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)),
          ...data,
        };
        rewardPointEntries.push(created);
        return Promise.resolve(created);
      }),
    },
    gamificationRewardDefinition: {
      findMany: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(
          rewards
            .filter((item) => matchesEntry(item, where))
            .sort((left, right) => String(left.name).localeCompare(String(right.name))),
        ),
      ),
      count: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(rewards.filter((item) => matchesEntry(item, where)).length),
      ),
      findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(rewards.find((item) => matchesEntry(item, where)) ?? null),
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        if (
          rewards.some(
            (item) =>
              item.workspaceId === data.workspaceId && item.normalizedName === data.normalizedName,
          )
        ) {
          throw uniqueConstraintError();
        }
        const created = {
          id: `00000000-0000-4000-8000-${String(900 + ++sequence).padStart(12, '0')}`,
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)),
          updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)),
          ...data,
        };
        rewards.push(created);
        return Promise.resolve(created);
      }),
      update: jest.fn(
        ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const index = rewards.findIndex((item) => item.id === where.id);
          if (index < 0) throw new Error('not found');
          const normalizedData = { ...data };
          if (
            normalizedData.availableQuantity &&
            typeof normalizedData.availableQuantity === 'object'
          ) {
            const operation = normalizedData.availableQuantity as {
              decrement?: number;
              increment?: number;
            };
            const current = Number(rewards[index]!.availableQuantity ?? 0);
            normalizedData.availableQuantity =
              current - Number(operation.decrement ?? 0) + Number(operation.increment ?? 0);
          }
          rewards[index] = {
            ...rewards[index],
            ...normalizedData,
            updatedAt: new Date(Date.UTC(2026, 0, 2)),
          };
          return Promise.resolve(rewards[index]);
        },
      ),
    },
    gamificationRewardRedemption: {
      count: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(redemptions.filter((item) => matchesEntry(item, where)).length),
      ),
      findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(redemptions.find((item) => matchesEntry(item, where)) ?? null),
      ),
      findMany: jest.fn(
        ({ where, skip, take }: { where: Record<string, unknown>; skip: number; take: number }) =>
          Promise.resolve(
            redemptions
              .filter((item) => matchesEntry(item, where))
              .sort((left, right) => {
                const dateDiff =
                  (right.requestedAt as Date).getTime() - (left.requestedAt as Date).getTime();
                if (dateDiff !== 0) return dateDiff;
                return String(right.id).localeCompare(String(left.id));
              })
              .slice(skip, skip + take),
          ),
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        if (
          data.idempotencyKey &&
          redemptions.some(
            (item) =>
              item.workspaceId === data.workspaceId &&
              item.membershipId === data.membershipId &&
              item.idempotencyKey === data.idempotencyKey,
          )
        ) {
          throw uniqueConstraintError();
        }
        const reward = rewards.find((item) => item.id === data.rewardDefinitionId);
        const created = {
          id: `00000000-0000-4000-8000-${String(1000 + ++sequence).padStart(12, '0')}`,
          requestedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)),
          fulfilledAt: null,
          cancelledAt: null,
          fulfilledByMembershipId: null,
          cancelledByMembershipId: null,
          cancelReason: null,
          rewardDefinition: reward
            ? { id: reward.id, name: reward.name, isActive: reward.isActive }
            : null,
          ...data,
        };
        redemptions.push(created);
        return Promise.resolve(created);
      }),
      update: jest.fn(
        ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const index = redemptions.findIndex((item) => item.id === where.id);
          if (index < 0) throw new Error('not found');
          redemptions[index] = { ...redemptions[index], ...data };
          return Promise.resolve(redemptions[index]);
        },
      ),
    },
    gamificationBadgeDefinition: {
      findMany: jest.fn(() => Promise.resolve([])),
      findFirst: jest.fn(() => Promise.resolve(null)),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: `00000000-0000-4000-8000-${String(300 + ++sequence).padStart(12, '0')}`,
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)),
          updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)),
          ...data,
        }),
      ),
      update: jest.fn(),
    },
    gamificationAchievementDefinition: {
      findMany: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(
          achievements
            .filter((item) => matchesEntry(item, where))
            .sort((left, right) => String(left.name).localeCompare(String(right.name))),
        ),
      ),
      findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(achievements.find((item) => matchesEntry(item, where)) ?? null),
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: `00000000-0000-4000-8000-${String(400 + ++sequence).padStart(12, '0')}`,
          badgeDefinition: null,
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)),
          updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)),
          ...data,
        }),
      ),
      update: jest.fn(),
      count: jest.fn(() => Promise.resolve(0)),
    },
    gamificationAchievementAward: {
      count: jest.fn(() => Promise.resolve(0)),
      findMany: jest.fn(() => Promise.resolve([])),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: `00000000-0000-4000-8000-${String(700 + ++sequence).padStart(12, '0')}`,
          earnedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)),
          ...data,
        }),
      ),
    },
    gamificationBadgeAward: {
      count: jest.fn(() => Promise.resolve(0)),
      findMany: jest.fn(() => Promise.resolve([])),
      createMany: jest.fn(() => Promise.resolve({ count: 0 })),
    },
    gamificationStreakConfig: {
      findUnique: jest.fn(() => Promise.resolve(streakConfig ?? null)),
      upsert: jest.fn(
        ({
          create,
          update,
        }: {
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          if (streakConfig) {
            streakConfig = {
              ...streakConfig,
              ...update,
              updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, ++sequence)),
            };
          } else {
            streakConfig = {
              id: `00000000-0000-4000-8000-${String(500 + ++sequence).padStart(12, '0')}`,
              createdAt: new Date(Date.UTC(2026, 0, 1)),
              updatedAt: new Date(Date.UTC(2026, 0, 1)),
              ...create,
            };
          }
          return Promise.resolve(streakConfig);
        },
      ),
    },
    gamificationLeaderboardConfig: {
      findUnique: jest.fn(() => Promise.resolve(leaderboardConfig ?? null)),
      upsert: jest.fn(
        ({
          create,
          update,
        }: {
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          if (leaderboardConfig) {
            leaderboardConfig = {
              ...leaderboardConfig,
              ...update,
              updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, ++sequence)),
            };
          } else {
            leaderboardConfig = {
              id: `00000000-0000-4000-8000-${String(1100 + ++sequence).padStart(12, '0')}`,
              createdAt: new Date(Date.UTC(2026, 0, 1)),
              updatedAt: new Date(Date.UTC(2026, 0, 1)),
              ...create,
            };
          }
          return Promise.resolve(leaderboardConfig);
        },
      ),
    },
    gamificationLeaderboardPreference: {
      findUnique: jest.fn(
        ({
          where,
        }: {
          where: { workspaceId_membershipId: { workspaceId: string; membershipId: string } };
        }) =>
          Promise.resolve(
            leaderboardPreferences.find(
              (item) =>
                item.workspaceId === where.workspaceId_membershipId.workspaceId &&
                item.membershipId === where.workspaceId_membershipId.membershipId,
            ) ?? null,
          ),
      ),
      upsert: jest.fn(
        ({
          where,
          create,
          update,
        }: {
          where: { workspaceId_membershipId: { workspaceId: string; membershipId: string } };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const index = leaderboardPreferences.findIndex(
            (item) =>
              item.workspaceId === where.workspaceId_membershipId.workspaceId &&
              item.membershipId === where.workspaceId_membershipId.membershipId,
          );
          if (index >= 0) {
            leaderboardPreferences[index] = {
              ...leaderboardPreferences[index],
              ...update,
              updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, ++sequence)),
            };
            return Promise.resolve(leaderboardPreferences[index]);
          }
          const created = {
            id: `00000000-0000-4000-8000-${String(1200 + ++sequence).padStart(12, '0')}`,
            workspaceId: create.workspaceId,
            membershipId: create.membershipId,
            createdAt: new Date(Date.UTC(2026, 0, 1)),
            updatedAt: new Date(Date.UTC(2026, 0, 1)),
            ...create,
          };
          leaderboardPreferences.push(created);
          return Promise.resolve(created);
        },
      ),
    },
    gamificationStreakDay: {
      findMany: jest.fn(
        ({
          where,
          skip = 0,
          take = 10,
        }: {
          where: Record<string, unknown>;
          skip?: number;
          take?: number;
        }) =>
          Promise.resolve(
            streakDays
              .filter((item) => matchesEntry(item, where))
              .sort((left, right) => {
                const dateDiff =
                  (right.localDate as Date).getTime() - (left.localDate as Date).getTime();
                if (dateDiff !== 0) return dateDiff;
                return String(right.id).localeCompare(String(left.id));
              })
              .slice(skip, skip + take),
          ),
      ),
      count: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(streakDays.filter((item) => matchesEntry(item, where)).length),
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        if (
          streakDays.some(
            (item) =>
              item.workspaceId === data.workspaceId &&
              item.membershipId === data.membershipId &&
              String(item.localDate) === String(data.localDate),
          ) ||
          streakDays.some(
            (item) =>
              item.workspaceId === data.workspaceId &&
              item.membershipId === data.membershipId &&
              item.qualificationType === data.qualificationType &&
              item.sourceEntityId === data.sourceEntityId,
          )
        ) {
          throw uniqueConstraintError();
        }
        const created = {
          id: `00000000-0000-4000-8000-${String(600 + ++sequence).padStart(12, '0')}`,
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)),
          ...data,
        };
        streakDays.push(created);
        return Promise.resolve(created);
      }),
    },
    task: {
      count: jest.fn(() => Promise.resolve(0)),
      findFirst: jest.fn(({ where }: { where: { id?: string; workspaceId: string } }) =>
        Promise.resolve(
          where.id ? taskResult(where.id, task, memberships, taskAssigneeMembershipIds) : null,
        ),
      ),
    },
    project: {
      count: jest.fn(() => Promise.resolve(0)),
      findFirst: jest.fn(() => Promise.resolve(project)),
    },
    ticket: {
      findFirst: jest.fn(() => Promise.resolve(ticket)),
    },
    statusDefinition: {
      findMany: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(statusDefinitions.filter((item) => matchesEntry(item, where))),
      ),
    },
    auditLog: {
      findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) => {
        const sorted = auditRows
          .filter((row) => matchesAuditWhere(row, where))
          .sort((left, right) => {
            const createdDiff =
              (left.createdAt as Date).getTime() - (right.createdAt as Date).getTime();
            if (createdDiff !== 0) return createdDiff;
            return String(left.id).localeCompare(String(right.id));
          });
        return Promise.resolve(sorted[0] ?? null);
      }),
      findMany: jest.fn(() =>
        Promise.resolve(
          [...auditRows].sort((left, right) => {
            const createdDiff =
              (left.createdAt as Date).getTime() - (right.createdAt as Date).getTime();
            if (createdDiff !== 0) return createdDiff;
            return String(left.id).localeCompare(String(right.id));
          }),
        ),
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const created = {
          id: `00000000-0000-4000-8000-${String(1300 + ++sequence).padStart(12, '0')}`,
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)),
          ...data,
        };
        auditRows.push(created);
        return Promise.resolve(created);
      }),
    },
    refreshToken: {
      findUnique: jest.fn(({ where }: { where: { tokenHash: string } }) =>
        Promise.resolve(
          where.tokenHash === 'hash:refresh-token'
            ? {
                id: '00000000-0000-4000-8000-000000000099',
                userId: tenant.userId,
                expiresAt: new Date(Date.UTC(2099, 0, 1, 1)),
                revokedAt: null,
              }
            : null,
        ),
      ),
    },
    securityStepUpGrant: {
      updateMany: jest.fn(
        ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          const index = stepUpGrants.findIndex(
            (grant) =>
              grant.id === where.id &&
              grant.userId === where.userId &&
              grant.refreshTokenId === where.refreshTokenId &&
              grant.workspaceId === where.workspaceId &&
              grant.targetMembershipId === where.targetMembershipId &&
              grant.purpose === where.purpose &&
              grant.economy === where.economy &&
              grant.usedAt === null,
          );
          if (index < 0) return Promise.resolve({ count: 0 });
          stepUpGrants[index] = { ...stepUpGrants[index], ...data };
          return Promise.resolve({ count: 1 });
        },
      ),
    },
  };
  const prisma = {
    $queryRaw: tx.$queryRaw,
    $transaction: jest.fn(
      async (callback: ((client: typeof tx) => unknown) | Array<Promise<unknown>>) => {
        if (Array.isArray(callback)) return Promise.all(callback);
        const entrySnapshot = [...entries];
        const rewardPointEntrySnapshot = [...rewardPointEntries];
        const workXpEventSnapshot = [...workXpEvents];
        const reconciliationSnapshot = [...reconciliations];
        const levelSnapshot = [...levels];
        const rewardSnapshot = [...rewards];
        const redemptionSnapshot = [...redemptions];
        const pointRuleSnapshot = [...pointRules];
        const creationPointRuleSnapshot = [...creationPointRules];
        const streakDaySnapshot = [...streakDays];
        const streakConfigSnapshot = streakConfig ? { ...streakConfig } : streakConfig;
        const leaderboardConfigSnapshot = leaderboardConfig
          ? { ...leaderboardConfig }
          : leaderboardConfig;
        const leaderboardPreferenceSnapshot = [...leaderboardPreferences];
        const auditSnapshot = [...auditRows];
        const stepUpGrantSnapshot = [...stepUpGrants];
        try {
          return await callback(tx);
        } catch (error) {
          entries.splice(0, entries.length, ...entrySnapshot);
          rewardPointEntries.splice(0, rewardPointEntries.length, ...rewardPointEntrySnapshot);
          workXpEvents.splice(0, workXpEvents.length, ...workXpEventSnapshot);
          reconciliations.splice(0, reconciliations.length, ...reconciliationSnapshot);
          levels.splice(0, levels.length, ...levelSnapshot);
          rewards.splice(0, rewards.length, ...rewardSnapshot);
          redemptions.splice(0, redemptions.length, ...redemptionSnapshot);
          pointRules.splice(0, pointRules.length, ...pointRuleSnapshot);
          creationPointRules.splice(0, creationPointRules.length, ...creationPointRuleSnapshot);
          streakDays.splice(0, streakDays.length, ...streakDaySnapshot);
          streakConfig = streakConfigSnapshot;
          leaderboardConfig = leaderboardConfigSnapshot;
          leaderboardPreferences.splice(
            0,
            leaderboardPreferences.length,
            ...leaderboardPreferenceSnapshot,
          );
          auditRows.splice(0, auditRows.length, ...auditSnapshot);
          stepUpGrants.splice(0, stepUpGrants.length, ...stepUpGrantSnapshot);
          throw error;
        }
      },
    ),
    workspace: tx.workspace,
    workspaceMembership: tx.workspaceMembership,
    gamificationXpEntry: tx.gamificationXpEntry,
    gamificationWorkXpEvent: tx.gamificationWorkXpEvent,
    gamificationXpReconciliation: tx.gamificationXpReconciliation,
    gamificationRewardPointEntry: tx.gamificationRewardPointEntry,
    gamificationRewardDefinition: tx.gamificationRewardDefinition,
    gamificationRewardRedemption: tx.gamificationRewardRedemption,
    gamificationPointRule: tx.gamificationPointRule,
    gamificationCreationPointRule: tx.gamificationCreationPointRule,
    gamificationLevel: tx.gamificationLevel,
    gamificationBadgeDefinition: tx.gamificationBadgeDefinition,
    gamificationAchievementDefinition: tx.gamificationAchievementDefinition,
    gamificationAchievementAward: tx.gamificationAchievementAward,
    gamificationBadgeAward: tx.gamificationBadgeAward,
    gamificationStreakConfig: tx.gamificationStreakConfig,
    gamificationStreakDay: tx.gamificationStreakDay,
    gamificationLeaderboardConfig: tx.gamificationLeaderboardConfig,
    gamificationLeaderboardPreference: tx.gamificationLeaderboardPreference,
    department: tx.department,
    role: tx.role,
    task: tx.task,
    project: tx.project,
    ticket: tx.ticket,
    statusDefinition: tx.statusDefinition,
    auditLog: tx.auditLog,
    refreshToken: tx.refreshToken,
    securityStepUpGrant: tx.securityStepUpGrant,
  };

  const audit = {
    record: jest.fn((data: Record<string, unknown>) => {
      auditRows.push({
        id: `00000000-0000-4000-8000-${String(1400 + ++sequence).padStart(12, '0')}`,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)),
        ...data,
      });
      return Promise.resolve();
    }),
  };
  const tokens = { createTokenHash: jest.fn((value: string) => `hash:${value}`) };
  return {
    service: new GamificationService(prisma as never, audit as never, tokens as never),
    entries,
    rewardPointEntries,
    workXpEvents,
    reconciliations,
    pointRules,
    creationPointRules,
    rewards,
    redemptions,
    leaderboardPreferences,
    streakDays,
    prisma,
    tx,
    audit,
    auditRows,
    stepUpGrants,
  };
}

function leaderboardRows(
  memberships: Array<Record<string, unknown>>,
  entries: Array<Record<string, unknown>>,
  preferences: Array<Record<string, unknown>>,
  departments: Array<Record<string, unknown>>,
  workspace: string,
  targetDepartment?: string,
) {
  const eligible = memberships
    .filter(
      (member) =>
        member.workspaceId === workspace &&
        member.status === MembershipStatus.ACTIVE &&
        (!targetDepartment || member.departmentId === targetDepartment),
    )
    .map((member) => {
      const privacy =
        preferences.find(
          (preference) =>
            preference.workspaceId === workspace && preference.membershipId === member.id,
        )?.privacyMode ?? GamificationLeaderboardPrivacyMode.ANONYMOUS;
      const currentXp = entries
        .filter((entry) => entry.workspaceId === workspace && entry.membershipId === member.id)
        .reduce((sum, entry) => sum + Number(entry.amount), 0);
      const department = departments.find(
        (item) => item.id === member.departmentId && item.workspaceId === workspace,
      );
      return {
        membershipId: String(member.id),
        departmentId: (member.departmentId as string | null | undefined) ?? null,
        departmentName: (department?.name as string | null | undefined) ?? null,
        name: (member.userName as string | null | undefined) ?? null,
        privacyMode: privacy,
        currentXp,
        rank: 0,
      };
    })
    .filter((row) => row.privacyMode !== GamificationLeaderboardPrivacyMode.OPT_OUT)
    .sort((left, right) => {
      const xpDiff = right.currentXp - left.currentXp;
      if (xpDiff !== 0) return xpDiff;
      return left.membershipId.localeCompare(right.membershipId);
    });
  let rank = 0;
  let previousXp: number | null = null;
  return eligible.map((row) => {
    if (previousXp !== row.currentXp) {
      rank += 1;
      previousXp = row.currentXp;
    }
    return { ...row, rank };
  });
}

function sortNewestFirst(left: Record<string, unknown>, right: Record<string, unknown>) {
  const createdDiff = (right.createdAt as Date).getTime() - (left.createdAt as Date).getTime();
  if (createdDiff !== 0) return createdDiff;
  return String(right.id).localeCompare(String(left.id));
}

function sortWorkEventsNewestFirst(left: Record<string, unknown>, right: Record<string, unknown>) {
  const cycleDiff = Number(right.completionCycle ?? 0) - Number(left.completionCycle ?? 0);
  if (cycleDiff !== 0) return cycleDiff;
  const occurredDiff =
    ((right.occurredAt as Date | null | undefined) ?? (right.createdAt as Date)).getTime() -
    ((left.occurredAt as Date | null | undefined) ?? (left.createdAt as Date)).getTime();
  if (occurredDiff !== 0) return occurredDiff;
  return String(right.id).localeCompare(String(left.id));
}

function taskResult(
  id: string,
  task: Record<string, unknown> | null,
  memberships: Array<Record<string, unknown>>,
  assigneeIds: string[],
) {
  const base = {
    id,
    title: 'Task',
    priority: GamificationPointCategory.MEDIUM,
    dueAt: null,
    departmentId: null,
    department: null,
  };
  const selected = { ...base, ...(task ?? {}) };
  return {
    ...selected,
    assignees: memberships
      .filter(
        (item) =>
          item.workspaceId === workspaceId &&
          item.status === MembershipStatus.ACTIVE &&
          assigneeIds.includes(String(item.id)),
      )
      .map((item) => ({
        membershipId: item.id,
        membership: { status: item.status },
      })),
  };
}
