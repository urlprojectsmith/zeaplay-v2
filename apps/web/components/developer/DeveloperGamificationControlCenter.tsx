'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  EmptyState,
  Input,
  Skeleton,
} from '@zea-play/ui';
import { useLanguage } from '../../contexts/language-provider';
import {
  developerGamificationKeys,
  getDeveloperAchievementsStreaksHealth,
  getDeveloperAudit,
  getDeveloperBaselines,
  getDeveloperGamificationHealth,
  getDeveloperLeaderboardDiagnostics,
  getDeveloperLedgerHealth,
  getDeveloperNormalizationEvents,
  getDeveloperPointRules,
  getDeveloperReconciliation,
  getDeveloperSecurityHealth,
  getDeveloperXpEvents,
  type DeveloperHealthCard,
  type DeveloperQueryParams,
} from '../../services/developer-gamification';
import { PageContainer } from '../layout/PageContainer';
import { PageHeader } from '../layout/PageHeader';
import { readGlobalTab, writeGlobalTab } from '../gamification/AgencyGlobalLeaderboardPage';

type DeveloperGamificationTab =
  | 'overview'
  | 'pointRules'
  | 'xpEvents'
  | 'normalization'
  | 'leaderboards'
  | 'reconciliation'
  | 'ledgers'
  | 'achievements'
  | 'security'
  | 'audit';

const tabs: DeveloperGamificationTab[] = [
  'overview',
  'pointRules',
  'xpEvents',
  'normalization',
  'leaderboards',
  'reconciliation',
  'ledgers',
  'achievements',
  'security',
  'audit',
];

export function DeveloperGamificationControlCenter() {
  const { locale, t } = useLanguage();
  const [activeTab, setActiveTab] = useState<DeveloperGamificationTab>(() =>
    readGlobalTab('overview', tabs),
  );
  const [page, setPage] = useState(1);
  const [workspaceId, setWorkspaceId] = useState('');
  const [search, setSearch] = useState('');
  const params = useMemo<DeveloperQueryParams>(
    () => ({
      page,
      pageSize: 20,
      workspaceId: workspaceId || undefined,
      search: search || undefined,
    }),
    [page, search, workspaceId],
  );

  return (
    <PageContainer>
      <PageHeader
        title={t(locale, 'developerGamification.title')}
        description={t(locale, 'developerGamification.description')}
      />
      <p className="rounded-md border bg-[hsl(var(--muted))] p-3 text-sm text-[hsl(var(--muted-foreground))]">
        {t(locale, 'developerGamification.readOnlyNotice')}
      </p>
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3">
            <div
              role="tablist"
              aria-label={t(locale, 'developerGamification.title')}
              className="flex flex-wrap gap-2"
            >
              {tabs.map((tab) => (
                <Button
                  key={tab}
                  role="tab"
                  aria-selected={activeTab === tab}
                  variant={activeTab === tab ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => {
                    setActiveTab(tab);
                    writeGlobalTab(tab);
                    setPage(1);
                  }}
                >
                  {developerTabLabel(locale, t, tab)}
                </Button>
              ))}
            </div>
            {activeTab !== 'overview' &&
            activeTab !== 'ledgers' &&
            activeTab !== 'achievements' &&
            activeTab !== 'security' ? (
              <div className="grid gap-2 md:grid-cols-2">
                <Input
                  value={workspaceId}
                  onChange={(event) => {
                    setWorkspaceId(event.target.value);
                    setPage(1);
                  }}
                  placeholder={t(locale, 'developerGamification.workspaceId')}
                  aria-label={t(locale, 'developerGamification.workspaceId')}
                />
                <Input
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                  placeholder={t(locale, 'common.search')}
                  aria-label={t(locale, 'common.search')}
                />
              </div>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          {activeTab === 'overview' ? <Overview /> : null}
          {activeTab === 'pointRules' ? <PointRules params={params} /> : null}
          {activeTab === 'xpEvents' ? <PagedMonitor tab="xpEvents" params={params} /> : null}
          {activeTab === 'normalization' ? <Normalization params={params} /> : null}
          {activeTab === 'leaderboards' ? (
            <KeyValuePanel tab="leaderboards" params={params} />
          ) : null}
          {activeTab === 'reconciliation' ? (
            <PagedMonitor tab="reconciliation" params={params} />
          ) : null}
          {activeTab === 'ledgers' ? <KeyValuePanel tab="ledgers" params={{}} /> : null}
          {activeTab === 'achievements' ? <KeyValuePanel tab="achievements" params={{}} /> : null}
          {activeTab === 'security' ? <KeyValuePanel tab="security" params={{}} /> : null}
          {activeTab === 'audit' ? <PagedMonitor tab="audit" params={params} /> : null}
        </CardContent>
      </Card>
      {['xpEvents', 'normalization', 'reconciliation', 'audit'].includes(activeTab) ? (
        <Pagination page={page} onPageChange={setPage} />
      ) : null}
    </PageContainer>
  );
}

function Overview() {
  const { locale, t } = useLanguage();
  const query = useQuery({
    queryKey: developerGamificationKeys.health(),
    queryFn: getDeveloperGamificationHealth,
  });
  if (query.isLoading) return <SkeletonGrid />;
  if (query.isError) return <EmptyState title={t(locale, 'developerGamification.unableToLoad')} />;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {query.data?.cards.map((card) => (
        <HealthCard key={card.title} card={card} />
      ))}
    </div>
  );
}

function HealthCard({ card }: { card: DeveloperHealthCard }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{card.title}</h2>
          <Badge
            variant={
              card.status === 'ERROR' ? 'danger' : card.status === 'WARNING' ? 'warning' : 'success'
            }
          >
            {card.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold">{card.value}</p>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">{card.summary}</p>
      </CardContent>
    </Card>
  );
}

function PointRules({ params }: { params: DeveloperQueryParams }) {
  const query = useQuery({
    queryKey: developerGamificationKeys.tab('pointRules', params),
    queryFn: () => getDeveloperPointRules(params),
  });
  if (query.isLoading) return <SkeletonGrid />;
  if (query.isError) return <ErrorState />;
  return (
    <div className="grid gap-4">
      <DataTable title="Completion" rows={query.data?.completionRules ?? []} />
      <DataTable title="Creation" rows={query.data?.creationRules ?? []} />
    </div>
  );
}

function Normalization({ params }: { params: DeveloperQueryParams }) {
  const baselineQuery = useQuery({
    queryKey: developerGamificationKeys.tab('baselines', params),
    queryFn: () => getDeveloperBaselines(params),
  });
  const eventQuery = useQuery({
    queryKey: developerGamificationKeys.tab('normalizationEvents', params),
    queryFn: () => getDeveloperNormalizationEvents(params),
  });
  if (baselineQuery.isLoading || eventQuery.isLoading) return <SkeletonGrid />;
  if (baselineQuery.isError || eventQuery.isError) return <ErrorState />;
  return (
    <div className="grid gap-4">
      <DataTable title="Baselines" rows={baselineQuery.data?.items ?? []} />
      <DataTable title="Global Score Events" rows={eventQuery.data?.items ?? []} />
    </div>
  );
}

function PagedMonitor({
  tab,
  params,
}: {
  tab: 'xpEvents' | 'reconciliation' | 'audit';
  params: DeveloperQueryParams;
}) {
  const query = useQuery({
    queryKey: developerGamificationKeys.tab(tab, params),
    queryFn: () =>
      tab === 'xpEvents'
        ? getDeveloperXpEvents(params)
        : tab === 'reconciliation'
          ? getDeveloperReconciliation(params)
          : getDeveloperAudit(params),
  });
  if (query.isLoading) return <SkeletonGrid />;
  if (query.isError) return <ErrorState />;
  return <DataTable title={tab} rows={query.data?.items ?? []} />;
}

function KeyValuePanel({
  tab,
  params,
}: {
  tab: 'leaderboards' | 'ledgers' | 'achievements' | 'security';
  params: DeveloperQueryParams;
}) {
  const query = useQuery({
    queryKey: developerGamificationKeys.tab(tab, params),
    queryFn: () =>
      tab === 'leaderboards'
        ? getDeveloperLeaderboardDiagnostics(params)
        : tab === 'ledgers'
          ? getDeveloperLedgerHealth()
          : tab === 'achievements'
            ? getDeveloperAchievementsStreaksHealth()
            : getDeveloperSecurityHealth(),
  });
  if (query.isLoading) return <SkeletonGrid />;
  if (query.isError) return <ErrorState />;
  return (
    <pre className="overflow-x-auto rounded-md bg-[hsl(var(--muted))] p-3 text-xs">
      {JSON.stringify(query.data, null, 2)}
    </pre>
  );
}

function DataTable({ title, rows }: { title: string; rows: unknown[] }) {
  const { locale, t } = useLanguage();
  if (rows.length === 0) return <EmptyState title={t(locale, 'developerGamification.noData')} />;
  const keys = Object.keys((rows[0] ?? {}) as Record<string, unknown>).slice(0, 8);
  return (
    <div className="overflow-x-auto">
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead>
          <tr className="border-b border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]">
            {keys.map((key) => (
              <th key={key} className="py-2 pr-3">
                {key}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const record = row as Record<string, unknown>;
            return (
              <tr key={rowKey(record.id, index)} className="border-b border-[hsl(var(--border))]">
                {keys.map((key) => (
                  <td key={key} className="max-w-[240px] truncate py-3 pr-3">
                    {formatCell(record[key])}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Pagination({
  page,
  onPageChange,
}: {
  page: number;
  onPageChange: (page: number) => void;
}) {
  const { locale, t } = useLanguage();
  return (
    <div className="flex justify-end gap-2">
      <Button
        size="sm"
        variant="secondary"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        {t(locale, 'gamification.previous')}
      </Button>
      <Button size="sm" variant="secondary" onClick={() => onPageChange(page + 1)}>
        {t(locale, 'gamification.next')}
      </Button>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid gap-3">
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  );
}

function ErrorState() {
  const { locale, t } = useLanguage();
  return <EmptyState title={t(locale, 'developerGamification.unableToLoad')} />;
}

function developerTabLabel(
  locale: 'en' | 'ta',
  translateLabel: ReturnType<typeof useLanguage>['t'],
  tab: DeveloperGamificationTab,
) {
  const labels: Record<DeveloperGamificationTab, string> = {
    overview: translateLabel(locale, 'developerGamification.overviewTab'),
    pointRules: translateLabel(locale, 'developerGamification.pointRulesTab'),
    xpEvents: translateLabel(locale, 'developerGamification.xpEventsTab'),
    normalization: translateLabel(locale, 'developerGamification.normalizationTab'),
    leaderboards: translateLabel(locale, 'developerGamification.leaderboardsTab'),
    reconciliation: translateLabel(locale, 'developerGamification.reconciliationTab'),
    ledgers: translateLabel(locale, 'developerGamification.ledgersTab'),
    achievements: translateLabel(locale, 'developerGamification.achievementsTab'),
    security: translateLabel(locale, 'developerGamification.securityTab'),
    audit: translateLabel(locale, 'developerGamification.auditTab'),
  };
  return labels[tab];
}

function formatCell(value: unknown) {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value.toString();
  }
  return JSON.stringify(value);
}

function rowKey(value: unknown, index: number) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return value.toString();
  return `row-${index}`;
}
