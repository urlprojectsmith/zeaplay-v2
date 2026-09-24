import { Module } from '@nestjs/common';
import { CloudDriveTokenEncryptionService } from '../cloud-drives/cloud-drive-token-encryption.service';
import { WebhookUrlValidatorService } from '../webhooks/webhook-url-validator.service';
import { IntegrationCredentialService } from './integration-credential.service';
import { IntegrationGenericRestSecurityService } from './integration-generic-rest-security.service';
import { IntegrationMaintenanceService } from './integration-maintenance.service';
import {
  GenericRestIntegrationAdapter,
  GoHighLevelIntegrationAdapter,
  SlackIntegrationAdapter,
  WebexIntegrationAdapter,
} from './integration-provider.adapters';
import { IntegrationProviderHttpService } from './integration-provider-http.service';
import { IntegrationProviderRegistry } from './integration-provider.registry';
import { IntegrationRateLimitService } from './integration-rate-limit.service';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';

@Module({
  controllers: [IntegrationsController],
  providers: [
    CloudDriveTokenEncryptionService,
    WebhookUrlValidatorService,
    IntegrationCredentialService,
    IntegrationProviderHttpService,
    IntegrationGenericRestSecurityService,
    GoHighLevelIntegrationAdapter,
    SlackIntegrationAdapter,
    WebexIntegrationAdapter,
    GenericRestIntegrationAdapter,
    IntegrationProviderRegistry,
    IntegrationRateLimitService,
    IntegrationsService,
    IntegrationMaintenanceService,
  ],
  exports: [IntegrationsService, IntegrationProviderRegistry],
})
export class IntegrationsModule {}
