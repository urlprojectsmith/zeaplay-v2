import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { WEBHOOK_EVENT_TYPES } from '../webhooks.constants';

export class CreateWebhookSubscriptionDto {
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

  @ApiProperty({ maxLength: 2048 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsUrl({ require_protocol: true, protocols: ['https', 'http'] })
  @MaxLength(2048)
  endpointUrl!: string;

  @ApiProperty({ enum: WEBHOOK_EVENT_TYPES, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(WEBHOOK_EVENT_TYPES.length)
  @ArrayUnique()
  @IsIn(WEBHOOK_EVENT_TYPES, { each: true })
  eventTypes!: string[];
}

export class UpdateWebhookSubscriptionDto {
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

  @ApiPropertyOptional({ maxLength: 2048 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['https', 'http'] })
  @MaxLength(2048)
  endpointUrl?: string;

  @ApiPropertyOptional({ enum: WEBHOOK_EVENT_TYPES, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(WEBHOOK_EVENT_TYPES.length)
  @ArrayUnique()
  @IsIn(WEBHOOK_EVENT_TYPES, { each: true })
  eventTypes?: string[];
}

export class WebhookListQueryDto {
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

export class WebhookDeliveryListQueryDto extends WebhookListQueryDto {}

export class WebhookSubscriptionIdParamDto {
  @ApiProperty()
  @IsString()
  webhookId!: string;
}

export class WebhookDeliveryIdParamDto {
  @ApiProperty()
  @IsString()
  deliveryId!: string;
}
