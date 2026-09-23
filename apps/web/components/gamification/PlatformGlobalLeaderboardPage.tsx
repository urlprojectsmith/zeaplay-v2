'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, CardContent, CardHeader, EmptyState, Input } from '@zea-play/ui';
import { useLanguage } from '../../contexts/language-provider';
import { useSessionStore } from '../../stores/session';
import {
  getPlatformGlobalAgencies,
  getPlatformGlobalSubaccounts,
  getPlatformGlobalUsers,
  globalGamificationKeys,
  type GlobalAgencyLeaderboardItem,
  type GlobalSubaccountLeaderboardItem,
} from '../../services/global-gamification';
import { PageContainer } from '../layout/PageContainer';
import { PageHeader } from '../layout/PageHeader';
import {
  formatScore,
  GlobalTabList,
  GlobalUsersTable,
  Pagination,
  readGlobalTab,
  TableSkeleton,
  writeGlobalTab,
} from './AgencyGlobalLeaderboardPage';

type PlatformTab = 'agencies' | 'subaccounts' | 'users';
type PlatformSection = 'overview' | 'leaderboard' | 'governance';

const tabs: PlatformTab[] = ['agencies', 'subaccounts', 'users'];
const pageSize = 20;

export function PlatformGlobalLeaderboardPage() {
  const { locale, t } = useLanguage();
  const { accessToken, selectedAgencyId } = useSessionStore();
  const [section, setSection] = useState<PlatformSection>(() =>
    readGlobalTab('overview', ['overview', 'leaderboard', 'governance']),
  );
  const [activeTab, setActiveTab] = useState<PlatformTab>('agencies');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedAgency, setSelectedAgency] = useState<GlobalAgencyLeaderboardItem | null>(null);
  const [selectedSubaccount, setSelectedSubaccount] =
    useState<GlobalSubaccountLeaderboardItem | null>(null);
  const [drilldownPage, setDrilldownPage] = useState(1);
  const params = useMemo(() => ({ page, pageSize, search }), [page, search]);
  const agencySubaccountParams = useMemo(
    () => ({ page: drilldownPage, pageSize, agencyId: selectedAgency?.agencyId }),
    [drilldownPage, selectedAgency?.agencyId],
  );
  const subaccountUsersParams = useMemo(
    () => ({
      page: drilldownPage,
      pageSize,
      agencyId: selectedSubaccount?.agencyId ?? undefined,
      workspaceId: selectedSubaccount?.workspaceId,
    }),
    [drilldownPage, selectedSubaccount?.agencyId, selectedSubaccount?.workspaceId],
  );

  useEffect(() => {
    setSearch('');
    setPage(1);
    setSelectedAgency(null);
    setSelectedSubaccount(null);
    setDrilldownPage(1);
  }, [selectedAgencyId]);

  const agenciesQuery = useQuery({
    queryKey: globalGamificationKeys.platform(selectedAgencyId, 'agencies', params),
    queryFn: () => getPlatformGlobalAgencies(params),
    enabled: Boolean(
      accessToken &&
      selectedAgencyId &&
      (section === 'overview' || (section === 'leaderboard' && activeTab === 'agencies')),
    ),
  });
  const subaccountsQuery = useQuery({
    queryKey: globalGamificationKeys.platform(selectedAgencyId, 'subaccounts', params),
    queryFn: () => getPlatformGlobalSubaccounts(params),
    enabled: Boolean(
      accessToken && selectedAgencyId && section === 'leaderboard' && activeTab === 'subaccounts',
    ),
  });
  const usersQuery = useQuery({
    queryKey: globalGamificationKeys.platform(selectedAgencyId, 'users', params),
    queryFn: () => getPlatformGlobalUsers(params),
    enabled: Boolean(
      accessToken && selectedAgencyId && section === 'leaderboard' && activeTab === 'users',
    ),
  });
  const agencySubaccountsQuery = useQuery({
    queryKey: globalGamificationKeys.platform(
      selectedAgencyId,
      'agency-subaccounts',
      agencySubaccountParams,
    ),
    queryFn: () => getPlatformGlobalSubaccounts(agencySubaccountParams),
    enabled: Boolean(accessToken && selectedAgencyId && selectedAgency),
  });
  const subaccountUsersQuery = useQuery({
    queryKey: globalGamificationKeys.platform(
      selectedAgencyId,
      'subaccount-users',
      subaccountUsersParams,
    ),
    queryFn: () => getPlatformGlobalUsers(subaccountUsersParams),
    enabled: Boolean(accessToken && selectedAgencyId && selectedSubaccount),
  });

  const totalPages =
    activeTab === 'agencies'
      ? agenciesQuery.data?.totalPages
      : activeTab === 'subaccounts'
        ? subaccountsQuery.data?.totalPages
        : usersQuery.data?.totalPages;

  return (
    <PageContainer>
      <PageHeader
        title={t(locale, 'globalLeaderboard.title')}
        description={t(locale, 'globalLeaderboard.platformDescription')}
      />
      <GlobalTabList
        activeTab={section}
        tabs={['overview', 'leaderboard', 'governance']}
        onChange={(tab) => {
          setSection(tab as PlatformSection);
          writeGlobalTab(tab);
          setSelectedAgency(null);
          setSelectedSubaccount(null);
          setPage(1);
          setDrilldownPage(1);
        }}
      />
      {section === 'overview' ? (
        <div className="grid gap-4 md:grid-cols-3">
          <MetricCard
            label={t(locale, 'globalLeaderboard.agencies')}
            value={formatScore(agenciesQuery.data?.total ?? 0)}
          />
          <MetricCard
            label={t(locale, 'globalLeaderboard.normalizedScore')}
            value={t(locale, 'globalLeaderboard.normalizedScoreNote')}
          />
          <MetricCard
            label={t(locale, 'globalLeaderboard.agency')}
            value={agenciesQuery.data?.items[0]?.agencyName ?? '-'}
          />
        </div>
      ) : null}
      {section === 'governance' ? (
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold">
              {t(locale, 'globalLeaderboard.governanceStatus')}
            </h2>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              {t(locale, 'globalLeaderboard.governancePending')}
            </p>
          </CardContent>
        </Card>
      ) : null}
      {section === 'leaderboard' ? (
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div
                role="tablist"
                aria-label={t(locale, 'globalLeaderboard.title')}
                className="flex flex-wrap gap-2"
              >
                {tabs.map((tab) => (
                  <Button
                    key={tab}
                    role="tab"
                    aria-selected={activeTab === tab}
                    variant={activeTab === tab ? 'primary' : 'secondary'}
                    onClick={() => {
                      setActiveTab(tab);
                      setPage(1);
                      setSelectedAgency(null);
                      setSelectedSubaccount(null);
                      setDrilldownPage(1);
                    }}
                  >
                    {t(locale, `globalLeaderboard.${tab}`)}
                  </Button>
                ))}
              </div>
              <Input
                className="lg:max-w-xs"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder={t(locale, 'common.search')}
                aria-label={t(locale, 'common.search')}
              />
            </div>
          </CardHeader>
          <CardContent>
            {activeTab === 'agencies' ? (
              <AgenciesTable
                isLoading={agenciesQuery.isLoading}
                isError={agenciesQuery.isError}
                items={agenciesQuery.data?.items ?? []}
                onViewSubaccounts={(item) => {
                  setSelectedAgency(item);
                  setSelectedSubaccount(null);
                  setDrilldownPage(1);
                }}
              />
            ) : activeTab === 'subaccounts' ? (
              <SubaccountsTable
                isLoading={subaccountsQuery.isLoading}
                isError={subaccountsQuery.isError}
                items={subaccountsQuery.data?.items ?? []}
                onViewUsers={(item) => {
                  setSelectedSubaccount(item);
                  setSelectedAgency(null);
                  setDrilldownPage(1);
                }}
              />
            ) : usersQuery.isLoading ? (
              <TableSkeleton />
            ) : usersQuery.isError ? (
              <EmptyState title={t(locale, 'globalLeaderboard.unableToLoadLeaderboard')} />
            ) : (usersQuery.data?.items.length ?? 0) === 0 ? (
              <EmptyState title={t(locale, 'globalLeaderboard.noLeaderboardData')} />
            ) : (
              <GlobalUsersTable users={usersQuery.data?.items ?? []} showAgency showSubaccount />
            )}
            <Pagination page={page} totalPages={totalPages ?? 1} onPageChange={setPage} />
          </CardContent>
        </Card>
      ) : null}
      {selectedAgency ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">{selectedAgency.agencyName}</h2>
              <Button variant="ghost" size="sm" onClick={() => setSelectedAgency(null)}>
                {t(locale, 'common.close')}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <SubaccountsTable
              isLoading={agencySubaccountsQuery.isLoading}
              isError={agencySubaccountsQuery.isError}
              items={agencySubaccountsQuery.data?.items ?? []}
              onViewUsers={(item) => {
                setSelectedSubaccount(item);
                setSelectedAgency(null);
                setDrilldownPage(1);
              }}
            />
            <Pagination
              page={drilldownPage}
              totalPages={agencySubaccountsQuery.data?.totalPages ?? 1}
              onPageChange={setDrilldownPage}
            />
          </CardContent>
        </Card>
      ) : null}
      {selectedSubaccount ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">{selectedSubaccount.workspaceName}</h2>
              <Button variant="ghost" size="sm" onClick={() => setSelectedSubaccount(null)}>
                {t(locale, 'common.close')}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {subaccountUsersQuery.isLoading ? (
              <TableSkeleton />
            ) : subaccountUsersQuery.isError ? (
              <EmptyState title={t(locale, 'globalLeaderboard.unableToLoadLeaderboard')} />
            ) : (subaccountUsersQuery.data?.items.length ?? 0) === 0 ? (
              <EmptyState title={t(locale, 'globalLeaderboard.noLeaderboardData')} />
            ) : (
              <GlobalUsersTable
                users={subaccountUsersQuery.data?.items ?? []}
                showAgency
                showSubaccount={false}
              />
            )}
            <Pagination
              page={drilldownPage}
              totalPages={subaccountUsersQuery.data?.totalPages ?? 1}
              onPageChange={setDrilldownPage}
            />
          </CardContent>
        </Card>
      ) : null}
    </PageContainer>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold">{label}</h2>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}

function AgenciesTable({
  isLoading,
  isError,
  items,
  onViewSubaccounts,
}: {
  isLoading: boolean;
  isError: boolean;
  items: GlobalAgencyLeaderboardItem[];
  onViewSubaccounts: (item: GlobalAgencyLeaderboardItem) => void;
}) {
  const { locale, t } = useLanguage();
  if (isLoading) return <TableSkeleton />;
  if (isError) return <EmptyState title={t(locale, 'globalLeaderboard.unableToLoadLeaderboard')} />;
  if (items.length === 0)
    return <EmptyState title={t(locale, 'globalLeaderboard.noLeaderboardData')} />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead>
          <tr className="border-b border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]">
            <th className="py-2 pr-3">{t(locale, 'globalLeaderboard.rank')}</th>
            <th className="py-2 pr-3">{t(locale, 'globalLeaderboard.agency')}</th>
            <th className="py-2 pr-3">{t(locale, 'globalLeaderboard.globalScore')}</th>
            <th className="py-2 pr-3">{t(locale, 'globalLeaderboard.subaccounts')}</th>
            <th className="py-2 pr-3">{t(locale, 'globalLeaderboard.scoredUsers')}</th>
            <th className="py-2 pr-3">{t(locale, 'globalLeaderboard.action')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.agencyId} className="border-b border-[hsl(var(--border))]">
              <td className="py-3 pr-3 font-medium">#{item.rank}</td>
              <td className="py-3 pr-3">{item.agencyName}</td>
              <td className="py-3 pr-3">{formatScore(item.globalScore)}</td>
              <td className="py-3 pr-3">{item.subaccounts}</td>
              <td className="py-3 pr-3">{item.scoredUsers}</td>
              <td className="py-3 pr-3">
                <Button size="sm" variant="secondary" onClick={() => onViewSubaccounts(item)}>
                  {t(locale, 'globalLeaderboard.subaccounts')}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SubaccountsTable({
  isLoading,
  isError,
  items,
  onViewUsers,
}: {
  isLoading: boolean;
  isError: boolean;
  items: GlobalSubaccountLeaderboardItem[];
  onViewUsers: (item: GlobalSubaccountLeaderboardItem) => void;
}) {
  const { locale, t } = useLanguage();
  if (isLoading) return <TableSkeleton />;
  if (isError) return <EmptyState title={t(locale, 'globalLeaderboard.unableToLoadLeaderboard')} />;
  if (items.length === 0)
    return <EmptyState title={t(locale, 'globalLeaderboard.noLeaderboardData')} />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead>
          <tr className="border-b border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]">
            <th className="py-2 pr-3">{t(locale, 'globalLeaderboard.rank')}</th>
            <th className="py-2 pr-3">{t(locale, 'globalLeaderboard.subaccount')}</th>
            <th className="py-2 pr-3">{t(locale, 'globalLeaderboard.agency')}</th>
            <th className="py-2 pr-3">{t(locale, 'globalLeaderboard.globalScore')}</th>
            <th className="py-2 pr-3">{t(locale, 'globalLeaderboard.scoredUsers')}</th>
            <th className="py-2 pr-3">{t(locale, 'globalLeaderboard.action')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.workspaceId} className="border-b border-[hsl(var(--border))]">
              <td className="py-3 pr-3 font-medium">#{item.rank}</td>
              <td className="py-3 pr-3">{item.workspaceName}</td>
              <td className="py-3 pr-3">{item.agencyName}</td>
              <td className="py-3 pr-3">{formatScore(item.globalScore)}</td>
              <td className="py-3 pr-3">{item.scoredUsers}</td>
              <td className="py-3 pr-3">
                <Button size="sm" variant="secondary" onClick={() => onViewUsers(item)}>
                  {t(locale, 'globalLeaderboard.viewUsers')}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
