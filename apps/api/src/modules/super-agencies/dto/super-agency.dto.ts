import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SuperAgencyStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Max,
  MinLength,
  Min,
} from 'class-validator';

export class SuperAgencyParamsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  superAgencyId!: string;
}

export class CreateSuperAgencyDto {
  @ApiProperty({ minLength: 2, maxLength: 160 })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @ApiProperty({ minLength: 2, maxLength: 120, pattern: '^[a-z0-9-]+$' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Matches(/^[a-z0-9-]+$/)
  slug!: string;
}

export class UpdateSuperAgencyDto {
  @ApiPropertyOptional({ minLength: 2, maxLength: 160 })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name?: string;

  @ApiPropertyOptional({ enum: SuperAgencyStatus })
  @IsOptional()
  @IsEnum(SuperAgencyStatus)
  status?: SuperAgencyStatus;
}

export class SuperAgencyListQueryDto {
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

  @ApiPropertyOptional({ minLength: 1, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ enum: SuperAgencyStatus })
  @IsOptional()
  @IsEnum(SuperAgencyStatus)
  status?: SuperAgencyStatus;
}
