import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateCustomDomainDto {
  @IsString()
  @MaxLength(253)
  hostname!: string;
}

export class CustomDomainRevisionDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedRevision?: number;
}
