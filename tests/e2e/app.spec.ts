import { expect, test } from '@playwright/test';

test('application boots and login route loads', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('dashboard route requires authentication', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login$/);
});

test('dashboard route foundations are present', async ({ page }) => {
  for (const path of [
    '/developer/dashboard',
    '/super-admin/dashboard',
    '/agency/dashboard',
    '/workspace/dashboard',
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading')).toBeVisible();
  }
});
