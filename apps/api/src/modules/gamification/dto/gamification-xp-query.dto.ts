import { ApiPropertyOptional } from '@nestjs/swagger';
import { GamificationXpEntryType, GamificationXpSourceType } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

export class GamificationXpHistoryQueryDto {
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

  @ApiPropertyOptional({ enum: GamificationXpEntryType })
  @IsOptional()
  @IsEnum(GamificationXpEntryType)
  entryType?: GamificationXpEntryType;

  @ApiPropertyOptional({ enum: GamificationXpSourceType })
  @IsOptional()
  @IsEnum(GamificationXpSourceType)
  sourceType?: GamificationXpSourceType;
}
