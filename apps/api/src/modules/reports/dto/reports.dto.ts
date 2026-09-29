import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  analyticsBuckets,
  analyticsDatePresets,
  analyticsDimensions,
} from '../../analytics/dto/analytics.dto';

export const reportTypes = ['SUMMARY', 'TABLE', 'TIME_SERIES'] as const;
export const reportVisibilities = ['PRIVATE', 'SELECTED_MEMBERS', 'SCOPE'] as const;
export const reportExportFormats = ['CSV', 'XLSX'] as const;
export const reportScheduleFrequencies = ['DAILY', 'WEEKLY', 'MONTHLY'] as const;

export class ReportConfigDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @IsString({ each: true })
  metricKeys!: string[];

  @IsOptional()
  @IsIn(analyticsDatePresets)
  datePreset?: (typeof analyticsDatePresets)[number];

  @IsOptional()
  @IsISO8601()
  start?: string;

  @IsOptional()
  @IsISO8601()
  end?: string;

  @IsOptional()
  @IsIn(analyticsBuckets)
  bucket?: (typeof analyticsBuckets)[number];

  @IsOptional()
  @IsIn(analyticsDimensions)
  dimension?: (typeof analyticsDimensions)[number];

  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  @IsOptional()
  @IsUUID()
  agencyId?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  priority?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  plan?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  subscriptionStatus?: string;

  @IsOptional()
  @Transform(({ value }) => Number(value ?? 1))
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value ?? 50))
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class CreateReportDto {
  @IsString()
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsIn(reportTypes)
  type!: (typeof reportTypes)[number];

  @IsOptional()
  @IsIn(reportVisibilities)
  visibility?: (typeof reportVisibilities)[number];

  @ValidateNested()
  @Type(() => ReportConfigDto)
  configuration!: ReportConfigDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID(undefined, { each: true })
  accessMembershipIds?: string[];
}

export class UpdateReportDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @IsIn(reportTypes)
  type?: (typeof reportTypes)[number];

  @IsOptional()
  @IsIn(reportVisibilities)
  visibility?: (typeof reportVisibilities)[number];

  @IsOptional()
  @ValidateNested()
  @Type(() => ReportConfigDto)
  configuration?: ReportConfigDto;

  @IsInt()
  @Min(1)
  expectedRevision!: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID(undefined, { each: true })
  accessMembershipIds?: string[];
}

export class ReportListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(['ACTIVE', 'ARCHIVED'])
  status?: 'ACTIVE' | 'ARCHIVED';
}

export class ExportReportDto {
  @IsIn(reportExportFormats)
  format!: (typeof reportExportFormats)[number];

  @IsOptional()
  @IsString()
  @MaxLength(160)
  idempotencyKey?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  async?: boolean;
}

export class ReportRecipientConfigDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID(undefined, { each: true })
  workspaceMembershipIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID(undefined, { each: true })
  agencyMembershipIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID(undefined, { each: true })
  superAgencyMembershipIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID(undefined, { each: true })
  userIds?: string[];
}

export class CreateReportScheduleDto {
  @IsIn(reportScheduleFrequencies)
  frequency!: (typeof reportScheduleFrequencies)[number];

  @IsString()
  @MaxLength(80)
  timezone!: string;

  @IsString()
  @MaxLength(5)
  localTime!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  dayOfMonth?: number;

  @ValidateNested()
  @Type(() => ReportRecipientConfigDto)
  recipients!: ReportRecipientConfigDto;
}

export class UpdateReportScheduleDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(reportScheduleFrequencies)
  frequency?: (typeof reportScheduleFrequencies)[number];

  @IsOptional()
  @IsString()
  @MaxLength(80)
  timezone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5)
  localTime?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  dayOfMonth?: number;

  @IsOptional()
  @IsObject()
  recipients?: ReportRecipientConfigDto;
}
