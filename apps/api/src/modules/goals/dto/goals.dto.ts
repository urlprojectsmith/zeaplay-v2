import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { GoalMetricType, GoalOwnerType, GoalPeriodType, GoalStatus } from '@prisma/client';

export class GoalListQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Transform(({ value }) => Number(value ?? 1))
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 30, minimum: 1, maximum: 100 })
  @Transform(({ value }) => Number(value ?? 30))
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 30;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  search?: string;

  @ApiPropertyOptional({ enum: GoalStatus })
  @IsOptional()
  @IsEnum(GoalStatus)
  status?: GoalStatus;

  @ApiPropertyOptional({ enum: GoalOwnerType })
  @IsOptional()
  @IsEnum(GoalOwnerType)
  ownerType?: GoalOwnerType;

  @ApiPropertyOptional({ enum: GoalMetricType })
  @IsOptional()
  @IsEnum(GoalMetricType)
  metricType?: GoalMetricType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  ownerMembershipId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string;
}

export class CreateGoalDto {
  @IsString()
  @MinLength(1)
  @MaxLength(180)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsEnum(GoalOwnerType)
  ownerType!: GoalOwnerType;

  @IsOptional()
  @IsUUID()
  ownerMembershipId?: string | null;

  @IsOptional()
  @IsUUID()
  departmentId?: string | null;

  @IsEnum(GoalMetricType)
  metricType!: GoalMetricType;

  @IsEnum(GoalPeriodType)
  periodType!: GoalPeriodType;

  @IsInt()
  @Min(1)
  @Max(100000000)
  targetValue!: number;

  @IsOptional()
  @IsString()
  periodStart?: string;

  @IsOptional()
  @IsString()
  periodEnd?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class ManualGoalProgressDto {
  @IsInt()
  @Min(-100000000)
  @Max(100000000)
  delta!: number;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(220)
  idempotencyKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class ReconcileGoalDto {
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(220)
  idempotencyKey?: string;
}

export class GoalParamsDto {
  @IsUUID()
  goalId!: string;
}

export class ParentGoalsQueryDto extends GoalListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  agencyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  workspaceId?: string;
}
