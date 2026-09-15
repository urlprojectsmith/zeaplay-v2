import { IsUUID } from 'class-validator';

export class MembershipParamsDto {
  @IsUUID()
  organizationId!: string;

  @IsUUID()
  id!: string;
}
