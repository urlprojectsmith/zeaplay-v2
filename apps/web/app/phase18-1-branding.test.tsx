import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dashboardConfigs } from '../components/navigation/navigation-config';
import { brandingKeys } from '../services/branding';

const root = join(__dirname, '..');

describe('Phase 18.1 Branding UI foundation', () => {
  it('adds scoped Branding settings routes for all certified environments', () => {
    expect(read('app/workspace/branding/page.tsx')).toContain('scope="WORKSPACE"');
    expect(read('app/agency/branding/page.tsx')).toContain('scope="AGENCY"');
    expect(read('app/super-agency/branding/page.tsx')).toContain('scope="SUPER_AGENCY"');
    expect(read('app/super-admin/branding/page.tsx')).toContain('scope="PLATFORM"');
  });

  it('gates Branding navigation by tenant and platform branding permissions', () => {
    expect(dashboardConfigs.workspace.groups[1]?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: '/workspace/branding',
          requiredPermissions: ['branding.manage'],
        }),
      ]),
    );
    expect(dashboardConfigs.agency.groups[1]?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: '/agency/branding',
          requiredPermissions: ['branding.manage'],
        }),
      ]),
    );
    expect(dashboardConfigs['super-agency'].groups[0]?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: '/super-agency/branding',
          requiredPermissions: ['branding.manage'],
        }),
      ]),
    );
    expect(dashboardConfigs['super-admin'].groups[0]?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: '/super-admin/branding',
          requiredPermissions: ['branding.platform.manage'],
        }),
      ]),
    );
  });

  it('uses explicit scope type and scope id in Branding query keys', () => {
    expect(brandingKeys.config('WORKSPACE', 'same-id')).not.toEqual(
      brandingKeys.config('SUPER_AGENCY', 'same-id'),
    );
    expect(brandingKeys.effective('AGENCY', 'same-id')).not.toEqual(
      brandingKeys.effective('PLATFORM', 'same-id'),
    );
  });

  it('keeps Branding UI bounded to registry fields and safe asset references', () => {
    const panel = read('components/branding/BrandingSettingsPanel.tsx');
    const provider = read('components/branding/BrandProvider.tsx');

    expect(panel).toContain('expectedRevision');
    expect(panel).toContain('agencyAllowedOverrides');
    expect(panel).toContain('workspaceAllowedOverrides');
    expect(panel).toContain('Reset All');
    expect(panel).toContain('assetId');
    expect(panel).toContain('workspaceId');
    expect(panel).not.toContain('CUSTOM_CSS');
    expect(panel).not.toContain('CUSTOM_HTML');
    expect(panel).not.toContain('CUSTOM_JS');
    expect(panel).not.toContain('dangerouslySetInnerHTML');
    expect(provider).not.toContain('dangerouslySetInnerHTML');
  });
});

function read(path: string) {
  return readFileSync(join(root, path), 'utf8');
}
