'use client';

import type { QueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { automationKeys } from './workspace-automations';
import { calendarKeys } from './workspace-calendar';
import { gamificationKeys } from './workspace-gamification';
import { notificationsKeys } from './workspace-notifications';
import { projectKeys } from './workspace-projects';
import { taskKeys } from './workspace-tasks';
import { ticketKeys } from './workspace-tickets';

export const REALTIME_CLIENT_EVENT = 'realtime:event';
export const REALTIME_SUBSCRIBE_WORKSPACE = 'realtime:subscribe-workspace';
export const REALTIME_UNSUBSCRIBE_WORKSPACE = 'realtime:unsubscribe-workspace';

export type RealtimeStatus = 'offline' | 'connecting' | 'connected' | 'reconnecting';

export type RealtimeEventType =
  | 'NOTIFICATION_CREATED'
  | 'NOTIFICATION_READ'
  | 'NOTIFICATION_UNREAD'
  | 'NOTIFICATIONS_READ_ALL'
  | 'NOTIFICATION_UNREAD_COUNT_CHANGED'
  | 'TASK_CREATED'
  | 'TASK_UPDATED'
  | 'TASK_ASSIGNED'
  | 'TASK_STATUS_CHANGED'
  | 'TASK_DELETED'
  | 'PROJECT_CREATED'
  | 'PROJECT_UPDATED'
  | 'PROJECT_STATUS_CHANGED'
  | 'PROJECT_DELETED'
  | 'TICKET_CREATED'
  | 'TICKET_UPDATED'
  | 'TICKET_ASSIGNED'
  | 'TICKET_STATUS_CHANGED'
  | 'TICKET_RESOLVED'
  | 'AUTOMATION_EXECUTION_CREATED'
  | 'AUTOMATION_EXECUTION_STATUS_CHANGED'
  | 'AUTOMATION_DEAD_LETTERED'
  | 'AUTOMATION_WORKFLOW_UPDATED'
  | 'GAMIFICATION_XP_CHANGED'
  | 'GAMIFICATION_REWARD_POINTS_CHANGED'
  | 'GAMIFICATION_ACHIEVEMENT_EARNED'
  | 'GAMIFICATION_STREAK_CHANGED'
  | 'GAMIFICATION_LEADERBOARD_CHANGED'
  | 'CALENDAR_EVENT_CREATED'
  | 'CALENDAR_EVENT_UPDATED'
  | 'CALENDAR_EVENT_CANCELLED';

export interface RealtimeEventEnvelope {
  schemaVersion: 1;
  eventId: string;
  eventType: RealtimeEventType;
  workspaceId: string;
  occurredAt: string;
  entityType?: string;
  entityId?: string | null;
  actorMembershipId?: string | null;
  payload: Record<string, unknown>;
}

let sharedSocket: Socket | null = null;

export function getSharedRealtimeSocket(accessToken: string) {
  if (!sharedSocket) {
    sharedSocket = io(realtimeBaseUrl(), {
      path: '/socket.io',
      auth: { token: accessToken },
      transports: ['websocket'],
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
    });
  } else {
    sharedSocket.auth = { token: accessToken };
  }
  return sharedSocket;
}

export function resetSharedRealtimeSocket() {
  sharedSocket?.disconnect();
  sharedSocket = null;
}

export function subscribeWorkspace(socket: Socket, workspaceId: string) {
  socket.emit(REALTIME_SUBSCRIBE_WORKSPACE, { workspaceId });
}

export function unsubscribeWorkspace(socket: Socket) {
  socket.emit(REALTIME_UNSUBSCRIBE_WORKSPACE, {});
}

export function invalidateRealtimeQueries(
  queryClient: QueryClient,
  event: RealtimeEventEnvelope,
  membershipId: string | null,
) {
  const workspaceId = event.workspaceId;
  if (event.eventType.startsWith('NOTIFICATION_') || event.eventType === 'NOTIFICATIONS_READ_ALL') {
    void queryClient.invalidateQueries({
      queryKey: notificationsKeys.all(workspaceId, membershipId),
    });
    return;
  }
  if (event.eventType.startsWith('TASK_')) {
    void queryClient.invalidateQueries({ queryKey: taskKeys.all(workspaceId) });
    void queryClient.invalidateQueries({ queryKey: calendarKeys.all(workspaceId) });
    return;
  }
  if (event.eventType.startsWith('PROJECT_')) {
    void queryClient.invalidateQueries({ queryKey: projectKeys.all(workspaceId) });
    void queryClient.invalidateQueries({ queryKey: calendarKeys.all(workspaceId) });
    return;
  }
  if (event.eventType.startsWith('TICKET_')) {
    void queryClient.invalidateQueries({ queryKey: ticketKeys.all(workspaceId) });
    void queryClient.invalidateQueries({ queryKey: calendarKeys.all(workspaceId) });
    return;
  }
  if (event.eventType.startsWith('CALENDAR_EVENT_')) {
    void queryClient.invalidateQueries({ queryKey: calendarKeys.all(workspaceId) });
    return;
  }
  if (
    event.eventType.startsWith('AUTOMATION_EXECUTION_') ||
    event.eventType === 'AUTOMATION_DEAD_LETTERED'
  ) {
    void queryClient.invalidateQueries({ queryKey: automationKeys.executions(workspaceId, 1) });
    void queryClient.invalidateQueries({ queryKey: automationKeys.health(workspaceId) });
    if (event.entityId) {
      void queryClient.invalidateQueries({
        queryKey: automationKeys.executionDetail(workspaceId, event.entityId),
      });
    }
    return;
  }
  if (event.eventType === 'AUTOMATION_WORKFLOW_UPDATED') {
    void queryClient.invalidateQueries({ queryKey: automationKeys.all(workspaceId) });
    return;
  }
  if (event.eventType === 'GAMIFICATION_XP_CHANGED') {
    void queryClient.invalidateQueries({ queryKey: gamificationKeys.summary(workspaceId) });
    void queryClient.invalidateQueries({ queryKey: gamificationKeys.all(workspaceId) });
    return;
  }
  if (event.eventType === 'GAMIFICATION_REWARD_POINTS_CHANGED') {
    void queryClient.invalidateQueries({
      queryKey: gamificationKeys.rewardPointSummary(workspaceId),
    });
    void queryClient.invalidateQueries({ queryKey: gamificationKeys.all(workspaceId) });
    return;
  }
  if (event.eventType === 'GAMIFICATION_ACHIEVEMENT_EARNED') {
    void queryClient.invalidateQueries({
      queryKey: gamificationKeys.achievements(workspaceId, false),
    });
    void queryClient.invalidateQueries({ queryKey: gamificationKeys.summary(workspaceId) });
    return;
  }
  if (event.eventType === 'GAMIFICATION_STREAK_CHANGED') {
    void queryClient.invalidateQueries({ queryKey: gamificationKeys.streakSummary(workspaceId) });
    return;
  }
  if (event.eventType === 'GAMIFICATION_LEADERBOARD_CHANGED') {
    void queryClient.invalidateQueries({
      queryKey: gamificationKeys.workspaceLeaderboard(workspaceId),
    });
    void queryClient.invalidateQueries({
      queryKey: gamificationKeys.myDepartmentLeaderboard(workspaceId),
    });
  }
}

function realtimeBaseUrl() {
  const raw = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
  return raw.replace(/\/api\/v1\/?$/, '') + '/realtime';
}
