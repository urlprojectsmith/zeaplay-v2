import { IsUUID } from 'class-validator';

export class AgencyParamsDto {
  @IsUUID()
  agencyId!: string;
}

export class AgencyMembershipParamsDto extends AgencyParamsDto {
  @IsUUID()
  id!: string;
}
