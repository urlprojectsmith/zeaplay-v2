import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
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

export const accountContextTargetTypes = ['SUPER_AGENCY', 'AGENCY', 'WORKSPACE'] as const;
export type AccountContextTargetType = (typeof accountContextTargetTypes)[number];

export class AccountContextListQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize = 25;

  @ApiPropertyOptional({ minLength: 1, maxLength: 150 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  search?: string;
}

export class AccountContextAgencyQueryDto extends AccountContextListQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  superAgencyId!: string;
}

export class AccountContextSubaccountQueryDto extends AccountContextListQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  agencyId!: string;
}

export class SwitchAccountContextDto {
  @ApiProperty({ enum: accountContextTargetTypes })
  @IsIn(accountContextTargetTypes)
  targetType!: AccountContextTargetType;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  targetId!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  agencyId?: string;

  @ApiPropertyOptional({ enum: accountContextTargetTypes })
  @IsOptional()
  @IsIn(accountContextTargetTypes)
  sourceType?: AccountContextTargetType;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  sourceId?: string;
}

export class ReturnAccountContextDto {
  @ApiProperty({ enum: ['SUPER_AGENCY', 'AGENCY'] })
  @IsIn(['SUPER_AGENCY', 'AGENCY'])
  targetType!: Exclude<AccountContextTargetType, 'WORKSPACE'>;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  targetId!: string;

  @ApiPropertyOptional({ enum: accountContextTargetTypes })
  @IsOptional()
  @IsIn(accountContextTargetTypes)
  sourceType?: AccountContextTargetType;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  sourceId?: string;
}
