import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dashboardConfigs } from '../components/navigation/navigation-config';
import { messages } from '../lib/i18n';
import { parentFormKeys, workspaceFormKeys } from '../services/workspace-forms';

const root = join(__dirname, '..');

describe('Phase 16.2 Forms UI main gate', () => {
  it('declares Workspace, parent, and public Forms routes', () => {
    expect(read('app/workspace/forms/page.tsx')).toContain('WorkspaceFormsPage');
    expect(read('app/agency/forms/page.tsx')).toContain('AgencyFormsOversightPage');
    expect(read('app/super-agency/forms/page.tsx')).toContain('SuperAgencyFormsOversightPage');
    expect(read('app/(public)/forms/[publicId]/page.tsx')).toContain('robots');
    expect(read('app/(public)/forms/[publicId]/page.tsx')).toContain('index: false');
  });

  it('enables Forms navigation with workspace and parent permissions', () => {
    expect(messages.en.navigation.forms).toBe('Forms');
    expect(dashboardConfigs.workspace.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          items: expect.arrayContaining([
            expect.objectContaining({
              href: '/workspace/forms',
              requiredPermissions: ['forms.view'],
            }),
          ]),
        }),
      ]),
    );
    expect(dashboardConfigs.agency.groups[0]?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: '/agency/forms',
          requiredPermissions: ['forms.parent.read'],
        }),
      ]),
    );
    expect(dashboardConfigs['super-agency'].groups[0]?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: '/super-agency/forms',
          requiredPermissions: ['forms.parent.read'],
        }),
      ]),
    );
  });

  it('keeps Forms query keys isolated by tenant scope', () => {
    expect(workspaceFormKeys.list('workspace-a', { search: 'a' })).not.toEqual(
      workspaceFormKeys.list('workspace-b', { search: 'a' }),
    );
    expect(parentFormKeys.agency('agency-a', { search: 'x' })).not.toEqual(
      parentFormKeys.agency('agency-b', { search: 'x' }),
    );
    expect(parentFormKeys.agency('tenant', { search: 'x' })).not.toEqual(
      parentFormKeys.superAgency('tenant', { search: 'x' }),
    );
  });

  it('ships builder, renderer, submissions, templates, and public components', () => {
    const workspace = read('components/workspace/forms/WorkspaceFormsPage.tsx');
    const publicForm = read('components/workspace/forms/PublicFormPage.tsx');
    expect(workspace).toContain('Field Palette');
    expect(workspace).toContain('Submissions');
    expect(workspace).toContain('Templates');
    expect(workspace).toContain('submitWorkspaceForm');
    expect(publicForm).toContain('submitPublicForm');
    expect(publicForm).toContain('authorizePublicFormUpload');
    expect(publicForm).toContain('completePublicFormUpload');
    expect(publicForm).toContain('PublicSignatureInput');
    expect(publicForm).toContain('publicBranding.uploadSignature');
    expect(publicForm).toContain('uploadToken');
    expect(read('components/workspace/forms/ParentFormsOversightPage.tsx')).toContain(
      'Forms metadata',
    );
  });
});

function read(path: string) {
  return readFileSync(join(root, path), 'utf8');
}
