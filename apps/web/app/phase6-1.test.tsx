import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider, useLanguage } from '../contexts/language-provider';
import { ThemeProvider } from '../contexts/theme-provider';
import { WorkspaceDepartmentsPage } from '../components/workspace/WorkspaceDepartmentsPage';
import { WorkspaceRolesPage } from '../components/workspace/WorkspaceRolesPage';
import { WorkspaceUsersPage } from '../components/workspace/WorkspaceUsersPage';
import { useSessionStore } from '../stores/session';

const listWorkspaceUsers = vi.fn();
const listDepartments = vi.fn();
const createDepartment = vi.fn();
const updateDepartment = vi.fn();
const updateWorkspaceUser = vi.fn();
const listWorkspaceRoles = vi.fn();
const getWorkspaceRole = vi.fn();
const createWorkspaceRole = vi.fn();
const updateWorkspaceRole = vi.fn();
const cloneWorkspaceRole = vi.fn();
const replaceWorkspaceRolePermissions = vi.fn();
const listWorkspacePermissions = vi.fn();

vi.mock('../services/workspace-management', () => ({
  listWorkspaceUsers: (...args: unknown[]) => listWorkspaceUsers(...args),
  listDepartments: (...args: unknown[]) => listDepartments(...args),
  createDepartment: (...args: unknown[]) => createDepartment(...args),
  updateDepartment: (...args: unknown[]) => updateDepartment(...args),
  updateWorkspaceUser: (...args: unknown[]) => updateWorkspaceUser(...args),
}));

vi.mock('../services/workspace-roles', () => ({
  rolesKeys: {
    all: (workspaceId: string | null) => ['workspace', workspaceId, 'roles'],
    detail: (workspaceId: string | null, roleId: string | null) => [
      'workspace',
      workspaceId,
      'roles',
      roleId,
    ],
  },
  permissionsKeys: {
    catalog: (workspaceId: string | null) => ['workspace', workspaceId, 'permissions'],
  },
  listWorkspaceRoles: (...args: unknown[]) => listWorkspaceRoles(...args),
  getWorkspaceRole: (...args: unknown[]) => getWorkspaceRole(...args),
  createWorkspaceRole: (...args: unknown[]) => createWorkspaceRole(...args),
  updateWorkspaceRole: (...args: unknown[]) => updateWorkspaceRole(...args),
  cloneWorkspaceRole: (...args: unknown[]) => cloneWorkspaceRole(...args),
  replaceWorkspaceRolePermissions: (...args: unknown[]) => replaceWorkspaceRolePermissions(...args),
  listWorkspacePermissions: (...args: unknown[]) => listWorkspacePermissions(...args),
}));

const permissions = [
  { id: 'permission-users-view', key: 'users.view', description: null, createdAt: '' },
  { id: 'permission-users-manage', key: 'users.manage', description: null, createdAt: '' },
  {
    id: 'permission-roles-manage',
    key: 'roles.manage_permissions',
    description: null,
    createdAt: '',
  },
];

const roles = [
  {
    id: 'role-owner',
    key: 'OWNER',
    name: 'Owner',
    description: null,
    scope: 'WORKSPACE',
    isSystem: true,
    isActive: true,
    workspaceId: null,
    permissions,
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'role-member',
    key: 'MEMBER',
    name: 'Member',
    description: null,
    scope: 'WORKSPACE',
    isSystem: true,
    isActive: true,
    workspaceId: null,
    permissions: [permissions[0]],
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'role-custom',
    key: 'workspace:workspace-1:custom',
    name: 'QA Lead',
    description: 'Owns quality',
    scope: 'WORKSPACE',
    isSystem: false,
    isActive: true,
    workspaceId: 'workspace-1',
    permissions: [permissions[0]],
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'role-inactive',
    key: 'workspace:workspace-1:inactive',
    name: 'Inactive Lead',
    description: null,
    scope: 'WORKSPACE',
    isSystem: false,
    isActive: false,
    workspaceId: 'workspace-1',
    permissions: [],
    createdAt: '',
    updatedAt: '',
  },
] as const;

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
      role: { id: 'role-member', key: 'MEMBER', name: 'Member' },
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

describe('phase 6.1 and 6.2B workspace pages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useSessionStore.setState({
      selectedAgencyId: 'agency-1',
      selectedWorkspaceId: 'workspace-1',
      hydrated: true,
      accessToken: 'token',
      user: { id: 'admin-1', email: 'admin@zeaplay.test' },
    });
    listWorkspaceUsers.mockResolvedValue(emptyPage);
    listDepartments.mockResolvedValue(emptyPage);
    listWorkspaceRoles.mockResolvedValue(roles);
    getWorkspaceRole.mockImplementation((_workspaceId, roleId) =>
      Promise.resolve(roles.find((role) => role.id === roleId) ?? roles[0]),
    );
    listWorkspacePermissions.mockResolvedValue(permissions);
    createWorkspaceRole.mockResolvedValue(roles[2]);
    updateWorkspaceRole.mockImplementation((_workspaceId, roleId, body) =>
      Promise.resolve({ ...roles.find((role) => role.id === roleId), ...body }),
    );
    cloneWorkspaceRole.mockResolvedValue({ ...roles[2], id: 'role-clone', name: 'QA Lead Copy' });
    replaceWorkspaceRolePermissions.mockResolvedValue({
      ...roles[2],
      permissions: [permissions[0], permissions[1]],
    });
  });

  it('shows users loading and then empty state', async () => {
    renderWithLanguage(<WorkspaceUsersPage />);
    expect(screen.getAllByText('', { selector: '.animate-pulse' }).length).toBeGreaterThan(0);
    expect(await screen.findByText('No users')).toBeInTheDocument();
  });

  it('shows user API errors and uses the selected workspace in requests', async () => {
    listWorkspaceUsers.mockRejectedValue(new Error('Denied'));
    renderWithLanguage(<WorkspaceUsersPage />);
    expect(await screen.findByText('Could not load users')).toBeInTheDocument();
    expect(listWorkspaceUsers).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'workspace-1' }),
    );
  });

  it('shows active custom roles in the user role selector and excludes inactive roles', async () => {
    listWorkspaceUsers.mockResolvedValue(userPage);
    renderWithLanguage(<WorkspaceUsersPage />);
    expect((await screen.findAllByText('Member One')).length).toBeGreaterThan(0);
    const roleTriggers = screen.getAllByRole('combobox');
    fireEvent.keyDown(roleTriggers[roleTriggers.length - 2]!, { key: 'ArrowDown' });
    expect(await screen.findByRole('option', { name: 'QA Lead' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Inactive Lead' })).not.toBeInTheDocument();
  });

  it('clears selected user detail when switching workspaces', async () => {
    listWorkspaceUsers.mockImplementation(({ workspaceId }: { workspaceId: string }) =>
      Promise.resolve(
        workspaceId === 'workspace-1'
          ? userPage
          : {
              items: [
                {
                  ...userPage.items[0],
                  id: 'user-3',
                  email: 'secondary@zeaplay.test',
                  name: 'Secondary Member',
                  workspaceId: 'workspace-2',
                },
              ],
              page: 1,
              pageSize: 10,
              total: 1,
            },
      ),
    );

    renderWithLanguage(<WorkspaceUsersPage />);
    fireEvent.click((await screen.findAllByText('Member One'))[0]!);
    expect(screen.getAllByText('Member One').length).toBeGreaterThan(1);

    act(() => {
      useSessionStore.setState({ selectedWorkspaceId: 'workspace-2' });
    });

    expect((await screen.findAllByText('Secondary Member')).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.queryByText('Member One')).not.toBeInTheDocument());
  });

  it('validates department create form with React Hook Form and Zod', async () => {
    listWorkspaceUsers.mockResolvedValue(userPage);
    renderWithLanguage(<WorkspaceDepartmentsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /new department/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('Name is required.')).toBeInTheDocument();
    expect(createDepartment).not.toHaveBeenCalled();
  });

  it('creates a department using selected tenant context and renders in colorful theme', async () => {
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
        <LanguageProvider>
          <QueryHarness>
            <WorkspaceDepartmentsPage />
          </QueryHarness>
        </LanguageProvider>
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

  it('renders role list with system/custom display and grouped permissions', async () => {
    renderWithLanguage(<WorkspaceRolesPage />);
    expect(await screen.findByRole('heading', { name: 'Roles & Permissions' })).toBeInTheDocument();
    expect(await screen.findByText('QA Lead')).toBeInTheDocument();
    expect(screen.getAllByText('System').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Custom').length).toBeGreaterThan(0);
    expect(screen.getByText('Users')).toBeInTheDocument();
  });

  it('validates create role form and surfaces duplicate-name API errors', async () => {
    createWorkspaceRole.mockRejectedValueOnce(
      new Error('Role name already exists in this workspace.'),
    );
    renderWithLanguage(<WorkspaceRolesPage />);
    fireEvent.click(await screen.findByRole('button', { name: /create role/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('Role name is required.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Role name'), { target: { value: 'QA Lead' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(createWorkspaceRole).toHaveBeenCalled());
  });

  it('clones roles and edits custom role permissions with module select-all state', async () => {
    renderWithLanguage(<WorkspaceRolesPage />);
    await screen.findByText('QA Lead');
    const cloneButtons = screen.getAllByRole('button', { name: /clone/i });
    expect(cloneButtons.length).toBeGreaterThan(2);
    fireEvent.click(cloneButtons[2]!);
    fireEvent.click(await screen.findByRole('button', { name: 'Clone' }));
    await waitFor(() =>
      expect(cloneWorkspaceRole).toHaveBeenCalledWith('workspace-1', 'role-custom'),
    );

    fireEvent.click(screen.getByText('QA Lead'));
    fireEvent.click(await screen.findByLabelText('Manage workspace users'));
    expect(screen.getByRole('button', { name: /save permissions/i })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /save permissions/i }));
    await waitFor(() =>
      expect(replaceWorkspaceRolePermissions).toHaveBeenCalledWith(
        'workspace-1',
        'role-custom',
        expect.arrayContaining(['permission-users-view', 'permission-users-manage']),
      ),
    );
  });

  it('retains dirty permission state when permission save is rejected', async () => {
    replaceWorkspaceRolePermissions.mockRejectedValueOnce(new Error('Delegation denied'));
    renderWithLanguage(<WorkspaceRolesPage />);
    await screen.findByText('QA Lead');
    fireEvent.click(screen.getByText('QA Lead'));
    fireEvent.click(await screen.findByLabelText('Manage workspace users'));
    const saveButton = screen.getByRole('button', { name: /save permissions/i });
    fireEvent.click(saveButton);
    await waitFor(() => expect(replaceWorkspaceRolePermissions).toHaveBeenCalled());
    expect(saveButton).not.toBeDisabled();
  });

  it('confirms before discarding dirty permission changes when switching roles', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderWithLanguage(<WorkspaceRolesPage />);
    await screen.findByText('QA Lead');
    fireEvent.click(screen.getByText('QA Lead'));
    expect(await screen.findByLabelText('QA Lead Permission matrix')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Manage workspace users'));
    fireEvent.click(screen.getAllByText('Member')[0]!);
    expect(confirmSpy).toHaveBeenCalled();
    expect(screen.getByLabelText('QA Lead Permission matrix')).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it('keeps OWNER permissions read-only and clears stale detail on workspace switch', async () => {
    renderWithLanguage(<WorkspaceRolesPage />);
    expect(
      await screen.findByText(
        'Full Workspace Access. OWNER permissions are read-only and protected.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('View workspace users')).toBeDisabled();
    act(() => {
      useSessionStore.setState({ selectedWorkspaceId: 'workspace-2' });
    });
    await waitFor(() => expect(listWorkspaceRoles).toHaveBeenCalledWith('workspace-2'));
  });

  it('renders Phase 6.2B role labels through Tamil', async () => {
    render(
      <LanguageProvider>
        <TamilSwitch />
        <QueryHarness>
          <WorkspaceRolesPage />
        </QueryHarness>
      </LanguageProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'ta' }));
    expect(await screen.findByText('பாத்திரங்கள் & அனுமதிகள்')).toBeInTheDocument();
  });
});

function renderWithLanguage(ui: React.ReactElement) {
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
