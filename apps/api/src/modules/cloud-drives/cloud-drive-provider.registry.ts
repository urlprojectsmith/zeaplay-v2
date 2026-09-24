import { Injectable } from '@nestjs/common';
import { CloudDriveProvider } from '@prisma/client';
import { CloudDriveTokenEncryptionService } from './cloud-drive-token-encryption.service';
import type { CloudDriveProviderAdapter } from './providers/cloud-drive-provider.interface';
import { DropboxAdapter } from './providers/dropbox.adapter';
import { GoogleDriveAdapter } from './providers/google-drive.adapter';
import { OneDriveAdapter } from './providers/onedrive.adapter';

@Injectable()
export class CloudDriveProviderRegistry {
  private readonly adapters: Record<CloudDriveProvider, CloudDriveProviderAdapter>;

  constructor(
    google: GoogleDriveAdapter,
    oneDrive: OneDriveAdapter,
    dropbox: DropboxAdapter,
    private readonly encryption: CloudDriveTokenEncryptionService,
  ) {
    this.adapters = {
      [CloudDriveProvider.GOOGLE_DRIVE]: google,
      [CloudDriveProvider.ONEDRIVE]: oneDrive,
      [CloudDriveProvider.DROPBOX]: dropbox,
    };
  }

  get(provider: CloudDriveProvider) {
    return this.adapters[provider];
  }

  listStatus() {
    return Object.values(this.adapters).map((adapter) => {
      const configured = adapter.configured();
      const encryptionReady = this.encryption.isConfigured();
      return {
        provider: adapter.provider,
        configured,
        available: configured && encryptionReady,
        status: configured ? (encryptionReady ? 'AVAILABLE' : 'UNAVAILABLE') : 'NOT_CONFIGURED',
        capabilities: adapter.capabilities,
      };
    });
  }
}
