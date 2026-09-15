import { IsUUID } from 'class-validator';

export class WorkspaceParamsDto {
  @IsUUID()
  workspaceId!: string;
}

export class WorkspaceMembershipParamsDto extends WorkspaceParamsDto {
  @IsUUID()
  id!: string;
}

export class AgencyWorkspaceParamsDto {
  @IsUUID()
  agencyId!: string;
}
