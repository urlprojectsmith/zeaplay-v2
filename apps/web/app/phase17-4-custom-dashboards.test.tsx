import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dashboardConfigs } from '../components/navigation/navigation-config';
import { dashboardKeys } from '../services/custom-dashboards';

const root = join(__dirname, '..');

describe('Phase 17.4 Custom Dashboards UI foundation', () => {
  it('adds scoped Custom Dashboard routes without replacing analytics or reports routes', () => {
    expect(read('app/workspace/dashboards/page.tsx')).toContain('scope="WORKSPACE"');
    expect(read('app/agency/dashboards/page.tsx')).toContain('scope="AGENCY"');
    expect(read('app/super-agency/dashboards/page.tsx')).toContain('scope="SUPER_AGENCY"');
    expect(read('app/super-admin/dashboards/page.tsx')).toContain('scope="PLATFORM"');
    expect(read('app/workspace/analytics/page.tsx')).toContain('scope="WORKSPACE"');
    expect(read('app/workspace/reports/page.tsx')).toContain('scope="WORKSPACE"');
  });

  it('enables Custom Dashboard navigation with dashboard permissions', () => {
    expect(dashboardConfigs.workspace.groups[1]?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: '/workspace/dashboards',
          requiredPermissions: ['dashboards.view'],
        }),
      ]),
    );
    expect(dashboardConfigs.agency.groups[1]?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: '/agency/dashboards',
          requiredPermissions: ['dashboards.view'],
        }),
      ]),
    );
    expect(dashboardConfigs['super-agency'].groups[0]?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: '/super-agency/dashboards',
          requiredPermissions: ['dashboards.view'],
        }),
      ]),
    );
    expect(dashboardConfigs['super-admin'].groups[0]?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: '/super-admin/dashboards',
          requiredPermissions: ['dashboards.platform.read'],
        }),
      ]),
    );
  });

  it('uses explicit scope type and scope id in dashboard query keys', () => {
    expect(dashboardKeys.list('WORKSPACE', 'same-id')).not.toEqual(
      dashboardKeys.list('SUPER_AGENCY', 'same-id'),
    );
    expect(dashboardKeys.render('AGENCY', 'same-id', 'dashboard-a')).not.toEqual(
      dashboardKeys.render('PLATFORM', 'same-id', 'dashboard-a'),
    );
  });

  it('keeps forbidden widget surfaces out of the builder source', () => {
    const source = read('components/custom-dashboards/CustomDashboardsPage.tsx');
    expect(source).not.toContain('HTML_WIDGET');
    expect(source).not.toContain('IFRAME');
    expect(source).not.toContain('CUSTOM_FORMULA');
    expect(source).toContain('DndContext');
  });
});

function read(path: string) {
  return readFileSync(join(root, path), 'utf8');
}
