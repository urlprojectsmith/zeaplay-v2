import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import {
  AnalyticsScopeType,
  MembershipStatus,
  Prisma,
  ReportExportFormat,
  ReportExportStatus,
  ReportExecutionStatus,
  ReportExecutionType,
  ReportScheduleFrequency,
  ReportStatus,
  ReportType,
  ReportVisibility,
} from '@prisma/client';
import { Queue } from 'bullmq';
import { DateTime } from 'luxon';
import type {
  AgencyTenantContext,
  AuthenticatedUser,
  SuperAgencyTenantContext,
  WorkspaceTenantContext,
} from '../../common/auth/auth.types';
import { PermissionKeys } from '../../common/authorization/permissions';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { REPORT_EXPORT_JOB_TYPE, REPORTS_QUEUE } from '../../infrastructure/queue/queue.constants';
import type { StorageAdapter } from '../../infrastructure/storage/storage-adapter';
import { STORAGE_ADAPTER } from '../../infrastructure/storage/storage.tokens';
import { AnalyticsService } from '../analytics/analytics.service';
import type { AnalyticsQueryDto } from '../analytics/dto/analytics.dto';
import { AuditService } from '../audit/audit.service';
import {
  CreateReportDto,
  CreateReportScheduleDto,
  ExportReportDto,
  ReportConfigDto,
  ReportListQueryDto,
  ReportRecipientConfigDto,
  UpdateReportDto,
  UpdateReportScheduleDto,
} from './dto/reports.dto';
import {
  exportExtension,
  exportMimeType,
  reportTableToCsv,
  reportTableToXlsx,
  REPORT_EXPORT_RETENTION_DAYS,
  REPORT_SYNC_EXPORT_ROW_LIMIT,
  type ReportTable,
} from './report-exporter';

const PLATFORM_SCOPE_ID = '00000000-0000-4000-8000-000000000000';

type ReportScope = {
  type: AnalyticsScopeType;
  id: string;
  workspaceId: string | null;
  agencyId: string | null;
  superAgencyId: string | null;
};

type ReportActor = {
  userId: string;
  permissions: string[];
  workspaceMembershipId?: string | null;
  agencyMembershipId?: string | null;
  superAgencyMembershipId?: string | null;
};

type ReportAccessEntry = {
  workspaceMembershipId?: string | null;
  agencyMembershipId?: string | null;
  superAgencyMembershipId?: string | null;
  userId?: string | null;
};

type ReadableReport = {
  accesses: ReportAccessEntry[];
  visibility: ReportVisibility;
  createdByUserId: string | null;
};

type SerializableReport = ReadableReport & {
  id: string;
  scopeType: AnalyticsScopeType;
  scopeId: string;
  name: string;
  description: string | null;
  type: ReportType;
  configuration: Prisma.JsonValue;
  revision: number;
  status: ReportStatus;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  schedules?: unknown[];
};

type SerializableExport = {
  id: string;
  reportId: string;
  format: ReportExportFormat;
  status: ReportExportStatus;
  filename: string;
  mimeType: string;
  sizeBytes?: bigint | number | string | null;
  rowCount?: number | null;
  expiresAt: Date;
  completedAt?: Date | null;
  safeErrorCode?: string | null;
};

type SerializableSchedule = {
  id: string;
  reportId: string;
  frequency: ReportScheduleFrequency;
  timezone: string;
  localTime: string;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  enabled: boolean;
  recipientConfig: Prisma.JsonValue;
  nextRunAt: Date;
  lastRunAt: Date | null;
};

type AnalyticsResult = {
  metrics?: Array<{
    key: string;
    displayName: string;
    domain: string;
    unit: string;
    value: number | string | null;
    comparison?: { previous: number | string | null; percentChange: number | null } | null;
  }>;
  timeSeries?: {
    metricKey: string | null;
    bucket: string;
    points: Array<{ start: string; end: string; value: number | string | null }>;
  };
  dimension?: {
    dimension: string;
    items: Array<{ key: string; label: string; value: number | string | null }>;
  } | null;
};

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
    private readonly audit: AuditService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    @InjectQueue(REPORTS_QUEUE) private readonly reportsQueue: Queue,
  ) {}

  workspaceScope(tenant: WorkspaceTenantContext): Promise<ReportScope> {
    return this.resolveScope(AnalyticsScopeType.WORKSPACE, tenant.workspaceId);
  }

  agencyScope(tenant: AgencyTenantContext): Promise<ReportScope> {
    return this.resolveScope(AnalyticsScopeType.AGENCY, tenant.agencyId);
  }

  superAgencyScope(tenant: SuperAgencyTenantContext): Promise<ReportScope> {
    return this.resolveScope(AnalyticsScopeType.SUPER_AGENCY, tenant.superAgencyId);
  }

  platformScope(): ReportScope {
    return {
      type: AnalyticsScopeType.PLATFORM,
      id: PLATFORM_SCOPE_ID,
      workspaceId: null,
      agencyId: null,
      superAgencyId: null,
    };
  }

  workspaceActor(tenant: WorkspaceTenantContext): ReportActor {
    return {
      userId: tenant.userId,
      permissions: tenant.permissions,
      workspaceMembershipId: tenant.workspaceMembershipId,
      agencyMembershipId: tenant.agencyMembershipId,
    };
  }

  agencyActor(tenant: AgencyTenantContext): ReportActor {
    return {
      userId: tenant.userId,
      permissions: tenant.permissions,
      agencyMembershipId: tenant.agencyMembershipId,
    };
  }

  superAgencyActor(tenant: SuperAgencyTenantContext): ReportActor {
    return {
      userId: tenant.userId,
      permissions: tenant.permissions,
      superAgencyMembershipId: tenant.superAgencyMembershipId,
    };
  }

  platformActor(user: AuthenticatedUser): ReportActor {
    return {
      userId: user.id,
      permissions: [
        PermissionKeys.reportsPlatformRead,
        PermissionKeys.reportsView,
        PermissionKeys.reportsCreate,
        PermissionKeys.reportsEdit,
        PermissionKeys.reportsExport,
        PermissionKeys.reportsSchedule,
        PermissionKeys.reportsManage,
      ],
    };
  }

  async list(scope: ReportScope, actor: ReportActor, query: ReportListQueryDto) {
    this.assertPermission(actor, PermissionKeys.reportsView);
    const reports = await this.prisma.report.findMany({
      where: {
        scopeType: scope.type,
        scopeId: scope.id,
        status: query.status ?? ReportStatus.ACTIVE,
        ...(query.search
          ? { name: { contains: query.search, mode: Prisma.QueryMode.insensitive } }
          : {}),
      },
      include: { accesses: true, schedules: true },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
    return {
      reports: reports
        .filter((report) => this.canRead(report, actor))
        .map((report) => serializeReport(report)),
    };
  }

  async create(scope: ReportScope, actor: ReportActor, dto: CreateReportDto) {
    this.assertPermission(actor, PermissionKeys.reportsCreate);
    await this.executeAnalytics(scope, dto.configuration);
    await this.assertAccessMembers(scope, dto.accessMembershipIds ?? []);
    const report = await this.prisma.report.create({
      data: {
        scopeType: scope.type,
        scopeId: scope.id,
        workspaceId: scope.workspaceId,
        agencyId: scope.agencyId,
        superAgencyId: scope.superAgencyId,
        createdByUserId: actor.userId,
        createdByWorkspaceMembershipId: actor.workspaceMembershipId ?? null,
        createdByAgencyMembershipId: actor.agencyMembershipId ?? null,
        createdBySuperAgencyMembershipId: actor.superAgencyMembershipId ?? null,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        type: dto.type as ReportType,
        visibility: (dto.visibility ?? 'PRIVATE') as ReportVisibility,
        configuration: sanitizeConfig(dto.configuration),
        accesses: {
          create: this.accessRows(scope, dto.accessMembershipIds ?? []),
        },
      },
      include: { accesses: true, schedules: true },
    });
    await this.auditReport(scope, actor, 'report.create', report.id, report);
    return { report: serializeReport(report) };
  }

  async get(scope: ReportScope, actor: ReportActor, reportId: string) {
    this.assertPermission(actor, PermissionKeys.reportsView);
    const report = await this.findScopedReport(scope, reportId, true);
    this.assertCanRead(report, actor);
    return { report: serializeReport(report) };
  }

  async update(scope: ReportScope, actor: ReportActor, reportId: string, dto: UpdateReportDto) {
    this.assertPermission(actor, PermissionKeys.reportsEdit);
    const report = await this.findScopedReport(scope, reportId, true);
    this.assertCanRead(report, actor);
    if (!this.canManage(report, actor)) throw new ForbiddenException('REPORT_EDIT_DENIED');
    if (report.revision !== dto.expectedRevision) {
      throw new ConflictException({
        code: 'REPORT_REVISION_CONFLICT',
        currentRevision: report.revision,
      });
    }
    if (dto.configuration) await this.executeAnalytics(scope, dto.configuration);
    if (dto.accessMembershipIds) await this.assertAccessMembers(scope, dto.accessMembershipIds);
    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.accessMembershipIds) {
        await tx.reportAccess.deleteMany({ where: { reportId } });
      }
      return tx.report.update({
        where: { id: reportId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.description !== undefined
            ? { description: dto.description?.trim() || null }
            : {}),
          ...(dto.type ? { type: dto.type as ReportType } : {}),
          ...(dto.visibility ? { visibility: dto.visibility as ReportVisibility } : {}),
          ...(dto.configuration ? { configuration: sanitizeConfig(dto.configuration) } : {}),
          revision: { increment: 1 },
          ...(dto.accessMembershipIds
            ? { accesses: { create: this.accessRows(scope, dto.accessMembershipIds) } }
            : {}),
        },
        include: { accesses: true, schedules: true },
      });
    });
    await this.auditReport(scope, actor, 'report.update', updated.id, updated);
    return { report: serializeReport(updated) };
  }

  async archive(scope: ReportScope, actor: ReportActor, reportId: string) {
    this.assertPermission(actor, PermissionKeys.reportsManage);
    const report = await this.findScopedReport(scope, reportId, false);
    if (!this.canManage(report, actor)) throw new ForbiddenException('REPORT_ARCHIVE_DENIED');
    const updated = await this.prisma.report.update({
      where: { id: reportId },
      data: { status: ReportStatus.ARCHIVED, archivedAt: new Date(), revision: { increment: 1 } },
      include: { accesses: true, schedules: true },
    });
    await this.auditReport(scope, actor, 'report.archive', reportId, updated);
    return { report: serializeReport(updated) };
  }

  async preview(scope: ReportScope, actor: ReportActor, reportId: string) {
    this.assertPermission(actor, PermissionKeys.reportsView);
    const report = await this.findScopedReport(scope, reportId, true);
    this.assertCanRead(report, actor);
    const startedAt = new Date();
    const execution = await this.prisma.reportExecution.create({
      data: {
        reportId: report.id,
        scopeType: scope.type,
        scopeId: scope.id,
        reportRevision: report.revision,
        configSnapshot: inputJson(report.configuration),
        executionType: ReportExecutionType.PREVIEW,
        status: ReportExecutionStatus.RUNNING,
        requestedByUserId: actor.userId,
        requestedByMembershipId: this.primaryMembershipId(actor),
        startedAt,
      },
    });
    try {
      const result = await this.executeAnalytics(
        scope,
        report.configuration as unknown as ReportConfigDto,
      );
      const table = this.toTable(report.type, result);
      await this.prisma.reportExecution.update({
        where: { id: execution.id },
        data: {
          status: ReportExecutionStatus.SUCCEEDED,
          completedAt: new Date(),
          rowCount: table.rows.length,
        },
      });
      return { executionId: execution.id, result, table };
    } catch (error) {
      await this.prisma.reportExecution.update({
        where: { id: execution.id },
        data: {
          status: ReportExecutionStatus.FAILED,
          failedAt: new Date(),
          safeErrorCode: safeErrorCode(error),
        },
      });
      throw error;
    }
  }

  async export(scope: ReportScope, actor: ReportActor, reportId: string, dto: ExportReportDto) {
    this.assertPermission(actor, PermissionKeys.reportsExport);
    const report = await this.findScopedReport(scope, reportId, true);
    this.assertCanRead(report, actor);
    const format = dto.format as ReportExportFormat;
    if (dto.idempotencyKey) {
      const existing = await this.prisma.reportExport.findFirst({
        where: { reportId, requestedByUserId: actor.userId, idempotencyKey: dto.idempotencyKey },
      });
      if (existing) return { export: serializeExport(existing) };
    }
    const result = await this.executeAnalytics(
      scope,
      report.configuration as unknown as ReportConfigDto,
    );
    const table = this.toTable(report.type, result);
    const expiresAt = DateTime.utc().plus({ days: REPORT_EXPORT_RETENTION_DAYS }).toJSDate();
    const filename = reportFilename(report.name, format);
    const execution = await this.prisma.reportExecution.create({
      data: {
        reportId,
        scopeType: scope.type,
        scopeId: scope.id,
        reportRevision: report.revision,
        configSnapshot: inputJson(report.configuration),
        executionType: ReportExecutionType.MANUAL_EXPORT,
        status: ReportExecutionStatus.RUNNING,
        requestedByUserId: actor.userId,
        requestedByMembershipId: this.primaryMembershipId(actor),
        startedAt: new Date(),
      },
    });
    const shouldQueue = Boolean(dto.async) || table.rows.length > REPORT_SYNC_EXPORT_ROW_LIMIT;
    const created = await this.prisma.reportExport.create({
      data: {
        reportId,
        executionId: execution.id,
        scopeType: scope.type,
        scopeId: scope.id,
        format,
        status: shouldQueue ? ReportExportStatus.QUEUED : ReportExportStatus.RUNNING,
        requestedByUserId: actor.userId,
        requestedByMembershipId: this.primaryMembershipId(actor),
        reportRevision: report.revision,
        configSnapshot: {
          ...safeJson(report.configuration),
          preparedTable: table as unknown as Prisma.InputJsonValue,
        },
        filename,
        mimeType: exportMimeType(format),
        idempotencyKey: dto.idempotencyKey ?? null,
        expiresAt,
        rowCount: table.rows.length,
      },
    });
    if (shouldQueue) {
      await this.reportsQueue.add(REPORT_EXPORT_JOB_TYPE, {
        exportId: created.id,
        executionId: execution.id,
      });
      await this.auditReport(scope, actor, 'report.export_queued', reportId, created);
      return { export: serializeExport(created), queued: true };
    }
    const completed = await this.renderAndStoreExport(created.id, format, table);
    await this.prisma.reportExecution.update({
      where: { id: execution.id },
      data: {
        status: ReportExecutionStatus.SUCCEEDED,
        completedAt: new Date(),
        rowCount: table.rows.length,
      },
    });
    await this.auditReport(scope, actor, 'report.export_ready', reportId, completed);
    return { export: serializeExport(completed), queued: false };
  }

  async download(scope: ReportScope, actor: ReportActor, reportId: string, exportId: string) {
    this.assertPermission(actor, PermissionKeys.reportsExport);
    const report = await this.findScopedReport(scope, reportId, true);
    this.assertCanRead(report, actor);
    const exportRecord = await this.prisma.reportExport.findFirst({
      where: { id: exportId, reportId, scopeType: scope.type, scopeId: scope.id },
    });
    if (!exportRecord) throw new NotFoundException('REPORT_EXPORT_NOT_FOUND');
    if (exportRecord.status !== ReportExportStatus.READY || !exportRecord.storageKey) {
      throw new ConflictException('REPORT_EXPORT_NOT_READY');
    }
    if (exportRecord.expiresAt <= new Date()) {
      await this.prisma.reportExport.update({
        where: { id: exportRecord.id },
        data: { status: ReportExportStatus.EXPIRED },
      });
      throw new ConflictException('REPORT_EXPORT_EXPIRED');
    }
    const downloadUrl = await this.storage.createPresignedDownloadUrl(exportRecord.storageKey, 900);
    await this.auditReport(scope, actor, 'report.export_download_authorized', reportId, {
      exportId,
      format: exportRecord.format,
    });
    return {
      export: serializeExport(exportRecord),
      downloadUrl,
      expiresInSeconds: 900,
    };
  }

  async createSchedule(
    scope: ReportScope,
    actor: ReportActor,
    reportId: string,
    dto: CreateReportScheduleDto,
  ) {
    this.assertPermission(actor, PermissionKeys.reportsSchedule);
    const report = await this.findScopedReport(scope, reportId, true);
    if (!this.canManage(report, actor)) throw new ForbiddenException('REPORT_SCHEDULE_DENIED');
    await this.assertRecipients(scope, dto.recipients);
    const nextRunAt = nextScheduleRun(dto.frequency, dto.timezone, dto.localTime, {
      dayOfWeek: dto.dayOfWeek,
      dayOfMonth: dto.dayOfMonth,
    });
    const schedule = await this.prisma.reportSchedule.create({
      data: {
        reportId,
        scopeType: scope.type,
        scopeId: scope.id,
        frequency: dto.frequency as ReportScheduleFrequency,
        timezone: dto.timezone,
        localTime: dto.localTime,
        dayOfWeek: dto.dayOfWeek ?? null,
        dayOfMonth: dto.dayOfMonth ?? null,
        recipientConfig: sanitizeRecipientConfig(dto.recipients),
        nextRunAt,
        createdByUserId: actor.userId,
      },
    });
    await this.auditReport(scope, actor, 'report.schedule_create', reportId, schedule);
    return { schedule: serializeSchedule(schedule) };
  }

  async listSchedules(scope: ReportScope, actor: ReportActor, reportId: string) {
    this.assertPermission(actor, PermissionKeys.reportsView);
    const report = await this.findScopedReport(scope, reportId, true);
    this.assertCanRead(report, actor);
    const schedules = await this.prisma.reportSchedule.findMany({
      where: { reportId, scopeType: scope.type, scopeId: scope.id },
      orderBy: { createdAt: 'desc' },
    });
    return { schedules: schedules.map(serializeSchedule) };
  }

  async updateSchedule(
    scope: ReportScope,
    actor: ReportActor,
    reportId: string,
    scheduleId: string,
    dto: UpdateReportScheduleDto,
  ) {
    this.assertPermission(actor, PermissionKeys.reportsSchedule);
    const report = await this.findScopedReport(scope, reportId, true);
    if (!this.canManage(report, actor)) throw new ForbiddenException('REPORT_SCHEDULE_DENIED');
    const existing = await this.prisma.reportSchedule.findFirst({
      where: { id: scheduleId, reportId, scopeType: scope.type, scopeId: scope.id },
    });
    if (!existing) throw new NotFoundException('REPORT_SCHEDULE_NOT_FOUND');
    const recipients = dto.recipients ?? (existing.recipientConfig as ReportRecipientConfigDto);
    await this.assertRecipients(scope, recipients);
    const frequency = (dto.frequency ?? existing.frequency) as ReportScheduleFrequency;
    const timezone = dto.timezone ?? existing.timezone;
    const localTime = dto.localTime ?? existing.localTime;
    const dayOfWeek = dto.dayOfWeek ?? existing.dayOfWeek ?? undefined;
    const dayOfMonth = dto.dayOfMonth ?? existing.dayOfMonth ?? undefined;
    const schedule = await this.prisma.reportSchedule.update({
      where: { id: scheduleId },
      data: {
        enabled: dto.enabled ?? existing.enabled,
        frequency,
        timezone,
        localTime,
        dayOfWeek: dayOfWeek ?? null,
        dayOfMonth: dayOfMonth ?? null,
        recipientConfig: sanitizeRecipientConfig(recipients),
        nextRunAt: nextScheduleRun(frequency, timezone, localTime, { dayOfWeek, dayOfMonth }),
      },
    });
    await this.auditReport(scope, actor, 'report.schedule_update', reportId, schedule);
    return { schedule: serializeSchedule(schedule) };
  }

  async dispatchDueSchedules(now = new Date()) {
    const schedules = await this.prisma.reportSchedule.findMany({
      where: { enabled: true, nextRunAt: { lte: now }, report: { status: ReportStatus.ACTIVE } },
      include: { report: true },
      orderBy: [{ nextRunAt: 'asc' }, { id: 'asc' }],
      take: 20,
    });
    let dispatched = 0;
    for (const schedule of schedules) {
      const occurrenceKey = DateTime.fromJSDate(schedule.nextRunAt)
        .toUTC()
        .toISO({ suppressMilliseconds: true });
      if (!occurrenceKey) continue;
      const occurrence = await this.claimScheduleOccurrence(schedule.id, occurrenceKey);
      if (!occurrence) continue;
      try {
        const scope =
          schedule.scopeType === AnalyticsScopeType.PLATFORM
            ? this.platformScope()
            : await this.resolveScope(schedule.scopeType, schedule.scopeId);
        await this.assertRecipients(
          scope,
          schedule.recipientConfig as unknown as ReportRecipientConfigDto,
        );
        const result = await this.executeAnalytics(scope, schedule.report.configuration);
        const table = this.toTable(schedule.report.type, result);
        const execution = await this.prisma.reportExecution.create({
          data: {
            reportId: schedule.reportId,
            scopeType: schedule.scopeType,
            scopeId: schedule.scopeId,
            reportRevision: schedule.report.revision,
            configSnapshot: inputJson(schedule.report.configuration),
            executionType: ReportExecutionType.SCHEDULED_EXPORT,
            status: ReportExecutionStatus.RUNNING,
            requestedByUserId: schedule.createdByUserId,
            scheduledOccurrenceKey: occurrenceKey,
            startedAt: now,
          },
        });
        const exportRecord = await this.prisma.reportExport.create({
          data: {
            reportId: schedule.reportId,
            executionId: execution.id,
            scopeType: schedule.scopeType,
            scopeId: schedule.scopeId,
            format: ReportExportFormat.CSV,
            status: ReportExportStatus.RUNNING,
            requestedByUserId: schedule.createdByUserId,
            reportRevision: schedule.report.revision,
            configSnapshot: {
              ...safeJson(schedule.report.configuration),
              preparedTable: table as unknown as Prisma.InputJsonValue,
            },
            filename: reportFilename(schedule.report.name, ReportExportFormat.CSV),
            mimeType: exportMimeType(ReportExportFormat.CSV),
            expiresAt: DateTime.utc().plus({ days: REPORT_EXPORT_RETENTION_DAYS }).toJSDate(),
            rowCount: table.rows.length,
          },
        });
        const completed = await this.renderAndStoreExport(
          exportRecord.id,
          ReportExportFormat.CSV,
          table,
        );
        await this.prisma.$transaction([
          this.prisma.reportExecution.update({
            where: { id: execution.id },
            data: {
              status: ReportExecutionStatus.SUCCEEDED,
              completedAt: new Date(),
              rowCount: table.rows.length,
            },
          }),
          this.prisma.reportScheduleOccurrence.update({
            where: { id: occurrence.id },
            data: {
              status: ReportExecutionStatus.SUCCEEDED,
              executionId: execution.id,
              exportId: completed.id,
              completedAt: new Date(),
            },
          }),
          this.prisma.reportSchedule.update({
            where: { id: schedule.id },
            data: {
              lastRunAt: now,
              nextRunAt: nextScheduleRun(
                schedule.frequency,
                schedule.timezone,
                schedule.localTime,
                {
                  dayOfWeek: schedule.dayOfWeek ?? undefined,
                  dayOfMonth: schedule.dayOfMonth ?? undefined,
                },
              ),
            },
          }),
        ]);
        dispatched += 1;
      } catch (error) {
        await this.prisma.reportScheduleOccurrence.update({
          where: { id: occurrence.id },
          data: {
            status: ReportExecutionStatus.FAILED,
            completedAt: new Date(),
            safeErrorCode: safeErrorCode(error),
          },
        });
      }
    }
    return { scanned: schedules.length, dispatched };
  }

  private async renderAndStoreExport(
    exportId: string,
    format: ReportExportFormat,
    table: ReportTable,
  ) {
    const exportRecord = await this.prisma.reportExport.findUniqueOrThrow({
      where: { id: exportId },
    });
    const body =
      format === ReportExportFormat.CSV ? reportTableToCsv(table) : await reportTableToXlsx(table);
    const storageKey = reportStorageKey(exportRecord.scopeType, exportRecord.scopeId, exportId);
    await this.storage.upload(storageKey, body, {
      contentType: exportMimeType(format),
      fileName: exportRecord.filename,
    });
    return this.prisma.reportExport.update({
      where: { id: exportId },
      data: {
        status: ReportExportStatus.READY,
        storageProvider: 'MINIO',
        storageKey,
        sizeBytes: BigInt(body.length),
        completedAt: new Date(),
      },
    });
  }

  private async executeAnalytics(scope: ReportScope, config: ReportConfigDto | Prisma.JsonValue) {
    const query = toAnalyticsQuery(config as ReportConfigDto);
    if (scope.type === AnalyticsScopeType.WORKSPACE) {
      return this.analytics.workspaceSummary(
        {
          userId: '',
          superAgencyId: scope.superAgencyId ?? undefined,
          agencyId: scope.agencyId ?? '',
          workspaceId: scope.id,
          workspaceMembershipId: null,
          agencyMembershipId: null,
          roleId: '',
          roleName: '',
          permissions: [],
          accessSource: 'WORKSPACE_MEMBERSHIP',
        },
        query,
      ) as Promise<AnalyticsResult>;
    }
    if (scope.type === AnalyticsScopeType.AGENCY) {
      return this.analytics.agencySummary(
        {
          userId: '',
          superAgencyId: scope.superAgencyId ?? undefined,
          agencyId: scope.id,
          agencyMembershipId: '',
          roleId: '',
          roleName: '',
          permissions: [],
        },
        query,
      ) as Promise<AnalyticsResult>;
    }
    if (scope.type === AnalyticsScopeType.SUPER_AGENCY) {
      return this.analytics.superAgencySummary(
        {
          userId: '',
          superAgencyId: scope.id,
          superAgencyMembershipId: '',
          roleId: '',
          roleName: '',
          permissions: [],
          status: 'ACTIVE',
        },
        query,
      ) as Promise<AnalyticsResult>;
    }
    return this.analytics.platformSummary(query) as Promise<AnalyticsResult>;
  }

  private toTable(type: ReportType, result: AnalyticsResult): ReportTable {
    if (type === ReportType.TIME_SERIES) {
      return {
        columns: ['Start', 'End', 'Metric', 'Bucket', 'Value'],
        rows: (result.timeSeries?.points ?? []).map((point) => [
          point.start,
          point.end,
          result.timeSeries?.metricKey ?? '',
          result.timeSeries?.bucket ?? '',
          point.value,
        ]),
      };
    }
    if (type === ReportType.TABLE && result.dimension) {
      return {
        columns: ['Dimension', 'Key', 'Label', 'Value'],
        rows: result.dimension.items.map((item) => [
          result.dimension?.dimension ?? '',
          item.key,
          item.label,
          item.value,
        ]),
      };
    }
    return {
      columns: ['Metric', 'Value', 'Previous', 'Percent Change', 'Domain', 'Unit'],
      rows: (result.metrics ?? []).map((metric) => [
        metric.displayName,
        metric.value,
        metric.comparison?.previous ?? null,
        metric.comparison?.percentChange ?? null,
        metric.domain,
        metric.unit,
      ]),
    };
  }

  private async resolveScope(type: AnalyticsScopeType, id: string): Promise<ReportScope> {
    if (type === AnalyticsScopeType.WORKSPACE) {
      const workspace = await this.prisma.workspace.findUnique({
        where: { id },
        select: { id: true, agencyId: true, agency: { select: { superAgencyId: true } } },
      });
      if (!workspace) throw new NotFoundException('WORKSPACE_NOT_FOUND');
      return {
        type,
        id,
        workspaceId: id,
        agencyId: workspace.agencyId,
        superAgencyId: workspace.agency.superAgencyId,
      };
    }
    if (type === AnalyticsScopeType.AGENCY) {
      const agency = await this.prisma.agency.findUnique({
        where: { id },
        select: { id: true, superAgencyId: true },
      });
      if (!agency) throw new NotFoundException('AGENCY_NOT_FOUND');
      return {
        type,
        id,
        workspaceId: null,
        agencyId: id,
        superAgencyId: agency.superAgencyId,
      };
    }
    const superAgency = await this.prisma.superAgency.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!superAgency) throw new NotFoundException('SUPER_AGENCY_NOT_FOUND');
    return { type, id, workspaceId: null, agencyId: null, superAgencyId: id };
  }

  private async findScopedReport(scope: ReportScope, reportId: string, activeOnly: boolean) {
    const report = await this.prisma.report.findFirst({
      where: {
        id: reportId,
        scopeType: scope.type,
        scopeId: scope.id,
        ...(activeOnly ? { status: ReportStatus.ACTIVE } : {}),
      },
      include: { accesses: true, schedules: true },
    });
    if (!report) throw new NotFoundException('REPORT_NOT_FOUND');
    return report;
  }

  private async claimScheduleOccurrence(scheduleId: string, occurrenceKey: string) {
    try {
      return await this.prisma.reportScheduleOccurrence.create({
        data: {
          scheduleId,
          occurrenceKey,
          status: ReportExecutionStatus.RUNNING,
          claimedAt: new Date(),
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return null;
      }
      throw error;
    }
  }

  private assertCanRead(report: ReadableReport, actor: ReportActor) {
    if (!this.canRead(report, actor)) throw new ForbiddenException('REPORT_ACCESS_DENIED');
  }

  private assertPermission(actor: ReportActor, permission: string) {
    if (!actor.permissions.includes('*') && !actor.permissions.includes(permission)) {
      throw new ForbiddenException('REPORT_PERMISSION_DENIED');
    }
  }

  private canRead(report: ReadableReport, actor: ReportActor) {
    if (this.canManage(report, actor)) return true;
    if (report.visibility === ReportVisibility.SCOPE) return true;
    if (report.createdByUserId === actor.userId) return true;
    if (report.visibility === ReportVisibility.SELECTED_MEMBERS) {
      return report.accesses.some((access) =>
        Boolean(
          (actor.workspaceMembershipId &&
            access.workspaceMembershipId === actor.workspaceMembershipId) ||
          (actor.agencyMembershipId && access.agencyMembershipId === actor.agencyMembershipId) ||
          (actor.superAgencyMembershipId &&
            access.superAgencyMembershipId === actor.superAgencyMembershipId) ||
          access.userId === actor.userId,
        ),
      );
    }
    return false;
  }

  private canManage(report: { createdByUserId: string | null }, actor: ReportActor) {
    return (
      report.createdByUserId === actor.userId ||
      actor.permissions.includes(PermissionKeys.reportsManage)
    );
  }

  private async assertAccessMembers(scope: ReportScope, membershipIds: string[]) {
    if (!membershipIds.length) return;
    if (scope.type === AnalyticsScopeType.WORKSPACE) {
      const count = await this.prisma.workspaceMembership.count({
        where: {
          id: { in: membershipIds },
          workspaceId: scope.id,
          status: MembershipStatus.ACTIVE,
        },
      });
      if (count !== new Set(membershipIds).size)
        throw new BadRequestException('REPORT_ACCESS_MEMBER_INVALID');
      return;
    }
    if (scope.type === AnalyticsScopeType.AGENCY) {
      const count = await this.prisma.agencyMembership.count({
        where: { id: { in: membershipIds }, agencyId: scope.id, status: MembershipStatus.ACTIVE },
      });
      if (count !== new Set(membershipIds).size)
        throw new BadRequestException('REPORT_ACCESS_MEMBER_INVALID');
      return;
    }
    if (scope.type === AnalyticsScopeType.SUPER_AGENCY) {
      const count = await this.prisma.superAgencyMembership.count({
        where: {
          id: { in: membershipIds },
          superAgencyId: scope.id,
          status: MembershipStatus.ACTIVE,
        },
      });
      if (count !== new Set(membershipIds).size)
        throw new BadRequestException('REPORT_ACCESS_MEMBER_INVALID');
      return;
    }
    if (scope.type === AnalyticsScopeType.PLATFORM) {
      const count = await this.prisma.user.count({ where: { id: { in: membershipIds } } });
      if (count !== new Set(membershipIds).size)
        throw new BadRequestException('REPORT_ACCESS_MEMBER_INVALID');
    }
  }

  private async assertRecipients(scope: ReportScope, recipients: ReportRecipientConfigDto) {
    if (scope.type === AnalyticsScopeType.WORKSPACE) {
      if (
        recipients.agencyMembershipIds?.length ||
        recipients.superAgencyMembershipIds?.length ||
        recipients.userIds?.length
      ) {
        throw new BadRequestException('REPORT_RECIPIENT_SCOPE_INVALID');
      }
      await this.assertAccessMembers(scope, recipients.workspaceMembershipIds ?? []);
      return;
    }
    if (scope.type === AnalyticsScopeType.AGENCY) {
      if (
        recipients.workspaceMembershipIds?.length ||
        recipients.superAgencyMembershipIds?.length ||
        recipients.userIds?.length
      ) {
        throw new BadRequestException('REPORT_RECIPIENT_SCOPE_INVALID');
      }
      await this.assertAccessMembers(scope, recipients.agencyMembershipIds ?? []);
      return;
    }
    if (scope.type === AnalyticsScopeType.SUPER_AGENCY) {
      if (
        recipients.workspaceMembershipIds?.length ||
        recipients.agencyMembershipIds?.length ||
        recipients.userIds?.length
      ) {
        throw new BadRequestException('REPORT_RECIPIENT_SCOPE_INVALID');
      }
      await this.assertAccessMembers(scope, recipients.superAgencyMembershipIds ?? []);
      return;
    }
    if (
      recipients.workspaceMembershipIds?.length ||
      recipients.agencyMembershipIds?.length ||
      recipients.superAgencyMembershipIds?.length
    ) {
      throw new BadRequestException('REPORT_RECIPIENT_SCOPE_INVALID');
    }
    await this.assertAccessMembers(scope, recipients.userIds ?? []);
  }

  private accessRows(scope: ReportScope, membershipIds: string[]) {
    return [...new Set(membershipIds)].map((membershipId) => ({
      scopeType: scope.type,
      scopeId: scope.id,
      workspaceMembershipId: scope.type === AnalyticsScopeType.WORKSPACE ? membershipId : null,
      agencyMembershipId: scope.type === AnalyticsScopeType.AGENCY ? membershipId : null,
      superAgencyMembershipId: scope.type === AnalyticsScopeType.SUPER_AGENCY ? membershipId : null,
      userId: scope.type === AnalyticsScopeType.PLATFORM ? membershipId : null,
    }));
  }

  private primaryMembershipId(actor: ReportActor) {
    return (
      actor.workspaceMembershipId ??
      actor.agencyMembershipId ??
      actor.superAgencyMembershipId ??
      null
    );
  }

  private auditReport(
    scope: ReportScope,
    actor: ReportActor,
    action: string,
    reportId: string,
    metadata: unknown,
  ) {
    return this.audit.record({
      superAgencyId: scope.superAgencyId,
      agencyId: scope.agencyId,
      workspaceId: scope.workspaceId,
      userId: actor.userId,
      action,
      entityType: 'Report',
      entityId: reportId,
      metadata: {
        scopeType: scope.type,
        scopeId: scope.id,
        summary: auditSummary(metadata),
      },
    });
  }
}

function toAnalyticsQuery(config: ReportConfigDto): AnalyticsQueryDto {
  return {
    metrics: [...new Set(config.metricKeys)].join(','),
    datePreset: config.datePreset ?? 'LAST_30_DAYS',
    start: config.start,
    end: config.end,
    bucket: config.bucket ?? 'DAY',
    dimension: config.dimension,
    workspaceId: config.workspaceId,
    agencyId: config.agencyId,
    departmentId: config.departmentId,
    status: config.status,
    priority: config.priority,
    plan: config.plan,
    subscriptionStatus: config.subscriptionStatus,
    page: config.page ?? 1,
    pageSize: config.pageSize ?? 50,
  };
}

function sanitizeConfig(config: ReportConfigDto): Prisma.InputJsonValue {
  return {
    metricKeys: [...new Set(config.metricKeys)].map((metric) => metric.trim()).filter(Boolean),
    datePreset: config.datePreset ?? 'LAST_30_DAYS',
    start: config.start ?? null,
    end: config.end ?? null,
    bucket: config.bucket ?? 'DAY',
    dimension: config.dimension ?? null,
    workspaceId: config.workspaceId ?? null,
    agencyId: config.agencyId ?? null,
    departmentId: config.departmentId ?? null,
    status: config.status ?? null,
    priority: config.priority ?? null,
    plan: config.plan ?? null,
    subscriptionStatus: config.subscriptionStatus ?? null,
    page: config.page ?? 1,
    pageSize: config.pageSize ?? 50,
  };
}

function safeJson(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function inputJson(value: Prisma.JsonValue): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

function sanitizeRecipientConfig(config: ReportRecipientConfigDto): Prisma.InputJsonValue {
  return {
    workspaceMembershipIds: [...new Set(config.workspaceMembershipIds ?? [])],
    agencyMembershipIds: [...new Set(config.agencyMembershipIds ?? [])],
    superAgencyMembershipIds: [...new Set(config.superAgencyMembershipIds ?? [])],
    userIds: [...new Set(config.userIds ?? [])],
    deliveryType: 'INTERNAL_RECIPIENTS',
  };
}

function nextScheduleRun(
  frequency: ReportScheduleFrequency,
  timezone: string,
  localTime: string,
  options: { dayOfWeek?: number; dayOfMonth?: number },
) {
  if (!/^[0-2][0-9]:[0-5][0-9]$/.test(localTime)) {
    throw new BadRequestException('REPORT_SCHEDULE_LOCAL_TIME_INVALID');
  }
  const [hour = 0, minute = 0] = localTime.split(':').map(Number);
  if (hour > 23) throw new BadRequestException('REPORT_SCHEDULE_LOCAL_TIME_INVALID');
  let candidate = DateTime.now().setZone(timezone).set({ hour, minute, second: 0, millisecond: 0 });
  if (!candidate.isValid) throw new BadRequestException('REPORT_SCHEDULE_TIMEZONE_INVALID');
  if (candidate <= DateTime.now().setZone(timezone)) candidate = candidate.plus({ days: 1 });
  if (frequency === ReportScheduleFrequency.WEEKLY) {
    const day = options.dayOfWeek ?? 1;
    while (candidate.weekday !== day) candidate = candidate.plus({ days: 1 });
  }
  if (frequency === ReportScheduleFrequency.MONTHLY) {
    const day = Math.min(options.dayOfMonth ?? 1, candidate.daysInMonth ?? 31);
    candidate = candidate.set({ day });
    if (candidate <= DateTime.now().setZone(timezone)) {
      const next = candidate.plus({ months: 1 });
      candidate = next.set({ day: Math.min(options.dayOfMonth ?? 1, next.daysInMonth ?? 31) });
    }
  }
  return candidate.toUTC().toJSDate();
}

function reportFilename(name: string, format: ReportExportFormat) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return `${slug || 'report'}-${DateTime.utc().toFormat('yyyyLLdd-HHmmss')}.${exportExtension(format)}`;
}

function reportStorageKey(scopeType: AnalyticsScopeType, scopeId: string, exportId: string) {
  return `generated/reports/${scopeType.toLowerCase()}/${scopeId}/${exportId}`;
}

function safeErrorCode(error: unknown) {
  if (typeof error === 'object' && error && 'message' in error) {
    return String((error as { message?: unknown }).message).slice(0, 120);
  }
  return 'REPORT_EXECUTION_FAILED';
}

function auditSummary(metadata: unknown): Prisma.InputJsonValue {
  if (!metadata || typeof metadata !== 'object') return {};
  const record = metadata as Record<string, unknown>;
  return {
    id: typeof record.id === 'string' ? record.id : null,
    status: typeof record.status === 'string' ? record.status : null,
    revision: typeof record.revision === 'number' ? record.revision : null,
  };
}

function serializeReport(report: SerializableReport) {
  return {
    id: report.id,
    scopeType: report.scopeType,
    scopeId: report.scopeId,
    name: report.name,
    description: report.description,
    type: report.type,
    visibility: report.visibility,
    configuration: report.configuration,
    revision: report.revision,
    status: report.status,
    archivedAt: report.archivedAt,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
    accessCount: report.accesses?.length ?? 0,
    scheduleCount: report.schedules?.length ?? 0,
  };
}

function serializeExport(exportRecord: SerializableExport) {
  return {
    id: exportRecord.id,
    reportId: exportRecord.reportId,
    format: exportRecord.format,
    status: exportRecord.status,
    filename: exportRecord.filename,
    mimeType: exportRecord.mimeType,
    sizeBytes: exportRecord.sizeBytes?.toString?.() ?? exportRecord.sizeBytes ?? null,
    rowCount: exportRecord.rowCount,
    expiresAt: exportRecord.expiresAt,
    completedAt: exportRecord.completedAt,
    safeErrorCode: exportRecord.safeErrorCode,
  };
}

function serializeSchedule(schedule: SerializableSchedule) {
  return {
    id: schedule.id,
    reportId: schedule.reportId,
    frequency: schedule.frequency,
    timezone: schedule.timezone,
    localTime: schedule.localTime,
    dayOfWeek: schedule.dayOfWeek,
    dayOfMonth: schedule.dayOfMonth,
    enabled: schedule.enabled,
    recipientConfig: schedule.recipientConfig,
    nextRunAt: schedule.nextRunAt,
    lastRunAt: schedule.lastRunAt,
  };
}
