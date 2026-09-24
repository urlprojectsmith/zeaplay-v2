'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Switch } from '@zea-play/ui';
import { useLanguage } from '../../contexts/language-provider';
import { getWorkspaceSettings, updateWorkspaceSettings } from '../../services/workspace-management';
import {
  cloudDriveKeys,
  disconnectCloudConnection,
  getCloudConnections,
  getCloudProviders,
  startCloudConnection,
  type CloudDriveProvider,
} from '../../services/workspace-cloud-drives';
import {
  getWorkspaceNotificationPreferences,
  notificationsKeys,
  updateWorkspaceNotificationPreferences,
  type NotificationCategory,
} from '../../services/workspace-notifications';
import { listWorkspaceRoles, rolesKeys } from '../../services/workspace-roles';
import {
  createWorkspaceApiKey,
  listWorkspaceApiKeys,
  publicApiScopes,
  revokeWorkspaceApiKey,
  workspaceApiKeyKeys,
  type PublicApiScope,
  type WorkspaceApiKeyCreateResult,
} from '../../services/workspace-api-keys';
import {
  createWorkspaceWebhook,
  disableWorkspaceWebhook,
  listWorkspaceWebhookDeliveries,
  listWorkspaceWebhooks,
  retryWorkspaceWebhookDelivery,
  rotateWorkspaceWebhookSecret,
  sendWorkspaceWebhookTest,
  webhookEventTypes,
  workspaceWebhookKeys,
  type WebhookEventType,
  type WorkspaceWebhookCreateResult,
} from '../../services/workspace-webhooks';
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

const notificationCategories: Array<{ value: NotificationCategory; labelKey: string }> = [
  { value: 'TASK', labelKey: 'tasks' },
  { value: 'PROJECT', labelKey: 'projects' },
  { value: 'TICKET', labelKey: 'tickets' },
  { value: 'AUTOMATION', labelKey: 'automation' },
  { value: 'GAMIFICATION', labelKey: 'gamification' },
  { value: 'SYSTEM', labelKey: 'system' },
  { value: 'CALENDAR', labelKey: 'calendar' },
];

const cloudProviders: Array<{ value: CloudDriveProvider; labelKey: string }> = [
  { value: 'GOOGLE_DRIVE', labelKey: 'googleDrive' },
  { value: 'ONEDRIVE', labelKey: 'oneDrive' },
  { value: 'DROPBOX', labelKey: 'dropbox' },
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
  const membershipId = selectedWorkspace?.membershipId ?? null;
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('');
  const [apiKeyName, setApiKeyName] = useState('');
  const [apiKeyExpiry, setApiKeyExpiry] = useState('');
  const [apiKeyScopes, setApiKeyScopes] = useState<PublicApiScope[]>(['tasks.read']);
  const [createdApiKey, setCreatedApiKey] = useState<WorkspaceApiKeyCreateResult | null>(null);
  const [webhookName, setWebhookName] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookEventSelection, setWebhookEventSelection] = useState<WebhookEventType[]>([
    'task.created',
  ]);
  const [revealedWebhookSecret, setRevealedWebhookSecret] =
    useState<WorkspaceWebhookCreateResult | null>(null);
  const [selectedWebhookId, setSelectedWebhookId] = useState<string | null>(null);
  const settingsQuery = useQuery({
    queryKey: ['workspace', workspaceId, 'settings'],
    queryFn: () => getWorkspaceSettings(workspaceId as string),
    enabled: Boolean(workspaceId),
  });
  const preferencesQuery = useQuery({
    queryKey: notificationsKeys.preferences(workspaceId, membershipId),
    queryFn: () => getWorkspaceNotificationPreferences(workspaceId as string),
    enabled: Boolean(workspaceId && membershipId),
  });
  const cloudProvidersQuery = useQuery({
    queryKey: cloudDriveKeys.providers(workspaceId),
    queryFn: () => getCloudProviders(workspaceId as string),
    enabled: Boolean(workspaceId),
  });
  const cloudConnectionsQuery = useQuery({
    queryKey: cloudDriveKeys.connections(workspaceId),
    queryFn: () => getCloudConnections(workspaceId as string),
    enabled: Boolean(workspaceId),
  });
  const rolesQuery = useQuery({
    queryKey: rolesKeys.all(workspaceId),
    queryFn: () => listWorkspaceRoles(workspaceId as string),
    enabled: Boolean(workspaceId),
  });
  const permissions = useMemo(() => {
    const role = rolesQuery.data?.find((item) => item.key === selectedWorkspace?.role);
    return new Set(role?.permissions.map((permission) => permission.key) ?? []);
  }, [rolesQuery.data, selectedWorkspace?.role]);
  const permissionsReady = rolesQuery.isSuccess;
  const canViewApiKeys = permissionsReady && hasPermission(permissions, 'api_keys.view');
  const canCreateApiKeys = permissionsReady && hasPermission(permissions, 'api_keys.create');
  const canManageApiKeys = permissionsReady && hasPermission(permissions, 'api_keys.manage');
  const canViewWebhooks = permissionsReady && hasPermission(permissions, 'webhooks.view');
  const canCreateWebhooks = permissionsReady && hasPermission(permissions, 'webhooks.create');
  const canManageWebhooks = permissionsReady && hasPermission(permissions, 'webhooks.manage');
  const canRetryWebhooks = permissionsReady && hasPermission(permissions, 'webhooks.retry');
  const apiKeysQuery = useQuery({
    queryKey: workspaceApiKeyKeys.list(workspaceId),
    queryFn: () => listWorkspaceApiKeys(workspaceId as string),
    enabled: Boolean(workspaceId && canViewApiKeys),
  });
  const webhooksQuery = useQuery({
    queryKey: workspaceWebhookKeys.list(workspaceId),
    queryFn: () => listWorkspaceWebhooks(workspaceId as string),
    enabled: Boolean(workspaceId && canViewWebhooks),
  });
  const webhookDeliveriesQuery = useQuery({
    queryKey: workspaceWebhookKeys.deliveries(workspaceId, selectedWebhookId),
    queryFn: () =>
      listWorkspaceWebhookDeliveries(workspaceId as string, selectedWebhookId as string),
    enabled: Boolean(workspaceId && selectedWebhookId && canViewWebhooks),
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
  const preferencesMutation = useMutation({
    mutationFn: (input: {
      category: NotificationCategory;
      inAppEnabled: boolean;
      emailEnabled: boolean;
    }) =>
      updateWorkspaceNotificationPreferences(workspaceId as string, [
        {
          category: input.category,
          inAppEnabled: input.inAppEnabled,
          emailEnabled: input.emailEnabled,
          mutedUntil: null,
        },
      ]),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: notificationsKeys.preferences(workspaceId, membershipId),
      });
      void queryClient.invalidateQueries({
        queryKey: notificationsKeys.all(workspaceId, membershipId),
      });
    },
  });
  const connectMutation = useMutation({
    mutationFn: (provider: CloudDriveProvider) =>
      startCloudConnection(workspaceId as string, provider),
    onSuccess: (result) => {
      window.location.assign(result.authorizationUrl);
    },
  });
  const disconnectMutation = useMutation({
    mutationFn: (connectionId: string) =>
      disconnectCloudConnection(workspaceId as string, connectionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: cloudDriveKeys.connections(workspaceId),
      });
      void queryClient.invalidateQueries({
        queryKey: cloudDriveKeys.providers(workspaceId),
      });
    },
  });
  const createApiKeyMutation = useMutation({
    mutationFn: () =>
      createWorkspaceApiKey(workspaceId as string, {
        name: apiKeyName,
        scopes: apiKeyScopes,
        expiresAt: apiKeyExpiry ? new Date(apiKeyExpiry).toISOString() : null,
      }),
    onSuccess: (result) => {
      setCreatedApiKey(result);
      setApiKeyName('');
      setApiKeyExpiry('');
      setApiKeyScopes(['tasks.read']);
      void queryClient.invalidateQueries({ queryKey: workspaceApiKeyKeys.list(workspaceId) });
    },
  });
  const revokeApiKeyMutation = useMutation({
    mutationFn: (apiKeyId: string) => revokeWorkspaceApiKey(workspaceId as string, apiKeyId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: workspaceApiKeyKeys.list(workspaceId) });
    },
  });
  const createWebhookMutation = useMutation({
    mutationFn: () =>
      createWorkspaceWebhook(workspaceId as string, {
        name: webhookName,
        endpointUrl: webhookUrl,
        eventTypes: webhookEventSelection,
      }),
    onSuccess: (result) => {
      setRevealedWebhookSecret(result);
      setWebhookName('');
      setWebhookUrl('');
      setWebhookEventSelection(['task.created']);
      void queryClient.invalidateQueries({ queryKey: workspaceWebhookKeys.list(workspaceId) });
    },
  });
  const disableWebhookMutation = useMutation({
    mutationFn: (webhookId: string) => disableWorkspaceWebhook(workspaceId as string, webhookId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: workspaceWebhookKeys.list(workspaceId) });
    },
  });
  const rotateWebhookMutation = useMutation({
    mutationFn: (webhookId: string) =>
      rotateWorkspaceWebhookSecret(workspaceId as string, webhookId),
    onSuccess: (result) => {
      setRevealedWebhookSecret(result);
      void queryClient.invalidateQueries({ queryKey: workspaceWebhookKeys.list(workspaceId) });
    },
  });
  const testWebhookMutation = useMutation({
    mutationFn: (webhookId: string) => sendWorkspaceWebhookTest(workspaceId as string, webhookId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: workspaceWebhookKeys.deliveries(workspaceId, selectedWebhookId),
      });
    },
  });
  const retryWebhookDeliveryMutation = useMutation({
    mutationFn: (deliveryId: string) =>
      retryWorkspaceWebhookDelivery(workspaceId as string, deliveryId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: workspaceWebhookKeys.deliveries(workspaceId, selectedWebhookId),
      });
    },
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate();
  }
  function toggleApiScope(scope: PublicApiScope) {
    setApiKeyScopes((current) =>
      current.includes(scope)
        ? current.filter((item) => item !== scope)
        : [...current, scope].sort(),
    );
  }
  function toggleWebhookEvent(eventType: WebhookEventType) {
    setWebhookEventSelection((current) =>
      current.includes(eventType)
        ? current.filter((item) => item !== eventType)
        : [...current, eventType].sort(),
    );
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
      <section className="grid gap-4 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
        <header>
          <h2 className="text-lg font-semibold">{t(locale, 'apiKeys.title')}</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {t(locale, 'apiKeys.description')}
          </p>
        </header>
        <form
          className="grid gap-3 rounded-md border border-[hsl(var(--border))] p-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (canCreateApiKeys) createApiKeyMutation.mutate();
          }}
        >
          <label className="grid gap-2 text-sm font-medium">
            {t(locale, 'apiKeys.name')}
            <input
              className="h-10 rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 text-sm"
              disabled={!canCreateApiKeys}
              maxLength={100}
              value={apiKeyName}
              onChange={(event) => setApiKeyName(event.target.value)}
            />
          </label>
          <label className="grid gap-2 text-sm font-medium">
            {t(locale, 'apiKeys.expiration')}
            <input
              className="h-10 rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 text-sm"
              disabled={!canCreateApiKeys}
              type="datetime-local"
              value={apiKeyExpiry}
              onChange={(event) => setApiKeyExpiry(event.target.value)}
            />
          </label>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">{t(locale, 'apiKeys.scopes')}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {publicApiScopes.map((scope) => (
                <label
                  key={scope.value}
                  className="flex items-center gap-2 rounded-md border border-[hsl(var(--border))] px-3 py-2 text-sm"
                >
                  <input
                    checked={apiKeyScopes.includes(scope.value)}
                    disabled={!canCreateApiKeys}
                    type="checkbox"
                    onChange={() => toggleApiScope(scope.value)}
                  />
                  <span>{t(locale, `apiKeys.${scope.labelKey}`)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {createApiKeyMutation.isError ? (
            <p className="text-sm text-[hsl(var(--destructive))]">
              {t(locale, 'apiKeys.createFailed')}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button
              disabled={
                createApiKeyMutation.isPending ||
                !apiKeyName.trim() ||
                apiKeyScopes.length === 0 ||
                !canCreateApiKeys
              }
              type="submit"
            >
              {t(locale, 'apiKeys.create')}
            </Button>
          </div>
        </form>
        {createdApiKey ? (
          <div className="grid gap-3 rounded-md border border-[hsl(var(--primary))] p-3">
            <p className="text-sm font-medium">{t(locale, 'apiKeys.shownOnce')}</p>
            <code className="break-all rounded-md bg-[hsl(var(--muted))] p-3 text-xs">
              {createdApiKey.plaintextApiKey}
            </code>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(createdApiKey.plaintextApiKey);
                }}
              >
                {t(locale, 'apiKeys.copyKey')}
              </Button>
              <Button type="button" onClick={() => setCreatedApiKey(null)}>
                {t(locale, 'apiKeys.savedKey')}
              </Button>
            </div>
          </div>
        ) : null}
        {!permissionsReady ? (
          <div className="h-16 animate-pulse rounded-md bg-[hsl(var(--muted))]" />
        ) : !canViewApiKeys ? (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {t(locale, 'common.permissionDenied')}
          </p>
        ) : apiKeysQuery.isLoading ? (
          <div className="h-16 animate-pulse rounded-md bg-[hsl(var(--muted))]" />
        ) : apiKeysQuery.isError ? (
          <p className="text-sm text-[hsl(var(--destructive))]">
            {t(locale, 'apiKeys.loadFailed')}
          </p>
        ) : (
          <div className="grid gap-2">
            {(apiKeysQuery.data?.items ?? []).map((key) => (
              <div
                key={key.id}
                className="grid gap-3 rounded-md border border-[hsl(var(--border))] p-3 sm:grid-cols-[1fr_auto] sm:items-center"
              >
                <div className="grid gap-1">
                  <span className="text-sm font-medium">{key.name}</span>
                  <span className="break-all text-xs text-[hsl(var(--muted-foreground))]">
                    {key.maskedKey}
                  </span>
                  <span className="text-xs text-[hsl(var(--muted-foreground))]">
                    {t(locale, 'apiKeys.lastUsed')}: {formatDate(key.lastUsedAt)}
                  </span>
                  <span className="text-xs text-[hsl(var(--muted-foreground))]">
                    {key.scopes.join(', ')}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md border border-[hsl(var(--border))] px-2 py-1 text-xs">
                    {t(locale, `apiKeys.status${key.status}`)}
                  </span>
                  <Button
                    disabled={
                      key.status !== 'ACTIVE' || revokeApiKeyMutation.isPending || !canManageApiKeys
                    }
                    onClick={() => {
                      if (canManageApiKeys) revokeApiKeyMutation.mutate(key.id);
                    }}
                    type="button"
                    variant="outline"
                  >
                    {t(locale, 'apiKeys.revoke')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="grid gap-4 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
        <header>
          <h2 className="text-lg font-semibold">{t(locale, 'webhooks.title')}</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {t(locale, 'webhooks.description')}
          </p>
        </header>
        <form
          className="grid gap-3 rounded-md border border-[hsl(var(--border))] p-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (canCreateWebhooks) createWebhookMutation.mutate();
          }}
        >
          <label className="grid gap-2 text-sm font-medium">
            {t(locale, 'webhooks.name')}
            <input
              className="h-10 rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 text-sm"
              disabled={!canCreateWebhooks}
              maxLength={100}
              value={webhookName}
              onChange={(event) => setWebhookName(event.target.value)}
            />
          </label>
          <label className="grid gap-2 text-sm font-medium">
            {t(locale, 'webhooks.url')}
            <input
              className="h-10 rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 text-sm"
              disabled={!canCreateWebhooks}
              inputMode="url"
              maxLength={2048}
              value={webhookUrl}
              onChange={(event) => setWebhookUrl(event.target.value)}
            />
          </label>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">{t(locale, 'webhooks.events')}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {webhookEventTypes.map((eventType) => (
                <label
                  key={eventType.value}
                  className="flex items-center gap-2 rounded-md border border-[hsl(var(--border))] px-3 py-2 text-sm"
                >
                  <input
                    checked={webhookEventSelection.includes(eventType.value)}
                    disabled={!canCreateWebhooks}
                    type="checkbox"
                    onChange={() => toggleWebhookEvent(eventType.value)}
                  />
                  <span>{t(locale, `webhooks.${eventType.labelKey}`)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {createWebhookMutation.isError ? (
            <p className="text-sm text-[hsl(var(--destructive))]">
              {t(locale, 'webhooks.createFailed')}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button
              disabled={
                createWebhookMutation.isPending ||
                !webhookName.trim() ||
                !webhookUrl.trim() ||
                webhookEventSelection.length === 0 ||
                !canCreateWebhooks
              }
              type="submit"
            >
              {t(locale, 'webhooks.create')}
            </Button>
          </div>
        </form>
        {revealedWebhookSecret ? (
          <div className="grid gap-3 rounded-md border border-[hsl(var(--primary))] p-3">
            <p className="text-sm font-medium">{t(locale, 'webhooks.shownOnce')}</p>
            <code className="break-all rounded-md bg-[hsl(var(--muted))] p-3 text-xs">
              {revealedWebhookSecret.plaintextSecret}
            </code>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(revealedWebhookSecret.plaintextSecret);
                }}
              >
                {t(locale, 'webhooks.copySecret')}
              </Button>
              <Button type="button" onClick={() => setRevealedWebhookSecret(null)}>
                {t(locale, 'webhooks.savedSecret')}
              </Button>
            </div>
          </div>
        ) : null}
        {!permissionsReady ? (
          <div className="h-16 animate-pulse rounded-md bg-[hsl(var(--muted))]" />
        ) : !canViewWebhooks ? (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {t(locale, 'common.permissionDenied')}
          </p>
        ) : webhooksQuery.isLoading ? (
          <div className="h-16 animate-pulse rounded-md bg-[hsl(var(--muted))]" />
        ) : webhooksQuery.isError ? (
          <p className="text-sm text-[hsl(var(--destructive))]">
            {t(locale, 'webhooks.loadFailed')}
          </p>
        ) : (
          <div className="grid gap-2">
            {(webhooksQuery.data?.items ?? []).map((webhook) => (
              <div
                key={webhook.id}
                className="grid gap-3 rounded-md border border-[hsl(var(--border))] p-3"
              >
                <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-start">
                  <div className="grid gap-1">
                    <span className="text-sm font-medium">{webhook.name}</span>
                    <span className="break-all text-xs text-[hsl(var(--muted-foreground))]">
                      {webhook.endpointUrl}
                    </span>
                    <span className="text-xs text-[hsl(var(--muted-foreground))]">
                      {t(locale, 'webhooks.lastSuccess')}: {formatDate(webhook.lastSuccessAt)}
                    </span>
                    <span className="text-xs text-[hsl(var(--muted-foreground))]">
                      {t(locale, 'webhooks.lastFailure')}: {formatDate(webhook.lastFailureAt)}
                    </span>
                    <span className="text-xs text-[hsl(var(--muted-foreground))]">
                      {webhook.eventTypes.join(', ')}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md border border-[hsl(var(--border))] px-2 py-1 text-xs">
                      {t(locale, `webhooks.status${webhook.status}`)}
                    </span>
                    <Button
                      disabled={
                        testWebhookMutation.isPending ||
                        webhook.status !== 'ACTIVE' ||
                        !canManageWebhooks
                      }
                      onClick={() => testWebhookMutation.mutate(webhook.id)}
                      type="button"
                      variant="outline"
                    >
                      {t(locale, 'webhooks.sendTest')}
                    </Button>
                    <Button
                      disabled={rotateWebhookMutation.isPending || !canManageWebhooks}
                      onClick={() => rotateWebhookMutation.mutate(webhook.id)}
                      type="button"
                      variant="outline"
                    >
                      {t(locale, 'webhooks.rotateSecret')}
                    </Button>
                    <Button
                      disabled={
                        disableWebhookMutation.isPending ||
                        webhook.status !== 'ACTIVE' ||
                        !canManageWebhooks
                      }
                      onClick={() => disableWebhookMutation.mutate(webhook.id)}
                      type="button"
                      variant="outline"
                    >
                      {t(locale, 'webhooks.disable')}
                    </Button>
                    <Button
                      onClick={() =>
                        setSelectedWebhookId((current) =>
                          current === webhook.id ? null : webhook.id,
                        )
                      }
                      type="button"
                      variant="outline"
                    >
                      {t(locale, 'webhooks.viewDeliveries')}
                    </Button>
                  </div>
                </div>
                {selectedWebhookId === webhook.id ? (
                  webhookDeliveriesQuery.isLoading ? (
                    <div className="h-12 animate-pulse rounded-md bg-[hsl(var(--muted))]" />
                  ) : webhookDeliveriesQuery.isError ? (
                    <p className="text-sm text-[hsl(var(--destructive))]">
                      {t(locale, 'webhooks.deliveriesLoadFailed')}
                    </p>
                  ) : (
                    <div className="grid gap-2">
                      {(webhookDeliveriesQuery.data?.items ?? []).map((delivery) => (
                        <div
                          key={delivery.id}
                          className="grid gap-2 rounded-md border border-[hsl(var(--border))] p-2 text-xs sm:grid-cols-[1fr_auto] sm:items-center"
                        >
                          <div className="grid gap-1">
                            <span className="font-medium">{delivery.event.eventType}</span>
                            <span className="text-[hsl(var(--muted-foreground))]">
                              {delivery.status} · {t(locale, 'webhooks.attempts')}{' '}
                              {delivery.attemptCount} · HTTP {delivery.httpStatus ?? '-'}
                            </span>
                            <span className="text-[hsl(var(--muted-foreground))]">
                              {delivery.safeErrorCode ?? t(locale, 'webhooks.noError')}
                            </span>
                          </div>
                          <Button
                            disabled={
                              !canRetryWebhooks ||
                              retryWebhookDeliveryMutation.isPending ||
                              !['FAILED', 'DEAD_LETTERED'].includes(delivery.status)
                            }
                            onClick={() => retryWebhookDeliveryMutation.mutate(delivery.id)}
                            type="button"
                            variant="outline"
                          >
                            {t(locale, 'webhooks.retry')}
                          </Button>
                        </div>
                      ))}
                    </div>
                  )
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="grid gap-4 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
        <header>
          <h2 className="text-lg font-semibold">{t(locale, 'cloudDrives.title')}</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {t(locale, 'cloudDrives.description')}
          </p>
        </header>
        {cloudProvidersQuery.isLoading || cloudConnectionsQuery.isLoading ? (
          <div className="grid gap-2">
            {[0, 1, 2].map((item) => (
              <div key={item} className="h-14 animate-pulse rounded-md bg-[hsl(var(--muted))]" />
            ))}
          </div>
        ) : cloudProvidersQuery.isError || cloudConnectionsQuery.isError ? (
          <p className="text-sm text-[hsl(var(--destructive))]">
            {t(locale, 'cloudDrives.loadFailed')}
          </p>
        ) : (
          <div className="grid gap-3">
            {cloudProviders.map((provider) => {
              const providerStatus = cloudProvidersQuery.data?.find(
                (item) => item.provider === provider.value,
              );
              const connection = cloudConnectionsQuery.data?.find(
                (item) => item.provider === provider.value && item.status !== 'REVOKED',
              );
              const connected = connection?.status === 'CONNECTED';
              const needsReauth =
                connection?.status === 'REAUTH_REQUIRED' || connection?.status === 'EXPIRED';
              const statusLabel = connected
                ? 'connected'
                : needsReauth
                  ? 'reauthRequired'
                  : providerStatus?.status === 'NOT_CONFIGURED'
                    ? 'notConfigured'
                    : providerStatus?.available
                      ? 'notConnected'
                      : 'unavailable';
              return (
                <div
                  key={provider.value}
                  className="grid gap-3 rounded-md border border-[hsl(var(--border))] p-3 sm:grid-cols-[1fr_auto] sm:items-center"
                >
                  <div className="grid gap-1">
                    <span className="text-sm font-medium">
                      {t(locale, `cloudDrives.${provider.labelKey}`)}
                    </span>
                    <span className="text-xs text-[hsl(var(--muted-foreground))]">
                      {connection?.providerAccountLabel ?? t(locale, `cloudDrives.${statusLabel}`)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md border border-[hsl(var(--border))] px-2 py-1 text-xs">
                      {t(locale, `cloudDrives.${statusLabel}`)}
                    </span>
                    {connected ? (
                      <Button
                        disabled={disconnectMutation.isPending}
                        onClick={() => disconnectMutation.mutate(connection.id)}
                        type="button"
                        variant="outline"
                      >
                        {t(locale, 'cloudDrives.disconnect')}
                      </Button>
                    ) : (
                      <Button
                        disabled={!providerStatus?.available || connectMutation.isPending}
                        onClick={() => connectMutation.mutate(provider.value)}
                        type="button"
                      >
                        {needsReauth
                          ? t(locale, 'cloudDrives.reconnect')
                          : t(locale, 'cloudDrives.connect')}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
      <section className="grid gap-4 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
        <header>
          <h2 className="text-lg font-semibold">{t(locale, 'notifications.preferences')}</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {t(locale, 'notifications.preferencesDescription')}
          </p>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            {t(locale, 'notifications.emailDescription')}
          </p>
        </header>
        {preferencesQuery.isLoading ? (
          <div className="grid gap-2">
            {[0, 1, 2].map((item) => (
              <div key={item} className="h-12 animate-pulse rounded-md bg-[hsl(var(--muted))]" />
            ))}
          </div>
        ) : preferencesQuery.isError ? (
          <p className="text-sm text-[hsl(var(--destructive))]">
            {t(locale, 'notifications.preferencesLoadFailed')}
          </p>
        ) : (
          <div className="grid gap-3">
            {notificationCategories.map((item) => {
              const preference = preferencesQuery.data?.find(
                (candidate) => candidate.category === item.value,
              );
              const inAppEnabled = preference?.inAppEnabled ?? true;
              const emailEnabled = preference?.emailEnabled ?? false;
              return (
                <div
                  key={item.value}
                  className="grid gap-3 rounded-md border border-[hsl(var(--border))] p-3 sm:grid-cols-[1fr_auto_auto] sm:items-center"
                >
                  <span className="text-sm font-medium">
                    {t(locale, `notifications.${item.labelKey}`)}
                  </span>
                  <Switch
                    checked={inAppEnabled}
                    disabled={preferencesMutation.isPending}
                    label={t(locale, 'notifications.inApp')}
                    onCheckedChange={(nextInApp) =>
                      preferencesMutation.mutate({
                        category: item.value,
                        inAppEnabled: nextInApp,
                        emailEnabled,
                      })
                    }
                  />
                  <Switch
                    checked={emailEnabled}
                    disabled={preferencesMutation.isPending}
                    label={t(locale, 'notifications.email')}
                    onCheckedChange={(nextEmail) =>
                      preferencesMutation.mutate({
                        category: item.value,
                        inAppEnabled,
                        emailEnabled: nextEmail,
                      })
                    }
                  />
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

function formatDate(value: string | null) {
  if (!value) return 'Never';
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function hasPermission(permissions: Set<string>, permission: string) {
  return permissions.has('*') || permissions.has(permission);
}
