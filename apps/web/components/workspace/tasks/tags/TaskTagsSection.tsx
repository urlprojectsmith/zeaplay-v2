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
} from '@zea-play/ui';
import { Archive, Check, Pencil, Plus, RotateCcw, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { listWorkspaceRoles, rolesKeys } from '../../../../services/workspace-roles';
import {
  addTaskTags,
  archiveWorkspaceTag,
  createWorkspaceTag,
  getTaskTags,
  listWorkspaceTags,
  reactivateWorkspaceTag,
  removeTaskTags,
  taskKeys,
  updateWorkspaceTag,
  type TaskTagMutationResult,
  type WorkspaceTagStatus,
  type WorkspaceTagSummary,
} from '../../../../services/workspace-tasks';
import { useSessionStore } from '../../../../stores/session';

const selectionLimit = 50;
const hexColorPattern = /^#[0-9A-Fa-f]{6}$/;
const neutralColor = '#64748B';

export function TaskTagsSection({
  workspaceId,
  taskId,
  labels,
}: {
  workspaceId: string | null;
  taskId: string;
  labels: TaskTagLabels;
}) {
  const accessToken = useSessionStore((state) => state.accessToken);
  const selectedWorkspace = useSelectedWorkspace(workspaceId);
  const roleKey = selectedWorkspace?.role ?? null;
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [removingTagId, setRemovingTagId] = useState<string | null>(null);
  const resetKey = `${workspaceId ?? 'no-workspace'}:${taskId}:${accessToken ?? 'signed-out'}`;

  const rolesQuery = useQuery({
    queryKey: rolesKeys.all(workspaceId),
    queryFn: () => listWorkspaceRoles(workspaceId as string),
    enabled: Boolean(workspaceId && roleKey && accessToken),
    staleTime: 30_000,
  });
  const permissions = useMemo(() => {
    const role = rolesQuery.data?.find((item) => item.key.toLowerCase() === roleKey?.toLowerCase());
    return new Set(role?.permissions.map((permission) => permission.key) ?? []);
  }, [roleKey, rolesQuery.data]);
  const canAssign =
    hasPermission(permissions, 'tasks.update') && hasPermission(permissions, 'tags.assign');
  const canViewCatalog = hasPermission(permissions, 'tags.view');
  const canCreate = hasPermission(permissions, 'tags.create');
  const canUpdate = hasPermission(permissions, 'tags.update');
  const canArchive = hasPermission(permissions, 'tags.archive');

  const tagsQuery = useQuery({
    queryKey: taskKeys.tags(workspaceId, taskId),
    queryFn: () => getTaskTags(workspaceId as string, taskId),
    enabled: Boolean(workspaceId && taskId && accessToken),
  });

  useEffect(() => {
    setAddOpen(false);
    setManageOpen(false);
  }, [resetKey]);

  return (
    <section className="grid gap-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h4 className="text-sm font-semibold">{labels.tags}</h4>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">{labels.tagsDescription}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canAssign ? (
            <Button type="button" size="sm" onClick={() => setAddOpen(true)}>
              <Plus aria-hidden="true" className="h-4 w-4" />
              {labels.addTags}
            </Button>
          ) : null}
          {canViewCatalog ? (
            <Button type="button" size="sm" variant="secondary" onClick={() => setManageOpen(true)}>
              {labels.manageTags}
            </Button>
          ) : null}
        </div>
      </div>

      {tagsQuery.isLoading ? (
        <div className="flex flex-wrap gap-2" aria-label={labels.loadingTags}>
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-28" />
        </div>
      ) : tagsQuery.isError ? (
        <EmptyState
          title={labels.tagsLoadFailed}
          description={labels.networkError}
          action={
            <Button type="button" variant="secondary" onClick={() => void tagsQuery.refetch()}>
              {labels.retry}
            </Button>
          }
        />
      ) : tagsQuery.data?.length ? (
        <div className="flex flex-wrap gap-2" aria-label={labels.tags}>
          {tagsQuery.data.map((tag) => (
            <TagChip
              key={tag.id}
              tag={tag}
              labels={labels}
              removable={canAssign}
              disabled={Boolean(removingTagId)}
              onRemove={() => {
                if (removingTagId) return;
                setRemovingTagId(tag.id);
                void removeTaskTag(queryClient, workspaceId, taskId, tag.id, labels).finally(() =>
                  setRemovingTagId(null),
                );
              }}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">{labels.noTags}</p>
      )}

      <TaskAddTagsDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        workspaceId={workspaceId}
        taskId={taskId}
        labels={labels}
        attachedTags={tagsQuery.data ?? []}
        canManage={canViewCatalog}
        onManage={() => {
          setAddOpen(false);
          setManageOpen(true);
        }}
      />
      <WorkspaceTagManager
        open={manageOpen}
        onOpenChange={setManageOpen}
        workspaceId={workspaceId}
        labels={labels}
        canCreate={canCreate}
        canUpdate={canUpdate}
        canArchive={canArchive}
        currentTaskTags={tagsQuery.data ?? []}
        taskId={taskId}
      />
    </section>
  );
}

function TaskAddTagsDialog({
  open,
  onOpenChange,
  workspaceId,
  taskId,
  labels,
  attachedTags,
  canManage,
  onManage,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string | null;
  taskId: string;
  labels: TaskTagLabels;
  attachedTags: WorkspaceTagSummary[];
  canManage: boolean;
  onManage: () => void;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<WorkspaceTagSummary[]>([]);
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const attachedIds = useMemo(() => new Set(attachedTags.map((tag) => tag.id)), [attachedTags]);
  const catalogQuery = useQuery({
    queryKey: taskKeys.tagCatalog(workspaceId, {
      page: 1,
      pageSize: 10,
      search: debouncedSearch,
      status: 'ACTIVE',
      sortBy: 'name',
      sortDirection: 'asc',
    }),
    queryFn: () =>
      listWorkspaceTags(workspaceId as string, {
        page: 1,
        pageSize: 10,
        search: debouncedSearch,
        status: 'ACTIVE',
        sortBy: 'name',
        sortDirection: 'asc',
      }),
    enabled: Boolean(open && workspaceId),
  });
  const addMutation = useMutation({
    mutationFn: () =>
      addTaskTags(
        workspaceId as string,
        taskId,
        selected.map((tag) => tag.id),
      ),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: taskKeys.tags(workspaceId, taskId) });
      toast.success(
        tagMutationMessage(
          result,
          labels.tagsAdded,
          labels.tagsAlreadyAssigned,
          labels.noTagsAdded,
        ),
      );
      setSelected([]);
      setSearch('');
      onOpenChange(false);
    },
    onError: (error) => toast.error(safeTagError(error, labels)),
  });

  useEffect(() => {
    if (!open) {
      setSearch('');
      setSelected([]);
    }
  }, [open, workspaceId, taskId]);

  function toggle(tag: WorkspaceTagSummary) {
    if (attachedIds.has(tag.id)) return;
    setSelected((current) => {
      if (current.some((item) => item.id === tag.id)) {
        return current.filter((item) => item.id !== tag.id);
      }
      if (current.length >= selectionLimit) {
        toast.error(labels.selectionLimit);
        return current;
      }
      return [...current, tag];
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{labels.addTags}</DialogTitle>
          <DialogDescription>{labels.addTagsDescription}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Input
            label={labels.searchTags}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={labels.searchTags}
          />
          <div className="grid gap-2" role="listbox" aria-label={labels.tagSearchResults}>
            {catalogQuery.isLoading ? (
              <Skeleton className="h-12 w-full" />
            ) : catalogQuery.data?.items.length ? (
              catalogQuery.data.items.map((tag) => {
                const selectedTag = selected.some((item) => item.id === tag.id);
                const alreadyAttached = attachedIds.has(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    role="option"
                    aria-selected={selectedTag}
                    disabled={alreadyAttached}
                    className="flex items-center justify-between gap-3 rounded-md border border-[hsl(var(--border))] px-3 py-2 text-left outline-none hover:bg-[hsl(var(--surface-muted))] focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => toggle(tag)}
                  >
                    <TagLabel tag={tag} labels={labels} />
                    <span className="text-xs font-semibold text-[hsl(var(--muted-foreground))]">
                      {alreadyAttached
                        ? labels.alreadyAdded
                        : selectedTag
                          ? labels.selected
                          : labels.addTags}
                    </span>
                  </button>
                );
              })
            ) : (
              <p className="text-sm text-[hsl(var(--muted-foreground))]">{labels.noTagsFound}</p>
            )}
          </div>
          {selected.length ? (
            <div className="flex flex-wrap gap-2" aria-label={labels.selectedTags}>
              {selected.map((tag) => (
                <TagChip
                  key={tag.id}
                  tag={tag}
                  labels={labels}
                  removable
                  onRemove={() =>
                    setSelected((current) => current.filter((item) => item.id !== tag.id))
                  }
                />
              ))}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          {canManage ? (
            <Button type="button" variant="secondary" onClick={onManage}>
              {labels.manageTags}
            </Button>
          ) : null}
          <Button
            type="button"
            disabled={selected.length === 0 || addMutation.isPending}
            onClick={() => addMutation.mutate()}
          >
            {addMutation.isPending ? labels.applying : labels.addTags}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WorkspaceTagManager({
  open,
  onOpenChange,
  workspaceId,
  labels,
  canCreate,
  canUpdate,
  canArchive,
  currentTaskTags,
  taskId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string | null;
  labels: TaskTagLabels;
  canCreate: boolean;
  canUpdate: boolean;
  canArchive: boolean;
  currentTaskTags: WorkspaceTagSummary[];
  taskId: string;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<WorkspaceTagStatus | 'ALL'>('ACTIVE');
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState({ name: '', color: '' });
  const [editing, setEditing] = useState<WorkspaceTagSummary | null>(null);
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const params = {
    page,
    pageSize: 10,
    search: debouncedSearch,
    ...(status === 'ALL' ? {} : { status }),
    sortBy: 'name' as const,
    sortDirection: 'asc' as const,
  };
  const catalogQuery = useQuery({
    queryKey: taskKeys.tagCatalog(workspaceId, params),
    queryFn: () => listWorkspaceTags(workspaceId as string, params),
    enabled: Boolean(open && workspaceId),
  });
  const taskTagIds = useMemo(
    () => new Set(currentTaskTags.map((tag) => tag.id)),
    [currentTaskTags],
  );

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, status, workspaceId]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil((catalogQuery.data?.total ?? 0) / 10));
    if (catalogQuery.isSuccess && page > totalPages) setPage(totalPages);
  }, [catalogQuery.data?.total, catalogQuery.isSuccess, page]);

  useEffect(() => {
    if (!open) {
      setSearch('');
      setStatus('ACTIVE');
      setPage(1);
      setDraft({ name: '', color: '' });
      setEditing(null);
    }
  }, [open, workspaceId]);

  const invalidateCatalog = async (tagId?: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: taskKeys.tagCatalogBase(workspaceId) }),
      tagId && taskTagIds.has(tagId)
        ? queryClient.invalidateQueries({ queryKey: taskKeys.tags(workspaceId, taskId) })
        : Promise.resolve(),
    ]);
  };

  const createMutation = useMutation({
    mutationFn: () =>
      createWorkspaceTag(workspaceId as string, {
        name: draft.name,
        ...(draft.color ? { color: draft.color.toUpperCase() } : {}),
      }),
    onSuccess: async () => {
      setDraft({ name: '', color: '' });
      await invalidateCatalog();
      toast.success(labels.tagCreated);
    },
    onError: (error) => toast.error(safeTagError(error, labels)),
  });
  const updateMutation = useMutation({
    mutationFn: (tag: WorkspaceTagSummary) =>
      updateWorkspaceTag(workspaceId as string, tag.id, {
        name: draft.name,
        color: draft.color ? draft.color.toUpperCase() : null,
      }),
    onSuccess: async (tag) => {
      setEditing(null);
      setDraft({ name: '', color: '' });
      await invalidateCatalog(tag.id);
      toast.success(labels.tagUpdated);
    },
    onError: (error) => toast.error(safeTagError(error, labels)),
  });
  const archiveMutation = useMutation({
    mutationFn: (tag: WorkspaceTagSummary) => archiveWorkspaceTag(workspaceId as string, tag.id),
    onSuccess: async (tag) => {
      await invalidateCatalog(tag.id);
      toast.success(labels.tagArchived);
    },
    onError: (error) => toast.error(safeTagError(error, labels)),
  });
  const reactivateMutation = useMutation({
    mutationFn: (tag: WorkspaceTagSummary) => reactivateWorkspaceTag(workspaceId as string, tag.id),
    onSuccess: async (tag) => {
      await invalidateCatalog(tag.id);
      toast.success(labels.tagReactivated);
    },
    onError: (error) => toast.error(safeTagError(error, labels)),
  });

  const colorValid = !draft.color || hexColorPattern.test(draft.color);
  const nameValid = draft.name.trim().length > 0 && draft.name.trim().length <= 80;
  const noEditChange =
    editing &&
    editing.name === draft.name.trim() &&
    (editing.color ?? '') === (draft.color ? draft.color.toUpperCase() : '');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{labels.manageTags}</DialogTitle>
          <DialogDescription>{labels.manageTagsDescription}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {canCreate || (canUpdate && editing) ? (
            <div className="grid gap-3 rounded-md border border-[hsl(var(--border))] p-3">
              <h4 className="text-sm font-semibold">
                {editing ? labels.editTag : labels.createTag}
              </h4>
              <div className="grid gap-3 sm:grid-cols-[1fr_9rem_auto] sm:items-end">
                <Input
                  label={labels.tagName}
                  value={draft.name}
                  maxLength={80}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, name: event.target.value }))
                  }
                />
                <Input
                  label={labels.tagColor}
                  value={draft.color}
                  placeholder="#2563EB"
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, color: event.target.value }))
                  }
                />
                <Button
                  type="button"
                  disabled={
                    !nameValid ||
                    !colorValid ||
                    Boolean(noEditChange) ||
                    createMutation.isPending ||
                    updateMutation.isPending
                  }
                  onClick={() => {
                    if (editing) updateMutation.mutate(editing);
                    else createMutation.mutate();
                  }}
                >
                  <Check aria-hidden="true" className="h-4 w-4" />
                  {editing ? labels.save : labels.createTag}
                </Button>
              </div>
              {!colorValid ? (
                <p className="text-sm text-[hsl(var(--destructive))]">{labels.invalidColor}</p>
              ) : null}
              {editing ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setEditing(null);
                    setDraft({ name: '', color: '' });
                  }}
                >
                  {labels.cancel}
                </Button>
              ) : null}
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
            <Input
              label={labels.searchTags}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={labels.searchTags}
            />
            <Select
              value={status}
              onValueChange={(value) => setStatus(value as WorkspaceTagStatus | 'ALL')}
            >
              <SelectTrigger label={labels.filterByTagStatus}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ACTIVE">{labels.active}</SelectItem>
                <SelectItem value="ARCHIVED">{labels.archived}</SelectItem>
                <SelectItem value="ALL">{labels.allTags}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {catalogQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : catalogQuery.data?.items.length ? (
            <div className="grid gap-2">
              {catalogQuery.data.items.map((tag) => (
                <div
                  key={tag.id}
                  className="grid gap-3 rounded-md border border-[hsl(var(--border))] p-3 sm:grid-cols-[1fr_auto] sm:items-center"
                >
                  <TagLabel tag={tag} labels={labels} />
                  <div className="flex flex-wrap gap-2">
                    {canUpdate ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        aria-label={`${labels.editTag}: ${tag.name}`}
                        onClick={() => {
                          setEditing(tag);
                          setDraft({ name: tag.name, color: tag.color ?? '' });
                        }}
                      >
                        <Pencil aria-hidden="true" className="h-4 w-4" />
                        {labels.editTag}
                      </Button>
                    ) : null}
                    {canArchive && tag.status === 'ACTIVE' ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        aria-label={`${labels.archive}: ${tag.name}`}
                        disabled={archiveMutation.isPending}
                        onClick={() => {
                          if (window.confirm(labels.archiveConfirmation))
                            archiveMutation.mutate(tag);
                        }}
                      >
                        <Archive aria-hidden="true" className="h-4 w-4" />
                        {labels.archive}
                      </Button>
                    ) : null}
                    {canArchive && tag.status === 'ARCHIVED' ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        aria-label={`${labels.reactivate}: ${tag.name}`}
                        disabled={reactivateMutation.isPending}
                        onClick={() => reactivateMutation.mutate(tag)}
                      >
                        <RotateCcw aria-hidden="true" className="h-4 w-4" />
                        {labels.reactivate}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
              <TagCatalogPagination
                labels={labels}
                page={catalogQuery.data.page}
                pageSize={catalogQuery.data.pageSize}
                total={catalogQuery.data.total}
                onPage={setPage}
              />
            </div>
          ) : (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">{labels.noTagsFound}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TagChip({
  tag,
  labels,
  removable,
  disabled,
  onRemove,
}: {
  tag: WorkspaceTagSummary;
  labels: TaskTagLabels;
  removable?: boolean;
  disabled?: boolean;
  onRemove?: () => void;
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2.5 py-1 text-xs font-semibold">
      <ColorDot color={tag.color} />
      <span className="truncate">{tag.name}</span>
      {tag.status === 'ARCHIVED' ? <Badge variant="neutral">{labels.archived}</Badge> : null}
      {removable && onRemove ? (
        <button
          type="button"
          className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={labels.removeTagFromTask.replace('{name}', tag.name)}
          disabled={disabled}
          onClick={onRemove}
        >
          <X aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </span>
  );
}

function TagLabel({ tag, labels }: { tag: WorkspaceTagSummary; labels: TaskTagLabels }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <ColorDot color={tag.color} />
      <span className="truncate font-semibold">{tag.name}</span>
      {tag.status === 'ARCHIVED' ? <Badge variant="neutral">{labels.archived}</Badge> : null}
    </span>
  );
}

function ColorDot({ color }: { color: string | null }) {
  const safeColor = color && hexColorPattern.test(color) ? color : neutralColor;
  return (
    <span
      aria-hidden="true"
      className="h-3 w-3 shrink-0 rounded-full border border-[hsl(var(--border))]"
      style={{ backgroundColor: safeColor }}
    />
  );
}

function TagCatalogPagination({
  labels,
  page,
  pageSize,
  total,
  onPage,
}: {
  labels: TaskTagLabels;
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageCount <= 1) return null;
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <span className="text-sm text-[hsl(var(--muted-foreground))]">
        {labels.page} {page} / {pageCount}
      </span>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        {labels.previous}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={page >= pageCount}
        onClick={() => onPage(page + 1)}
      >
        {labels.next}
      </Button>
    </div>
  );
}

async function removeTaskTag(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string | null,
  taskId: string,
  tagId: string,
  labels: TaskTagLabels,
) {
  if (!workspaceId) return;
  try {
    const result = await removeTaskTags(workspaceId, taskId, [tagId]);
    await queryClient.invalidateQueries({ queryKey: taskKeys.tags(workspaceId, taskId) });
    toast.success(
      tagMutationMessage(result, labels.tagRemoved, labels.tagRemoveNoop, labels.noTagsRemoved),
    );
  } catch (error) {
    toast.error(safeTagError(error, labels));
  }
}

function tagMutationMessage(
  result: TaskTagMutationResult,
  changedTemplate: string,
  unchangedTemplate: string,
  zeroChangedMessage: string,
) {
  if (result.changedCount === 0) {
    return zeroChangedMessage;
  }
  const base = changedTemplate.replace('{count}', String(result.changedCount));
  return result.unchangedCount > 0
    ? `${base} ${unchangedTemplate.replace('{count}', String(result.unchangedCount))}`
    : base;
}

function safeTagError(error: unknown, labels: TaskTagLabels) {
  const status =
    typeof error === 'object' && error && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : undefined;
  const message = error instanceof Error ? error.message : '';
  if (status === 401 || status === 403) return labels.permissionDenied;
  if (status === 404) return labels.staleTag;
  if (status === 409) return labels.tagConflict;
  if (status === 400 || status === 422) {
    if (/archived/i.test(message)) return labels.archivedTagCannotBeAssigned;
    if (/color/i.test(message)) return labels.invalidColor;
    if (/already exists|duplicate/i.test(message)) return labels.duplicateTag;
    return labels.tagInvalid;
  }
  if (error instanceof TypeError) return labels.networkError;
  return labels.tagActionFailed;
}

function hasPermission(permissions: Set<string>, permission: string) {
  return permissions.has('*') || permissions.has(permission);
}

function useSelectedWorkspace(workspaceId: string | null) {
  return useSessionStore((state) =>
    state.agencies
      .flatMap((agency) => agency.workspaces)
      .find((workspace) => workspace.id === workspaceId),
  );
}

function useDebouncedValue(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export type TaskTagLabels = Record<
  | 'tags'
  | 'tagsDescription'
  | 'addTags'
  | 'manageTags'
  | 'loadingTags'
  | 'tagsLoadFailed'
  | 'networkError'
  | 'retry'
  | 'noTags'
  | 'addTagsDescription'
  | 'searchTags'
  | 'tagSearchResults'
  | 'alreadyAdded'
  | 'selected'
  | 'noTagsFound'
  | 'selectedTags'
  | 'applying'
  | 'manageTagsDescription'
  | 'createTag'
  | 'editTag'
  | 'tagName'
  | 'tagColor'
  | 'save'
  | 'cancel'
  | 'invalidColor'
  | 'filterByTagStatus'
  | 'active'
  | 'archived'
  | 'allTags'
  | 'archive'
  | 'reactivate'
  | 'archiveConfirmation'
  | 'tagCreated'
  | 'tagUpdated'
  | 'tagArchived'
  | 'tagReactivated'
  | 'page'
  | 'previous'
  | 'next'
  | 'removeTagFromTask'
  | 'tagsAdded'
  | 'tagsAlreadyAssigned'
  | 'noTagsAdded'
  | 'tagRemoved'
  | 'tagRemoveNoop'
  | 'noTagsRemoved'
  | 'selectionLimit'
  | 'permissionDenied'
  | 'staleTag'
  | 'tagConflict'
  | 'archivedTagCannotBeAssigned'
  | 'duplicateTag'
  | 'tagInvalid'
  | 'tagActionFailed',
  string
>;
