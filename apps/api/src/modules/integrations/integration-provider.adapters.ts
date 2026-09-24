import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { IntegrationAuthType, IntegrationProvider } from '@prisma/client';
import { IntegrationGenericRestSecurityService } from './integration-generic-rest-security.service';
import { IntegrationProviderHttpService } from './integration-provider-http.service';
import type {
  IntegrationActionContext,
  IntegrationActionResult,
  IntegrationCredentialPayload,
  IntegrationProviderAdapter,
} from './integration.types';

function bearer(credentials: IntegrationCredentialPayload) {
  const token = credentials.accessToken ?? credentials.token;
  if (!token) throw new BadRequestException('INTEGRATION_TOKEN_MISSING');
  return { authorization: `Bearer ${token}` };
}

function assertObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function requiredString(value: unknown, code: string) {
  const normalized = optionalString(value);
  if (!normalized) throw new BadRequestException(code);
  return normalized;
}

function summary(json: unknown): Record<string, unknown> {
  if (!json || typeof json !== 'object') return { response: 'empty' };
  const record = json as Record<string, unknown>;
  return {
    id: optionalString(record.id),
    ok: typeof record.ok === 'boolean' ? record.ok : undefined,
    name: optionalString(record.name) ?? optionalString(record.title),
    error: optionalString(record.error),
  };
}

@Injectable()
export class GoHighLevelIntegrationAdapter implements IntegrationProviderAdapter {
  readonly provider = IntegrationProvider.GOHIGHLEVEL;
  readonly label = 'HighLevel';
  readonly authTypes = [IntegrationAuthType.OAUTH, IntegrationAuthType.BEARER_TOKEN];
  readonly supportsOAuth = true;
  readonly capabilities = [
    'contacts.list',
    'contacts.get',
    'contacts.create',
    'contacts.update',
    'opportunities.list',
    'opportunities.create',
    'opportunities.update',
  ];

  constructor(private readonly http: IntegrationProviderHttpService) {}

  isConfigured() {
    return true;
  }

  async validateConfiguration(configuration: Record<string, unknown>) {
    return {
      locationId: requiredString(configuration.locationId, 'INTEGRATION_GHL_LOCATION_REQUIRED'),
    };
  }

  async testConnection(context: Omit<IntegrationActionContext, 'capability' | 'input'>) {
    return this.execute({ ...context, capability: 'contacts.list', input: { limit: 1 } });
  }

  async execute(context: IntegrationActionContext) {
    const config = assertObject(context.connection.configurationJson);
    const locationId = requiredString(config.locationId, 'INTEGRATION_GHL_LOCATION_REQUIRED');
    const headers = { ...bearer(context.credentials), version: '2021-07-28' };
    const base = 'https://services.leadconnectorhq.com';
    const input = context.input;
    let method: 'GET' | 'POST' | 'PUT' = 'GET';
    let url = '';
    let body: unknown;
    if (context.capability === 'contacts.list') {
      url = `${base}/contacts/?locationId=${encodeURIComponent(locationId)}&limit=${Number(input.limit ?? 20)}`;
    } else if (context.capability === 'contacts.get') {
      url = `${base}/contacts/${encodeURIComponent(requiredString(input.contactId, 'INTEGRATION_CONTACT_ID_REQUIRED'))}`;
    } else if (context.capability === 'contacts.create') {
      method = 'POST';
      url = `${base}/contacts/`;
      body = { ...input, locationId };
    } else if (context.capability === 'contacts.update') {
      method = 'PUT';
      url = `${base}/contacts/${encodeURIComponent(requiredString(input.contactId, 'INTEGRATION_CONTACT_ID_REQUIRED'))}`;
      body = { ...input, contactId: undefined };
    } else if (context.capability === 'opportunities.list') {
      url = `${base}/opportunities/search?location_id=${encodeURIComponent(locationId)}&limit=${Number(input.limit ?? 20)}`;
    } else if (context.capability === 'opportunities.create') {
      method = 'POST';
      url = `${base}/opportunities/`;
      body = { ...input, locationId };
    } else if (context.capability === 'opportunities.update') {
      method = 'PUT';
      url = `${base}/opportunities/${encodeURIComponent(requiredString(input.opportunityId, 'INTEGRATION_OPPORTUNITY_ID_REQUIRED'))}`;
      body = { ...input, opportunityId: undefined };
    } else {
      throw new BadRequestException('INTEGRATION_CAPABILITY_UNSUPPORTED');
    }
    const response = await this.http.request({ method, url, headers, body });
    if (!response.ok) throw new ServiceUnavailableException('INTEGRATION_PROVIDER_REJECTED');
    return toActionResult(response.json);
  }
}

@Injectable()
export class SlackIntegrationAdapter implements IntegrationProviderAdapter {
  readonly provider = IntegrationProvider.SLACK;
  readonly label = 'Slack';
  readonly authTypes = [IntegrationAuthType.OAUTH, IntegrationAuthType.BEARER_TOKEN];
  readonly supportsOAuth = true;
  readonly capabilities = ['channels.list', 'messages.send'];

  constructor(private readonly http: IntegrationProviderHttpService) {}

  isConfigured() {
    return true;
  }

  async validateConfiguration(configuration: Record<string, unknown>) {
    return { teamId: optionalString(configuration.teamId) ?? null };
  }

  async testConnection(context: Omit<IntegrationActionContext, 'capability' | 'input'>) {
    return this.execute({ ...context, capability: 'channels.list', input: { limit: 1 } });
  }

  async execute(context: IntegrationActionContext) {
    const headers = bearer(context.credentials);
    if (context.capability === 'channels.list') {
      const response = await this.http.request({
        method: 'GET',
        url: `https://slack.com/api/conversations.list?limit=${Number(context.input.limit ?? 100)}`,
        headers,
      });
      assertSlackOk(response.json);
      return toActionResult(response.json);
    }
    if (context.capability === 'messages.send') {
      const response = await this.http.request({
        method: 'POST',
        url: 'https://slack.com/api/chat.postMessage',
        headers,
        body: {
          channel: requiredString(context.input.channelId, 'INTEGRATION_SLACK_CHANNEL_REQUIRED'),
          text: requiredString(context.input.text, 'INTEGRATION_MESSAGE_TEXT_REQUIRED'),
        },
      });
      assertSlackOk(response.json);
      return toActionResult(response.json);
    }
    throw new BadRequestException('INTEGRATION_CAPABILITY_UNSUPPORTED');
  }
}

@Injectable()
export class WebexIntegrationAdapter implements IntegrationProviderAdapter {
  readonly provider = IntegrationProvider.WEBEX;
  readonly label = 'Webex';
  readonly authTypes = [IntegrationAuthType.OAUTH, IntegrationAuthType.BEARER_TOKEN];
  readonly supportsOAuth = true;
  readonly capabilities = ['spaces.list', 'messages.send'];

  constructor(private readonly http: IntegrationProviderHttpService) {}

  isConfigured() {
    return true;
  }

  async validateConfiguration(configuration: Record<string, unknown>) {
    return { orgId: optionalString(configuration.orgId) ?? null };
  }

  async testConnection(context: Omit<IntegrationActionContext, 'capability' | 'input'>) {
    return this.execute({ ...context, capability: 'spaces.list', input: { max: 1 } });
  }

  async execute(context: IntegrationActionContext) {
    const headers = bearer(context.credentials);
    if (context.capability === 'spaces.list') {
      const response = await this.http.request({
        method: 'GET',
        url: `https://webexapis.com/v1/rooms?max=${Number(context.input.max ?? 100)}`,
        headers,
      });
      if (!response.ok) throw new ServiceUnavailableException('INTEGRATION_PROVIDER_REJECTED');
      return toActionResult(response.json);
    }
    if (context.capability === 'messages.send') {
      const response = await this.http.request({
        method: 'POST',
        url: 'https://webexapis.com/v1/messages',
        headers,
        body: {
          roomId: requiredString(context.input.spaceId, 'INTEGRATION_WEBEX_SPACE_REQUIRED'),
          text: requiredString(context.input.text, 'INTEGRATION_MESSAGE_TEXT_REQUIRED'),
        },
      });
      if (!response.ok) throw new ServiceUnavailableException('INTEGRATION_PROVIDER_REJECTED');
      return toActionResult(response.json);
    }
    throw new BadRequestException('INTEGRATION_CAPABILITY_UNSUPPORTED');
  }
}

@Injectable()
export class GenericRestIntegrationAdapter implements IntegrationProviderAdapter {
  readonly provider = IntegrationProvider.GENERIC_REST;
  readonly label = 'Generic REST';
  readonly authTypes = [
    IntegrationAuthType.BEARER_TOKEN,
    IntegrationAuthType.API_KEY,
    IntegrationAuthType.BASIC_AUTH,
  ];
  readonly supportsOAuth = false;
  readonly capabilities = ['connection.test', 'http.get', 'http.post', 'http.patch'];

  constructor(
    private readonly http: IntegrationProviderHttpService,
    private readonly security: IntegrationGenericRestSecurityService,
  ) {}

  isConfigured() {
    return true;
  }

  async validateConfiguration(configuration: Record<string, unknown>) {
    return {
      baseUrl: await this.security.validateBaseUrl(configuration.baseUrl),
      testPath: this.security.validateRelativePath(configuration.testPath),
      apiKeyHeaderName: this.security.validateCredentialHeaderName(configuration.apiKeyHeaderName),
    };
  }

  async testConnection(context: Omit<IntegrationActionContext, 'capability' | 'input'>) {
    return this.execute({ ...context, capability: 'connection.test', input: {} });
  }

  async execute(context: IntegrationActionContext) {
    const config = assertObject(context.connection.configurationJson);
    const baseUrl = requiredString(config.baseUrl, 'INTEGRATION_GENERIC_BASE_URL_REQUIRED');
    const path =
      context.capability === 'connection.test'
        ? this.security.validateRelativePath(config.testPath)
        : this.security.validateRelativePath(context.input.path);
    const method =
      context.capability === 'http.post'
        ? 'POST'
        : context.capability === 'http.patch'
          ? 'PATCH'
          : 'GET';
    if (!this.capabilities.includes(context.capability)) {
      throw new BadRequestException('INTEGRATION_CAPABILITY_UNSUPPORTED');
    }
    const response = await this.http.request({
      method,
      url: `${baseUrl}${path}`,
      headers: this.authHeaders(context.credentials, config),
      body: method === 'GET' ? undefined : (context.input.body ?? {}),
    });
    if (!response.ok) throw new ServiceUnavailableException('INTEGRATION_PROVIDER_REJECTED');
    return toActionResult(response.json ?? { status: response.status });
  }

  private authHeaders(credentials: IntegrationCredentialPayload, config: Record<string, unknown>) {
    if (credentials.token) return { authorization: `Bearer ${credentials.token}` };
    if (credentials.apiKey) {
      const name = this.security.validateCredentialHeaderName(
        credentials.apiKeyHeaderName ?? config.apiKeyHeaderName,
      );
      return { [name]: credentials.apiKey };
    }
    if (credentials.username && credentials.password) {
      return {
        authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`,
      };
    }
    return {};
  }
}

function assertSlackOk(json: unknown) {
  const body = assertObject(json);
  if (body.ok !== true) throw new ServiceUnavailableException('INTEGRATION_PROVIDER_REJECTED');
}

function toActionResult(json: unknown): IntegrationActionResult {
  const safeSummary = summary(json);
  return {
    providerRequestId: optionalString(
      (assertObject(json).headers as Record<string, unknown>)?.['x-request-id'],
    ),
    resourceId: optionalString(assertObject(json).id),
    summary: safeSummary,
    data: json,
  };
}
