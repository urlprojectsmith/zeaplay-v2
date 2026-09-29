import ExcelJS from 'exceljs';

export type ReportCell = string | number | boolean | null;

export interface ReportTable {
  columns: string[];
  rows: ReportCell[][];
}

export const REPORT_EXPORT_RETENTION_DAYS = 7;
export const REPORT_SYNC_EXPORT_ROW_LIMIT = 1_000;

const dangerousSpreadsheetPrefix = /^[=+\-@]/;

export function sanitizeSpreadsheetCell(value: ReportCell): ReportCell {
  if (typeof value !== 'string') return value;
  const trimmed = value.trimStart();
  if (!dangerousSpreadsheetPrefix.test(trimmed)) return value;
  return `'${value}`;
}

export function reportTableToCsv(table: ReportTable): Buffer {
  const lines = [table.columns, ...table.rows].map((row) =>
    row.map((value) => csvCell(sanitizeSpreadsheetCell(value))).join(','),
  );
  return Buffer.from(lines.join('\r\n'), 'utf8');
}

export async function reportTableToXlsx(table: ReportTable): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Zea Play';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Report');
  sheet.columns = table.columns.map((header) => ({ header, key: header, width: 22 }));
  for (const row of table.rows) {
    sheet.addRow(row.map((value) => sanitizeSpreadsheetCell(value)));
  }
  sheet.getRow(1).font = { bold: true };
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
}

export function exportMimeType(format: 'CSV' | 'XLSX') {
  if (format === 'CSV') return 'text/csv; charset=utf-8';
  return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
}

export function exportExtension(format: 'CSV' | 'XLSX') {
  return format.toLowerCase();
}

function csvCell(value: ReportCell) {
  if (value === null) return '';
  const text = String(value);
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}
