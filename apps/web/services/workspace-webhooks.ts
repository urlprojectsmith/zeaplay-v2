import { apiClient } from './api';

export type WebhookEventType =
  | 'task.created'
  | 'task.status_changed'
  | 'task.completed'
  | 'project.created'
  | 'project.status_changed'
  | 'ticket.created'
  | 'ticket.status_changed'
  | 'ticket.resolved'
  | 'webhook.test';

export interface WorkspaceWebhook {
  id: string;
  name: string;
  description: string | null;
  endpointUrl: string;
  status: 'ACTIVE' | 'DISABLED';
  eventTypes: WebhookEventType[];
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  createdAt: string;
}

export interface WorkspaceWebhookCreateResult extends WorkspaceWebhook {
  plaintextSecret: string;
}

export interface WorkspaceWebhookDelivery {
  id: string;
  eventId: string;
  subscriptionId: string;
  status: 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'RETRY_SCHEDULED' | 'FAILED' | 'DEAD_LETTERED';
  attemptCount: number;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  deliveredAt: string | null;
  httpStatus: number | null;
  safeErrorCode: string | null;
  responseDurationMs: number | null;
  responseSnippet: string | null;
  createdAt: string;
  event: { id: string; eventType: WebhookEventType; eventVersion: number; createdAt: string };
}

export const webhookEventTypes: Array<{ value: WebhookEventType; labelKey: string }> = [
  { value: 'task.created', labelKey: 'taskCreated' },
  { value: 'task.status_changed', labelKey: 'taskStatusChanged' },
  { value: 'task.completed', labelKey: 'taskCompleted' },
  { value: 'project.created', labelKey: 'projectCreated' },
  { value: 'project.status_changed', labelKey: 'projectStatusChanged' },
  { value: 'ticket.created', labelKey: 'ticketCreated' },
  { value: 'ticket.status_changed', labelKey: 'ticketStatusChanged' },
  { value: 'ticket.resolved', labelKey: 'ticketResolved' },
  { value: 'webhook.test', labelKey: 'webhookTest' },
];

export async function listWorkspaceWebhooks(workspaceId: string) {
  const response = await apiClient.request<{ items: WorkspaceWebhook[]; total: number }>(
    `/workspaces/${workspaceId}/webhooks`,
  );
  return response.data;
}

export async function createWorkspaceWebhook(
  workspaceId: string,
  input: { name: string; endpointUrl: string; eventTypes: WebhookEventType[] },
) {
  const response = await apiClient.request<WorkspaceWebhookCreateResult>(
    `/workspaces/${workspaceId}/webhooks`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return response.data;
}

export async function disableWorkspaceWebhook(workspaceId: string, webhookId: string) {
  const response = await apiClient.request<WorkspaceWebhook>(
    `/workspaces/${workspaceId}/webhooks/${webhookId}/disable`,
    { method: 'POST' },
  );
  return response.data;
}

export async function rotateWorkspaceWebhookSecret(workspaceId: string, webhookId: string) {
  const response = await apiClient.request<WorkspaceWebhookCreateResult>(
    `/workspaces/${workspaceId}/webhooks/${webhookId}/rotate-secret`,
    { method: 'POST' },
  );
  return response.data;
}

export async function sendWorkspaceWebhookTest(workspaceId: string, webhookId: string) {
  const response = await apiClient.request<{ deliveryId: string }>(
    `/workspaces/${workspaceId}/webhooks/${webhookId}/test`,
    { method: 'POST' },
  );
  return response.data;
}

export async function listWorkspaceWebhookDeliveries(workspaceId: string, webhookId: string) {
  const response = await apiClient.request<{ items: WorkspaceWebhookDelivery[]; total: number }>(
    `/workspaces/${workspaceId}/webhooks/${webhookId}/deliveries`,
  );
  return response.data;
}

export async function retryWorkspaceWebhookDelivery(workspaceId: string, deliveryId: string) {
  const response = await apiClient.request<WorkspaceWebhookDelivery>(
    `/workspaces/${workspaceId}/webhook-deliveries/${deliveryId}/retry`,
    { method: 'POST' },
  );
  return response.data;
}

export const workspaceWebhookKeys = {
  list: (workspaceId: string | null) => ['workspace', workspaceId, 'webhooks'] as const,
  deliveries: (workspaceId: string | null, webhookId: string | null) =>
    ['workspace', workspaceId, 'webhooks', webhookId, 'deliveries'] as const,
};
