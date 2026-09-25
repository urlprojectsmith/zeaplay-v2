import { ApiPropertyOptional } from '@nestjs/swagger';
import { TaskPriority } from '@prisma/client';
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
  MaxLength,
  Min,
} from 'class-validator';

export class ParentOversightBaseQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Transform(({ value }) => Number(value ?? 1))
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 100 })
  @Transform(({ value }) => Number(value ?? 25))
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  agencyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  workspaceId?: string;

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
  departmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  createdFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  createdTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  updatedFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  updatedTo?: string;
}

export class ParentTaskOversightQueryDto extends ParentOversightBaseQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assigneeMembershipId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueTo?: string;

  @ApiPropertyOptional({ enum: ['createdAt', 'updatedAt', 'dueAt', 'title', 'priority'] })
  @IsOptional()
  @IsIn(['createdAt', 'updatedAt', 'dueAt', 'title', 'priority'])
  sortBy: 'createdAt' | 'updatedAt' | 'dueAt' | 'title' | 'priority' = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection: 'asc' | 'desc' = 'desc';
}

export class ParentProjectOversightQueryDto extends ParentOversightBaseQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  ownerMembershipId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  plannedFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  plannedTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueTo?: string;

  @ApiPropertyOptional({
    enum: ['createdAt', 'updatedAt', 'name', 'plannedStartAt', 'dueAt', 'priority'],
  })
  @IsOptional()
  @IsIn(['createdAt', 'updatedAt', 'name', 'plannedStartAt', 'dueAt', 'priority'])
  sortBy: 'createdAt' | 'updatedAt' | 'name' | 'plannedStartAt' | 'dueAt' | 'priority' =
    'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection: 'asc' | 'desc' = 'desc';
}

export class ParentTicketOversightQueryDto extends ParentOversightBaseQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assignedToMembershipId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  slaDueFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  slaDueTo?: string;

  @ApiPropertyOptional({ enum: ['createdAt', 'updatedAt', 'ticketNumber', 'priority'] })
  @IsOptional()
  @IsIn(['createdAt', 'updatedAt', 'ticketNumber', 'priority'])
  sortBy: 'createdAt' | 'updatedAt' | 'ticketNumber' | 'priority' = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDirection: 'asc' | 'desc' = 'desc';
}
