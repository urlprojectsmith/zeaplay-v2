import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import {
  dateKeyInZone,
  formToStartIso,
  itemsForDate,
} from '../components/workspace/calendar/WorkspaceCalendarPage';
import { invalidateRealtimeQueries, type RealtimeEventEnvelope } from '../services/realtime';
import { calendarKeys, type CalendarItem } from '../services/workspace-calendar';

describe('Phase 12.4 shared calendar client', () => {
  it('scopes calendar query keys by workspace, view, date, and filters', () => {
    const params = {
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-02-01T00:00:00.000Z',
      sourceTypes: ['TASK' as const],
      memberIds: ['member-1'],
    };
    expect(calendarKeys.range('workspace-1', 'month', '2026-01-01', params)).toEqual([
      'workspace',
      'workspace-1',
      'calendar',
      'month',
      '2026-01-01',
      params,
    ]);
  });

  it('invalidates shared calendar cache for source and custom calendar realtime events', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    invalidateRealtimeQueries(queryClient, event('TASK_UPDATED'), 'member-1');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: calendarKeys.all('workspace-1') });

    invalidate.mockClear();
    invalidateRealtimeQueries(queryClient, event('PROJECT_UPDATED'), 'member-1');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: calendarKeys.all('workspace-1') });

    invalidate.mockClear();
    invalidateRealtimeQueries(queryClient, event('TICKET_STATUS_CHANGED'), 'member-1');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: calendarKeys.all('workspace-1') });

    invalidate.mockClear();
    invalidateRealtimeQueries(queryClient, event('CALENDAR_EVENT_CANCELLED'), 'member-1');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: calendarKeys.all('workspace-1') });
  });

  it('keeps all-day events date-stable in the workspace timezone', () => {
    const startAt = formToStartIso(
      {
        title: 'All day',
        description: '',
        date: '2026-01-05',
        start: '09:00',
        endDate: '2026-01-05',
        end: '10:00',
        allDay: true,
        visibility: 'WORKSPACE',
        participantMembershipIds: [],
      },
      'America/New_York',
    );
    expect(dateKeyInZone(startAt, 'America/New_York')).toBe('2026-01-05');
  });

  it('shows range items on interior days and sorts all-day items first', () => {
    const timed = calendarItem({
      id: 'PROJECT:1',
      sourceType: 'PROJECT',
      startAt: '2026-01-04T09:00:00.000Z',
      endAt: '2026-01-08T17:00:00.000Z',
      title: 'Project range',
    });
    const allDay = calendarItem({
      id: 'CUSTOM_EVENT:1',
      sourceType: 'CUSTOM_EVENT',
      startAt: '2026-01-06T05:00:00.000Z',
      allDay: true,
      title: 'All day',
    });

    expect(itemsForDate([timed, allDay], '2026-01-06', 'UTC').map((item) => item.id)).toEqual([
      'CUSTOM_EVENT:1',
      'PROJECT:1',
    ]);
  });
});

function event(eventType: RealtimeEventEnvelope['eventType']): RealtimeEventEnvelope {
  return {
    schemaVersion: 1,
    eventId: crypto.randomUUID(),
    eventType,
    workspaceId: 'workspace-1',
    occurredAt: new Date().toISOString(),
    payload: {},
  };
}

function calendarItem(overrides: Partial<CalendarItem>): CalendarItem {
  return {
    id: 'TASK:1',
    sourceType: 'TASK',
    sourceId: '1',
    title: 'Item',
    startAt: '2026-01-05T10:00:00.000Z',
    endAt: null,
    allDay: false,
    status: null,
    priority: null,
    departmentId: null,
    participantMembershipIds: [],
    visibility: 'SOURCE',
    editable: false,
    metadata: {},
    ...overrides,
  };
}
