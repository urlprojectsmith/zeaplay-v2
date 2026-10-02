const { spawnSync } = require('node:child_process');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const runtimeDir = path.join(repoRoot, '.tmp');
const runtimeEnvPath = path.join(runtimeDir, 'api-integration-runtime-env.json');
const container = process.env.ZEA_API_INTEGRATION_POSTGRES_CONTAINER ?? 'zeaplay-v2-postgres-1';
const expectedMigrationCount = 90;
const expectedLatestMigration = '0090_phase18_2_custom_domains';

module.exports = async () => {
  mkdirSync(runtimeDir, { recursive: true });

  const databaseUrl = resolveDatabaseUrl();
  const parsed = new URL(databaseUrl);
  const dbName = scratchDatabaseName();
  assertScratchName(dbName);

  const testUrl = databaseUrlFor(parsed, dbName);
  const runtime = {
    dbName,
    databaseUrl: testUrl,
    directDatabaseUrl: testUrl,
    container,
  };

  writeFileSync(runtimeEnvPath, JSON.stringify(runtime, null, 2));
  resetDatabase(dbName, parsed.username);
  runPrisma(['migrate', 'deploy', '--schema', 'prisma/schema.prisma'], testUrl);
  assertMigrated(dbName);
};

function resolveDatabaseUrl() {
  if (process.env.ZEA_API_INTEGRATION_DATABASE_URL) {
    return process.env.ZEA_API_INTEGRATION_DATABASE_URL;
  }
  if (process.env.DIRECT_DATABASE_URL && !isSharedDatabase(process.env.DIRECT_DATABASE_URL)) {
    return process.env.DIRECT_DATABASE_URL;
  }

  const envExample = readFileSync(path.join(repoRoot, '.env.example'), 'utf8');
  const direct = envExample.match(/^DIRECT_DATABASE_URL=(.+)$/m)?.[1];
  if (!direct) throw new Error('DIRECT_DATABASE_URL missing from .env.example');
  return direct;
}

function scratchDatabaseName() {
  const suffix = `${process.pid}_${Date.now().toString(36)}`.toLowerCase();
  return `zea_play_api_integration_${suffix}`;
}

function isSharedDatabase(value) {
  try {
    const parsed = new URL(value);
    return parsed.pathname.replace(/^\//, '') === 'zea_play';
  } catch {
    return false;
  }
}

function databaseUrlFor(parsed, dbName) {
  const next = new URL(parsed.toString());
  next.pathname = `/${dbName}`;
  return next.toString();
}

function assertScratchName(dbName) {
  if (
    !/^zea_play_api_integration_[a-z0-9_]+$/.test(dbName) ||
    ['zea_play', 'zea_play_test', 'postgres', 'template0', 'template1'].includes(dbName)
  ) {
    throw new Error(`Refusing to operate on non-integration scratch database: ${dbName}`);
  }
}

function resetDatabase(dbName, user) {
  assertScratchName(dbName);
  dockerPsql(
    'postgres',
    `
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = '${dbName}' AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS "${dbName}";
CREATE DATABASE "${dbName}" OWNER "${user}";
`,
  );
}

function assertMigrated(dbName) {
  const output = dockerPsql(
    dbName,
    `
SELECT COUNT(*)::text FROM _prisma_migrations WHERE finished_at IS NOT NULL;
SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC, started_at DESC LIMIT 1;
SELECT table_name
FROM (VALUES
  ('analytics_rollups'),
  ('goal_progress_events'),
  ('report_schedule_occurrences'),
  ('search_documents'),
  ('recent_searches'),
  ('search_index_jobs'),
  ('custom_dashboards'),
  ('dashboard_access'),
  ('dashboard_widgets'),
  ('dashboard_preferences'),
  ('white_label_branding'),
  ('custom_domains')
) AS required(table_name)
WHERE to_regclass('public.' || table_name) IS NULL;
`,
    ['-At'],
  )
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const [count, latest, ...missingTables] = output;
  if (count !== String(expectedMigrationCount) || latest !== expectedLatestMigration) {
    throw new Error(
      `Integration DB migration mismatch: count=${count ?? '<none>'} latest=${latest ?? '<none>'}`,
    );
  }
  if (missingTables.length > 0) {
    throw new Error(`Integration DB missing required tables: ${missingTables.join(', ')}`);
  }
}

function runPrisma(args, databaseUrl) {
  run('pnpm', ['--filter', '@zea-play/api', 'exec', 'prisma', ...args], {
    DATABASE_URL: databaseUrl,
    DIRECT_DATABASE_URL: databaseUrl,
    TURBO_ENV_MODE: 'loose',
  });
}

function dockerPsql(dbName, sql, extraArgs = []) {
  const result = run(
    'docker',
    [
      'exec',
      '-i',
      container,
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      'zea',
      '-d',
      dbName,
      ...extraArgs,
    ],
    {},
    sql,
  );
  return result.stdout;
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
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function quoteWindowsArg(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`;
}

function redact(value) {
  return String(value).replace(/postgresql:\/\/[^@\s]+@/g, 'postgresql://<redacted>@');
}
