import { apiClient } from './api';
import { superAgencyHeaders } from './super-agencies';

const AGENCY_HEADER = 'x-agency-id';

export type FormStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type FormType = 'FORM' | 'TEMPLATE';
export type FormFieldType =
  | 'TEXT'
  | 'TEXTAREA'
  | 'NUMBER'
  | 'EMAIL'
  | 'PHONE'
  | 'DATE'
  | 'DROPDOWN'
  | 'MULTI_SELECT'
  | 'CHECKBOX'
  | 'RADIO'
  | 'RATING'
  | 'FILE_UPLOAD'
  | 'SIGNATURE'
  | 'HIDDEN';

export interface FormField {
  id: string;
  type: FormFieldType;
  label: string;
  required?: boolean;
  options?: Array<{ id: string; label: string }>;
  accept?: string[];
  maxFiles?: number;
  maxSizeBytes?: number;
  condition?: { fieldId: string; operator: string; value?: unknown };
}

export interface FormSchema {
  fields: FormField[];
  steps?: Array<{ id: string; title: string; fieldIds: string[] }>;
}

export interface WorkspaceForm {
  id: string;
  workspaceId: string;
  publicId: string;
  title: string;
  description: string | null;
  status: FormStatus;
  type: FormType;
  visibility: 'INTERNAL' | 'PUBLIC';
  publicEnabled: boolean;
  publishedVersionNumber: number | null;
  updatedAt: string;
  versions?: Array<{
    id: string;
    versionNumber: number;
    state: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
    schema: FormSchema;
    settings?: Record<string, unknown> | null;
  }>;
  _count?: { submissions: number };
}

export interface ParentForm extends WorkspaceForm {
  workspace: {
    id: string;
    name: string;
    slug: string;
    agency: { id: string; name: string; slug: string; superAgencyId: string };
  };
}

export interface FormListParams {
  search?: string;
  status?: FormStatus;
  type?: FormType;
  agencyId?: string;
  workspaceId?: string;
  page?: number;
  pageSize?: number;
}

export const workspaceFormKeys = {
  all: (workspaceId: string | null) => ['workspace', workspaceId, 'forms'],
  list: (workspaceId: string | null, params: FormListParams) => [
    'workspace',
    workspaceId,
    'forms',
    'list',
    normalizeParams(params),
  ],
  detail: (workspaceId: string | null, formId: string | null) => [
    'workspace',
    workspaceId,
    'forms',
    formId,
  ],
};

export const parentFormKeys = {
  agency: (agencyId: string | null, params: FormListParams) =>
    ['agency', agencyId, 'forms', normalizeParams(params)] as const,
  superAgency: (superAgencyId: string | null, params: FormListParams) =>
    ['super-agency', superAgencyId, 'forms', normalizeParams(params)] as const,
};

export async function listWorkspaceForms(workspaceId: string, params: FormListParams) {
  const response = await apiClient.request<{
    items: WorkspaceForm[];
    total: number;
    page: number;
    pageSize: number;
  }>(`/workspaces/${workspaceId}/forms${toSearchParams(params)}`);
  return response.data;
}

export async function getWorkspaceForm(workspaceId: string, formId: string) {
  const response = await apiClient.request<WorkspaceForm>(
    `/workspaces/${workspaceId}/forms/${formId}`,
  );
  return response.data;
}

export async function createWorkspaceForm(workspaceId: string, input: Partial<WorkspaceForm>) {
  const response = await apiClient.request<WorkspaceForm>(`/workspaces/${workspaceId}/forms`, {
    method: 'POST',
    body: JSON.stringify({
      title: input.title ?? 'Untitled Form',
      description: input.description ?? null,
      type: input.type ?? 'FORM',
      schema: input.versions?.[0]?.schema ?? emptyFormSchema(),
      settings: { successMessage: 'Thanks. Your response was submitted.' },
    }),
  });
  return response.data;
}

export async function updateWorkspaceFormDraft(
  workspaceId: string,
  formId: string,
  input: {
    title: string;
    description?: string | null;
    schema: FormSchema;
    settings?: Record<string, unknown>;
  },
) {
  const response = await apiClient.request<WorkspaceForm>(
    `/workspaces/${workspaceId}/forms/${formId}/draft`,
    { method: 'PATCH', body: JSON.stringify(input) },
  );
  return response.data;
}

export async function publishWorkspaceForm(
  workspaceId: string,
  formId: string,
  publicEnabled: boolean,
) {
  const response = await apiClient.request<WorkspaceForm>(
    `/workspaces/${workspaceId}/forms/${formId}/publish`,
    { method: 'POST', body: JSON.stringify({ publicEnabled }) },
  );
  return response.data;
}

export async function submitWorkspaceForm(
  workspaceId: string,
  formId: string,
  answers: Record<string, unknown>,
) {
  const response = await apiClient.request<{ id: string; submittedAt: string }>(
    `/workspaces/${workspaceId}/forms/${formId}/submissions`,
    {
      method: 'POST',
      body: JSON.stringify({ answers, idempotencyKey: crypto.randomUUID() }),
    },
  );
  return response.data;
}

export async function listFormSubmissions(workspaceId: string, formId: string) {
  const response = await apiClient.request<{
    items: Array<Record<string, unknown>>;
    total: number;
  }>(`/workspaces/${workspaceId}/forms/${formId}/submissions?page=1&pageSize=50`);
  return response.data;
}

export async function getPublicForm(publicId: string) {
  const response = await apiClient.request<{
    publicId: string;
    title: string;
    description: string | null;
    versionNumber: number;
    schema: FormSchema;
    settings: { successMessage?: string; successRedirectUrl?: string; captchaRequired?: boolean };
    noindex: true;
  }>(`/forms/${publicId}`, { skipTenantContext: true });
  return response.data;
}

export async function submitPublicForm(publicId: string, answers: Record<string, unknown>) {
  const response = await apiClient.request<{ id: string; submittedAt: string }>(
    `/forms/${publicId}/submissions`,
    {
      method: 'POST',
      skipTenantContext: true,
      body: JSON.stringify({ answers, idempotencyKey: crypto.randomUUID(), honeypot: '' }),
    },
  );
  return response.data;
}

export async function authorizePublicFormUpload(
  publicId: string,
  input: {
    fieldId: string;
    formVersionNumber: number;
    filename: string;
    mimeType: string;
    sizeBytes: number;
  },
) {
  const response = await apiClient.request<{
    assetId: string;
    uploadToken: string;
    uploadUrl: string;
    expiresAt: string;
    constraints: {
      fieldId: string;
      formVersionNumber: number;
      mimeType: string;
      maxSizeBytes: number;
    };
  }>(`/forms/${publicId}/uploads/authorize`, {
    method: 'POST',
    skipTenantContext: true,
    body: JSON.stringify(input),
  });
  return response.data;
}

export async function completePublicFormUpload(
  publicId: string,
  input: {
    fieldId: string;
    formVersionNumber: number;
    assetId: string;
    uploadToken: string;
    sizeBytes: number;
  },
) {
  const response = await apiClient.request<{
    assetId: string;
    mimeType: string;
    sizeBytes: number;
    status: string;
  }>(`/forms/${publicId}/uploads/complete`, {
    method: 'POST',
    skipTenantContext: true,
    body: JSON.stringify(input),
  });
  return response.data;
}

export async function listAgencyParentForms(agencyId: string, params: FormListParams) {
  const response = await apiClient.request<{
    items: ParentForm[];
    total: number;
    page: number;
    pageSize: number;
  }>(`/agencies/${agencyId}/parent/forms${toSearchParams(params)}`, {
    headers: agencyHeaders(agencyId),
    skipTenantContext: true,
  });
  return response.data;
}

export async function listSuperAgencyParentForms(superAgencyId: string, params: FormListParams) {
  const response = await apiClient.request<{
    items: ParentForm[];
    total: number;
    page: number;
    pageSize: number;
  }>(`/super-agencies/${superAgencyId}/parent/forms${toSearchParams(params)}`, {
    headers: superAgencyHeaders(superAgencyId),
    skipTenantContext: true,
  });
  return response.data;
}

export function emptyFormSchema(): FormSchema {
  return {
    fields: [
      {
        id: 'name',
        type: 'TEXT',
        label: 'Name',
        required: true,
      },
      {
        id: 'email',
        type: 'EMAIL',
        label: 'Email',
        required: true,
      },
    ],
  };
}

export interface PublicUploadAnswerRef {
  assetId: string;
  uploadToken: string;
}

function toSearchParams(params: FormListParams) {
  const query = new URLSearchParams();
  const normalized = normalizeParams(params);
  if (normalized.search) query.set('search', normalized.search);
  if (normalized.status) query.set('status', normalized.status);
  if (normalized.type) query.set('type', normalized.type);
  if (normalized.agencyId) query.set('agencyId', normalized.agencyId);
  if (normalized.workspaceId) query.set('workspaceId', normalized.workspaceId);
  query.set('page', String(normalized.page));
  query.set('pageSize', String(normalized.pageSize));
  return `?${query.toString()}`;
}

function normalizeParams(params: FormListParams) {
  return {
    search: params.search?.trim().slice(0, 150) || undefined,
    status: params.status,
    type: params.type,
    agencyId: params.agencyId,
    workspaceId: params.workspaceId,
    page: Math.max(1, params.page ?? 1),
    pageSize: Math.min(Math.max(1, params.pageSize ?? 30), 100),
  };
}

function agencyHeaders(agencyId: string) {
  return { [AGENCY_HEADER]: agencyId };
}
