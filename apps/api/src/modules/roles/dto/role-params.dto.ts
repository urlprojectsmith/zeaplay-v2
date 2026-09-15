import { IsUUID } from 'class-validator';

export class RoleParamsDto {
  @IsUUID()
  workspaceId!: string;

  @IsUUID()
  roleId!: string;
}
