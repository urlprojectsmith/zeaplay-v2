import { apiClient } from './api';
import type { AnalyticsScopeType } from './analytics';
import { superAgencyHeaders } from './super-agencies';

export type BrandingFieldKey =
  | 'APP_NAME'
  | 'COMPANY_NAME'
  | 'LOGO'
  | 'DARK_LOGO'
  | 'FAVICON'
  | 'LOGIN_BACKGROUND'
  | 'PRIMARY_COLOR'
  | 'ACCENT_COLOR'
  | 'SUPPORT_EMAIL'
  | 'SUPPORT_URL'
  | 'FOOTER_TEXT'
  | 'META_DESCRIPTION';

export interface BrandingAssetRef {
  assetId: string;
  workspaceId: string;
  mimeType?: string;
  sizeBytes?: number;
  displayName?: string;
  url?: string;
  expiresInSeconds?: number;
}

export interface EffectiveBranding {
  scopeType: AnalyticsScopeType;
  scopeId: string;
  appName: string;
  companyName: string;
  logo: BrandingAssetRef | null;
  darkLogo: BrandingAssetRef | null;
  favicon: BrandingAssetRef | null;
  loginBackground: BrandingAssetRef | null;
  primaryColor: string;
  primaryForeground: string;
  accentColor: string;
  accentForeground: string;
  supportEmail: string;
  supportUrl: string;
  footerText: string;
  metaDescription: string;
  fingerprint: string;
  sources?: Record<BrandingFieldKey, string>;
  policy?: {
    agencyAllowedOverrides: BrandingFieldKey[];
    workspaceAllowedOverrides: BrandingFieldKey[];
  };
}

export interface BrandingConfig {
  scopeType: AnalyticsScopeType;
  scopeId: string;
  revision: number;
  overrides: Partial<Record<string, unknown>>;
  agencyAllowedOverrides: BrandingFieldKey[];
  workspaceAllowedOverrides: BrandingFieldKey[];
  effective: EffectiveBranding;
}

export interface UpdateBrandingConfig {
  expectedRevision: number;
  appName?: string | null;
  companyName?: string | null;
  logo?: { assetId: string; workspaceId: string } | null;
  darkLogo?: { assetId: string; workspaceId: string } | null;
  favicon?: { assetId: string; workspaceId: string } | null;
  loginBackground?: { assetId: string; workspaceId: string } | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  supportEmail?: string | null;
  supportUrl?: string | null;
  footerText?: string | null;
  metaDescription?: string | null;
  agencyAllowedOverrides?: BrandingFieldKey[];
  workspaceAllowedOverrides?: BrandingFieldKey[];
}

export const brandingKeys = {
  effective: (scope: AnalyticsScopeType | null, scopeId: string | null) =>
    ['branding', 'effective', scope, scopeId] as const,
  config: (scope: AnalyticsScopeType | null, scopeId: string | null) =>
    ['branding', 'config', scope, scopeId] as const,
};

export async function getEffectiveBranding(scope: AnalyticsScopeType, scopeId: string) {
  const response = await apiClient.request<EffectiveBranding>(
    `${basePath(scope, scopeId)}/branding/effective`,
    requestOptions(scope, scopeId),
  );
  return response.data;
}

export async function getBrandingConfig(scope: AnalyticsScopeType, scopeId: string) {
  const response = await apiClient.request<BrandingConfig>(
    `${basePath(scope, scopeId)}/branding/config`,
    requestOptions(scope, scopeId),
  );
  return response.data;
}

export async function updateBrandingConfig(
  scope: AnalyticsScopeType,
  scopeId: string,
  body: UpdateBrandingConfig,
) {
  const response = await apiClient.request<BrandingConfig>(
    `${basePath(scope, scopeId)}/branding/config`,
    { ...requestOptions(scope, scopeId), method: 'PATCH', body: JSON.stringify(body) },
  );
  return response.data;
}

function basePath(scope: AnalyticsScopeType, scopeId: string) {
  if (scope === 'WORKSPACE') return `/workspaces/${scopeId}`;
  if (scope === 'AGENCY') return `/agencies/${scopeId}`;
  if (scope === 'SUPER_AGENCY') return `/super-agencies/${scopeId}`;
  return '/platform';
}

function requestOptions(scope: AnalyticsScopeType, scopeId: string) {
  if (scope === 'SUPER_AGENCY') {
    return { headers: superAgencyHeaders(scopeId), skipTenantContext: true };
  }
  if (scope === 'PLATFORM') return { skipTenantContext: true };
  return {};
}
