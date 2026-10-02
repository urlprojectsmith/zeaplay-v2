import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  AnalyticsScopeType,
  DocVisibility,
  MembershipStatus,
  Prisma,
  RoleScope,
  SearchIndexOperation,
  SearchPrivacyClass,
  SearchResultType,
} from '@prisma/client';
import type { Job } from 'bullmq';
import { PermissionKeys } from '../src/common/authorization/permissions';
import { PrismaService } from '../src/infrastructure/database/prisma.service';
import { SearchService, SEARCH_STATEMENT_TIMEOUT_MS } from '../src/modules/search/search.service';

jest.setTimeout(60_000);

const SEARCH_INDEX_JOB_TYPE = 'search.index';
const loadWorkerModule = createRequire(__filename);

describe('Phase 17.3 real PostgreSQL Search integration', () => {
  let prisma: PrismaService;
  let service: SearchService;
  let processor: SearchIndexProcessorHarness;
  let SearchIndexProcessorClass: new (prisma: never) => SearchIndexProcessorHarness;
  let cache: Map<string, string>;
  let ids: SeedIds;

  beforeAll(async () => {
    expect(process.env.DATABASE_URL).toBeTruthy();
    const workerModulePath = [
      '..',
      '..',
      'worker',
      'src',
      'processors',
      'search-index.processor',
    ].join('/');
    const workerModule = loadWorkerModule(workerModulePath) as {
      SearchIndexProcessor: new (prisma: never) => SearchIndexProcessorHarness;
    };
    SearchIndexProcessorClass = workerModule.SearchIndexProcessor;
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterAll(async () => {
    await cleanup(prisma, ids).catch(() => undefined);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    ids = makeIds();
    cache = new Map();
    service = new SearchService(prisma, redisHarness(cache) as never);
    processor = new SearchIndexProcessorClass(prisma as never);
    await cleanup(prisma, ids);
    await seedTenant(prisma, ids);
  });

  afterEach(async () => {
    await cleanup(prisma, ids);
  });

  it('uses real FTS, prefix, trigram, Tamil text, ranking, cache isolation, and recent history', async () => {
    const scope = workspaceScope(ids);
    const actor = workspaceActor(ids.userA, ids.membershipA);
    const otherActor = workspaceActor(ids.userB, ids.membershipB);
    await indexSearchFixtures(service, scope, ids);

    const exact = await service.search(scope, actor, {
      q: 'aurora',
      types: ['TASK'],
      saveRecent: false,
      pageSize: 10,
    });
    expect(exact.results.map((item: SearchResult) => item.title)).toContain('aurora');
    expect(exact.results[0]?.title).toBe('aurora');

    const prefix = await service.search(scope, actor, {
      q: 'prefix',
      types: ['TASK'],
      saveRecent: false,
    });
    expect(prefix.results[0]?.title).toBe('prefix-harbor launch');

    const fts = await service.search(scope, actor, {
      q: 'retention',
      types: ['TASK'],
      saveRecent: false,
    });
    expect(fts.results[0]?.title).toBe('Metrics workbook');

    const fuzzy = await service.search(scope, actor, {
      q: 'suport',
      types: ['TASK'],
      saveRecent: false,
    });
    expect(fuzzy.results[0]?.title).toBe('Support Atlas');

    const tamil = await service.search(scope, actor, {
      q: 'தமிழ்',
      types: ['TASK'],
      saveRecent: false,
    });
    expect(tamil.results[0]?.title).toContain('தமிழ்');
    expect(tamil.results[0]?.snippet).toContain('தமிழ்');

    await prisma.docAccess.create({
      data: {
        id: ids.docAccess,
        docId: ids.selectedDoc,
        workspaceId: ids.workspace,
        membershipId: ids.membershipA,
        grantedByMembershipId: ids.membershipA,
      },
    });
    await indexDoc(service, scope, ids.selectedDoc, 'Selected cache doc', 'selectedsecret', {
      visibility: DocVisibility.SELECTED_MEMBERS,
    });
    const selected = await service.search(scope, actor, {
      q: 'selectedsecret',
      types: ['DOC'],
      saveRecent: false,
    });
    expect(selected.results).toHaveLength(1);
    expect(cache.size).toBeGreaterThan(0);

    const isolated = await service.search(scope, otherActor, {
      q: 'selectedsecret',
      types: ['DOC'],
      saveRecent: false,
    });
    expect(isolated.results).toHaveLength(0);

    await service.search(scope, actor, { q: 'recent-alpha', types: ['TASK'] });
    await service.search(scope, actor, { q: 'recent-alpha', types: ['TASK'] });
    await service.search(scope, otherActor, { q: 'recent-beta', types: ['TASK'] });
    await expect(service.recent(scope, actor)).resolves.toMatchObject({
      searches: [{ query: 'recent-alpha' }],
    });
    await expect(service.recent(scope, otherActor)).resolves.toMatchObject({
      searches: [{ query: 'recent-beta' }],
    });
  });

  it('rechecks canonical Doc visibility, ACL, and module permission even when the index is stale', async () => {
    const scope = workspaceScope(ids);
    const actor = workspaceActor(ids.userB, ids.membershipB);
    await indexDoc(service, scope, ids.workspaceDoc, 'Visible stale doc', 'staledoc', {
      visibility: DocVisibility.WORKSPACE,
    });

    await expect(searchTitles(service, scope, actor, 'staledoc')).resolves.toContain(
      'Visible stale doc',
    );
    await prisma.doc.update({
      where: { id: ids.workspaceDoc },
      data: { visibility: DocVisibility.PRIVATE },
    });
    await expect(searchTitles(service, scope, actor, 'staledoc')).resolves.not.toContain(
      'Visible stale doc',
    );

    await indexDoc(service, scope, ids.selectedDoc, 'Selected stale doc', 'aclremovedoc', {
      visibility: DocVisibility.SELECTED_MEMBERS,
    });
    await prisma.docAccess.create({
      data: {
        id: ids.docAccess,
        docId: ids.selectedDoc,
        workspaceId: ids.workspace,
        membershipId: ids.membershipB,
        grantedByMembershipId: ids.membershipA,
      },
    });
    await expect(searchTitles(service, scope, actor, 'aclremovedoc')).resolves.toContain(
      'Selected stale doc',
    );
    await prisma.docAccess.delete({ where: { id: ids.docAccess } });
    await expect(searchTitles(service, scope, actor, 'aclremovedoc')).resolves.not.toContain(
      'Selected stale doc',
    );

    const noDocsActor = {
      ...actor,
      permissions: [PermissionKeys.searchView],
    };
    await expect(searchTitles(service, scope, noDocsActor, 'aclremovedoc')).resolves.toHaveLength(
      0,
    );
  });

  it('enforces server-side rate limiting and uses transaction-local statement timeout', async () => {
    const scope = workspaceScope(ids);
    const actor = workspaceActor(randomUUID(), randomUUID());
    await indexSearchFixtures(service, scope, ids);

    for (let index = 0; index < 90; index += 1) {
      await expect(
        service.search(scope, actor, {
          q: 'aurora',
          types: ['TASK'],
          saveRecent: false,
        }),
      ).resolves.toMatchObject({ query: 'aurora' });
    }
    await expect(
      service.search(scope, actor, { q: 'aurora', types: ['TASK'], saveRecent: false }),
    ).rejects.toMatchObject({ status: 429 });

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `SELECT set_config('statement_timeout', '${SEARCH_STATEMENT_TIMEOUT_MS}', true)`,
        );
        const rows = await tx.$queryRawUnsafe<Array<{ value: string }>>(
          `SELECT current_setting('statement_timeout') AS value`,
        );
        return rows[0]?.value;
      }),
    ).resolves.toBe(`${SEARCH_STATEMENT_TIMEOUT_MS}ms`);
  });

  it('indexes every registered workspace module through real canonical rows and excludes unsafe fields', async () => {
    const scope = workspaceScope(ids);
    const actor = workspaceActor(ids.userA, ids.membershipA);
    await seedWorkspaceModuleRows(prisma, ids);

    await Promise.all([
      processEntity(processor, SearchResultType.PROJECT, ids.project),
      processEntity(processor, SearchResultType.TICKET, ids.ticket),
      processEntity(processor, SearchResultType.FORM, ids.form),
      processEntity(processor, SearchResultType.GOAL, ids.goal),
      processEntity(processor, SearchResultType.FILE, ids.asset),
      processEntity(processor, SearchResultType.MEMBER, ids.memberSearch),
      processEntity(processor, SearchResultType.MEMBER, ids.memberInactive),
      processEntity(processor, SearchResultType.AUTOMATION, ids.automation),
      processEntity(processor, SearchResultType.API_KEY, ids.apiKey),
      processEntity(processor, SearchResultType.WEBHOOK, ids.webhook),
      processEntity(processor, SearchResultType.INTEGRATION, ids.integration),
      processEntity(processor, SearchResultType.BILLING_METADATA, ids.invoiceA),
      processEntity(processor, SearchResultType.BILLING_METADATA, ids.invoiceB),
    ]);

    await expect(
      searchTitles(service, scope, actor, 'projectphoenix', ['PROJECT']),
    ).resolves.toEqual(['Project Phoenix']);
    await expect(searchTitles(service, scope, actor, 'ticketatlas', ['TICKET'])).resolves.toEqual([
      'Ticket Atlas',
    ]);
    await expect(searchTitles(service, scope, actor, 'formnebula', ['FORM'])).resolves.toEqual([
      'Form Nebula',
    ]);
    await expect(searchTitles(service, scope, actor, 'goalsummit', ['GOAL'])).resolves.toEqual([
      'Goal Summit',
    ]);
    await expect(searchTitles(service, scope, actor, 'quarterly-file', ['FILE'])).resolves.toEqual([
      'quarterly-file.pdf',
    ]);
    await expect(
      searchTitles(service, scope, actor, 'Member Searchable', ['MEMBER']),
    ).resolves.toEqual(['Member Searchable']);
    await expect(
      service.search(scope, actor, {
        q: 'Inactive',
        types: ['MEMBER'],
        saveRecent: false,
      }),
    ).resolves.toMatchObject({ results: [] });
    await expect(
      service.search(scope, actor, {
        q: 'Inactive',
        types: ['MEMBER'],
        includeArchived: true,
        saveRecent: false,
      }),
    ).resolves.toMatchObject({ results: [expect.objectContaining({ archived: true })] });
    await expect(
      searchTitles(service, scope, actor, 'workflow lighthouse', ['AUTOMATION']),
    ).resolves.toEqual(['Workflow Lighthouse']);
    await expect(
      searchTitles(service, scope, actor, 'reporting key', ['API_KEY']),
    ).resolves.toEqual(['Reporting API Key']);
    await expect(searchTitles(service, scope, actor, 'crm webhook', ['WEBHOOK'])).resolves.toEqual([
      'CRM Webhook',
    ]);
    await expect(
      searchTitles(service, scope, actor, 'Slack Primary', ['INTEGRATION']),
    ).resolves.toEqual(['Slack Primary']);

    for (const [query, type] of [
      ['conversation-secret-zebra', 'TICKET'],
      ['submitter@example.test', 'FORM'],
      ['555-0100', 'FORM'],
      ['hidden-answer-orchid', 'FORM'],
      ['normal-answer-violet', 'FORM'],
      ['manual-private-goal-note', 'GOAL'],
      ['binary-content-secret', 'FILE'],
      ['automation-execution-secret', 'AUTOMATION'],
      ['api-secret-hash-value', 'API_KEY'],
      ['signing-secret-value', 'WEBHOOK'],
      ['oauth-refresh-token-secret', 'INTEGRATION'],
    ] as Array<[string, SearchResultType]>) {
      await expect(searchTitles(service, scope, actor, query, [type])).resolves.toHaveLength(0);
    }

    const superScope = superAgencyScope(ids, ids.superAgency);
    const superActor = superAgencyActor(ids);
    await expect(
      searchTitles(service, workspaceScope(ids), actor, 'ALPHA-INVOICE-P17', ['BILLING_METADATA']),
    ).resolves.toHaveLength(0);
    await expect(
      searchTitles(service, agencyScope(ids, ids.agency), agencyActor(ids), 'ALPHA-INVOICE-P17', [
        'BILLING_METADATA',
      ]),
    ).resolves.toHaveLength(0);
    await expect(
      searchTitles(service, superScope, superActor, 'ALPHA-INVOICE-P17', ['BILLING_METADATA']),
    ).resolves.toEqual(['ALPHA-INVOICE-P17']);
    await expect(
      searchTitles(service, superScope, superActor, 'OMEGA-BILL-P17', ['BILLING_METADATA']),
    ).resolves.toHaveLength(0);
    await expect(
      searchTitles(service, service.platformScope(), platformActor(ids), 'ALPHA-INVOICE-P17', [
        'BILLING_METADATA',
      ]),
    ).resolves.toEqual(['ALPHA-INVOICE-P17']);
  });

  it('enforces Agency, Super Agency, Platform, Doc, and Ticket parent search privacy', async () => {
    await seedParentRows(prisma, ids);
    await Promise.all([
      processEntity(processor, SearchResultType.TASK, ids.taskA1),
      processEntity(processor, SearchResultType.TASK, ids.taskA2),
      processEntity(processor, SearchResultType.TASK, ids.taskA3),
      processEntity(processor, SearchResultType.TASK, ids.taskB1),
      processEntity(processor, SearchResultType.TICKET, ids.ticket),
      processEntity(processor, SearchResultType.DOC, ids.parentWorkspaceDoc),
      processEntity(processor, SearchResultType.DOC, ids.parentPrivateDoc),
      processEntity(processor, SearchResultType.DOC, ids.parentSelectedDoc),
      processEntity(processor, SearchResultType.WORKSPACE, ids.workspace),
      processEntity(processor, SearchResultType.WORKSPACE, ids.workspace2),
      processEntity(processor, SearchResultType.WORKSPACE, ids.workspace3),
      processEntity(processor, SearchResultType.WORKSPACE, ids.workspaceB),
      processEntity(processor, SearchResultType.AGENCY, ids.agency),
      processEntity(processor, SearchResultType.AGENCY, ids.agency2),
      processEntity(processor, SearchResultType.SUPER_AGENCY, ids.superAgency),
      processEntity(processor, SearchResultType.SUPER_AGENCY, ids.superAgencyB),
    ]);

    await expect(
      searchTitles(service, agencyScope(ids, ids.agency), agencyActor(ids), 'northstar', ['TASK']),
    ).resolves.toEqual(['Northstar Task']);
    await expect(
      searchTitles(service, agencyScope(ids, ids.agency), agencyActor(ids), 'riverstone', ['TASK']),
    ).resolves.toEqual(['Riverstone Task']);
    await expect(
      searchTitles(service, agencyScope(ids, ids.agency), agencyActor(ids), 'mountainpeak', [
        'TASK',
      ]),
    ).resolves.toHaveLength(0);
    await expect(
      searchTitles(service, agencyScope(ids, ids.agency), agencyActor(ids), 'westhaven', ['TASK']),
    ).resolves.toHaveLength(0);

    await expect(
      searchTitles(
        service,
        superAgencyScope(ids, ids.superAgency),
        superAgencyActor(ids),
        'mountainpeak',
        ['TASK'],
      ),
    ).resolves.toEqual(['Mountainpeak Task']);
    await expect(
      searchTitles(
        service,
        superAgencyScope(ids, ids.superAgency),
        superAgencyActor(ids),
        'westhaven',
        ['TASK'],
      ),
    ).resolves.toHaveLength(0);

    await expect(
      searchTitles(
        service,
        agencyScope(ids, ids.agency),
        agencyActor(ids),
        'parent workspace doc',
        ['DOC'],
      ),
    ).resolves.toEqual(['Parent Workspace Doc']);
    await expect(
      searchTitles(
        service,
        agencyScope(ids, ids.agency),
        agencyActor(ids),
        'private-parent-secret',
        ['DOC'],
      ),
    ).resolves.toHaveLength(0);
    await expect(
      searchTitles(
        service,
        superAgencyScope(ids, ids.superAgency),
        superAgencyActor(ids),
        'selected-parent-secret',
        ['DOC'],
      ),
    ).resolves.toHaveLength(0);
    await expect(
      searchTitles(
        service,
        agencyScope(ids, ids.agency),
        agencyActor(ids),
        'conversation-secret-zebra',
        ['TICKET'],
      ),
    ).resolves.toHaveLength(0);

    await expect(
      searchTitles(service, service.platformScope(), platformActor(ids), 'Alpha Super Unique', [
        'SUPER_AGENCY',
      ]),
    ).resolves.toEqual(['Alpha Super Unique']);
    await expect(
      searchTitles(service, service.platformScope(), platformActor(ids), 'private-parent-secret', [
        'DOC',
      ]),
    ).resolves.toHaveLength(0);
    await expect(
      searchTitles(
        service,
        service.platformScope(),
        platformActor(ids),
        'conversation-secret-zebra',
        ['TICKET'],
      ),
    ).resolves.toHaveLength(0);
  });

  it('proves real worker canonical reload, multi-worker freshness, stale jobs, and destructive stale protection', async () => {
    await seedWorkerTask(prisma, ids.workerTask, ids, 'Worker Alpha', 'worker-alpha-v1');
    await processEntity(processor, SearchResultType.TASK, ids.workerTask, 1);
    await expect(workspaceDocument(ids.workerTask)).resolves.toMatchObject({
      title: 'Worker Alpha',
      searchText: expect.stringContaining('worker-alpha-v1'),
      sourceVersion: 1,
    });

    await prisma.task.update({
      where: { id: ids.workerTask },
      data: { title: 'Worker Alpha Updated', description: 'worker-alpha-v2' },
    });
    await processEntity(processor, SearchResultType.TASK, ids.workerTask, 2);
    await expect(workspaceDocument(ids.workerTask)).resolves.toMatchObject({
      title: 'Worker Alpha Updated',
      searchText: expect.stringContaining('worker-alpha-v2'),
      sourceVersion: 1,
    });
    await expect(
      prisma.searchDocument.count({
        where: {
          scopeType: AnalyticsScopeType.WORKSPACE,
          scopeId: ids.workspace,
          entityType: SearchResultType.TASK,
          entityId: ids.workerTask,
        },
      }),
    ).resolves.toBe(1);

    await Promise.all([
      processEntity(processor, SearchResultType.TASK, ids.workerTask, 3),
      processEntity(processor, SearchResultType.TASK, ids.workerTask, 3),
    ]);
    await expect(
      prisma.searchDocument.count({
        where: { entityType: SearchResultType.TASK, entityId: ids.workerTask },
      }),
    ).resolves.toBe(3);

    await prisma.task.update({ where: { id: ids.workerTask }, data: { archivedAt: new Date() } });
    await processEntity(processor, SearchResultType.TASK, ids.workerTask, 4);
    await expect(
      service.search(workspaceScope(ids), workspaceActor(ids.userA, ids.membershipA), {
        q: 'Worker Alpha Updated',
        types: ['TASK'],
        saveRecent: false,
      }),
    ).resolves.toMatchObject({ results: [] });
    await processEntity(processor, SearchResultType.TASK, ids.workerTask, 1);
    await expect(workspaceDocument(ids.workerTask)).resolves.toMatchObject({ archived: true });

    await prisma.task.update({ where: { id: ids.workerTask }, data: { archivedAt: null } });
    await processEntity(processor, SearchResultType.TASK, ids.workerTask, 5);
    cache.clear();
    await expect(
      searchTitles(
        service,
        workspaceScope(ids),
        workspaceActor(ids.userA, ids.membershipA),
        'Worker Alpha Updated',
        ['TASK'],
      ),
    ).resolves.toEqual(['Worker Alpha Updated']);

    await prisma.task.delete({ where: { id: ids.workerTask } });
    await processEntity(processor, SearchResultType.TASK, ids.workerTask, 6);
    await expect(
      prisma.searchDocument.count({
        where: { entityType: SearchResultType.TASK, entityId: ids.workerTask },
      }),
    ).resolves.toBe(0);

    async function workspaceDocument(entityId: string) {
      return prisma.searchDocument.findFirstOrThrow({
        where: {
          scopeType: AnalyticsScopeType.WORKSPACE,
          scopeId: ids.workspace,
          entityType: SearchResultType.TASK,
          entityId,
        },
      });
    }
  });

  it('proves real backfill batching, idempotency, rebuild authorization, and reconciliation by scoped rebuild', async () => {
    const batchIds = Array.from({ length: 260 }, () => randomUUID());
    await prisma.task.createMany({
      data: batchIds.map((id, index) => ({
        id,
        workspaceId: ids.workspace,
        title: `Backfill Batch ${index}`,
        description: `batch-token-${index}`,
        statusDefinitionId: ids.taskStatus,
        createdById: ids.userA,
      })),
    });
    await processRebuild(processor, AnalyticsScopeType.WORKSPACE, ids.workspace, [
      SearchResultType.TASK,
    ]);
    await expect(
      prisma.searchDocument.count({
        where: {
          scopeType: AnalyticsScopeType.WORKSPACE,
          scopeId: ids.workspace,
          entityType: SearchResultType.TASK,
          entityId: { in: batchIds },
        },
      }),
    ).resolves.toBe(260);
    await processRebuild(processor, AnalyticsScopeType.WORKSPACE, ids.workspace, [
      SearchResultType.TASK,
    ]);
    await expect(
      prisma.searchDocument.count({
        where: {
          scopeType: AnalyticsScopeType.WORKSPACE,
          scopeId: ids.workspace,
          entityType: SearchResultType.TASK,
          entityId: { in: batchIds },
        },
      }),
    ).resolves.toBe(260);

    const deleted = await prisma.searchDocument.findFirstOrThrow({
      where: { entityType: SearchResultType.TASK, entityId: batchIds[0] },
    });
    await prisma.searchDocument.delete({ where: { id: deleted.id } });
    await prisma.searchDocument.create({
      data: {
        scopeType: AnalyticsScopeType.WORKSPACE,
        scopeId: ids.workspace,
        workspaceId: ids.workspace,
        agencyId: ids.agency,
        superAgencyId: ids.superAgency,
        entityType: SearchResultType.TASK,
        entityId: randomUUID(),
        title: 'Orphan Search Row',
        searchText: 'orphan-reconcile-token',
        route: { href: '/workspace/tasks/orphan' },
        metadata: {},
        privacyClass: SearchPrivacyClass.WORKSPACE_OPERATIONAL,
        sourceUpdatedAt: new Date(),
      },
    });

    await expect(
      service.enqueueRebuild(workspaceScope(ids), workspaceActor(ids.userA, ids.membershipA), [
        'TASK',
      ]),
    ).rejects.toMatchObject({ status: 403 });

    const queuePayloads: unknown[] = [];
    const platformService = new SearchService(
      prisma,
      redisHarness(new Map()) as never,
      {
        add: jest.fn((_name, payload) => {
          queuePayloads.push(payload);
          return Promise.resolve({ id: 'queued' });
        }),
      } as never,
    );
    await expect(
      platformService.enqueueRebuild(workspaceScope(ids), platformActor(ids), ['TASK']),
    ).resolves.toMatchObject({ queued: true });
    await processor.process({ name: SEARCH_INDEX_JOB_TYPE, data: queuePayloads[0] } as Job);

    await expect(
      prisma.searchDocument.count({
        where: {
          scopeType: AnalyticsScopeType.WORKSPACE,
          scopeId: ids.workspace,
          entityType: SearchResultType.TASK,
          entityId: { in: batchIds },
        },
      }),
    ).resolves.toBe(260);
    await expect(
      prisma.searchDocument.count({
        where: { scopeId: ids.workspace, searchText: { contains: 'orphan-reconcile-token' } },
      }),
    ).resolves.toBe(0);
  });

  it('uses search indexes for FTS, trigram, scope, and parent query plans without result fan-out', async () => {
    await seedParentRows(prisma, ids);
    await Promise.all([
      processEntity(processor, SearchResultType.TASK, ids.taskA1),
      processEntity(processor, SearchResultType.TASK, ids.taskA2),
      processEntity(processor, SearchResultType.TASK, ids.taskA3),
      processEntity(processor, SearchResultType.TASK, ids.taskB1),
    ]);
    for (let index = 0; index < 350; index += 1) {
      await service.upsertDocument({
        scope: agencyScope(ids, ids.agency),
        entityType: SearchResultType.TASK,
        entityId: randomUUID(),
        title: `Plan row ${index}`,
        searchText: `plan-token-${index}`,
        route: { href: `/agency/search/${index}` },
        metadata: {},
        privacyClass: SearchPrivacyClass.PARENT_SAFE_METADATA,
        sourceUpdatedAt: new Date(),
      });
    }

    await expect(
      explainUses('fts', 'search_documents_vector_idx', ids.agency, 'plan-token-1'),
    ).resolves.toBe(true);
    await expect(
      explainUses('trgm', 'search_documents_title_trgm_idx', ids.agency, 'pln row'),
    ).resolves.toBe(true);
    await expect(
      explainUses('scope', 'search_documents_scope_type_updated_idx', ids.agency, 'plan-token-2'),
    ).resolves.toBe(true);

    const queryLog: string[] = [];
    const handler = (event: { query: string }) => queryLog.push(event.query);
    prisma.$on('query' as never, handler as never);
    await service.search(agencyScope(ids, ids.agency), agencyActor(ids), {
      q: 'Plan row',
      types: ['TASK'],
      pageSize: 20,
      saveRecent: false,
    });
    const canonicalLookups = queryLog.filter((query) =>
      /FROM\s+"public"\."tasks"|FROM\s+"tasks"/i.test(query),
    );
    expect(canonicalLookups).toHaveLength(0);

    async function explainUses(
      mode: 'fts' | 'trgm' | 'scope',
      indexName: string,
      scopeId: string,
      query: string,
    ) {
      await prisma.$executeRawUnsafe('SET enable_seqscan = off');
      const predicate =
        mode === 'fts'
          ? `d.search_vector @@ websearch_to_tsquery('simple', $1)`
          : mode === 'trgm'
            ? `d.title % $1`
            : `d.scope_type = 'AGENCY'::"AnalyticsScopeType" AND d.scope_id = $2::uuid AND d.entity_type = 'TASK'::"SearchResultType" AND d.archived = false`;
      const orderBy = mode === 'scope' ? 'd.updated_at DESC' : 'd.source_updated_at DESC';
      const rows = await prisma.$queryRawUnsafe<Array<{ plan: string }>>(
        `
        EXPLAIN
        SELECT d.id
        FROM search_documents d
        WHERE ${mode === 'scope' ? predicate : `(${predicate})`}
        ORDER BY ${orderBy}
        LIMIT 25;
        `,
        query,
        scopeId,
      );
      await prisma.$executeRawUnsafe('RESET enable_seqscan');
      return rows.some((row) => String(Object.values(row)[0] ?? '').includes(indexName));
    }
  });
});

async function indexSearchFixtures(service: SearchService, scope: SearchScope, ids: SeedIds) {
  await Promise.all([
    indexTask(service, scope, ids.exactTask, 'aurora', 'exact title match'),
    indexTask(service, scope, ids.prefixTask, 'prefix-harbor launch', 'prefix route'),
    indexTask(service, scope, ids.ftsTask, 'Metrics workbook', 'retention signal body'),
    indexTask(service, scope, ids.fuzzyTask, 'Support Atlas', 'customer support'),
    indexTask(service, scope, ids.tamilTask, 'தமிழ் தேடல் பணி', 'தமிழ் உள்ளடக்கம்'),
  ]);
}

async function indexTask(
  service: SearchService,
  scope: SearchScope,
  entityId: string,
  title: string,
  searchText: string,
) {
  await service.upsertDocument({
    scope,
    entityType: SearchResultType.TASK,
    entityId,
    title,
    searchText,
    route: { href: `/workspace/tasks/${entityId}` },
    metadata: {},
    privacyClass: SearchPrivacyClass.WORKSPACE_OPERATIONAL,
    sourceUpdatedAt: new Date(),
  });
}

async function indexDoc(
  service: SearchService,
  scope: SearchScope,
  entityId: string,
  title: string,
  searchText: string,
  metadata: Prisma.InputJsonValue,
) {
  await service.upsertDocument({
    scope,
    entityType: SearchResultType.DOC,
    entityId,
    title,
    searchText,
    route: { href: `/workspace/docs/${entityId}` },
    metadata,
    privacyClass: SearchPrivacyClass.ACL_SENSITIVE,
    sourceUpdatedAt: new Date(),
  });
}

async function searchTitles(
  service: SearchService,
  scope: SearchScope,
  actor: SearchActor,
  query: string,
  types: Array<keyof typeof SearchResultType> = ['DOC'],
) {
  const result = await service.search(scope, actor, {
    q: query,
    types: types as never,
    saveRecent: false,
  });
  return result.results.map((item: SearchResult) => item.title);
}

async function processEntity(
  processor: SearchIndexProcessorHarness,
  entityType: SearchResultType,
  entityId: string,
  sourceVersion = 1,
) {
  await processor.process({
    name: SEARCH_INDEX_JOB_TYPE,
    data: {
      operation: SearchIndexOperation.UPSERT,
      entityType,
      entityId,
      sourceUpdatedAt: new Date().toISOString(),
      sourceVersion,
    },
  } as Job);
}

async function processRebuild(
  processor: SearchIndexProcessorHarness,
  scopeType: AnalyticsScopeType,
  scopeId: string,
  types: SearchResultType[],
) {
  await processor.process({
    name: SEARCH_INDEX_JOB_TYPE,
    data: {
      operation: SearchIndexOperation.REBUILD_SCOPE,
      scopeType,
      scopeId,
      types,
      sourceUpdatedAt: new Date().toISOString(),
    },
  } as Job);
}

async function seedTenant(prisma: PrismaService, ids: SeedIds) {
  await prisma.user.createMany({
    data: [
      {
        id: ids.userA,
        email: `phase17-search-a-${ids.run}@example.test`,
        name: 'Phase 17 Search A',
        passwordHash: 'hash',
      },
      {
        id: ids.userB,
        email: `phase17-search-b-${ids.run}@example.test`,
        name: 'Phase 17 Search B',
        passwordHash: 'hash',
      },
      {
        id: ids.userMemberSearch,
        email: `member-search-${ids.run}@example.test`,
        name: 'Member Searchable',
        passwordHash: 'hash',
      },
      {
        id: ids.userMemberInactive,
        email: `member-inactive-${ids.run}@example.test`,
        name: 'Inactive Searchable',
        passwordHash: 'hash',
      },
    ],
  });
  await prisma.role.createMany({
    data: [
      {
        id: ids.role,
        key: `PHASE17_SEARCH_${ids.run}`,
        name: 'Phase 17 Search',
        nameNormalized: `phase17-search-${ids.run}`,
        scope: RoleScope.WORKSPACE,
      },
      {
        id: ids.roleAgency,
        key: `PHASE17_SEARCH_AGENCY_${ids.run}`,
        name: 'Phase 17 Search Agency',
        nameNormalized: `phase17-search-agency-${ids.run}`,
        scope: RoleScope.AGENCY,
      },
      {
        id: ids.roleSuperAgency,
        key: `PHASE17_SEARCH_SUPER_${ids.run}`,
        name: 'Phase 17 Search Super',
        nameNormalized: `phase17-search-super-${ids.run}`,
        scope: RoleScope.SUPER_AGENCY,
      },
    ],
  });
  await prisma.superAgency.createMany({
    data: [
      {
        id: ids.superAgency,
        name: 'Alpha Super Unique',
        slug: `phase17-search-super-${ids.run}`,
        createdById: ids.userA,
      },
      {
        id: ids.superAgencyB,
        name: 'Omega Tenant Unique',
        slug: `phase17-search-super-b-${ids.run}`,
        createdById: ids.userA,
      },
    ],
  });
  await prisma.agency.createMany({
    data: [
      {
        id: ids.agency,
        superAgencyId: ids.superAgency,
        name: 'Phase 17 Search Agency',
        slug: `phase17-search-agency-${ids.run}`,
        createdById: ids.userA,
      },
      {
        id: ids.agency2,
        superAgencyId: ids.superAgency,
        name: 'Phase 17 Search Agency A2',
        slug: `phase17-search-agency-a2-${ids.run}`,
        createdById: ids.userA,
      },
      {
        id: ids.agencyB,
        superAgencyId: ids.superAgencyB,
        name: 'Phase 17 Search Agency B1',
        slug: `phase17-search-agency-b1-${ids.run}`,
        createdById: ids.userA,
      },
    ],
  });
  await prisma.workspace.createMany({
    data: [
      {
        id: ids.workspace,
        agencyId: ids.agency,
        name: 'Phase 17 Search Workspace A1',
        slug: `phase17-search-workspace-a1-${ids.run}`,
        createdById: ids.userA,
      },
      {
        id: ids.workspace2,
        agencyId: ids.agency,
        name: 'Phase 17 Search Workspace A2',
        slug: `phase17-search-workspace-a2-${ids.run}`,
        createdById: ids.userA,
      },
      {
        id: ids.workspace3,
        agencyId: ids.agency2,
        name: 'Phase 17 Search Workspace A3',
        slug: `phase17-search-workspace-a3-${ids.run}`,
        createdById: ids.userA,
      },
      {
        id: ids.workspaceB,
        agencyId: ids.agencyB,
        name: 'Phase 17 Search Workspace B1',
        slug: `phase17-search-workspace-b1-${ids.run}`,
        createdById: ids.userA,
      },
    ],
  });
  await prisma.superAgencyMembership.create({
    data: {
      id: ids.superAgencyMembership,
      userId: ids.userA,
      superAgencyId: ids.superAgency,
      roleId: ids.roleSuperAgency,
      status: MembershipStatus.ACTIVE,
    },
  });
  await prisma.agencyMembership.create({
    data: {
      id: ids.agencyMembership,
      userId: ids.userA,
      agencyId: ids.agency,
      roleId: ids.roleAgency,
      status: MembershipStatus.ACTIVE,
    },
  });
  await prisma.workspaceMembership.createMany({
    data: [
      {
        id: ids.membershipA,
        userId: ids.userA,
        workspaceId: ids.workspace,
        roleId: ids.role,
        status: MembershipStatus.ACTIVE,
      },
      {
        id: ids.membershipB,
        userId: ids.userB,
        workspaceId: ids.workspace,
        roleId: ids.role,
        status: MembershipStatus.ACTIVE,
      },
      {
        id: ids.memberSearch,
        userId: ids.userMemberSearch,
        workspaceId: ids.workspace,
        roleId: ids.role,
        status: MembershipStatus.ACTIVE,
      },
      {
        id: ids.memberInactive,
        userId: ids.userMemberInactive,
        workspaceId: ids.workspace,
        roleId: ids.role,
        status: MembershipStatus.SUSPENDED,
      },
    ],
  });
  await prisma.statusDefinition.createMany({
    data: [ids.workspace, ids.workspace2, ids.workspace3, ids.workspaceB].flatMap(
      (workspaceId, index) => [
        {
          id: ids.taskStatuses[index],
          workspaceId,
          entityType: 'TASK',
          name: 'Todo',
          nameNormalized: `todo-${ids.run}-${index}`,
          color: '#3366ff',
          position: 1,
          category: 'TODO',
          isDefault: true,
        },
        {
          id: ids.ticketStatuses[index],
          workspaceId,
          entityType: 'TICKET',
          name: 'Open',
          nameNormalized: `open-${ids.run}-${index}`,
          color: '#22aa66',
          position: 1,
          category: 'TODO',
          isDefault: true,
        },
      ],
    ) as never,
  });
  await prisma.doc.createMany({
    data: [
      {
        id: ids.workspaceDoc,
        workspaceId: ids.workspace,
        title: 'Visible stale doc',
        content: { content: [{ text: 'staledoc' }] },
        visibility: DocVisibility.WORKSPACE,
        createdByMembershipId: ids.membershipA,
      },
      {
        id: ids.selectedDoc,
        workspaceId: ids.workspace,
        title: 'Selected stale doc',
        content: { content: [{ text: 'aclremovedoc' }] },
        visibility: DocVisibility.SELECTED_MEMBERS,
        createdByMembershipId: ids.membershipA,
      },
    ],
  });
}

async function seedWorkspaceModuleRows(prisma: PrismaService, ids: SeedIds) {
  await prisma.project.create({
    data: {
      id: ids.project,
      workspaceId: ids.workspace,
      name: 'Project Phoenix',
      description: 'projectphoenix safe project details',
      status: 'ACTIVE',
      visibility: 'WORKSPACE',
      ownerMembershipId: ids.membershipA,
      createdById: ids.userA,
    } as never,
  });
  await prisma.ticket.create({
    data: {
      id: ids.ticket,
      workspaceId: ids.workspace,
      sequenceNumber: 1,
      ticketNumber: 'P17-1',
      subject: 'Ticket Atlas',
      description: 'ticketatlas safe ticket detail',
      statusDefinitionId: ids.ticketStatus,
      priority: 'HIGH',
      createdByMembershipId: ids.membershipA,
    } as never,
  });
  await prisma.ticketConversationEntry.create({
    data: {
      id: ids.ticketConversation,
      workspaceId: ids.workspace,
      ticketId: ids.ticket,
      type: 'INTERNAL_NOTE',
      body: 'conversation-secret-zebra',
      authorMembershipId: ids.membershipA,
      authorUserId: ids.userA,
    } as never,
  });
  await prisma.form.create({
    data: {
      id: ids.form,
      workspaceId: ids.workspace,
      publicId: `p17-${ids.run}`,
      title: 'Form Nebula',
      description: 'formnebula public label',
      status: 'PUBLISHED',
      type: 'FORM',
      visibility: 'PUBLIC',
      publicEnabled: true,
      publishedVersionNumber: 1,
      createdByMembershipId: ids.membershipA,
      updatedByMembershipId: ids.membershipA,
    } as never,
  });
  await prisma.formVersion.create({
    data: {
      id: ids.formVersion,
      formId: ids.form,
      workspaceId: ids.workspace,
      versionNumber: 1,
      state: 'PUBLISHED',
      titleSnapshot: 'Form Nebula',
      descriptionSnapshot: 'formnebula public label',
      schema: { fields: [{ id: 'email', label: 'Email' }] },
      settings: {},
      createdByMembershipId: ids.membershipA,
      publishedByMembershipId: ids.membershipA,
      publishedAt: new Date(),
    } as never,
  });
  await prisma.formSubmission.create({
    data: {
      id: ids.formSubmission,
      formId: ids.form,
      formVersionId: ids.formVersion,
      workspaceId: ids.workspace,
      source: 'PUBLIC',
      status: 'RECEIVED',
      answers: {
        email: 'submitter@example.test',
        phone: '555-0100',
        hidden: 'hidden-answer-orchid',
        normal: 'normal-answer-violet',
      },
      answerSummary: { email: 'submitter@example.test' },
      automationStatus: 'QUEUED',
    } as never,
  });
  await prisma.goal.create({
    data: {
      id: ids.goal,
      workspaceId: ids.workspace,
      ownerType: 'WORKSPACE',
      metricType: 'TASKS_COMPLETED',
      periodType: 'MONTHLY',
      title: 'Goal Summit',
      description: 'goalsummit safe metric metadata',
      targetValue: 10,
      periodStart: new Date('2026-09-01T00:00:00.000Z'),
      periodEnd: new Date('2026-09-30T23:59:59.000Z'),
      createdByMembershipId: ids.membershipA,
      metadata: { privateNote: 'manual-private-goal-note' },
    } as never,
  });
  await prisma.goalProgressEvent.create({
    data: {
      id: ids.goalProgressEvent,
      workspaceId: ids.workspace,
      goalId: ids.goal,
      sourceType: 'MANUAL',
      idempotencyKey: `manual-${ids.run}`,
      delta: 1,
      valueAfter: 1,
      occurredAt: new Date(),
      actorMembershipId: ids.membershipA,
      note: 'manual-private-goal-note',
    } as never,
  });
  await prisma.asset.create({
    data: {
      id: ids.asset,
      workspaceId: ids.workspace,
      createdById: ids.userA,
      uploadedByMembershipId: ids.membershipA,
      originalFilename: 'quarterly-file.pdf',
      displayName: 'quarterly-file.pdf',
      storageBucket: 'phase17',
      storageKey: `phase17/${ids.run}/quarterly-file.pdf`,
      mimeType: 'application/pdf',
      extension: 'pdf',
      sizeBytes: 128,
      status: 'READY',
      lifecycle: 'ACTIVE',
      metadata: { extracted: 'binary-content-secret' },
      uploadExpiresAt: new Date('2026-10-01T00:00:00.000Z'),
    } as never,
  });
  await prisma.automationWorkflow.create({
    data: {
      id: ids.automation,
      workspaceId: ids.workspace,
      name: 'Workflow Lighthouse',
      description: 'workflow lighthouse safe descriptor',
      status: 'DRAFT',
      createdByMembershipId: ids.membershipA,
    } as never,
  });
  await prisma.automationWorkflowVersion.create({
    data: {
      id: ids.automationVersion,
      workflowId: ids.automation,
      workspaceId: ids.workspace,
      versionNumber: 1,
      state: 'DRAFT',
      triggerDefinition: { type: 'TASK_CREATED' },
      nodesDefinition: [],
      edgesDefinition: [],
      settingsDefinition: {},
      definitionSizeBytes: 2,
      createdByMembershipId: ids.membershipA,
    } as never,
  });
  await prisma.automationDomainEvent.create({
    data: {
      id: ids.automationEvent,
      workspaceId: ids.workspace,
      eventType: 'TASK_CREATED',
      entityType: 'TASK',
      entityId: ids.exactTask,
      actorMembershipId: ids.membershipA,
      occurredAt: new Date(),
      correlationId: ids.run,
      payload: { secret: 'automation-execution-secret' },
      idempotencyKey: `automation-${ids.run}`,
    } as never,
  });
  await prisma.automationTriggerMatch.create({
    data: {
      id: ids.automationMatch,
      workspaceId: ids.workspace,
      domainEventId: ids.automationEvent,
      workflowId: ids.automation,
      workflowVersionId: ids.automationVersion,
      triggerNodeId: 'trigger',
      status: 'MATCHED',
    } as never,
  });
  await prisma.automationExecution.create({
    data: {
      id: ids.automationExecution,
      workspaceId: ids.workspace,
      triggerMatchId: ids.automationMatch,
      domainEventId: ids.automationEvent,
      workflowId: ids.automation,
      workflowVersionId: ids.automationVersion,
      status: 'QUEUED',
      correlationId: ids.run,
      failureMessage: 'automation-execution-secret',
    } as never,
  });
  await prisma.apiKey.create({
    data: {
      id: ids.apiKey,
      workspaceId: ids.workspace,
      name: 'Reporting API Key',
      description: 'reporting key safe metadata',
      publicIdentifier: `p17${ids.run}apikey000000000000000`,
      prefix: 'p17',
      secretHash: 'api-secret-hash-value',
      status: 'ACTIVE',
      scopes: ['tasks:read'],
      createdByMembershipId: ids.membershipA,
    } as never,
  });
  await prisma.webhookSubscription.create({
    data: {
      id: ids.webhook,
      workspaceId: ids.workspace,
      name: 'CRM Webhook',
      description: 'crm webhook safe metadata',
      endpointUrl: 'https://example.test/webhook',
      encryptedSecret: 'signing-secret-value',
      status: 'ACTIVE',
      eventTypes: ['task.created'],
      createdByMembershipId: ids.membershipA,
    } as never,
  });
  await prisma.integrationConnection.create({
    data: {
      id: ids.integration,
      workspaceId: ids.workspace,
      provider: 'SLACK',
      name: 'Slack Primary',
      status: 'CONNECTED',
      authType: 'OAUTH',
      providerAccountLabel: 'slack-safe-label',
      encryptedCredentials: 'oauth-refresh-token-secret',
      scopes: ['chat:write'],
      capabilities: ['messages'],
      configurationJson: {},
      connectedByMembershipId: ids.membershipA,
    } as never,
  });
  await prisma.billingInvoice.createMany({
    data: [
      {
        id: ids.invoiceA,
        superAgencyId: ids.superAgency,
        provider: 'STRIPE',
        providerInvoiceId: `in_${ids.run}_a`,
        invoiceNumber: 'ALPHA-INVOICE-P17',
        currency: 'USD',
        status: 'open',
        amountDueMinor: 1000,
        amountPaidMinor: 0,
        amountRemainingMinor: 1000,
        providerCreatedAt: new Date('2026-09-01T00:00:00.000Z'),
      },
      {
        id: ids.invoiceB,
        superAgencyId: ids.superAgencyB,
        provider: 'STRIPE',
        providerInvoiceId: `in_${ids.run}_b`,
        invoiceNumber: 'OMEGA-BILL-P17',
        currency: 'USD',
        status: 'open',
        amountDueMinor: 1000,
        amountPaidMinor: 0,
        amountRemainingMinor: 1000,
        providerCreatedAt: new Date('2026-09-01T00:00:00.000Z'),
      },
    ] as never,
  });
}

async function seedParentRows(prisma: PrismaService, ids: SeedIds) {
  await seedWorkerTask(prisma, ids.taskA1, ids, 'Northstar Task', 'parent visible');
  await seedWorkerTask(
    prisma,
    ids.taskA2,
    { ...ids, workspace: ids.workspace2, taskStatus: ids.taskStatuses[1]! },
    'Riverstone Task',
    'parent visible',
  );
  await seedWorkerTask(
    prisma,
    ids.taskA3,
    { ...ids, workspace: ids.workspace3, taskStatus: ids.taskStatuses[2]! },
    'Mountainpeak Task',
    'parent visible',
  );
  await seedWorkerTask(
    prisma,
    ids.taskB1,
    { ...ids, workspace: ids.workspaceB, taskStatus: ids.taskStatuses[3]! },
    'Westhaven Task',
    'parent visible',
  );
  if (!(await prisma.ticket.findUnique({ where: { id: ids.ticket } }))) {
    await seedWorkspaceModuleRows(prisma, ids);
  }
  await prisma.doc.createMany({
    data: [
      {
        id: ids.parentWorkspaceDoc,
        workspaceId: ids.workspace,
        title: 'Parent Workspace Doc',
        content: { content: [{ text: 'parent workspace doc' }] },
        visibility: DocVisibility.WORKSPACE,
        createdByMembershipId: ids.membershipA,
      },
      {
        id: ids.parentPrivateDoc,
        workspaceId: ids.workspace,
        title: 'Parent Private Doc',
        content: { content: [{ text: 'private-parent-secret' }] },
        visibility: DocVisibility.PRIVATE,
        createdByMembershipId: ids.membershipA,
      },
      {
        id: ids.parentSelectedDoc,
        workspaceId: ids.workspace,
        title: 'Parent Selected Doc',
        content: { content: [{ text: 'selected-parent-secret' }] },
        visibility: DocVisibility.SELECTED_MEMBERS,
        createdByMembershipId: ids.membershipA,
      },
    ],
  });
}

async function seedWorkerTask(
  prisma: PrismaService,
  id: string,
  ids: Pick<SeedIds, 'workspace' | 'taskStatus' | 'userA'>,
  title: string,
  description: string,
) {
  await prisma.task.create({
    data: {
      id,
      workspaceId: ids.workspace,
      title,
      description,
      statusDefinitionId: ids.taskStatus,
      priority: 'HIGH',
      createdById: ids.userA,
    } as never,
  });
}

async function cleanup(prisma: PrismaService, ids?: SeedIds) {
  if (!ids) return;
  const workspaceIds = [ids.workspace, ids.workspace2, ids.workspace3, ids.workspaceB];
  const agencyIds = [ids.agency, ids.agency2, ids.agencyB];
  const superAgencyIds = [ids.superAgency, ids.superAgencyB];
  const userIds = [ids.userA, ids.userB, ids.userMemberSearch, ids.userMemberInactive];
  const roleIds = [ids.role, ids.roleAgency, ids.roleSuperAgency];
  const scopeIds = [...workspaceIds, ...agencyIds, ...superAgencyIds];

  await prisma.searchDocument.deleteMany({
    where: {
      OR: [
        { scopeId: { in: scopeIds } },
        { workspaceId: { in: workspaceIds } },
        { agencyId: { in: agencyIds } },
        { superAgencyId: { in: superAgencyIds } },
      ],
    },
  });
  await prisma.recentSearch.deleteMany({
    where: {
      OR: [
        { userId: { in: userIds } },
        { scopeId: { in: scopeIds } },
        { workspaceMembershipId: { in: [ids.membershipA, ids.membershipB] } },
        { agencyMembershipId: ids.agencyMembership },
        { superAgencyMembershipId: ids.superAgencyMembership },
      ],
    },
  });
  await prisma.searchIndexJob.deleteMany({
    where: {
      OR: [
        { scopeId: { in: scopeIds } },
        {
          entityId: {
            in: [
              ids.project,
              ids.ticket,
              ids.form,
              ids.goal,
              ids.asset,
              ids.memberSearch,
              ids.memberInactive,
              ids.automation,
              ids.apiKey,
              ids.webhook,
              ids.integration,
              ids.invoiceA,
              ids.invoiceB,
              ids.taskA1,
              ids.taskA2,
              ids.taskA3,
              ids.taskB1,
              ids.workerTask,
            ],
          },
        },
      ],
    },
  });

  await prisma.ticketConversationEntry.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.ticket.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.goalProgressEvent.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.goal.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.formSubmissionAsset.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.formSubmission.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.formVersion.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.form.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.docAttachment.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.docShare.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.docFavorite.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.docMention.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.docComment.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.docVersion.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.docAccess.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.doc.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.docFolder.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.asset.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.apiKey.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.webhookSubscription.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.integrationConnection.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await deleteImmutableAutomationRows(prisma, workspaceIds);
  await prisma.automationWorkflowVersion.deleteMany({
    where: { workspaceId: { in: workspaceIds } },
  });
  await prisma.automationWorkflow.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.task.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.project.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.workspaceTicketCounter.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.workspaceMemberCapacity.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.statusDefinition.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.billingInvoice.deleteMany({ where: { superAgencyId: { in: superAgencyIds } } });
  await prisma.workspaceMembership.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.agencyMembership.deleteMany({ where: { agencyId: { in: agencyIds } } });
  await prisma.superAgencyMembership.deleteMany({
    where: { superAgencyId: { in: superAgencyIds } },
  });
  await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
  await prisma.agency.deleteMany({ where: { id: { in: agencyIds } } });
  await prisma.superAgency.deleteMany({ where: { id: { in: superAgencyIds } } });
  await prisma.role.deleteMany({ where: { id: { in: roleIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function deleteImmutableAutomationRows(prisma: PrismaService, workspaceIds: string[]) {
  await prisma.$executeRawUnsafe('ALTER TABLE automation_trigger_matches DISABLE TRIGGER USER');
  await prisma.$executeRawUnsafe('ALTER TABLE automation_domain_events DISABLE TRIGGER USER');
  try {
    await prisma.automationExecution.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.automationTriggerMatch.deleteMany({
      where: { workspaceId: { in: workspaceIds } },
    });
    await prisma.automationDomainEvent.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  } finally {
    await prisma.$executeRawUnsafe('ALTER TABLE automation_domain_events ENABLE TRIGGER USER');
    await prisma.$executeRawUnsafe('ALTER TABLE automation_trigger_matches ENABLE TRIGGER USER');
  }
}

function redisHarness(cache: Map<string, string>) {
  return {
    cache: {
      get: jest.fn((key: string) => Promise.resolve(cache.get(key) ?? null)),
      set: jest.fn((key: string, value: string) => {
        cache.set(key, value);
        return Promise.resolve('OK');
      }),
    },
    rateLimit: {
      multi: jest.fn(() => {
        throw new Error('use non-production fallback');
      }),
    },
  };
}

function workspaceScope(ids: SeedIds): SearchScope {
  return {
    type: AnalyticsScopeType.WORKSPACE,
    id: ids.workspace,
    workspaceId: ids.workspace,
    agencyId: ids.agency,
    superAgencyId: ids.superAgency,
  };
}

function agencyScope(ids: SeedIds, agencyId: string): SearchScope {
  return {
    type: AnalyticsScopeType.AGENCY,
    id: agencyId,
    workspaceId: null,
    agencyId,
    superAgencyId: agencyId === ids.agencyB ? ids.superAgencyB : ids.superAgency,
  };
}

function superAgencyScope(ids: SeedIds, superAgencyId: string): SearchScope {
  return {
    type: AnalyticsScopeType.SUPER_AGENCY,
    id: superAgencyId,
    workspaceId: null,
    agencyId: null,
    superAgencyId,
  };
}

function workspaceActor(userId: string, membershipId: string): SearchActor {
  return {
    userId,
    workspaceMembershipId: membershipId,
    permissions: [
      PermissionKeys.searchView,
      PermissionKeys.tasksView,
      PermissionKeys.docsView,
      PermissionKeys.projectsView,
      PermissionKeys.ticketsView,
      PermissionKeys.formsView,
      PermissionKeys.goalsView,
      PermissionKeys.assetRead,
      PermissionKeys.workspaceMemberRead,
      PermissionKeys.automationView,
      PermissionKeys.apiKeysView,
      PermissionKeys.webhooksView,
      PermissionKeys.integrationsView,
    ],
  };
}

function agencyActor(ids: SeedIds): SearchActor {
  return {
    userId: ids.userA,
    agencyMembershipId: ids.agencyMembership,
    superAgencyMembershipId: ids.superAgencyMembership,
    permissions: [
      PermissionKeys.searchView,
      PermissionKeys.workspaceRead,
      PermissionKeys.tasksParentRead,
      PermissionKeys.projectsParentRead,
      PermissionKeys.ticketsParentRead,
      PermissionKeys.docsParentRead,
      PermissionKeys.formsParentRead,
      PermissionKeys.goalsParentRead,
    ],
  };
}

function superAgencyActor(ids: SeedIds): SearchActor {
  return {
    userId: ids.userA,
    superAgencyMembershipId: ids.superAgencyMembership,
    permissions: [
      PermissionKeys.searchView,
      PermissionKeys.agencyRead,
      PermissionKeys.workspaceRead,
      PermissionKeys.billingInvoiceView,
      PermissionKeys.tasksParentRead,
      PermissionKeys.projectsParentRead,
      PermissionKeys.ticketsParentRead,
      PermissionKeys.docsParentRead,
      PermissionKeys.formsParentRead,
      PermissionKeys.goalsParentRead,
    ],
  };
}

function platformActor(ids: SeedIds): SearchActor {
  return {
    userId: ids.userA,
    permissions: [
      PermissionKeys.searchView,
      PermissionKeys.searchPlatformRead,
      PermissionKeys.billingInvoiceView,
      PermissionKeys.agencyRead,
      PermissionKeys.workspaceRead,
    ],
  };
}

function makeIds(): SeedIds {
  const taskStatuses = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const ticketStatuses = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  return {
    run: randomUUID().slice(0, 8),
    userA: randomUUID(),
    userB: randomUUID(),
    userMemberSearch: randomUUID(),
    userMemberInactive: randomUUID(),
    role: randomUUID(),
    roleAgency: randomUUID(),
    roleSuperAgency: randomUUID(),
    superAgency: randomUUID(),
    superAgencyB: randomUUID(),
    agency: randomUUID(),
    agency2: randomUUID(),
    agencyB: randomUUID(),
    workspace: randomUUID(),
    workspace2: randomUUID(),
    workspace3: randomUUID(),
    workspaceB: randomUUID(),
    superAgencyMembership: randomUUID(),
    agencyMembership: randomUUID(),
    membershipA: randomUUID(),
    membershipB: randomUUID(),
    memberSearch: randomUUID(),
    memberInactive: randomUUID(),
    taskStatuses,
    ticketStatuses,
    taskStatus: taskStatuses[0]!,
    ticketStatus: ticketStatuses[0]!,
    exactTask: randomUUID(),
    prefixTask: randomUUID(),
    ftsTask: randomUUID(),
    fuzzyTask: randomUUID(),
    tamilTask: randomUUID(),
    workspaceDoc: randomUUID(),
    selectedDoc: randomUUID(),
    docAccess: randomUUID(),
    project: randomUUID(),
    ticket: randomUUID(),
    ticketConversation: randomUUID(),
    form: randomUUID(),
    formVersion: randomUUID(),
    formSubmission: randomUUID(),
    goal: randomUUID(),
    goalProgressEvent: randomUUID(),
    asset: randomUUID(),
    automation: randomUUID(),
    automationVersion: randomUUID(),
    automationEvent: randomUUID(),
    automationMatch: randomUUID(),
    automationExecution: randomUUID(),
    apiKey: randomUUID(),
    webhook: randomUUID(),
    integration: randomUUID(),
    invoiceA: randomUUID(),
    invoiceB: randomUUID(),
    taskA1: randomUUID(),
    taskA2: randomUUID(),
    taskA3: randomUUID(),
    taskB1: randomUUID(),
    parentWorkspaceDoc: randomUUID(),
    parentPrivateDoc: randomUUID(),
    parentSelectedDoc: randomUUID(),
    workerTask: randomUUID(),
  };
}

type SearchScope = {
  type: AnalyticsScopeType;
  id: string;
  workspaceId: string | null;
  agencyId: string | null;
  superAgencyId: string | null;
};

type SearchActor = {
  userId: string;
  permissions: string[];
  workspaceMembershipId?: string | null;
  agencyMembershipId?: string | null;
  superAgencyMembershipId?: string | null;
};

type SearchResult = {
  title: string;
};

type SearchIndexProcessorHarness = {
  process(job: Job): Promise<unknown>;
};

type SeedIds = {
  run: string;
  userA: string;
  userB: string;
  userMemberSearch: string;
  userMemberInactive: string;
  role: string;
  roleAgency: string;
  roleSuperAgency: string;
  superAgency: string;
  superAgencyB: string;
  agency: string;
  agency2: string;
  agencyB: string;
  workspace: string;
  workspace2: string;
  workspace3: string;
  workspaceB: string;
  superAgencyMembership: string;
  agencyMembership: string;
  membershipA: string;
  membershipB: string;
  memberSearch: string;
  memberInactive: string;
  taskStatuses: string[];
  ticketStatuses: string[];
  taskStatus: string;
  ticketStatus: string;
  exactTask: string;
  prefixTask: string;
  ftsTask: string;
  fuzzyTask: string;
  tamilTask: string;
  workspaceDoc: string;
  selectedDoc: string;
  docAccess: string;
  project: string;
  ticket: string;
  ticketConversation: string;
  form: string;
  formVersion: string;
  formSubmission: string;
  goal: string;
  goalProgressEvent: string;
  asset: string;
  automation: string;
  automationVersion: string;
  automationEvent: string;
  automationMatch: string;
  automationExecution: string;
  apiKey: string;
  webhook: string;
  integration: string;
  invoiceA: string;
  invoiceB: string;
  taskA1: string;
  taskA2: string;
  taskA3: string;
  taskB1: string;
  parentWorkspaceDoc: string;
  parentPrivateDoc: string;
  parentSelectedDoc: string;
  workerTask: string;
};
