import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import {
  AgencyStatus,
  ApiKeyStatus,
  MembershipStatus,
  SuperAgencyStatus,
  WorkspaceStatus,
} from '@prisma/client';
import { createHash } from 'crypto';
import { ApiKeysService } from './api-keys.service';
import { PublicApiRateLimitService } from './public-api-rate-limit.service';
import { PublicApiIdempotencyService } from './public-api-idempotency.service';
import { PublicApiScopeGuard } from './guards/public-api-scope.guard';
import { PublicProjectsController } from './public-projects.controller';
import { PublicTasksController } from './public-tasks.controller';
import { PublicTicketsController } from './public-tickets.controller';
import { LegacyProjectsController } from '../projects/projects.controller';

const tenant = {
  userId: '00000000-0000-4000-8000-000000000001',
  agencyId: '00000000-0000-4000-8000-000000000002',
  workspaceId: '00000000-0000-4000-8000-000000000003',
  workspaceMembershipId: '00000000-0000-4000-8000-000000000004',
  agencyMembershipId: null,
  roleId: '00000000-0000-4000-8000-000000000005',
  roleName: 'ADMIN',
  permissions: ['api_keys.view', 'api_keys.create', 'api_keys.manage'],
  accessSource: 'WORKSPACE_MEMBERSHIP' as const,
};

describe('Phase 14.1 public API foundation', () => {
  beforeEach(() => {
    process.env = {
      ...process.env,
      NODE_ENV: 'test',
      APP_ENV: 'test',
      WEB_APP_URL: 'http://localhost:3000',
      API_PUBLIC_URL: 'http://localhost:4000/api/v1',
      CORS_ORIGINS: 'http://localhost:3000',
      DATABASE_URL: 'postgresql://user:pass@localhost:6432/db',
      DIRECT_DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      REDIS_CACHE_URL: 'redis://localhost:6379',
      REDIS_QUEUE_URL: 'redis://localhost:6380',
      REDIS_REALTIME_URL: 'redis://localhost:6381',
      REDIS_RATE_LIMIT_URL: 'redis://localhost:6382',
      JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters',
      MINIO_ENDPOINT: 'localhost',
      MINIO_ACCESS_KEY: 'zea-play-dev-minio-access',
      MINIO_SECRET_KEY: 'zea-play-dev-minio-secret-at-least-32-chars',
      MINIO_BUCKET: 'zea-play-dev',
      EMAIL_FROM: 'no-reply@example.com',
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 'test-resend-api-key',
      OTP_PEPPER: 'test-otp-pepper-at-least-32-characters',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
      PUBLIC_API_KEY_RATE_LIMIT_PER_MINUTE: '2',
      PUBLIC_API_WORKSPACE_RATE_LIMIT_PER_MINUTE: '3',
      PUBLIC_API_IDEMPOTENCY_TTL_HOURS: '24',
    };
  });

  it('creates a split API key, stores only a hash, and lists without plaintext', async () => {
    const prisma = prismaMock();
    let createData: Record<string, unknown> | undefined;
    prisma.$transaction.mockImplementation((input: unknown) =>
      Promise.resolve(
        Array.isArray(input)
          ? Promise.all(input)
          : (input as (tx: typeof prisma) => unknown)(prisma),
      ),
    );
    prisma.apiKey.count.mockResolvedValue(0);
    prisma.apiKey.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => {
      createData = data;
      return Promise.resolve(apiKeyRecord(data));
    });
    prisma.apiKey.findMany.mockResolvedValue([apiKeyRecord({})]);
    prisma.apiKey.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    const service = new ApiKeysService(prisma as never, auditMock() as never);

    const created = await service.create(tenant, {
      name: 'Build bot',
      scopes: ['tasks.read'],
    });
    const listed = await service.list(tenant, { page: 1, pageSize: 25 });

    expect(created.plaintextApiKey).toMatch(/^zea_live_[A-Za-z0-9_-]+_[A-Za-z0-9_-]+$/);
    expect(createData?.secretHash).toEqual(expect.any(String));
    expect(created.plaintextApiKey).not.toContain(String(createData?.secretHash));
    expect(JSON.stringify(listed)).not.toContain(created.plaintextApiKey);
  });

  it('requires direct Workspace membership for API key list, update, and revoke management', async () => {
    const prisma = prismaMock();
    const service = new ApiKeysService(prisma as never, auditMock() as never);
    const parentTenant = {
      ...tenant,
      workspaceMembershipId: null,
      accessSource: 'AGENCY_ADMINISTRATION' as const,
    };

    await expect(service.list(parentTenant, { page: 1, pageSize: 25 })).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.update(parentTenant, 'api-key-1', { name: 'Name' })).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.revoke(parentTenant, 'api-key-1')).rejects.toThrow(BadRequestException);

    expect(prisma.apiKey.findMany).not.toHaveBeenCalled();
    expect(prisma.apiKey.findFirst).not.toHaveBeenCalled();
    expect(prisma.apiKey.update).not.toHaveBeenCalled();
  });

  it('authenticates valid bearer keys and generically rejects invalid, revoked, or expired keys', async () => {
    const prisma = prismaMock();
    const service = new ApiKeysService(prisma as never, auditMock() as never);
    const secret = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN';
    prisma.apiKey.findUnique.mockResolvedValue(authRecord(secret));

    await expect(
      service.authenticate(`Bearer zea_live_publicid01_${secret}`),
    ).resolves.toMatchObject({
      workspaceId: tenant.workspaceId,
      scopes: ['tasks.read'],
    });

    prisma.apiKey.findUnique.mockResolvedValueOnce(
      authRecord(secret, { status: ApiKeyStatus.REVOKED }),
    );
    await expect(service.authenticate(`Bearer zea_live_publicid01_${secret}`)).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(service.authenticate(`Bearer zea_live_publicid01_wrong${secret}`)).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(service.authenticate(undefined)).rejects.toThrow(UnauthorizedException);
    await expect(service.authenticate('Bearer not-a-zea-key')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('keeps active Workspace-owned keys valid if the creator membership is later inactive', async () => {
    const prisma = prismaMock();
    const service = new ApiKeysService(prisma as never, auditMock() as never);
    const secret = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN';
    prisma.apiKey.findUnique.mockResolvedValue(
      authRecord(secret, {
        createdByMembership: {
          id: tenant.workspaceMembershipId,
          userId: tenant.userId,
          status: MembershipStatus.SUSPENDED,
          roleId: tenant.roleId,
          role: { key: 'ADMIN' },
        },
      }),
    );

    await expect(
      service.authenticate(`Bearer zea_live_publicid01_${secret}`),
    ).resolves.toMatchObject({
      apiKeyId: '00000000-0000-4000-8000-000000000010',
      workspaceId: tenant.workspaceId,
      tenant: expect.objectContaining({
        roleName: 'API_KEY',
        workspaceMembershipId: tenant.workspaceMembershipId,
      }),
    });
  });

  it('rejects otherwise valid API keys when the parent hierarchy is suspended', async () => {
    const prisma = prismaMock();
    const service = new ApiKeysService(prisma as never, auditMock() as never);
    const secret = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN';
    prisma.apiKey.findUnique.mockResolvedValue(
      authRecord(secret, {
        workspace: {
          id: tenant.workspaceId,
          agencyId: tenant.agencyId,
          status: WorkspaceStatus.ACTIVE,
          agency: {
            status: AgencyStatus.ACTIVE,
            superAgency: { status: SuperAgencyStatus.SUSPENDED },
          },
        },
      }),
    );

    await expect(service.authenticate(`Bearer zea_live_publicid01_${secret}`)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects otherwise valid API keys when the Super Agency is archived', async () => {
    const prisma = prismaMock();
    const service = new ApiKeysService(prisma as never, auditMock() as never);
    const secret = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN';
    prisma.apiKey.findUnique.mockResolvedValue(
      authRecord(secret, {
        workspace: {
          id: tenant.workspaceId,
          agencyId: tenant.agencyId,
          status: WorkspaceStatus.ACTIVE,
          agency: {
            status: AgencyStatus.ACTIVE,
            superAgency: { status: SuperAgencyStatus.ARCHIVED },
          },
        },
      }),
    );

    await expect(service.authenticate(`Bearer zea_live_publicid01_${secret}`)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects persisted scopes outside the public allowlist', async () => {
    const prisma = prismaMock();
    const service = new ApiKeysService(prisma as never, auditMock() as never);
    const secret = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN';
    prisma.apiKey.findUnique.mockResolvedValue(authRecord(secret, { scopes: ['workspace.*'] }));

    await expect(service.authenticate(`Bearer zea_live_publicid01_${secret}`)).rejects.toThrow(
      'PUBLIC_API_SCOPE_UNSUPPORTED',
    );
  });

  it('enforces public scopes without wildcard bypass', async () => {
    const guard = new PublicApiScopeGuard({
      getAllAndOverride: () => ['projects.read'],
    } as unknown as Reflector);

    await expect(guard.canActivate(scopeContext({ scopes: ['tasks.read'] }))).rejects.toThrow(
      ForbiddenException,
    );
    await expect(guard.canActivate(scopeContext({ scopes: ['projects.read'] }))).resolves.toBe(
      true,
    );
    await expect(guard.canActivate(scopeContext({ scopes: ['*'] }))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('keeps read/write semantics resource-specific across public scopes', async () => {
    const projectReadGuard = new PublicApiScopeGuard({
      getAllAndOverride: () => ['projects.read', 'projects.write'],
    } as unknown as Reflector);
    const ticketWriteGuard = new PublicApiScopeGuard({
      getAllAndOverride: () => ['tickets.write'],
    } as unknown as Reflector);

    await expect(
      projectReadGuard.canActivate(scopeContext({ scopes: ['projects.write'] })),
    ).resolves.toBe(true);
    await expect(
      projectReadGuard.canActivate(scopeContext({ scopes: ['tasks.write'] })),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      ticketWriteGuard.canActivate(scopeContext({ scopes: ['projects.write'] })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('does not consume commercial API quota for insufficient scopes', async () => {
    const billing = { reservePublicApiRequestUsage: jest.fn() };
    const guard = new PublicApiScopeGuard(
      { getAllAndOverride: () => ['tasks.write'] } as unknown as Reflector,
      undefined,
      billing as never,
    );

    await expect(guard.canActivate(scopeContext({ scopes: ['tasks.read'] }))).rejects.toThrow(
      ForbiddenException,
    );

    expect(billing.reservePublicApiRequestUsage).not.toHaveBeenCalled();
  });

  it('reserves commercial API quota after scope authorization for GET and write requests', async () => {
    const billing = { reservePublicApiRequestUsage: jest.fn().mockResolvedValue(true) };
    const guard = new PublicApiScopeGuard(
      { getAllAndOverride: () => ['tasks.read'] } as unknown as Reflector,
      undefined,
      billing as never,
    );

    await expect(
      guard.canActivate(scopeContext({ scopes: ['tasks.read'], method: 'GET' })),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(scopeContext({ scopes: ['tasks.read'], method: 'POST' })),
    ).resolves.toBe(true);

    expect(billing.reservePublicApiRequestUsage).toHaveBeenCalledTimes(2);
    expect(billing.reservePublicApiRequestUsage).toHaveBeenCalledWith(tenant.workspaceId);
  });

  it('registers public resource controllers under a non-conflicting route family', () => {
    expect(Reflect.getMetadata(PATH_METADATA, PublicTasksController)).toBe('public/tasks');
    expect(Reflect.getMetadata(PATH_METADATA, PublicProjectsController)).toBe('public/projects');
    expect(Reflect.getMetadata(PATH_METADATA, PublicTicketsController)).toBe('public/tickets');
    expect(Reflect.getMetadata(PATH_METADATA, LegacyProjectsController)).toBe('projects');
  });

  it('rate limits by API key and Workspace without using the plaintext secret', async () => {
    const exec = jest.fn().mockResolvedValue([
      [null, 1],
      [null, 1],
    ]);
    const keys: string[] = [];
    const multi = jest.fn(() => {
      const pipeline: {
        incr: jest.Mock;
        expire: jest.Mock;
        exec: jest.Mock;
      } = {
        incr: jest.fn((key: string) => {
          keys.push(key);
          return pipeline;
        }),
        expire: jest.fn().mockReturnThis(),
        exec,
      };
      return pipeline;
    });
    const redis = { rateLimit: { multi } };
    const limiter = new PublicApiRateLimitService(redis as never);
    await limiter.assertWithinLimit(publicPrincipal());

    expect(keys.join(' ')).toContain('key:api-key-1');
    expect(keys.join(' ')).toContain('workspace:');
    expect(keys.join(' ')).not.toContain('secret');

    exec
      .mockResolvedValueOnce([
        [null, 3],
        [null, 1],
      ])
      .mockResolvedValueOnce([
        [null, 1],
        [null, 1],
      ]);
    await expect(limiter.assertWithinLimit(publicPrincipal())).rejects.toMatchObject({
      status: 429,
    });
  });

  it('rate limits multiple API keys through the same Workspace aggregate bucket', async () => {
    const keys: string[] = [];
    const exec = jest.fn().mockResolvedValue([
      [null, 1],
      [null, 1],
    ]);
    const redis = {
      rateLimit: {
        multi: jest.fn(() => {
          const pipeline: {
            incr: jest.Mock;
            expire: jest.Mock;
            exec: jest.Mock;
          } = {
            incr: jest.fn((key: string) => {
              keys.push(key);
              return pipeline;
            }),
            expire: jest.fn().mockReturnThis(),
            exec,
          };
          return pipeline;
        }),
      },
    };
    const limiter = new PublicApiRateLimitService(redis as never);
    await limiter.assertWithinLimit(publicPrincipal('api-key-1'));
    await limiter.assertWithinLimit(publicPrincipal('api-key-2'));

    expect(keys.some((key) => key.includes('key:api-key-1'))).toBe(true);
    expect(keys.some((key) => key.includes('key:api-key-2'))).toBe(true);
    expect(keys.filter((key) => key.includes(`workspace:${tenant.workspaceId}`))).toHaveLength(2);
  });

  it('reuses idempotent create responses and rejects body drift', async () => {
    const prisma = prismaMock();
    const service = new PublicApiIdempotencyService(prisma as never);
    prisma.$transaction.mockImplementation((callback: (tx: typeof prisma) => unknown) =>
      Promise.resolve(callback(prisma)),
    );
    prisma.apiIdempotencyRecord.findUnique.mockResolvedValueOnce(null);
    prisma.apiIdempotencyRecord.create.mockResolvedValue({});
    prisma.apiIdempotencyRecord.update.mockResolvedValue({});
    const handler = jest.fn().mockResolvedValue({ id: '00000000-0000-4000-8000-000000000099' });

    await expect(
      service.run(publicPrincipal(), {
        key: 'create-1',
        method: 'POST',
        routeKey: '/api/v1/public/tasks',
        body: { title: 'A' },
        handler,
      }),
    ).resolves.toEqual({ id: '00000000-0000-4000-8000-000000000099' });
    expect(handler).toHaveBeenCalledTimes(1);

    prisma.apiIdempotencyRecord.findUnique.mockResolvedValueOnce({
      requestFingerprint: 'different',
      status: 'COMPLETED',
      responseBody: { id: 'old' },
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(
      service.run(publicPrincipal(), {
        key: 'create-1',
        method: 'POST',
        routeKey: '/api/v1/public/tasks',
        body: { title: 'B' },
        handler,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('scopes idempotency identity by API key and route', async () => {
    const prisma = prismaMock();
    const service = new PublicApiIdempotencyService(prisma as never);
    prisma.$transaction.mockImplementation((callback: (tx: typeof prisma) => unknown) =>
      Promise.resolve(callback(prisma)),
    );
    prisma.apiIdempotencyRecord.findUnique.mockResolvedValue(null);
    prisma.apiIdempotencyRecord.create.mockResolvedValue({});
    prisma.apiIdempotencyRecord.update.mockResolvedValue({});
    const handler = jest.fn().mockResolvedValue({ id: '00000000-0000-4000-8000-000000000099' });

    await service.run(publicPrincipal('api-key-1'), {
      key: 'same-key',
      method: 'POST',
      routeKey: '/api/v1/public/tasks',
      body: { title: 'A' },
      handler,
    });
    await service.run(publicPrincipal('api-key-2'), {
      key: 'same-key',
      method: 'POST',
      routeKey: '/api/v1/public/projects',
      body: { name: 'A' },
      handler,
    });

    expect(prisma.apiIdempotencyRecord.create.mock.calls[0]?.[0].data.apiKeyId).toBe('api-key-1');
    expect(prisma.apiIdempotencyRecord.create.mock.calls[1]?.[0].data.apiKeyId).toBe('api-key-2');
    expect(prisma.apiIdempotencyRecord.create.mock.calls[0]?.[0].data.routeKey).toBe(
      '/api/v1/public/tasks',
    );
    expect(prisma.apiIdempotencyRecord.create.mock.calls[1]?.[0].data.routeKey).toBe(
      '/api/v1/public/projects',
    );
  });

  it('public Task controller wraps canonical service output and derives tenant from the key', async () => {
    const tasks = {
      list: jest
        .fn()
        .mockResolvedValue({ items: [{ id: 'task-1' }], page: 1, pageSize: 25, total: 1 }),
      get: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 'task-2' }),
      update: jest.fn(),
    };
    const idempotency = {
      run: jest.fn((_principal, { handler }) => handler()),
    };
    const controller = new PublicTasksController(tasks as never, idempotency as never);
    const principal = publicPrincipal();

    await expect(controller.list(principal, { page: 1, pageSize: 25 } as never)).resolves.toEqual({
      data: [{ id: 'task-1' }],
      meta: { page: 1, pageSize: 25, total: 1 },
    });
    await expect(
      controller.create(
        principal,
        { title: 'Task' } as never,
        {
          header: () => 'idem-1',
        } as never,
      ),
    ).resolves.toEqual({ data: { id: 'task-2' } });
    expect(tasks.list).toHaveBeenCalledWith(principal.tenant, expect.any(Object));
    expect(tasks.create).toHaveBeenCalledWith(principal.tenant, { title: 'Task' });
  });

  it('public Project and Ticket controllers use canonical services with the API-key tenant', async () => {
    const projects = {
      list: jest
        .fn()
        .mockResolvedValue({ items: [{ id: 'project-1' }], page: 1, pageSize: 20, total: 1 }),
      get: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 'project-2' }),
      update: jest.fn().mockResolvedValue({ id: 'project-2' }),
    };
    const tickets = {
      list: jest
        .fn()
        .mockResolvedValue({ items: [{ id: 'ticket-1' }], page: 1, pageSize: 20, total: 1 }),
      get: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 'ticket-2' }),
      update: jest.fn().mockResolvedValue({ id: 'ticket-2' }),
    };
    const idempotency = { run: jest.fn((_principal, { handler }) => handler()) };
    const principal = publicPrincipal();

    const projectController = new PublicProjectsController(projects as never, idempotency as never);
    const ticketController = new PublicTicketsController(tickets as never, idempotency as never);
    await projectController.create(
      principal,
      { name: 'Project', workspaceId: 'foreign' } as never,
      {
        header: () => 'project-1',
      } as never,
    );
    await ticketController.create(
      principal,
      {
        subject: 'Ticket',
        requester: { type: 'EXTERNAL', name: 'Customer' },
        workspaceId: 'foreign',
      } as never,
      { header: () => 'ticket-1' } as never,
    );

    expect(projects.create).toHaveBeenCalledWith(
      principal.tenant,
      expect.objectContaining({ name: 'Project' }),
    );
    expect(tickets.create).toHaveBeenCalledWith(
      principal.tenant,
      expect.objectContaining({ subject: 'Ticket' }),
    );
  });
});

function prismaMock() {
  return {
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    apiKey: {
      count: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    apiIdempotencyRecord: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
}

function auditMock() {
  return { record: jest.fn().mockResolvedValue(undefined) };
}

function apiKeyRecord(data: Record<string, unknown>) {
  return {
    id: '00000000-0000-4000-8000-000000000010',
    workspaceId: tenant.workspaceId,
    name: data.name ?? 'Build bot',
    description: null,
    prefix: data.prefix ?? 'zea_live_publicid01',
    status: ApiKeyStatus.ACTIVE,
    scopes: data.scopes ?? ['tasks.read'],
    expiresAt: null,
    lastUsedAt: null,
    revokedAt: null,
    createdAt: new Date('2026-09-24T00:00:00.000Z'),
    createdByMembership: {
      id: tenant.workspaceMembershipId,
      user: { id: tenant.userId, email: 'owner@zeaplay.test', name: 'Owner' },
    },
  };
}

function authRecord(secret: string, overrides: Record<string, unknown> = {}) {
  return {
    ...apiKeyRecord({ scopes: ['tasks.read'] }),
    secretHash: createHash('sha256').update(secret).digest('hex'),
    workspace: {
      id: tenant.workspaceId,
      agencyId: tenant.agencyId,
      status: WorkspaceStatus.ACTIVE,
      agency: {
        status: AgencyStatus.ACTIVE,
        superAgency: { status: SuperAgencyStatus.ACTIVE },
      },
    },
    createdByMembership: {
      id: tenant.workspaceMembershipId,
      userId: tenant.userId,
      status: MembershipStatus.ACTIVE,
      roleId: tenant.roleId,
      role: { key: 'ADMIN' },
    },
    ...overrides,
  };
}

function publicPrincipal(apiKeyId = 'api-key-1') {
  return {
    apiKeyId,
    workspaceId: tenant.workspaceId,
    agencyId: tenant.agencyId,
    createdByMembershipId: tenant.workspaceMembershipId,
    createdByUserId: tenant.userId,
    prefix: 'zea_live_publicid01',
    scopes: ['tasks.read' as const],
    tenant,
  };
}

function scopeContext(publicApi: { scopes: string[]; method?: string }) {
  const principal = { ...publicPrincipal(), scopes: publicApi.scopes };
  return {
    getHandler: () => null,
    getClass: () => null,
    switchToHttp: () => ({
      getRequest: () => ({ publicApi: principal, method: publicApi.method }),
    }),
  } as never;
}
