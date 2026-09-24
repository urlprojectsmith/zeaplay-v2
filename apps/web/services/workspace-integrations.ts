import { apiClient } from './api';

export type IntegrationProvider = 'GOHIGHLEVEL' | 'SLACK' | 'WEBEX' | 'GENERIC_REST';
export type IntegrationAuthType = 'OAUTH' | 'BEARER_TOKEN' | 'API_KEY' | 'BASIC_AUTH';
export type IntegrationStatus =
  'CONNECTED' | 'DISCONNECTED' | 'REAUTH_REQUIRED' | 'ERROR' | 'DISABLED';

export interface WorkspaceIntegrationProvider {
  provider: IntegrationProvider;
  label: string;
  configured: boolean;
  authTypes: IntegrationAuthType[];
  capabilities: string[];
  supportsOAuth: boolean;
}

export interface WorkspaceIntegration {
  id: string;
  workspaceId: string;
  provider: IntegrationProvider;
  name: string;
  status: IntegrationStatus;
  authType: IntegrationAuthType;
  providerAccountId: string | null;
  providerAccountLabel: string | null;
  scopes: string[];
  capabilities: string[];
  configuration: Record<string, unknown>;
  lastValidatedAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  safeErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
  hasCredentials: boolean;
}

export async function listWorkspaceIntegrationProviders(workspaceId: string) {
  const response = await apiClient.request<WorkspaceIntegrationProvider[]>(
    `/workspaces/${workspaceId}/integrations/providers`,
  );
  return response.data;
}

export async function listWorkspaceIntegrations(workspaceId: string) {
  const response = await apiClient.request<WorkspaceIntegration[]>(
    `/workspaces/${workspaceId}/integrations`,
  );
  return response.data;
}

export async function createWorkspaceIntegration(
  workspaceId: string,
  input: {
    provider: IntegrationProvider;
    name: string;
    authType: IntegrationAuthType;
    credentials: Record<string, unknown>;
    configuration?: Record<string, unknown>;
  },
) {
  const response = await apiClient.request<WorkspaceIntegration>(
    `/workspaces/${workspaceId}/integrations`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return response.data;
}

export async function disconnectWorkspaceIntegration(workspaceId: string, integrationId: string) {
  const response = await apiClient.request<WorkspaceIntegration>(
    `/workspaces/${workspaceId}/integrations/${integrationId}/disconnect`,
    { method: 'POST' },
  );
  return response.data;
}

export async function testWorkspaceIntegration(workspaceId: string, integrationId: string) {
  const response = await apiClient.request<{ ok: boolean; durationMs: number }>(
    `/workspaces/${workspaceId}/integrations/${integrationId}/test`,
    { method: 'POST' },
  );
  return response.data;
}

export async function executeWorkspaceIntegrationAction(
  workspaceId: string,
  integrationId: string,
  capability: string,
  input: Record<string, unknown>,
) {
  const response = await apiClient.request<{
    executionId: string;
    status: string;
    provider: IntegrationProvider;
    capability: string;
    summary: Record<string, unknown>;
    data?: unknown;
  }>(`/workspaces/${workspaceId}/integrations/${integrationId}/actions/${capability}`, {
    method: 'POST',
    body: JSON.stringify({ input }),
  });
  return response.data;
}

export const workspaceIntegrationKeys = {
  providers: (workspaceId: string | null) =>
    ['workspace', workspaceId, 'integrations', 'providers'] as const,
  list: (workspaceId: string | null) => ['workspace', workspaceId, 'integrations'] as const,
};
