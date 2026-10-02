import { Module } from '@nestjs/common';
import { StorageModule } from '../../infrastructure/storage/storage.module';
import { CustomDomainsModule } from '../custom-domains/custom-domains.module';
import { BrandingController } from './branding.controller';
import { BrandingPlatformGuard } from './branding-platform.guard';
import { BrandingService } from './branding.service';

@Module({
  imports: [StorageModule, CustomDomainsModule],
  controllers: [BrandingController],
  providers: [BrandingService, BrandingPlatformGuard],
  exports: [BrandingService],
})
export class BrandingModule {}
