export const webEnv = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1',
  sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN ?? '',
};
