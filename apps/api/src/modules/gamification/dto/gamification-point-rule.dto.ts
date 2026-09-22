import {
  GamificationPointCategory,
  GamificationPointScopeType,
  GamificationPointWorkType,
} from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class GamificationPointRulesQueryDto {
  @IsOptional()
  @IsUUID()
  departmentId?: string;
}

export class UpsertGamificationCompletionPointRuleDto {
  @IsEnum(GamificationPointScopeType)
  scopeType!: GamificationPointScopeType;

  @IsOptional()
  @IsUUID()
  departmentId?: string | null;

  @IsEnum(GamificationPointWorkType)
  workType!: GamificationPointWorkType;

  @IsEnum(GamificationPointCategory)
  category!: GamificationPointCategory;

  @IsBoolean()
  isEnabled!: boolean;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  baseXp!: number;

  @Transform(({ value }) => Number(value ?? 0))
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  earlyBonusXp = 0;

  @IsOptional()
  @Transform(({ value }) => (value === null || value === '' ? null : Number(value)))
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  earlyThresholdMinutes?: number | null;

  @Transform(({ value }) => Number(value ?? 0))
  @IsInt()
  @Min(0)
  @Max(100)
  latePenaltyPercent = 0;

  @IsOptional()
  @Transform(({ value }) => (value === null || value === '' ? null : Number(value)))
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  penaltyIntervalMinutes?: number | null;

  @Transform(({ value }) => Number(value ?? 0))
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  maxPenaltyXp = 0;
}

export class UpsertGamificationCreationPointRuleDto {
  @IsEnum(GamificationPointScopeType)
  scopeType!: GamificationPointScopeType;

  @IsOptional()
  @IsUUID()
  departmentId?: string | null;

  @IsEnum(GamificationPointWorkType)
  workType!: GamificationPointWorkType;

  @IsEnum(GamificationPointCategory)
  category!: GamificationPointCategory;

  @IsUUID()
  roleId!: string;

  @IsBoolean()
  isEnabled!: boolean;

  @Transform(({ value }) => Number(value ?? 0))
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  creationXp = 0;
}

export class RemoveGamificationPointRuleOverrideDto {
  @IsUUID()
  departmentId!: string;

  @IsEnum(GamificationPointWorkType)
  workType!: GamificationPointWorkType;

  @IsEnum(GamificationPointCategory)
  category!: GamificationPointCategory;

  @IsOptional()
  @IsUUID()
  roleId?: string;
}

export class GamificationPointPreviewDto {
  @IsBoolean()
  isEnabled!: boolean;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  baseXp!: number;

  @Transform(({ value }) => Number(value ?? 0))
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  earlyBonusXp = 0;

  @IsOptional()
  @Transform(({ value }) => (value === null || value === '' ? null : Number(value)))
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  earlyThresholdMinutes?: number | null;

  @Transform(({ value }) => Number(value ?? 0))
  @IsInt()
  @Min(0)
  @Max(100)
  latePenaltyPercent = 0;

  @IsOptional()
  @Transform(({ value }) => (value === null || value === '' ? null : Number(value)))
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  penaltyIntervalMinutes?: number | null;

  @Transform(({ value }) => Number(value ?? 0))
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  maxPenaltyXp = 0;

  @IsDateString()
  completedAt!: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string | null;
}
