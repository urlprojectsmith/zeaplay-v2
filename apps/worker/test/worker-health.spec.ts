import { Test } from '@nestjs/testing';
import { HealthService } from '../src/modules/health/health.service';
import { FOUNDATION_QUEUES } from '../src/queue/queue.constants';
import { QueueHealthService } from '../src/queue/queue-health.service';

describe('worker health', () => {
  it('reports registered foundation queues', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [HealthService, QueueHealthService],
    }).compile();

    const health = moduleRef.get(HealthService);
    expect(health.ready().queues).toHaveLength(FOUNDATION_QUEUES.length);
  });
});
