import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateWorkspaceDto {
  @ApiProperty({ minLength: 2, maxLength: 160 })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @ApiProperty({ minLength: 2, maxLength: 120, pattern: '^[a-z0-9-]+$' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Matches(/^[a-z0-9-]+$/)
  slug!: string;

  @ApiProperty({ required: false, default: 'UTC', maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  timezone?: string;
}
