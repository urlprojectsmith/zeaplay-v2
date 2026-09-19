'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@zea-play/ui';
import { useLanguage } from '../../../contexts/language-provider';
import { useSessionStore } from '../../../stores/session';
import {
  listWorkspaceTimeReport,
  taskKeys,
  type TimeReportParams,
} from '../../../services/workspace-tasks';

export function TaskTimeTrackingPage() {
  const workspaceId = useSessionStore((state) => state.selectedWorkspaceId);
  const { locale, t } = useLanguage();
  const [page, setPage] = useState(1);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const params = useMemo<TimeReportParams>(
    () => ({ page, pageSize: 20, ...(from ? { from } : {}), ...(to ? { to } : {}) }),
    [from, page, to],
  );
  const reportQuery = useQuery({
    queryKey: taskKeys.timeReport(workspaceId, params),
    queryFn: () => listWorkspaceTimeReport(workspaceId as string, params),
    enabled: Boolean(workspaceId),
  });
  const report = reportQuery.data;
  return (
    <main className="mx-auto grid w-full max-w-6xl gap-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">
            {t(locale, 'workspaceTasks.timeTracking')}
          </h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {t(locale, 'workspaceTasks.totalTracked')}:{' '}
            {formatDuration(report?.summary.totalDurationSeconds ?? 0)}
          </p>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            {t(locale, 'workspaceTasks.timeReportTimezone')}: {report?.summary.timezone ?? 'UTC'}
          </p>
        </div>
      </header>
      <section className="grid gap-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-medium">
          {t(locale, 'workspaceTasks.startTime')}
          <input
            className="h-10 rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 text-sm"
            type="date"
            value={from}
            onChange={(event) => {
              setPage(1);
              setFrom(event.target.value);
            }}
          />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          {t(locale, 'workspaceTasks.endTime')}
          <input
            className="h-10 rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 text-sm"
            type="date"
            value={to}
            onChange={(event) => {
              setPage(1);
              setTo(event.target.value);
            }}
          />
        </label>
      </section>
      <section className="grid gap-2">
        {reportQuery.isLoading ? (
          <p className="rounded-md border border-[hsl(var(--border))] p-4">Loading...</p>
        ) : report?.items.length ? (
          report.items.map((entry) => (
            <article
              className="grid gap-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-3 sm:grid-cols-[1fr_auto]"
              key={entry.id}
            >
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold">{entry.task.title}</h2>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  {entry.member.name ?? entry.member.email} ·{' '}
                  {entry.entryType === 'MANUAL'
                    ? t(locale, 'workspaceTasks.manualEntry')
                    : t(locale, 'workspaceTasks.timerEntry')}
                </p>
              </div>
              <p className="text-sm tabular-nums">{formatDuration(entry.durationSeconds ?? 0)}</p>
            </article>
          ))
        ) : (
          <p className="rounded-md border border-[hsl(var(--border))] p-4">
            {t(locale, 'workspaceTasks.noTimeTracked')}
          </p>
        )}
      </section>
      <nav className="flex items-center justify-end gap-2" aria-label="Time report pages">
        <Button
          disabled={page <= 1}
          variant="secondary"
          onClick={() => setPage((value) => value - 1)}
        >
          Previous
        </Button>
        <span className="text-sm">Page {page}</span>
        <Button
          disabled={!report || page * report.pageSize >= report.total}
          variant="secondary"
          onClick={() => setPage((value) => value + 1)}
        >
          Next
        </Button>
      </nav>
    </main>
  );
}

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}
