import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../contexts/providers';
import { DashboardRouteChrome } from '../components/layout/DashboardRouteChrome';
import { dashboardConfigs } from '../components/navigation/navigation-config';
import { SuperAgencyDashboardPage } from '../components/super-agency/SuperAgencyPages';
import { superAgencyKeys } from '../services/super-agencies';
import { useSessionStore, type SessionSuperAgency } from '../stores/session';

const replace = vi.fn();
const getSuperAgencyContext = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/super-agency',
}));

vi.mock('../services/super-agencies', async () => {
  const actual = await vi.importActual<typeof import('../services/super-agencies')>(
    '../services/super-agencies',
  );
  return {
    ...actual,
    getSuperAgencyContext: (...args: unknown[]) => getSuperAgencyContext(...args),
  };
});

vi.mock('../services/workspace-roles', () => ({
  rolesKeys: {
    all: (workspaceId: string | null) => ['workspace', workspaceId, 'roles'],
  },
  listWorkspaceRoles: vi.fn(),
}));

const superAgencies: SessionSuperAgency[] = [
  {
    id: 'super-agency-1',
    name: 'Super Agency One',
    slug: 'super-agency-one',
    status: 'ACTIVE',
    role: 'SUPER_AGENCY_OWNER',
    membershipId: 'super-membership-1',
    agencies: [{ id: 'agency-1', name: 'Agency One', slug: 'agency-one', status: 'ACTIVE' }],
  },
  {
    id: 'super-agency-2',
    name: 'Super Agency Two',
    slug: 'super-agency-two',
    status: 'ACTIVE',
    role: 'SUPER_AGENCY_MEMBER',
    membershipId: 'super-membership-2',
    agencies: [],
  },
];

describe('phase 14.6.4 Super Agency shell', () => {
  beforeEach(() => {
    localStorage.clear();
    replace.mockClear();
    getSuperAgencyContext.mockReset();
    getSuperAgencyContext.mockResolvedValue({
      id: 'super-agency-1',
      name: 'Super Agency One',
      slug: 'super-agency-one',
      status: 'ACTIVE',
      roleId: 'role-1',
      roleName: 'SUPER_AGENCY_OWNER',
      membershipId: 'super-membership-1',
      permissions: ['super_agency.view', 'super_agency.members.view', 'super_agency.roles.view'],
      counts: {
        agencies: 1,
        workspaces: 2,
        activeMembers: 3,
        pendingInvitations: 1,
      },
      agencies: [{ id: 'agency-1', name: 'Agency One', slug: 'agency-one', status: 'ACTIVE' }],
      createdAt: '',
      updatedAt: '',
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

  it('adds a separate Super Agency navigation scope without changing Platform scope', () => {
    expect(dashboardConfigs['super-agency'].basePath).toBe('/super-agency');
    expect(dashboardConfigs['super-admin'].basePath).toBe('/super-admin/dashboard');
    expect(dashboardConfigs['super-admin'].title).toBe('Super Admin Dashboard');

    const superAgencyLabels = dashboardConfigs['super-agency'].groups.flatMap((group) =>
      group.items.map((item) => item.labelKey),
    );
    expect(superAgencyLabels).toContain('navigation.members');
    expect(superAgencyLabels).toContain('navigation.roles');
    expect(superAgencyLabels).toContain('navigation.globalLeaderboard');
    expect(superAgencyLabels).toContain('navigation.billing');
    expect(superAgencyLabels).not.toContain('navigation.files');
    expect(superAgencyLabels).not.toContain('navigation.gamification');
    expect(superAgencyLabels).not.toContain('navigation.developerAccess');
  });

  it('renders the Super Agency shell with permission-aware navigation and no workspace widgets', async () => {
    render(
      <Providers>
        <DashboardRouteChrome scope="super-agency">
          <p>super agency content</p>
        </DashboardRouteChrome>
      </Providers>,
    );

    expect(await screen.findByText('super agency content')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /members/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /roles/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /global leaderboard/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /billing/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /files/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /notifications/i })).not.toBeInTheDocument();
  });

  it('requires explicit Super Agency selection when multiple memberships exist', async () => {
    useSessionStore.setState({
      selectedSuperAgencyId: null,
      superAgencies,
    });

    render(
      <Providers>
        <SuperAgencyDashboardPage />
      </Providers>,
    );

    expect(await screen.findByRole('heading', { name: 'Switch Super Agency' })).toBeInTheDocument();
    expect(getSuperAgencyContext).not.toHaveBeenCalled();
  });

  it('hides child agency dashboard data without agency foundation permission', async () => {
    render(
      <Providers>
        <SuperAgencyDashboardPage />
      </Providers>,
    );

    expect(await screen.findByText('Super Agency One')).toBeInTheDocument();
    expect(screen.getByText('Active Members')).toBeInTheDocument();
    expect(screen.queryByText('Agency One')).not.toBeInTheDocument();
    expect(screen.queryByText('agency-one')).not.toBeInTheDocument();
    expect(screen.queryByText('Child Agencies')).not.toBeInTheDocument();
    expect(screen.queryByText('Workspaces')).not.toBeInTheDocument();
    expect(screen.queryByText('Pending Invitations')).not.toBeInTheDocument();
  });

  it('clears child tenant selections when switching Super Agency and stores no permission authority', () => {
    useSessionStore.setState({
      superAgencies,
      selectedSuperAgencyId: null,
      selectedAgencyId: 'agency-1',
      selectedWorkspaceId: 'workspace-1',
    });

    useSessionStore.getState().setSuperAgency('super-agency-2');

    const stored = JSON.parse(localStorage.getItem('zea-play-session-ui') ?? '{}') as Record<
      string,
      unknown
    >;
    expect(useSessionStore.getState().selectedSuperAgencyId).toBe('super-agency-2');
    expect(useSessionStore.getState().selectedAgencyId).toBeNull();
    expect(useSessionStore.getState().selectedWorkspaceId).toBeNull();
    expect(stored.selectedSuperAgencyId).toBe('super-agency-2');
    expect(stored.permissions).toBeUndefined();
  });

  it('uses Super Agency scoped query keys with the tenant id', () => {
    expect(superAgencyKeys.context('super-agency-1')).toEqual([
      'super-agency',
      'super-agency-1',
      'context',
    ]);
    expect(superAgencyKeys.members('super-agency-2', { search: 'owner' })).toEqual([
      'super-agency',
      'super-agency-2',
      'members',
      { page: 1, pageSize: 25, search: 'owner' },
    ]);
  });
});
