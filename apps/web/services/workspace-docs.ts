import { apiClient } from './api';
import { superAgencyHeaders } from './super-agencies';

export type DocVisibility = 'PRIVATE' | 'SELECTED_MEMBERS' | 'WORKSPACE';
export type DocStatus = 'ACTIVE' | 'ARCHIVED';
export type DocType = 'PAGE' | 'TEMPLATE';
const AGENCY_HEADER = 'x-agency-id';

export interface WorkspaceDoc {
  id: string;
  workspaceId: string;
  folderId: string | null;
  parentDocId: string | null;
  title: string;
  content?: Record<string, unknown>;
  contentRevision: number;
  visibility: DocVisibility;
  type: DocType;
  status: DocStatus;
  sortOrder: number;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: { comments: number; attachments: number };
  attachments?: Array<{
    id: string;
    asset: {
      id: string;
      displayName: string;
      mimeType: string;
      sizeBytes: number;
      status: string;
      lifecycle: string;
    };
  }>;
  shares?: Array<{
    id: string;
    status: string;
    expiresAt: string | null;
    revokedAt: string | null;
    lastAccessedAt: string | null;
    createdAt: string;
  }>;
}

export interface DocFolder {
  id: string;
  workspaceId: string;
  parentFolderId: string | null;
  name: string;
  sortOrder: number;
}

export interface DocComment {
  id: string;
  docId: string;
  parentCommentId: string | null;
  body: string;
  status: string;
  createdAt: string;
  createdByMembership: {
    id: string;
    user: { id: string; name: string | null; email: string };
  };
}

export interface DocListParams {
  search?: string;
  status?: DocStatus;
  type?: DocType;
  page?: number;
  pageSize?: number;
}

export interface ParentDoc {
  id: string;
  workspaceId: string;
  title: string;
  content: Record<string, unknown>;
  contentRevision: number;
  type: DocType;
  visibility: DocVisibility;
  status: DocStatus;
  updatedAt: string;
  createdByMembership?: {
    id: string;
    user: { id: string; name: string | null; email: string };
  } | null;
  workspace: {
    id: string;
    name: string;
    slug: string;
    agency: { id: string; name: string; slug: string; superAgencyId: string };
  };
  _count?: { attachments?: number };
}

export interface ParentDocListParams {
  search?: string;
  type?: DocType;
  agencyId?: string;
  workspaceId?: string;
  page?: number;
  pageSize?: number;
}

export const workspaceDocKeys = {
  all: (workspaceId: string | null) => ['workspace', workspaceId, 'docs'],
  list: (workspaceId: string | null, params: DocListParams) => [
    'workspace',
    workspaceId,
    'docs',
    'list',
    params,
  ],
  detail: (workspaceId: string | null, docId: string | null) => [
    'workspace',
    workspaceId,
    'docs',
    docId,
  ],
  folders: (workspaceId: string | null) => ['workspace', workspaceId, 'docs', 'folders'],
  comments: (workspaceId: string | null, docId: string | null) => [
    'workspace',
    workspaceId,
    'docs',
    docId,
    'comments',
  ],
};

export const parentDocKeys = {
  agency: (agencyId: string | null, params: ParentDocListParams) =>
    ['agency', agencyId, 'docs', normalizeParentParams(params)] as const,
  superAgency: (superAgencyId: string | null, params: ParentDocListParams) =>
    ['super-agency', superAgencyId, 'docs', normalizeParentParams(params)] as const,
};

export async function listWorkspaceDocs(workspaceId: string, params: DocListParams) {
  const response = await apiClient.request<{
    items: WorkspaceDoc[];
    total: number;
    page: number;
    pageSize: number;
  }>(`/workspaces/${workspaceId}/docs${toSearchParams(params)}`);
  return response.data;
}

export async function listDocFolders(workspaceId: string) {
  const response = await apiClient.request<DocFolder[]>(`/workspaces/${workspaceId}/docs/folders`);
  return response.data;
}

export async function createDocFolder(workspaceId: string, input: { name: string }) {
  const response = await apiClient.request<DocFolder>(`/workspaces/${workspaceId}/docs/folders`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return response.data;
}

export async function createWorkspaceDoc(
  workspaceId: string,
  input: {
    title: string;
    content: Record<string, unknown>;
    visibility: DocVisibility;
    type?: DocType;
    folderId?: string | null;
  },
) {
  const response = await apiClient.request<WorkspaceDoc>(`/workspaces/${workspaceId}/docs`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return response.data;
}

export async function getWorkspaceDoc(workspaceId: string, docId: string) {
  const response = await apiClient.request<WorkspaceDoc>(
    `/workspaces/${workspaceId}/docs/${docId}`,
  );
  return response.data;
}

export async function updateWorkspaceDoc(
  workspaceId: string,
  docId: string,
  input: {
    expectedRevision: number;
    title?: string;
    content?: Record<string, unknown>;
    visibility?: DocVisibility;
    folderId?: string | null;
  },
) {
  const response = await apiClient.request<WorkspaceDoc>(
    `/workspaces/${workspaceId}/docs/${docId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
  );
  return response.data;
}

export async function setDocFavorite(workspaceId: string, docId: string, favorite: boolean) {
  const response = await apiClient.request<{ favorite: boolean }>(
    `/workspaces/${workspaceId}/docs/${docId}/favorite`,
    { method: 'POST', body: JSON.stringify({ favorite }) },
  );
  return response.data;
}

export async function archiveWorkspaceDoc(workspaceId: string, docId: string) {
  const response = await apiClient.request<WorkspaceDoc>(
    `/workspaces/${workspaceId}/docs/${docId}/archive`,
    { method: 'POST' },
  );
  return response.data;
}

export async function restoreWorkspaceDoc(workspaceId: string, docId: string) {
  const response = await apiClient.request<WorkspaceDoc>(
    `/workspaces/${workspaceId}/docs/${docId}/restore`,
    { method: 'POST' },
  );
  return response.data;
}

export async function createDocShare(
  workspaceId: string,
  docId: string,
  input: { expiresAt?: string | null; password?: string | null },
) {
  const response = await apiClient.request<{ id: string; token: string; url: string }>(
    `/workspaces/${workspaceId}/docs/${docId}/shares`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return response.data;
}

export async function listDocComments(workspaceId: string, docId: string) {
  const response = await apiClient.request<DocComment[]>(
    `/workspaces/${workspaceId}/docs/${docId}/comments`,
  );
  return response.data;
}

export async function createDocComment(workspaceId: string, docId: string, body: string) {
  const response = await apiClient.request<DocComment>(
    `/workspaces/${workspaceId}/docs/${docId}/comments`,
    { method: 'POST', body: JSON.stringify({ body }) },
  );
  return response.data;
}

export async function getPublicDocShare(token: string, access?: string) {
  const query = access ? `?access=${encodeURIComponent(access)}` : '';
  const response = await apiClient.request<{
    id: string;
    title: string;
    content: Record<string, unknown>;
    contentRevision: number;
    updatedAt: string;
    attachments: Array<{
      id: string;
      asset: { id: string; displayName: string; mimeType: string; sizeBytes: number };
    }>;
  }>(`/docs/share/${token}${query}`, { skipTenantContext: true });
  return response.data;
}

export async function verifyPublicDocSharePassword(token: string, password: string) {
  const response = await apiClient.request<{ access: string }>(`/docs/share/${token}/password`, {
    method: 'POST',
    body: JSON.stringify({ password }),
    skipTenantContext: true,
  });
  return response.data;
}

export async function listAgencyParentDocs(agencyId: string, params: ParentDocListParams) {
  const response = await apiClient.request<{
    items: ParentDoc[];
    total: number;
    page: number;
    pageSize: number;
  }>(`/agencies/${agencyId}/parent/docs${toParentSearchParams(params)}`, {
    headers: agencyHeaders(agencyId),
    skipTenantContext: true,
  });
  return response.data;
}

export async function listSuperAgencyParentDocs(
  superAgencyId: string,
  params: ParentDocListParams,
) {
  const response = await apiClient.request<{
    items: ParentDoc[];
    total: number;
    page: number;
    pageSize: number;
  }>(`/super-agencies/${superAgencyId}/parent/docs${toParentSearchParams(params)}`, {
    headers: superAgencyHeaders(superAgencyId),
    skipTenantContext: true,
  });
  return response.data;
}

function toSearchParams(params: DocListParams) {
  const query = new URLSearchParams();
  if (params.search?.trim()) query.set('search', params.search.trim().slice(0, 150));
  if (params.status) query.set('status', params.status);
  if (params.type) query.set('type', params.type);
  query.set('page', String(Math.max(1, params.page ?? 1)));
  query.set('pageSize', String(Math.min(Math.max(1, params.pageSize ?? 30), 100)));
  return `?${query.toString()}`;
}

function toParentSearchParams(params: ParentDocListParams) {
  const query = new URLSearchParams();
  const normalized = normalizeParentParams(params);
  if (normalized.search) query.set('search', normalized.search);
  if (normalized.type) query.set('type', normalized.type);
  if (normalized.agencyId) query.set('agencyId', normalized.agencyId);
  if (normalized.workspaceId) query.set('workspaceId', normalized.workspaceId);
  query.set('page', String(normalized.page));
  query.set('pageSize', String(normalized.pageSize));
  return `?${query.toString()}`;
}

function normalizeParentParams(params: ParentDocListParams) {
  return {
    search: params.search?.trim().slice(0, 150) || undefined,
    type: params.type,
    agencyId: params.agencyId,
    workspaceId: params.workspaceId,
    page: Math.max(1, params.page ?? 1),
    pageSize: Math.min(Math.max(1, params.pageSize ?? 25), 50),
  };
}

function agencyHeaders(agencyId: string) {
  return { [AGENCY_HEADER]: agencyId };
}
