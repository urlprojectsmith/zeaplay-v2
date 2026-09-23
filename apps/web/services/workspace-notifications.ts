import { apiClient } from './api';

export type NotificationCategory =
  'TASK' | 'PROJECT' | 'TICKET' | 'AUTOMATION' | 'GAMIFICATION' | 'SYSTEM' | 'CALENDAR';

export type NotificationPriority = 'NORMAL' | 'IMPORTANT' | 'URGENT';

export interface WorkspaceNotification {
  id: string;
  workspaceId: string;
  category: NotificationCategory;
  type: string;
  title: string;
  message: string;
  entityType: string | null;
  entityId: string | null;
  priority: NotificationPriority;
  readAt: string | null;
  createdAt: string;
  unread: boolean;
}

export interface NotificationPreference {
  category: NotificationCategory;
  inAppEnabled: boolean;
  emailEnabled: boolean;
  pushEnabled: boolean;
  mutedUntil: string | null;
}

export const notificationsKeys = {
  all: (workspaceId: string | null) => ['workspace', workspaceId, 'notifications'] as const,
  list: (workspaceId: string | null, state: 'all' | 'unread', category: string) =>
    [...notificationsKeys.all(workspaceId), 'list', state, category] as const,
  unreadCount: (workspaceId: string | null) =>
    [...notificationsKeys.all(workspaceId), 'unread-count'] as const,
  preferences: (workspaceId: string | null) =>
    [...notificationsKeys.all(workspaceId), 'preferences'] as const,
};

export async function listWorkspaceNotifications(
  workspaceId: string,
  params: { state?: 'all' | 'unread'; category?: string } = {},
) {
  const search = new URLSearchParams({
    page: '1',
    pageSize: '20',
    state: params.state ?? 'all',
  });
  if (params.category) search.set('category', params.category);
  const response = await apiClient.request<{
    items: WorkspaceNotification[];
    page: number;
    pageSize: number;
    total: number;
  }>(`/workspaces/${workspaceId}/notifications?${search.toString()}`);
  return response.data;
}

export async function getWorkspaceNotificationUnreadCount(workspaceId: string) {
  const response = await apiClient.request<{ count: number }>(
    `/workspaces/${workspaceId}/notifications/unread-count`,
  );
  return response.data;
}

export async function markWorkspaceNotificationRead(workspaceId: string, notificationId: string) {
  const response = await apiClient.request<WorkspaceNotification>(
    `/workspaces/${workspaceId}/notifications/${notificationId}/read`,
    { method: 'POST' },
  );
  return response.data;
}

export async function markWorkspaceNotificationUnread(workspaceId: string, notificationId: string) {
  const response = await apiClient.request<WorkspaceNotification>(
    `/workspaces/${workspaceId}/notifications/${notificationId}/unread`,
    { method: 'POST' },
  );
  return response.data;
}

export async function markAllWorkspaceNotificationsRead(workspaceId: string) {
  const response = await apiClient.request<{ updatedCount: number }>(
    `/workspaces/${workspaceId}/notifications/read-all`,
    { method: 'POST' },
  );
  return response.data;
}

export async function getWorkspaceNotificationPreferences(workspaceId: string) {
  const response = await apiClient.request<NotificationPreference[]>(
    `/workspaces/${workspaceId}/notifications/preferences`,
  );
  return response.data;
}

export async function updateWorkspaceNotificationPreferences(
  workspaceId: string,
  preferences: Array<Pick<NotificationPreference, 'category' | 'inAppEnabled' | 'mutedUntil'>>,
) {
  const response = await apiClient.request<NotificationPreference[]>(
    `/workspaces/${workspaceId}/notifications/preferences`,
    { method: 'PATCH', body: JSON.stringify({ preferences }) },
  );
  return response.data;
}
