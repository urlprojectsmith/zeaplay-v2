'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Badge,
  EmptyState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@zea-play/ui';
import { Activity, BarChart3, CalendarDays, Gauge, ShieldCheck, TrendingUp } from 'lucide-react';
import { PageContainer } from '../layout/PageContainer';
import { PageHeader } from '../layout/PageHeader';
import { useSessionStore } from '../../stores/session';
import {
  analyticsKeys,
  getAgencyAnalytics,
  getPlatformAnalytics,
  getSuperAgencyAnalytics,
  getWorkspaceAnalytics,
  type AnalyticsDatePreset,
  type AnalyticsScopeType,
  type AnalyticsSummary,
} from '../../services/analytics';

const presetOptions: AnalyticsDatePreset[] = [
  'TODAY',
  'LAST_7_DAYS',
  'LAST_30_DAYS',
  'THIS_MONTH',
  'LAST_MONTH',
  'THIS_QUARTER',
  'THIS_YEAR',
];

const workspaceMetrics = [
  'tasks.total',
  'tasks.completed',
  'tickets.open',
  'projects.active',
  'gamification.xp_earned',
  'automation.executions',
  'forms.submissions',
  'goals.active',
  'files.storage_bytes',
  'api.requests',
  'memberships.active',
];

const parentMetrics = [
  'tasks.total',
  'tasks.completed',
  'tickets.open',
  'projects.active',
  'gamification.global_score',
  'automation.executions',
  'forms.submissions',
  'goals.completed',
  'files.storage_bytes',
  'api.requests',
  'memberships.active',
];

const commercialMetrics = [...parentMetrics, 'billing.active_subscriptions'];

export function AnalyticsPage({ scope }: { scope: AnalyticsScopeType }) {
  const { hydrated, hydrate, accessToken } = useSessionStore();
  const selectedWorkspaceId = useSessionStore((state) => state.selectedWorkspaceId);
  const selectedAgencyId = useSessionStore((state) => state.selectedAgencyId);
  const selectedSuperAgencyId = useSessionStore((state) => state.selectedSuperAgencyId);
  const [datePreset, setDatePreset] = useState<AnalyticsDatePreset>('LAST_30_DAYS');

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const scopeId =
    scope === 'WORKSPACE'
      ? selectedWorkspaceId
      : scope === 'AGENCY'
        ? selectedAgencyId
        : scope === 'SUPER_AGENCY'
          ? selectedSuperAgencyId
          : 'platform';
  const metrics =
    scope === 'WORKSPACE' || scope === 'AGENCY' ? workspaceMetrics : commercialMetrics;
  const params = useMemo(
    () => ({ datePreset, bucket: 'DAY' as const, metrics }),
    [datePreset, metrics],
  );
  const query = useQuery({
    queryKey: analyticsKeys.summary(scope, scopeId, params),
    queryFn: () => fetchSummary(scope, scopeId as string, params),
    enabled: Boolean(accessToken && scopeId && hydrated),
  });

  if (!hydrated) return <Skeleton className="h-96 rounded-md" />;

  return (
    <PageContainer>
      <PageHeader
        title="Analytics"
        description={scopeLabel(scope)}
        actions={
          <Select
            value={datePreset}
            onValueChange={(value) => setDatePreset(value as AnalyticsDatePreset)}
          >
            <SelectTrigger className="w-44" aria-label="Analytics date range">
              <CalendarDays className="mr-2 h-4 w-4" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {presetOptions.map((preset) => (
                <SelectItem key={preset} value={preset}>
                  {label(preset)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      {!scopeId ? (
        <EmptyState title="No Scope" description="Select an authorized scope to view Analytics." />
      ) : query.isLoading ? (
        <AnalyticsSkeleton />
      ) : query.data ? (
        <AnalyticsContent summary={query.data} />
      ) : (
        <EmptyState title="Analytics Unavailable" description={errorMessage(query.error)} />
      )}
    </PageContainer>
  );
}

function AnalyticsContent({ summary }: { summary: AnalyticsSummary }) {
  const maxPoint = Math.max(
    ...summary.timeSeries.points.map((point) => Number(point.value ?? 0)),
    1,
  );
  return (
    <div className="grid gap-4">
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summary.metrics.slice(0, 12).map((metric) => (
          <article key={metric.key} className="rounded-md border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium text-muted-foreground">{metric.displayName}</div>
              {metric.financialSensitivity ? (
                <ShieldCheck className="h-4 w-4 text-amber-600" />
              ) : (
                <Gauge className="h-4 w-4 text-primary" />
              )}
            </div>
            <div className="mt-3 text-2xl font-semibold tracking-normal">
              {formatMetric(metric.value, metric.unit)}
            </div>
            {metric.comparison ? (
              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <TrendingUp className="h-3.5 w-3.5" />
                <span>{formatPercent(metric.comparison.percentChange)}</span>
              </div>
            ) : null}
          </article>
        ))}
      </section>
      <section className="rounded-md border border-border bg-card p-4">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <BarChart3 className="h-4 w-4" />
            {summary.timeSeries.metricKey ?? 'timeseries'}
          </div>
          <Badge variant="neutral">{summary.timeSeries.bucket}</Badge>
        </div>
        <div className="flex h-56 items-end gap-1 overflow-hidden">
          {summary.timeSeries.points.map((point) => {
            const value = Number(point.value ?? 0);
            const height = Math.max(4, Math.round((value / maxPoint) * 100));
            return (
              <div key={point.start} className="flex min-w-2 flex-1 flex-col justify-end">
                <div
                  className="rounded-t-sm bg-primary/80"
                  style={{ height: `${height}%` }}
                  title={`${new Date(point.start).toLocaleDateString()}: ${value}`}
                />
              </div>
            );
          })}
        </div>
      </section>
      <section className="grid gap-3 md:grid-cols-3">
        <InfoPill
          icon={<Activity className="h-4 w-4" />}
          label="Workspaces"
          value={summary.scope.workspaceCount}
        />
        <InfoPill
          icon={<ShieldCheck className="h-4 w-4" />}
          label="Financial"
          value={summary.privacy.financialAllowed ? 'Allowed' : 'Hidden'}
        />
        <InfoPill
          icon={<CalendarDays className="h-4 w-4" />}
          label="Timezone"
          value={summary.range.timezone}
        />
      </section>
    </div>
  );
}

function InfoPill({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border bg-card p-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function AnalyticsSkeleton() {
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton key={index} className="h-28 rounded-md" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-md" />
    </div>
  );
}

async function fetchSummary(
  scope: AnalyticsScopeType,
  scopeId: string,
  params: { datePreset: AnalyticsDatePreset; bucket: 'DAY'; metrics: string[] },
) {
  if (scope === 'WORKSPACE') return getWorkspaceAnalytics(scopeId, params);
  if (scope === 'AGENCY') return getAgencyAnalytics(scopeId, params);
  if (scope === 'SUPER_AGENCY') return getSuperAgencyAnalytics(scopeId, params);
  return getPlatformAnalytics(params);
}

function formatMetric(value: number | string | null, unit: string) {
  if (value === null) return 'N/A';
  const number = Number(value);
  if (unit === 'bytes') return formatBytes(number);
  if (unit === 'percentage') return `${number}%`;
  return new Intl.NumberFormat().format(number);
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let amount = value / 1024;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount.toFixed(amount >= 10 ? 0 : 1)} ${units[index]}`;
}

function formatPercent(value: number | null) {
  if (value === null) return 'No previous baseline';
  if (value === 0) return 'No change';
  return `${value > 0 ? '+' : ''}${value}%`;
}

function label(value: string) {
  return value
    .split('_')
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(' ');
}

function scopeLabel(scope: AnalyticsScopeType) {
  if (scope === 'WORKSPACE') return 'Workspace operational metrics';
  if (scope === 'AGENCY') return 'Agency descendant Workspace aggregates';
  if (scope === 'SUPER_AGENCY') return 'Super Agency safe aggregate and commercial metrics';
  return 'Platform aggregate analytics';
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Analytics could not be loaded.';
}
