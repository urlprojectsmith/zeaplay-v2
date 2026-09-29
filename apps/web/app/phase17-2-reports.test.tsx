import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dashboardConfigs } from '../components/navigation/navigation-config';
import { reportKeys } from '../services/reports';

const root = join(__dirname, '..');

describe('Phase 17.2 Reports UI foundation', () => {
  it('adds scoped Reports routes without replacing analytics routes', () => {
    expect(read('app/workspace/reports/page.tsx')).toContain('scope="WORKSPACE"');
    expect(read('app/agency/reports/page.tsx')).toContain('scope="AGENCY"');
    expect(read('app/super-agency/reports/page.tsx')).toContain('scope="SUPER_AGENCY"');
    expect(read('app/super-admin/reports/page.tsx')).toContain('scope="PLATFORM"');
  });

  it('enables Reports navigation with report permissions', () => {
    expect(dashboardConfigs.workspace.groups[1]?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: '/workspace/reports',
          requiredPermissions: ['reports.view'],
        }),
      ]),
    );
    expect(dashboardConfigs.agency.groups[1]?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ href: '/agency/reports', requiredPermissions: ['reports.view'] }),
      ]),
    );
    expect(dashboardConfigs['super-agency'].groups[0]?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: '/super-agency/reports',
          requiredPermissions: ['reports.view'],
        }),
      ]),
    );
    expect(dashboardConfigs['super-admin'].groups[0]?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: '/super-admin/reports',
          requiredPermissions: ['reports.platform.read'],
        }),
      ]),
    );
  });

  it('uses explicit scope type and scope id in report query keys', () => {
    expect(reportKeys.list('WORKSPACE', 'same-id')).not.toEqual(
      reportKeys.list('SUPER_AGENCY', 'same-id'),
    );
  });
});

function read(path: string) {
  return readFileSync(join(root, path), 'utf8');
}
