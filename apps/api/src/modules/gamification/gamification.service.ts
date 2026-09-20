import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import {
  GamificationXpEntry,
  GamificationXpEntryType,
  GamificationXpSourceType,
  MembershipStatus,
  Prisma,
} from '@prisma/client';
import type { WorkspaceTenantContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { GamificationXpHistoryQueryDto } from './dto/gamification-xp-query.dto';

const MAX_XP_AMOUNT = 1_000_000;
const SOURCE_EVENT_MAX_LENGTH = 80;
const IDEMPOTENCY_KEY_MAX_LENGTH = 160;
const REASON_MAX_LENGTH = 500;

export interface ApplyXpChangeInput {
  workspaceId: string;
  membershipId: string;
  amount: number;
  entryType: GamificationXpEntryType;
  sourceType: GamificationXpSourceType;
  sourceEvent: string;
  sourceEntityId?: string | null;
  idempotencyKey?: string | null;
  actorMembershipId?: string | null;
  reason?: string | null;
}

export interface ReverseXpEntryInput {
  workspaceId: string;
  membershipId: string;
  entryId: string;
  idempotencyKey?: string | null;
  actorMembershipId?: string | null;
  reason?: string | null;
}

@Injectable()
export class GamificationService {
  constructor(private readonly prisma: PrismaService) {}

  async getMyXpSummary(tenant: WorkspaceTenantContext) {
    const membershipId = requireWorkspaceMembership(tenant);
    const where = { workspaceId: tenant.workspaceId, membershipId };
    const [balance, earned, deducted, count, last] = await Promise.all([
      this.prisma.gamificationXpEntry.aggregate({ where, _sum: { amount: true } }),
      this.prisma.gamificationXpEntry.aggregate({
        where: { ...where, entryType: GamificationXpEntryType.EARN, amount: { gt: 0 } },
        _sum: { amount: true },
      }),
      this.prisma.gamificationXpEntry.aggregate({
        where: { ...where, entryType: GamificationXpEntryType.DEDUCT, amount: { lt: 0 } },
        _sum: { amount: true },
      }),
      this.prisma.gamificationXpEntry.count({ where }),
      this.prisma.gamificationXpEntry.findFirst({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { createdAt: true },
      }),
    ]);
    return {
      currentXp: Math.max(0, balance._sum.amount ?? 0),
      lifetimeEarnedXp: earned._sum.amount ?? 0,
      lifetimeDeductedXp: Math.abs(deducted._sum.amount ?? 0),
      entryCount: count,
      lastXpChangeAt: last?.createdAt ?? null,
    };
  }

  async getMyXpHistory(tenant: WorkspaceTenantContext, query: GamificationXpHistoryQueryDto) {
    const membershipId = requireWorkspaceMembership(tenant);
    const page = query.page;
    const pageSize = query.pageSize;
    const where: Prisma.GamificationXpEntryWhereInput = {
      workspaceId: tenant.workspaceId,
      membershipId,
      ...(query.entryType ? { entryType: query.entryType } : {}),
      ...(query.sourceType ? { sourceType: query.sourceType } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.gamificationXpEntry.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: xpEntrySelect,
      }),
      this.prisma.gamificationXpEntry.count({ where }),
    ]);
    return { items, page, pageSize, total };
  }

  async applyXpChange(input: ApplyXpChangeInput) {
    const normalized = normalizeApplyInput(input);
    return this.prisma.$transaction(async (tx) => {
      await lockMembership(tx, normalized.workspaceId, normalized.membershipId);
      const existing = normalized.idempotencyKey
        ? await tx.gamificationXpEntry.findFirst({
            where: {
              workspaceId: normalized.workspaceId,
              membershipId: normalized.membershipId,
              idempotencyKey: normalized.idempotencyKey,
            },
          })
        : null;
      if (existing) return assertIdempotentReplay(existing, normalized);
      await assertActiveMembership(tx, normalized.workspaceId, normalized.membershipId);
      if (normalized.actorMembershipId)
        await assertWorkspaceMembership(tx, normalized.workspaceId, normalized.actorMembershipId);
      await assertBalanceFloor(
        tx,
        normalized.workspaceId,
        normalized.membershipId,
        normalized.amount,
      );
      try {
        return await tx.gamificationXpEntry.create({ data: normalized });
      } catch (error) {
        if (isUniqueConstraintError(error) && normalized.idempotencyKey) {
          const replay = await tx.gamificationXpEntry.findFirstOrThrow({
            where: {
              workspaceId: normalized.workspaceId,
              membershipId: normalized.membershipId,
              idempotencyKey: normalized.idempotencyKey,
            },
          });
          return assertIdempotentReplay(replay, normalized);
        }
        throw error;
      }
    });
  }

  async awardSystemXp(input: Omit<ApplyXpChangeInput, 'entryType'>) {
    return this.applyXpChange({ ...input, entryType: GamificationXpEntryType.EARN });
  }

  async deductSystemXp(input: Omit<ApplyXpChangeInput, 'entryType'>) {
    return this.applyXpChange({ ...input, entryType: GamificationXpEntryType.DEDUCT });
  }

  async reverseXpEntry(input: ReverseXpEntryInput) {
    const reason = normalizeBoundedText(input.reason, REASON_MAX_LENGTH, 'XP_REASON_INVALID');
    const idempotencyKey = normalizeBoundedText(
      input.idempotencyKey ?? `reversal:${input.entryId}`,
      IDEMPOTENCY_KEY_MAX_LENGTH,
      'XP_IDEMPOTENCY_KEY_INVALID',
    );
    return this.prisma.$transaction(async (tx) => {
      await lockMembership(tx, input.workspaceId, input.membershipId);
      const original = await tx.gamificationXpEntry.findFirst({
        where: {
          id: input.entryId,
          workspaceId: input.workspaceId,
          membershipId: input.membershipId,
        },
      });
      if (!original) throw new ConflictException('XP_ENTRY_NOT_FOUND');
      if (original.entryType === GamificationXpEntryType.REVERSAL)
        throw new ConflictException('XP_REVERSAL_CHAIN_UNSUPPORTED');
      const existingReversal = await tx.gamificationXpEntry.findFirst({
        where: { reversalOfEntryId: original.id },
      });
      if (existingReversal) throw new ConflictException('XP_ENTRY_ALREADY_REVERSED');
      await assertActiveMembership(tx, input.workspaceId, input.membershipId);
      if (input.actorMembershipId)
        await assertWorkspaceMembership(tx, input.workspaceId, input.actorMembershipId);
      const amount = -original.amount;
      await assertBalanceFloor(tx, input.workspaceId, input.membershipId, amount);
      return tx.gamificationXpEntry.create({
        data: {
          workspaceId: input.workspaceId,
          membershipId: input.membershipId,
          amount,
          entryType: GamificationXpEntryType.REVERSAL,
          sourceType: original.sourceType,
          sourceEvent: 'XP_REVERSAL',
          sourceEntityId: original.sourceEntityId,
          idempotencyKey,
          reversalOfEntryId: original.id,
          actorMembershipId: input.actorMembershipId ?? null,
          reason,
        },
      });
    });
  }
}

const xpEntrySelect = {
  id: true,
  amount: true,
  entryType: true,
  sourceType: true,
  sourceEvent: true,
  sourceEntityId: true,
  reason: true,
  createdAt: true,
} satisfies Prisma.GamificationXpEntrySelect;

function requireWorkspaceMembership(tenant: WorkspaceTenantContext) {
  if (!tenant.workspaceMembershipId) throw new ForbiddenException('WORKSPACE_MEMBERSHIP_REQUIRED');
  return tenant.workspaceMembershipId;
}

function normalizeApplyInput(
  input: ApplyXpChangeInput,
): Prisma.GamificationXpEntryUncheckedCreateInput {
  if (
    !Number.isInteger(input.amount) ||
    input.amount === 0 ||
    Math.abs(input.amount) > MAX_XP_AMOUNT
  )
    throw new BadRequestException('XP_AMOUNT_INVALID');
  if (input.entryType === GamificationXpEntryType.EARN && input.amount <= 0)
    throw new BadRequestException('XP_EARN_AMOUNT_INVALID');
  if (input.entryType === GamificationXpEntryType.DEDUCT && input.amount >= 0)
    throw new BadRequestException('XP_DEDUCT_AMOUNT_INVALID');
  if (input.entryType === GamificationXpEntryType.REVERSAL)
    throw new BadRequestException('XP_REVERSAL_USE_REVERSE_METHOD');
  return {
    workspaceId: input.workspaceId,
    membershipId: input.membershipId,
    amount: input.amount,
    entryType: input.entryType,
    sourceType: input.sourceType,
    sourceEvent: requireBoundedText(
      input.sourceEvent,
      SOURCE_EVENT_MAX_LENGTH,
      'XP_SOURCE_EVENT_INVALID',
    ),
    sourceEntityId: input.sourceEntityId ?? null,
    idempotencyKey: normalizeBoundedText(
      input.idempotencyKey,
      IDEMPOTENCY_KEY_MAX_LENGTH,
      'XP_IDEMPOTENCY_KEY_INVALID',
    ),
    reversalOfEntryId: null,
    actorMembershipId: input.actorMembershipId ?? null,
    reason: normalizeBoundedText(input.reason, REASON_MAX_LENGTH, 'XP_REASON_INVALID'),
  };
}

function assertIdempotentReplay(
  existing: GamificationXpEntry,
  input: Prisma.GamificationXpEntryUncheckedCreateInput,
) {
  if (
    existing.amount !== input.amount ||
    existing.entryType !== input.entryType ||
    existing.sourceType !== input.sourceType ||
    existing.sourceEvent !== input.sourceEvent ||
    existing.sourceEntityId !== input.sourceEntityId ||
    existing.reversalOfEntryId !== input.reversalOfEntryId
  ) {
    throw new ConflictException('XP_IDEMPOTENCY_CONFLICT');
  }
  return existing;
}

async function lockMembership(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  membershipId: string,
) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id
    FROM workspace_memberships
    WHERE id = ${membershipId}::uuid
      AND workspace_id = ${workspaceId}::uuid
    FOR UPDATE
  `);
  if (rows.length !== 1) throw new ForbiddenException('WORKSPACE_MEMBERSHIP_NOT_FOUND');
}

async function assertActiveMembership(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  membershipId: string,
) {
  const membership = await tx.workspaceMembership.findFirst({
    where: { id: membershipId, workspaceId },
    select: { status: true },
  });
  if (!membership) throw new ForbiddenException('WORKSPACE_MEMBERSHIP_NOT_FOUND');
  if (membership.status !== MembershipStatus.ACTIVE)
    throw new ForbiddenException('XP_TARGET_MEMBERSHIP_INACTIVE');
}

async function assertWorkspaceMembership(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  membershipId: string,
) {
  const count = await tx.workspaceMembership.count({ where: { id: membershipId, workspaceId } });
  if (count !== 1) throw new ForbiddenException('XP_ACTOR_MEMBERSHIP_INVALID');
}

async function assertBalanceFloor(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  membershipId: string,
  delta: number,
) {
  const aggregate = await tx.gamificationXpEntry.aggregate({
    where: { workspaceId, membershipId },
    _sum: { amount: true },
  });
  if ((aggregate._sum.amount ?? 0) + delta < 0) throw new ConflictException('XP_BALANCE_FLOOR');
}

function requireBoundedText(value: string | undefined, max: number, error: string) {
  const normalized = value?.trim();
  if (!normalized || normalized.length > max) throw new BadRequestException(error);
  return normalized;
}

function normalizeBoundedText(value: string | null | undefined, max: number, error: string) {
  if (value == null || value === '') return null;
  return requireBoundedText(value, max, error);
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
