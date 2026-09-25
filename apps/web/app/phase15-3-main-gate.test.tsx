import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../contexts/providers';
import { CommercialFeatureBoundary } from '../components/layout/CommercialFeatureBoundary';
import {
  featureEnabled,
  resolveCommercialNavItem,
  resolveRouteFeature,
} from '../components/navigation/commercial-entitlements';
import { dashboardConfigs } from '../components/navigation/navigation-config';
import { billingKeys } from '../services/billing';
import { useSessionStore } from '../stores/session';

let pathname = '/workspace/tasks';
const getWorkspaceBillingEntitlements = vi.fn();
const getSuperAgencyBillingEntitlements = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock('../services/billing', async () => {
  const actual = await vi.importActual<typeof import('../services/billing')>('../services/billing');
  return {
    ...actual,
    getWorkspaceBillingEntitlements: (...args: unknown[]) =>
      getWorkspaceBillingEntitlements(...args),
    getSuperAgencyBillingEntitlements: (...args: unknown[]) =>
      getSuperAgencyBillingEntitlements(...args),
  };
});

describe('phase 15.3 locked navigation and direct routes', () => {
  beforeEach(() => {
    localStorage.clear();
    pathname = '/workspace/tasks';
    getWorkspaceBillingEntitlements.mockReset();
    getSuperAgencyBillingEntitlements.mockReset();
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
          agencies: [{ id: 'agency-1', name: 'Agency', slug: 'agency', status: 'ACTIVE' }],
        },
      ],
      agencies: [
        {
          id: 'agency-1',
          name: 'Agency',
          slug: 'agency',
          status: 'ACTIVE',
          role: 'ADMIN',
          membershipId: 'agency-member-1',
          workspaces: [
            {
              id: 'workspace-1',
              agencyId: 'agency-1',
              name: 'Workspace',
              slug: 'workspace',
              timezone: 'UTC',
              status: 'ACTIVE',
              role: 'ADMIN',
              membershipId: 'workspace-member-1',
            },
          ],
        },
      ],
      selectedSuperAgencyId: null,
      selectedAgencyId: 'agency-1',
      selectedWorkspaceId: 'workspace-1',
    });
  });

  it('locks commercially disabled nav items without treating RBAC as commercial state', () => {
    const tasksItem = dashboardConfigs.workspace.groups
      .flatMap((group) => group.items)
      .find((item) => item.href === '/workspace/tasks');
    const locked = resolveCommercialNavItem(tasksItem!, {
      hasCurrentSubscription: true,
      features: [{ key: 'tasks.enabled', enabled: false }],
    });
    const unmanaged = resolveCommercialNavItem(tasksItem!, {
      hasCurrentSubscription: false,
      features: [],
    });

    expect(locked.locked).toBe(true);
    expect(locked.badge).toBe('Locked');
    expect(unmanaged.locked).toBeUndefined();
    expect(
      featureEnabled(
        { hasCurrentSubscription: true, features: [{ key: 'tasks', enabled: true }] },
        'tasks.enabled',
      ),
    ).toBe(true);
  });

  it('maps direct Workspace module routes to the same commercial feature keys', () => {
    expect(resolveRouteFeature('workspace', '/workspace/tasks/recurring')).toMatchObject({
      featureKey: 'tasks.enabled',
    });
    expect(resolveRouteFeature('workspace', '/workspace/files')).toMatchObject({
      featureKey: 'files.enabled',
    });
    expect(resolveRouteFeature('agency', '/agency/usage')).toBeNull();
  });

  it('renders locked direct-route UX instead of editable module content', async () => {
    getWorkspaceBillingEntitlements.mockResolvedValue({
      superAgencyId: 'super-agency-1',
      hasCurrentSubscription: true,
      subscription: null,
      features: [{ key: 'tasks.enabled', enabled: false }],
      limits: [],
    });

    render(
      <Providers>
        <CommercialFeatureBoundary scope="workspace">
          <div>Editable Tasks</div>
        </CommercialFeatureBoundary>
      </Providers>,
    );

    expect(await screen.findByText('Feature Locked')).toBeInTheDocument();
    expect(screen.getByText('Unavailable on Current Plan')).toBeInTheDocument();
    expect(
      screen.getByText('Contact your billing administrator to request access.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Editable Tasks')).not.toBeInTheDocument();
    expect(getWorkspaceBillingEntitlements).toHaveBeenCalledWith('workspace-1');
  });

  it('offers billing management only on Super Agency locked routes', async () => {
    pathname = '/super-agency/gamification';
    useSessionStore.setState({
      selectedSuperAgencyId: 'super-agency-1',
      selectedAgencyId: null,
      selectedWorkspaceId: null,
    });
    getSuperAgencyBillingEntitlements.mockResolvedValue({
      superAgencyId: 'super-agency-1',
      hasCurrentSubscription: true,
      subscription: null,
      features: [{ key: 'gamification.enabled', enabled: false }],
      limits: [],
    });

    render(
      <Providers>
        <CommercialFeatureBoundary scope="super-agency">
          <div>Editable Gamification</div>
        </CommercialFeatureBoundary>
      </Providers>,
    );

    expect(await screen.findByRole('link', { name: 'Manage Plan' })).toHaveAttribute(
      'href',
      '/super-agency/billing',
    );
    await waitFor(() =>
      expect(screen.queryByText('Editable Gamification')).not.toBeInTheDocument(),
    );
    expect(billingKeys.workspaceEntitlements('workspace-x')).toEqual([
      'workspace',
      'workspace-x',
      'billing',
      'entitlements',
    ]);
  });
});
