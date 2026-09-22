import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class GamificationLevelQueryDto {
  @ApiPropertyOptional({ default: false })
  @Transform(({ value }) => value === true || value === 'true')
  @IsOptional()
  @IsBoolean()
  includeInactive?: boolean;
}

export class CreateGamificationLevelDto {
  @IsString()
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(1000)
  levelNumber!: number;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  xpThreshold!: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateGamificationLevelDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(1000)
  levelNumber?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  xpThreshold?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
