'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, Circle, ExternalLink, Settings } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Dialog, DialogContent, DialogHeader, DialogTitle } from '@zea-play/ui';
import { useLanguage } from '../../contexts/language-provider';
import {
  listWorkspaceNotifications,
  markAllWorkspaceNotificationsRead,
  markWorkspaceNotificationRead,
  markWorkspaceNotificationUnread,
  notificationsKeys,
  getWorkspaceNotificationUnreadCount,
  type NotificationCategory,
  type WorkspaceNotification,
} from '../../services/workspace-notifications';
import { useSessionStore } from '../../stores/session';

const categories: Array<{ value: NotificationCategory; labelKey: string }> = [
  { value: 'TASK', labelKey: 'tasks' },
  { value: 'PROJECT', labelKey: 'projects' },
  { value: 'TICKET', labelKey: 'tickets' },
  { value: 'AUTOMATION', labelKey: 'automation' },
  { value: 'GAMIFICATION', labelKey: 'gamification' },
  { value: 'SYSTEM', labelKey: 'system' },
  { value: 'CALENDAR', labelKey: 'calendar' },
];

export function NotificationCenter() {
  const { locale, t } = useLanguage();
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspaceId = useSessionStore((state) => state.selectedWorkspaceId);
  const membershipId = useSessionStore(
    (state) =>
      state.agencies
        .find((agency) => agency.id === state.selectedAgencyId)
        ?.workspaces.find((workspace) => workspace.id === state.selectedWorkspaceId)
        ?.membershipId ?? null,
  );
  const accessToken = useSessionStore((state) => state.accessToken);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<'all' | 'unread'>('all');
  const [category, setCategory] = useState('');
  const countQuery = useQuery({
    queryKey: notificationsKeys.unreadCount(workspaceId, membershipId),
    queryFn: () => getWorkspaceNotificationUnreadCount(workspaceId as string),
    enabled: Boolean(accessToken && workspaceId && membershipId),
  });
  const listQuery = useQuery({
    queryKey: notificationsKeys.list(workspaceId, membershipId, state, category),
    queryFn: () =>
      listWorkspaceNotifications(workspaceId as string, {
        state,
        category,
      }),
    enabled: Boolean(accessToken && workspaceId && membershipId && open),
  });
  const invalidate = () => {
    void queryClient.invalidateQueries({
      queryKey: notificationsKeys.all(workspaceId, membershipId),
    });
  };
  const readMutation = useMutation({
    mutationFn: (notificationId: string) =>
      markWorkspaceNotificationRead(workspaceId as string, notificationId),
    onSuccess: invalidate,
  });
  const unreadMutation = useMutation({
    mutationFn: (notificationId: string) =>
      markWorkspaceNotificationUnread(workspaceId as string, notificationId),
    onSuccess: invalidate,
  });
  const readAllMutation = useMutation({
    mutationFn: () => markAllWorkspaceNotificationsRead(workspaceId as string),
    onSuccess: invalidate,
  });
  useEffect(() => {
    setOpen(false);
    setState('all');
    setCategory('');
  }, [workspaceId, membershipId]);
  const unreadCount = countQuery.data?.count ?? 0;
  return (
    <>
      <Button
        aria-label={`${t(locale, 'common.notifications')}: ${unreadCount} ${t(locale, 'notifications.unread')}`}
        className="relative"
        size="icon"
        type="button"
        variant="ghost"
        onClick={() => setOpen(true)}
      >
        <Bell aria-hidden="true" className="h-5 w-5" />
        {unreadCount > 0 ? (
          <span className="absolute right-1 top-1 min-w-4 rounded-full bg-[hsl(var(--danger))] px-1 text-[10px] font-semibold leading-4 text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="right-0 top-0 h-[100dvh] w-full max-w-md translate-x-0 translate-y-0 rounded-none sm:left-auto sm:right-4 sm:top-20 sm:h-[min(720px,calc(100dvh-6rem))] sm:rounded-md">
          <DialogHeader>
            <div className="flex items-center justify-between gap-3 pr-8">
              <DialogTitle>{t(locale, 'common.notifications')}</DialogTitle>
              <Button
                disabled={readAllMutation.isPending || unreadCount === 0}
                size="sm"
                type="button"
                variant="outline"
                onClick={() => readAllMutation.mutate()}
              >
                <CheckCheck aria-hidden="true" className="h-4 w-4" />
                {t(locale, 'notifications.markAllRead')}
              </Button>
            </div>
          </DialogHeader>
          <div className="grid min-h-0 flex-1 gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <FilterButton active={state === 'all'} onClick={() => setState('all')}>
                {t(locale, 'notifications.all')}
              </FilterButton>
              <FilterButton active={state === 'unread'} onClick={() => setState('unread')}>
                {t(locale, 'notifications.unread')}
              </FilterButton>
              <select
                aria-label={t(locale, 'notifications.category')}
                className="h-9 rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-2 text-sm"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                <option value="">{t(locale, 'notifications.allCategories')}</option>
                {categories.map((item) => (
                  <option key={item.value} value={item.value}>
                    {t(locale, `notifications.${item.labelKey}`)}
                  </option>
                ))}
              </select>
              <Button
                aria-label={t(locale, 'notifications.preferences')}
                size="icon"
                type="button"
                variant="ghost"
                onClick={() => router.push('/workspace/settings')}
              >
                <Settings aria-hidden="true" className="h-4 w-4" />
              </Button>
            </div>
            <div className="min-h-0 overflow-y-auto pr-1">
              {listQuery.isLoading ? (
                <div className="grid gap-2">
                  {[0, 1, 2].map((item) => (
                    <div
                      key={item}
                      className="h-24 animate-pulse rounded-md bg-[hsl(var(--muted))]"
                    />
                  ))}
                </div>
              ) : listQuery.isError ? (
                <p className="rounded-md border border-[hsl(var(--border))] p-4 text-sm">
                  {t(locale, 'notifications.unableToLoad')}
                </p>
              ) : listQuery.data?.items.length ? (
                <div className="grid gap-2">
                  {listQuery.data.items.map((item) => (
                    <NotificationRow
                      key={item.id}
                      item={item}
                      labels={{
                        markRead: t(locale, 'notifications.markRead'),
                        markUnread: t(locale, 'notifications.markUnread'),
                        open: t(locale, 'notifications.open'),
                      }}
                      onRead={() => readMutation.mutate(item.id)}
                      onUnread={() => unreadMutation.mutate(item.id)}
                    />
                  ))}
                </div>
              ) : (
                <p className="rounded-md border border-[hsl(var(--border))] p-4 text-sm">
                  {state === 'unread'
                    ? t(locale, 'notifications.allCaughtUp')
                    : t(locale, 'notifications.noNotifications')}
                </p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function FilterButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <Button size="sm" type="button" variant={active ? 'primary' : 'outline'} onClick={onClick}>
      {children}
    </Button>
  );
}

function NotificationRow({
  item,
  labels,
  onRead,
  onUnread,
}: {
  item: WorkspaceNotification;
  labels: { markRead: string; markUnread: string; open: string };
  onRead: () => void;
  onUnread: () => void;
}) {
  const route = useMemo(() => entityRoute(item), [item]);
  const router = useRouter();
  return (
    <article className="grid gap-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-3">
      <div className="flex items-start gap-3">
        <Circle
          aria-hidden="true"
          className={item.unread ? 'mt-1 h-3 w-3 fill-[hsl(var(--primary))]' : 'mt-1 h-3 w-3'}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold">{item.title}</h3>
            <Badge variant={item.priority === 'URGENT' ? 'danger' : 'neutral'}>
              {item.category}
            </Badge>
          </div>
          <p className="mt-1 line-clamp-2 text-sm text-[hsl(var(--muted-foreground))]">
            {item.message}
          </p>
          <time className="mt-2 block text-xs text-[hsl(var(--muted-foreground))]">
            {new Date(item.createdAt).toLocaleString()}
          </time>
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        {route ? (
          <Button
            size="sm"
            type="button"
            variant="ghost"
            onClick={() => router.push(route as Parameters<typeof router.push>[0])}
          >
            <ExternalLink aria-hidden="true" className="h-4 w-4" />
            {labels.open}
          </Button>
        ) : null}
        <Button size="sm" type="button" variant="outline" onClick={item.unread ? onRead : onUnread}>
          {item.unread ? labels.markRead : labels.markUnread}
        </Button>
      </div>
    </article>
  );
}

function entityRoute(item: WorkspaceNotification) {
  if (!item.entityId) return null;
  if (item.entityType === 'TASK') return '/workspace/tasks';
  if (item.entityType === 'TICKET') return `/workspace/tickets/${item.entityId}`;
  if (item.entityType === 'PROJECT') return `/workspace/projects/${item.entityId}`;
  return null;
}
