import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import {
  GamificationXpEntryType,
  GamificationXpSourceType,
  MembershipStatus,
} from '@prisma/client';
import { GamificationService } from './gamification.service';

const workspaceId = '00000000-0000-4000-8000-000000000001';
const membershipId = '00000000-0000-4000-8000-000000000002';
const actorMembershipId = '00000000-0000-4000-8000-000000000003';
const otherWorkspaceId = '00000000-0000-4000-8000-000000000008';
const otherMembershipId = '00000000-0000-4000-8000-000000000009';

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

describe('GamificationService', () => {
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

function makeService(options?: {
  memberships?: Array<{ id: string; workspaceId: string; status: MembershipStatus }>;
  entries?: Array<Record<string, unknown>>;
}) {
  const memberships = options?.memberships ?? [
    { id: membershipId, workspaceId, status: MembershipStatus.ACTIVE },
    { id: actorMembershipId, workspaceId, status: MembershipStatus.ACTIVE },
  ];
  const entries: Array<Record<string, unknown>> = [...(options?.entries ?? [])];
  let sequence = 0;

  const matchesEntry = (entry: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => {
      if (value && typeof value === 'object' && 'gt' in value)
        return Number(entry[key]) > Number((value as { gt: number }).gt);
      if (value && typeof value === 'object' && 'lt' in value)
        return Number(entry[key]) < Number((value as { lt: number }).lt);
      return entry[key] === value;
    });

  const tx = {
    $queryRaw: jest.fn().mockImplementation((query: { values?: string[] }) => {
      const [lockedMembershipId, lockedWorkspaceId] = query.values ?? [];
      return Promise.resolve(
        memberships.some(
          (item) => item.id === lockedMembershipId && item.workspaceId === lockedWorkspaceId,
        )
          ? [{ id: lockedMembershipId }]
          : [],
      );
    }),
    workspaceMembership: {
      findFirst: jest.fn(({ where }: { where: { id: string; workspaceId: string } }) =>
        Promise.resolve(
          memberships.find(
            (item) => item.id === where.id && item.workspaceId === where.workspaceId,
          ) ?? null,
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
    gamificationXpEntry: {
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
        ({ where, skip, take }: { where: Record<string, unknown>; skip: number; take: number }) =>
          Promise.resolve(
            entries
              .filter((entry) => matchesEntry(entry, where))
              .sort(sortNewestFirst)
              .slice(skip, skip + take),
          ),
      ),
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        const created = {
          id: `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)),
          ...data,
        };
        entries.push(created);
        return Promise.resolve(created);
      }),
    },
  };
  const prisma = {
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    gamificationXpEntry: tx.gamificationXpEntry,
  };

  return { service: new GamificationService(prisma as never), entries, prisma, tx };
}

function sortNewestFirst(left: Record<string, unknown>, right: Record<string, unknown>) {
  const createdDiff = (right.createdAt as Date).getTime() - (left.createdAt as Date).getTime();
  if (createdDiff !== 0) return createdDiff;
  return String(right.id).localeCompare(String(left.id));
}
