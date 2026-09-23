import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AutomationDomainEventEntityType,
  AutomationExecutionStatus,
  AutomationTriggerMatchStatus,
  AutomationTriggerType,
  AutomationWorkflowStatus,
} from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class AutomationWorkflowParamsDto {
  @ApiProperty()
  @IsUUID()
  workspaceId!: string;

  @ApiProperty()
  @IsUUID()
  workflowId!: string;
}

export class AutomationWorkflowVersionParamsDto extends AutomationWorkflowParamsDto {
  @ApiProperty()
  @IsUUID()
  versionId!: string;
}

export class AutomationWorkflowTemplateParamsDto {
  @ApiProperty()
  @IsUUID()
  workspaceId!: string;

  @ApiProperty()
  @IsUUID()
  templateId!: string;
}

export class AutomationWorkflowQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: AutomationWorkflowStatus })
  @IsOptional()
  @IsEnum(AutomationWorkflowStatus)
  status?: AutomationWorkflowStatus;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(({ value }) => value === 'true')
  includeArchived?: boolean;
}

export class AutomationVersionQueryDto extends PaginationDto {}

export class AutomationTemplateQueryDto extends PaginationDto {
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(({ value }) => value === 'true')
  includeArchived?: boolean;
}

export class AutomationDomainEventQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: AutomationTriggerType })
  @IsOptional()
  @IsEnum(AutomationTriggerType)
  eventType?: AutomationTriggerType;

  @ApiPropertyOptional({ enum: AutomationDomainEventEntityType })
  @IsOptional()
  @IsEnum(AutomationDomainEventEntityType)
  entityType?: AutomationDomainEventEntityType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  entityId?: string;
}

export class AutomationDomainEventParamsDto {
  @ApiProperty()
  @IsUUID()
  workspaceId!: string;

  @ApiProperty()
  @IsUUID()
  eventId!: string;
}

export class AutomationTriggerMatchQueryDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  domainEventId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  workflowId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  workflowVersionId?: string;

  @ApiPropertyOptional({ enum: AutomationTriggerMatchStatus })
  @IsOptional()
  @IsEnum(AutomationTriggerMatchStatus)
  status?: AutomationTriggerMatchStatus;
}

export class AutomationExecutionQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: AutomationExecutionStatus })
  @IsOptional()
  @IsEnum(AutomationExecutionStatus)
  status?: AutomationExecutionStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  workflowId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  workflowVersionId?: string;

  @ApiPropertyOptional({ enum: AutomationTriggerType })
  @IsOptional()
  @IsEnum(AutomationTriggerType)
  eventType?: AutomationTriggerType;

  @ApiPropertyOptional({ enum: AutomationDomainEventEntityType })
  @IsOptional()
  @IsEnum(AutomationDomainEventEntityType)
  entityType?: AutomationDomainEventEntityType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  correlationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  @IsString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  @IsString()
  to?: string;
}

export class AutomationExecutionParamsDto {
  @ApiProperty()
  @IsUUID()
  workspaceId!: string;

  @ApiProperty()
  @IsUUID()
  executionId!: string;
}

export class ReplayAutomationExecutionDto {
  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  @ApiProperty({ enum: ['REPLAY'] })
  @IsString()
  @MinLength(6)
  @MaxLength(6)
  confirmation!: 'REPLAY';

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(120)
  @Matches(/^[A-Za-z0-9:_-]+$/)
  idempotencyKey!: string;
}

export class UpdateAutomationRuntimePolicyDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(500)
  maxPublishedWorkflows!: number;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(5000)
  maxExecutionsPerMinute!: number;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(1000)
  maxConcurrentExecutions!: number;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(100)
  maxActionsPerExecution!: number;

  @ApiProperty()
  @IsInt()
  @Min(1)
  @Max(500)
  maxReplaysPerHour!: number;
}

export class CreateAutomationWorkflowDto {
  @ApiProperty({ minLength: 2, maxLength: 120 })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ maxLength: 500, nullable: true })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  trigger?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [Object] })
  @IsOptional()
  @IsArray()
  nodes?: Record<string, unknown>[];

  @ApiPropertyOptional({ type: [Object] })
  @IsOptional()
  @IsArray()
  edges?: Record<string, unknown>[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}

export class UpdateAutomationWorkflowDto {
  @ApiPropertyOptional({ minLength: 2, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ maxLength: 500, nullable: true })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(500)
  description?: string | null;
}

export class UpdateAutomationDraftDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  trigger?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [Object] })
  @IsOptional()
  @IsArray()
  nodes?: Record<string, unknown>[];

  @ApiPropertyOptional({ type: [Object] })
  @IsOptional()
  @IsArray()
  edges?: Record<string, unknown>[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedUpdatedAtMs?: number;
}

export class CloneAutomationWorkflowDto {
  @ApiPropertyOptional({ minLength: 2, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sourceVersionId?: string;
}

export class CreateAutomationTemplateDto {
  @ApiProperty({ minLength: 2, maxLength: 120 })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ maxLength: 500, nullable: true })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiProperty()
  @IsUUID()
  sourceWorkflowId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sourceWorkflowVersionId?: string;
}

export class UseAutomationTemplateDto {
  @ApiPropertyOptional({ minLength: 2, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ maxLength: 500, nullable: true })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(500)
  description?: string | null;
}
