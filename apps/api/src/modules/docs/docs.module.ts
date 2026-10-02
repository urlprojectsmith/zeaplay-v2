import { Module } from '@nestjs/common';
import { StorageModule } from '../../infrastructure/storage/storage.module';
import { BrandingModule } from '../branding/branding.module';
import { NotificationsModule } from '../notifications/notifications.module';
import {
  AgencyDocsOversightController,
  PublicDocsController,
  SuperAgencyDocsOversightController,
  WorkspaceDocsController,
} from './docs.controller';
import { DocsService } from './docs.service';

@Module({
  imports: [StorageModule, NotificationsModule, BrandingModule],
  controllers: [
    WorkspaceDocsController,
    PublicDocsController,
    AgencyDocsOversightController,
    SuperAgencyDocsOversightController,
  ],
  providers: [DocsService],
  exports: [DocsService],
})
export class DocsModule {}
