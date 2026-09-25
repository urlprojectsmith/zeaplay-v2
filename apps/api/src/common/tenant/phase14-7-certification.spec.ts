import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Phase 14.7 hierarchy certification guards', () => {
  const repoRoot = join(__dirname, '..', '..', '..', '..', '..');
  const schema = read('apps/api/prisma/schema.prisma');
  const seed = read('apps/api/prisma/seed.ts');
  const parentOversightController = read(
    'apps/api/src/modules/parent-oversight/parent-oversight.controller.ts',
  );
  const tenantContext = read('apps/api/src/common/tenant/tenant-context.service.ts');
  const migrationHarness = read('scripts/phase14-6-13-migration-compatibility.mjs');

  it('keeps the canonical hierarchy in schema without duplicating parent columns on operational models', () => {
    expect(modelBlock('SuperAgency')).toContain('@@map("super_agencies")');
    expect(modelBlock('Agency')).toContain(
      'superAgencyId String       @map("super_agency_id") @db.Uuid',
    );
    expect(modelBlock('Workspace')).toContain(
      'agencyId          String          @map("agency_id") @db.Uuid',
    );
    expect(modelBlock('Workspace')).not.toContain('superAgencyId');

    for (const modelName of [
      'Task',
      'Project',
      'Ticket',
      'Asset',
      'AutomationWorkflow',
      'Notification',
      'CalendarEvent',
      'ApiKey',
      'WebhookSubscription',
      'IntegrationConnection',
      'CloudDriveConnection',
    ]) {
      const block = modelBlock(modelName);
      expect(block).toContain('workspaceId');
      expect(block).not.toContain('superAgencyId');
    }
  });

  it('does not use Organization or first membership selection as tenant authority', () => {
    expect(modelBlock('Agency')).not.toContain('organizationId');
    expect(modelBlock('Workspace')).not.toContain('organizationId');
    expect(tenantContext).not.toMatch(/organizationId|OrganizationMembership/);
    expect(tenantContext).not.toMatch(/memberships\s*\[\s*0\s*\]/);
    expect(tenantContext).not.toMatch(/superAgencies\s*\[\s*0\s*\]/);
    expect(tenantContext).toContain('userId_superAgencyId');
    expect(tenantContext).toContain('userId_agencyId');
    expect(tenantContext).toContain('userId_workspaceId');
  });

  it('keeps Agency parent administration out of child operational capabilities', () => {
    const agencyPermissions = constArray('agencyPermissions');
    expect(agencyPermissions).toEqual(
      expect.arrayContaining([
        'agency.read',
        'agency.update',
        'workspace.read',
        'workspace.create',
        'workspace.update',
        'tasks.parent.read',
        'projects.parent.read',
        'tickets.parent.read',
      ]),
    );

    for (const forbiddenPrefix of [
      'tasks.',
      'projects.',
      'tickets.',
      'storage.',
      'api_keys.',
      'webhooks.',
      'inbound_webhooks.',
      'integrations.',
      'automation.',
      'notifications.',
      'calendar.',
      'gamification.',
    ]) {
      const allowedParentRead = [
        'tasks.parent.read',
        'projects.parent.read',
        'tickets.parent.read',
        'gamification.global_leaderboard.view_agency',
      ];
      const forbiddenPermissions = agencyPermissions.filter(
        (permission) =>
          permission.startsWith(forbiddenPrefix) && !allowedParentRead.includes(permission),
      );
      expect(forbiddenPermissions).toEqual([]);
    }
  });

  it('keeps parent oversight controllers read-only and metadata-only by construction', () => {
    expect(parentOversightController.match(/@Get\(/g)).toHaveLength(6);
    expect(parentOversightController).not.toMatch(/@(Post|Put|Patch|Delete)\(/);
    expect(parentOversightController).toContain('AgencyTenantGuard');
    expect(parentOversightController).toContain('SuperAgencyTenantGuard');
  });

  it('requires direct WorkspaceMembership in credential, file, notification, calendar, and automation services', () => {
    for (const sourceFile of [
      'apps/api/src/modules/public-api/api-keys.service.ts',
      'apps/api/src/modules/webhooks/webhooks.service.ts',
      'apps/api/src/modules/inbound-webhooks/inbound-webhooks.service.ts',
      'apps/api/src/modules/integrations/integrations.service.ts',
      'apps/api/src/modules/cloud-drives/cloud-drives.service.ts',
      'apps/api/src/modules/assets/assets.service.ts',
      'apps/api/src/modules/automation/automation.service.ts',
      'apps/api/src/modules/notifications/notifications.service.ts',
      'apps/api/src/modules/calendar/calendar.service.ts',
      'apps/api/src/modules/projects/projects.service.ts',
      'apps/api/src/modules/tasks/tasks.service.ts',
      'apps/api/src/modules/tickets/tickets.service.ts',
    ]) {
      const source = read(sourceFile);
      expect(source).toMatch(/workspaceMembershipId/);
      expect(source).toMatch(
        /ForbiddenException|BadRequestException|WORKSPACE_MEMBERSHIP_REQUIRED|return \{ membershipId: null/,
      );
    }
  });

  it('keeps migration compatibility harness constrained to phase scratch databases', () => {
    expect(migrationHarness).toContain("['zea_play', 'zea_play_test', 'random_db', 'postgres']");
    expect(migrationHarness).toContain('Refusing to operate on non-phase scratch database name');
    expect(migrationHarness).toContain('allowedLocalHosts');
    expect(migrationHarness).toContain('zea_play_phase14613');
  });

  function read(relativePath: string) {
    return readFileSync(join(repoRoot, relativePath), 'utf8');
  }

  function modelBlock(modelName: string) {
    const match = schema.match(new RegExp(`model ${modelName} \\{[\\s\\S]*?\\n\\}`));
    if (!match) throw new Error(`Missing model ${modelName}`);
    return match[0];
  }

  function constArray(name: string) {
    const match = seed.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
    if (!match) throw new Error(`Missing const array ${name}`);
    const arrayBody = match[1] ?? '';
    return Array.from(arrayBody.matchAll(/'([^']+)'/g), (item) => item[1] ?? '');
  }
});
