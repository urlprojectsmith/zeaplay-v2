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

export const dashboardVisibilities = ['PRIVATE', 'SELECTED_MEMBERS', 'WORKSPACE', 'SCOPE'] as const;
export const dashboardStatuses = ['ACTIVE', 'ARCHIVED'] as const;
export const dashboardWidgetTypes = [
  'METRIC_CARD',
  'LINE_CHART',
  'BAR_CHART',
  'AREA_CHART',
  'PIE_CHART',
  'DONUT_CHART',
  'TABLE',
  'GOAL_PROGRESS',
  'GAMIFICATION_SUMMARY',
] as const;
export const dashboardWidgetDataSources = ['ANALYTICS_QUERY', 'SAVED_REPORT'] as const;
export const dashboardBreakpoints = ['desktop', 'tablet', 'mobile'] as const;

export class DashboardFiltersDto {
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
}

export class DashboardLayoutDto {
  @IsInt()
  @Min(0)
  @Max(48)
  x!: number;

  @IsInt()
  @Min(0)
  @Max(200)
  y!: number;

  @IsInt()
  @Min(1)
  @Max(12)
  width!: number;

  @IsInt()
  @Min(1)
  @Max(24)
  height!: number;

  @IsOptional()
  @IsIn(dashboardBreakpoints)
  breakpoint?: (typeof dashboardBreakpoints)[number];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  order?: number;
}

export class DashboardWidgetConfigDto {
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @IsString({ each: true })
  metricKeys?: string[];

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
  @ValidateNested()
  @Type(() => DashboardFiltersDto)
  filters?: DashboardFiltersDto;

  @IsOptional()
  @IsBoolean()
  inheritGlobalFilters?: boolean;

  @IsOptional()
  @IsUUID()
  reportId?: string;
}

export class CreateDashboardWidgetDto {
  @IsIn(dashboardWidgetTypes)
  type!: (typeof dashboardWidgetTypes)[number];

  @IsString()
  @MaxLength(160)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsIn(dashboardWidgetDataSources)
  dataSourceType!: (typeof dashboardWidgetDataSources)[number];

  @ValidateNested()
  @Type(() => DashboardWidgetConfigDto)
  configuration!: DashboardWidgetConfigDto;

  @ValidateNested()
  @Type(() => DashboardLayoutDto)
  layout!: DashboardLayoutDto;

  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(86400)
  refreshSeconds?: number | null;
}

export class UpdateDashboardWidgetDto {
  @IsOptional()
  @IsIn(dashboardWidgetTypes)
  type?: (typeof dashboardWidgetTypes)[number];

  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @IsIn(dashboardWidgetDataSources)
  dataSourceType?: (typeof dashboardWidgetDataSources)[number];

  @IsOptional()
  @ValidateNested()
  @Type(() => DashboardWidgetConfigDto)
  configuration?: DashboardWidgetConfigDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => DashboardLayoutDto)
  layout?: DashboardLayoutDto;

  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(86400)
  refreshSeconds?: number | null;

  @IsInt()
  @Min(1)
  expectedRevision!: number;
}

export class CreateDashboardDto {
  @IsString()
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsIn(dashboardVisibilities)
  visibility?: (typeof dashboardVisibilities)[number];

  @IsOptional()
  @ValidateNested()
  @Type(() => DashboardFiltersDto)
  globalFilters?: DashboardFiltersDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID(undefined, { each: true })
  accessMembershipIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => CreateDashboardWidgetDto)
  widgets?: CreateDashboardWidgetDto[];
}

export class UpdateDashboardDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @IsIn(dashboardVisibilities)
  visibility?: (typeof dashboardVisibilities)[number];

  @IsOptional()
  @ValidateNested()
  @Type(() => DashboardFiltersDto)
  globalFilters?: DashboardFiltersDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID(undefined, { each: true })
  accessMembershipIds?: string[];

  @IsInt()
  @Min(1)
  expectedRevision!: number;
}

export class DashboardListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(dashboardStatuses)
  status?: (typeof dashboardStatuses)[number];
}

export class DashboardExpectedRevisionDto {
  @IsInt()
  @Min(1)
  expectedRevision!: number;
}

export class DashboardLayoutUpdateItemDto {
  @IsUUID()
  widgetId!: string;

  @ValidateNested()
  @Type(() => DashboardLayoutDto)
  layout!: DashboardLayoutDto;
}

export class UpdateDashboardLayoutDto extends DashboardExpectedRevisionDto {
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => DashboardLayoutUpdateItemDto)
  layouts!: DashboardLayoutUpdateItemDto[];
}

export class DashboardPreferenceDto {
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  enabled!: boolean;
}

export class CreateDashboardFromTemplateDto {
  @IsString()
  @MaxLength(80)
  templateKey!: string;
}
