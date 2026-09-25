import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { CloudDriveOAuthController, CloudDrivesController } from './cloud-drives.controller';
import { CloudDriveProviderRegistry } from './cloud-drive-provider.registry';
import { CloudDriveTokenEncryptionService } from './cloud-drive-token-encryption.service';
import { CloudDrivesService } from './cloud-drives.service';
import { DropboxAdapter } from './providers/dropbox.adapter';
import { GoogleDriveAdapter } from './providers/google-drive.adapter';
import { OneDriveAdapter } from './providers/onedrive.adapter';

@Module({
  imports: [BillingModule],
  controllers: [CloudDrivesController, CloudDriveOAuthController],
  providers: [
    CloudDrivesService,
    CloudDriveTokenEncryptionService,
    CloudDriveProviderRegistry,
    GoogleDriveAdapter,
    OneDriveAdapter,
    DropboxAdapter,
  ],
})
export class CloudDrivesModule {}
