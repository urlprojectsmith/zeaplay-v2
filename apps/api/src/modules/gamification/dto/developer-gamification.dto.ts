import {
  GamificationGlobalScoreEventStatus,
  GamificationPointCategory,
  GamificationPointWorkType,
  GamificationWorkXpEventOutcome,
  GamificationWorkXpEventType,
  GamificationXpReconciliationStatus,
} from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class DeveloperGamificationPageQueryDto {
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
  @IsUUID()
  agencyId?: string;

  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  @IsOptional()
  @IsUUID()
  membershipId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsString()
  search?: string;
}

export class DeveloperPointRuleInspectorQueryDto extends DeveloperGamificationPageQueryDto {
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsEnum(GamificationPointWorkType)
  workType?: GamificationPointWorkType;

  @IsOptional()
  @IsEnum(GamificationPointCategory)
  category?: GamificationPointCategory;
}

export class DeveloperXpEventMonitorQueryDto extends DeveloperGamificationPageQueryDto {
  @IsOptional()
  @IsEnum(GamificationPointWorkType)
  workType?: GamificationPointWorkType;

  @IsOptional()
  @IsEnum(GamificationWorkXpEventType)
  eventType?: GamificationWorkXpEventType;

  @IsOptional()
  @IsEnum(GamificationWorkXpEventOutcome)
  outcome?: GamificationWorkXpEventOutcome;
}

export class DeveloperNormalizationEventsQueryDto extends DeveloperGamificationPageQueryDto {
  @IsOptional()
  @IsEnum(GamificationGlobalScoreEventStatus)
  status?: GamificationGlobalScoreEventStatus;
}

export class DeveloperReconciliationQueryDto extends DeveloperGamificationPageQueryDto {
  @IsOptional()
  @IsEnum(GamificationXpReconciliationStatus)
  status?: GamificationXpReconciliationStatus;
}

export class DeveloperAuditQueryDto extends DeveloperGamificationPageQueryDto {
  @IsOptional()
  @IsString()
  action?: string;
}

export class DeveloperLeaderboardDiagnosticsQueryDto extends DeveloperGamificationPageQueryDto {
  @IsOptional()
  @IsIn([
    'workspace',
    'department',
    'agency',
    'platform-agencies',
    'platform-subaccounts',
    'platform-users',
  ])
  scope?:
    | 'workspace'
    | 'department'
    | 'agency'
    | 'platform-agencies'
    | 'platform-subaccounts'
    | 'platform-users';
}

export class DeveloperGamificationIdParamDto {
  @IsUUID()
  id!: string;
}
