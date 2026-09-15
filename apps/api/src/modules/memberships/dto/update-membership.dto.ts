import { ApiPropertyOptional } from '@nestjs/swagger';
import { MembershipStatus } from '@prisma/client';
import { IsEnum, IsIn, IsOptional } from 'class-validator';

export class UpdateMembershipDto {
  @ApiPropertyOptional({ enum: ['OWNER', 'ADMIN', 'MANAGER', 'MEMBER'] })
  @IsOptional()
  @IsIn(['OWNER', 'ADMIN', 'MANAGER', 'MEMBER'])
  role?: 'OWNER' | 'ADMIN' | 'MANAGER' | 'MEMBER';

  @ApiPropertyOptional({ enum: MembershipStatus })
  @IsOptional()
  @IsEnum(MembershipStatus)
  status?: MembershipStatus;
}
