import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MembershipStatus } from '@prisma/client';
import { IsEmail, IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';

export class CreateWorkspaceMembershipDto {
  @ApiProperty({ example: 'member@zeaplay.test' })
  @IsEmail()
  email!: string;

  @ApiProperty({ enum: ['ADMIN', 'MANAGER', 'MEMBER'] })
  @IsIn(['ADMIN', 'MANAGER', 'MEMBER'])
  role!: 'ADMIN' | 'MANAGER' | 'MEMBER';
}

export class UpdateWorkspaceMembershipDto {
  @ApiPropertyOptional({ enum: ['ADMIN', 'MANAGER', 'MEMBER'] })
  @IsOptional()
  @IsIn(['ADMIN', 'MANAGER', 'MEMBER'])
  role?: 'ADMIN' | 'MANAGER' | 'MEMBER';

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  roleId?: string;

  @ApiPropertyOptional({ enum: MembershipStatus })
  @IsOptional()
  @IsEnum(MembershipStatus)
  status?: MembershipStatus;
}
