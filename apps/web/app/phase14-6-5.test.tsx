import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '../contexts/providers';
import { dashboardConfigs } from '../components/navigation/navigation-config';
import {
  SuperAgencyAgenciesPage,
  SuperAgencyAgencyDetailPage,
} from '../components/super-agency/SuperAgencyPages';
import { superAgencyKeys } from '../services/super-agencies';
import { useSessionStore, type SessionSuperAgency } from '../stores/session';

const getSuperAgencyContext = vi.fn();
const listSuperAgencyAgencies = vi.fn();
const createSuperAgencyAgency = vi.fn();
const getSuperAgencyAgency = vi.fn();
const updateSuperAgencyAgency = vi.fn();
const listSuperAgencyAgencyWorkspaces = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/super-agency/agencies',
}));

vi.mock('../services/super-agencies', async () => {
  const actual = await vi.importActual<typeof import('../services/super-agencies')>(
    '../services/super-agencies',
  );
  return {
    ...actual,
    getSuperAgencyContext: (...args: unknown[]) => getSuperAgencyContext(...args),
    listSuperAgencyAgencies: (...args: unknown[]) => listSuperAgencyAgencies(...args),
    createSuperAgencyAgency: (...args: unknown[]) => createSuperAgencyAgency(...args),
    getSuperAgencyAgency: (...args: unknown[]) => getSuperAgencyAgency(...args),
    updateSuperAgencyAgency: (...args: unknown[]) => updateSuperAgencyAgency(...args),
    listSuperAgencyAgencyWorkspaces: (...args: unknown[]) =>
      listSuperAgencyAgencyWorkspaces(...args),
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
];

const agency = {
  id: 'agency-1',
  superAgencyId: 'super-agency-1',
  name: 'Agency One',
  slug: 'agency-one',
  status: 'ACTIVE',
  createdById: 'user-1',
  createdAt: '2026-09-25T00:00:00.000Z',
  updatedAt: '2026-09-25T00:00:00.000Z',
  counts: { members: 2, workspaces: 1 },
};

describe('phase 14.6.5 Super Agency Agency management', () => {
  beforeEach(() => {
    localStorage.clear();
    getSuperAgencyContext.mockReset();
    listSuperAgencyAgencies.mockReset();
    createSuperAgencyAgency.mockReset();
    getSuperAgencyAgency.mockReset();
    updateSuperAgencyAgency.mockReset();
    listSuperAgencyAgencyWorkspaces.mockReset();
    getSuperAgencyContext.mockResolvedValue({
      id: 'super-agency-1',
      name: 'Super Agency One',
      slug: 'super-agency-one',
      status: 'ACTIVE',
      roleId: 'role-1',
      roleName: 'SUPER_AGENCY_OWNER',
      membershipId: 'super-membership-1',
      permissions: [
        'super_agency.view',
        'agency.read',
        'agency.create',
        'agency.update',
        'workspace.read',
      ],
      counts: {
        agencies: 1,
        workspaces: 1,
        activeMembers: 1,
        pendingInvitations: 0,
      },
      agencies: [{ id: 'agency-1', name: 'Agency One', slug: 'agency-one', status: 'ACTIVE' }],
      createdAt: '',
      updatedAt: '',
    });
    listSuperAgencyAgencies.mockResolvedValue({
      items: [agency],
      page: 1,
      pageSize: 25,
      total: 1,
      totalPages: 1,
    });
    createSuperAgencyAgency.mockResolvedValue(agency);
    getSuperAgencyAgency.mockResolvedValue(agency);
    updateSuperAgencyAgency.mockResolvedValue(agency);
    listSuperAgencyAgencyWorkspaces.mockResolvedValue({
      items: [
        {
          id: 'workspace-1',
          agencyId: 'agency-1',
          name: 'Workspace One',
          slug: 'workspace-one',
          timezone: 'UTC',
          status: 'ACTIVE',
          createdById: 'user-1',
          createdAt: '',
          updatedAt: '',
          agency: {
            id: 'agency-1',
            name: 'Agency One',
            slug: 'agency-one',
            superAgencyId: 'super-agency-1',
          },
          counts: { members: 3 },
        },
      ],
      page: 1,
      pageSize: 25,
      total: 1,
      totalPages: 1,
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

  it('routes Agencies to the parent management surface and scopes query keys by tenant', () => {
    const agenciesItem = dashboardConfigs['super-agency'].groups[0]!.items.find(
      (item) => item.labelKey === 'navigation.agencies',
    );

    expect(agenciesItem).toMatchObject({
      href: '/super-agency/agencies',
      requiredPermissions: ['agency.read'],
    });
    expect(superAgencyKeys.agencies('super-agency-1', { search: 'alpha' })).toEqual([
      'super-agency',
      'super-agency-1',
      'agencies',
      { page: 1, pageSize: 25, search: 'alpha', status: '', sort: 'NEWEST' },
    ]);
    expect(superAgencyKeys.agencyWorkspaces('super-agency-1', 'agency-1', {})).toEqual([
      'super-agency',
      'super-agency-1',
      'agencies',
      'agency-1',
      'workspaces',
      { page: 1, pageSize: 25, search: '', status: '', sort: 'NEWEST' },
    ]);
  });

  it('renders parent Agency list and create dialog without a parent selector', async () => {
    render(
      <Providers>
        <SuperAgencyAgenciesPage />
      </Providers>,
    );

    expect(await screen.findByText('Agency One')).toBeInTheDocument();
    expect(screen.getByText(/1 Sub-Accounts/i)).toBeInTheDocument();
    expect(screen.getByText(/2 Agency Members/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create Agency' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Slug')).toBeInTheDocument();
    expect(screen.queryByText(/Super Agency selector/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New Agency' } });
    fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'new-agency' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Create Agency' }).at(-1)!);

    await waitFor(() =>
      expect(createSuperAgencyAgency).toHaveBeenCalledWith('super-agency-1', {
        name: 'New Agency',
        slug: 'new-agency',
      }),
    );
  });

  it('keeps parent Agency pagination server-side and tenant-keyed', async () => {
    listSuperAgencyAgencies.mockResolvedValueOnce({
      items: [agency],
      page: 1,
      pageSize: 25,
      total: 26,
      totalPages: 2,
    });
    listSuperAgencyAgencies.mockResolvedValueOnce({
      items: [{ ...agency, id: 'agency-2', name: 'Agency Two', slug: 'agency-two' }],
      page: 2,
      pageSize: 25,
      total: 26,
      totalPages: 2,
    });

    render(
      <Providers>
        <SuperAgencyAgenciesPage />
      </Providers>,
    );

    expect(await screen.findByText('Agency One')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() =>
      expect(listSuperAgencyAgencies).toHaveBeenCalledWith('super-agency-1', {
        search: '',
        page: 2,
      }),
    );
    expect(await screen.findByText('Agency Two')).toBeInTheDocument();
  });

  it('renders parent Agency detail with metadata-only Workspace summaries', async () => {
    render(
      <Providers>
        <SuperAgencyAgencyDetailPage agencyId="agency-1" />
      </Providers>,
    );

    expect(await screen.findByText('Managed from Super Agency')).toBeInTheDocument();
    expect(
      screen.getByRole('navigation', { name: 'Super Agency management breadcrumb' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Workspace One')).toBeInTheDocument();
    expect(screen.getByText(/3 Workspace Members/i)).toBeInTheDocument();
    expect(screen.queryByText(/Tasks/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Projects/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Tickets/i)).not.toBeInTheDocument();
    expect(listSuperAgencyAgencyWorkspaces).toHaveBeenCalledWith('super-agency-1', 'agency-1', {
      page: 1,
    });
  });
});
