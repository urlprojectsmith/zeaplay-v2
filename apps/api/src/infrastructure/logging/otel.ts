export function bootstrapOpenTelemetry() {
  return {
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'zea-play-api',
    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318',
  };
}
