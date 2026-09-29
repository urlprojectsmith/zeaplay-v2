import { exportMimeType, reportTableToCsv, reportTableToXlsx } from './report-exporter';

describe('report exporter', () => {
  it('escapes CSV values and hardens spreadsheet formulas', () => {
    const csv = reportTableToCsv({
      columns: ['Metric', 'Value'],
      rows: [
        ['Open tasks', 12],
        ['=IMPORTXML("https://example.test")', '+42'],
        ['Needs, quote', 'He said "done"'],
      ],
    }).toString('utf8');

    expect(csv).toContain('Open tasks,12');
    expect(csv).toContain('"\'=IMPORTXML(""https://example.test"")"');
    expect(csv).toContain("'+42");
    expect(csv).toContain('"Needs, quote","He said ""done"""');
  });

  it('generates a real XLSX workbook buffer', async () => {
    const xlsx = await reportTableToXlsx({
      columns: ['Metric', 'Value'],
      rows: [['Tasks', 3]],
    });

    expect(xlsx.subarray(0, 2).toString()).toBe('PK');
    expect(exportMimeType('XLSX')).toContain('spreadsheetml');
  });
});
