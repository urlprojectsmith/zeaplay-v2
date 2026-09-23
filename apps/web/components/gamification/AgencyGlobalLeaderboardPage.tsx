'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Skeleton,
} from '@zea-play/ui';
import { useLanguage } from '../../contexts/language-provider';
import { useSessionStore } from '../../stores/session';
import { PageContainer } from '../layout/PageContainer';
import { PageHeader } from '../layout/PageHeader';
import {
  getAgencyGlobalSubaccounts,
  getAgencyGlobalUsers,
  globalGamificationKeys,
  type GlobalSubaccountLeaderboardItem,
  type GlobalUserLeaderboardItem,
} from '../../services/global-gamification';

const pageSize = 20;
type AgencyGamificationTab = 'overview' | 'leaderboard';

export function AgencyGlobalLeaderboardPage() {
  const { locale, t } = useLanguage();
  const { accessToken, selectedAgencyId, agencies } = useSessionStore();
  const [activeTab, setActiveTab] = useState<AgencyGamificationTab>(() =>
    readGlobalTab('overview', ['overview', 'leaderboard']),
  );
  const [search, setSearch] = useState('');
  const [selectedWorkspace, setSelectedWorkspace] =
    useState<GlobalSubaccountLeaderboardItem | null>(null);
  const [page, setPage] = useState(1);
  const selectedAgency = agencies.find((agency) => agency.id === selectedAgencyId);

  useEffect(() => {
    setSearch('');
    setSelectedWorkspace(null);
    setPage(1);
  }, [selectedAgencyId]);

  const subaccountsQuery = useQuery({
    queryKey: globalGamificationKeys.agencySubaccounts(selectedAgencyId, search),
    queryFn: () => getAgencyGlobalSubaccounts(selectedAgencyId as string, search),
    enabled: Boolean(accessToken && selectedAgencyId),
  });

  const usersParams = useMemo(() => ({ page, pageSize }), [page]);
  const usersQuery = useQuery({
    queryKey: globalGamificationKeys.agencyUsers(
      selectedAgencyId,
      selectedWorkspace?.workspaceId ?? null,
      usersParams,
    ),
    queryFn: () =>
      getAgencyGlobalUsers(
        selectedAgencyId as string,
        selectedWorkspace?.workspaceId as string,
        usersParams,
      ),
    enabled: Boolean(accessToken && selectedAgencyId && selectedWorkspace),
  });

  return (
    <PageContainer>
      <PageHeader
        title={t(locale, 'globalLeaderboard.title')}
        description={
          selectedAgency
            ? `${selectedAgency.name} - ${t(locale, 'globalLeaderboard.normalizedScoreNote')}`
            : t(locale, 'dashboard.noAgencySelected')
        }
      />
      <GlobalTabList
        activeTab={activeTab}
        tabs={['overview', 'leaderboard']}
        onChange={(tab) => {
          setActiveTab(tab as AgencyGamificationTab);
          writeGlobalTab(tab);
          setSelectedWorkspace(null);
          setPage(1);
        }}
      />
      <Card>
        <CardHeader>
          <CardTitle>{t(locale, 'globalLeaderboard.agencyGlobalScore')}</CardTitle>
        </CardHeader>
        <CardContent>
          {subaccountsQuery.isLoading ? (
            <Skeleton className="h-9 w-36" />
          ) : (
            <p className="text-3xl font-semibold">
              {formatScore(subaccountsQuery.data?.globalScore ?? 0)}
            </p>
          )}
        </CardContent>
      </Card>
      {activeTab === 'overview' ? (
        <div className="grid gap-4 md:grid-cols-3">
          <MetricCard
            label={t(locale, 'globalLeaderboard.normalizedScore')}
            value={t(locale, 'globalLeaderboard.normalizedScoreNote')}
          />
          <MetricCard
            label={t(locale, 'globalLeaderboard.subaccounts')}
            value={formatScore(subaccountsQuery.data?.items.length ?? 0)}
          />
          <MetricCard
            label={t(locale, 'globalLeaderboard.topSubaccounts')}
            value={subaccountsQuery.data?.items[0]?.workspaceName ?? '-'}
          />
        </div>
      ) : null}
      {activeTab === 'leaderboard' ? (
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle>{t(locale, 'globalLeaderboard.topSubaccounts')}</CardTitle>
              <Input
                className="sm:max-w-xs"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t(locale, 'common.search')}
                aria-label={t(locale, 'common.search')}
              />
            </div>
          </CardHeader>
          <CardContent>
            {subaccountsQuery.isLoading ? (
              <TableSkeleton />
            ) : subaccountsQuery.isError ? (
              <EmptyState title={t(locale, 'globalLeaderboard.unableToLoadLeaderboard')} />
            ) : (subaccountsQuery.data?.items.length ?? 0) === 0 ? (
              <EmptyState title={t(locale, 'globalLeaderboard.noLeaderboardData')} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]">
                      <th className="py-2 pr-3">{t(locale, 'globalLeaderboard.rank')}</th>
                      <th className="py-2 pr-3">{t(locale, 'globalLeaderboard.subaccount')}</th>
                      <th className="py-2 pr-3">{t(locale, 'globalLeaderboard.globalScore')}</th>
                      <th className="py-2 pr-3">{t(locale, 'globalLeaderboard.scoredUsers')}</th>
                      <th className="py-2 pr-3">{t(locale, 'globalLeaderboard.action')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subaccountsQuery.data?.items.map((item) => (
                      <tr key={item.workspaceId} className="border-b border-[hsl(var(--border))]">
                        <td className="py-3 pr-3 font-medium">#{item.rank}</td>
                        <td className="py-3 pr-3">{item.workspaceName}</td>
                        <td className="py-3 pr-3">{formatScore(item.globalScore)}</td>
                        <td className="py-3 pr-3">{item.scoredUsers}</td>
                        <td className="py-3 pr-3">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setSelectedWorkspace(item);
                              setPage(1);
                            }}
                          >
                            {t(locale, 'globalLeaderboard.viewUsers')}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
      {selectedWorkspace ? (
        <UserDrilldown
          title={selectedWorkspace.workspaceName}
          users={usersQuery.data?.items ?? []}
          isLoading={usersQuery.isLoading}
          isError={usersQuery.isError}
          page={page}
          totalPages={usersQuery.data?.totalPages ?? 1}
          onPageChange={setPage}
        />
      ) : null}
    </PageContainer>
  );
}

export function GlobalTabList({
  activeTab,
  tabs,
  onChange,
}: {
  activeTab: string;
  tabs: string[];
  onChange: (tab: string) => void;
}) {
  const { locale, t } = useLanguage();
  return (
    <div role="tablist" aria-label={t(locale, 'globalLeaderboard.title')} className="flex gap-2">
      {tabs.map((tab) => (
        <Button
          key={tab}
          role="tab"
          aria-selected={activeTab === tab}
          variant={activeTab === tab ? 'primary' : 'secondary'}
          onClick={() => onChange(tab)}
        >
          {tab === 'leaderboard'
            ? t(locale, 'globalLeaderboard.title')
            : t(locale, `globalLeaderboard.${tab}`)}
        </Button>
      ))}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}

function UserDrilldown({
  title,
  users,
  isLoading,
  isError,
  page,
  totalPages,
  onPageChange,
}: {
  title: string;
  users: GlobalUserLeaderboardItem[];
  isLoading: boolean;
  isError: boolean;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  const { locale, t } = useLanguage();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <TableSkeleton />
        ) : isError ? (
          <EmptyState title={t(locale, 'globalLeaderboard.unableToLoadLeaderboard')} />
        ) : users.length === 0 ? (
          <EmptyState title={t(locale, 'globalLeaderboard.noLeaderboardData')} />
        ) : (
          <GlobalUsersTable users={users} showAgency={false} showSubaccount={false} />
        )}
        <Pagination page={page} totalPages={totalPages} onPageChange={onPageChange} />
      </CardContent>
    </Card>
  );
}

export function GlobalUsersTable({
  users,
  showAgency,
  showSubaccount,
}: {
  users: GlobalUserLeaderboardItem[];
  showAgency: boolean;
  showSubaccount: boolean;
}) {
  const { locale, t } = useLanguage();
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] text-left text-sm">
        <thead>
          <tr className="border-b border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]">
            <th className="py-2 pr-3">{t(locale, 'globalLeaderboard.rank')}</th>
            <th className="py-2 pr-3">{t(locale, 'globalLeaderboard.user')}</th>
            {showSubaccount ? (
              <th className="py-2 pr-3">{t(locale, 'globalLeaderboard.subaccount')}</th>
            ) : null}
            {showAgency ? (
              <th className="py-2 pr-3">{t(locale, 'globalLeaderboard.agency')}</th>
            ) : null}
            <th className="py-2 pr-3">{t(locale, 'globalLeaderboard.globalScore')}</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr
              key={`${user.workspaceId}-${user.membershipId ?? user.rank}-${user.displayName}`}
              className="border-b border-[hsl(var(--border))]"
            >
              <td className="py-3 pr-3 font-medium">#{user.rank}</td>
              <td className="py-3 pr-3">{user.displayName}</td>
              {showSubaccount ? <td className="py-3 pr-3">{user.workspaceName}</td> : null}
              {showAgency ? <td className="py-3 pr-3">{user.agencyName}</td> : null}
              <td className="py-3 pr-3">{formatScore(user.globalScore)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  const { locale, t } = useLanguage();
  return (
    <div className="mt-4 flex items-center justify-end gap-2">
      <Button
        variant="secondary"
        size="sm"
        disabled={page <= 1}
        onClick={() => onPageChange(Math.max(1, page - 1))}
      >
        {t(locale, 'gamification.previous')}
      </Button>
      <span className="text-sm text-[hsl(var(--muted-foreground))]">
        {page} / {totalPages}
      </span>
      <Button
        variant="secondary"
        size="sm"
        disabled={page >= totalPages}
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
      >
        {t(locale, 'gamification.next')}
      </Button>
    </div>
  );
}

export function TableSkeleton() {
  return (
    <div className="grid gap-2">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

export function formatScore(value: number) {
  return new Intl.NumberFormat().format(value);
}

export function readGlobalTab<T extends string>(fallback: T, validTabs: readonly T[]): T {
  if (typeof window === 'undefined') return fallback;
  const tab = new URLSearchParams(window.location.search).get('tab') as T | null;
  return tab && validTabs.includes(tab) ? tab : fallback;
}

export function writeGlobalTab(tab: string) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (tab === 'overview') {
    url.searchParams.delete('tab');
  } else {
    url.searchParams.set('tab', tab);
  }
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}
