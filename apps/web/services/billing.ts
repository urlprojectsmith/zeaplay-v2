import { apiClient } from './api';
import { superAgencyHeaders } from './super-agencies';

export type MasterPlanStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
export type MasterPlanType =
  'PUBLIC' | 'PRIVATE' | 'ENTERPRISE' | 'INTERNAL' | 'FREE' | 'DEMO' | 'QA';
export type BillingInterval = 'MONTHLY' | 'ANNUAL';
export type BillingPriceStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
export type PlanVersionStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type PlanEntitlementKind = 'FEATURE' | 'LIMIT';
export type PlanEntitlementValueType = 'BOOLEAN' | 'INTEGER' | 'BYTES' | 'COUNT' | 'UNLIMITED';
export type SubscriptionStatus =
  | 'TRIALING'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'GRACE_PERIOD'
  | 'TRIAL_GRACE'
  | 'PAYMENT_GRACE'
  | 'RESTRICTED'
  | 'SUSPENDED'
  | 'CANCELED'
  | 'EXPIRED';

export interface BillingPrice {
  id: string;
  planVersionId: string;
  provider: 'STRIPE' | 'INTERNAL';
  currency: string;
  interval: BillingInterval;
  amountMinor: string;
  externalProductId: string | null;
  externalPriceId: string | null;
  status: BillingPriceStatus;
}

export interface PlanEntitlement {
  id: string;
  key: string;
  kind: PlanEntitlementKind;
  valueType: PlanEntitlementValueType;
  booleanValue: boolean | null;
  numericValue: string | null;
  unlimited: boolean;
}

export interface MasterPlanVersion {
  id: string;
  versionNumber: number;
  status: PlanVersionStatus;
  publishedAt: string | null;
  archivedAt: string | null;
  createdAt?: string;
  updatedAt?: string;
  entitlements?: PlanEntitlement[];
}

export interface MasterPlan {
  id: string;
  key: string;
  type: MasterPlanType;
  displayName: string;
  description: string | null;
  status: MasterPlanStatus;
  tierRank: number;
  externalProductId: string | null;
  createdAt: string;
  updatedAt: string;
  versions: MasterPlanVersion[];
  prices: BillingPrice[];
}

export interface SuperAgencySubscription {
  id: string;
  superAgencyId: string;
  masterPlanId: string;
  planVersionId: string;
  billingPriceId: string | null;
  provider: 'STRIPE' | 'INTERNAL';
  status: SubscriptionStatus;
  isCurrent: boolean;
  billingInterval: BillingInterval | null;
  providerStatus: string | null;
  currentPeriodEnd: string | null;
  pendingPlanVersionId?: string | null;
  pendingBillingPriceId?: string | null;
  pendingChangeEffectiveAt?: string | null;
  cancelAtPeriodEnd: boolean;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  graceEndsAt: string | null;
  restrictedAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  masterPlan: {
    id: string;
    key: string;
    type: MasterPlanType;
    displayName: string;
    status: MasterPlanStatus;
  };
  planVersion: MasterPlanVersion & { entitlements: PlanEntitlement[] };
}

export interface BillingInvoice {
  id: string;
  superAgencyId: string;
  provider: 'STRIPE' | 'INTERNAL';
  providerInvoiceId: string;
  providerSubscriptionId: string | null;
  invoiceNumber: string | null;
  currency: string;
  status: string;
  amountDueMinor: string;
  amountPaidMinor: string;
  amountRemainingMinor: string;
  providerCreatedAt: string;
  dueAt: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  finalizedAt: string | null;
  paidAt: string | null;
  voidedAt: string | null;
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
  lastSyncedAt: string;
}

export interface PaymentMethodSummary {
  type: string;
  brand: string | null;
  displayBrand: string;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  isDefault: boolean;
}

export interface BillingHistoryItem {
  id: string;
  eventType: string;
  label: string;
  createdAt: string;
  planName: string | null;
  planVersion: number | null;
  subscriptionId: string | null;
}

export interface BillingAccessState {
  level: 'FULL' | 'FULL_WITH_WARNING' | 'READ_ONLY_RESTRICTED';
  reason: string;
  graceEndsAt?: string;
}

export interface EffectiveEntitlements {
  superAgencyId: string;
  hasCurrentSubscription: boolean;
  subscription: SuperAgencySubscription | null;
  access?: BillingAccessState;
  features: { key: string; enabled: boolean }[];
  limits: {
    key: string;
    valueType: PlanEntitlementValueType;
    unlimited: boolean;
    value: string | null;
  }[];
}

export interface BillingResourceSummary {
  resourceKey: string;
  dimension: 'LIVE_CAPACITY' | 'PERIOD_METERED' | 'FEATURE_ONLY';
  used: string;
  limit: string | null;
  unlimited: boolean;
  configured: boolean;
  remaining: string | null;
  status: 'WITHIN_LIMIT' | 'OVER_LIMIT';
  allocatedToChildren?: string | null;
  childAllocationUnlimited?: boolean;
  unallocated?: string | null;
}

export interface SuperAgencyUsageSummary {
  superAgencyId: string;
  enforcementMode: 'MANAGED' | 'UNMANAGED';
  resources: BillingResourceSummary[];
  period?: { start: string; end: string };
}

export interface AgencyUsageSummary {
  agencyId: string;
  superAgencyId: string;
  resources: BillingResourceSummary[];
}

export interface WorkspaceUsageSummary {
  workspaceId: string;
  agencyId: string;
  superAgencyId: string;
  resources: BillingResourceSummary[];
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export const billingKeys = {
  platformPlans: (page = 1) => ['platform-billing', 'plans', page] as const,
  superAgencyEntitlements: (superAgencyId: string | null) =>
    ['super-agency', superAgencyId, 'billing', 'entitlements'] as const,
  agencyEntitlements: (agencyId: string | null) =>
    ['agency', agencyId, 'billing', 'entitlements'] as const,
  workspaceEntitlements: (workspaceId: string | null) =>
    ['workspace', workspaceId, 'billing', 'entitlements'] as const,
  superAgencyCheckoutPlans: (superAgencyId: string | null) =>
    ['super-agency', superAgencyId, 'billing', 'checkout-plans'] as const,
  superAgencyUsage: (superAgencyId: string | null) =>
    ['super-agency', superAgencyId, 'billing', 'usage'] as const,
  superAgencyInvoices: (superAgencyId: string | null, page = 1) =>
    ['super-agency', superAgencyId, 'billing', 'invoices', page] as const,
  superAgencyPaymentMethod: (superAgencyId: string | null) =>
    ['super-agency', superAgencyId, 'billing', 'payment-method'] as const,
  superAgencyHistory: (superAgencyId: string | null, page = 1) =>
    ['super-agency', superAgencyId, 'billing', 'history', page] as const,
  agencyUsage: (agencyId: string | null) => ['agency', agencyId, 'billing', 'usage'] as const,
  workspaceUsage: (workspaceId: string | null) =>
    ['workspace', workspaceId, 'billing', 'usage'] as const,
};

export async function listPlatformPlans(page = 1) {
  const response = await apiClient.request<Paginated<MasterPlan>>(
    `/platform/billing/plans?page=${page}&pageSize=25`,
    { skipTenantContext: true },
  );
  return response.data;
}

export async function createPlatformPlan(body: {
  key: string;
  displayName: string;
  description?: string;
  tierRank?: number;
}) {
  const response = await apiClient.request<MasterPlan>('/platform/billing/plans', {
    method: 'POST',
    skipTenantContext: true,
    body: JSON.stringify({ ...body, entitlements: [] }),
  });
  return response.data;
}

export async function createPlatformPlanPrice(
  planId: string,
  versionId: string,
  body: { interval: BillingInterval; amountMinor: number },
) {
  const response = await apiClient.request<BillingPrice>(
    `/platform/billing/plans/${planId}/versions/${versionId}/prices`,
    {
      method: 'POST',
      skipTenantContext: true,
      body: JSON.stringify(body),
    },
  );
  return response.data;
}

export async function publishPlatformPlanVersion(planId: string, versionId: string) {
  const response = await apiClient.request<MasterPlan>(
    `/platform/billing/plans/${planId}/versions/${versionId}/publish`,
    { method: 'POST', skipTenantContext: true },
  );
  return response.data;
}

export async function getSuperAgencyBillingEntitlements(superAgencyId: string) {
  const response = await apiClient.request<EffectiveEntitlements>(
    `/super-agencies/${superAgencyId}/billing/entitlements`,
    { headers: superAgencyHeaders(superAgencyId), skipTenantContext: true },
  );
  return response.data;
}

export async function getAgencyBillingEntitlements(agencyId: string) {
  const response = await apiClient.request<EffectiveEntitlements>(
    `/agencies/${agencyId}/billing/entitlements`,
  );
  return response.data;
}

export async function getWorkspaceBillingEntitlements(workspaceId: string) {
  const response = await apiClient.request<EffectiveEntitlements>(
    `/workspaces/${workspaceId}/billing/entitlements`,
  );
  return response.data;
}

export async function getSuperAgencyUsage(superAgencyId: string) {
  const response = await apiClient.request<SuperAgencyUsageSummary>(
    `/super-agencies/${superAgencyId}/billing/usage`,
    { headers: superAgencyHeaders(superAgencyId), skipTenantContext: true },
  );
  return response.data;
}

export async function getAgencyUsage(agencyId: string) {
  const response = await apiClient.request<AgencyUsageSummary>(
    `/agencies/${agencyId}/billing/usage`,
  );
  return response.data;
}

export async function getWorkspaceUsage(workspaceId: string) {
  const response = await apiClient.request<WorkspaceUsageSummary>(
    `/workspaces/${workspaceId}/billing/usage`,
  );
  return response.data;
}

export async function updateAgencyAllocation(
  superAgencyId: string,
  agencyId: string,
  body: { resourceKey: string; allocated?: number; unlimited?: boolean },
) {
  const response = await apiClient.request<AgencyUsageSummary>(
    `/super-agencies/${superAgencyId}/billing/allocations/agencies/${agencyId}`,
    {
      method: 'PATCH',
      headers: superAgencyHeaders(superAgencyId),
      skipTenantContext: true,
      body: JSON.stringify(body),
    },
  );
  return response.data;
}

export async function updateWorkspaceAllocation(
  agencyId: string,
  workspaceId: string,
  body: { resourceKey: string; allocated?: number; unlimited?: boolean },
) {
  const response = await apiClient.request<WorkspaceUsageSummary>(
    `/agencies/${agencyId}/billing/allocations/workspaces/${workspaceId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(body),
    },
  );
  return response.data;
}

export async function listSuperAgencyCheckoutPlans(superAgencyId: string) {
  const response = await apiClient.request<MasterPlan[]>(
    `/super-agencies/${superAgencyId}/billing/checkout-plans`,
    { headers: superAgencyHeaders(superAgencyId), skipTenantContext: true },
  );
  return response.data;
}

export async function createCheckoutSession(
  superAgencyId: string,
  body: { planVersionId: string; interval: BillingInterval },
) {
  const response = await apiClient.request<{ attemptId: string; url: string | null }>(
    `/super-agencies/${superAgencyId}/billing/checkout`,
    {
      method: 'POST',
      headers: superAgencyHeaders(superAgencyId),
      skipTenantContext: true,
      body: JSON.stringify(body),
    },
  );
  return response.data;
}

export async function changeSubscription(
  superAgencyId: string,
  body: { planVersionId: string; interval: BillingInterval },
) {
  const response = await apiClient.request<{ status: string; effectiveAt?: string | null }>(
    `/super-agencies/${superAgencyId}/billing/subscription/change`,
    {
      method: 'POST',
      headers: superAgencyHeaders(superAgencyId),
      skipTenantContext: true,
      body: JSON.stringify(body),
    },
  );
  return response.data;
}

export async function createPortalSession(superAgencyId: string) {
  const response = await apiClient.request<{ url: string }>(
    `/super-agencies/${superAgencyId}/billing/portal`,
    {
      method: 'POST',
      headers: superAgencyHeaders(superAgencyId),
      skipTenantContext: true,
    },
  );
  return response.data;
}

export async function listSuperAgencyInvoices(superAgencyId: string, page = 1) {
  const response = await apiClient.request<Paginated<BillingInvoice>>(
    `/super-agencies/${superAgencyId}/billing/invoices?page=${page}&pageSize=25`,
    { headers: superAgencyHeaders(superAgencyId), skipTenantContext: true },
  );
  return response.data;
}

export async function refreshSuperAgencyInvoices(superAgencyId: string) {
  const response = await apiClient.request<{
    synced: number;
    provider: string;
    lastSyncedAt: string;
  }>(`/super-agencies/${superAgencyId}/billing/invoices/refresh`, {
    method: 'POST',
    headers: superAgencyHeaders(superAgencyId),
    skipTenantContext: true,
  });
  return response.data;
}

export async function getSuperAgencyPaymentMethod(superAgencyId: string) {
  const response = await apiClient.request<{
    provider: 'STRIPE' | 'INTERNAL';
    paymentMethod: PaymentMethodSummary | null;
  }>(`/super-agencies/${superAgencyId}/billing/payment-method`, {
    headers: superAgencyHeaders(superAgencyId),
    skipTenantContext: true,
  });
  return response.data;
}

export async function listSuperAgencyBillingHistory(superAgencyId: string, page = 1) {
  const response = await apiClient.request<Paginated<BillingHistoryItem>>(
    `/super-agencies/${superAgencyId}/billing/history?page=${page}&pageSize=25`,
    { headers: superAgencyHeaders(superAgencyId), skipTenantContext: true },
  );
  return response.data;
}

export async function cancelSubscription(superAgencyId: string) {
  const response = await apiClient.request<SuperAgencySubscription>(
    `/super-agencies/${superAgencyId}/billing/subscription/cancel`,
    {
      method: 'POST',
      headers: superAgencyHeaders(superAgencyId),
      skipTenantContext: true,
      body: JSON.stringify({ immediate: false }),
    },
  );
  return response.data;
}
