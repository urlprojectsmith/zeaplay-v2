import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dashboardConfigs } from '../components/navigation/navigation-config';
import { messages } from '../lib/i18n';
import { parentGoalKeys, workspaceGoalKeys } from '../services/workspace-goals';

const root = join(__dirname, '..');

describe('Phase 16.3 Goals workspace and parent UI gate', () => {
  it('adds Workspace, Agency, and Super Agency Goals routes', () => {
    expect(read('app/workspace/goals/page.tsx')).toContain('WorkspaceGoalsPage');
    expect(read('app/agency/goals/page.tsx')).toContain('AgencyGoalsOversightPage');
    expect(read('app/super-agency/goals/page.tsx')).toContain('SuperAgencyGoalsOversightPage');
  });

  it('enables Goals navigation with workspace and parent permissions', () => {
    expect(messages.en.navigation.goals).toBe('Goals');
    expect(messages.ta.navigation.goals).toBe('இலக்குகள்');
    expect(dashboardConfigs.workspace.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          items: expect.arrayContaining([
            expect.objectContaining({
              href: '/workspace/goals',
              requiredPermissions: ['goals.view'],
            }),
          ]),
        }),
      ]),
    );
    expect(dashboardConfigs.agency.groups[0]?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: '/agency/goals',
          requiredPermissions: ['goals.parent.read'],
        }),
      ]),
    );
    expect(dashboardConfigs['super-agency'].groups[0]?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: '/super-agency/goals',
          requiredPermissions: ['goals.parent.read'],
        }),
      ]),
    );
  });

  it('uses typed goal service keys and workspace API endpoints', () => {
    expect(workspaceGoalKeys.all('workspace-1')).toEqual(['workspace', 'workspace-1', 'goals']);
    expect(parentGoalKeys.agency('agency-1', { page: 1 })).toContain('goals');
    const service = read('services/workspace-goals.ts');
    expect(service).toContain('/workspaces/${workspaceId}/goals');
    expect(service).toContain('/manual-progress');
    expect(service).toContain('/reconcile');
    expect(service).toContain('/agencies/${agencyId}/parent/goals');
    expect(service).toContain('/super-agencies/${superAgencyId}/parent/goals');
  });

  it('ships an operational workspace Goals page with creation, reconciliation, and manual progress', () => {
    const page = read('components/workspace/goals/WorkspaceGoalsPage.tsx');
    expect(page).toContain('Create goal');
    expect(page).toContain('Goal metric type');
    expect(page).toContain('Manual progress delta');
    expect(page).toContain('Reconcile');
    expect(page).toContain('Archive');
  });

  it('ships parent Goals oversight as aggregate-only metadata', () => {
    const page = read('components/workspace/goals/ParentGoalsOversightPage.tsx');
    expect(read('services/workspace-goals.ts')).toContain('AGGREGATED_WORKSPACE_ONLY');
    expect(page).toContain('ParentGoalAggregate');
    expect(page).not.toContain('manualNote');
    expect(page).not.toContain('ownerMembershipId');
  });
});

function read(path: string) {
  return readFileSync(join(root, path), 'utf8');
}
