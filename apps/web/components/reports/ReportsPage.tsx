'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@zea-play/ui';
import { CalendarClock, Download, Eye, FilePlus2, FileSpreadsheet, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { PageContainer } from '../layout/PageContainer';
import { PageHeader } from '../layout/PageHeader';
import { useSessionStore } from '../../stores/session';
import type { AnalyticsDatePreset, AnalyticsScopeType } from '../../services/analytics';
import {
  createReport,
  exportReport,
  listReports,
  previewReport,
  reportKeys,
  type ReportDefinition,
  type ReportExportFormat,
  type ReportType,
  type ReportVisibility,
} from '../../services/reports';

const defaultMetrics = ['tasks.total', 'tasks.completed', 'tickets.open'];
const presetOptions: AnalyticsDatePreset[] = [
  'LAST_7_DAYS',
  'LAST_30_DAYS',
  'THIS_MONTH',
  'THIS_YEAR',
];
const reportTypes: ReportType[] = ['SUMMARY', 'TABLE', 'TIME_SERIES'];
const exportFormats: ReportExportFormat[] = ['CSV', 'XLSX'];

export function ReportsPage({ scope }: { scope: AnalyticsScopeType }) {
  const { hydrated, hydrate, accessToken } = useSessionStore();
  const selectedWorkspaceId = useSessionStore((state) => state.selectedWorkspaceId);
  const selectedAgencyId = useSessionStore((state) => state.selectedAgencyId);
  const selectedSuperAgencyId = useSessionStore((state) => state.selectedSuperAgencyId);
  const queryClient = useQueryClient();
  const [name, setName] = useState('Operations Snapshot');
  const [type, setType] = useState<ReportType>('SUMMARY');
  const [visibility, setVisibility] = useState<ReportVisibility>('SCOPE');
  const [datePreset, setDatePreset] = useState<AnalyticsDatePreset>('LAST_30_DAYS');
  const [metrics, setMetrics] = useState(defaultMetrics.join(', '));
  const [format, setFormat] = useState<ReportExportFormat>('CSV');
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [previewRows, setPreviewRows] = useState<unknown[][]>([]);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const scopeId =
    scope === 'WORKSPACE'
      ? selectedWorkspaceId
      : scope === 'AGENCY'
        ? selectedAgencyId
        : scope === 'SUPER_AGENCY'
          ? selectedSuperAgencyId
          : 'platform';

  const reportsQuery = useQuery({
    queryKey: reportKeys.list(scope, scopeId),
    queryFn: () => listReports(scope, scopeId as string),
    enabled: Boolean(accessToken && hydrated && scopeId),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      createReport(scope, scopeId as string, {
        name,
        type,
        visibility,
        configuration: {
          metricKeys: metricList(metrics),
          datePreset,
          bucket: 'DAY',
          dimension:
            type === 'TABLE' ? (scope === 'WORKSPACE' ? 'STATUS' : 'WORKSPACE') : undefined,
        },
      }),
    onSuccess(report) {
      setActiveReportId(report.id);
      void queryClient.invalidateQueries({ queryKey: reportKeys.list(scope, scopeId) });
      toast.success('Report saved');
    },
    onError(error) {
      toast.error(error instanceof Error ? error.message : 'Report could not be saved');
    },
  });

  const activeReport = useMemo(
    () => reportsQuery.data?.reports.find((report) => report.id === activeReportId) ?? null,
    [activeReportId, reportsQuery.data?.reports],
  );

  const previewMutation = useMutation({
    mutationFn: (report: ReportDefinition) => previewReport(scope, scopeId as string, report.id),
    onSuccess(result) {
      setPreviewRows(result.table.rows.slice(0, 8));
      toast.success('Preview refreshed');
    },
    onError(error) {
      toast.error(error instanceof Error ? error.message : 'Preview unavailable');
    },
  });

  const exportMutation = useMutation({
    mutationFn: (report: ReportDefinition) =>
      exportReport(scope, scopeId as string, report.id, format),
    onSuccess(result) {
      toast.success(result.queued ? 'Export queued' : 'Export ready');
    },
    onError(error) {
      toast.error(error instanceof Error ? error.message : 'Export failed');
    },
  });

  if (!hydrated) return <Skeleton className="h-96 rounded-md" />;

  return (
    <PageContainer>
      <PageHeader title="Reports" description={scopeDescription(scope)} />
      {!scopeId ? (
        <EmptyState title="No Scope" description="Select an authorized scope to view Reports." />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-muted-foreground">
                {reportsQuery.data?.reports.length ?? 0} saved
              </div>
              <Button
                variant="secondary"
                onClick={() => void reportsQuery.refetch()}
                disabled={reportsQuery.isFetching}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh
              </Button>
            </div>
            {reportsQuery.isLoading ? (
              <ReportsSkeleton />
            ) : reportsQuery.data?.reports.length ? (
              reportsQuery.data.reports.map((report) => (
                <ReportRow
                  key={report.id}
                  report={report}
                  active={report.id === activeReportId}
                  format={format}
                  onSelect={() => setActiveReportId(report.id)}
                  onPreview={() => previewMutation.mutate(report)}
                  onExport={() => exportMutation.mutate(report)}
                />
              ))
            ) : (
              <EmptyState title="No Reports" description="Save a report definition to begin." />
            )}
          </section>
          <aside className="grid content-start gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Builder</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                <Input value={name} onChange={(event) => setName(event.target.value)} />
                <Select value={type} onValueChange={(value) => setType(value as ReportType)}>
                  <SelectTrigger aria-label="Report type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {reportTypes.map((item) => (
                      <SelectItem key={item} value={item}>
                        {label(item)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={visibility}
                  onValueChange={(value) => setVisibility(value as ReportVisibility)}
                >
                  <SelectTrigger aria-label="Report visibility">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PRIVATE">Private</SelectItem>
                    <SelectItem value="SCOPE">Scope</SelectItem>
                    <SelectItem value="SELECTED_MEMBERS">Selected Members</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={datePreset}
                  onValueChange={(value) => setDatePreset(value as AnalyticsDatePreset)}
                >
                  <SelectTrigger aria-label="Report date range">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {presetOptions.map((preset) => (
                      <SelectItem key={preset} value={preset}>
                        {label(preset)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input value={metrics} onChange={(event) => setMetrics(event.target.value)} />
                <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
                  <FilePlus2 className="mr-2 h-4 w-4" />
                  Save
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Export</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                <Select
                  value={format}
                  onValueChange={(value) => setFormat(value as ReportExportFormat)}
                >
                  <SelectTrigger aria-label="Report export format">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {exportFormats.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="secondary"
                  disabled={!activeReport || exportMutation.isPending}
                  onClick={() => activeReport && exportMutation.mutate(activeReport)}
                >
                  <FileSpreadsheet className="mr-2 h-4 w-4" />
                  Export
                </Button>
              </CardContent>
            </Card>
            <PreviewPanel rows={previewRows} />
          </aside>
        </div>
      )}
    </PageContainer>
  );
}

function ReportRow({
  report,
  active,
  format,
  onSelect,
  onPreview,
  onExport,
}: {
  report: ReportDefinition;
  active: boolean;
  format: ReportExportFormat;
  onSelect: () => void;
  onPreview: () => void;
  onExport: () => void;
}) {
  return (
    <article
      className={`rounded-md border bg-card p-4 ${active ? 'border-primary' : 'border-border'}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <button className="min-w-0 text-left" onClick={onSelect}>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold tracking-normal">{report.name}</h2>
            <Badge variant="neutral">{label(report.type)}</Badge>
            <Badge variant={report.visibility === 'PRIVATE' ? 'warning' : 'info'}>
              {label(report.visibility)}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {report.configuration.metricKeys.join(', ')}
          </p>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="secondary" onClick={onPreview}>
            <Eye className="mr-2 h-4 w-4" />
            Preview
          </Button>
          <Button variant="secondary" onClick={onExport}>
            <Download className="mr-2 h-4 w-4" />
            {format}
          </Button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span>Revision {report.revision}</span>
        <span>{report.accessCount} access entries</span>
        <span className="inline-flex items-center gap-1">
          <CalendarClock className="h-3.5 w-3.5" />
          {report.scheduleCount}
        </span>
      </div>
    </article>
  );
}

function PreviewPanel({ rows }: { rows: unknown[][] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Preview</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length ? (
          <div className="grid gap-2 text-sm">
            {rows.map((row, index) => (
              <div
                key={index}
                className="grid grid-cols-2 gap-2 rounded-md border border-border p-2"
              >
                <span className="truncate text-muted-foreground">{displayCell(row[0])}</span>
                <span className="truncate font-medium">{displayCell(row[row.length - 1])}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">No preview selected.</div>
        )}
      </CardContent>
    </Card>
  );
}

function ReportsSkeleton() {
  return (
    <div className="grid gap-3">
      {Array.from({ length: 4 }).map((_, index) => (
        <Skeleton key={index} className="h-28 rounded-md" />
      ))}
    </div>
  );
}

function metricList(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function label(value: string) {
  return value
    .split('_')
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(' ');
}

function displayCell(value: unknown) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value === null || value === undefined) return '';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'symbol') return value.description ?? 'symbol';
  return '';
}

function scopeDescription(scope: AnalyticsScopeType) {
  if (scope === 'WORKSPACE') return 'Workspace saved analytics reports';
  if (scope === 'AGENCY') return 'Agency aggregate report definitions';
  if (scope === 'SUPER_AGENCY') return 'Super Agency aggregate and commercial reports';
  return 'Platform report definitions';
}
