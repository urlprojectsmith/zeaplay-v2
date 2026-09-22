import { ApiPropertyOptional } from '@nestjs/swagger';
import { GamificationAchievementCriterionType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class GamificationDefinitionQueryDto {
  @ApiPropertyOptional({ default: false })
  @Transform(({ value }) => value === true || value === 'true')
  @IsOptional()
  @IsBoolean()
  includeInactive?: boolean;
}

export class CreateGamificationBadgeDto {
  @IsString()
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  iconKey?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateGamificationBadgeDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  iconKey?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateGamificationAchievementDto {
  @IsString()
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsEnum(GamificationAchievementCriterionType)
  criterionType!: GamificationAchievementCriterionType;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  criterionValue!: number;

  @IsOptional()
  @IsUUID()
  badgeDefinitionId?: string | null;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(0)
  @Max(100_000)
  xpReward?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(0)
  @Max(100_000)
  rewardPointsReward?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateGamificationAchievementDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @IsEnum(GamificationAchievementCriterionType)
  criterionType?: GamificationAchievementCriterionType;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  criterionValue?: number;

  @IsOptional()
  @IsUUID()
  badgeDefinitionId?: string | null;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(0)
  @Max(100_000)
  xpReward?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(0)
  @Max(100_000)
  rewardPointsReward?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
