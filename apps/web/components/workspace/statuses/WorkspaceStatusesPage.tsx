'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
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
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  cn,
} from '@zea-play/ui';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  CircleDot,
  MoreHorizontal,
  Plus,
  RotateCcw,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { useLanguage } from '../../../contexts/language-provider';
import {
  createWorkspaceStatus,
  initializeWorkspaceStatusDefaults,
  listWorkspaceStatuses,
  reorderWorkspaceStatuses,
  setWorkspaceStatusDefault,
  statusKeys,
  updateWorkspaceStatus,
} from '../../../services/workspace-statuses';
import type {
  StatusCategory,
  StatusEntityType,
  WorkspaceStatusDefinition,
} from '../../../services/workspace-statuses';
import { useSessionStore } from '../../../stores/session';
import { PageContainer } from '../../layout/PageContainer';
import { PageHeader } from '../../layout/PageHeader';

const entityTypes = ['TASK', 'PROJECT', 'TICKET'] as const satisfies readonly StatusEntityType[];
const statusCategories = [
  'BACKLOG',
  'TODO',
  'IN_PROGRESS',
  'REVIEW',
  'COMPLETED',
  'CANCELLED',
] as const satisfies readonly StatusCategory[];
const colorPalette = ['#64748B', '#2563EB', '#0891B2', '#7C3AED', '#D97706', '#16A34A', '#DC2626'];

const statusLabelKeys = [
  'title',
  'description',
  'tabs',
  'taskStatuses',
  'projectPipeline',
  'ticketStatuses',
  'taskStatusPlural',
  'pipelineStagePlural',
  'ticketStatusPlural',
  'statusHelp',
  'pipelineHelp',
  'createTaskStatus',
  'createPipelineStage',
  'createTicketStatus',
  'editStatus',
  'formDescription',
  'name',
  'descriptionField',
  'color',
  'colorPalette',
  'category',
  'terminalStatus',
  'terminalHelp',
  'create',
  'cancel',
  'saveChanges',
  'default',
  'terminal',
  'active',
  'inactive',
  'actions',
  'edit',
  'setDefault',
  'currentDefault',
  'newDefault',
  'setDefaultHelp',
  'deactivate',
  'deactivateHelp',
  'reactivate',
  'moveUp',
  'moveDown',
  'filter',
  'filterALL',
  'filterACTIVE',
  'filterINACTIVE',
  'noDescription',
  'noStatuses',
  'emptyDescription',
  'initializeDefaults',
  'loadError',
  'retryDescription',
  'limitReached',
  'none',
  'discardChanges',
  'created',
  'updated',
  'defaultChanged',
  'deactivated',
  'reactivated',
  'initialized',
  'reordered',
  'createFailed',
  'updateFailed',
  'defaultFailed',
  'activeFailed',
  'initializeFailed',
  'reorderFailed',
  'categoryBACKLOG',
  'categoryTODO',
  'categoryIN_PROGRESS',
  'categoryREVIEW',
  'categoryCOMPLETED',
  'categoryCANCELLED',
] as const;

type StatusLabels = Record<(typeof statusLabelKeys)[number], string>;

const statusFormSchema = z.object({
  name: z.string().trim().min(2, 'Name is required.').max(80),
  description: z.string().max(240).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Use a #RRGGBB HEX color.'),
  category: z.enum(statusCategories),
  isTerminal: z.boolean(),
});

type StatusFormValues = z.infer<typeof statusFormSchema>;
type StatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';

export function WorkspaceStatusesPage() {
  const { locale, t } = useLanguage();
  const labels = statusLabels(locale, t);
  const workspaceId = useSessionStore((state) => state.selectedWorkspaceId);
  const queryClient = useQueryClient();
  const [entityType, setEntityType] = useState<StatusEntityType>(() => initialEntityType());
  const [filter, setFilter] = useState<StatusFilter>('ALL');
  const [editing, setEditing] = useState<WorkspaceStatusDefinition | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [defaultTarget, setDefaultTarget] = useState<WorkspaceStatusDefinition | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<WorkspaceStatusDefinition | null>(null);

  const statusesQuery = useQuery({
    queryKey: statusKeys.list(workspaceId, entityType, 'ALL'),
    queryFn: () => listWorkspaceStatuses(workspaceId as string, entityType, 'ALL'),
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
  });

  const allStatuses = statusesQuery.data ?? [];
  const statuses = filterStatuses(allStatuses, filter);
  const activeDefault = allStatuses.find((status) => status.isActive && status.isDefault) ?? null;
  const activeCount = allStatuses.filter((status) => status.isActive).length;
  const canCreate = allStatuses.length < 50;

  const form = useForm<StatusFormValues>({
    resolver: zodResolver(statusFormSchema),
    defaultValues: defaultFormValues(),
  });
  const formIsDirty = form.formState.isDirty;

  useEffect(() => {
    setEditing(null);
    setCreateOpen(false);
    setDefaultTarget(null);
    setDeactivateTarget(null);
    form.reset(defaultFormValues());
  }, [entityType, workspaceId, form]);

  function changeEntityType(next: StatusEntityType) {
    if (formIsDirty && !window.confirm(labels.discardChanges)) return;
    setEntityType(next);
    window.history.replaceState(null, '', `?type=${next}`);
  }

  function openCreate() {
    form.reset(defaultFormValues());
    setEditing(null);
    setCreateOpen(true);
  }

  function openEdit(status: WorkspaceStatusDefinition) {
    form.reset({
      name: status.name,
      description: status.description ?? '',
      color: status.color,
      category: status.category,
      isTerminal: status.isTerminal,
    });
    setEditing(status);
    setCreateOpen(true);
  }

  const invalidateCurrentEntity = async () => {
    await queryClient.invalidateQueries({
      queryKey: statusKeys.list(workspaceId, entityType, 'ALL'),
    });
  };

  const invalidateWorkspaceStatuses = async () => {
    await queryClient.invalidateQueries({ queryKey: statusKeys.all(workspaceId) });
  };

  const createMutation = useMutation({
    mutationFn: (values: StatusFormValues) =>
      createWorkspaceStatus(workspaceId as string, entityType, serializeStatusForm(values)),
    onSuccess: async () => {
      toast.success(labels.created);
      setCreateOpen(false);
      form.reset(defaultFormValues());
      await invalidateCurrentEntity();
    },
    onError: (error) => toast.error(errorMessage(error, labels.createFailed)),
  });

  const updateMutation = useMutation({
    mutationFn: (values: StatusFormValues) =>
      updateWorkspaceStatus(
        workspaceId as string,
        entityType,
        editing?.id as string,
        serializeStatusForm(values),
      ),
    onSuccess: async () => {
      toast.success(labels.updated);
      setCreateOpen(false);
      setEditing(null);
      await invalidateCurrentEntity();
    },
    onError: (error) => toast.error(errorMessage(error, labels.updateFailed)),
  });

  const setDefaultMutation = useMutation({
    mutationFn: (statusId: string) =>
      setWorkspaceStatusDefault(workspaceId as string, entityType, statusId),
    onSuccess: async () => {
      toast.success(labels.defaultChanged);
      setDefaultTarget(null);
      await invalidateCurrentEntity();
    },
    onError: (error) => toast.error(errorMessage(error, labels.defaultFailed)),
  });

  const activeMutation = useMutation({
    mutationFn: ({ statusId, isActive }: { statusId: string; isActive: boolean }) =>
      updateWorkspaceStatus(workspaceId as string, entityType, statusId, { isActive }),
    onSuccess: async (_status, variables) => {
      toast.success(variables.isActive ? labels.reactivated : labels.deactivated);
      setDeactivateTarget(null);
      await invalidateCurrentEntity();
    },
    onError: (error) => toast.error(errorMessage(error, labels.activeFailed)),
  });

  const initializeMutation = useMutation({
    mutationFn: () => initializeWorkspaceStatusDefaults(workspaceId as string),
    onSuccess: async () => {
      toast.success(labels.initialized);
      await invalidateWorkspaceStatuses();
    },
    onError: (error) => toast.error(errorMessage(error, labels.initializeFailed)),
  });

  const reorderMutation = useMutation({
    mutationFn: (orderedStatusIds: string[]) =>
      reorderWorkspaceStatuses(workspaceId as string, entityType, orderedStatusIds),
    onMutate: async (orderedStatusIds) => {
      const queryKey = statusKeys.list(workspaceId, entityType, 'ALL');
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<WorkspaceStatusDefinition[]>(queryKey);
      if (previous) {
        const byId = new Map(previous.map((status) => [status.id, status]));
        queryClient.setQueryData(
          queryKey,
          orderedStatusIds
            .map((id, index) => {
              const status = byId.get(id);
              return status ? { ...status, position: index + 1 } : null;
            })
            .filter((status): status is WorkspaceStatusDefinition => Boolean(status)),
        );
      }
      return { previous, queryKey };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(context.queryKey, context.previous);
      toast.error(errorMessage(error, labels.reorderFailed));
    },
    onSuccess: async () => {
      toast.success(labels.reordered);
      await invalidateCurrentEntity();
    },
  });

  function moveStatus(statusId: string, direction: -1 | 1) {
    const index = statuses.findIndex((status) => status.id === statusId);
    const nextIndex = index + direction;
    if (
      filter !== 'ALL' ||
      index < 0 ||
      nextIndex < 0 ||
      nextIndex >= statuses.length ||
      reorderMutation.isPending
    ) {
      return;
    }
    const ordered = [...statuses];
    const [moved] = ordered.splice(index, 1);
    if (!moved) return;
    ordered.splice(nextIndex, 0, moved);
    reorderMutation.mutate(ordered.map((status) => status.id));
  }

  const empty = !statusesQuery.isLoading && !statusesQuery.isError && allStatuses.length === 0;

  return (
    <PageContainer>
      <PageHeader
        title={labels.title}
        description={labels.description}
        actions={
          <Button onClick={openCreate} disabled={!canCreate}>
            <Plus className="h-4 w-4" /> {createLabel(entityType, labels)}
          </Button>
        }
      />
      <Tabs
        value={entityType}
        onValueChange={(value) => changeEntityType(value as StatusEntityType)}
      >
        <TabsList
          aria-label={labels.tabs}
          className="grid w-full grid-cols-1 gap-1 sm:inline-grid sm:w-auto sm:grid-cols-3"
        >
          {entityTypes.map((type) => (
            <TabsTrigger key={type} value={type} className="whitespace-normal text-center">
              {entityLabel(type, labels)}
            </TabsTrigger>
          ))}
        </TabsList>
        {entityTypes.map((type) => (
          <TabsContent key={type} value={type}>
            <Card>
              <CardContent className="grid gap-4 pt-5 md:grid-cols-[1fr_180px]">
                <div>
                  <p className="font-semibold">{entityHeading(type, labels)}</p>
                  <p className="text-sm text-[hsl(var(--muted-foreground))]">
                    {type === 'PROJECT' ? labels.pipelineHelp : labels.statusHelp}
                  </p>
                </div>
                <Select value={filter} onValueChange={(value) => setFilter(value as StatusFilter)}>
                  <SelectTrigger label={labels.filter}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['ALL', 'ACTIVE', 'INACTIVE'] as const).map((item) => (
                      <SelectItem key={item} value={item}>
                        {labels[`filter${item}`]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>
            {statusesQuery.isLoading ? (
              <StatusSkeleton />
            ) : statusesQuery.isError ? (
              <EmptyState title={labels.loadError} description={labels.retryDescription} />
            ) : empty ? (
              <EmptyState
                title={labels.noStatuses}
                description={labels.emptyDescription}
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button onClick={() => initializeMutation.mutate()}>
                      <RotateCcw className="h-4 w-4" /> {labels.initializeDefaults}
                    </Button>
                    <Button variant="secondary" onClick={openCreate}>
                      <Plus className="h-4 w-4" /> {createLabel(entityType, labels)}
                    </Button>
                  </div>
                }
              />
            ) : (
              <>
                <StatusList
                  statuses={statuses}
                  entityType={entityType}
                  activeCount={activeCount}
                  labels={labels}
                  busy={reorderMutation.isPending}
                  reorderDisabled={filter !== 'ALL'}
                  onMove={moveStatus}
                  onEdit={openEdit}
                  onSetDefault={setDefaultTarget}
                  onDeactivate={setDeactivateTarget}
                  onReactivate={(status) =>
                    activeMutation.mutate({ statusId: status.id, isActive: true })
                  }
                />
                {!canCreate ? (
                  <p className="text-sm font-semibold text-[hsl(var(--warning))]">
                    {labels.limitReached}
                  </p>
                ) : null}
              </>
            )}
          </TabsContent>
        ))}
      </Tabs>
      <StatusFormDialog
        open={createOpen}
        entityType={entityType}
        editing={editing}
        form={form}
        labels={labels}
        loading={createMutation.isPending || updateMutation.isPending}
        onOpenChange={(open) => {
          if (!open && formIsDirty && !window.confirm(labels.discardChanges)) return;
          setCreateOpen(open);
          if (!open) setEditing(null);
        }}
        onSubmit={(event) =>
          void form.handleSubmit((values) =>
            editing ? updateMutation.mutate(values) : createMutation.mutate(values),
          )(event)
        }
      />
      <SetDefaultDialog
        currentDefault={activeDefault}
        target={defaultTarget}
        labels={labels}
        loading={setDefaultMutation.isPending}
        onOpenChange={(open) => {
          if (!open) setDefaultTarget(null);
        }}
        onConfirm={() => defaultTarget && setDefaultMutation.mutate(defaultTarget.id)}
      />
      <DeactivateStatusDialog
        target={deactivateTarget}
        labels={labels}
        loading={activeMutation.isPending}
        onOpenChange={(open) => {
          if (!open) setDeactivateTarget(null);
        }}
        onConfirm={() =>
          deactivateTarget &&
          activeMutation.mutate({ statusId: deactivateTarget.id, isActive: false })
        }
      />
    </PageContainer>
  );
}

function StatusList({
  statuses,
  entityType,
  activeCount,
  labels,
  busy,
  reorderDisabled,
  onMove,
  onEdit,
  onSetDefault,
  onDeactivate,
  onReactivate,
}: {
  statuses: WorkspaceStatusDefinition[];
  entityType: StatusEntityType;
  activeCount: number;
  labels: StatusLabels;
  busy: boolean;
  reorderDisabled: boolean;
  onMove: (statusId: string, direction: -1 | 1) => void;
  onEdit: (status: WorkspaceStatusDefinition) => void;
  onSetDefault: (status: WorkspaceStatusDefinition) => void;
  onDeactivate: (status: WorkspaceStatusDefinition) => void;
  onReactivate: (status: WorkspaceStatusDefinition) => void;
}) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  function closeMenu() {
    setOpenMenuId(null);
  }

  return (
    <div
      className={cn(
        'grid gap-3',
        entityType === 'PROJECT' && 'md:grid-cols-[repeat(auto-fit,minmax(220px,1fr))]',
      )}
    >
      {statuses.map((status, index) => (
        <Card
          key={status.id}
          className={cn(
            'p-0',
            !status.isActive && 'opacity-75',
            entityType === 'PROJECT' && 'h-full',
          )}
        >
          <CardContent className="grid gap-4 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="h-3.5 w-3.5 shrink-0 rounded-full border border-black/15"
                    style={{ backgroundColor: status.color }}
                  />
                  <p className="break-words font-semibold">{status.name}</p>
                </div>
                <p className="mt-1 min-h-5 text-sm text-[hsl(var(--muted-foreground))]">
                  {status.description || labels.noDescription}
                </p>
              </div>
              <div className="relative">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-expanded={openMenuId === status.id}
                  aria-label={`${labels.actions}: ${status.name}`}
                  onClick={() =>
                    setOpenMenuId((current) => (current === status.id ? null : status.id))
                  }
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
                {openMenuId === status.id ? (
                  <div
                    role="menu"
                    className="absolute right-0 z-20 mt-2 grid min-w-44 gap-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-elevated))] p-1 text-sm shadow-lg"
                  >
                    <ActionMenuButton
                      label={labels.edit}
                      onSelect={() => {
                        closeMenu();
                        onEdit(status);
                      }}
                    />
                    <ActionMenuButton
                      label={labels.setDefault}
                      disabled={!status.isActive || status.isDefault}
                      onSelect={() => {
                        closeMenu();
                        onSetDefault(status);
                      }}
                    />
                    {status.isActive ? (
                      <ActionMenuButton
                        label={labels.deactivate}
                        disabled={status.isDefault || activeCount <= 1}
                        onSelect={() => {
                          closeMenu();
                          onDeactivate(status);
                        }}
                      />
                    ) : (
                      <ActionMenuButton
                        label={labels.reactivate}
                        onSelect={() => {
                          closeMenu();
                          onReactivate(status);
                        }}
                      />
                    )}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="neutral">{categoryLabel(status.category, labels)}</Badge>
              {status.isDefault ? <Badge variant="success">{labels.default}</Badge> : null}
              {status.isTerminal ? <Badge variant="info">{labels.terminal}</Badge> : null}
              <Badge variant={status.isActive ? 'success' : 'warning'}>
                {status.isActive ? labels.active : labels.inactive}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={reorderDisabled || index === 0 || busy}
                onClick={() => onMove(status.id, -1)}
              >
                <ArrowUp className="h-4 w-4" /> {labels.moveUp}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={reorderDisabled || index === statuses.length - 1 || busy}
                onClick={() => onMove(status.id, 1)}
              >
                <ArrowDown className="h-4 w-4" /> {labels.moveDown}
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ActionMenuButton({
  label,
  disabled,
  onSelect,
}: {
  label: string;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      data-disabled={disabled ? '' : undefined}
      className="rounded px-2 py-2 text-left outline-none hover:bg-[hsl(var(--surface-muted))] focus-visible:bg-[hsl(var(--surface-muted))] disabled:pointer-events-none disabled:opacity-50"
      onClick={onSelect}
    >
      {label}
    </button>
  );
}

function StatusFormDialog({
  open,
  entityType,
  editing,
  form,
  labels,
  loading,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  entityType: StatusEntityType;
  editing: WorkspaceStatusDefinition | null;
  form: ReturnType<typeof useForm<StatusFormValues>>;
  labels: StatusLabels;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const color = form.watch('color');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? labels.editStatus : createLabel(entityType, labels)}</DialogTitle>
          <DialogDescription>{labels.formDescription}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={onSubmit}>
          <Input
            label={labels.name}
            error={form.formState.errors.name?.message}
            {...form.register('name')}
          />
          <Textarea
            label={labels.descriptionField}
            error={form.formState.errors.description?.message}
            {...form.register('description')}
          />
          <div className="grid gap-2">
            <Input
              label={labels.color}
              error={form.formState.errors.color?.message}
              {...form.register('color')}
            />
            <div className="flex flex-wrap gap-2" aria-label={labels.colorPalette}>
              {colorPalette.map((paletteColor) => (
                <button
                  key={paletteColor}
                  type="button"
                  aria-label={`${labels.color} ${paletteColor}`}
                  className={cn(
                    'h-8 w-8 rounded-full border border-black/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
                    color.toUpperCase() === paletteColor && 'ring-2 ring-[hsl(var(--ring))]',
                  )}
                  style={{ backgroundColor: paletteColor }}
                  onClick={() => form.setValue('color', paletteColor, { shouldDirty: true })}
                />
              ))}
            </div>
          </div>
          <Select
            value={form.watch('category')}
            onValueChange={(value) =>
              form.setValue('category', value as StatusCategory, { shouldDirty: true })
            }
          >
            <SelectTrigger label={labels.category} error={form.formState.errors.category?.message}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusCategories.map((category) => (
                <SelectItem key={category} value={category}>
                  {categoryLabel(category, labels)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Switch
            label={labels.terminalStatus}
            description={labels.terminalHelp}
            checked={form.watch('isTerminal')}
            onCheckedChange={(checked) =>
              form.setValue('isTerminal', Boolean(checked), { shouldDirty: true })
            }
          />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              {labels.cancel}
            </Button>
            <Button type="submit" loading={loading}>
              {editing ? labels.saveChanges : labels.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SetDefaultDialog({
  currentDefault,
  target,
  labels,
  loading,
  onOpenChange,
  onConfirm,
}: {
  currentDefault: WorkspaceStatusDefinition | null;
  target: WorkspaceStatusDefinition | null;
  labels: StatusLabels;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={Boolean(target)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{labels.setDefault}</DialogTitle>
          <DialogDescription>{labels.setDefaultHelp}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 rounded-md border border-[hsl(var(--border))] p-4">
          <p className="text-sm">
            <span className="font-semibold">{labels.currentDefault}:</span>{' '}
            {currentDefault?.name ?? labels.none}
          </p>
          <p className="text-sm">
            <span className="font-semibold">{labels.newDefault}:</span>{' '}
            {target?.name ?? labels.none}
          </p>
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            {labels.cancel}
          </Button>
          <Button loading={loading} onClick={onConfirm}>
            <CheckCircle2 className="h-4 w-4" /> {labels.setDefault}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeactivateStatusDialog({
  target,
  labels,
  loading,
  onOpenChange,
  onConfirm,
}: {
  target: WorkspaceStatusDefinition | null;
  labels: StatusLabels;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={Boolean(target)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{labels.deactivate}</DialogTitle>
          <DialogDescription>{labels.deactivateHelp}</DialogDescription>
        </DialogHeader>
        {target ? (
          <div className="flex items-center gap-2 rounded-md border border-[hsl(var(--border))] p-4">
            <CircleDot className="h-4 w-4" />
            <span className="font-semibold">{target.name}</span>
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            {labels.cancel}
          </Button>
          <Button variant="danger" loading={loading} onClick={onConfirm}>
            {labels.deactivate}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusSkeleton() {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <Skeleton key={index} className="h-44 w-full" />
      ))}
    </div>
  );
}

function initialEntityType(): StatusEntityType {
  if (typeof window === 'undefined') return 'TASK';
  const type = new URLSearchParams(window.location.search).get('type');
  return entityTypes.includes(type as StatusEntityType) ? (type as StatusEntityType) : 'TASK';
}

function filterStatuses(statuses: WorkspaceStatusDefinition[], filter: StatusFilter) {
  if (filter === 'ACTIVE') return statuses.filter((status) => status.isActive);
  if (filter === 'INACTIVE') return statuses.filter((status) => !status.isActive);
  return statuses;
}

function defaultFormValues(): StatusFormValues {
  return { name: '', description: '', color: '#2563EB', category: 'TODO', isTerminal: false };
}

function serializeStatusForm(values: StatusFormValues) {
  return {
    name: values.name.trim(),
    description: values.description?.trim() || null,
    color: values.color.toUpperCase(),
    category: values.category,
    isTerminal: values.isTerminal,
  };
}

function entityLabel(type: StatusEntityType, labels: StatusLabels) {
  if (type === 'TASK') return labels.taskStatuses;
  if (type === 'PROJECT') return labels.projectPipeline;
  return labels.ticketStatuses;
}

function entityHeading(type: StatusEntityType, labels: StatusLabels) {
  if (type === 'PROJECT') return labels.pipelineStagePlural;
  if (type === 'TICKET') return labels.ticketStatusPlural;
  return labels.taskStatusPlural;
}

function createLabel(type: StatusEntityType, labels: StatusLabels) {
  if (type === 'PROJECT') return labels.createPipelineStage;
  if (type === 'TICKET') return labels.createTicketStatus;
  return labels.createTaskStatus;
}

function categoryLabel(category: StatusCategory, labels: StatusLabels) {
  return labels[`category${category}`] ?? category;
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;
  return fallback;
}

function statusLabels(
  locale: ReturnType<typeof useLanguage>['locale'],
  t: ReturnType<typeof useLanguage>['t'],
): StatusLabels {
  return Object.fromEntries(
    statusLabelKeys.map((key) => [key, t(locale, `workspaceStatuses.${key}`)]),
  ) as StatusLabels;
}
