import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../contexts/language-provider';
import { ThemeProvider } from '../contexts/theme-provider';
import { SuperAgencyGlobalLeaderboardPage } from '../components/gamification/SuperAgencyGlobalLeaderboardPage';
import { dashboardConfigs } from '../components/navigation/navigation-config';
import { globalGamificationKeys } from '../services/global-gamification';
import { useSessionStore } from '../stores/session';

const getSuperAgencyGlobalAgencies = vi.fn();
const getSuperAgencyGlobalSubaccounts = vi.fn();
const getSuperAgencyGlobalUsers = vi.fn();

vi.mock('../services/global-gamification', async () => {
  const actual = await vi.importActual<typeof import('../services/global-gamification')>(
    '../services/global-gamification',
  );
  return {
    ...actual,
    getSuperAgencyGlobalAgencies: (...args: unknown[]) => getSuperAgencyGlobalAgencies(...args),
    getSuperAgencyGlobalSubaccounts: (...args: unknown[]) =>
      getSuperAgencyGlobalSubaccounts(...args),
    getSuperAgencyGlobalUsers: (...args: unknown[]) => getSuperAgencyGlobalUsers(...args),
  };
});

describe('phase 14.6.7 Super Agency Global Leaderboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/super-agency/gamification');
    useSessionStore.setState({
      hydrated: true,
      accessToken: 'token',
      csrfToken: 'csrf-token',
      user: { id: 'user-1', email: 'owner@example.test' },
      superAgencies: [
        {
          id: 'super-agency-1',
          name: 'Super Agency One',
          slug: 'super-agency-one',
          status: 'ACTIVE',
          role: 'SUPER_AGENCY_OWNER',
          membershipId: 'super-membership-1',
          agencies: [{ id: 'agency-1', name: 'Agency One', slug: 'agency-one', status: 'ACTIVE' }],
        },
      ],
      agencies: [],
      selectedSuperAgencyId: 'super-agency-1',
      selectedAgencyId: null,
      selectedWorkspaceId: null,
    });
    getSuperAgencyGlobalAgencies.mockResolvedValue(
      pageResult([
        {
          rank: 1,
          agencyId: 'agency-1',
          agencyName: 'Agency One',
          globalScore: 900,
          subaccounts: 2,
          scoredUsers: 3,
        },
      ]),
    );
    getSuperAgencyGlobalSubaccounts.mockResolvedValue(
      pageResult([
        {
          rank: 1,
          workspaceId: 'workspace-1',
          workspaceName: 'Workspace One',
          agencyId: 'agency-1',
          agencyName: 'Agency One',
          globalScore: 700,
          scoredUsers: 2,
        },
      ]),
    );
    getSuperAgencyGlobalUsers.mockResolvedValue(
      pageResult([
        {
          rank: 1,
          membershipId: null,
          displayName: 'Anonymous User',
          workspaceId: 'workspace-1',
          workspaceName: 'Workspace One',
          agencyId: 'agency-1',
          agencyName: 'Agency One',
          departmentName: null,
          privacyMode: 'ANONYMOUS',
          globalScore: 700,
        },
      ]),
    );
  });

  it('adds the Super Agency navigation item with a parent read permission', () => {
    const item = dashboardConfigs['super-agency'].groups[0]!.items.find(
      (entry) => entry.href === '/super-agency/gamification',
    );

    expect(item).toMatchObject({
      labelKey: 'navigation.globalLeaderboard',
      requiredPermissions: ['gamification.global_leaderboard.view_super_agency'],
    });
    expect(globalGamificationKeys.superAgency('super-agency-1', 'users', { page: 2 })).toEqual([
      'global-gamification',
      'super-agency',
      'super-agency-1',
      'users',
      { page: 2 },
    ]);
    expect(globalGamificationKeys.platform('super-agencies', { page: 1 })).toEqual([
      'global-gamification',
      'platform',
      'super-agencies',
      { page: 1 },
    ]);
  });

  it('renders Super Agency read-only leaderboards without XP controls or PII', async () => {
    renderWithProviders(<SuperAgencyGlobalLeaderboardPage />);

    expect(
      await screen.findByText(
        'Super Agency One - Agency and Platform leaderboards compare normalized Global Score, not raw local XP.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Agencies' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('Agency One')).toBeInTheDocument();
    expect(screen.queryByText('Current XP')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /reset|reconcile|adjust/i }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Users' }));

    expect(await screen.findByText('Anonymous User')).toBeInTheDocument();
    expect(screen.getByText('Workspace One')).toBeInTheDocument();
    expect(screen.queryByText(/owner@example.test/i)).not.toBeInTheDocument();
    await waitFor(() =>
      expect(getSuperAgencyGlobalUsers).toHaveBeenCalledWith('super-agency-1', {
        page: 1,
        pageSize: 20,
        search: '',
      }),
    );
  });
});

function pageResult<T>(items: T[]) {
  return {
    scope: 'SUPER_AGENCY',
    period: 'ALL_TIME',
    items,
    page: 1,
    pageSize: 20,
    total: items.length,
    totalPages: 1,
  };
}

function renderWithProviders(node: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <LanguageProvider>{node}</LanguageProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}
