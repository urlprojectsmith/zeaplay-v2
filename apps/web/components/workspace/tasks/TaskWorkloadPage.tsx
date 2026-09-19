'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@zea-play/ui';
import { useLanguage } from '../../../contexts/language-provider';
import { useSessionStore } from '../../../stores/session';
import {
  listWorkspaceWorkload,
  taskKeys,
  type TaskWorkloadParams,
} from '../../../services/workspace-tasks';

export function TaskWorkloadPage() {
  const workspaceId = useSessionStore((state) => state.selectedWorkspaceId);
  const { locale, t } = useLanguage();
  const [view, setView] = useState<'DAY' | 'WEEK'>('WEEK');
  const params = useMemo<TaskWorkloadParams>(() => ({ view, page: 1, pageSize: 50 }), [view]);
  const workloadQuery = useQuery({
    queryKey: taskKeys.workload(workspaceId, params),
    queryFn: () => listWorkspaceWorkload(workspaceId as string, params),
    enabled: Boolean(workspaceId),
  });
  const workload = workloadQuery.data;
  return (
    <main className="mx-auto grid w-full max-w-6xl gap-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">
            {t(locale, 'workspaceTasks.workload')}
          </h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {t(locale, 'workspaceTasks.plannedWork')} uses task estimates and assignee allocation.
          </p>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            {t(locale, 'workspaceTasks.workloadTimezone')}: {workload?.window.timezone ?? 'UTC'}
          </p>
        </div>
        <div className="flex rounded-md border border-[hsl(var(--border))] p-1">
          {(['DAY', 'WEEK'] as const).map((option) => (
            <Button
              key={option}
              size="sm"
              type="button"
              variant={view === option ? 'primary' : 'ghost'}
              onClick={() => setView(option)}
            >
              {option === 'DAY'
                ? t(locale, 'workspaceTasks.day')
                : t(locale, 'workspaceTasks.week')}
            </Button>
          ))}
        </div>
      </header>
      <section className="grid gap-3 sm:grid-cols-3">
        <Summary
          label={t(locale, 'workspaceTasks.unallocatedWork')}
          value={workload?.summary.unallocatedMinutes ?? 0}
        />
        <Summary
          label={t(locale, 'workspaceTasks.unscheduledWork')}
          value={workload?.summary.unscheduledMinutes ?? 0}
        />
        <Summary
          label={t(locale, 'workspaceTasks.overdueBacklog')}
          value={workload?.summary.overdueMinutes ?? 0}
        />
      </section>
      <section className="grid gap-2">
        {workloadQuery.isLoading ? (
          <p className="rounded-md border border-[hsl(var(--border))] p-4">Loading...</p>
        ) : workload?.items.length ? (
          workload.items.map((member) => (
            <article
              className="grid gap-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-3 sm:grid-cols-[1fr_auto]"
              key={member.membershipId}
            >
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold">
                  {member.user.name ?? member.user.email}
                </h2>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  {t(locale, 'workspaceTasks.plannedAllocation')}: {minutes(member.plannedMinutes)}{' '}
                  / {t(locale, 'workspaceTasks.capacity')}: {minutes(member.capacityMinutes)}
                </p>
              </div>
              <p className="text-sm font-medium">
                {stateLabel(member.state, locale, t)} · {member.utilization ?? '∞'}%
              </p>
            </article>
          ))
        ) : (
          <p className="rounded-md border border-[hsl(var(--border))] p-4">No planned workload</p>
        )}
      </section>
    </main>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-3">
      <p className="text-xs text-[hsl(var(--muted-foreground))]">{label}</p>
      <p className="text-lg font-semibold">{minutes(value)}</p>
    </div>
  );
}

function minutes(value: number) {
  return `${Math.floor(value / 60)}h ${value % 60}m`;
}

function stateLabel(
  state: string,
  locale: Parameters<ReturnType<typeof useLanguage>['t']>[0],
  t: ReturnType<typeof useLanguage>['t'],
) {
  if (state === 'NEAR_CAPACITY') return t(locale, 'workspaceTasks.nearCapacity');
  if (state === 'OVER_CAPACITY') return t(locale, 'workspaceTasks.overCapacity');
  if (state === 'BALANCED') return t(locale, 'workspaceTasks.balanced');
  return t(locale, 'workspaceTasks.available');
}
