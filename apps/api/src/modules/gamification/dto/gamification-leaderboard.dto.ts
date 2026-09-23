import { GamificationLeaderboardPrivacyMode } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class UpdateGamificationLeaderboardConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  workspaceLeaderboardEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  departmentLeaderboardEnabled?: boolean;
}

export class UpdateGamificationLeaderboardPreferenceDto {
  @IsEnum(GamificationLeaderboardPrivacyMode)
  privacyMode!: GamificationLeaderboardPrivacyMode;
}

export class GamificationDepartmentLeaderboardParamsDto {
  @IsUUID()
  departmentId!: string;
}

export class GamificationGlobalLeaderboardQueryDto {
  @IsOptional()
  @Transform(({ value }) => Number(value ?? 1))
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Transform(({ value }) => Number(value ?? 20))
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsUUID()
  agencyId?: string;

  @IsOptional()
  @IsUUID()
  workspaceId?: string;
}

export class GamificationGlobalLeaderboardTabParamsDto {
  @IsIn(['agencies', 'subaccounts', 'users'])
  tab!: 'agencies' | 'subaccounts' | 'users';
}

export class GamificationAgencyGlobalLeaderboardUsersParamsDto {
  @IsUUID()
  workspaceId!: string;
}
