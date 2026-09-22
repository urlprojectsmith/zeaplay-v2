import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export const xpControlStatuses = ['BALANCED', 'MISMATCH', 'NEEDS_REVIEW', 'RECONCILED'] as const;
export const xpControlSortFields = [
  'user',
  'claimedXp',
  'storedXp',
  'currentXp',
  'delta',
  'status',
  'lastActivityAt',
] as const;
export const xpLogCategories = [
  'ALL',
  'TASKS',
  'PROJECTS',
  'TICKETS',
  'CREATION_XP',
  'BONUS_XP',
  'PENALTY_XP',
  'REVERSALS',
  'ACHIEVEMENTS',
  'STREAKS',
  'MANUAL_ADJUSTMENTS',
  'RESETS',
  'RECONCILIATION',
  'LEGACY',
] as const;

export class GamificationXpControlQueryDto {
  @IsOptional()
  @Transform(({ value }) => Number(value ?? 1))
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Transform(({ value }) => Number(value ?? 20))
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsIn(xpControlStatuses)
  status?: (typeof xpControlStatuses)[number];

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  hasDelta?: boolean;

  @IsOptional()
  @IsIn(xpControlSortFields)
  sortBy: (typeof xpControlSortFields)[number] = 'delta';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection: 'asc' | 'desc' = 'desc';
}

export class GamificationXpLogQueryDto {
  @IsOptional()
  @Transform(({ value }) => Number(value ?? 1))
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Transform(({ value }) => Number(value ?? 20))
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @IsOptional()
  @IsIn(xpLogCategories)
  category: (typeof xpLogCategories)[number] = 'ALL';
}

export class GamificationXpReconciliationPreviewDto {
  @IsUUID()
  targetMembershipId!: string;
}

export class GamificationXpReconciliationApplyDto {
  @IsUUID()
  targetMembershipId!: string;

  @IsString()
  previewToken!: string;

  @IsString()
  reason!: string;

  @IsString()
  confirmation!: string;

  @IsString()
  idempotencyKey!: string;
}
