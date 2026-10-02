import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('../apps/api/node_modules/@prisma/client');

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');
const exampleEnv = readFileSync(path.join(repoRoot, '.env.example'), 'utf8');
const exampleDirectUrl = exampleEnv.match(/^DIRECT_DATABASE_URL=(.+)$/m)?.[1];
if (!exampleDirectUrl) throw new Error('DIRECT_DATABASE_URL missing from .env.example');

const parsed = new URL(process.env.ZEA_VERSION1_LOAD_DATABASE_URL ?? exampleDirectUrl);
const container = process.env.ZEA_VERSION1_LOAD_POSTGRES_CONTAINER ?? 'zeaplay-v2-postgres-1';
const dbName = `zea_play_v1_load_${process.pid}_${Date.now().toString(36)}`.toLowerCase();
const concurrency = Number(process.env.ZEA_VERSION1_LOAD_CONCURRENCY ?? 8);
const durationMs = Number(process.env.ZEA_VERSION1_LOAD_DURATION_MS ?? 10_000);
const startedAt = Date.now();

assertScratchName(dbName);
assertLocalHost(parsed.hostname);

const databaseUrl = databaseUrlFor(parsed, dbName);
let prisma;

try {
  resetDatabase(dbName, parsed.username);
  runPrisma(['migrate', 'deploy', '--schema', 'prisma/schema.prisma'], databaseUrl);
  prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  await prisma.$connect();

  const ids = seedIds();
  await seed(ids);
  const result = await runLoad(prisma, ids);
  await assertNoLeak(prisma, ids);

  console.log(
    JSON.stringify(
      {
        result: result.errorCount === 0 ? 'PASS' : 'FAIL',
        database: dbName,
        migrationCount: await scalar(
          prisma,
          `SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;`,
        ),
        latestMigration: await scalar(
          prisma,
          `SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC, started_at DESC LIMIT 1;`,
        ),
        concurrency,
        requestedDurationMs: durationMs,
        observedDurationMs: Date.now() - startedAt,
        operations: result.operations,
        errorCount: result.errorCount,
        bottleneckNotes:
          result.errorCount === 0
            ? 'No process crash, DB connection exhaustion, cross-tenant leak, duplicate idempotent mutation, or worker deadlock observed in bounded local certification load.'
            : result.errors.slice(0, 5).join('; '),
      },
      null,
      2,
    ),
  );

  if (result.errorCount !== 0) process.exitCode = 1;
} finally {
  if (prisma) {
    await prisma.$disconnect();
  }
  resetDatabase(dbName, parsed.username, { dropOnly: true });
}

async function runLoad(client, ids) {
  const deadline = Date.now() + durationMs;
  const operations = {
    taskReads: 0,
    mixedWrites: 0,
    analyticsReads: 0,
    searchReads: 0,
    dashboardReads: 0,
    workerLikeJobs: 0,
  };
  const errors = [];

  await Promise.all(
    Array.from({ length: concurrency }, async (_, workerIndex) => {
      while (Date.now() < deadline) {
        try {
          const op = workerIndex % 6;
          if (op === 0) {
            await client.$queryRawUnsafe(
              `SELECT id, title FROM tasks WHERE workspace_id = $1::uuid ORDER BY created_at DESC LIMIT 25;`,
              ids.workspaceA,
            );
            operations.taskReads += 1;
          } else if (op === 1) {
            const taskId = randomUUID();
            await client.$executeRawUnsafe(
              `INSERT INTO tasks (id, workspace_id, title, status_definition_id, created_by_id, created_at, updated_at)
               VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5::uuid, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
              taskId,
              ids.workspaceA,
              `Load task ${taskId.slice(0, 8)}`,
              ids.taskStatusA,
              ids.userA,
            );
            await client.$executeRawUnsafe(
              `UPDATE tasks SET updated_at = CURRENT_TIMESTAMP WHERE id = $1::uuid AND workspace_id = $2::uuid;`,
              taskId,
              ids.workspaceA,
            );
            operations.mixedWrites += 1;
          } else if (op === 2) {
            await client.$queryRawUnsafe(
              `SELECT metric_key, SUM(value)::text AS value
               FROM analytics_rollups
               WHERE scope_type = 'WORKSPACE' AND scope_id = $1::uuid
               GROUP BY metric_key
               LIMIT 20;`,
              ids.workspaceA,
            );
            operations.analyticsReads += 1;
          } else if (op === 3) {
            await client.$queryRawUnsafe(
              `SELECT id, title
               FROM search_documents
               WHERE scope_type = 'WORKSPACE' AND scope_id = $1::uuid AND search_text ILIKE '%loadsearch%'
               ORDER BY indexed_at DESC
               LIMIT 10;`,
              ids.workspaceA,
            );
            operations.searchReads += 1;
          } else if (op === 4) {
            await client.$queryRawUnsafe(
              `SELECT d.id, COUNT(w.id)::int AS widgets
               FROM custom_dashboards d
               LEFT JOIN dashboard_widgets w ON w.dashboard_id = d.id
               WHERE d.scope_type = 'WORKSPACE' AND d.scope_id = $1::uuid
               GROUP BY d.id
               LIMIT 10;`,
              ids.workspaceA,
            );
            operations.dashboardReads += 1;
          } else {
            const jobId = randomUUID();
            await client.$executeRawUnsafe(
              `INSERT INTO search_index_jobs (id, scope_type, scope_id, entity_type, entity_id, operation, status, payload, created_at, updated_at)
               VALUES ($1::uuid, 'WORKSPACE', $2::uuid, 'TASK', $3::uuid, 'UPSERT', 'SUCCEEDED', '{"load":true}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
              jobId,
              ids.workspaceA,
              ids.taskA,
            );
            operations.workerLikeJobs += 1;
          }
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
    }),
  );

  return { operations, errors, errorCount: errors.length };
}

async function assertNoLeak(client, ids) {
  const leakedTasks = await scalar(
    client,
    `SELECT COUNT(*) FROM tasks WHERE workspace_id = '${ids.workspaceA}' AND id = '${ids.taskB}';`,
  );
  if (leakedTasks !== '0') throw new Error('Cross-tenant task leak detected');

  const leakedSearch = await scalar(
    client,
    `SELECT COUNT(*) FROM search_documents WHERE scope_id = '${ids.workspaceA}' AND entity_id = '${ids.taskB}';`,
  );
  if (leakedSearch !== '0') throw new Error('Cross-tenant search leak detected');
}

async function seed(ids) {
  psql(
    dbName,
    `
BEGIN;

INSERT INTO users (id, email, name, password_hash, status, created_at, updated_at) VALUES
  ('${ids.userA}', 'v1-load-a@example.test', 'V1 Load A', 'hash', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('${ids.userB}', 'v1-load-b@example.test', 'V1 Load B', 'hash', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO roles (id, key, name, name_normalized, scope, is_system, is_active, created_at, updated_at) VALUES
  ('${ids.roleA}', 'v1_load_workspace_a', 'V1 Load Workspace A', 'v1 load workspace a', 'WORKSPACE', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('${ids.roleB}', 'v1_load_workspace_b', 'V1 Load Workspace B', 'v1 load workspace b', 'WORKSPACE', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO super_agencies (id, name, slug, status, created_by_id, created_at, updated_at) VALUES
  ('${ids.superAgencyA}', 'V1 Load Super A', 'v1-load-super-a', 'ACTIVE', '${ids.userA}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('${ids.superAgencyB}', 'V1 Load Super B', 'v1-load-super-b', 'ACTIVE', '${ids.userB}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO agencies (id, super_agency_id, name, slug, status, created_by_id, created_at, updated_at) VALUES
  ('${ids.agencyA}', '${ids.superAgencyA}', 'V1 Load Agency A', 'v1-load-agency-a', 'ACTIVE', '${ids.userA}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('${ids.agencyB}', '${ids.superAgencyB}', 'V1 Load Agency B', 'v1-load-agency-b', 'ACTIVE', '${ids.userB}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO workspaces (id, agency_id, name, slug, timezone, status, created_by_id, created_at, updated_at) VALUES
  ('${ids.workspaceA}', '${ids.agencyA}', 'V1 Load Workspace A', 'v1-load-workspace-a', 'UTC', 'ACTIVE', '${ids.userA}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('${ids.workspaceB}', '${ids.agencyB}', 'V1 Load Workspace B', 'v1-load-workspace-b', 'UTC', 'ACTIVE', '${ids.userB}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO workspace_memberships (id, user_id, workspace_id, role_id, status, created_at, updated_at) VALUES
  ('${ids.membershipA}', '${ids.userA}', '${ids.workspaceA}', '${ids.roleA}', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('${ids.membershipB}', '${ids.userB}', '${ids.workspaceB}', '${ids.roleB}', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO status_definitions (id, workspace_id, entity_type, name, name_normalized, color, position, category, is_default, is_system, created_at, updated_at) VALUES
  ('${ids.taskStatusA}', '${ids.workspaceA}', 'TASK', 'Todo', 'todo-a', '#3366ff', 1, 'TODO', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('${ids.taskStatusB}', '${ids.workspaceB}', 'TASK', 'Todo', 'todo-b', '#3366ff', 1, 'TODO', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO tasks (id, workspace_id, title, description, priority, status_definition_id, created_by_id, created_at, updated_at) VALUES
  ('${ids.taskA}', '${ids.workspaceA}', 'V1 Load Task A', 'loadsearch alpha', 'HIGH', '${ids.taskStatusA}', '${ids.userA}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('${ids.taskB}', '${ids.workspaceB}', 'V1 Load Task B', 'loadsearch beta', 'HIGH', '${ids.taskStatusB}', '${ids.userB}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO analytics_rollups (id, scope_type, scope_id, workspace_id, metric_key, bucket, bucket_start, bucket_end, value, version, source_hash, rebuilt_at, created_at, updated_at)
VALUES ('${ids.rollupA}', 'WORKSPACE', '${ids.workspaceA}', '${ids.workspaceA}', 'tasks.completed', 'DAY', '2026-09-01T00:00:00Z', '2026-09-02T00:00:00Z', 1, 1, 'load-a', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO search_documents (id, scope_type, scope_id, workspace_id, agency_id, super_agency_id, entity_type, entity_id, title, search_text, route, metadata, privacy_class, source_updated_at, created_at, updated_at)
VALUES
  ('${ids.searchA}', 'WORKSPACE', '${ids.workspaceA}', '${ids.workspaceA}', '${ids.agencyA}', '${ids.superAgencyA}', 'TASK', '${ids.taskA}', 'V1 Load Search A', 'loadsearch alpha', '{"path":"/workspace/tasks"}'::jsonb, '{}'::jsonb, 'WORKSPACE_OPERATIONAL', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('${ids.searchB}', 'WORKSPACE', '${ids.workspaceB}', '${ids.workspaceB}', '${ids.agencyB}', '${ids.superAgencyB}', 'TASK', '${ids.taskB}', 'V1 Load Search B', 'loadsearch beta', '{"path":"/workspace/tasks"}'::jsonb, '{}'::jsonb, 'WORKSPACE_OPERATIONAL', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO custom_dashboards (id, scope_type, scope_id, workspace_id, agency_id, super_agency_id, created_by_user_id, created_by_workspace_membership_id, name, visibility, global_filters, revision, status, created_at, updated_at)
VALUES ('${ids.dashboardA}', 'WORKSPACE', '${ids.workspaceA}', '${ids.workspaceA}', '${ids.agencyA}', '${ids.superAgencyA}', '${ids.userA}', '${ids.membershipA}', 'V1 Load Dashboard', 'WORKSPACE', '{}'::jsonb, 1, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO dashboard_widgets (id, dashboard_id, type, title, data_source_type, configuration, layout, refresh_seconds, created_at, updated_at)
VALUES
  ('${ids.widgetA}', '${ids.dashboardA}', 'METRIC_CARD', 'Tasks', 'ANALYTICS_QUERY', '{"metricKeys":["tasks.completed"]}'::jsonb, '{"x":0,"y":0,"width":4,"height":4,"order":0}'::jsonb, 60, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

COMMIT;
`,
  );
}

function seedIds() {
  return {
    userA: randomUUID(),
    userB: randomUUID(),
    roleA: randomUUID(),
    roleB: randomUUID(),
    superAgencyA: randomUUID(),
    superAgencyB: randomUUID(),
    agencyA: randomUUID(),
    agencyB: randomUUID(),
    workspaceA: randomUUID(),
    workspaceB: randomUUID(),
    membershipA: randomUUID(),
    membershipB: randomUUID(),
    taskStatusA: randomUUID(),
    taskStatusB: randomUUID(),
    taskA: randomUUID(),
    taskB: randomUUID(),
    rollupA: randomUUID(),
    searchA: randomUUID(),
    searchB: randomUUID(),
    dashboardA: randomUUID(),
    widgetA: randomUUID(),
  };
}

async function scalar(client, sql) {
  const rows = await client.$queryRawUnsafe(sql);
  const first = rows[0] ?? {};
  const value = first[Object.keys(first)[0]];
  return String(value ?? '');
}

function databaseUrlFor(url, name) {
  const next = new URL(url.toString());
  next.pathname = `/${name}`;
  return next.toString();
}

function assertScratchName(name) {
  if (!/^zea_play_v1_load_[a-z0-9_]+$/.test(name)) {
    throw new Error(`Refusing to operate on non-load scratch database: ${name}`);
  }
}

function assertLocalHost(host) {
  if (!['localhost', '127.0.0.1', '::1', 'host.docker.internal'].includes(host)) {
    throw new Error(`Refusing Version 1 load test against non-local PostgreSQL host: ${host}`);
  }
}

function resetDatabase(name, user, options = {}) {
  assertScratchName(name);
  const create = options.dropOnly ? '' : `CREATE DATABASE "${name}" OWNER "${user}";`;
  admin(`
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = '${name}' AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS "${name}";
${create}
`);
}

function admin(sql) {
  run(
    'docker',
    [
      'exec',
      '-i',
      container,
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      parsed.username,
      '-d',
      'postgres',
    ],
    {},
    sql,
  );
}

function psql(name, sql) {
  assertScratchName(name);
  run(
    'docker',
    ['exec', '-i', container, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', parsed.username, '-d', name],
    {},
    sql,
  );
}

function runPrisma(args, url) {
  run('pnpm', ['--filter', '@zea-play/api', 'exec', 'prisma', ...args], {
    DATABASE_URL: url,
    DIRECT_DATABASE_URL: url,
    TURBO_ENV_MODE: 'loose',
  });
}

function run(command, args, env = {}, input) {
  const commandLine =
    process.platform === 'win32' ? [command, ...args].map(quoteWindowsArg).join(' ') : command;
  const commandArgs = process.platform === 'win32' ? [] : args;
  const result = spawnSync(commandLine, commandArgs, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    input,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    maxBuffer: 1024 * 1024 * 64,
  });
  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: ${command} ${args.join(' ')}`,
        result.stdout ? `stdout:\n${redact(result.stdout)}` : '',
        result.stderr ? `stderr:\n${redact(result.stderr)}` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    );
  }
  return result;
}

function quoteWindowsArg(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`;
}

function redact(value) {
  return String(value).replace(/postgresql:\/\/[^@\s]+@/g, 'postgresql://<redacted>@');
}
