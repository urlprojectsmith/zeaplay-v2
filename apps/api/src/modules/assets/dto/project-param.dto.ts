import { IsUUID } from 'class-validator';

export class ProjectParamDto {
  @IsUUID()
  projectId!: string;
}
