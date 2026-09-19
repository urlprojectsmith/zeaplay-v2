'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Textarea,
} from '@zea-play/ui';
import { Archive, Pause, Play, Plus, RotateCcw, Square, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useLanguage } from '../../../contexts/language-provider';
import { listDepartments, listWorkspaceUsers } from '../../../services/workspace-management';
import { listWorkspaceStatuses } from '../../../services/workspace-statuses';
import {
  archiveTaskTemplate,
  createTaskTemplate,
  endTaskRecurrence,
  listTaskRecurrenceSeries,
  listTaskTemplates,
  listWorkspaceProjects,
  listWorkspaceTags,
  pauseTaskRecurrence,
  reactivateTaskTemplate,
  resumeTaskRecurrence,
  taskCreationKeys,
  taskKeys,
  updateTaskTemplate,
  type TaskPriority,
  type TaskRecurrenceSeries,
  type TaskRecurrenceStatus,
  type TaskTemplate,
  type TaskTemplatePayload,
  type TaskTemplateStatus,
} from '../../../services/workspace-tasks';
import { useSessionStore } from '../../../stores/session';
import { PageContainer } from '../../layout/PageContainer';
import { PageHeader } from '../../layout/PageHeader';
import { TaskCreateDialog, taskLabels, type TaskLabels } from './WorkspaceTasksPage';

const priorities = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
const noneValue = '__none__';

export function RecurringTasksPage() {
  const { locale, t } = useLanguage();
  const labels = taskLabels(locale, t);
  const workspaceId = useSessionStore((state) => state.selectedWorkspaceId);
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const [status, setStatus] = useState<'ALL' | TaskRecurrenceStatus>('ALL');
  const [page, setPage] = useState(1);
  const params = useMemo(
    () => ({
      page,
      pageSize: 20,
      search: debouncedSearch,
      status: status === 'ALL' ? undefined : status,
    }),
    [debouncedSearch, page, status],
  );
  const query = useQuery({
    queryKey: taskKeys.recurrenceList(workspaceId, params),
    queryFn: () => listTaskRecurrenceSeries(workspaceId as string, params),
    enabled: Boolean(workspaceId),
  });
  const actionMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'pause' | 'resume' | 'end' }) => {
      if (!workspaceId) throw new Error(labels.noWorkspace);
      if (action === 'pause') return pauseTaskRecurrence(workspaceId, id);
      if (action === 'resume') return resumeTaskRecurrence(workspaceId, id);
      return endTaskRecurrence(workspaceId, id);
    },
    onSuccess: async () => {
      toast.success(labels.recurrenceUpdated);
      await queryClient.invalidateQueries({ queryKey: taskKeys.recurrenceBase(workspaceId) });
    },
    onError: () => toast.error(labels.recurrenceActionFailed),
  });

  useEffect(() => setPage(1), [workspaceId, debouncedSearch, status]);

  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 20));

  useEffect(() => {
    if (!query.isFetching && page > totalPages) setPage(totalPages);
  }, [page, query.isFetching, totalPages]);

  return (
    <PageContainer>
      <PageHeader title={labels.recurringTasks} description={labels.recurringTasksDescription} />
      <div className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
          <Input
            label={labels.searchTasks}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
            <SelectTrigger label={labels.seriesStatus}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{labels.all}</SelectItem>
              <SelectItem value="ACTIVE">{labels.active}</SelectItem>
              <SelectItem value="PAUSED">{labels.paused}</SelectItem>
              <SelectItem value="ENDED">{labels.ended}</SelectItem>
              <SelectItem value="ERROR">{labels.needsAttention}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {query.isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : query.isError ? (
          <EmptyState title={labels.errorTitle} description={labels.recurrenceActionFailed} />
        ) : items.length === 0 ? (
          <EmptyState
            title={labels.noRecurringTasks}
            description={labels.noRecurringTasksDescription}
          />
        ) : (
          <div className="grid gap-2">
            {items.map((series) => (
              <SeriesRow
                key={series.id}
                labels={labels}
                series={series}
                busy={actionMutation.isPending}
                onAction={(action) => actionMutation.mutate({ id: series.id, action })}
              />
            ))}
          </div>
        )}
        <Pager labels={labels} page={page} totalPages={totalPages} onPage={setPage} />
      </div>
    </PageContainer>
  );
}

export function TaskTemplatesPage() {
  const { locale, t } = useLanguage();
  const labels = taskLabels(locale, t);
  const workspaceId = useSessionStore((state) => state.selectedWorkspaceId);
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const [status, setStatus] = useState<'ALL' | TaskTemplateStatus>('ACTIVE');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<TaskTemplate | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [taskPrefill, setTaskPrefill] =
    useState<Parameters<typeof TaskCreateDialog>[0]['prefill']>(null);
  const params = useMemo(
    () => ({
      page,
      pageSize: 20,
      search: debouncedSearch,
      status: status === 'ALL' ? undefined : status,
    }),
    [debouncedSearch, page, status],
  );
  const query = useQuery({
    queryKey: taskKeys.templatesList(workspaceId, params),
    queryFn: () => listTaskTemplates(workspaceId as string, params),
    enabled: Boolean(workspaceId),
  });
  const archiveMutation = useMutation({
    mutationFn: ({
      template,
      action,
    }: {
      template: TaskTemplate;
      action: 'archive' | 'reactivate';
    }) => {
      if (!workspaceId) throw new Error(labels.noWorkspace);
      if (action === 'archive') return archiveTaskTemplate(workspaceId, template.id);
      return reactivateTaskTemplate(workspaceId, template.id);
    },
    onSuccess: async () => {
      toast.success(labels.templateUpdated);
      await queryClient.invalidateQueries({ queryKey: taskKeys.templatesBase(workspaceId) });
    },
    onError: () => toast.error(labels.templateActionFailed),
  });

  useEffect(() => {
    setPage(1);
    setEditing(null);
    setCreateOpen(false);
    setCreateTaskOpen(false);
    setTaskPrefill(null);
  }, [workspaceId, debouncedSearch, status]);

  const items = query.data?.items ?? [];
  const totalPages = Math.max(1, Math.ceil((query.data?.total ?? 0) / 20));

  useEffect(() => {
    if (!query.isFetching && page > totalPages) setPage(totalPages);
  }, [page, query.isFetching, totalPages]);

  function useTemplate(template: TaskTemplate) {
    if (
      template.assigneeMembershipIds.length ||
      template.followerMembershipIds.length ||
      template.projectIds.length ||
      template.tagIds.length ||
      template.departmentId
    ) {
      toast.message(labels.outdatedFieldsWarning);
    }
    setTaskPrefill({
      title: template.title,
      description: template.description ?? '',
      priority: template.priority,
      statusDefinitionId: template.statusDefinitionId,
      departmentId: template.departmentId ?? '',
      additionalAssigneeMembershipIds: template.assigneeMembershipIds,
      followerMembershipIds: template.followerMembershipIds,
      projectIds: template.projectIds,
      tagIds: template.tagIds,
    });
    setCreateTaskOpen(true);
  }

  return (
    <PageContainer>
      <PageHeader
        title={labels.taskTemplates}
        description={labels.taskTemplatesDescription}
        actions={
          <Button disabled={!workspaceId} onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {labels.createTemplate}
          </Button>
        }
      />
      <div className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
          <Input
            label={labels.searchTemplates}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
            <SelectTrigger label={labels.status}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ACTIVE">{labels.active}</SelectItem>
              <SelectItem value="ARCHIVED">{labels.archived}</SelectItem>
              <SelectItem value="ALL">{labels.all}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {query.isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : query.isError ? (
          <EmptyState title={labels.errorTitle} description={labels.templateActionFailed} />
        ) : items.length === 0 ? (
          <EmptyState title={labels.noTemplates} description={labels.noTemplatesFound} />
        ) : (
          <div className="grid gap-2">
            {items.map((template) => (
              <TemplateRow
                key={template.id}
                labels={labels}
                template={template}
                busy={archiveMutation.isPending}
                onUse={() => useTemplate(template)}
                onEdit={() => setEditing(template)}
                onArchive={() => {
                  if (window.confirm(labels.archiveTemplateConfirmation)) {
                    archiveMutation.mutate({ template, action: 'archive' });
                  }
                }}
                onReactivate={() => archiveMutation.mutate({ template, action: 'reactivate' })}
              />
            ))}
          </div>
        )}
        <Pager labels={labels} page={page} totalPages={totalPages} onPage={setPage} />
      </div>
      <TemplateDialog
        labels={labels}
        workspaceId={workspaceId}
        template={editing}
        open={createOpen || Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            setEditing(null);
          }
        }}
      />
      <TaskCreateDialog
        labels={labels}
        open={createTaskOpen}
        workspaceId={workspaceId}
        prefill={taskPrefill}
        onPrefillConsumed={() => setTaskPrefill(null)}
        onOpenChange={setCreateTaskOpen}
        onCreated={async () => {
          await queryClient.invalidateQueries({ queryKey: taskKeys.all(workspaceId) });
        }}
      />
    </PageContainer>
  );
}

function SeriesRow({
  labels,
  series,
  busy,
  onAction,
}: {
  labels: TaskLabels;
  series: TaskRecurrenceSeries;
  busy: boolean;
  onAction: (action: 'pause' | 'resume' | 'end') => void;
}) {
  return (
    <article className="grid gap-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4 md:grid-cols-[1fr_auto] md:items-center">
      <div className="grid gap-1">
        <h2 className="break-words text-base font-semibold">{series.title}</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          {series.frequency} · {series.timezone} · {labels.nextOccurrence}:{' '}
          {series.nextOccurrenceAt ? formatDate(series.nextOccurrenceAt) : labels.emptyDash}
        </p>
        <div className="flex flex-wrap gap-2">
          <Badge variant={series.status === 'ERROR' ? 'danger' : 'neutral'}>
            {statusLabel(series.status, labels)}
          </Badge>
          <Badge variant="info">
            {labels.generatedCount}: {series.generatedCount}
          </Badge>
          <Badge variant="neutral">
            {labels.lastGenerated}:{' '}
            {series.lastGeneratedAt ? formatDate(series.lastGeneratedAt) : labels.emptyDash}
          </Badge>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {series.status === 'ACTIVE' ? (
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => onAction('pause')}
          >
            <Pause className="h-4 w-4" aria-hidden="true" />
            {labels.pause}
          </Button>
        ) : null}
        {series.status === 'PAUSED' ? (
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => onAction('resume')}
          >
            <Play className="h-4 w-4" aria-hidden="true" />
            {labels.resume}
          </Button>
        ) : null}
        {series.status !== 'ENDED' ? (
          <Button type="button" variant="secondary" disabled={busy} onClick={() => onAction('end')}>
            <Square className="h-4 w-4" aria-hidden="true" />
            {labels.endRecurrence}
          </Button>
        ) : null}
      </div>
    </article>
  );
}

function TemplateRow({
  labels,
  template,
  busy,
  onUse,
  onEdit,
  onArchive,
  onReactivate,
}: {
  labels: TaskLabels;
  template: TaskTemplate;
  busy: boolean;
  onUse: () => void;
  onEdit: () => void;
  onArchive: () => void;
  onReactivate: () => void;
}) {
  return (
    <article className="grid gap-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4 md:grid-cols-[1fr_auto] md:items-center">
      <div className="grid gap-1">
        <h2 className="break-words text-base font-semibold">{template.name}</h2>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">{template.title}</p>
        <div className="flex flex-wrap gap-2">
          <Badge variant="info">{labels[`priority${template.priority}`]}</Badge>
          <Badge variant={template.status === 'ARCHIVED' ? 'neutral' : 'success'}>
            {template.status === 'ARCHIVED' ? labels.archived : labels.active}
          </Badge>
          <Badge variant="neutral">
            {labels.updated}: {formatDate(template.updatedAt)}
          </Badge>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={template.status !== 'ACTIVE'} onClick={onUse}>
          <Wand2 className="h-4 w-4" aria-hidden="true" />
          {labels.useTemplate}
        </Button>
        <Button type="button" variant="secondary" onClick={onEdit}>
          {labels.editTemplate}
        </Button>
        {template.status === 'ARCHIVED' ? (
          <Button type="button" variant="secondary" disabled={busy} onClick={onReactivate}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            {labels.reactivateTemplate}
          </Button>
        ) : (
          <Button type="button" variant="secondary" disabled={busy} onClick={onArchive}>
            <Archive className="h-4 w-4" aria-hidden="true" />
            {labels.archiveTemplate}
          </Button>
        )}
      </div>
    </article>
  );
}

function TemplateDialog({
  labels,
  workspaceId,
  template,
  open,
  onOpenChange,
}: {
  labels: TaskLabels;
  workspaceId: string | null;
  template: TaskTemplate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<TaskTemplatePayload>(emptyTemplatePayload);
  const statusesQuery = useQuery({
    queryKey: taskCreationKeys.statuses(workspaceId),
    queryFn: () => listWorkspaceStatuses(workspaceId as string, 'TASK', 'ACTIVE'),
    enabled: Boolean(workspaceId && open),
    staleTime: 30_000,
  });
  useQuery({
    queryKey: taskCreationKeys.departments(workspaceId),
    queryFn: () =>
      listDepartments({ workspaceId: workspaceId as string, pageSize: 20, status: 'ACTIVE' }),
    enabled: Boolean(workspaceId && open),
  });
  useQuery({
    queryKey: taskCreationKeys.users(workspaceId, 'template'),
    queryFn: () =>
      listWorkspaceUsers({ workspaceId: workspaceId as string, pageSize: 10, status: 'ACTIVE' }),
    enabled: Boolean(workspaceId && open),
  });
  useQuery({
    queryKey: taskCreationKeys.projects(workspaceId, 'template'),
    queryFn: () => listWorkspaceProjects({ workspaceId: workspaceId as string, pageSize: 10 }),
    enabled: Boolean(workspaceId && open),
  });
  useQuery({
    queryKey: taskKeys.tagCatalog(workspaceId, {
      page: 1,
      pageSize: 10,
      status: 'ACTIVE',
      sortBy: 'name',
      sortDirection: 'asc',
    }),
    queryFn: () =>
      listWorkspaceTags(workspaceId as string, {
        page: 1,
        pageSize: 10,
        status: 'ACTIVE',
        sortBy: 'name',
        sortDirection: 'asc',
      }),
    enabled: Boolean(workspaceId && open),
  });
  const mutation = useMutation({
    mutationFn: () => {
      if (!workspaceId) throw new Error(labels.noWorkspace);
      if (template) return updateTaskTemplate(workspaceId, template.id, form);
      return createTaskTemplate(workspaceId, form);
    },
    onSuccess: async () => {
      toast.success(labels.templateUpdated);
      await queryClient.invalidateQueries({ queryKey: taskKeys.templatesBase(workspaceId) });
      onOpenChange(false);
    },
    onError: () => toast.error(labels.templateActionFailed),
  });

  useEffect(() => {
    if (!open) return;
    setForm(template ? templateToPayload(template) : emptyTemplatePayload());
  }, [open, template]);

  const creationStatuses = (statusesQuery.data ?? []).filter((status) => !status.isTerminal);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{template ? labels.editTemplate : labels.createTemplate}</DialogTitle>
          <DialogDescription>{labels.templateDialogDescription}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Input
            label={labels.templateName}
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
          <Input
            label={labels.titleLabel}
            value={form.title}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
          />
          <Textarea
            label={labels.descriptionField}
            value={form.description ?? ''}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
          <Select
            value={form.priority ?? 'MEDIUM'}
            onValueChange={(value) => setForm({ ...form, priority: value as TaskPriority })}
          >
            <SelectTrigger label={labels.priority}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {priorities.map((priority) => (
                <SelectItem key={priority} value={priority}>
                  {labels[`priority${priority}`]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={form.statusDefinitionId || noneValue}
            onValueChange={(value) =>
              setForm({ ...form, statusDefinitionId: value === noneValue ? '' : value })
            }
          >
            <SelectTrigger label={labels.status}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={noneValue}>{labels.backendDefault}</SelectItem>
              {creationStatuses.map((status) => (
                <SelectItem key={status.id} value={status.id}>
                  {status.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {labels.outdatedFieldsWarning}
          </p>
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            {labels.cancel}
          </Button>
          <Button
            type="button"
            disabled={!form.name.trim() || !form.title.trim() || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {labels.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Pager({
  labels,
  page,
  totalPages,
  onPage,
}: {
  labels: TaskLabels;
  page: number;
  totalPages: number;
  onPage: (page: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button
        type="button"
        variant="secondary"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        {labels.previous}
      </Button>
      <span className="text-sm text-[hsl(var(--muted-foreground))]">
        {labels.page} {page}
      </span>
      <Button
        type="button"
        variant="secondary"
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
      >
        {labels.next}
      </Button>
    </div>
  );
}

function emptyTemplatePayload(): TaskTemplatePayload {
  return {
    name: '',
    title: '',
    description: '',
    priority: 'MEDIUM',
    assigneeMembershipIds: [],
    followerMembershipIds: [],
    projectIds: [],
    tagIds: [],
  };
}

function templateToPayload(template: TaskTemplate): TaskTemplatePayload {
  return {
    name: template.name,
    title: template.title,
    description: template.description ?? '',
    priority: template.priority,
    statusDefinitionId: template.statusDefinitionId,
    departmentId: template.departmentId,
    assigneeMembershipIds: template.assigneeMembershipIds,
    followerMembershipIds: template.followerMembershipIds,
    projectIds: template.projectIds,
    tagIds: template.tagIds,
  };
}

function statusLabel(status: TaskRecurrenceStatus, labels: TaskLabels) {
  if (status === 'PAUSED') return labels.paused;
  if (status === 'ENDED') return labels.ended;
  if (status === 'ERROR') return labels.needsAttention;
  return labels.active;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

function useDebouncedValue(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [delay, value]);
  return debounced;
}
