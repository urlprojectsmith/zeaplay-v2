import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dashboardConfigs } from '../components/navigation/navigation-config';
import {
  customDomainKeys,
  customDomainMatchesContext,
  type CustomDomainHostResolution,
} from '../services/custom-domains';

const root = join(__dirname, '..');

describe('Phase 18.2 Custom Domains UI foundation', () => {
  it('adds tenant-scoped Custom Domain settings routes and no platform custom-domain route', () => {
    expect(read('app/workspace/custom-domains/page.tsx')).toContain('scope="WORKSPACE"');
    expect(read('app/agency/custom-domains/page.tsx')).toContain('scope="AGENCY"');
    expect(read('app/super-agency/custom-domains/page.tsx')).toContain('scope="SUPER_AGENCY"');
    expect(() => read('app/super-admin/custom-domains/page.tsx')).toThrow();
  });

  it('gates Custom Domain navigation by tenant permission only', () => {
    expect(dashboardConfigs.workspace.groups[1]?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: '/workspace/custom-domains',
          requiredPermissions: ['custom_domains.manage'],
        }),
      ]),
    );
    expect(dashboardConfigs.agency.groups[1]?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: '/agency/custom-domains',
          requiredPermissions: ['custom_domains.manage'],
        }),
      ]),
    );
    expect(dashboardConfigs['super-agency'].groups[0]?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: '/super-agency/custom-domains',
          requiredPermissions: ['custom_domains.manage'],
        }),
      ]),
    );
    expect(JSON.stringify(dashboardConfigs['super-admin'])).not.toContain('custom-domains');
  });

  it('uses explicit scope type and scope id in Custom Domain query keys', () => {
    expect(customDomainKeys.list('WORKSPACE', 'same-id')).not.toEqual(
      customDomainKeys.list('SUPER_AGENCY', 'same-id'),
    );
  });

  it('prevents custom-domain tenant switches from matching unrelated tenant contexts', () => {
    const resolution = {
      domainId: 'domain-1',
      scopeType: 'WORKSPACE',
      scopeId: 'workspace-a',
      status: 'ACTIVE',
    } satisfies CustomDomainHostResolution;

    expect(
      customDomainMatchesContext(resolution, {
        selectedSuperAgencyId: null,
        selectedAgencyId: 'agency-a',
        selectedWorkspaceId: 'workspace-a',
      }),
    ).toBe(true);
    expect(
      customDomainMatchesContext(resolution, {
        selectedSuperAgencyId: null,
        selectedAgencyId: 'agency-b',
        selectedWorkspaceId: 'workspace-b',
      }),
    ).toBe(false);
  });

  it('keeps UI bounded to DNS instructions and safe actions', () => {
    const panel = read('components/custom-domains/CustomDomainSettingsPanel.tsx');

    expect(panel).toContain('TXT Record');
    expect(panel).toContain('Record Value');
    expect(panel).toContain('Verify Domain');
    expect(panel).toContain('Generate New Verification Record');
    expect(panel).toContain('Remove Domain');
    expect(panel).not.toContain('dangerouslySetInnerHTML');
    expect(panel).not.toContain('branded login');
    expect(panel).not.toContain('email branding');
    expect(read('stores/session.ts')).toContain('resolveDomainBoundSwitchRedirect');
  });
});

function read(path: string) {
  return readFileSync(join(root, path), 'utf8');
}
