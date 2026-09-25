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
const expectedMigrationCount = 81;
const expectedLatestMigration = '0081_phase16_1_docs_foundation';
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
    !/^zea_play_phase14613[a-z0-9_]*_(clean|legacy|zero|one|many|phase15)$/.test(dbName) ||
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

  for (const dbName of [cleanDb, legacyDb, zeroAgencyDb, oneAgencyDb, manyAgencyDb, phase15Db]) {
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
    .replaceAll(databaseUrl(phase15Db), '<redacted-phase15-database-url>');
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
          'billing_invoices'
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

const clean = runCleanInstall();
const legacy = runLegacyUpgrade();
const phase152Upgrade = runPhase152Upgrade();
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
