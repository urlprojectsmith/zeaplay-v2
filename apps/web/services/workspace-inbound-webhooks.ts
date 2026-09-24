import { apiClient } from './api';

export interface WorkspaceInboundWebhookSource {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  publicIdentifier: string;
  endpointUrl: string;
  type: 'GENERIC_HMAC_V1';
  status: 'ACTIVE' | 'DISABLED';
  lastReceivedAt: string | null;
  lastVerifiedAt: string | null;
  lastFailureAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceInboundWebhookCreateResult extends WorkspaceInboundWebhookSource {
  plaintextSecret: string;
}

export interface WorkspaceInboundWebhookEvent {
  id: string;
  workspaceId: string;
  sourceId: string;
  externalEventId: string;
  eventType: string | null;
  eventVersion: string | null;
  status: 'VERIFIED' | 'NORMALIZED' | 'FAILED_NORMALIZATION';
  normalizedType: string | null;
  receivedAt: string;
  verifiedAt: string;
  normalizedAt: string | null;
  safeErrorCode: string | null;
  correlationId: string | null;
  createdAt: string;
}

export async function listWorkspaceInboundWebhooks(workspaceId: string) {
  const response = await apiClient.request<{
    items: WorkspaceInboundWebhookSource[];
    total: number;
  }>(`/workspaces/${workspaceId}/inbound-webhooks`);
  return response.data;
}

export async function createWorkspaceInboundWebhook(
  workspaceId: string,
  input: { name: string; description?: string; type: 'GENERIC_HMAC_V1' },
) {
  const response = await apiClient.request<WorkspaceInboundWebhookCreateResult>(
    `/workspaces/${workspaceId}/inbound-webhooks`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return response.data;
}

export async function rotateWorkspaceInboundWebhookSecret(workspaceId: string, sourceId: string) {
  const response = await apiClient.request<WorkspaceInboundWebhookCreateResult>(
    `/workspaces/${workspaceId}/inbound-webhooks/${sourceId}/rotate-secret`,
    { method: 'POST' },
  );
  return response.data;
}

export async function disableWorkspaceInboundWebhook(workspaceId: string, sourceId: string) {
  const response = await apiClient.request<WorkspaceInboundWebhookSource>(
    `/workspaces/${workspaceId}/inbound-webhooks/${sourceId}/disable`,
    { method: 'POST' },
  );
  return response.data;
}

export async function listWorkspaceInboundWebhookEvents(workspaceId: string, sourceId: string) {
  const response = await apiClient.request<{
    items: WorkspaceInboundWebhookEvent[];
    total: number;
  }>(`/workspaces/${workspaceId}/inbound-webhooks/${sourceId}/events`);
  return response.data;
}

export const workspaceInboundWebhookKeys = {
  list: (workspaceId: string | null) => ['workspace', workspaceId, 'inbound-webhooks'] as const,
  events: (workspaceId: string | null, sourceId: string | null) =>
    ['workspace', workspaceId, 'inbound-webhooks', sourceId, 'events'] as const,
};
