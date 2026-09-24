import { Module } from '@nestjs/common';
import { CloudDriveTokenEncryptionService } from '../cloud-drives/cloud-drive-token-encryption.service';
import {
  GenericHmacV1InboundWebhookAdapter,
  InboundWebhookAdapterRegistry,
} from './inbound-webhook-adapters';
import { InboundWebhookCryptoService } from './inbound-webhook-crypto.service';
import { InboundWebhookMaintenanceSchedulerService } from './inbound-webhook-maintenance-scheduler.service';
import { InboundWebhookRateLimitService } from './inbound-webhook-rate-limit.service';
import { InboundWebhooksController } from './inbound-webhooks.controller';
import { InboundWebhooksService } from './inbound-webhooks.service';
import { PublicInboundWebhooksController } from './public-inbound-webhooks.controller';

@Module({
  controllers: [InboundWebhooksController, PublicInboundWebhooksController],
  providers: [
    InboundWebhooksService,
    InboundWebhookCryptoService,
    InboundWebhookMaintenanceSchedulerService,
    InboundWebhookRateLimitService,
    GenericHmacV1InboundWebhookAdapter,
    InboundWebhookAdapterRegistry,
    CloudDriveTokenEncryptionService,
  ],
  exports: [InboundWebhooksService],
})
export class InboundWebhooksModule {}
