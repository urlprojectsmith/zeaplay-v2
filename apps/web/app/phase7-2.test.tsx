import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider, useLanguage } from '../contexts/language-provider';
import { ThemeProvider } from '../contexts/theme-provider';
import { WorkspaceTasksPage } from '../components/workspace/tasks/WorkspaceTasksPage';
import { apiClient } from '../services/api';
import { taskDueAtFromLocalDate } from '../services/workspace-tasks';
import { useSessionStore } from '../stores/session';

const listRecentWorkspaceTasks = vi.fn();
const listWorkspaceTasks = vi.fn();
const getWorkspaceTask = vi.fn();
const createTaskMock = vi.fn();
const bulkUpdateTaskStatus = vi.fn();
const bulkUpdateTaskPriority = vi.fn();
const bulkAddTaskAssignees = vi.fn();
const bulkRemoveTaskAssignees = vi.fn();
const bulkDeleteTasks = vi.fn();
const listWorkspaceProjects = vi.fn();
const listWorkspaceUsers = vi.fn();
const listDepartments = vi.fn();
const listWorkspaceStatuses = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
const routerReplace = vi.fn();
let currentSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  usePathname: () => '/workspace/tasks',
  useRouter: () => ({ replace: routerReplace }),
  useSearchParams: () => currentSearchParams,
}));

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

vi.mock('../services/workspace-management', async () => {
  const actual = await vi.importActual<typeof import('../services/workspace-management')>(
    '../services/workspace-management',
  );
  return {
    ...actual,
    listWorkspaceUsers: (...args: unknown[]) => listWorkspaceUsers(...args),
    listDepartments: (...args: unknown[]) => listDepartments(...args),
  };
});

vi.mock('../services/workspace-statuses', async () => {
  const actual = await vi.importActual<typeof import('../services/workspace-statuses')>(
    '../services/workspace-statuses',
  );
  return {
    ...actual,
    listWorkspaceStatuses: (...args: unknown[]) => listWorkspaceStatuses(...args),
  };
});

vi.mock('../services/workspace-tasks', async () => {
  const actual = await vi.importActual<typeof import('../services/workspace-tasks')>(
    '../services/workspace-tasks',
  );
  return {
    ...actual,
    listRecentWorkspaceTasks: (...args: unknown[]) => listRecentWorkspaceTasks(...args),
    listWorkspaceTasks: (...args: unknown[]) => listWorkspaceTasks(...args),
    getWorkspaceTask: (...args: unknown[]) => getWorkspaceTask(...args),
    createWorkspaceTask: (...args: unknown[]) => createTaskMock(...args),
    bulkUpdateTaskStatus: (...args: unknown[]) => bulkUpdateTaskStatus(...args),
    bulkUpdateTaskPriority: (...args: unknown[]) => bulkUpdateTaskPriority(...args),
    bulkAddTaskAssignees: (...args: unknown[]) => bulkAddTaskAssignees(...args),
    bulkRemoveTaskAssignees: (...args: unknown[]) => bulkRemoveTaskAssignees(...args),
    bulkDeleteTasks: (...args: unknown[]) => bulkDeleteTasks(...args),
    listWorkspaceProjects: (...args: unknown[]) => listWorkspaceProjects(...args),
  };
});

describe('Phase 7.2 task creation experience', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentSearchParams = new URLSearchParams();
    localStorage.clear();
    useSessionStore.setState({
      selectedAgencyId: 'agency-1',
      selectedWorkspaceId: 'workspace-1',
      hydrated: true,
      accessToken: 'token',
      user: { id: 'admin-1', email: 'admin@zeaplay.test' },
    });
    listRecentWorkspaceTasks.mockResolvedValue({ items: [], page: 1, pageSize: 5, total: 0 });
    listWorkspaceTasks.mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    });
    getWorkspaceTask.mockResolvedValue(
      taskFixture({ id: 'task-alpha', title: 'Alpha launch task' }),
    );
    listWorkspaceUsers.mockImplementation(({ workspaceId }: { workspaceId: string }) =>
      Promise.resolve({
        items:
          workspaceId === 'workspace-2'
            ? [user('membership-b', 'Bala')]
            : [user('membership-a', 'Anya'), user('membership-c', 'Chen')],
        page: 1,
        pageSize: 10,
        total: 2,
      }),
    );
    listDepartments.mockResolvedValue({
      items: [{ id: 'department-1', workspaceId: 'workspace-1', name: 'Design', status: 'ACTIVE' }],
      page: 1,
      pageSize: 100,
      total: 1,
    });
    listWorkspaceStatuses.mockImplementation((_workspaceId: string, entityType: string) =>
      Promise.resolve([
        status('status-task', entityType, 'To Do'),
        status('status-review', entityType, 'Review', false),
      ]),
    );
    listWorkspaceProjects.mockResolvedValue({
      items: [{ id: 'project-1', workspaceId: 'workspace-1', name: 'Launch', status: 'ACTIVE' }],
      page: 1,
      pageSize: 10,
      total: 1,
    });
    createTaskMock.mockResolvedValue({ id: 'task-1', title: 'Draft brief' });
  });

  it('renders the Tasks route foundation and keeps quick create simple initially', async () => {
    renderWithProviders(<WorkspaceTasksPage />);

    expect(await screen.findByRole('heading', { name: 'Tasks' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'All Tasks' })).toBeInTheDocument();
    expect(await screen.findByText('No tasks')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));

    expect(screen.getByLabelText('Title *')).toBeInTheDocument();
    expect(screen.getByLabelText('Assignee *')).toBeInTheDocument();
    expect(screen.getByLabelText('Due Date *')).toBeInTheDocument();
    expect(screen.queryByLabelText('Description')).not.toBeInTheDocument();
    expect(screen.queryByText('Followers')).not.toBeInTheDocument();
  });

  it('reveals supported advanced fields and updates the live preview', async () => {
    renderWithProviders(<WorkspaceTasksPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create Task' }));
    fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'Draft brief' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add more details' }));

    expect(screen.getByLabelText('Description')).toBeInTheDocument();
    expect(screen.getByText('Additional Assignees')).toBeInTheDocument();
    expect(screen.getByText('Followers')).toBeInTheDocument();
    expect(screen.getByText('Projects')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Preview' })).toBeInTheDocument();
    expect(screen.getByText('Draft brief')).toBeInTheDocument();
    await selectPerson('Anya');
    await selectPerson('Chen', 'Additional Assignees');
    await selectPerson('Anya', 'Followers');
    fireEvent.change(screen.getByLabelText('Due Date *'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('Due Time'), { target: { value: '09:30' } });
    await selectSelectOption('Status', 'Review');
    await selectSelectOption('Department', 'Design');
    await selectProject('Launch');
    expect(screen.getAllByText('Anya').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Chen').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Review').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Design').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Launch/).length).toBeGreaterThan(0);
    expect(screen.queryByText('2026-10-01 09:30')).not.toBeInTheDocument();
  });

  it('validates title, assignee, due date, then submits the Phase 7.1 create payload once', async () => {
    renderWithProviders(<WorkspaceTasksPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create Task' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));

    expect(await screen.findByText('Task title is required.')).toBeInTheDocument();
    expect(screen.getByText('Assignee is required.')).toBeInTheDocument();
    expect(screen.getByText('Due date is required.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Title *'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));
    expect(await screen.findByText('Task title is required.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Title *'), { target: { value: '  Draft brief  ' } });
    await selectPerson('Anya');
    fireEvent.change(screen.getByLabelText('Due Date *'), { target: { value: '2026-09-30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));

    await waitFor(() => expect(createTaskMock).toHaveBeenCalledTimes(1));
    expect(createTaskMock).toHaveBeenCalledWith(
      'workspace-1',
      expect.objectContaining({
        title: 'Draft brief',
        assigneeMembershipIds: ['membership-a'],
        dueAt: taskDueAtFromLocalDate('2026-09-30'),
      }),
    );
    expect(toastSuccess).toHaveBeenCalledWith('Task created');
  });

  it('supports multiple assignees, followers with assignee overlap, priority, TASK status, department, and projects', async () => {
    renderWithProviders(<WorkspaceTasksPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create Task' }));
    fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'Advanced task' } });
    await selectPerson('Anya');
    fireEvent.change(screen.getByLabelText('Due Date *'), { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add more details' }));
    await selectPerson('Chen', 'Additional Assignees');
    await selectPerson('Anya', 'Followers');
    await selectSelectOption('Priority', 'High');
    await selectSelectOption('Status', 'Review');
    await selectSelectOption('Department', 'Design');
    await selectProject('Launch');

    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));
    await waitFor(() =>
      expect(createTaskMock).toHaveBeenCalledWith(
        'workspace-1',
        expect.objectContaining({
          assigneeMembershipIds: ['membership-a', 'membership-c'],
          followerMembershipIds: ['membership-a'],
          priority: 'HIGH',
          statusDefinitionId: 'status-review',
          departmentId: 'department-1',
          projectIds: ['project-1'],
        }),
      ),
    );
    expect(listWorkspaceStatuses).toHaveBeenCalledWith('workspace-1', 'TASK', 'ACTIVE');
  });

  it('prevents duplicate submit while create is pending', async () => {
    let resolveCreate: (value: unknown) => void = () => undefined;
    createTaskMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );
    renderWithProviders(<WorkspaceTasksPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create Task' }));
    await fillQuickTask();

    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));
    expect(await screen.findByRole('button', { name: 'Creating...' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('button', { name: 'Creating...' }).closest('form')!);
    fireEvent.keyDown(screen.getByLabelText('Due Date *'), { key: 'Enter', code: 'Enter' });
    expect(createTaskMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveCreate({ id: 'task-1' });
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('handles 422, 403, stale relation, conflict, and network create errors safely', async () => {
    createTaskMock.mockRejectedValueOnce(new Error('Task title is required.'));
    renderWithProviders(<WorkspaceTasksPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create Task' }));
    await fillQuickTask();
    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));
    expect(await screen.findByText('Task title is required.')).toBeInTheDocument();

    createTaskMock.mockRejectedValueOnce(
      Object.assign(new Error('Raw forbidden'), { status: 403 }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Permission denied'));
    expect(screen.getByDisplayValue('Draft brief')).toBeInTheDocument();

    createTaskMock.mockRejectedValueOnce(
      Object.assign(new Error('Project archived'), { status: 404 }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'A selected task detail is no longer available for this workspace.',
      ),
    );

    createTaskMock.mockRejectedValueOnce(Object.assign(new Error('Conflict'), { status: 409 }));
    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'Task could not be created because the selected data changed.',
      ),
    );

    createTaskMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'Network error. Check your connection and try again.',
      ),
    );
  });

  it('resets stale relation selections on workspace switch and scopes selector cache by workspace', async () => {
    renderWithProviders(<WorkspaceTasksPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create Task' }));
    await selectPerson('Anya');

    act(() => {
      useSessionStore.setState({ selectedWorkspaceId: 'workspace-2' });
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));
    expect(await screen.findByText('Bala')).toBeInTheDocument();
    expect(screen.queryByText('Anya')).not.toBeInTheDocument();
  });

  it('closes task creation when the authenticated session is lost', async () => {
    renderWithProviders(<WorkspaceTasksPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create Task' }));
    fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'Sensitive draft' } });
    act(() => {
      useSessionStore.setState({ accessToken: null });
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByDisplayValue('Sensitive draft')).not.toBeInTheDocument();
  });

  it('renders translated Tamil labels and all configured theme contexts', async () => {
    const tamilRender = render(
      <LanguageProvider>
        <TamilSwitch />
        <QueryHarness>
          <WorkspaceTasksPage />
        </QueryHarness>
      </LanguageProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'ta' }));
    expect(await screen.findByRole('heading', { name: 'பணிகள்' })).toBeInTheDocument();
    tamilRender.unmount();
    localStorage.setItem('zea-play-locale', 'en');

    for (const theme of ['light', 'dark', 'colorful'] as const) {
      localStorage.setItem('zea-play-theme', theme);
      const { unmount } = render(
        <ThemeProvider>
          <LanguageProvider>
            <QueryHarness>
              <WorkspaceTasksPage />
            </QueryHarness>
          </LanguageProvider>
        </ThemeProvider>,
      );
      expect(await screen.findByRole('heading', { name: 'Tasks' })).toBeInTheDocument();
      unmount();
    }
  });
});

describe('Phase 7.3A all tasks list/table foundation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentSearchParams = new URLSearchParams();
    localStorage.clear();
    useSessionStore.setState({
      selectedAgencyId: 'agency-1',
      selectedWorkspaceId: 'workspace-1',
      hydrated: true,
      accessToken: 'token',
      user: { id: 'admin-1', email: 'admin@zeaplay.test' },
    });
    listWorkspaceTasks.mockResolvedValue({
      items: [taskFixture({ id: 'task-alpha', title: 'Alpha launch task' })],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    getWorkspaceTask.mockResolvedValue(
      taskFixture({ id: 'task-alpha', title: 'Alpha launch task' }),
    );
    listWorkspaceUsers.mockResolvedValue({
      items: [user('membership-a', 'Anya'), user('membership-c', 'Chen')],
      page: 1,
      pageSize: 10,
      total: 2,
    });
    listDepartments.mockResolvedValue({
      items: [{ id: 'department-1', workspaceId: 'workspace-1', name: 'Design', status: 'ACTIVE' }],
      page: 1,
      pageSize: 100,
      total: 1,
    });
    listWorkspaceStatuses.mockResolvedValue([
      status('status-task', 'TASK', 'To Do'),
      status('status-review', 'TASK', 'Review', false),
    ]);
    listWorkspaceProjects.mockResolvedValue({
      items: [{ id: 'project-1', workspaceId: 'workspace-1', name: 'Launch', status: 'ACTIVE' }],
      page: 1,
      pageSize: 10,
      total: 1,
    });
    createTaskMock.mockResolvedValue({ id: 'task-new', title: 'New task' });
  });

  it('renders backend task rows and fetches detail only when opened', async () => {
    renderWithProviders(<WorkspaceTasksPage />);

    expect(await screen.findAllByText('Alpha launch task')).not.toHaveLength(0);
    expect(screen.getAllByText('To Do')).not.toHaveLength(0);
    expect(screen.getAllByText('High')).not.toHaveLength(0);
    expect(screen.getByText('Anya, Chen')).toBeInTheDocument();
    expect(screen.getByText('Design')).toBeInTheDocument();
    expect(screen.getByText('Launch')).toBeInTheDocument();
    expect(getWorkspaceTask).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Alpha launch task' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Task details');
    expect(getWorkspaceTask).toHaveBeenCalledWith('workspace-1', 'task-alpha');
    expect(await screen.findByText('Priya')).toBeInTheDocument();
  });

  it('uses workspace-scoped list keys and restores URL-backed list state', async () => {
    currentSearchParams = new URLSearchParams(
      'search=billing&page=2&pageSize=25&sortBy=updatedAt&sortDirection=asc&status=status-review&priority=URGENT&assignee=membership-a&department=department-1&project=project-1&dueFrom=2026-09-01&dueTo=2026-09-30',
    );

    renderWithProviders(<WorkspaceTasksPage />);

    await waitFor(() =>
      expect(listWorkspaceTasks).toHaveBeenCalledWith(
        'workspace-1',
        expect.objectContaining({
          page: 2,
          pageSize: 25,
          search: 'billing',
          sortBy: 'updatedAt',
          sortDirection: 'asc',
          statusDefinitionId: 'status-review',
          priority: 'URGENT',
          assigneeMembershipId: 'membership-a',
          departmentId: 'department-1',
          projectId: 'project-1',
        }),
      ),
    );
  });

  it('falls back safely for malformed URL list state', async () => {
    currentSearchParams = new URLSearchParams(
      'page=-5&pageSize=999999&sortBy=priority&sortDirection=sideways&priority=BLOCKER&status=bad!&assignee=also/bad&department=&project=project-1&dueFrom=2026-02-31&dueTo=not-a-date',
    );

    renderWithProviders(<WorkspaceTasksPage />);

    await waitFor(() =>
      expect(listWorkspaceTasks).toHaveBeenCalledWith(
        'workspace-1',
        expect.objectContaining({
          page: 1,
          pageSize: 25,
          sortBy: 'createdAt',
          sortDirection: 'desc',
          projectId: 'project-1',
        }),
      ),
    );
    expect(listWorkspaceTasks.mock.calls[0]?.[1]).not.toHaveProperty('priority');
    expect(listWorkspaceTasks.mock.calls[0]?.[1]).not.toHaveProperty('statusDefinitionId');
    expect(listWorkspaceTasks.mock.calls[0]?.[1]).not.toHaveProperty('assigneeMembershipId');
    expect(listWorkspaceTasks.mock.calls[0]?.[1]).not.toHaveProperty('dueFrom');
    expect(listWorkspaceTasks.mock.calls[0]?.[1]).not.toHaveProperty('dueTo');
  });

  it('debounces server-side search and resets page in the URL', async () => {
    currentSearchParams = new URLSearchParams('page=3');
    listWorkspaceTasks.mockResolvedValue({
      items: [taskFixture({ id: 'task-alpha', title: 'Alpha launch task' })],
      page: 3,
      pageSize: 25,
      total: 100,
    });
    renderWithProviders(<WorkspaceTasksPage />);

    fireEvent.change(await screen.findByLabelText('Search tasks'), {
      target: { value: 'a' },
    });
    fireEvent.change(screen.getByLabelText('Search tasks'), {
      target: { value: 'ab' },
    });
    fireEvent.change(screen.getByLabelText('Search tasks'), {
      target: { value: 'billing' },
    });
    await waitFor(() =>
      expect(routerReplace).toHaveBeenCalledWith('/workspace/tasks?search=billing', {
        scroll: false,
      }),
    );
    expect(routerReplace).toHaveBeenCalledTimes(1);
  });

  it('clearing search removes only search and keeps unrelated filters', async () => {
    currentSearchParams = new URLSearchParams('search=billing&page=3&priority=HIGH');
    renderWithProviders(<WorkspaceTasksPage />);

    fireEvent.change(await screen.findByLabelText('Search tasks'), { target: { value: '' } });

    await waitFor(() =>
      expect(routerReplace).toHaveBeenCalledWith('/workspace/tasks?priority=HIGH', {
        scroll: false,
      }),
    );
  });

  it('writes status, priority, assignee, department, project, due range, sort, and pagination to URL state', async () => {
    listWorkspaceTasks.mockResolvedValue({
      items: [taskFixture({ id: 'task-alpha', title: 'Alpha launch task' })],
      page: 1,
      pageSize: 20,
      total: 40,
    });
    renderWithProviders(<WorkspaceTasksPage />);

    await selectSelectOption('Status', 'Review');
    expect(routerReplace).toHaveBeenLastCalledWith('/workspace/tasks?status=status-review', {
      scroll: false,
    });

    await selectSelectOption('Priority', 'Urgent');
    expect(routerReplace).toHaveBeenLastCalledWith('/workspace/tasks?priority=URGENT', {
      scroll: false,
    });

    await selectSelectOption('Department', 'Design');
    expect(routerReplace).toHaveBeenLastCalledWith('/workspace/tasks?department=department-1', {
      scroll: false,
    });

    fireEvent.change(screen.getByLabelText('Search people'), { target: { value: 'An' } });
    await selectSelectOption('Assignee', 'Anya');
    expect(routerReplace).toHaveBeenLastCalledWith('/workspace/tasks?assignee=membership-a', {
      scroll: false,
    });

    fireEvent.change(screen.getByLabelText('Search projects'), { target: { value: 'La' } });
    await selectSelectOption('Project', 'Launch');
    expect(routerReplace).toHaveBeenLastCalledWith('/workspace/tasks?project=project-1', {
      scroll: false,
    });

    fireEvent.change(screen.getByLabelText('Due from'), { target: { value: '2026-09-01' } });
    expect(routerReplace).toHaveBeenLastCalledWith('/workspace/tasks?dueFrom=2026-09-01', {
      scroll: false,
    });
    fireEvent.click(screen.getByRole('button', { name: /Updated/i }));
    expect(routerReplace).toHaveBeenLastCalledWith(
      '/workspace/tasks?sortBy=updatedAt&sortDirection=asc',
      { scroll: false },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(routerReplace).toHaveBeenLastCalledWith('/workspace/tasks?page=2', { scroll: false });
  });

  it('uses friendly removable filter chips and corrects high pages after narrowed results', async () => {
    currentSearchParams = new URLSearchParams('page=5&status=status-task');
    listWorkspaceTasks.mockResolvedValue({
      items: [taskFixture({ id: 'task-alpha', title: 'Alpha launch task' })],
      page: 5,
      pageSize: 25,
      total: 1,
    });
    renderWithProviders(<WorkspaceTasksPage />);

    expect(await screen.findByText('Status: To Do')).toBeInTheDocument();
    await waitFor(() =>
      expect(routerReplace).toHaveBeenCalledWith('/workspace/tasks?page=1&status=status-task', {
        scroll: false,
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove filter Status: To Do' }));
    expect(routerReplace).toHaveBeenLastCalledWith('/workspace/tasks', { scroll: false });
  });

  it('does not mark terminal tasks overdue from due date alone', async () => {
    listWorkspaceTasks.mockResolvedValue({
      items: [
        taskFixture({
          id: 'task-done',
          title: 'Closed historical task',
          dueAt: '2020-01-01T00:00:00.000Z',
          status: status('status-done', 'TASK', 'Completed', false, true),
        }),
      ],
      page: 1,
      pageSize: 25,
      total: 1,
    });
    renderWithProviders(<WorkspaceTasksPage />);

    expect(await screen.findAllByText('Closed historical task')).not.toHaveLength(0);
    expect(screen.queryByText('Overdue')).not.toBeInTheDocument();
  });

  it('differentiates empty states, safe errors, clear filters, and create invalidation', async () => {
    listWorkspaceTasks.mockResolvedValueOnce({ items: [], page: 1, pageSize: 20, total: 0 });
    const { unmount } = renderWithProviders(<WorkspaceTasksPage />);
    expect(await screen.findByText('No tasks')).toBeInTheDocument();
    unmount();

    currentSearchParams = new URLSearchParams('priority=LOW');
    listWorkspaceTasks.mockResolvedValueOnce({ items: [], page: 1, pageSize: 20, total: 0 });
    const noMatch = renderWithProviders(<WorkspaceTasksPage />);
    expect(await screen.findByText('No matching tasks')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters/search' }));
    expect(routerReplace).toHaveBeenLastCalledWith('/workspace/tasks', { scroll: false });
    noMatch.unmount();

    listWorkspaceTasks.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden'), { status: 403 }),
    );
    const errorRender = renderWithProviders(<WorkspaceTasksPage />);
    expect(await screen.findByText('Permission denied')).toBeInTheDocument();
    errorRender.unmount();

    renderWithProviders(<WorkspaceTasksPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create Task' }));
    await fillQuickTask();
    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }));
    await waitFor(() => expect(createTaskMock).toHaveBeenCalled());
    await waitFor(() => expect(listWorkspaceTasks).toHaveBeenCalled());
  });

  it('clears tenant-bound filters and closes task detail on workspace switch', async () => {
    currentSearchParams = new URLSearchParams(
      'search=alpha&page=4&priority=HIGH&status=status-task&assignee=membership-a&department=department-1&project=project-1',
    );
    renderWithProviders(<WorkspaceTasksPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Alpha launch task' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    act(() => {
      useSessionStore.setState({ selectedWorkspaceId: 'workspace-2' });
    });

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(getWorkspaceTask).not.toHaveBeenCalledWith('workspace-2', 'task-alpha');
    expect(routerReplace).toHaveBeenLastCalledWith(
      '/workspace/tasks?search=alpha&page=1&priority=HIGH',
      { scroll: false },
    );
  });

  it('renders translated Tamil All Tasks labels and theme contexts', async () => {
    const tamilRender = render(
      <LanguageProvider>
        <TamilSwitch />
        <QueryHarness>
          <WorkspaceTasksPage />
        </QueryHarness>
      </LanguageProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'ta' }));
    expect(await screen.findByRole('heading', { name: 'அனைத்து பணிகள்' })).toBeInTheDocument();
    tamilRender.unmount();
    localStorage.setItem('zea-play-locale', 'en');

    for (const theme of ['light', 'dark', 'colorful'] as const) {
      localStorage.setItem('zea-play-theme', theme);
      const { unmount } = render(
        <ThemeProvider>
          <LanguageProvider>
            <QueryHarness>
              <WorkspaceTasksPage />
            </QueryHarness>
          </LanguageProvider>
        </ThemeProvider>,
      );
      expect(await screen.findByRole('heading', { name: 'All Tasks' })).toBeInTheDocument();
      unmount();
    }
  });
});

describe('Phase 7.3B all tasks grid and compact views', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentSearchParams = new URLSearchParams();
    localStorage.clear();
    useSessionStore.setState({
      selectedAgencyId: 'agency-1',
      selectedWorkspaceId: 'workspace-1',
      hydrated: true,
      accessToken: 'token',
      user: { id: 'admin-1', email: 'admin@zeaplay.test' },
    });
    listWorkspaceTasks.mockResolvedValue({
      items: [taskFixture({ id: 'task-alpha', title: 'Alpha launch task' })],
      page: 1,
      pageSize: 25,
      total: 1,
    });
    getWorkspaceTask.mockResolvedValue(
      taskFixture({ id: 'task-alpha', title: 'Alpha launch task' }),
    );
    listWorkspaceUsers.mockResolvedValue({
      items: [user('membership-a', 'Anya'), user('membership-c', 'Chen')],
      page: 1,
      pageSize: 10,
      total: 2,
    });
    listDepartments.mockResolvedValue({
      items: [{ id: 'department-1', workspaceId: 'workspace-1', name: 'Design', status: 'ACTIVE' }],
      page: 1,
      pageSize: 100,
      total: 1,
    });
    listWorkspaceStatuses.mockResolvedValue([status('status-task', 'TASK', 'To Do')]);
    listWorkspaceProjects.mockResolvedValue({
      items: [{ id: 'project-1', workspaceId: 'workspace-1', name: 'Launch', status: 'ACTIVE' }],
      page: 1,
      pageSize: 10,
      total: 1,
    });
  });

  it('defaults to List when no URL view or stored preference exists', async () => {
    renderWithProviders(<WorkspaceTasksPage />);

    expect(await screen.findByRole('button', { name: 'List' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(await screen.findAllByText('Alpha launch task')).not.toHaveLength(0);
  });

  it('uses stored view preference only when URL view is absent', async () => {
    localStorage.setItem('zea-play-all-tasks-view', 'grid');
    renderWithProviders(<WorkspaceTasksPage />);

    expect(await screen.findByRole('button', { name: 'Grid' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(
      await screen.findByRole('button', { name: /Open task details: Alpha launch task/ }),
    ).toBeInTheDocument();
  });

  it('lets URL view override preference and safely falls back for malformed values', async () => {
    localStorage.setItem('zea-play-all-tasks-view', 'grid');
    currentSearchParams = new URLSearchParams('view=compact');
    const compactRender = renderWithProviders(<WorkspaceTasksPage />);

    expect(await screen.findByRole('button', { name: 'Compact' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    compactRender.unmount();

    for (const rawView of ['', 'banana', 'LIST', 'null']) {
      currentSearchParams = new URLSearchParams(`view=${rawView}`);
      const invalidRender = renderWithProviders(<WorkspaceTasksPage />);

      expect(await screen.findByRole('button', { name: 'List' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      invalidRender.unmount();
    }
  });

  it('falls back to List for invalid stored preferences', async () => {
    localStorage.setItem('zea-play-all-tasks-view', 'banana');
    renderWithProviders(<WorkspaceTasksPage />);

    expect(await screen.findByRole('button', { name: 'List' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('switches views through URL state without changing the Task list query params', async () => {
    currentSearchParams = new URLSearchParams(
      'search=invoice&priority=HIGH&status=status-task&assignee=membership-a&department=department-1&project=project-1&dueFrom=2026-09-01&dueTo=2026-09-30&page=2&pageSize=50&sortBy=updatedAt&sortDirection=asc',
    );
    listWorkspaceTasks.mockResolvedValue({
      items: [taskFixture({ id: 'task-alpha', title: 'Alpha launch task' })],
      page: 2,
      pageSize: 50,
      total: 100,
    });
    renderWithProviders(<WorkspaceTasksPage />);
    expect(await screen.findAllByText('Alpha launch task')).not.toHaveLength(0);
    expect(listWorkspaceTasks).toHaveBeenCalledTimes(1);
    const initialParams = listWorkspaceTasks.mock.calls[0]?.[1];

    fireEvent.click(screen.getByRole('button', { name: 'Grid' }));
    await waitFor(() => expect(localStorage.getItem('zea-play-all-tasks-view')).toBe('grid'));
    expect(routerReplace).toHaveBeenLastCalledWith(expect.stringContaining('view=grid'), {
      scroll: false,
    });
    expect(routerReplace.mock.calls[routerReplace.mock.calls.length - 1]?.[0]).toContain(
      'search=invoice',
    );
    expect(routerReplace.mock.calls[routerReplace.mock.calls.length - 1]?.[0]).toContain(
      'priority=HIGH',
    );
    expect(routerReplace.mock.calls[routerReplace.mock.calls.length - 1]?.[0]).toContain(
      'status=status-task',
    );
    expect(routerReplace.mock.calls[routerReplace.mock.calls.length - 1]?.[0]).toContain(
      'assignee=membership-a',
    );
    expect(routerReplace.mock.calls[routerReplace.mock.calls.length - 1]?.[0]).toContain(
      'department=department-1',
    );
    expect(routerReplace.mock.calls[routerReplace.mock.calls.length - 1]?.[0]).toContain(
      'project=project-1',
    );
    expect(routerReplace.mock.calls[routerReplace.mock.calls.length - 1]?.[0]).toContain(
      'dueFrom=2026-09-01',
    );
    expect(routerReplace.mock.calls[routerReplace.mock.calls.length - 1]?.[0]).toContain(
      'dueTo=2026-09-30',
    );
    expect(routerReplace.mock.calls[routerReplace.mock.calls.length - 1]?.[0]).toContain('page=2');
    expect(listWorkspaceTasks).toHaveBeenCalledTimes(1);
    expect(listWorkspaceTasks.mock.calls[0]?.[1]).toEqual(initialParams);

    fireEvent.click(screen.getByRole('button', { name: 'Compact' }));
    await waitFor(() => expect(localStorage.getItem('zea-play-all-tasks-view')).toBe('compact'));
    expect(routerReplace).toHaveBeenLastCalledWith(expect.stringContaining('view=compact'), {
      scroll: false,
    });
    expect(listWorkspaceTasks).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    await waitFor(() => expect(localStorage.getItem('zea-play-all-tasks-view')).toBe('list'));
    expect(routerReplace).toHaveBeenLastCalledWith(expect.stringContaining('view=list'), {
      scroll: false,
    });
    expect(listWorkspaceTasks).toHaveBeenCalledTimes(1);
  });

  it('renders only the active Task presentation for Grid and Compact', async () => {
    renderWithProviders(<WorkspaceTasksPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Grid' }));
    expect(
      screen.getByRole('button', { name: /Open task details: Alpha launch task/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Task' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Alpha launch task' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Compact' }));
    expect(
      screen.getByRole('button', { name: /Open task details: Alpha launch task/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Task' })).not.toBeInTheDocument();
    expect(screen.queryByText('Launch checklist')).not.toBeInTheDocument();
  });

  it('renders Grid task data and opens the existing detail dialog', async () => {
    renderWithProviders(<WorkspaceTasksPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Grid' }));
    expect(
      screen.getByRole('button', { name: /Open task details: Alpha launch task/ }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('To Do')).not.toHaveLength(0);
    expect(screen.getAllByText('High')).not.toHaveLength(0);
    expect(screen.getByText('Anya, Chen')).toBeInTheDocument();
    expect(getWorkspaceTask).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Open task details: Alpha launch task/ }));

    expect(await screen.findByRole('dialog')).toHaveTextContent('Task details');
    expect(getWorkspaceTask).toHaveBeenCalledWith('workspace-1', 'task-alpha');
  });

  it('renders Compact task data and opens the existing detail dialog', async () => {
    renderWithProviders(<WorkspaceTasksPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Compact' }));
    expect(
      screen.getByRole('button', { name: /Open task details: Alpha launch task/ }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('To Do')).not.toHaveLength(0);
    expect(screen.getAllByText('High')).not.toHaveLength(0);
    expect(getWorkspaceTask).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Open task details: Alpha launch task/ }));

    expect(await screen.findByRole('dialog')).toHaveTextContent('Task details');
    expect(getWorkspaceTask).toHaveBeenCalledWith('workspace-1', 'task-alpha');
  });

  it('closes Grid and Compact detail on workspace switch without foreign detail fetches', async () => {
    for (const view of ['grid', 'compact'] as const) {
      vi.clearAllMocks();
      currentSearchParams = new URLSearchParams(`view=${view}`);
      listWorkspaceTasks.mockResolvedValue({
        items: [taskFixture({ id: 'task-alpha', title: 'Alpha launch task' })],
        page: 1,
        pageSize: 25,
        total: 1,
      });
      getWorkspaceTask.mockResolvedValue(
        taskFixture({ id: 'task-alpha', title: 'Alpha launch task' }),
      );
      const rendered = renderWithProviders(<WorkspaceTasksPage />);

      fireEvent.click(
        await screen.findByRole('button', { name: /Open task details: Alpha launch task/ }),
      );
      expect(await screen.findByRole('dialog')).toHaveTextContent('Task details');

      act(() => {
        useSessionStore.setState({ selectedWorkspaceId: 'workspace-2' });
      });

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(getWorkspaceTask).not.toHaveBeenCalledWith('workspace-2', 'task-alpha');
      rendered.unmount();
      useSessionStore.setState({ selectedWorkspaceId: 'workspace-1' });
    }
  });

  it('keeps due state semantics consistent in Grid and Compact', async () => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12).toISOString();
    const future = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 5, 12).toISOString();
    const overdue = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - 5,
      12,
    ).toISOString();

    for (const view of ['grid', 'compact'] as const) {
      currentSearchParams = new URLSearchParams(`view=${view}`);
      listWorkspaceTasks.mockResolvedValueOnce({
        items: [
          taskFixture({ id: `${view}-future`, title: `${view} future`, dueAt: future }),
          taskFixture({ id: `${view}-today`, title: `${view} today`, dueAt: today }),
          taskFixture({ id: `${view}-overdue`, title: `${view} overdue`, dueAt: overdue }),
          taskFixture({
            id: `${view}-terminal-overdue`,
            title: `${view} terminal overdue`,
            dueAt: overdue,
            status: status('status-done', 'TASK', 'Completed', false, true),
          }),
          taskFixture({
            id: `${view}-terminal-future`,
            title: `${view} terminal future`,
            dueAt: future,
            status: status('status-done', 'TASK', 'Completed', false, true),
          }),
        ],
        page: 1,
        pageSize: 25,
        total: 5,
      });
      const rendered = renderWithProviders(<WorkspaceTasksPage />);

      expect(await screen.findByText(`${view} future`)).toBeInTheDocument();
      expect(screen.getByText('Upcoming')).toBeInTheDocument();
      expect(screen.getByText('Due today')).toBeInTheDocument();
      expect(screen.getByText('Overdue')).toBeInTheDocument();
      const terminalOverdue = screen.getByRole('button', {
        name: new RegExp(`Open task details: ${view} terminal overdue`),
      });
      expect(within(terminalOverdue).queryByText('Overdue')).not.toBeInTheDocument();
      const terminalFuture = screen.getByRole('button', {
        name: new RegExp(`Open task details: ${view} terminal future`),
      });
      expect(within(terminalFuture).queryByText('Upcoming')).not.toBeInTheDocument();
      rendered.unmount();
    }
  });

  it('keeps assignee/project summaries and long content bounded in Grid and Compact', async () => {
    const longTitle =
      'A very long task title that should stay bounded inside every presentation mode without stretching the layout';
    const longDepartment =
      'A very long department name that should truncate instead of expanding compact rows';
    const longProject =
      'A very long project name that should truncate instead of expanding task cards';
    const tasks = [
      taskFixture({ id: 'summary-empty', title: 'Summary empty', assignees: [], projects: [] }),
      taskFixture({
        id: 'summary-one',
        title: 'Summary one',
        assignees: [
          { id: 'membership-a', user: { id: 'user-a', email: 'anya@zeaplay.test', name: 'Anya' } },
        ],
        projects: [
          {
            id: 'project-1',
            workspaceId: 'workspace-1',
            name: 'Launch',
            description: null,
            status: 'ACTIVE',
            createdById: 'admin-1',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        counts: { assignees: 1, followers: 0, projects: 1 },
      }),
      taskFixture({
        id: 'summary-many',
        title: longTitle,
        department: {
          id: 'department-long',
          workspaceId: 'workspace-1',
          name: longDepartment,
          description: null,
          status: 'ACTIVE',
          manager: null,
          memberCount: 0,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        projects: [
          {
            id: 'project-long',
            workspaceId: 'workspace-1',
            name: longProject,
            description: null,
            status: 'ACTIVE',
            createdById: 'admin-1',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
          {
            id: 'project-2',
            workspaceId: 'workspace-1',
            name: 'Second project',
            description: null,
            status: 'ACTIVE',
            createdById: 'admin-1',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
          {
            id: 'project-3',
            workspaceId: 'workspace-1',
            name: 'Third project',
            description: null,
            status: 'ACTIVE',
            createdById: 'admin-1',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        assignees: [
          { id: 'membership-a', user: { id: 'user-a', email: 'anya@zeaplay.test', name: 'Anya' } },
          { id: 'membership-c', user: { id: 'user-c', email: 'chen@zeaplay.test', name: 'Chen' } },
          { id: 'membership-d', user: { id: 'user-d', email: 'dev@zeaplay.test', name: 'Dev' } },
        ],
        counts: { assignees: 3, followers: 0, projects: 3 },
      }),
    ];

    for (const view of ['grid', 'compact'] as const) {
      currentSearchParams = new URLSearchParams(`view=${view}`);
      listWorkspaceTasks.mockResolvedValueOnce({ items: tasks, page: 1, pageSize: 25, total: 3 });
      const rendered = renderWithProviders(<WorkspaceTasksPage />);

      expect(await screen.findByText('Summary empty')).toBeInTheDocument();
      const oneSummary = taskSurfaceFromOpenButton(
        screen.getByRole('button', { name: /Open task details: Summary one/ }),
      );
      expect(oneSummary).toHaveTextContent('Anya');
      expect(oneSummary).toHaveTextContent('Launch');
      const manySummary = taskSurfaceFromOpenButton(
        screen.getByRole('button', {
          name: new RegExp(`Open task details: ${longTitle}`),
        }),
      );
      expect(manySummary).toHaveTextContent('Anya, Chen +1');
      expect(manySummary).toHaveTextContent(`${longProject} +2`);
      expect(screen.getAllByTitle(longTitle)).not.toHaveLength(0);
      expect(screen.getAllByTitle((content) => content.includes(longDepartment))).not.toHaveLength(
        0,
      );
      rendered.unmount();
    }
  });

  it('keeps neutral view preference while workspace switch clears tenant filters', async () => {
    currentSearchParams = new URLSearchParams(
      'view=grid&search=alpha&page=4&priority=HIGH&status=status-task&assignee=membership-a&department=department-1&project=project-1',
    );
    renderWithProviders(<WorkspaceTasksPage />);
    expect(await screen.findByRole('button', { name: 'Grid' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    act(() => {
      useSessionStore.setState({ selectedWorkspaceId: 'workspace-2' });
    });

    await waitFor(() =>
      expect(routerReplace).toHaveBeenLastCalledWith(
        '/workspace/tasks?view=grid&search=alpha&page=1&priority=HIGH',
        { scroll: false },
      ),
    );
  });

  it('renders English/Tamil view labels and supported theme contexts', async () => {
    const tamilRender = render(
      <LanguageProvider>
        <TamilSwitch />
        <QueryHarness>
          <WorkspaceTasksPage />
        </QueryHarness>
      </LanguageProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'ta' }));
    expect(await screen.findByRole('button', { name: 'கட்டம்' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'சுருக்கம்' })).toBeInTheDocument();
    tamilRender.unmount();
    localStorage.setItem('zea-play-locale', 'en');

    for (const theme of ['light', 'dark', 'colorful'] as const) {
      localStorage.setItem('zea-play-theme', theme);
      const { unmount } = render(
        <ThemeProvider>
          <LanguageProvider>
            <QueryHarness>
              <WorkspaceTasksPage />
            </QueryHarness>
          </LanguageProvider>
        </ThemeProvider>,
      );
      expect(await screen.findByRole('button', { name: 'List' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Grid' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Compact' })).toBeInTheDocument();
      unmount();
    }
  });
});

describe('Phase 7.2 task service payload construction', () => {
  it('keeps tenant headers centralized and compacts empty optional fields', async () => {
    const requestSpy = vi.spyOn(apiClient, 'request').mockResolvedValueOnce({
      data: { id: 'task-1' },
      meta: {},
    } as never);

    const actual = await vi.importActual<typeof import('../services/workspace-tasks')>(
      '../services/workspace-tasks',
    );
    await actual.createWorkspaceTask('workspace-1', {
      title: '  Ship UI  ',
      dueAt: '2026-09-30T18:29:59.999Z',
      assigneeMembershipIds: ['membership-a'],
      description: '  ',
      priority: 'MEDIUM',
      followerMembershipIds: [],
      projectIds: [],
    });

    expect(requestSpy).toHaveBeenCalledWith('/workspaces/workspace-1/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Ship UI',
        dueAt: '2026-09-30T18:29:59.999Z',
        assigneeMembershipIds: ['membership-a'],
        priority: 'MEDIUM',
      }),
    });
    requestSpy.mockRestore();
  });

  it('converts local due dates and optional due times to deterministic UTC ISO strings', () => {
    expect(taskDueAtFromLocalDate('2026-01-15')).toBe(
      new Date(2026, 0, 15, 23, 59, 59, 999).toISOString(),
    );
    expect(taskDueAtFromLocalDate('2026-01-31')).toBe(
      new Date(2026, 0, 31, 23, 59, 59, 999).toISOString(),
    );
    expect(taskDueAtFromLocalDate('2026-12-31')).toBe(
      new Date(2026, 11, 31, 23, 59, 59, 999).toISOString(),
    );
    expect(taskDueAtFromLocalDate('2026-12-31', '09:30')).toBe(
      new Date(2026, 11, 31, 9, 30, 0, 0).toISOString(),
    );
  });

  it('converts due-range local dates to deterministic UTC boundaries', async () => {
    const actual = await vi.importActual<typeof import('../services/workspace-tasks')>(
      '../services/workspace-tasks',
    );

    expect(actual.taskDueBoundaryFromLocalDate('2026-01-15', 'start')).toBe(
      new Date(2026, 0, 15, 0, 0, 0, 0).toISOString(),
    );
    expect(actual.taskDueBoundaryFromLocalDate('2026-01-15', 'end')).toBe(
      new Date(2026, 0, 15, 23, 59, 59, 999).toISOString(),
    );
    expect(actual.taskDueBoundaryFromLocalDate('2026-01-31', 'end')).toBe(
      new Date(2026, 0, 31, 23, 59, 59, 999).toISOString(),
    );
    expect(actual.taskDueBoundaryFromLocalDate('2026-12-31', 'end')).toBe(
      new Date(2026, 11, 31, 23, 59, 59, 999).toISOString(),
    );
    expect(actual.taskDueBoundaryFromLocalDate('2026-02-31', 'start')).toBe('');
  });

  it('normalizes list params, uses workspace-scoped keys, and centralizes due-range boundaries', async () => {
    const requestSpy = vi.spyOn(apiClient, 'request').mockResolvedValueOnce({
      data: { items: [], page: 1, pageSize: 25, total: 0 },
      meta: {},
    } as never);
    const actual = await vi.importActual<typeof import('../services/workspace-tasks')>(
      '../services/workspace-tasks',
    );

    const normalized = actual.normalizeTaskListParams({
      page: 0,
      pageSize: 500,
      search: '  billing  ',
      sortBy: 'updatedAt',
      sortDirection: 'asc',
      priority: 'HIGH',
      dueFrom: actual.taskDueBoundaryFromLocalDate('2026-09-01', 'start'),
      dueTo: actual.taskDueBoundaryFromLocalDate('2026-09-30', 'end'),
    });

    expect(normalized).toEqual(
      expect.objectContaining({
        page: 1,
        pageSize: 25,
        search: 'billing',
        sortBy: 'updatedAt',
        sortDirection: 'asc',
        priority: 'HIGH',
        dueFrom: new Date(2026, 8, 1, 0, 0, 0, 0).toISOString(),
        dueTo: new Date(2026, 8, 30, 23, 59, 59, 999).toISOString(),
      }),
    );
    expect(actual.taskKeys.list('workspace-1', normalized)[1]).toBe('workspace-1');
    expect(actual.taskKeys.detail('workspace-1', 'task-1')).toEqual([
      'workspace',
      'workspace-1',
      'tasks',
      'detail',
      'task-1',
    ]);

    await actual.listWorkspaceTasks('workspace-1', normalized);
    expect(requestSpy).toHaveBeenCalledWith(
      expect.stringContaining('/workspaces/workspace-1/tasks?'),
    );
    const [requestUrl] = requestSpy.mock.calls[0] ?? [];
    expect(requestUrl).toContain('search=billing');
    expect(requestUrl).toContain('pageSize=25');
    requestSpy.mockRestore();
  });
});

describe('Phase 7.3C2 task bulk selection UX', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentSearchParams = new URLSearchParams();
    localStorage.clear();
    useSessionStore.setState({
      selectedAgencyId: 'agency-1',
      selectedWorkspaceId: 'workspace-1',
      hydrated: true,
      accessToken: 'token',
      user: { id: 'admin-1', email: 'admin@zeaplay.test' },
    });
    listWorkspaceTasks.mockResolvedValue({
      items: [
        taskFixture({ id: 'task-alpha', title: 'Alpha launch task' }),
        taskFixture({ id: 'task-beta', title: 'Beta review task', priority: 'LOW' }),
      ],
      page: 1,
      pageSize: 25,
      total: 2,
    });
    getWorkspaceTask.mockResolvedValue(
      taskFixture({ id: 'task-alpha', title: 'Alpha launch task' }),
    );
    listWorkspaceUsers.mockResolvedValue({
      items: [user('membership-a', 'Anya'), user('membership-c', 'Chen')],
      page: 1,
      pageSize: 10,
      total: 2,
    });
    listDepartments.mockResolvedValue({
      items: [{ id: 'department-1', workspaceId: 'workspace-1', name: 'Design', status: 'ACTIVE' }],
      page: 1,
      pageSize: 100,
      total: 1,
    });
    listWorkspaceStatuses.mockResolvedValue([
      status('status-task', 'TASK', 'To Do'),
      status('status-review', 'TASK', 'Review', false),
    ]);
    listWorkspaceProjects.mockResolvedValue({
      items: [{ id: 'project-1', workspaceId: 'workspace-1', name: 'Launch', status: 'ACTIVE' }],
      page: 1,
      pageSize: 10,
      total: 1,
    });
    bulkUpdateTaskStatus.mockResolvedValue({
      requestedCount: 2,
      changedCount: 1,
      unchangedCount: 1,
    });
    bulkUpdateTaskPriority.mockResolvedValue({
      requestedCount: 2,
      changedCount: 2,
      unchangedCount: 0,
    });
    bulkAddTaskAssignees.mockResolvedValue({
      requestedCount: 2,
      changedCount: 2,
      unchangedCount: 0,
      relationChangedCount: 2,
      relationUnchangedCount: 0,
    });
    bulkRemoveTaskAssignees.mockResolvedValue({
      requestedCount: 2,
      changedCount: 1,
      unchangedCount: 1,
      relationChangedCount: 1,
      relationUnchangedCount: 1,
    });
    bulkDeleteTasks.mockResolvedValue({ requestedCount: 1, changedCount: 1, unchangedCount: 0 });
  });

  it('shares selection across List, Grid, and Compact without refetching on view switch', async () => {
    renderWithProviders(<WorkspaceTasksPage />);

    fireEvent.click(await firstByLabelText('Select task: Alpha launch task'));
    expectSelectedText('1 task selected');
    expect(listWorkspaceTasks).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Grid' }));
    expect(await firstByLabelText('Select task: Alpha launch task')).toHaveAttribute(
      'data-state',
      'checked',
    );
    expectSelectedText('1 task selected');
    expect(listWorkspaceTasks).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Compact' }));
    expect(await firstByLabelText('Select task: Alpha launch task')).toHaveAttribute(
      'data-state',
      'checked',
    );
    expectSelectedText('1 task selected');
    expect(listWorkspaceTasks).toHaveBeenCalledTimes(1);
  });

  it('selects, indeterminates, and deselects only the current page', async () => {
    renderWithProviders(<WorkspaceTasksPage />);

    fireEvent.click(await firstByLabelText('Select task: Alpha launch task'));
    expect(screen.getByLabelText('Select all on this page')).toHaveAttribute(
      'data-state',
      'indeterminate',
    );
    fireEvent.click(screen.getByLabelText('Select all on this page'));
    expectSelectedText('2 tasks selected');
    expect(screen.getByLabelText('Select all on this page')).toHaveAttribute(
      'data-state',
      'checked',
    );
    fireEvent.click(screen.getByLabelText('Select all on this page'));
    expectNoSelectedText('2 tasks selected');
  });

  it('bulk status and priority each send one request and clear selection on success', async () => {
    renderWithProviders(<WorkspaceTasksPage />);
    fireEvent.click(await screen.findByLabelText('Select all on this page'));

    fireEvent.click(screen.getByRole('button', { name: 'Change status' }));
    await selectSelectOption('Status', 'Review');
    fireEvent.click(screen.getByRole('button', { name: 'Update 2 tasks' }));
    await waitFor(() => expect(bulkUpdateTaskStatus).toHaveBeenCalledTimes(1));
    expect(bulkUpdateTaskStatus).toHaveBeenCalledWith('workspace-1', {
      taskIds: ['task-alpha', 'task-beta'],
      statusDefinitionId: 'status-review',
    });
    expect(toastSuccess).toHaveBeenCalledWith('1 tasks updated. 1 already matched.');
    await waitFor(() => expectNoSelectedText('2 tasks selected'));

    fireEvent.click(screen.getByLabelText('Select all on this page'));
    fireEvent.click(screen.getByRole('button', { name: 'Change priority' }));
    await selectSelectOption('Priority', 'Urgent');
    fireEvent.click(screen.getByRole('button', { name: 'Update 2 tasks' }));
    await waitFor(() => expect(bulkUpdateTaskPriority).toHaveBeenCalledTimes(1));
    expect(bulkUpdateTaskPriority).toHaveBeenCalledWith('workspace-1', {
      taskIds: ['task-alpha', 'task-beta'],
      priority: 'URGENT',
    });
  });

  it('bulk assignee add/remove each send one request and preserve selection on failure', async () => {
    bulkRemoveTaskAssignees.mockRejectedValueOnce(
      Object.assign(new Error('gone'), { status: 404 }),
    );
    renderWithProviders(<WorkspaceTasksPage />);
    fireEvent.click(await screen.findByLabelText('Select all on this page'));

    fireEvent.click(screen.getByRole('button', { name: 'Add assignees' }));
    fireEvent.click(await screen.findByLabelText('Anya'));
    fireEvent.click(screen.getByRole('button', { name: 'Add to 2 tasks' }));
    await waitFor(() => expect(bulkAddTaskAssignees).toHaveBeenCalledTimes(1));
    expect(bulkAddTaskAssignees).toHaveBeenCalledWith('workspace-1', {
      taskIds: ['task-alpha', 'task-beta'],
      membershipIds: ['membership-a'],
    });

    fireEvent.click(screen.getByLabelText('Select all on this page'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove assignees' }));
    fireEvent.click(await screen.findByLabelText('Chen'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove from 2 tasks' }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'One or more selected tasks are no longer available. Refresh and try again.',
      ),
    );
    expect(bulkRemoveTaskAssignees).toHaveBeenCalledTimes(1);
    expectSelectedText('2 tasks selected');
  });

  it('clears selection on dataset changes, workspace switch, and session loss', async () => {
    listWorkspaceTasks.mockResolvedValue({
      items: [
        taskFixture({ id: 'task-alpha', title: 'Alpha launch task' }),
        taskFixture({ id: 'task-beta', title: 'Beta review task' }),
      ],
      page: 1,
      pageSize: 25,
      total: 50,
    });
    const searchRender = renderWithProviders(<WorkspaceTasksPage />);

    fireEvent.click(await firstByLabelText('Select task: Alpha launch task'));
    fireEvent.change(screen.getByLabelText('Search tasks'), { target: { value: 'billing' } });
    await waitFor(() => expectNoSelectedText('1 task selected'));
    searchRender.unmount();

    const datasetRender = renderWithProviders(<WorkspaceTasksPage />);

    fireEvent.click(await firstByLabelText('Select task: Alpha launch task'));
    await selectSelectOption('Priority', 'Urgent');
    expectNoSelectedText('1 task selected');

    fireEvent.click(await firstByLabelText('Select task: Alpha launch task'));
    fireEvent.click(screen.getByRole('button', { name: /Updated/i }));
    expectNoSelectedText('1 task selected');

    fireEvent.click(await firstByLabelText('Select task: Alpha launch task'));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expectNoSelectedText('1 task selected');

    fireEvent.click(await firstByLabelText('Select task: Alpha launch task'));
    act(() => {
      useSessionStore.setState({ selectedWorkspaceId: 'workspace-2' });
    });
    await waitFor(() => expectNoSelectedText('1 task selected'));
    datasetRender.unmount();

    act(() => {
      useSessionStore.setState({ selectedWorkspaceId: 'workspace-1' });
    });
    renderWithProviders(<WorkspaceTasksPage />);
    fireEvent.click(await firstByLabelText('Select task: Alpha launch task'));
    act(() => {
      useSessionStore.setState({ accessToken: null });
    });
    await waitFor(() => expectNoSelectedText('1 task selected'));
  });

  it('bulk delete requires confirmation and sends one request', async () => {
    renderWithProviders(<WorkspaceTasksPage />);
    fireEvent.click(await firstByLabelText('Select task: Alpha launch task'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete tasks' }));

    expect(screen.getByText('Delete 1 selected tasks?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete 1 tasks' }));

    await waitFor(() => expect(bulkDeleteTasks).toHaveBeenCalledTimes(1));
    expect(bulkDeleteTasks).toHaveBeenCalledWith('workspace-1', { taskIds: ['task-alpha'] });
    expectNoSelectedText('1 task selected');
  });

  it('renders Tamil bulk labels and theme contexts', async () => {
    const tamilRender = render(
      <LanguageProvider>
        <TamilSwitch />
        <QueryHarness>
          <WorkspaceTasksPage />
        </QueryHarness>
      </LanguageProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'ta' }));
    const tamilTaskCheckbox = (await screen.findAllByRole('checkbox')).find((node) =>
      node.getAttribute('aria-label')?.includes('Alpha launch task'),
    );
    expect(tamilTaskCheckbox).toBeTruthy();
    fireEvent.click(tamilTaskCheckbox!);
    expect(await screen.findByText('மொத்த செயல்கள்')).toBeInTheDocument();
    tamilRender.unmount();
    localStorage.setItem('zea-play-locale', 'en');

    for (const theme of ['light', 'dark', 'colorful'] as const) {
      localStorage.setItem('zea-play-theme', theme);
      const { unmount } = render(
        <ThemeProvider>
          <LanguageProvider>
            <QueryHarness>
              <WorkspaceTasksPage />
            </QueryHarness>
          </LanguageProvider>
        </ThemeProvider>,
      );
      fireEvent.click(await firstByLabelText('Select task: Alpha launch task'));
      expect(screen.getByText('Bulk actions')).toBeInTheDocument();
      unmount();
    }
  });
});

async function fillQuickTask() {
  fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'Draft brief' } });
  await selectPerson('Anya');
  fireEvent.change(screen.getByLabelText('Due Date *'), { target: { value: '2026-09-30' } });
}

async function selectPerson(name: string, groupLabel = 'Assignee') {
  const region = screen.getByRole('group', { name: groupLabel });
  fireEvent.click(await within(region).findByRole('button', { name: new RegExp(name) }));
}

async function selectProject(name: string) {
  const region = screen.getByRole('group', { name: 'Projects' });
  fireEvent.click(await within(region).findByRole('button', { name: new RegExp(name) }));
}

async function selectSelectOption(label: string, option: string) {
  fireEvent.click(screen.getByRole('combobox', { name: label }));
  fireEvent.click(await screen.findByRole('option', { name: option }));
}

async function firstByLabelText(label: string) {
  const elements = await screen.findAllByLabelText(label);
  return elements[0] as HTMLElement;
}

function expectSelectedText(text: string) {
  expect(screen.getAllByText(text).length).toBeGreaterThan(0);
}

function expectNoSelectedText(text: string) {
  expect(screen.queryAllByText(text)).toHaveLength(0);
}

function taskSurfaceFromOpenButton(button: HTMLElement) {
  return (button.closest('div.grid') ?? button.parentElement ?? button) as HTMLElement;
}

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

function user(membershipId: string, name: string) {
  return {
    id: `${membershipId}-user`,
    membershipId,
    workspaceId: 'workspace-1',
    email: `${name.toLowerCase()}@zeaplay.test`,
    name,
    userStatus: 'ACTIVE',
    membershipStatus: 'ACTIVE',
    role: { id: 'role-1', key: 'MEMBER', name: 'Member' },
    department: null,
    joinedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function status(
  id: string,
  entityType: string,
  name: string,
  isDefault = true,
  isTerminal = false,
) {
  return {
    id,
    workspaceId: 'workspace-1',
    entityType,
    name,
    description: null,
    color: '#64748B',
    position: 1,
    category: 'TODO',
    isDefault,
    isTerminal,
    isActive: true,
    isSystem: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function taskFixture(overrides: Partial<ReturnType<typeof taskFixtureBase>>) {
  return { ...taskFixtureBase(), ...overrides };
}

function taskFixtureBase() {
  return {
    id: 'task-alpha',
    workspaceId: 'workspace-1',
    title: 'Alpha launch task',
    description: 'Launch checklist',
    priority: 'HIGH',
    status: status('status-task', 'TASK', 'To Do'),
    department: {
      id: 'department-1',
      workspaceId: 'workspace-1',
      name: 'Design',
      description: null,
      status: 'ACTIVE',
      manager: null,
      memberCount: 2,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    dueAt: new Date(2026, 8, 30, 9, 30).toISOString(),
    assignees: [
      { id: 'membership-a', user: { id: 'user-a', email: 'anya@zeaplay.test', name: 'Anya' } },
      { id: 'membership-c', user: { id: 'user-c', email: 'chen@zeaplay.test', name: 'Chen' } },
    ],
    followers: [
      { id: 'membership-p', user: { id: 'user-p', email: 'priya@zeaplay.test', name: 'Priya' } },
    ],
    projects: [
      {
        id: 'project-1',
        workspaceId: 'workspace-1',
        name: 'Launch',
        description: null,
        status: 'ACTIVE',
        createdById: 'admin-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    counts: { assignees: 2, followers: 1, projects: 1 },
    createdBy: { id: 'admin-1', email: 'admin@zeaplay.test', name: 'Admin' },
    updatedBy: { id: 'admin-1', email: 'admin@zeaplay.test', name: 'Admin' },
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-02T10:00:00.000Z',
  };
}
