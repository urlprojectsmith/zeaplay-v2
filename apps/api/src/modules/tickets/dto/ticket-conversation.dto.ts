import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TicketConversationEntryType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class TicketConversationQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Transform(({ value }) => Number(value ?? 1))
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @Transform(({ value }) => Number(value ?? 20))
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize = 20;
}

export class CreateTicketConversationEntryDto {
  @ApiProperty({ enum: TicketConversationEntryType })
  @IsEnum(TicketConversationEntryType)
  type!: TicketConversationEntryType;

  @ApiProperty({ minLength: 1, maxLength: 12000 })
  @IsString()
  @MaxLength(12000)
  body!: string;

  @ApiPropertyOptional({ type: [String], maxItems: 10 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  attachmentIds?: string[];
}
