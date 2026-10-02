import { Prisma, SearchIndexOperation, SearchPrivacyClass, SearchResultType } from '@prisma/client';
import type { Job } from 'bullmq';
import { SEARCH_INDEX_JOB_TYPE } from '../queue/queue.constants';
import { SearchIndexProcessor } from './search-index.processor';

describe('SearchIndexProcessor', () => {
  it('reloads canonical task data and indexes parent rows with safe metadata only', async () => {
    const prisma = mockPrisma();
    prisma.task.findUnique.mockResolvedValue({
      id: 'task-1',
      workspaceId: 'workspace-1',
      title: 'Renewal review',
      description: 'workspace-only internal detail',
      priority: 'HIGH',
      statusDefinitionId: 'status-1',
      archivedAt: null,
      deletedAt: null,
      updatedAt: new Date('2026-09-29T01:00:00.000Z'),
      workspace: {
        agencyId: 'agency-1',
        agency: { superAgencyId: 'super-agency-1' },
      },
    });
    const processor = new SearchIndexProcessor(prisma as never);

    await processor.process(
      job({
        operation: SearchIndexOperation.UPSERT,
        entityType: SearchResultType.TASK,
        entityId: 'task-1',
      }),
    );

    expect(prisma.task.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'task-1' } }),
    );
    expect(prisma.searchDocument.create).toHaveBeenCalledTimes(3);
    const parentCalls = prisma.searchDocument.create.mock.calls.filter(
      ([arg]) => arg.data.privacyClass === SearchPrivacyClass.PARENT_SAFE_METADATA,
    );
    expect(parentCalls).toHaveLength(2);
    for (const [arg] of parentCalls) {
      expect(arg.data.searchText).toBe('Renewal review HIGH');
      expect(arg.data.searchText).not.toContain('workspace-only internal detail');
      expect(arg.data.scopeType).not.toBe('WORKSPACE');
    }
  });

  it('uses freshness predicates when a second worker races the same document', async () => {
    const prisma = mockPrisma();
    prisma.task.findUnique.mockResolvedValue({
      id: 'task-1',
      workspaceId: 'workspace-1',
      title: 'Renewal review',
      description: 'details',
      priority: 'HIGH',
      statusDefinitionId: 'status-1',
      archivedAt: null,
      deletedAt: null,
      updatedAt: new Date('2026-09-29T02:00:00.000Z'),
      workspace: {
        agencyId: 'agency-1',
        agency: { superAgencyId: 'super-agency-1' },
      },
    });
    prisma.searchDocument.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    const processor = new SearchIndexProcessor(prisma as never);

    await processor.process(
      job({
        operation: SearchIndexOperation.UPSERT,
        entityType: SearchResultType.TASK,
        entityId: 'task-1',
        sourceUpdatedAt: '2026-09-29T01:00:00.000Z',
      }),
    );

    expect(prisma.searchDocument.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { sourceVersion: { lt: 1 } },
            {
              sourceVersion: 1,
              sourceUpdatedAt: { lte: new Date('2026-09-29T02:00:00.000Z') },
            },
          ],
        }),
      }),
    );
  });
});

function job(data: unknown) {
  return { name: SEARCH_INDEX_JOB_TYPE, data } as Job;
}

function mockPrisma() {
  return {
    searchIndexJob: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn(),
    },
    searchDocument: {
      create: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn(),
    },
    task: { findUnique: jest.fn(), findMany: jest.fn() },
    project: { findUnique: jest.fn(), findMany: jest.fn() },
    ticket: { findUnique: jest.fn(), findMany: jest.fn() },
    doc: { findUnique: jest.fn(), findMany: jest.fn() },
    form: { findUnique: jest.fn(), findMany: jest.fn() },
    goal: { findUnique: jest.fn(), findMany: jest.fn() },
    asset: { findUnique: jest.fn(), findMany: jest.fn() },
    workspaceMembership: { findUnique: jest.fn(), findMany: jest.fn() },
    automationWorkflow: { findUnique: jest.fn(), findMany: jest.fn() },
    apiKey: { findUnique: jest.fn(), findMany: jest.fn() },
    webhookSubscription: { findUnique: jest.fn(), findMany: jest.fn() },
    integrationConnection: { findUnique: jest.fn(), findMany: jest.fn() },
    workspace: { findUnique: jest.fn(), findMany: jest.fn() },
    agency: { findUnique: jest.fn(), findMany: jest.fn() },
    superAgency: { findUnique: jest.fn(), findMany: jest.fn() },
    billingInvoice: { findUnique: jest.fn(), findMany: jest.fn() },
  };
}
