import { ApiPropertyOptional } from '@nestjs/swagger';
import { TaskPriority, TicketEscalationLevel } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { TicketRequesterDto } from './create-ticket.dto';

export class UpdateTicketDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 200 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  subject?: string;

  @ApiPropertyOptional({ maxLength: 4000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  statusDefinitionId?: string;

  @ApiPropertyOptional({ enum: TaskPriority })
  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  gamificationResolutionTargetAt?: string | null;
}

export class UpdateTicketStatusDto {
  @ApiPropertyOptional()
  @IsUUID()
  statusDefinitionId!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  gamificationResolutionTargetAt?: string | null;
}

export class UpdateTicketRequesterDto {
  @ValidateNested()
  @Type(() => TicketRequesterDto)
  requester!: TicketRequesterDto;
}

export class UpdateTicketAssignmentDto {
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  departmentId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  assignedToMembershipId?: string | null;
}

export class ClaimTicketDto {}

export const ticketEscalationActions = ['ESCALATE', 'DEESCALATE', 'CLEAR'] as const;
export type TicketEscalationAction = (typeof ticketEscalationActions)[number];

export class UpdateTicketEscalationDto {
  @ApiPropertyOptional({ enum: ticketEscalationActions })
  @IsIn(ticketEscalationActions)
  action!: TicketEscalationAction;

  @ApiPropertyOptional({ enum: TicketEscalationLevel })
  @IsEnum(TicketEscalationLevel)
  expectedLevel!: TicketEscalationLevel;

  @ApiPropertyOptional({ minLength: 1, maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}
