import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ReportExportFormat, ReportExportStatus, ReportExecutionStatus } from '@prisma/client';
import type { Job } from 'bullmq';
import ExcelJS from 'exceljs';
import { PrismaService } from '../infrastructure/database/prisma.service';
import type { StorageService } from '../infrastructure/storage/storage.service';
import { REPORT_EXPORT_JOB_TYPE, REPORTS_QUEUE } from '../queue/queue.constants';

type ReportCell = string | number | boolean | null;
type PreparedTable = { columns: string[]; rows: ReportCell[][] };

@Processor(REPORTS_QUEUE)
@Injectable()
export class ReportExportProcessor extends WorkerHost {
  private readonly logger = new Logger(ReportExportProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {
    super();
  }

  async process(job: Job<{ exportId: string; executionId?: string }>): Promise<void> {
    if (job.name !== REPORT_EXPORT_JOB_TYPE) return;
    const exportRecord = await this.prisma.reportExport.findUnique({
      where: { id: job.data.exportId },
    });
    if (!exportRecord) return;
    if (exportRecord.status !== ReportExportStatus.QUEUED) return;
    await this.prisma.reportExport.update({
      where: { id: exportRecord.id },
      data: { status: ReportExportStatus.RUNNING },
    });
    if (job.data.executionId) {
      await this.prisma.reportExecution.updateMany({
        where: { id: job.data.executionId, status: ReportExecutionStatus.RUNNING },
        data: { startedAt: new Date() },
      });
    }
    try {
      const table = readPreparedTable(exportRecord.configSnapshot);
      const body =
        exportRecord.format === ReportExportFormat.CSV
          ? tableToCsv(table)
          : await tableToXlsx(table);
      const storageKey = `generated/reports/${exportRecord.scopeType.toLowerCase()}/${exportRecord.scopeId}/${exportRecord.id}`;
      await this.storage.upload(storageKey, body, {
        contentType: exportRecord.mimeType,
        fileName: exportRecord.filename,
      });
      await this.prisma.reportExport.update({
        where: { id: exportRecord.id },
        data: {
          status: ReportExportStatus.READY,
          storageProvider: 'MINIO',
          storageKey,
          sizeBytes: BigInt(body.length),
          completedAt: new Date(),
        },
      });
      if (job.data.executionId) {
        await this.prisma.reportExecution.updateMany({
          where: { id: job.data.executionId },
          data: {
            status: ReportExecutionStatus.SUCCEEDED,
            completedAt: new Date(),
            rowCount: table.rows.length,
          },
        });
      }
    } catch (error) {
      const code = safeErrorCode(error);
      this.logger.warn({ exportId: exportRecord.id, code }, 'Report export generation failed');
      await this.prisma.reportExport.update({
        where: { id: exportRecord.id },
        data: {
          status: ReportExportStatus.FAILED,
          failedAt: new Date(),
          safeErrorCode: code,
        },
      });
      if (job.data.executionId) {
        await this.prisma.reportExecution.updateMany({
          where: { id: job.data.executionId },
          data: {
            status: ReportExecutionStatus.FAILED,
            failedAt: new Date(),
            safeErrorCode: code,
          },
        });
      }
      throw error;
    }
  }
}

function readPreparedTable(value: unknown): PreparedTable {
  if (!value || typeof value !== 'object' || !('preparedTable' in value)) {
    throw new Error('REPORT_EXPORT_TABLE_MISSING');
  }
  const table = (value as { preparedTable?: unknown }).preparedTable;
  if (!table || typeof table !== 'object') throw new Error('REPORT_EXPORT_TABLE_INVALID');
  const maybe = table as { columns?: unknown; rows?: unknown };
  if (!Array.isArray(maybe.columns) || !Array.isArray(maybe.rows)) {
    throw new Error('REPORT_EXPORT_TABLE_INVALID');
  }
  return {
    columns: maybe.columns.map((column) => String(column)),
    rows: maybe.rows.map((row) => (Array.isArray(row) ? row.map(normalizeCell) : [])),
  };
}

function normalizeCell(value: unknown): ReportCell {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return value;
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'symbol') return value.description ?? 'symbol';
  if (typeof value === 'object') return JSON.stringify(value);
  return null;
}

function tableToCsv(table: PreparedTable): Buffer {
  const lines = [table.columns, ...table.rows].map((row) =>
    row.map((value) => csvCell(sanitizeCell(value))).join(','),
  );
  return Buffer.from(lines.join('\r\n'), 'utf8');
}

async function tableToXlsx(table: PreparedTable): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Zea Play';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Report');
  sheet.columns = table.columns.map((header) => ({ header, key: header, width: 22 }));
  for (const row of table.rows) sheet.addRow(row.map((value) => sanitizeCell(value)));
  sheet.getRow(1).font = { bold: true };
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
}

function sanitizeCell(value: ReportCell): ReportCell {
  if (typeof value !== 'string') return value;
  return /^[=+\-@]/.test(value.trimStart()) ? `'${value}` : value;
}

function csvCell(value: ReportCell) {
  if (value === null) return '';
  const text = String(value);
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function safeErrorCode(error: unknown) {
  if (typeof error === 'object' && error && 'message' in error) {
    return String((error as { message?: unknown }).message).slice(0, 120);
  }
  return 'REPORT_EXPORT_FAILED';
}
