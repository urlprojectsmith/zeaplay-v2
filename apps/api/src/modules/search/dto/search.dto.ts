import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const searchResultTypes = [
  'TASK',
  'PROJECT',
  'TICKET',
  'DOC',
  'FORM',
  'GOAL',
  'FILE',
  'MEMBER',
  'AUTOMATION',
  'API_KEY',
  'WEBHOOK',
  'INTEGRATION',
  'BILLING_METADATA',
  'SUPER_AGENCY',
  'AGENCY',
  'WORKSPACE',
] as const;

export const searchScopeTypes = ['WORKSPACE', 'AGENCY', 'SUPER_AGENCY', 'PLATFORM'] as const;

export type SearchResultTypeKey = (typeof searchResultTypes)[number];
export type SearchScopeTypeKey = (typeof searchScopeTypes)[number];

export class SearchQueryDto {
  @ApiPropertyOptional()
  @IsString()
  @MaxLength(160)
  q!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) =>
    Array.isArray(value)
      ? value
      : String(value ?? '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
  )
  @IsArray()
  @ArrayMaxSize(8)
  @IsIn(searchResultTypes, { each: true })
  types?: SearchResultTypeKey[];

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => Number(value ?? 1))
  @IsInt()
  @Min(1)
  @Max(20)
  page?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => Number(value ?? 20))
  @IsInt()
  @Min(1)
  @Max(25)
  pageSize?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeArchived?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  saveRecent?: boolean;
}

export class SearchRebuildDto {
  @IsOptional()
  @Transform(({ value }) =>
    Array.isArray(value)
      ? value
      : String(value ?? '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
  )
  @IsArray()
  @ArrayMaxSize(16)
  @IsIn(searchResultTypes, { each: true })
  types?: SearchResultTypeKey[];
}
