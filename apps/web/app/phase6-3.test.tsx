import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider, useLanguage } from '../contexts/language-provider';
import { ThemeProvider } from '../contexts/theme-provider';
import { WorkspaceStatusesPage } from '../components/workspace/statuses/WorkspaceStatusesPage';
import { useSessionStore } from '../stores/session';
import type {
  StatusCategory,
  StatusEntityType,
  WorkspaceStatusDefinition,
} from '../services/workspace-statuses';

const listWorkspaceStatuses = vi.fn();
const createWorkspaceStatus = vi.fn();
const updateWorkspaceStatus = vi.fn();
const setWorkspaceStatusDefault = vi.fn();
const reorderWorkspaceStatuses = vi.fn();
const initializeWorkspaceStatusDefaults = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

vi.mock('../services/workspace-statuses', async () => {
  const actual = await vi.importActual<typeof import('../services/workspace-statuses')>(
    '../services/workspace-statuses',
  );
  return {
    ...actual,
    listWorkspaceStatuses: (...args: unknown[]) => listWorkspaceStatuses(...args),
    createWorkspaceStatus: (...args: unknown[]) => createWorkspaceStatus(...args),
    updateWorkspaceStatus: (...args: unknown[]) => updateWorkspaceStatus(...args),
    setWorkspaceStatusDefault: (...args: unknown[]) => setWorkspaceStatusDefault(...args),
    reorderWorkspaceStatuses: (...args: unknown[]) => reorderWorkspaceStatuses(...args),
    initializeWorkspaceStatusDefaults: (...args: unknown[]) =>
      initializeWorkspaceStatusDefaults(...args),
  };
});

const baseStatuses: Record<StatusEntityType, WorkspaceStatusDefinition[]> = {
  TASK: [
    status('task-todo', 'TASK', 'To Do', 1, {
      category: 'TODO',
      isDefault: true,
      color: '#64748B',
    }),
    status('task-progress', 'TASK', 'In Progress', 2, {
      category: 'IN_PROGRESS',
      color: '#2563EB',
    }),
    status('task-complete', 'TASK', 'Completed', 3, {
      category: 'COMPLETED',
      color: '#16A34A',
      isTerminal: true,
    }),
    status('task-paused', 'TASK', 'Paused', 4, {
      category: 'REVIEW',
      color: '#D97706',
      isActive: false,
    }),
  ],
  PROJECT: [
    status('project-initial', 'PROJECT', 'Initial Meeting', 1, {
      category: 'BACKLOG',
      isDefault: true,
    }),
    status('project-review', 'PROJECT', 'Client Review', 2, { category: 'REVIEW' }),
  ],
  TICKET: [
    status('ticket-new', 'TICKET', 'New', 1, { category: 'TODO', isDefault: true }),
    status('ticket-closed', 'TICKET', 'Closed', 2, {
      category: 'COMPLETED',
      isTerminal: true,
    }),
  ],
};

describe('Phase 6.3B workspace status management UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    window.history.replaceState(null, '', '/workspace/statuses');
    useSessionStore.setState({
      selectedAgencyId: 'agency-1',
      selectedWorkspaceId: 'workspace-1',
      hydrated: true,
      accessToken: 'token',
      user: { id: 'admin-1', email: 'admin@zeaplay.test' },
    });
    listWorkspaceStatuses.mockImplementation((_workspaceId: string, entityType: StatusEntityType) =>
      Promise.resolve(baseStatuses[entityType]),
    );
    createWorkspaceStatus.mockImplementation(
      (
        _workspaceId: string,
        entityType: StatusEntityType,
        body: Partial<WorkspaceStatusDefinition>,
      ) =>
        Promise.resolve(
          status(`${entityType.toLowerCase()}-custom`, entityType, body.name ?? 'Custom', 99, body),
        ),
    );
    updateWorkspaceStatus.mockImplementation(
      (
        _workspaceId: string,
        entityType: StatusEntityType,
        statusId: string,
        body: Partial<WorkspaceStatusDefinition>,
      ) => {
        const existing =
          Object.values(baseStatuses)
            .flat()
            .find((item) => item.id === statusId) ?? status(statusId, entityType, 'Updated', 1);
        return Promise.resolve({ ...existing, ...body });
      },
    );
    setWorkspaceStatusDefault.mockImplementation(
      (_workspaceId: string, entityType: StatusEntityType, statusId: string) =>
        Promise.resolve({ ...baseStatuses[entityType][0], id: statusId, isDefault: true }),
    );
    reorderWorkspaceStatuses.mockImplementation(
      (_workspaceId: string, entityType: StatusEntityType, orderedIds: string[]) =>
        Promise.resolve(
          orderedIds.map((id, index) => ({
            ...baseStatuses[entityType].find((item) => item.id === id)!,
            position: index + 1,
          })),
        ),
    );
    initializeWorkspaceStatusDefaults.mockResolvedValue([]);
  });

  it('uses one three-tab UI and calls the API with TASK, PROJECT, and TICKET entity types', async () => {
    renderWithProviders(<WorkspaceStatusesPage />);
    expect(await screen.findByRole('heading', { name: 'Status Management' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Task Statuses' })).toBeInTheDocument();

    selectTab('Project Pipeline');
    await waitFor(() =>
      expect(listWorkspaceStatuses).toHaveBeenCalledWith('workspace-1', 'PROJECT', 'ALL'),
    );

    selectTab('Ticket Statuses');
    await waitFor(() =>
      expect(listWorkspaceStatuses).toHaveBeenCalledWith('workspace-1', 'TICKET', 'ALL'),
    );
  });

  it('renders ordered statuses with default, terminal, inactive, category, and color-safe labels', async () => {
    renderWithProviders(<WorkspaceStatusesPage />);
    expect((await screen.findAllByText('To Do')).length).toBeGreaterThan(0);
    expect(screen.getByText('Default')).toBeInTheDocument();
    expect(screen.getByText('Terminal')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
    expect(screen.getAllByText('In Progress').length).toBeGreaterThan(0);
  });

  it('validates create form name and HEX color, sends category and terminal values, and surfaces duplicate errors', async () => {
    createWorkspaceStatus.mockRejectedValueOnce(
      new Error('Status name already exists for this entity type.'),
    );
    renderWithProviders(<WorkspaceStatusesPage />);
    fireEvent.click(await screen.findByRole('button', { name: /create task status/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('Name is required.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Review' } });
    fireEvent.change(screen.getByLabelText('Color'), { target: { value: 'url(javascript:1)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('Use a #RRGGBB HEX color.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Color'), { target: { value: '#9333EA' } });
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Category' }), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: 'Review' }));
    fireEvent.click(screen.getByLabelText('Terminal Status'));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(createWorkspaceStatus).toHaveBeenCalledWith(
        'workspace-1',
        'TASK',
        expect.objectContaining({
          name: 'Review',
          color: '#9333EA',
          category: 'REVIEW',
          isTerminal: true,
        }),
      ),
    );
    expect(toastError).toHaveBeenCalledWith('Status name already exists for this entity type.');
  });

  it('edits statuses, sets defaults explicitly, protects current default deactivation, and handles last-active rejection', async () => {
    renderWithProviders(<WorkspaceStatusesPage />);
    await screen.findAllByText('To Do');

    openActions('In Progress');
    fireEvent.click(await screen.findByText('Edit'));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Doing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(updateWorkspaceStatus).toHaveBeenCalledWith(
        'workspace-1',
        'TASK',
        'task-progress',
        expect.objectContaining({ name: 'Doing' }),
      ),
    );

    openActions('In Progress');
    fireEvent.click(await screen.findByText('Set as Default'));
    expect(screen.getByText('Current Default:')).toBeInTheDocument();
    expect(screen.getByText('New Default:')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Set as Default' }));
    await waitFor(() =>
      expect(setWorkspaceStatusDefault).toHaveBeenCalledWith(
        'workspace-1',
        'TASK',
        'task-progress',
      ),
    );

    openActions('To Do');
    expect(await screen.findByText('Deactivate')).toHaveAttribute('data-disabled');

    openActions('In Progress');
    fireEvent.click(await screen.findByText('Deactivate'));
    updateWorkspaceStatus.mockRejectedValueOnce(
      new Error('At least one active status is required.'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('At least one active status is required.'),
    );
  });

  it('supports reactivate and initialize-defaults from empty state', async () => {
    listWorkspaceStatuses.mockResolvedValueOnce([]);
    const { unmount } = renderWithProviders(<WorkspaceStatusesPage />);
    fireEvent.click(await screen.findByRole('button', { name: /initialize default statuses/i }));
    await waitFor(() =>
      expect(initializeWorkspaceStatusDefaults).toHaveBeenCalledWith('workspace-1'),
    );
    unmount();

    listWorkspaceStatuses.mockResolvedValue(baseStatuses.TASK);
    renderWithProviders(<WorkspaceStatusesPage />);
    await screen.findByText('Paused');
    openActions('Paused');
    fireEvent.click(await screen.findByText('Reactivate'));
    await waitFor(() =>
      expect(updateWorkspaceStatus).toHaveBeenCalledWith('workspace-1', 'TASK', 'task-paused', {
        isActive: true,
      }),
    );
  });

  it('reorders with Move Up/Down and rolls back when the API rejects', async () => {
    reorderWorkspaceStatuses.mockRejectedValueOnce(new Error('Could not update status order'));
    renderWithProviders(<WorkspaceStatusesPage />);
    await screen.findAllByText('To Do');
    const inProgressRow = screen.getAllByText('In Progress')[0]!.closest('.p-0') as HTMLElement;
    fireEvent.click(within(inProgressRow).getByRole('button', { name: /move up/i }));
    await waitFor(() =>
      expect(reorderWorkspaceStatuses).toHaveBeenCalledWith('workspace-1', 'TASK', [
        'task-progress',
        'task-todo',
        'task-complete',
        'task-paused',
      ]),
    );
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Could not update status order'));
    expect(
      screen
        .getAllByText('To Do')[0]!
        .compareDocumentPosition(screen.getAllByText('In Progress')[0]!),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('disables create at the 50-status limit and clears stale data on workspace switch', async () => {
    listWorkspaceStatuses.mockResolvedValueOnce(
      Array.from({ length: 50 }).map((_, index) =>
        status(`task-${index}`, 'TASK', `Status ${index}`, index + 1),
      ),
    );
    renderWithProviders(<WorkspaceStatusesPage />);
    expect(
      await screen.findByText('Maximum 50 statuses reached for this entity type.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create task status/i })).toBeDisabled();

    act(() => {
      useSessionStore.setState({ selectedWorkspaceId: 'workspace-2' });
    });
    await waitFor(() =>
      expect(listWorkspaceStatuses).toHaveBeenCalledWith('workspace-2', 'TASK', 'ALL'),
    );
  });

  it('confirms before discarding dirty dialog edits and renders Tamil labels', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(
      <LanguageProvider>
        <TamilSwitch />
        <QueryHarness>
          <WorkspaceStatusesPage />
        </QueryHarness>
      </LanguageProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'ta' }));
    expect(await screen.findByText('நிலை மேலாண்மை')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /பணி நிலை உருவாக்கு/ }));
    fireEvent.change(screen.getByLabelText('பெயர்'), { target: { value: 'தமிழ் நிலை' } });
    await waitFor(() => expect(screen.getByDisplayValue('தமிழ் நிலை')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'ரத்து' }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it('renders inside Light, Dark, and Colorful theme contexts', async () => {
    for (const theme of ['light', 'dark', 'colorful'] as const) {
      localStorage.setItem('zea-play-theme', theme);
      const { unmount } = render(
        <ThemeProvider>
          <LanguageProvider>
            <QueryHarness>
              <WorkspaceStatusesPage />
            </QueryHarness>
          </LanguageProvider>
        </ThemeProvider>,
      );
      expect(await screen.findByRole('heading', { name: 'Status Management' })).toBeInTheDocument();
      unmount();
    }
  });
});

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <LanguageProvider>
      <QueryHarness>{ui}</QueryHarness>
    </LanguageProvider>,
  );
}

function QueryHarness({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function TamilSwitch() {
  const { setLocale } = useLanguage();
  return (
    <button type="button" onClick={() => setLocale('ta')}>
      ta
    </button>
  );
}

function openActions(name: string) {
  const trigger = screen.getByRole('button', { name: `Actions: ${name}` });
  fireEvent.click(trigger);
}

function selectTab(name: string) {
  const tab = screen.getByRole('tab', { name });
  fireEvent.pointerDown(tab);
  fireEvent.mouseDown(tab);
  fireEvent.click(tab);
}

function status(
  id: string,
  entityType: StatusEntityType,
  name: string,
  position: number,
  overrides: Partial<WorkspaceStatusDefinition> & { category?: StatusCategory } = {},
): WorkspaceStatusDefinition {
  return {
    id,
    workspaceId: 'workspace-1',
    entityType,
    name,
    description: null,
    color: '#64748B',
    position,
    category: 'TODO',
    isDefault: false,
    isTerminal: false,
    isActive: true,
    isSystem: false,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}
