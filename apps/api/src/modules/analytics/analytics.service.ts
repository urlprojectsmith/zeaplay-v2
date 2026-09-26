import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AnalyticsBucket,
  AnalyticsScopeType,
  AssetLifecycle,
  AssetStatus,
  AutomationExecutionStatus,
  AutomationWorkflowStatus,
  BillingUsageScope,
  GamificationGlobalScoreEventStatus,
  GoalStatus,
  MembershipStatus,
  Prisma,
  ProjectStatus,
  StatusEntityType,
  SuperAgencySubscriptionStatus,
} from '@prisma/client';
import { DateTime } from 'luxon';
import type {
  AgencyTenantContext,
  SuperAgencyTenantContext,
  WorkspaceTenantContext,
} from '../../common/auth/auth.types';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { BILLING_RESOURCE_KEYS } from '../billing/billing.constants';
import type { AnalyticsQueryDto } from './dto/analytics.dto';
import {
  ANALYTICS_DIMENSIONS,
  ANALYTICS_FILTERS,
  DEFAULT_ANALYTICS_METRICS,
  METRIC_REGISTRY,
  METRIC_REGISTRY_BY_KEY,
  type AnalyticsDimension,
  type AnalyticsScope,
  type MetricDefinition,
} from './analytics.registry';

const MAX_METRICS_PER_QUERY = 12;
const MAX_RANGE_DAYS = 366;
const ANALYTICS_CACHE_TTL_SECONDS = 30;
const EMPTY_UUID = '00000000-0000-4000-8000-000000000000';
const storageStatuses: AssetStatus[] = [
  AssetStatus.UPLOADED,
  AssetStatus.PROCESSING,
  AssetStatus.READY,
];
const quotaLifecycles: AssetLifecycle[] = [
  AssetLifecycle.ACTIVE,
  AssetLifecycle.ARCHIVED,
  AssetLifecycle.PENDING_DELETE,
  AssetLifecycle.PURGING,
];

type ResolvedScope = {
  type: AnalyticsScope;
  id: string;
  workspaceIds: string[];
  agencyIds: string[];
  superAgencyId?: string | null;
  timezone: string;
  financialAllowed: boolean;
};

type MetricValue = {
  key: string;
  displayName: string;
  domain: string;
  valueType: string;
  unit: string;
  value: number | string | null;
  comparison: { previous: number | string | null; percentChange: number | null } | null;
  sourceStrategy: string;
  freshnessMode: string;
  financialSensitivity: boolean;
};

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  registry() {
    return {
      metrics: METRIC_REGISTRY,
      dimensions: ANALYTICS_DIMENSIONS,
      filters: ANALYTICS_FILTERS,
      limits: {
        maxMetricsPerQuery: MAX_METRICS_PER_QUERY,
        maxRangeDays: MAX_RANGE_DAYS,
        maxPageSize: 100,
      },
      policy: {
        interval: 'HALF_OPEN_UTC',
        redisAuthority: false,
        metricDefinitions: 'SERVER_OWNED_CODE_REGISTRY',
      },
    };
  }

  async workspaceSummary(tenant: WorkspaceTenantContext, query: AnalyticsQueryDto) {
    const scope = await this.resolveWorkspaceScope(tenant);
    if (query.workspaceId && query.workspaceId !== scope.id) {
      throw new ForbiddenException('Workspace denied.');
    }
    if (query.agencyId && !scope.agencyIds.includes(query.agencyId)) {
      throw new ForbiddenException('Agency denied.');
    }
    return this.query(scope, query);
  }

  async agencySummary(tenant: AgencyTenantContext, query: AnalyticsQueryDto) {
    const scope = await this.resolveAgencyScope(tenant, query);
    return this.query(scope, query);
  }

  async superAgencySummary(tenant: SuperAgencyTenantContext, query: AnalyticsQueryDto) {
    const scope = await this.resolveSuperAgencyScope(tenant, query);
    return this.query(scope, query);
  }

  async rebuildSuperAgencyRollups(tenant: SuperAgencyTenantContext, query: AnalyticsQueryDto) {
    const scope = await this.resolveSuperAgencyScope(tenant, query);
    return this.rebuildRollups(scope, query);
  }

  async platformSummary(query: AnalyticsQueryDto) {
    const agencies = await this.prisma.agency.findMany({
      where: query.agencyId ? { id: query.agencyId } : undefined,
      select: { id: true },
    });
    if (query.agencyId && !agencies.length) throw new ForbiddenException('Agency denied.');
    const agencyIds = agencies.map((agency) => agency.id);
    const workspaces = await this.prisma.workspace.findMany({
      where: {
        ...(agencyIds.length ? { agencyId: { in: agencyIds } } : {}),
        ...(query.workspaceId ? { id: query.workspaceId } : {}),
      },
      select: { id: true },
    });
    if (query.workspaceId && !workspaces.length) throw new ForbiddenException('Workspace denied.');
    return this.query(
      {
        type: 'PLATFORM',
        id: EMPTY_UUID,
        workspaceIds: workspaces.map((workspace) => workspace.id),
        agencyIds,
        timezone: 'UTC',
        financialAllowed: true,
      },
      query,
    );
  }

  async rebuildRollups(scope: ResolvedScope, query: AnalyticsQueryDto) {
    const parsed = this.parseQuery(scope, query);
    const rollupMetrics = parsed.metrics.filter((metric) => metric.rollupStrategy !== 'NONE');
    const lockKey = `analytics-rollup:${scope.type}:${scope.id}`;
    const claimed = await this.prisma.$queryRaw<Array<{ locked: boolean }>>(Prisma.sql`
      SELECT pg_try_advisory_lock(hashtext(${lockKey})) AS locked
    `);
    if (!claimed[0]?.locked) return { rebuilt: 0, locked: true };
    try {
      let rebuilt = 0;
      for (const metric of rollupMetrics) {
        if (!metric.supportsTimeSeries) continue;
        const buckets = await this.timeSeriesForMetric(scope, metric, parsed.range, parsed.bucket);
        await this.prisma.analyticsRollup.deleteMany({
          where: {
            scopeType: scope.type as AnalyticsScopeType,
            scopeId: scope.id,
            metricKey: metric.key,
            bucket: parsed.bucket as AnalyticsBucket,
            bucketStart: { gte: parsed.range.start, lt: parsed.range.end },
          },
        });
        if (buckets.length) {
          await this.prisma.analyticsRollup.createMany({
            data: buckets.map((bucket) => ({
              scopeType: scope.type as AnalyticsScopeType,
              scopeId: scope.id,
              workspaceId: scope.type === 'WORKSPACE' ? scope.id : null,
              metricKey: metric.key,
              bucket: parsed.bucket as AnalyticsBucket,
              bucketStart: bucket.start,
              bucketEnd: bucket.end,
              dimensionKey: null,
              dimensionValue: null,
              value: new Prisma.Decimal(bucket.value ?? 0),
              version: 1,
              rebuiltAt: new Date(),
            })),
          });
          rebuilt += buckets.length;
        }
      }
      return { rebuilt, locked: false };
    } finally {
      await this.prisma.$queryRaw`SELECT pg_advisory_unlock(hashtext(${lockKey}))`;
    }
  }

  private async query(scope: ResolvedScope, query: AnalyticsQueryDto) {
    const parsed = this.parseQuery(scope, query);
    const cacheKey = this.cacheKey(scope, parsed);
    const cached = await this.getCache(cacheKey);
    if (cached) return cached;
    const metrics: MetricValue[] = [];
    for (const metric of parsed.metrics) {
      const value = await this.valueForMetric(scope, metric, parsed.range);
      const comparison = metric.supportsComparison
        ? await this.comparison(scope, metric, parsed.range, value)
        : null;
      metrics.push({
        key: metric.key,
        displayName: metric.displayName,
        domain: metric.domain,
        valueType: metric.valueType,
        unit: metric.unit,
        value,
        comparison,
        sourceStrategy: metric.sourceStrategy,
        freshnessMode: metric.freshnessMode,
        financialSensitivity: metric.financialSensitivity,
      });
    }
    const primaryTimeSeriesMetric = parsed.metrics.find((metric) => metric.supportsTimeSeries);
    const timeSeries = primaryTimeSeriesMetric
      ? await this.timeSeriesForMetric(scope, primaryTimeSeriesMetric, parsed.range, parsed.bucket)
      : [];
    const dimension = parsed.dimension
      ? await this.dimensionBreakdown(scope, parsed.metrics[0]!, parsed.range, parsed.dimension)
      : null;
    const result = {
      scope: {
        type: scope.type,
        id: scope.id,
        workspaceCount: scope.workspaceIds.length,
        agencyCount: scope.agencyIds.length,
      },
      range: {
        start: parsed.range.start.toISOString(),
        end: parsed.range.end.toISOString(),
        timezone: scope.timezone,
        interval: 'start <= occurredAt < end',
      },
      metrics,
      timeSeries: {
        metricKey: primaryTimeSeriesMetric?.key ?? null,
        bucket: parsed.bucket,
        points: timeSeries.map((point) => ({
          start: point.start.toISOString(),
          end: point.end.toISOString(),
          value: point.value,
        })),
      },
      dimension,
      pagination: { page: query.page, pageSize: query.pageSize },
      cache: {
        key: cacheKey,
        ttlSeconds: ANALYTICS_CACHE_TTL_SECONDS,
        redisAuthority: false,
      },
      privacy: {
        financialAllowed: scope.financialAllowed,
        parentSafeAggregateOnly: scope.type !== 'WORKSPACE',
      },
    };
    await this.setCache(cacheKey, result);
    return result;
  }

  private parseQuery(scope: ResolvedScope, query: AnalyticsQueryDto) {
    const metricKeys = normalizeMetricKeys(query.metrics);
    if (metricKeys.length > MAX_METRICS_PER_QUERY) {
      throw new BadRequestException({
        code: 'ANALYTICS_TOO_MANY_METRICS',
        message: 'Analytics metric count exceeds the configured limit.',
      });
    }
    const metrics = metricKeys.map((key) => {
      const metric = METRIC_REGISTRY_BY_KEY.get(key);
      if (!metric) throw new BadRequestException({ code: 'ANALYTICS_METRIC_NOT_SUPPORTED', key });
      if (!metric.supportedScopes.includes(scope.type)) {
        throw new ForbiddenException({ code: 'ANALYTICS_SCOPE_NOT_SUPPORTED', key });
      }
      if (metric.financialSensitivity && !scope.financialAllowed) {
        throw new ForbiddenException({ code: 'ANALYTICS_FINANCIAL_SCOPE_DENIED', key });
      }
      return metric;
    });
    const dimension = query.dimension as AnalyticsDimension | undefined;
    if (dimension && !metrics[0]?.supportedDimensions.includes(dimension)) {
      throw new BadRequestException({ code: 'ANALYTICS_DIMENSION_NOT_SUPPORTED', dimension });
    }
    this.assertSupportedFilters(metrics, query);
    const range = dateRange(query, scope.timezone);
    const spanDays = (range.end.getTime() - range.start.getTime()) / 86_400_000;
    if (spanDays <= 0 || spanDays > MAX_RANGE_DAYS) {
      throw new BadRequestException({ code: 'ANALYTICS_DATE_RANGE_INVALID' });
    }
    return { metrics, range, bucket: query.bucket ?? 'DAY', dimension };
  }

  private assertSupportedFilters(metrics: MetricDefinition[], query: AnalyticsQueryDto) {
    const filterMap: Array<[keyof AnalyticsQueryDto, string]> = [
      ['workspaceId', 'WORKSPACE'],
      ['agencyId', 'AGENCY'],
      ['departmentId', 'DEPARTMENT'],
      ['status', 'STATUS'],
      ['priority', 'PRIORITY'],
      ['plan', 'PLAN'],
      ['subscriptionStatus', 'SUBSCRIPTION_STATUS'],
    ];
    for (const [field, filter] of filterMap) {
      if (!query[field]) continue;
      for (const metric of metrics) {
        if (!metric.supportedFilters.includes(filter as never)) {
          throw new BadRequestException({
            code: 'ANALYTICS_FILTER_NOT_SUPPORTED',
            metricKey: metric.key,
            filter,
          });
        }
      }
    }
  }

  private async resolveWorkspaceScope(tenant: WorkspaceTenantContext): Promise<ResolvedScope> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: tenant.workspaceId },
      select: {
        id: true,
        timezone: true,
        agencyId: true,
        agency: { select: { superAgencyId: true } },
      },
    });
    if (!workspace) throw new NotFoundException('WORKSPACE_NOT_FOUND');
    return {
      type: 'WORKSPACE',
      id: workspace.id,
      workspaceIds: [workspace.id],
      agencyIds: [workspace.agencyId],
      superAgencyId: workspace.agency.superAgencyId,
      timezone: safeTimezone(workspace.timezone),
      financialAllowed: false,
    };
  }

  private async resolveAgencyScope(
    tenant: AgencyTenantContext,
    query: AnalyticsQueryDto,
  ): Promise<ResolvedScope> {
    if (query.agencyId && query.agencyId !== tenant.agencyId) {
      throw new ForbiddenException('Agency denied.');
    }
    const workspaceWhere: Prisma.WorkspaceWhereInput = {
      agencyId: tenant.agencyId,
      ...(query.workspaceId ? { id: query.workspaceId } : {}),
    };
    const workspaces = await this.prisma.workspace.findMany({
      where: workspaceWhere,
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    if (query.workspaceId && !workspaces.length) throw new ForbiddenException('Workspace denied.');
    return {
      type: 'AGENCY',
      id: tenant.agencyId,
      workspaceIds: workspaces.map((workspace) => workspace.id),
      agencyIds: [tenant.agencyId],
      superAgencyId: tenant.superAgencyId,
      timezone: 'UTC',
      financialAllowed: false,
    };
  }

  private async resolveSuperAgencyScope(
    tenant: SuperAgencyTenantContext,
    query: AnalyticsQueryDto,
  ): Promise<ResolvedScope> {
    const agencyWhere: Prisma.AgencyWhereInput = {
      superAgencyId: tenant.superAgencyId,
      ...(query.agencyId ? { id: query.agencyId } : {}),
    };
    const agencies = await this.prisma.agency.findMany({
      where: agencyWhere,
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    if (query.agencyId && !agencies.length) throw new ForbiddenException('Agency denied.');
    const agencyIds = agencies.map((agency) => agency.id);
    const workspaces = await this.prisma.workspace.findMany({
      where: {
        agencyId: { in: agencyIds.length ? agencyIds : [EMPTY_UUID] },
        ...(query.workspaceId ? { id: query.workspaceId } : {}),
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    if (query.workspaceId && !workspaces.length) throw new ForbiddenException('Workspace denied.');
    return {
      type: 'SUPER_AGENCY',
      id: tenant.superAgencyId,
      workspaceIds: workspaces.map((workspace) => workspace.id),
      agencyIds,
      superAgencyId: tenant.superAgencyId,
      timezone: 'UTC',
      financialAllowed: true,
    };
  }

  private async valueForMetric(scope: ResolvedScope, metric: MetricDefinition, range: DateRange) {
    const where = this.workspaceDateWhere(scope, range, 'createdAt');
    switch (metric.key) {
      case 'tasks.total':
        return this.prisma.task.count({ where: { ...where, deletedAt: null } });
      case 'tasks.completed':
        return this.prisma.task.count({
          where: {
            ...where,
            deletedAt: null,
            statusDefinitionId: { in: await this.terminalStatusIds(scope, StatusEntityType.TASK) },
          },
        });
      case 'tasks.open':
        return this.prisma.task.count({
          where: {
            ...where,
            deletedAt: null,
            statusDefinitionId: {
              notIn: await this.terminalStatusIds(scope, StatusEntityType.TASK),
            },
          },
        });
      case 'tasks.overdue':
        return this.prisma.task.count({
          where: {
            workspaceId: { in: scope.workspaceIds },
            deletedAt: null,
            dueAt: { lt: new Date() },
            statusDefinitionId: {
              notIn: await this.terminalStatusIds(scope, StatusEntityType.TASK),
            },
          },
        });
      case 'projects.total':
        return this.prisma.project.count({ where: { ...where, archivedAt: null } });
      case 'projects.completed':
        return this.prisma.project.count({
          where: {
            ...where,
            archivedAt: null,
            statusDefinitionId: {
              in: await this.terminalStatusIds(scope, StatusEntityType.PROJECT),
            },
          },
        });
      case 'projects.active':
        return this.prisma.project.count({
          where: {
            workspaceId: { in: scope.workspaceIds },
            archivedAt: null,
            status: ProjectStatus.ACTIVE,
          },
        });
      case 'tickets.total':
        return this.prisma.ticket.count({ where: { ...where, deletedAt: null } });
      case 'tickets.resolved':
        return this.prisma.ticket.count({
          where: {
            ...where,
            deletedAt: null,
            statusDefinitionId: {
              in: await this.terminalStatusIds(scope, StatusEntityType.TICKET),
            },
          },
        });
      case 'tickets.open':
        return this.prisma.ticket.count({
          where: {
            ...where,
            deletedAt: null,
            statusDefinitionId: {
              notIn: await this.terminalStatusIds(scope, StatusEntityType.TICKET),
            },
          },
        });
      case 'gamification.xp_earned':
        return sumNumber(
          await this.prisma.gamificationXpEntry.aggregate({
            where: this.workspaceDateWhere(scope, range, 'createdAt'),
            _sum: { amount: true },
          }),
          'amount',
        );
      case 'gamification.global_score':
        return sumNumber(
          await this.prisma.gamificationGlobalScoreEvent.aggregate({
            where: {
              workspaceId: { in: scope.workspaceIds },
              occurredAt: { gte: range.start, lt: range.end },
              status: GamificationGlobalScoreEventStatus.APPLIED,
            },
            _sum: { normalizedScore: true },
          }),
          'normalizedScore',
        );
      case 'gamification.badges_awarded':
        return this.prisma.gamificationBadgeAward.count({ where });
      case 'gamification.achievements_awarded':
        return this.prisma.gamificationAchievementAward.count({ where });
      case 'automation.executions':
        return this.prisma.automationExecution.count({ where });
      case 'automation.successful':
        return this.prisma.automationExecution.count({
          where: { ...where, status: AutomationExecutionStatus.SUCCEEDED },
        });
      case 'automation.failed':
        return this.prisma.automationExecution.count({
          where: {
            ...where,
            status: {
              in: [AutomationExecutionStatus.FAILED, AutomationExecutionStatus.DEAD_LETTERED],
            },
          },
        });
      case 'automation.active_workflows':
        return this.prisma.automationWorkflow.count({
          where: {
            workspaceId: { in: scope.workspaceIds },
            status: AutomationWorkflowStatus.PUBLISHED,
          },
        });
      case 'forms.submissions':
        return this.prisma.formSubmission.count({ where });
      case 'goals.active':
        return this.prisma.goal.count({
          where: { workspaceId: { in: scope.workspaceIds }, status: GoalStatus.ACTIVE },
        });
      case 'goals.completed':
        return this.prisma.goal.count({ where: { ...where, status: GoalStatus.COMPLETED } });
      case 'goals.expired':
        return this.prisma.goal.count({ where: { ...where, status: GoalStatus.EXPIRED } });
      case 'goals.completion_rate':
        return this.goalCompletionRate(scope, range);
      case 'files.storage_bytes':
        return this.storageBytes(scope);
      case 'files.assets':
        return this.prisma.asset.count({ where: { ...where, status: { in: storageStatuses } } });
      case 'api.requests':
        return this.apiRequests(scope, range);
      case 'memberships.active':
        return this.prisma.workspaceMembership.count({
          where: { workspaceId: { in: scope.workspaceIds }, status: MembershipStatus.ACTIVE },
        });
      case 'billing.active_subscriptions':
        return this.billingActiveSubscriptions(scope);
      default:
        throw new BadRequestException({
          code: 'ANALYTICS_METRIC_NOT_IMPLEMENTED',
          key: metric.key,
        });
    }
  }

  private async comparison(
    scope: ResolvedScope,
    metric: MetricDefinition,
    range: DateRange,
    current: number | string | null,
  ) {
    const previousRange = previousEquivalentRange(range);
    const previous = await this.valueForMetric(scope, metric, previousRange);
    return { previous, percentChange: percentChange(toNumber(current), toNumber(previous)) };
  }

  private async timeSeriesForMetric(
    scope: ResolvedScope,
    metric: MetricDefinition,
    range: DateRange,
    bucket: string,
  ) {
    const windows = bucketWindows(range, bucket as AnalyticsBucket);
    const points = [];
    for (const window of windows.slice(0, 400)) {
      points.push({ ...window, value: await this.valueForMetric(scope, metric, window) });
    }
    return points;
  }

  private async dimensionBreakdown(
    scope: ResolvedScope,
    metric: MetricDefinition,
    range: DateRange,
    dimension: AnalyticsDimension,
  ) {
    if (dimension === 'WORKSPACE') {
      const rows = await this.prisma.workspace.findMany({
        where: { id: { in: scope.workspaceIds } },
        select: { id: true, name: true },
        take: 100,
      });
      return {
        dimension,
        items: await Promise.all(
          rows.map(async (workspace) => ({
            key: workspace.id,
            label: workspace.name,
            value: await this.valueForMetric(
              { ...scope, type: 'WORKSPACE', id: workspace.id, workspaceIds: [workspace.id] },
              metric,
              range,
            ),
          })),
        ),
      };
    }
    if (dimension === 'AGENCY') {
      const rows = await this.prisma.agency.findMany({
        where: { id: { in: scope.agencyIds } },
        select: { id: true, name: true },
        take: 100,
      });
      return {
        dimension,
        items: await Promise.all(
          rows.map(async (agency) => {
            const workspaces = await this.prisma.workspace.findMany({
              where: { agencyId: agency.id },
              select: { id: true },
            });
            return {
              key: agency.id,
              label: agency.name,
              value: await this.valueForMetric(
                {
                  ...scope,
                  type: 'AGENCY',
                  id: agency.id,
                  workspaceIds: workspaces.map((workspace) => workspace.id),
                  agencyIds: [agency.id],
                },
                metric,
                range,
              ),
            };
          }),
        ),
      };
    }
    return { dimension, items: [] };
  }

  private workspaceDateWhere(
    scope: ResolvedScope,
    range: DateRange,
    field: 'createdAt' | 'updatedAt' | 'occurredAt',
  ) {
    return {
      workspaceId: { in: scope.workspaceIds },
      [field]: { gte: range.start, lt: range.end },
    };
  }

  private async terminalStatusIds(scope: ResolvedScope, entityType: StatusEntityType) {
    const rows = await this.prisma.statusDefinition.findMany({
      where: { workspaceId: { in: scope.workspaceIds }, entityType, isTerminal: true },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  private async goalCompletionRate(scope: ResolvedScope, range: DateRange) {
    const [completed, total] = await Promise.all([
      this.prisma.goal.count({
        where: {
          ...this.workspaceDateWhere(scope, range, 'createdAt'),
          status: GoalStatus.COMPLETED,
        },
      }),
      this.prisma.goal.count({ where: this.workspaceDateWhere(scope, range, 'createdAt') }),
    ]);
    return total > 0 ? Math.round((completed / total) * 10000) / 100 : null;
  }

  private async storageBytes(scope: ResolvedScope) {
    const [used, reserved] = await this.prisma.$transaction([
      this.prisma.asset.aggregate({
        where: {
          workspaceId: { in: scope.workspaceIds },
          status: { in: storageStatuses },
          lifecycle: { in: quotaLifecycles },
        },
        _sum: { sizeBytes: true },
      }),
      this.prisma.storageUploadReservation.aggregate({
        where: {
          workspaceId: { in: scope.workspaceIds },
          consumedAt: null,
          releasedAt: null,
          expiresAt: { gt: new Date() },
        },
        _sum: { reservedBytes: true },
      }),
    ]);
    return Number(used._sum.sizeBytes ?? 0n) + Number(reserved._sum.reservedBytes ?? 0n);
  }

  private async apiRequests(scope: ResolvedScope, range: DateRange) {
    const rows = await this.prisma.billingUsageCounter.aggregate({
      where: {
        scope: BillingUsageScope.WORKSPACE,
        scopeId: { in: scope.workspaceIds },
        resourceKey: BILLING_RESOURCE_KEYS.apiRequests,
        periodStart: { lt: range.end },
        periodEnd: { gt: range.start },
      },
      _sum: { used: true },
    });
    return Number(rows._sum.used ?? 0n);
  }

  private async billingActiveSubscriptions(scope: ResolvedScope) {
    const where: Prisma.SuperAgencySubscriptionWhereInput = {
      isCurrent: true,
      status: {
        in: [
          SuperAgencySubscriptionStatus.TRIALING,
          SuperAgencySubscriptionStatus.ACTIVE,
          SuperAgencySubscriptionStatus.GRACE_PERIOD,
          SuperAgencySubscriptionStatus.TRIAL_GRACE,
          SuperAgencySubscriptionStatus.PAYMENT_GRACE,
          SuperAgencySubscriptionStatus.PAST_DUE,
          SuperAgencySubscriptionStatus.RESTRICTED,
        ],
      },
      ...(scope.type === 'SUPER_AGENCY' ? { superAgencyId: scope.id } : {}),
    };
    return this.prisma.superAgencySubscription.count({ where });
  }

  private cacheKey(
    scope: ResolvedScope,
    parsed: { metrics: MetricDefinition[]; range: DateRange; bucket: string; dimension?: string },
  ) {
    return [
      'analytics',
      scope.type,
      scope.id,
      parsed.metrics.map((metric) => metric.key).join(','),
      parsed.range.start.toISOString(),
      parsed.range.end.toISOString(),
      parsed.bucket,
      parsed.dimension ?? 'none',
    ].join(':');
  }

  private async getCache(key: string) {
    try {
      const value = await this.redis.cache.get(key);
      return value ? JSON.parse(value) : null;
    } catch {
      return null;
    }
  }

  private async setCache(key: string, value: unknown) {
    try {
      await this.redis.cache.set(key, JSON.stringify(value), 'EX', ANALYTICS_CACHE_TTL_SECONDS);
    } catch {
      return;
    }
  }
}

type DateRange = { start: Date; end: Date };

function normalizeMetricKeys(value?: string) {
  const keys = value
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : DEFAULT_ANALYTICS_METRICS;
  return [...new Set(keys)];
}

function dateRange(query: AnalyticsQueryDto, timezone: string): DateRange {
  const zone = safeTimezone(timezone);
  const now = DateTime.utc();
  const localNow = now.setZone(zone);
  if (query.datePreset === 'CUSTOM') {
    if (!query.start || !query.end)
      throw new BadRequestException('CUSTOM range requires start and end.');
    return { start: new Date(query.start), end: new Date(query.end) };
  }
  const preset = query.datePreset ?? 'LAST_30_DAYS';
  const startEnd: [DateTime, DateTime] = (() => {
    switch (preset) {
      case 'TODAY':
        return [localNow.startOf('day'), localNow.startOf('day').plus({ days: 1 })];
      case 'YESTERDAY':
        return [localNow.startOf('day').minus({ days: 1 }), localNow.startOf('day')];
      case 'LAST_7_DAYS':
        return [
          localNow.startOf('day').minus({ days: 6 }),
          localNow.startOf('day').plus({ days: 1 }),
        ];
      case 'THIS_WEEK':
        return [localNow.startOf('week'), localNow.startOf('week').plus({ weeks: 1 })];
      case 'LAST_WEEK':
        return [localNow.startOf('week').minus({ weeks: 1 }), localNow.startOf('week')];
      case 'THIS_MONTH':
        return [localNow.startOf('month'), localNow.startOf('month').plus({ months: 1 })];
      case 'LAST_MONTH':
        return [localNow.startOf('month').minus({ months: 1 }), localNow.startOf('month')];
      case 'THIS_QUARTER':
        return [localNow.startOf('quarter'), localNow.startOf('quarter').plus({ quarters: 1 })];
      case 'LAST_QUARTER':
        return [localNow.startOf('quarter').minus({ quarters: 1 }), localNow.startOf('quarter')];
      case 'THIS_YEAR':
        return [localNow.startOf('year'), localNow.startOf('year').plus({ years: 1 })];
      case 'LAST_30_DAYS':
      default:
        return [
          localNow.startOf('day').minus({ days: 29 }),
          localNow.startOf('day').plus({ days: 1 }),
        ];
    }
  })();
  return { start: startEnd[0].toUTC().toJSDate(), end: startEnd[1].toUTC().toJSDate() };
}

function previousEquivalentRange(range: DateRange): DateRange {
  const span = range.end.getTime() - range.start.getTime();
  return {
    start: new Date(range.start.getTime() - span),
    end: new Date(range.end.getTime() - span),
  };
}

function percentChange(current: number | null, previous: number | null) {
  if (current === null || previous === null) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / Math.abs(previous)) * 10000) / 100;
}

function toNumber(value: number | string | null) {
  if (value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sumNumber(result: { _sum?: Record<string, number | bigint | null> | null }, key: string) {
  return Number(result._sum?.[key] ?? 0);
}

function bucketWindows(range: DateRange, bucket: AnalyticsBucket) {
  const unit =
    bucket === 'HOUR' ? 'hour' : bucket === 'WEEK' ? 'week' : bucket === 'MONTH' ? 'month' : 'day';
  const windows: DateRange[] = [];
  let cursor = DateTime.fromJSDate(range.start, { zone: 'utc' }).startOf(unit);
  const end = DateTime.fromJSDate(range.end, { zone: 'utc' });
  while (cursor < end && windows.length < 400) {
    const next = cursor.plus({ [unit]: 1 });
    windows.push({
      start:
        cursor < DateTime.fromJSDate(range.start, { zone: 'utc' })
          ? range.start
          : cursor.toJSDate(),
      end: next > end ? range.end : next.toJSDate(),
    });
    cursor = next;
  }
  return windows;
}

function safeTimezone(value: string | null | undefined) {
  return value && DateTime.local().setZone(value).isValid ? value : 'UTC';
}
