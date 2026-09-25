import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { CloudDriveTokenEncryptionService } from '../cloud-drives/cloud-drive-token-encryption.service';
import { WebhookSigningService } from './webhook-signing.service';
import { WebhookUrlValidatorService } from './webhook-url-validator.service';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [BillingModule],
  controllers: [WebhooksController],
  providers: [
    WebhooksService,
    WebhookSigningService,
    WebhookUrlValidatorService,
    CloudDriveTokenEncryptionService,
  ],
  exports: [WebhooksService],
})
export class WebhooksModule {}
