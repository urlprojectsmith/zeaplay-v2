import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dashboardConfigs } from '../components/navigation/navigation-config';
import { messages } from '../lib/i18n';
import { analyticsKeys } from '../services/analytics';

const root = join(__dirname, '..');

describe('Phase 17.1 Analytics UI foundation', () => {
  it('adds Workspace, Agency, Super Agency, and Platform Analytics routes', () => {
    expect(read('app/workspace/analytics/page.tsx')).toContain('scope="WORKSPACE"');
    expect(read('app/agency/analytics/page.tsx')).toContain('scope="AGENCY"');
    expect(read('app/super-agency/analytics/page.tsx')).toContain('scope="SUPER_AGENCY"');
    expect(read('app/super-admin/analytics/page.tsx')).toContain('scope="PLATFORM"');
  });

  it('enables Analytics navigation with scope-specific permissions', () => {
    expect(messages.en.navigation.analytics).toBe('Analytics');
    expect(messages.ta.navigation.analytics).toBeTruthy();
    expect(dashboardConfigs.workspace.groups[1]?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: '/workspace/analytics',
          requiredPermissions: ['analytics.view'],
        }),
      ]),
    );
    expect(dashboardConfigs.agency.groups[0]?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: '/agency/analytics',
          requiredPermissions: ['analytics.parent.read'],
        }),
      ]),
    );
    expect(dashboardConfigs['super-agency'].groups[0]?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: '/super-agency/analytics',
          requiredPermissions: ['analytics.parent.read'],
        }),
      ]),
    );
    expect(dashboardConfigs['super-admin'].groups[0]?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: '/super-admin/analytics',
          requiredPermissions: ['analytics.platform.read'],
        }),
      ]),
    );
  });

  it('uses scope type and id in frontend query keys', () => {
    expect(
      analyticsKeys.summary('WORKSPACE', 'same-id', { datePreset: 'LAST_30_DAYS' }),
    ).not.toEqual(analyticsKeys.summary('SUPER_AGENCY', 'same-id', { datePreset: 'LAST_30_DAYS' }));
  });

  it('keeps billing analytics out of Workspace and Agency metric requests', () => {
    const page = read('components/analytics/AnalyticsPage.tsx');
    expect(page).toContain('commercialMetrics');
    expect(page).toContain("scope === 'WORKSPACE' || scope === 'AGENCY'");
    expect(page).toContain('billing.active_subscriptions');
  });
});

function read(path: string) {
  return readFileSync(join(root, path), 'utf8');
}
