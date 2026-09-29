import { ReportExportFormat, ReportExportStatus, ReportExecutionStatus } from '@prisma/client';
import { ReportExportProcessor } from './report-export.processor';

describe('ReportExportProcessor', () => {
  it('renders queued aggregate snapshots and marks export ready', async () => {
    const prisma = minimalPrisma();
    const storage = { upload: jest.fn().mockResolvedValue(undefined) };
    const processor = new ReportExportProcessor(prisma as never, storage as never);

    await processor.process({
      name: 'report.export.generate',
      data: { exportId: 'export-1', executionId: 'execution-1' },
    } as never);

    expect(storage.upload).toHaveBeenCalledWith(
      'generated/reports/workspace/00000000-0000-4000-8000-000000000001/export-1',
      expect.any(Buffer),
      expect.objectContaining({ contentType: 'text/csv; charset=utf-8' }),
    );
    expect(prisma.reportExport.update).toHaveBeenLastCalledWith({
      where: { id: 'export-1' },
      data: expect.objectContaining({
        status: ReportExportStatus.READY,
        storageProvider: 'MINIO',
        sizeBytes: expect.any(BigInt),
      }),
    });
    expect(prisma.reportExecution.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'execution-1' },
      data: expect.objectContaining({ status: ReportExecutionStatus.SUCCEEDED, rowCount: 1 }),
    });
  });

  it('fails safely when the prepared aggregate table is missing', async () => {
    const prisma = minimalPrisma({ configSnapshot: { metricKeys: ['tasks.total'] } });
    const processor = new ReportExportProcessor(prisma as never, { upload: jest.fn() } as never);

    await expect(
      processor.process({
        name: 'report.export.generate',
        data: { exportId: 'export-1', executionId: 'execution-1' },
      } as never),
    ).rejects.toThrow('REPORT_EXPORT_TABLE_MISSING');

    expect(prisma.reportExport.update).toHaveBeenLastCalledWith({
      where: { id: 'export-1' },
      data: expect.objectContaining({
        status: ReportExportStatus.FAILED,
        safeErrorCode: 'REPORT_EXPORT_TABLE_MISSING',
      }),
    });
  });
});

function minimalPrisma(overrides: Record<string, unknown> = {}) {
  return {
    reportExport: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'export-1',
        scopeType: 'WORKSPACE',
        scopeId: '00000000-0000-4000-8000-000000000001',
        format: ReportExportFormat.CSV,
        status: ReportExportStatus.QUEUED,
        mimeType: 'text/csv; charset=utf-8',
        filename: 'tasks.csv',
        configSnapshot: overrides.configSnapshot ?? {
          preparedTable: { columns: ['Metric', 'Value'], rows: [['=danger', 3]] },
        },
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    reportExecution: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
}
