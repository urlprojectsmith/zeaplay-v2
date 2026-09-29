import { ConflictException, ForbiddenException } from '@nestjs/common';
import {
  AnalyticsScopeType,
  ReportExportFormat,
  ReportExportStatus,
  ReportExecutionStatus,
  ReportStatus,
} from '@prisma/client';
import { PermissionKeys } from '../../common/authorization/permissions';
import { ReportsService } from './reports.service';

describe('ReportsService', () => {
  it('rejects stale optimistic revisions before mutating a report', async () => {
    const { service, prisma, actor, scope } = harness();
    prisma.report.findFirst.mockResolvedValue(reportRecord({ revision: 3 }));

    await expect(
      service.update(scope as never, actor, 'report-1', {
        expectedRevision: 2,
        name: 'Stale edit',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.report.update).not.toHaveBeenCalled();
  });

  it('renders small exports synchronously through storage with retention metadata', async () => {
    const { service, prisma, analytics, storage, actor, scope } = harness();
    prisma.report.findFirst.mockResolvedValue(reportRecord());
    prisma.reportExecution.create.mockResolvedValue({ id: 'execution-1' });
    prisma.reportExport.findFirst.mockResolvedValue(null);
    prisma.reportExport.create.mockResolvedValue({
      id: 'export-1',
      reportId: 'report-1',
      scopeType: AnalyticsScopeType.WORKSPACE,
      scopeId: scope.id,
      format: ReportExportFormat.CSV,
      status: ReportExportStatus.RUNNING,
      filename: 'ops.csv',
      mimeType: 'text/csv; charset=utf-8',
      expiresAt: new Date('2026-10-03T00:00:00.000Z'),
    });
    prisma.reportExport.findUniqueOrThrow.mockResolvedValue({
      id: 'export-1',
      scopeType: AnalyticsScopeType.WORKSPACE,
      scopeId: scope.id,
      filename: 'ops.csv',
    });
    prisma.reportExport.update.mockResolvedValue({
      id: 'export-1',
      reportId: 'report-1',
      format: ReportExportFormat.CSV,
      status: ReportExportStatus.READY,
      filename: 'ops.csv',
      mimeType: 'text/csv; charset=utf-8',
      sizeBytes: 24n,
      rowCount: 1,
      expiresAt: new Date('2026-10-03T00:00:00.000Z'),
      completedAt: new Date('2026-09-26T00:00:00.000Z'),
    });
    analytics.workspaceSummary.mockResolvedValue({
      metrics: [
        {
          key: 'tasks.total',
          displayName: '=Danger',
          domain: 'tasks',
          unit: 'count',
          value: 4,
          comparison: null,
        },
      ],
      timeSeries: { metricKey: 'tasks.total', bucket: 'DAY', points: [] },
      dimension: null,
    });

    const result = await service.export(scope as never, actor, 'report-1', { format: 'CSV' });

    expect(result.queued).toBe(false);
    expect(storage.upload).toHaveBeenCalledWith(
      'generated/reports/workspace/00000000-0000-4000-8000-000000000001/export-1',
      expect.any(Buffer),
      expect.objectContaining({ contentType: 'text/csv; charset=utf-8', fileName: 'ops.csv' }),
    );
    expect(String(storage.upload.mock.calls[0]?.[1])).toContain("'=Danger");
    expect(prisma.reportExecution.update).toHaveBeenCalledWith({
      where: { id: 'execution-1' },
      data: expect.objectContaining({ rowCount: 1 }),
    });
  });

  it('denies export when the service caller lacks reports.export', async () => {
    const { service, prisma, actor, scope } = harness();
    prisma.report.findFirst.mockResolvedValue(reportRecord());

    await expect(
      service.export(
        scope as never,
        { ...actor, permissions: [PermissionKeys.reportsView] },
        'report-1',
        { format: 'CSV' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.report.findFirst).not.toHaveBeenCalled();
  });

  it('scans only active reports and revalidates scheduled recipients before execution', async () => {
    const { service, prisma, analytics, scope } = harness();
    prisma.reportSchedule.findMany.mockResolvedValue([
      {
        id: 'schedule-1',
        reportId: 'report-1',
        scopeType: AnalyticsScopeType.WORKSPACE,
        scopeId: scope.id,
        frequency: 'DAILY',
        timezone: 'UTC',
        localTime: '09:00',
        dayOfWeek: null,
        dayOfMonth: null,
        recipientConfig: { workspaceMembershipIds: ['membership-revoked'] },
        nextRunAt: new Date('2026-09-28T00:00:00.000Z'),
        createdByUserId: '00000000-0000-4000-8000-000000000004',
        report: reportRecord(),
      },
    ]);
    prisma.reportScheduleOccurrence.create.mockResolvedValue({ id: 'occurrence-1' });
    prisma.workspace.findUnique.mockResolvedValue({
      id: scope.id,
      agencyId: scope.agencyId,
      agency: { superAgencyId: scope.superAgencyId },
    });
    prisma.workspaceMembership.count.mockResolvedValue(0);

    const result = await service.dispatchDueSchedules(new Date('2026-09-28T00:00:00.000Z'));

    expect(prisma.reportSchedule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ report: { status: ReportStatus.ACTIVE } }),
      }),
    );
    expect(analytics.workspaceSummary).not.toHaveBeenCalled();
    expect(prisma.reportScheduleOccurrence.update).toHaveBeenCalledWith({
      where: { id: 'occurrence-1' },
      data: expect.objectContaining({ status: ReportExecutionStatus.FAILED }),
    });
    expect(result).toEqual({ scanned: 1, dispatched: 0 });
  });
});

function harness() {
  const prisma = {
    report: { findFirst: jest.fn(), update: jest.fn() },
    reportExecution: { create: jest.fn(), update: jest.fn() },
    reportExport: {
      findFirst: jest.fn(),
      create: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    reportSchedule: { findMany: jest.fn(), update: jest.fn() },
    reportScheduleOccurrence: { create: jest.fn(), update: jest.fn() },
    workspace: { findUnique: jest.fn() },
    workspaceMembership: { count: jest.fn() },
    agencyMembership: { count: jest.fn() },
    superAgencyMembership: { count: jest.fn() },
    user: { count: jest.fn() },
    $transaction: jest.fn((operations: unknown) => Promise.resolve(operations)),
  };
  const analytics = { workspaceSummary: jest.fn() };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const storage = {
    upload: jest.fn().mockResolvedValue(undefined),
    createPresignedDownloadUrl: jest.fn(),
  };
  const queue = { add: jest.fn().mockResolvedValue(undefined) };
  return {
    service: new ReportsService(
      prisma as never,
      analytics as never,
      audit as never,
      storage as never,
      queue as never,
    ),
    prisma,
    analytics,
    storage,
    scope: {
      type: AnalyticsScopeType.WORKSPACE,
      id: '00000000-0000-4000-8000-000000000001',
      workspaceId: '00000000-0000-4000-8000-000000000001',
      agencyId: '00000000-0000-4000-8000-000000000002',
      superAgencyId: '00000000-0000-4000-8000-000000000003',
    },
    actor: {
      userId: '00000000-0000-4000-8000-000000000004',
      permissions: [
        PermissionKeys.reportsView,
        PermissionKeys.reportsCreate,
        PermissionKeys.reportsEdit,
        PermissionKeys.reportsExport,
        PermissionKeys.reportsSchedule,
        PermissionKeys.reportsManage,
      ],
      workspaceMembershipId: '00000000-0000-4000-8000-000000000005',
    },
  };
}

function reportRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'report-1',
    scopeType: AnalyticsScopeType.WORKSPACE,
    scopeId: '00000000-0000-4000-8000-000000000001',
    name: 'Ops',
    type: 'SUMMARY',
    visibility: 'SCOPE',
    configuration: {
      metricKeys: ['tasks.total'],
      datePreset: 'LAST_30_DAYS',
      bucket: 'DAY',
    },
    revision: 1,
    status: 'ACTIVE',
    createdByUserId: '00000000-0000-4000-8000-000000000004',
    accesses: [],
    schedules: [],
    ...overrides,
  };
}
