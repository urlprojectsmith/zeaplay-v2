import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  AgencyStatus,
  IntegrationActionStatus,
  IntegrationAuthType,
  IntegrationProvider,
  IntegrationStatus,
  SuperAgencyStatus,
  WorkspaceStatus,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { IntegrationsService } from './integrations.service';
import type { IntegrationProviderInfo } from './integration.types';

const tenant = {
  userId: '00000000-0000-4000-8000-000000000010',
  agencyId: '00000000-0000-4000-8000-000000000011',
  workspaceId: '00000000-0000-4000-8000-000000000012',
  workspaceMembershipId: '00000000-0000-4000-8000-000000000013',
  agencyMembershipId: null,
  roleId: 'role',
  roleName: 'Owner',
  permissions: [],
  accessSource: 'WORKSPACE_MEMBERSHIP' as const,
};

describe('IntegrationsService action authority', () => {
  const prisma = {
    integrationConnection: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    integrationOAuthState: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    integrationActionExecution: {
      create: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      update: jest.fn(),
    },
    integrationActionIdempotencyRecord: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
      update: jest.fn(),
    },
    auditLog: { create: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  };
  const credentials = {
    isConfigured: jest.fn(() => true),
    encrypt: jest.fn(() => 'encrypted'),
    decrypt: jest.fn(() => ({ token: 'secret-token' })),
  };
  const adapter = {
    capabilities: ['channels.list', 'messages.send'],
    execute: jest.fn(),
    testConnection: jest.fn(),
    authTypes: [IntegrationAuthType.BEARER_TOKEN] as IntegrationAuthType[],
    validateConfiguration: jest.fn(() => Promise.resolve({})),
  };
  const registry = {
    list: jest.fn((): IntegrationProviderInfo[] => [
      {
        provider: IntegrationProvider.SLACK,
        label: 'Slack',
        configured: true,
        authTypes: [IntegrationAuthType.BEARER_TOKEN],
        capabilities: adapter.capabilities,
        supportsOAuth: false,
      },
    ]),
    get: jest.fn(() => adapter),
  };
  const rateLimit = { assertWithinLimit: jest.fn() };
  const service = new IntegrationsService(
    prisma as never,
    credentials as never,
    registry as never,
    rateLimit as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.integrationConnection.findFirst.mockResolvedValue(connection());
    prisma.integrationConnection.count.mockResolvedValue(0);
    prisma.integrationConnection.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => Promise.resolve(connection(data)),
    );
    prisma.integrationOAuthState.findMany.mockResolvedValue([]);
    prisma.integrationOAuthState.deleteMany.mockResolvedValue({ count: 0 });
    prisma.integrationActionExecution.create.mockResolvedValue({ id: 'execution-1' });
    prisma.integrationActionExecution.findMany.mockResolvedValue([]);
    prisma.integrationActionExecution.deleteMany.mockResolvedValue({ count: 0 });
    prisma.integrationActionExecution.update.mockResolvedValue({});
    prisma.integrationActionIdempotencyRecord.findMany.mockResolvedValue([]);
    prisma.integrationActionIdempotencyRecord.deleteMany.mockResolvedValue({ count: 0 });
    prisma.integrationConnection.update.mockResolvedValue(connection());
    prisma.auditLog.create.mockResolvedValue({});
    prisma.$queryRaw.mockResolvedValue([]);
    adapter.execute.mockResolvedValue({
      summary: { ok: true },
      data: { channel: 'C1', token: undefined },
    });
    adapter.validateConfiguration.mockResolvedValue({});
    prisma.$transaction.mockImplementation((handler: (tx: typeof prisma) => Promise<unknown>) =>
      handler(prisma),
    );
    prisma.$queryRaw.mockResolvedValue([{ locked: true }]);
  });

  it('scopes connection lookup to the tenant workspace', async () => {
    await service.get(tenant, '00000000-0000-4000-8000-000000000099');

    expect(prisma.integrationConnection.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: '00000000-0000-4000-8000-000000000099',
          workspaceId: tenant.workspaceId,
        },
      }),
    );
  });

  it('requires direct Workspace membership before listing integration connections', async () => {
    await expect(
      service.list(
        {
          ...tenant,
          workspaceMembershipId: null,
          accessSource: 'AGENCY_ADMINISTRATION',
        },
        {},
      ),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.integrationConnection.findMany).not.toHaveBeenCalled();
  });

  it('rejects foreign or missing connections', async () => {
    prisma.integrationConnection.findFirst.mockResolvedValueOnce(null);

    await expect(service.get(tenant, '00000000-0000-4000-8000-000000000099')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects disabled connection execution', async () => {
    prisma.integrationConnection.findFirst.mockResolvedValueOnce(
      connection({ status: IntegrationStatus.DISCONNECTED }),
    );

    await expect(
      service.execute(tenant, connection().id, 'channels.list', { input: {} }),
    ).rejects.toThrow(ConflictException);
  });

  it('blocks provider actions when the connection hierarchy is suspended before decrypting credentials', async () => {
    prisma.integrationConnection.findFirst.mockResolvedValueOnce(
      connection({
        workspace: {
          status: WorkspaceStatus.ACTIVE,
          agency: {
            status: AgencyStatus.ACTIVE,
            superAgency: { status: SuperAgencyStatus.SUSPENDED },
          },
        },
      }),
    );

    await expect(
      service.execute(tenant, connection().id, 'channels.list', { input: {} }),
    ).rejects.toThrow(ConflictException);

    expect(credentials.decrypt).not.toHaveBeenCalled();
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it('requires capability in both connection record and provider registry', async () => {
    prisma.integrationConnection.findFirst.mockResolvedValueOnce(
      connection({ capabilities: ['messages.send', 'wildcard.fake'] }),
    );

    await expect(
      service.execute(tenant, connection().id, 'wildcard.fake', { input: {} }),
    ).rejects.toThrow(BadRequestException);
  });

  it('keeps no-auth providers available when credential encryption is not configured', () => {
    credentials.isConfigured.mockReturnValueOnce(false);
    registry.list.mockReturnValueOnce([
      {
        provider: IntegrationProvider.GENERIC_REST,
        label: 'Generic REST',
        configured: true,
        authTypes: [IntegrationAuthType.NONE, IntegrationAuthType.BEARER_TOKEN],
        capabilities: ['connection.test'],
        supportsOAuth: false,
      },
      {
        provider: IntegrationProvider.SLACK,
        label: 'Slack',
        configured: true,
        authTypes: [IntegrationAuthType.BEARER_TOKEN],
        capabilities: ['channels.list'],
        supportsOAuth: false,
      },
    ]);

    expect(service.listProviders()).toEqual([
      expect.objectContaining({
        provider: IntegrationProvider.GENERIC_REST,
        configured: true,
      }),
      expect.objectContaining({
        provider: IntegrationProvider.SLACK,
        configured: false,
      }),
    ]);
  });

  it('replays completed idempotent mutations without a second provider call', async () => {
    prisma.integrationActionIdempotencyRecord.findUnique.mockResolvedValueOnce({
      requestFingerprint: hash('{"channelId":"C1","text":"Hello"}'),
      responseBody: { executionId: 'previous', status: IntegrationActionStatus.SUCCEEDED },
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await service.execute(tenant, connection().id, 'messages.send', {
      idempotencyKey: 'idem-key',
      input: { channelId: 'C1', text: 'Hello' },
    });

    expect(result).toEqual({ executionId: 'previous', status: IntegrationActionStatus.SUCCEEDED });
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it('creates Generic REST NONE auth connections without encryption or stored credentials', async () => {
    credentials.isConfigured.mockReturnValueOnce(false);
    registry.get.mockReturnValueOnce({
      ...adapter,
      authTypes: [IntegrationAuthType.NONE],
      capabilities: ['connection.test'],
      validateConfiguration: jest.fn(() => Promise.resolve({ baseUrl: 'https://api.example.com' })),
    });

    const created = await service.create(tenant, {
      provider: IntegrationProvider.GENERIC_REST,
      name: 'Public status',
      authType: IntegrationAuthType.NONE,
      configuration: { baseUrl: 'https://api.example.com' },
    });

    expect(credentials.encrypt).not.toHaveBeenCalled();
    expect(prisma.integrationConnection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          authType: IntegrationAuthType.NONE,
          encryptedCredentials: null,
          scopes: [],
          providerAccountId: null,
          providerAccountLabel: null,
        }),
      }),
    );
    expect(created).toMatchObject({ authType: IntegrationAuthType.NONE, hasCredentials: false });
  });

  it('switches a connection to NONE by clearing stored credential metadata', async () => {
    prisma.integrationConnection.update.mockResolvedValueOnce(
      connection({
        authType: IntegrationAuthType.NONE,
        encryptedCredentials: null,
        scopes: [],
        providerAccountId: null,
        providerAccountLabel: null,
      }),
    );
    registry.get.mockReturnValueOnce({
      ...adapter,
      authTypes: [IntegrationAuthType.NONE, IntegrationAuthType.BEARER_TOKEN],
    });

    await service.update(tenant, connection().id, { authType: IntegrationAuthType.NONE });

    expect(prisma.integrationConnection.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          authType: IntegrationAuthType.NONE,
          encryptedCredentials: null,
          scopes: [],
          providerAccountId: null,
          providerAccountLabel: null,
        }),
      }),
    );
  });

  it('bounds integration maintenance cleanup under an advisory lock', async () => {
    prisma.integrationOAuthState.findMany.mockResolvedValueOnce([{ id: 'oauth-1' }]);
    prisma.integrationActionIdempotencyRecord.findMany.mockResolvedValueOnce([{ id: 'idem-1' }]);
    prisma.integrationActionExecution.findMany.mockResolvedValueOnce([{ id: 'exec-1' }]);
    prisma.integrationOAuthState.deleteMany.mockResolvedValueOnce({ count: 1 });
    prisma.integrationActionIdempotencyRecord.deleteMany.mockResolvedValueOnce({ count: 1 });
    prisma.integrationActionExecution.deleteMany.mockResolvedValueOnce({ count: 1 });

    await expect(service.cleanupExpired(700)).resolves.toEqual({
      oauthStates: 1,
      idempotencyRecords: 1,
      actionExecutions: 1,
    });

    expect(prisma.integrationOAuthState.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 500 }),
    );
    expect(prisma.integrationActionIdempotencyRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 500 }),
    );
    expect(prisma.integrationActionExecution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 500 }),
    );
    expect(prisma.integrationOAuthState.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['oauth-1'] } },
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('skips integration maintenance cleanup when another instance owns the lock', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ locked: false }]);

    await expect(service.cleanupExpired()).resolves.toEqual({
      oauthStates: 0,
      idempotencyRecords: 0,
      actionExecutions: 0,
    });

    expect(prisma.integrationOAuthState.findMany).not.toHaveBeenCalled();
    expect(prisma.integrationActionIdempotencyRecord.findMany).not.toHaveBeenCalled();
    expect(prisma.integrationActionExecution.findMany).not.toHaveBeenCalled();
  });
});

function connection(overrides: Record<string, unknown> = {}) {
  return { ...baseConnection(), ...overrides };
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function baseConnection() {
  return {
    id: '00000000-0000-4000-8000-000000000020',
    workspaceId: tenant.workspaceId,
    provider: IntegrationProvider.SLACK,
    name: 'Slack',
    status: IntegrationStatus.CONNECTED,
    authType: IntegrationAuthType.BEARER_TOKEN,
    providerAccountId: null,
    providerAccountLabel: null,
    encryptedCredentials: 'encrypted',
    scopes: [],
    capabilities: ['channels.list', 'messages.send'],
    configurationJson: {},
    connectedByMembershipId: tenant.workspaceMembershipId as string,
    lastValidatedAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    safeErrorCode: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    revokedAt: null,
    workspace: {
      status: WorkspaceStatus.ACTIVE,
      agency: {
        status: AgencyStatus.ACTIVE,
        superAgency: { status: SuperAgencyStatus.ACTIVE },
      },
    },
  };
}
