import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  APP_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  WEB_PORT: z.coerce.number().int().positive().default(3000),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WORKER_PORT: z.coerce.number().int().positive().default(4001),
  WEB_APP_URL: z.string().url(),
  API_PUBLIC_URL: z.string().url(),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  REQUEST_BODY_LIMIT: z
    .string()
    .regex(/^\d+(kb|mb)$/i, 'Use an explicit request body limit such as 512kb or 1mb.')
    .default('1mb'),
  DATABASE_URL: z.string().min(1),
  DIRECT_DATABASE_URL: z.string().min(1),
  REDIS_CACHE_URL: z.string().min(1),
  REDIS_QUEUE_URL: z.string().min(1),
  REDIS_REALTIME_URL: z.string().min(1),
  REDIS_RATE_LIMIT_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),
  REFRESH_TOKEN_COOKIE_NAME: z.string().min(1).default('zea_refresh'),
  CSRF_COOKIE_NAME: z.string().min(1).default('zea_csrf'),
  AUTH_COOKIE_DOMAIN: z.string().optional().default(''),
  LOGIN_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(900),
  LOGIN_RATE_LIMIT_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(52_428_800),
  ALLOWED_MIME_TYPES: z
    .string()
    .default('image/png,image/jpeg,image/webp,application/pdf,text/plain'),
  UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().positive().max(900).default(300),
  DOWNLOAD_URL_TTL_SECONDS: z.coerce.number().int().positive().max(900).default(300),
  DEFAULT_STORAGE_LIMIT_BYTES: z.coerce.number().int().positive().default(1_073_741_824),
  MINIO_ENDPOINT: z.string().min(1),
  MINIO_PORT: z.coerce.number().int().positive().default(9000),
  MINIO_USE_SSL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(1),
  MINIO_BUCKET: z.string().min(1),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SENTRY_DSN: z.string().optional().default(''),
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional().default(''),
  OTEL_SERVICE_NAME: z.string().min(1).default('zea-play'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url(),
});

const unsafeProductionValues = new Set(['replace-me', 'minioadmin', 'zea_password', 'password']);

export type Environment = z.infer<typeof environmentSchema>;

export function validateEnvironment(source: NodeJS.ProcessEnv): Environment {
  const env = environmentSchema.parse(source);
  if (env.APP_ENV === 'production' || env.NODE_ENV === 'production') {
    assertProductionSafe(env);
  }
  return env;
}

export function parseCorsOrigins(value: string): string[] {
  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.includes('*')) {
    throw new Error('Wildcard CORS origins are not allowed.');
  }

  return origins;
}

function assertProductionSafe(env: Environment) {
  const secretValues = [env.JWT_ACCESS_SECRET, env.MINIO_ACCESS_KEY, env.MINIO_SECRET_KEY];

  for (const value of secretValues) {
    if (value.length < 32 || unsafeProductionValues.has(value)) {
      throw new Error('Production secrets must be unique values of at least 32 characters.');
    }
  }

  if (env.CORS_ORIGINS.includes('*')) {
    throw new Error('Production CORS origins must be explicit.');
  }
}
