import { IsUUID } from 'class-validator';

export class WorkspaceUserParamsDto {
  @IsUUID()
  workspaceId!: string;

  @IsUUID()
  userId!: string;
}
