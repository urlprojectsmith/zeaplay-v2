'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, EmptyState, Input, Skeleton } from '@zea-play/ui';
import { Goal, Search } from 'lucide-react';
import { PageContainer } from '../../layout/PageContainer';
import { PageHeader } from '../../layout/PageHeader';
import { useSessionStore } from '../../../stores/session';
import {
  listAgencyParentGoals,
  listSuperAgencyParentGoals,
  parentGoalKeys,
  type ParentGoalAggregate,
} from '../../../services/workspace-goals';

const pageSize = 50;

export function AgencyGoalsOversightPage() {
  const { accessToken, selectedAgencyId, agencies } = useSessionStore();
  const selectedAgency = agencies.find((agency) => agency.id === selectedAgencyId);
  return (
    <ParentGoalsOversightPage
      scope="agency"
      scopeId={selectedAgencyId}
      enabled={Boolean(accessToken && selectedAgencyId)}
      title="Goals Oversight"
      description={
        selectedAgency
          ? `${selectedAgency.name} Workspace goal aggregates`
          : 'Select an Agency to review Workspace goal aggregates.'
      }
    />
  );
}

export function SuperAgencyGoalsOversightPage() {
  const { accessToken, selectedSuperAgencyId, superAgencies } = useSessionStore();
  const selectedSuperAgency = superAgencies.find((item) => item.id === selectedSuperAgencyId);
  return (
    <ParentGoalsOversightPage
      scope="super-agency"
      scopeId={selectedSuperAgencyId}
      enabled={Boolean(accessToken && selectedSuperAgencyId)}
      title="Goals Oversight"
      description={
        selectedSuperAgency
          ? `${selectedSuperAgency.name} descendant Workspace goal aggregates`
          : 'Select a Super Agency to review descendant Workspace goal aggregates.'
      }
    />
  );
}

function ParentGoalsOversightPage({
  scope,
  scopeId,
  enabled,
  title,
  description,
}: {
  scope: 'agency' | 'super-agency';
  scopeId: string | null;
  enabled: boolean;
  title: string;
  description: string;
}) {
  const [search, setSearch] = useState('');
  const params = useMemo(() => ({ search, page: 1, pageSize }), [search]);
  const goalsQuery = useQuery({
    queryKey:
      scope === 'agency'
        ? parentGoalKeys.agency(scopeId, params)
        : parentGoalKeys.superAgency(scopeId, params),
    queryFn: () =>
      scope === 'agency'
        ? listAgencyParentGoals(scopeId as string, params)
        : listSuperAgencyParentGoals(scopeId as string, params),
    enabled,
  });
  const goals = goalsQuery.data?.items ?? [];

  return (
    <PageContainer>
      <PageHeader title={title} description={description} />
      {!enabled ? (
        <EmptyState title="No Parent Scope" description="Select a parent tenant to review Goals." />
      ) : (
        <section className="grid gap-4">
          <div className="rounded-md border border-border bg-card p-3">
            <label className="relative block max-w-xl">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                value={search}
                aria-label="Search Goals"
                placeholder="Search Goals"
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          </div>
          {goalsQuery.isLoading ? (
            <div className="grid gap-2">
              <Skeleton className="h-20 rounded-md" />
              <Skeleton className="h-20 rounded-md" />
            </div>
          ) : goals.length ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {goals.map((item) => (
                <ParentGoalCard key={aggregateKey(item)} item={item} />
              ))}
            </div>
          ) : (
            <EmptyState
              title="No Goals"
              description="No parent-readable goal aggregates were found."
            />
          )}
        </section>
      )}
    </PageContainer>
  );
}

function ParentGoalCard({ item }: { item: ParentGoalAggregate }) {
  const progress = item._sum.currentProgress ?? 0;
  const target = item._sum.targetValue ?? 0;
  return (
    <article className="grid gap-3 rounded-md border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Goal className="h-4 w-4 text-muted-foreground" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{item.workspaceId}</p>
            <p className="text-xs text-muted-foreground">
              {label(item.ownerType)} - {label(item.metricType)}
            </p>
          </div>
        </div>
        <Badge>{label(item.status)}</Badge>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Metric label="Goals" value={String(item._count._all)} />
        <Metric label="Progress" value={String(progress)} />
        <Metric label="Target" value={String(target)} />
      </div>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function aggregateKey(item: ParentGoalAggregate) {
  return `${item.workspaceId}:${item.status}:${item.ownerType}:${item.metricType}`;
}

function label(value: string) {
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
