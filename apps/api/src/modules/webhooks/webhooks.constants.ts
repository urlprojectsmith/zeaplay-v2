export const WEBHOOK_ACTIVE_SUBSCRIPTION_LIMIT = 25;
export const WEBHOOK_EVENT_VERSION = 1;
export const WEBHOOK_SECRET_BYTES = 32;

export const WEBHOOK_EVENT_TYPES = [
  'task.created',
  'task.status_changed',
  'task.completed',
  'project.created',
  'project.status_changed',
  'ticket.created',
  'ticket.status_changed',
  'ticket.resolved',
  'webhook.test',
] as const;

export const WEBHOOK_EVENT_TYPE_SET = new Set<string>(WEBHOOK_EVENT_TYPES);

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];
