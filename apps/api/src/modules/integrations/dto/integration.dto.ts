import { IntegrationAuthType, IntegrationProvider, IntegrationStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class IntegrationIdParamDto {
  @IsUUID()
  integrationId!: string;
}

export class IntegrationProviderParamDto {
  @IsEnum(IntegrationProvider)
  provider!: IntegrationProvider;
}

export class IntegrationCapabilityParamDto extends IntegrationIdParamDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  capability!: string;
}

export class IntegrationListQueryDto {
  @IsOptional()
  @IsEnum(IntegrationProvider)
  provider?: IntegrationProvider;

  @IsOptional()
  @IsEnum(IntegrationStatus)
  status?: IntegrationStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class CreateIntegrationConnectionDto {
  @IsEnum(IntegrationProvider)
  provider!: IntegrationProvider;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsEnum(IntegrationAuthType)
  authType!: IntegrationAuthType;

  @IsObject()
  credentials!: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  configuration?: Record<string, unknown>;
}

export class UpdateIntegrationConnectionDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsObject()
  configuration?: Record<string, unknown>;
}

export class ExecuteIntegrationActionDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  idempotencyKey?: string;

  @IsOptional()
  @IsObject()
  input?: Record<string, unknown>;
}

export class StartIntegrationOAuthDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  redirectPath?: string;
}
