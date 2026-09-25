import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AgencyStatus, WorkspaceStatus } from '@prisma/client';
import { Type } from 'class-transformer';
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
  MinLength,
} from 'class-validator';

export class AgencyManagementParamsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  superAgencyId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  agencyId!: string;
}

export class AgencyManagementListQueryDto {
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

  @ApiPropertyOptional({ enum: AgencyStatus })
  @IsOptional()
  @IsEnum(AgencyStatus)
  status?: AgencyStatus;

  @ApiPropertyOptional({ enum: ['NEWEST', 'OLDEST', 'NAME_ASC', 'NAME_DESC'] })
  @IsOptional()
  @IsIn(['NEWEST', 'OLDEST', 'NAME_ASC', 'NAME_DESC'])
  sort: 'NEWEST' | 'OLDEST' | 'NAME_ASC' | 'NAME_DESC' = 'NEWEST';
}

export class WorkspaceManagementListQueryDto {
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

  @ApiPropertyOptional({ enum: WorkspaceStatus })
  @IsOptional()
  @IsEnum(WorkspaceStatus)
  status?: WorkspaceStatus;

  @ApiPropertyOptional({ enum: ['NEWEST', 'OLDEST', 'NAME_ASC', 'NAME_DESC'] })
  @IsOptional()
  @IsIn(['NEWEST', 'OLDEST', 'NAME_ASC', 'NAME_DESC'])
  sort: 'NEWEST' | 'OLDEST' | 'NAME_ASC' | 'NAME_DESC' = 'NEWEST';
}
