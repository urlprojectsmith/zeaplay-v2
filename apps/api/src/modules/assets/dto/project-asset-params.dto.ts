import { IsUUID } from 'class-validator';

export class ProjectAssetParamsDto {
  @IsUUID()
  projectId!: string;

  @IsUUID()
  assetId!: string;
}
