import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, Min } from 'class-validator';

export const analyticsDatePresets = [
  'TODAY',
  'YESTERDAY',
  'LAST_7_DAYS',
  'LAST_30_DAYS',
  'THIS_WEEK',
  'LAST_WEEK',
  'THIS_MONTH',
  'LAST_MONTH',
  'THIS_QUARTER',
  'LAST_QUARTER',
  'THIS_YEAR',
  'CUSTOM',
] as const;

export const analyticsBuckets = ['HOUR', 'DAY', 'WEEK', 'MONTH'] as const;
export const analyticsDimensions = [
  'DATE',
  'HOUR',
  'DAY',
  'WEEK',
  'MONTH',
  'WORKSPACE',
  'AGENCY',
  'DEPARTMENT',
  'STATUS',
  'PRIORITY',
  'PLAN',
  'SUBSCRIPTION_STATUS',
] as const;

export class AnalyticsQueryDto {
  @ApiPropertyOptional({ description: 'Comma-separated registry metric keys.' })
  @IsOptional()
  @IsString()
  metrics?: string;

  @ApiPropertyOptional({ enum: analyticsDatePresets, default: 'LAST_30_DAYS' })
  @IsOptional()
  @IsIn(analyticsDatePresets)
  datePreset: (typeof analyticsDatePresets)[number] = 'LAST_30_DAYS';

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  start?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  end?: string;

  @ApiPropertyOptional({ enum: analyticsBuckets, default: 'DAY' })
  @IsOptional()
  @IsIn(analyticsBuckets)
  bucket: (typeof analyticsBuckets)[number] = 'DAY';

  @ApiPropertyOptional({ enum: analyticsDimensions })
  @IsOptional()
  @IsIn(analyticsDimensions)
  dimension?: (typeof analyticsDimensions)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  workspaceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  agencyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  priority?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  plan?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subscriptionStatus?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Transform(({ value }) => Number(value ?? 1))
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100 })
  @Transform(({ value }) => Number(value ?? 50))
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 50;
}

export class AnalyticsRebuildDto extends AnalyticsQueryDto {}
