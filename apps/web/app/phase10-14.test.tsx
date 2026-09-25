import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../contexts/language-provider';
import { ThemeProvider } from '../contexts/theme-provider';
import { DeveloperGamificationControlCenter } from '../components/developer/DeveloperGamificationControlCenter';
import { AgencyGlobalLeaderboardPage } from '../components/gamification/AgencyGlobalLeaderboardPage';
import { PlatformGlobalLeaderboardPage } from '../components/gamification/PlatformGlobalLeaderboardPage';
import { useSessionStore } from '../stores/session';

const getAgencyGlobalSubaccounts = vi.fn();
const getAgencyGlobalUsers = vi.fn();
const getSuperAgencyGlobalAgencies = vi.fn();
const getSuperAgencyGlobalSubaccounts = vi.fn();
const getSuperAgencyGlobalUsers = vi.fn();
const getPlatformGlobalSuperAgencies = vi.fn();
const getPlatformGlobalAgencies = vi.fn();
const getPlatformGlobalSubaccounts = vi.fn();
const getPlatformGlobalUsers = vi.fn();
const getDeveloperGamificationHealth = vi.fn();
const getDeveloperPointRules = vi.fn();
const getDeveloperXpEvents = vi.fn();
const getDeveloperNormalizationEvents = vi.fn();
const getDeveloperBaselines = vi.fn();
const getDeveloperLeaderboardDiagnostics = vi.fn();
const getDeveloperReconciliation = vi.fn();
const getDeveloperLedgerHealth = vi.fn();
const getDeveloperAchievementsStreaksHealth = vi.fn();
const getDeveloperSecurityHealth = vi.fn();
const getDeveloperAudit = vi.fn();

vi.mock('../services/global-gamification', () => ({
  globalGamificationKeys: {
    agencySubaccounts: (agencyId: string | null, search: string) => [
      'global-gamification',
      'agency',
      agencyId,
      'subaccounts',
      search,
    ],
    agencyUsers: (agencyId: string | null, workspaceId: string | null, params: unknown) => [
      'global-gamification',
      'agency',
      agencyId,
      'users',
      workspaceId,
      params,
    ],
    superAgency: (superAgencyId: string | null, tab: string, params: unknown) => [
      'global-gamification',
      'super-agency',
      superAgencyId,
      tab,
      params,
    ],
    platform: (tab: string, params: unknown) => ['global-gamification', 'platform', tab, params],
  },
  getAgencyGlobalSubaccounts: (...args: unknown[]) => getAgencyGlobalSubaccounts(...args),
  getAgencyGlobalUsers: (...args: unknown[]) => getAgencyGlobalUsers(...args),
  getSuperAgencyGlobalAgencies: (...args: unknown[]) => getSuperAgencyGlobalAgencies(...args),
  getSuperAgencyGlobalSubaccounts: (...args: unknown[]) => getSuperAgencyGlobalSubaccounts(...args),
  getSuperAgencyGlobalUsers: (...args: unknown[]) => getSuperAgencyGlobalUsers(...args),
  getPlatformGlobalSuperAgencies: (...args: unknown[]) => getPlatformGlobalSuperAgencies(...args),
  getPlatformGlobalAgencies: (...args: unknown[]) => getPlatformGlobalAgencies(...args),
  getPlatformGlobalSubaccounts: (...args: unknown[]) => getPlatformGlobalSubaccounts(...args),
  getPlatformGlobalUsers: (...args: unknown[]) => getPlatformGlobalUsers(...args),
}));

vi.mock('../services/developer-gamification', () => ({
  developerGamificationKeys: {
    health: () => ['developer-gamification', 'health'],
    tab: (tab: string, params: unknown) => ['developer-gamification', tab, params],
  },
  getDeveloperGamificationHealth: (...args: unknown[]) => getDeveloperGamificationHealth(...args),
  getDeveloperPointRules: (...args: unknown[]) => getDeveloperPointRules(...args),
  getDeveloperXpEvents: (...args: unknown[]) => getDeveloperXpEvents(...args),
  getDeveloperNormalizationEvents: (...args: unknown[]) => getDeveloperNormalizationEvents(...args),
  getDeveloperBaselines: (...args: unknown[]) => getDeveloperBaselines(...args),
  getDeveloperLeaderboardDiagnostics: (...args: unknown[]) =>
    getDeveloperLeaderboardDiagnostics(...args),
  getDeveloperReconciliation: (...args: unknown[]) => getDeveloperReconciliation(...args),
  getDeveloperLedgerHealth: (...args: unknown[]) => getDeveloperLedgerHealth(...args),
  getDeveloperAchievementsStreaksHealth: (...args: unknown[]) =>
    getDeveloperAchievementsStreaksHealth(...args),
  getDeveloperSecurityHealth: (...args: unknown[]) => getDeveloperSecurityHealth(...args),
  getDeveloperAudit: (...args: unknown[]) => getDeveloperAudit(...args),
}));

describe('Phase 10.14 Gamification integration surfaces', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/');
    useSessionStore.setState({
      accessToken: 'access-token',
      csrfToken: 'csrf-token',
      user: { id: 'user-1', email: 'owner@zeaplay.test', name: 'Owner' },
      agencies: [
        {
          id: 'agency-1',
          name: 'Agency One',
          slug: 'agency-one',
          status: 'active',
          role: 'owner',
          membershipId: 'agency-membership-1',
          workspaces: [
            {
              id: 'workspace-1',
              agencyId: 'agency-1',
              name: 'Workspace One',
              slug: 'workspace-one',
              timezone: 'UTC',
              status: 'active',
              role: 'role-member',
              membershipId: 'workspace-membership-1',
            },
          ],
        },
      ],
      selectedAgencyId: 'agency-1',
      selectedWorkspaceId: 'workspace-1',
      hydrated: true,
    });

    getAgencyGlobalSubaccounts.mockResolvedValue({
      scope: 'AGENCY',
      period: 'ALL_TIME',
      agencyId: 'agency-1',
      globalScore: 1200,
      items: [
        {
          rank: 1,
          workspaceId: 'workspace-1',
          workspaceName: 'Workspace One',
          agencyId: 'agency-1',
          agencyName: 'Agency One',
          globalScore: 1200,
          scoredUsers: 4,
        },
      ],
    });
    getAgencyGlobalUsers.mockResolvedValue(pageResult([]));
    getSuperAgencyGlobalAgencies.mockResolvedValue(pageResult([]));
    getSuperAgencyGlobalSubaccounts.mockResolvedValue(pageResult([]));
    getSuperAgencyGlobalUsers.mockResolvedValue(pageResult([]));
    getPlatformGlobalSuperAgencies.mockResolvedValue(
      pageResult([
        {
          rank: 1,
          superAgencyId: 'super-agency-1',
          superAgencyName: 'Super Agency One',
          globalScore: 1200,
          agencies: 1,
          subaccounts: 1,
          scoredUsers: 4,
        },
      ]),
    );
    getPlatformGlobalAgencies.mockResolvedValue(
      pageResult([
        {
          rank: 1,
          agencyId: 'agency-1',
          agencyName: 'Agency One',
          globalScore: 1200,
          subaccounts: 1,
          scoredUsers: 4,
        },
      ]),
    );
    getPlatformGlobalSubaccounts.mockResolvedValue(
      pageResult([
        {
          rank: 1,
          workspaceId: 'workspace-1',
          workspaceName: 'Workspace One',
          agencyId: 'agency-1',
          agencyName: 'Agency One',
          globalScore: 1200,
          scoredUsers: 4,
        },
      ]),
    );
    getPlatformGlobalUsers.mockResolvedValue(pageResult([]));

    getDeveloperGamificationHealth.mockResolvedValue({
      cards: [{ title: 'XP Events', value: 5, status: 'OK', summary: 'Healthy' }],
    });
    getDeveloperPointRules.mockResolvedValue({ completionRules: [], creationRules: [] });
    getDeveloperXpEvents.mockResolvedValue(pageResult([]));
    getDeveloperNormalizationEvents.mockResolvedValue(pageResult([]));
    getDeveloperBaselines.mockResolvedValue(pageResult([]));
    getDeveloperLeaderboardDiagnostics.mockResolvedValue({
      workspaceAuthority: 'LOCAL XP',
      platformAuthority: 'NORMALIZED GLOBAL SCORE',
    });
    getDeveloperReconciliation.mockResolvedValue(pageResult([]));
    getDeveloperLedgerHealth.mockResolvedValue({ status: 'OK' });
    getDeveloperAchievementsStreaksHealth.mockResolvedValue({ status: 'OK' });
    getDeveloperSecurityHealth.mockResolvedValue({ status: 'OK' });
    getDeveloperAudit.mockResolvedValue(pageResult([]));
  });

  it('keeps Agency Gamification on Overview and Global Leaderboard with normalized Global Score labels', async () => {
    renderWithProviders(<AgencyGlobalLeaderboardPage />);

    expect(await screen.findByText('Agency Global Score')).toBeInTheDocument();
    expect(screen.getAllByText(/normalized Global Score/i).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('tab', { name: 'Global Leaderboard' }));

    expect(await screen.findByText('Top Subaccounts')).toBeInTheDocument();
    expect(screen.getByText('Global Score')).toBeInTheDocument();
    expect(screen.queryByText('Current XP')).not.toBeInTheDocument();
  });

  it('keeps Super Admin sections and nested leaderboard tabs on normalized Global Score only', async () => {
    useSessionStore.setState({ selectedAgencyId: null });
    renderWithProviders(<PlatformGlobalLeaderboardPage />);

    expect(await screen.findByRole('tab', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Global Leaderboard' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Governance Status' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Global Leaderboard' }));
    expect(await screen.findByRole('tab', { name: 'Super Agencies' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Agencies' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Subaccounts' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Users' })).toBeInTheDocument();
    expect(screen.getByText('Global Score')).toBeInTheDocument();
    expect(screen.queryByText('Current XP')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Governance Status' }));
    expect(
      await screen.findByText(/pending platform feature-control implementation/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(getPlatformGlobalAgencies).toHaveBeenCalled();
  });

  it('keeps Developer Gamification URL-backed and read-only', async () => {
    window.history.replaceState(null, '', '/developer/dashboard?tab=leaderboards');
    renderWithProviders(<DeveloperGamificationControlCenter />);

    expect(await screen.findByText(/does not mutate Gamification data/i)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Leaderboards' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await waitFor(() => expect(getDeveloperLeaderboardDiagnostics).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /fix all|repair|backfill|reconcile/i })).toBeNull();
  });
});

function pageResult<T>(items: T[]) {
  return {
    scope: 'GLOBAL',
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
