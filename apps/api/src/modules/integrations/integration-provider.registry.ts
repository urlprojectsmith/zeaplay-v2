import { Injectable, NotFoundException } from '@nestjs/common';
import { IntegrationProvider } from '@prisma/client';
import {
  GenericRestIntegrationAdapter,
  GoHighLevelIntegrationAdapter,
  SlackIntegrationAdapter,
  WebexIntegrationAdapter,
} from './integration-provider.adapters';
import type { IntegrationProviderAdapter, IntegrationProviderInfo } from './integration.types';

@Injectable()
export class IntegrationProviderRegistry {
  private readonly adapters: Record<IntegrationProvider, IntegrationProviderAdapter>;

  constructor(
    ghl: GoHighLevelIntegrationAdapter,
    slack: SlackIntegrationAdapter,
    webex: WebexIntegrationAdapter,
    generic: GenericRestIntegrationAdapter,
  ) {
    this.adapters = {
      [IntegrationProvider.GOHIGHLEVEL]: ghl,
      [IntegrationProvider.SLACK]: slack,
      [IntegrationProvider.WEBEX]: webex,
      [IntegrationProvider.GENERIC_REST]: generic,
    };
  }

  get(provider: IntegrationProvider) {
    const adapter = this.adapters[provider];
    if (!adapter) throw new NotFoundException('INTEGRATION_PROVIDER_UNSUPPORTED');
    return adapter;
  }

  list(): IntegrationProviderInfo[] {
    return Object.values(this.adapters).map((adapter) => ({
      provider: adapter.provider,
      label: adapter.label,
      configured: adapter.isConfigured(),
      authTypes: adapter.authTypes,
      capabilities: adapter.capabilities,
      supportsOAuth: adapter.supportsOAuth,
    }));
  }
}
