import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { IntegrationAuthType, IntegrationProvider, IntegrationStatus } from '@prisma/client';
import {
  GenericRestIntegrationAdapter,
  GoHighLevelIntegrationAdapter,
  SlackIntegrationAdapter,
  WebexIntegrationAdapter,
} from './integration-provider.adapters';
import { IntegrationGenericRestSecurityService } from './integration-generic-rest-security.service';

const token = 'provider-secret-token';

describe('Integration provider adapters', () => {
  const http = { request: jest.fn() };
  const genericSecurity = {
    validateBaseUrl: jest.fn((value: string) => Promise.resolve(value.replace(/\/$/, ''))),
    validateRelativePath: jest.fn((value: string) => value || '/'),
    validateCredentialHeaderName: jest.fn((value?: string) => value || 'X-API-Key'),
    validateJsonBody: jest.fn((value: unknown) => value ?? {}),
    buildUrl: jest.fn((base: string, path: string) => `${base}${path}`),
  } as unknown as IntegrationGenericRestSecurityService;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    ['contacts.list', { contacts: [{ id: 'c1', name: 'Ada', accessToken: token }] }, { limit: 25 }],
    ['contacts.get', { id: 'c1', name: 'Ada', refreshToken: token }, { contactId: 'c1' }],
    ['contacts.create', { id: 'c2', name: 'Grace' }, { name: 'Grace' }],
    [
      'contacts.update',
      { id: 'c1', name: 'Ada Updated' },
      { contactId: 'c1', name: 'Ada Updated' },
    ],
    [
      'opportunities.list',
      { opportunities: [{ id: 'o1', name: 'Deal', password: token }] },
      { limit: 10 },
    ],
    ['opportunities.create', { id: 'o2', name: 'Deal' }, { name: 'Deal', contactId: 'c1' }],
    ['opportunities.update', { id: 'o1', name: 'Deal Updated' }, { opportunityId: 'o1' }],
  ])('maps and normalizes GHL %s', async (capability, json, input) => {
    http.request.mockResolvedValueOnce(ok(json));
    const adapter = new GoHighLevelIntegrationAdapter(http as never);

    const result = await adapter.execute(
      context(IntegrationProvider.GOHIGHLEVEL, capability, input),
    );

    expect(http.request).toHaveBeenCalledWith(
      expect.objectContaining({ headers: expect.any(Object) }),
    );
    expect(JSON.stringify(result)).not.toContain(token);
    expect(result.data).toBeDefined();
  });

  it('rejects GHL request location override', async () => {
    const adapter = new GoHighLevelIntegrationAdapter(http as never);

    await expect(
      adapter.execute(
        context(IntegrationProvider.GOHIGHLEVEL, 'contacts.create', {
          name: 'Ada',
          locationId: 'other-location',
        }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it.each([
    [401, 'INTEGRATION_AUTH_FAILED'],
    [429, 'INTEGRATION_RATE_LIMITED'],
    [503, 'INTEGRATION_PROVIDER_TRANSIENT'],
  ])('normalizes provider HTTP status %s', async (status) => {
    http.request.mockResolvedValueOnce({ ...ok({}), ok: false, status });
    const adapter = new GoHighLevelIntegrationAdapter(http as never);

    await expect(
      adapter.execute(context(IntegrationProvider.GOHIGHLEVEL, 'contacts.list', {})),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('normalizes Slack channels pagination without raw channel payload secrets', async () => {
    http.request.mockResolvedValueOnce(
      ok({
        ok: true,
        channels: [{ id: 'C1', name: 'general', token }],
        response_metadata: { next_cursor: 'next' },
      }),
    );
    const adapter = new SlackIntegrationAdapter(http as never);

    const result = await adapter.execute(context(IntegrationProvider.SLACK, 'channels.list', {}));

    expect(result.data).toEqual({
      items: [{ id: 'C1', name: 'general' }],
      nextCursor: 'next',
    });
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it('validates and sends Slack messages with bounded typed input', async () => {
    http.request.mockResolvedValueOnce(ok({ ok: true, channel: 'C1', ts: '123.45' }));
    const adapter = new SlackIntegrationAdapter(http as never);

    const result = await adapter.execute(
      context(IntegrationProvider.SLACK, 'messages.send', { channelId: 'C1', text: 'Hello' }),
    );

    expect(http.request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://slack.com/api/chat.postMessage',
        body: { channel: 'C1', text: 'Hello' },
      }),
    );
    expect(result.summary).toEqual({ capability: 'messages.send', ok: true });
  });

  it('marks Slack send transport failure as ambiguous', async () => {
    http.request.mockRejectedValueOnce(new Error('socket closed'));
    const adapter = new SlackIntegrationAdapter(http as never);

    await expect(
      adapter.execute(
        context(IntegrationProvider.SLACK, 'messages.send', { channelId: 'C1', text: 'Hello' }),
      ),
    ).rejects.toThrow('INTEGRATION_AMBIGUOUS_RESULT');
  });

  it('normalizes Webex spaces and messages without raw token output', async () => {
    http.request
      .mockResolvedValueOnce(ok({ items: [{ id: 'R1', title: 'Room', accessToken: token }] }))
      .mockResolvedValueOnce(ok({ id: 'M1', roomId: 'R1', text: 'Hello', token }));
    const adapter = new WebexIntegrationAdapter(http as never);

    const spaces = await adapter.execute(context(IntegrationProvider.WEBEX, 'spaces.list', {}));
    const message = await adapter.execute(
      context(IntegrationProvider.WEBEX, 'messages.send', { spaceId: 'R1', text: 'Hello' }),
    );

    expect(JSON.stringify(spaces)).not.toContain(token);
    expect(JSON.stringify(message)).not.toContain(token);
    expect(message.resourceId).toBe('M1');
  });

  it('marks Webex send transport failure as ambiguous', async () => {
    http.request.mockRejectedValueOnce(new Error('socket closed'));
    const adapter = new WebexIntegrationAdapter(http as never);

    await expect(
      adapter.execute(
        context(IntegrationProvider.WEBEX, 'messages.send', { spaceId: 'R1', text: 'Hello' }),
      ),
    ).rejects.toThrow('INTEGRATION_AMBIGUOUS_RESULT');
  });

  it('executes Generic REST through fixed-origin validated URL construction', async () => {
    http.request.mockResolvedValueOnce(ok({ id: 'ok', authorization: token }));
    const adapter = new GenericRestIntegrationAdapter(http as never, genericSecurity);

    const result = await adapter.execute(
      context(IntegrationProvider.GENERIC_REST, 'http.post', {
        path: '/widgets',
        query: { page: '1' },
        body: { name: 'Widget' },
      }),
    );

    const buildUrlMock = (genericSecurity as unknown as { buildUrl: jest.Mock }).buildUrl;
    expect(buildUrlMock).toHaveBeenCalledWith('https://api.example.com', '/widgets', {
      page: '1',
    });
    expect(http.request).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'POST', bindToResolvedPublicAddress: true }),
    );
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it('advertises and executes Generic REST without auth headers when auth type is NONE', async () => {
    http.request.mockResolvedValueOnce(ok({ id: 'ok' }));
    const adapter = new GenericRestIntegrationAdapter(http as never, genericSecurity);

    expect(adapter.authTypes).toContain(IntegrationAuthType.NONE);

    await adapter.execute(
      context(
        IntegrationProvider.GENERIC_REST,
        'http.get',
        { path: '/status' },
        IntegrationAuthType.NONE,
      ),
    );

    expect(http.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        headers: {},
      }),
    );
  });
});

function ok(json: unknown) {
  return { ok: true, status: 200, headers: new Headers(), body: JSON.stringify(json), json };
}

function context(
  provider: IntegrationProvider,
  capability: string,
  input: Record<string, unknown>,
  authType: IntegrationAuthType = IntegrationAuthType.BEARER_TOKEN,
) {
  return {
    capability,
    input,
    credentials: { token },
    connection: {
      id: '00000000-0000-4000-8000-000000000001',
      workspaceId: '00000000-0000-4000-8000-000000000002',
      provider,
      name: 'Test',
      status: IntegrationStatus.CONNECTED,
      authType,
      providerAccountId: null,
      providerAccountLabel: null,
      encryptedCredentials: 'encrypted',
      scopes: [],
      capabilities: [],
      configurationJson:
        provider === IntegrationProvider.GENERIC_REST
          ? { baseUrl: 'https://api.example.com', testPath: '/', apiKeyHeaderName: 'X-API-Key' }
          : { locationId: 'locA' },
      connectedByMembershipId: '00000000-0000-4000-8000-000000000003',
      lastValidatedAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      safeErrorCode: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      revokedAt: null,
    },
  };
}
