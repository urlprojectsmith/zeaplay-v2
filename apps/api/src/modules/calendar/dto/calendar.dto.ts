import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CalendarEventVisibility, CalendarSourceType, TaskPriority } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

function arrayValue(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined;
  return Array.isArray(value) ? value : [value];
}

export class CalendarQueryDto {
  @ApiProperty()
  @IsDateString()
  from!: string;

  @ApiProperty()
  @IsDateString()
  to!: string;

  @ApiPropertyOptional({ enum: CalendarSourceType, isArray: true })
  @IsOptional()
  @Transform(({ value }) => arrayValue(value))
  @IsArray()
  @ArrayUnique()
  @IsEnum(CalendarSourceType, { each: true })
  sourceTypes?: CalendarSourceType[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @Transform(({ value }) => arrayValue(value))
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  memberIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @Transform(({ value }) => arrayValue(value))
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  departmentIds?: string[];

  @ApiPropertyOptional({ enum: TaskPriority, isArray: true })
  @IsOptional()
  @Transform(({ value }) => arrayValue(value))
  @IsArray()
  @ArrayUnique()
  @IsEnum(TaskPriority, { each: true })
  priorities?: TaskPriority[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @Transform(({ value }) => arrayValue(value))
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  statuses?: string[];
}

export class CalendarEventParamsDto {
  @ApiProperty()
  @IsUUID()
  workspaceId!: string;

  @ApiProperty()
  @IsUUID()
  eventId!: string;
}

export class CreateCalendarEventDto {
  @ApiProperty({ minLength: 1, maxLength: 160 })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiProperty()
  @IsDateString()
  startAt!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endAt?: string | null;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  allDay?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  timezone?: string | null;

  @ApiPropertyOptional({ enum: CalendarEventVisibility })
  @IsOptional()
  @IsEnum(CalendarEventVisibility)
  visibility?: CalendarEventVisibility;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  ownerMembershipId?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  participantMembershipIds?: string[];
}

export class UpdateCalendarEventDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 160 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startAt?: string;

  @ApiPropertyOptional()
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsDateString()
  endAt?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  allDay?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  timezone?: string | null;

  @ApiPropertyOptional({ enum: CalendarEventVisibility })
  @IsOptional()
  @IsEnum(CalendarEventVisibility)
  visibility?: CalendarEventVisibility;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  ownerMembershipId?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  participantMembershipIds?: string[];
}
