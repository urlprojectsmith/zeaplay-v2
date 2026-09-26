import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { FormStatus, FormType } from '@prisma/client';

export class FormListQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Transform(({ value }) => Number(value ?? 1))
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 30, minimum: 1, maximum: 100 })
  @Transform(({ value }) => Number(value ?? 30))
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 30;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  search?: string;

  @ApiPropertyOptional({ enum: FormStatus })
  @IsOptional()
  @IsEnum(FormStatus)
  status?: FormStatus;

  @ApiPropertyOptional({ enum: FormType })
  @IsOptional()
  @IsEnum(FormType)
  type?: FormType;
}

export class CreateFormDto {
  @IsString()
  @MinLength(1)
  @MaxLength(220)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsObject()
  schema!: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;

  @IsOptional()
  @IsEnum(FormType)
  type: FormType = FormType.FORM;
}

export class UpdateFormDraftDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(220)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsObject()
  schema!: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}

export class PublishFormDto {
  @IsOptional()
  @IsBoolean()
  publicEnabled?: boolean;
}

export class CreateFormFromTemplateDto {
  @IsUUID()
  templateId!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(220)
  title?: string;
}

export class SubmitFormDto {
  @IsObject()
  answers!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  idempotencyKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  captchaToken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  honeypot?: string;
}

export class AuthorizePublicFormUploadDto {
  @IsString()
  @MaxLength(80)
  fieldId!: string;

  @IsInt()
  @Min(1)
  formVersionNumber!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  filename!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(160)
  mimeType!: string;

  @IsInt()
  @Min(1)
  sizeBytes!: number;
}

export class CompletePublicFormUploadDto {
  @IsString()
  @MaxLength(80)
  fieldId!: string;

  @IsInt()
  @Min(1)
  formVersionNumber!: number;

  @IsUUID()
  assetId!: string;

  @IsString()
  @MinLength(32)
  @MaxLength(256)
  uploadToken!: string;

  @IsInt()
  @Min(1)
  sizeBytes!: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  checksum?: string;
}

export class ParentFormsQueryDto extends FormListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  agencyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  workspaceId?: string;
}

export class FormParamsDto {
  @IsUUID()
  formId!: string;
}

export class SubmissionParamsDto extends FormParamsDto {
  @IsUUID()
  submissionId!: string;
}

export class AssetAnswerDto {
  @IsString()
  @MaxLength(80)
  fieldId!: string;

  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID(undefined, { each: true })
  assetIds!: string[];
}
