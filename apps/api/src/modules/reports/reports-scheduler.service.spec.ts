import { ReportsSchedulerService } from './reports-scheduler.service';

describe('ReportsSchedulerService', () => {
  it('registers one repeatable report schedule scanner', async () => {
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    const service = new ReportsSchedulerService(queue as never);

    await service.onModuleInit();

    expect(queue.add).toHaveBeenCalledWith(
      'report.schedule.scan',
      { type: 'report.schedule.scan', version: 1 },
      expect.objectContaining({ jobId: 'report-schedule-scan', repeat: { every: 60_000 } }),
    );
  });
});
