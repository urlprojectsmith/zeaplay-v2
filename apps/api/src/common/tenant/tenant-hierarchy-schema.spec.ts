import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Phase 14.6.2 hierarchy schema contract', () => {
  const repoRoot = join(__dirname, '..', '..', '..', '..', '..');
  const schema = readFileSync(join(repoRoot, 'apps/api/prisma/schema.prisma'), 'utf8');
  const migration = readFileSync(
    join(
      repoRoot,
      'apps/api/prisma/migrations/0074_phase14_6_2_super_agency_hierarchy/migration.sql',
    ),
    'utf8',
  );

  it('adds canonical Super Agency without repurposing Organization', () => {
    const agencyModel = modelBlock('Agency');

    expect(schema).toContain('model SuperAgency');
    expect(schema).toContain('model Organization');
    expect(schema).toContain('model SuperAgencyMembership');
    expect(schema).toContain('SUPER_AGENCY');
    expect(agencyModel).toContain('superAgencyId');
    expect(agencyModel).not.toContain('organizationId');
  });

  it('parents Agency under Super Agency while preserving Workspace under Agency', () => {
    const workspaceModel = modelBlock('Workspace');
    const taskModel = modelBlock('Task');
    const projectModel = modelBlock('Project');
    const ticketModel = modelBlock('Ticket');

    expect(schema).toContain('superAgencyId String       @map("super_agency_id") @db.Uuid');
    expect(schema).toContain('agencyId          String          @map("agency_id") @db.Uuid');
    expect(workspaceModel).not.toContain('superAgencyId');
    expect(taskModel).not.toContain('superAgencyId');
    expect(projectModel).not.toContain('superAgencyId');
    expect(ticketModel).not.toContain('superAgencyId');
  });

  it('backfills one compatibility Super Agency per legacy Agency', () => {
    expect(migration).toContain('one compatibility Super Agency per existing Agency');
    expect(migration).toContain('SELECT');
    expect(migration).toContain('FROM "agencies"');
    expect(migration).toContain('UPDATE "agencies"');
    expect(migration).toContain(
      'ALTER TABLE "agencies" ALTER COLUMN "super_agency_id" SET NOT NULL',
    );
    expect(migration).not.toContain('default_super_agency');
  });

  it('uses restrictive parent deletes and uniqueness for memberships', () => {
    expect(migration).toContain('ON DELETE RESTRICT ON UPDATE CASCADE');
    expect(migration).toContain('"super_agency_memberships_user_id_super_agency_id_key"');
    expect(migration).not.toMatch(/ON DELETE CASCADE[\s\S]*"agencies_super_agency_id_fkey"/);
  });

  it('keeps Platform authority separate from Super Agency tenant membership', () => {
    const membershipModel = modelBlock('SuperAgencyMembership');

    expect(membershipModel).toContain('superAgencyId');
    expect(membershipModel).not.toContain('platform');
    expect(membershipModel).not.toContain('superAdmin');
    expect(schema).not.toContain('model Platform');
  });

  function modelBlock(modelName: string) {
    const match = schema.match(new RegExp(`model ${modelName} \\{[\\s\\S]*?\\n\\}`));
    if (!match) throw new Error(`Missing model ${modelName}`);
    return match[0];
  }
});
