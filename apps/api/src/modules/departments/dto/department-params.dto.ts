import { IsUUID } from 'class-validator';

export class DepartmentParamsDto {
  @IsUUID()
  workspaceId!: string;

  @IsUUID()
  departmentId!: string;
}
