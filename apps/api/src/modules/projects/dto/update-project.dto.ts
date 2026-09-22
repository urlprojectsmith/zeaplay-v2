import { ApiPropertyOptional } from '@nestjs/swagger';
import { ProjectVisibility, ProjectXpCategory, TaskPriority } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class UpdateProjectDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 160 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string;

  @ApiPropertyOptional({ maxLength: 1000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  statusDefinitionId?: string;

  @ApiPropertyOptional({ enum: TaskPriority })
  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @ApiPropertyOptional({ enum: ProjectXpCategory, nullable: true })
  @IsOptional()
  @IsEnum(ProjectXpCategory)
  xpCategory?: ProjectXpCategory | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  plannedStartAt?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  dueAt?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  departmentId?: string | null;

  @ApiPropertyOptional({ enum: ProjectVisibility })
  @IsOptional()
  @IsEnum(ProjectVisibility)
  visibility?: ProjectVisibility;
}

export class UpdateProjectStatusDto {
  @ApiPropertyOptional()
  @IsUUID()
  statusDefinitionId!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  dueAt?: string | null;
}

export class ProjectMembersDto {
  @ApiPropertyOptional({ type: [String], maxItems: 100 })
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  membershipIds!: string[];
}

export class ProjectTagIdsDto {
  @ApiPropertyOptional({ type: [String], maxItems: 50 })
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  tagIds!: string[];
}

export class ProjectTaskIdsDto {
  @ApiPropertyOptional({ type: [String], maxItems: 100 })
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  taskIds!: string[];
}

export class ProjectAttachmentIdsDto {
  @ApiPropertyOptional({ type: [String], maxItems: 100 })
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  attachmentIds!: string[];
}

export class CreateProjectUrlAttachmentDto {
  @ApiPropertyOptional({ maxLength: 2048 })
  @IsString()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  @MaxLength(2048)
  url!: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  displayName?: string;
}

export class UpdateProjectProgressDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 100, nullable: true })
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(0)
  @Max(100)
  manualProgressPercent!: number | null;
}

export class ProjectMemberQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Transform(({ value }) => Number(value ?? 1))
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @Transform(({ value }) => Number(value ?? 20))
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}

export class UpdateProjectOwnerDto {
  @ApiPropertyOptional()
  @IsUUID()
  workspaceMembershipId!: string;
}

export class ProjectActivityQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Transform(({ value }) => Number(value ?? 1))
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @Transform(({ value }) => Number(value ?? 20))
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  action?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class ProjectReportQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  statusDefinitionId?: string;

  @ApiPropertyOptional({ enum: TaskPriority })
  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assigneeMembershipId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  tagId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}
