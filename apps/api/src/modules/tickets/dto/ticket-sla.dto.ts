import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TaskPriority, TicketSlaBusinessMode } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
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
  ValidateNested,
} from 'class-validator';
import { MAX_SLA_TARGET_MINUTES } from '../ticket-sla-business-time';

export class TicketSlaRuleDto {
  @ApiProperty({ enum: TaskPriority })
  @IsEnum(TaskPriority)
  priority!: TaskPriority;

  @ApiProperty({ minimum: 1, maximum: MAX_SLA_TARGET_MINUTES })
  @IsInt()
  @Min(1)
  @Max(MAX_SLA_TARGET_MINUTES)
  firstResponseMinutes!: number;

  @ApiProperty({ minimum: 1, maximum: MAX_SLA_TARGET_MINUTES })
  @IsInt()
  @Min(1)
  @Max(MAX_SLA_TARGET_MINUTES)
  resolutionMinutes!: number;
}

export class TicketSlaPauseStatusDto {
  @ApiProperty()
  @IsUUID()
  statusDefinitionId!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  pauseFirstResponse?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  pauseResolution?: boolean;
}

export class TicketSlaPolicyDto {
  @ApiProperty({ maxLength: 160 })
  @IsString()
  @MaxLength(160)
  name!: string;

  @ApiPropertyOptional({ maxLength: 500, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiProperty()
  @IsString()
  @MaxLength(80)
  timezone!: string;

  @ApiPropertyOptional({ enum: TicketSlaBusinessMode })
  @IsOptional()
  @IsEnum(TicketSlaBusinessMode)
  businessMode?: TicketSlaBusinessMode;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  businessHours?: Record<string, Array<{ start: string; end: string }>>;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { each: true })
  holidayDates?: string[];

  @ApiProperty({ type: [TicketSlaRuleDto] })
  @IsArray()
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => TicketSlaRuleDto)
  rules!: TicketSlaRuleDto[];

  @ApiPropertyOptional({ type: [TicketSlaPauseStatusDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => TicketSlaPauseStatusDto)
  pauseStatuses?: TicketSlaPauseStatusDto[];
}

export class UpdateTicketSlaPolicyDto extends TicketSlaPolicyDto {}
