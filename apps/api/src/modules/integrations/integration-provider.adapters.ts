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

function boundedString(value: unknown, code: string, maxLength: number) {
  const normalized = requiredString(value, code);
  if (normalized.length > maxLength) throw new BadRequestException(code);
  return normalized;
}

function boundedOptionalString(value: unknown, maxLength: number) {
  const normalized = optionalString(value);
  if (!normalized) return undefined;
  if (normalized.length > maxLength) throw new BadRequestException('INTEGRATION_INPUT_TOO_LARGE');
  return normalized;
}

function boundedLimit(value: unknown, defaultValue: number, maxValue: number) {
  const number = Number(value ?? defaultValue);
  if (!Number.isInteger(number) || number < 1)
    throw new BadRequestException('INTEGRATION_LIMIT_INVALID');
  return Math.min(number, maxValue);
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
  readonly authTypes = [IntegrationAuthType.BEARER_TOKEN];
  readonly supportsOAuth = false;
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

  validateConfiguration(configuration: Record<string, unknown>) {
    return Promise.resolve({
      locationId: requiredString(configuration.locationId, 'INTEGRATION_GHL_LOCATION_REQUIRED'),
    });
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
      url = `${base}/contacts/?locationId=${encodeURIComponent(locationId)}&limit=${boundedLimit(input.limit, 20, 100)}`;
    } else if (context.capability === 'contacts.get') {
      url = `${base}/contacts/${encodeURIComponent(boundedString(input.contactId, 'INTEGRATION_CONTACT_ID_REQUIRED', 120))}`;
    } else if (context.capability === 'contacts.create') {
      method = 'POST';
      url = `${base}/contacts/`;
      body = sanitizeGhlContactInput(input, locationId);
    } else if (context.capability === 'contacts.update') {
      method = 'PUT';
      url = `${base}/contacts/${encodeURIComponent(boundedString(input.contactId, 'INTEGRATION_CONTACT_ID_REQUIRED', 120))}`;
      body = sanitizeGhlContactInput(input, locationId, true);
    } else if (context.capability === 'opportunities.list') {
      url = `${base}/opportunities/search?location_id=${encodeURIComponent(locationId)}&limit=${boundedLimit(input.limit, 20, 100)}`;
    } else if (context.capability === 'opportunities.create') {
      method = 'POST';
      url = `${base}/opportunities/`;
      body = sanitizeGhlOpportunityInput(input, locationId);
    } else if (context.capability === 'opportunities.update') {
      method = 'PUT';
      url = `${base}/opportunities/${encodeURIComponent(boundedString(input.opportunityId, 'INTEGRATION_OPPORTUNITY_ID_REQUIRED', 120))}`;
      body = sanitizeGhlOpportunityInput(input, locationId, true);
    } else {
      throw new BadRequestException('INTEGRATION_CAPABILITY_UNSUPPORTED');
    }
    const response = await safeProviderRequest(
      () => this.http.request({ method, url, headers, body }),
      method !== 'GET',
    );
    assertProviderOk(response.status);
    return normalizeGhlResult(context.capability, response.json);
  }
}

@Injectable()
export class SlackIntegrationAdapter implements IntegrationProviderAdapter {
  readonly provider = IntegrationProvider.SLACK;
  readonly label = 'Slack';
  readonly authTypes = [IntegrationAuthType.BEARER_TOKEN];
  readonly supportsOAuth = false;
  readonly capabilities = ['channels.list', 'messages.send'];

  constructor(private readonly http: IntegrationProviderHttpService) {}

  isConfigured() {
    return true;
  }

  validateConfiguration(configuration: Record<string, unknown>) {
    return Promise.resolve({ teamId: optionalString(configuration.teamId) ?? null });
  }

  async testConnection(context: Omit<IntegrationActionContext, 'capability' | 'input'>) {
    return this.execute({ ...context, capability: 'channels.list', input: { limit: 1 } });
  }

  async execute(context: IntegrationActionContext) {
    const headers = bearer(context.credentials);
    if (context.capability === 'channels.list') {
      const response = await this.http.request({
        method: 'GET',
        url: `https://slack.com/api/conversations.list?limit=${boundedLimit(context.input.limit, 100, 200)}`,
        headers,
      });
      assertSlackOk(response.json);
      return normalizeSlackResult(context.capability, response.json);
    }
    if (context.capability === 'messages.send') {
      const response = await safeProviderRequest(
        () =>
          this.http.request({
            method: 'POST',
            url: 'https://slack.com/api/chat.postMessage',
            headers,
            body: {
              channel: boundedString(
                context.input.channelId,
                'INTEGRATION_SLACK_CHANNEL_REQUIRED',
                120,
              ),
              text: boundedString(context.input.text, 'INTEGRATION_MESSAGE_TEXT_REQUIRED', 4000),
            },
          }),
        true,
      );
      assertSlackOk(response.json);
      return normalizeSlackResult(context.capability, response.json);
    }
    throw new BadRequestException('INTEGRATION_CAPABILITY_UNSUPPORTED');
  }
}

@Injectable()
export class WebexIntegrationAdapter implements IntegrationProviderAdapter {
  readonly provider = IntegrationProvider.WEBEX;
  readonly label = 'Webex';
  readonly authTypes = [IntegrationAuthType.BEARER_TOKEN];
  readonly supportsOAuth = false;
  readonly capabilities = ['spaces.list', 'messages.send'];

  constructor(private readonly http: IntegrationProviderHttpService) {}

  isConfigured() {
    return true;
  }

  validateConfiguration(configuration: Record<string, unknown>) {
    return Promise.resolve({ orgId: optionalString(configuration.orgId) ?? null });
  }

  async testConnection(context: Omit<IntegrationActionContext, 'capability' | 'input'>) {
    return this.execute({ ...context, capability: 'spaces.list', input: { max: 1 } });
  }

  async execute(context: IntegrationActionContext) {
    const headers = bearer(context.credentials);
    if (context.capability === 'spaces.list') {
      const response = await this.http.request({
        method: 'GET',
        url: `https://webexapis.com/v1/rooms?max=${boundedLimit(context.input.max, 100, 100)}`,
        headers,
      });
      assertProviderOk(response.status);
      return normalizeWebexResult(context.capability, response.json);
    }
    if (context.capability === 'messages.send') {
      const response = await safeProviderRequest(
        () =>
          this.http.request({
            method: 'POST',
            url: 'https://webexapis.com/v1/messages',
            headers,
            body: {
              roomId: boundedString(context.input.spaceId, 'INTEGRATION_WEBEX_SPACE_REQUIRED', 120),
              text: boundedString(context.input.text, 'INTEGRATION_MESSAGE_TEXT_REQUIRED', 4000),
            },
          }),
        true,
      );
      assertProviderOk(response.status);
      return normalizeWebexResult(context.capability, response.json);
    }
    throw new BadRequestException('INTEGRATION_CAPABILITY_UNSUPPORTED');
  }
}

@Injectable()
export class GenericRestIntegrationAdapter implements IntegrationProviderAdapter {
  readonly provider = IntegrationProvider.GENERIC_REST;
  readonly label = 'Generic REST';
  readonly authTypes = [
    IntegrationAuthType.NONE,
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
    const body = method === 'GET' ? undefined : this.security.validateJsonBody(context.input.body);
    const response = await safeProviderRequest(
      () =>
        this.http.request({
          method,
          url: this.security.buildUrl(baseUrl, path, context.input.query),
          headers: this.authHeaders(context.connection.authType, context.credentials, config),
          body,
          bindToResolvedPublicAddress: true,
        }),
      method !== 'GET',
    );
    assertProviderOk(response.status);
    return normalizeGenericResult(response.status, response.json);
  }

  private authHeaders(
    authType: IntegrationAuthType,
    credentials: IntegrationCredentialPayload,
    config: Record<string, unknown>,
  ) {
    if (authType === IntegrationAuthType.NONE) return {};
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

async function safeProviderRequest<T>(handler: () => Promise<T>, mutation: boolean) {
  try {
    return await handler();
  } catch (error) {
    if (mutation) throw new ServiceUnavailableException('INTEGRATION_AMBIGUOUS_RESULT');
    throw error;
  }
}

function assertProviderOk(status: number) {
  if (status === 401 || status === 403)
    throw new ServiceUnavailableException('INTEGRATION_AUTH_FAILED');
  if (status === 429) throw new ServiceUnavailableException('INTEGRATION_RATE_LIMITED');
  if (status >= 500) throw new ServiceUnavailableException('INTEGRATION_PROVIDER_TRANSIENT');
  if (status < 200 || status >= 300)
    throw new ServiceUnavailableException('INTEGRATION_PROVIDER_REJECTED');
}

function normalizeGhlResult(capability: string, json: unknown): IntegrationActionResult {
  const record = assertObject(json);
  const items = Array.isArray(record.contacts)
    ? record.contacts
    : Array.isArray(record.opportunities)
      ? record.opportunities
      : undefined;
  const data = items
    ? {
        items: items
          .slice(0, 100)
          .map((item) =>
            pickFields(assertObject(item), ['id', 'name', 'email', 'phone', 'status']),
          ),
        nextPageCursor: optionalString(record.nextPageCursor) ?? optionalString(record.meta),
      }
    : pickFields(record, ['id', 'contactId', 'opportunityId', 'name', 'email', 'phone', 'status']);
  return {
    resourceId:
      optionalString(record.id) ??
      optionalString(record.contactId) ??
      optionalString(record.opportunityId),
    summary: { capability, count: items?.length, ...summary(data) },
    data,
  };
}

function normalizeSlackResult(capability: string, json: unknown): IntegrationActionResult {
  const record = assertObject(json);
  if (capability === 'channels.list') {
    const channels = Array.isArray(record.channels) ? record.channels : [];
    const data = {
      items: channels
        .slice(0, 200)
        .map((item) => pickFields(assertObject(item), ['id', 'name', 'is_channel', 'is_private'])),
      nextCursor: optionalString(assertObject(record.response_metadata).next_cursor),
    };
    return { summary: { capability, count: data.items.length }, data };
  }
  const data = pickFields(record, ['channel', 'ts', 'message']);
  return {
    resourceId: optionalString(record.ts),
    summary: { capability, ok: record.ok === true },
    data,
  };
}

function normalizeWebexResult(capability: string, json: unknown): IntegrationActionResult {
  const record = assertObject(json);
  if (capability === 'spaces.list') {
    const items = Array.isArray(record.items) ? record.items : [];
    const data = {
      items: items
        .slice(0, 100)
        .map((item) => pickFields(assertObject(item), ['id', 'title', 'type', 'lastActivity'])),
    };
    return { summary: { capability, count: data.items.length }, data };
  }
  const data = pickFields(record, ['id', 'roomId', 'roomType', 'text', 'created']);
  return {
    resourceId: optionalString(record.id),
    summary: { capability, id: optionalString(record.id) },
    data,
  };
}

function normalizeGenericResult(status: number, json: unknown): IntegrationActionResult {
  const record = assertObject(json);
  const data = {
    status,
    body:
      json && typeof json === 'object'
        ? pickFields(
            record,
            Object.keys(record)
              .filter((key) => !/token|secret|password|authorization|cookie/i.test(key))
              .slice(0, 25),
          )
        : json,
  };
  return { summary: { status }, data };
}

function pickFields(record: Record<string, unknown>, keys: string[]) {
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    if (record[key] === undefined || /token|secret|password|authorization|cookie/i.test(key))
      continue;
    const value = record[key];
    output[key] = typeof value === 'string' ? value.slice(0, 500) : value;
  }
  return output;
}

function sanitizeGhlContactInput(
  input: Record<string, unknown>,
  locationId: string,
  updating = false,
) {
  assertNoLocationOverride(input, locationId);
  return {
    ...(updating ? {} : { locationId }),
    firstName: boundedOptionalString(input.firstName, 100),
    lastName: boundedOptionalString(input.lastName, 100),
    name: boundedOptionalString(input.name, 200),
    email: boundedOptionalString(input.email, 320),
    phone: boundedOptionalString(input.phone, 50),
    source: boundedOptionalString(input.source, 120),
  };
}

function sanitizeGhlOpportunityInput(
  input: Record<string, unknown>,
  locationId: string,
  updating = false,
) {
  assertNoLocationOverride(input, locationId);
  return {
    ...(updating ? {} : { locationId }),
    name: boundedOptionalString(input.name, 200),
    contactId: boundedOptionalString(input.contactId, 120),
    pipelineId: boundedOptionalString(input.pipelineId, 120),
    pipelineStageId: boundedOptionalString(input.pipelineStageId, 120),
    status: boundedOptionalString(input.status, 50),
    monetaryValue: typeof input.monetaryValue === 'number' ? input.monetaryValue : undefined,
  };
}

function assertNoLocationOverride(input: Record<string, unknown>, locationId: string) {
  const requested = optionalString(input.locationId) ?? optionalString(input.location_id);
  if (requested && requested !== locationId)
    throw new BadRequestException('INTEGRATION_GHL_LOCATION_OVERRIDE_REJECTED');
}
