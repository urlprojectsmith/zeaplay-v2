import { apiClient } from './api';
import type { TaskPriority } from './workspace-tasks';

export type CalendarSourceType = 'TASK' | 'PROJECT' | 'TICKET' | 'CUSTOM_EVENT';
export type CalendarVisibility =
  'WORKSPACE' | 'PARTICIPANTS_ONLY' | 'PRIVATE' | 'RESTRICTED' | 'SOURCE';
export type CalendarView = 'month' | 'week' | 'day';

export interface CalendarItem {
  id: string;
  sourceType: CalendarSourceType;
  sourceId: string;
  title: string;
  startAt: string;
  endAt: string | null;
  allDay: boolean;
  status: { id: string | null; name: string; terminal?: boolean } | string | null;
  priority: TaskPriority | null;
  departmentId: string | null;
  participantMembershipIds: string[];
  visibility: CalendarVisibility;
  editable: boolean;
  metadata: Record<string, string | number | boolean | null>;
}

export interface CalendarResponse {
  window: { from: string; to: string; timezone: string };
  items: CalendarItem[];
}

export interface CalendarQueryParams {
  from: string;
  to: string;
  sourceTypes?: CalendarSourceType[];
  memberIds?: string[];
  departmentIds?: string[];
  priorities?: TaskPriority[];
  statuses?: string[];
}

export interface CalendarEventPayload {
  title: string;
  description?: string | null;
  startAt: string;
  endAt?: string | null;
  allDay?: boolean;
  timezone?: string | null;
  visibility?: 'WORKSPACE' | 'PARTICIPANTS_ONLY' | 'PRIVATE';
  ownerMembershipId?: string;
  participantMembershipIds?: string[];
}

export const calendarKeys = {
  all: (workspaceId: string | null) => ['workspace', workspaceId, 'calendar'] as const,
  range: (
    workspaceId: string | null,
    view: CalendarView,
    date: string,
    params: CalendarQueryParams,
  ) => [...calendarKeys.all(workspaceId), view, date, params] as const,
  event: (workspaceId: string | null, eventId: string | null) =>
    [...calendarKeys.all(workspaceId), 'event', eventId] as const,
};

export async function getWorkspaceCalendar(workspaceId: string, params: CalendarQueryParams) {
  const response = await apiClient.request<CalendarResponse>(
    `/workspaces/${workspaceId}/calendar?${calendarQueryString(params)}`,
  );
  return response.data;
}

export async function createWorkspaceCalendarEvent(
  workspaceId: string,
  payload: CalendarEventPayload,
) {
  const response = await apiClient.request<CalendarItem>(
    `/workspaces/${workspaceId}/calendar/events`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
  return response.data;
}

export async function updateWorkspaceCalendarEvent(
  workspaceId: string,
  eventId: string,
  payload: Partial<CalendarEventPayload>,
) {
  const response = await apiClient.request<CalendarItem>(
    `/workspaces/${workspaceId}/calendar/events/${eventId}`,
    { method: 'PATCH', body: JSON.stringify(payload) },
  );
  return response.data;
}

export async function cancelWorkspaceCalendarEvent(workspaceId: string, eventId: string) {
  const response = await apiClient.request<CalendarItem>(
    `/workspaces/${workspaceId}/calendar/events/${eventId}/cancel`,
    { method: 'POST' },
  );
  return response.data;
}

function calendarQueryString(params: CalendarQueryParams) {
  const search = new URLSearchParams();
  search.set('from', params.from);
  search.set('to', params.to);
  appendArray(search, 'sourceTypes', params.sourceTypes);
  appendArray(search, 'memberIds', params.memberIds);
  appendArray(search, 'departmentIds', params.departmentIds);
  appendArray(search, 'priorities', params.priorities);
  appendArray(search, 'statuses', params.statuses);
  return search.toString();
}

function appendArray(search: URLSearchParams, key: string, values?: string[]) {
  values?.forEach((value) => search.append(key, value));
}
