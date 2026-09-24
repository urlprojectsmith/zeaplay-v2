import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getSharedRealtimeSocket,
  invalidateRealtimeQueries,
  REALTIME_SUBSCRIBE_WORKSPACE,
  resetSharedRealtimeSocket,
  subscribeWorkspace,
  unsubscribeWorkspace,
  type RealtimeEventEnvelope,
} from '../services/realtime';
import { automationKeys } from '../services/workspace-automations';
import { gamificationKeys } from '../services/workspace-gamification';
import { notificationsKeys } from '../services/workspace-notifications';
import { projectKeys } from '../services/workspace-projects';
import { taskKeys } from '../services/workspace-tasks';
import { ticketKeys } from '../services/workspace-tickets';

const socket = {
  auth: {},
  emit: vi.fn(),
  disconnect: vi.fn(),
};

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => socket),
}));

describe('Phase 12.2 realtime client', () => {
  beforeEach(() => {
    socket.emit.mockClear();
    socket.disconnect.mockClear();
  });

  it('reuses one shared socket and subscribes with explicit workspace protocol', async () => {
    const { io } = await import('socket.io-client');
    resetSharedRealtimeSocket();
    const first = getSharedRealtimeSocket('token-1');
    const second = getSharedRealtimeSocket('token-2');
    expect(first).toBe(second);
    expect(io).toHaveBeenCalledTimes(1);
    expect(second.auth).toEqual({ token: 'token-2' });
    expect(io).toHaveBeenCalledWith(
      'http://localhost:4000/realtime',
      expect.objectContaining({
        auth: { token: 'token-1' },
        reconnectionDelay: 500,
        reconnectionDelayMax: 5000,
      }),
    );
    expect((vi.mocked(io).mock.calls[0]?.[1] as { query?: unknown }).query).toBeUndefined();

    subscribeWorkspace(second, 'workspace-1');
    expect(socket.emit).toHaveBeenCalledWith(REALTIME_SUBSCRIBE_WORKSPACE, {
      workspaceId: 'workspace-1',
    });
    unsubscribeWorkspace(second);
    expect(socket.emit).toHaveBeenCalledWith('realtime:unsubscribe-workspace', {});
  });

  it('targets notification and domain query invalidation without a second state authority', () => {
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    invalidateRealtimeQueries(queryClient, event('NOTIFICATION_CREATED'), 'member-1');
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: notificationsKeys.all('workspace-1', 'member-1'),
    });

    invalidate.mockClear();
    invalidateRealtimeQueries(queryClient, event('TASK_STATUS_CHANGED'), 'member-1');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: taskKeys.all('workspace-1') });

    invalidate.mockClear();
    invalidateRealtimeQueries(queryClient, event('PROJECT_UPDATED'), 'member-1');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: projectKeys.all('workspace-1') });

    invalidate.mockClear();
    invalidateRealtimeQueries(queryClient, event('TICKET_RESOLVED'), 'member-1');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ticketKeys.all('workspace-1') });

    invalidate.mockClear();
    invalidateRealtimeQueries(
      queryClient,
      { ...event('AUTOMATION_EXECUTION_STATUS_CHANGED'), entityId: 'execution-1' },
      'member-1',
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: automationKeys.executions('workspace-1', 1),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: automationKeys.executionDetail('workspace-1', 'execution-1'),
    });

    invalidate.mockClear();
    invalidateRealtimeQueries(queryClient, event('GAMIFICATION_LEADERBOARD_CHANGED'), 'member-1');
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: gamificationKeys.workspaceLeaderboard('workspace-1'),
    });
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
