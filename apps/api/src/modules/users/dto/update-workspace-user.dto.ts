import { ApiPropertyOptional } from '@nestjs/swagger';
import { MembershipStatus } from '@prisma/client';
import { IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';

export class UpdateWorkspaceUserMembershipDto {
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

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  departmentId?: string | null;
}
