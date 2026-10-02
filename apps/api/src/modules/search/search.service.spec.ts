import { BadRequestException } from '@nestjs/common';
import {
  AnalyticsScopeType,
  DocStatus,
  DocVisibility,
  Prisma,
  SearchPrivacyClass,
  SearchResultType,
} from '@prisma/client';
import { PermissionKeys } from '../../common/authorization/permissions';
import { SearchService } from './search.service';

const workspaceScope = {
  type: AnalyticsScopeType.WORKSPACE,
  id: '11111111-1111-4111-8111-111111111111',
  workspaceId: '11111111-1111-4111-8111-111111111111',
  agencyId: '22222222-2222-4222-8222-222222222222',
  superAgencyId: '33333333-3333-4333-8333-333333333333',
};

const actor = {
  userId: '44444444-4444-4444-8444-444444444444',
  permissions: [PermissionKeys.searchView, PermissionKeys.docsView, PermissionKeys.tasksView],
  workspaceMembershipId: '55555555-5555-4555-8555-555555555555',
  agencyMembershipId: null,
  superAgencyMembershipId: null,
};

describe('SearchService', () => {
  it('rejects broad empty and one-character searches', async () => {
    const service = new SearchService(mockPrisma() as never, mockRedis() as never);

    await expect(service.search(workspaceScope, actor, { q: 'a' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('post-filters ACL-sensitive docs against canonical Doc access', async () => {
    const prisma = mockPrisma();
    prisma.$queryRaw.mockResolvedValue([
      row({
        entity_type: SearchResultType.DOC,
        privacy_class: SearchPrivacyClass.ACL_SENSITIVE,
        metadata: { visibility: DocVisibility.SELECTED_MEMBERS },
      }),
    ]);
    prisma.doc.findFirst.mockResolvedValue({
      status: DocStatus.ACTIVE,
      visibility: DocVisibility.SELECTED_MEMBERS,
      createdByMembershipId: 'other-member',
      accessList: [],
    });
    const service = new SearchService(prisma as never, mockRedis() as never);

    const result = await service.search(workspaceScope, actor, { q: 'roadmap', types: ['DOC'] });

    expect(result.results).toHaveLength(0);
    expect(prisma.doc.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: expect.any(String), workspaceId: workspaceScope.id }),
      }),
    );
  });

  it('allows ACL-sensitive docs when the actor has canonical Doc access', async () => {
    const prisma = mockPrisma();
    prisma.$queryRaw.mockResolvedValue([
      row({
        entity_type: SearchResultType.DOC,
        privacy_class: SearchPrivacyClass.ACL_SENSITIVE,
        metadata: { visibility: DocVisibility.PRIVATE },
      }),
    ]);
    prisma.doc.findFirst.mockResolvedValue({
      status: DocStatus.ACTIVE,
      visibility: DocVisibility.PRIVATE,
      createdByMembershipId: actor.workspaceMembershipId,
      accessList: [],
    });
    const service = new SearchService(prisma as never, mockRedis() as never);

    const result = await service.search(workspaceScope, actor, { q: 'roadmap', types: ['DOC'] });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.type).toBe(SearchResultType.DOC);
  });

  it('preserves Tamil Unicode queries through the search path', async () => {
    const prisma = mockPrisma();
    prisma.$queryRaw.mockResolvedValue([
      row({
        title: 'தமிழ் இலக்கு',
        snippet: 'தமிழ் இலக்கு',
        entity_type: SearchResultType.DOC,
        metadata: { visibility: DocVisibility.WORKSPACE },
      }),
    ]);
    prisma.doc.findFirst.mockResolvedValue({
      status: DocStatus.ACTIVE,
      visibility: DocVisibility.WORKSPACE,
      createdByMembershipId: 'other-member',
      accessList: [],
    });
    const service = new SearchService(prisma as never, mockRedis() as never);

    const result = await service.search(workspaceScope, actor, { q: 'தமிழ்', types: ['DOC'] });

    expect(result.query).toBe('தமிழ்');
    expect(result.results[0]?.title).toBe('தமிழ் இலக்கு');
  });

  it('stores recent searches with actor and explicit scope identity', async () => {
    const prisma = mockPrisma();
    prisma.$queryRaw.mockResolvedValue([row({ entity_type: SearchResultType.TASK })]);
    const service = new SearchService(prisma as never, mockRedis() as never);

    await service.search(workspaceScope, actor, { q: 'invoice', types: ['TASK'] });

    expect(prisma.recentSearch.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_scopeType_scopeId_queryNormalized: {
            userId: actor.userId,
            scopeType: workspaceScope.type,
            scopeId: workspaceScope.id,
            queryNormalized: 'invoice',
          },
        },
        create: expect.objectContaining({
          workspaceMembershipId: actor.workspaceMembershipId,
          resultTypes: [SearchResultType.TASK],
        }),
      }),
    );
  });

  it('returns only scope-supported registry entries', () => {
    const service = new SearchService(mockPrisma() as never, mockRedis() as never);

    const registry = service.registry(AnalyticsScopeType.AGENCY);

    expect(registry.engine).toBe('POSTGRESQL');
    expect(registry.types.every((type) => type.scopes.includes('AGENCY'))).toBe(true);
    expect(registry.types.some((type) => type.key === 'FILE')).toBe(false);
  });

  it('does not let stale source updates overwrite newer indexed documents', async () => {
    const prisma = mockPrisma();
    prisma.searchDocument.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    prisma.searchDocument.updateMany.mockResolvedValue({ count: 0 });
    prisma.searchDocument.findUnique.mockResolvedValue({ id: 'current-index-row' });
    const service = new SearchService(prisma as never, mockRedis() as never);

    await service.upsertDocument({
      scope: workspaceScope,
      entityType: SearchResultType.DOC,
      entityId: '77777777-7777-4777-8777-777777777777',
      title: 'Older title',
      searchText: 'Older body',
      route: { href: '/workspace/docs?doc=77777777-7777-4777-8777-777777777777' },
      privacyClass: SearchPrivacyClass.ACL_SENSITIVE,
      sourceUpdatedAt: new Date('2026-09-29T01:00:00.000Z'),
      sourceVersion: 5,
    });

    expect(prisma.searchDocument.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { sourceVersion: { lt: 5 } },
            { sourceVersion: 5, sourceUpdatedAt: { lte: new Date('2026-09-29T01:00:00.000Z') } },
          ],
        }),
      }),
    );
  });

  it('returns a safe timeout error when PostgreSQL cancels the search statement', async () => {
    const prisma = mockPrisma();
    prisma.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('canceling statement due to statement timeout', {
        code: 'P2010',
        clientVersion: 'test',
        meta: { code: '57014' },
      }),
    );
    const service = new SearchService(prisma as never, mockRedis() as never);

    await expect(
      service.search(workspaceScope, actor, { q: 'roadmap', types: ['DOC'] }),
    ).rejects.toMatchObject({
      response: { code: 'SEARCH_QUERY_TIMEOUT' },
    });
  });

  it('rate limits abusive search bursts by actor and scope', async () => {
    const prisma = mockPrisma();
    prisma.$queryRaw.mockResolvedValue([]);
    const redis = mockRedis();
    redis.rateLimit.multi.mockReturnValue({
      incr: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([[null, 91]]),
    });
    const service = new SearchService(prisma as never, redis as never);

    await expect(
      service.search(workspaceScope, actor, { q: 'roadmap', types: ['DOC'] }),
    ).rejects.toMatchObject({
      response: { code: 'SEARCH_RATE_LIMITED' },
    });
  });
});

function mockPrisma() {
  const queryRaw = jest.fn();
  const prisma = {
    $queryRaw: queryRaw,
    $executeRaw: jest.fn(),
    $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
      Promise.resolve(callback({ $executeRaw: jest.fn(), $queryRaw: queryRaw })),
    ),
    searchDocument: {
      create: jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      deleteMany: jest.fn(),
      upsert: jest.fn(),
    },
    searchIndexJob: { create: jest.fn(), update: jest.fn() },
    recentSearch: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    doc: { findFirst: jest.fn() },
    project: { findFirst: jest.fn() },
    workspace: { findUnique: jest.fn(), findMany: jest.fn() },
    agency: { findUnique: jest.fn(), findMany: jest.fn() },
    superAgency: { findUnique: jest.fn(), findMany: jest.fn() },
    task: { findMany: jest.fn() },
    ticket: { findMany: jest.fn() },
    form: { findMany: jest.fn() },
    goal: { findMany: jest.fn() },
    asset: { findMany: jest.fn() },
    workspaceMembership: { findMany: jest.fn() },
    automationWorkflow: { findMany: jest.fn() },
    apiKey: { findMany: jest.fn() },
    webhookSubscription: { findMany: jest.fn() },
    integrationConnection: { findMany: jest.fn() },
    billingInvoice: { findMany: jest.fn() },
  };
  return prisma;
}

function mockRedis() {
  return {
    cache: {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
    },
    rateLimit: {
      multi: jest.fn(() => ({
        incr: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([[null, 1]]),
      })),
    },
  };
}

function row(overrides: Partial<Record<string, unknown>>) {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    scope_type: AnalyticsScopeType.WORKSPACE,
    scope_id: workspaceScope.id,
    workspace_id: workspaceScope.id,
    agency_id: workspaceScope.agencyId,
    super_agency_id: workspaceScope.superAgencyId,
    entity_type: SearchResultType.TASK,
    entity_id: '77777777-7777-4777-8777-777777777777',
    title: 'Invoice follow-up',
    subtitle: 'HIGH',
    metadata: {},
    route: { href: '/workspace/tasks?task=77777777-7777-4777-8777-777777777777' },
    privacy_class: SearchPrivacyClass.WORKSPACE_OPERATIONAL,
    archived: false,
    source_updated_at: new Date('2026-09-29T00:00:00.000Z'),
    indexed_at: new Date('2026-09-29T00:00:00.000Z'),
    score: 100,
    snippet: 'Invoice follow-up',
    ...overrides,
  };
}
