import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { DocAccessRole, DocStatus, DocType, DocVisibility } from '@prisma/client';

export class DocListQueryDto {
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  folderId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  parentDocId?: string;

  @ApiPropertyOptional({ enum: DocStatus })
  @IsOptional()
  @IsEnum(DocStatus)
  status: DocStatus = DocStatus.ACTIVE;

  @ApiPropertyOptional({ enum: DocType })
  @IsOptional()
  @IsEnum(DocType)
  type?: DocType;
}

export class CreateFolderDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsUUID()
  parentFolderId?: string | null;
}

export class UpdateFolderDto extends CreateFolderDto {}

export class MemberAccessDto {
  @IsUUID()
  membershipId!: string;

  @IsOptional()
  @IsEnum(DocAccessRole)
  role: DocAccessRole = DocAccessRole.VIEWER;
}

export class CreateDocDto {
  @IsString()
  @MinLength(1)
  @MaxLength(220)
  title!: string;

  @IsObject()
  content!: Record<string, unknown>;

  @IsOptional()
  @IsUUID()
  folderId?: string | null;

  @IsOptional()
  @IsUUID()
  parentDocId?: string | null;

  @IsOptional()
  @IsEnum(DocVisibility)
  visibility: DocVisibility = DocVisibility.WORKSPACE;

  @IsOptional()
  @IsEnum(DocType)
  type: DocType = DocType.PAGE;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => MemberAccessDto)
  access?: MemberAccessDto[];
}

export class UpdateDocDto {
  @IsInt()
  @Min(1)
  expectedRevision!: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(220)
  title?: string;

  @IsOptional()
  @IsObject()
  content?: Record<string, unknown>;

  @IsOptional()
  @IsEnum(DocVisibility)
  visibility?: DocVisibility;

  @IsOptional()
  @IsUUID()
  folderId?: string | null;

  @IsOptional()
  @IsUUID()
  parentDocId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class ReplaceDocAccessDto {
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => MemberAccessDto)
  members!: MemberAccessDto[];
}

export class CreateDocFromTemplateDto {
  @IsUUID()
  templateId!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(220)
  title?: string;

  @IsOptional()
  @IsUUID()
  folderId?: string | null;
}

export class CreateCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;

  @IsOptional()
  @IsUUID()
  parentCommentId?: string;

  @IsOptional()
  @IsObject()
  anchor?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID(undefined, { each: true })
  mentionMembershipIds?: string[];
}

export class UpdateCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;
}

export class AttachAssetDto {
  @IsUUID()
  assetId!: string;
}

export class CreateShareDto {
  @IsOptional()
  @IsISO8601()
  expiresAt?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password?: string | null;
}

export class VerifySharePasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;
}

export class PublicShareQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  access?: string;
}

export class ParentDocsQueryDto extends DocListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  agencyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  workspaceId?: string;
}

export class DocParamsDto {
  @IsUUID()
  docId!: string;
}

export class FolderParamsDto {
  @IsUUID()
  folderId!: string;
}

export class VersionParamsDto {
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  revision!: number;
}

export class CommentParamsDto {
  @IsUUID()
  commentId!: string;
}

export class AttachmentParamsDto {
  @IsUUID()
  attachmentId!: string;
}

export class ShareParamsDto {
  @IsUUID()
  shareId!: string;
}

export class FavoriteDto {
  @IsBoolean()
  favorite!: boolean;
}
