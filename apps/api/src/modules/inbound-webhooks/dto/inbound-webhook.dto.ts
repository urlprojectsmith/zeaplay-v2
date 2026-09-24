import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { INBOUND_WEBHOOK_SOURCE_TYPES } from '../inbound-webhooks.constants';

export class CreateInboundWebhookSourceDto {
  @ApiProperty({ minLength: 1, maxLength: 100 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ enum: INBOUND_WEBHOOK_SOURCE_TYPES, default: 'GENERIC_HMAC_V1' })
  @IsIn(INBOUND_WEBHOOK_SOURCE_TYPES)
  type = 'GENERIC_HMAC_V1' as const;
}

export class UpdateInboundWebhookSourceDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: 100 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ maxLength: 500, nullable: true })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;
}

export class InboundWebhookListQueryDto {
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
}

export class InboundWebhookSourceParamDto {
  @ApiProperty()
  @IsString()
  sourceId!: string;
}

export class InboundWebhookPublicParamDto {
  @ApiProperty()
  @IsString()
  @MaxLength(80)
  publicId!: string;
}

export class InboundWebhookEventParamDto {
  @ApiProperty()
  @IsString()
  eventId!: string;
}
