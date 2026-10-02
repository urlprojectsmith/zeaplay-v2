import { apiClient } from './api';
import type { AccountContextResponse } from './account-context';
import type { AnalyticsScopeType } from './analytics';
import { superAgencyHeaders } from './super-agencies';

export type CustomDomainScopeType = 'SUPER_AGENCY' | 'AGENCY' | 'WORKSPACE';
export type CustomDomainStatus =
  | 'PENDING_VERIFICATION'
  | 'DNS_VERIFIED'
  | 'ROUTING_PENDING'
  | 'SSL_PENDING'
  | 'ACTIVE'
  | 'FAILED'
  | 'SUSPENDED'
  | 'REMOVING'
  | 'REMOVED';

export interface CustomDomain {
  id: string;
  scopeType: CustomDomainScopeType;
  scopeId: string;
  hostname: string;
  normalizedHostname: string;
  displayHostname?: string | null;
  status: CustomDomainStatus;
  txtRecordName: string;
  txtRecordValue?: string;
  verificationTokenReturnedOnce: boolean;
  verificationTokenCreatedAt: string;
  verificationExpiresAt: string;
  verifiedAt?: string | null;
  routingVerifiedAt?: string | null;
  sslRequestedAt?: string | null;
  sslActiveAt?: string | null;
  failureCode?: string | null;
  failureMessageSafe?: string | null;
  revision: number;
  removedAt?: string | null;
}

export interface CustomDomainHostResolution {
  domainId: string;
  scopeType: CustomDomainScopeType;
  scopeId: string;
  status: 'ACTIVE';
}

export const customDomainKeys = {
  list: (scope: AnalyticsScopeType | null, scopeId: string | null) =>
    ['custom-domains', scope, scopeId] as const,
};

export async function listCustomDomains(scope: AnalyticsScopeType, scopeId: string) {
  const response = await apiClient.request<{ items: CustomDomain[] }>(
    `${basePath(scope, scopeId)}/custom-domains`,
    requestOptions(scope, scopeId),
  );
  return response.data;
}

export async function createCustomDomain(
  scope: AnalyticsScopeType,
  scopeId: string,
  hostname: string,
) {
  const response = await apiClient.request<CustomDomain>(
    `${basePath(scope, scopeId)}/custom-domains`,
    {
      ...requestOptions(scope, scopeId),
      method: 'POST',
      body: JSON.stringify({ hostname }),
    },
  );
  return response.data;
}

export async function verifyCustomDomain(
  scope: AnalyticsScopeType,
  scopeId: string,
  domainId: string,
) {
  const response = await apiClient.request<CustomDomain>(
    `${basePath(scope, scopeId)}/custom-domains/${domainId}/verify`,
    { ...requestOptions(scope, scopeId), method: 'POST' },
  );
  return response.data;
}

export async function rotateCustomDomainToken(
  scope: AnalyticsScopeType,
  scopeId: string,
  domainId: string,
) {
  const response = await apiClient.request<CustomDomain>(
    `${basePath(scope, scopeId)}/custom-domains/${domainId}/verification-token`,
    { ...requestOptions(scope, scopeId), method: 'POST' },
  );
  return response.data;
}

export async function removeCustomDomain(
  scope: AnalyticsScopeType,
  scopeId: string,
  domain: CustomDomain,
) {
  const response = await apiClient.request<CustomDomain>(
    `${basePath(scope, scopeId)}/custom-domains/${domain.id}`,
    {
      ...requestOptions(scope, scopeId),
      method: 'DELETE',
      body: JSON.stringify({ expectedRevision: domain.revision }),
    },
  );
  return response.data;
}

export async function getCurrentCustomDomainHostResolution() {
  const response = await apiClient.request<CustomDomainHostResolution | null>('/host-resolution', {
    skipTenantContext: true,
  });
  return response.data;
}

export async function resolveDomainBoundSwitchRedirect(context: AccountContextResponse) {
  if (typeof window === 'undefined') return null;
  const resolution = await getCurrentCustomDomainHostResolution().catch(() => null);
  if (!resolution || customDomainMatchesContext(resolution, context)) return null;
  const canonical = canonicalAppUrl();
  if (!canonical || canonical.origin === window.location.origin) return null;
  canonical.pathname = canonicalPathForContext(context);
  canonical.search = '';
  canonical.hash = '';
  return canonical.href;
}

export function customDomainMatchesContext(
  resolution: CustomDomainHostResolution,
  context: Pick<
    AccountContextResponse,
    'selectedSuperAgencyId' | 'selectedAgencyId' | 'selectedWorkspaceId'
  >,
) {
  if (resolution.scopeType === 'SUPER_AGENCY') {
    return context.selectedSuperAgencyId === resolution.scopeId;
  }
  if (resolution.scopeType === 'AGENCY') {
    return context.selectedAgencyId === resolution.scopeId && !context.selectedWorkspaceId;
  }
  return context.selectedWorkspaceId === resolution.scopeId;
}

function basePath(scope: AnalyticsScopeType, scopeId: string) {
  if (scope === 'WORKSPACE') return `/workspaces/${scopeId}`;
  if (scope === 'AGENCY') return `/agencies/${scopeId}`;
  if (scope === 'SUPER_AGENCY') return `/super-agencies/${scopeId}`;
  throw new Error('Custom domains are tenant-scoped in Phase 18.2.');
}

function requestOptions(scope: AnalyticsScopeType, scopeId: string) {
  if (scope === 'SUPER_AGENCY') {
    return { headers: superAgencyHeaders(scopeId), skipTenantContext: true };
  }
  return {};
}

function canonicalAppUrl() {
  const configured = process.env.NEXT_PUBLIC_CANONICAL_APP_URL ?? '';
  try {
    const url = new URL(configured);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

function canonicalPathForContext(context: AccountContextResponse) {
  if (context.selectedWorkspaceId) return '/workspace/dashboard';
  if (context.selectedAgencyId) return '/agency/dashboard';
  if (context.selectedSuperAgencyId) return '/super-agency/dashboard';
  return '/';
}
