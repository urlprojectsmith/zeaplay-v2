import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../contexts/providers';
import { PlatformPlansPage, SuperAgencyBillingPage } from '../components/billing/BillingPages';
import { dashboardConfigs } from '../components/navigation/navigation-config';
import { billingKeys } from '../services/billing';
import { useSessionStore, type SessionSuperAgency } from '../stores/session';

const listPlatformPlans = vi.fn();
const createPlatformPlan = vi.fn();
const publishPlatformPlanVersion = vi.fn();
const getSuperAgencyBillingEntitlements = vi.fn();
const listSuperAgencyCheckoutPlans = vi.fn();
const getSuperAgencyUsage = vi.fn();
const listSuperAgencyInvoices = vi.fn();
const getSuperAgencyPaymentMethod = vi.fn();
const listSuperAgencyBillingHistory = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => '/super-agency/billing',
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock('../services/billing', async () => {
  const actual = await vi.importActual<typeof import('../services/billing')>('../services/billing');
  return {
    ...actual,
    listPlatformPlans: (...args: unknown[]) => listPlatformPlans(...args),
    createPlatformPlan: (...args: unknown[]) => createPlatformPlan(...args),
    publishPlatformPlanVersion: (...args: unknown[]) => publishPlatformPlanVersion(...args),
    getSuperAgencyBillingEntitlements: (...args: unknown[]) =>
      getSuperAgencyBillingEntitlements(...args),
    listSuperAgencyCheckoutPlans: (...args: unknown[]) => listSuperAgencyCheckoutPlans(...args),
    getSuperAgencyUsage: (...args: unknown[]) => getSuperAgencyUsage(...args),
    listSuperAgencyInvoices: (...args: unknown[]) => listSuperAgencyInvoices(...args),
    getSuperAgencyPaymentMethod: (...args: unknown[]) => getSuperAgencyPaymentMethod(...args),
    listSuperAgencyBillingHistory: (...args: unknown[]) => listSuperAgencyBillingHistory(...args),
  };
});

const superAgencies: SessionSuperAgency[] = [
  {
    id: 'super-agency-1',
    name: 'Super Agency One',
    slug: 'super-agency-one',
    status: 'ACTIVE',
    role: 'SUPER_AGENCY_OWNER',
    membershipId: 'super-membership-1',
    agencies: [],
  },
];

describe('phase 15.1 billing foundation UI', () => {
  beforeEach(() => {
    localStorage.clear();
    listPlatformPlans.mockReset();
    createPlatformPlan.mockReset();
    publishPlatformPlanVersion.mockReset();
    getSuperAgencyBillingEntitlements.mockReset();
    listSuperAgencyCheckoutPlans.mockReset();
    getSuperAgencyUsage.mockReset();
    listSuperAgencyInvoices.mockReset();
    getSuperAgencyPaymentMethod.mockReset();
    listSuperAgencyBillingHistory.mockReset();
    listPlatformPlans.mockResolvedValue({
      items: [
        {
          id: 'plan-1',
          key: 'professional',
          type: 'PUBLIC',
          displayName: 'Professional',
          description: null,
          status: 'DRAFT',
          createdAt: '',
          updatedAt: '',
          versions: [
            {
              id: 'version-1',
              versionNumber: 1,
              status: 'DRAFT',
              publishedAt: null,
              archivedAt: null,
            },
          ],
        },
      ],
      page: 1,
      pageSize: 25,
      total: 1,
      totalPages: 1,
    });
    createPlatformPlan.mockResolvedValue({ id: 'plan-2' });
    publishPlatformPlanVersion.mockResolvedValue({ id: 'plan-1' });
    getSuperAgencyBillingEntitlements.mockResolvedValue({
      superAgencyId: 'super-agency-1',
      hasCurrentSubscription: false,
      subscription: null,
      features: [],
      limits: [],
    });
    getSuperAgencyUsage.mockResolvedValue({
      superAgencyId: 'super-agency-1',
      enforcementMode: 'UNMANAGED',
      resources: [],
    });
    listSuperAgencyCheckoutPlans.mockResolvedValue([]);
    listSuperAgencyInvoices.mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 25,
      total: 0,
      totalPages: 0,
    });
    getSuperAgencyPaymentMethod.mockResolvedValue({ paymentMethod: null });
    listSuperAgencyBillingHistory.mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 25,
      total: 0,
      totalPages: 0,
    });
    useSessionStore.setState({
      hydrated: true,
      accessToken: 'token',
      csrfToken: 'csrf-token',
      user: { id: 'user-1', email: 'owner@example.test' },
      superAgencies,
      agencies: [],
      selectedSuperAgencyId: 'super-agency-1',
      selectedAgencyId: null,
      selectedWorkspaceId: null,
    });
  });

  it('adds billing only to Platform and Super Agency navigation, not Agency or Workspace purchase flows', () => {
    expect(dashboardConfigs['super-admin'].groups.flatMap((group) => group.items)).toEqual(
      expect.arrayContaining([expect.objectContaining({ href: '/super-admin/plans' })]),
    );
    expect(dashboardConfigs['super-agency'].groups.flatMap((group) => group.items)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: '/super-agency/billing',
          requiredPermissions: ['billing.subscription.view'],
        }),
      ]),
    );
    expect(dashboardConfigs.agency.groups.flatMap((group) => group.items)).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ href: expect.stringContaining('billing') }),
      ]),
    );
    expect(dashboardConfigs.workspace.groups.flatMap((group) => group.items)).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ href: expect.stringContaining('billing') }),
      ]),
    );
  });

  it('renders Platform plan catalog management without Stripe/payment UI', async () => {
    render(
      <Providers>
        <PlatformPlansPage />
      </Providers>,
    );

    expect(await screen.findByRole('heading', { name: 'Master Plans' })).toBeInTheDocument();
    expect(await screen.findByText('Professional')).toBeInTheDocument();
    expect(await screen.findByText('professional | PUBLIC')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /checkout|pay|card/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/card/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Plan key'), { target: { value: 'starter' } });
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Starter' } });
    fireEvent.click(screen.getByRole('button', { name: /create/i }));

    await waitFor(() =>
      expect(createPlatformPlan).toHaveBeenCalledWith({
        key: 'starter',
        displayName: 'Starter',
      }),
    );
  });

  it('renders Super Agency billing read-only and keeps query keys scoped by Super Agency id', async () => {
    render(
      <Providers>
        <SuperAgencyBillingPage />
      </Providers>,
    );

    expect(await screen.findByRole('heading', { name: 'Billing' })).toBeInTheDocument();
    expect(screen.getByText('Choose a public plan')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /checkout|pay now|card number/i }),
    ).not.toBeInTheDocument();
    expect(getSuperAgencyBillingEntitlements).toHaveBeenCalledWith('super-agency-1');
    expect(billingKeys.superAgencyEntitlements('super-agency-2')).toEqual([
      'super-agency',
      'super-agency-2',
      'billing',
      'entitlements',
    ]);
  });
});
