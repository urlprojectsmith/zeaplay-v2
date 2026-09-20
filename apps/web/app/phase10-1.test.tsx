import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../contexts/language-provider';
import { ThemeProvider } from '../contexts/theme-provider';
import { WorkspaceGamificationPage } from '../components/workspace/gamification/WorkspaceGamificationPage';
import { useSessionStore } from '../stores/session';

const listWorkspaceRoles = vi.fn();
const getMyGamificationXpSummary = vi.fn();
const getMyGamificationXpHistory = vi.fn();

vi.mock('../services/workspace-roles', () => ({
  rolesKeys: {
    all: (workspaceId: string | null) => ['workspace', workspaceId, 'roles'],
  },
  listWorkspaceRoles: (...args: unknown[]) => listWorkspaceRoles(...args),
}));

vi.mock('../services/workspace-gamification', () => ({
  gamificationKeys: {
    summary: (workspaceId: string | null) => ['workspace', workspaceId, 'gamification', 'xp'],
    history: (workspaceId: string | null, params: unknown) => [
      'workspace',
      workspaceId,
      'gamification',
      'xp',
      'history',
      params,
    ],
  },
  getMyGamificationXpSummary: (...args: unknown[]) => getMyGamificationXpSummary(...args),
  getMyGamificationXpHistory: (...args: unknown[]) => getMyGamificationXpHistory(...args),
}));

describe('Phase 10.1 gamification page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    listWorkspaceRoles.mockResolvedValue([
      {
        id: 'role-member',
        key: 'MEMBER',
        name: 'Member',
        description: null,
        scope: 'WORKSPACE',
        isSystem: true,
        isActive: true,
        workspaceId: null,
        permissions: [{ id: 'permission-gamification-view', key: 'gamification.view' }],
        createdAt: '',
        updatedAt: '',
      },
    ]);
    getMyGamificationXpSummary.mockResolvedValue({
      currentXp: 125,
      lifetimeEarnedXp: 150,
      lifetimeDeductedXp: 25,
      entryCount: 3,
      lastXpChangeAt: '2026-01-01T00:00:00.000Z',
    });
    getMyGamificationXpHistory.mockResolvedValue({
      items: [
        {
          id: 'xp-1',
          amount: 25,
          entryType: 'EARN',
          sourceType: 'TASK',
          sourceEvent: 'TASK_COMPLETED',
          sourceEntityId: 'task-1',
          reason: null,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      page: 1,
      pageSize: 10,
      total: 1,
    });
  });

  it('renders server XP summary and fetches history only when the history tab opens', async () => {
    renderGamificationPage();

    expect(await screen.findByRole('heading', { name: 'Gamification' })).toBeInTheDocument();
    expect(await screen.findByText('125 XP')).toBeInTheDocument();
    expect(getMyGamificationXpSummary).toHaveBeenCalledWith('workspace-1');
    expect(getMyGamificationXpHistory).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('tab', { name: 'History' }));

    await waitFor(() =>
      expect(getMyGamificationXpHistory).toHaveBeenCalledWith('workspace-1', {
        page: 1,
        pageSize: 10,
      }),
    );
    expect(await screen.findByText('+25 XP')).toBeInTheDocument();
  });

  it('does not call XP APIs when the selected role lacks gamification.view', async () => {
    listWorkspaceRoles.mockResolvedValue([
      {
        id: 'role-member',
        key: 'MEMBER',
        name: 'Member',
        description: null,
        scope: 'WORKSPACE',
        isSystem: true,
        isActive: true,
        workspaceId: null,
        permissions: [],
        createdAt: '',
        updatedAt: '',
      },
    ]);

    renderGamificationPage();

    expect(await screen.findByText('Permission denied')).toBeInTheDocument();
    expect(getMyGamificationXpSummary).not.toHaveBeenCalled();
    expect(getMyGamificationXpHistory).not.toHaveBeenCalled();
  });
});

function renderGamificationPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <LanguageProvider>
          <WorkspaceGamificationPage />
        </LanguageProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}
