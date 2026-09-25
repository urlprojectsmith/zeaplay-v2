import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  BillingInterval,
  BillingProvider,
  MasterPlanStatus,
  MasterPlanType,
  PlanEntitlementKind,
  PlanEntitlementValueType,
  SuperAgencySubscriptionStatus,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { BILLING_RESOURCE_KEYS } from '../billing.constants';

const planKeyPattern = /^[a-z0-9][a-z0-9_.-]{1,79}$/;
export const BILLING_INVOICE_STATUS_FILTERS = [
  'draft',
  'open',
  'paid',
  'uncollectible',
  'void',
] as const;

export class BillingPlanParamsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  planId!: string;
}

export class BillingPlanVersionParamsDto extends BillingPlanParamsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  versionId!: string;
}

export class BillingSuperAgencyParamsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  superAgencyId!: string;
}

export class BillingPlanListQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;

  @ApiPropertyOptional({ minLength: 1, maxLength: 150 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  search?: string;

  @ApiPropertyOptional({ enum: MasterPlanStatus })
  @IsOptional()
  @IsEnum(MasterPlanStatus)
  status?: MasterPlanStatus;

  @ApiPropertyOptional({ enum: MasterPlanType })
  @IsOptional()
  @IsEnum(MasterPlanType)
  type?: MasterPlanType;
}

export class BillingInvoiceListQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;

  @ApiPropertyOptional({ enum: BILLING_INVOICE_STATUS_FILTERS })
  @IsOptional()
  @IsString()
  @IsIn(BILLING_INVOICE_STATUS_FILTERS)
  @MaxLength(40)
  status?: string;
}

export class BillingProviderQueryDto {
  @ApiPropertyOptional({ enum: BillingProvider, default: BillingProvider.STRIPE })
  @IsOptional()
  @IsEnum(BillingProvider)
  provider?: BillingProvider;
}

export class PlanEntitlementDto {
  @ApiProperty({ enum: PlanEntitlementKind })
  @IsEnum(PlanEntitlementKind)
  kind!: PlanEntitlementKind;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  key!: string;

  @ApiProperty({ enum: PlanEntitlementValueType })
  @IsEnum(PlanEntitlementValueType)
  valueType!: PlanEntitlementValueType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  booleanValue?: boolean;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000_000_000_000)
  numericValue?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  unlimited?: boolean;
}

export class CreateMasterPlanDto {
  @ApiProperty({ minLength: 2, maxLength: 80, pattern: planKeyPattern.source })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  @Matches(planKeyPattern)
  key!: string;

  @ApiProperty({ minLength: 2, maxLength: 160 })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  displayName!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ enum: MasterPlanType, default: MasterPlanType.PUBLIC })
  @IsOptional()
  @IsEnum(MasterPlanType)
  type?: MasterPlanType;

  @ApiPropertyOptional({ minimum: 0, maximum: 1000, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  tierRank?: number;

  @ApiProperty({ type: [PlanEntitlementDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PlanEntitlementDto)
  entitlements!: PlanEntitlementDto[];
}

export class UpdateDraftPlanVersionDto {
  @ApiPropertyOptional({ minLength: 2, maxLength: 160 })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  displayName?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ enum: MasterPlanType })
  @IsOptional()
  @IsEnum(MasterPlanType)
  type?: MasterPlanType;

  @ApiPropertyOptional({ minimum: 0, maximum: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  tierRank?: number;

  @ApiPropertyOptional({ type: [PlanEntitlementDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PlanEntitlementDto)
  entitlements?: PlanEntitlementDto[];
}

export class CreateNextPlanVersionDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  fromVersionId?: string;
}

export class ManualProvisionSubscriptionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  superAgencyId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  planVersionId!: string;

  @ApiPropertyOptional({
    enum: [SuperAgencySubscriptionStatus.ACTIVE, SuperAgencySubscriptionStatus.TRIALING],
  })
  @IsOptional()
  @IsIn([SuperAgencySubscriptionStatus.ACTIVE, SuperAgencySubscriptionStatus.TRIALING])
  status?: SuperAgencySubscriptionStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  startTrial?: boolean;
}

export class CreateBillingPriceDto {
  @ApiProperty({ minimum: 1, maximum: 100_000_000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  amountMinor!: number;

  @ApiProperty({ enum: BillingInterval })
  @IsEnum(BillingInterval)
  interval!: BillingInterval;
}

export class ActivateTrialDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  superAgencyId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  planVersionId!: string;
}

export class CreateCheckoutSessionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  planVersionId!: string;

  @ApiProperty({ enum: BillingInterval })
  @IsEnum(BillingInterval)
  interval!: BillingInterval;
}

export class ChangeSubscriptionDto extends CreateCheckoutSessionDto {}

export class CancelSubscriptionDto {
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  immediate?: boolean;
}

export class BillingAgencyParamsDto extends BillingSuperAgencyParamsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  agencyId!: string;
}

export class BillingWorkspaceParamsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  agencyId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  workspaceId!: string;
}

export class AllocationUpdateDto {
  @ApiProperty({
    enum: [
      BILLING_RESOURCE_KEYS.workspaces,
      BILLING_RESOURCE_KEYS.workspaceMemberships,
      BILLING_RESOURCE_KEYS.storageBytes,
      BILLING_RESOURCE_KEYS.activeAutomations,
    ],
  })
  @IsIn([
    BILLING_RESOURCE_KEYS.workspaces,
    BILLING_RESOURCE_KEYS.workspaceMemberships,
    BILLING_RESOURCE_KEYS.storageBytes,
    BILLING_RESOURCE_KEYS.activeAutomations,
  ])
  resourceKey!:
    | typeof BILLING_RESOURCE_KEYS.workspaces
    | typeof BILLING_RESOURCE_KEYS.workspaceMemberships
    | typeof BILLING_RESOURCE_KEYS.storageBytes
    | typeof BILLING_RESOURCE_KEYS.activeAutomations;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000_000_000_000)
  allocated?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  unlimited?: boolean;
}
