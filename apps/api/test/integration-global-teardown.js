const { spawnSync } = require('node:child_process');
const { existsSync, readFileSync, rmSync } = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const runtimeEnvPath = path.join(repoRoot, '.tmp', 'api-integration-runtime-env.json');

module.exports = async () => {
  if (!existsSync(runtimeEnvPath)) return;
  const runtime = JSON.parse(readFileSync(runtimeEnvPath, 'utf8'));
  const dbName = runtime.dbName;
  assertScratchName(dbName);

  const container = runtime.container ?? 'zeaplay-v2-postgres-1';
  const sql = `
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = '${dbName}' AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS "${dbName}";
`;

  run(
    'docker',
    ['exec', '-i', container, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'zea', '-d', 'postgres'],
    sql,
  );
  rmSync(runtimeEnvPath, { force: true });
};

function assertScratchName(dbName) {
  if (!/^zea_play_api_integration_[a-z0-9_]+$/.test(dbName)) {
    throw new Error(`Refusing to drop non-integration scratch database: ${dbName}`);
  }
}

function run(command, args, input) {
  const commandLine =
    process.platform === 'win32' ? [command, ...args].map(quoteWindowsArg).join(' ') : command;
  const commandArgs = process.platform === 'win32' ? [] : args;
  const result = spawnSync(commandLine, commandArgs, {
    cwd: repoRoot,
    input,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    maxBuffer: 1024 * 1024 * 16,
  });

  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: ${command} ${args.join(' ')}`,
        result.stdout ? `stdout:\n${result.stdout}` : '',
        result.stderr ? `stderr:\n${result.stderr}` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    );
  }
}

function quoteWindowsArg(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`;
}
