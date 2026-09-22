import {
  GamificationRewardInventoryMode,
  GamificationRewardRedemptionStatus,
} from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class GamificationRewardPointHistoryQueryDto {
  @IsOptional()
  @Transform(({ value }) => Number(value ?? 1))
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Transform(({ value }) => Number(value ?? 10))
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize = 10;
}

export class GamificationRewardDefinitionQueryDto {
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeInactive = false;

  @IsOptional()
  @Transform(({ value }) => Number(value ?? 1))
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Transform(({ value }) => Number(value ?? 20))
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize = 20;
}

export class CreateGamificationRewardDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsInt()
  @Min(1)
  @Max(1_000_000)
  pointsCost!: number;

  @IsEnum(GamificationRewardInventoryMode)
  inventoryMode!: GamificationRewardInventoryMode;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  availableQuantity?: number | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateGamificationRewardDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  pointsCost?: number;

  @IsOptional()
  @IsEnum(GamificationRewardInventoryMode)
  inventoryMode?: GamificationRewardInventoryMode;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  availableQuantity?: number | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class RedeemGamificationRewardDto {
  @IsUUID()
  idempotencyKey!: string;
}

export class GamificationRewardRedemptionQueryDto {
  @IsOptional()
  @IsEnum(GamificationRewardRedemptionStatus)
  status?: GamificationRewardRedemptionStatus;

  @IsOptional()
  @Transform(({ value }) => Number(value ?? 1))
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Transform(({ value }) => Number(value ?? 10))
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize = 10;
}

export class CancelGamificationRewardRedemptionDto {
  @IsOptional()
  @IsString()
  reason?: string | null;
}
