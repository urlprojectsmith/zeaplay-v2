import { apiClient } from './api';

export type FileLifecycle = 'ACTIVE' | 'ARCHIVED' | 'PENDING_DELETE' | 'PURGING' | 'PURGED';
export type FileStatus = 'UPLOADING' | 'UPLOADED' | 'PROCESSING' | 'READY' | 'FAILED' | 'DELETED';
export type FileSourceModule = 'GENERAL' | 'TASK' | 'PROJECT' | 'TICKET';
export type FileCategory = 'IMAGE' | 'PDF' | 'DOCUMENT' | 'SPREADSHEET' | 'ARCHIVE' | 'OTHER';
export type FileSort = 'NEWEST' | 'OLDEST' | 'NAME_ASC' | 'NAME_DESC' | 'SIZE_ASC' | 'SIZE_DESC';
export type BulkFileAction = 'ARCHIVE' | 'DELETE' | 'RESTORE';

export interface WorkspaceFile {
  id: string;
  workspaceId: string;
  projectId: string | null;
  createdById: string;
  uploadedByMembershipId: string | null;
  originalFilename: string;
  displayName: string;
  mimeType: string;
  extension: string | null;
  sizeBytes: number;
  checksum: string | null;
  status: FileStatus;
  lifecycle: FileLifecycle;
  sourceModule: string | null;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  sourceProvider?: string | null;
  sourceConnectionId?: string | null;
  sourceProviderFileId?: string | null;
  uploadedByMembership?: {
    id: string;
    user: { id: string; name: string | null; email: string };
  } | null;
  archivedAt: string | null;
  pendingDeleteAt: string | null;
  deleteRequestedAt: string | null;
  purgeAfter: string | null;
  purgingStartedAt: string | null;
  purgedAt: string | null;
  purgeFailureCode: string | null;
  purgeFailureAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FileListParams {
  lifecycle?: FileLifecycle;
  search?: string;
  sourceModule?: FileSourceModule | '';
  category?: FileCategory | '';
  uploader?: string;
  createdFrom?: string;
  createdTo?: string;
  sort?: FileSort;
  page?: number;
  pageSize?: number;
}

export interface StorageUsage {
  usedBytes: number;
  reservedBytes: number;
  quotaBytes: number;
  availableBytes: number;
  usagePercent: number;
}

export interface UploadReservation {
  file: WorkspaceFile;
  uploadUrl: string;
  expiresAt: string;
}

export const workspaceFileKeys = {
  all: (workspaceId: string | null) => ['workspace', workspaceId, 'files'],
  list: (workspaceId: string | null, params: FileListParams) => [
    'workspace',
    workspaceId,
    'files',
    'list',
    params,
  ],
  usage: (workspaceId: string | null) => ['workspace', workspaceId, 'files', 'usage'],
};

export async function listWorkspaceFiles(workspaceId: string, params: FileListParams) {
  const query = toSearchParams(params);
  const response = await apiClient.request<{
    items: WorkspaceFile[];
    page: number;
    pageSize: number;
    total: number;
  }>(`/workspaces/${workspaceId}/files${query}`);
  return response.data;
}

export async function getWorkspaceStorageUsage(workspaceId: string) {
  const response = await apiClient.request<StorageUsage>(
    `/workspaces/${workspaceId}/storage/usage`,
  );
  return response.data;
}

export async function initWorkspaceFileUpload(
  workspaceId: string,
  input: {
    filename: string;
    displayName?: string;
    mimeType: string;
    sizeBytes: number;
    sourceModule?: FileSourceModule;
  },
) {
  const response = await apiClient.request<UploadReservation>(
    `/workspaces/${workspaceId}/files/uploads`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
  return response.data;
}

export async function completeWorkspaceFileUpload(
  workspaceId: string,
  fileId: string,
  input: { sizeBytes: number; checksum?: string },
) {
  const response = await apiClient.request<WorkspaceFile>(
    `/workspaces/${workspaceId}/files/${fileId}/complete`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
  return response.data;
}

export async function getWorkspaceFileDownloadUrl(workspaceId: string, fileId: string) {
  const response = await apiClient.request<{ downloadUrl: string; expiresInSeconds: number }>(
    `/workspaces/${workspaceId}/files/${fileId}/download-url`,
    { method: 'POST' },
  );
  return response.data;
}

export async function archiveWorkspaceFile(workspaceId: string, fileId: string) {
  const response = await apiClient.request<WorkspaceFile>(
    `/workspaces/${workspaceId}/files/${fileId}/archive`,
    { method: 'POST' },
  );
  return response.data;
}

export async function moveWorkspaceFileToRecentlyDeleted(workspaceId: string, fileId: string) {
  const response = await apiClient.request<WorkspaceFile>(
    `/workspaces/${workspaceId}/files/${fileId}/delete`,
    { method: 'POST' },
  );
  return response.data;
}

export async function restoreWorkspaceFile(workspaceId: string, fileId: string) {
  const response = await apiClient.request<WorkspaceFile>(
    `/workspaces/${workspaceId}/files/${fileId}/restore`,
    { method: 'POST' },
  );
  return response.data;
}

export async function bulkWorkspaceFileAction(
  workspaceId: string,
  action: BulkFileAction,
  fileIds: string[],
) {
  const response = await apiClient.request<{
    action: BulkFileAction;
    results: Array<{ fileId: string; ok: boolean; code?: string; file?: WorkspaceFile }>;
  }>(`/workspaces/${workspaceId}/files/bulk`, {
    method: 'POST',
    body: JSON.stringify({ action, fileIds }),
  });
  return response.data;
}

export function normalizeFileListParams(params: FileListParams): FileListParams {
  return {
    lifecycle: params.lifecycle ?? 'ACTIVE',
    search: params.search?.trim().slice(0, 150) || undefined,
    sourceModule: params.sourceModule || undefined,
    category: params.category || undefined,
    uploader: params.uploader || undefined,
    createdFrom: params.createdFrom || undefined,
    createdTo: params.createdTo || undefined,
    sort: params.sort ?? 'NEWEST',
    page: Math.max(1, params.page ?? 1),
    pageSize: Math.min(Math.max(1, params.pageSize ?? 25), 100),
  };
}

function toSearchParams(params: FileListParams) {
  const normalized = normalizeFileListParams(params);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(normalized)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  const serialized = query.toString();
  return serialized ? `?${serialized}` : '';
}
