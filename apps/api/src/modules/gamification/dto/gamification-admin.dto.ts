import { GamificationAdminEconomy } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export enum GamificationAdminAdjustmentOperation {
  ADD = 'ADD',
  DEDUCT = 'DEDUCT',
}

export class GamificationAdminMemberQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Transform(({ value }) => Number(value ?? 20))
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize = 20;
}

export class GamificationAdminAdjustmentDto {
  @IsUUID()
  targetMembershipId!: string;

  @IsEnum(GamificationAdminEconomy)
  economy!: GamificationAdminEconomy;

  @IsEnum(GamificationAdminAdjustmentOperation)
  operation!: GamificationAdminAdjustmentOperation;

  @IsInt()
  @Min(1)
  @Max(1_000_000)
  amount!: number;

  @IsString()
  reason!: string;

  @IsString()
  idempotencyKey!: string;
}

export class GamificationResetStepUpDto {
  @IsUUID()
  targetMembershipId!: string;

  @IsEnum(GamificationAdminEconomy)
  economy!: GamificationAdminEconomy;

  @IsString()
  password!: string;
}

export class GamificationAdminResetDto {
  @IsUUID()
  targetMembershipId!: string;

  @IsEnum(GamificationAdminEconomy)
  economy!: GamificationAdminEconomy;

  @IsString()
  reason!: string;

  @IsString()
  confirmation!: string;

  @IsUUID()
  stepUpGrantId!: string;

  @IsString()
  idempotencyKey!: string;
}
