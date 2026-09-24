import { ApiPropertyOptional } from '@nestjs/swagger';
import { CloudDriveProvider } from '@prisma/client';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export const cloudDriveProviderValues = [
  CloudDriveProvider.GOOGLE_DRIVE,
  CloudDriveProvider.ONEDRIVE,
  CloudDriveProvider.DROPBOX,
] as const;

export class CloudProviderParamDto {
  @IsIn(cloudDriveProviderValues)
  provider!: CloudDriveProvider;
}

export class CloudConnectDto {
  @IsOptional()
  @IsString()
  @MaxLength(512)
  redirectPath?: string;
}

export class CloudOAuthCallbackDto {
  @IsString()
  @MaxLength(2048)
  code!: string;

  @IsString()
  @MaxLength(256)
  state!: string;
}

export class CloudListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  folderId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  cursor?: string;

  @ApiPropertyOptional({ default: 50, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 50;
}

export class CloudConnectionParamDto {
  @IsUUID()
  id!: string;
}

export class CloudImportDto {
  @IsString()
  @MaxLength(512)
  providerFileId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  idempotencyKey?: string;
}

export class CloudExportDto {
  @IsUUID()
  assetId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  destinationFolderId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  filename?: string;
}
