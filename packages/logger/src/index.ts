import pino from 'pino';

export function createLogger(serviceName: string) {
  return pino({
    name: serviceName,
    level: process.env.LOG_LEVEL ?? 'info',
    base: {
      service: serviceName,
      environment: process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
