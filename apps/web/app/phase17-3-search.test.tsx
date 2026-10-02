import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalSearch } from '../components/search/GlobalSearch';
import * as searchService from '../services/search';
import { useSessionStore } from '../stores/session';

const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/workspace/dashboard',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('../services/search', async () => {
  const actual = await vi.importActual<typeof import('../services/search')>('../services/search');
  return {
    ...actual,
    globalSearch: vi.fn(),
    listRecentSearches: vi.fn(),
    clearRecentSearches: vi.fn(),
  };
});

describe('GlobalSearch', () => {
  beforeEach(() => {
    push.mockReset();
    useSessionStore.setState({
      accessToken: 'token',
      selectedAgencyId: 'agency-1',
      selectedWorkspaceId: 'workspace-1',
      selectedSuperAgencyId: null,
      hydrated: true,
    });
    vi.mocked(searchService.globalSearch).mockResolvedValue({
      query: 'invoice',
      scope: { type: 'WORKSPACE', id: 'workspace-1' },
      page: 1,
      pageSize: 8,
      hasMore: false,
      results: [
        {
          id: 'search-1',
          type: 'TASK',
          entityId: 'task-1',
          title: 'Invoice Follow-up',
          subtitle: 'HIGH',
          snippet: '<script>alert(1)</script> Invoice note',
          scope: { type: 'WORKSPACE', id: 'workspace-1' },
          route: { href: '/workspace/tasks?task=task-1' },
          metadata: {},
          archived: false,
          updatedAt: '2026-09-29T00:00:00.000Z',
          score: 100,
        },
      ],
    });
    vi.mocked(searchService.listRecentSearches).mockResolvedValue([]);
  });

  it('opens with Ctrl+K, searches current Workspace scope, and opens a result route', async () => {
    renderSearch();

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    fireEvent.change(screen.getByLabelText('Search query'), { target: { value: 'invoice' } });

    expect(await screen.findByText('Invoice Follow-up')).toBeInTheDocument();
    expect(searchService.globalSearch).toHaveBeenCalledWith('WORKSPACE', 'workspace-1', {
      q: 'invoice',
      pageSize: 8,
    });
    fireEvent.click(screen.getByText('Invoice Follow-up'));
    expect(push).toHaveBeenCalledWith('/workspace/tasks?task=task-1');
  });

  it('shows and clears recent searches per selected scope', async () => {
    vi.mocked(searchService.listRecentSearches).mockResolvedValue([
      {
        id: 'recent-1',
        query: 'தமிழ்',
        resultTypes: ['DOC'],
        updatedAt: '2026-09-29T00:00:00.000Z',
      },
    ]);
    vi.mocked(searchService.clearRecentSearches).mockResolvedValue({ cleared: true });
    renderSearch();

    fireEvent.click(screen.getAllByLabelText('Search')[0] as HTMLElement);

    expect(await screen.findByText('தமிழ்')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Clear search history'));

    await waitFor(() =>
      expect(searchService.clearRecentSearches).toHaveBeenCalledWith('WORKSPACE', 'workspace-1'),
    );
  });
});

function renderSearch() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <GlobalSearch scope="workspace" />
    </QueryClientProvider>,
  );
}
