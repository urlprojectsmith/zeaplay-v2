import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SuperAgencyBillingPage } from '../components/billing/BillingPages';
import { Providers } from '../contexts/providers';
import { useSessionStore } from '../stores/session';

const getSuperAgencyBillingEntitlements = vi.fn();
const listSuperAgencyCheckoutPlans = vi.fn();
const getSuperAgencyUsage = vi.fn();
const listSuperAgencyInvoices = vi.fn();
const refreshSuperAgencyInvoices = vi.fn();
const getSuperAgencyPaymentMethod = vi.fn();
const listSuperAgencyBillingHistory = vi.fn();
const createPortalSession = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => '/super-agency/billing',
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock('../services/billing', async () => {
  const actual = await vi.importActual<typeof import('../services/billing')>('../services/billing');
  return {
    ...actual,
    getSuperAgencyBillingEntitlements: (...args: unknown[]) =>
      getSuperAgencyBillingEntitlements(...args),
    listSuperAgencyCheckoutPlans: (...args: unknown[]) => listSuperAgencyCheckoutPlans(...args),
    getSuperAgencyUsage: (...args: unknown[]) => getSuperAgencyUsage(...args),
    listSuperAgencyInvoices: (...args: unknown[]) => listSuperAgencyInvoices(...args),
    refreshSuperAgencyInvoices: (...args: unknown[]) => refreshSuperAgencyInvoices(...args),
    getSuperAgencyPaymentMethod: (...args: unknown[]) => getSuperAgencyPaymentMethod(...args),
    listSuperAgencyBillingHistory: (...args: unknown[]) => listSuperAgencyBillingHistory(...args),
    createPortalSession: (...args: unknown[]) => createPortalSession(...args),
  };
});

describe('phase 15.4 billing UI', () => {
  beforeEach(() => {
    localStorage.clear();
    getSuperAgencyBillingEntitlements.mockReset();
    listSuperAgencyCheckoutPlans.mockReset();
    getSuperAgencyUsage.mockReset();
    listSuperAgencyInvoices.mockReset();
    refreshSuperAgencyInvoices.mockReset();
    getSuperAgencyPaymentMethod.mockReset();
    listSuperAgencyBillingHistory.mockReset();
    createPortalSession.mockReset();

    getSuperAgencyBillingEntitlements.mockResolvedValue({
      superAgencyId: 'super-agency-1',
      hasCurrentSubscription: true,
      subscription: null,
      features: [],
      limits: [],
    });
    listSuperAgencyCheckoutPlans.mockResolvedValue([]);
    getSuperAgencyUsage.mockResolvedValue({
      superAgencyId: 'super-agency-1',
      enforcementMode: 'MANAGED',
      resources: [],
    });
    listSuperAgencyInvoices.mockResolvedValue({
      items: [
        {
          id: 'invoice-1',
          provider: 'STRIPE',
          providerInvoiceId: 'in_123',
          providerSubscriptionId: 'sub_123',
          invoiceNumber: 'INV-0001',
          currency: 'USD',
          status: 'open',
          amountDueMinor: '2500',
          amountPaidMinor: '0',
          amountRemainingMinor: '2500',
          providerCreatedAt: '2026-09-24T00:00:00.000Z',
          dueAt: null,
          periodStart: null,
          periodEnd: null,
          finalizedAt: null,
          paidAt: null,
          voidedAt: null,
          hostedInvoiceUrl: 'https://billing.stripe.com/invoice/in_123',
          invoicePdfUrl: 'https://pay.stripe.com/invoice/in_123/pdf',
          lastSyncedAt: '2026-09-24T00:00:00.000Z',
        },
      ],
      page: 1,
      pageSize: 25,
      total: 1,
      totalPages: 1,
    });
    refreshSuperAgencyInvoices.mockResolvedValue({ synced: 1 });
    getSuperAgencyPaymentMethod.mockResolvedValue({
      paymentMethod: {
        provider: 'STRIPE',
        type: 'card',
        displayBrand: 'Visa',
        last4: '4242',
        expMonth: 12,
        expYear: 2030,
      },
    });
    listSuperAgencyBillingHistory.mockResolvedValue({
      items: [
        {
          id: 'history-1',
          event: 'PAYMENT_GRACE_STARTED',
          label: 'Payment grace period started',
          actorType: 'SYSTEM',
          actorUserId: null,
          createdAt: '2026-09-24T00:00:00.000Z',
        },
      ],
      page: 1,
      pageSize: 25,
      total: 1,
      totalPages: 1,
    });
    createPortalSession.mockResolvedValue({ url: 'https://billing.stripe.com/session/test' });
    useSessionStore.setState({
      hydrated: true,
      accessToken: 'token',
      csrfToken: 'csrf-token',
      user: { id: 'user-1', email: 'owner@example.test' },
      superAgencies: [
        {
          id: 'super-agency-1',
          name: 'Super Agency',
          slug: 'super-agency',
          status: 'ACTIVE',
          role: 'OWNER',
          membershipId: 'super-member-1',
          agencies: [],
        },
      ],
      agencies: [],
      selectedSuperAgencyId: 'super-agency-1',
      selectedAgencyId: null,
      selectedWorkspaceId: null,
    });
  });

  it('renders safe payment details, invoice projection, history, and invoice refresh', async () => {
    render(
      <Providers>
        <SuperAgencyBillingPage />
      </Providers>,
    );

    expect(await screen.findByText('Visa ending 4242')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Payment Method' }));
    expect(screen.getByText('Visa')).toBeInTheDocument();
    expect(screen.getByText('12/2030')).toBeInTheDocument();
    expect(screen.queryByText(/pm_|cus_|secret/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Invoices' }));
    expect(await screen.findByText('INV-0001')).toBeInTheDocument();
    expect(screen.getAllByText('$25.00').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /hosted invoice/i })).toHaveAttribute(
      'href',
      'https://billing.stripe.com/invoice/in_123',
    );
    fireEvent.click(screen.getByRole('button', { name: /refresh invoices/i }));
    await waitFor(() => expect(refreshSuperAgencyInvoices).toHaveBeenCalledWith('super-agency-1'));

    fireEvent.click(screen.getByRole('button', { name: 'Billing History' }));
    expect(await screen.findByText('Payment grace period started')).toBeInTheDocument();
  });
});
