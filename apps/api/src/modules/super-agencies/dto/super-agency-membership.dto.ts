import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MembershipStatus, SuperAgencyInvitationStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class SuperAgencyMembershipParamsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  superAgencyId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  membershipId!: string;
}

export class SuperAgencyRoleParamsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  superAgencyId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  roleId!: string;
}

export class SuperAgencyInvitationParamsDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  superAgencyId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  invitationId!: string;
}

export class CreateSuperAgencyMembershipDto {
  @ApiProperty({ example: 'manager@zeaplay.test' })
  @IsEmail()
  email!: string;

  @ApiPropertyOptional({
    enum: ['SUPER_AGENCY_ADMIN', 'SUPER_AGENCY_MANAGER', 'SUPER_AGENCY_MEMBER'],
  })
  @IsOptional()
  @IsIn(['SUPER_AGENCY_ADMIN', 'SUPER_AGENCY_MANAGER', 'SUPER_AGENCY_MEMBER'])
  role?: 'SUPER_AGENCY_ADMIN' | 'SUPER_AGENCY_MANAGER' | 'SUPER_AGENCY_MEMBER';

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  roleId?: string;
}

export class UpdateSuperAgencyMembershipDto {
  @ApiPropertyOptional({
    enum: ['SUPER_AGENCY_ADMIN', 'SUPER_AGENCY_MANAGER', 'SUPER_AGENCY_MEMBER'],
  })
  @IsOptional()
  @IsIn(['SUPER_AGENCY_ADMIN', 'SUPER_AGENCY_MANAGER', 'SUPER_AGENCY_MEMBER'])
  role?: 'SUPER_AGENCY_ADMIN' | 'SUPER_AGENCY_MANAGER' | 'SUPER_AGENCY_MEMBER';

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  roleId?: string;

  @ApiPropertyOptional({ enum: MembershipStatus })
  @IsOptional()
  @IsEnum(MembershipStatus)
  status?: MembershipStatus;
}

export class SuperAgencyMemberListQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;

  @ApiPropertyOptional({ minLength: 1, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  search?: string;
}

export class SuperAgencyInvitationListQueryDto extends SuperAgencyMemberListQueryDto {
  @ApiPropertyOptional({ enum: SuperAgencyInvitationStatus })
  @IsOptional()
  @IsEnum(SuperAgencyInvitationStatus)
  status?: SuperAgencyInvitationStatus;
}

export class CreateSuperAgencyRoleDto {
  @ApiProperty({ minLength: 2, maxLength: 80 })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({ maxLength: 240, nullable: true })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(240)
  description?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  permissionIds?: string[];
}

export class ReplaceSuperAgencyRolePermissionsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsUUID(undefined, { each: true })
  permissionIds!: string[];
}

export class CreateSuperAgencyInvitationDto extends CreateSuperAgencyMembershipDto {}

export class AcceptSuperAgencyInvitationDto {
  @ApiProperty({ minLength: 32, maxLength: 256 })
  @IsString()
  @MinLength(32)
  @MaxLength(256)
  token!: string;
}
