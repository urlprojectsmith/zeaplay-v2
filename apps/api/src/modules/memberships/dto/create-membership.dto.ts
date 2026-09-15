import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn } from 'class-validator';

export class CreateMembershipDto {
  @ApiProperty({ example: 'member@zeaplay.test' })
  @IsEmail()
  email!: string;

  @ApiProperty({ enum: ['ADMIN', 'MANAGER', 'MEMBER'] })
  @IsIn(['ADMIN', 'MANAGER', 'MEMBER'])
  role!: 'ADMIN' | 'MANAGER' | 'MEMBER';
}
