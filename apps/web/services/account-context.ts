import { apiClient } from './api';

export type AccountContextTargetType = 'SUPER_AGENCY' | 'AGENCY' | 'WORKSPACE';

export interface AccountContextSuperAgency {
  id: string;
  name: string;
  slug: string;
  status: string;
}

export interface AccountContextWorkspace {
  id: string;
  agencyId: string;
  name: string;
  slug: string;
  timezone: string;
  status: string;
}

export interface AccountContextAgency {
  id: string;
  superAgencyId: string;
  name: string;
  slug: string;
  status: string;
  workspaces?: AccountContextWorkspace[];
}

export interface AccountContextResponse {
  targetType: AccountContextTargetType;
  targetId: string;
  selectedSuperAgencyId: string | null;
  selectedAgencyId: string | null;
  selectedWorkspaceId: string | null;
  superAgencyId: string | null;
  agencyId: string | null;
  workspaceId: string | null;
  superAgency: AccountContextSuperAgency | null;
  agency: AccountContextAgency | null;
  workspace: AccountContextWorkspace | null;
  roleName: string;
  permissions: string[];
  accessSource?: 'WORKSPACE_MEMBERSHIP' | 'AGENCY_ADMINISTRATION' | 'SUPER_AGENCY_ADMINISTRATION';
}

export interface AccountContextPage<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export const accountContextKeys = {
  agencies: (superAgencyId: string | null, search: string) => [
    'account-context',
    'agencies',
    superAgencyId,
    search,
  ],
  subaccounts: (agencyId: string | null, search: string) => [
    'account-context',
    'subaccounts',
    agencyId,
    search,
  ],
};

export async function listAccountContextAgencies(superAgencyId: string, search: string) {
  const params = new URLSearchParams({ superAgencyId, pageSize: '25' });
  if (search.trim()) params.set('search', search.trim());
  const response = await apiClient.request<AccountContextPage<AccountContextAgency>>(
    `/account-context/agencies?${params}`,
    { skipTenantContext: true },
  );
  return response.data;
}

export async function listAccountContextSubaccounts(agencyId: string, search: string) {
  const params = new URLSearchParams({ agencyId, pageSize: '25' });
  if (search.trim()) params.set('search', search.trim());
  const response = await apiClient.request<AccountContextPage<AccountContextWorkspace>>(
    `/account-context/subaccounts?${params}`,
    { skipTenantContext: true },
  );
  return response.data;
}

export async function switchAccountContext(input: {
  targetType: AccountContextTargetType;
  targetId: string;
  agencyId?: string;
  sourceType?: AccountContextTargetType;
  sourceId?: string;
}) {
  const response = await apiClient.request<AccountContextResponse>('/account-context/switch', {
    method: 'POST',
    body: JSON.stringify(input),
    skipTenantContext: true,
  });
  return response.data;
}

export async function validateAccountContext(input: {
  targetType: AccountContextTargetType;
  targetId: string;
  agencyId?: string;
}) {
  const response = await apiClient.request<AccountContextResponse>('/account-context/validate', {
    method: 'POST',
    body: JSON.stringify(input),
    skipTenantContext: true,
  });
  return response.data;
}

export async function returnAccountContext(input: {
  targetType: Exclude<AccountContextTargetType, 'WORKSPACE'>;
  targetId: string;
  sourceType?: AccountContextTargetType;
  sourceId?: string;
}) {
  const response = await apiClient.request<AccountContextResponse>('/account-context/return', {
    method: 'POST',
    body: JSON.stringify(input),
    skipTenantContext: true,
  });
  return response.data;
}
