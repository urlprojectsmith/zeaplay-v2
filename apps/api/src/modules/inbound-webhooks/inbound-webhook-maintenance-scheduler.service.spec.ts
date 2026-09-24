import { INBOUND_WEBHOOK_CLEANUP_JOB_TYPE } from '../../infrastructure/queue/queue.constants';
import { InboundWebhookMaintenanceSchedulerService } from './inbound-webhook-maintenance-scheduler.service';

describe('InboundWebhookMaintenanceSchedulerService', () => {
  it('registers a bounded repeatable cleanup job without payload data', async () => {
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    const service = new InboundWebhookMaintenanceSchedulerService(queue as never);

    await service.onModuleInit();

    expect(queue.add).toHaveBeenCalledWith(
      INBOUND_WEBHOOK_CLEANUP_JOB_TYPE,
      { version: 1, type: INBOUND_WEBHOOK_CLEANUP_JOB_TYPE },
      expect.objectContaining({
        jobId: 'inbound-webhook-cleanup',
        repeat: { every: 60 * 60 * 1000 },
        removeOnComplete: { age: 86_400, count: 100 },
        removeOnFail: { age: 604_800, count: 500 },
      }),
    );
  });

  it('does not fail application startup when queue registration is unavailable', async () => {
    const queue = { add: jest.fn().mockRejectedValue(new Error('queue unavailable')) };
    const service = new InboundWebhookMaintenanceSchedulerService(queue as never);

    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });
});
