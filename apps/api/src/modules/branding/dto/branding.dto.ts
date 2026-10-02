import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { BRANDING_FIELD_KEYS } from '../branding.registry';

export class BrandingAssetOverrideDto {
  @IsUUID()
  assetId!: string;

  @IsUUID()
  workspaceId!: string;
}

export class UpdateWhiteLabelBrandingDto {
  @IsInt()
  @Min(0)
  expectedRevision!: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  appName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  companyName?: string | null;

  @ApiPropertyOptional({ nullable: true, type: BrandingAssetOverrideDto })
  @IsOptional()
  logo?: BrandingAssetOverrideDto | null;

  @ApiPropertyOptional({ nullable: true, type: BrandingAssetOverrideDto })
  @IsOptional()
  darkLogo?: BrandingAssetOverrideDto | null;

  @ApiPropertyOptional({ nullable: true, type: BrandingAssetOverrideDto })
  @IsOptional()
  favicon?: BrandingAssetOverrideDto | null;

  @ApiPropertyOptional({ nullable: true, type: BrandingAssetOverrideDto })
  @IsOptional()
  loginBackground?: BrandingAssetOverrideDto | null;

  @IsOptional()
  @IsString()
  @MaxLength(7)
  primaryColor?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(7)
  accentColor?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(320)
  supportEmail?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  supportUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  footerText?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  metaDescription?: string | null;

  @ApiPropertyOptional({ enum: BRANDING_FIELD_KEYS, isArray: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  agencyAllowedOverrides?: string[];

  @ApiPropertyOptional({ enum: BRANDING_FIELD_KEYS, isArray: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  workspaceAllowedOverrides?: string[];
}
