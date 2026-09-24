export const REALTIME_CLIENT_EVENT = 'realtime:event';
export const REALTIME_SUBSCRIBE_WORKSPACE = 'realtime:subscribe-workspace';
export const REALTIME_UNSUBSCRIBE_WORKSPACE = 'realtime:unsubscribe-workspace';

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

export type RealtimeEntityType =
  | 'NOTIFICATION'
  | 'TASK'
  | 'PROJECT'
  | 'TICKET'
  | 'AUTOMATION_EXECUTION'
  | 'AUTOMATION_WORKFLOW'
  | 'GAMIFICATION'
  | 'CALENDAR';

export interface RealtimeEventEnvelope {
  schemaVersion: 1;
  eventId: string;
  eventType: RealtimeEventType;
  workspaceId: string;
  occurredAt: string;
  entityType?: RealtimeEntityType;
  entityId?: string | null;
  actorMembershipId?: string | null;
  payload: Record<string, unknown>;
}

export interface RealtimeSocketData {
  user?: { id: string; email: string };
  authToken?: string;
  workspaceId?: string;
  membershipId?: string;
  rooms?: string[];
  rate?: { windowStartedAt: number; count: number };
}
