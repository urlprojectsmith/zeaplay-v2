import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import {
  AnalyticsScopeType,
  AssetLifecycle,
  AutomationWorkflowStatus,
  DocVisibility,
  MembershipStatus,
  Prisma,
  ProjectVisibility,
  SearchIndexOperation,
  SearchPrivacyClass,
  SearchResultType,
} from '@prisma/client';
import type { Queue } from 'bullmq';
import type {
  AgencyTenantContext,
  AuthenticatedUser,
  SuperAgencyTenantContext,
  WorkspaceTenantContext,
} from '../../common/auth/auth.types';
import { PermissionKeys } from '../../common/authorization/permissions';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  SEARCH_INDEX_JOB_TYPE,
  SEARCH_INDEX_QUEUE,
} from '../../infrastructure/queue/queue.constants';
import { RedisService } from '../../infrastructure/redis/redis.service';
import type { SearchQueryDto, SearchResultTypeKey } from './dto/search.dto';
import {
  PLATFORM_SCOPE_ID,
  SEARCH_CACHE_SECONDS,
  SEARCH_FUZZY_MIN_QUERY_LENGTH,
  SEARCH_MAX_PAGE_SIZE,
  SEARCH_MAX_QUERY_LENGTH,
  SEARCH_MIN_QUERY_LENGTH,
  SEARCH_RECENT_LIMIT,
  searchTypeByKey,
  searchTypeRegistry,
} from './search.registry';

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

type SearchRow = {
  id: string;
  scope_type: AnalyticsScopeType;
  scope_id: string;
  workspace_id: string | null;
  agency_id: string | null;
  super_agency_id: string | null;
  entity_type: SearchResultType;
  entity_id: string;
  title: string;
  subtitle: string | null;
  metadata: Prisma.JsonValue;
  route: Prisma.JsonValue;
  privacy_class: SearchPrivacyClass;
  archived: boolean;
  source_updated_at: Date;
  indexed_at: Date;
  score: number;
  snippet: string | null;
};

type SearchDocumentInput = {
  scope: SearchScope;
  entityType: SearchResultType;
  entityId: string;
  title: string;
  subtitle?: string | null;
  searchText: string;
  route: Prisma.InputJsonValue;
  metadata?: Prisma.InputJsonValue;
  privacyClass: SearchPrivacyClass;
  archived?: boolean;
  sourceUpdatedAt: Date;
  sourceVersion?: number;
};

type SearchIndexQueuePayload = {
  searchIndexJobId: string;
  operation: SearchIndexOperation;
  scopeType: AnalyticsScopeType;
  scopeId: string;
  types: SearchResultTypeKey[];
  sourceUpdatedAt: string;
};

const scopedTypes = new Set<SearchResultType>(
  searchTypeRegistry.map((item) => item.key as SearchResultType),
);

export const SEARCH_STATEMENT_TIMEOUT_MS = 1_500;
const SEARCH_QUERY_RATE_LIMIT = 90;
const SEARCH_RECENT_RATE_LIMIT = 30;
const SEARCH_REBUILD_RATE_LIMIT = 5;
const SEARCH_RATE_LIMIT_WINDOW_SECONDS = 60;
const parentWorkspaceTypes = ['TASK', 'PROJECT', 'TICKET', 'DOC', 'FORM', 'GOAL'];

@Injectable()
export class SearchService {
  private readonly rateLimitFallback = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Optional()
    @InjectQueue(SEARCH_INDEX_QUEUE)
    private readonly searchQueue?: Queue<SearchIndexQueuePayload>,
  ) {}

  workspaceScope(tenant: WorkspaceTenantContext): Promise<SearchScope> {
    return this.resolveScope(AnalyticsScopeType.WORKSPACE, tenant.workspaceId);
  }

  agencyScope(tenant: AgencyTenantContext): Promise<SearchScope> {
    return this.resolveScope(AnalyticsScopeType.AGENCY, tenant.agencyId);
  }

  superAgencyScope(tenant: SuperAgencyTenantContext): Promise<SearchScope> {
    return this.resolveScope(AnalyticsScopeType.SUPER_AGENCY, tenant.superAgencyId);
  }

  platformScope(): SearchScope {
    return {
      type: AnalyticsScopeType.PLATFORM,
      id: PLATFORM_SCOPE_ID,
      workspaceId: null,
      agencyId: null,
      superAgencyId: null,
    };
  }

  workspaceActor(tenant: WorkspaceTenantContext): SearchActor {
    return {
      userId: tenant.userId,
      permissions: tenant.permissions,
      workspaceMembershipId: tenant.workspaceMembershipId,
      agencyMembershipId: tenant.agencyMembershipId,
      superAgencyMembershipId: null,
    };
  }

  agencyActor(tenant: AgencyTenantContext): SearchActor {
    return {
      userId: tenant.userId,
      permissions: tenant.permissions,
      agencyMembershipId: tenant.agencyMembershipId,
      superAgencyMembershipId: tenant.superAgencyMembershipId,
    };
  }

  superAgencyActor(tenant: SuperAgencyTenantContext): SearchActor {
    return {
      userId: tenant.userId,
      permissions: tenant.permissions,
      superAgencyMembershipId: tenant.superAgencyMembershipId,
    };
  }

  platformActor(user: AuthenticatedUser): SearchActor {
    return {
      userId: user.id,
      permissions: [
        PermissionKeys.searchPlatformRead,
        PermissionKeys.searchView,
        PermissionKeys.billingInvoiceView,
      ],
    };
  }

  registry(scopeType?: AnalyticsScopeType) {
    const types = searchTypeRegistry.filter(
      (type) => !scopeType || type.scopes.includes(scopeType),
    );
    return {
      engine: 'POSTGRESQL',
      textSearchConfig: 'simple',
      minimumQueryLength: SEARCH_MIN_QUERY_LENGTH,
      fuzzyMinimumQueryLength: SEARCH_FUZZY_MIN_QUERY_LENGTH,
      maximumQueryLength: SEARCH_MAX_QUERY_LENGTH,
      maximumPageSize: SEARCH_MAX_PAGE_SIZE,
      types,
    };
  }

  async search(scope: SearchScope, actor: SearchActor, query: SearchQueryDto) {
    this.assertPermission(actor, PermissionKeys.searchView);
    const normalized = normalizeSearchQuery(query.q);
    if (normalized.length < SEARCH_MIN_QUERY_LENGTH) {
      throw new BadRequestException('SEARCH_QUERY_TOO_SHORT');
    }
    if (normalized.length > SEARCH_MAX_QUERY_LENGTH) {
      throw new BadRequestException('SEARCH_QUERY_TOO_LONG');
    }
    await this.assertSearchRateLimit(scope, actor, 'query');
    const types = this.allowedTypes(scope.type, actor, query.types);
    const page = bounded(query.page ?? 1, 1, 20);
    const pageSize = bounded(query.pageSize ?? 20, 1, SEARCH_MAX_PAGE_SIZE);
    if (!types.length) {
      return {
        query: normalized,
        scope: { type: scope.type, id: scope.id },
        page,
        pageSize,
        hasMore: false,
        results: [],
      };
    }
    const cacheKey = cacheKeyFor(
      scope,
      actor,
      normalized,
      types,
      page,
      pageSize,
      query.includeArchived,
    );
    const cacheable = canUseSearchCache(types);
    const cached = cacheable ? await this.readCache(cacheKey) : null;
    if (cached) return cached;

    const offset = (page - 1) * pageSize;
    const rows = await this.searchRowsWithTimeout(
      scope,
      normalized,
      types,
      query.includeArchived === true,
      pageSize + 8,
      offset,
    );
    const authorized = await this.filterAuthorizedRows(scope, actor, rows);
    const results = authorized.slice(0, pageSize).map((row) => serializeRow(row, normalized));
    const response = {
      query: normalized,
      scope: { type: scope.type, id: scope.id },
      page,
      pageSize,
      hasMore: authorized.length > pageSize,
      results,
    };
    if (cacheable) await this.writeCache(cacheKey, response);
    if (query.saveRecent !== false) await this.recordRecent(scope, actor, normalized, types);
    return response;
  }

  async recent(scope: SearchScope, actor: SearchActor) {
    this.assertPermission(actor, PermissionKeys.searchView);
    const items = await this.prisma.recentSearch.findMany({
      where: { userId: actor.userId, scopeType: scope.type, scopeId: scope.id },
      orderBy: { updatedAt: 'desc' },
      take: SEARCH_RECENT_LIMIT,
    });
    return {
      searches: items.map((item) => ({
        id: item.id,
        query: item.query,
        resultTypes: item.resultTypes,
        updatedAt: item.updatedAt,
      })),
    };
  }

  async clearRecent(scope: SearchScope, actor: SearchActor) {
    this.assertPermission(actor, PermissionKeys.searchView);
    await this.assertSearchRateLimit(scope, actor, 'recent');
    await this.prisma.recentSearch.deleteMany({
      where: { userId: actor.userId, scopeType: scope.type, scopeId: scope.id },
    });
    return { cleared: true };
  }

  async enqueueRebuild(scope: SearchScope, actor: SearchActor, types?: SearchResultTypeKey[]) {
    this.assertPermission(actor, PermissionKeys.searchPlatformRead);
    await this.assertSearchRateLimit(scope, actor, 'rebuild');
    if (!this.searchQueue) {
      throw new ServiceUnavailableException('SEARCH_INDEX_QUEUE_UNAVAILABLE');
    }
    const job = await this.prisma.searchIndexJob.create({
      data: {
        scopeType: scope.type,
        scopeId: scope.id,
        operation: SearchIndexOperation.REBUILD_SCOPE,
        payload: { types: types ?? [] },
      },
    });
    await this.searchQueue.add(
      SEARCH_INDEX_JOB_TYPE,
      {
        searchIndexJobId: job.id,
        operation: SearchIndexOperation.REBUILD_SCOPE,
        scopeType: scope.type,
        scopeId: scope.id,
        types: types ?? [],
        sourceUpdatedAt: new Date().toISOString(),
      },
      {
        jobId: `search-rebuild:${job.id}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1_000 },
      },
    );
    return { jobId: job.id, queued: true };
  }

  async upsertDocument(input: SearchDocumentInput) {
    const title = cleanSearchText(input.title).slice(0, 240);
    const subtitle = cleanSearchText(input.subtitle ?? '').slice(0, 300) || null;
    const searchText = cleanSearchText(input.searchText).slice(0, 8000);
    const sourceVersion = input.sourceVersion ?? 1;
    const identity = {
      scopeType: input.scope.type,
      scopeId: input.scope.id,
      entityType: input.entityType,
      entityId: input.entityId,
    };
    const data = {
      scopeType: input.scope.type,
      scopeId: input.scope.id,
      workspaceId: input.scope.workspaceId,
      agencyId: input.scope.agencyId,
      superAgencyId: input.scope.superAgencyId,
      entityType: input.entityType,
      entityId: input.entityId,
      title,
      subtitle,
      searchText,
      route: input.route,
      metadata: input.metadata ?? {},
      privacyClass: input.privacyClass,
      archived: input.archived ?? false,
      sourceUpdatedAt: input.sourceUpdatedAt,
      sourceVersion,
    };
    try {
      return await this.prisma.searchDocument.create({ data });
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
    }
    const updated = await this.prisma.searchDocument.updateMany({
      where: {
        ...identity,
        OR: [
          { sourceVersion: { lt: sourceVersion } },
          {
            sourceVersion,
            sourceUpdatedAt: { lte: input.sourceUpdatedAt },
          },
        ],
      },
      data,
    });
    if (updated.count > 0) {
      return this.prisma.searchDocument.findUnique({
        where: { scopeType_scopeId_entityType_entityId: identity },
      });
    }
    return this.prisma.searchDocument.findUnique({
      where: { scopeType_scopeId_entityType_entityId: identity },
    });
  }

  async deleteDocument(
    input: Pick<SearchDocumentInput, 'scope' | 'entityType' | 'entityId'> & {
      sourceUpdatedAt: Date;
      sourceVersion?: number;
    },
  ) {
    const sourceVersion = input.sourceVersion ?? 1;
    return this.prisma.searchDocument.deleteMany({
      where: {
        scopeType: input.scope.type,
        scopeId: input.scope.id,
        entityType: input.entityType,
        entityId: input.entityId,
        OR: [
          { sourceVersion: { lt: sourceVersion } },
          {
            sourceVersion,
            sourceUpdatedAt: { lte: input.sourceUpdatedAt },
          },
        ],
      },
    });
  }

  async archiveDocument(
    input: Pick<SearchDocumentInput, 'scope' | 'entityType' | 'entityId'> & {
      sourceUpdatedAt: Date;
      sourceVersion?: number;
    },
  ) {
    const sourceVersion = input.sourceVersion ?? 1;
    return this.prisma.searchDocument.updateMany({
      where: {
        scopeType: input.scope.type,
        scopeId: input.scope.id,
        entityType: input.entityType,
        entityId: input.entityId,
        OR: [
          { sourceVersion: { lt: sourceVersion } },
          {
            sourceVersion,
            sourceUpdatedAt: { lte: input.sourceUpdatedAt },
          },
        ],
      },
      data: {
        archived: true,
        sourceUpdatedAt: input.sourceUpdatedAt,
        sourceVersion,
      },
    });
  }

  private async searchRowsWithTimeout(
    scope: SearchScope,
    query: string,
    types: SearchResultType[],
    includeArchived: boolean,
    take: number,
    offset: number,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('statement_timeout', ${String(
          SEARCH_STATEMENT_TIMEOUT_MS,
        )}, true)`;
        return this.searchRows(tx, scope, query, types, includeArchived, take, offset);
      });
    } catch (error) {
      if (isStatementTimeout(error)) {
        throw new HttpException(
          { code: 'SEARCH_QUERY_TIMEOUT', message: 'Search query timed out.' },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      throw error;
    }
  }

  private async assertSearchRateLimit(
    scope: SearchScope,
    actor: SearchActor,
    action: 'query' | 'recent' | 'rebuild',
  ) {
    const limit =
      action === 'query'
        ? SEARCH_QUERY_RATE_LIMIT
        : action === 'recent'
          ? SEARCH_RECENT_RATE_LIMIT
          : SEARCH_REBUILD_RATE_LIMIT;
    const identifiers = [
      `${action}:actor:${actor.userId}:scope:${scope.type}:${scope.id}`,
      `${action}:scope:${scope.type}:${scope.id}`,
    ];
    const results = await Promise.all(
      identifiers.map((identifier) => this.consumeSearchRateLimit(identifier, limit)),
    );
    if (results.some((result) => !result.allowed)) {
      throw new HttpException(
        { code: 'SEARCH_RATE_LIMITED', message: 'Search rate limit exceeded.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async consumeSearchRateLimit(identifier: string, limit: number) {
    const bucket = Math.floor(Date.now() / 1000 / SEARCH_RATE_LIMIT_WINDOW_SECONDS);
    const key = `search:${identifier}:${bucket}`;
    try {
      const results = await this.redis.rateLimit
        .multi()
        .incr(key)
        .expire(key, SEARCH_RATE_LIMIT_WINDOW_SECONDS)
        .exec();
      const count = Number(results?.[0]?.[1] ?? 0);
      if (!count) throw new Error('SEARCH_RATE_LIMIT_COUNTER_FAILED');
      return { allowed: count <= limit };
    } catch {
      return this.consumeSearchRateLimitFallback(identifier, limit);
    }
  }

  private consumeSearchRateLimitFallback(identifier: string, limit: number) {
    if (process.env.NODE_ENV === 'production') {
      throw new ServiceUnavailableException('SEARCH_RATE_LIMIT_UNAVAILABLE');
    }
    const now = Date.now();
    const current = this.rateLimitFallback.get(identifier);
    if (!current || current.resetAt <= now) {
      this.rateLimitFallback.set(identifier, {
        count: 1,
        resetAt: now + SEARCH_RATE_LIMIT_WINDOW_SECONDS * 1000,
      });
      return { allowed: true };
    }
    current.count += 1;
    return { allowed: current.count <= limit };
  }

  private async searchRows(
    db: PrismaService | Prisma.TransactionClient,
    scope: SearchScope,
    query: string,
    types: SearchResultType[],
    includeArchived: boolean,
    take: number,
    offset: number,
  ) {
    const typeValues = Prisma.join(types.map((type) => Prisma.sql`${type}::"SearchResultType"`));
    return db.$queryRaw<SearchRow[]>`
      WITH q AS (
        SELECT
          websearch_to_tsquery('simple', ${query}) AS ts_query,
          lower(${query}) AS normalized_query
      )
      SELECT
        d."id",
        d."scope_type",
        d."scope_id",
        d."workspace_id",
        d."agency_id",
        d."super_agency_id",
        d."entity_type",
        d."entity_id",
        d."title",
        d."subtitle",
        d."metadata",
        d."route",
        d."privacy_class",
        d."archived",
        d."source_updated_at",
        d."indexed_at",
        ts_headline('simple', d."search_text", q.ts_query, 'MaxWords=18, MinWords=6, ShortWord=2, HighlightAll=false') AS "snippet",
        (
          CASE WHEN lower(d."title") = q.normalized_query THEN 100 ELSE 0 END +
          CASE WHEN lower(d."title") LIKE q.normalized_query || '%' THEN 45 ELSE 0 END +
          ts_rank_cd(d."search_vector", q.ts_query) * 20 +
          CASE WHEN length(${query}) >= ${SEARCH_FUZZY_MIN_QUERY_LENGTH} THEN similarity(d."title", ${query}) * 12 ELSE 0 END +
          CASE WHEN length(${query}) >= ${SEARCH_FUZZY_MIN_QUERY_LENGTH} THEN similarity(d."search_text", ${query}) * 4 ELSE 0 END +
          LEAST(2, GREATEST(0, EXTRACT(EPOCH FROM (now() - d."source_updated_at")) / -604800 + 2))
        )::float AS "score"
      FROM "search_documents" d, q
      WHERE d."scope_type" = ${scope.type}::"AnalyticsScopeType"
        AND d."scope_id" = ${scope.id}::uuid
        AND d."entity_type" IN (${typeValues})
        AND (${includeArchived} OR d."archived" = FALSE)
        AND (
          d."search_vector" @@ q.ts_query
          OR lower(d."title") LIKE q.normalized_query || '%'
          OR (length(${query}) >= ${SEARCH_FUZZY_MIN_QUERY_LENGTH} AND d."title" % ${query})
          OR (length(${query}) >= ${SEARCH_FUZZY_MIN_QUERY_LENGTH} AND d."search_text" % ${query})
        )
      ORDER BY "score" DESC, d."source_updated_at" DESC, d."id" ASC
      LIMIT ${take}
      OFFSET ${offset};
    `;
  }

  /*
   * Scope rebuild is kept as an internal utility for bounded repair flows. Public
   * tenant controllers do not call it; platform rebuilds are queued to the worker.
   */
  private async rebuildScope(scope: SearchScope, types?: SearchResultTypeKey[]) {
    const allowed = new Set(
      (types?.length
        ? types
        : this.allowedTypes(scope.type, { userId: '', permissions: ['*'] })
      ).map(String),
    );
    let indexed = 0;
    if (scope.type === AnalyticsScopeType.WORKSPACE && scope.workspaceId) {
      await this.prisma.searchDocument.deleteMany({
        where: { scopeType: scope.type, scopeId: scope.id },
      });
      indexed += await this.rebuildWorkspace(scope, allowed);
    } else if (scope.type === AnalyticsScopeType.AGENCY && scope.agencyId) {
      await this.prisma.searchDocument.deleteMany({
        where: { scopeType: scope.type, scopeId: scope.id },
      });
      indexed += await this.rebuildAgency(scope, allowed);
    } else if (scope.type === AnalyticsScopeType.SUPER_AGENCY && scope.superAgencyId) {
      await this.prisma.searchDocument.deleteMany({
        where: { scopeType: scope.type, scopeId: scope.id },
      });
      indexed += await this.rebuildSuperAgency(scope, allowed);
    } else if (scope.type === AnalyticsScopeType.PLATFORM) {
      await this.prisma.searchDocument.deleteMany({
        where: { scopeType: scope.type, scopeId: scope.id },
      });
      indexed += await this.rebuildPlatform(scope, allowed);
    }
    return { indexed };
  }

  private async rebuildWorkspace(scope: SearchScope, allowed: Set<string>) {
    const workspaceId = scope.workspaceId ?? scope.id;
    let indexed = 0;
    const [
      tasks,
      projects,
      tickets,
      docs,
      forms,
      goals,
      assets,
      members,
      automations,
      apiKeys,
      webhooks,
      integrations,
    ] = await Promise.all([
      allowed.has('TASK')
        ? this.prisma.task.findMany({ where: { workspaceId, deletedAt: null }, take: 1000 })
        : [],
      allowed.has('PROJECT')
        ? this.prisma.project.findMany({ where: { workspaceId }, take: 1000 })
        : [],
      allowed.has('TICKET')
        ? this.prisma.ticket.findMany({ where: { workspaceId, deletedAt: null }, take: 1000 })
        : [],
      allowed.has('DOC') ? this.prisma.doc.findMany({ where: { workspaceId }, take: 1000 }) : [],
      allowed.has('FORM') ? this.prisma.form.findMany({ where: { workspaceId }, take: 1000 }) : [],
      allowed.has('GOAL') ? this.prisma.goal.findMany({ where: { workspaceId }, take: 1000 }) : [],
      allowed.has('FILE') ? this.prisma.asset.findMany({ where: { workspaceId }, take: 1000 }) : [],
      allowed.has('MEMBER')
        ? this.prisma.workspaceMembership.findMany({
            where: { workspaceId },
            include: { user: { select: { name: true, email: true } } },
            take: 1000,
          })
        : [],
      allowed.has('AUTOMATION')
        ? this.prisma.automationWorkflow.findMany({ where: { workspaceId }, take: 1000 })
        : [],
      allowed.has('API_KEY')
        ? this.prisma.apiKey.findMany({ where: { workspaceId }, take: 1000 })
        : [],
      allowed.has('WEBHOOK')
        ? this.prisma.webhookSubscription.findMany({ where: { workspaceId }, take: 1000 })
        : [],
      allowed.has('INTEGRATION')
        ? this.prisma.integrationConnection.findMany({ where: { workspaceId }, take: 1000 })
        : [],
    ]);
    for (const task of tasks) {
      await this.upsertDocument({
        scope,
        entityType: SearchResultType.TASK,
        entityId: task.id,
        title: task.title,
        subtitle: task.priority,
        searchText: [task.title, task.description].join(' '),
        route: { href: `/workspace/tasks?task=${task.id}` },
        metadata: { statusDefinitionId: task.statusDefinitionId, priority: task.priority },
        privacyClass: SearchPrivacyClass.WORKSPACE_OPERATIONAL,
        archived: Boolean(task.archivedAt),
        sourceUpdatedAt: task.updatedAt,
      });
      indexed += 1;
    }
    for (const project of projects) {
      await this.upsertDocument({
        scope,
        entityType: SearchResultType.PROJECT,
        entityId: project.id,
        title: project.name,
        subtitle: project.status,
        searchText: [project.name, project.description].join(' '),
        route: { href: `/workspace/projects/${project.id}` },
        metadata: { status: project.status, visibility: project.visibility },
        privacyClass:
          project.visibility === ProjectVisibility.RESTRICTED
            ? SearchPrivacyClass.ACL_SENSITIVE
            : SearchPrivacyClass.WORKSPACE_OPERATIONAL,
        archived: Boolean(project.archivedAt),
        sourceUpdatedAt: project.updatedAt,
      });
      indexed += 1;
    }
    for (const ticket of tickets) {
      await this.upsertDocument({
        scope,
        entityType: SearchResultType.TICKET,
        entityId: ticket.id,
        title: ticket.subject,
        subtitle: ticket.ticketNumber,
        searchText: [ticket.ticketNumber, ticket.subject, ticket.description].join(' '),
        route: { href: `/workspace/tickets/${ticket.id}` },
        metadata: { ticketNumber: ticket.ticketNumber, priority: ticket.priority },
        privacyClass: SearchPrivacyClass.WORKSPACE_OPERATIONAL,
        sourceUpdatedAt: ticket.updatedAt,
      });
      indexed += 1;
    }
    for (const doc of docs) {
      await this.upsertDocument({
        scope,
        entityType: SearchResultType.DOC,
        entityId: doc.id,
        title: doc.title,
        subtitle: doc.visibility,
        searchText: [doc.title, extractStructuredText(doc.content)].join(' '),
        route: { href: `/workspace/docs?doc=${doc.id}` },
        metadata: { visibility: doc.visibility, type: doc.type },
        privacyClass:
          doc.visibility === DocVisibility.WORKSPACE
            ? SearchPrivacyClass.WORKSPACE_OPERATIONAL
            : SearchPrivacyClass.ACL_SENSITIVE,
        archived: doc.status === 'ARCHIVED',
        sourceUpdatedAt: doc.updatedAt,
        sourceVersion: doc.contentRevision,
      });
      indexed += 1;
    }
    for (const form of forms) {
      await this.upsertDocument({
        scope,
        entityType: SearchResultType.FORM,
        entityId: form.id,
        title: form.title,
        subtitle: form.status,
        searchText: [form.title, form.description].join(' '),
        route: { href: `/workspace/forms?form=${form.id}` },
        metadata: { status: form.status, type: form.type, visibility: form.visibility },
        privacyClass: SearchPrivacyClass.WORKSPACE_OPERATIONAL,
        archived: Boolean(form.archivedAt),
        sourceUpdatedAt: form.updatedAt,
      });
      indexed += 1;
    }
    for (const goal of goals) {
      await this.upsertDocument({
        scope,
        entityType: SearchResultType.GOAL,
        entityId: goal.id,
        title: goal.title,
        subtitle: goal.status,
        searchText: [goal.title, goal.description, goal.metricType, goal.periodType].join(' '),
        route: { href: `/workspace/goals?goal=${goal.id}` },
        metadata: { status: goal.status, metricType: goal.metricType, periodType: goal.periodType },
        privacyClass: SearchPrivacyClass.WORKSPACE_OPERATIONAL,
        archived: goal.status === 'ARCHIVED',
        sourceUpdatedAt: goal.updatedAt,
      });
      indexed += 1;
    }
    for (const asset of assets) {
      await this.upsertDocument({
        scope,
        entityType: SearchResultType.FILE,
        entityId: asset.id,
        title: asset.displayName,
        subtitle: asset.mimeType,
        searchText: [
          asset.displayName,
          asset.originalFilename,
          asset.extension,
          asset.mimeType,
        ].join(' '),
        route: { href: `/workspace/files?file=${asset.id}` },
        metadata: {
          extension: asset.extension,
          mimeType: asset.mimeType,
          lifecycle: asset.lifecycle,
        },
        privacyClass: SearchPrivacyClass.WORKSPACE_OPERATIONAL,
        archived: asset.lifecycle !== AssetLifecycle.ACTIVE,
        sourceUpdatedAt: asset.updatedAt,
      });
      indexed += 1;
    }
    for (const member of members) {
      await this.upsertDocument({
        scope,
        entityType: SearchResultType.MEMBER,
        entityId: member.id,
        title: member.user.name ?? member.user.email,
        subtitle: member.user.email,
        searchText: [member.user.name, member.user.email].join(' '),
        route: { href: `/workspace/users?member=${member.id}` },
        metadata: { status: member.status },
        privacyClass: SearchPrivacyClass.WORKSPACE_OPERATIONAL,
        archived: member.status !== MembershipStatus.ACTIVE,
        sourceUpdatedAt: member.updatedAt,
      });
      indexed += 1;
    }
    for (const automation of automations) {
      await this.upsertDocument({
        scope,
        entityType: SearchResultType.AUTOMATION,
        entityId: automation.id,
        title: automation.name,
        subtitle: automation.status,
        searchText: [automation.name, automation.description, automation.status].join(' '),
        route: { href: `/workspace/automations/${automation.id}` },
        metadata: { status: automation.status },
        privacyClass: SearchPrivacyClass.WORKSPACE_OPERATIONAL,
        archived: automation.status === AutomationWorkflowStatus.ARCHIVED,
        sourceUpdatedAt: automation.updatedAt,
      });
      indexed += 1;
    }
    for (const apiKey of apiKeys) {
      await this.upsertDocument({
        scope,
        entityType: SearchResultType.API_KEY,
        entityId: apiKey.id,
        title: apiKey.name,
        subtitle: apiKey.status,
        searchText: [apiKey.name, apiKey.description, apiKey.publicIdentifier, apiKey.status].join(
          ' ',
        ),
        route: { href: `/workspace/settings/api-keys?key=${apiKey.id}` },
        metadata: { status: apiKey.status, publicIdentifier: apiKey.publicIdentifier },
        privacyClass: SearchPrivacyClass.WORKSPACE_OPERATIONAL,
        archived: apiKey.status !== 'ACTIVE',
        sourceUpdatedAt: apiKey.updatedAt,
      });
      indexed += 1;
    }
    for (const webhook of webhooks) {
      await this.upsertDocument({
        scope,
        entityType: SearchResultType.WEBHOOK,
        entityId: webhook.id,
        title: webhook.name,
        subtitle: webhook.status,
        searchText: [
          webhook.name,
          webhook.description,
          webhook.eventTypes.join(' '),
          webhook.status,
        ].join(' '),
        route: { href: `/workspace/settings/webhooks?webhook=${webhook.id}` },
        metadata: { status: webhook.status, eventTypes: webhook.eventTypes },
        privacyClass: SearchPrivacyClass.WORKSPACE_OPERATIONAL,
        archived: webhook.status !== 'ACTIVE',
        sourceUpdatedAt: webhook.updatedAt,
      });
      indexed += 1;
    }
    for (const integration of integrations) {
      await this.upsertDocument({
        scope,
        entityType: SearchResultType.INTEGRATION,
        entityId: integration.id,
        title: integration.name,
        subtitle: integration.provider,
        searchText: [
          integration.name,
          integration.provider,
          integration.providerAccountLabel,
          integration.status,
        ].join(' '),
        route: { href: `/workspace/settings/integrations?connection=${integration.id}` },
        metadata: { status: integration.status, provider: integration.provider },
        privacyClass: SearchPrivacyClass.WORKSPACE_OPERATIONAL,
        archived: integration.status === 'DISABLED' || Boolean(integration.revokedAt),
        sourceUpdatedAt: integration.updatedAt,
      });
      indexed += 1;
    }
    return indexed;
  }

  private async rebuildAgency(scope: SearchScope, allowed: Set<string>) {
    let indexed = 0;
    const agencyId = scope.agencyId ?? scope.id;
    const needsWorkspaceLineage = parentWorkspaceTypes.some((type) => allowed.has(type));
    const workspaces =
      allowed.has('WORKSPACE') || needsWorkspaceLineage
        ? await this.prisma.workspace.findMany({ where: { agencyId }, take: 1000 })
        : [];
    for (const workspace of workspaces) {
      await this.upsertDocument({
        scope,
        entityType: SearchResultType.WORKSPACE,
        entityId: workspace.id,
        title: workspace.name,
        subtitle: workspace.status,
        searchText: [workspace.name, workspace.slug, workspace.status].join(' '),
        route: { href: `/agency/dashboard?workspace=${workspace.id}` },
        metadata: { status: workspace.status },
        privacyClass: SearchPrivacyClass.PARENT_SAFE_METADATA,
        archived: workspace.status === 'ARCHIVED',
        sourceUpdatedAt: workspace.updatedAt,
      });
      indexed += 1;
    }
    indexed += await this.rebuildParentWorkspaceEntities(
      scope,
      workspaces.map((workspace) => ({
        id: workspace.id,
        agencyId: workspace.agencyId,
        superAgencyId: scope.superAgencyId,
      })),
      allowed,
      'agency',
    );
    return indexed;
  }

  private async rebuildSuperAgency(scope: SearchScope, allowed: Set<string>) {
    let indexed = 0;
    const superAgencyId = scope.superAgencyId ?? scope.id;
    const needsWorkspaceLineage = parentWorkspaceTypes.some((type) => allowed.has(type));
    const [agencies, workspaces, invoices] = await Promise.all([
      allowed.has('AGENCY')
        ? this.prisma.agency.findMany({ where: { superAgencyId }, take: 1000 })
        : [],
      allowed.has('WORKSPACE') || needsWorkspaceLineage
        ? this.prisma.workspace.findMany({ where: { agency: { superAgencyId } }, take: 1000 })
        : [],
      allowed.has('BILLING_METADATA')
        ? this.prisma.billingInvoice.findMany({ where: { superAgencyId }, take: 1000 })
        : [],
    ]);
    for (const agency of agencies) {
      await this.upsertDocument({
        scope,
        entityType: SearchResultType.AGENCY,
        entityId: agency.id,
        title: agency.name,
        subtitle: agency.status,
        searchText: [agency.name, agency.slug, agency.status].join(' '),
        route: { href: `/super-agency/agencies/${agency.id}` },
        metadata: { status: agency.status },
        privacyClass: SearchPrivacyClass.PARENT_SAFE_METADATA,
        archived: agency.status === 'ARCHIVED',
        sourceUpdatedAt: agency.updatedAt,
      });
      indexed += 1;
    }
    for (const workspace of workspaces) {
      await this.upsertDocument({
        scope,
        entityType: SearchResultType.WORKSPACE,
        entityId: workspace.id,
        title: workspace.name,
        subtitle: workspace.status,
        searchText: [workspace.name, workspace.slug, workspace.status].join(' '),
        route: { href: `/super-agency/agencies/${workspace.agencyId}` },
        metadata: { status: workspace.status, agencyId: workspace.agencyId },
        privacyClass: SearchPrivacyClass.PARENT_SAFE_METADATA,
        archived: workspace.status === 'ARCHIVED',
        sourceUpdatedAt: workspace.updatedAt,
      });
      indexed += 1;
    }
    for (const invoice of invoices) {
      await this.upsertDocument({
        scope,
        entityType: SearchResultType.BILLING_METADATA,
        entityId: invoice.id,
        title: invoice.invoiceNumber ?? invoice.providerInvoiceId,
        subtitle: invoice.status,
        searchText: [invoice.invoiceNumber, invoice.status, invoice.provider].join(' '),
        route: { href: `/super-agency/billing?invoice=${invoice.id}` },
        metadata: { status: invoice.status, provider: invoice.provider },
        privacyClass: SearchPrivacyClass.BILLING_SAFE_METADATA,
        sourceUpdatedAt: invoice.updatedAt,
      });
      indexed += 1;
    }
    indexed += await this.rebuildParentWorkspaceEntities(
      scope,
      workspaces.map((workspace) => ({
        id: workspace.id,
        agencyId: workspace.agencyId,
        superAgencyId,
      })),
      allowed,
      'super-agency',
    );
    return indexed;
  }

  private async rebuildParentWorkspaceEntities(
    scope: SearchScope,
    workspaces: Array<{ id: string; agencyId: string; superAgencyId: string | null }>,
    allowed: Set<string>,
    routePrefix: 'agency' | 'super-agency',
  ) {
    const workspaceIds = workspaces.map((workspace) => workspace.id);
    if (!workspaceIds.length) return 0;
    const lineage = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
    let indexed = 0;
    const [tasks, projects, tickets, docs, forms, goals] = await Promise.all([
      allowed.has('TASK')
        ? this.prisma.task.findMany({
            where: { workspaceId: { in: workspaceIds }, deletedAt: null },
            take: 1000,
          })
        : [],
      allowed.has('PROJECT')
        ? this.prisma.project.findMany({ where: { workspaceId: { in: workspaceIds } }, take: 1000 })
        : [],
      allowed.has('TICKET')
        ? this.prisma.ticket.findMany({
            where: { workspaceId: { in: workspaceIds }, deletedAt: null },
            take: 1000,
          })
        : [],
      allowed.has('DOC')
        ? this.prisma.doc.findMany({
            where: { workspaceId: { in: workspaceIds }, visibility: DocVisibility.WORKSPACE },
            take: 1000,
          })
        : [],
      allowed.has('FORM')
        ? this.prisma.form.findMany({ where: { workspaceId: { in: workspaceIds } }, take: 1000 })
        : [],
      allowed.has('GOAL')
        ? this.prisma.goal.findMany({ where: { workspaceId: { in: workspaceIds } }, take: 1000 })
        : [],
    ]);
    const childScope = (workspaceId: string): SearchScope => {
      const item = lineage.get(workspaceId);
      return {
        type: scope.type,
        id: scope.id,
        workspaceId: null,
        agencyId:
          scope.type === AnalyticsScopeType.AGENCY ? (item?.agencyId ?? scope.agencyId) : null,
        superAgencyId: item?.superAgencyId ?? scope.superAgencyId,
      };
    };
    for (const task of tasks) {
      await this.upsertDocument({
        scope: childScope(task.workspaceId),
        entityType: SearchResultType.TASK,
        entityId: task.id,
        title: task.title,
        subtitle: task.priority,
        searchText: [task.title, task.priority].join(' '),
        route: { href: `/${routePrefix}/tasks?workspace=${task.workspaceId}&task=${task.id}` },
        metadata: { priority: task.priority },
        privacyClass: SearchPrivacyClass.PARENT_SAFE_METADATA,
        archived: Boolean(task.archivedAt),
        sourceUpdatedAt: task.updatedAt,
      });
      indexed += 1;
    }
    for (const project of projects) {
      await this.upsertDocument({
        scope: childScope(project.workspaceId),
        entityType: SearchResultType.PROJECT,
        entityId: project.id,
        title: project.name,
        subtitle: project.status,
        searchText: [project.name, project.status, project.visibility].join(' '),
        route: {
          href: `/${routePrefix}/projects?workspace=${project.workspaceId}&project=${project.id}`,
        },
        metadata: { status: project.status, visibility: project.visibility },
        privacyClass: SearchPrivacyClass.PARENT_SAFE_METADATA,
        archived: Boolean(project.archivedAt),
        sourceUpdatedAt: project.updatedAt,
      });
      indexed += 1;
    }
    for (const ticket of tickets) {
      await this.upsertDocument({
        scope: childScope(ticket.workspaceId),
        entityType: SearchResultType.TICKET,
        entityId: ticket.id,
        title: ticket.subject,
        subtitle: ticket.ticketNumber,
        searchText: [ticket.ticketNumber, ticket.subject, ticket.priority].join(' '),
        route: {
          href: `/${routePrefix}/tickets?workspace=${ticket.workspaceId}&ticket=${ticket.id}`,
        },
        metadata: { ticketNumber: ticket.ticketNumber, priority: ticket.priority },
        privacyClass: SearchPrivacyClass.PARENT_SAFE_METADATA,
        sourceUpdatedAt: ticket.updatedAt,
      });
      indexed += 1;
    }
    for (const doc of docs) {
      await this.upsertDocument({
        scope: childScope(doc.workspaceId),
        entityType: SearchResultType.DOC,
        entityId: doc.id,
        title: doc.title,
        subtitle: doc.visibility,
        searchText: [doc.title, extractStructuredText(doc.content)].join(' '),
        route: { href: `/${routePrefix}/docs?workspace=${doc.workspaceId}&doc=${doc.id}` },
        metadata: { visibility: doc.visibility, type: doc.type },
        privacyClass: SearchPrivacyClass.PARENT_SAFE_METADATA,
        archived: doc.status === 'ARCHIVED',
        sourceUpdatedAt: doc.updatedAt,
        sourceVersion: doc.contentRevision,
      });
      indexed += 1;
    }
    for (const form of forms) {
      await this.upsertDocument({
        scope: childScope(form.workspaceId),
        entityType: SearchResultType.FORM,
        entityId: form.id,
        title: form.title,
        subtitle: form.status,
        searchText: [form.title, form.description].join(' '),
        route: { href: `/${routePrefix}/forms?workspace=${form.workspaceId}&form=${form.id}` },
        metadata: { status: form.status, type: form.type, visibility: form.visibility },
        privacyClass: SearchPrivacyClass.PARENT_SAFE_METADATA,
        archived: Boolean(form.archivedAt),
        sourceUpdatedAt: form.updatedAt,
      });
      indexed += 1;
    }
    for (const goal of goals) {
      await this.upsertDocument({
        scope: childScope(goal.workspaceId),
        entityType: SearchResultType.GOAL,
        entityId: goal.id,
        title: goal.title,
        subtitle: goal.status,
        searchText: [goal.title, goal.description, goal.metricType, goal.periodType].join(' '),
        route: { href: `/${routePrefix}/goals?workspace=${goal.workspaceId}&goal=${goal.id}` },
        metadata: { status: goal.status, metricType: goal.metricType, periodType: goal.periodType },
        privacyClass: SearchPrivacyClass.PARENT_SAFE_METADATA,
        archived: goal.status === 'ARCHIVED',
        sourceUpdatedAt: goal.updatedAt,
      });
      indexed += 1;
    }
    return indexed;
  }

  private async rebuildPlatform(scope: SearchScope, allowed: Set<string>) {
    let indexed = 0;
    const [superAgencies, agencies, workspaces] = await Promise.all([
      allowed.has('SUPER_AGENCY') ? this.prisma.superAgency.findMany({ take: 1000 }) : [],
      allowed.has('AGENCY') ? this.prisma.agency.findMany({ take: 1000 }) : [],
      allowed.has('WORKSPACE') ? this.prisma.workspace.findMany({ take: 1000 }) : [],
    ]);
    for (const superAgency of superAgencies) {
      await this.upsertDocument({
        scope,
        entityType: SearchResultType.SUPER_AGENCY,
        entityId: superAgency.id,
        title: superAgency.name,
        subtitle: superAgency.status,
        searchText: [superAgency.name, superAgency.slug, superAgency.status].join(' '),
        route: { href: `/super-admin/dashboard?superAgency=${superAgency.id}` },
        metadata: { status: superAgency.status },
        privacyClass: SearchPrivacyClass.PLATFORM_SAFE_METADATA,
        archived: superAgency.status === 'ARCHIVED',
        sourceUpdatedAt: superAgency.updatedAt,
      });
      indexed += 1;
    }
    for (const agency of agencies) {
      await this.upsertDocument({
        scope,
        entityType: SearchResultType.AGENCY,
        entityId: agency.id,
        title: agency.name,
        subtitle: agency.status,
        searchText: [agency.name, agency.slug, agency.status].join(' '),
        route: { href: `/super-admin/dashboard?agency=${agency.id}` },
        metadata: { status: agency.status, superAgencyId: agency.superAgencyId },
        privacyClass: SearchPrivacyClass.PLATFORM_SAFE_METADATA,
        archived: agency.status === 'ARCHIVED',
        sourceUpdatedAt: agency.updatedAt,
      });
      indexed += 1;
    }
    for (const workspace of workspaces) {
      await this.upsertDocument({
        scope,
        entityType: SearchResultType.WORKSPACE,
        entityId: workspace.id,
        title: workspace.name,
        subtitle: workspace.status,
        searchText: [workspace.name, workspace.slug, workspace.status].join(' '),
        route: { href: `/super-admin/dashboard?workspace=${workspace.id}` },
        metadata: { status: workspace.status, agencyId: workspace.agencyId },
        privacyClass: SearchPrivacyClass.PLATFORM_SAFE_METADATA,
        archived: workspace.status === 'ARCHIVED',
        sourceUpdatedAt: workspace.updatedAt,
      });
      indexed += 1;
    }
    return indexed;
  }

  private async filterAuthorizedRows(scope: SearchScope, actor: SearchActor, rows: SearchRow[]) {
    const filtered: SearchRow[] = [];
    for (const row of rows) {
      if (await this.canReturnRow(scope, actor, row)) filtered.push(row);
    }
    return filtered;
  }

  private async canReturnRow(scope: SearchScope, actor: SearchActor, row: SearchRow) {
    const metadata = safeRecord(row.metadata);
    if (!this.actorCanSeeType(actor, row.entity_type)) return false;
    if (row.entity_type === SearchResultType.DOC && row.workspace_id) {
      if (scope.type !== AnalyticsScopeType.WORKSPACE) {
        return metadata.visibility === DocVisibility.WORKSPACE;
      }
      const doc = await this.prisma.doc.findFirst({
        where: { id: row.entity_id, workspaceId: row.workspace_id },
        select: {
          status: true,
          visibility: true,
          createdByMembershipId: true,
          accessList: { select: { membershipId: true } },
        },
      });
      if (!doc || doc.status === 'ARCHIVED') return false;
      if (doc.visibility === DocVisibility.WORKSPACE) return true;
      if (!actor.workspaceMembershipId) return false;
      return (
        doc.createdByMembershipId === actor.workspaceMembershipId ||
        doc.accessList.some((entry) => entry.membershipId === actor.workspaceMembershipId)
      );
    }
    if (row.entity_type === SearchResultType.PROJECT && row.workspace_id) {
      const visibility = metadata.visibility;
      if (visibility !== ProjectVisibility.RESTRICTED) return true;
      if (!actor.workspaceMembershipId) return false;
      const project = await this.prisma.project.findFirst({
        where: {
          id: row.entity_id,
          workspaceId: row.workspace_id,
          OR: [
            { ownerMembershipId: actor.workspaceMembershipId },
            { members: { some: { workspaceMembershipId: actor.workspaceMembershipId } } },
          ],
        },
        select: { id: true },
      });
      return Boolean(project);
    }
    return true;
  }

  private allowedTypes(
    scopeType: AnalyticsScopeType,
    actor: SearchActor,
    requested?: SearchResultTypeKey[],
  ) {
    const requestedSet = new Set((requested?.length ? requested : [...scopedTypes]).map(String));
    const values = searchTypeRegistry
      .filter((type) => type.scopes.includes(scopeType))
      .filter((type) => requestedSet.has(type.key))
      .filter((type) => this.actorCanSeeType(actor, type.key as SearchResultType))
      .map((type) => type.key as SearchResultType);
    return values;
  }

  private actorCanSeeType(actor: SearchActor, type: SearchResultType) {
    const metadata = searchTypeByKey.get(type);
    if (!metadata) return false;
    if (actor.permissions.includes('*')) return true;
    if (metadata.permission === PermissionKeys.searchPlatformRead) {
      return actor.permissions.includes(PermissionKeys.searchPlatformRead);
    }
    if (type === SearchResultType.BILLING_METADATA) {
      return (
        actor.permissions.includes(PermissionKeys.billingInvoiceView) ||
        actor.permissions.includes(PermissionKeys.searchPlatformRead)
      );
    }
    return (
      actor.permissions.includes(metadata.permission) || this.actorHasParentPermission(actor, type)
    );
  }

  private actorHasParentPermission(actor: SearchActor, type: SearchResultType) {
    const parentPermission =
      type === SearchResultType.TASK
        ? PermissionKeys.tasksParentRead
        : type === SearchResultType.PROJECT
          ? PermissionKeys.projectsParentRead
          : type === SearchResultType.TICKET
            ? PermissionKeys.ticketsParentRead
            : type === SearchResultType.DOC
              ? PermissionKeys.docsParentRead
              : type === SearchResultType.FORM
                ? PermissionKeys.formsParentRead
                : type === SearchResultType.GOAL
                  ? PermissionKeys.goalsParentRead
                  : null;
    return Boolean(parentPermission && actor.permissions.includes(parentPermission));
  }

  private assertPermission(actor: SearchActor, permission: string) {
    if (
      !actor.permissions.includes('*') &&
      !actor.permissions.includes(permission) &&
      !actor.permissions.includes(PermissionKeys.searchPlatformRead)
    ) {
      throw new ForbiddenException('SEARCH_PERMISSION_DENIED');
    }
  }

  private async recordRecent(
    scope: SearchScope,
    actor: SearchActor,
    query: string,
    types: SearchResultType[],
  ) {
    const queryNormalized = normalizeSearchQuery(query).toLocaleLowerCase();
    await this.prisma.recentSearch.upsert({
      where: {
        userId_scopeType_scopeId_queryNormalized: {
          userId: actor.userId,
          scopeType: scope.type,
          scopeId: scope.id,
          queryNormalized,
        },
      },
      create: {
        userId: actor.userId,
        scopeType: scope.type,
        scopeId: scope.id,
        workspaceMembershipId: actor.workspaceMembershipId ?? null,
        agencyMembershipId: actor.agencyMembershipId ?? null,
        superAgencyMembershipId: actor.superAgencyMembershipId ?? null,
        query,
        queryNormalized,
        resultTypes: types,
      },
      update: {
        query,
        resultTypes: types,
        workspaceMembershipId: actor.workspaceMembershipId ?? null,
        agencyMembershipId: actor.agencyMembershipId ?? null,
        superAgencyMembershipId: actor.superAgencyMembershipId ?? null,
      },
    });
    const stale = await this.prisma.recentSearch.findMany({
      where: { userId: actor.userId, scopeType: scope.type, scopeId: scope.id },
      orderBy: { updatedAt: 'desc' },
      skip: SEARCH_RECENT_LIMIT,
      select: { id: true },
    });
    if (stale.length) {
      await this.prisma.recentSearch.deleteMany({
        where: { id: { in: stale.map((item) => item.id) } },
      });
    }
  }

  private async resolveScope(type: AnalyticsScopeType, id: string): Promise<SearchScope> {
    if (type === AnalyticsScopeType.WORKSPACE) {
      const workspace = await this.prisma.workspace.findUnique({
        where: { id },
        select: { id: true, agencyId: true, agency: { select: { superAgencyId: true } } },
      });
      if (!workspace) throw new NotFoundException('WORKSPACE_NOT_FOUND');
      return {
        type,
        id,
        workspaceId: id,
        agencyId: workspace.agencyId,
        superAgencyId: workspace.agency.superAgencyId,
      };
    }
    if (type === AnalyticsScopeType.AGENCY) {
      const agency = await this.prisma.agency.findUnique({
        where: { id },
        select: { id: true, superAgencyId: true },
      });
      if (!agency) throw new NotFoundException('AGENCY_NOT_FOUND');
      return { type, id, workspaceId: null, agencyId: id, superAgencyId: agency.superAgencyId };
    }
    if (type === AnalyticsScopeType.SUPER_AGENCY) {
      const superAgency = await this.prisma.superAgency.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!superAgency) throw new NotFoundException('SUPER_AGENCY_NOT_FOUND');
      return { type, id, workspaceId: null, agencyId: null, superAgencyId: id };
    }
    return this.platformScope();
  }

  private async readCache(key: string) {
    try {
      const value = await this.redis.cache.get(key);
      return value ? JSON.parse(value) : null;
    } catch {
      return null;
    }
  }

  private async writeCache(key: string, value: unknown) {
    try {
      await this.redis.cache.set(key, JSON.stringify(value), 'EX', SEARCH_CACHE_SECONDS);
    } catch {
      return undefined;
    }
  }
}

function serializeRow(row: SearchRow, query: string) {
  return {
    id: row.id,
    type: row.entity_type,
    entityId: row.entity_id,
    title: row.title,
    subtitle: row.subtitle,
    snippet: safeSnippet(row.snippet, query),
    scope: { type: row.scope_type, id: row.scope_id },
    route: safeRecord(row.route),
    metadata: safeRecord(row.metadata),
    archived: row.archived,
    updatedAt: row.source_updated_at,
    score: Math.round(Number(row.score) * 1000) / 1000,
  };
}

function safeSnippet(snippet: string | null, query: string) {
  const text = cleanSearchText(snippet ?? '');
  if (text) return text.slice(0, 240);
  return query;
}

function normalizeSearchQuery(value: string | undefined) {
  return cleanSearchText(value ?? '').slice(0, SEARCH_MAX_QUERY_LENGTH);
}

function cleanSearchText(value: unknown) {
  const raw =
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : value instanceof Date
        ? value.toISOString()
        : '';
  return raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/javascript:/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractStructuredText(value: Prisma.JsonValue): string {
  const parts: string[] = [];
  visitJson(value, parts);
  return cleanSearchText(parts.join(' ')).slice(0, 6000);
}

function visitJson(value: Prisma.JsonValue, parts: string[]) {
  if (typeof value === 'string') {
    parts.push(value);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item) => visitJson(item, parts));
    return;
  }
  const record = value as Record<string, Prisma.JsonValue>;
  if (typeof record.text === 'string') parts.push(record.text);
  if (Array.isArray(record.content)) visitJson(record.content, parts);
}

function safeRecord(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cacheKeyFor(
  scope: SearchScope,
  actor: SearchActor,
  query: string,
  types: SearchResultType[],
  page: number,
  pageSize: number,
  includeArchived?: boolean,
) {
  return [
    'search',
    scope.type,
    scope.id,
    actor.userId,
    actor.workspaceMembershipId ?? '',
    actor.agencyMembershipId ?? '',
    actor.superAgencyMembershipId ?? '',
    query.toLocaleLowerCase(),
    types.join(','),
    page,
    pageSize,
    includeArchived ? 'archived' : 'active',
  ].join(':');
}

function canUseSearchCache(types: SearchResultType[]) {
  return !types.some((type) => type === SearchResultType.DOC || type === SearchResultType.PROJECT);
}

function bounded(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.trunc(Number.isFinite(value) ? value : min)));
}

function isUniqueConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function isStatementTimeout(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = error.meta as Record<string, unknown> | undefined;
    return error.code === 'P2010' && (meta?.code === '57014' || meta?.message === '57014');
  }
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('57014') || message.toLowerCase().includes('statement timeout');
}
