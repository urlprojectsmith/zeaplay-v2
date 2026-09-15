import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../contexts/theme-provider';
import { WorkspaceDepartmentsPage } from '../components/workspace/WorkspaceDepartmentsPage';
import { WorkspaceUsersPage } from '../components/workspace/WorkspaceUsersPage';
import { useSessionStore } from '../stores/session';

const listWorkspaceUsers = vi.fn();
const listDepartments = vi.fn();
const createDepartment = vi.fn();
const updateDepartment = vi.fn();
const updateWorkspaceUser = vi.fn();

vi.mock('../services/workspace-management', () => ({
  listWorkspaceUsers: (...args: unknown[]) => listWorkspaceUsers(...args),
  listDepartments: (...args: unknown[]) => listDepartments(...args),
  createDepartment: (...args: unknown[]) => createDepartment(...args),
  updateDepartment: (...args: unknown[]) => updateDepartment(...args),
  updateWorkspaceUser: (...args: unknown[]) => updateWorkspaceUser(...args),
}));

const userPage = {
  items: [
    {
      id: 'user-1',
      membershipId: 'membership-1',
      workspaceId: 'workspace-1',
      email: 'member@zeaplay.test',
      name: 'Member One',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
      role: { id: 'role-1', key: 'MEMBER', name: 'Member' },
      department: null,
      joinedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    },
  ],
  page: 1,
  pageSize: 10,
  total: 1,
};

const emptyPage = { items: [], page: 1, pageSize: 10, total: 0 };

describe('phase 6.1 workspace pages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({
      selectedAgencyId: 'agency-1',
      selectedWorkspaceId: 'workspace-1',
      hydrated: true,
      accessToken: 'token',
      user: { id: 'admin-1', email: 'admin@zeaplay.test' },
    });
  });

  it('shows users loading and then empty state', async () => {
    listWorkspaceUsers.mockResolvedValue(emptyPage);
    listDepartments.mockResolvedValue(emptyPage);
    render(<WorkspaceUsersPage />);
    expect(screen.getAllByText('', { selector: '.animate-pulse' }).length).toBeGreaterThan(0);
    expect(await screen.findByText('No users')).toBeInTheDocument();
  });

  it('shows user API errors and uses the selected workspace in requests', async () => {
    listWorkspaceUsers.mockRejectedValue(new Error('Denied'));
    listDepartments.mockResolvedValue(emptyPage);
    render(<WorkspaceUsersPage />);
    expect(await screen.findByText('Could not load users')).toBeInTheDocument();
    expect(listWorkspaceUsers).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'workspace-1' }),
    );
  });

  it('validates department create form with React Hook Form and Zod', async () => {
    listDepartments.mockResolvedValue(emptyPage);
    listWorkspaceUsers.mockResolvedValue(userPage);
    render(<WorkspaceDepartmentsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /new department/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('Name is required.')).toBeInTheDocument();
    expect(createDepartment).not.toHaveBeenCalled();
  });

  it('creates a department using selected tenant context and renders in colorful theme', async () => {
    listDepartments.mockResolvedValue(emptyPage);
    listWorkspaceUsers.mockResolvedValue(userPage);
    createDepartment.mockResolvedValue({
      id: 'department-1',
      workspaceId: 'workspace-1',
      name: 'Design',
      description: null,
      status: 'ACTIVE',
      manager: null,
      memberCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    render(
      <ThemeProvider>
        <WorkspaceDepartmentsPage />
      </ThemeProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /new department/i }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Design' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(createDepartment).toHaveBeenCalledWith(
        'workspace-1',
        expect.objectContaining({ name: 'Design' }),
      ),
    );
    expect(await screen.findByText('Design')).toBeInTheDocument();
  });
});
