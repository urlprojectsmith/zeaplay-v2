import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MembershipStatus } from '@prisma/client';
import { IsEmail, IsEnum, IsIn, IsOptional } from 'class-validator';

export class CreateAgencyMembershipDto {
  @ApiProperty({ example: 'manager@zeaplay.test' })
  @IsEmail()
  email!: string;

  @ApiProperty({ enum: ['AGENCY_ADMIN', 'AGENCY_MANAGER', 'AGENCY_USER'] })
  @IsIn(['AGENCY_ADMIN', 'AGENCY_MANAGER', 'AGENCY_USER'])
  role!: 'AGENCY_ADMIN' | 'AGENCY_MANAGER' | 'AGENCY_USER';
}

export class UpdateAgencyMembershipDto {
  @ApiPropertyOptional({ enum: ['AGENCY_ADMIN', 'AGENCY_MANAGER', 'AGENCY_USER'] })
  @IsOptional()
  @IsIn(['AGENCY_ADMIN', 'AGENCY_MANAGER', 'AGENCY_USER'])
  role?: 'AGENCY_ADMIN' | 'AGENCY_MANAGER' | 'AGENCY_USER';

  @ApiPropertyOptional({ enum: MembershipStatus })
  @IsOptional()
  @IsEnum(MembershipStatus)
  status?: MembershipStatus;
}
