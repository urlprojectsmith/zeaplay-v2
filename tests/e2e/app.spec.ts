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
