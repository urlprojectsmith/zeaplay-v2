'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Card, CardContent, CardHeader, EmptyState, Input } from '@zea-play/ui';
import { useLanguage } from '../../contexts/language-provider';
import {
  getSuperAgencyGlobalAgencies,
  getSuperAgencyGlobalSubaccounts,
  getSuperAgencyGlobalUsers,
  globalGamificationKeys,
  type GlobalAgencyLeaderboardItem,
  type GlobalSubaccountLeaderboardItem,
} from '../../services/global-gamification';
import { useSessionStore } from '../../stores/session';
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

type SuperAgencyTab = 'agencies' | 'subaccounts' | 'users';

const tabs: SuperAgencyTab[] = ['agencies', 'subaccounts', 'users'];
const pageSize = 20;

export function SuperAgencyGlobalLeaderboardPage() {
  const { locale, t } = useLanguage();
  const { accessToken, selectedSuperAgencyId, superAgencies } = useSessionStore();
  const selectedSuperAgency = superAgencies.find((tenant) => tenant.id === selectedSuperAgencyId);
  const [activeTab, setActiveTab] = useState<SuperAgencyTab>(() => readGlobalTab('agencies', tabs));
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
  }, [selectedSuperAgencyId]);

  const agenciesQuery = useQuery({
    queryKey: globalGamificationKeys.superAgency(selectedSuperAgencyId, 'agencies', params),
    queryFn: () => getSuperAgencyGlobalAgencies(selectedSuperAgencyId as string, params),
    enabled: Boolean(accessToken && selectedSuperAgencyId && activeTab === 'agencies'),
  });
  const subaccountsQuery = useQuery({
    queryKey: globalGamificationKeys.superAgency(selectedSuperAgencyId, 'subaccounts', params),
    queryFn: () => getSuperAgencyGlobalSubaccounts(selectedSuperAgencyId as string, params),
    enabled: Boolean(accessToken && selectedSuperAgencyId && activeTab === 'subaccounts'),
  });
  const usersQuery = useQuery({
    queryKey: globalGamificationKeys.superAgency(selectedSuperAgencyId, 'users', params),
    queryFn: () => getSuperAgencyGlobalUsers(selectedSuperAgencyId as string, params),
    enabled: Boolean(accessToken && selectedSuperAgencyId && activeTab === 'users'),
  });
  const agencySubaccountsQuery = useQuery({
    queryKey: globalGamificationKeys.superAgency(
      selectedSuperAgencyId,
      'agency-subaccounts',
      agencySubaccountParams,
    ),
    queryFn: () =>
      getSuperAgencyGlobalSubaccounts(selectedSuperAgencyId as string, agencySubaccountParams),
    enabled: Boolean(accessToken && selectedSuperAgencyId && selectedAgency),
  });
  const subaccountUsersQuery = useQuery({
    queryKey: globalGamificationKeys.superAgency(
      selectedSuperAgencyId,
      'subaccount-users',
      subaccountUsersParams,
    ),
    queryFn: () =>
      getSuperAgencyGlobalUsers(selectedSuperAgencyId as string, subaccountUsersParams),
    enabled: Boolean(accessToken && selectedSuperAgencyId && selectedSubaccount),
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
        description={
          selectedSuperAgency
            ? `${selectedSuperAgency.name} - ${t(locale, 'globalLeaderboard.normalizedScoreNote')}`
            : t(locale, 'superAgency.explicitSelectionRequired')
        }
      />
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <GlobalTabList
              activeTab={activeTab}
              tabs={tabs}
              onChange={(tab) => {
                setActiveTab(tab as SuperAgencyTab);
                writeGlobalTab(tab);
                setSelectedAgency(null);
                setSelectedSubaccount(null);
                setPage(1);
                setDrilldownPage(1);
              }}
            />
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
                showAgency={false}
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
