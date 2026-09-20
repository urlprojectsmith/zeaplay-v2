'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { Button, EmptyState, Skeleton } from '@zea-play/ui';
import { useLanguage } from '../../../contexts/language-provider';
import { translate as t } from '../../../lib/i18n';
import { useSessionStore } from '../../../stores/session';
import { listWorkspaceRoles, rolesKeys } from '../../../services/workspace-roles';
import {
  gamificationKeys,
  getMyGamificationXpHistory,
  getMyGamificationXpSummary,
  type GamificationXpEntry,
  type GamificationXpEntryType,
  type GamificationXpSourceType,
} from '../../../services/workspace-gamification';

const pageSize = 10;
const tabs = ['overview', 'history'] as const;
type GamificationTab = (typeof tabs)[number];

export function WorkspaceGamificationPage() {
  const { locale } = useLanguage();
  const accessToken = useSessionStore((state) => state.accessToken);
  const selectedWorkspaceId = useSessionStore((state) => state.selectedWorkspaceId);
  const selectedWorkspace = useSessionStore((state) =>
    state.agencies
      .flatMap((agency) => agency.workspaces)
      .find((workspace) => workspace.id === state.selectedWorkspaceId),
  );
  const [activeTab, setActiveTab] = useState<GamificationTab>('overview');
  const [page, setPage] = useState(1);

  useEffect(() => {
    setActiveTab('overview');
    setPage(1);
  }, [selectedWorkspaceId]);

  const rolesQuery = useQuery({
    queryKey: rolesKeys.all(selectedWorkspaceId),
    queryFn: () => listWorkspaceRoles(selectedWorkspaceId as string),
    enabled: Boolean(accessToken && selectedWorkspaceId),
  });
  const permissions = useMemo(() => {
    const role = rolesQuery.data?.find(
      (item) => item.id === selectedWorkspace?.role || item.key === selectedWorkspace?.role,
    );
    return new Set(role?.permissions.map((permission) => permission.key) ?? []);
  }, [rolesQuery.data, selectedWorkspace?.role]);
  const canView = permissions.has('*') || permissions.has('gamification.view');

  const summaryQuery = useQuery({
    queryKey: gamificationKeys.summary(selectedWorkspaceId),
    queryFn: () => getMyGamificationXpSummary(selectedWorkspaceId as string),
    enabled: Boolean(accessToken && selectedWorkspaceId && canView),
  });
  const historyQuery = useQuery({
    queryKey: gamificationKeys.history(selectedWorkspaceId, { page, pageSize }),
    queryFn: () => getMyGamificationXpHistory(selectedWorkspaceId as string, { page, pageSize }),
    enabled: Boolean(accessToken && selectedWorkspaceId && canView && activeTab === 'history'),
  });

  if (!selectedWorkspaceId) {
    return (
      <EmptyState
        title={t(locale, 'states.permissionDenied')}
        description={t(locale, 'states.permissionDeniedDescription')}
      />
    );
  }
  if (rolesQuery.isFetched && !canView) {
    return (
      <EmptyState
        title={t(locale, 'states.permissionDenied')}
        description={t(locale, 'states.permissionDeniedDescription')}
      />
    );
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold tracking-normal">
            {t(locale, 'gamification.title')}
          </h1>
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t(locale, 'gamification.description')}
        </p>
      </header>

      <nav
        role="tablist"
        aria-label={t(locale, 'gamification.tabs')}
        className="flex gap-2 overflow-x-auto border-b pb-2"
      >
        {tabs.map((tab) => (
          <button
            key={tab}
            id={`gamification-tab-${tab}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls={`gamification-panel-${tab}`}
            tabIndex={activeTab === tab ? 0 : -1}
            className={[
              'whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors',
              activeTab === tab ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
            ].join(' ')}
            onClick={() => {
              setActiveTab(tab);
              setPage(1);
            }}
          >
            {tab === 'overview'
              ? t(locale, 'gamification.overview')
              : t(locale, 'gamification.history')}
          </button>
        ))}
      </nav>

      <div
        id={`gamification-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`gamification-tab-${activeTab}`}
      >
        {activeTab === 'overview' ? (
          <OverviewPanel
            summary={summaryQuery.data}
            isLoading={summaryQuery.isLoading || rolesQuery.isLoading}
            isError={summaryQuery.isError}
          />
        ) : (
          <HistoryPanel
            items={historyQuery.data?.items ?? []}
            page={historyQuery.data?.page ?? page}
            pageSize={historyQuery.data?.pageSize ?? pageSize}
            total={historyQuery.data?.total ?? 0}
            isLoading={historyQuery.isLoading}
            isError={historyQuery.isError}
            onPageChange={setPage}
          />
        )}
      </div>
    </section>
  );
}

function OverviewPanel({
  summary,
  isLoading,
  isError,
}: {
  summary:
    | {
        currentXp: number;
        lifetimeEarnedXp: number;
        lifetimeDeductedXp: number;
        entryCount: number;
        lastXpChangeAt: string | null;
      }
    | undefined;
  isLoading: boolean;
  isError: boolean;
}) {
  const { locale } = useLanguage();
  if (isLoading) return <Skeleton className="h-32 w-full" />;
  if (isError) return <EmptyState title={t(locale, 'gamification.unableToLoad')} />;
  const data = summary ?? {
    currentXp: 0,
    lifetimeEarnedXp: 0,
    lifetimeDeductedXp: 0,
    entryCount: 0,
    lastXpChangeAt: null,
  };
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <XpCard label={t(locale, 'gamification.currentXp')} value={`${data.currentXp} XP`} />
      <XpCard
        label={t(locale, 'gamification.lifetimeEarned')}
        value={`${data.lifetimeEarnedXp} XP`}
      />
      <XpCard
        label={t(locale, 'gamification.lifetimeDeducted')}
        value={`${data.lifetimeDeductedXp} XP`}
      />
      <XpCard label={t(locale, 'gamification.entryCount')} value={String(data.entryCount)} />
      <XpCard
        label={t(locale, 'gamification.lastChange')}
        value={
          data.lastXpChangeAt
            ? formatDate(data.lastXpChangeAt)
            : t(locale, 'gamification.noXpActivity')
        }
      />
    </div>
  );
}

function XpCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 break-words text-2xl font-semibold tracking-normal">{value}</p>
    </div>
  );
}

function HistoryPanel({
  items,
  page,
  pageSize,
  total,
  isLoading,
  isError,
  onPageChange,
}: {
  items: GamificationXpEntry[];
  page: number;
  pageSize: number;
  total: number;
  isLoading: boolean;
  isError: boolean;
  onPageChange: (page: number) => void;
}) {
  const { locale } = useLanguage();
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (isError) return <EmptyState title={t(locale, 'gamification.unableToLoadHistory')} />;
  if (items.length === 0) return <EmptyState title={t(locale, 'gamification.noXpActivity')} />;
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {items.map((item) => (
          <article key={item.id} className="rounded-md border bg-card p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="font-medium">{formatXpAmount(item.amount)}</p>
                <p className="text-sm text-muted-foreground">
                  {entryTypeLabel(locale, item.entryType)} /{' '}
                  {sourceTypeLabel(locale, item.sourceType)}
                </p>
              </div>
              <time className="text-sm text-muted-foreground">{formatDate(item.createdAt)}</time>
            </div>
            <p className="mt-2 text-sm">
              {sourceEventLabel(locale, item.sourceEvent)}
              {item.reason ? ` - ${item.reason}` : ''}
            </p>
          </article>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {t(locale, 'gamification.page')} {page} / {pageCount}
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={page <= 1}
            onClick={() => onPageChange(Math.max(1, page - 1))}
          >
            {t(locale, 'gamification.previous')}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={page >= pageCount}
            onClick={() => onPageChange(Math.min(pageCount, page + 1))}
          >
            {t(locale, 'gamification.next')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function formatXpAmount(amount: number) {
  return `${amount > 0 ? '+' : ''}${amount} XP`;
}

function entryTypeLabel(locale: 'en' | 'ta', type: GamificationXpEntryType) {
  const labels = {
    EARN: t(locale, 'gamification.earnedXp'),
    DEDUCT: t(locale, 'gamification.xpDeduction'),
    REVERSAL: t(locale, 'gamification.xpReversal'),
    ADJUSTMENT: t(locale, 'gamification.xpAdjustment'),
  };
  return labels[type];
}

function sourceTypeLabel(locale: 'en' | 'ta', type: GamificationXpSourceType) {
  const labels = {
    TASK: t(locale, 'navigation.tasks'),
    PROJECT: t(locale, 'navigation.projects'),
    TICKET: t(locale, 'navigation.tickets'),
    STREAK: t(locale, 'gamification.xpChange'),
    ACHIEVEMENT: t(locale, 'gamification.xpChange'),
    MANUAL: t(locale, 'gamification.xpChange'),
    SYSTEM: t(locale, 'gamification.system'),
  };
  return labels[type];
}

function sourceEventLabel(locale: 'en' | 'ta', event: string) {
  const labels: Record<string, string> = {
    XP_REVERSAL: t(locale, 'gamification.xpReversal'),
  };
  return labels[event] ?? t(locale, 'gamification.xpChange');
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}
