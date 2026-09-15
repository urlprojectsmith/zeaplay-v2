import { Injectable } from '@nestjs/common';
import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  readonly httpRequests = new Counter({
    name: 'zea_api_http_requests_total',
    help: 'Total API HTTP requests by route, method, and status.',
    labelNames: ['method', 'route', 'status'],
    registers: [this.registry],
  });
  readonly httpLatency = new Histogram({
    name: 'zea_api_http_request_duration_seconds',
    help: 'API HTTP request latency.',
    labelNames: ['method', 'route', 'status'],
    registers: [this.registry],
  });
  readonly dependencyHealth = new Gauge({
    name: 'zea_dependency_health',
    help: 'Dependency health where 1 is healthy and 0 is unhealthy.',
    labelNames: ['dependency'],
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry, prefix: 'zea_' });
  }
}
