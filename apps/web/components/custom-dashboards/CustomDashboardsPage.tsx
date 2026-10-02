'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@zea-play/ui';
import {
  Archive,
  Copy,
  GripVertical,
  Heart,
  LayoutDashboard,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Star,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { PageContainer } from '../layout/PageContainer';
import { PageHeader } from '../layout/PageHeader';
import { useSessionStore } from '../../stores/session';
import type { AnalyticsDatePreset, AnalyticsScopeType } from '../../services/analytics';
import {
  addDashboardWidget,
  archiveDashboard,
  createDashboard,
  createDashboardFromTemplate,
  dashboardKeys,
  duplicateDashboard,
  favoriteDashboard,
  listDashboardTemplates,
  listDashboards,
  removeDashboardWidget,
  renderDashboard,
  restoreDashboard,
  setDefaultDashboard,
  updateDashboardLayout,
  type CustomDashboard,
  type DashboardTemplate,
  type DashboardWidget,
  type DashboardWidgetType,
  type RenderedWidget,
} from '../../services/custom-dashboards';

const widgetTypes: DashboardWidgetType[] = [
  'METRIC_CARD',
  'LINE_CHART',
  'BAR_CHART',
  'AREA_CHART',
  'TABLE',
  'GOAL_PROGRESS',
  'GAMIFICATION_SUMMARY',
];

const datePresets: AnalyticsDatePreset[] = [
  'LAST_7_DAYS',
  'LAST_30_DAYS',
  'THIS_MONTH',
  'THIS_YEAR',
];

export function CustomDashboardsPage({ scope }: { scope: AnalyticsScopeType }) {
  const { hydrated, hydrate, accessToken } = useSessionStore();
  const selectedWorkspaceId = useSessionStore((state) => state.selectedWorkspaceId);
  const selectedAgencyId = useSessionStore((state) => state.selectedAgencyId);
  const selectedSuperAgencyId = useSessionStore((state) => state.selectedSuperAgencyId);
  const queryClient = useQueryClient();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [activeDashboardId, setActiveDashboardId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [name, setName] = useState('Operations Dashboard');
  const [templateKey, setTemplateKey] = useState<string>('team-performance');
  const [widgetType, setWidgetType] = useState<DashboardWidgetType>('METRIC_CARD');
  const [widgetMetric, setWidgetMetric] = useState('tasks.total');
  const [widgetTitle, setWidgetTitle] = useState('Metric');
  const [datePreset, setDatePreset] = useState<AnalyticsDatePreset>('LAST_30_DAYS');

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

  const dashboardsQuery = useQuery({
    queryKey: dashboardKeys.list(scope, scopeId),
    queryFn: () => listDashboards(scope, scopeId as string),
    enabled: Boolean(accessToken && hydrated && scopeId),
  });

  const templatesQuery = useQuery({
    queryKey: dashboardKeys.templates(scope, scopeId),
    queryFn: () => listDashboardTemplates(scope, scopeId as string),
    enabled: Boolean(accessToken && hydrated && scopeId),
  });

  const activeDashboard =
    dashboardsQuery.data?.dashboards.find((dashboard) => dashboard.id === activeDashboardId) ??
    dashboardsQuery.data?.dashboards.find((dashboard) => dashboard.isDefault) ??
    dashboardsQuery.data?.dashboards[0] ??
    null;

  useEffect(() => {
    if (!activeDashboardId && activeDashboard) setActiveDashboardId(activeDashboard.id);
  }, [activeDashboard, activeDashboardId]);

  const renderQuery = useQuery({
    queryKey: dashboardKeys.render(scope, scopeId, activeDashboard?.id ?? null),
    queryFn: () => renderDashboard(scope, scopeId as string, activeDashboard?.id as string),
    enabled: Boolean(accessToken && hydrated && scopeId && activeDashboard?.id),
    refetchInterval: activeDashboard?.widgets.some((widget) => widget.refreshSeconds)
      ? Math.max(
          60000,
          Math.min(
            ...activeDashboard.widgets
              .map((widget) => widget.refreshSeconds ?? Number.POSITIVE_INFINITY)
              .filter(Number.isFinite),
          ) * 1000,
        )
      : false,
    refetchIntervalInBackground: false,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: dashboardKeys.list(scope, scopeId) });
    void queryClient.invalidateQueries({
      queryKey: dashboardKeys.render(scope, scopeId, activeDashboard?.id ?? null),
    });
  };

  const createBlankMutation = useMutation({
    mutationFn: () =>
      createDashboard(scope, scopeId as string, {
        name,
        visibility: scope === 'WORKSPACE' ? 'PRIVATE' : 'SCOPE',
        globalFilters: { datePreset },
        widgets: [
          {
            type: 'METRIC_CARD',
            title: 'Open Tickets',
            dataSourceType: 'ANALYTICS_QUERY',
            configuration: { metricKeys: ['tickets.open'], datePreset, bucket: 'DAY' },
            layout: { x: 0, y: 0, width: 4, height: 4, order: 0 },
          },
        ],
      }),
    onSuccess(dashboard) {
      setActiveDashboardId(dashboard.id);
      invalidate();
      toast.success('Dashboard saved');
    },
    onError: toastError('Dashboard could not be saved'),
  });

  const templateMutation = useMutation({
    mutationFn: () => createDashboardFromTemplate(scope, scopeId as string, templateKey),
    onSuccess(dashboard) {
      setActiveDashboardId(dashboard.id);
      invalidate();
      toast.success('Template created');
    },
    onError: toastError('Template could not be created'),
  });

  const addWidgetMutation = useMutation({
    mutationFn: () =>
      addDashboardWidget(scope, scopeId as string, activeDashboard?.id as string, {
        type: widgetType,
        title: widgetTitle,
        dataSourceType: 'ANALYTICS_QUERY',
        configuration: {
          metricKeys: [widgetMetric],
          datePreset,
          bucket: 'DAY',
          dimension:
            widgetType === 'TABLE' ? (scope === 'WORKSPACE' ? 'STATUS' : 'WORKSPACE') : undefined,
        },
        layout: {
          x: 0,
          y: activeDashboard?.widgets.length ?? 0,
          width: widgetType === 'METRIC_CARD' ? 4 : 8,
          height: widgetType === 'METRIC_CARD' ? 4 : 6,
          order: activeDashboard?.widgets.length ?? 0,
        },
      }),
    onSuccess() {
      invalidate();
      toast.success('Widget added');
    },
    onError: toastError('Widget could not be added'),
  });

  const layoutMutation = useMutation({
    mutationFn: (next: DashboardWidget[]) =>
      updateDashboardLayout(
        scope,
        scopeId as string,
        activeDashboard as CustomDashboard,
        next.map((widget, index) => ({
          widgetId: widget.id,
          layout: { ...widget.layout, y: index, order: index },
        })),
      ),
    onSuccess() {
      invalidate();
      toast.success('Layout saved');
    },
    onError: toastError('Layout conflict'),
  });

  const simpleMutation = useMutation({
    mutationFn: async (
      action: 'duplicate' | 'archive' | 'restore' | 'favorite' | 'default' | `remove:${string}`,
    ) => {
      if (!activeDashboard) return null;
      if (action === 'duplicate')
        return duplicateDashboard(scope, scopeId as string, activeDashboard.id);
      if (action === 'archive')
        return archiveDashboard(scope, scopeId as string, activeDashboard.id);
      if (action === 'restore')
        return restoreDashboard(scope, scopeId as string, activeDashboard.id);
      if (action === 'favorite')
        return favoriteDashboard(
          scope,
          scopeId as string,
          activeDashboard.id,
          !activeDashboard.isFavorite,
        );
      if (action === 'default')
        return setDefaultDashboard(scope, scopeId as string, activeDashboard.id);
      if (action.startsWith('remove:')) {
        await removeDashboardWidget(scope, scopeId as string, activeDashboard.id, action.slice(7));
      }
      return null;
    },
    onSuccess(result) {
      if (result?.id) setActiveDashboardId(result.id);
      invalidate();
    },
    onError: toastError('Action failed'),
  });

  const renderedById = useMemo(() => {
    return new Map((renderQuery.data?.widgets ?? []).map((item) => [item.widget.id, item]));
  }, [renderQuery.data?.widgets]);

  if (!hydrated) return <Skeleton className="h-96 rounded-md" />;

  return (
    <PageContainer>
      <PageHeader
        title="Custom Dashboards"
        description={scopeDescription(scope)}
        actions={
          activeDashboard ? (
            <div className="flex flex-wrap gap-2">
              <Button
                variant={editMode ? 'primary' : 'secondary'}
                onClick={() => setEditMode((value) => !value)}
              >
                <LayoutDashboard className="mr-2 h-4 w-4" />
                {editMode ? 'Edit' : 'View'}
              </Button>
              <Button variant="secondary" onClick={() => void renderQuery.refetch()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh
              </Button>
            </div>
          ) : null
        }
      />
      {!scopeId ? (
        <EmptyState title="No Scope" description="Select an authorized scope." />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)_340px]">
          <aside className="grid content-start gap-3">
            <Input value={name} onChange={(event) => setName(event.target.value)} />
            <Button
              onClick={() => createBlankMutation.mutate()}
              disabled={createBlankMutation.isPending}
            >
              <Plus className="mr-2 h-4 w-4" />
              Blank
            </Button>
            <TemplatePicker
              templates={templatesQuery.data?.templates ?? []}
              value={templateKey}
              onChange={setTemplateKey}
              onCreate={() => templateMutation.mutate()}
              disabled={templateMutation.isPending}
            />
            <DashboardList
              dashboards={dashboardsQuery.data?.dashboards ?? []}
              activeId={activeDashboard?.id ?? null}
              onSelect={setActiveDashboardId}
            />
          </aside>
          <main className="min-w-0">
            {!activeDashboard ? (
              dashboardsQuery.isLoading ? (
                <DashboardSkeleton />
              ) : (
                <EmptyState title="No Dashboards" description="Create a dashboard to begin." />
              )
            ) : (
              <DashboardCanvas
                dashboard={activeDashboard}
                renderedById={renderedById}
                editMode={editMode}
                sensors={sensors}
                onDragEnd={(event) => {
                  const widgets = activeDashboard.widgets;
                  const oldIndex = widgets.findIndex((widget) => widget.id === event.active.id);
                  const newIndex = widgets.findIndex((widget) => widget.id === event.over?.id);
                  if (oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex) {
                    layoutMutation.mutate(arrayMove(widgets, oldIndex, newIndex));
                  }
                }}
                onRemove={(widgetId) => simpleMutation.mutate(`remove:${widgetId}`)}
                loading={renderQuery.isLoading || layoutMutation.isPending}
              />
            )}
          </main>
          <aside className="grid content-start gap-4">
            {activeDashboard ? (
              <Toolbar
                dashboard={activeDashboard}
                onDuplicate={() => simpleMutation.mutate('duplicate')}
                onArchive={() =>
                  simpleMutation.mutate(
                    activeDashboard.status === 'ARCHIVED' ? 'restore' : 'archive',
                  )
                }
                onFavorite={() => simpleMutation.mutate('favorite')}
                onDefault={() => simpleMutation.mutate('default')}
              />
            ) : null}
            {activeDashboard && editMode ? (
              <WidgetPicker
                widgetType={widgetType}
                setWidgetType={setWidgetType}
                metric={widgetMetric}
                setMetric={setWidgetMetric}
                title={widgetTitle}
                setTitle={setWidgetTitle}
                datePreset={datePreset}
                setDatePreset={setDatePreset}
                onAdd={() => addWidgetMutation.mutate()}
                disabled={addWidgetMutation.isPending || activeDashboard.widgets.length >= 30}
              />
            ) : null}
          </aside>
        </div>
      )}
    </PageContainer>
  );
}

function DashboardCanvas({
  dashboard,
  renderedById,
  editMode,
  sensors,
  onDragEnd,
  onRemove,
  loading,
}: {
  dashboard: CustomDashboard;
  renderedById: Map<string, RenderedWidget>;
  editMode: boolean;
  sensors: ReturnType<typeof useSensors>;
  onDragEnd: (event: DragEndEvent) => void;
  onRemove: (widgetId: string) => void;
  loading: boolean;
}) {
  const sorted = [...dashboard.widgets].sort(
    (a, b) => (a.layout.order ?? 0) - (b.layout.order ?? 0),
  );
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext
        items={sorted.map((widget) => widget.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          {sorted.map((widget) => (
            <WidgetTile
              key={widget.id}
              widget={widget}
              rendered={renderedById.get(widget.id)}
              editMode={editMode}
              loading={loading}
              onRemove={() => onRemove(widget.id)}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function WidgetTile({
  widget,
  rendered,
  editMode,
  loading,
  onRemove,
}: {
  widget: DashboardWidget;
  rendered?: RenderedWidget;
  editMode: boolean;
  loading: boolean;
  onRemove: () => void;
}) {
  const sortable = useSortable({ id: widget.id, disabled: !editMode });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };
  const width = Math.max(1, Math.min(12, widget.layout.width || 4));
  return (
    <article
      ref={sortable.setNodeRef}
      style={{ ...style, gridColumn: `span ${width} / span ${width}` }}
      className="min-h-40 rounded-md border border-border bg-card p-4"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {editMode ? (
              <button
                ref={sortable.setActivatorNodeRef}
                {...sortable.attributes}
                {...sortable.listeners}
                className="rounded p-1 text-muted-foreground hover:bg-muted"
                aria-label="Drag widget"
              >
                <GripVertical className="h-4 w-4" />
              </button>
            ) : null}
            <h2 className="truncate text-sm font-semibold tracking-normal">{widget.title}</h2>
          </div>
          <div className="mt-1 flex flex-wrap gap-2">
            <Badge variant="neutral">{label(widget.type)}</Badge>
            {widget.refreshSeconds ? <Badge variant="info">{widget.refreshSeconds}s</Badge> : null}
          </div>
        </div>
        {editMode ? (
          <Button variant="ghost" size="icon" onClick={onRemove} aria-label="Remove widget">
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
      {loading && !rendered ? (
        <Skeleton className="h-28 rounded-md" />
      ) : rendered?.status === 'SUCCESS' ? (
        <WidgetContent widget={widget} rendered={rendered} />
      ) : (
        <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          {rendered?.status ?? 'LOADING'}
        </div>
      )}
    </article>
  );
}

function WidgetContent({
  widget,
  rendered,
}: {
  widget: DashboardWidget;
  rendered: RenderedWidget;
}) {
  const result = asRecord(rendered.data?.result);
  const timeSeries = asRecord(result.timeSeries);
  const table = asRecord(result.table);
  const metrics = rendered.data?.metrics ?? (Array.isArray(result.metrics) ? result.metrics : []);
  const points =
    rendered.data?.timeSeries?.points ??
    (Array.isArray(timeSeries.points) ? timeSeries.points : []);
  const rows = rendered.data?.table?.rows ?? (Array.isArray(table.rows) ? table.rows : []);
  if (
    widget.type === 'METRIC_CARD' ||
    widget.type === 'GOAL_PROGRESS' ||
    widget.type === 'GAMIFICATION_SUMMARY'
  ) {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {metrics
          .slice(0, 4)
          .map(
            (metric: {
              key: string;
              displayName: string;
              value: number | string | null;
              unit: string;
            }) => (
              <div key={metric.key} className="rounded-md bg-muted/40 p-3">
                <div className="truncate text-xs text-muted-foreground">{metric.displayName}</div>
                <div className="mt-2 text-2xl font-semibold tracking-normal">
                  {formatValue(metric.value, metric.unit)}
                </div>
              </div>
            ),
          )}
      </div>
    );
  }
  if (widget.type === 'TABLE') {
    return (
      <div className="grid gap-2">
        {rows.slice(0, 6).map((row: unknown[], index: number) => (
          <div
            key={index}
            className="grid grid-cols-2 gap-2 rounded-md border border-border p-2 text-sm"
          >
            <span className="truncate text-muted-foreground">{displayCell(row[0])}</span>
            <span className="truncate font-medium">{displayCell(row[row.length - 1])}</span>
          </div>
        ))}
      </div>
    );
  }
  const max = Math.max(
    ...points.map((point: { value: number | string | null }) => Number(point.value ?? 0)),
    1,
  );
  return (
    <div className="flex h-40 items-end gap-1 overflow-hidden">
      {points
        .slice(0, 40)
        .map((point: { start: string; value: number | string | null }, index: number) => (
          <div key={`${point.start}-${index}`} className="flex min-w-2 flex-1 flex-col justify-end">
            <div
              className="rounded-t-sm bg-primary/80"
              style={{ height: `${Math.max(5, (Number(point.value ?? 0) / max) * 100)}%` }}
            />
          </div>
        ))}
    </div>
  );
}

function DashboardList({
  dashboards,
  activeId,
  onSelect,
}: {
  dashboards: CustomDashboard[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="grid gap-2">
      {dashboards.map((dashboard) => (
        <button
          key={dashboard.id}
          onClick={() => onSelect(dashboard.id)}
          className={`rounded-md border p-3 text-left ${dashboard.id === activeId ? 'border-primary bg-primary/5' : 'border-border bg-card'}`}
        >
          <div className="truncate text-sm font-medium">{dashboard.name}</div>
          <div className="mt-2 flex gap-1">
            {dashboard.isDefault ? <Star className="h-3.5 w-3.5 text-amber-500" /> : null}
            {dashboard.isFavorite ? <Heart className="h-3.5 w-3.5 text-rose-500" /> : null}
            <span className="text-xs text-muted-foreground">
              {dashboard.widgets.length} widgets
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}

function TemplatePicker({
  templates,
  value,
  onChange,
  onCreate,
  disabled,
}: {
  templates: DashboardTemplate[];
  value: string;
  onChange: (value: string) => void;
  onCreate: () => void;
  disabled: boolean;
}) {
  return (
    <div className="grid gap-2">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label="Dashboard template">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {templates.map((template) => (
            <SelectItem key={template.key} value={template.key}>
              {template.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="secondary" onClick={onCreate} disabled={disabled || !templates.length}>
        <Save className="mr-2 h-4 w-4" />
        Template
      </Button>
    </div>
  );
}

function Toolbar({
  dashboard,
  onDuplicate,
  onArchive,
  onFavorite,
  onDefault,
}: {
  dashboard: CustomDashboard;
  onDuplicate: () => void;
  onArchive: () => void;
  onFavorite: () => void;
  onDefault: () => void;
}) {
  return (
    <Card>
      <CardContent className="grid gap-2 p-4">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold tracking-normal">{dashboard.name}</h2>
          <p className="text-sm text-muted-foreground">Revision {dashboard.revision}</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={onFavorite}>
            <Heart className="mr-2 h-4 w-4" />
            {dashboard.isFavorite ? 'Saved' : 'Save'}
          </Button>
          <Button variant="secondary" onClick={onDefault}>
            <Star className="mr-2 h-4 w-4" />
            Default
          </Button>
          <Button variant="secondary" onClick={onDuplicate}>
            <Copy className="mr-2 h-4 w-4" />
            Copy
          </Button>
          <Button variant="secondary" onClick={onArchive}>
            {dashboard.status === 'ARCHIVED' ? (
              <RotateCcw className="mr-2 h-4 w-4" />
            ) : (
              <Archive className="mr-2 h-4 w-4" />
            )}
            {dashboard.status === 'ARCHIVED' ? 'Restore' : 'Archive'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function WidgetPicker({
  widgetType,
  setWidgetType,
  metric,
  setMetric,
  title,
  setTitle,
  datePreset,
  setDatePreset,
  onAdd,
  disabled,
}: {
  widgetType: DashboardWidgetType;
  setWidgetType: (value: DashboardWidgetType) => void;
  metric: string;
  setMetric: (value: string) => void;
  title: string;
  setTitle: (value: string) => void;
  datePreset: AnalyticsDatePreset;
  setDatePreset: (value: AnalyticsDatePreset) => void;
  onAdd: () => void;
  disabled: boolean;
}) {
  return (
    <Card>
      <CardContent className="grid gap-3 p-4">
        <Input value={title} onChange={(event) => setTitle(event.target.value)} />
        <Select
          value={widgetType}
          onValueChange={(value) => setWidgetType(value as DashboardWidgetType)}
        >
          <SelectTrigger aria-label="Widget type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {widgetTypes.map((type) => (
              <SelectItem key={type} value={type}>
                {label(type)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input value={metric} onChange={(event) => setMetric(event.target.value)} />
        <Select
          value={datePreset}
          onValueChange={(value) => setDatePreset(value as AnalyticsDatePreset)}
        >
          <SelectTrigger aria-label="Widget date range">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {datePresets.map((preset) => (
              <SelectItem key={preset} value={preset}>
                {label(preset)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={onAdd} disabled={disabled}>
          <Plus className="mr-2 h-4 w-4" />
          Widget
        </Button>
      </CardContent>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-3 lg:grid-cols-12">
      <Skeleton className="h-40 rounded-md lg:col-span-4" />
      <Skeleton className="h-40 rounded-md lg:col-span-8" />
      <Skeleton className="h-52 rounded-md lg:col-span-12" />
    </div>
  );
}

function formatValue(value: number | string | null, unit: string) {
  if (value === null) return 'N/A';
  const number = Number(value);
  if (unit === 'bytes') return formatBytes(number);
  if (unit === 'percentage') return `${number}%`;
  return new Intl.NumberFormat().format(number);
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let amount = value / 1024;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount.toFixed(amount >= 10 ? 0 : 1)} ${units[index]}`;
}

function displayCell(value: unknown) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  if (value === null || value === undefined) return '';
  return '';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function label(value: string) {
  return value
    .split('_')
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(' ');
}

function scopeDescription(scope: AnalyticsScopeType) {
  if (scope === 'WORKSPACE') return 'Workspace operational dashboard builder';
  if (scope === 'AGENCY') return 'Agency descendant aggregate dashboard builder';
  if (scope === 'SUPER_AGENCY') return 'Super Agency aggregate and commercial dashboard builder';
  return 'Platform custom dashboard builder';
}

function toastError(fallback: string) {
  return (error: unknown) => toast.error(error instanceof Error ? error.message : fallback);
}
