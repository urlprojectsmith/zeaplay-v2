import { ApiPropertyOptional } from '@nestjs/swagger';
import { AssetLifecycle, AssetStatus } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Max,
  Min,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export const fileSourceModules = ['TASK', 'PROJECT', 'TICKET', 'GENERAL'] as const;
export const fileCategories = [
  'IMAGE',
  'PDF',
  'DOCUMENT',
  'SPREADSHEET',
  'ARCHIVE',
  'OTHER',
] as const;
export const workspaceFileSorts = [
  'NEWEST',
  'OLDEST',
  'NAME_ASC',
  'NAME_DESC',
  'SIZE_ASC',
  'SIZE_DESC',
] as const;
export const workspaceFileBulkActions = ['ARCHIVE', 'DELETE', 'RESTORE'] as const;

export class WorkspaceFileUploadInitDto {
  @IsString()
  @MaxLength(255)
  filename!: string;

  @IsString()
  @MaxLength(160)
  mimeType!: string;

  @IsInt()
  @Min(1)
  sizeBytes!: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  displayName?: string;

  @ApiPropertyOptional({ enum: fileSourceModules })
  @IsOptional()
  @IsIn(fileSourceModules)
  sourceModule?: (typeof fileSourceModules)[number];

  @IsOptional()
  @IsString()
  @MaxLength(80)
  sourceEntityType?: string;

  @IsOptional()
  @IsUUID()
  sourceEntityId?: string;
}

export class WorkspaceFileCompleteDto {
  @IsInt()
  @Min(1)
  sizeBytes!: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  checksum?: string;
}

export class WorkspaceFileQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  declare search?: string;

  @ApiPropertyOptional({ enum: AssetLifecycle })
  @IsOptional()
  @IsEnum(AssetLifecycle)
  lifecycle?: AssetLifecycle;

  @ApiPropertyOptional({ enum: AssetStatus })
  @IsOptional()
  @IsEnum(AssetStatus)
  status?: AssetStatus;

  @ApiPropertyOptional({ enum: fileSourceModules })
  @IsOptional()
  @IsIn(fileSourceModules)
  sourceModule?: (typeof fileSourceModules)[number];

  @IsOptional()
  @IsString()
  @MaxLength(80)
  sourceEntityType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  mimeType?: string;

  @ApiPropertyOptional({ enum: fileCategories })
  @IsOptional()
  @IsIn(fileCategories)
  category?: (typeof fileCategories)[number];

  @IsOptional()
  @IsUUID()
  uploader?: string;

  @IsOptional()
  @IsDateString()
  createdFrom?: string;

  @IsOptional()
  @IsDateString()
  createdTo?: string;

  @ApiPropertyOptional({ enum: workspaceFileSorts })
  @IsOptional()
  @IsIn(workspaceFileSorts)
  sort?: (typeof workspaceFileSorts)[number];
}

export class WorkspaceFileBulkActionDto {
  @ApiPropertyOptional({ enum: workspaceFileBulkActions })
  @IsIn(workspaceFileBulkActions)
  action!: (typeof workspaceFileBulkActions)[number];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  fileIds!: string[];
}

export class StorageRetentionPolicyUpdateDto {
  @IsInt()
  @Min(1)
  @Max(365)
  deleteGraceDays!: number;
}
