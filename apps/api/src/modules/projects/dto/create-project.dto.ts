import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProjectVisibility, ProjectXpCategory, TaskPriority } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateProjectDto {
  @ApiProperty({ minLength: 1, maxLength: 160 })
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  statusDefinitionId?: string;

  @ApiPropertyOptional({ enum: TaskPriority, default: TaskPriority.MEDIUM })
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  ownerMembershipId?: string;

  @ApiPropertyOptional({ enum: ProjectVisibility, default: ProjectVisibility.WORKSPACE })
  @IsOptional()
  @IsEnum(ProjectVisibility)
  visibility?: ProjectVisibility;

  @ApiPropertyOptional({ type: [String], maxItems: 100 })
  @IsOptional()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  memberMembershipIds?: string[];
}
