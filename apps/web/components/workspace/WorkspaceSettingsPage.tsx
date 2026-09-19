'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@zea-play/ui';
import { useLanguage } from '../../contexts/language-provider';
import { getWorkspaceSettings, updateWorkspaceSettings } from '../../services/workspace-management';
import { useSessionStore } from '../../stores/session';

const COMMON_TIMEZONES = [
  'UTC',
  'Asia/Kolkata',
  'America/New_York',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
];

export function WorkspaceSettingsPage() {
  const { locale, t } = useLanguage();
  const queryClient = useQueryClient();
  const workspaceId = useSessionStore((state) => state.selectedWorkspaceId);
  const selectedAgencyId = useSessionStore((state) => state.selectedAgencyId);
  const selectedWorkspace = useSessionStore((state) =>
    state.agencies
      .find((agency) => agency.id === state.selectedAgencyId)
      ?.workspaces.find((workspace) => workspace.id === state.selectedWorkspaceId),
  );
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('');
  const settingsQuery = useQuery({
    queryKey: ['workspace', workspaceId, 'settings'],
    queryFn: () => getWorkspaceSettings(workspaceId as string),
    enabled: Boolean(workspaceId),
  });
  const browserTimezone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  }, []);
  const timezoneOptions = useMemo(
    () =>
      Array.from(
        new Set(
          [selectedWorkspace?.timezone, browserTimezone, ...COMMON_TIMEZONES].filter(Boolean),
        ),
      ),
    [browserTimezone, selectedWorkspace?.timezone],
  );
  useEffect(() => {
    const settings = settingsQuery.data;
    if (!settings) return;
    setName(settings.name);
    setTimezone(settings.timezone);
  }, [settingsQuery.data]);
  const mutation = useMutation({
    mutationFn: () =>
      updateWorkspaceSettings(workspaceId as string, {
        name: name.trim(),
        timezone: timezone.trim(),
      }),
    onSuccess: (workspace) => {
      useSessionStore.setState((state) => ({
        agencies: state.agencies.map((agency) =>
          agency.id !== selectedAgencyId
            ? agency
            : {
                ...agency,
                workspaces: agency.workspaces.map((item) =>
                  item.id === workspace.id
                    ? { ...item, name: workspace.name, timezone: workspace.timezone }
                    : item,
                ),
              },
        ),
      }));
      queryClient.setQueryData(['workspace', workspaceId, 'settings'], workspace);
      void queryClient.invalidateQueries({
        queryKey: ['workspace', workspaceId, 'tasks', 'workload'],
      });
      void queryClient.invalidateQueries({
        queryKey: ['workspace', workspaceId, 'tasks', 'time-report'],
      });
    },
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate();
  }
  return (
    <main className="mx-auto grid w-full max-w-3xl gap-4 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-normal">
          {t(locale, 'workspaceSettings.title')}
        </h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          {t(locale, 'workspaceSettings.description')}
        </p>
      </header>
      <form
        className="grid gap-4 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4"
        onSubmit={submit}
      >
        <label className="grid gap-2 text-sm font-medium">
          {t(locale, 'common.workspace')}
          <input
            className="h-10 rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 text-sm"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="grid gap-2 text-sm font-medium">
          {t(locale, 'workspaceSettings.timezone')}
          <input
            aria-label={t(locale, 'workspaceSettings.timezone')}
            className="h-10 rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 text-sm"
            list="workspace-timezones"
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
          />
          <datalist id="workspace-timezones">
            {timezoneOptions.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
          <span className="text-xs text-[hsl(var(--muted-foreground))]">
            {t(locale, 'workspaceSettings.timezoneHelp')}
          </span>
        </label>
        {mutation.isError ? (
          <p className="text-sm text-[hsl(var(--destructive))]">
            {t(locale, 'workspaceSettings.timezoneInvalid')}
          </p>
        ) : null}
        <div className="flex justify-end">
          <Button disabled={mutation.isPending || settingsQuery.isLoading} type="submit">
            {t(locale, 'workspaceSettings.save')}
          </Button>
        </div>
      </form>
    </main>
  );
}
