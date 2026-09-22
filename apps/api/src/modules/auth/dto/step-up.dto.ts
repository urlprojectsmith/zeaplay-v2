import { GamificationAdminEconomy, SecurityStepUpPurpose } from '@prisma/client';
import { IsEnum, IsString, IsUUID, Length, Matches } from 'class-validator';

export class PasswordStepUpDto {
  @IsUUID()
  workspaceId!: string;

  @IsEnum(SecurityStepUpPurpose)
  purpose!: SecurityStepUpPurpose;

  @IsUUID()
  targetMembershipId!: string;

  @IsEnum(GamificationAdminEconomy)
  economy!: GamificationAdminEconomy;

  @IsString()
  password!: string;
}

export class StartEmailOtpStepUpDto {
  @IsUUID()
  workspaceId!: string;

  @IsEnum(SecurityStepUpPurpose)
  purpose!: SecurityStepUpPurpose;

  @IsUUID()
  targetMembershipId!: string;

  @IsEnum(GamificationAdminEconomy)
  economy!: GamificationAdminEconomy;

  @IsString()
  password!: string;
}

export class VerifyEmailOtpStepUpDto {
  @IsUUID()
  challengeId!: string;

  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/)
  code!: string;
}
