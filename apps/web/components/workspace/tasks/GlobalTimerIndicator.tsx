'use client';

import { useContext, useEffect, useMemo, useState } from 'react';
import { Clock, Square } from 'lucide-react';
import { QueryClientContext, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@zea-play/ui';
import { useLanguage } from '../../../contexts/language-provider';
import {
  getActiveTimer,
  stopActiveTimer,
  taskKeys,
  type TaskTimeEntry,
} from '../../../services/workspace-tasks';

export function GlobalTimerIndicator() {
  const queryClient = useContext(QueryClientContext);
  if (!queryClient) return null;
  return <GlobalTimerIndicatorContent />;
}

function GlobalTimerIndicatorContent() {
  const queryClient = useQueryClient();
  const { locale, t } = useLanguage();
  const activeQuery = useQuery({
    queryKey: taskKeys.activeTimer(),
    queryFn: getActiveTimer,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });
  const stopMutation = useMutation({
    mutationFn: stopActiveTimer,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: taskKeys.activeTimer() });
    },
  });
  const active = activeQuery.data;
  const elapsed = useElapsedSeconds(active);
  if (!active) return null;
  return (
    <div className="flex max-w-[14rem] items-center gap-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-2 py-1 text-xs text-[hsl(var(--foreground))] sm:max-w-xs">
      <Clock aria-hidden="true" className="h-4 w-4 shrink-0 text-[hsl(var(--primary))]" />
      <div className="min-w-0">
        <p className="truncate font-medium">{active.task.title}</p>
        <p
          className="tabular-nums text-[hsl(var(--muted-foreground))]"
          aria-label={t(locale, 'workspaceTasks.timerRunning')}
        >
          {formatElapsed(elapsed)}
        </p>
      </div>
      <Button
        aria-label={t(locale, 'workspaceTasks.stopTimer')}
        disabled={stopMutation.isPending}
        size="icon"
        type="button"
        variant="ghost"
        onClick={() => stopMutation.mutate()}
      >
        <Square aria-hidden="true" className="h-4 w-4" />
      </Button>
    </div>
  );
}

function useElapsedSeconds(active: TaskTimeEntry | null | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return useMemo(() => {
    if (!active) return 0;
    return Math.max(0, Math.floor((now - new Date(active.startedAt).getTime()) / 1000));
  }, [active, now]);
}

function formatElapsed(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}
