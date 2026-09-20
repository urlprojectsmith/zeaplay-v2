import { ApiPropertyOptional } from '@nestjs/swagger';
import { TaskPriority } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
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

export const ticketBuiltInQueues = [
  'ALL_VISIBLE',
  'MY_ASSIGNED',
  'MY_REQUESTED',
  'MY_DEPARTMENT',
  'UNASSIGNED_MY_DEPARTMENT',
  'SLA_BREACHED',
] as const;

export const assignmentStates = ['ANY', 'ASSIGNED', 'UNASSIGNED'] as const;
export const requesterTypeFilters = ['INTERNAL', 'EXTERNAL', 'UNSET'] as const;
export const slaMetrics = ['ANY', 'FIRST_RESPONSE', 'RESOLUTION'] as const;
export const slaStates = [
  'NOT_CONFIGURED',
  'RUNNING',
  'PAUSED',
  'MET',
  'BREACHED',
  'NOT_APPLICABLE',
] as const;

export type TicketBuiltInQueue = (typeof ticketBuiltInQueues)[number];
export type AssignmentState = (typeof assignmentStates)[number];
export type RequesterTypeFilter = (typeof requesterTypeFilters)[number];
export type TicketSlaMetricFilter = (typeof slaMetrics)[number];
export type TicketSlaStateFilter = (typeof slaStates)[number];

export class TicketQueryDto {
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  statusDefinitionId?: string;

  @ApiPropertyOptional({ enum: TaskPriority })
  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @ApiPropertyOptional({ enum: ticketBuiltInQueues })
  @IsOptional()
  @IsIn(ticketBuiltInQueues)
  queue?: TicketBuiltInQueue;

  @ApiPropertyOptional({ enum: requesterTypeFilters })
  @IsOptional()
  @IsIn(requesterTypeFilters)
  requesterType?: RequesterTypeFilter;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  internalRequesterMembershipId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assignedToMembershipId?: string;

  @ApiPropertyOptional({ enum: assignmentStates })
  @IsOptional()
  @IsIn(assignmentStates)
  assignmentState?: AssignmentState;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  createdFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  createdTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  updatedFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  updatedTo?: string;

  @ApiPropertyOptional({ enum: slaMetrics })
  @IsOptional()
  @IsIn(slaMetrics)
  slaMetric?: TicketSlaMetricFilter;

  @ApiPropertyOptional({ enum: slaStates })
  @IsOptional()
  @IsIn(slaStates)
  slaState?: TicketSlaStateFilter;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  slaDueFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
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
