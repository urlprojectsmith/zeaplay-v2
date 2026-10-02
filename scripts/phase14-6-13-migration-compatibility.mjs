import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');
const prismaDir = path.join(repoRoot, 'apps', 'api', 'prisma');
const migrationsDir = path.join(prismaDir, 'migrations');
const currentSchema = path.join(prismaDir, 'schema.prisma');
const exampleEnv = readFileSync(path.join(repoRoot, '.env.example'), 'utf8');
const exampleDirectUrl = exampleEnv.match(/^DIRECT_DATABASE_URL=(.+)$/m)?.[1];
const parsedExampleDirectUrl = exampleDirectUrl ? new URL(exampleDirectUrl) : null;

const container = process.env.ZEA_PHASE14613_POSTGRES_CONTAINER ?? 'zeaplay-v2-postgres-1';
const dbUser =
  process.env.ZEA_PHASE14613_POSTGRES_USER ?? parsedExampleDirectUrl?.username ?? 'zea';
const dbPassword =
  process.env.ZEA_PHASE14613_POSTGRES_PASSWORD ?? parsedExampleDirectUrl?.password ?? '';
const dbHost =
  process.env.ZEA_PHASE14613_POSTGRES_HOST ?? parsedExampleDirectUrl?.hostname ?? 'localhost';
const dbPort = process.env.ZEA_PHASE14613_POSTGRES_PORT ?? parsedExampleDirectUrl?.port ?? '5432';
const dbPrefix = process.env.ZEA_PHASE14613_DB_PREFIX ?? 'zea_play_phase14613';
const cleanDb = `${dbPrefix}_clean`;
const legacyDb = `${dbPrefix}_legacy`;
const zeroAgencyDb = `${dbPrefix}_zero`;
const oneAgencyDb = `${dbPrefix}_one`;
const manyAgencyDb = `${dbPrefix}_many`;
const phase15Db = `${dbPrefix}_phase15`;
const phase154Db = `${dbPrefix}_phase154`;
const phase161Db = `${dbPrefix}_phase161`;
const phase162Db = `${dbPrefix}_phase162`;
const phase163Db = `${dbPrefix}_phase163`;
const phase171Db = `${dbPrefix}_phase171`;
const phase172Db = `${dbPrefix}_phase172`;
const phase173Db = `${dbPrefix}_phase173`;
const phase174Db = `${dbPrefix}_phase174`;
const expectedMigrationCount = 90;
const expectedLatestMigration = '0090_phase18_2_custom_domains';
const allowedLocalHosts = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal']);

const fixture = {
  users: [
    '00000000-146d-0013-0000-000000000001',
    '00000000-146d-0013-0000-000000000002',
    '00000000-146d-0013-0000-000000000003',
  ],
  organizations: ['00000000-146d-0013-1000-000000000001', '00000000-146d-0013-1000-000000000002'],
  roles: {
    org: '00000000-146d-0013-2000-000000000001',
    agency: '00000000-146d-0013-2000-000000000002',
    workspace: '00000000-146d-0013-2000-000000000003',
  },
  agencies: [
    '00000000-146d-0013-3000-000000000001',
    '00000000-146d-0013-3000-000000000002',
    '00000000-146d-0013-3000-000000000003',
  ],
  workspaces: [
    '00000000-146d-0013-4000-000000000001',
    '00000000-146d-0013-4000-000000000002',
    '00000000-146d-0013-4000-000000000003',
    '00000000-146d-0013-4000-000000000004',
  ],
  memberships: {
    agency: [
      '00000000-146d-0013-5000-000000000001',
      '00000000-146d-0013-5000-000000000002',
      '00000000-146d-0013-5000-000000000003',
    ],
    workspace: [
      '00000000-146d-0013-6000-000000000001',
      '00000000-146d-0013-6000-000000000002',
      '00000000-146d-0013-6000-000000000003',
      '00000000-146d-0013-6000-000000000004',
    ],
  },
  domain: {
    department: '00000000-146d-0013-7000-000000000001',
    taskStatus: '00000000-146d-0013-7100-000000000001',
    projectStatus: '00000000-146d-0013-7100-000000000002',
    ticketStatus: '00000000-146d-0013-7100-000000000003',
    task: '00000000-146d-0013-7200-000000000001',
    project: '00000000-146d-0013-7300-000000000001',
    ticket: '00000000-146d-0013-7400-000000000001',
    asset: '00000000-146d-0013-7500-000000000001',
    apiKey: '00000000-146d-0013-7600-000000000001',
    webhookSubscription: '00000000-146d-0013-7700-000000000001',
    webhookEvent: '00000000-146d-0013-7700-000000000002',
    webhookDelivery: '00000000-146d-0013-7700-000000000003',
    inboundSource: '00000000-146d-0013-7800-000000000001',
    inboundEvent: '00000000-146d-0013-7800-000000000002',
    normalizedInboundEvent: '00000000-146d-0013-7800-000000000003',
    integrationConnection: '00000000-146d-0013-7900-000000000001',
    integrationAction: '00000000-146d-0013-7900-000000000002',
    integrationIdempotency: '00000000-146d-0013-7900-000000000003',
    cloudDriveConnection: '00000000-146d-0013-8000-000000000001',
    uploadReservation: '00000000-146d-0013-8100-000000000001',
    processingJob: '00000000-146d-0013-8100-000000000002',
    calendarEvent: '00000000-146d-0013-8200-000000000001',
    calendarParticipant: '00000000-146d-0013-8200-000000000002',
    notification: '00000000-146d-0013-8300-000000000001',
    workXpEvent: '00000000-146d-0013-8400-000000000001',
    xpEntry: '00000000-146d-0013-8400-000000000002',
    globalScore: '00000000-146d-0013-8400-000000000003',
    automationWorkflow: '00000000-146d-0013-8500-000000000001',
    automationVersion: '00000000-146d-0013-8500-000000000002',
    automationDomainEvent: '00000000-146d-0013-8500-000000000003',
    automationTriggerMatch: '00000000-146d-0013-8500-000000000004',
    automationExecution: '00000000-146d-0013-8500-000000000005',
    automationStep: '00000000-146d-0013-8500-000000000006',
    feature: '00000000-146d-0013-8600-000000000001',
    entitlement: '00000000-146d-0013-8600-000000000002',
    auditLegacy: '00000000-146d-0013-8700-000000000001',
    auditLineage: '00000000-146d-0013-8700-000000000002',
    auditNewLineage: '00000000-146d-0013-8700-000000000003',
  },
};

const fixtureLists = {
  agencies: fixture.agencies.map(sqlLiteralList).join(','),
  workspaces: fixture.workspaces.map(sqlLiteralList).join(','),
  agencyMemberships: fixture.memberships.agency.map(sqlLiteralList).join(','),
  workspaceMemberships: fixture.memberships.workspace.map(sqlLiteralList).join(','),
};

function sqlLiteralList(value) {
  return `'${value}'`;
}

function assertScratchName(dbName) {
  if (
    !/^zea_play_phase14613[a-z0-9_]*_(clean|legacy|zero|one|many|phase15|phase154|phase161|phase162|phase163|phase171|phase172|phase173|phase174)$/.test(
      dbName,
    ) ||
    /prod|production|shared/i.test(dbName) ||
    ['zea_play', 'postgres', 'template0', 'template1'].includes(dbName)
  ) {
    throw new Error(`Refusing to operate on non-phase scratch database name: ${dbName}`);
  }
}

function assertLocalHost() {
  if (!allowedLocalHosts.has(dbHost)) {
    throw new Error(
      `Refusing scratch migration against non-local PostgreSQL host: ${dbHost}. ` +
        'Set ZEA_PHASE14613_POSTGRES_HOST to localhost/127.0.0.1/::1/host.docker.internal.',
    );
  }
}

function assertHarnessSafety() {
  assertLocalHost();

  for (const unsafeName of ['zea_play', 'zea_play_test', 'random_db', 'postgres']) {
    let refused = false;
    try {
      assertScratchName(unsafeName);
    } catch {
      refused = true;
    }

    if (!refused) {
      throw new Error(`Harness failed to refuse unsafe database name: ${unsafeName}`);
    }
  }

  for (const dbName of [
    cleanDb,
    legacyDb,
    zeroAgencyDb,
    oneAgencyDb,
    manyAgencyDb,
    phase15Db,
    phase154Db,
    phase161Db,
    phase162Db,
    phase163Db,
    phase171Db,
    phase172Db,
    phase173Db,
    phase174Db,
  ]) {
    assertScratchName(dbName);
  }
}

function redact(value) {
  return value
    .replaceAll(dbPassword, '<redacted>')
    .replaceAll(databaseUrl(cleanDb), '<redacted-clean-database-url>')
    .replaceAll(databaseUrl(legacyDb), '<redacted-legacy-database-url>')
    .replaceAll(databaseUrl(zeroAgencyDb), '<redacted-zero-database-url>')
    .replaceAll(databaseUrl(oneAgencyDb), '<redacted-one-database-url>')
    .replaceAll(databaseUrl(manyAgencyDb), '<redacted-many-database-url>')
    .replaceAll(databaseUrl(phase15Db), '<redacted-phase15-database-url>')
    .replaceAll(databaseUrl(phase154Db), '<redacted-phase154-database-url>')
    .replaceAll(databaseUrl(phase161Db), '<redacted-phase161-database-url>')
    .replaceAll(databaseUrl(phase162Db), '<redacted-phase162-database-url>')
    .replaceAll(databaseUrl(phase163Db), '<redacted-phase163-database-url>')
    .replaceAll(databaseUrl(phase171Db), '<redacted-phase171-database-url>')
    .replaceAll(databaseUrl(phase172Db), '<redacted-phase172-database-url>')
    .replaceAll(databaseUrl(phase173Db), '<redacted-phase173-database-url>')
    .replaceAll(databaseUrl(phase174Db), '<redacted-phase174-database-url>');
}

function quoteWindowsArg(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`;
}

function run(command, args, options = {}) {
  const commandLine =
    process.platform === 'win32' ? [command, ...args].map(quoteWindowsArg).join(' ') : command;
  const commandArgs = process.platform === 'win32' ? [] : args;

  const result = spawnSync(commandLine, commandArgs, {
    cwd: repoRoot,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    input: options.input,
    maxBuffer: 1024 * 1024 * 64,
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    const rendered = [command, ...args].join(' ');
    throw new Error(
      [
        `Command failed: ${redact(rendered)}`,
        result.stdout ? `stdout:\n${redact(result.stdout)}` : '',
        result.stderr ? `stderr:\n${redact(result.stderr)}` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    );
  }

  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function databaseUrl(dbName) {
  return `postgresql://${encodeURIComponent(dbUser)}:${encodeURIComponent(
    dbPassword,
  )}@${dbHost}:${dbPort}/${dbName}?schema=public`;
}

function prismaEnv(dbName) {
  const url = databaseUrl(dbName);
  return {
    DATABASE_URL: url,
    DIRECT_DATABASE_URL: url,
    TURBO_ENV_MODE: 'loose',
  };
}

function psql(dbName, sql, extraArgs = []) {
  assertScratchName(dbName);
  return run(
    'docker',
    [
      'exec',
      '-i',
      container,
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      dbUser,
      '-d',
      dbName,
      ...extraArgs,
    ],
    { input: sql },
  ).stdout;
}

function psqlScalar(dbName, sql) {
  return psql(dbName, sql, ['-At']).trim();
}

function admin(sql) {
  return run(
    'docker',
    ['exec', '-i', container, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', dbUser, '-d', 'postgres'],
    { input: sql },
  ).stdout;
}

function resetDatabase(dbName) {
  assertLocalHost();
  assertScratchName(dbName);
  console.error(
    `[phase14.6.13] resetting scratch database host=${dbHost} port=${dbPort} db=${dbName}`,
  );
  admin(`
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname = '${dbName}' AND pid <> pg_backend_pid();
    DROP DATABASE IF EXISTS "${dbName}";
    CREATE DATABASE "${dbName}" OWNER "${dbUser}";
  `);
}

function runPrisma(dbName, args) {
  return run('pnpm', ['--filter', '@zea-play/api', 'exec', 'prisma', ...args], {
    env: prismaEnv(dbName),
  });
}

function migrateDeploy(dbName, schemaPath) {
  return runPrisma(dbName, ['migrate', 'deploy', '--schema', schemaPath]);
}

function migrateStatus(dbName, schemaPath) {
  return runPrisma(dbName, ['migrate', 'status', '--schema', schemaPath]);
}

function seed(dbName) {
  return run('pnpm', ['--filter', '@zea-play/api', 'prisma:seed'], {
    env: prismaEnv(dbName),
  });
}

function buildPrismaDirThrough(cutoffMigration, label) {
  const tempRoot = path.join(repoRoot, '.tmp', `phase14-6-13-${Date.now().toString(36)}`);
  const tempPrisma = path.join(tempRoot, `prisma-${label}`);
  const tempMigrations = path.join(tempPrisma, 'migrations');

  mkdirSync(tempMigrations, { recursive: true });
  copyFileSync(currentSchema, path.join(tempPrisma, 'schema.prisma'));

  for (const entry of readdirSync(migrationsDir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name <= cutoffMigration) {
      cpSync(path.join(migrationsDir, entry.name), path.join(tempMigrations, entry.name), {
        recursive: true,
      });
    }
  }

  return {
    tempRoot,
    schemaPath: path.join(tempPrisma, 'schema.prisma'),
  };
}

function buildLegacyPrismaDir() {
  return buildPrismaDirThrough('0073_phase14_5_integration_audit_hardening', '0073');
}

function buildPhase152PrismaDir() {
  return buildPrismaDirThrough('0078_phase15_2_stripe_subscription_lifecycle', '0078');
}

function buildPhase154PrismaDir() {
  return buildPrismaDirThrough('0080_phase15_4_invoice_projection', '0080');
}

function buildPhase161PrismaDir() {
  return buildPrismaDirThrough('0081_phase16_1_docs_foundation', '0081');
}

function buildPhase162PrismaDir() {
  return buildPrismaDirThrough('0082_phase16_2_forms_foundation', '0082');
}

function buildPhase163PrismaDir() {
  return buildPrismaDirThrough('0083_phase16_3_goals_foundation', '0083');
}

function buildPhase171PrismaDir() {
  return buildPrismaDirThrough('0084_phase17_1_analytics_foundation', '0084');
}

function buildPhase172PrismaDir() {
  return buildPrismaDirThrough('0085_phase17_2_reports', '0085');
}

function buildPhase173PrismaDir() {
  return buildPrismaDirThrough('0086_phase17_3_global_search', '0086');
}

function buildPhase174PrismaDir() {
  return buildPrismaDirThrough('0087_phase17_4_custom_dashboards', '0087');
}

function assertEqual(label, actual, expected) {
  if (String(actual) !== String(expected)) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function assertZero(dbName, label, sql) {
  assertEqual(label, psqlScalar(dbName, sql), '0');
}

function assertOne(dbName, label, sql) {
  assertEqual(label, psqlScalar(dbName, sql), '1');
}

function tableColumnCount(dbName, table, column) {
  return psqlScalar(
    dbName,
    `SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${table}' AND column_name = '${column}';`,
  );
}

function migrationDirectories() {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function validateMigrationInventory(migrations) {
  assertEqual('migration directory count', migrations.length, expectedMigrationCount);
  assertEqual('latest migration', migrations.at(-1), expectedLatestMigration);

  const numbers = migrations.map((name) => name.slice(0, 4));
  assertEqual('unique migration numbers', new Set(numbers).size, migrations.length);

  for (let index = 0; index < numbers.length; index += 1) {
    assertEqual(
      'contiguous migration numbering',
      numbers[index],
      String(index + 1).padStart(4, '0'),
    );
  }
}

function uuid(group, index) {
  return `00000000-146d-0013-${group}-${String(index).padStart(12, '0')}`;
}

function assertPreSuperAgencySchema(dbName) {
  assertEqual(
    'pre-0074 super_agencies table absent',
    psqlScalar(
      dbName,
      `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'super_agencies';`,
    ),
    '0',
  );
  assertEqual(
    'pre-0074 super_agency_memberships table absent',
    psqlScalar(
      dbName,
      `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'super_agency_memberships';`,
    ),
    '0',
  );
  assertEqual(
    'pre-0074 agencies.super_agency_id absent',
    tableColumnCount(dbName, 'agencies', 'super_agency_id'),
    '0',
  );
}

function lightweightAgencyFixtureSql(label, agencyCount) {
  if (agencyCount === 0) {
    return '';
  }

  const userId = uuid('9000', agencyCount);
  const orgId = uuid('9100', agencyCount);
  const agencyRows = [];

  for (let index = 1; index <= agencyCount; index += 1) {
    const status = index % 5 === 0 ? 'ARCHIVED' : index % 3 === 0 ? 'SUSPENDED' : 'ACTIVE';
    agencyRows.push(
      `('${uuid('9200', index)}', 'Shared Edge Agency', 'phase14613-${label}-agency-${index}', '${status}', '${userId}', '2024-02-01T00:00:00Z', '2024-02-01T00:00:00Z')`,
    );
  }

  return `
INSERT INTO users (id, email, name, password_hash, status, created_at, updated_at)
VALUES ('${userId}', 'phase14613-${label}@example.test', 'Phase 14.6.13 ${label}', 'edge-hash', 'ACTIVE', '2024-02-01T00:00:00Z', '2024-02-01T00:00:00Z');

INSERT INTO organizations (id, name, slug, status, created_at, updated_at)
VALUES ('${orgId}', 'Phase 14.6.13 ${label} Organization', 'phase14613-${label}-org', 'ACTIVE', '2024-02-01T00:00:00Z', '2024-02-01T00:00:00Z');

INSERT INTO agencies (id, name, slug, status, created_by_id, created_at, updated_at)
VALUES
  ${agencyRows.join(',\n  ')};
`;
}

function runLegacyEdgeScenario(dbName, agencyCount, label) {
  const legacy = buildLegacyPrismaDir();
  try {
    resetDatabase(dbName);
    migrateDeploy(dbName, legacy.schemaPath);
    assertPreSuperAgencySchema(dbName);

    const fixtureSql = lightweightAgencyFixtureSql(label, agencyCount);
    if (fixtureSql) {
      psql(dbName, fixtureSql);
    }

    const preCounts = {
      agencies: psqlScalar(
        dbName,
        `SELECT COUNT(*) FROM agencies WHERE slug LIKE 'phase14613-${label}-agency-%';`,
      ),
      suspended: psqlScalar(
        dbName,
        `SELECT COUNT(*) FROM agencies WHERE slug LIKE 'phase14613-${label}-agency-%' AND status = 'SUSPENDED';`,
      ),
      archived: psqlScalar(
        dbName,
        `SELECT COUNT(*) FROM agencies WHERE slug LIKE 'phase14613-${label}-agency-%' AND status = 'ARCHIVED';`,
      ),
    };

    migrateDeploy(dbName, currentSchema);
    const status = migrateStatus(dbName, currentSchema);

    assertEqual(`${label} agency count preserved`, preCounts.agencies, String(agencyCount));
    assertEqual(
      `${label} compatibility super agency count`,
      psqlScalar(
        dbName,
        `
        SELECT COUNT(*)
        FROM agencies a
        JOIN super_agencies s ON s.id = a.super_agency_id
        WHERE a.slug LIKE 'phase14613-${label}-agency-%';
        `,
      ),
      String(agencyCount),
    );
    assertEqual(
      `${label} same-id compatibility mapping`,
      psqlScalar(
        dbName,
        `SELECT COUNT(*) FROM agencies WHERE slug LIKE 'phase14613-${label}-agency-%' AND super_agency_id = id;`,
      ),
      String(agencyCount),
    );
    assertEqual(
      `${label} distinct compatibility parents`,
      psqlScalar(
        dbName,
        `SELECT COUNT(DISTINCT super_agency_id) FROM agencies WHERE slug LIKE 'phase14613-${label}-agency-%';`,
      ),
      String(agencyCount),
    );
    assertEqual(
      `${label} no synthetic super agency memberships`,
      psqlScalar(
        dbName,
        `
        SELECT COUNT(*)
        FROM super_agency_memberships sam
        JOIN agencies a ON a.super_agency_id = sam.super_agency_id
        WHERE a.slug LIKE 'phase14613-${label}-agency-%';
        `,
      ),
      '0',
    );
    assertEqual(
      `${label} suspended status preserved`,
      psqlScalar(
        dbName,
        `SELECT COUNT(*) FROM agencies WHERE slug LIKE 'phase14613-${label}-agency-%' AND status = 'SUSPENDED';`,
      ),
      preCounts.suspended,
    );
    assertEqual(
      `${label} archived status preserved`,
      psqlScalar(
        dbName,
        `SELECT COUNT(*) FROM agencies WHERE slug LIKE 'phase14613-${label}-agency-%' AND status = 'ARCHIVED';`,
      ),
      preCounts.archived,
    );

    return {
      database: dbName,
      agencies: preCounts.agencies,
      compatibilitySuperAgencies: psqlScalar(
        dbName,
        `SELECT COUNT(*) FROM super_agencies s WHERE EXISTS (SELECT 1 FROM agencies a WHERE a.slug LIKE 'phase14613-${label}-agency-%' AND a.super_agency_id = s.id);`,
      ),
      sameIdMappings: psqlScalar(
        dbName,
        `SELECT COUNT(*) FROM agencies WHERE slug LIKE 'phase14613-${label}-agency-%' AND super_agency_id = id;`,
      ),
      statusUpToDate: /Database schema is up to date/i.test(status.stdout + status.stderr),
    };
  } finally {
    if (existsSync(legacy.tempRoot) && legacy.tempRoot.startsWith(path.join(repoRoot, '.tmp'))) {
      rmSync(legacy.tempRoot, { recursive: true, force: true });
    }
  }
}

function legacyFixtureSql() {
  const d = fixture.domain;
  return `
BEGIN;

INSERT INTO users (id, email, name, password_hash, status, created_at, updated_at) VALUES
  ('${fixture.users[0]}', 'phase14613-owner@example.test', 'Phase 14.6.13 Owner', 'legacy-hash-owner', 'ACTIVE', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z'),
  ('${fixture.users[1]}', 'phase14613-manager@example.test', 'Phase 14.6.13 Manager', 'legacy-hash-manager', 'ACTIVE', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z'),
  ('${fixture.users[2]}', 'phase14613-member@example.test', 'Phase 14.6.13 Member', 'legacy-hash-member', 'ACTIVE', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z');

INSERT INTO organizations (id, name, slug, status, storage_used_bytes, storage_limit_bytes, created_at, updated_at) VALUES
  ('${fixture.organizations[0]}', 'Legacy Organization Alpha', 'phase14613-org-alpha', 'ACTIVE', 12345, 987654321, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z'),
  ('${fixture.organizations[1]}', 'Legacy Organization Beta', 'phase14613-org-beta', 'ACTIVE', 67890, 987654321, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z');

INSERT INTO roles (id, key, name, name_normalized, scope, is_system, is_active, workspace_id, description, created_at, updated_at) VALUES
  ('${fixture.roles.org}', 'phase14613_legacy_org_admin', 'Legacy Org Admin', 'legacy org admin', 'LEGACY_ORGANIZATION', true, true, NULL, 'Legacy compatibility role', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z'),
  ('${fixture.roles.agency}', 'phase14613_agency_admin', 'Agency Admin', 'agency admin', 'AGENCY', true, true, NULL, 'Agency compatibility role', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z'),
  ('${fixture.roles.workspace}', 'phase14613_workspace_member', 'Workspace Member', 'workspace member', 'WORKSPACE', true, true, NULL, 'Workspace compatibility role', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z');

INSERT INTO memberships (id, user_id, organization_id, role_id, status, created_at, updated_at) VALUES
  ('00000000-146d-0013-2100-000000000001', '${fixture.users[0]}', '${fixture.organizations[0]}', '${fixture.roles.org}', 'ACTIVE', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z'),
  ('00000000-146d-0013-2100-000000000002', '${fixture.users[1]}', '${fixture.organizations[1]}', '${fixture.roles.org}', 'ACTIVE', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z');

INSERT INTO agencies (id, name, slug, status, created_by_id, created_at, updated_at) VALUES
  ('${fixture.agencies[0]}', 'Shared Name Legacy Agency', 'phase14613-agency-alpha', 'ACTIVE', '${fixture.users[0]}', '2024-01-02T00:00:00Z', '2024-01-02T00:00:00Z'),
  ('${fixture.agencies[1]}', 'Shared Name Legacy Agency', 'phase14613-agency-beta', 'SUSPENDED', '${fixture.users[1]}', '2024-01-03T00:00:00Z', '2024-01-03T00:00:00Z'),
  ('${fixture.agencies[2]}', 'Unicode Legacy Agency', 'phase14613-agency-gamma', 'ARCHIVED', '${fixture.users[2]}', '2024-01-04T00:00:00Z', '2024-01-04T00:00:00Z');

INSERT INTO agency_memberships (id, user_id, agency_id, role_id, status, created_at, updated_at) VALUES
  ('${fixture.memberships.agency[0]}', '${fixture.users[0]}', '${fixture.agencies[0]}', '${fixture.roles.agency}', 'ACTIVE', '2024-01-05T00:00:00Z', '2024-01-05T00:00:00Z'),
  ('${fixture.memberships.agency[1]}', '${fixture.users[1]}', '${fixture.agencies[1]}', '${fixture.roles.agency}', 'ACTIVE', '2024-01-05T00:00:00Z', '2024-01-05T00:00:00Z'),
  ('${fixture.memberships.agency[2]}', '${fixture.users[2]}', '${fixture.agencies[2]}', '${fixture.roles.agency}', 'ACTIVE', '2024-01-05T00:00:00Z', '2024-01-05T00:00:00Z');

INSERT INTO workspaces (id, agency_id, name, slug, timezone, status, storage_used_bytes, storage_limit_bytes, created_by_id, created_at, updated_at) VALUES
  ('${fixture.workspaces[0]}', '${fixture.agencies[0]}', 'Alpha Workspace One', 'phase14613-alpha-one', 'UTC', 'ACTIVE', 111, 1073741824, '${fixture.users[0]}', '2024-01-06T00:00:00Z', '2024-01-06T00:00:00Z'),
  ('${fixture.workspaces[1]}', '${fixture.agencies[0]}', 'Alpha Workspace Two', 'phase14613-alpha-two', 'UTC', 'ACTIVE', 222, 1073741824, '${fixture.users[0]}', '2024-01-06T00:00:00Z', '2024-01-06T00:00:00Z'),
  ('${fixture.workspaces[2]}', '${fixture.agencies[1]}', 'Beta Workspace', 'phase14613-beta', 'UTC', 'ACTIVE', 333, 1073741824, '${fixture.users[1]}', '2024-01-06T00:00:00Z', '2024-01-06T00:00:00Z'),
  ('${fixture.workspaces[3]}', '${fixture.agencies[2]}', 'Gamma Workspace', 'phase14613-gamma', 'Asia/Kolkata', 'ACTIVE', 444, 1073741824, '${fixture.users[2]}', '2024-01-06T00:00:00Z', '2024-01-06T00:00:00Z');

INSERT INTO workspace_memberships (id, user_id, workspace_id, role_id, department_id, status, created_at, updated_at) VALUES
  ('${fixture.memberships.workspace[0]}', '${fixture.users[0]}', '${fixture.workspaces[0]}', '${fixture.roles.workspace}', NULL, 'ACTIVE', '2024-01-07T00:00:00Z', '2024-01-07T00:00:00Z'),
  ('${fixture.memberships.workspace[1]}', '${fixture.users[0]}', '${fixture.workspaces[1]}', '${fixture.roles.workspace}', NULL, 'ACTIVE', '2024-01-07T00:00:00Z', '2024-01-07T00:00:00Z'),
  ('${fixture.memberships.workspace[2]}', '${fixture.users[1]}', '${fixture.workspaces[2]}', '${fixture.roles.workspace}', NULL, 'ACTIVE', '2024-01-07T00:00:00Z', '2024-01-07T00:00:00Z'),
  ('${fixture.memberships.workspace[3]}', '${fixture.users[2]}', '${fixture.workspaces[3]}', '${fixture.roles.workspace}', NULL, 'ACTIVE', '2024-01-07T00:00:00Z', '2024-01-07T00:00:00Z');

INSERT INTO departments (id, workspace_id, name, description, status, manager_membership_id, created_at, updated_at) VALUES
  ('${d.department}', '${fixture.workspaces[0]}', 'Operations', 'Legacy operations department', 'ACTIVE', '${fixture.memberships.workspace[0]}', '2024-01-08T00:00:00Z', '2024-01-08T00:00:00Z');

INSERT INTO status_definitions (id, workspace_id, entity_type, name, name_normalized, description, color, position, category, is_default, is_terminal, is_active, is_system, created_at, updated_at) VALUES
  ('${d.taskStatus}', '${fixture.workspaces[0]}', 'TASK', 'To Do', 'to do', 'Legacy task status', '#123456', 1, 'TODO', true, false, true, true, '2024-01-09T00:00:00Z', '2024-01-09T00:00:00Z'),
  ('${d.projectStatus}', '${fixture.workspaces[0]}', 'PROJECT', 'Active', 'active', 'Legacy project status', '#234567', 1, 'IN_PROGRESS', true, false, true, true, '2024-01-09T00:00:00Z', '2024-01-09T00:00:00Z'),
  ('${d.ticketStatus}', '${fixture.workspaces[0]}', 'TICKET', 'Open', 'open', 'Legacy ticket status', '#345678', 1, 'TODO', true, false, true, true, '2024-01-09T00:00:00Z', '2024-01-09T00:00:00Z');

INSERT INTO projects (id, workspace_id, name, description, status, status_definition_id, priority, xp_category, visibility, department_id, owner_membership_id, created_by_id, created_at, updated_at)
VALUES ('${d.project}', '${fixture.workspaces[0]}', 'Legacy Project', 'Project before hierarchy migration', 'ACTIVE', '${d.projectStatus}', 'MEDIUM', 'MEDIUM', 'WORKSPACE', '${d.department}', '${fixture.memberships.workspace[0]}', '${fixture.users[0]}', '2024-01-10T00:00:00Z', '2024-01-10T00:00:00Z');

INSERT INTO tasks (id, workspace_id, title, description, priority, status_definition_id, department_id, created_by_id, updated_by_id, created_at, updated_at)
VALUES ('${d.task}', '${fixture.workspaces[0]}', 'Legacy Task', 'Task before hierarchy migration', 'HIGH', '${d.taskStatus}', '${d.department}', '${fixture.users[0]}', '${fixture.users[0]}', '2024-01-10T00:00:00Z', '2024-01-10T00:00:00Z');

INSERT INTO tickets (id, workspace_id, sequence_number, ticket_number, subject, description, status_definition_id, priority, department_id, assigned_to_membership_id, created_by_membership_id, created_at, updated_at)
VALUES ('${d.ticket}', '${fixture.workspaces[0]}', 1, 'T-1', 'Legacy Ticket', 'Ticket before hierarchy migration', '${d.ticketStatus}', 'URGENT', '${d.department}', '${fixture.memberships.workspace[0]}', '${fixture.memberships.workspace[0]}', '2024-01-10T00:00:00Z', '2024-01-10T00:00:00Z');

INSERT INTO cloud_drive_connections (id, workspace_id, provider, display_name, status, provider_account_id, provider_account_label, encrypted_access_token, encrypted_refresh_token, scopes, root_folder_id, connected_by_membership_id, created_at, updated_at)
VALUES ('${d.cloudDriveConnection}', '${fixture.workspaces[0]}', 'GOOGLE_DRIVE', 'Legacy Drive', 'CONNECTED', 'acct-legacy', 'Legacy Account', 'encrypted-access-before', 'encrypted-refresh-before', ARRAY['drive.readonly'], 'root-before', '${fixture.memberships.workspace[0]}', '2024-01-11T00:00:00Z', '2024-01-11T00:00:00Z');

INSERT INTO assets (id, workspace_id, project_id, created_by_id, uploaded_by_membership_id, original_filename, display_name, storage_bucket, storage_provider, storage_key, mime_type, extension, size_bytes, checksum, status, lifecycle, source_module, source_entity_type, source_entity_id, source_provider, source_connection_id, source_provider_file_id, metadata, upload_expires_at, created_at, updated_at)
VALUES ('${d.asset}', '${fixture.workspaces[0]}', '${d.project}', '${fixture.users[0]}', '${fixture.memberships.workspace[0]}', 'legacy.txt', 'Legacy File', 'phase14613', 'MINIO', 'legacy/tenant/path/phase14613-file.txt', 'text/plain', 'txt', 64, 'checksum-before', 'READY', 'ACTIVE', 'TASKS', 'TASK', '${d.task}', 'GOOGLE_DRIVE', '${d.cloudDriveConnection}', 'provider-file-before', '{"before":"migration"}', '2025-01-01T00:00:00Z', '2024-01-12T00:00:00Z', '2024-01-12T00:00:00Z');

INSERT INTO storage_upload_reservations (id, workspace_id, file_id, membership_id, reserved_bytes, expires_at, consumed_at, created_at, updated_at)
VALUES ('${d.uploadReservation}', '${fixture.workspaces[0]}', '${d.asset}', '${fixture.memberships.workspace[0]}', 64, '2025-01-01T00:00:00Z', '2024-01-12T00:10:00Z', '2024-01-12T00:00:00Z', '2024-01-12T00:10:00Z');

INSERT INTO processing_jobs (id, workspace_id, project_id, asset_id, type, status, attempts, progress, correlation_id, created_at, updated_at)
VALUES ('${d.processingJob}', '${fixture.workspaces[0]}', '${d.project}', '${d.asset}', 'THUMBNAIL', 'QUEUED', 0, 0, 'phase14613-processing', '2024-01-12T00:00:00Z', '2024-01-12T00:00:00Z');

INSERT INTO api_keys (id, workspace_id, name, description, public_identifier, prefix, secret_hash, status, scopes, created_by_membership_id, created_at, updated_at)
VALUES ('${d.apiKey}', '${fixture.workspaces[0]}', 'Legacy API Key', 'API key before hierarchy migration', 'pk_phase14613_legacy', 'zp_legacy', 'secret-hash-before', 'ACTIVE', ARRAY['tasks:read','webhooks:write'], '${fixture.memberships.workspace[0]}', '2024-01-13T00:00:00Z', '2024-01-13T00:00:00Z');

INSERT INTO webhook_subscriptions (id, workspace_id, name, description, endpoint_url, status, encrypted_secret, event_types, created_by_membership_id, created_at, updated_at)
VALUES ('${d.webhookSubscription}', '${fixture.workspaces[0]}', 'Legacy Outbound', 'Outbound webhook before hierarchy migration', 'https://example.test/hooks/phase14613', 'ACTIVE', 'encrypted-webhook-secret-before', ARRAY['task.created'], '${fixture.memberships.workspace[0]}', '2024-01-14T00:00:00Z', '2024-01-14T00:00:00Z');

INSERT INTO webhook_events (id, workspace_id, event_type, aggregate_type, aggregate_id, payload_json, correlation_id, is_test, created_at)
VALUES ('${d.webhookEvent}', '${fixture.workspaces[0]}', 'task.created', 'task', '${d.task}', '{"id":"legacy"}', 'phase14613-webhook', false, '2024-01-14T00:01:00Z');

INSERT INTO webhook_deliveries (id, workspace_id, event_id, subscription_id, status, attempt_count, next_attempt_at, created_at, updated_at)
VALUES ('${d.webhookDelivery}', '${fixture.workspaces[0]}', '${d.webhookEvent}', '${d.webhookSubscription}', 'PENDING', 0, '2024-01-14T00:02:00Z', '2024-01-14T00:01:00Z', '2024-01-14T00:01:00Z');

INSERT INTO inbound_webhook_sources (id, workspace_id, name, description, public_identifier, type, status, encrypted_signing_secret, created_by_membership_id, created_at, updated_at)
VALUES ('${d.inboundSource}', '${fixture.workspaces[0]}', 'Legacy Inbound', 'Inbound webhook before hierarchy migration', 'iw_phase14613_legacy', 'GENERIC_HMAC_V1', 'ACTIVE', 'encrypted-inbound-secret-before', '${fixture.memberships.workspace[0]}', '2024-01-15T00:00:00Z', '2024-01-15T00:00:00Z');

INSERT INTO inbound_webhook_events (id, workspace_id, source_id, external_event_id, raw_body_hash, event_type, event_version, status, normalized_type, normalized_payload_json, received_at, verified_at, normalized_at, correlation_id, created_at, updated_at)
VALUES ('${d.inboundEvent}', '${fixture.workspaces[0]}', '${d.inboundSource}', 'external-phase14613', repeat('a', 64), 'external.created', '1', 'NORMALIZED', 'task.created', '{"id":"external"}', '2024-01-15T00:01:00Z', '2024-01-15T00:01:00Z', '2024-01-15T00:02:00Z', 'phase14613-inbound', '2024-01-15T00:01:00Z', '2024-01-15T00:02:00Z');

INSERT INTO normalized_inbound_events (id, workspace_id, source_id, inbound_event_id, source_type, external_event_id, type, version, occurred_at, received_at, data, correlation_id, created_at)
VALUES ('${d.normalizedInboundEvent}', '${fixture.workspaces[0]}', '${d.inboundSource}', '${d.inboundEvent}', 'GENERIC_HMAC_V1', 'external-phase14613', 'task.created', '1', '2024-01-15T00:00:00Z', '2024-01-15T00:01:00Z', '{"normalized":true}', 'phase14613-inbound', '2024-01-15T00:02:00Z');

INSERT INTO integration_connections (id, workspace_id, provider, name, status, auth_type, provider_account_id, provider_account_label, encrypted_credentials, scopes, capabilities, configuration_json, connected_by_membership_id, created_at, updated_at)
VALUES ('${d.integrationConnection}', '${fixture.workspaces[0]}', 'GENERIC_REST', 'Legacy Generic REST', 'CONNECTED', 'BEARER_TOKEN', 'generic-account', 'Generic Account', 'encrypted-credentials-before', ARRAY['generic:write'], ARRAY['http.request'], '{"baseUrl":"https://api.example.test"}', '${fixture.memberships.workspace[0]}', '2024-01-16T00:00:00Z', '2024-01-16T00:00:00Z');

INSERT INTO integration_action_executions (id, workspace_id, connection_id, provider, capability, status, actor_membership_id, request_summary_json, response_summary_json, duration_ms, created_at, completed_at)
VALUES ('${d.integrationAction}', '${fixture.workspaces[0]}', '${d.integrationConnection}', 'GENERIC_REST', 'http.request', 'SUCCEEDED', '${fixture.memberships.workspace[0]}', '{"method":"POST"}', '{"status":200}', 25, '2024-01-16T00:01:00Z', '2024-01-16T00:01:25Z');

INSERT INTO integration_action_idempotency_records (id, workspace_id, connection_id, capability, idempotency_key_hash, request_fingerprint, status, execution_id, response_body, expires_at, created_at, updated_at)
VALUES ('${d.integrationIdempotency}', '${fixture.workspaces[0]}', '${d.integrationConnection}', 'http.request', repeat('b', 64), repeat('c', 64), 'SUCCEEDED', '${d.integrationAction}', '{"ok":true}', '2025-01-16T00:00:00Z', '2024-01-16T00:00:00Z', '2024-01-16T00:01:25Z');

INSERT INTO calendar_events (id, workspace_id, title, description, start_at, end_at, all_day, timezone, visibility, created_by_membership_id, owner_membership_id, created_at, updated_at)
VALUES ('${d.calendarEvent}', '${fixture.workspaces[0]}', 'Legacy Calendar Event', 'Calendar before hierarchy migration', '2024-01-17T09:00:00Z', '2024-01-17T10:00:00Z', false, 'UTC', 'WORKSPACE', '${fixture.memberships.workspace[0]}', '${fixture.memberships.workspace[0]}', '2024-01-17T00:00:00Z', '2024-01-17T00:00:00Z');

INSERT INTO calendar_event_participants (id, calendar_event_id, workspace_id, membership_id, participant_role, created_at)
VALUES ('${d.calendarParticipant}', '${d.calendarEvent}', '${fixture.workspaces[0]}', '${fixture.memberships.workspace[0]}', 'OWNER', '2024-01-17T00:00:00Z');

INSERT INTO notifications (id, workspace_id, recipient_membership_id, category, type, title, message, entity_type, entity_id, actor_membership_id, priority, metadata, dedupe_key, created_at)
VALUES ('${d.notification}', '${fixture.workspaces[0]}', '${fixture.memberships.workspace[0]}', 'SYSTEM', 'SYSTEM_ANNOUNCEMENT', 'Legacy Notification', 'Notification before hierarchy migration', 'TASK', '${d.task}', '${fixture.memberships.workspace[0]}', 'IMPORTANT', '{"before":"migration"}', 'phase14613-notification', '2024-01-18T00:00:00Z');

INSERT INTO gamification_work_xp_events (id, workspace_id, recipient_membership_id, triggered_by_membership_id, work_type, source_entity_id, source_label_snapshot, event_type, completion_cycle, correlation_key, idempotency_key, department_id_snapshot, department_name_snapshot, category_snapshot, role_id_snapshot, role_name_snapshot, rule_source_snapshot, outcome, creation_xp_snapshot, base_xp_snapshot, bonus_xp_snapshot, penalty_xp_snapshot, net_xp_snapshot, occurred_at, created_at)
VALUES ('${d.workXpEvent}', '${fixture.workspaces[0]}', '${fixture.memberships.workspace[0]}', '${fixture.memberships.workspace[0]}', 'TASK', '${d.task}', 'Legacy Task', 'COMPLETION_AWARD', 1, 'phase14613-work-xp', 'phase14613-work-xp', '${d.department}', 'Operations', 'HIGH', '${fixture.roles.workspace}', 'Workspace Member', 'WORKSPACE_RULE', 'APPLIED', 0, 10, 2, 0, 12, '2024-01-19T00:00:00Z', '2024-01-19T00:00:00Z');

INSERT INTO gamification_xp_entries (id, workspace_id, membership_id, amount, entry_type, source_type, source_event, source_entity_id, idempotency_key, work_xp_event_id, actor_membership_id, reason, created_at)
VALUES ('${d.xpEntry}', '${fixture.workspaces[0]}', '${fixture.memberships.workspace[0]}', 12, 'EARN', 'TASK', 'TASK_COMPLETED', '${d.task}', 'phase14613-xp-entry', '${d.workXpEvent}', '${fixture.memberships.workspace[0]}', 'Legacy XP entry', '2024-01-19T00:00:01Z');

INSERT INTO gamification_global_score_events (id, workspace_id, recipient_membership_id, work_xp_event_id, work_type, source_entity_id, event_type, score_type, category_snapshot, normalized_score, status, occurred_at, idempotency_key, created_at)
VALUES ('${d.globalScore}', '${fixture.workspaces[0]}', '${fixture.memberships.workspace[0]}', '${d.workXpEvent}', 'TASK', '${d.task}', 'COMPLETION_AWARD', 'COMPLETION', 'HIGH', 12, 'APPLIED', '2024-01-19T00:00:00Z', 'phase14613-global-score', '2024-01-19T00:00:02Z');

INSERT INTO automation_workflows (id, workspace_id, name, description, status, created_by_membership_id, updated_by_membership_id, created_at, updated_at)
VALUES ('${d.automationWorkflow}', '${fixture.workspaces[0]}', 'Legacy Automation', 'Automation before hierarchy migration', 'PUBLISHED', '${fixture.memberships.workspace[0]}', '${fixture.memberships.workspace[0]}', '2024-01-20T00:00:00Z', '2024-01-20T00:00:00Z');

INSERT INTO automation_workflow_versions (id, workflow_id, workspace_id, version_number, state, definition_version, trigger_definition, nodes_definition, edges_definition, settings_definition, definition_size_bytes, created_by_membership_id, created_at, updated_at, published_at)
VALUES ('${d.automationVersion}', '${d.automationWorkflow}', '${fixture.workspaces[0]}', 1, 'PUBLISHED', '1', '{"type":"TASK_CREATED"}', '[]', '[]', '{}', 64, '${fixture.memberships.workspace[0]}', '2024-01-20T00:01:00Z', '2024-01-20T00:01:00Z', '2024-01-20T00:01:00Z');

UPDATE automation_workflows SET active_published_version_id = '${d.automationVersion}' WHERE id = '${d.automationWorkflow}';

INSERT INTO automation_domain_events (id, workspace_id, event_type, entity_type, entity_id, actor_membership_id, occurred_at, schema_version, correlation_id, automation_depth, payload, idempotency_key, created_at)
VALUES ('${d.automationDomainEvent}', '${fixture.workspaces[0]}', 'TASK_CREATED', 'TASK', '${d.task}', '${fixture.memberships.workspace[0]}', '2024-01-20T00:02:00Z', 1, 'phase14613-automation', 0, '{"taskId":"${d.task}"}', 'phase14613-domain-event', '2024-01-20T00:02:00Z');

INSERT INTO automation_trigger_matches (id, workspace_id, domain_event_id, workflow_id, workflow_version_id, trigger_node_id, status, runtime_eligible_at, created_at)
VALUES ('${d.automationTriggerMatch}', '${fixture.workspaces[0]}', '${d.automationDomainEvent}', '${d.automationWorkflow}', '${d.automationVersion}', 'trigger-1', 'MATCHED', '2024-01-20T00:02:00Z', '2024-01-20T00:02:00Z');

INSERT INTO automation_executions (id, workspace_id, trigger_match_id, domain_event_id, workflow_id, workflow_version_id, status, correlation_id, automation_depth, attempt_count, max_attempts, created_at, queued_at)
VALUES ('${d.automationExecution}', '${fixture.workspaces[0]}', '${d.automationTriggerMatch}', '${d.automationDomainEvent}', '${d.automationWorkflow}', '${d.automationVersion}', 'PENDING_QUEUE', 'phase14613-automation', 0, 0, 3, '2024-01-20T00:03:00Z', '2024-01-20T00:03:00Z');

INSERT INTO automation_step_executions (id, workspace_id, execution_id, workflow_version_id, node_id, node_type, sequence, action_type, status, attempt_count, invocation_key, result, created_at)
VALUES ('${d.automationStep}', '${fixture.workspaces[0]}', '${d.automationExecution}', '${d.automationVersion}', 'action-1', 'ACTION', 1, 'CREATE_TASK', 'PENDING', 0, 'phase14613-step-invocation', '{}', '2024-01-20T00:03:00Z');

INSERT INTO feature_definitions (id, key, name, description, enabled_by_default, created_at, updated_at)
VALUES ('${d.feature}', 'phase14613_legacy_feature', 'Legacy Feature', 'Feature entitlement before hierarchy migration', false, '2024-01-21T00:00:00Z', '2024-01-21T00:00:00Z');

INSERT INTO feature_entitlements (id, feature_id, agency_id, workspace_id, enabled, created_at, updated_at)
VALUES ('${d.entitlement}', '${d.feature}', '${fixture.agencies[0]}', '${fixture.workspaces[0]}', true, '2024-01-21T00:01:00Z', '2024-01-21T00:01:00Z');

INSERT INTO audit_logs (id, organization_id, agency_id, workspace_id, user_id, action, entity_type, entity_id, metadata, ip_address, user_agent, created_at) VALUES
  ('${d.auditLegacy}', '${fixture.organizations[0]}', NULL, NULL, '${fixture.users[0]}', 'legacy.organization.event', 'organization', '${fixture.organizations[0]}', '{"before":"migration"}', '127.0.0.1', 'phase14613', '2024-01-22T00:00:00Z'),
  ('${d.auditLineage}', NULL, '${fixture.agencies[0]}', '${fixture.workspaces[0]}', '${fixture.users[0]}', 'legacy.workspace.event', 'task', '${d.task}', '{"before":"migration"}', '127.0.0.1', 'phase14613', '2024-01-22T00:01:00Z');

COMMIT;
`;
}

function migratedAuditLineageSql() {
  const d = fixture.domain;
  return `
INSERT INTO audit_logs (id, super_agency_id, agency_id, workspace_id, user_id, action, entity_type, entity_id, metadata, ip_address, user_agent, created_at)
VALUES ('${d.auditNewLineage}', '${fixture.agencies[0]}', '${fixture.agencies[0]}', '${fixture.workspaces[0]}', '${fixture.users[0]}', 'new.super_agency.event', 'workspace', '${fixture.workspaces[0]}', '{"after":"migration"}', '127.0.0.1', 'phase14613', '2024-01-23T00:00:00Z');
`;
}

function phase152UpgradeFixtureSql() {
  const ids = {
    user: uuid('9500', 1),
    superAgency: uuid('9501', 1),
    agency: uuid('9502', 1),
    workspace: uuid('9503', 1),
    roleAgency: uuid('9504', 1),
    roleWorkspace: uuid('9504', 2),
    agencyMembership: uuid('9505', 1),
    workspaceMembership: uuid('9506', 1),
    plan: uuid('9507', 1),
    version: uuid('9508', 1),
    price: uuid('9509', 1),
    subscription: uuid('9510', 1),
    featureEntitlement: uuid('9511', 1),
    limitEntitlement: uuid('9511', 2),
    asset: uuid('9512', 1),
    apiKey: uuid('9513', 1),
    workflow: uuid('9514', 1),
    workflowVersion: uuid('9515', 1),
    xpEntry: uuid('9516', 1),
  };

  return `
BEGIN;

INSERT INTO users (id, email, name, password_hash, status, created_at, updated_at)
VALUES ('${ids.user}', 'phase152-upgrade@example.test', 'Phase 15.2 Upgrade User', 'phase152-hash', 'ACTIVE', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');

INSERT INTO roles (id, key, name, name_normalized, scope, is_system, is_active, workspace_id, description, created_at, updated_at) VALUES
  ('${ids.roleAgency}', 'phase152_agency_admin', 'Phase 15.2 Agency Admin', 'phase 15.2 agency admin', 'AGENCY', true, true, NULL, 'Phase 15.2 upgrade fixture role', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
  ('${ids.roleWorkspace}', 'phase152_workspace_admin', 'Phase 15.2 Workspace Admin', 'phase 15.2 workspace admin', 'WORKSPACE', true, true, NULL, 'Phase 15.2 upgrade fixture role', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');

INSERT INTO super_agencies (id, name, slug, status, created_by_id, created_at, updated_at)
VALUES ('${ids.superAgency}', 'Phase 15.2 Upgrade Super Agency', 'phase152-upgrade-super-agency', 'ACTIVE', '${ids.user}', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');

INSERT INTO agencies (id, super_agency_id, name, slug, status, created_by_id, created_at, updated_at)
VALUES ('${ids.agency}', '${ids.superAgency}', 'Phase 15.2 Upgrade Agency', 'phase152-upgrade-agency', 'ACTIVE', '${ids.user}', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');

INSERT INTO workspaces (id, agency_id, name, slug, timezone, status, storage_used_bytes, storage_limit_bytes, created_by_id, created_at, updated_at)
VALUES ('${ids.workspace}', '${ids.agency}', 'Phase 15.2 Upgrade Workspace', 'phase152-upgrade-workspace', 'UTC', 'ACTIVE', 64, 1024, '${ids.user}', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');

INSERT INTO agency_memberships (id, user_id, agency_id, role_id, status, created_at, updated_at)
VALUES ('${ids.agencyMembership}', '${ids.user}', '${ids.agency}', '${ids.roleAgency}', 'ACTIVE', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');

INSERT INTO workspace_memberships (id, user_id, workspace_id, role_id, status, created_at, updated_at)
VALUES ('${ids.workspaceMembership}', '${ids.user}', '${ids.workspace}', '${ids.roleWorkspace}', 'ACTIVE', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');

INSERT INTO master_plans (id, key, type, tier_rank, display_name, description, status, created_at, updated_at)
VALUES ('${ids.plan}', 'phase152_upgrade_plan', 'PUBLIC', 3, 'Phase 15.2 Upgrade Plan', 'Fixture plan before 0079', 'ACTIVE', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');

INSERT INTO master_plan_versions (id, master_plan_id, version_number, status, published_at, created_at, updated_at)
VALUES ('${ids.version}', '${ids.plan}', 1, 'PUBLISHED', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');

INSERT INTO plan_entitlements (id, plan_version_id, key, kind, value_type, boolean_value, numeric_value, unlimited, created_at, updated_at) VALUES
  ('${ids.featureEntitlement}', '${ids.version}', 'tasks.enabled', 'FEATURE', 'BOOLEAN', true, NULL, false, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
  ('${ids.limitEntitlement}', '${ids.version}', 'max_workspaces', 'LIMIT', 'COUNT', NULL, 15, false, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');

INSERT INTO billing_prices (id, master_plan_id, plan_version_id, provider, currency, interval, amount_minor, external_product_id, external_price_id, status, created_at, updated_at)
VALUES ('${ids.price}', '${ids.plan}', '${ids.version}', 'STRIPE', 'USD', 'MONTHLY', 9900, 'prod_phase152_upgrade', 'price_phase152_upgrade', 'ACTIVE', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');

INSERT INTO super_agency_subscriptions (id, super_agency_id, master_plan_id, plan_version_id, billing_price_id, provider, status, is_current, billing_interval, stripe_subscription_id, stripe_subscription_item_id, provider_status, current_period_start, current_period_end, started_at, created_at, updated_at)
VALUES ('${ids.subscription}', '${ids.superAgency}', '${ids.plan}', '${ids.version}', '${ids.price}', 'STRIPE', 'ACTIVE', true, 'MONTHLY', 'sub_phase152_upgrade', 'si_phase152_upgrade', 'active', '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');

INSERT INTO assets (id, workspace_id, created_by_id, uploaded_by_membership_id, original_filename, display_name, storage_bucket, storage_provider, storage_key, mime_type, extension, size_bytes, status, lifecycle, upload_expires_at, created_at, updated_at)
VALUES ('${ids.asset}', '${ids.workspace}', '${ids.user}', '${ids.workspaceMembership}', 'phase152.txt', 'phase152.txt', 'phase152-bucket', 'MINIO', 'phase152/object.txt', 'text/plain', 'txt', 64, 'READY', 'ACTIVE', '2026-10-01T00:00:00Z', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');

INSERT INTO api_keys (id, workspace_id, name, public_identifier, prefix, secret_hash, status, scopes, created_by_membership_id, created_at, updated_at)
VALUES ('${ids.apiKey}', '${ids.workspace}', 'Phase 15.2 API Key', 'phase152upgradeapikey00000001', 'phase152', 'hash:phase152', 'ACTIVE', ARRAY['tasks:read','tasks:write'], '${ids.workspaceMembership}', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');

INSERT INTO automation_workflows (id, workspace_id, name, status, created_by_membership_id, created_at, updated_at)
VALUES ('${ids.workflow}', '${ids.workspace}', 'Phase 15.2 Upgrade Workflow', 'DRAFT', '${ids.workspaceMembership}', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');

INSERT INTO automation_workflow_versions (id, workflow_id, workspace_id, version_number, state, definition_version, trigger_definition, nodes_definition, edges_definition, settings_definition, definition_size_bytes, created_by_membership_id, created_at, updated_at)
VALUES ('${ids.workflowVersion}', '${ids.workflow}', '${ids.workspace}', 1, 'DRAFT', '1', '{"type":"TASK_CREATED"}'::jsonb, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, 2, '${ids.workspaceMembership}', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');

INSERT INTO gamification_xp_entries (id, workspace_id, membership_id, amount, entry_type, source_type, source_event, idempotency_key, created_at)
VALUES ('${ids.xpEntry}', '${ids.workspace}', '${ids.workspaceMembership}', 25, 'EARN', 'SYSTEM', 'phase152-upgrade', 'phase152-upgrade-xp', '2026-09-01T00:00:00Z');

COMMIT;
`;
}

function phase16DocsFixtureSql() {
  const ids = {
    workspace: uuid('9503', 1),
    workspaceMembership: uuid('9506', 1),
    asset: uuid('9512', 1),
    folder: uuid('9520', 1),
    doc: uuid('9521', 1),
    access: uuid('9522', 1),
    version: uuid('9523', 1),
    comment: uuid('9524', 1),
    mention: uuid('9525', 1),
    favorite: uuid('9526', 1),
    share: uuid('9527', 1),
    attachment: uuid('9528', 1),
  };

  return `
BEGIN;

INSERT INTO doc_folders (id, workspace_id, name, sort_order, created_by_membership_id, created_at, updated_at)
VALUES ('${ids.folder}', '${ids.workspace}', 'Phase 16 Docs Upgrade Folder', 10, '${ids.workspaceMembership}', '2026-09-02T00:00:00Z', '2026-09-02T00:00:00Z');

INSERT INTO docs (id, workspace_id, folder_id, title, content, content_revision, visibility, type, status, sort_order, created_by_membership_id, updated_by_membership_id, last_snapshot_at, created_at, updated_at)
VALUES ('${ids.doc}', '${ids.workspace}', '${ids.folder}', 'Phase 16 Docs Upgrade Page', '{"type":"doc","content":[{"type":"paragraph","text":"phase16 docs upgrade"}]}'::jsonb, 2, 'SELECTED_MEMBERS', 'PAGE', 'ACTIVE', 20, '${ids.workspaceMembership}', '${ids.workspaceMembership}', '2026-09-02T00:05:00Z', '2026-09-02T00:01:00Z', '2026-09-02T00:06:00Z');

INSERT INTO doc_access (id, doc_id, workspace_id, membership_id, role, granted_by_membership_id, created_at, updated_at)
VALUES ('${ids.access}', '${ids.doc}', '${ids.workspace}', '${ids.workspaceMembership}', 'EDITOR', '${ids.workspaceMembership}', '2026-09-02T00:02:00Z', '2026-09-02T00:02:00Z');

INSERT INTO doc_versions (id, doc_id, workspace_id, revision, title_snapshot, content_snapshot, source, created_by_membership_id, created_at)
VALUES ('${ids.version}', '${ids.doc}', '${ids.workspace}', 2, 'Phase 16 Docs Upgrade Page', '{"type":"doc","content":[{"type":"paragraph","text":"phase16 docs upgrade snapshot"}]}'::jsonb, 'SNAPSHOT', '${ids.workspaceMembership}', '2026-09-02T00:05:00Z');

INSERT INTO doc_comments (id, doc_id, workspace_id, body, anchor, status, created_by_membership_id, updated_by_membership_id, created_at, updated_at)
VALUES ('${ids.comment}', '${ids.doc}', '${ids.workspace}', 'Preserved docs comment', '{"pos":1}'::jsonb, 'ACTIVE', '${ids.workspaceMembership}', '${ids.workspaceMembership}', '2026-09-02T00:07:00Z', '2026-09-02T00:07:00Z');

INSERT INTO doc_mentions (id, doc_id, workspace_id, comment_id, target_membership_id, created_by_membership_id, source, dedupe_key, created_at)
VALUES ('${ids.mention}', '${ids.doc}', '${ids.workspace}', '${ids.comment}', '${ids.workspaceMembership}', '${ids.workspaceMembership}', 'COMMENT', 'phase16-docs-upgrade-mention', '2026-09-02T00:08:00Z');

INSERT INTO doc_favorites (id, doc_id, workspace_id, membership_id, created_at)
VALUES ('${ids.favorite}', '${ids.doc}', '${ids.workspace}', '${ids.workspaceMembership}', '2026-09-02T00:09:00Z');

INSERT INTO doc_shares (id, doc_id, workspace_id, token_hash, status, expires_at, password_hash, created_by_membership_id, created_at, updated_at)
VALUES ('${ids.share}', '${ids.doc}', '${ids.workspace}', 'phase16-docs-upgrade-share-token-hash', 'ACTIVE', '2026-10-02T00:00:00Z', 'hash:phase16-docs-upgrade', '${ids.workspaceMembership}', '2026-09-02T00:10:00Z', '2026-09-02T00:10:00Z');

INSERT INTO doc_attachments (id, doc_id, workspace_id, asset_id, linked_by_membership_id, created_at)
VALUES ('${ids.attachment}', '${ids.doc}', '${ids.workspace}', '${ids.asset}', '${ids.workspaceMembership}', '2026-09-02T00:11:00Z');

COMMIT;
`;
}

function phase16FormsFixtureSql() {
  const ids = {
    user: uuid('9500', 1),
    workspace: uuid('9503', 1),
    workspaceMembership: uuid('9506', 1),
    form: uuid('9530', 1),
    formVersion: uuid('9531', 1),
    submission: uuid('9532', 1),
    asset: uuid('9533', 1),
    submissionAsset: uuid('9534', 1),
  };

  return `
BEGIN;

INSERT INTO forms (id, workspace_id, public_id, title, description, status, type, visibility, public_enabled, published_version_number, created_by_membership_id, updated_by_membership_id, created_at, updated_at)
VALUES ('${ids.form}', '${ids.workspace}', 'phase16-form-upgrade', 'Phase 16 Forms Upgrade', 'Public form fixture before 0083', 'PUBLISHED', 'FORM', 'PUBLIC', true, 1, '${ids.workspaceMembership}', '${ids.workspaceMembership}', '2026-09-03T00:00:00Z', '2026-09-03T00:01:00Z');

INSERT INTO form_versions (id, form_id, workspace_id, version_number, state, title_snapshot, description_snapshot, schema, settings, created_by_membership_id, published_by_membership_id, published_at, created_at)
VALUES ('${ids.formVersion}', '${ids.form}', '${ids.workspace}', 1, 'PUBLISHED', 'Phase 16 Forms Upgrade', 'Public form fixture before 0083', '{"fields":[{"id":"name","type":"text","label":"Name"},{"id":"upload","type":"file","label":"Upload"}]}'::jsonb, '{"allowPublic":true,"submitLimit":1}'::jsonb, '${ids.workspaceMembership}', '${ids.workspaceMembership}', '2026-09-03T00:01:00Z', '2026-09-03T00:00:00Z');

INSERT INTO form_submissions (id, form_id, form_version_id, workspace_id, source, status, submitted_by_membership_id, idempotency_key_hash, public_client_hash, answers, answer_summary, automation_status, submitted_at, created_at)
VALUES ('${ids.submission}', '${ids.form}', '${ids.formVersion}', '${ids.workspace}', 'PUBLIC', 'RECEIVED', NULL, 'phase16-form-upgrade-idempotency', 'phase16-public-client', '{"name":"Phase 16 Submitter","upload":"phase16-form-upload.txt"}'::jsonb, '{"name":"Phase 16 Submitter"}'::jsonb, 'QUEUED', '2026-09-03T00:02:00Z', '2026-09-03T00:02:00Z');

INSERT INTO assets (id, workspace_id, created_by_id, uploaded_by_membership_id, original_filename, display_name, storage_bucket, storage_provider, storage_key, mime_type, extension, size_bytes, status, lifecycle, source_module, source_entity_type, source_entity_id, metadata, upload_expires_at, created_at, updated_at)
VALUES ('${ids.asset}', '${ids.workspace}', '${ids.user}', '${ids.workspaceMembership}', 'phase16-form-upload.txt', 'phase16-form-upload.txt', 'phase16-bucket', 'MINIO', 'phase16/forms/upload.txt', 'text/plain', 'txt', 32, 'READY', 'ACTIVE', 'FORM', 'FORM_SUBMISSION', '${ids.submission}', '{"publicFormUpload":true,"fieldId":"upload"}'::jsonb, '2026-10-03T00:00:00Z', '2026-09-03T00:03:00Z', '2026-09-03T00:03:00Z');

INSERT INTO form_submission_assets (id, workspace_id, form_submission_id, form_id, form_version_id, asset_id, field_id, kind, created_at)
VALUES ('${ids.submissionAsset}', '${ids.workspace}', '${ids.submission}', '${ids.form}', '${ids.formVersion}', '${ids.asset}', 'upload', 'FILE', '2026-09-03T00:04:00Z');

COMMIT;
`;
}

function phase16GoalsFixtureSql() {
  const ids = {
    workspace: uuid('9503', 1),
    workspaceMembership: uuid('9506', 1),
    goal: uuid('9546', 1),
    goalEvent: uuid('9547', 1),
  };

  return `
BEGIN;

INSERT INTO goals (id, workspace_id, owner_type, metric_type, period_type, title, description, target_value, current_progress, status, period_start, period_end, created_by_membership_id, metadata, created_at, updated_at)
VALUES ('${ids.goal}', '${ids.workspace}', 'WORKSPACE', 'TASKS_COMPLETED', 'MONTHLY', 'Phase 16 Goals Upgrade', 'Preserve goal before 0084', 10, 2, 'ACTIVE', '2026-09-01T00:00:00Z', '2026-09-30T23:59:59Z', '${ids.workspaceMembership}', '{"safe":"phase16-goal"}'::jsonb, '2026-09-04T00:00:00Z', '2026-09-04T00:00:00Z');

INSERT INTO goal_progress_events (id, workspace_id, goal_id, source_type, idempotency_key, delta, value_after, occurred_at, actor_membership_id, note, created_at)
VALUES ('${ids.goalEvent}', '${ids.workspace}', '${ids.goal}', 'MANUAL', 'phase16-goal-progress', 2, 2, '2026-09-04T00:00:00Z', '${ids.workspaceMembership}', 'Phase 16 goal progress', '2026-09-04T00:00:00Z');

COMMIT;
`;
}

function phase171AnalyticsFixtureSql() {
  const ids = {
    workspace: uuid('9503', 1),
    rollup: uuid('9548', 1),
  };

  return `
BEGIN;

INSERT INTO analytics_rollups (id, scope_type, scope_id, workspace_id, metric_key, bucket, bucket_start, bucket_end, dimension_key, dimension_value, value, version, source_hash, rebuilt_at, created_at, updated_at)
VALUES ('${ids.rollup}', 'WORKSPACE', '${ids.workspace}', '${ids.workspace}', 'tasks.completed', 'DAY', '2026-09-05T00:00:00Z', '2026-09-06T00:00:00Z', 'status', 'done', 2.000000, 1, 'phase171-rollup', '2026-09-05T00:00:00Z', '2026-09-05T00:00:00Z', '2026-09-05T00:00:00Z');

COMMIT;
`;
}

function phase172PopulatedFixtureSql() {
  const ids = {
    user: uuid('9500', 1),
    superAgency: uuid('9501', 1),
    agency: uuid('9502', 1),
    workspace: uuid('9503', 1),
    roleSuper: uuid('9540', 1),
    superMembership: uuid('9541', 1),
    taskStatus: uuid('9542', 1),
    ticketStatus: uuid('9542', 2),
    task: uuid('9543', 1),
    project: uuid('9544', 1),
    ticket: uuid('9545', 1),
    goal: uuid('9546', 1),
    goalEvent: uuid('9547', 1),
    rollup: uuid('9548', 1),
    report: uuid('9549', 1),
    execution: uuid('9550', 1),
    export: uuid('9551', 1),
    schedule: uuid('9552', 1),
    occurrence: uuid('9553', 1),
    invoice: uuid('9554', 1),
    webhook: uuid('9555', 1),
    integration: uuid('9556', 1),
  };

  return `
BEGIN;

INSERT INTO roles (id, key, name, name_normalized, scope, is_system, is_active, created_at, updated_at)
VALUES ('${ids.roleSuper}', 'phase172_super_admin', 'Phase 17.2 Super Admin', 'phase 17.2 super admin', 'SUPER_AGENCY', true, true, '2026-09-05T00:00:00Z', '2026-09-05T00:00:00Z');

INSERT INTO super_agency_memberships (id, user_id, super_agency_id, role_id, status, created_at, updated_at)
VALUES ('${ids.superMembership}', '${ids.user}', '${ids.superAgency}', '${ids.roleSuper}', 'ACTIVE', '2026-09-05T00:00:00Z', '2026-09-05T00:00:00Z');

INSERT INTO status_definitions (id, workspace_id, entity_type, name, name_normalized, color, position, category, is_default, is_system, created_at, updated_at) VALUES
  ('${ids.taskStatus}', '${ids.workspace}', 'TASK', 'Todo', 'phase172-task-todo', '#3366ff', 1, 'TODO', true, true, '2026-09-05T00:00:00Z', '2026-09-05T00:00:00Z'),
  ('${ids.ticketStatus}', '${ids.workspace}', 'TICKET', 'Open', 'phase172-ticket-open', '#22aa66', 1, 'TODO', true, true, '2026-09-05T00:00:00Z', '2026-09-05T00:00:00Z');

INSERT INTO tasks (id, workspace_id, title, description, priority, status_definition_id, created_by_id, created_at, updated_at)
VALUES ('${ids.task}', '${ids.workspace}', 'Phase 17.2 Upgrade Task', 'Preserve task before 0086', 'HIGH', '${ids.taskStatus}', '${ids.user}', '2026-09-05T00:00:00Z', '2026-09-05T00:00:00Z');

INSERT INTO projects (id, workspace_id, name, description, status, visibility, owner_membership_id, created_by_id, created_at, updated_at)
VALUES ('${ids.project}', '${ids.workspace}', 'Phase 17.2 Upgrade Project', 'Preserve project before 0086', 'ACTIVE', 'WORKSPACE', '${uuid('9506', 1)}', '${ids.user}', '2026-09-05T00:00:00Z', '2026-09-05T00:00:00Z');

INSERT INTO tickets (id, workspace_id, sequence_number, ticket_number, subject, description, status_definition_id, priority, created_by_membership_id, created_at, updated_at)
VALUES ('${ids.ticket}', '${ids.workspace}', 172, 'P17-172', 'Phase 17.2 Upgrade Ticket', 'Preserve ticket before 0086', '${ids.ticketStatus}', 'HIGH', '${uuid('9506', 1)}', '2026-09-05T00:00:00Z', '2026-09-05T00:00:00Z');

INSERT INTO goals (id, workspace_id, owner_type, metric_type, period_type, title, description, target_value, current_progress, status, period_start, period_end, created_by_membership_id, metadata, created_at, updated_at)
VALUES ('${ids.goal}', '${ids.workspace}', 'WORKSPACE', 'TASKS_COMPLETED', 'MONTHLY', 'Phase 17.2 Upgrade Goal', 'Preserve goal before 0086', 10, 2, 'ACTIVE', '2026-09-01T00:00:00Z', '2026-09-30T23:59:59Z', '${uuid('9506', 1)}', '{"safe":"metadata"}'::jsonb, '2026-09-05T00:00:00Z', '2026-09-05T00:00:00Z');

INSERT INTO goal_progress_events (id, workspace_id, goal_id, source_type, idempotency_key, delta, value_after, occurred_at, actor_membership_id, note, created_at)
VALUES ('${ids.goalEvent}', '${ids.workspace}', '${ids.goal}', 'MANUAL', 'phase172-goal-progress', 2, 2, '2026-09-05T00:00:00Z', '${uuid('9506', 1)}', 'Phase 17.2 progress', '2026-09-05T00:00:00Z');

INSERT INTO analytics_rollups (id, scope_type, scope_id, workspace_id, metric_key, bucket, bucket_start, bucket_end, dimension_key, dimension_value, value, version, source_hash, rebuilt_at, created_at, updated_at)
VALUES ('${ids.rollup}', 'WORKSPACE', '${ids.workspace}', '${ids.workspace}', 'tasks.completed', 'DAY', '2026-09-05T00:00:00Z', '2026-09-06T00:00:00Z', 'status', 'done', 2.000000, 1, 'phase172-rollup', '2026-09-05T00:00:00Z', '2026-09-05T00:00:00Z', '2026-09-05T00:00:00Z');

INSERT INTO reports (id, scope_type, scope_id, workspace_id, agency_id, super_agency_id, created_by_user_id, created_by_workspace_membership_id, name, description, type, visibility, configuration, revision, status, created_at, updated_at)
VALUES ('${ids.report}', 'WORKSPACE', '${ids.workspace}', '${ids.workspace}', '${ids.agency}', '${ids.superAgency}', '${ids.user}', '${uuid('9506', 1)}', 'Phase 17.2 Upgrade Report', 'Preserve report before 0086', 'SUMMARY', 'SCOPE', '{"metric":"tasks.completed"}'::jsonb, 3, 'ACTIVE', '2026-09-05T00:00:00Z', '2026-09-05T00:00:00Z');

INSERT INTO report_executions (id, report_id, scope_type, scope_id, report_revision, config_snapshot, execution_type, status, requested_by_user_id, requested_by_membership_id, scheduled_occurrence_key, completed_at, row_count, created_at)
VALUES ('${ids.execution}', '${ids.report}', 'WORKSPACE', '${ids.workspace}', 3, '{"metric":"tasks.completed"}'::jsonb, 'SCHEDULED_EXPORT', 'SUCCEEDED', '${ids.user}', '${uuid('9506', 1)}', 'phase172-occurrence', '2026-09-05T00:05:00Z', 12, '2026-09-05T00:01:00Z');

INSERT INTO report_exports (id, report_id, execution_id, scope_type, scope_id, format, status, requested_by_user_id, requested_by_membership_id, report_revision, config_snapshot, filename, mime_type, storage_provider, storage_bucket, storage_key, size_bytes, row_count, idempotency_key, expires_at, completed_at, created_at, updated_at)
VALUES ('${ids.export}', '${ids.report}', '${ids.execution}', 'WORKSPACE', '${ids.workspace}', 'CSV', 'READY', '${ids.user}', '${uuid('9506', 1)}', 3, '{"metric":"tasks.completed"}'::jsonb, 'phase172.csv', 'text/csv', 'MINIO', 'phase172', 'reports/phase172.csv', 128, 12, 'phase172-export', '2026-10-05T00:00:00Z', '2026-09-05T00:06:00Z', '2026-09-05T00:02:00Z', '2026-09-05T00:06:00Z');

INSERT INTO report_schedules (id, report_id, scope_type, scope_id, frequency, timezone, local_time, enabled, recipient_config, next_run_at, created_by_user_id, created_at, updated_at)
VALUES ('${ids.schedule}', '${ids.report}', 'WORKSPACE', '${ids.workspace}', 'DAILY', 'UTC', '09:00', true, '{"emails":["phase172@example.test"]}'::jsonb, '2026-09-06T09:00:00Z', '${ids.user}', '2026-09-05T00:03:00Z', '2026-09-05T00:03:00Z');

INSERT INTO report_schedule_occurrences (id, schedule_id, occurrence_key, status, execution_id, export_id, claimed_at, completed_at, created_at)
VALUES ('${ids.occurrence}', '${ids.schedule}', 'phase172-occurrence', 'SUCCEEDED', '${ids.execution}', '${ids.export}', '2026-09-05T00:04:00Z', '2026-09-05T00:06:00Z', '2026-09-05T00:04:00Z');

INSERT INTO billing_invoices (id, super_agency_id, provider, provider_invoice_id, invoice_number, currency, status, amount_due_minor, amount_paid_minor, amount_remaining_minor, provider_created_at, created_at, updated_at)
VALUES ('${ids.invoice}', '${ids.superAgency}', 'STRIPE', 'in_phase172_upgrade', 'PHASE172-INV', 'USD', 'open', 5000, 0, 5000, '2026-09-05T00:00:00Z', '2026-09-05T00:00:00Z', '2026-09-05T00:00:00Z');

INSERT INTO webhook_subscriptions (id, workspace_id, name, description, endpoint_url, status, encrypted_secret, event_types, created_by_membership_id, created_at, updated_at)
VALUES ('${ids.webhook}', '${ids.workspace}', 'Phase 17.2 Upgrade Webhook', 'Preserve webhook metadata before 0086', 'https://example.test/phase172', 'ACTIVE', 'encrypted-phase172-webhook-secret', ARRAY['task.created'], '${uuid('9506', 1)}', '2026-09-05T00:00:00Z', '2026-09-05T00:00:00Z');

INSERT INTO integration_connections (id, workspace_id, provider, name, status, auth_type, provider_account_label, encrypted_credentials, scopes, capabilities, configuration_json, connected_by_membership_id, created_at, updated_at)
VALUES ('${ids.integration}', '${ids.workspace}', 'SLACK', 'Phase 17.2 Upgrade Integration', 'CONNECTED', 'OAUTH', 'phase172-account', 'encrypted-phase172-refresh-token', ARRAY['chat:write'], ARRAY['messages'], '{}'::jsonb, '${uuid('9506', 1)}', '2026-09-05T00:00:00Z', '2026-09-05T00:00:00Z');

COMMIT;
`;
}

function phase173SearchFixtureSql() {
  const ids = {
    user: uuid('9500', 1),
    workspace: uuid('9503', 1),
    agency: uuid('9502', 1),
    superAgency: uuid('9501', 1),
    workspaceMembership: uuid('9506', 1),
    task: uuid('9543', 1),
    searchDocument: uuid('9560', 1),
    recentSearch: uuid('9561', 1),
    searchJob: uuid('9562', 1),
  };

  return `
BEGIN;

INSERT INTO search_documents (id, scope_type, scope_id, workspace_id, agency_id, super_agency_id, entity_type, entity_id, title, subtitle, search_text, route, metadata, privacy_class, archived, source_updated_at, source_version, created_at, updated_at)
VALUES ('${ids.searchDocument}', 'WORKSPACE', '${ids.workspace}', '${ids.workspace}', '${ids.agency}', '${ids.superAgency}', 'TASK', '${ids.task}', 'Phase 17.3 Search Upgrade Task', 'Task', 'phase173 searchable task', '{"path":"/workspace/tasks"}'::jsonb, '{"safe":true}'::jsonb, 'WORKSPACE_OPERATIONAL', false, '2026-09-06T00:00:00Z', 1, '2026-09-06T00:00:00Z', '2026-09-06T00:00:00Z');

INSERT INTO recent_searches (id, user_id, scope_type, scope_id, workspace_membership_id, query, query_normalized, result_types, created_at, updated_at)
VALUES ('${ids.recentSearch}', '${ids.user}', 'WORKSPACE', '${ids.workspace}', '${ids.workspaceMembership}', 'phase173', 'phase173', ARRAY['TASK']::"SearchResultType"[], '2026-09-06T00:01:00Z', '2026-09-06T00:01:00Z');

INSERT INTO search_index_jobs (id, scope_type, scope_id, entity_type, entity_id, operation, status, source_updated_at, attempt_count, completed_at, payload, created_at, updated_at)
VALUES ('${ids.searchJob}', 'WORKSPACE', '${ids.workspace}', 'TASK', '${ids.task}', 'UPSERT', 'SUCCEEDED', '2026-09-06T00:00:00Z', 1, '2026-09-06T00:02:00Z', '{"source":"phase173"}'::jsonb, '2026-09-06T00:00:00Z', '2026-09-06T00:02:00Z');

COMMIT;
`;
}

function phase174DashboardFixtureSql() {
  const ids = {
    user: uuid('9500', 1),
    workspace: uuid('9503', 1),
    agency: uuid('9502', 1),
    superAgency: uuid('9501', 1),
    workspaceMembership: uuid('9506', 1),
    dashboard: uuid('9570', 1),
    access: uuid('9571', 1),
    preference: uuid('9572', 1),
  };

  const widgets = Array.from({ length: 30 }, (_, index) => {
    const widgetId = uuid('9580', index + 1);
    return `('${widgetId}', '${ids.dashboard}', 'METRIC_CARD', 'Widget ${index + 1}', 'ANALYTICS_QUERY', '{"metricKeys":["tasks.total"]}'::jsonb, '{"x":0,"y":${index},"width":4,"height":4,"order":${index}}'::jsonb, 60, '2026-09-07T00:00:00Z', '2026-09-07T00:00:00Z')`;
  }).join(',\n  ');

  return `
BEGIN;

INSERT INTO custom_dashboards (id, scope_type, scope_id, workspace_id, agency_id, super_agency_id, created_by_user_id, created_by_workspace_membership_id, name, description, visibility, global_filters, revision, status, created_at, updated_at)
VALUES ('${ids.dashboard}', 'WORKSPACE', '${ids.workspace}', '${ids.workspace}', '${ids.agency}', '${ids.superAgency}', '${ids.user}', '${ids.workspaceMembership}', 'Phase 17.4 Upgrade Dashboard', 'Preserve dashboard before 0088', 'WORKSPACE', '{"datePreset":"LAST_30_DAYS"}'::jsonb, 2, 'ACTIVE', '2026-09-07T00:00:00Z', '2026-09-07T00:00:00Z');

INSERT INTO dashboard_access (id, dashboard_id, scope_type, scope_id, workspace_membership_id, created_at)
VALUES ('${ids.access}', '${ids.dashboard}', 'WORKSPACE', '${ids.workspace}', '${ids.workspaceMembership}', '2026-09-07T00:00:00Z');

INSERT INTO dashboard_preferences (id, dashboard_id, scope_type, scope_id, user_id, is_favorite, is_default, context_key, created_at, updated_at)
VALUES ('${ids.preference}', '${ids.dashboard}', 'WORKSPACE', '${ids.workspace}', '${ids.user}', true, true, 'WORKSPACE:${ids.workspace}', '2026-09-07T00:00:00Z', '2026-09-07T00:00:00Z');

INSERT INTO dashboard_widgets (id, dashboard_id, type, title, data_source_type, configuration, layout, refresh_seconds, created_at, updated_at)
VALUES
  ${widgets};

COMMIT;
`;
}

function runCleanInstall() {
  resetDatabase(cleanDb);
  migrateDeploy(cleanDb, currentSchema);
  const seedOne = seed(cleanDb);
  const seedTwo = seed(cleanDb);
  const status = migrateStatus(cleanDb, currentSchema);

  assertZero(
    cleanDb,
    'clean install agencies without super_agency_id',
    `SELECT COUNT(*) FROM agencies WHERE super_agency_id IS NULL;`,
  );
  assertZero(
    cleanDb,
    'clean install invalid agency parent',
    `SELECT COUNT(*) FROM agencies a LEFT JOIN super_agencies s ON s.id = a.super_agency_id WHERE s.id IS NULL;`,
  );
  assertEqual(
    'clean install workspace super_agency_id column',
    tableColumnCount(cleanDb, 'workspaces', 'super_agency_id'),
    '0',
  );
  assertZero(
    cleanDb,
    'clean install duplicate permission keys after repeated seed',
    `SELECT COUNT(*) FROM (SELECT key FROM permissions GROUP BY key HAVING COUNT(*) > 1) duplicates;`,
  );
  assertZero(
    cleanDb,
    'clean install duplicate role keys after repeated seed',
    `SELECT COUNT(*) FROM (SELECT key FROM roles GROUP BY key HAVING COUNT(*) > 1) duplicates;`,
  );
  assertZero(
    cleanDb,
    'clean install duplicate super agency role names after repeated seed',
    `
    SELECT COUNT(*)
    FROM (
      SELECT COALESCE(workspace_id::TEXT, 'global') AS workspace_key, COALESCE(name_normalized, LOWER(name)) AS comparable_name
      FROM roles
      WHERE scope = 'SUPER_AGENCY'
      GROUP BY COALESCE(workspace_id::TEXT, 'global'), COALESCE(name_normalized, LOWER(name))
      HAVING COUNT(*) > 1
    ) duplicates;
    `,
  );

  return {
    database: cleanDb,
    migrations: psqlScalar(
      cleanDb,
      `SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;`,
    ),
    agencies: psqlScalar(cleanDb, `SELECT COUNT(*) FROM agencies;`),
    superAgencies: psqlScalar(cleanDb, `SELECT COUNT(*) FROM super_agencies;`),
    seedRuns: 2,
    seedOutputSeen:
      seedOne.stdout.includes('Seed completed') || seedTwo.stdout.includes('Seed completed'),
    statusUpToDate: /Database schema is up to date/i.test(status.stdout + status.stderr),
  };
}

function runLegacyUpgrade() {
  const legacy = buildLegacyPrismaDir();
  try {
    resetDatabase(legacyDb);
    migrateDeploy(legacyDb, legacy.schemaPath);
    assertPreSuperAgencySchema(legacyDb);
    psql(legacyDb, legacyFixtureSql());

    const preUpgrade = {
      agencies: psqlScalar(
        legacyDb,
        `SELECT COUNT(*) FROM agencies WHERE id IN (${fixtureLists.agencies});`,
      ),
      workspaces: psqlScalar(
        legacyDb,
        `SELECT COUNT(*) FROM workspaces WHERE id IN (${fixtureLists.workspaces});`,
      ),
      agencyMemberships: psqlScalar(
        legacyDb,
        `SELECT COUNT(*) FROM agency_memberships WHERE id IN (${fixtureLists.agencyMemberships});`,
      ),
      workspaceMemberships: psqlScalar(
        legacyDb,
        `SELECT COUNT(*) FROM workspace_memberships WHERE id IN (${fixtureLists.workspaceMemberships});`,
      ),
      objectKey: psqlScalar(
        legacyDb,
        `SELECT storage_key FROM assets WHERE id = '${fixture.domain.asset}';`,
      ),
      apiSecret: psqlScalar(
        legacyDb,
        `SELECT secret_hash FROM api_keys WHERE id = '${fixture.domain.apiKey}';`,
      ),
      webhookSecret: psqlScalar(
        legacyDb,
        `SELECT encrypted_secret FROM webhook_subscriptions WHERE id = '${fixture.domain.webhookSubscription}';`,
      ),
      inboundSecret: psqlScalar(
        legacyDb,
        `SELECT encrypted_signing_secret FROM inbound_webhook_sources WHERE id = '${fixture.domain.inboundSource}';`,
      ),
      integrationCredentials: psqlScalar(
        legacyDb,
        `SELECT encrypted_credentials FROM integration_connections WHERE id = '${fixture.domain.integrationConnection}';`,
      ),
      cloudAccessToken: psqlScalar(
        legacyDb,
        `SELECT encrypted_access_token FROM cloud_drive_connections WHERE id = '${fixture.domain.cloudDriveConnection}';`,
      ),
      activeAgencies: psqlScalar(
        legacyDb,
        `SELECT COUNT(*) FROM agencies WHERE id IN (${fixtureLists.agencies}) AND status = 'ACTIVE';`,
      ),
      suspendedAgencies: psqlScalar(
        legacyDb,
        `SELECT COUNT(*) FROM agencies WHERE id IN (${fixtureLists.agencies}) AND status = 'SUSPENDED';`,
      ),
      archivedAgencies: psqlScalar(
        legacyDb,
        `SELECT COUNT(*) FROM agencies WHERE id IN (${fixtureLists.agencies}) AND status = 'ARCHIVED';`,
      ),
      taskCount: psqlScalar(
        legacyDb,
        `SELECT COUNT(*) FROM tasks WHERE id = '${fixture.domain.task}';`,
      ),
      projectCount: psqlScalar(
        legacyDb,
        `SELECT COUNT(*) FROM projects WHERE id = '${fixture.domain.project}';`,
      ),
      ticketCount: psqlScalar(
        legacyDb,
        `SELECT COUNT(*) FROM tickets WHERE id = '${fixture.domain.ticket}';`,
      ),
      xpSum: psqlScalar(
        legacyDb,
        `SELECT COALESCE(SUM(amount), 0) FROM gamification_xp_entries WHERE id = '${fixture.domain.xpEntry}';`,
      ),
      globalScoreSum: psqlScalar(
        legacyDb,
        `SELECT COALESCE(SUM(normalized_score), 0) FROM gamification_global_score_events WHERE id = '${fixture.domain.globalScore}';`,
      ),
    };

    migrateDeploy(legacyDb, currentSchema);
    assertZero(
      legacyDb,
      'legacy upgrade unsafe super agency auto-promotion before seed',
      `SELECT COUNT(*) FROM super_agency_memberships WHERE super_agency_id IN (${fixtureLists.agencies});`,
    );
    seed(legacyDb);
    seed(legacyDb);
    psql(legacyDb, migratedAuditLineageSql());
    const status = migrateStatus(legacyDb, currentSchema);

    assertEqual('legacy agency fixture count', preUpgrade.agencies, '3');
    assertEqual('legacy workspace fixture count', preUpgrade.workspaces, '4');
    assertEqual('legacy agency membership fixture count', preUpgrade.agencyMemberships, '3');
    assertEqual('legacy workspace membership fixture count', preUpgrade.workspaceMemberships, '4');

    assertZero(
      legacyDb,
      'legacy upgrade agencies without super_agency_id',
      `SELECT COUNT(*) FROM agencies WHERE id IN (${fixtureLists.agencies}) AND super_agency_id IS NULL;`,
    );
    assertZero(
      legacyDb,
      'legacy upgrade agencies not mapped to same-id compatibility parent',
      `SELECT COUNT(*) FROM agencies WHERE id IN (${fixtureLists.agencies}) AND super_agency_id <> id;`,
    );
    assertEqual(
      'legacy upgrade compatibility super agency count',
      psqlScalar(
        legacyDb,
        `SELECT COUNT(*) FROM super_agencies WHERE id IN (${fixtureLists.agencies});`,
      ),
      '3',
    );
    assertZero(
      legacyDb,
      'legacy upgrade unsafe super agency auto-promotion',
      `SELECT COUNT(*) FROM super_agency_memberships WHERE super_agency_id IN (${fixtureLists.agencies});`,
    );
    assertEqual(
      'legacy upgrade agency memberships preserved',
      psqlScalar(
        legacyDb,
        `SELECT COUNT(*) FROM agency_memberships WHERE id IN (${fixtureLists.agencyMemberships});`,
      ),
      preUpgrade.agencyMemberships,
    );
    assertEqual(
      'legacy upgrade workspace memberships preserved',
      psqlScalar(
        legacyDb,
        `SELECT COUNT(*) FROM workspace_memberships WHERE id IN (${fixtureLists.workspaceMemberships});`,
      ),
      preUpgrade.workspaceMemberships,
    );
    assertZero(
      legacyDb,
      'legacy upgrade workspace agency remap',
      `SELECT COUNT(*) FROM workspaces WHERE id = '${fixture.workspaces[0]}' AND agency_id <> '${fixture.agencies[0]}';`,
    );
    assertEqual(
      'legacy active agency status preserved',
      psqlScalar(
        legacyDb,
        `SELECT COUNT(*) FROM agencies WHERE id IN (${fixtureLists.agencies}) AND status = 'ACTIVE';`,
      ),
      preUpgrade.activeAgencies,
    );
    assertEqual(
      'legacy suspended agency status preserved',
      psqlScalar(
        legacyDb,
        `SELECT COUNT(*) FROM agencies WHERE id IN (${fixtureLists.agencies}) AND status = 'SUSPENDED';`,
      ),
      preUpgrade.suspendedAgencies,
    );
    assertEqual(
      'legacy archived agency status preserved',
      psqlScalar(
        legacyDb,
        `SELECT COUNT(*) FROM agencies WHERE id IN (${fixtureLists.agencies}) AND status = 'ARCHIVED';`,
      ),
      preUpgrade.archivedAgencies,
    );
    assertZero(
      legacyDb,
      'legacy upgrade operational super_agency_id columns',
      `
      SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name = 'super_agency_id'
        AND table_name NOT IN (
          'agencies',
          'super_agency_memberships',
          'super_agency_invitations',
          'feature_entitlements',
          'audit_logs',
          'super_agency_subscriptions',
          'super_agency_billing_accounts',
          'billing_checkout_attempts',
          'stripe_billing_events',
          'billing_history',
          'billing_invoices',
          'reports',
          'search_documents',
          'custom_dashboards'
        );
      `,
    );
    assertEqual(
      'legacy upgrade workspace super_agency_id column',
      tableColumnCount(legacyDb, 'workspaces', 'super_agency_id'),
      '0',
    );
    assertEqual(
      'legacy upgrade feature_entitlements super_agency_id column',
      tableColumnCount(legacyDb, 'feature_entitlements', 'super_agency_id'),
      '1',
    );
    assertEqual(
      'legacy upgrade audit_logs super_agency_id column',
      tableColumnCount(legacyDb, 'audit_logs', 'super_agency_id'),
      '1',
    );
    assertOne(
      legacyDb,
      'legacy audit row remains organization-compatible with null super agency',
      `SELECT COUNT(*) FROM audit_logs WHERE id = '${fixture.domain.auditLegacy}' AND organization_id = '${fixture.organizations[0]}' AND super_agency_id IS NULL;`,
    );
    assertOne(
      legacyDb,
      'new audit row accepts super agency lineage',
      `SELECT COUNT(*) FROM audit_logs WHERE id = '${fixture.domain.auditNewLineage}' AND super_agency_id = '${fixture.agencies[0]}' AND agency_id = '${fixture.agencies[0]}' AND workspace_id = '${fixture.workspaces[0]}';`,
    );
    assertEqual(
      'legacy object key preserved',
      psqlScalar(legacyDb, `SELECT storage_key FROM assets WHERE id = '${fixture.domain.asset}';`),
      preUpgrade.objectKey,
    );
    assertEqual(
      'legacy api key secret preserved',
      psqlScalar(
        legacyDb,
        `SELECT secret_hash FROM api_keys WHERE id = '${fixture.domain.apiKey}';`,
      ),
      preUpgrade.apiSecret,
    );
    assertEqual(
      'legacy webhook secret preserved',
      psqlScalar(
        legacyDb,
        `SELECT encrypted_secret FROM webhook_subscriptions WHERE id = '${fixture.domain.webhookSubscription}';`,
      ),
      preUpgrade.webhookSecret,
    );
    assertEqual(
      'legacy inbound secret preserved',
      psqlScalar(
        legacyDb,
        `SELECT encrypted_signing_secret FROM inbound_webhook_sources WHERE id = '${fixture.domain.inboundSource}';`,
      ),
      preUpgrade.inboundSecret,
    );
    assertEqual(
      'legacy integration credentials preserved',
      psqlScalar(
        legacyDb,
        `SELECT encrypted_credentials FROM integration_connections WHERE id = '${fixture.domain.integrationConnection}';`,
      ),
      preUpgrade.integrationCredentials,
    );
    assertEqual(
      'legacy cloud drive token preserved',
      psqlScalar(
        legacyDb,
        `SELECT encrypted_access_token FROM cloud_drive_connections WHERE id = '${fixture.domain.cloudDriveConnection}';`,
      ),
      preUpgrade.cloudAccessToken,
    );
    assertEqual(
      'legacy task count preserved',
      psqlScalar(legacyDb, `SELECT COUNT(*) FROM tasks WHERE id = '${fixture.domain.task}';`),
      preUpgrade.taskCount,
    );
    assertEqual(
      'legacy project count preserved',
      psqlScalar(legacyDb, `SELECT COUNT(*) FROM projects WHERE id = '${fixture.domain.project}';`),
      preUpgrade.projectCount,
    );
    assertEqual(
      'legacy ticket count preserved',
      psqlScalar(legacyDb, `SELECT COUNT(*) FROM tickets WHERE id = '${fixture.domain.ticket}';`),
      preUpgrade.ticketCount,
    );
    assertEqual(
      'legacy XP sum preserved',
      psqlScalar(
        legacyDb,
        `SELECT COALESCE(SUM(amount), 0) FROM gamification_xp_entries WHERE id = '${fixture.domain.xpEntry}';`,
      ),
      preUpgrade.xpSum,
    );
    assertEqual(
      'legacy global score sum preserved',
      psqlScalar(
        legacyDb,
        `SELECT COALESCE(SUM(normalized_score), 0) FROM gamification_global_score_events WHERE id = '${fixture.domain.globalScore}';`,
      ),
      preUpgrade.globalScoreSum,
    );
    assertZero(
      legacyDb,
      'legacy upgrade unvalidated constraints',
      `SELECT COUNT(*) FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND NOT convalidated;`,
    );
    assertZero(
      legacyDb,
      'legacy upgrade automatic Stripe billing accounts',
      `SELECT COUNT(*) FROM super_agency_billing_accounts;`,
    );
    assertZero(
      legacyDb,
      'legacy upgrade automatic checkout attempts',
      `SELECT COUNT(*) FROM billing_checkout_attempts;`,
    );
    assertZero(
      legacyDb,
      'legacy upgrade automatic Stripe billing events',
      `SELECT COUNT(*) FROM stripe_billing_events;`,
    );
    assertZero(
      legacyDb,
      'legacy upgrade automatic Phase 15.2 trial/customer lifecycle',
      `
      SELECT COUNT(*)
      FROM super_agency_subscriptions
      WHERE super_agency_id IN (${fixtureLists.agencies})
         OR stripe_subscription_id IS NOT NULL
         OR billing_price_id IS NOT NULL;
      `,
    );

    const requiredRows = [
      ['tasks', fixture.domain.task],
      ['projects', fixture.domain.project],
      ['tickets', fixture.domain.ticket],
      ['status_definitions', fixture.domain.taskStatus],
      ['departments', fixture.domain.department],
      ['assets', fixture.domain.asset],
      ['processing_jobs', fixture.domain.processingJob],
      ['calendar_events', fixture.domain.calendarEvent],
      ['notifications', fixture.domain.notification],
      ['api_keys', fixture.domain.apiKey],
      ['webhook_subscriptions', fixture.domain.webhookSubscription],
      ['webhook_events', fixture.domain.webhookEvent],
      ['webhook_deliveries', fixture.domain.webhookDelivery],
      ['inbound_webhook_sources', fixture.domain.inboundSource],
      ['inbound_webhook_events', fixture.domain.inboundEvent],
      ['normalized_inbound_events', fixture.domain.normalizedInboundEvent],
      ['integration_connections', fixture.domain.integrationConnection],
      ['integration_action_executions', fixture.domain.integrationAction],
      ['integration_action_idempotency_records', fixture.domain.integrationIdempotency],
      ['cloud_drive_connections', fixture.domain.cloudDriveConnection],
      ['storage_upload_reservations', fixture.domain.uploadReservation],
      ['gamification_work_xp_events', fixture.domain.workXpEvent],
      ['gamification_xp_entries', fixture.domain.xpEntry],
      ['gamification_global_score_events', fixture.domain.globalScore],
      ['automation_workflows', fixture.domain.automationWorkflow],
      ['automation_workflow_versions', fixture.domain.automationVersion],
      ['automation_domain_events', fixture.domain.automationDomainEvent],
      ['automation_trigger_matches', fixture.domain.automationTriggerMatch],
      ['automation_executions', fixture.domain.automationExecution],
      ['automation_step_executions', fixture.domain.automationStep],
    ];

    for (const [table, id] of requiredRows) {
      assertOne(
        legacyDb,
        `legacy preserved row ${table}.${id}`,
        `SELECT COUNT(*) FROM ${table} WHERE id = '${id}';`,
      );
    }

    return {
      database: legacyDb,
      migrations: psqlScalar(
        legacyDb,
        `SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;`,
      ),
      preUpgrade,
      compatibilitySuperAgencies: psqlScalar(
        legacyDb,
        `SELECT COUNT(*) FROM super_agencies WHERE id IN (${fixtureLists.agencies});`,
      ),
      unsafeSuperAgencyPromotions: psqlScalar(
        legacyDb,
        `SELECT COUNT(*) FROM super_agency_memberships WHERE super_agency_id IN (${fixtureLists.agencies});`,
      ),
      orphanedAgencies: psqlScalar(
        legacyDb,
        `SELECT COUNT(*) FROM agencies a LEFT JOIN super_agencies s ON s.id = a.super_agency_id WHERE s.id IS NULL;`,
      ),
      statusUpToDate: /Database schema is up to date/i.test(status.stdout + status.stderr),
    };
  } finally {
    if (existsSync(legacy.tempRoot) && legacy.tempRoot.startsWith(path.join(repoRoot, '.tmp'))) {
      rmSync(legacy.tempRoot, { recursive: true, force: true });
    }
  }
}

function runPhase152Upgrade() {
  const phase152 = buildPhase152PrismaDir();
  try {
    resetDatabase(phase15Db);
    migrateDeploy(phase15Db, phase152.schemaPath);
    psql(phase15Db, phase152UpgradeFixtureSql());

    const preUpgrade = {
      superAgencies: psqlScalar(
        phase15Db,
        `SELECT COUNT(*) FROM super_agencies WHERE slug = 'phase152-upgrade-super-agency';`,
      ),
      agencies: psqlScalar(
        phase15Db,
        `SELECT COUNT(*) FROM agencies WHERE slug = 'phase152-upgrade-agency';`,
      ),
      workspaces: psqlScalar(
        phase15Db,
        `SELECT COUNT(*) FROM workspaces WHERE slug = 'phase152-upgrade-workspace';`,
      ),
      subscriptions: psqlScalar(
        phase15Db,
        `SELECT COUNT(*) FROM super_agency_subscriptions WHERE stripe_subscription_id = 'sub_phase152_upgrade';`,
      ),
      prices: psqlScalar(
        phase15Db,
        `SELECT COUNT(*) FROM billing_prices WHERE external_price_id = 'price_phase152_upgrade';`,
      ),
      entitlements: psqlScalar(
        phase15Db,
        `SELECT COUNT(*) FROM plan_entitlements WHERE plan_version_id = '${uuid('9508', 1)}';`,
      ),
      memberships: psqlScalar(
        phase15Db,
        `SELECT COUNT(*) FROM workspace_memberships WHERE id = '${uuid('9506', 1)}';`,
      ),
      assets: psqlScalar(
        phase15Db,
        `SELECT COUNT(*) FROM assets WHERE storage_key = 'phase152/object.txt';`,
      ),
      apiKeys: psqlScalar(
        phase15Db,
        `SELECT COUNT(*) FROM api_keys WHERE public_identifier = 'phase152upgradeapikey00000001';`,
      ),
      automationWorkflows: psqlScalar(
        phase15Db,
        `SELECT COUNT(*) FROM automation_workflows WHERE id = '${uuid('9514', 1)}';`,
      ),
      xpSum: psqlScalar(
        phase15Db,
        `SELECT COALESCE(SUM(amount), 0) FROM gamification_xp_entries WHERE id = '${uuid('9516', 1)}';`,
      ),
    };

    migrateDeploy(phase15Db, currentSchema);
    const status = migrateStatus(phase15Db, currentSchema);

    assertEqual('phase15 upgrade super agency preserved', preUpgrade.superAgencies, '1');
    assertEqual('phase15 upgrade agency preserved', preUpgrade.agencies, '1');
    assertEqual('phase15 upgrade workspace preserved', preUpgrade.workspaces, '1');
    assertEqual('phase15 upgrade subscription preserved', preUpgrade.subscriptions, '1');
    assertEqual('phase15 upgrade billing price preserved', preUpgrade.prices, '1');
    assertEqual('phase15 upgrade entitlements preserved', preUpgrade.entitlements, '2');
    assertEqual('phase15 upgrade workspace membership preserved', preUpgrade.memberships, '1');
    assertEqual('phase15 upgrade asset preserved', preUpgrade.assets, '1');
    assertEqual('phase15 upgrade API key preserved', preUpgrade.apiKeys, '1');
    assertEqual(
      'phase15 upgrade automation workflow preserved',
      preUpgrade.automationWorkflows,
      '1',
    );
    assertEqual('phase15 upgrade XP preserved', preUpgrade.xpSum, '25');
    assertZero(
      phase15Db,
      'phase15 upgrade automatic agency allocations',
      `SELECT COUNT(*) FROM agency_resource_allocations;`,
    );
    assertZero(
      phase15Db,
      'phase15 upgrade automatic workspace allocations',
      `SELECT COUNT(*) FROM workspace_resource_allocations;`,
    );
    assertZero(
      phase15Db,
      'phase15 upgrade automatic usage counters',
      `SELECT COUNT(*) FROM billing_usage_counters;`,
    );
    assertZero(
      phase15Db,
      'phase15 upgrade automatic invoice projections',
      `SELECT COUNT(*) FROM billing_invoices;`,
    );

    return {
      database: phase15Db,
      migrations: psqlScalar(
        phase15Db,
        `SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;`,
      ),
      preUpgrade,
      automaticAgencyAllocations: psqlScalar(
        phase15Db,
        `SELECT COUNT(*) FROM agency_resource_allocations;`,
      ),
      automaticWorkspaceAllocations: psqlScalar(
        phase15Db,
        `SELECT COUNT(*) FROM workspace_resource_allocations;`,
      ),
      automaticUsageCounters: psqlScalar(phase15Db, `SELECT COUNT(*) FROM billing_usage_counters;`),
      automaticInvoiceProjections: psqlScalar(phase15Db, `SELECT COUNT(*) FROM billing_invoices;`),
      statusUpToDate: /Database schema is up to date/i.test(status.stdout + status.stderr),
    };
  } finally {
    if (
      existsSync(phase152.tempRoot) &&
      phase152.tempRoot.startsWith(path.join(repoRoot, '.tmp'))
    ) {
      rmSync(phase152.tempRoot, { recursive: true, force: true });
    }
  }
}

function runPhase154Upgrade() {
  const phase154 = buildPhase154PrismaDir();
  try {
    resetDatabase(phase154Db);
    migrateDeploy(phase154Db, phase154.schemaPath);
    psql(phase154Db, phase152UpgradeFixtureSql());

    const preUpgrade = {
      superAgencies: psqlScalar(
        phase154Db,
        `SELECT COUNT(*) FROM super_agencies WHERE slug = 'phase152-upgrade-super-agency';`,
      ),
      agencies: psqlScalar(
        phase154Db,
        `SELECT COUNT(*) FROM agencies WHERE slug = 'phase152-upgrade-agency';`,
      ),
      workspaces: psqlScalar(
        phase154Db,
        `SELECT COUNT(*) FROM workspaces WHERE slug = 'phase152-upgrade-workspace';`,
      ),
      subscriptions: psqlScalar(
        phase154Db,
        `SELECT COUNT(*) FROM super_agency_subscriptions WHERE stripe_subscription_id = 'sub_phase152_upgrade';`,
      ),
      prices: psqlScalar(
        phase154Db,
        `SELECT COUNT(*) FROM billing_prices WHERE external_price_id = 'price_phase152_upgrade';`,
      ),
      entitlements: psqlScalar(
        phase154Db,
        `SELECT COUNT(*) FROM plan_entitlements WHERE plan_version_id = '${uuid('9508', 1)}';`,
      ),
      memberships: psqlScalar(
        phase154Db,
        `SELECT COUNT(*) FROM workspace_memberships WHERE id = '${uuid('9506', 1)}';`,
      ),
      assets: psqlScalar(
        phase154Db,
        `SELECT COUNT(*) FROM assets WHERE storage_key = 'phase152/object.txt';`,
      ),
      apiKeys: psqlScalar(
        phase154Db,
        `SELECT COUNT(*) FROM api_keys WHERE public_identifier = 'phase152upgradeapikey00000001';`,
      ),
      automationWorkflows: psqlScalar(
        phase154Db,
        `SELECT COUNT(*) FROM automation_workflows WHERE id = '${uuid('9514', 1)}';`,
      ),
      xpSum: psqlScalar(
        phase154Db,
        `SELECT COALESCE(SUM(amount), 0) FROM gamification_xp_entries WHERE id = '${uuid('9516', 1)}';`,
      ),
    };

    migrateDeploy(phase154Db, currentSchema);
    const status = migrateStatus(phase154Db, currentSchema);

    assertEqual('phase15.4 upgrade super agency preserved', preUpgrade.superAgencies, '1');
    assertEqual('phase15.4 upgrade agency preserved', preUpgrade.agencies, '1');
    assertEqual('phase15.4 upgrade workspace preserved', preUpgrade.workspaces, '1');
    assertEqual('phase15.4 upgrade subscription preserved', preUpgrade.subscriptions, '1');
    assertEqual('phase15.4 upgrade billing price preserved', preUpgrade.prices, '1');
    assertEqual('phase15.4 upgrade entitlements preserved', preUpgrade.entitlements, '2');
    assertEqual('phase15.4 upgrade workspace membership preserved', preUpgrade.memberships, '1');
    assertEqual('phase15.4 upgrade asset preserved', preUpgrade.assets, '1');
    assertEqual('phase15.4 upgrade API key preserved', preUpgrade.apiKeys, '1');
    assertEqual(
      'phase15.4 upgrade automation workflow preserved',
      preUpgrade.automationWorkflows,
      '1',
    );
    assertEqual('phase15.4 upgrade XP preserved', preUpgrade.xpSum, '25');
    assertZero(phase154Db, 'phase15.4 upgrade automatic docs', `SELECT COUNT(*) FROM docs;`);
    assertZero(phase154Db, 'phase15.4 upgrade automatic forms', `SELECT COUNT(*) FROM forms;`);
    assertZero(phase154Db, 'phase15.4 upgrade automatic goals', `SELECT COUNT(*) FROM goals;`);
    assertZero(
      phase154Db,
      'phase15.4 upgrade automatic agency allocations',
      `SELECT COUNT(*) FROM agency_resource_allocations;`,
    );
    assertZero(
      phase154Db,
      'phase15.4 upgrade automatic workspace allocations',
      `SELECT COUNT(*) FROM workspace_resource_allocations;`,
    );
    assertZero(
      phase154Db,
      'phase15.4 upgrade automatic usage counters',
      `SELECT COUNT(*) FROM billing_usage_counters;`,
    );
    assertZero(
      phase154Db,
      'phase15.4 upgrade automatic invoice projections',
      `SELECT COUNT(*) FROM billing_invoices;`,
    );

    return {
      database: phase154Db,
      migrations: psqlScalar(
        phase154Db,
        `SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;`,
      ),
      preUpgrade,
      automaticDocs: psqlScalar(phase154Db, `SELECT COUNT(*) FROM docs;`),
      automaticForms: psqlScalar(phase154Db, `SELECT COUNT(*) FROM forms;`),
      automaticGoals: psqlScalar(phase154Db, `SELECT COUNT(*) FROM goals;`),
      automaticAgencyAllocations: psqlScalar(
        phase154Db,
        `SELECT COUNT(*) FROM agency_resource_allocations;`,
      ),
      automaticWorkspaceAllocations: psqlScalar(
        phase154Db,
        `SELECT COUNT(*) FROM workspace_resource_allocations;`,
      ),
      automaticUsageCounters: psqlScalar(
        phase154Db,
        `SELECT COUNT(*) FROM billing_usage_counters;`,
      ),
      automaticInvoiceProjections: psqlScalar(phase154Db, `SELECT COUNT(*) FROM billing_invoices;`),
      statusUpToDate: /Database schema is up to date/i.test(status.stdout + status.stderr),
    };
  } finally {
    if (
      existsSync(phase154.tempRoot) &&
      phase154.tempRoot.startsWith(path.join(repoRoot, '.tmp'))
    ) {
      rmSync(phase154.tempRoot, { recursive: true, force: true });
    }
  }
}

function runPhase161Upgrade() {
  const phase161 = buildPhase161PrismaDir();
  try {
    resetDatabase(phase161Db);
    migrateDeploy(phase161Db, phase161.schemaPath);
    psql(phase161Db, phase152UpgradeFixtureSql());
    psql(phase161Db, phase16DocsFixtureSql());

    const preUpgrade = {
      docs: psqlScalar(phase161Db, `SELECT COUNT(*) FROM docs WHERE id = '${uuid('9521', 1)}';`),
      folders: psqlScalar(
        phase161Db,
        `SELECT COUNT(*) FROM doc_folders WHERE id = '${uuid('9520', 1)}';`,
      ),
      access: psqlScalar(
        phase161Db,
        `SELECT COUNT(*) FROM doc_access WHERE id = '${uuid('9522', 1)}';`,
      ),
      versions: psqlScalar(
        phase161Db,
        `SELECT COUNT(*) FROM doc_versions WHERE id = '${uuid('9523', 1)}';`,
      ),
      comments: psqlScalar(
        phase161Db,
        `SELECT COUNT(*) FROM doc_comments WHERE id = '${uuid('9524', 1)}';`,
      ),
      shares: psqlScalar(
        phase161Db,
        `SELECT COUNT(*) FROM doc_shares WHERE id = '${uuid('9527', 1)}';`,
      ),
      attachments: psqlScalar(
        phase161Db,
        `SELECT COUNT(*) FROM doc_attachments WHERE id = '${uuid('9528', 1)}';`,
      ),
    };

    migrateDeploy(phase161Db, currentSchema);
    const status = migrateStatus(phase161Db, currentSchema);

    assertEqual('phase16.1 upgrade doc preserved', preUpgrade.docs, '1');
    assertEqual('phase16.1 upgrade folder preserved', preUpgrade.folders, '1');
    assertEqual('phase16.1 upgrade access preserved', preUpgrade.access, '1');
    assertEqual('phase16.1 upgrade version preserved', preUpgrade.versions, '1');
    assertEqual('phase16.1 upgrade comment preserved', preUpgrade.comments, '1');
    assertEqual('phase16.1 upgrade share preserved', preUpgrade.shares, '1');
    assertEqual('phase16.1 upgrade attachment preserved', preUpgrade.attachments, '1');
    assertZero(phase161Db, 'phase16.1 upgrade automatic forms', `SELECT COUNT(*) FROM forms;`);
    assertZero(phase161Db, 'phase16.1 upgrade automatic goals', `SELECT COUNT(*) FROM goals;`);

    return {
      database: phase161Db,
      migrations: psqlScalar(
        phase161Db,
        `SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;`,
      ),
      preUpgrade,
      docsAfterUpgrade: psqlScalar(phase161Db, `SELECT COUNT(*) FROM docs;`),
      formsAfterUpgrade: psqlScalar(phase161Db, `SELECT COUNT(*) FROM forms;`),
      goalsAfterUpgrade: psqlScalar(phase161Db, `SELECT COUNT(*) FROM goals;`),
      statusUpToDate: /Database schema is up to date/i.test(status.stdout + status.stderr),
    };
  } finally {
    if (
      existsSync(phase161.tempRoot) &&
      phase161.tempRoot.startsWith(path.join(repoRoot, '.tmp'))
    ) {
      rmSync(phase161.tempRoot, { recursive: true, force: true });
    }
  }
}

function runPhase162Upgrade() {
  const phase162 = buildPhase162PrismaDir();
  try {
    resetDatabase(phase162Db);
    migrateDeploy(phase162Db, phase162.schemaPath);
    psql(phase162Db, phase152UpgradeFixtureSql());
    psql(phase162Db, phase16DocsFixtureSql());
    psql(phase162Db, phase16FormsFixtureSql());

    const preUpgrade = {
      docs: psqlScalar(phase162Db, `SELECT COUNT(*) FROM docs WHERE id = '${uuid('9521', 1)}';`),
      forms: psqlScalar(phase162Db, `SELECT COUNT(*) FROM forms WHERE id = '${uuid('9530', 1)}';`),
      formVersions: psqlScalar(
        phase162Db,
        `SELECT COUNT(*) FROM form_versions WHERE id = '${uuid('9531', 1)}';`,
      ),
      submissions: psqlScalar(
        phase162Db,
        `SELECT COUNT(*) FROM form_submissions WHERE id = '${uuid('9532', 1)}';`,
      ),
      formAssets: psqlScalar(
        phase162Db,
        `SELECT COUNT(*) FROM form_submission_assets WHERE id = '${uuid('9534', 1)}';`,
      ),
      publicUploadAssets: psqlScalar(
        phase162Db,
        `SELECT COUNT(*) FROM assets WHERE id = '${uuid('9533', 1)}' AND source_module = 'FORM';`,
      ),
    };

    migrateDeploy(phase162Db, currentSchema);
    const status = migrateStatus(phase162Db, currentSchema);

    assertEqual('phase16.2 upgrade doc preserved', preUpgrade.docs, '1');
    assertEqual('phase16.2 upgrade form preserved', preUpgrade.forms, '1');
    assertEqual('phase16.2 upgrade form version preserved', preUpgrade.formVersions, '1');
    assertEqual('phase16.2 upgrade submission preserved', preUpgrade.submissions, '1');
    assertEqual('phase16.2 upgrade form asset link preserved', preUpgrade.formAssets, '1');
    assertEqual(
      'phase16.2 upgrade public upload asset preserved',
      preUpgrade.publicUploadAssets,
      '1',
    );
    assertZero(phase162Db, 'phase16.2 upgrade automatic goals', `SELECT COUNT(*) FROM goals;`);

    return {
      database: phase162Db,
      migrations: psqlScalar(
        phase162Db,
        `SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;`,
      ),
      preUpgrade,
      docsAfterUpgrade: psqlScalar(phase162Db, `SELECT COUNT(*) FROM docs;`),
      formsAfterUpgrade: psqlScalar(phase162Db, `SELECT COUNT(*) FROM forms;`),
      submissionsAfterUpgrade: psqlScalar(phase162Db, `SELECT COUNT(*) FROM form_submissions;`),
      goalsAfterUpgrade: psqlScalar(phase162Db, `SELECT COUNT(*) FROM goals;`),
      statusUpToDate: /Database schema is up to date/i.test(status.stdout + status.stderr),
    };
  } finally {
    if (
      existsSync(phase162.tempRoot) &&
      phase162.tempRoot.startsWith(path.join(repoRoot, '.tmp'))
    ) {
      rmSync(phase162.tempRoot, { recursive: true, force: true });
    }
  }
}

function runPhase163Upgrade() {
  const phase163 = buildPhase163PrismaDir();
  try {
    resetDatabase(phase163Db);
    migrateDeploy(phase163Db, phase163.schemaPath);
    psql(phase163Db, phase152UpgradeFixtureSql());
    psql(phase163Db, phase16DocsFixtureSql());
    psql(phase163Db, phase16FormsFixtureSql());
    psql(phase163Db, phase16GoalsFixtureSql());

    const preUpgrade = {
      docs: psqlScalar(phase163Db, `SELECT COUNT(*) FROM docs WHERE id = '${uuid('9521', 1)}';`),
      forms: psqlScalar(phase163Db, `SELECT COUNT(*) FROM forms WHERE id = '${uuid('9530', 1)}';`),
      submissions: psqlScalar(
        phase163Db,
        `SELECT COUNT(*) FROM form_submissions WHERE id = '${uuid('9532', 1)}';`,
      ),
      goals: psqlScalar(phase163Db, `SELECT COUNT(*) FROM goals WHERE id = '${uuid('9546', 1)}';`),
      goalEvents: psqlScalar(
        phase163Db,
        `SELECT COUNT(*) FROM goal_progress_events WHERE id = '${uuid('9547', 1)}';`,
      ),
    };

    migrateDeploy(phase163Db, currentSchema);
    const status = migrateStatus(phase163Db, currentSchema);

    for (const [label, count] of Object.entries(preUpgrade)) {
      assertEqual(`phase16.3 upgrade ${label} preserved`, count, '1');
    }
    assertOne(
      phase163Db,
      'phase16.3 upgrade analytics_rollups table added',
      `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'analytics_rollups';`,
    );

    return {
      database: phase163Db,
      migrations: psqlScalar(
        phase163Db,
        `SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;`,
      ),
      preUpgrade,
      analyticsRollupsAfterUpgrade: psqlScalar(
        phase163Db,
        `SELECT COUNT(*) FROM analytics_rollups;`,
      ),
      statusUpToDate: /Database schema is up to date/i.test(status.stdout + status.stderr),
    };
  } finally {
    if (
      existsSync(phase163.tempRoot) &&
      phase163.tempRoot.startsWith(path.join(repoRoot, '.tmp'))
    ) {
      rmSync(phase163.tempRoot, { recursive: true, force: true });
    }
  }
}

function runPhase171Upgrade() {
  const phase171 = buildPhase171PrismaDir();
  try {
    resetDatabase(phase171Db);
    migrateDeploy(phase171Db, phase171.schemaPath);
    psql(phase171Db, phase152UpgradeFixtureSql());
    psql(phase171Db, phase16DocsFixtureSql());
    psql(phase171Db, phase16FormsFixtureSql());
    psql(phase171Db, phase16GoalsFixtureSql());
    psql(phase171Db, phase171AnalyticsFixtureSql());

    const preUpgrade = {
      goals: psqlScalar(phase171Db, `SELECT COUNT(*) FROM goals WHERE id = '${uuid('9546', 1)}';`),
      analyticsRollups: psqlScalar(
        phase171Db,
        `SELECT COUNT(*) FROM analytics_rollups WHERE id = '${uuid('9548', 1)}';`,
      ),
    };

    migrateDeploy(phase171Db, currentSchema);
    const status = migrateStatus(phase171Db, currentSchema);

    for (const [label, count] of Object.entries(preUpgrade)) {
      assertEqual(`phase17.1 upgrade ${label} preserved`, count, '1');
    }
    assertOne(
      phase171Db,
      'phase17.1 upgrade reports table added',
      `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'reports';`,
    );

    return {
      database: phase171Db,
      migrations: psqlScalar(
        phase171Db,
        `SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;`,
      ),
      preUpgrade,
      reportsAfterUpgrade: psqlScalar(phase171Db, `SELECT COUNT(*) FROM reports;`),
      statusUpToDate: /Database schema is up to date/i.test(status.stdout + status.stderr),
    };
  } finally {
    if (
      existsSync(phase171.tempRoot) &&
      phase171.tempRoot.startsWith(path.join(repoRoot, '.tmp'))
    ) {
      rmSync(phase171.tempRoot, { recursive: true, force: true });
    }
  }
}

function runPhase172Upgrade() {
  const phase172 = buildPhase172PrismaDir();
  try {
    resetDatabase(phase172Db);
    migrateDeploy(phase172Db, phase172.schemaPath);
    psql(phase172Db, phase152UpgradeFixtureSql());
    psql(phase172Db, phase16DocsFixtureSql());
    psql(phase172Db, phase16FormsFixtureSql());
    psql(phase172Db, phase172PopulatedFixtureSql());

    const preUpgrade = {
      superAgencyMemberships: psqlScalar(
        phase172Db,
        `SELECT COUNT(*) FROM super_agency_memberships WHERE id = '${uuid('9541', 1)}';`,
      ),
      tasks: psqlScalar(phase172Db, `SELECT COUNT(*) FROM tasks WHERE id = '${uuid('9543', 1)}';`),
      projects: psqlScalar(
        phase172Db,
        `SELECT COUNT(*) FROM projects WHERE id = '${uuid('9544', 1)}';`,
      ),
      tickets: psqlScalar(
        phase172Db,
        `SELECT COUNT(*) FROM tickets WHERE id = '${uuid('9545', 1)}';`,
      ),
      docs: psqlScalar(phase172Db, `SELECT COUNT(*) FROM docs WHERE id = '${uuid('9521', 1)}';`),
      forms: psqlScalar(phase172Db, `SELECT COUNT(*) FROM forms WHERE id = '${uuid('9530', 1)}';`),
      submissions: psqlScalar(
        phase172Db,
        `SELECT COUNT(*) FROM form_submissions WHERE id = '${uuid('9532', 1)}';`,
      ),
      goals: psqlScalar(phase172Db, `SELECT COUNT(*) FROM goals WHERE id = '${uuid('9546', 1)}';`),
      goalEvents: psqlScalar(
        phase172Db,
        `SELECT COUNT(*) FROM goal_progress_events WHERE id = '${uuid('9547', 1)}';`,
      ),
      analyticsRollups: psqlScalar(
        phase172Db,
        `SELECT COUNT(*) FROM analytics_rollups WHERE id = '${uuid('9548', 1)}';`,
      ),
      reports: psqlScalar(
        phase172Db,
        `SELECT COUNT(*) FROM reports WHERE id = '${uuid('9549', 1)}';`,
      ),
      reportExecutions: psqlScalar(
        phase172Db,
        `SELECT COUNT(*) FROM report_executions WHERE id = '${uuid('9550', 1)}';`,
      ),
      reportExports: psqlScalar(
        phase172Db,
        `SELECT COUNT(*) FROM report_exports WHERE id = '${uuid('9551', 1)}';`,
      ),
      reportSchedules: psqlScalar(
        phase172Db,
        `SELECT COUNT(*) FROM report_schedules WHERE id = '${uuid('9552', 1)}';`,
      ),
      reportOccurrences: psqlScalar(
        phase172Db,
        `SELECT COUNT(*) FROM report_schedule_occurrences WHERE id = '${uuid('9553', 1)}';`,
      ),
      apiKeys: psqlScalar(
        phase172Db,
        `SELECT COUNT(*) FROM api_keys WHERE id = '${uuid('9513', 1)}';`,
      ),
      webhooks: psqlScalar(
        phase172Db,
        `SELECT COUNT(*) FROM webhook_subscriptions WHERE id = '${uuid('9555', 1)}';`,
      ),
      integrations: psqlScalar(
        phase172Db,
        `SELECT COUNT(*) FROM integration_connections WHERE id = '${uuid('9556', 1)}';`,
      ),
      billingInvoices: psqlScalar(
        phase172Db,
        `SELECT COUNT(*) FROM billing_invoices WHERE id = '${uuid('9554', 1)}';`,
      ),
    };

    migrateDeploy(phase172Db, currentSchema);
    const status = migrateStatus(phase172Db, currentSchema);

    for (const [label, count] of Object.entries(preUpgrade)) {
      assertEqual(`phase17.2 upgrade ${label} preserved`, count, '1');
    }
    assertOne(
      phase172Db,
      'phase17.2 upgrade pg_trgm enabled',
      `SELECT COUNT(*) FROM pg_extension WHERE extname = 'pg_trgm';`,
    );
    assertOne(
      phase172Db,
      'phase17.2 upgrade search_documents table added',
      `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'search_documents';`,
    );
    assertZero(
      phase172Db,
      'phase17.2 upgrade search index starts empty',
      `SELECT COUNT(*) FROM search_documents;`,
    );

    return {
      database: phase172Db,
      migrations: psqlScalar(
        phase172Db,
        `SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;`,
      ),
      preUpgrade,
      fixtureEntityCount: Object.values(preUpgrade).reduce((sum, value) => sum + Number(value), 0),
      searchDocumentsAfterUpgrade: psqlScalar(phase172Db, `SELECT COUNT(*) FROM search_documents;`),
      pgTrgmEnabled: psqlScalar(
        phase172Db,
        `SELECT COUNT(*) FROM pg_extension WHERE extname = 'pg_trgm';`,
      ),
      statusUpToDate: /Database schema is up to date/i.test(status.stdout + status.stderr),
    };
  } finally {
    if (
      existsSync(phase172.tempRoot) &&
      phase172.tempRoot.startsWith(path.join(repoRoot, '.tmp'))
    ) {
      rmSync(phase172.tempRoot, { recursive: true, force: true });
    }
  }
}

function runPhase173Upgrade() {
  const phase173 = buildPhase173PrismaDir();
  try {
    resetDatabase(phase173Db);
    migrateDeploy(phase173Db, phase173.schemaPath);
    psql(phase173Db, phase152UpgradeFixtureSql());
    psql(phase173Db, phase16DocsFixtureSql());
    psql(phase173Db, phase16FormsFixtureSql());
    psql(phase173Db, phase172PopulatedFixtureSql());
    psql(phase173Db, phase173SearchFixtureSql());

    const preUpgrade = {
      searchDocuments: psqlScalar(
        phase173Db,
        `SELECT COUNT(*) FROM search_documents WHERE id = '${uuid('9560', 1)}';`,
      ),
      recentSearches: psqlScalar(
        phase173Db,
        `SELECT COUNT(*) FROM recent_searches WHERE id = '${uuid('9561', 1)}';`,
      ),
      searchIndexJobs: psqlScalar(
        phase173Db,
        `SELECT COUNT(*) FROM search_index_jobs WHERE id = '${uuid('9562', 1)}';`,
      ),
    };

    migrateDeploy(phase173Db, currentSchema);
    const status = migrateStatus(phase173Db, currentSchema);

    for (const [label, count] of Object.entries(preUpgrade)) {
      assertEqual(`phase17.3 upgrade ${label} preserved`, count, '1');
    }
    assertOne(
      phase173Db,
      'phase17.3 upgrade custom_dashboards table added',
      `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'custom_dashboards';`,
    );

    return {
      database: phase173Db,
      migrations: psqlScalar(
        phase173Db,
        `SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;`,
      ),
      preUpgrade,
      dashboardsAfterUpgrade: psqlScalar(phase173Db, `SELECT COUNT(*) FROM custom_dashboards;`),
      statusUpToDate: /Database schema is up to date/i.test(status.stdout + status.stderr),
    };
  } finally {
    if (
      existsSync(phase173.tempRoot) &&
      phase173.tempRoot.startsWith(path.join(repoRoot, '.tmp'))
    ) {
      rmSync(phase173.tempRoot, { recursive: true, force: true });
    }
  }
}

function runPhase174Upgrade() {
  const phase174 = buildPhase174PrismaDir();
  try {
    resetDatabase(phase174Db);
    migrateDeploy(phase174Db, phase174.schemaPath);
    psql(phase174Db, phase152UpgradeFixtureSql());
    psql(phase174Db, phase16DocsFixtureSql());
    psql(phase174Db, phase16FormsFixtureSql());
    psql(phase174Db, phase172PopulatedFixtureSql());
    psql(phase174Db, phase173SearchFixtureSql());
    psql(phase174Db, phase174DashboardFixtureSql());

    const preUpgrade = {
      dashboards: psqlScalar(
        phase174Db,
        `SELECT COUNT(*) FROM custom_dashboards WHERE id = '${uuid('9570', 1)}';`,
      ),
      dashboardAccess: psqlScalar(
        phase174Db,
        `SELECT COUNT(*) FROM dashboard_access WHERE id = '${uuid('9571', 1)}';`,
      ),
      dashboardPreferences: psqlScalar(
        phase174Db,
        `SELECT COUNT(*) FROM dashboard_preferences WHERE id = '${uuid('9572', 1)}';`,
      ),
      dashboardWidgets: psqlScalar(
        phase174Db,
        `SELECT COUNT(*) FROM dashboard_widgets WHERE dashboard_id = '${uuid('9570', 1)}';`,
      ),
    };

    migrateDeploy(phase174Db, currentSchema);
    const status = migrateStatus(phase174Db, currentSchema);

    assertEqual('phase17.4 upgrade dashboards preserved', preUpgrade.dashboards, '1');
    assertEqual('phase17.4 upgrade dashboard access preserved', preUpgrade.dashboardAccess, '1');
    assertEqual(
      'phase17.4 upgrade dashboard preferences preserved',
      preUpgrade.dashboardPreferences,
      '1',
    );
    assertEqual('phase17.4 upgrade dashboard widgets preserved', preUpgrade.dashboardWidgets, '30');
    assertEqual(
      'phase17.4 upgrade widget trigger advisory lock',
      psqlScalar(
        phase174Db,
        `SELECT CASE WHEN pg_get_functiondef('dashboard_widgets_limit_30'::regproc) LIKE '%pg_advisory_xact_lock%' THEN 1 ELSE 0 END;`,
      ),
      '1',
    );

    return {
      database: phase174Db,
      migrations: psqlScalar(
        phase174Db,
        `SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;`,
      ),
      preUpgrade,
      statusUpToDate: /Database schema is up to date/i.test(status.stdout + status.stderr),
    };
  } finally {
    if (
      existsSync(phase174.tempRoot) &&
      phase174.tempRoot.startsWith(path.join(repoRoot, '.tmp'))
    ) {
      rmSync(phase174.tempRoot, { recursive: true, force: true });
    }
  }
}

const migrations = migrationDirectories();
assertHarnessSafety();
validateMigrationInventory(migrations);

if (!migrations.includes('0074_phase14_6_2_super_agency_hierarchy')) {
  throw new Error('Missing migration 0074_phase14_6_2_super_agency_hierarchy');
}
if (!migrations.includes('0075_phase14_6_3_super_agency_auth_rbac')) {
  throw new Error('Missing migration 0075_phase14_6_3_super_agency_auth_rbac');
}
if (!migrations.includes('0076_phase15_1_billing_foundation')) {
  throw new Error('Missing migration 0076_phase15_1_billing_foundation');
}
if (!migrations.includes('0077_phase15_1_billing_foundation_hardening')) {
  throw new Error('Missing migration 0077_phase15_1_billing_foundation_hardening');
}
if (!migrations.includes('0078_phase15_2_stripe_subscription_lifecycle')) {
  throw new Error('Missing migration 0078_phase15_2_stripe_subscription_lifecycle');
}
if (!migrations.includes('0079_phase15_3_allocation_usage_enforcement')) {
  throw new Error('Missing migration 0079_phase15_3_allocation_usage_enforcement');
}
if (!migrations.includes('0080_phase15_4_invoice_projection')) {
  throw new Error('Missing migration 0080_phase15_4_invoice_projection');
}
if (!migrations.includes('0081_phase16_1_docs_foundation')) {
  throw new Error('Missing migration 0081_phase16_1_docs_foundation');
}
if (!migrations.includes('0082_phase16_2_forms_foundation')) {
  throw new Error('Missing migration 0082_phase16_2_forms_foundation');
}
if (!migrations.includes('0083_phase16_3_goals_foundation')) {
  throw new Error('Missing migration 0083_phase16_3_goals_foundation');
}
if (!migrations.includes('0084_phase17_1_analytics_foundation')) {
  throw new Error('Missing migration 0084_phase17_1_analytics_foundation');
}
if (!migrations.includes('0085_phase17_2_reports')) {
  throw new Error('Missing migration 0085_phase17_2_reports');
}
if (!migrations.includes('0086_phase17_3_global_search')) {
  throw new Error('Missing migration 0086_phase17_3_global_search');
}
if (!migrations.includes('0087_phase17_4_custom_dashboards')) {
  throw new Error('Missing migration 0087_phase17_4_custom_dashboards');
}
if (!migrations.includes('0088_phase17_4_dashboard_widget_limit_lock')) {
  throw new Error('Missing migration 0088_phase17_4_dashboard_widget_limit_lock');
}
if (!migrations.includes('0089_phase18_1_white_label_branding')) {
  throw new Error('Missing migration 0089_phase18_1_white_label_branding');
}
if (!migrations.includes('0090_phase18_2_custom_domains')) {
  throw new Error('Missing migration 0090_phase18_2_custom_domains');
}

const clean = runCleanInstall();
const legacy = runLegacyUpgrade();
const phase152Upgrade = runPhase152Upgrade();
const phase154Upgrade = runPhase154Upgrade();
const phase161Upgrade = runPhase161Upgrade();
const phase162Upgrade = runPhase162Upgrade();
const phase163Upgrade = runPhase163Upgrade();
const phase171Upgrade = runPhase171Upgrade();
const phase172Upgrade = runPhase172Upgrade();
const phase173Upgrade = runPhase173Upgrade();
const phase174Upgrade = runPhase174Upgrade();
const zeroAgency = runLegacyEdgeScenario(zeroAgencyDb, 0, 'zero');
const oneAgency = runLegacyEdgeScenario(oneAgencyDb, 1, 'one');
const manyAgency = runLegacyEdgeScenario(manyAgencyDb, 25, 'many');

console.log(
  JSON.stringify(
    {
      result: 'PASS',
      scratchSafety: {
        cleanDb,
        legacyDb,
        zeroAgencyDb,
        oneAgencyDb,
        manyAgencyDb,
        phase15Db,
        phase154Db,
        phase161Db,
        phase162Db,
        phase163Db,
        phase171Db,
        phase172Db,
        phase173Db,
        phase174Db,
        host: dbHost,
        port: dbPort,
        container,
        refusedUnsafeNames: ['zea_play', 'zea_play_test', 'random_db', 'postgres'],
      },
      migrationInventory: {
        count: migrations.length,
        latest: migrations.at(-1),
      },
      cleanInstall: clean,
      legacyUpgrade: legacy,
      phase152Upgrade,
      phase154Upgrade,
      phase161Upgrade,
      phase162Upgrade,
      phase163Upgrade,
      phase171Upgrade,
      phase172Upgrade,
      phase173Upgrade,
      phase174Upgrade,
      edgeCases: {
        zeroAgency,
        oneAgency,
        manyAgency,
      },
      compatibilityPolicy: {
        oneCompatibilitySuperAgencyPerLegacyAgency: true,
        noLegacyAgencyUserAutoPromotion: true,
        organizationRemainsCompatibilityOnly: true,
      },
    },
    null,
    2,
  ),
);
