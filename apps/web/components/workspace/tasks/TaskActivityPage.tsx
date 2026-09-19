'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Input } from '@zea-play/ui';
import { useLanguage } from '../../../contexts/language-provider';
import { useSessionStore } from '../../../stores/session';
import {
  exportTaskActivityCsv,
  getTaskActivity,
  taskKeys,
  type TaskActivityParams,
} from '../../../services/workspace-tasks';

export function TaskActivityPage() {
  const workspaceId = useSessionStore((state) => state.selectedWorkspaceId);
  const { locale, t } = useLanguage();
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const params = useMemo<TaskActivityParams>(
    () => ({
      action: action || undefined,
      from: from || undefined,
      to: to || undefined,
      page: 1,
      pageSize: 20,
    }),
    [action, from, to],
  );
  const activityQuery = useQuery({
    queryKey: taskKeys.activity(workspaceId, params),
    queryFn: () => getTaskActivity(workspaceId as string, params),
    enabled: Boolean(workspaceId),
  });
  return (
    <main className="mx-auto grid w-full max-w-6xl gap-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">
            {t(locale, 'workspaceTasks.activityLogs')}
          </h1>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {activityQuery.data?.timezone ?? 'UTC'}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Input
            label={t(locale, 'workspaceTasks.eventType')}
            value={action}
            onChange={(event) => setAction(event.target.value)}
          />
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
              void exportTaskActivityCsv(workspaceId, params).then((result) =>
                downloadCsv(result.filename, result.csv, result.contentType),
              );
            }}
          >
            {t(locale, 'workspaceTasks.exportActivityCsv')}
          </Button>
        </div>
      </header>
      <section className="grid gap-2">
        {activityQuery.data?.items.length ? (
          activityQuery.data.items.map((item) => (
            <article
              key={item.id}
              className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-3"
            >
              <div className="flex flex-wrap justify-between gap-2">
                <h2 className="font-semibold">{item.action}</h2>
                <time className="text-sm text-[hsl(var(--muted-foreground))]">
                  {new Date(item.timestamp).toLocaleString()}
                </time>
              </div>
              <p className="text-sm text-[hsl(var(--muted-foreground))]">{item.summary}</p>
              <p className="text-sm">
                {item.actor?.name ?? item.actor?.email ?? t(locale, 'workspaceTasks.user')}
              </p>
            </article>
          ))
        ) : (
          <p className="rounded-md border border-[hsl(var(--border))] p-4 text-sm text-[hsl(var(--muted-foreground))]">
            {t(locale, 'workspaceTasks.noActivity')}
          </p>
        )}
      </section>
    </main>
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
