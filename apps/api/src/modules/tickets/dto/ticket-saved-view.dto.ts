import { ApiPropertyOptional } from '@nestjs/swagger';
import { TicketSavedViewScope } from '@prisma/client';
import { IsEnum, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class TicketSavedViewDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsEnum(TicketSavedViewScope)
  scope!: TicketSavedViewScope;

  @IsObject()
  filters!: Record<string, unknown>;

  @IsObject()
  sort!: Record<string, unknown>;
}

export class UpdateTicketSavedViewDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  filters?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  sort?: Record<string, unknown>;
}
