import { Injectable } from '@nestjs/common';
import { QueueHealthService } from '../../queue/queue-health.service';

@Injectable()
export class HealthService {
  constructor(private readonly queueHealth: QueueHealthService) {}

  basic() {
    return { status: 'ok', service: 'zea-play-worker', timestamp: new Date().toISOString() };
  }

  live() {
    return { status: 'live', timestamp: new Date().toISOString() };
  }

  ready() {
    return {
      status: 'ready',
      queues: this.queueHealth.listRegisteredQueues(),
      timestamp: new Date().toISOString(),
    };
  }
}
