import { GamificationLeaderboardPrivacyMode } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsUUID } from 'class-validator';

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
