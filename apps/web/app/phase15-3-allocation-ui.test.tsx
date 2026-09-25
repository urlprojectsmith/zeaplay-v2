import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../contexts/providers';
import {
  AgencyPlanUsagePage,
  SuperAgencyBillingPage,
  WorkspaceUsageLimitsPage,
} from '../components/billing/BillingPages';
import { billingKeys } from '../services/billing';
import { useSessionStore } from '../stores/session';

const getSuperAgencyBillingEntitlements = vi.fn();
const listSuperAgencyCheckoutPlans = vi.fn();
const getSuperAgencyUsage = vi.fn();
const getAgencyUsage = vi.fn();
const getWorkspaceUsage = vi.fn();
const updateAgencyAllocation = vi.fn();
const updateWorkspaceAllocation = vi.fn();
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
    getSuperAgencyBillingEntitlements: (...args: unknown[]) =>
      getSuperAgencyBillingEntitlements(...args),
    listSuperAgencyCheckoutPlans: (...args: unknown[]) => listSuperAgencyCheckoutPlans(...args),
    getSuperAgencyUsage: (...args: unknown[]) => getSuperAgencyUsage(...args),
    getAgencyUsage: (...args: unknown[]) => getAgencyUsage(...args),
    getWorkspaceUsage: (...args: unknown[]) => getWorkspaceUsage(...args),
    updateAgencyAllocation: (...args: unknown[]) => updateAgencyAllocation(...args),
    updateWorkspaceAllocation: (...args: unknown[]) => updateWorkspaceAllocation(...args),
    listSuperAgencyInvoices: (...args: unknown[]) => listSuperAgencyInvoices(...args),
    getSuperAgencyPaymentMethod: (...args: unknown[]) => getSuperAgencyPaymentMethod(...args),
    listSuperAgencyBillingHistory: (...args: unknown[]) => listSuperAgencyBillingHistory(...args),
  };
});

describe('phase 15.3 allocation UI', () => {
  beforeEach(() => {
    localStorage.clear();
    getSuperAgencyBillingEntitlements.mockReset();
    listSuperAgencyCheckoutPlans.mockReset();
    getSuperAgencyUsage.mockReset();
    getAgencyUsage.mockReset();
    getWorkspaceUsage.mockReset();
    updateAgencyAllocation.mockReset();
    updateWorkspaceAllocation.mockReset();
    listSuperAgencyInvoices.mockReset();
    getSuperAgencyPaymentMethod.mockReset();
    listSuperAgencyBillingHistory.mockReset();
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
      resources: [
        resource('WORKSPACES', '16', '20', false, '4', 'WITHIN_LIMIT', {
          allocatedToChildren: '16',
          unallocated: '4',
        }),
      ],
    });
    getAgencyUsage.mockResolvedValue({
      agencyId: 'agency-1',
      superAgencyId: 'super-agency-1',
      resources: [
        resource('WORKSPACES', '16', '15', false, '0', 'OVER_LIMIT'),
        resource('STORAGE_BYTES', '0', null, true, null, 'WITHIN_LIMIT'),
      ],
    });
    getWorkspaceUsage.mockResolvedValue({
      workspaceId: 'workspace-1',
      agencyId: 'agency-1',
      superAgencyId: 'super-agency-1',
      resources: [resource('WORKSPACE_MEMBERSHIPS', '4', '5', false, '1', 'WITHIN_LIMIT')],
    });
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
    updateAgencyAllocation.mockResolvedValue({});
    updateWorkspaceAllocation.mockResolvedValue({});
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
          agencies: [{ id: 'agency-1', name: 'Agency One', slug: 'agency-one', status: 'ACTIVE' }],
        },
      ],
      agencies: [
        {
          id: 'agency-1',
          name: 'Agency One',
          slug: 'agency-one',
          status: 'ACTIVE',
          role: 'ADMIN',
          membershipId: 'agency-member-1',
          workspaces: [
            {
              id: 'workspace-1',
              agencyId: 'agency-1',
              name: 'Workspace One',
              slug: 'workspace-one',
              timezone: 'UTC',
              status: 'ACTIVE',
              role: 'ADMIN',
              membershipId: 'workspace-member-1',
            },
          ],
        },
      ],
      selectedSuperAgencyId: 'super-agency-1',
      selectedAgencyId: null,
      selectedWorkspaceId: null,
    });
  });

  it('renders Super Agency allocation grid with usage, remaining, over-limit and unlimited states', async () => {
    render(
      <Providers>
        <SuperAgencyBillingPage />
      </Providers>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Agency Allocations' }));
    expect(await screen.findByRole('heading', { name: 'Agency Allocations' })).toBeInTheDocument();
    expect(screen.getByText('Agency One')).toBeInTheDocument();
    expect(await screen.findByText('OVER LIMIT')).toBeInTheDocument();
    expect(await screen.findByText(/Used 16 \/ 15/)).toBeInTheDocument();
    expect(screen.getByText(/Remaining 0/)).toBeInTheDocument();
    expect(screen.getByText(/Parent capacity 20/)).toBeInTheDocument();
    expect(screen.getByText(/Allocated 16/)).toBeInTheDocument();
    expect(screen.getByText(/Available 4/)).toBeInTheDocument();
    expect(screen.getAllByText(/Unlimited/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/stripe customer/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/card number|subscription price|stripe customer id/i),
    ).not.toBeInTheDocument();
  });

  it('rejects invalid allocation edits in the frontend and submits valid finite changes', async () => {
    render(
      <Providers>
        <SuperAgencyBillingPage />
      </Providers>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Agency Allocations' }));
    const allocation = await screen.findByLabelText('WORKSPACES allocation');
    await screen.findByText(/Used 16 \/ 15/);
    const editor = allocation.parentElement?.parentElement as HTMLElement;
    const save = within(editor).getByRole('button', {
      name: /save/i,
    });

    fireEvent.change(allocation, { target: { value: '-1' } });
    expect(save).toBeDisabled();
    fireEvent.change(allocation, { target: { value: '3.5' } });
    expect(save).toBeDisabled();
    fireEvent.change(allocation, { target: { value: '20' } });
    expect(save).toBeDisabled();
    expect(screen.getByText(/exceeds available parent capacity/i)).toBeInTheDocument();
    fireEvent.change(allocation, { target: { value: '14' } });
    expect(save).not.toBeDisabled();
    fireEvent.click(save);

    await waitFor(() =>
      expect(updateAgencyAllocation).toHaveBeenCalledWith('super-agency-1', 'agency-1', {
        rowId: 'agency-1',
        resourceKey: 'WORKSPACES',
        allocated: 14,
        unlimited: false,
      }),
    );
  });

  it('renders Agency Workspace allocation only for descendant Workspaces and uses scoped cache keys', async () => {
    useSessionStore.setState({
      selectedSuperAgencyId: null,
      selectedAgencyId: 'agency-1',
      selectedWorkspaceId: 'workspace-1',
    });

    render(
      <Providers>
        <AgencyPlanUsagePage />
      </Providers>,
    );

    expect(
      await screen.findByRole('heading', { name: 'Workspace Allocations' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Workspace One')).toBeInTheDocument();
    expect(screen.queryByText('Foreign Workspace')).not.toBeInTheDocument();
    expect(billingKeys.superAgencyUsage('same-id')).toEqual([
      'super-agency',
      'same-id',
      'billing',
      'usage',
    ]);
    expect(billingKeys.agencyUsage('same-id')).toEqual(['agency', 'same-id', 'billing', 'usage']);
    expect(billingKeys.workspaceUsage('same-id')).toEqual([
      'workspace',
      'same-id',
      'billing',
      'usage',
    ]);
  });

  it('keeps Super Agency delayed responses scoped to the selected Super Agency', async () => {
    const superAgencyA = deferred<unknown>();
    const superAgencyB = deferred<unknown>();
    getSuperAgencyUsage.mockImplementation((id: string) =>
      id === 'super-agency-a' ? superAgencyA.promise : superAgencyB.promise,
    );
    useSessionStore.setState({
      superAgencies: [
        {
          id: 'super-agency-a',
          name: 'Super Agency A',
          slug: 'super-agency-a',
          status: 'ACTIVE',
          role: 'OWNER',
          membershipId: 'super-member-a',
          agencies: [],
        },
        {
          id: 'super-agency-b',
          name: 'Super Agency B',
          slug: 'super-agency-b',
          status: 'ACTIVE',
          role: 'OWNER',
          membershipId: 'super-member-b',
          agencies: [],
        },
      ],
      selectedSuperAgencyId: 'super-agency-a',
    });

    render(
      <Providers>
        <SuperAgencyBillingPage />
      </Providers>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Usage' }));
    act(() => {
      useSessionStore.setState({ selectedSuperAgencyId: 'super-agency-b' });
    });
    act(() => {
      superAgencyB.resolve({
        superAgencyId: 'super-agency-b',
        enforcementMode: 'MANAGED',
        resources: [resource('WORKSPACES', '22', '30', false, '8', 'WITHIN_LIMIT')],
      });
    });

    expect(await screen.findByText('22')).toBeInTheDocument();
    act(() => {
      superAgencyA.resolve({
        superAgencyId: 'super-agency-a',
        enforcementMode: 'MANAGED',
        resources: [resource('WORKSPACES', '11', '20', false, '9', 'WITHIN_LIMIT')],
      });
    });
    await waitFor(() => expect(screen.queryByText('11')).not.toBeInTheDocument());
  });

  it('keeps Agency delayed responses scoped to the selected Agency', async () => {
    const agencyA = deferred<unknown>();
    const agencyB = deferred<unknown>();
    getAgencyUsage.mockImplementation((id: string) =>
      id === 'agency-a' ? agencyA.promise : agencyB.promise,
    );
    useSessionStore.setState({
      agencies: [
        {
          id: 'agency-a',
          name: 'Agency A',
          slug: 'agency-a',
          status: 'ACTIVE',
          role: 'ADMIN',
          membershipId: 'agency-member-a',
          workspaces: [],
        },
        {
          id: 'agency-b',
          name: 'Agency B',
          slug: 'agency-b',
          status: 'ACTIVE',
          role: 'ADMIN',
          membershipId: 'agency-member-b',
          workspaces: [],
        },
      ],
      selectedSuperAgencyId: null,
      selectedAgencyId: 'agency-a',
      selectedWorkspaceId: null,
    });

    render(
      <Providers>
        <AgencyPlanUsagePage />
      </Providers>,
    );

    act(() => {
      useSessionStore.setState({ selectedAgencyId: 'agency-b' });
    });
    act(() => {
      agencyB.resolve({
        agencyId: 'agency-b',
        superAgencyId: 'super-agency-1',
        resources: [resource('STORAGE_BYTES', '888', '1000', false, '112', 'WITHIN_LIMIT')],
      });
    });

    expect(await screen.findByText('888')).toBeInTheDocument();
    act(() => {
      agencyA.resolve({
        agencyId: 'agency-a',
        superAgencyId: 'super-agency-1',
        resources: [resource('STORAGE_BYTES', '111', '1000', false, '889', 'WITHIN_LIMIT')],
      });
    });
    await waitFor(() => expect(screen.queryByText('111')).not.toBeInTheDocument());
  });

  it('keeps Workspace delayed responses scoped to the selected Workspace', async () => {
    const workspaceA = deferred<unknown>();
    const workspaceB = deferred<unknown>();
    getWorkspaceUsage.mockImplementation((id: string) =>
      id === 'workspace-a' ? workspaceA.promise : workspaceB.promise,
    );
    useSessionStore.setState({
      selectedSuperAgencyId: null,
      selectedAgencyId: null,
      selectedWorkspaceId: 'workspace-a',
    });

    render(
      <Providers>
        <WorkspaceUsageLimitsPage />
      </Providers>,
    );

    act(() => {
      useSessionStore.setState({ selectedWorkspaceId: 'workspace-b' });
    });
    act(() => {
      workspaceB.resolve({
        workspaceId: 'workspace-b',
        agencyId: 'agency-1',
        superAgencyId: 'super-agency-1',
        resources: [resource('WORKSPACE_MEMBERSHIPS', '333', '500', false, '167', 'WITHIN_LIMIT')],
      });
    });

    expect(await screen.findByText('333')).toBeInTheDocument();
    act(() => {
      workspaceA.resolve({
        workspaceId: 'workspace-a',
        agencyId: 'agency-1',
        superAgencyId: 'super-agency-1',
        resources: [resource('WORKSPACE_MEMBERSHIPS', '222', '500', false, '278', 'WITHIN_LIMIT')],
      });
    });
    await waitFor(() => expect(screen.queryByText('222')).not.toBeInTheDocument());
  });

  it('clears delayed Workspace responses after logout reset', async () => {
    const workspaceUsage = deferred<unknown>();
    getWorkspaceUsage.mockReturnValue(workspaceUsage.promise);
    useSessionStore.setState({ selectedWorkspaceId: 'workspace-1' });

    render(
      <Providers>
        <WorkspaceUsageLimitsPage />
      </Providers>,
    );

    act(() => {
      useSessionStore.setState({ accessToken: null, selectedWorkspaceId: null });
    });
    act(() => {
      workspaceUsage.resolve({
        workspaceId: 'workspace-1',
        agencyId: 'agency-1',
        superAgencyId: 'super-agency-1',
        resources: [resource('WORKSPACE_MEMBERSHIPS', '777', '1000', false, '223', 'WITHIN_LIMIT')],
      });
    });

    expect(await screen.findByText('Switch Workspace')).toBeInTheDocument();
    expect(screen.queryByText('777')).not.toBeInTheDocument();
  });
});

function resource(
  resourceKey: string,
  used: string,
  limit: string | null,
  unlimited: boolean,
  remaining: string | null,
  status: 'WITHIN_LIMIT' | 'OVER_LIMIT',
  allocation?: {
    allocatedToChildren?: string | null;
    childAllocationUnlimited?: boolean;
    unallocated?: string | null;
  },
) {
  return {
    resourceKey,
    dimension: 'LIVE_CAPACITY',
    used,
    limit,
    unlimited,
    configured: true,
    remaining,
    status,
    ...allocation,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
