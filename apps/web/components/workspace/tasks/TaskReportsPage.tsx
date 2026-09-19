'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Input } from '@zea-play/ui';
import { useLanguage } from '../../../contexts/language-provider';
import { useSessionStore } from '../../../stores/session';
import {
  exportTaskReportsCsv,
  getTaskReportsSummary,
  taskKeys,
  type TaskReportsParams,
} from '../../../services/workspace-tasks';

export function TaskReportsPage() {
  const workspaceId = useSessionStore((state) => state.selectedWorkspaceId);
  const { locale, t } = useLanguage();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const params = useMemo<TaskReportsParams>(
    () => ({ from: from || undefined, to: to || undefined }),
    [from, to],
  );
  const reportQuery = useQuery({
    queryKey: taskKeys.reports(workspaceId, params),
    queryFn: () => getTaskReportsSummary(workspaceId as string, params),
    enabled: Boolean(workspaceId),
  });
  const report = reportQuery.data;
  return (
    <main className="mx-auto grid w-full max-w-6xl gap-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">
            {t(locale, 'workspaceTasks.taskReports')}
          </h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">{report?.timezone ?? 'UTC'}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Input
            label={t(locale, 'workspaceTasks.dueFrom')}
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
          <Input
            label={t(locale, 'workspaceTasks.dueTo')}
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
          <Button
            type="button"
            onClick={() => {
              if (!workspaceId) return;
              void exportTaskReportsCsv(workspaceId, params).then((result) =>
                downloadCsv(result.filename, result.csv, result.contentType),
              );
            }}
          >
            {t(locale, 'workspaceTasks.exportCsv')}
          </Button>
        </div>
      </header>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Kpi label={t(locale, 'workspaceTasks.totalTasks')} value={report?.kpis.totalTasks ?? 0} />
        <Kpi label={t(locale, 'workspaceTasks.openTasks')} value={report?.kpis.open ?? 0} />
        <Kpi
          label={t(locale, 'workspaceTasks.completedTasks')}
          value={report?.kpis.completed ?? 0}
        />
        <Kpi label={t(locale, 'workspaceTasks.overdueTasks')} value={report?.kpis.overdue ?? 0} />
        <Kpi
          label={t(locale, 'workspaceTasks.pendingApproval')}
          value={report?.kpis.pendingApproval ?? 0}
        />
        <Kpi
          label={t(locale, 'workspaceTasks.completionRate')}
          value={`${report?.kpis.completionRate ?? 0}%`}
        />
        <Kpi
          label={t(locale, 'workspaceTasks.estimatedTime')}
          value={report?.time.estimatedMinutes ?? 0}
        />
        <Kpi
          label={t(locale, 'workspaceTasks.trackedTime')}
          value={
            report?.time.trackedTimeRestricted ? 'Restricted' : (report?.time.trackedSeconds ?? 0)
          }
        />
      </section>
      <section className="rounded-md border border-[hsl(var(--border))] p-4">
        <h2 className="font-semibold">{t(locale, 'workspaceTasks.completionEvents')}</h2>
        <div className="mt-3 grid gap-2">
          {report?.completionTrend.length ? (
            report.completionTrend.map((item) => (
              <div key={item.date} className="flex justify-between text-sm">
                <span>{item.date}</span>
                <span>{item.count}</span>
              </div>
            ))
          ) : (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              {t(locale, 'workspaceTasks.noReportData')}
            </p>
          )}
        </div>
      </section>
    </main>
  );
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <article className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
      <p className="text-sm text-[hsl(var(--muted-foreground))]">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </article>
  );
}

function downloadCsv(filename: string, csv: string, contentType: string) {
  const blob = new Blob([csv], { type: contentType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
