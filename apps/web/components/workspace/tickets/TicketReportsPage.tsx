'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { Button, EmptyState, Input, Skeleton } from '@zea-play/ui';
import { useLanguage } from '../../../contexts/language-provider';
import { translate as t } from '../../../lib/i18n';
import { useSessionStore } from '../../../stores/session';
import {
  exportWorkspaceTicketReportsCsv,
  getWorkspaceTicketReports,
  ticketKeys,
  type TicketReportParams,
  type TicketReportSlaSummary,
} from '../../../services/workspace-tickets';

export function TicketReportsPage() {
  const workspaceId = useSessionStore((state) => state.selectedWorkspaceId);
  const { locale } = useLanguage();
  const [createdFrom, setCreatedFrom] = useState('');
  const [createdTo, setCreatedTo] = useState('');
  const [trendFrom, setTrendFrom] = useState('');
  const [trendTo, setTrendTo] = useState('');
  const [bucket, setBucket] = useState<'DAY' | 'WEEK' | 'MONTH'>('DAY');
  const params = useMemo<TicketReportParams>(
    () => ({
      createdFrom: createdFrom || undefined,
      createdTo: createdTo || undefined,
      trendFrom: trendFrom || undefined,
      trendTo: trendTo || undefined,
      bucket,
    }),
    [bucket, createdFrom, createdTo, trendFrom, trendTo],
  );
  const reportQuery = useQuery({
    queryKey: ticketKeys.reports(workspaceId, params),
    queryFn: () => getWorkspaceTicketReports(workspaceId as string, params),
    enabled: Boolean(workspaceId),
  });
  const report = reportQuery.data;
  return (
    <main className="mx-auto grid w-full max-w-7xl gap-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">
            {t(locale, 'workspaceTickets.serviceDeskReports')}
          </h1>
          <p className="text-sm text-muted-foreground">{report?.timezone ?? 'UTC'}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Input
            label={t(locale, 'workspaceTickets.createdFrom')}
            type="date"
            value={createdFrom}
            onChange={(event) => setCreatedFrom(event.target.value)}
          />
          <Input
            label={t(locale, 'workspaceTickets.createdTo')}
            type="date"
            value={createdTo}
            onChange={(event) => setCreatedTo(event.target.value)}
          />
          <Input
            label={t(locale, 'workspaceTickets.trendFrom')}
            type="date"
            value={trendFrom}
            onChange={(event) => setTrendFrom(event.target.value)}
          />
          <Input
            label={t(locale, 'workspaceTickets.trendTo')}
            type="date"
            value={trendTo}
            onChange={(event) => setTrendTo(event.target.value)}
          />
          <label className="grid gap-1 text-sm font-medium">
            {t(locale, 'workspaceTickets.bucket')}
            <select
              className="h-10 rounded-md border bg-background px-3 text-sm"
              value={bucket}
              onChange={(event) => setBucket(event.target.value as 'DAY' | 'WEEK' | 'MONTH')}
            >
              <option value="DAY">{t(locale, 'workspaceTickets.bucketDay')}</option>
              <option value="WEEK">{t(locale, 'workspaceTickets.bucketWeek')}</option>
              <option value="MONTH">{t(locale, 'workspaceTickets.bucketMonth')}</option>
            </select>
          </label>
          <Button
            type="button"
            onClick={() => {
              if (!workspaceId) return;
              void exportWorkspaceTicketReportsCsv(workspaceId, params)
                .then((result) => downloadCsv(result.filename, result.csv, result.contentType))
                .catch((error: { status?: number }) => {
                  toast.error(
                    error.status === 413
                      ? t(locale, 'workspaceTickets.exportTooLarge')
                      : t(locale, 'workspaceTickets.unableToExportReport'),
                  );
                });
            }}
          >
            <Download className="mr-2 h-4 w-4" />
            {t(locale, 'workspaceTickets.exportCsv')}
          </Button>
        </div>
      </header>

      {reportQuery.isLoading ? <Skeleton className="h-32 w-full" /> : null}
      {reportQuery.isError ? (
        <EmptyState title={t(locale, 'workspaceTickets.unableToLoadReports')} />
      ) : null}
      {report ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Kpi
              label={t(locale, 'workspaceTickets.totalTickets')}
              value={report.kpis.totalTickets}
            />
            <Kpi
              label={t(locale, 'workspaceTickets.openTickets')}
              value={report.kpis.openTickets}
            />
            <Kpi
              label={t(locale, 'workspaceTickets.terminalTickets')}
              value={report.kpis.terminalTickets}
            />
            <Kpi
              label={t(locale, 'workspaceTickets.unassignedTickets')}
              value={report.kpis.unassignedTickets}
            />
            <Kpi
              label={t(locale, 'workspaceTickets.escalatedTickets')}
              value={report.kpis.escalatedTickets}
            />
            <Kpi
              label={t(locale, 'workspaceTickets.slaBreached')}
              value={report.kpis.slaBreachedTickets}
            />
            <Kpi
              label={t(locale, 'workspaceTickets.slaNotConfigured')}
              value={report.kpis.slaNotConfiguredTickets}
            />
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <Breakdown
              title={t(locale, 'workspaceTickets.statusDistribution')}
              emptyLabel={t(locale, 'workspaceTickets.noReportData')}
              items={report.distributions.status.map((item) => ({
                label: `${item.name}${item.isTerminal ? ` (${t(locale, 'workspaceTickets.terminal')})` : ''}`,
                value: item.count,
              }))}
            />
            <Breakdown
              title={t(locale, 'workspaceTickets.priorityDistribution')}
              emptyLabel={t(locale, 'workspaceTickets.noReportData')}
              items={report.distributions.priority.map((item) => ({
                label: priorityLabel(locale, item.priority),
                value: item.count,
              }))}
            />
            <Breakdown
              title={t(locale, 'workspaceTickets.requesterTypeBreakdown')}
              emptyLabel={t(locale, 'workspaceTickets.noReportData')}
              items={report.distributions.requesterType.map((item) => ({
                label: item.type,
                value: item.count,
              }))}
            />
            <Breakdown
              title={t(locale, 'workspaceTickets.escalationBreakdown')}
              emptyLabel={t(locale, 'workspaceTickets.noReportData')}
              items={report.distributions.escalation.map((item) => ({
                label: escalationLabel(locale, item.level),
                value: item.count,
              }))}
            />
            <Breakdown
              title={t(locale, 'workspaceTickets.departmentBreakdown')}
              emptyLabel={t(locale, 'workspaceTickets.noReportData')}
              items={report.distributions.departments.map((item) => ({
                label: item.name,
                value: item.ticketCount,
              }))}
            />
            <Breakdown
              title={t(locale, 'workspaceTickets.assigneeBreakdown')}
              emptyLabel={t(locale, 'workspaceTickets.noReportData')}
              items={report.distributions.assignees.map((item) => ({
                label: `${item.displayName}${item.inactive ? ` (${t(locale, 'workspaceTickets.inactive')})` : ''}`,
                value: item.ticketCount,
              }))}
            />
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <Breakdown
              title={t(locale, 'workspaceTickets.ticketsCreated')}
              emptyLabel={t(locale, 'workspaceTickets.noReportData')}
              items={report.trends.created.map((item) => ({ label: item.date, value: item.count }))}
            />
            <Breakdown
              title={t(locale, 'workspaceTickets.firstResolutionTrend')}
              emptyLabel={t(locale, 'workspaceTickets.noReportData')}
              items={report.trends.firstTerminalResolution.map((item) => ({
                label: item.date,
                value: item.count,
              }))}
            />
            <SlaCard
              title={t(locale, 'workspaceTickets.firstResponseSla')}
              summary={report.sla.firstResponse}
              complianceLabel={t(locale, 'workspaceTickets.slaCompliance')}
              notEnoughDataLabel={t(locale, 'workspaceTickets.notEnoughData')}
            />
            <SlaCard
              title={t(locale, 'workspaceTickets.resolutionSla')}
              summary={report.sla.resolution}
              complianceLabel={t(locale, 'workspaceTickets.slaCompliance')}
              notEnoughDataLabel={t(locale, 'workspaceTickets.notEnoughData')}
            />
          </section>
        </>
      ) : null}
    </main>
  );
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <article className="rounded-md border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </article>
  );
}

function Breakdown({
  title,
  items,
  emptyLabel,
}: {
  title: string;
  items: Array<{ label: string; value: number }>;
  emptyLabel: string;
}) {
  return (
    <section className="rounded-md border bg-card p-4">
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-3 grid gap-2">
        {items.length ? (
          items.map((item) => (
            <div key={item.label} className="flex justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">{item.label}</span>
              <span className="font-medium">{item.value}</span>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">{emptyLabel}</p>
        )}
      </div>
    </section>
  );
}

function SlaCard({
  title,
  summary,
  complianceLabel,
  notEnoughDataLabel,
}: {
  title: string;
  summary: TicketReportSlaSummary;
  complianceLabel: string;
  notEnoughDataLabel: string;
}) {
  return (
    <section className="rounded-md border bg-card p-4">
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-3 grid gap-2 text-sm">
        {Object.entries(summary)
          .filter(([key]) => key !== 'complianceRate')
          .map(([key, value]) => (
            <div key={key} className="flex justify-between gap-3">
              <span>{key.replaceAll('_', ' ')}</span>
              <span className="font-medium">{value}</span>
            </div>
          ))}
        <div className="flex justify-between gap-3 border-t pt-2">
          <span>{complianceLabel}</span>
          <span className="font-medium">
            {summary.complianceRate === null ? notEnoughDataLabel : `${summary.complianceRate}%`}
          </span>
        </div>
      </div>
    </section>
  );
}

function priorityLabel(locale: 'en' | 'ta', priority: string) {
  const labels: Record<string, string> = {
    LOW: t(locale, 'workspaceTickets.priorityLow'),
    MEDIUM: t(locale, 'workspaceTickets.priorityMedium'),
    HIGH: t(locale, 'workspaceTickets.priorityHigh'),
    URGENT: t(locale, 'workspaceTickets.priorityUrgent'),
  };
  return labels[priority] ?? priority;
}

function escalationLabel(locale: 'en' | 'ta', level: string) {
  const labels: Record<string, string> = {
    NONE: t(locale, 'workspaceTickets.escalationNone'),
    LEVEL_1: t(locale, 'workspaceTickets.escalationLevel1'),
    LEVEL_2: t(locale, 'workspaceTickets.escalationLevel2'),
    LEVEL_3: t(locale, 'workspaceTickets.escalationLevel3'),
  };
  return labels[level] ?? level;
}

function downloadCsv(filename: string, csv: string, contentType: string) {
  const blob = new Blob([csv], { type: contentType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
