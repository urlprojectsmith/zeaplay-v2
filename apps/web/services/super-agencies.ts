import { apiClient } from './api';

const SUPER_AGENCY_HEADER = 'x-super-agency-id';

export type SuperAgencyStatus = 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
export type AgencyStatus = 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
export type WorkspaceStatus = 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
export type MembershipStatus = 'ACTIVE' | 'INVITED' | 'SUSPENDED';
export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';

export interface SuperAgencyContext {
  id: string;
  name: string;
  slug: string;
  status: SuperAgencyStatus;
  roleId: string;
  roleName: string;
  membershipId: string;
  permissions: string[];
  counts: {
    agencies: number;
    workspaces: number;
    activeMembers: number;
    pendingInvitations: number | null;
  };
  agencies: {
    id: string;
    name: string;
    slug: string;
    status: string;
  }[];
  createdAt: string;
  updatedAt: string;
}

export interface SuperAgencyMember {
  id: string;
  userId: string;
  superAgencyId: string;
  status: MembershipStatus;
  createdAt: string;
  updatedAt: string;
  user: { id: string; email: string; name: string | null; status: string };
  role: { id: string; key: string; name: string; scope: string };
}

export interface SuperAgencyRole {
  id: string;
  key: string;
  name: string;
  description: string | null;
  scope: 'SUPER_AGENCY';
  isSystem: boolean;
  isActive: boolean;
  workspaceId: string | null;
  permissions: { id: string; key: string; description: string | null }[];
  createdAt: string;
  updatedAt: string;
}

export interface SuperAgencyInvitation {
  id: string;
  superAgencyId: string;
  email: string;
  roleId: string;
  status: InvitationStatus;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
  role: { id: string; key: string; name: string; scope: string };
}

export interface SuperAgencyAgency {
  id: string;
  superAgencyId: string;
  name: string;
  slug: string;
  status: AgencyStatus;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  counts: { members: number; workspaces: number };
}

export interface SuperAgencyWorkspaceSummary {
  id: string;
  agencyId: string;
  name: string;
  slug: string;
  timezone: string;
  status: WorkspaceStatus;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  agency: { id: string; name: string; slug: string; superAgencyId: string };
  counts: { members: number };
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export const superAgencyKeys = {
  base: (superAgencyId: string | null) => ['super-agency', superAgencyId] as const,
  context: (superAgencyId: string | null) =>
    [...superAgencyKeys.base(superAgencyId), 'context'] as const,
  members: (superAgencyId: string | null, params: SuperAgencyListParams) =>
    [...superAgencyKeys.base(superAgencyId), 'members', normalizeListParams(params)] as const,
  roles: (superAgencyId: string | null) =>
    [...superAgencyKeys.base(superAgencyId), 'roles'] as const,
  invitations: (superAgencyId: string | null, params: SuperAgencyInvitationListParams) =>
    [...superAgencyKeys.base(superAgencyId), 'invitations', normalizeListParams(params)] as const,
  agencies: (superAgencyId: string | null, params: SuperAgencyAgencyListParams) =>
    [
      ...superAgencyKeys.base(superAgencyId),
      'agencies',
      normalizeAgencyListParams(params),
    ] as const,
  agency: (superAgencyId: string | null, agencyId: string | null) =>
    [...superAgencyKeys.base(superAgencyId), 'agencies', agencyId] as const,
  agencyWorkspaces: (
    superAgencyId: string | null,
    agencyId: string | null,
    params: SuperAgencyWorkspaceListParams,
  ) =>
    [
      ...superAgencyKeys.agency(superAgencyId, agencyId),
      'workspaces',
      normalizeWorkspaceListParams(params),
    ] as const,
};

export interface SuperAgencyListParams {
  page?: number;
  pageSize?: number;
  search?: string;
}

export interface SuperAgencyInvitationListParams extends SuperAgencyListParams {
  status?: InvitationStatus;
}

export interface SuperAgencyAgencyListParams extends SuperAgencyListParams {
  status?: AgencyStatus;
  sort?: 'NEWEST' | 'OLDEST' | 'NAME_ASC' | 'NAME_DESC';
}

export interface SuperAgencyWorkspaceListParams extends SuperAgencyListParams {
  status?: WorkspaceStatus;
  sort?: 'NEWEST' | 'OLDEST' | 'NAME_ASC' | 'NAME_DESC';
}

export async function getSuperAgencyContext(superAgencyId: string) {
  const response = await apiClient.request<SuperAgencyContext>(`/super-agencies/${superAgencyId}`, {
    headers: superAgencyHeaders(superAgencyId),
    skipTenantContext: true,
  });
  return response.data;
}

export async function listSuperAgencyMembers(
  superAgencyId: string,
  params: SuperAgencyListParams = {},
) {
  const query = listQueryString(params);
  const response = await apiClient.request<Paginated<SuperAgencyMember>>(
    `/super-agencies/${superAgencyId}/memberships?${query}`,
    { headers: superAgencyHeaders(superAgencyId), skipTenantContext: true },
  );
  return response.data;
}

export async function updateSuperAgencyMembership(
  superAgencyId: string,
  membershipId: string,
  body: { status?: MembershipStatus; roleId?: string },
) {
  const response = await apiClient.request<SuperAgencyMember>(
    `/super-agencies/${superAgencyId}/memberships/${membershipId}`,
    {
      method: 'PATCH',
      headers: superAgencyHeaders(superAgencyId),
      skipTenantContext: true,
      body: JSON.stringify(body),
    },
  );
  return response.data;
}

export async function listSuperAgencyRoles(superAgencyId: string) {
  const response = await apiClient.request<SuperAgencyRole[]>(
    `/super-agencies/${superAgencyId}/roles`,
    { headers: superAgencyHeaders(superAgencyId), skipTenantContext: true },
  );
  return response.data;
}

export async function createSuperAgencyInvitation(
  superAgencyId: string,
  body: { email: string; roleId: string },
) {
  const response = await apiClient.request<SuperAgencyInvitation>(
    `/super-agencies/${superAgencyId}/invitations`,
    {
      method: 'POST',
      headers: superAgencyHeaders(superAgencyId),
      skipTenantContext: true,
      body: JSON.stringify(body),
    },
  );
  return response.data;
}

export async function listSuperAgencyInvitations(
  superAgencyId: string,
  params: SuperAgencyInvitationListParams = {},
) {
  const query = invitationQueryString(params);
  const response = await apiClient.request<Paginated<SuperAgencyInvitation>>(
    `/super-agencies/${superAgencyId}/invitations?${query}`,
    { headers: superAgencyHeaders(superAgencyId), skipTenantContext: true },
  );
  return response.data;
}

export async function revokeSuperAgencyInvitation(superAgencyId: string, invitationId: string) {
  const response = await apiClient.request<SuperAgencyInvitation>(
    `/super-agencies/${superAgencyId}/invitations/${invitationId}/revoke`,
    {
      method: 'PATCH',
      headers: superAgencyHeaders(superAgencyId),
      skipTenantContext: true,
    },
  );
  return response.data;
}

export async function listSuperAgencyAgencies(
  superAgencyId: string,
  params: SuperAgencyAgencyListParams = {},
) {
  const response = await apiClient.request<Paginated<SuperAgencyAgency>>(
    `/super-agencies/${superAgencyId}/agencies?${agencyListQueryString(params)}`,
    { headers: superAgencyHeaders(superAgencyId), skipTenantContext: true },
  );
  return response.data;
}

export async function createSuperAgencyAgency(
  superAgencyId: string,
  body: { name: string; slug: string },
) {
  const response = await apiClient.request<SuperAgencyAgency>(
    `/super-agencies/${superAgencyId}/agencies`,
    {
      method: 'POST',
      headers: superAgencyHeaders(superAgencyId),
      skipTenantContext: true,
      body: JSON.stringify(body),
    },
  );
  return response.data;
}

export async function getSuperAgencyAgency(superAgencyId: string, agencyId: string) {
  const response = await apiClient.request<SuperAgencyAgency>(
    `/super-agencies/${superAgencyId}/agencies/${agencyId}`,
    { headers: superAgencyHeaders(superAgencyId), skipTenantContext: true },
  );
  return response.data;
}

export async function updateSuperAgencyAgency(
  superAgencyId: string,
  agencyId: string,
  body: { name?: string; status?: AgencyStatus },
) {
  const response = await apiClient.request<SuperAgencyAgency>(
    `/super-agencies/${superAgencyId}/agencies/${agencyId}`,
    {
      method: 'PATCH',
      headers: superAgencyHeaders(superAgencyId),
      skipTenantContext: true,
      body: JSON.stringify(body),
    },
  );
  return response.data;
}

export async function listSuperAgencyAgencyWorkspaces(
  superAgencyId: string,
  agencyId: string,
  params: SuperAgencyWorkspaceListParams = {},
) {
  const response = await apiClient.request<Paginated<SuperAgencyWorkspaceSummary>>(
    `/super-agencies/${superAgencyId}/agencies/${agencyId}/workspaces?${workspaceListQueryString(
      params,
    )}`,
    { headers: superAgencyHeaders(superAgencyId), skipTenantContext: true },
  );
  return response.data;
}

export function superAgencyHeaders(superAgencyId: string) {
  return { [SUPER_AGENCY_HEADER]: superAgencyId };
}

function listQueryString(params: SuperAgencyListParams) {
  const normalized = normalizeListParams(params);
  const query = new URLSearchParams();
  query.set('page', String(normalized.page));
  query.set('pageSize', String(normalized.pageSize));
  if (normalized.search) query.set('search', normalized.search);
  return query.toString();
}

function invitationQueryString(params: SuperAgencyInvitationListParams) {
  const query = new URLSearchParams(listQueryString(params));
  if (params.status) query.set('status', params.status);
  return query.toString();
}

function agencyListQueryString(params: SuperAgencyAgencyListParams) {
  const query = new URLSearchParams(listQueryString(params));
  if (params.status) query.set('status', params.status);
  if (params.sort) query.set('sort', params.sort);
  return query.toString();
}

function workspaceListQueryString(params: SuperAgencyWorkspaceListParams) {
  const query = new URLSearchParams(listQueryString(params));
  if (params.status) query.set('status', params.status);
  if (params.sort) query.set('sort', params.sort);
  return query.toString();
}

function normalizeListParams<T extends SuperAgencyListParams>(params: T) {
  return {
    page: params.page ?? 1,
    pageSize: Math.min(params.pageSize ?? 25, 100),
    search: params.search?.trim() ?? '',
    ...('status' in params && params.status ? { status: params.status } : {}),
  };
}

function normalizeAgencyListParams(params: SuperAgencyAgencyListParams) {
  return {
    ...normalizeListParams(params),
    status: params.status ?? '',
    sort: params.sort ?? 'NEWEST',
  };
}

function normalizeWorkspaceListParams(params: SuperAgencyWorkspaceListParams) {
  return {
    ...normalizeListParams(params),
    status: params.status ?? '',
    sort: params.sort ?? 'NEWEST',
  };
}
