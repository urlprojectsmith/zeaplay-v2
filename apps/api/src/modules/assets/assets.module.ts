import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { StorageRetentionSchedulerService } from './storage-retention-scheduler.service';
import { WorkspaceFilesController } from './workspace-files.controller';

@Module({
  imports: [BillingModule],
  controllers: [AssetsController, WorkspaceFilesController],
  providers: [AssetsService, StorageRetentionSchedulerService],
})
export class AssetsModule {}
