import { apiClient } from './api';

export type CloudDriveProvider = 'GOOGLE_DRIVE' | 'ONEDRIVE' | 'DROPBOX';
export type CloudConnectionStatus =
  'CONNECTED' | 'EXPIRED' | 'REAUTH_REQUIRED' | 'REVOKED' | 'ERROR';

export interface CloudProviderStatus {
  provider: CloudDriveProvider;
  configured: boolean;
  available: boolean;
  status: 'AVAILABLE' | 'NOT_CONFIGURED' | 'UNAVAILABLE';
  capabilities: Record<string, boolean>;
}

export interface CloudDriveConnection {
  id: string;
  workspaceId: string;
  provider: CloudDriveProvider;
  displayName: string | null;
  status: CloudConnectionStatus;
  providerAccountLabel: string | null;
  tokenExpiresAt: string | null;
  lastValidatedAt: string | null;
  revokedAt: string | null;
}

export interface CloudDriveFile {
  connectionId: string;
  providerFileId: string;
  name: string;
  mimeType: string | null;
  sizeBytes: number | null;
  isFolder: boolean;
  modifiedAt: string | null;
  parentId: string | null;
  providerWebUrl: string | null;
  downloadable: boolean;
}

export async function getCloudProviders(workspaceId: string) {
  const response = await apiClient.request<CloudProviderStatus[]>(
    `/workspaces/${workspaceId}/cloud-drives/providers`,
  );
  return response.data;
}

export async function getCloudConnections(workspaceId: string) {
  const response = await apiClient.request<CloudDriveConnection[]>(
    `/workspaces/${workspaceId}/cloud-drives/connections`,
  );
  return response.data;
}

export async function startCloudConnection(workspaceId: string, provider: CloudDriveProvider) {
  const response = await apiClient.request<{
    provider: CloudDriveProvider;
    authorizationUrl: string;
  }>(`/workspaces/${workspaceId}/cloud-drives/${provider}/connect`, {
    method: 'POST',
    body: JSON.stringify({ redirectPath: '/workspace/settings' }),
  });
  return response.data;
}

export async function disconnectCloudConnection(workspaceId: string, connectionId: string) {
  const response = await apiClient.request<CloudDriveConnection>(
    `/workspaces/${workspaceId}/cloud-drives/connections/${connectionId}/disconnect`,
    { method: 'POST' },
  );
  return response.data;
}

export async function listCloudDriveFiles(
  workspaceId: string,
  connectionId: string,
  params: { folderId?: string | null; cursor?: string | null; pageSize?: number },
) {
  const query = new URLSearchParams();
  if (params.folderId) query.set('folderId', params.folderId);
  if (params.cursor) query.set('cursor', params.cursor);
  query.set('pageSize', String(Math.min(Math.max(params.pageSize ?? 50, 1), 100)));
  const response = await apiClient.request<{ items: CloudDriveFile[]; nextCursor: string | null }>(
    `/workspaces/${workspaceId}/cloud-drives/connections/${connectionId}/files?${query.toString()}`,
  );
  return response.data;
}

export async function importCloudDriveFile(
  workspaceId: string,
  connectionId: string,
  input: { providerFileId: string; idempotencyKey?: string },
) {
  const response = await apiClient.request(
    `/workspaces/${workspaceId}/cloud-drives/connections/${connectionId}/import`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return response.data;
}

export async function exportWorkspaceFileToCloud(
  workspaceId: string,
  connectionId: string,
  input: { assetId: string; destinationFolderId?: string | null; filename?: string },
) {
  const response = await apiClient.request(
    `/workspaces/${workspaceId}/cloud-drives/connections/${connectionId}/export`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return response.data;
}

export const cloudDriveKeys = {
  providers: (workspaceId: string | null) => [
    'workspace',
    workspaceId,
    'cloud-drives',
    'providers',
  ],
  connections: (workspaceId: string | null) => [
    'workspace',
    workspaceId,
    'cloud-drives',
    'connections',
  ],
  files: (
    workspaceId: string | null,
    connectionId: string | null,
    folderId: string | null,
    cursor: string | null,
  ) => ['workspace', workspaceId, 'cloud-drives', 'files', connectionId, folderId, cursor],
};
