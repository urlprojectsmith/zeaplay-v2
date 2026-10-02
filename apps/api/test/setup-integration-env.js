const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const runtimeEnvPath = path.join(repoRoot, '.tmp', 'api-integration-runtime-env.json');

if (!existsSync(runtimeEnvPath)) {
  throw new Error(
    'API integration runtime env is missing. Jest globalSetup did not prepare the isolated database.',
  );
}

const runtime = JSON.parse(readFileSync(runtimeEnvPath, 'utf8'));

process.env.NODE_ENV = 'test';
process.env.APP_ENV = 'test';
process.env.DATABASE_URL = runtime.databaseUrl;
process.env.DIRECT_DATABASE_URL = runtime.directDatabaseUrl;
process.env.TURBO_ENV_MODE = 'loose';
process.env.REDIS_CACHE_URL ??= 'redis://localhost:7379';
process.env.REDIS_QUEUE_URL ??= 'redis://localhost:7380';
process.env.REDIS_REALTIME_URL ??= 'redis://localhost:7381';
process.env.REDIS_RATE_LIMIT_URL ??= 'redis://localhost:7382';
