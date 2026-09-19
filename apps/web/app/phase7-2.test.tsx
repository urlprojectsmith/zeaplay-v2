import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider, useLanguage } from '../contexts/language-provider';
import { ThemeProvider } from '../contexts/theme-provider';
import { WorkspaceTasksPage } from '../components/workspace/tasks/WorkspaceTasksPage';
import {
  WorkspaceProjectDetailPage,
  WorkspaceProjectsPage,
} from '../components/workspace/projects/WorkspaceProjectsPage';
import { toggleRelationshipSelection } from '../components/workspace/tasks/AllTasksBrowser';
import { apiClient } from '../services/api';
import type { StatusEntityType, WorkspaceStatusDefinition } from '../services/workspace-statuses';
import {
  taskDueAtFromLocalDate,
  type TaskCommentSummary,
  type WorkspaceTagSummary,
  type WorkspaceTask,
} from '../services/workspace-tasks';
import { useSessionStore } from '../stores/session';

const listRecentWorkspaceTasks = vi.fn();
const listWorkspaceTasks = vi.fn();
const getTaskGantt = vi.fn();
const getWorkspaceTask = vi.fn();
const listWorkspaceSubtasks = vi.fn();
const listWorkspaceTaskBlockedBy = vi.fn();
const listWorkspaceTaskBlocks = vi.fn();
const listWorkspaceTaskRelated = vi.fn();
const addWorkspaceTaskBlockedBy = vi.fn();
const removeWorkspaceTaskBlockedBy = vi.fn();
const addWorkspaceTaskRelated = vi.fn();
const removeWorkspaceTaskRelated = vi.fn();
const listWorkspaceTaskComments = vi.fn();
const listWorkspaceTaskCommentReplies = vi.fn();
const createWorkspaceTaskComment = vi.fn();
const createWorkspaceTaskCommentReply = vi.fn();
const updateWorkspaceTaskComment = vi.fn();
const deleteWorkspaceTaskComment = vi.fn();
const addWorkspaceTaskCommentReaction = vi.fn();
const removeWorkspaceTaskCommentReaction = vi.fn();
const listWorkspaceTags = vi.fn();
const getTaskKanbanSettings = vi.fn();
const moveWorkspaceTaskKanban = vi.fn();
const updateTaskKanbanColumnSetting = vi.fn();
const updateTaskSchedule = vi.fn();
const createWorkspaceTag = vi.fn();
const updateWorkspaceTag = vi.fn();
const archiveWorkspaceTag = vi.fn();
const reactivateWorkspaceTag = vi.fn();
const getTaskTags = vi.fn();
const addTaskTags = vi.fn();
const removeTaskTags = vi.fn();
const createTaskMock = vi.fn();
const createSubtaskMock = vi.fn();
const updateTaskParentMock = vi.fn();
const bulkUpdateTaskStatus = vi.fn();
const bulkUpdateTaskPriority = vi.fn();
const bulkAddTaskAssignees = vi.fn();
const bulkRemoveTaskAssignees = vi.fn();
const bulkDeleteTasks = vi.fn();
const listWorkspaceProjects = vi.fn();
const getWorkspaceProject = vi.fn();
const listProjectManagementProjects = vi.fn();
const listWorkspaceProjectTags = vi.fn();
const listWorkspaceProjectMembers = vi.fn();
const listWorkspaceProjectAttachments = vi.fn();
const addWorkspaceProjectUrlAttachment = vi.fn();
const downloadWorkspaceProjectAttachment = vi.fn();
const removeWorkspaceProjectAttachment = vi.fn();
const listWorkspaceProjectActivity = vi.fn();
const linkWorkspaceProjectTasks = vi.fn();
const unlinkWorkspaceProjectTasks = vi.fn();
const createWorkspaceProject = vi.fn();
const updateWorkspaceProject = vi.fn();
const updateWorkspaceProjectStatus = vi.fn();
const updateWorkspaceProjectProgress = vi.fn();
const updateWorkspaceProjectOwner = vi.fn();
const addWorkspaceProjectTags = vi.fn();
const removeWorkspaceProjectTags = vi.fn();
const addWorkspaceProjectMembers = vi.fn();
const removeWorkspaceProjectMember = vi.fn();
const deleteWorkspaceProject = vi.fn();
const listWorkspaceUsers = vi.fn();
const listDepartments = vi.fn();
const listWorkspaceStatuses = vi.fn();
const listWorkspaceRoles = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
const toastInfo = vi.fn();
const routerReplace = vi.fn();
const routerPush = vi.fn();
let currentSearchParams = new URLSearchParams();
let currentPathname = '/workspace/tasks';
const isoDate = '2026-01-01T00:00:00.000Z';

vi.mock('next/navigation', () => ({
  usePathname: () => currentPathname,
  useRouter: () => ({ push: routerPush, replace: routerReplace }),
  useSearchParams: () => currentSearchParams,
}));

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
    info: (...args: unknown[]) => toastInfo(...args),
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

vi.mock('../services/workspace-roles', async () => {
  const actual = await vi.importActual<typeof import('../services/workspace-roles')>(
    '../services/workspace-roles',
  );
  return {
    ...actual,
    listWorkspaceRoles: (...args: unknown[]) => listWorkspaceRoles(...args),
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
    getTaskGantt: (...args: unknown[]) => getTaskGantt(...args),
    getWorkspaceTask: (...args: unknown[]) => getWorkspaceTask(...args),
    listWorkspaceSubtasks: (...args: unknown[]) => listWorkspaceSubtasks(...args),
    listWorkspaceTaskBlockedBy: (...args: unknown[]) => listWorkspaceTaskBlockedBy(...args),
    listWorkspaceTaskBlocks: (...args: unknown[]) => listWorkspaceTaskBlocks(...args),
    listWorkspaceTaskRelated: (...args: unknown[]) => listWorkspaceTaskRelated(...args),
    addWorkspaceTaskBlockedBy: (...args: unknown[]) => addWorkspaceTaskBlockedBy(...args),
    removeWorkspaceTaskBlockedBy: (...args: unknown[]) => removeWorkspaceTaskBlockedBy(...args),
    addWorkspaceTaskRelated: (...args: unknown[]) => addWorkspaceTaskRelated(...args),
    removeWorkspaceTaskRelated: (...args: unknown[]) => removeWorkspaceTaskRelated(...args),
    listWorkspaceTaskComments: (...args: unknown[]) => listWorkspaceTaskComments(...args),
    listWorkspaceTaskCommentReplies: (...args: unknown[]) =>
      listWorkspaceTaskCommentReplies(...args),
    createWorkspaceTaskComment: (...args: unknown[]) => createWorkspaceTaskComment(...args),
    createWorkspaceTaskCommentReply: (...args: unknown[]) =>
      createWorkspaceTaskCommentReply(...args),
    updateWorkspaceTaskComment: (...args: unknown[]) => updateWorkspaceTaskComment(...args),
    deleteWorkspaceTaskComment: (...args: unknown[]) => deleteWorkspaceTaskComment(...args),
    addWorkspaceTaskCommentReaction: (...args: unknown[]) =>
      addWorkspaceTaskCommentReaction(...args),
    removeWorkspaceTaskCommentReaction: (...args: unknown[]) =>
      removeWorkspaceTaskCommentReaction(...args),
    listWorkspaceTags: (...args: unknown[]) => listWorkspaceTags(...args),
    getTaskKanbanSettings: (...args: unknown[]) => getTaskKanbanSettings(...args),
    moveWorkspaceTaskKanban: (...args: unknown[]) => moveWorkspaceTaskKanban(...args),
    updateTaskKanbanColumnSetting: (...args: unknown[]) => updateTaskKanbanColumnSetting(...args),
    updateTaskSchedule: (...args: unknown[]) => updateTaskSchedule(...args),
    createWorkspaceTag: (...args: unknown[]) => createWorkspaceTag(...args),
    updateWorkspaceTag: (...args: unknown[]) => updateWorkspaceTag(...args),
    archiveWorkspaceTag: (...args: unknown[]) => archiveWorkspaceTag(...args),
    reactivateWorkspaceTag: (...args: unknown[]) => reactivateWorkspaceTag(...args),
    getTaskTags: (...args: unknown[]) => getTaskTags(...args),
    addTaskTags: (...args: unknown[]) => addTaskTags(...args),
    removeTaskTags: (...args: unknown[]) => removeTaskTags(...args),
    createWorkspaceTask: (...args: unknown[]) => createTaskMock(...args),
    createWorkspaceSubtask: (...args: unknown[]) => createSubtaskMock(...args),
    updateWorkspaceTaskParent: (...args: unknown[]) => updateTaskParentMock(...args),
    bulkUpdateTaskStatus: (...args: unknown[]) => bulkUpdateTaskStatus(...args),
    bulkUpdateTaskPriority: (...args: unknown[]) => bulkUpdateTaskPriority(...args),
    bulkAddTaskAssignees: (...args: unknown[]) => bulkAddTaskAssignees(...args),
    bulkRemoveTaskAssignees: (...args: unknown[]) => bulkRemoveTaskAssignees(...args),
    bulkDeleteTasks: (...args: unknown[]) => bulkDeleteTasks(...args),
    listWorkspaceProjects: (...args: unknown[]) => listWorkspaceProjects(...args),
  };
});

vi.mock('../services/workspace-projects', async () => {
  const actual = await vi.importActual<typeof import('../services/workspace-projects')>(
    '../services/workspace-projects',
  );
  return {
    ...actual,
    getWorkspaceProject: (...args: unknown[]) => getWorkspaceProject(...args),
    listWorkspaceProjects: (...args: unknown[]) => listProjectManagementProjects(...args),
    listWorkspaceProjectTags: (...args: unknown[]) => listWorkspaceProjectTags(...args),
    listWorkspaceProjectMembers: (...args: unknown[]) => listWorkspaceProjectMembers(...args),
    listWorkspaceProjectAttachments: (...args: unknown[]) =>
      listWorkspaceProjectAttachments(...args),
    addWorkspaceProjectUrlAttachment: (...args: unknown[]) =>
      addWorkspaceProjectUrlAttachment(...args),
    downloadWorkspaceProjectAttachment: (...args: unknown[]) =>
      downloadWorkspaceProjectAttachment(...args),
    removeWorkspaceProjectAttachment: (...args: unknown[]) =>
      removeWorkspaceProjectAttachment(...args),
    listWorkspaceProjectActivity: (...args: unknown[]) => listWorkspaceProjectActivity(...args),
    linkWorkspaceProjectTasks: (...args: unknown[]) => linkWorkspaceProjectTasks(...args),
    unlinkWorkspaceProjectTasks: (...args: unknown[]) => unlinkWorkspaceProjectTasks(...args),
    createWorkspaceProject: (...args: unknown[]) => createWorkspaceProject(...args),
    updateWorkspaceProject: (...args: unknown[]) => updateWorkspaceProject(...args),
    updateWorkspaceProjectStatus: (...args: unknown[]) => updateWorkspaceProjectStatus(...args),
    updateWorkspaceProjectProgress: (...args: unknown[]) => updateWorkspaceProjectProgress(...args),
    updateWorkspaceProjectOwner: (...args: unknown[]) => updateWorkspaceProjectOwner(...args),
    addWorkspaceProjectTags: (...args: unknown[]) => addWorkspaceProjectTags(...args),
    removeWorkspaceProjectTags: (...args: unknown[]) => removeWorkspaceProjectTags(...args),
    addWorkspaceProjectMembers: (...args: unknown[]) => addWorkspaceProjectMembers(...args),
    removeWorkspaceProjectMember: (...args: unknown[]) => removeWorkspaceProjectMember(...args),
    deleteWorkspaceProject: (...args: unknown[]) => deleteWorkspaceProject(...args),
  };
});

describe('Phase 7.2 task creation experience', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDefaultTags();
    currentSearchParams = new URLSearchParams();
    currentPathname = '/workspace/tasks';
    localStorage.clear();
    useSessionStore.setState({
      selectedAgencyId: 'agency-1',
      selectedWorkspaceId: 'workspace-1',
      hydrated: true,
      accessToken: 'token',
      user: { id: 'admin-1', email: 'admin@zeaplay.test' },
      agencies: [
        {
          id: 'agency-1',
          name: 'Agency',
          slug: 'agency',
          status: 'ACTIVE',
          role: 'OWNER',
          membershipId: 'agency-membership-1',
          workspaces: [
            {
              id: 'workspace-1',
              agencyId: 'agency-1',
              name: 'Workspace',
              slug: 'workspace',
              status: 'ACTIVE',
              role: 'OWNER',
              membershipId: 'membership-a',
              timezone: 'UTC',
            },
            {
              id: 'workspace-2',
              agencyId: 'agency-1',
              name: 'Workspace 2',
              slug: 'workspace-2',
              status: 'ACTIVE',
              role: 'OWNER',
              membershipId: 'membership-b',
              timezone: 'UTC',
            },
          ],
        },
      ],
    });
    listRecentWorkspaceTasks.mockResolvedValue({ items: [], page: 1, pageSize: 5, total: 0 });
    listWorkspaceTasks.mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    });
    getTaskGantt.mockResolvedValue({
      window: { from: '2026-01-01', to: '2026-01-31', timezone: 'UTC' },
      items: [
        taskFixture({
          id: 'project-task-1',
          title: 'Project scoped task',
          plannedStartAt: '2026-01-10T00:00:00.000Z',
          dueAt: '2026-01-12T00:00:00.000Z',
        }),
      ],
      dependencies: [],
      unscheduledItems: [
        taskFixture({
          id: 'project-unscheduled-1',
          title: 'Project unscheduled task',
          plannedStartAt: null,
          dueAt: '2026-01-18T00:00:00.000Z',
        }),
      ],
      unscheduledCount: 1,
      page: 1,
      pageSize: 50,
      total: 1,
    });
    getTaskKanbanSettings.mockResolvedValue({
      columns: [
        { status: status('status-task', 'TASK', 'To Do'), wipLimit: null },
        { status: status('status-review', 'TASK', 'Review', false), wipLimit: 1 },
      ],
    });
    moveWorkspaceTaskKanban.mockImplementation((_workspaceId: string, taskId: string) =>
      Promise.resolve(
        taskFixture({ id: taskId, status: status('status-review', 'TASK', 'Review', false) }),
      ),
    );
    updateTaskKanbanColumnSetting.mockResolvedValue({
      statusDefinitionId: 'status-review',
      wipLimit: 2,
    });
    getWorkspaceTask.mockResolvedValue(
      taskFixture({
        id: 'task-alpha',
        title: 'Alpha launch task',
        directSubtaskCount: 0,
        parent: null,
      }),
    );
    listWorkspaceSubtasks.mockResolvedValue({ items: [], page: 1, pageSize: 10, total: 0 });
    listWorkspaceTaskBlockedBy.mockResolvedValue({ items: [], page: 1, pageSize: 10, total: 0 });
    listWorkspaceTaskBlocks.mockResolvedValue({ items: [], page: 1, pageSize: 10, total: 0 });
    listWorkspaceTaskRelated.mockResolvedValue({ items: [], page: 1, pageSize: 10, total: 0 });
    listWorkspaceTaskComments.mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 10,
      total: 0,
    });
    listWorkspaceTaskCommentReplies.mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 10,
      total: 0,
    });
    createWorkspaceTaskComment.mockResolvedValue(commentFixture({ id: 'comment-created' }));
    createWorkspaceTaskCommentReply.mockResolvedValue(
      commentFixture({ id: 'comment-reply-created', parentCommentId: 'comment-root' }),
    );
    updateWorkspaceTaskComment.mockResolvedValue(commentFixture({ id: 'comment-root' }));
    deleteWorkspaceTaskComment.mockResolvedValue(
      commentFixture({ id: 'comment-root', body: null, deleted: true, deletedAt: isoDate }),
    );
    addWorkspaceTaskCommentReaction.mockResolvedValue({ changed: true, reactionType: 'LIKE' });
    removeWorkspaceTaskCommentReaction.mockResolvedValue({ changed: true, reactionType: 'LIKE' });
    listWorkspaceTaskComments.mockResolvedValue({ items: [], page: 1, pageSize: 10, total: 0 });
    listWorkspaceTaskCommentReplies.mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 10,
      total: 0,
    });
    createWorkspaceTaskComment.mockResolvedValue(commentFixture({ id: 'comment-created' }));
    createWorkspaceTaskCommentReply.mockResolvedValue(
      commentFixture({ id: 'comment-reply-created', parentCommentId: 'comment-root' }),
    );
    updateWorkspaceTaskComment.mockResolvedValue(commentFixture({ id: 'comment-root' }));
    deleteWorkspaceTaskComment.mockResolvedValue(
      commentFixture({ id: 'comment-root', body: null, deleted: true, deletedAt: isoDate }),
    );
    addWorkspaceTaskCommentReaction.mockResolvedValue({ changed: true, reactionType: 'LIKE' });
    removeWorkspaceTaskCommentReaction.mockResolvedValue({ changed: true, reactionType: 'LIKE' });
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
    listWorkspaceStatuses.mockImplementation((_workspaceId: string, entityType: StatusEntityType) =>
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
    getWorkspaceProject.mockResolvedValue(projectFixture());
    listProjectManagementProjects.mockResolvedValue({
      items: [projectFixture()],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    listWorkspaceProjectTags.mockResolvedValue([]);
    listWorkspaceProjectMembers.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 });
    listWorkspaceProjectAttachments.mockResolvedValue({
      items: [
        {
          id: 'attachment-1',
          workspaceId: 'workspace-1',
          projectId: 'project-1',
          type: 'URL',
          displayName: 'Creative brief',
          url: 'https://example.com/brief',
          file: null,
          attachedAt: isoDate,
          createdAt: isoDate,
          updatedAt: isoDate,
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    listWorkspaceProjectActivity.mockResolvedValue({
      items: [
        {
          id: 'activity-1',
          action: 'project.attachment_url_added',
          entityType: 'Project',
          entityId: 'project-1',
          metadata: { attachmentId: 'attachment-1' },
          createdAt: isoDate,
          actor: { id: 'user-a', email: 'anya@zeaplay.test', name: 'Anya' },
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    addWorkspaceProjectUrlAttachment.mockResolvedValue({ id: 'attachment-url' });
    downloadWorkspaceProjectAttachment.mockResolvedValue({ downloadUrl: 'https://files.test/x' });
    removeWorkspaceProjectAttachment.mockResolvedValue({ changed: true });
    linkWorkspaceProjectTasks.mockResolvedValue({
      requestedCount: 1,
      changedCount: 1,
      unchangedCount: 0,
    });
    unlinkWorkspaceProjectTasks.mockResolvedValue({
      requestedCount: 1,
      changedCount: 1,
      unchangedCount: 0,
    });
    createWorkspaceProject.mockResolvedValue(projectFixture());
    updateWorkspaceProject.mockResolvedValue(projectFixture());
    updateWorkspaceProjectStatus.mockResolvedValue(projectFixture());
    updateWorkspaceProjectProgress.mockResolvedValue(projectFixture());
    updateWorkspaceProjectOwner.mockResolvedValue(projectFixture());
    addWorkspaceProjectTags.mockResolvedValue({ requestedCount: 1, changedCount: 1 });
    removeWorkspaceProjectTags.mockResolvedValue({ requestedCount: 1, changedCount: 1 });
    addWorkspaceProjectMembers.mockResolvedValue({ requestedCount: 1, changedCount: 1 });
    removeWorkspaceProjectMember.mockResolvedValue({ changedCount: 1 });
    deleteWorkspaceProject.mockResolvedValue(projectFixture());
    createTaskMock.mockResolvedValue({ id: 'task-1', title: 'Draft brief' });
    createSubtaskMock.mockResolvedValue(taskFixture({ id: 'task-child', title: 'Child task' }));
    addWorkspaceTaskBlockedBy.mockResolvedValue({
      requestedCount: 1,
      changedCount: 1,
      unchangedCount: 0,
    });
    removeWorkspaceTaskBlockedBy.mockResolvedValue({
      requestedCount: 1,
      changedCount: 1,
      unchangedCount: 0,
    });
    addWorkspaceTaskRelated.mockResolvedValue({
      requestedCount: 1,
      changedCount: 1,
      unchangedCount: 0,
    });
    removeWorkspaceTaskRelated.mockResolvedValue({
      requestedCount: 1,
      changedCount: 1,
      unchangedCount: 0,
    });
    updateTaskParentMock.mockImplementation((_workspaceId: string, taskId: string, parentTaskId) =>
      Promise.resolve(taskFixture({ id: taskId, parentTaskId })),
    );
    updateTaskSchedule.mockImplementation(
      (
        _workspaceId: string,
        taskId: string,
        body: { plannedStartAt: string | null; dueAt: string | null },
      ) => Promise.resolve(taskFixture({ id: taskId, ...body })),
    );
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

  it('renders Kanban from Task statuses and moves cards through the fallback status selector', async () => {
    currentSearchParams = new URLSearchParams('view=kanban&search=alpha');
    listWorkspaceTasks.mockImplementation(
      (_workspaceId: string, params: { statusDefinitionId?: string }) => {
        if (params.statusDefinitionId === 'status-task') {
          return Promise.resolve({
            items: [taskFixture({ id: 'task-alpha', title: 'Alpha launch task' })],
            page: 1,
            pageSize: 20,
            total: 1,
          });
        }
        if (params.statusDefinitionId === 'status-review') {
          return Promise.resolve({
            items: [
              taskFixture({
                id: 'task-review',
                title: 'Review checklist',
                status: status('status-review', 'TASK', 'Review', false),
              }),
              taskFixture({
                id: 'task-review-two',
                title: 'Review follow-up',
                status: status('status-review', 'TASK', 'Review', false),
              }),
            ],
            page: 1,
            pageSize: 20,
            total: 2,
          });
        }
        return Promise.resolve({ items: [], page: 1, pageSize: 20, total: 0 });
      },
    );

    renderWithProviders(<WorkspaceTasksPage />);

    expect(await screen.findByRole('heading', { name: 'To Do' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Review' })).toBeInTheDocument();
    expect(await screen.findByText('Alpha launch task')).toBeInTheDocument();
    expect(screen.getByText('2 / 1 - WIP limit exceeded')).toBeInTheDocument();
    await waitFor(() =>
      expect(listWorkspaceTasks).toHaveBeenCalledWith(
        'workspace-1',
        expect.objectContaining({
          search: 'alpha',
          sortBy: 'kanbanRank',
          statusDefinitionId: 'status-task',
        }),
      ),
    );

    await selectSelectOption('Move to status', 'Review');
    await waitFor(() =>
      expect(moveWorkspaceTaskKanban).toHaveBeenCalledWith(
        'workspace-1',
        'task-alpha',
        expect.objectContaining({ statusDefinitionId: 'status-review' }),
      ),
    );
    expect(toastSuccess).toHaveBeenCalledWith('Task moved');
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

  it('keeps Project Tasks lazy and uses the existing server-side task list with projectId', async () => {
    listWorkspaceTasks.mockResolvedValue({
      items: [taskFixture({ id: 'project-task-1', title: 'Project scoped task' })],
      page: 1,
      pageSize: 20,
      total: 1,
    });

    renderWithProviders(<WorkspaceProjectDetailPage projectId="project-1" />);

    await screen.findByText('Launch');
    expect(listWorkspaceTasks).not.toHaveBeenCalled();

    openProjectTasksTab();

    await waitFor(() => expect(listWorkspaceTasks).toHaveBeenCalledTimes(1));
    expect(listWorkspaceTasks).toHaveBeenCalledWith(
      'workspace-1',
      expect.objectContaining({ projectId: 'project-1', page: 1, pageSize: 25 }),
    );
    expect(screen.getByRole('tab', { name: 'Project Kanban' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Project Timeline' })).toBeInTheDocument();
    expect(getTaskKanbanSettings).not.toHaveBeenCalled();
    expect(getTaskGantt).not.toHaveBeenCalled();
  });

  it('keeps Workspace Project list bounded with server filters and opens created Projects', async () => {
    currentPathname = '/workspace/projects';
    renderWithProviders(<WorkspaceProjectsPage />);

    await screen.findByText('Launch');
    fireEvent.change(screen.getAllByLabelText('Search Projects')[0]!, {
      target: { value: 'Launch' },
    });
    fireEvent.change(screen.getByLabelText('Planned From'), { target: { value: '2026-01-01' } });
    fireEvent.change(screen.getByLabelText('Due To'), { target: { value: '2026-01-31' } });
    await selectSelectOption('Sort By', 'Due Date');
    await selectSelectOption('Sort Direction', 'Ascending');

    await waitFor(() =>
      expect(listProjectManagementProjects).toHaveBeenLastCalledWith(
        'workspace-1',
        expect.objectContaining({
          search: 'Launch',
          plannedFrom: '2026-01-01',
          dueTo: '2026-01-31',
          sortBy: 'dueAt',
          sortDirection: 'asc',
        }),
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }));
    const forms = screen.getAllByRole('button', { name: 'Create Project' });
    fireEvent.change(screen.getByLabelText('Project Name'), { target: { value: 'New Project' } });
    fireEvent.click(forms[forms.length - 1]!);

    await waitFor(() => expect(createWorkspaceProject).toHaveBeenCalled());
    expect(routerPush).toHaveBeenCalledWith('/workspace/projects/project-1');
  });

  it('pushes Project tab URLs and keeps Reports gated by Project reports plus Task view permissions', async () => {
    currentPathname = '/workspace/projects/project-1';
    renderWithProviders(<WorkspaceProjectDetailPage projectId="project-1" />);

    await screen.findByText('Launch');
    openProjectDetailTab('Project Reports');

    expect(routerPush).toHaveBeenCalledWith('/workspace/projects/project-1?tab=reports');
    await waitFor(() => expect(getWorkspaceProject).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Effective Progress')).toBeInTheDocument();
  });

  it('falls back safely to Overview for invalid Project tab URLs', async () => {
    currentPathname = '/workspace/projects/project-1';
    currentSearchParams = new URLSearchParams('tab=banana');

    renderWithProviders(<WorkspaceProjectDetailPage projectId="project-1" />);

    await screen.findByText('Launch');
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('data-state', 'active');
    expect(listWorkspaceTasks).not.toHaveBeenCalled();
    expect(listWorkspaceProjectAttachments).not.toHaveBeenCalled();
    expect(listWorkspaceProjectActivity).not.toHaveBeenCalled();
  });

  it('clears Project detail when visibility, member removal, or owner transfer causes access loss', async () => {
    currentPathname = '/workspace/projects/project-1';

    const visibilityRender = renderWithProviders(
      <WorkspaceProjectDetailPage projectId="project-1" />,
    );
    await screen.findByText('Launch');
    fireEvent.click(screen.getByRole('button', { name: 'Edit Project' }));
    await selectSelectOption('Visibility', 'Restricted');
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit Project' }).at(-1)!);
    await waitFor(() =>
      expect(updateWorkspaceProject).toHaveBeenCalledWith(
        'workspace-1',
        'project-1',
        expect.objectContaining({ visibility: 'RESTRICTED' }),
      ),
    );
    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith('/workspace/projects'));
    visibilityRender.unmount();
    routerReplace.mockClear();

    getWorkspaceProject.mockResolvedValueOnce(
      projectFixture({
        visibility: 'RESTRICTED',
        ownerMembershipId: 'membership-c',
        owner: {
          id: 'membership-c',
          status: 'ACTIVE',
          user: { id: 'user-c', email: 'chen@zeaplay.test', name: 'Chen' },
        },
      }),
    );
    listWorkspaceProjectMembers.mockResolvedValueOnce({
      items: [
        {
          id: 'project-member-a',
          workspaceId: 'workspace-1',
          projectId: 'project-1',
          workspaceMembershipId: 'membership-a',
          member: {
            id: 'membership-a',
            status: 'ACTIVE',
            user: { id: 'user-a', email: 'anya@zeaplay.test', name: 'Anya' },
          },
          createdAt: isoDate,
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    const memberRender = renderWithProviders(<WorkspaceProjectDetailPage projectId="project-1" />);
    await screen.findByText('Launch');
    openProjectDetailTab('Project Members');
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Member Anya' }));
    await waitFor(() =>
      expect(removeWorkspaceProjectMember).toHaveBeenCalledWith(
        'workspace-1',
        'project-1',
        'membership-a',
      ),
    );
    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith('/workspace/projects'));
    memberRender.unmount();
    routerReplace.mockClear();

    getWorkspaceProject.mockResolvedValueOnce(
      projectFixture({
        visibility: 'RESTRICTED',
        ownerMembershipId: 'membership-a',
      }),
    );
    const ownerRender = renderWithProviders(<WorkspaceProjectDetailPage projectId="project-1" />);
    await screen.findByText('Launch');
    openProjectDetailTab('Project Members');
    await selectSelectOption('Change Owner', 'Chen');
    await waitFor(() =>
      expect(updateWorkspaceProjectOwner).toHaveBeenCalledWith(
        'workspace-1',
        'project-1',
        'membership-c',
      ),
    );
    await waitFor(() => expect(routerReplace).toHaveBeenCalledWith('/workspace/projects'));
    ownerRender.unmount();
  });

  it('lazy-loads Project Kanban and Timeline with server-side projectId filters', async () => {
    listWorkspaceTasks.mockResolvedValue({
      items: [
        taskFixture({
          id: 'project-task-1',
          title: 'Project scoped task',
          plannedStartAt: '2026-01-10T00:00:00.000Z',
          dueAt: '2026-01-12T00:00:00.000Z',
        }),
      ],
      page: 1,
      pageSize: 25,
      total: 1,
    });

    renderWithProviders(<WorkspaceProjectDetailPage projectId="project-1" />);

    await screen.findByText('Launch');
    expect(getTaskKanbanSettings).not.toHaveBeenCalled();
    expect(getTaskGantt).not.toHaveBeenCalled();

    openProjectDetailTab('Project Kanban');
    await waitFor(() => expect(getTaskKanbanSettings).toHaveBeenCalledWith('workspace-1'));
    await waitFor(() =>
      expect(listWorkspaceTasks).toHaveBeenCalledWith(
        'workspace-1',
        expect.objectContaining({
          projectId: 'project-1',
          statusDefinitionId: 'status-task',
          page: 1,
          pageSize: 25,
        }),
      ),
    );
    expect(getTaskGantt).not.toHaveBeenCalled();

    openProjectDetailTab('Project Timeline');
    await waitFor(() =>
      expect(getTaskGantt).toHaveBeenCalledWith(
        'workspace-1',
        expect.objectContaining({ projectId: 'project-1', page: 1, pageSize: 50 }),
      ),
    );
    expect(await screen.findAllByRole('button', { name: 'Schedule Task' })).toHaveLength(2);
    expect(screen.getByRole('region', { name: 'Unscheduled' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Project unscheduled task' })).toBeInTheDocument();
  });

  it('lazy-loads Project Files, Members, and Activity with Project-scoped queries', async () => {
    renderWithProviders(<WorkspaceProjectDetailPage projectId="project-1" />);

    await screen.findByText('Launch');
    expect(listWorkspaceProjectAttachments).not.toHaveBeenCalled();
    expect(listWorkspaceProjectMembers).not.toHaveBeenCalled();
    expect(listWorkspaceProjectActivity).not.toHaveBeenCalled();

    openProjectDetailTab('Files');
    await screen.findByText('Creative brief');
    expect(listWorkspaceProjectAttachments).toHaveBeenCalledWith(
      'workspace-1',
      'project-1',
      expect.objectContaining({ page: 1, pageSize: 20 }),
    );
    expect(screen.getByRole('button', { name: 'Open Link' })).toBeInTheDocument();

    openProjectDetailTab('Project Members');
    await waitFor(() => expect(listWorkspaceProjectMembers).toHaveBeenCalledTimes(1));
    expect(listWorkspaceProjectMembers).toHaveBeenCalledWith(
      'workspace-1',
      'project-1',
      expect.objectContaining({ page: 1, pageSize: 20 }),
    );

    openProjectDetailTab('Activity');
    await screen.findByText('Link added');
    expect(listWorkspaceProjectActivity).toHaveBeenCalledWith(
      'workspace-1',
      'project-1',
      expect.objectContaining({ page: 1, pageSize: 20 }),
    );
  });

  it('schedules Project Timeline tasks through the shared task schedule mutation', async () => {
    renderWithProviders(<WorkspaceProjectDetailPage projectId="project-1" />);

    await screen.findByText('Launch');
    openProjectDetailTab('Project Timeline');

    fireEvent.click((await screen.findAllByRole('button', { name: 'Schedule Task' }))[0]!);
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Start Date'), {
      target: { value: '2026-01-11' },
    });
    fireEvent.change(within(dialog).getByLabelText('End Date'), {
      target: { value: '2026-01-15' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(updateTaskSchedule).toHaveBeenCalledWith('workspace-1', 'project-task-1', {
        plannedStartAt: new Date(2026, 0, 11).toISOString(),
        dueAt: new Date(2026, 0, 15).toISOString(),
      }),
    );
    expect(getWorkspaceProject).toHaveBeenCalledTimes(1);
  });

  it('lazy-loads Link Existing search, submits one multi-link request, and clears on Project switch', async () => {
    listWorkspaceTasks.mockImplementation((_workspaceId: string, params = {}) => {
      const normalized = params as { projectId?: string; search?: string };
      if (normalized.projectId) {
        return Promise.resolve({ items: [], page: 1, pageSize: 20, total: 0 });
      }
      return Promise.resolve({
        items: [
          taskFixture({ id: 'candidate-1', title: 'Candidate one' }),
          taskFixture({ id: 'candidate-2', title: 'Candidate two' }),
        ],
        page: 1,
        pageSize: 20,
        total: 2,
      });
    });

    const rendered = renderWithProviders(<WorkspaceProjectDetailPage projectId="project-1" />);

    await screen.findByText('Launch');
    openProjectTasksTab();
    await waitFor(() => expect(listWorkspaceTasks).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Link Existing Task' }));
    await screen.findByText('Candidate one');
    expect(listWorkspaceTasks).toHaveBeenLastCalledWith(
      'workspace-1',
      expect.objectContaining({ page: 1, pageSize: 20, sortBy: 'updatedAt' }),
    );

    fireEvent.click(screen.getByRole('checkbox', { name: /Candidate one/ }));
    fireEvent.change(screen.getByLabelText('Search Tasks'), { target: { value: 'candidate' } });
    expect(await screen.findAllByText('Candidate one')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Link Tasks' }));
    await waitFor(() =>
      expect(linkWorkspaceProjectTasks).toHaveBeenCalledWith('workspace-1', 'project-1', [
        'candidate-1',
      ]),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Link Existing Task' }));
    await screen.findByText('Candidate one');
    fireEvent.click(screen.getByRole('checkbox', { name: /Candidate one/ }));

    getWorkspaceProject.mockResolvedValueOnce(projectFixture({ id: 'project-2', name: 'Second' }));
    rendered.rerender(
      <LanguageProvider>
        <QueryHarness>
          <WorkspaceProjectDetailPage projectId="project-2" />
        </QueryHarness>
      </LanguageProvider>,
    );

    await screen.findByText('Second');
    openProjectTasksTab();
    fireEvent.click(screen.getByRole('button', { name: 'Link Existing Task' }));
    await screen.findByText('Candidate one');
    expect(screen.getByRole('button', { name: 'Link Tasks' })).toBeDisabled();
  });
});

describe('Phase 7.3A all tasks list/table foundation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDefaultTags();
    currentSearchParams = new URLSearchParams();
    localStorage.clear();
    useSessionStore.setState({
      selectedAgencyId: 'agency-1',
      selectedWorkspaceId: 'workspace-1',
      hydrated: true,
      accessToken: 'token',
      user: { id: 'admin-1', email: 'admin@zeaplay.test' },
      agencies: [
        {
          id: 'agency-1',
          name: 'Agency',
          slug: 'agency',
          status: 'ACTIVE',
          role: 'OWNER',
          membershipId: 'agency-membership-1',
          workspaces: [
            {
              id: 'workspace-1',
              agencyId: 'agency-1',
              name: 'Workspace',
              slug: 'workspace',
              status: 'ACTIVE',
              role: 'OWNER',
              membershipId: 'membership-a',
              timezone: 'UTC',
            },
            {
              id: 'workspace-2',
              agencyId: 'agency-1',
              name: 'Workspace 2',
              slug: 'workspace-2',
              status: 'ACTIVE',
              role: 'OWNER',
              membershipId: 'membership-b',
              timezone: 'UTC',
            },
          ],
        },
      ],
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
    await waitFor(() =>
      expect(listWorkspaceUsers).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'An', workspaceId: 'workspace-1' }),
      ),
    );
    await selectSelectOption('Assignee', 'Anya');
    expect(routerReplace).toHaveBeenLastCalledWith('/workspace/tasks?assignee=membership-a', {
      scroll: false,
    });

    fireEvent.change(screen.getByLabelText('Search projects'), { target: { value: 'La' } });
    await waitFor(() =>
      expect(listWorkspaceProjects).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'La', workspaceId: 'workspace-1' }),
      ),
    );
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
    mockDefaultTags();
    currentSearchParams = new URLSearchParams();
    localStorage.clear();
    useSessionStore.setState({
      selectedAgencyId: 'agency-1',
      selectedWorkspaceId: 'workspace-1',
      hydrated: true,
      accessToken: 'token',
      user: { id: 'admin-1', email: 'admin@zeaplay.test' },
      agencies: [
        {
          id: 'agency-1',
          name: 'Agency',
          slug: 'agency',
          status: 'ACTIVE',
          role: 'OWNER',
          membershipId: 'agency-membership-1',
          workspaces: [
            {
              id: 'workspace-1',
              agencyId: 'agency-1',
              name: 'Workspace',
              slug: 'workspace',
              status: 'ACTIVE',
              role: 'OWNER',
              membershipId: 'membership-a',
              timezone: 'UTC',
            },
            {
              id: 'workspace-2',
              agencyId: 'agency-1',
              name: 'Workspace 2',
              slug: 'workspace-2',
              status: 'ACTIVE',
              role: 'MEMBER',
              membershipId: 'membership-b',
              timezone: 'UTC',
            },
          ],
        },
      ],
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
      tagId: 'tag-bug',
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
        tagId: 'tag-bug',
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
    expect(
      actual.taskKeys.subtasks('workspace-1', 'task-parent', { page: 2, pageSize: 5 }),
    ).toEqual([
      'workspace',
      'workspace-1',
      'tasks',
      'detail',
      'task-parent',
      'subtasks',
      { page: 2, pageSize: 5 },
    ]);
    expect(
      actual.taskKeys.blockedBy('workspace-1', 'task-parent', { page: 2, pageSize: 10 }),
    ).toEqual([
      'workspace',
      'workspace-1',
      'tasks',
      'detail',
      'task-parent',
      'blocked-by',
      { page: 2, pageSize: 10 },
    ]);
    expect(actual.taskKeys.blocks('workspace-1', 'task-parent', { page: 3, pageSize: 10 })).toEqual(
      [
        'workspace',
        'workspace-1',
        'tasks',
        'detail',
        'task-parent',
        'blocks',
        { page: 3, pageSize: 10 },
      ],
    );
    expect(
      actual.taskKeys.related('workspace-1', 'task-parent', { page: 4, pageSize: 10 }),
    ).toEqual([
      'workspace',
      'workspace-1',
      'tasks',
      'detail',
      'task-parent',
      'related',
      { page: 4, pageSize: 10 },
    ]);
    expect(
      actual.taskKeys.comments('workspace-1', 'task-parent', { page: 1, pageSize: 10 }),
    ).toEqual([
      'workspace',
      'workspace-1',
      'tasks',
      'detail',
      'task-parent',
      'comments',
      { page: 1, pageSize: 10 },
    ]);
    expect(
      actual.taskKeys.replies('workspace-1', 'task-parent', 'comment-1', {
        page: 2,
        pageSize: 10,
      }),
    ).toEqual([
      'workspace',
      'workspace-1',
      'tasks',
      'detail',
      'task-parent',
      'comments',
      'comment-1',
      'replies',
      { page: 2, pageSize: 10 },
    ]);

    await actual.listWorkspaceTasks('workspace-1', normalized);
    expect(requestSpy).toHaveBeenCalledWith(
      expect.stringContaining('/workspaces/workspace-1/tasks?'),
    );
    const [requestUrl] = requestSpy.mock.calls[0] ?? [];
    expect(requestUrl).toContain('search=billing');
    expect(requestUrl).toContain('pageSize=25');
    expect(requestUrl).toContain('tagId=tag-bug');
    requestSpy.mockRestore();
  });

  it('calls dependency and related task APIs with scoped pagination and bounded write payloads', async () => {
    const requestSpy = vi.spyOn(apiClient, 'request').mockResolvedValue({
      data: { items: [], page: 2, pageSize: 10, total: 0 },
      meta: {},
    } as never);
    const actual = await vi.importActual<typeof import('../services/workspace-tasks')>(
      '../services/workspace-tasks',
    );

    await actual.listWorkspaceTaskBlockedBy('workspace-1', 'task-current', {
      page: 2,
      pageSize: 10,
    });
    expect(requestSpy).toHaveBeenCalledWith(
      '/workspaces/workspace-1/tasks/task-current/blocked-by?page=2&pageSize=10',
    );
    await actual.listWorkspaceTaskBlocks('workspace-1', 'task-current', { page: 3, pageSize: 10 });
    expect(requestSpy).toHaveBeenCalledWith(
      '/workspaces/workspace-1/tasks/task-current/blocks?page=3&pageSize=10',
    );
    await actual.listWorkspaceTaskRelated('workspace-1', 'task-current', {
      page: 4,
      pageSize: 10,
    });
    expect(requestSpy).toHaveBeenCalledWith(
      '/workspaces/workspace-1/tasks/task-current/related?page=4&pageSize=10',
    );
    await actual.addWorkspaceTaskBlockedBy('workspace-1', 'task-current', [
      'task-a',
      'task-a',
      'task-b',
    ]);
    expect(requestSpy).toHaveBeenCalledWith(
      '/workspaces/workspace-1/tasks/task-current/blocked-by',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ taskIds: ['task-a', 'task-b'] }),
      }),
    );
    await actual.removeWorkspaceTaskBlockedBy('workspace-1', 'task-current', ['task-a']);
    expect(requestSpy).toHaveBeenCalledWith(
      '/workspaces/workspace-1/tasks/task-current/blocked-by/remove',
      expect.objectContaining({ method: 'POST' }),
    );
    await actual.addWorkspaceTaskRelated('workspace-1', 'task-current', ['task-c']);
    expect(requestSpy).toHaveBeenCalledWith(
      '/workspaces/workspace-1/tasks/task-current/related',
      expect.objectContaining({ method: 'POST' }),
    );
    await actual.removeWorkspaceTaskRelated('workspace-1', 'task-current', ['task-c']);
    expect(requestSpy).toHaveBeenCalledWith(
      '/workspaces/workspace-1/tasks/task-current/related/remove',
      expect.objectContaining({ method: 'POST' }),
    );
    await actual.listWorkspaceTaskComments('workspace-1', 'task-current', {
      page: 1,
      pageSize: 10,
    });
    expect(requestSpy).toHaveBeenCalledWith(
      '/workspaces/workspace-1/tasks/task-current/comments?page=1&pageSize=10',
    );
    await actual.listWorkspaceTaskCommentReplies('workspace-1', 'task-current', 'comment-1', {
      page: 2,
      pageSize: 10,
    });
    expect(requestSpy).toHaveBeenCalledWith(
      '/workspaces/workspace-1/tasks/task-current/comments/comment-1/replies?page=2&pageSize=10',
    );
    await actual.createWorkspaceTaskComment('workspace-1', 'task-current', {
      body: ' Hi @Anya ',
      visibility: 'INTERNAL',
      mentionedMembershipIds: ['membership-a', 'membership-a'],
    });
    expect(requestSpy).toHaveBeenCalledWith(
      '/workspaces/workspace-1/tasks/task-current/comments',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          body: 'Hi @Anya',
          visibility: 'INTERNAL',
          mentionedMembershipIds: ['membership-a'],
        }),
      }),
    );
    await actual.addWorkspaceTaskCommentReaction(
      'workspace-1',
      'task-current',
      'comment-1',
      'LIKE',
    );
    expect(requestSpy).toHaveBeenCalledWith(
      '/workspaces/workspace-1/tasks/task-current/comments/comment-1/reactions',
      expect.objectContaining({ method: 'POST' }),
    );
    requestSpy.mockRestore();
  });

  it('calls workspace tag catalog and task tag APIs with scoped keys and explicit payloads', async () => {
    const requestSpy = vi.spyOn(apiClient, 'request').mockResolvedValue({
      data: { items: [], page: 1, pageSize: 10, total: 0 },
      meta: {},
    } as never);
    const actual = await vi.importActual<typeof import('../services/workspace-tasks')>(
      '../services/workspace-tasks',
    );

    expect(actual.taskKeys.tags('workspace-1', 'task-current')).toEqual([
      'workspace',
      'workspace-1',
      'tasks',
      'detail',
      'task-current',
      'tags',
    ]);
    expect(
      actual.taskKeys.tagCatalog('workspace-1', {
        page: 1,
        pageSize: 10,
        search: 'bug',
        status: 'ACTIVE',
        sortBy: 'name',
        sortDirection: 'asc',
      }),
    ).toEqual([
      'workspace',
      'workspace-1',
      'tags',
      {
        page: 1,
        pageSize: 10,
        search: 'bug',
        status: 'ACTIVE',
        sortBy: 'name',
        sortDirection: 'asc',
      },
    ]);

    await actual.listWorkspaceTags('workspace-1', {
      page: 1,
      pageSize: 10,
      search: ' bug ',
      status: 'ACTIVE',
      sortBy: 'name',
      sortDirection: 'asc',
    });
    expect(requestSpy).toHaveBeenCalledWith(
      '/workspaces/workspace-1/tags?page=1&pageSize=10&sortBy=name&sortDirection=asc&search=bug&status=ACTIVE',
    );
    await actual.createWorkspaceTag('workspace-1', { name: ' Bug ', color: '#dc2626' });
    expect(requestSpy).toHaveBeenCalledWith(
      '/workspaces/workspace-1/tags',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Bug', color: '#dc2626' }),
      }),
    );
    await actual.updateWorkspaceTag('workspace-1', 'tag-bug', { name: 'Bug Fix', color: null });
    expect(requestSpy).toHaveBeenCalledWith(
      '/workspaces/workspace-1/tags/tag-bug',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ name: 'Bug Fix', color: null }),
      }),
    );
    await actual.archiveWorkspaceTag('workspace-1', 'tag-bug');
    expect(requestSpy).toHaveBeenCalledWith(
      '/workspaces/workspace-1/tags/tag-bug/archive',
      expect.objectContaining({ method: 'POST' }),
    );
    await actual.reactivateWorkspaceTag('workspace-1', 'tag-bug');
    expect(requestSpy).toHaveBeenCalledWith(
      '/workspaces/workspace-1/tags/tag-bug/reactivate',
      expect.objectContaining({ method: 'POST' }),
    );
    await actual.getTaskTags('workspace-1', 'task-current');
    expect(requestSpy).toHaveBeenCalledWith('/workspaces/workspace-1/tasks/task-current/tags');
    await actual.addTaskTags('workspace-1', 'task-current', ['tag-a', 'tag-a', 'tag-b']);
    expect(requestSpy).toHaveBeenCalledWith(
      '/workspaces/workspace-1/tasks/task-current/tags/add',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ tagIds: ['tag-a', 'tag-b'] }),
      }),
    );
    await actual.removeTaskTags('workspace-1', 'task-current', ['tag-a']);
    expect(requestSpy).toHaveBeenCalledWith(
      '/workspaces/workspace-1/tasks/task-current/tags/remove',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ tagIds: ['tag-a'] }),
      }),
    );
    requestSpy.mockRestore();
  });

  it('calls direct-subtask APIs with workspace, parent task, and pagination identity', async () => {
    const requestSpy = vi.spyOn(apiClient, 'request').mockResolvedValue({
      data: { items: [], page: 2, pageSize: 5, total: 0 },
      meta: {},
    } as never);
    const actual = await vi.importActual<typeof import('../services/workspace-tasks')>(
      '../services/workspace-tasks',
    );

    await actual.listWorkspaceSubtasks('workspace-1', 'task-parent', { page: 2, pageSize: 5 });
    expect(requestSpy).toHaveBeenCalledWith(
      '/workspaces/workspace-1/tasks/task-parent/subtasks?page=2&pageSize=5',
    );

    await actual.createWorkspaceSubtask('workspace-1', 'task-parent', {
      title: 'Child',
      dueAt: '2026-10-10T00:00:00.000Z',
      assigneeMembershipIds: ['membership-a'],
    });
    expect(requestSpy).toHaveBeenCalledWith(
      '/workspaces/workspace-1/tasks/task-parent/subtasks',
      expect.objectContaining({ method: 'POST' }),
    );

    await actual.updateWorkspaceTaskParent('workspace-1', 'task-child', null);
    expect(requestSpy).toHaveBeenCalledWith(
      '/workspaces/workspace-1/tasks/task-child/parent',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ parentTaskId: null }) }),
    );
    requestSpy.mockRestore();
  });
});

describe('Phase 7.3C2 task bulk selection UX', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDefaultTags();
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

describe('Phase 7.4B1 task relationship shell and subtasks UX', () => {
  const rootTask = taskFixture({
    id: 'task-root',
    title: 'Root task',
    directSubtaskCount: 1,
    parent: null,
  });
  const childTask = taskFixture({
    id: 'task-child',
    title: 'Child task',
    parentTaskId: 'task-root',
    parent: { id: 'task-root', title: 'Root task', status: status('status-task', 'TASK', 'To Do') },
    directSubtaskCount: 1,
  });
  const grandchildTask = taskFixture({
    id: 'task-grandchild',
    title: 'Grandchild task',
    parentTaskId: 'task-child',
    parent: {
      id: 'task-child',
      title: 'Child task',
      status: status('status-task', 'TASK', 'To Do'),
    },
    directSubtaskCount: 0,
  });
  const otherParent = taskFixture({
    id: 'task-other-parent',
    title: 'Other parent',
    directSubtaskCount: 0,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockDefaultTags();
    currentSearchParams = new URLSearchParams();
    localStorage.clear();
    useSessionStore.setState({
      selectedAgencyId: 'agency-1',
      selectedWorkspaceId: 'workspace-1',
      hydrated: true,
      accessToken: 'token',
      user: { id: 'admin-1', email: 'admin@zeaplay.test' },
    });
    listWorkspaceTasks.mockImplementation((_workspaceId: string, params = {}) => {
      if ('search' in (params as Record<string, unknown>)) {
        return Promise.resolve({ items: [otherParent], page: 1, pageSize: 10, total: 1 });
      }
      return Promise.resolve({ items: [rootTask], page: 1, pageSize: 20, total: 1 });
    });
    getWorkspaceTask.mockImplementation((_workspaceId: string, taskId: string) =>
      Promise.resolve(
        taskId === 'task-child'
          ? childTask
          : taskId === 'task-grandchild'
            ? grandchildTask
            : rootTask,
      ),
    );
    listWorkspaceSubtasks.mockImplementation((_workspaceId: string, taskId: string) =>
      Promise.resolve(
        taskId === 'task-root'
          ? { items: [childTask], page: 1, pageSize: 10, total: 1 }
          : taskId === 'task-child'
            ? { items: [grandchildTask], page: 1, pageSize: 5, total: 1 }
            : { items: [], page: 1, pageSize: 5, total: 0 },
      ),
    );
    listWorkspaceTaskBlockedBy.mockResolvedValue({ items: [], page: 1, pageSize: 10, total: 0 });
    listWorkspaceTaskBlocks.mockResolvedValue({ items: [], page: 1, pageSize: 10, total: 0 });
    listWorkspaceTaskRelated.mockResolvedValue({ items: [], page: 1, pageSize: 10, total: 0 });
    listWorkspaceTaskComments.mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 10,
      total: 0,
    });
    listWorkspaceTaskCommentReplies.mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 10,
      total: 0,
    });
    listWorkspaceUsers.mockResolvedValue({
      items: [user('membership-a', 'Anya')],
      page: 1,
      pageSize: 10,
      total: 1,
    });
    listDepartments.mockResolvedValue({ items: [], page: 1, pageSize: 100, total: 0 });
    listWorkspaceStatuses.mockResolvedValue([status('status-task', 'TASK', 'To Do')]);
    listWorkspaceProjects.mockResolvedValue({ items: [], page: 1, pageSize: 10, total: 0 });
    createSubtaskMock.mockResolvedValue(
      taskFixture({ id: 'task-created-child', title: 'Created child' }),
    );
    addWorkspaceTaskBlockedBy.mockResolvedValue({
      requestedCount: 1,
      changedCount: 1,
      unchangedCount: 0,
    });
    removeWorkspaceTaskBlockedBy.mockResolvedValue({
      requestedCount: 1,
      changedCount: 1,
      unchangedCount: 0,
    });
    addWorkspaceTaskRelated.mockResolvedValue({
      requestedCount: 1,
      changedCount: 1,
      unchangedCount: 0,
    });
    removeWorkspaceTaskRelated.mockResolvedValue({
      requestedCount: 1,
      changedCount: 1,
      unchangedCount: 0,
    });
    createWorkspaceTaskComment.mockResolvedValue(commentFixture({ id: 'comment-created' }));
    createWorkspaceTaskCommentReply.mockResolvedValue(
      commentFixture({ id: 'comment-reply-created', parentCommentId: 'comment-root' }),
    );
    updateWorkspaceTaskComment.mockResolvedValue(commentFixture({ id: 'comment-root' }));
    deleteWorkspaceTaskComment.mockResolvedValue(
      commentFixture({ id: 'comment-root', body: null, deleted: true, deletedAt: isoDate }),
    );
    addWorkspaceTaskCommentReaction.mockResolvedValue({ changed: true, reactionType: 'LIKE' });
    removeWorkspaceTaskCommentReaction.mockResolvedValue({ changed: true, reactionType: 'LIKE' });
    updateTaskParentMock.mockImplementation((_workspaceId: string, taskId: string, parentTaskId) =>
      Promise.resolve(taskFixture({ id: taskId, parentTaskId })),
    );
  });

  it('shows task detail tabs and lazy-loads child pages only when Subtasks is opened or expanded', async () => {
    renderWithProviders(<WorkspaceTasksPage />);
    fireEvent.click(await firstByLabelText('Open task details: Root task'));

    expect(await screen.findByRole('tab', { name: 'Overview' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Subtasks' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Dependencies' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Related' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Comments' })).toBeInTheDocument();
    expect(listWorkspaceSubtasks).not.toHaveBeenCalled();
    expect(listWorkspaceTaskBlockedBy).not.toHaveBeenCalled();
    expect(listWorkspaceTaskBlocks).not.toHaveBeenCalled();
    expect(listWorkspaceTaskRelated).not.toHaveBeenCalled();
    expect(listWorkspaceTaskComments).not.toHaveBeenCalled();

    await clickTab('Dependencies');
    expect(await screen.findByText('Blocked By')).toBeInTheDocument();
    expect(screen.getByText('Blocks')).toBeInTheDocument();
    expect(listWorkspaceTaskBlockedBy).toHaveBeenCalledWith(
      'workspace-1',
      'task-root',
      expect.objectContaining({ page: 1, pageSize: 10 }),
    );
    expect(listWorkspaceTaskBlocks).toHaveBeenCalledWith(
      'workspace-1',
      'task-root',
      expect.objectContaining({ page: 1, pageSize: 10 }),
    );
    expect(listWorkspaceTaskRelated).not.toHaveBeenCalled();
    await clickTab('Related');
    expect(await screen.findByText('Related Tasks')).toBeInTheDocument();
    expect(listWorkspaceTaskRelated).toHaveBeenCalledWith(
      'workspace-1',
      'task-root',
      expect.objectContaining({ page: 1, pageSize: 10 }),
    );
    expect(listWorkspaceSubtasks).not.toHaveBeenCalled();
    expect(listWorkspaceTaskComments).not.toHaveBeenCalled();

    await clickTab('Subtasks');
    expect(await screen.findByText('Child task')).toBeInTheDocument();
    expect(listWorkspaceSubtasks).toHaveBeenCalledWith(
      'workspace-1',
      'task-root',
      expect.objectContaining({ page: 1, pageSize: 10 }),
    );
    expect(listWorkspaceSubtasks).not.toHaveBeenCalledWith(
      'workspace-1',
      'task-child',
      expect.anything(),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    expect(await screen.findByText('Grandchild task')).toBeInTheDocument();
    expect(listWorkspaceSubtasks).toHaveBeenCalledWith(
      'workspace-1',
      'task-child',
      expect.objectContaining({ page: 1, pageSize: 5 }),
    );

    fireEvent.click(screen.getByText('Child task'));
    await waitFor(() => expect(getWorkspaceTask).toHaveBeenCalledWith('workspace-1', 'task-child'));
    expect(await screen.findByRole('tab', { name: 'Overview' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    fireEvent.click(await screen.findByRole('button', { name: 'View Parent' }));
    await waitFor(() => expect(getWorkspaceTask).toHaveBeenCalledWith('workspace-1', 'task-root'));
    expect((await screen.findAllByText('Root task')).length).toBeGreaterThan(0);
  });

  it('opens Comments lazily, posts normal and internal comments, and sends selected mention IDs only', async () => {
    listWorkspaceTaskComments.mockResolvedValue({
      items: [
        commentFixture({
          id: 'comment-root',
          body: 'Kickoff note for @Anya',
          visibility: 'INTERNAL',
          mentions: [
            {
              membershipId: 'membership-a',
              userId: 'membership-a-user',
              name: 'Anya',
              email: 'anya@zeaplay.test',
            },
          ],
        }),
      ],
      page: 1,
      pageSize: 10,
      total: 1,
    });
    listWorkspaceUsers.mockResolvedValue({
      items: [user('membership-a', 'Anya'), user('membership-c', 'Chen')],
      page: 1,
      pageSize: 8,
      total: 2,
    });

    renderWithProviders(<WorkspaceTasksPage />);
    fireEvent.click(await firstByLabelText('Open task details: Root task'));
    expect(listWorkspaceTaskComments).not.toHaveBeenCalled();

    await clickTab('Comments');
    expect(await screen.findByText('Kickoff note for @Anya')).toBeInTheDocument();
    expect(screen.getByText('Internal')).toBeInTheDocument();
    expect(listWorkspaceTaskComments).toHaveBeenCalledWith(
      'workspace-1',
      'task-root',
      expect.objectContaining({ page: 1, pageSize: 10 }),
    );

    const textarea = screen.getByLabelText('Write a comment');
    fireEvent.change(textarea, { target: { value: 'Manual @Chen and selected @A' } });
    expect(await screen.findByRole('listbox', { name: 'Mention people' })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('option', { name: 'Anya' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Internal comment/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));

    await waitFor(() =>
      expect(createWorkspaceTaskComment).toHaveBeenCalledWith(
        'workspace-1',
        'task-root',
        expect.objectContaining({
          visibility: 'INTERNAL',
          mentionedMembershipIds: ['membership-a'],
        }),
      ),
    );
    const payload = createWorkspaceTaskComment.mock.calls.at(-1)?.[2] as {
      mentionedMembershipIds: string[];
      body: string;
      visibility: string;
    };
    expect(payload.body).toContain('@Anya');
    expect(payload.mentionedMembershipIds).not.toContain('membership-c');
    await waitFor(() => expect(textarea).toHaveValue(''));
    expect(screen.getByRole('checkbox', { name: /Internal comment/i })).not.toBeChecked();
    expect(payload.visibility).toBe('INTERNAL');
  });

  it('preserves failed comment drafts and prevents duplicate pending create requests', async () => {
    createWorkspaceTaskComment.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden'), { status: 403 }),
    );

    renderWithProviders(<WorkspaceTasksPage />);
    fireEvent.click(await firstByLabelText('Open task details: Root task'));
    await clickTab('Comments');
    const textarea = screen.getByLabelText('Write a comment');
    fireEvent.change(textarea, { target: { value: 'Draft that should remain @A' } });
    fireEvent.click(await screen.findByRole('option', { name: 'Anya' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /Internal comment/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Post comment' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Comment could not be posted.'));
    expect((textarea as HTMLTextAreaElement).value).toContain('Draft that should remain');
    expect(screen.getByRole('checkbox', { name: /Internal comment/i })).toBeChecked();
    expect(screen.getByText('@Anya')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Post comment' })).not.toBeDisabled(),
    );

    let resolveCreate: (value: TaskCommentSummary) => void = () => undefined;
    createWorkspaceTaskComment.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );
    fireEvent.change(textarea, { target: { value: 'Pending create once' } });
    const submit = screen.getByRole('button', { name: 'Post comment' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    fireEvent.submit(submit.closest('form')!);
    await waitFor(() => expect(createWorkspaceTaskComment).toHaveBeenCalledTimes(2));

    await act(async () => {
      resolveCreate(commentFixture({ id: 'comment-pending' }));
      await Promise.resolve();
    });
  });

  it('lazy-loads replies, replies inline, edits, deletes, and toggles multiple reactions', async () => {
    listWorkspaceTaskComments.mockResolvedValue({
      items: [
        commentFixture({
          id: 'comment-root',
          body: 'Root comment',
          directReplyCount: 1,
          reactionCounts: { LIKE: 1, LOVE: 0, CELEBRATE: 0, EYES: 0, CHECK: 0 },
        }),
      ],
      page: 1,
      pageSize: 10,
      total: 1,
    });
    listWorkspaceTaskCommentReplies.mockResolvedValue({
      items: [
        commentFixture({
          id: 'comment-reply',
          parentCommentId: 'comment-root',
          body: 'Existing reply',
        }),
      ],
      page: 1,
      pageSize: 10,
      total: 1,
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderWithProviders(<WorkspaceTasksPage />);
    fireEvent.click(await firstByLabelText('Open task details: Root task'));
    await clickTab('Comments');
    expect(await screen.findByText('Root comment')).toBeInTheDocument();
    expect(listWorkspaceTaskCommentReplies).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'View 1 replies' }));
    expect(await screen.findByText('Existing reply')).toBeInTheDocument();
    expect(listWorkspaceTaskCommentReplies).toHaveBeenCalledWith(
      'workspace-1',
      'task-root',
      'comment-root',
      expect.objectContaining({ page: 1, pageSize: 10 }),
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Reply' })[0]!);
    fireEvent.change(screen.getByLabelText('Write a reply'), { target: { value: 'Inline reply' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post reply' }));
    await waitFor(() =>
      expect(createWorkspaceTaskCommentReply).toHaveBeenCalledWith(
        'workspace-1',
        'task-root',
        'comment-root',
        expect.objectContaining({ body: 'Inline reply', visibility: 'NORMAL' }),
      ),
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]!);
    fireEvent.change(screen.getByLabelText('Edit comment'), { target: { value: 'Root edited' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(updateWorkspaceTaskComment).toHaveBeenCalledWith(
        'workspace-1',
        'task-root',
        'comment-root',
        { body: 'Root edited' },
      ),
    );

    fireEvent.click(screen.getAllByRole('button', { name: /React with Like/i })[0]!);
    await waitFor(() =>
      expect(addWorkspaceTaskCommentReaction).toHaveBeenCalledWith(
        'workspace-1',
        'task-root',
        'comment-root',
        'LIKE',
      ),
    );
    fireEvent.click(screen.getAllByRole('button', { name: /React with Love/i })[0]!);
    await waitFor(() =>
      expect(addWorkspaceTaskCommentReaction).toHaveBeenCalledWith(
        'workspace-1',
        'task-root',
        'comment-root',
        'LOVE',
      ),
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete comment' })[0]!);
    await waitFor(() =>
      expect(deleteWorkspaceTaskComment).toHaveBeenCalledWith(
        'workspace-1',
        'task-root',
        'comment-root',
      ),
    );
  });

  it('renders task overview tags, adds multiple active tags once, and removes archived tags', async () => {
    getTaskTags.mockResolvedValue([
      tagFixture({ id: 'tag-bug', name: 'Bug', status: 'ACTIVE' }),
      tagFixture({ id: 'tag-legacy', name: 'Legacy', status: 'ARCHIVED', color: null }),
    ]);
    listWorkspaceTags.mockResolvedValue({
      items: [
        tagFixture({ id: 'tag-feature', name: 'Feature' }),
        tagFixture({ id: 'tag-bug', name: 'Bug' }),
      ],
      page: 1,
      pageSize: 10,
      total: 2,
    });
    addTaskTags.mockResolvedValue({ requestedCount: 1, changedCount: 1, unchangedCount: 0 });
    removeTaskTags.mockResolvedValue({ requestedCount: 1, changedCount: 1, unchangedCount: 0 });

    renderWithProviders(<WorkspaceTasksPage />);
    fireEvent.click(await firstByLabelText('Open task details: Root task'));

    expect(await screen.findByText('Bug')).toBeInTheDocument();
    expect(screen.getByText('Legacy')).toBeInTheDocument();
    expect(screen.getByText('Archived')).toBeInTheDocument();
    expect(getTaskTags).toHaveBeenCalledWith('workspace-1', 'task-root');
    expect(listWorkspaceTags).not.toHaveBeenCalledWith(
      'workspace-1',
      expect.objectContaining({ status: 'ACTIVE' }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add Tags' }));
    expect(await screen.findByRole('dialog', { name: 'Add Tags' })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('option', { name: /Feature/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Tags' }));
    await waitFor(() =>
      expect(addTaskTags).toHaveBeenCalledWith('workspace-1', 'task-root', ['tag-feature']),
    );
    expect(addTaskTags).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Remove Legacy from task' }));
    await waitFor(() =>
      expect(removeTaskTags).toHaveBeenCalledWith('workspace-1', 'task-root', ['tag-legacy']),
    );
  });

  it('preserves selected tags across search, enforces assignment limits, and reports no-op or stale results safely', async () => {
    const manyTags = Array.from({ length: 51 }, (_, index) =>
      tagFixture({ id: `tag-${index + 1}`, name: `Tag ${index + 1}` }),
    );
    getTaskTags.mockResolvedValue([tagFixture({ id: 'tag-legacy', name: 'Legacy' })]);
    listWorkspaceTags.mockResolvedValue({
      items: manyTags,
      page: 1,
      pageSize: 10,
      total: manyTags.length,
    });
    addTaskTags.mockResolvedValue({ requestedCount: 50, changedCount: 0, unchangedCount: 50 });
    removeTaskTags.mockResolvedValue({ requestedCount: 1, changedCount: 0, unchangedCount: 1 });

    renderWithProviders(<WorkspaceTasksPage />);
    fireEvent.click(await firstByLabelText('Open task details: Root task'));
    fireEvent.click(await screen.findByRole('button', { name: 'Add Tags' }));
    expect(await screen.findByRole('listbox', { name: 'Tag search results' })).toBeInTheDocument();

    const options = await screen.findAllByRole('option');
    for (const option of options.slice(0, 50)) fireEvent.click(option);
    fireEvent.click(options[50]!);
    expect(toastError).toHaveBeenCalledWith('You can select up to 50 tags.');

    fireEvent.change(screen.getByRole('textbox', { name: 'Search tags' }), {
      target: { value: 'changed search' },
    });
    const selectedTags = screen.getByLabelText('Selected tags');
    expect(within(selectedTags).getByText('Tag 1')).toBeInTheDocument();
    expect(within(selectedTags).getByText('Tag 50')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add Tags' }));
    await waitFor(() => expect(addTaskTags).toHaveBeenCalledTimes(1));
    expect(addTaskTags).toHaveBeenCalledWith(
      'workspace-1',
      'task-root',
      manyTags.slice(0, 50).map((tag) => tag.id),
    );
    expect(toastSuccess).toHaveBeenCalledWith('No new tags were added.');

    fireEvent.click(await screen.findByRole('button', { name: 'Remove Legacy from task' }));
    await waitFor(() => expect(removeTaskTags).toHaveBeenCalledTimes(1));
    expect(toastSuccess).toHaveBeenCalledWith('No tags were removed.');

    const archivedError = new Error('archived tag cannot be assigned') as Error & {
      status?: number;
    };
    archivedError.status = 422;
    addTaskTags.mockRejectedValueOnce(archivedError);
    fireEvent.click(screen.getByRole('button', { name: 'Add Tags' }));
    fireEvent.click((await screen.findAllByRole('option'))[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Add Tags' }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Archived tags cannot be assigned to tasks.'),
    );
    expect(screen.getByRole('dialog', { name: 'Add Tags' })).toBeInTheDocument();
    expect(within(screen.getByLabelText('Selected tags')).getByText('Tag 1')).toBeInTheDocument();
  });

  it('manages workspace tags with search, create, edit, archive, and reactivate', async () => {
    listWorkspaceTags.mockResolvedValue({
      items: [
        tagFixture({ id: 'tag-bug', name: 'Bug', status: 'ACTIVE' }),
        tagFixture({ id: 'tag-legacy', name: 'Legacy', status: 'ARCHIVED' }),
      ],
      page: 1,
      pageSize: 10,
      total: 2,
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderWithProviders(<WorkspaceTasksPage />);
    fireEvent.click(await firstByLabelText('Open task details: Root task'));
    fireEvent.click(await screen.findByRole('button', { name: 'Manage Tags' }));

    expect(await screen.findByRole('dialog', { name: 'Manage Tags' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Tag Name'), { target: { value: 'QA' } });
    fireEvent.change(screen.getByLabelText('Tag Color'), { target: { value: '#22C55E' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Tag' }));
    await waitFor(() =>
      expect(createWorkspaceTag).toHaveBeenCalledWith('workspace-1', {
        name: 'QA',
        color: '#22C55E',
      }),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Tag: Bug' }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Tag Name'), { target: { value: 'Bug Fixed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(updateWorkspaceTag).toHaveBeenCalledWith(
        'workspace-1',
        'tag-bug',
        expect.objectContaining({ name: 'Bug Fixed' }),
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Archive: Bug' }));
    await waitFor(() => expect(archiveWorkspaceTag).toHaveBeenCalledWith('workspace-1', 'tag-bug'));
    fireEvent.click(screen.getByRole('button', { name: 'Reactivate: Legacy' }));
    await waitFor(() =>
      expect(reactivateWorkspaceTag).toHaveBeenCalledWith('workspace-1', 'tag-legacy'),
    );
  });

  it('filters All Tasks by tag through URL state and clears tenant-bound tag filter on workspace switch', async () => {
    currentSearchParams = new URLSearchParams('tagId=tag-bug&priority=HIGH&view=grid');
    listWorkspaceTags.mockResolvedValue({
      items: [tagFixture({ id: 'tag-bug', name: 'Bug' })],
      page: 1,
      pageSize: 10,
      total: 1,
    });

    renderWithProviders(<WorkspaceTasksPage />);

    await waitFor(() =>
      expect(listWorkspaceTasks).toHaveBeenCalledWith(
        'workspace-1',
        expect.objectContaining({ tagId: 'tag-bug', priority: 'HIGH' }),
      ),
    );
    expect(await screen.findByText('Filter by Tag: Bug')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Remove filter Filter by Tag: Bug/ }));
    expect(routerReplace).toHaveBeenCalledWith('/workspace/tasks?priority=HIGH&view=grid', {
      scroll: false,
    });

    act(() => {
      useSessionStore.setState({ selectedWorkspaceId: 'workspace-2' });
    });
    await waitFor(() =>
      expect(routerReplace).toHaveBeenCalledWith('/workspace/tasks?priority=HIGH&view=grid', {
        scroll: false,
      }),
    );
  });

  it('keeps root and nested pagination bounded, isolated, and keyed by parent', async () => {
    const rootPageOne = Array.from({ length: 10 }, (_, index) =>
      taskFixture({
        id: `task-root-child-${index + 1}`,
        title: `Root child ${index + 1}`,
        directSubtaskCount: index === 0 ? 6 : 0,
      }),
    );
    const rootPageTwo = [
      taskFixture({ id: 'task-root-child-11', title: 'Root child 11', directSubtaskCount: 0 }),
      taskFixture({ id: 'task-root-child-12', title: 'Root child 12', directSubtaskCount: 0 }),
    ];
    const nestedPageOne = Array.from({ length: 5 }, (_, index) =>
      taskFixture({
        id: `task-nested-${index + 1}`,
        title: `Nested child ${index + 1}`,
        directSubtaskCount: 0,
      }),
    );
    const nestedPageTwo = [
      taskFixture({ id: 'task-nested-6', title: 'Nested child 6', directSubtaskCount: 0 }),
    ];
    listWorkspaceSubtasks.mockImplementation(
      (_workspaceId: string, taskId: string, params: { page: number; pageSize: number }) => {
        if (taskId === 'task-root') {
          return Promise.resolve({
            items: params.page === 2 ? rootPageTwo : rootPageOne,
            page: params.page,
            pageSize: params.pageSize,
            total: 12,
          });
        }
        if (taskId === 'task-root-child-1') {
          return Promise.resolve({
            items: params.page === 2 ? nestedPageTwo : nestedPageOne,
            page: params.page,
            pageSize: params.pageSize,
            total: 6,
          });
        }
        return Promise.resolve({
          items: [],
          page: params.page,
          pageSize: params.pageSize,
          total: 0,
        });
      },
    );

    renderWithProviders(<WorkspaceTasksPage />);
    fireEvent.click(await firstByLabelText('Open task details: Root task'));
    await clickTab('Subtasks');
    expect(await screen.findByText('Root child 1')).toBeInTheDocument();
    expect(screen.queryByText('Root child 11')).not.toBeInTheDocument();

    fireEvent.click(firstEnabledButton(screen.getAllByRole('button', { name: 'Expand' })));
    expect(await screen.findByText('Nested child 1')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Next' })[0] as HTMLElement);
    expect(await screen.findByText('Nested child 6')).toBeInTheDocument();
    expect(listWorkspaceSubtasks).toHaveBeenCalledWith(
      'workspace-1',
      'task-root-child-1',
      expect.objectContaining({ page: 2, pageSize: 5 }),
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Next' }).at(-1) as HTMLElement);
    expect(await screen.findByText('Root child 11')).toBeInTheDocument();
    expect(listWorkspaceSubtasks).toHaveBeenCalledWith(
      'workspace-1',
      'task-root',
      expect.objectContaining({ page: 2, pageSize: 10 }),
    );
    expect(listWorkspaceSubtasks).not.toHaveBeenCalledWith(
      'workspace-1',
      'task-root-child-2',
      expect.anything(),
    );
  });

  it('stops malformed repeated task paths without recursive network cascades', async () => {
    const repeatedA = taskFixture({
      id: 'task-a',
      title: 'Deep A',
      directSubtaskCount: 1,
    });
    const deepB = taskFixture({
      id: 'task-b',
      title: 'Deep B',
      directSubtaskCount: 1,
    });
    listWorkspaceSubtasks.mockImplementation((_workspaceId: string, taskId: string) =>
      Promise.resolve(
        taskId === 'task-root'
          ? { items: [repeatedA], page: 1, pageSize: 10, total: 1 }
          : taskId === 'task-a'
            ? { items: [deepB], page: 1, pageSize: 5, total: 1 }
            : taskId === 'task-b'
              ? { items: [repeatedA], page: 1, pageSize: 5, total: 1 }
              : { items: [], page: 1, pageSize: 5, total: 0 },
      ),
    );

    renderWithProviders(<WorkspaceTasksPage />);
    fireEvent.click(await firstByLabelText('Open task details: Root task'));
    await clickTab('Subtasks');
    fireEvent.click(await screen.findByRole('button', { name: 'Expand' }));
    expect(await screen.findByText('Deep B')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Expand' })[0] as HTMLElement);
    expect(
      await screen.findByText('This branch contains repeated task data and was stopped.'),
    ).toBeInTheDocument();
    const taskACalls = listWorkspaceSubtasks.mock.calls.filter((call) => call[1] === 'task-a');
    expect(taskACalls).toHaveLength(1);
  });

  it('creates a subtask with quick fields, reveals advanced details, and refreshes parent children', async () => {
    let resolveCreate: ((task: ReturnType<typeof taskFixture>) => void) | undefined;
    createSubtaskMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );
    renderWithProviders(<WorkspaceTasksPage />);
    fireEvent.click(await firstByLabelText('Open task details: Root task'));
    await clickTab('Subtasks');
    fireEvent.click(await screen.findByRole('button', { name: 'Create Subtask' }));

    const createDialog = await dialogByTitle('Create Subtask');
    expect(within(createDialog).getByLabelText('Title *')).toBeInTheDocument();
    expect(within(createDialog).getByLabelText('Assignee')).toBeInTheDocument();
    expect(within(createDialog).getByLabelText('Due Date *')).toBeInTheDocument();
    expect(screen.queryByLabelText('Description')).not.toBeInTheDocument();

    fireEvent.click(within(createDialog).getByRole('button', { name: 'Add more details' }));
    expect(within(createDialog).getByLabelText('Description')).toBeInTheDocument();
    fireEvent.change(within(createDialog).getByLabelText('Title *'), {
      target: { value: 'Created child' },
    });
    const [assigneeOption] = await within(createDialog).findAllByLabelText('Anya');
    if (!assigneeOption) throw new Error('Expected Anya assignee option');
    fireEvent.click(assigneeOption);
    fireEvent.change(within(createDialog).getByLabelText('Due Date *'), {
      target: { value: '2026-10-10' },
    });
    const submitButton = within(createDialog).getByRole('button', { name: 'Create Subtask' });
    fireEvent.click(submitButton);
    fireEvent.click(submitButton);
    resolveCreate?.(taskFixture({ id: 'task-created-child', title: 'Created child' }));

    await waitFor(() =>
      expect(createSubtaskMock).toHaveBeenCalledWith(
        'workspace-1',
        'task-root',
        expect.objectContaining({
          title: 'Created child',
          assigneeMembershipIds: ['membership-a'],
          dueAt: taskDueAtFromLocalDate('2026-10-10'),
        }),
      ),
    );
    expect(createSubtaskMock).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith('Subtask created');
  });

  it('preserves subtask drafts and shows safe create errors for terminal parent rejection', async () => {
    createSubtaskMock.mockRejectedValueOnce(
      Object.assign(new Error('Terminal parent tasks cannot contain active subtasks.'), {
        status: 409,
      }),
    );
    renderWithProviders(<WorkspaceTasksPage />);
    fireEvent.click(await firstByLabelText('Open task details: Root task'));
    await clickTab('Subtasks');
    fireEvent.click(await screen.findByRole('button', { name: 'Create Subtask' }));
    const createDialog = await dialogByTitle('Create Subtask');
    fireEvent.change(within(createDialog).getByLabelText('Title *'), {
      target: { value: 'Blocked child' },
    });
    const [assigneeOption] = await within(createDialog).findAllByLabelText('Anya');
    if (!assigneeOption) throw new Error('Expected Anya assignee option');
    fireEvent.click(assigneeOption);
    fireEvent.change(within(createDialog).getByLabelText('Due Date *'), {
      target: { value: '2026-10-10' },
    });
    fireEvent.click(within(createDialog).getByRole('button', { name: 'Create Subtask' }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'Terminal parent tasks cannot contain active non-terminal subtasks.',
      ),
    );
    expect(within(createDialog).getByDisplayValue('Blocked child')).toBeInTheDocument();
    expect(toastSuccess).not.toHaveBeenCalledWith('Subtask created');
  });

  it('moves a child to another parent, detaches to root, and surfaces hierarchy errors safely', async () => {
    renderWithProviders(<WorkspaceTasksPage />);
    fireEvent.click(await firstByLabelText('Open task details: Root task'));
    await clickTab('Subtasks');
    expect(await screen.findByText('Child task')).toBeInTheDocument();

    listWorkspaceTasks.mockImplementation((_workspaceId: string, params = {}) => {
      if ('search' in (params as Record<string, unknown>)) {
        return Promise.resolve({
          items: [rootTask, otherParent],
          page: 1,
          pageSize: 10,
          total: 2,
        });
      }
      return Promise.resolve({ items: [rootTask], page: 1, pageSize: 20, total: 1 });
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Move / Change Parent' }));
    fireEvent.change(screen.getByLabelText('New Parent'), { target: { value: 'Other' } });
    await waitFor(() => expect(screen.getAllByText('Root task').length).toBeGreaterThan(1));
    const moveDialog = await dialogByTitle('Move Task');
    const rootCandidate = within(moveDialog)
      .getAllByText('Root task')
      .map((node) => node.closest('button'))
      .find(Boolean);
    if (!rootCandidate) throw new Error('Expected current parent candidate');
    expect(rootCandidate).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move' })).toBeDisabled();
    expect(await screen.findByText('Other parent')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Other parent'));
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    await waitFor(() =>
      expect(updateTaskParentMock).toHaveBeenCalledWith(
        'workspace-1',
        'task-child',
        'task-other-parent',
      ),
    );

    fireEvent.click(
      (await screen.findAllByRole('button', { name: 'Move / Change Parent' }))[0] as HTMLElement,
    );
    fireEvent.click(screen.getByText('Move to Root'));
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    await waitFor(() =>
      expect(updateTaskParentMock).toHaveBeenCalledWith('workspace-1', 'task-child', null),
    );

    updateTaskParentMock.mockRejectedValueOnce(
      Object.assign(new Error('Task hierarchy cycles are not allowed.'), { status: 409 }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Move / Change Parent' }));
    fireEvent.click(screen.getByText('Move to Root'));
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Hierarchy cycle not allowed.'));

    updateTaskParentMock.mockRejectedValueOnce(
      Object.assign(new Error('Selected parent was deleted.'), { status: 404 }),
    );
    fireEvent.change(screen.getByLabelText('New Parent'), { target: { value: 'Other' } });
    fireEvent.click(await screen.findByText('Other parent'));
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'Selected parent is no longer available. Refresh and try again.',
      ),
    );
  });

  it('clears relationship UI state on workspace switch', async () => {
    renderWithProviders(<WorkspaceTasksPage />);
    fireEvent.click(await firstByLabelText('Open task details: Root task'));
    await clickTab('Subtasks');
    expect(await screen.findByText('Child task')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Move / Change Parent' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    act(() => {
      useSessionStore.setState({ selectedWorkspaceId: 'workspace-2' });
    });
    await waitFor(() => expect(screen.queryByText('Child task')).not.toBeInTheDocument());
    expect(screen.queryByText('Move Task')).not.toBeInTheDocument();
  });

  it('clears open relationship state on session loss without persisting hierarchy state', async () => {
    renderWithProviders(<WorkspaceTasksPage />);
    fireEvent.click(await firstByLabelText('Open task details: Root task'));
    await clickTab('Subtasks');
    expect(await screen.findByText('Child task')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    expect(await screen.findByText('Grandchild task')).toBeInTheDocument();
    fireEvent.click(
      (await screen.findAllByRole('button', { name: 'Move / Change Parent' }))[0] as HTMLElement,
    );
    expect(screen.getByText('Move Task')).toBeInTheDocument();

    act(() => {
      useSessionStore.setState({ accessToken: null });
    });

    await waitFor(() => expect(screen.queryByText('Move Task')).not.toBeInTheDocument());
    expect(screen.queryByText('Child task')).not.toBeInTheDocument();
    expect(localStorage.getItem('task-expanded-ids')).toBeNull();
  });

  it('lazy-loads dependencies with independent pagination and opens blocker detail without row detail fetches', async () => {
    const blockerOne = taskFixture({
      id: 'task-blocker-1',
      title: 'Legal approval',
      status: status('status-review', 'TASK', 'Review', false),
      priority: 'URGENT',
      assignees: [rootTask.assignees[0]!],
    });
    const blockerTwo = taskFixture({
      id: 'task-blocker-2',
      title: 'Final signoff',
      status: status('status-done', 'TASK', 'Completed', false, true),
      priority: 'LOW',
    });
    const blockedTask = taskFixture({
      id: 'task-blocked-1',
      title: 'Publish campaign',
      priority: 'MEDIUM',
    });
    listWorkspaceTaskBlockedBy.mockImplementation(
      (_workspaceId: string, _taskId: string, params: { page: number; pageSize: number }) =>
        Promise.resolve({
          items: params.page === 2 ? [blockerTwo] : [blockerOne],
          page: params.page,
          pageSize: params.pageSize,
          total: 11,
        }),
    );
    listWorkspaceTaskBlocks.mockImplementation(
      (_workspaceId: string, _taskId: string, params: { page: number; pageSize: number }) =>
        Promise.resolve({
          items: params.page === 2 ? [] : [blockedTask],
          page: params.page,
          pageSize: params.pageSize,
          total: 1,
        }),
    );

    renderWithProviders(<WorkspaceTasksPage />);
    fireEvent.click(await firstByLabelText('Open task details: Root task'));
    expect(listWorkspaceTaskBlockedBy).not.toHaveBeenCalled();
    expect(listWorkspaceTaskBlocks).not.toHaveBeenCalled();
    await clickTab('Dependencies');

    expect(await screen.findByText('Legal approval')).toBeInTheDocument();
    expect(screen.getByText('Publish campaign')).toBeInTheDocument();
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
    expect(getWorkspaceTask).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getAllByRole('button', { name: 'Next' })[0] as HTMLElement);
    expect(await screen.findByText('Final signoff')).toBeInTheDocument();
    expect(listWorkspaceTaskBlockedBy).toHaveBeenCalledWith(
      'workspace-1',
      'task-root',
      expect.objectContaining({ page: 2, pageSize: 10 }),
    );
    expect(listWorkspaceTaskBlocks).not.toHaveBeenCalledWith(
      'workspace-1',
      'task-root',
      expect.objectContaining({ page: 2 }),
    );
    fireEvent.click(screen.getByText('Final signoff'));
    await waitFor(() =>
      expect(getWorkspaceTask).toHaveBeenCalledWith('workspace-1', 'task-blocker-2'),
    );
  });

  it('adds and removes blockers with bounded search, one request, counts, and safe failures', async () => {
    let resolveAdd:
      | ((value: { requestedCount: number; changedCount: number; unchangedCount: number }) => void)
      | undefined;
    addWorkspaceTaskBlockedBy.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveAdd = resolve;
      }),
    );
    listWorkspaceTasks.mockImplementation((_workspaceId: string, params = {}) => {
      if ('search' in (params as Record<string, unknown>)) {
        return Promise.resolve({
          items: [
            taskFixture({ id: 'task-candidate-1', title: 'Design dependency' }),
            taskFixture({ id: 'task-candidate-2', title: 'Engineering dependency' }),
            rootTask,
          ],
          page: 1,
          pageSize: 10,
          total: 3,
        });
      }
      return Promise.resolve({ items: [rootTask], page: 1, pageSize: 20, total: 1 });
    });
    listWorkspaceTaskBlockedBy.mockResolvedValue({
      items: [taskFixture({ id: 'task-candidate-1', title: 'Design dependency' })],
      page: 1,
      pageSize: 10,
      total: 1,
    });

    renderWithProviders(<WorkspaceTasksPage />);
    fireEvent.click(await firstByLabelText('Open task details: Root task'));
    await clickTab('Dependencies');
    fireEvent.click(await screen.findByRole('button', { name: 'Add Blocker' }));
    const dialog = await dialogByTitle('Add Blocker');
    fireEvent.change(within(dialog).getByLabelText('Search tasks'), { target: { value: 'dep' } });
    fireEvent.click(await within(dialog).findByRole('button', { name: /Design dependency/ }));
    fireEvent.click(await within(dialog).findByRole('button', { name: /Engineering dependency/ }));
    const submit = within(dialog).getByRole('button', { name: 'Add Blocker' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    resolveAdd?.({ requestedCount: 2, changedCount: 1, unchangedCount: 1 });

    await waitFor(() =>
      expect(addWorkspaceTaskBlockedBy).toHaveBeenCalledWith('workspace-1', 'task-root', [
        'task-candidate-1',
        'task-candidate-2',
      ]),
    );
    expect(addWorkspaceTaskBlockedBy).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('1 blockers added. 1 already linked.'),
    );
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Add Blocker' })).not.toBeInTheDocument(),
    );

    fireEvent.click(await screen.findByRole('button', { name: /Remove Blocker:/ }));
    await waitFor(() =>
      expect(removeWorkspaceTaskBlockedBy).toHaveBeenCalledWith('workspace-1', 'task-root', [
        'task-candidate-1',
      ]),
    );

    addWorkspaceTaskBlockedBy.mockRejectedValueOnce(
      Object.assign(new Error('Dependency cycle detected.'), { status: 409 }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Add Blocker' }));
    const failingDialog = await dialogByTitle('Add Blocker');
    fireEvent.click(
      await within(failingDialog).findByRole('button', { name: /Design dependency/ }),
    );
    fireEvent.click(within(failingDialog).getByRole('button', { name: 'Add Blocker' }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('This dependency would create a cycle.'),
    );
    expect(within(failingDialog).getAllByText('Design dependency').length).toBeGreaterThan(0);
  });

  it('manages related tasks symmetrically without dependency language', async () => {
    const relatedTask = taskFixture({ id: 'task-related-1', title: 'Reference launch task' });
    listWorkspaceTaskRelated.mockResolvedValue({
      items: [relatedTask],
      page: 1,
      pageSize: 10,
      total: 1,
    });
    listWorkspaceTasks.mockImplementation((_workspaceId: string, params = {}) => {
      if ('search' in (params as Record<string, unknown>)) {
        return Promise.resolve({ items: [relatedTask, rootTask], page: 1, pageSize: 10, total: 2 });
      }
      return Promise.resolve({ items: [rootTask], page: 1, pageSize: 20, total: 1 });
    });
    addWorkspaceTaskRelated.mockResolvedValueOnce({
      requestedCount: 1,
      changedCount: 0,
      unchangedCount: 1,
    });

    renderWithProviders(<WorkspaceTasksPage />);
    fireEvent.click(await firstByLabelText('Open task details: Root task'));
    await clickTab('Related');
    expect(await screen.findByText('Related Tasks')).toBeInTheDocument();
    expect(screen.getByText('Reference launch task')).toBeInTheDocument();
    expect(screen.queryByText('Must complete first')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add Related Task' }));
    const dialog = await dialogByTitle('Add Related Task');
    fireEvent.change(within(dialog).getByLabelText('Search tasks'), { target: { value: 'ref' } });
    fireEvent.click(await within(dialog).findByRole('button', { name: /Reference launch task/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add Related Task' }));
    await waitFor(() =>
      expect(addWorkspaceTaskRelated).toHaveBeenCalledWith('workspace-1', 'task-root', [
        'task-related-1',
      ]),
    );
    expect(toastSuccess).toHaveBeenCalledWith('No new relationships were added.');
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Add Related Task' })).not.toBeInTheDocument(),
    );

    fireEvent.click(await screen.findByRole('button', { name: /Remove Related Task:/ }));
    await waitFor(() =>
      expect(removeWorkspaceTaskRelated).toHaveBeenCalledWith('workspace-1', 'task-root', [
        'task-related-1',
      ]),
    );
    fireEvent.click(screen.getByText('Reference launch task'));
    await waitFor(() =>
      expect(getWorkspaceTask).toHaveBeenCalledWith('workspace-1', 'task-related-1'),
    );
  });

  it('clears dependency and related dialogs on workspace switch', async () => {
    const candidate = taskFixture({ id: 'task-candidate-1', title: 'Candidate task' });
    listWorkspaceTasks.mockImplementation((_workspaceId: string, params = {}) => {
      if ('search' in (params as Record<string, unknown>)) {
        return Promise.resolve({ items: [candidate], page: 1, pageSize: 10, total: 1 });
      }
      return Promise.resolve({ items: [rootTask], page: 1, pageSize: 20, total: 1 });
    });

    renderWithProviders(<WorkspaceTasksPage />);
    fireEvent.click(await firstByLabelText('Open task details: Root task'));
    await clickTab('Dependencies');
    fireEvent.click(await screen.findByRole('button', { name: 'Add Blocker' }));
    expect(await dialogByTitle('Add Blocker')).toBeInTheDocument();
    act(() => {
      useSessionStore.setState({ selectedWorkspaceId: 'workspace-2' });
    });
    await waitFor(() => expect(screen.queryByText('Candidate task')).not.toBeInTheDocument());
    expect(addWorkspaceTaskBlockedBy).not.toHaveBeenCalled();

    act(() => {
      useSessionStore.setState({ selectedWorkspaceId: 'workspace-1' });
    });
    fireEvent.click(await firstByLabelText('Open task details: Root task'));
    await clickTab('Related');
    fireEvent.click(await screen.findByRole('button', { name: 'Add Related Task' }));
    expect(await dialogByTitle('Add Related Task')).toBeInTheDocument();
    act(() => {
      useSessionStore.setState({ selectedWorkspaceId: 'workspace-2' });
    });
    await waitFor(() => expect(screen.queryByText('Candidate task')).not.toBeInTheDocument());
    expect(addWorkspaceTaskRelated).not.toHaveBeenCalled();
  });

  it('keeps selected relationship chips across search changes', async () => {
    const candidates = Array.from({ length: 2 }, (_, index) =>
      taskFixture({
        id: `task-candidate-${index + 1}`,
        title: `Candidate ${index + 1}`,
      }),
    );
    listWorkspaceTasks.mockImplementation((_workspaceId: string, params = {}) => {
      if ('search' in (params as Record<string, unknown>)) {
        return Promise.resolve({
          items: candidates,
          page: 1,
          pageSize: 10,
          total: 2,
        });
      }
      return Promise.resolve({ items: [rootTask], page: 1, pageSize: 20, total: 1 });
    });

    renderWithProviders(<WorkspaceTasksPage />);
    fireEvent.click(await firstByLabelText('Open task details: Root task'));
    await clickTab('Dependencies');
    fireEvent.click(await screen.findByRole('button', { name: 'Add Blocker' }));
    const dialog = await dialogByTitle('Add Blocker');
    fireEvent.change(within(dialog).getByLabelText('Search tasks'), {
      target: { value: 'first' },
    });
    fireEvent.click(await within(dialog).findByRole('button', { name: /^Candidate 1\b/ }));
    fireEvent.change(within(dialog).getByLabelText('Search tasks'), {
      target: { value: 'second' },
    });
    await waitFor(() =>
      expect(within(dialog).getAllByText('Candidate 1').length).toBeGreaterThan(0),
    );
    expect(
      within(dialog).getByRole('button', { name: 'Remove selected task: Candidate 1' }),
    ).toBeInTheDocument();
  });

  it('caps relationship selection at 100 tasks and still allows deselection', () => {
    const selected = Array.from({ length: 100 }, (_, index) =>
      taskFixture({
        id: `task-candidate-${index + 1}`,
        title: `Candidate ${index + 1}`,
      }),
    );
    const capped = toggleRelationshipSelection(
      selected,
      taskFixture({ id: 'task-candidate-101', title: 'Candidate 101' }),
    );
    expect(capped).toHaveLength(100);
    expect(capped.some((item) => item.id === 'task-candidate-101')).toBe(false);

    const reduced = toggleRelationshipSelection(selected, selected[0]!);
    expect(reduced).toHaveLength(99);
    expect(reduced.some((item) => item.id === 'task-candidate-1')).toBe(false);
  });

  it('maps terminal, stale candidate, and concurrent relationship failures safely', async () => {
    const candidate = taskFixture({ id: 'task-candidate-1', title: 'Candidate task' });
    listWorkspaceTasks.mockImplementation((_workspaceId: string, params = {}) => {
      if ('search' in (params as Record<string, unknown>)) {
        return Promise.resolve({ items: [candidate], page: 1, pageSize: 10, total: 1 });
      }
      return Promise.resolve({ items: [rootTask], page: 1, pageSize: 20, total: 1 });
    });
    addWorkspaceTaskBlockedBy
      .mockRejectedValueOnce(
        Object.assign(new Error('Terminal tasks cannot accept active non-terminal blockers.'), {
          status: 409,
        }),
      )
      .mockRejectedValueOnce(Object.assign(new Error('Task not found.'), { status: 404 }))
      .mockRejectedValueOnce(
        Object.assign(new Error('Serialization conflict while writing dependency.'), {
          status: 409,
        }),
      );

    renderWithProviders(<WorkspaceTasksPage />);
    fireEvent.click(await firstByLabelText('Open task details: Root task'));
    await clickTab('Dependencies');
    fireEvent.click(await screen.findByRole('button', { name: 'Add Blocker' }));
    const dialog = await dialogByTitle('Add Blocker');
    fireEvent.click(await within(dialog).findByRole('button', { name: /Candidate task/ }));

    for (const expected of [
      'This task is already complete. Only completed blockers can be added.',
      'Selected task is no longer available. Refresh and try again.',
      'Task relationships changed at the same time. Please retry.',
    ]) {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Add Blocker' }));
      await waitFor(() => expect(toastError).toHaveBeenCalledWith(expected));
      expect(within(dialog).getAllByText('Candidate task').length).toBeGreaterThan(0);
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
  fireEvent.click(screen.getAllByRole('combobox', { name: label })[0]!);
  const item = await screen.findByRole('option', { name: option });
  fireEvent.click(item);
  await waitFor(() =>
    expect(screen.queryByRole('option', { name: option })).not.toBeInTheDocument(),
  );
}

async function clickTab(name: string) {
  const tab = await screen.findByRole('tab', { name });
  fireEvent.pointerDown(tab);
  fireEvent.mouseDown(tab);
  fireEvent.click(tab);
}

async function dialogByTitle(title: string) {
  const heading = await screen.findByRole('heading', { name: title });
  const dialog = heading.closest('[role="dialog"]');
  if (!dialog) throw new Error(`Dialog not found for ${title}`);
  return dialog as HTMLElement;
}

function firstEnabledButton(buttons: HTMLElement[]) {
  const button = buttons.find((item) => !(item as HTMLButtonElement).disabled);
  if (!button) throw new Error('Expected enabled button');
  return button;
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

function openProjectTasksTab() {
  openProjectDetailTab('Project Tasks');
}

function openProjectDetailTab(name: string) {
  act(() => {
    const tab = screen.getByRole('tab', { name });
    tab.focus();
    fireEvent.keyDown(tab, { key: 'Enter', code: 'Enter' });
  });
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

function commentFixture(overrides: Partial<TaskCommentSummary> = {}): TaskCommentSummary {
  return {
    id: 'comment-root',
    workspaceId: 'workspace-1',
    taskId: 'task-root',
    parentCommentId: null,
    body: 'Root comment',
    visibility: 'NORMAL',
    deleted: false,
    editedAt: null,
    deletedAt: null,
    createdAt: isoDate,
    updatedAt: isoDate,
    author: {
      membershipId: 'membership-a',
      userId: 'membership-a-user',
      name: 'Anya',
      email: 'anya@zeaplay.test',
    },
    mentions: [],
    directReplyCount: 0,
    reactionCounts: { LIKE: 0, LOVE: 0, CELEBRATE: 0, EYES: 0, CHECK: 0 },
    currentUserReactions: [],
    ...overrides,
  };
}

function tagFixture(overrides: Partial<WorkspaceTagSummary> = {}): WorkspaceTagSummary {
  return {
    id: 'tag-bug',
    workspaceId: 'workspace-1',
    name: 'Bug',
    color: '#DC2626',
    status: 'ACTIVE',
    createdAt: isoDate,
    updatedAt: isoDate,
    ...overrides,
  };
}

function mockDefaultTags() {
  getTaskTags.mockResolvedValue([]);
  listWorkspaceTags.mockResolvedValue({
    items: [tagFixture(), tagFixture({ id: 'tag-archived', name: 'Legacy', status: 'ARCHIVED' })],
    page: 1,
    pageSize: 10,
    total: 2,
  });
  createWorkspaceTag.mockResolvedValue(tagFixture({ id: 'tag-created', name: 'Created' }));
  updateWorkspaceTag.mockResolvedValue(tagFixture({ id: 'tag-bug', name: 'Bug Fixed' }));
  archiveWorkspaceTag.mockResolvedValue(tagFixture({ id: 'tag-bug', status: 'ARCHIVED' }));
  reactivateWorkspaceTag.mockResolvedValue(tagFixture({ id: 'tag-archived', status: 'ACTIVE' }));
  addTaskTags.mockResolvedValue({ requestedCount: 1, changedCount: 1, unchangedCount: 0 });
  removeTaskTags.mockResolvedValue({ requestedCount: 1, changedCount: 1, unchangedCount: 0 });
  listWorkspaceRoles.mockResolvedValue([
    {
      id: 'role-owner',
      key: 'OWNER',
      name: 'Owner',
      description: null,
      scope: 'WORKSPACE',
      isSystem: true,
      isActive: true,
      workspaceId: null,
      permissions: [
        {
          id: 'permission-tasks-update',
          key: 'tasks.update',
          description: null,
          createdAt: isoDate,
        },
        {
          id: 'permission-tasks-view',
          key: 'tasks.view',
          description: null,
          createdAt: isoDate,
        },
        {
          id: 'permission-projects-reports-view',
          key: 'projects.reports.view',
          description: null,
          createdAt: isoDate,
        },
        {
          id: 'permission-projects-create',
          key: 'projects.create',
          description: null,
          createdAt: isoDate,
        },
        {
          id: 'permission-projects-update',
          key: 'projects.update',
          description: null,
          createdAt: isoDate,
        },
        {
          id: 'permission-projects-delete',
          key: 'projects.delete',
          description: null,
          createdAt: isoDate,
        },
        {
          id: 'permission-projects-manage-status',
          key: 'projects.manage_status',
          description: null,
          createdAt: isoDate,
        },
        {
          id: 'permission-projects-manage-members',
          key: 'projects.manage_members',
          description: null,
          createdAt: isoDate,
        },
        {
          id: 'permission-projects-manage-owner',
          key: 'projects.manage_owner',
          description: null,
          createdAt: isoDate,
        },
        {
          id: 'permission-projects-manage-progress',
          key: 'projects.manage_progress',
          description: null,
          createdAt: isoDate,
        },
        {
          id: 'permission-project-files-view',
          key: 'projects.files.view',
          description: null,
          createdAt: isoDate,
        },
        {
          id: 'permission-project-files-add',
          key: 'projects.files.add',
          description: null,
          createdAt: isoDate,
        },
        {
          id: 'permission-project-files-remove',
          key: 'projects.files.remove',
          description: null,
          createdAt: isoDate,
        },
        {
          id: 'permission-project-files-download',
          key: 'projects.files.download',
          description: null,
          createdAt: isoDate,
        },
        {
          id: 'permission-project-activity-view',
          key: 'projects.activity.view',
          description: null,
          createdAt: isoDate,
        },
        { id: 'permission-tags-view', key: 'tags.view', description: null, createdAt: isoDate },
        { id: 'permission-tags-create', key: 'tags.create', description: null, createdAt: isoDate },
        { id: 'permission-tags-update', key: 'tags.update', description: null, createdAt: isoDate },
        {
          id: 'permission-tags-archive',
          key: 'tags.archive',
          description: null,
          createdAt: isoDate,
        },
        { id: 'permission-tags-assign', key: 'tags.assign', description: null, createdAt: isoDate },
        {
          id: 'permission-comments-internal',
          key: 'tasks.comments.internal',
          description: null,
          createdAt: isoDate,
        },
      ],
      createdAt: isoDate,
      updatedAt: isoDate,
    },
  ]);
}

function status(
  id: string,
  entityType: StatusEntityType,
  name: string,
  isDefault = true,
  isTerminal = false,
): WorkspaceStatusDefinition {
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

function taskFixture(overrides: Partial<WorkspaceTask> = {}): WorkspaceTask {
  return { ...taskFixtureBase(), ...overrides };
}

function projectFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'project-1',
    workspaceId: 'workspace-1',
    name: 'Launch',
    description: null,
    statusDefinitionId: 'status-project',
    status: { id: 'status-project', name: 'To Do', color: '#64748B', terminal: false },
    priority: 'MEDIUM',
    visibility: 'WORKSPACE',
    calculatedProgress: 0,
    manualProgressPercent: null,
    manualProgressUpdatedAt: null,
    effectiveProgress: 0,
    taskCounts: {
      totalTasks: 0,
      openTasks: 0,
      completedTasks: 0,
      overdueTasks: 0,
    },
    plannedStartAt: null,
    dueAt: null,
    departmentId: null,
    department: null,
    ownerMembershipId: 'membership-a',
    owner: {
      id: 'membership-a',
      status: 'ACTIVE',
      user: { id: 'user-a', email: 'anya@zeaplay.test', name: 'Anya' },
    },
    memberCount: 0,
    createdById: 'admin-1',
    createdAt: isoDate,
    updatedAt: isoDate,
    ...overrides,
  };
}

function taskFixtureBase(): WorkspaceTask {
  return {
    id: 'task-alpha',
    workspaceId: 'workspace-1',
    title: 'Alpha launch task',
    description: 'Launch checklist',
    priority: 'HIGH',
    kanbanRank: '1024',
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
    plannedStartAt: null,
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
