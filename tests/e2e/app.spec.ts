import { expect, type Page, test } from '@playwright/test';

const apiHeaders = {
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers':
    'authorization,content-type,x-correlation-id,x-csrf-token,x-agency-id,x-workspace-id',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,OPTIONS',
  'access-control-allow-origin': 'http://127.0.0.1:3000',
};

async function fulfillApi(
  route: Parameters<Page['route']>[1] extends (route: infer R) => unknown ? R : never,
  data: unknown,
  status = 200,
) {
  const request = route.request();
  await route.fulfill({
    status: request.method() === 'OPTIONS' ? 204 : status,
    contentType: 'application/json',
    headers: apiHeaders,
    body: request.method() === 'OPTIONS' ? '' : JSON.stringify({ data }),
  });
}

async function mockAuthenticatedSession(page: Page) {
  await page.context().addCookies([
    {
      name: 'zea_csrf',
      value: 'csrf-token',
      url: 'http://127.0.0.1:3000',
      httpOnly: false,
      sameSite: 'Lax',
    },
  ]);
  await page.addInitScript(() => {
    document.cookie = 'zea_csrf=csrf-token; path=/';
  });
  await page.route(/.*\/auth\/refresh$/, async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      headers: apiHeaders,
      body: JSON.stringify({ data: { accessToken: 'access-token', csrfToken: 'csrf-token' } }),
    });
  });
  await page.route(/.*\/auth\/me$/, async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      headers: apiHeaders,
      body: JSON.stringify({
        data: {
          id: 'user-1',
          email: 'owner@zeaplay.test',
          name: 'Owner',
          agencies: [
            {
              id: 'agency-1',
              name: 'Agency One',
              slug: 'agency-one',
              status: 'active',
              role: 'owner',
              membershipId: 'membership-1',
              workspaces: [
                {
                  id: 'workspace-1',
                  agencyId: 'agency-1',
                  name: 'Workspace One',
                  slug: 'workspace-one',
                  status: 'active',
                  role: 'admin',
                  membershipId: 'workspace-membership-1',
                },
              ],
            },
            {
              id: 'agency-2',
              name: 'Agency Two',
              slug: 'agency-two',
              status: 'active',
              role: 'admin',
              membershipId: 'membership-2',
              workspaces: [
                {
                  id: 'workspace-2',
                  agencyId: 'agency-2',
                  name: 'Workspace Two',
                  slug: 'workspace-two',
                  status: 'active',
                  role: 'member',
                  membershipId: 'workspace-membership-2',
                },
              ],
            },
          ],
        },
      }),
    });
  });
}

async function mockRoleManagementApi(page: Page) {
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
  ];

  await page.route(/.*\/workspaces\/workspace-1\/permissions$/, async (route) => {
    await fulfillApi(route, permissions);
  });
  await page.route(/.*\/workspaces\/workspace-1\/roles$/, async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { name: string; description?: string };
      roles.push({
        id: 'role-qa-lead',
        key: 'workspace:workspace-1:qa-lead',
        name: body.name,
        description: body.description ?? null,
        scope: 'WORKSPACE',
        isSystem: false,
        isActive: true,
        workspaceId: 'workspace-1',
        permissions: [],
        createdAt: '',
        updatedAt: '',
      });
      await fulfillApi(route, roles.at(-1));
      return;
    }
    await fulfillApi(route, roles);
  });
  await page.route(/.*\/workspaces\/workspace-1\/roles\/([^/]+)$/, async (route) => {
    const roleId = new URL(route.request().url()).pathname.split('/').at(-1);
    await fulfillApi(route, roles.find((role) => role.id === roleId) ?? roles[0]);
  });
  await page.route(/.*\/workspaces\/workspace-1\/roles\/([^/]+)\/clone$/, async (route) => {
    const role = roles.find((item) => item.id === 'role-qa-lead') ?? roles[1];
    const clone = { ...role, id: 'role-qa-lead-copy', name: `${role.name} Copy` };
    roles.push(clone);
    await fulfillApi(route, clone);
  });
  await page.route(/.*\/workspaces\/workspace-1\/roles\/([^/]+)\/permissions$/, async (route) => {
    const roleId = new URL(route.request().url()).pathname.split('/').at(-2);
    const body = route.request().postDataJSON() as { permissionIds: string[] };
    const role = roles.find((item) => item.id === roleId) ?? roles[1];
    role.permissions = permissions.filter((permission) =>
      body.permissionIds.includes(permission.id),
    );
    await fulfillApi(route, role);
  });
  await page.route(/.*\/workspaces\/workspace-1\/users.*/, async (route) => {
    await fulfillApi(route, {
      items: [
        {
          id: 'user-2',
          membershipId: 'workspace-membership-2',
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
    });
  });
  await page.route(/.*\/workspaces\/workspace-1\/departments.*/, async (route) => {
    await fulfillApi(route, { items: [], page: 1, pageSize: 10, total: 0 });
  });
}

async function mockStatusManagementApi(page: Page) {
  type EntityType = 'TASK' | 'PROJECT' | 'TICKET';
  type StatusDefinition = {
    id: string;
    workspaceId: string;
    entityType: EntityType;
    name: string;
    description: string | null;
    color: string;
    position: number;
    category: string;
    isDefault: boolean;
    isTerminal: boolean;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
  };

  const now = new Date().toISOString();
  const makeStatus = (
    id: string,
    entityType: EntityType,
    name: string,
    position: number,
    overrides: Partial<StatusDefinition> = {},
  ): StatusDefinition => ({
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
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });

  const statuses: Record<EntityType, StatusDefinition[]> = {
    TASK: [
      makeStatus('task-todo', 'TASK', 'To Do', 1, { isDefault: true }),
      makeStatus('task-progress', 'TASK', 'In Progress', 2, {
        color: '#2563EB',
        category: 'IN_PROGRESS',
      }),
    ],
    PROJECT: [
      makeStatus('project-lead', 'PROJECT', 'Lead', 1, {
        isDefault: true,
        category: 'BACKLOG',
      }),
      makeStatus('project-review', 'PROJECT', 'Client Review', 2, { category: 'REVIEW' }),
    ],
    TICKET: [
      makeStatus('ticket-new', 'TICKET', 'New', 1, { isDefault: true }),
      makeStatus('ticket-closed', 'TICKET', 'Closed', 2, {
        isTerminal: true,
        category: 'COMPLETED',
      }),
    ],
  };

  await page.route(/.*\/workspaces\/workspace-1\/statuses.*/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const parts = url.pathname.split('/').filter(Boolean);
    const entityType = parts[parts.indexOf('statuses') + 1] as EntityType | undefined;
    const statusId = parts[parts.indexOf('statuses') + 2];
    const action = parts[parts.indexOf('statuses') + 3];

    if (request.method() === 'POST' && entityType === 'initialize-defaults') {
      await fulfillApi(route, Object.values(statuses).flat());
      return;
    }

    if (!entityType || !statuses[entityType]) {
      await fulfillApi(route, []);
      return;
    }

    if (request.method() === 'GET') {
      await fulfillApi(
        route,
        statuses[entityType].sort((a, b) => a.position - b.position),
      );
      return;
    }

    if (request.method() === 'POST' && !statusId) {
      const body = request.postDataJSON() as Partial<StatusDefinition>;
      const created = makeStatus(
        `${entityType.toLowerCase()}-${Date.now()}`,
        entityType,
        body.name ?? 'Custom',
        statuses[entityType].length + 1,
        {
          description: body.description ?? null,
          color: body.color ?? '#64748B',
          category: body.category ?? 'TODO',
          isTerminal: Boolean(body.isTerminal),
        },
      );
      statuses[entityType].push(created);
      await fulfillApi(route, created, 201);
      return;
    }

    if (request.method() === 'PATCH' && statusId === 'reorder') {
      const body = request.postDataJSON() as { orderedStatusIds: string[] };
      statuses[entityType] = body.orderedStatusIds.map((id, index) => ({
        ...statuses[entityType].find((status) => status.id === id)!,
        position: index + 1,
      }));
      await fulfillApi(route, statuses[entityType]);
      return;
    }

    const existing = statuses[entityType].find((status) => status.id === statusId);
    if (!existing) {
      await fulfillApi(route, { message: 'Not found' }, 404);
      return;
    }

    if (request.method() === 'POST' && action === 'set-default') {
      statuses[entityType] = statuses[entityType].map((status) => ({
        ...status,
        isDefault: status.id === statusId,
      }));
      await fulfillApi(
        route,
        statuses[entityType].find((status) => status.id === statusId),
      );
      return;
    }

    if (request.method() === 'PATCH') {
      const body = request.postDataJSON() as Partial<StatusDefinition>;
      Object.assign(existing, body, { updatedAt: now });
      await fulfillApi(route, existing);
    }
  });
}

async function mockTaskCreationApi(page: Page, options: { extraTasks?: number } = {}) {
  const now = '2026-09-16T00:00:00.000Z';
  const users = [
    {
      id: 'user-anya',
      membershipId: 'membership-anya',
      workspaceId: 'workspace-1',
      email: 'anya@zeaplay.test',
      name: 'Anya',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
      role: { id: 'role-member', key: 'MEMBER', name: 'Member' },
      department: null,
      joinedAt: now,
      createdAt: now,
    },
  ];
  const taskStatus = {
    id: 'status-task-todo',
    workspaceId: 'workspace-1',
    entityType: 'TASK',
    name: 'To Do',
    description: null,
    color: '#64748B',
    position: 1,
    category: 'TODO',
    isDefault: true,
    isTerminal: false,
    isActive: true,
    isSystem: true,
    createdAt: now,
    updatedAt: now,
  };
  const completedTaskStatus = {
    ...taskStatus,
    id: 'status-task-completed',
    name: 'Completed',
    position: 2,
    category: 'DONE',
    isDefault: false,
    isTerminal: true,
  };
  const taskStatuses = [taskStatus, completedTaskStatus];
  const tasks: Array<Record<string, unknown>> = [
    {
      id: 'task-seed-alpha',
      workspaceId: 'workspace-1',
      title: 'Seed alpha task',
      description: null,
      priority: 'MEDIUM',
      status: taskStatus,
      department: null,
      dueAt: '2026-09-30T00:00:00.000Z',
      assignees: [],
      followers: [],
      projects: [],
      counts: { assignees: 0, followers: 0, projects: 0 },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'task-seed-beta',
      workspaceId: 'workspace-1',
      title: 'Seed beta task',
      description: null,
      priority: 'LOW',
      status: taskStatus,
      department: null,
      dueAt: '2026-10-01T00:00:00.000Z',
      assignees: [],
      followers: [],
      projects: [],
      counts: { assignees: 0, followers: 0, projects: 0 },
      createdAt: now,
      updatedAt: now,
    },
  ];
  for (let index = 1; index <= (options.extraTasks ?? 0); index += 1) {
    tasks.push({
      id: `task-extra-${index}`,
      workspaceId: 'workspace-1',
      title: `Extra task ${index}`,
      description: null,
      priority: 'MEDIUM',
      status: taskStatus,
      department: null,
      dueAt: '2026-10-15T00:00:00.000Z',
      assignees: [],
      followers: [],
      projects: [],
      counts: { assignees: 0, followers: 0, projects: 0 },
      createdAt: now,
      updatedAt: now,
    });
  }

  await page.route(/.*\/workspaces\/workspace-1\/users(\?.*)?$/, async (route) => {
    await fulfillApi(route, { items: users, page: 1, pageSize: 10, total: users.length });
  });
  await page.route(/.*\/workspaces\/workspace-2\/users(\?.*)?$/, async (route) => {
    await fulfillApi(route, { items: [], page: 1, pageSize: 10, total: 0 });
  });
  await page.route(/.*\/workspaces\/workspace-1\/departments(\?.*)?$/, async (route) => {
    await fulfillApi(route, { items: [], page: 1, pageSize: 100, total: 0 });
  });
  await page.route(/.*\/workspaces\/workspace-2\/departments(\?.*)?$/, async (route) => {
    await fulfillApi(route, { items: [], page: 1, pageSize: 100, total: 0 });
  });
  await page.route(/.*\/workspaces\/workspace-1\/statuses\/TASK(\?.*)?$/, async (route) => {
    await fulfillApi(route, taskStatuses);
  });
  await page.route(/.*\/workspaces\/workspace-2\/statuses\/TASK(\?.*)?$/, async (route) => {
    await fulfillApi(route, [{ ...taskStatus, workspaceId: 'workspace-2' }]);
  });
  await page.route(/.*\/projects(\?.*)?$/, async (route) => {
    await fulfillApi(route, { items: [], page: 1, pageSize: 10, total: 0 });
  });
  await page.route(/.*\/workspaces\/workspace-1\/tasks\/bulk\/priority$/, async (route) => {
    const body = route.request().postDataJSON() as { taskIds: string[]; priority: string };
    if (body.priority === 'URGENT') {
      await fulfillApi(route, { message: 'One or more selected tasks are unavailable.' }, 404);
      return;
    }
    let changedCount = 0;
    for (const task of tasks) {
      if (!body.taskIds.includes(String(task.id))) continue;
      if (task.priority !== body.priority) {
        task.priority = body.priority;
        task.updatedAt = now;
        changedCount += 1;
      }
    }
    await fulfillApi(route, {
      requestedCount: body.taskIds.length,
      changedCount,
      unchangedCount: body.taskIds.length - changedCount,
    });
  });
  await page.route(/.*\/workspaces\/workspace-1\/tasks\/bulk\/status$/, async (route) => {
    const body = route.request().postDataJSON() as {
      taskIds: string[];
      statusDefinitionId: string;
    };
    let changedCount = 0;
    const nextStatus =
      taskStatuses.find((status) => status.id === body.statusDefinitionId) ?? taskStatus;
    for (const task of tasks) {
      if (!body.taskIds.includes(String(task.id))) continue;
      if ((task.status as { id?: string }).id !== body.statusDefinitionId) {
        task.status = nextStatus;
        task.updatedAt = now;
        changedCount += 1;
      }
    }
    await fulfillApi(route, {
      requestedCount: body.taskIds.length,
      changedCount,
      unchangedCount: body.taskIds.length - changedCount,
    });
  });
  await page.route(/.*\/workspaces\/workspace-1\/tasks\/bulk\/assignees\/add$/, async (route) => {
    const body = route.request().postDataJSON() as { taskIds: string[]; membershipIds: string[] };
    let relationChangedCount = 0;
    for (const task of tasks) {
      if (!body.taskIds.includes(String(task.id))) continue;
      const assignees = task.assignees as Array<{ id: string; user: unknown }>;
      for (const membershipId of body.membershipIds) {
        if (assignees.some((assignee) => assignee.id === membershipId)) continue;
        const user = users.find((item) => item.membershipId === membershipId);
        if (!user) continue;
        assignees.push({
          id: user.membershipId,
          user: { id: user.id, email: user.email, name: user.name },
        });
        relationChangedCount += 1;
      }
      task.counts = { ...(task.counts as Record<string, number>), assignees: assignees.length };
      task.updatedAt = now;
    }
    const requestedRelations = body.taskIds.length * body.membershipIds.length;
    await fulfillApi(route, {
      requestedCount: body.taskIds.length,
      changedCount: relationChangedCount > 0 ? body.taskIds.length : 0,
      unchangedCount: relationChangedCount > 0 ? 0 : body.taskIds.length,
      relationChangedCount,
      relationUnchangedCount: requestedRelations - relationChangedCount,
    });
  });
  await page.route(
    /.*\/workspaces\/workspace-1\/tasks\/bulk\/assignees\/remove$/,
    async (route) => {
      const body = route.request().postDataJSON() as {
        taskIds: string[];
        membershipIds: string[];
      };
      let relationChangedCount = 0;
      for (const task of tasks) {
        if (!body.taskIds.includes(String(task.id))) continue;
        const assignees = task.assignees as Array<{ id: string; user: unknown }>;
        const before = assignees.length;
        task.assignees = assignees.filter((assignee) => !body.membershipIds.includes(assignee.id));
        relationChangedCount += before - (task.assignees as unknown[]).length;
        task.counts = {
          ...(task.counts as Record<string, number>),
          assignees: (task.assignees as unknown[]).length,
        };
        task.updatedAt = now;
      }
      const requestedRelations = body.taskIds.length * body.membershipIds.length;
      await fulfillApi(route, {
        requestedCount: body.taskIds.length,
        changedCount: relationChangedCount > 0 ? body.taskIds.length : 0,
        unchangedCount: relationChangedCount > 0 ? 0 : body.taskIds.length,
        relationChangedCount,
        relationUnchangedCount: requestedRelations - relationChangedCount,
      });
    },
  );
  await page.route(/.*\/workspaces\/workspace-1\/tasks\/bulk$/, async (route) => {
    const body = route.request().postDataJSON() as { taskIds: string[] };
    const before = tasks.length;
    for (let index = tasks.length - 1; index >= 0; index -= 1) {
      if (body.taskIds.includes(String(tasks[index].id))) tasks.splice(index, 1);
    }
    const changedCount = before - tasks.length;
    await fulfillApi(route, {
      requestedCount: body.taskIds.length,
      changedCount,
      unchangedCount: body.taskIds.length - changedCount,
    });
  });
  await page.route(/.*\/workspaces\/workspace-1\/tasks\/(?!bulk$)[^/]+$/, async (route) => {
    const taskId = route.request().url().split('/').pop();
    const task = tasks.find((item) => item.id === taskId);
    if (!task) {
      await fulfillApi(route, { message: 'Not found' }, 404);
      return;
    }
    await fulfillApi(route, {
      ...task,
      createdBy: { id: 'admin-1', email: 'admin@zeaplay.test', name: 'Admin' },
      updatedBy: { id: 'admin-1', email: 'admin@zeaplay.test', name: 'Admin' },
    });
  });
  await page.route(/.*\/workspaces\/workspace-1\/tasks(\?.*)?$/, async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as {
        title: string;
        dueAt: string;
        assigneeMembershipIds: string[];
      };
      const task = {
        id: 'task-e2e',
        workspaceId: 'workspace-1',
        title: body.title,
        description: null,
        priority: 'MEDIUM',
        status: taskStatus,
        department: null,
        dueAt: body.dueAt,
        assignees: users
          .filter((user) => body.assigneeMembershipIds.includes(user.membershipId))
          .map((user) => ({
            id: user.membershipId,
            user: { id: user.id, email: user.email, name: user.name },
          })),
        followers: [],
        projects: [],
        counts: { assignees: body.assigneeMembershipIds.length, followers: 0, projects: 0 },
        createdAt: now,
        updatedAt: now,
      };
      tasks.unshift(task);
      await fulfillApi(route, task);
      return;
    }
    const url = new URL(route.request().url());
    const search = url.searchParams.get('search')?.toLowerCase() ?? '';
    const statusDefinitionId = url.searchParams.get('statusDefinitionId');
    const pageNumber = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? 20);
    const filtered = tasks.filter((task) => {
      if (search && !String(task.title).toLowerCase().includes(search)) return false;
      if (
        statusDefinitionId &&
        (task.status as { id?: string } | undefined)?.id !== statusDefinitionId
      ) {
        return false;
      }
      return true;
    });
    await fulfillApi(route, {
      items: filtered.slice((pageNumber - 1) * pageSize, pageNumber * pageSize),
      page: pageNumber,
      pageSize,
      total: filtered.length,
    });
  });
  await page.route(/.*\/workspaces\/workspace-2\/tasks(\?.*)?$/, async (route) => {
    await fulfillApi(route, { items: [], page: 1, pageSize: 25, total: 0 });
  });
}

test('application boots and login route loads', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('dashboard route requires authentication', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login$/);
});

test('protected dashboard routes redirect unauthenticated users', async ({ page }) => {
  for (const path of [
    '/developer/dashboard',
    '/super-admin/dashboard',
    '/agency/dashboard',
    '/workspace/dashboard',
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
  }
});

test('authenticated workspace shell supports tenant, theme, language, and mobile navigation', async ({
  page,
}) => {
  await mockAuthenticatedSession(page);
  await page.goto('/workspace/dashboard');
  await expect(page.getByRole('heading', { name: 'Workspace Dashboard' })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByText('Agency One').first()).toBeVisible();

  const agencySelector = page.getByText('Agency One').first();
  await agencySelector.click();
  await page.getByRole('option', { name: 'Agency Two' }).click();
  await expect(page.getByText('Workspace Two').first()).toBeVisible();

  await page.getByRole('button', { name: 'Colorful' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'colorful');

  await page.getByRole('button', { name: 'தமிழ்' }).click();
  await expect(page.getByText('டாஷ்போர்டு அடித்தளம் தயார்')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /வழிசெலுத்தலை திற|open navigation/i }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('authenticated role management supports custom roles and permission assignment UI', async ({
  page,
}) => {
  await mockAuthenticatedSession(page);
  await mockRoleManagementApi(page);

  await page.goto('/workspace/roles');
  await expect(page.getByRole('heading', { name: 'Roles & Permissions' })).toBeVisible();
  await page.getByRole('button', { name: /create role/i }).click();
  await page.getByLabel('Role name').fill('QA Lead');
  await page.getByLabel('Description').fill('Owns release quality');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('QA Lead').first()).toBeVisible();

  await page
    .getByRole('button', { name: /QA Lead/ })
    .first()
    .click();
  await page.getByLabel('Manage workspace users').click();
  await expect(page.getByRole('button', { name: /save permissions/i })).toBeEnabled();
  await page.getByRole('button', { name: /save permissions/i }).click();

  await page.getByRole('button', { name: /clone/i }).last().click();
  await page.getByRole('button', { name: 'Clone' }).click();
  await expect(page.getByText('QA Lead Copy').first()).toBeVisible();

  await page.goto('/workspace/users');
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
  await expect(page.getByText('Member One').first()).toBeVisible();
  await page.getByRole('combobox', { name: 'Role' }).nth(1).click();
  await expect(page.getByRole('option', { name: 'QA Lead', exact: true })).toBeVisible();
});

test('authenticated status management supports workspace status lifecycle UI', async ({ page }) => {
  await mockAuthenticatedSession(page);
  await mockStatusManagementApi(page);

  await page.goto('/workspace/statuses');
  await expect(page.getByRole('heading', { name: 'Status Management' })).toBeVisible();
  await expect(page.getByText('To Do').first()).toBeVisible();

  await page.getByRole('tab', { name: 'Project Pipeline' }).click();
  await expect(page.getByText('Client Review').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Ticket Statuses' }).click();
  await expect(page.getByText('Closed').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Task Statuses' }).click();

  await page.getByRole('button', { name: /create task status/i }).click();
  await page.getByLabel('Name').fill('Blocked');
  await page.getByLabel('Description').fill('Waiting on a dependency');
  await page.getByRole('textbox', { name: 'Color' }).fill('#DC2626');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('Blocked').first()).toBeVisible();

  await page.getByRole('button', { name: 'Actions: In Progress' }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  await page.getByLabel('Name').fill('Doing');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Doing').first()).toBeVisible();

  await page.getByRole('button', { name: 'Actions: Doing' }).click();
  await page.getByRole('menuitem', { name: 'Set as Default' }).click();
  await expect(page.getByText('Current Default:')).toBeVisible();
  await page.getByRole('button', { name: 'Set as Default' }).click();
  await expect(
    page.locator('.p-0').filter({ hasText: 'Doing' }).getByText('Default'),
  ).toBeVisible();

  const doingCard = page.locator('.p-0').filter({ hasText: 'Doing' }).first();
  await doingCard.getByRole('button', { name: /move up/i }).click();
  await page.reload();
  await expect(page.getByText('Doing').first()).toBeVisible();
  await expect(page.getByText('To Do').first()).toBeVisible();
  const doingBox = await page.getByText('Doing').first().boundingBox();
  const todoBox = await page.getByText('To Do').first().boundingBox();
  expect(doingBox?.y ?? 0).toBeLessThan(todoBox?.y ?? Number.MAX_SAFE_INTEGER);
});

test('authenticated task creation supports the quick-create flow', async ({ page }) => {
  await mockAuthenticatedSession(page);
  await mockTaskCreationApi(page);

  await page.goto('/workspace/tasks');
  await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create Task' }).click();
  await expect(page.getByLabel('Title *')).toBeVisible();
  await expect(page.getByLabel('Assignee *')).toBeVisible();
  await expect(page.getByLabel('Due Date *')).toBeVisible();
  await expect(page.getByLabel('Description')).toBeHidden();

  await page.getByLabel('Title *').fill('E2E quick task');
  await page.getByRole('button', { name: /Anya/ }).click();
  await page.getByLabel('Due Date *').fill('2026-09-30');
  await page.getByRole('button', { name: 'Create Task' }).click();

  await expect(page.getByText('Task created')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'All Tasks' })).toBeVisible();
  await expect(page.getByText('E2E quick task').first()).toBeVisible();

  await page.goto('/workspace/tasks?search=quick');
  await expect(page).toHaveURL(/search=quick/);
  await expect(page.getByText('E2E quick task').first()).toBeVisible();

  await page.goto('/workspace/tasks?search=quick&status=status-task-todo');
  await expect(page).toHaveURL(/status=status-task-todo/);
  await expect(page.getByText('E2E quick task').first()).toBeVisible();

  await page.getByRole('button', { name: 'Grid' }).click();
  await expect(page).toHaveURL(/view=grid/);
  await expect(page.getByText('E2E quick task').first()).toBeVisible();
  await page.getByRole('button', { name: /Open task details: E2E quick task/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Task details');
  await expect(page.getByRole('dialog')).toContainText('Anya');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();

  await page.getByRole('button', { name: 'Compact' }).click();
  await expect(page).toHaveURL(/view=compact/);
  await expect(page.getByText('E2E quick task').first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Compact' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByText('E2E quick task').first()).toBeVisible();

  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const view of ['List', 'Grid', 'Compact']) {
      await page.getByRole('button', { name: view }).click();
      await expect(page.getByText('E2E quick task').first()).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
    }
  }

  await page.getByText('Agency One').first().click();
  await page.getByRole('option', { name: 'Agency Two' }).click();
  await expect(page.getByText('Workspace Two').first()).toBeVisible();
  await expect(page.getByText('E2E quick task')).toBeHidden();
  await expect(page.getByText('No matching tasks')).toBeVisible();
});

test('authenticated task browser supports current-page bulk actions', async ({ page }) => {
  await mockAuthenticatedSession(page);
  await mockTaskCreationApi(page);

  let statusRequests = 0;
  let priorityRequests = 0;
  let addAssigneeRequests = 0;
  let removeAssigneeRequests = 0;
  let deleteRequests = 0;
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/workspaces/workspace-1/tasks/bulk/status')) statusRequests += 1;
    if (url.includes('/workspaces/workspace-1/tasks/bulk/priority')) priorityRequests += 1;
    if (url.includes('/workspaces/workspace-1/tasks/bulk/assignees/add')) {
      addAssigneeRequests += 1;
    }
    if (url.includes('/workspaces/workspace-1/tasks/bulk/assignees/remove')) {
      removeAssigneeRequests += 1;
    }
    if (url.match(/\/workspaces\/workspace-1\/tasks\/bulk$/)) deleteRequests += 1;
  });

  await page.goto('/workspace/tasks');
  await expect(page.getByText('Seed alpha task').first()).toBeVisible();
  await page.getByLabel('Select all on this page').click();
  await expect(page.getByText('2 tasks selected').first()).toBeVisible();
  await page.getByRole('button', { name: 'Grid' }).click();
  await expect(page.getByText('2 tasks selected').first()).toBeVisible();
  await page.getByRole('button', { name: 'Compact' }).click();
  await expect(page.getByText('2 tasks selected').first()).toBeVisible();

  await page.getByRole('button', { name: 'Change priority' }).click();
  await page.getByRole('button', { name: 'Update 2 tasks' }).click();
  await expect(page.getByText('2 tasks selected')).toHaveCount(0);
  expect(priorityRequests).toBe(1);
  await expect(page.getByText('Medium').first()).toBeVisible();

  await page.getByLabel('Select task: Seed alpha task').click();
  await page.getByRole('button', { name: 'Change status' }).click();
  await page.getByRole('combobox', { name: 'Status' }).click();
  await page
    .getByRole('option', { name: 'To Do' })
    .evaluate((element) => (element as HTMLElement).click());
  await page.getByRole('button', { name: 'Update 1 tasks' }).click();
  await expect(page.getByText('1 task selected')).toHaveCount(0);
  expect(statusRequests).toBe(1);

  await page.getByLabel('Select task: Seed alpha task').click();
  await page.getByRole('button', { name: 'Add assignees' }).click();
  await page.getByLabel('Anya').click();
  await page.getByRole('button', { name: 'Add to 1 tasks' }).click();
  await expect(page.getByText('1 task selected')).toHaveCount(0);
  expect(addAssigneeRequests).toBe(1);
  await expect(page.getByText('Anya').first()).toBeVisible();

  await page.getByLabel('Select task: Seed alpha task').click();
  await page.getByRole('button', { name: 'Remove assignees' }).click();
  await page.getByLabel('Anya').click();
  await page.getByRole('button', { name: 'Remove from 1 tasks' }).click();
  await expect(page.getByText('1 task selected')).toHaveCount(0);
  expect(removeAssigneeRequests).toBe(1);

  await expect(page.getByText('Select all on this page')).toBeVisible();
  await page.getByLabel('Select all on this page').click();
  await expect(page.getByText('2 tasks selected').first()).toBeVisible();
  await page.getByRole('button', { name: 'Delete tasks' }).click();
  await expect(page.getByText('Delete 2 selected tasks?')).toBeVisible();
  await page.getByRole('button', { name: 'Delete 2 tasks' }).click();
  await expect(page.getByText('Seed alpha task')).toHaveCount(0);
  await expect(page.getByText('Seed beta task')).toHaveCount(0);
  expect(deleteRequests).toBe(1);
});

test('authenticated task browser clears bulk selection on workspace change', async ({ page }) => {
  await mockAuthenticatedSession(page);
  await mockTaskCreationApi(page);

  await page.goto('/workspace/tasks');
  await expect(page.getByText('Seed alpha task').first()).toBeVisible();
  await page.getByLabel('Select task: Seed alpha task').first().click();
  await expect(page.getByText('1 task selected').first()).toBeVisible();

  await page.getByText('Agency One').first().click();
  await page.getByRole('option', { name: 'Agency Two' }).click();

  await expect(page.getByText('Workspace Two').first()).toBeVisible();
  await expect(page.getByText('1 task selected')).toHaveCount(0);
});

test('authenticated task browser handles stale, terminal, detail, pagination, and mobile bulk states', async ({
  page,
}) => {
  await mockAuthenticatedSession(page);
  await mockTaskCreationApi(page, { extraTasks: 9 });

  await page.goto('/workspace/tasks');
  await expect(page.getByText('Seed alpha task').first()).toBeVisible();

  await page.getByLabel('Select task: Seed alpha task').first().click();
  await page.getByRole('button', { name: 'Change priority' }).click();
  await page.getByRole('combobox', { name: 'Priority' }).click();
  await page
    .getByRole('option', { name: 'Urgent' })
    .evaluate((element) => (element as HTMLElement).click());
  await page.getByRole('button', { name: 'Update 1 tasks' }).click();
  await expect(
    page.getByText('One or more selected tasks are no longer available. Refresh and try again.'),
  ).toBeVisible();
  await expect(page.getByText('1 task selected').first()).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  await page.getByRole('button', { name: 'Change status' }).click();
  await page.getByRole('combobox', { name: 'Status' }).click();
  await page
    .getByRole('option', { name: 'Completed' })
    .evaluate((element) => (element as HTMLElement).click());
  await page.getByRole('button', { name: 'Update 1 tasks' }).click();
  await expect(page.getByText('1 task selected')).toHaveCount(0);
  const alphaRow = page.getByRole('row', { name: /Seed alpha task/ });
  await expect(alphaRow.getByText('Completed')).toBeVisible();
  await expect(alphaRow.getByText('Upcoming')).toHaveCount(0);

  await page.getByRole('button', { name: 'Seed alpha task' }).click();
  await expect(page.getByRole('dialog')).toContainText('Completed');
  await expect(page.getByRole('dialog')).not.toContainText('Upcoming');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();

  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto('/workspace/tasks?page=2&pageSize=10');
  await expect(page.locator('button:visible', { hasText: 'Extra task 9' }).first()).toBeVisible();
  await page.getByLabel('Select all on this page').click();
  await expect(page.getByText('1 task selected').first()).toBeVisible();
  await page.getByRole('button', { name: 'Delete tasks' }).click();
  await page.getByRole('button', { name: 'Delete 1 tasks' }).click();
  await expect(page.getByText('1 task selected')).toHaveCount(0);
  await expect.poll(() => page.url()).not.toContain('page=2');
  await expect(page.getByText('Extra task 9')).toHaveCount(0);

  await page.setViewportSize({ width: 375, height: 900 });
  await page.locator('[aria-label="Select task: Seed alpha task"]:visible').click();
  await page.getByRole('button', { name: 'Bulk actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete tasks' }).click();
  await expect(page.getByText('Delete 1 selected tasks?')).toBeVisible();
  await page.getByRole('button', { name: 'Delete 1 tasks' }).click();
  await expect(page.getByText('Seed alpha task')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('workspace roles page remains responsive across supported widths', async ({ page }) => {
  await mockAuthenticatedSession(page);
  await mockRoleManagementApi(page);

  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/workspace/roles');
    await expect(page.getByRole('heading', { name: 'Roles & Permissions' })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  }
});
