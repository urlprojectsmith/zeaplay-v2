import { expect, type Page, test } from '@playwright/test';

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
      headers: {
        'access-control-allow-credentials': 'true',
        'access-control-allow-headers': 'content-type,x-correlation-id,x-csrf-token',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-origin': 'http://127.0.0.1:3000',
      },
      body: JSON.stringify({ data: { accessToken: 'access-token', csrfToken: 'csrf-token' } }),
    });
  });
  await page.route(/.*\/auth\/me$/, async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      headers: {
        'access-control-allow-credentials': 'true',
        'access-control-allow-headers':
          'authorization,content-type,x-correlation-id,x-agency-id,x-workspace-id',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-origin': 'http://127.0.0.1:3000',
      },
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
