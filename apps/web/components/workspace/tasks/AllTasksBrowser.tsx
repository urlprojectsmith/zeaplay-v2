'use client';

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  Pagination,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
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
  ArrowUpDown,
  BarChart3,
  CalendarDays,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CornerDownRight,
  MoreHorizontal,
  Filter,
  GripVertical,
  Grid2X2,
  KanbanSquare,
  List,
  MoveRight,
  Plus,
  Rows3,
  Settings2,
  Trash2,
  X,
} from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { useLanguage } from '../../../contexts/language-provider';
import {
  listDepartments,
  listWorkspaceUsers,
  type Department,
  type WorkspaceUser,
} from '../../../services/workspace-management';
import { listWorkspaceStatuses } from '../../../services/workspace-statuses';
import {
  addWorkspaceTaskBlockedBy,
  addWorkspaceTaskRelated,
  bulkAddTaskAssignees,
  bulkDeleteTasks,
  bulkRemoveTaskAssignees,
  bulkUpdateTaskPriority,
  bulkUpdateTaskStatus,
  completeTaskAttachmentUpload,
  createWorkspaceSubtask,
  decideTaskCompletion,
  endTaskRecurrence,
  getTaskCalendar,
  getTaskGantt,
  getTaskCompletionPolicy,
  getTaskKanbanSettings,
  getWorkspaceTask,
  initTaskAttachmentUpload,
  listTaskCompletionApprovals,
  listTaskCompletionSubmissions,
  listTaskRecurrenceSeries,
  listWorkspaceTaskBlockedBy,
  listWorkspaceTaskBlocks,
  listWorkspaceTaskRelated,
  listWorkspaceSubtasks,
  listWorkspaceProjects,
  listWorkspaceTasks,
  listWorkspaceTags,
  makeWorkspaceTaskRecurring,
  moveWorkspaceTaskKanban,
  pauseTaskRecurrence,
  resumeTaskRecurrence,
  normalizeTaskListParams,
  removeWorkspaceTaskBlockedBy,
  removeWorkspaceTaskRelated,
  saveTaskAsTemplate,
  submitTaskCompletion,
  taskCreationKeys,
  taskDueAtFromLocalDate,
  taskDueBoundaryFromLocalDate,
  taskKeys,
  updateTaskKanbanColumnSetting,
  updateTaskCompletionPolicy,
  updateWorkspaceTask,
  updateWorkspaceTaskParent,
  updateTaskSchedule,
  type CreateTaskPayload,
  type NormalizedTaskListParams,
  type TaskRecurrenceCustomUnit,
  type TaskRecurrenceEditScope,
  type TaskRecurrenceEndMode,
  type TaskRecurrenceFrequency,
  type TaskRecurrenceSeries,
  type TaskPriority,
  type TaskCompletionPolicy,
  type TaskCompletionProofRequirementMode,
  type TaskCompletionProofType,
  type TaskAttachmentSummary,
  type TaskRelationshipResult,
  type TaskSortBy,
  type TaskSortDirection,
  type TaskKanbanColumn,
  type WorkspaceProject,
  type WorkspaceTagSummary,
  type WorkspaceTask,
  type WorkspaceTaskRelationship,
} from '../../../services/workspace-tasks';
import { useSessionStore } from '../../../stores/session';
import { TaskCommentsPanel } from './comments/TaskCommentsPanel';
import { TaskTagsSection } from './tags/TaskTagsSection';
import { TaskAttachmentsSection } from './attachments/TaskAttachmentsSection';

const priorities = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
const pageSizes = [10, 25, 50] as const;
const sortFields = ['createdAt', 'updatedAt', 'dueAt', 'title'] as const;
const noneValue = '__none__';
const recurrenceOptions = ['DAILY', 'WEEKDAYS', 'WEEKLY', 'MONTHLY', 'CUSTOM'] as const;
const recurrenceEndModes = ['NEVER', 'ON_DATE', 'AFTER_COUNT'] as const;
const customRecurrenceUnits = ['DAY', 'WEEK', 'MONTH'] as const;
const editScopes = ['THIS_OCCURRENCE', 'THIS_AND_FUTURE', 'ENTIRE_SERIES'] as const;
const viewPreferenceKey = 'zea-play-all-tasks-view';
const tenantFilterParams = ['status', 'assignee', 'department', 'project', 'createdBy', 'tagId'];
const genericFilterParams = ['priority', 'dueFrom', 'dueTo'];
const maxCompletionProofFileBytes = 25 * 1024 * 1024;
const largeCompletionProofFileBytes = 2 * 1024 * 1024;

export function toggleRelationshipSelection(
  current: WorkspaceTaskRelationship[],
  candidate: WorkspaceTaskRelationship,
  maxSelected = 100,
) {
  if (current.some((item) => item.id === candidate.id)) {
    return current.filter((item) => item.id !== candidate.id);
  }
  if (current.length >= maxSelected) return current;
  return [...current, candidate];
}

export function AllTasksBrowser({ workspaceId }: { workspaceId: string | null }) {
  const { locale, t } = useLanguage();
  const labels = allTaskLabels(locale, t);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const accessToken = useSessionStore((state) => state.accessToken);
  const searchParamString = searchParams.toString();
  const previousWorkspaceId = useRef(workspaceId);
  const [searchInput, setSearchInput] = useState(searchParams.get('search') ?? '');
  const debouncedSearch = useDebouncedValue(searchInput.trim(), 300);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<SelectedTask | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(() => new Set());
  const [bulkAction, setBulkAction] = useState<BulkAction | null>(null);
  const [bulkStatusId, setBulkStatusId] = useState('');
  const [bulkPriority, setBulkPriority] = useState<TaskPriority>('MEDIUM');
  const [bulkAssigneeSearch, setBulkAssigneeSearch] = useState('');
  const [bulkMembershipIds, setBulkMembershipIds] = useState<string[]>([]);
  const [assigneeSearch, setAssigneeSearch] = useState('');
  const [projectSearch, setProjectSearch] = useState('');
  const [tagSearch, setTagSearch] = useState('');
  const [preferredView, setPreferredView] = useState<TaskView>('list');
  const [preferenceReady, setPreferenceReady] = useState(false);
  const debouncedAssigneeSearch = useDebouncedValue(assigneeSearch.trim(), 300);
  const debouncedBulkAssigneeSearch = useDebouncedValue(bulkAssigneeSearch.trim(), 300);
  const debouncedProjectSearch = useDebouncedValue(projectSearch.trim(), 300);
  const debouncedTagSearch = useDebouncedValue(tagSearch.trim(), 300);

  const urlState = useMemo(() => readTaskUrlState(searchParams), [searchParamString]);
  const activeView = urlState.view ?? (preferenceReady ? preferredView : 'list');
  const listParams = useMemo(
    () =>
      normalizeTaskListParams({
        page: urlState.page,
        pageSize: urlState.pageSize,
        search: urlState.search,
        sortBy: urlState.sortBy,
        sortDirection: urlState.sortDirection,
        statusDefinitionId: urlState.status,
        priority: urlState.priority,
        assigneeMembershipId: urlState.assignee,
        departmentId: urlState.department,
        projectId: urlState.project,
        tagId: urlState.tagId,
        dueFrom: urlState.dueFrom
          ? taskDueBoundaryFromLocalDate(urlState.dueFrom, 'start')
          : undefined,
        dueTo: urlState.dueTo ? taskDueBoundaryFromLocalDate(urlState.dueTo, 'end') : undefined,
      }),
    [
      urlState.assignee,
      urlState.department,
      urlState.dueFrom,
      urlState.dueTo,
      urlState.page,
      urlState.pageSize,
      urlState.priority,
      urlState.project,
      urlState.tagId,
      urlState.search,
      urlState.sortBy,
      urlState.sortDirection,
      urlState.status,
    ],
  );
  const kanbanBaseParams = useMemo(
    () =>
      normalizeTaskListParams({
        page: 1,
        pageSize: 25,
        search: urlState.search,
        sortBy: 'kanbanRank',
        sortDirection: 'asc',
        priority: urlState.priority,
        assigneeMembershipId: urlState.assignee,
        departmentId: urlState.department,
        projectId: urlState.project,
        tagId: urlState.tagId,
        dueFrom: urlState.dueFrom
          ? taskDueBoundaryFromLocalDate(urlState.dueFrom, 'start')
          : undefined,
        dueTo: urlState.dueTo ? taskDueBoundaryFromLocalDate(urlState.dueTo, 'end') : undefined,
      }),
    [
      urlState.assignee,
      urlState.department,
      urlState.dueFrom,
      urlState.dueTo,
      urlState.priority,
      urlState.project,
      urlState.tagId,
      urlState.search,
    ],
  );

  const tasksQuery = useQuery({
    queryKey: taskKeys.list(workspaceId, listParams),
    queryFn: () => listWorkspaceTasks(workspaceId as string, listParams),
    enabled: Boolean(workspaceId && ['list', 'grid', 'compact'].includes(activeView)),
  });

  const statusesQuery = useQuery({
    queryKey: taskCreationKeys.statuses(workspaceId),
    queryFn: () => listWorkspaceStatuses(workspaceId as string, 'TASK', 'ACTIVE'),
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
  });

  const departmentsQuery = useQuery({
    queryKey: taskCreationKeys.departments(workspaceId),
    queryFn: () => listDepartments({ workspaceId: workspaceId as string, pageSize: 100 }),
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
  });

  const assigneesQuery = useQuery({
    queryKey: taskCreationKeys.users(workspaceId, debouncedAssigneeSearch),
    queryFn: () =>
      listWorkspaceUsers({
        workspaceId: workspaceId as string,
        page: 1,
        pageSize: 10,
        search: debouncedAssigneeSearch.length >= 2 ? debouncedAssigneeSearch : undefined,
      }),
    enabled: Boolean(workspaceId),
  });

  const projectsQuery = useQuery({
    queryKey: taskCreationKeys.projects(workspaceId, debouncedProjectSearch),
    queryFn: () =>
      listWorkspaceProjects({
        workspaceId: workspaceId as string,
        page: 1,
        pageSize: 10,
        search: debouncedProjectSearch.length >= 2 ? debouncedProjectSearch : undefined,
      }),
    enabled: Boolean(workspaceId),
  });

  const tagsQuery = useQuery({
    queryKey: taskKeys.tagCatalog(workspaceId, {
      page: 1,
      pageSize: 10,
      search: debouncedTagSearch,
      sortBy: 'name',
      sortDirection: 'asc',
    }),
    queryFn: () =>
      listWorkspaceTags(workspaceId as string, {
        page: 1,
        pageSize: 10,
        search: debouncedTagSearch.length >= 2 ? debouncedTagSearch : undefined,
        sortBy: 'name',
        sortDirection: 'asc',
      }),
    enabled: Boolean(
      workspaceId && (filterOpen || urlState.tagId || debouncedTagSearch.length >= 2),
    ),
  });

  const bulkAssigneesQuery = useQuery({
    queryKey: taskCreationKeys.users(workspaceId, `bulk:${debouncedBulkAssigneeSearch}`),
    queryFn: () =>
      listWorkspaceUsers({
        workspaceId: workspaceId as string,
        page: 1,
        pageSize: 10,
        search: debouncedBulkAssigneeSearch.length >= 2 ? debouncedBulkAssigneeSearch : undefined,
      }),
    enabled: Boolean(
      workspaceId && (bulkAction === 'addAssignees' || bulkAction === 'removeAssignees'),
    ),
  });

  const bulkMutation = useMutation({
    mutationFn: async () => {
      if (!workspaceId) throw new Error(labels.noWorkspace);
      const taskIds = Array.from(selectedTaskIds);
      if (taskIds.length === 0) throw new Error(labels.noTasksSelected);
      if (taskIds.length > 100) throw new Error(labels.tooManySelected);
      if (bulkAction === 'status') {
        if (!bulkStatusId) throw new Error(labels.selectStatus);
        return bulkUpdateTaskStatus(workspaceId, { taskIds, statusDefinitionId: bulkStatusId });
      }
      if (bulkAction === 'priority') {
        return bulkUpdateTaskPriority(workspaceId, { taskIds, priority: bulkPriority });
      }
      if (bulkAction === 'addAssignees') {
        if (bulkMembershipIds.length === 0) throw new Error(labels.selectAssignees);
        return bulkAddTaskAssignees(workspaceId, { taskIds, membershipIds: bulkMembershipIds });
      }
      if (bulkAction === 'removeAssignees') {
        if (bulkMembershipIds.length === 0) throw new Error(labels.selectAssignees);
        return bulkRemoveTaskAssignees(workspaceId, { taskIds, membershipIds: bulkMembershipIds });
      }
      if (bulkAction === 'delete') {
        return bulkDeleteTasks(workspaceId, { taskIds });
      }
      throw new Error(labels.bulkActionFailed);
    },
    onSuccess: (result) => {
      const deletedIds = Array.from(selectedTaskIds);
      toast.success(successMessage(labels, bulkAction, result));
      if (workspaceId) {
        void queryClient.invalidateQueries({ queryKey: taskKeys.all(workspaceId) });
      }
      if (bulkAction === 'delete' && selectedTaskId && deletedIds.includes(selectedTaskId)) {
        setSelectedTask(null);
      }
      clearBulkState();
    },
    onError: (error) => {
      toast.error(safeBulkError(error, labels));
    },
  });

  useEffect(() => {
    setSearchInput(searchParams.get('search') ?? '');
  }, [searchParamString, searchParams]);

  useEffect(() => {
    const stored = window.localStorage.getItem(viewPreferenceKey);
    if (isTaskView(stored)) setPreferredView(stored);
    setPreferenceReady(true);
  }, []);

  useEffect(() => {
    const current = searchParams.get('search') ?? '';
    if (debouncedSearch !== current) {
      clearBulkState();
      setUrlState(router, pathname, searchParams, { search: debouncedSearch || null, page: null });
    }
  }, [debouncedSearch, pathname, router, searchParams]);

  useEffect(() => {
    if (previousWorkspaceId.current === workspaceId) return;
    previousWorkspaceId.current = workspaceId;
    setSelectedTask(null);
    setAssigneeSearch('');
    setProjectSearch('');
    setTagSearch('');
    clearBulkState();
    const next = new URLSearchParams(searchParams.toString());
    let changed = false;
    for (const key of tenantFilterParams) {
      if (next.has(key)) {
        next.delete(key);
        changed = true;
      }
    }
    if (next.get('page') && next.get('page') !== '1') {
      next.set('page', '1');
      changed = true;
    }
    if (changed) replaceUrl(router, pathname, next);
  }, [pathname, router, searchParams, workspaceId]);

  const total = tasksQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / urlState.pageSize));
  const activeFilterCount = activeFilters(urlState).length;
  const hasSearchOrFilters = Boolean(urlState.search || activeFilterCount);
  const tasks = tasksQuery.data?.items ?? [];
  const selectedTaskId = selectedTask?.workspaceId === workspaceId ? selectedTask.taskId : null;
  const currentPageTaskIds = useMemo(() => tasks.map((task) => task.id), [tasks]);
  const currentPageSelectedCount = currentPageTaskIds.filter((id) =>
    selectedTaskIds.has(id),
  ).length;
  const allCurrentPageSelected = tasks.length > 0 && currentPageSelectedCount === tasks.length;
  const someCurrentPageSelected = currentPageSelectedCount > 0 && !allCurrentPageSelected;
  const selectionCount = selectedTaskIds.size;
  const datasetSignature = useMemo(
    () => JSON.stringify({ workspaceId, listParams }),
    [workspaceId, listParams],
  );

  useEffect(() => {
    if (!tasksQuery.isSuccess || total === 0 || urlState.page <= totalPages) return;
    clearBulkState();
    updateState({ page: totalPages });
  }, [tasksQuery.isSuccess, total, totalPages, urlState.page]);

  useEffect(() => {
    clearBulkState();
  }, [datasetSignature]);

  useEffect(() => {
    if (!accessToken) {
      setSelectedTask(null);
      clearBulkState();
    }
  }, [accessToken]);

  function updateState(patch: Record<string, string | number | null>) {
    if (isDatasetPatch(patch)) clearBulkState();
    setUrlState(router, pathname, searchParams, patch);
  }

  function clearFilters() {
    const patch: Record<string, null> = { page: null };
    for (const key of [...tenantFilterParams, ...genericFilterParams]) patch[key] = null;
    clearBulkState();
    setUrlState(router, pathname, searchParams, patch);
  }

  function clearSearchAndFilters() {
    const patch: Record<string, null> = { search: null, page: null };
    for (const key of [...tenantFilterParams, ...genericFilterParams]) patch[key] = null;
    setSearchInput('');
    setTagSearch('');
    clearBulkState();
    setUrlState(router, pathname, searchParams, patch);
  }

  function changeSort(sortBy: TaskSortBy) {
    const nextDirection: TaskSortDirection =
      urlState.sortBy === sortBy && urlState.sortDirection === 'asc' ? 'desc' : 'asc';
    updateState({ sortBy, sortDirection: nextDirection, page: null });
  }

  function changeView(view: TaskView) {
    setPreferredView(view);
    window.localStorage.setItem(viewPreferenceKey, view);
    const next = new URLSearchParams(searchParams.toString());
    next.set('view', view);
    replaceUrl(router, pathname, next);
  }

  function clearBulkState() {
    setSelectedTaskIds((current) => (current.size > 0 ? new Set() : current));
    if (bulkAction) setBulkAction(null);
    if (bulkStatusId) setBulkStatusId('');
    if (bulkPriority !== 'MEDIUM') setBulkPriority('MEDIUM');
    if (bulkAssigneeSearch) setBulkAssigneeSearch('');
    if (bulkMembershipIds.length > 0) setBulkMembershipIds([]);
  }

  function toggleTaskSelection(taskId: string, checked: boolean) {
    setSelectedTaskIds((current) => {
      const next = new Set(current);
      if (checked) next.add(taskId);
      else next.delete(taskId);
      return next;
    });
  }

  function toggleCurrentPageSelection() {
    setSelectedTaskIds((current) => {
      const next = new Set(current);
      if (allCurrentPageSelected) {
        for (const taskId of currentPageTaskIds) next.delete(taskId);
      } else {
        for (const taskId of currentPageTaskIds) next.add(taskId);
      }
      return next;
    });
  }

  function openBulkAction(action: BulkAction) {
    setBulkAction(action);
    setBulkStatusId('');
    setBulkPriority('MEDIUM');
    setBulkAssigneeSearch('');
    setBulkMembershipIds([]);
  }

  function submitBulkAction() {
    bulkMutation.mutate();
  }

  return (
    <section className="grid gap-4" aria-labelledby="all-tasks-heading">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 id="all-tasks-heading" className="text-xl font-semibold">
            {labels.allTasks}
          </h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {activeView === 'kanban'
              ? labels.kanban
              : activeView === 'calendar'
                ? labels.calendar
                : activeView === 'gantt'
                  ? labels.gantt
                  : `${total} ${labels.tasks}`}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Input
            label={labels.searchTasks}
            value={searchInput}
            onChange={(event) => {
              if (event.target.value !== searchInput) clearBulkState();
              setSearchInput(event.target.value);
            }}
            placeholder={labels.searchTasks}
          />
          <Button
            type="button"
            variant="secondary"
            className="md:hidden"
            onClick={() => setFilterOpen(true)}
          >
            <Filter aria-hidden="true" className="h-4 w-4" />
            {labels.filters}
            {activeFilterCount ? ` (${activeFilterCount})` : ''}
          </Button>
          <TaskViewSwitcher labels={labels} view={activeView} onViewChange={changeView} />
        </div>
      </div>

      <div className="hidden rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4 md:block">
        <TaskFilterControls
          labels={labels}
          state={urlState}
          statuses={statusesQuery.data ?? []}
          departments={departmentsQuery.data?.items ?? []}
          assignees={assigneesQuery.data?.items ?? []}
          projects={projectsQuery.data?.items ?? []}
          tags={tagsQuery.data?.items ?? []}
          assigneeSearch={assigneeSearch}
          projectSearch={projectSearch}
          tagSearch={tagSearch}
          onAssigneeSearch={setAssigneeSearch}
          onProjectSearch={setProjectSearch}
          onTagSearch={setTagSearch}
          onChange={updateState}
          onClearFilters={clearFilters}
          activeFilterCount={activeFilterCount}
        />
      </div>

      <Dialog open={filterOpen} onOpenChange={setFilterOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {labels.filters}
              {activeFilterCount ? ` (${activeFilterCount})` : ''}
            </DialogTitle>
            <DialogDescription>{labels.filterDescription}</DialogDescription>
          </DialogHeader>
          <TaskFilterControls
            labels={labels}
            state={urlState}
            statuses={statusesQuery.data ?? []}
            departments={departmentsQuery.data?.items ?? []}
            assignees={assigneesQuery.data?.items ?? []}
            projects={projectsQuery.data?.items ?? []}
            tags={tagsQuery.data?.items ?? []}
            assigneeSearch={assigneeSearch}
            projectSearch={projectSearch}
            tagSearch={tagSearch}
            onAssigneeSearch={setAssigneeSearch}
            onProjectSearch={setProjectSearch}
            onTagSearch={setTagSearch}
            onChange={updateState}
            onClearFilters={clearFilters}
            activeFilterCount={activeFilterCount}
          />
        </DialogContent>
      </Dialog>

      <ActiveFilterChips
        labels={labels}
        state={urlState}
        statuses={statusesQuery.data ?? []}
        departments={departmentsQuery.data?.items ?? []}
        assignees={assigneesQuery.data?.items ?? []}
        projects={projectsQuery.data?.items ?? []}
        tags={tagsQuery.data?.items ?? []}
        onRemove={(key) => updateState({ [key]: null, page: null })}
        onClear={clearFilters}
      />

      {['list', 'grid', 'compact'].includes(activeView) && tasks.length > 0 ? (
        <div className="flex flex-col gap-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-3 md:flex-row md:items-center md:justify-between">
          <Checkbox
            label={allCurrentPageSelected ? labels.deselectCurrentPage : labels.selectCurrentPage}
            checked={
              allCurrentPageSelected ? true : someCurrentPageSelected ? 'indeterminate' : false
            }
            onCheckedChange={toggleCurrentPageSelection}
            aria-label={labels.selectCurrentPage}
          />
          <span className="text-sm font-semibold text-[hsl(var(--muted-foreground))]">
            {selectedCountLabel(selectionCount, labels)}
          </span>
        </div>
      ) : null}

      {selectionCount > 0 ? (
        <BulkActionToolbar
          labels={labels}
          selectedCount={selectionCount}
          loading={bulkMutation.isPending}
          onAction={openBulkAction}
          onClear={clearBulkState}
        />
      ) : null}

      <Card>
        <CardContent className="p-0">
          {activeView === 'calendar' ? (
            <TaskCalendarView
              workspaceId={workspaceId}
              labels={labels}
              filters={listParams}
              onOpenDetail={(taskId) =>
                workspaceId ? setSelectedTask({ workspaceId, taskId }) : setSelectedTask(null)
              }
            />
          ) : activeView === 'gantt' ? (
            <TaskGanttView
              workspaceId={workspaceId}
              labels={labels}
              filters={listParams}
              onOpenDetail={(taskId) =>
                workspaceId ? setSelectedTask({ workspaceId, taskId }) : setSelectedTask(null)
              }
            />
          ) : activeView === 'kanban' ? (
            <TaskKanbanBoard
              workspaceId={workspaceId}
              labels={labels}
              filters={kanbanBaseParams}
              hasSearchOrFilters={hasSearchOrFilters}
              onOpenDetail={(taskId) =>
                workspaceId ? setSelectedTask({ workspaceId, taskId }) : setSelectedTask(null)
              }
            />
          ) : tasksQuery.isLoading ? (
            <TaskResultsSkeleton view={activeView} />
          ) : tasksQuery.isError ? (
            <div className="p-6">
              <EmptyState
                title={labels.errorTitle}
                description={safeTaskError(tasksQuery.error, labels)}
              />
            </div>
          ) : tasks.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title={hasSearchOrFilters ? labels.noMatchingTasks : labels.noTasks}
                description={
                  hasSearchOrFilters ? labels.noMatchingTasksDescription : labels.noTasksDescription
                }
                action={
                  hasSearchOrFilters ? (
                    <Button type="button" variant="secondary" onClick={clearSearchAndFilters}>
                      <X aria-hidden="true" className="h-4 w-4" />
                      {labels.clearFiltersSearch}
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <TaskResults
              labels={labels}
              tasks={tasks}
              view={activeView}
              sortBy={urlState.sortBy}
              sortDirection={urlState.sortDirection}
              selectedTaskIds={selectedTaskIds}
              onSort={changeSort}
              onToggleSelection={toggleTaskSelection}
              onOpenDetail={(taskId) =>
                workspaceId ? setSelectedTask({ workspaceId, taskId }) : setSelectedTask(null)
              }
            />
          )}
        </CardContent>
      </Card>

      {['kanban', 'calendar', 'gantt'].includes(activeView) ? null : (
        <TaskPagination
          labels={labels}
          page={urlState.page}
          pageSize={urlState.pageSize}
          total={total}
          totalPages={totalPages}
          onPage={(page) => updateState({ page })}
          onPageSize={(pageSize) => updateState({ pageSize, page: null })}
        />
      )}

      <TaskDetailDialog
        labels={labels}
        workspaceId={workspaceId}
        taskId={selectedTaskId}
        onSelectTask={(taskId) =>
          workspaceId ? setSelectedTask({ workspaceId, taskId }) : setSelectedTask(null)
        }
        onOpenChange={(open) => {
          if (!open) setSelectedTask(null);
        }}
      />

      <BulkActionDialog
        labels={labels}
        action={bulkAction}
        selectedCount={selectionCount}
        statuses={statusesQuery.data ?? []}
        users={bulkAssigneesQuery.data?.items ?? []}
        assigneeSearch={bulkAssigneeSearch}
        selectedMembershipIds={bulkMembershipIds}
        selectedStatusId={bulkStatusId}
        selectedPriority={bulkPriority}
        loading={bulkMutation.isPending}
        onAssigneeSearch={setBulkAssigneeSearch}
        onMembershipToggle={(membershipId) =>
          setBulkMembershipIds((current) =>
            current.includes(membershipId)
              ? current.filter((id) => id !== membershipId)
              : [...current, membershipId],
          )
        }
        onStatusChange={setBulkStatusId}
        onPriorityChange={setBulkPriority}
        onSubmit={submitBulkAction}
        onOpenChange={(open) => {
          if (!open && !bulkMutation.isPending) setBulkAction(null);
        }}
      />
    </section>
  );
}

function BulkActionToolbar({
  labels,
  selectedCount,
  loading,
  onAction,
  onClear,
}: {
  labels: AllTaskLabels;
  selectedCount: number;
  loading: boolean;
  onAction: (action: BulkAction) => void;
  onClear: () => void;
}) {
  const actions = [
    { id: 'status' as const, label: labels.changeStatus },
    { id: 'priority' as const, label: labels.changePriority },
    { id: 'addAssignees' as const, label: labels.addAssignees },
    { id: 'removeAssignees' as const, label: labels.removeAssignees },
  ];
  return (
    <div
      className="sticky top-2 z-10 flex flex-col gap-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-elevated))] p-3 shadow-sm md:flex-row md:items-center md:justify-between"
      aria-label={labels.bulkActions}
    >
      <div className="flex items-center gap-2 text-sm font-semibold">
        <CheckSquare aria-hidden="true" className="h-4 w-4" />
        {selectedCountLabel(selectedCount, labels)}
      </div>
      <div className="hidden flex-wrap items-center gap-2 md:flex">
        {actions.map((action) => (
          <Button
            key={action.id}
            type="button"
            variant="secondary"
            disabled={loading}
            onClick={() => onAction(action.id)}
          >
            {action.label}
          </Button>
        ))}
        <Button
          type="button"
          variant="danger"
          disabled={loading}
          onClick={() => onAction('delete')}
        >
          <Trash2 aria-hidden="true" className="h-4 w-4" />
          {labels.deleteTasks}
        </Button>
        <Button type="button" variant="ghost" disabled={loading} onClick={onClear}>
          {labels.clearSelection}
        </Button>
      </div>
      <div className="flex items-center gap-2 md:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="secondary" disabled={loading}>
              <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
              {labels.bulkActions}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {actions.map((action) => (
              <DropdownMenuItem key={action.id} onSelect={() => onAction(action.id)}>
                {action.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-[hsl(var(--danger))]"
              onSelect={() => onAction('delete')}
            >
              {labels.deleteTasks}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button type="button" variant="ghost" disabled={loading} onClick={onClear}>
          {labels.clearSelection}
        </Button>
      </div>
    </div>
  );
}

function TaskViewSwitcher({
  labels,
  view,
  onViewChange,
}: {
  labels: AllTaskLabels;
  view: TaskView;
  onViewChange: (view: TaskView) => void;
}) {
  const options = [
    { value: 'list' as const, label: labels.viewList, icon: List },
    { value: 'grid' as const, label: labels.viewGrid, icon: Grid2X2 },
    { value: 'compact' as const, label: labels.viewCompact, icon: Rows3 },
    { value: 'kanban' as const, label: labels.kanban, icon: KanbanSquare },
    { value: 'calendar' as const, label: labels.calendar, icon: CalendarDays },
    { value: 'gantt' as const, label: labels.gantt, icon: BarChart3 },
  ];
  return (
    <div
      className="flex max-w-full flex-wrap rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-1"
      role="group"
      aria-label={labels.taskView}
    >
      {options.map((option) => {
        const Icon = option.icon;
        const selected = view === option.value;
        return (
          <button
            key={option.value}
            type="button"
            className={[
              'inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded px-2 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] sm:flex-none sm:px-3',
              selected
                ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
                : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--surface-muted))] hover:text-[hsl(var(--foreground))]',
            ].join(' ')}
            aria-pressed={selected}
            onClick={() => onViewChange(option.value)}
          >
            <Icon aria-hidden="true" className="h-4 w-4" />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function TaskFilterControls({
  labels,
  state,
  statuses,
  departments,
  assignees,
  projects,
  tags,
  assigneeSearch,
  projectSearch,
  tagSearch,
  onAssigneeSearch,
  onProjectSearch,
  onTagSearch,
  onChange,
  onClearFilters,
  activeFilterCount,
}: {
  labels: AllTaskLabels;
  state: TaskUrlState;
  statuses: { id: string; name: string }[];
  departments: Department[];
  assignees: WorkspaceUser[];
  projects: WorkspaceProject[];
  tags: WorkspaceTagSummary[];
  assigneeSearch: string;
  projectSearch: string;
  tagSearch: string;
  onAssigneeSearch: (value: string) => void;
  onProjectSearch: (value: string) => void;
  onTagSearch: (value: string) => void;
  onChange: (patch: Record<string, string | number | null>) => void;
  onClearFilters: () => void;
  activeFilterCount: number;
}) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 lg:grid-cols-4">
        <Select
          value={state.status || noneValue}
          onValueChange={(value) =>
            onChange({ status: value === noneValue ? null : value, page: null })
          }
        >
          <SelectTrigger label={labels.status}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={noneValue}>{labels.anyStatus}</SelectItem>
            {statuses.map((status) => (
              <SelectItem key={status.id} value={status.id}>
                {status.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={state.priority || noneValue}
          onValueChange={(value) =>
            onChange({ priority: value === noneValue ? null : value, page: null })
          }
        >
          <SelectTrigger label={labels.priority}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={noneValue}>{labels.anyPriority}</SelectItem>
            {priorities.map((priority) => (
              <SelectItem key={priority} value={priority}>
                {priorityLabel(priority, labels)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={state.department || noneValue}
          onValueChange={(value) =>
            onChange({ department: value === noneValue ? null : value, page: null })
          }
        >
          <SelectTrigger label={labels.department}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={noneValue}>{labels.anyDepartment}</SelectItem>
            {departments.map((department) => (
              <SelectItem key={department.id} value={department.id}>
                {department.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={`${state.sortBy}:${state.sortDirection}`}
          onValueChange={(value) => {
            const [sortBy, sortDirection] = value.split(':') as [TaskSortBy, TaskSortDirection];
            onChange({ sortBy, sortDirection, page: null });
          }}
        >
          <SelectTrigger label={labels.sort}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sortFields.flatMap((sortBy) =>
              (['asc', 'desc'] as const).map((sortDirection) => (
                <SelectItem key={`${sortBy}:${sortDirection}`} value={`${sortBy}:${sortDirection}`}>
                  {sortLabel(sortBy, labels)}{' '}
                  {sortDirection === 'asc' ? labels.ascending : labels.descending}
                </SelectItem>
              )),
            )}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-3 lg:grid-cols-4">
        <RelationFilter
          label={labels.assignee}
          searchLabel={labels.searchPeople}
          search={assigneeSearch}
          selectedId={state.assignee}
          items={assignees.map((user) => ({ id: user.membershipId, label: displayUser(user) }))}
          anyLabel={labels.anyAssignee}
          onSearch={onAssigneeSearch}
          onChange={(value) => onChange({ assignee: value, page: null })}
        />
        <RelationFilter
          label={labels.project}
          searchLabel={labels.searchProjects}
          search={projectSearch}
          selectedId={state.project}
          items={projects.map((project) => ({ id: project.id, label: project.name }))}
          anyLabel={labels.anyProject}
          onSearch={onProjectSearch}
          onChange={(value) => onChange({ project: value, page: null })}
        />
        <RelationFilter
          label={labels.filterByTag}
          searchLabel={labels.searchTags}
          search={tagSearch}
          selectedId={state.tagId}
          items={tags.map((tag) => ({
            id: tag.id,
            label: tag.status === 'ARCHIVED' ? `${tag.name} (${labels.archived})` : tag.name,
          }))}
          anyLabel={labels.anyTag}
          onSearch={onTagSearch}
          onChange={(value) => onChange({ tagId: value, page: null })}
        />
        <Input
          label={labels.dueFrom}
          type="date"
          value={state.dueFrom}
          onChange={(event) => onChange({ dueFrom: event.target.value || null, page: null })}
        />
        <Input
          label={labels.dueTo}
          type="date"
          value={state.dueTo}
          onChange={(event) => onChange({ dueTo: event.target.value || null, page: null })}
        />
      </div>
      <div className="flex justify-end">
        <Button
          type="button"
          variant="secondary"
          disabled={activeFilterCount === 0}
          onClick={onClearFilters}
        >
          <X aria-hidden="true" className="h-4 w-4" />
          {labels.clearFilters}
        </Button>
      </div>
    </div>
  );
}

function RelationFilter({
  label,
  searchLabel,
  search,
  selectedId,
  items,
  anyLabel,
  onSearch,
  onChange,
}: {
  label: string;
  searchLabel: string;
  search: string;
  selectedId: string;
  items: { id: string; label: string }[];
  anyLabel: string;
  onSearch: (value: string) => void;
  onChange: (value: string | null) => void;
}) {
  return (
    <div className="grid gap-2">
      <Input
        label={searchLabel}
        value={search}
        onChange={(event) => onSearch(event.target.value)}
        placeholder={searchLabel}
      />
      <Select
        value={selectedId || noneValue}
        onValueChange={(value) => onChange(value === noneValue ? null : value)}
      >
        <SelectTrigger aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={noneValue}>{anyLabel}</SelectItem>
          {items.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ActiveFilterChips({
  labels,
  state,
  statuses,
  departments,
  assignees,
  projects,
  tags,
  onRemove,
  onClear,
}: {
  labels: AllTaskLabels;
  state: TaskUrlState;
  statuses: { id: string; name: string }[];
  departments: Department[];
  assignees: WorkspaceUser[];
  projects: WorkspaceProject[];
  tags: WorkspaceTagSummary[];
  onRemove: (key: string) => void;
  onClear: () => void;
}) {
  const chips = activeFilters(state).map((key) => ({
    key,
    label: activeFilterLabel(key, state, labels, statuses, departments, assignees, projects, tags),
  }));
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label={labels.activeFilters}>
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex max-w-full items-center gap-1 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-2.5 py-1 text-xs font-semibold"
        >
          <span className="truncate">{chip.label}</span>
          <button
            type="button"
            className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
            onClick={() => onRemove(chip.key)}
            aria-label={`${labels.removeFilter} ${chip.label}`}
          >
            <X aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        </span>
      ))}
      <Button type="button" variant="ghost" onClick={onClear}>
        {labels.clearFilters}
      </Button>
    </div>
  );
}

function TaskCalendarView({
  workspaceId,
  labels,
  filters,
  onOpenDetail,
}: {
  workspaceId: string | null;
  labels: AllTaskLabels;
  filters: NormalizedTaskListParams;
  onOpenDetail: (taskId: string) => void;
}) {
  const [mode, setMode] = useState<'MONTH' | 'WEEK'>('MONTH');
  const [date, setDate] = useState(() => localInputDate(new Date()));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [dayDetailPage, setDayDetailPage] = useState(1);
  const params = {
    view: mode,
    date,
    search: filters.search,
    priority: filters.priority,
    assigneeMembershipId: filters.assigneeMembershipId,
    departmentId: filters.departmentId,
    projectId: filters.projectId,
    tagId: filters.tagId,
    page: 1,
    pageSize: 50,
  };
  const calendarQuery = useQuery({
    queryKey: taskKeys.calendar(workspaceId, params),
    queryFn: () => getTaskCalendar(workspaceId as string, params),
    enabled: Boolean(workspaceId),
  });
  const dayDetailParams = selectedDay
    ? {
        ...params,
        view: 'DAY' as const,
        date: selectedDay,
        page: dayDetailPage,
        pageSize: 20,
      }
    : null;
  const dayDetailQuery = useQuery({
    queryKey: taskKeys.calendar(workspaceId, dayDetailParams ?? { ...params, view: 'DAY', date }),
    queryFn: () => getTaskCalendar(workspaceId as string, dayDetailParams!),
    enabled: Boolean(workspaceId && dayDetailParams),
  });
  const days = calendarQuery.data?.days ?? [];
  const selectedDayTasks =
    dayDetailQuery.data?.days.find((day) => day.date === selectedDay)?.tasks ?? [];
  const dayDetailTotal = dayDetailQuery.data?.total ?? 0;
  const dayDetailPageSize = dayDetailQuery.data?.pageSize ?? 20;
  const dayDetailTotalPages = Math.max(1, Math.ceil(dayDetailTotal / dayDetailPageSize));
  useEffect(() => {
    setDayDetailPage(1);
  }, [
    selectedDay,
    filters.search,
    filters.priority,
    filters.assigneeMembershipId,
    filters.departmentId,
    filters.projectId,
    filters.tagId,
  ]);
  return (
    <div className="grid gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold">{labels.calendar}</h3>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {calendarQuery.data?.window.timezone ?? 'UTC'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={mode === 'MONTH' ? 'primary' : 'secondary'}
            onClick={() => setMode('MONTH')}
          >
            {labels.month}
          </Button>
          <Button
            variant={mode === 'WEEK' ? 'primary' : 'secondary'}
            onClick={() => setMode('WEEK')}
          >
            {labels.week}
          </Button>
          <Input
            label={labels.date}
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
          <Button variant="secondary" onClick={() => setDate(localInputDate(new Date()))}>
            {labels.today}
          </Button>
        </div>
      </div>
      {calendarQuery.isLoading ? (
        <TaskResultsSkeleton view="calendar" />
      ) : calendarQuery.isError ? (
        <EmptyState title={labels.unableToLoadTasks} description={labels.tryAgain} />
      ) : mode === 'MONTH' ? (
        <div className="grid min-w-[720px] grid-cols-7 gap-px overflow-x-auto rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--border))]">
          {days.map((day) => (
            <button
              key={day.date}
              type="button"
              className="min-h-32 bg-[hsl(var(--surface))] p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
              onClick={() => setSelectedDay(day.date)}
              aria-label={`${day.date}: ${day.total} ${labels.tasksDue}`}
            >
              <span className="block text-sm font-semibold">{day.date.slice(-2)}</span>
              <span className="mt-2 block text-sm">
                {day.total} {labels.tasksDue}
              </span>
              <span className="mt-1 block text-xs text-[hsl(var(--muted-foreground))]">
                {labels.overdue}: {day.overdue}
              </span>
              <span className="mt-1 block text-xs text-[hsl(var(--muted-foreground))]">
                H {day.priorityCounts.HIGH + day.priorityCounts.URGENT} / M{' '}
                {day.priorityCounts.MEDIUM} / L {day.priorityCounts.LOW}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-7">
          {days.map((day) => (
            <section key={day.date} className="rounded-md border border-[hsl(var(--border))] p-3">
              <h4 className="font-semibold">{day.date}</h4>
              <div className="mt-2 grid gap-2">
                {day.tasks.slice(0, 8).map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    className="rounded-md border border-[hsl(var(--border))] p-2 text-left text-sm"
                    onClick={() => onOpenDetail(task.id)}
                  >
                    <span className="block font-semibold">{task.title}</span>
                    <span className="block text-xs text-[hsl(var(--muted-foreground))]">
                      {task.status.name} / {task.priority} / {urgencyLabel(task.urgency, labels)}
                    </span>
                  </button>
                ))}
                {day.total > day.tasks.length ? (
                  <Button variant="secondary" onClick={() => setSelectedDay(day.date)}>
                    {labels.viewTasks}
                  </Button>
                ) : null}
              </div>
            </section>
          ))}
        </div>
      )}
      <Dialog open={Boolean(selectedDay)} onOpenChange={(open) => !open && setSelectedDay(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selectedDay}</DialogTitle>
            <DialogDescription>{labels.tasksDue}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {dayDetailQuery.isLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : selectedDayTasks.length ? (
              selectedDayTasks.map((task) => (
                <Button key={task.id} variant="secondary" onClick={() => onOpenDetail(task.id)}>
                  {task.title}
                </Button>
              ))
            ) : (
              <p className="text-sm text-[hsl(var(--muted-foreground))]">{labels.noTasks}</p>
            )}
          </div>
          {dayDetailTotalPages > 1 ? (
            <DialogFooter>
              <div className="flex w-full items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={dayDetailPage <= 1}
                  onClick={() => setDayDetailPage((page) => Math.max(1, page - 1))}
                >
                  {labels.previous}
                </Button>
                <span className="text-sm text-[hsl(var(--muted-foreground))]">
                  {labels.page} {dayDetailPage} / {dayDetailTotalPages}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={dayDetailPage >= dayDetailTotalPages}
                  onClick={() =>
                    setDayDetailPage((page) => Math.min(dayDetailTotalPages, page + 1))
                  }
                >
                  {labels.next}
                </Button>
              </div>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TaskGanttView({
  workspaceId,
  labels,
  filters,
  onOpenDetail,
}: {
  workspaceId: string | null;
  labels: AllTaskLabels;
  filters: NormalizedTaskListParams;
  onOpenDetail: (taskId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [from, setFrom] = useState(() => localInputDate(startOfMonth(new Date())));
  const [to, setTo] = useState(() => localInputDate(endOfMonth(new Date())));
  const [editing, setEditing] = useState<WorkspaceTask | null>(null);
  const params = {
    from,
    to,
    search: filters.search,
    priority: filters.priority,
    assigneeMembershipId: filters.assigneeMembershipId,
    departmentId: filters.departmentId,
    projectId: filters.projectId,
    tagId: filters.tagId,
    page: 1,
    pageSize: 50,
  };
  const ganttQuery = useQuery({
    queryKey: taskKeys.gantt(workspaceId, params),
    queryFn: () => getTaskGantt(workspaceId as string, params),
    enabled: Boolean(workspaceId && from && to),
  });
  const scheduleMutation = useMutation({
    mutationFn: (body: { taskId: string; plannedStartAt: string | null; dueAt: string | null }) =>
      updateTaskSchedule(workspaceId as string, body.taskId, {
        plannedStartAt: body.plannedStartAt,
        dueAt: body.dueAt,
      }),
    onSuccess: () => {
      toast.success(labels.updated);
      if (workspaceId) void queryClient.invalidateQueries({ queryKey: taskKeys.all(workspaceId) });
      setEditing(null);
    },
    onError: (error) => toast.error(safeTaskError(error, labels)),
  });
  const tasks = ganttQuery.data?.items ?? [];
  return (
    <div className="grid gap-4 overflow-x-auto p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold">{labels.gantt}</h3>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {labels.unscheduled}: {ganttQuery.data?.unscheduledCount ?? 0}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Input
            label={labels.startDate}
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
          <Input
            label={labels.endDate}
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>
      </div>
      {ganttQuery.isLoading ? (
        <TaskResultsSkeleton view="gantt" />
      ) : ganttQuery.isError ? (
        <EmptyState title={labels.unableToLoadTasks} description={labels.tryAgain} />
      ) : (
        <div className="min-w-[760px] rounded-md border border-[hsl(var(--border))]">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="grid grid-cols-[220px_1fr_auto] items-center gap-3 border-b border-[hsl(var(--border))] p-3 last:border-b-0"
            >
              <button className="text-left font-semibold" onClick={() => onOpenDetail(task.id)}>
                {task.title}
              </button>
              <div className="h-6 rounded bg-[hsl(var(--muted))]">
                <div
                  className="h-6 rounded bg-[hsl(var(--primary))]"
                  style={{ width: `${ganttWidth(task.plannedStartAt, task.dueAt, from, to)}%` }}
                  aria-label={`${task.title}, ${labels.plannedStart}: ${task.plannedStartAt}, ${labels.endDate}: ${task.dueAt}, ${task.status.name}`}
                />
              </div>
              <Button variant="secondary" onClick={() => setEditing(task)}>
                {labels.scheduleTask}
              </Button>
            </div>
          ))}
          {!tasks.length ? <EmptyState title={labels.noTasks} /> : null}
        </div>
      )}
      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{labels.scheduleTask}</DialogTitle>
            <DialogDescription>{editing?.title}</DialogDescription>
          </DialogHeader>
          {editing ? (
            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                scheduleMutation.mutate({
                  taskId: editing.id,
                  plannedStartAt: localDateToIso(form.get('plannedStartAt') as string),
                  dueAt: localDateToIso(form.get('dueAt') as string),
                });
              }}
            >
              <Input
                name="plannedStartAt"
                label={labels.startDate}
                type="date"
                defaultValue={editing.plannedStartAt?.slice(0, 10) ?? ''}
              />
              <Input
                name="dueAt"
                label={labels.endDate}
                type="date"
                defaultValue={editing.dueAt?.slice(0, 10) ?? ''}
              />
              <DialogFooter>
                <Button type="submit" disabled={scheduleMutation.isPending}>
                  {labels.save}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TaskKanbanBoard({
  workspaceId,
  labels,
  filters,
  hasSearchOrFilters,
  onOpenDetail,
}: {
  workspaceId: string | null;
  labels: AllTaskLabels;
  filters: NormalizedTaskListParams;
  hasSearchOrFilters: boolean;
  onOpenDetail: (taskId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [pageSizes, setPageSizes] = useState<Record<string, number>>({});
  const [editingColumn, setEditingColumn] = useState<TaskKanbanColumn | null>(null);
  const [completionRequest, setCompletionRequest] = useState<{
    taskId: string;
    statusDefinitionId: string;
  } | null>(null);
  const [wipInput, setWipInput] = useState('');
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const settingsQuery = useQuery({
    queryKey: taskKeys.kanbanSettings(workspaceId),
    queryFn: () => getTaskKanbanSettings(workspaceId as string),
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
  });

  useEffect(() => {
    setPageSizes({});
    setEditingColumn(null);
    setCompletionRequest(null);
    setWipInput('');
  }, [workspaceId]);

  const columns = settingsQuery.data?.columns ?? [];
  const columnQueries = useQueries({
    queries: columns.map((column) => {
      const params = {
        ...filters,
        page: 1,
        pageSize: pageSizes[column.status.id] ?? 25,
        statusDefinitionId: column.status.id,
      };
      return {
        queryKey: taskKeys.kanbanColumn(workspaceId, column.status.id, params),
        queryFn: () => listWorkspaceTasks(workspaceId as string, params),
        enabled: Boolean(workspaceId),
      };
    }),
  });
  const taskById = useMemo(() => {
    const map = new Map<string, WorkspaceTask>();
    columnQueries.forEach((query) => {
      query.data?.items.forEach((task) => map.set(task.id, task));
    });
    return map;
  }, [columnQueries]);
  const moveMutation = useMutation({
    mutationFn: ({
      taskId,
      statusDefinitionId,
      beforeTaskId,
      afterTaskId,
    }: {
      taskId: string;
      statusDefinitionId: string;
      beforeTaskId?: string | null;
      afterTaskId?: string | null;
    }) =>
      moveWorkspaceTaskKanban(workspaceId as string, taskId, {
        statusDefinitionId,
        beforeTaskId,
        afterTaskId,
      }),
    onSuccess: () => {
      toast.success(labels.taskMoved);
      if (workspaceId) {
        void queryClient.invalidateQueries({ queryKey: taskKeys.kanbanColumns(workspaceId) });
      }
    },
    onError: (error) => {
      if (isCompletionFlowRequired(error)) {
        const details = completionFlowDetails(error);
        if (details?.taskId && details.requestedTerminalStatusDefinitionId) {
          setCompletionRequest({
            taskId: details.taskId,
            statusDefinitionId: details.requestedTerminalStatusDefinitionId,
          });
          toast.info(labels.completionRequired);
          return;
        }
      }
      toast.error(safeKanbanError(error, labels));
    },
  });
  const wipMutation = useMutation({
    mutationFn: ({
      statusDefinitionId,
      wipLimit,
    }: {
      statusDefinitionId: string;
      wipLimit: number | null;
    }) => updateTaskKanbanColumnSetting(workspaceId as string, statusDefinitionId, { wipLimit }),
    onSuccess: () => {
      toast.success(labels.wipLimitUpdated);
      setEditingColumn(null);
      if (workspaceId)
        void queryClient.invalidateQueries({ queryKey: taskKeys.kanbanSettings(workspaceId) });
    },
    onError: (error) => toast.error(safeKanbanError(error, labels)),
  });

  function handleDragEnd(event: DragEndEvent) {
    const taskId = String(event.active.id);
    const overId = event.over?.id ? String(event.over.id) : '';
    if (moveMutation.isPending) return;
    if (!workspaceId || !overId) return;
    const task = taskById.get(taskId);
    if (!task) return;
    if (overId.startsWith('column:')) {
      const statusDefinitionId = overId.slice('column:'.length);
      if (statusDefinitionId === task.status.id) return;
      moveMutation.mutate({ taskId, statusDefinitionId });
      return;
    }
    if (overId === taskId) return;
    const overTask = taskById.get(overId);
    if (!overTask) return;
    moveMutation.mutate({
      taskId,
      statusDefinitionId: overTask.status.id,
      beforeTaskId: overTask.id,
    });
  }

  function openWipDialog(column: TaskKanbanColumn) {
    setEditingColumn(column);
    setWipInput(column.wipLimit ? String(column.wipLimit) : '');
  }

  function submitWip() {
    if (!editingColumn) return;
    const value = wipInput.trim();
    const wipLimit = value ? Number(value) : null;
    if (wipLimit !== null && (!Number.isInteger(wipLimit) || wipLimit < 1 || wipLimit > 999)) {
      toast.error(labels.wipLimitInvalid);
      return;
    }
    wipMutation.mutate({ statusDefinitionId: editingColumn.status.id, wipLimit });
  }

  if (settingsQuery.isLoading) {
    return <TaskResultsSkeleton view="kanban" />;
  }
  if (settingsQuery.isError) {
    return (
      <div className="p-6">
        <EmptyState
          title={labels.errorTitle}
          description={safeTaskError(settingsQuery.error, labels)}
        />
      </div>
    );
  }
  if (columns.length === 0) {
    return (
      <div className="p-6">
        <EmptyState
          title={labels.noKanbanColumns}
          description={labels.noKanbanColumnsDescription}
        />
      </div>
    );
  }

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div
          className="flex min-h-[34rem] gap-3 overflow-x-auto p-3"
          aria-label={labels.kanbanBoard}
        >
          {columns.map((column, index) => {
            const query = columnQueries[index];
            if (!query) return null;
            return (
              <TaskKanbanColumnView
                key={column.status.id}
                column={column}
                labels={labels}
                query={query}
                pageSize={pageSizes[column.status.id] ?? 25}
                statuses={columns.map((item) => item.status)}
                hasSearchOrFilters={hasSearchOrFilters}
                onLoadMore={() =>
                  setPageSizes((current) => ({
                    ...current,
                    [column.status.id]: (current[column.status.id] ?? 25) + 25,
                  }))
                }
                onOpenDetail={onOpenDetail}
                onMove={(taskId, statusDefinitionId) =>
                  !moveMutation.isPending && moveMutation.mutate({ taskId, statusDefinitionId })
                }
                moveDisabled={moveMutation.isPending}
                onEditWip={() => openWipDialog(column)}
              />
            );
          })}
        </div>
      </DndContext>
      <Dialog
        open={Boolean(editingColumn)}
        onOpenChange={(open) => !open && setEditingColumn(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{labels.setWipLimit}</DialogTitle>
            <DialogDescription>{labels.wipLimitDescription}</DialogDescription>
          </DialogHeader>
          <Input
            label={labels.wipLimit}
            type="number"
            min={1}
            max={999}
            value={wipInput}
            onChange={(event) => setWipInput(event.target.value)}
            placeholder={labels.unlimited}
          />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setEditingColumn(null)}>
              {labels.cancel}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setWipInput('')}>
              {labels.removeWipLimit}
            </Button>
            <Button type="button" onClick={submitWip} disabled={wipMutation.isPending}>
              {labels.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {completionRequest ? (
        <TaskCompletionDialog
          labels={labels}
          workspaceId={workspaceId}
          taskId={completionRequest.taskId}
          requestedTerminalStatusDefinitionId={completionRequest.statusDefinitionId}
          open={Boolean(completionRequest)}
          onOpenChange={(open) => {
            if (!open) setCompletionRequest(null);
          }}
          onCompleted={() => {
            if (workspaceId) {
              void queryClient.invalidateQueries({ queryKey: taskKeys.kanbanColumns(workspaceId) });
            }
          }}
        />
      ) : null}
    </>
  );
}

function TaskKanbanColumnView({
  column,
  labels,
  query,
  pageSize,
  statuses,
  hasSearchOrFilters,
  onLoadMore,
  onOpenDetail,
  onMove,
  moveDisabled,
  onEditWip,
}: {
  column: TaskKanbanColumn;
  labels: AllTaskLabels;
  query: {
    data?: PageResultLike<WorkspaceTask>;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
  };
  pageSize: number;
  statuses: TaskKanbanColumn['status'][];
  hasSearchOrFilters: boolean;
  onLoadMore: () => void;
  onOpenDetail: (taskId: string) => void;
  onMove: (taskId: string, statusDefinitionId: string) => void;
  moveDisabled: boolean;
  onEditWip: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `column:${column.status.id}` });
  const tasks = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const wipState = wipStateFor(total, column.wipLimit);
  return (
    <section
      ref={setNodeRef}
      className={[
        'flex w-[20rem] shrink-0 flex-col rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-muted))]',
        isOver ? 'ring-2 ring-[hsl(var(--ring))]' : '',
      ].join(' ')}
      aria-labelledby={`kanban-column-${column.status.id}`}
    >
      <header className="grid gap-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-3">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0">
            <h3
              id={`kanban-column-${column.status.id}`}
              className="flex min-w-0 items-center gap-2 text-sm font-semibold"
            >
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: safeStatusColor(column.status.color) }}
              />
              <span className="truncate">{column.status.name}</span>
            </h3>
            <p className={wipState.className}>{wipState.label}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onEditWip}
            aria-label={labels.setWipLimit}
          >
            <Settings2 aria-hidden="true" className="h-4 w-4" />
          </Button>
        </div>
      </header>
      <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
        <div className="grid flex-1 content-start gap-2 overflow-y-auto p-2">
          {query.isLoading ? (
            Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-32 w-full" />
            ))
          ) : query.isError ? (
            <p className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-3 text-sm text-[hsl(var(--destructive))]">
              {safeTaskError(query.error, labels)}
            </p>
          ) : tasks.length === 0 ? (
            <p className="rounded-md border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4 text-sm text-[hsl(var(--muted-foreground))]">
              {hasSearchOrFilters ? labels.noMatchingTasksDescription : labels.noTasksInStatus}
            </p>
          ) : (
            tasks.map((task) => (
              <TaskKanbanCard
                key={task.id}
                task={task}
                labels={labels}
                statuses={statuses}
                onOpenDetail={onOpenDetail}
                onMove={onMove}
                moveDisabled={moveDisabled}
              />
            ))
          )}
        </div>
      </SortableContext>
      {total > pageSize ? (
        <div className="border-t border-[hsl(var(--border))] p-2">
          <Button type="button" variant="secondary" className="w-full" onClick={onLoadMore}>
            {labels.loadMore}
          </Button>
        </div>
      ) : null}
    </section>
  );

  function wipStateFor(count: number, limit: number | null) {
    if (!limit) {
      return {
        label: `${count} ${labels.tasks}`,
        className: 'text-xs text-[hsl(var(--muted-foreground))]',
      };
    }
    if (count > limit) {
      return {
        label: `${count} / ${limit} - ${labels.wipLimitExceeded}`,
        className: 'text-xs font-semibold text-[hsl(var(--destructive))]',
      };
    }
    if (count === limit) {
      return {
        label: `${count} / ${limit} - ${labels.wipLimitReached}`,
        className: 'text-xs font-semibold text-amber-700 dark:text-amber-300',
      };
    }
    return {
      label: `${count} / ${limit}`,
      className: 'text-xs text-[hsl(var(--muted-foreground))]',
    };
  }
}

function TaskKanbanCard({
  task,
  labels,
  statuses,
  onOpenDetail,
  onMove,
  moveDisabled,
}: {
  task: WorkspaceTask;
  labels: AllTaskLabels;
  statuses: TaskKanbanColumn['status'][];
  onOpenDetail: (taskId: string) => void;
  onMove: (taskId: string, statusDefinitionId: string) => void;
  moveDisabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });
  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-dragging={isDragging ? 'true' : undefined}
      className="grid gap-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-3 shadow-sm data-[dragging=true]:opacity-60"
      aria-label={`${labels.task}: ${task.title}`}
    >
      <div className="flex min-w-0 items-start gap-2">
        <button
          type="button"
          className="mt-0.5 rounded p-1 text-[hsl(var(--muted-foreground))] outline-none hover:bg-[hsl(var(--surface-muted))] focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          aria-label={`${labels.moveTask}: ${task.title}`}
          disabled={moveDisabled}
          {...attributes}
          {...listeners}
        >
          <GripVertical aria-hidden="true" className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="min-w-0 flex-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          onClick={() => onOpenDetail(task.id)}
          aria-label={`${labels.openTaskDetails}: ${task.title}`}
        >
          <span className="line-clamp-2 text-sm font-semibold leading-snug" title={task.title}>
            {task.title}
          </span>
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge variant={priorityBadge(task.priority)}>{priorityLabel(task.priority, labels)}</Badge>
        <DueStateBadge task={task} labels={labels} />
        {task.completion?.pendingApproval ? (
          <Badge variant="warning">{labels.pendingApproval}</Badge>
        ) : null}
      </div>
      <div className="grid gap-1 text-xs text-[hsl(var(--muted-foreground))]">
        <span>
          {labels.dueDate}: <DueDateText task={task} labels={labels} />
        </span>
        <span>
          {labels.assignees}: {assigneeSummary(task, labels)}
        </span>
        <span>
          {labels.projects}: {projectSummary(task, labels)}
        </span>
      </div>
      <Select
        value={task.status.id}
        onValueChange={(value) => value !== task.status.id && onMove(task.id, value)}
        disabled={moveDisabled}
      >
        <SelectTrigger label={labels.moveToStatus}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {statuses.map((status) => (
            <SelectItem key={status.id} value={status.id}>
              {status.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </article>
  );
}

function TaskResults({
  labels,
  tasks,
  view,
  sortBy,
  sortDirection,
  selectedTaskIds,
  onSort,
  onToggleSelection,
  onOpenDetail,
}: {
  labels: AllTaskLabels;
  tasks: WorkspaceTask[];
  view: TaskView;
  sortBy: TaskSortBy;
  sortDirection: TaskSortDirection;
  selectedTaskIds: Set<string>;
  onSort: (sortBy: TaskSortBy) => void;
  onToggleSelection: (taskId: string, checked: boolean) => void;
  onOpenDetail: (taskId: string) => void;
}) {
  if (view === 'grid') {
    return (
      <TaskGridView
        labels={labels}
        tasks={tasks}
        selectedTaskIds={selectedTaskIds}
        onToggleSelection={onToggleSelection}
        onOpenDetail={onOpenDetail}
      />
    );
  }
  if (view === 'compact') {
    return (
      <TaskCompactView
        labels={labels}
        tasks={tasks}
        selectedTaskIds={selectedTaskIds}
        onToggleSelection={onToggleSelection}
        onOpenDetail={onOpenDetail}
      />
    );
  }
  return (
    <>
      <div className="hidden overflow-x-auto xl:block">
        <table className="w-full min-w-[960px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[hsl(var(--border))] text-left text-xs uppercase text-[hsl(var(--muted-foreground))]">
              <th className="w-12 px-4 py-3">
                <span className="sr-only">{labels.selectTask}</span>
              </th>
              <SortableHeader
                label={labels.task}
                field="title"
                sortBy={sortBy}
                sortDirection={sortDirection}
                onSort={onSort}
              />
              <th className="px-4 py-3">{labels.status}</th>
              <th className="px-4 py-3">{labels.priority}</th>
              <th className="px-4 py-3">{labels.assignees}</th>
              <th className="px-4 py-3">{labels.department}</th>
              <th className="px-4 py-3">{labels.projects}</th>
              <SortableHeader
                label={labels.dueDate}
                field="dueAt"
                sortBy={sortBy}
                sortDirection={sortDirection}
                onSort={onSort}
              />
              <SortableHeader
                label={labels.updated}
                field="updatedAt"
                sortBy={sortBy}
                sortDirection={sortDirection}
                onSort={onSort}
              />
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => {
              const selected = selectedTaskIds.has(task.id);
              return (
                <tr
                  key={task.id}
                  data-selected={selected ? 'true' : undefined}
                  className="border-b border-[hsl(var(--border))] last:border-0 hover:bg-[hsl(var(--surface-muted))] data-[selected=true]:bg-[hsl(var(--primary)/0.08)]"
                >
                  <td className="px-4 py-4">
                    <SelectionCheckbox
                      labels={labels}
                      task={task}
                      selected={selected}
                      onToggle={onToggleSelection}
                    />
                  </td>
                  <td className="max-w-72 px-4 py-4">
                    <button
                      type="button"
                      className="block max-w-full truncate text-left font-semibold underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                      onClick={() => onOpenDetail(task.id)}
                      title={task.title}
                    >
                      {task.title}
                    </button>
                    {task.description ? (
                      <p
                        className="truncate text-xs text-[hsl(var(--muted-foreground))]"
                        title={task.description}
                      >
                        {task.description}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-4">
                    <StatusBadge task={task} />
                  </td>
                  <td className="px-4 py-4">
                    <Badge variant={priorityBadge(task.priority)}>
                      {priorityLabel(task.priority, labels)}
                    </Badge>
                  </td>
                  <td className="px-4 py-4">{assigneeSummary(task, labels)}</td>
                  <td className="px-4 py-4">{task.department?.name ?? labels.emptyDash}</td>
                  <td className="px-4 py-4">{projectSummary(task, labels)}</td>
                  <td className="px-4 py-4">
                    <DueDateCell task={task} labels={labels} />
                  </td>
                  <td className="px-4 py-4">{formatDateTime(task.updatedAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 p-3 xl:hidden">
        {tasks.map((task) => {
          const selected = selectedTaskIds.has(task.id);
          return (
            <div
              key={task.id}
              data-selected={selected ? 'true' : undefined}
              className="grid gap-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4 text-left data-[selected=true]:border-[hsl(var(--primary))] data-[selected=true]:bg-[hsl(var(--primary)/0.08)]"
            >
              <span className="flex min-w-0 items-start justify-between gap-3">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                  onClick={() => onOpenDetail(task.id)}
                  aria-label={`${labels.openTaskDetails}: ${task.title}`}
                >
                  <span className="block truncate font-semibold" title={task.title}>
                    {task.title}
                  </span>
                </button>
                <SelectionCheckbox
                  labels={labels}
                  task={task}
                  selected={selected}
                  onToggle={onToggleSelection}
                />
              </span>
              <span className="mt-1 flex flex-wrap gap-2">
                <StatusBadge task={task} />
                <Badge variant={priorityBadge(task.priority)}>
                  {priorityLabel(task.priority, labels)}
                </Badge>
              </span>
              <span className="grid gap-1 text-sm text-[hsl(var(--muted-foreground))]">
                <span>
                  {labels.dueDate}: <DueDateText task={task} labels={labels} />
                </span>
                <span>
                  {labels.assignees}: {assigneeSummary(task, labels)}
                </span>
                <span>
                  {labels.projects}: {projectSummary(task, labels)}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

function TaskGridView({
  labels,
  tasks,
  selectedTaskIds,
  onToggleSelection,
  onOpenDetail,
}: {
  labels: AllTaskLabels;
  tasks: WorkspaceTask[];
  selectedTaskIds: Set<string>;
  onToggleSelection: (taskId: string, checked: boolean) => void;
  onOpenDetail: (taskId: string) => void;
}) {
  return (
    <div className="grid gap-3 p-3 sm:grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))]">
      {tasks.map((task) => {
        const selected = selectedTaskIds.has(task.id);
        return (
          <div
            key={task.id}
            data-selected={selected ? 'true' : undefined}
            className="grid min-h-56 content-start gap-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4 text-left transition-colors data-[selected=true]:border-[hsl(var(--primary))] data-[selected=true]:bg-[hsl(var(--primary)/0.08)]"
          >
            <span className="flex min-w-0 items-start justify-between gap-3">
              <button
                type="button"
                className="min-w-0 flex-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                onClick={() => onOpenDetail(task.id)}
                aria-label={`${labels.openTaskDetails}: ${task.title}`}
              >
                <span
                  className="line-clamp-2 text-base font-semibold leading-snug"
                  title={task.title}
                >
                  {task.title}
                </span>
              </button>
              <SelectionCheckbox
                labels={labels}
                task={task}
                selected={selected}
                onToggle={onToggleSelection}
              />
            </span>
            <span className="flex flex-wrap gap-2">
              <StatusBadge task={task} />
              <Badge variant={priorityBadge(task.priority)}>
                {priorityLabel(task.priority, labels)}
              </Badge>
            </span>
            {task.description ? (
              <span
                className="line-clamp-2 text-sm text-[hsl(var(--muted-foreground))]"
                title={task.description}
              >
                {task.description}
              </span>
            ) : null}
            <span className="grid gap-2 text-sm text-[hsl(var(--muted-foreground))]">
              <TaskMetaLine
                label={labels.dueDate}
                value={<DueDateText task={task} labels={labels} />}
              />
              <span className="flex flex-wrap gap-2">
                <DueStateBadge task={task} labels={labels} />
              </span>
              <TaskMetaLine label={labels.assignees} value={assigneeSummary(task, labels)} />
              <TaskMetaLine
                label={labels.department}
                value={task.department?.name ?? labels.emptyDash}
              />
              <TaskMetaLine label={labels.projects} value={projectSummary(task, labels)} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

function TaskCompactView({
  labels,
  tasks,
  selectedTaskIds,
  onToggleSelection,
  onOpenDetail,
}: {
  labels: AllTaskLabels;
  tasks: WorkspaceTask[];
  selectedTaskIds: Set<string>;
  onToggleSelection: (taskId: string, checked: boolean) => void;
  onOpenDetail: (taskId: string) => void;
}) {
  return (
    <div className="divide-y divide-[hsl(var(--border))]">
      {tasks.map((task) => {
        const selected = selectedTaskIds.has(task.id);
        return (
          <div
            key={task.id}
            data-selected={selected ? 'true' : undefined}
            className="grid w-full gap-2 px-3 py-2.5 text-left transition-colors hover:bg-[hsl(var(--surface-muted))] data-[selected=true]:bg-[hsl(var(--primary)/0.08)] sm:grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] sm:items-center"
          >
            <SelectionCheckbox
              labels={labels}
              task={task}
              selected={selected}
              onToggle={onToggleSelection}
            />
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <StatusBadge task={task} />
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                title={task.title}
                onClick={() => onOpenDetail(task.id)}
                aria-label={`${labels.openTaskDetails}: ${task.title}`}
              >
                {task.title}
              </button>
            </span>
            <span className="flex items-center gap-2 text-sm">
              <Badge variant={priorityBadge(task.priority)}>
                {priorityLabel(task.priority, labels)}
              </Badge>
            </span>
            <span
              className="truncate text-sm text-[hsl(var(--muted-foreground))]"
              title={assigneeSummary(task, labels)}
            >
              {assigneeSummary(task, labels)}
            </span>
            <span className="flex flex-wrap items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
              <DueDateText task={task} labels={labels} />
              <DueStateBadge task={task} labels={labels} />
            </span>
            <span
              className="min-w-0 truncate text-xs text-[hsl(var(--muted-foreground))] sm:col-span-5"
              title={`${labels.department}: ${task.department?.name ?? labels.emptyDash} · ${labels.projects}: ${projectSummary(task, labels)}`}
            >
              {labels.department}: {task.department?.name ?? labels.emptyDash} · {labels.projects}:{' '}
              {projectSummary(task, labels)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function SelectionCheckbox({
  labels,
  task,
  selected,
  onToggle,
}: {
  labels: AllTaskLabels;
  task: WorkspaceTask;
  selected: boolean;
  onToggle: (taskId: string, checked: boolean) => void;
}) {
  return (
    <Checkbox
      className="h-5 w-5 shrink-0"
      checked={selected}
      aria-label={`${labels.selectTask}: ${task.title}`}
      onClick={(event) => event.stopPropagation()}
      onCheckedChange={(checked) => onToggle(task.id, checked === true)}
    />
  );
}

function BulkActionDialog({
  labels,
  action,
  selectedCount,
  statuses,
  users,
  assigneeSearch,
  selectedMembershipIds,
  selectedStatusId,
  selectedPriority,
  loading,
  onAssigneeSearch,
  onMembershipToggle,
  onStatusChange,
  onPriorityChange,
  onSubmit,
  onOpenChange,
}: {
  labels: AllTaskLabels;
  action: BulkAction | null;
  selectedCount: number;
  statuses: { id: string; name: string }[];
  users: WorkspaceUser[];
  assigneeSearch: string;
  selectedMembershipIds: string[];
  selectedStatusId: string;
  selectedPriority: TaskPriority;
  loading: boolean;
  onAssigneeSearch: (value: string) => void;
  onMembershipToggle: (membershipId: string) => void;
  onStatusChange: (value: string) => void;
  onPriorityChange: (value: TaskPriority) => void;
  onSubmit: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const open = action !== null;
  const submitDisabled =
    loading ||
    selectedCount === 0 ||
    (action === 'status' && !selectedStatusId) ||
    ((action === 'addAssignees' || action === 'removeAssignees') &&
      selectedMembershipIds.length === 0);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{bulkDialogTitle(action, selectedCount, labels)}</DialogTitle>
          <DialogDescription>{bulkDialogDescription(action, labels)}</DialogDescription>
        </DialogHeader>
        {action === 'status' ? (
          <Select
            value={selectedStatusId || noneValue}
            onValueChange={(value) => onStatusChange(value === noneValue ? '' : value)}
          >
            <SelectTrigger label={labels.status}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={noneValue}>{labels.selectStatus}</SelectItem>
              {statuses.map((status) => (
                <SelectItem key={status.id} value={status.id}>
                  {status.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {action === 'priority' ? (
          <Select
            value={selectedPriority}
            onValueChange={(value) => onPriorityChange(value as TaskPriority)}
          >
            <SelectTrigger label={labels.priority}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {priorities.map((priority) => (
                <SelectItem key={priority} value={priority}>
                  {priorityLabel(priority, labels)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {action === 'addAssignees' || action === 'removeAssignees' ? (
          <div className="grid gap-3">
            {action === 'removeAssignees' ? (
              <p className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-muted))] p-3 text-sm text-[hsl(var(--muted-foreground))]">
                {labels.unassignedWarning}
              </p>
            ) : null}
            <Input
              label={labels.searchPeople}
              value={assigneeSearch}
              onChange={(event) => onAssigneeSearch(event.target.value)}
              placeholder={labels.searchPeople}
            />
            <div className="grid max-h-64 gap-2 overflow-y-auto rounded-md border border-[hsl(var(--border))] p-2">
              {users.length ? (
                users.map((user) => (
                  <Checkbox
                    key={user.membershipId}
                    label={displayUser(user)}
                    checked={selectedMembershipIds.includes(user.membershipId)}
                    onCheckedChange={() => onMembershipToggle(user.membershipId)}
                  />
                ))
              ) : (
                <p className="p-2 text-sm text-[hsl(var(--muted-foreground))]">
                  {labels.noEligibleUsers}
                </p>
              )}
            </div>
          </div>
        ) : null}
        {action === 'delete' ? (
          <p className="rounded-md border border-[hsl(var(--danger))] bg-[hsl(var(--danger)/0.08)] p-3 text-sm">
            {labels.deleteConfirmationDescription}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            disabled={loading}
            onClick={() => onOpenChange(false)}
          >
            {labels.cancel}
          </Button>
          <Button
            type="button"
            variant={action === 'delete' ? 'danger' : 'primary'}
            loading={loading}
            disabled={submitDisabled}
            onClick={onSubmit}
          >
            {bulkSubmitLabel(action, selectedCount, labels)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TaskMetaLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center justify-between gap-3">
      <span className="shrink-0 text-xs font-semibold uppercase text-[hsl(var(--muted-foreground))]">
        {label}
      </span>
      <span
        className="min-w-0 truncate text-right font-medium text-[hsl(var(--foreground))]"
        title={typeof value === 'string' ? value : undefined}
      >
        {value}
      </span>
    </span>
  );
}

function SortableHeader({
  label,
  field,
  sortBy,
  sortDirection,
  onSort,
}: {
  label: string;
  field: TaskSortBy;
  sortBy: TaskSortBy;
  sortDirection: TaskSortDirection;
  onSort: (sortBy: TaskSortBy) => void;
}) {
  const active = sortBy === field;
  return (
    <th className="px-4 py-3">
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
        aria-sort={active ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
        onClick={() => onSort(field)}
      >
        {label}
        {active ? (
          sortDirection === 'asc' ? (
            <ArrowUp aria-hidden="true" className="h-3.5 w-3.5" />
          ) : (
            <ArrowDown aria-hidden="true" className="h-3.5 w-3.5" />
          )
        ) : (
          <ArrowUpDown aria-hidden="true" className="h-3.5 w-3.5" />
        )}
      </button>
    </th>
  );
}

function TaskPagination({
  labels,
  page,
  pageSize,
  total,
  totalPages,
  onPage,
  onPageSize,
}: {
  labels: AllTaskLabels;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPage: (page: number) => void;
  onPageSize: (pageSize: number) => void;
}) {
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);
  return (
    <Pagination className="flex-wrap">
      <div className="text-sm text-[hsl(var(--muted-foreground))]">
        {labels.page} {page} / {totalPages} · {start}-{end} / {total}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={String(pageSize)} onValueChange={(value) => onPageSize(Number(value))}>
          <SelectTrigger className="w-32" aria-label={labels.rowsPerPage}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pageSizes.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size} {labels.rows}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="secondary"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft aria-hidden="true" className="h-4 w-4" />
          {labels.previous}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
        >
          {labels.next}
          <ChevronRight aria-hidden="true" className="h-4 w-4" />
        </Button>
      </div>
    </Pagination>
  );
}

function TaskDetailDialog({
  labels,
  workspaceId,
  taskId,
  onSelectTask,
  onOpenChange,
}: {
  labels: AllTaskLabels;
  workspaceId: string | null;
  taskId: string | null;
  onSelectTask: (taskId: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [activeTab, setActiveTab] = useState('overview');
  const detailQuery = useQuery({
    queryKey: taskKeys.detail(workspaceId, taskId),
    queryFn: () => getWorkspaceTask(workspaceId as string, taskId as string),
    enabled: Boolean(workspaceId && taskId),
  });
  const task = detailQuery.data;

  useEffect(() => {
    setActiveTab('overview');
  }, [taskId, workspaceId]);

  return (
    <Dialog open={Boolean(taskId)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{labels.taskDetails}</DialogTitle>
          <DialogDescription>{labels.taskDetailsDescription}</DialogDescription>
        </DialogHeader>
        {detailQuery.isLoading ? (
          <div className="grid gap-3">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : detailQuery.isError ? (
          <EmptyState
            title={labels.errorTitle}
            description={safeTaskError(detailQuery.error, labels)}
          />
        ) : task ? (
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList
              aria-label={labels.taskRelationshipTabs}
              className="grid w-full grid-cols-2 sm:grid-cols-5"
            >
              <TabsTrigger value="overview">{labels.overview}</TabsTrigger>
              <TabsTrigger value="subtasks">{labels.subtasks}</TabsTrigger>
              <TabsTrigger value="dependencies">{labels.dependencies}</TabsTrigger>
              <TabsTrigger value="related">{labels.related}</TabsTrigger>
              <TabsTrigger value="comments">{labels.comments}</TabsTrigger>
            </TabsList>
            <TabsContent value="overview">
              <TaskOverview
                labels={labels}
                workspaceId={workspaceId}
                task={task}
                onShowSubtasks={() => setActiveTab('subtasks')}
                onSelectTask={onSelectTask}
              />
            </TabsContent>
            <TabsContent value="subtasks">
              <SubtasksTab
                labels={labels}
                workspaceId={workspaceId}
                task={task}
                active={activeTab === 'subtasks'}
                onSelectTask={onSelectTask}
              />
            </TabsContent>
            <TabsContent value="dependencies">
              <DependenciesTab
                labels={labels}
                workspaceId={workspaceId}
                task={task}
                active={activeTab === 'dependencies'}
                onSelectTask={onSelectTask}
              />
            </TabsContent>
            <TabsContent value="related">
              <RelatedTasksTab
                labels={labels}
                workspaceId={workspaceId}
                task={task}
                active={activeTab === 'related'}
                onSelectTask={onSelectTask}
              />
            </TabsContent>
            <TabsContent value="comments">
              <TaskCommentsPanel
                workspaceId={workspaceId}
                task={task}
                active={activeTab === 'comments'}
              />
            </TabsContent>
          </Tabs>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function TaskOverview({
  labels,
  workspaceId,
  task,
  onShowSubtasks,
  onSelectTask,
}: {
  labels: AllTaskLabels;
  workspaceId: string | null;
  task: WorkspaceTask;
  onShowSubtasks: () => void;
  onSelectTask: (taskId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [makeRecurringOpen, setMakeRecurringOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const recurrenceQuery = useQuery({
    queryKey: taskKeys.recurrenceList(workspaceId, {
      page: 1,
      pageSize: 100,
      search: task.title,
    }),
    queryFn: () =>
      listTaskRecurrenceSeries(workspaceId as string, {
        page: 1,
        pageSize: 100,
        search: task.title,
      }),
    enabled: Boolean(workspaceId && task.recurrenceSeriesId),
  });
  const recurrence = recurrenceQuery.data?.items.find(
    (item) => item.id === task.recurrenceSeriesId,
  );
  const recurrenceAction = useMutation({
    mutationFn: async (action: 'pause' | 'resume' | 'end') => {
      if (!workspaceId || !task.recurrenceSeriesId) throw new Error(labels.noWorkspace);
      if (action === 'pause') return pauseTaskRecurrence(workspaceId, task.recurrenceSeriesId);
      if (action === 'resume') return resumeTaskRecurrence(workspaceId, task.recurrenceSeriesId);
      return endTaskRecurrence(workspaceId, task.recurrenceSeriesId);
    },
    onSuccess: async () => {
      toast.success(labels.recurrenceUpdated);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: taskKeys.recurrenceBase(workspaceId) }),
        queryClient.invalidateQueries({ queryKey: taskKeys.detail(workspaceId, task.id) }),
      ]);
    },
    onError: () => toast.error(labels.recurrenceActionFailed),
  });
  const saveTemplateMutation = useMutation({
    mutationFn: () => {
      if (!workspaceId) throw new Error(labels.noWorkspace);
      return saveTaskAsTemplate(workspaceId, task.id, templateName);
    },
    onSuccess: async () => {
      toast.success(labels.templateSaved);
      setTemplateOpen(false);
      setTemplateName('');
      await queryClient.invalidateQueries({ queryKey: taskKeys.templatesBase(workspaceId) });
    },
    onError: () => toast.error(labels.templateActionFailed),
  });
  const makeRecurringMutation = useMutation({
    mutationFn: (form: RecurrenceFormState) => {
      if (!workspaceId) throw new Error(labels.noWorkspace);
      const payload = recurrencePayloadFromForm(form);
      if (!payload) throw new Error(labels.recurrenceInvalid);
      return makeWorkspaceTaskRecurring(workspaceId, task.id, payload);
    },
    onSuccess: async () => {
      toast.success(labels.recurrenceUpdated);
      setMakeRecurringOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: taskKeys.detail(workspaceId, task.id) }),
        queryClient.invalidateQueries({ queryKey: taskKeys.recurrenceBase(workspaceId) }),
      ]);
    },
    onError: () => toast.error(labels.recurrenceActionFailed),
  });
  const editMutation = useMutation({
    mutationFn: (form: EditTaskScopeFormState) => {
      if (!workspaceId) throw new Error(labels.noWorkspace);
      if (!form.scope) throw new Error(labels.selectEditScope);
      return updateWorkspaceTask(workspaceId, task.id, {
        title: form.title,
        priority: form.priority,
        recurrenceEditScope: form.scope,
      });
    },
    onSuccess: async () => {
      toast.success(labels.taskUpdated);
      setEditOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: taskKeys.detail(workspaceId, task.id) }),
        queryClient.invalidateQueries({ queryKey: taskKeys.all(workspaceId) }),
        queryClient.invalidateQueries({ queryKey: taskKeys.recurrenceBase(workspaceId) }),
      ]);
    },
    onError: () => toast.error(labels.taskUpdateFailed),
  });

  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        <h3 className="break-words text-xl font-semibold">{task.title}</h3>
        <div className="flex flex-wrap gap-2">
          <StatusBadge task={task} />
          <Badge variant={priorityBadge(task.priority)}>
            {priorityLabel(task.priority, labels)}
          </Badge>
          <DueStateBadge task={task} labels={labels} />
        </div>
      </div>
      <section className="grid gap-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h4 className="text-sm font-semibold">
              {task.recurrenceSeriesId ? labels.recurring : labels.notRecurring}
            </h4>
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              {task.recurrenceSeriesId
                ? labels.recurringTaskSummary
                : labels.nonRecurringTaskSummary}
            </p>
          </div>
          <Button type="button" variant="secondary" onClick={() => setTemplateOpen(true)}>
            {labels.saveAsTemplate}
          </Button>
          {task.recurrenceSeriesId ? (
            <Button type="button" variant="secondary" onClick={() => setEditOpen(true)}>
              {labels.editTask}
            </Button>
          ) : (
            <Button type="button" variant="secondary" onClick={() => setMakeRecurringOpen(true)}>
              {labels.makeRecurring}
            </Button>
          )}
        </div>
        {task.recurrenceSeriesId ? (
          recurrenceQuery.isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : recurrence ? (
            <RecurringSummary
              labels={labels}
              series={recurrence}
              scheduledFor={task.recurrenceScheduledFor ?? null}
              onAction={(action) => {
                if (action === 'end' && !window.confirm(labels.endRecurrenceConfirmation)) return;
                if (action === 'pause' && !window.confirm(labels.pauseRecurrenceConfirmation))
                  return;
                if (action === 'resume' && !window.confirm(labels.resumeRecurrenceConfirmation))
                  return;
                recurrenceAction.mutate(action);
              }}
              busy={recurrenceAction.isPending}
            />
          ) : (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              {labels.recurrenceUnavailable}
            </p>
          )
        ) : null}
      </section>
      <TaskCompletionSection labels={labels} workspaceId={workspaceId} task={task} />
      {task.parent ? (
        <div className="flex flex-col gap-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-[hsl(var(--muted-foreground))]">
              {labels.parentTask}
            </p>
            <p className="break-words text-sm font-semibold">{task.parent.title}</p>
          </div>
          <Button type="button" variant="secondary" onClick={() => onSelectTask(task.parent!.id)}>
            {labels.viewParent}
          </Button>
        </div>
      ) : null}
      {task.description ? (
        <section className="grid gap-1">
          <h4 className="text-sm font-semibold">{labels.descriptionField}</h4>
          <p className="whitespace-pre-wrap break-words text-sm text-[hsl(var(--muted-foreground))]">
            {task.description}
          </p>
        </section>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <DetailRow
          label={labels.plannedStart}
          value={task.plannedStartAt ? formatDateTime(task.plannedStartAt) : labels.emptyDash}
        />
        <DetailRow
          label={labels.dueDate}
          value={task.dueAt ? formatDateTime(task.dueAt) : labels.noDueDate}
        />
        <DetailRow label={labels.department} value={task.department?.name ?? labels.emptyDash} />
        <DetailRow
          label={labels.directSubtasks}
          value={String(task.directSubtaskCount ?? 0)}
          actionLabel={labels.viewSubtasks}
          onAction={onShowSubtasks}
        />
        <DetailRow
          label={labels.creator}
          value={task.createdBy ? displayPerson(task.createdBy) : labels.emptyDash}
        />
        <DetailRow label={labels.createdAtLabel} value={formatDateTime(task.createdAt)} />
        <DetailRow label={labels.updated} value={formatDateTime(task.updatedAt)} />
      </div>
      <RelationList
        label={labels.assignees}
        values={task.assignees.map((item) => displayPerson(item.user))}
        empty={labels.emptyDash}
      />
      <RelationList
        label={labels.followers}
        values={(task.followers ?? []).map((item) => displayPerson(item.user))}
        empty={labels.emptyDash}
      />
      <RelationList
        label={labels.projects}
        values={task.projects.map((project) => project.name)}
        empty={labels.emptyDash}
      />
      <TaskTagsSection workspaceId={workspaceId} taskId={task.id} labels={labels} />
      <TaskAttachmentsSection workspaceId={workspaceId} taskId={task.id} labels={labels} />
      <MakeRecurringDialog
        labels={labels}
        open={makeRecurringOpen}
        busy={makeRecurringMutation.isPending}
        onOpenChange={setMakeRecurringOpen}
        onSubmit={(form) => makeRecurringMutation.mutate(form)}
      />
      <EditRecurringTaskDialog
        labels={labels}
        task={task}
        open={editOpen}
        busy={editMutation.isPending}
        onOpenChange={setEditOpen}
        onSubmit={(form) => editMutation.mutate(form)}
      />
      <Dialog open={templateOpen} onOpenChange={setTemplateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{labels.saveAsTemplate}</DialogTitle>
            <DialogDescription>{labels.saveTemplateDescription}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <Input
              label={labels.templateName}
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
            />
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              {labels.saveTemplateCopyWarning}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setTemplateOpen(false)}>
              {labels.cancel}
            </Button>
            <Button
              type="button"
              disabled={!templateName.trim() || saveTemplateMutation.isPending}
              onClick={() => saveTemplateMutation.mutate()}
            >
              {labels.saveAsTemplate}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type RecurrenceFormState = {
  frequency: TaskRecurrenceFrequency;
  startLocalDate: string;
  localTime: string;
  timezone: string;
  selectedWeekdays: number[];
  interval: number;
  customIntervalUnit: TaskRecurrenceCustomUnit;
  endMode: TaskRecurrenceEndMode;
  untilLocalDate: string;
  maxOccurrences: number;
};

type EditTaskScopeFormState = {
  title: string;
  priority: TaskPriority;
  scope: TaskRecurrenceEditScope | '';
};

const completionProofTypes = ['TEXT', 'URL', 'CHECKLIST_CONFIRMATION', 'ATTACHMENT'] as const;

function TaskCompletionSection({
  labels,
  workspaceId,
  task,
}: {
  labels: AllTaskLabels;
  workspaceId: string | null;
  task: WorkspaceTask;
}) {
  const queryClient = useQueryClient();
  const [policyOpen, setPolicyOpen] = useState(false);
  const [completionOpen, setCompletionOpen] = useState(false);
  const [targetStatusId, setTargetStatusId] = useState('');
  const [policyDraft, setPolicyDraft] = useState<TaskCompletionPolicy | null>(null);
  const [rejectingSubmissionId, setRejectingSubmissionId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const policyQuery = useQuery({
    queryKey: taskKeys.completionPolicy(workspaceId, task.id),
    queryFn: () => getTaskCompletionPolicy(workspaceId as string, task.id),
    enabled: Boolean(workspaceId),
  });
  const submissionsQuery = useQuery({
    queryKey: taskKeys.completionSubmissions(workspaceId, task.id, { page: 1, pageSize: 5 }),
    queryFn: () =>
      listTaskCompletionSubmissions(workspaceId as string, task.id, { page: 1, pageSize: 5 }),
    enabled: Boolean(workspaceId),
  });
  const approvalsQuery = useQuery({
    queryKey: taskKeys.completionApprovals(workspaceId, { page: 1, pageSize: 5 }),
    queryFn: () => listTaskCompletionApprovals(workspaceId as string, { page: 1, pageSize: 5 }),
    enabled: Boolean(workspaceId),
  });
  const statusesQuery = useQuery({
    queryKey: taskCreationKeys.statuses(workspaceId),
    queryFn: () => listWorkspaceStatuses(workspaceId as string, 'TASK', 'ACTIVE'),
    enabled: Boolean(workspaceId),
  });
  const terminalStatuses = (statusesQuery.data ?? []).filter((status) => status.isTerminal);
  const selectedPolicy = policyDraft ?? policyQuery.data;
  const policyMutation = useMutation({
    mutationFn: () => {
      if (!workspaceId || !selectedPolicy) throw new Error(labels.noWorkspace);
      return updateTaskCompletionPolicy(workspaceId, task.id, selectedPolicy);
    },
    onSuccess: async () => {
      toast.success(labels.completionPolicySaved);
      setPolicyOpen(false);
      await queryClient.invalidateQueries({
        queryKey: taskKeys.completionPolicy(workspaceId, task.id),
      });
    },
    onError: () => toast.error(labels.completionActionFailed),
  });
  const decisionMutation = useMutation({
    mutationFn: ({
      submissionId,
      decision,
    }: {
      submissionId: string;
      decision: 'APPROVED' | 'REJECTED';
    }) => {
      if (!workspaceId) throw new Error(labels.noWorkspace);
      return decideTaskCompletion(workspaceId, task.id, submissionId, {
        decision,
        reason: decision === 'REJECTED' ? rejectReason : undefined,
      });
    },
    onSuccess: async () => {
      toast.success(labels.completionDecisionSaved);
      setRejectingSubmissionId(null);
      setRejectReason('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: taskKeys.detail(workspaceId, task.id) }),
        queryClient.invalidateQueries({ queryKey: taskKeys.all(workspaceId) }),
        queryClient.invalidateQueries({
          queryKey: taskKeys.completionSubmissions(workspaceId, task.id, { page: 1, pageSize: 5 }),
        }),
        queryClient.invalidateQueries({
          queryKey: taskKeys.completionApprovals(workspaceId, { page: 1, pageSize: 5 }),
        }),
      ]);
    },
    onError: () => toast.error(labels.completionActionFailed),
  });

  useEffect(() => {
    if (!targetStatusId && terminalStatuses[0]) setTargetStatusId(terminalStatuses[0].id);
  }, [targetStatusId, terminalStatuses]);

  function openPolicyDialog() {
    setPolicyDraft(policyQuery.data ?? null);
    setPolicyOpen(true);
  }

  return (
    <section className="grid gap-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h4 className="text-sm font-semibold">{labels.completionApproval}</h4>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {task.completion?.pendingApproval ? labels.pendingApproval : labels.completionReady}
          </p>
        </div>
        <Button type="button" variant="secondary" onClick={openPolicyDialog}>
          {labels.completionPolicy}
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="grid gap-2">
          <Select value={targetStatusId} onValueChange={setTargetStatusId}>
            <SelectTrigger label={labels.requestCompletionStatus}>
              <SelectValue placeholder={labels.selectStatus} />
            </SelectTrigger>
            <SelectContent>
              {terminalStatuses.map((status) => (
                <SelectItem key={status.id} value={status.id}>
                  {status.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">{labels.completionRequired}</p>
          <Button
            type="button"
            disabled={!targetStatusId || task.status.isTerminal}
            onClick={() => setCompletionOpen(true)}
          >
            {labels.submitForCompletion}
          </Button>
        </div>
        <div className="grid gap-2">
          <h5 className="text-sm font-semibold">{labels.completionHistory}</h5>
          {(submissionsQuery.data?.items ?? []).length === 0 ? (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              {labels.noCompletionHistory}
            </p>
          ) : (
            submissionsQuery.data?.items.map((submission) => (
              <div
                key={submission.id}
                className="rounded-md border border-[hsl(var(--border))] p-2 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="neutral">v{submission.version}</Badge>
                  <Badge variant="info">{completionStatusLabel(submission.status, labels)}</Badge>
                  <span>{submission.requestedTerminalStatus.name}</span>
                </div>
                <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                  {formatDateTime(submission.submittedAt)}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
      <div className="grid gap-2">
        <h5 className="text-sm font-semibold">{labels.approvalQueue}</h5>
        {(approvalsQuery.data?.items ?? []).filter((item) => item.taskId === task.id).length ===
        0 ? (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">{labels.noApprovals}</p>
        ) : (
          approvalsQuery.data?.items
            .filter((item) => item.taskId === task.id)
            .map((submission) => (
              <div
                key={submission.id}
                className="grid gap-2 rounded-md border border-[hsl(var(--border))] p-2"
              >
                <p className="text-sm font-medium">
                  {labels.version} {submission.version}: {submission.requestedTerminalStatus.name}
                </p>
                {rejectingSubmissionId === submission.id ? (
                  <Input
                    label={labels.rejectionReason}
                    value={rejectReason}
                    onChange={(event) => setRejectReason(event.target.value)}
                  />
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    onClick={() =>
                      decisionMutation.mutate({ submissionId: submission.id, decision: 'APPROVED' })
                    }
                  >
                    {labels.approve}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() =>
                      rejectingSubmissionId === submission.id
                        ? decisionMutation.mutate({
                            submissionId: submission.id,
                            decision: 'REJECTED',
                          })
                        : setRejectingSubmissionId(submission.id)
                    }
                    disabled={rejectingSubmissionId === submission.id && !rejectReason.trim()}
                  >
                    {labels.reject}
                  </Button>
                </div>
              </div>
            ))
        )}
      </div>
      <CompletionPolicyDialog
        labels={labels}
        open={policyOpen}
        policy={policyDraft}
        busy={policyMutation.isPending}
        onOpenChange={setPolicyOpen}
        onChange={setPolicyDraft}
        onSave={() => policyMutation.mutate()}
      />
      <TaskCompletionDialog
        labels={labels}
        workspaceId={workspaceId}
        taskId={task.id}
        requestedTerminalStatusDefinitionId={targetStatusId}
        open={completionOpen}
        onOpenChange={setCompletionOpen}
        onCompleted={() => {
          void queryClient.invalidateQueries({ queryKey: taskKeys.detail(workspaceId, task.id) });
        }}
      />
    </section>
  );
}

function CompletionPolicyDialog({
  labels,
  open,
  policy,
  busy,
  onOpenChange,
  onChange,
  onSave,
}: {
  labels: AllTaskLabels;
  open: boolean;
  policy: TaskCompletionPolicy | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (policy: TaskCompletionPolicy) => void;
  onSave: () => void;
}) {
  if (!policy) return null;
  const setMode = (mode: TaskCompletionProofRequirementMode) =>
    onChange({
      ...policy,
      proofRequirementMode: mode,
      requiredProofTypes: mode === 'SPECIFIC' ? policy.requiredProofTypes : [],
    });
  const toggleProofType = (type: TaskCompletionProofType, checked: boolean) =>
    onChange({
      ...policy,
      requiredProofTypes: checked
        ? [...new Set([...policy.requiredProofTypes, type])]
        : policy.requiredProofTypes.filter((item) => item !== type),
    });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{labels.completionPolicy}</DialogTitle>
          <DialogDescription>{labels.completionPolicyDescription}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Select
            value={policy.proofRequirementMode}
            onValueChange={(value) => setMode(value as TaskCompletionProofRequirementMode)}
          >
            <SelectTrigger label={labels.proofRequirement}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="NONE">{labels.proofNone}</SelectItem>
              <SelectItem value="ANY">{labels.proofAny}</SelectItem>
              <SelectItem value="SPECIFIC">{labels.proofSpecific}</SelectItem>
            </SelectContent>
          </Select>
          {policy.proofRequirementMode === 'SPECIFIC' ? (
            <div className="grid gap-2">
              {completionProofTypes.map((type) => (
                <label key={type} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={policy.requiredProofTypes.includes(type)}
                    onCheckedChange={(value) => toggleProofType(type, value === true)}
                  />
                  {completionProofTypeLabel(type, labels)}
                </label>
              ))}
            </div>
          ) : null}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={policy.approvalRequired}
              onCheckedChange={(value) =>
                onChange({
                  ...policy,
                  approvalRequired: value === true,
                  approverMode: value === true ? (policy.approverMode ?? 'ANY_ONE') : null,
                })
              }
            />
            {labels.approvalRequired}
          </label>
          {policy.approvalRequired ? (
            <>
              <Select
                value={policy.approverMode ?? 'ANY_ONE'}
                onValueChange={(value) =>
                  onChange({ ...policy, approverMode: value as 'ANY_ONE' | 'ALL_REQUIRED' })
                }
              >
                <SelectTrigger label={labels.approverMode}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ANY_ONE">{labels.anyOneApprover}</SelectItem>
                  <SelectItem value="ALL_REQUIRED">{labels.allApprovers}</SelectItem>
                </SelectContent>
              </Select>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={policy.includeTaskCreator}
                  onCheckedChange={(value) =>
                    onChange({ ...policy, includeTaskCreator: value === true })
                  }
                />
                {labels.includeTaskCreator}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={policy.includePermissionApprovers}
                  onCheckedChange={(value) =>
                    onChange({ ...policy, includePermissionApprovers: value === true })
                  }
                />
                {labels.includePermissionApprovers}
              </label>
            </>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            {labels.cancel}
          </Button>
          <Button type="button" disabled={busy} onClick={onSave}>
            {labels.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TaskCompletionDialog({
  labels,
  workspaceId,
  taskId,
  requestedTerminalStatusDefinitionId,
  open,
  onOpenChange,
  onCompleted,
}: {
  labels: AllTaskLabels;
  workspaceId: string | null;
  taskId: string;
  requestedTerminalStatusDefinitionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCompleted?: (task: WorkspaceTask) => void;
}) {
  const queryClient = useQueryClient();
  const [proofText, setProofText] = useState('');
  const [proofUrl, setProofUrl] = useState('');
  const [checklistConfirmed, setChecklistConfirmed] = useState(false);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [uploadedAttachment, setUploadedAttachment] = useState<TaskAttachmentSummary | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const policyQuery = useQuery({
    queryKey: taskKeys.completionPolicy(workspaceId, taskId),
    queryFn: () => getTaskCompletionPolicy(workspaceId as string, taskId),
    enabled: Boolean(workspaceId && taskId && open),
  });
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!workspaceId) throw new Error(labels.noWorkspace);
      if (file.size > maxCompletionProofFileBytes) throw new Error(labels.fileTooLarge);
      const init = await initTaskAttachmentUpload(workspaceId, taskId, {
        filename: file.name,
        displayName: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
      });
      await uploadCompletionProofFile(init.uploadUrl, file, setUploadProgress);
      return completeTaskAttachmentUpload(workspaceId, taskId, init.attachment.id, {
        sizeBytes: file.size,
      });
    },
    onSuccess: async (attachment) => {
      setUploadedAttachment(attachment);
      setProofFile(null);
      toast.success(labels.fileUploaded);
      await queryClient.invalidateQueries({
        queryKey: taskKeys.attachmentsBase(workspaceId, taskId),
      });
    },
    onError: (error) => {
      setUploadProgress(0);
      toast.error(safeCompletionError(error, labels));
    },
  });
  const submitMutation = useMutation({
    mutationFn: () => {
      if (!workspaceId || !requestedTerminalStatusDefinitionId)
        throw new Error(labels.selectStatus);
      return submitTaskCompletion(workspaceId, taskId, requestedTerminalStatusDefinitionId, {
        proofItems: buildCompletionProofItems(
          policyQuery.data,
          proofText,
          proofUrl,
          checklistConfirmed,
          uploadedAttachment?.id ?? null,
        ),
      });
    },
    onSuccess: async (task) => {
      toast.success(
        task.completion?.pendingApproval ? labels.waitingForApproval : labels.completionSubmitted,
      );
      setProofText('');
      setProofUrl('');
      setChecklistConfirmed(false);
      setProofFile(null);
      setUploadedAttachment(null);
      setUploadProgress(0);
      onOpenChange(false);
      onCompleted?.(task);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: taskKeys.detail(workspaceId, taskId) }),
        queryClient.invalidateQueries({ queryKey: taskKeys.all(workspaceId) }),
        queryClient.invalidateQueries({ queryKey: taskKeys.kanbanColumns(workspaceId) }),
        queryClient.invalidateQueries({
          queryKey: taskKeys.completionSubmissions(workspaceId, taskId, { page: 1, pageSize: 5 }),
        }),
        queryClient.invalidateQueries({
          queryKey: taskKeys.completionApprovals(workspaceId, { page: 1, pageSize: 5 }),
        }),
      ]);
    },
    onError: (error) => toast.error(safeCompletionError(error, labels)),
  });

  useEffect(() => {
    if (!open) {
      setProofText('');
      setProofUrl('');
      setChecklistConfirmed(false);
      setProofFile(null);
      setUploadedAttachment(null);
      setUploadProgress(0);
    }
  }, [open, workspaceId, taskId, requestedTerminalStatusDefinitionId]);

  const policy = policyQuery.data;
  const proofTypes =
    policy?.proofRequirementMode === 'SPECIFIC' ? policy.requiredProofTypes : completionProofTypes;
  const showText = proofTypes.includes('TEXT');
  const showUrl = proofTypes.includes('URL');
  const showChecklist = proofTypes.includes('CHECKLIST_CONFIRMATION');
  const showAttachment = proofTypes.includes('ATTACHMENT');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{labels.submitProof}</DialogTitle>
          <DialogDescription>{labels.completionRequired}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {policyQuery.isLoading ? <Skeleton className="h-20 w-full" /> : null}
          {showText ? (
            <Textarea
              label={labels.textProof}
              value={proofText}
              onChange={(event) => setProofText(event.target.value)}
            />
          ) : null}
          {showUrl ? (
            <Input
              label={labels.urlProof}
              value={proofUrl}
              onChange={(event) => setProofUrl(event.target.value)}
            />
          ) : null}
          {showChecklist ? (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={checklistConfirmed}
                onCheckedChange={(value) => setChecklistConfirmed(value === true)}
              />
              {labels.checklistProof}
            </label>
          ) : null}
          {showAttachment ? (
            <div className="grid gap-2 rounded-md border border-[hsl(var(--border))] p-3">
              <Input
                label={labels.uploadFileImage}
                type="file"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  setProofFile(file);
                  setUploadedAttachment(null);
                  setUploadProgress(0);
                }}
              />
              {proofFile ? (
                <p className="text-sm text-[hsl(var(--muted-foreground))]">
                  {proofFile.name} - {formatBytes(proofFile.size)}
                </p>
              ) : null}
              {proofFile && proofFile.size > largeCompletionProofFileBytes ? (
                <p className="text-sm text-[hsl(var(--muted-foreground))]">
                  {labels.largeFileSuggestion}
                </p>
              ) : null}
              {proofFile && proofFile.size > maxCompletionProofFileBytes ? (
                <p className="text-sm font-semibold text-[hsl(var(--destructive))]">
                  {labels.fileTooLarge}
                </p>
              ) : null}
              {uploadProgress > 0 ? (
                <div
                  className="h-2 rounded-full bg-[hsl(var(--surface-muted))]"
                  role="progressbar"
                  aria-label={labels.uploadFileImage}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={uploadProgress}
                >
                  <div
                    className="h-2 rounded-full bg-[hsl(var(--primary))]"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              ) : null}
              {uploadedAttachment ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-[hsl(var(--surface-muted))] p-2 text-sm">
                  <span>
                    {labels.fileUploaded}: {uploadedAttachment.displayName}
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    aria-label={labels.removeProofFile}
                    onClick={() => {
                      setUploadedAttachment(null);
                      setUploadProgress(0);
                    }}
                  >
                    <X aria-hidden="true" className="h-4 w-4" />
                    {labels.removeProofFile}
                  </Button>
                </div>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                disabled={
                  !proofFile ||
                  proofFile.size > maxCompletionProofFileBytes ||
                  uploadMutation.isPending
                }
                onClick={() => proofFile && uploadMutation.mutate(proofFile)}
              >
                {uploadMutation.isPending ? labels.uploading : labels.uploadFileImage}
              </Button>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            {labels.cancel}
          </Button>
          <Button
            type="button"
            disabled={
              !requestedTerminalStatusDefinitionId ||
              submitMutation.isPending ||
              uploadMutation.isPending
            }
            onClick={() => submitMutation.mutate()}
          >
            {submitMutation.isPending ? labels.applying : labels.submitProof}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function buildCompletionProofItems(
  policy: TaskCompletionPolicy | undefined,
  textValue: string,
  url: string,
  checklistConfirmed: boolean,
  attachmentId?: string | null,
) {
  const items = [];
  const requiredTypes =
    policy?.proofRequirementMode === 'SPECIFIC' ? policy.requiredProofTypes : completionProofTypes;
  if (requiredTypes.includes('TEXT') && textValue.trim()) {
    items.push({ type: 'TEXT' as const, textValue: textValue.trim() });
  }
  if (requiredTypes.includes('URL') && url.trim()) {
    items.push({ type: 'URL' as const, url: url.trim() });
  }
  if (requiredTypes.includes('CHECKLIST_CONFIRMATION') && checklistConfirmed) {
    items.push({ type: 'CHECKLIST_CONFIRMATION' as const, checklistConfirmed: true });
  }
  if (requiredTypes.includes('ATTACHMENT') && attachmentId) {
    items.push({ type: 'ATTACHMENT' as const, attachmentId });
  }
  return items;
}

function completionProofTypeLabel(type: TaskCompletionProofType, labels: AllTaskLabels) {
  if (type === 'TEXT') return labels.textProof;
  if (type === 'URL') return labels.urlProof;
  if (type === 'CHECKLIST_CONFIRMATION') return labels.checklistProof;
  return labels.attachmentProof;
}

function completionStatusLabel(status: string, labels: AllTaskLabels) {
  if (status === 'PENDING_APPROVAL') return labels.pendingApproval;
  if (status === 'ACCEPTED') return labels.accepted;
  return labels.rejected;
}

function MakeRecurringDialog({
  labels,
  open,
  busy,
  onOpenChange,
  onSubmit,
}: {
  labels: AllTaskLabels;
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (form: RecurrenceFormState) => void;
}) {
  const workspaceTimezone = useSessionStore((state) => {
    for (const agency of state.agencies) {
      const workspace = agency.workspaces.find((item) => item.id === state.selectedWorkspaceId);
      if (workspace) return workspace.timezone;
    }
    return 'UTC';
  });
  const [form, setForm] = useState(() => defaultRecurrenceForm(workspaceTimezone));

  useEffect(() => {
    if (open) setForm(defaultRecurrenceForm(workspaceTimezone));
  }, [open, workspaceTimezone]);

  const invalid =
    !form.startLocalDate ||
    !form.localTime ||
    !form.timezone ||
    (form.frequency === 'WEEKLY' && form.selectedWeekdays.length === 0) ||
    (form.endMode === 'ON_DATE' &&
      (!form.untilLocalDate || form.untilLocalDate < form.startLocalDate));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{labels.makeRecurring}</DialogTitle>
          <DialogDescription>{labels.makeRecurringDescription}</DialogDescription>
        </DialogHeader>
        <RecurrenceEditor labels={labels} form={form} onChange={setForm} />
        {invalid ? (
          <p className="text-sm font-semibold text-[hsl(var(--danger))]">
            {labels.fixRequiredFields}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            {labels.cancel}
          </Button>
          <Button type="button" disabled={invalid || busy} onClick={() => onSubmit(form)}>
            {labels.makeRecurring}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditRecurringTaskDialog({
  labels,
  task,
  open,
  busy,
  onOpenChange,
  onSubmit,
}: {
  labels: AllTaskLabels;
  task: WorkspaceTask;
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (form: EditTaskScopeFormState) => void;
}) {
  const [form, setForm] = useState<EditTaskScopeFormState>({
    title: task.title,
    priority: task.priority,
    scope: '',
  });

  useEffect(() => {
    if (open) setForm({ title: task.title, priority: task.priority, scope: '' });
  }, [open, task.priority, task.title]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{labels.applyChangesTo}</DialogTitle>
          <DialogDescription>{labels.editScopeDescription}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Input
            label={labels.titleLabel}
            value={form.title}
            onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
          />
          <Select
            value={form.priority}
            onValueChange={(value) =>
              setForm((current) => ({ ...current, priority: value as TaskPriority }))
            }
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
          <fieldset className="grid gap-2">
            <legend className="text-sm font-semibold">{labels.applyChangesTo}</legend>
            {editScopes.map((scope) => (
              <label
                key={scope}
                className="flex items-start gap-2 rounded-md border border-[hsl(var(--border))] p-3"
              >
                <input
                  type="radio"
                  name="recurrence-edit-scope"
                  value={scope}
                  checked={form.scope === scope}
                  onChange={() => setForm((current) => ({ ...current, scope }))}
                />
                <span>
                  <span className="block text-sm font-semibold">
                    {editScopeLabel(scope, labels)}
                  </span>
                  <span className="block text-sm text-[hsl(var(--muted-foreground))]">
                    {editScopeDescription(scope, labels)}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            {labels.cancel}
          </Button>
          <Button
            type="button"
            disabled={!form.title.trim() || !form.scope || busy}
            onClick={() => onSubmit(form)}
          >
            {labels.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecurrenceEditor({
  labels,
  form,
  onChange,
}: {
  labels: AllTaskLabels;
  form: RecurrenceFormState;
  onChange: (form: RecurrenceFormState) => void;
}) {
  return (
    <div className="grid gap-3">
      <Select
        value={form.frequency}
        onValueChange={(value) =>
          onChange({ ...form, frequency: value as TaskRecurrenceFrequency })
        }
      >
        <SelectTrigger label={labels.repeat}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {recurrenceOptions.map((option) => (
            <SelectItem key={option} value={option}>
              {recurrenceFrequencyLabel(option, labels)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label={labels.startDate}
          type="date"
          value={form.startLocalDate}
          onChange={(event) => onChange({ ...form, startLocalDate: event.target.value })}
        />
        <Input
          label={labels.time}
          type="time"
          value={form.localTime}
          onChange={(event) => onChange({ ...form, localTime: event.target.value })}
        />
        <Input
          label={labels.timezone}
          value={form.timezone}
          onChange={(event) => onChange({ ...form, timezone: event.target.value })}
        />
        {form.frequency === 'WEEKDAYS' ? (
          <p className="self-end text-sm text-[hsl(var(--muted-foreground))]">
            {labels.mondayFriday}
          </p>
        ) : null}
      </div>
      {form.frequency === 'WEEKLY' ? (
        <div className="grid gap-2">
          <p className="text-sm font-semibold">{labels.repeatOn}</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label={labels.repeatOn}>
            {[1, 2, 3, 4, 5, 6, 7].map((day) => {
              const selected = form.selectedWeekdays.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={selected}
                  className={cn(
                    'rounded-md border border-[hsl(var(--border))] px-3 py-2 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
                    selected && 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]',
                  )}
                  onClick={() =>
                    onChange({
                      ...form,
                      selectedWeekdays: selected
                        ? form.selectedWeekdays.filter((value) => value !== day)
                        : [...form.selectedWeekdays, day].sort((a, b) => a - b),
                    })
                  }
                >
                  {weekdayLabel(day, labels)}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      {form.frequency === 'MONTHLY' ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">{labels.monthlyClampHelper}</p>
      ) : null}
      {form.frequency === 'CUSTOM' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label={labels.every}
            type="number"
            min={1}
            max={365}
            value={String(form.interval)}
            onChange={(event) =>
              onChange({ ...form, interval: Math.max(1, Number(event.target.value) || 1) })
            }
          />
          <Select
            value={form.customIntervalUnit}
            onValueChange={(value) =>
              onChange({ ...form, customIntervalUnit: value as TaskRecurrenceCustomUnit })
            }
          >
            <SelectTrigger label={labels.intervalUnit}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {customRecurrenceUnits.map((unit) => (
                <SelectItem key={unit} value={unit}>
                  {customUnitLabel(unit, labels)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          value={form.endMode}
          onValueChange={(value) => onChange({ ...form, endMode: value as TaskRecurrenceEndMode })}
        >
          <SelectTrigger label={labels.ends}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {recurrenceEndModes.map((mode) => (
              <SelectItem key={mode} value={mode}>
                {endModeLabel(mode, labels)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {form.endMode === 'ON_DATE' ? (
          <Input
            label={labels.endDate}
            type="date"
            value={form.untilLocalDate}
            onChange={(event) => onChange({ ...form, untilLocalDate: event.target.value })}
          />
        ) : null}
        {form.endMode === 'AFTER_COUNT' ? (
          <Input
            label={labels.occurrences}
            type="number"
            min={1}
            max={1000}
            value={String(form.maxOccurrences)}
            onChange={(event) =>
              onChange({
                ...form,
                maxOccurrences: Math.max(1, Number(event.target.value) || 1),
              })
            }
          />
        ) : null}
      </div>
    </div>
  );
}

function RecurringSummary({
  labels,
  series,
  scheduledFor,
  busy,
  onAction,
}: {
  labels: AllTaskLabels;
  series: TaskRecurrenceSeries;
  scheduledFor: string | null;
  busy: boolean;
  onAction: (action: 'pause' | 'resume' | 'end') => void;
}) {
  return (
    <div className="grid gap-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <DetailRow label={labels.pattern} value={formatRecurrencePattern(series, labels)} />
        <DetailRow label={labels.timezone} value={series.timezone} />
        <DetailRow
          label={labels.scheduledFor}
          value={scheduledFor ? formatDateTime(scheduledFor) : labels.emptyDash}
        />
        <DetailRow
          label={labels.seriesStatus}
          value={recurrenceStatusLabel(series.status, labels)}
        />
        <DetailRow
          label={labels.nextOccurrence}
          value={
            series.nextOccurrenceAt ? formatDateTime(series.nextOccurrenceAt) : labels.emptyDash
          }
        />
        <DetailRow label={labels.generatedCount} value={String(series.generatedCount)} />
      </div>
      {series.lastErrorCode ? (
        <p className="text-sm font-semibold text-[hsl(var(--danger))]">
          {labels.needsAttention}: {series.lastErrorCode}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {series.status === 'ACTIVE' ? (
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => onAction('pause')}
          >
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
            {labels.resume}
          </Button>
        ) : null}
        {series.status !== 'ENDED' ? (
          <Button type="button" variant="secondary" disabled={busy} onClick={() => onAction('end')}>
            {labels.endRecurrence}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function SubtasksTab({
  labels,
  workspaceId,
  task,
  active,
  onSelectTask,
}: {
  labels: AllTaskLabels;
  workspaceId: string | null;
  task: WorkspaceTask;
  active: boolean;
  onSelectTask: (taskId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [createParent, setCreateParent] = useState<WorkspaceTask | null>(null);
  const [moveTask, setMoveTask] = useState<WorkspaceTask | null>(null);
  const params = useMemo(() => ({ page, pageSize }), [page, pageSize]);
  const subtasksQuery = useQuery({
    queryKey: taskKeys.subtasks(workspaceId, task.id, params),
    queryFn: () => listWorkspaceSubtasks(workspaceId as string, task.id, params),
    enabled: Boolean(active && workspaceId),
  });
  const items = subtasksQuery.data?.items ?? [];
  const total = subtasksQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / params.pageSize));

  useEffect(() => {
    setPage(1);
    setExpandedIds(new Set());
    setCreateParent(null);
    setMoveTask(null);
  }, [task.id, workspaceId]);

  function invalidateParent(parentId: string | null | undefined) {
    if (!workspaceId || !parentId) return Promise.resolve();
    return queryClient.invalidateQueries({ queryKey: taskKeys.detail(workspaceId, parentId) });
  }

  function invalidateSubtasks(parentId: string | null | undefined) {
    if (!workspaceId || !parentId) return Promise.resolve();
    return queryClient.invalidateQueries({
      queryKey: taskKeys.subtasksBase(workspaceId, parentId),
    });
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-semibold">{labels.subtasks}</h3>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">{labels.directChildrenOnly}</p>
        </div>
        <Button type="button" onClick={() => setCreateParent(task)}>
          <Plus aria-hidden="true" className="h-4 w-4" />
          {labels.createSubtask}
        </Button>
      </div>

      {subtasksQuery.isLoading ? (
        <div className="grid gap-2">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))}
        </div>
      ) : subtasksQuery.isError ? (
        <EmptyState
          title={labels.errorTitle}
          description={safeHierarchyError(subtasksQuery.error, labels)}
          action={
            <Button type="button" variant="secondary" onClick={() => void subtasksQuery.refetch()}>
              {labels.retry}
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          title={labels.noSubtasks}
          description={labels.noSubtasksDescription}
          action={
            <Button type="button" onClick={() => setCreateParent(task)}>
              <Plus aria-hidden="true" className="h-4 w-4" />
              {labels.createSubtask}
            </Button>
          }
        />
      ) : (
        <div className="grid gap-2" role="tree" aria-label={labels.subtasks}>
          {items.map((child) => (
            <SubtaskTreeNode
              key={child.id}
              labels={labels}
              workspaceId={workspaceId}
              task={child}
              depth={0}
              ancestorIds={new Set([task.id])}
              expandedIds={expandedIds}
              onExpandedChange={setExpandedIds}
              onSelectTask={onSelectTask}
              onCreateSubtask={setCreateParent}
              onMoveTask={setMoveTask}
            />
          ))}
        </div>
      )}

      {totalPages > 1 ? (
        <TaskPagination
          labels={labels}
          page={page}
          pageSize={params.pageSize}
          total={total}
          totalPages={totalPages}
          onPage={setPage}
          onPageSize={(nextPageSize) => {
            setPageSize(nextPageSize);
            setPage(1);
          }}
        />
      ) : null}

      <CreateSubtaskDialog
        labels={labels}
        workspaceId={workspaceId}
        parent={createParent}
        onOpenChange={(open) => {
          if (!open) setCreateParent(null);
        }}
        onCreated={async (parentId, createdTaskId) => {
          if (!workspaceId) return;
          await Promise.all([
            invalidateSubtasks(parentId),
            queryClient.invalidateQueries({ queryKey: taskKeys.detail(workspaceId, parentId) }),
            queryClient.invalidateQueries({ queryKey: taskKeys.detail(workspaceId, task.id) }),
            queryClient.invalidateQueries({
              queryKey: taskKeys.detail(workspaceId, createdTaskId),
            }),
          ]);
        }}
      />

      <MoveTaskDialog
        labels={labels}
        workspaceId={workspaceId}
        task={moveTask}
        onOpenChange={(open) => {
          if (!open) setMoveTask(null);
        }}
        onMoved={async (moved, oldParentId, newParentId) => {
          if (!workspaceId) return;
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: taskKeys.detail(workspaceId, moved.id) }),
            invalidateParent(oldParentId),
            invalidateParent(newParentId),
            invalidateSubtasks(oldParentId),
            invalidateSubtasks(newParentId),
            invalidateSubtasks(task.id),
          ]);
        }}
      />
    </div>
  );
}

function SubtaskTreeNode({
  labels,
  workspaceId,
  task,
  depth,
  ancestorIds,
  expandedIds,
  onExpandedChange,
  onSelectTask,
  onCreateSubtask,
  onMoveTask,
}: {
  labels: AllTaskLabels;
  workspaceId: string | null;
  task: WorkspaceTask;
  depth: number;
  ancestorIds: Set<string>;
  expandedIds: Set<string>;
  onExpandedChange: (updater: (current: Set<string>) => Set<string>) => void;
  onSelectTask: (taskId: string) => void;
  onCreateSubtask: (task: WorkspaceTask) => void;
  onMoveTask: (task: WorkspaceTask) => void;
}) {
  const expanded = expandedIds.has(task.id);
  const [page, setPage] = useState(1);
  const params = useMemo(() => ({ page, pageSize: 5 }), [page]);
  const hasPotentialChildren = (task.directSubtaskCount ?? 0) > 0;
  const repeatedInPath = ancestorIds.has(task.id);
  const childQuery = useQuery({
    queryKey: taskKeys.subtasks(workspaceId, task.id, params),
    queryFn: () => listWorkspaceSubtasks(workspaceId as string, task.id, params),
    enabled: Boolean(workspaceId && expanded && !repeatedInPath),
  });
  const children = childQuery.data?.items ?? [];
  const total = childQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / params.pageSize));
  const indent = Math.min(depth, 6) * 14;
  const nextAncestorIds = useMemo(() => new Set([...ancestorIds, task.id]), [ancestorIds, task.id]);

  function toggle() {
    onExpandedChange((current) => {
      const next = new Set(current);
      if (next.has(task.id)) next.delete(task.id);
      else next.add(task.id);
      return next;
    });
  }

  if (repeatedInPath) {
    return (
      <div
        role="treeitem"
        className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-3 text-sm text-[hsl(var(--muted-foreground))]"
        style={{ marginLeft: indent }}
      >
        {labels.hierarchyCycleDetected}
      </div>
    );
  }

  return (
    <div role="treeitem" aria-expanded={hasPotentialChildren ? expanded : undefined}>
      <div
        className="grid gap-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-3 transition-colors hover:bg-[hsl(var(--surface-muted))]"
        style={{ marginLeft: indent }}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-2">
            <Button
              type="button"
              variant="ghost"
              className="h-8 w-8 shrink-0 p-0"
              aria-label={expanded ? labels.collapse : labels.expand}
              aria-expanded={hasPotentialChildren ? expanded : undefined}
              disabled={!hasPotentialChildren}
              onClick={toggle}
            >
              {expanded ? (
                <ChevronDown aria-hidden="true" className="h-4 w-4" />
              ) : (
                <ChevronRight aria-hidden="true" className="h-4 w-4" />
              )}
            </Button>
            <div className="min-w-0">
              <button
                type="button"
                className="break-words text-left text-sm font-semibold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
                onClick={() => onSelectTask(task.id)}
              >
                {task.title}
              </button>
              <div className="mt-2 flex flex-wrap gap-2">
                <StatusBadge task={task} />
                <Badge variant={priorityBadge(task.priority)}>
                  {priorityLabel(task.priority, labels)}
                </Badge>
                <DueStateBadge task={task} labels={labels} />
                <Badge variant="neutral">
                  {labels.subtasks}: {task.directSubtaskCount ?? 0}
                </Badge>
              </div>
              <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
                {assigneeSummary(task, labels)}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <Button type="button" variant="secondary" onClick={() => onMoveTask(task)}>
              <MoveRight aria-hidden="true" className="h-4 w-4" />
              {labels.changeParent}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="secondary"
                  aria-label={`${labels.actions}: ${task.title}`}
                >
                  <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
                  {labels.actions}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => onSelectTask(task.id)}>
                  {labels.viewTask}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onCreateSubtask(task)}>
                  {labels.createSubtask}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onMoveTask(task)}>
                  {labels.changeParent}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
      {expanded ? (
        <div className="mt-2 grid gap-2" role="group">
          {childQuery.isLoading ? (
            <Skeleton className="h-14 w-full" />
          ) : childQuery.isError ? (
            <div
              className="rounded-md border border-[hsl(var(--border))] p-3"
              style={{ marginLeft: indent + 14 }}
            >
              <p className="text-sm text-[hsl(var(--danger))]">
                {safeHierarchyError(childQuery.error, labels)}
              </p>
              <Button type="button" variant="secondary" onClick={() => void childQuery.refetch()}>
                {labels.retry}
              </Button>
            </div>
          ) : (
            <>
              {children.map((child) => (
                <SubtaskTreeNode
                  key={child.id}
                  labels={labels}
                  workspaceId={workspaceId}
                  task={child}
                  depth={depth + 1}
                  ancestorIds={nextAncestorIds}
                  expandedIds={expandedIds}
                  onExpandedChange={onExpandedChange}
                  onSelectTask={onSelectTask}
                  onCreateSubtask={onCreateSubtask}
                  onMoveTask={onMoveTask}
                />
              ))}
              {totalPages > 1 ? (
                <div
                  className="flex flex-wrap items-center gap-2"
                  style={{ marginLeft: indent + 14 }}
                >
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={page <= 1}
                    onClick={() => setPage((value) => Math.max(1, value - 1))}
                  >
                    {labels.previous}
                  </Button>
                  <span className="text-sm text-[hsl(var(--muted-foreground))]">
                    {labels.page} {page} / {totalPages}
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={page >= totalPages}
                    onClick={() => setPage((value) => value + 1)}
                  >
                    {labels.next}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function DependenciesTab({
  labels,
  workspaceId,
  task,
  active,
  onSelectTask,
}: {
  labels: AllTaskLabels;
  workspaceId: string | null;
  task: WorkspaceTask;
  active: boolean;
  onSelectTask: (taskId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [blockedByPage, setBlockedByPage] = useState(1);
  const [blocksPage, setBlocksPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const removeLockedRef = useRef(false);
  const blockedByParams = useMemo(() => ({ page: blockedByPage, pageSize: 10 }), [blockedByPage]);
  const blocksParams = useMemo(() => ({ page: blocksPage, pageSize: 10 }), [blocksPage]);
  const blockedByQuery = useQuery({
    queryKey: taskKeys.blockedBy(workspaceId, task.id, blockedByParams),
    queryFn: () => listWorkspaceTaskBlockedBy(workspaceId as string, task.id, blockedByParams),
    enabled: Boolean(active && workspaceId),
  });
  const blocksQuery = useQuery({
    queryKey: taskKeys.blocks(workspaceId, task.id, blocksParams),
    queryFn: () => listWorkspaceTaskBlocks(workspaceId as string, task.id, blocksParams),
    enabled: Boolean(active && workspaceId),
  });
  const removeMutation = useMutation({
    mutationFn: (blockerTaskId: string) => {
      if (!workspaceId) throw new Error(labels.noWorkspace);
      return removeWorkspaceTaskBlockedBy(workspaceId, task.id, [blockerTaskId]);
    },
    onSuccess: async (result, blockerTaskId) => {
      await invalidateDependencyQueries(queryClient, workspaceId, task.id, blockerTaskId);
      toast.success(relationshipSuccessMessage(labels, result, labels.blockerRemoved));
    },
    onError: (error) => toast.error(safeRelationshipError(error, labels)),
    onSettled: () => {
      removeLockedRef.current = false;
    },
  });

  useEffect(() => {
    setBlockedByPage(1);
    setBlocksPage(1);
    setAddOpen(false);
    removeLockedRef.current = false;
  }, [task.id, workspaceId]);

  function removeBlocker(blockerTaskId: string) {
    if (removeMutation.isPending || removeLockedRef.current) return;
    removeLockedRef.current = true;
    removeMutation.mutate(blockerTaskId);
  }

  return (
    <div className="grid gap-4">
      <RelationshipSection
        labels={labels}
        title={labels.blockedBy}
        description={labels.blockedByDescription}
        emptyTitle={labels.noActiveBlockers}
        query={blockedByQuery}
        page={blockedByPage}
        pageSize={blockedByParams.pageSize}
        onPage={setBlockedByPage}
        onSelectTask={onSelectTask}
        action={
          <Button type="button" onClick={() => setAddOpen(true)}>
            <Plus aria-hidden="true" className="h-4 w-4" />
            {labels.addBlocker}
          </Button>
        }
        rowAction={(item) => (
          <Button
            type="button"
            variant="secondary"
            aria-label={`${labels.removeBlocker}: ${item.title}`}
            disabled={removeMutation.isPending}
            onClick={() => removeBlocker(item.id)}
          >
            <X aria-hidden="true" className="h-4 w-4" />
            {labels.removeBlocker}
          </Button>
        )}
      />
      <RelationshipSection
        labels={labels}
        title={labels.blocks}
        description={labels.blocksDescription}
        emptyTitle={labels.notBlockingTasks}
        query={blocksQuery}
        page={blocksPage}
        pageSize={blocksParams.pageSize}
        onPage={setBlocksPage}
        onSelectTask={onSelectTask}
      />
      <TaskRelationshipDialog
        labels={labels}
        workspaceId={workspaceId}
        task={task}
        open={addOpen}
        mode="blocker"
        onOpenChange={setAddOpen}
        onSaved={async (result, selectedIds) => {
          await Promise.all([
            invalidateDependencyQueries(queryClient, workspaceId, task.id),
            ...selectedIds.map((id) =>
              invalidateDependencyCounterpartQueries(queryClient, workspaceId, id),
            ),
          ]);
          toast.success(relationshipSuccessMessage(labels, result, labels.blockersAdded));
        }}
      />
    </div>
  );
}

function RelatedTasksTab({
  labels,
  workspaceId,
  task,
  active,
  onSelectTask,
}: {
  labels: AllTaskLabels;
  workspaceId: string | null;
  task: WorkspaceTask;
  active: boolean;
  onSelectTask: (taskId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const removeLockedRef = useRef(false);
  const params = useMemo(() => ({ page, pageSize: 10 }), [page]);
  const relatedQuery = useQuery({
    queryKey: taskKeys.related(workspaceId, task.id, params),
    queryFn: () => listWorkspaceTaskRelated(workspaceId as string, task.id, params),
    enabled: Boolean(active && workspaceId),
  });
  const removeMutation = useMutation({
    mutationFn: (relatedTaskId: string) => {
      if (!workspaceId) throw new Error(labels.noWorkspace);
      return removeWorkspaceTaskRelated(workspaceId, task.id, [relatedTaskId]);
    },
    onSuccess: async (result, relatedTaskId) => {
      await invalidateRelatedQueries(queryClient, workspaceId, task.id, [relatedTaskId]);
      toast.success(relationshipSuccessMessage(labels, result, labels.relatedRemoved));
    },
    onError: (error) => toast.error(safeRelationshipError(error, labels)),
    onSettled: () => {
      removeLockedRef.current = false;
    },
  });

  useEffect(() => {
    setPage(1);
    setAddOpen(false);
    removeLockedRef.current = false;
  }, [task.id, workspaceId]);

  function removeRelatedTask(relatedTaskId: string) {
    if (removeMutation.isPending || removeLockedRef.current) return;
    removeLockedRef.current = true;
    removeMutation.mutate(relatedTaskId);
  }

  return (
    <div className="grid gap-4">
      <RelationshipSection
        labels={labels}
        title={labels.relatedTasks}
        description={labels.relatedDescription}
        emptyTitle={labels.noRelatedTasks}
        query={relatedQuery}
        page={page}
        pageSize={params.pageSize}
        onPage={setPage}
        onSelectTask={onSelectTask}
        action={
          <Button type="button" onClick={() => setAddOpen(true)}>
            <Plus aria-hidden="true" className="h-4 w-4" />
            {labels.addRelatedTask}
          </Button>
        }
        rowAction={(item) => (
          <Button
            type="button"
            variant="secondary"
            aria-label={`${labels.removeRelatedTask}: ${item.title}`}
            disabled={removeMutation.isPending}
            onClick={() => removeRelatedTask(item.id)}
          >
            <X aria-hidden="true" className="h-4 w-4" />
            {labels.removeRelatedTask}
          </Button>
        )}
      />
      <TaskRelationshipDialog
        labels={labels}
        workspaceId={workspaceId}
        task={task}
        open={addOpen}
        mode="related"
        onOpenChange={setAddOpen}
        onSaved={async (result, selectedIds) => {
          await invalidateRelatedQueries(queryClient, workspaceId, task.id, selectedIds);
          toast.success(relationshipSuccessMessage(labels, result, labels.relatedAdded));
        }}
      />
    </div>
  );
}

function RelationshipSection({
  labels,
  title,
  description,
  emptyTitle,
  query,
  page,
  pageSize,
  action,
  rowAction,
  onPage,
  onSelectTask,
}: {
  labels: AllTaskLabels;
  title: string;
  description: string;
  emptyTitle: string;
  query: ReturnType<typeof useQuery<PageResultLike<WorkspaceTaskRelationship>>>;
  page: number;
  pageSize: number;
  action?: ReactNode;
  rowAction?: (task: WorkspaceTaskRelationship) => ReactNode;
  onPage: (page: number) => void;
  onSelectTask: (taskId: string) => void;
}) {
  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    if (query.isSuccess && page > totalPages) onPage(totalPages);
  }, [onPage, page, query.isSuccess, totalPages]);

  return (
    <section className="grid gap-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-base font-semibold">{title}</h3>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">{description}</p>
        </div>
        {action}
      </div>
      {query.isLoading ? (
        <div className="grid gap-2" aria-label={labels.loadingRelationships}>
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-20 w-full" />
          ))}
        </div>
      ) : query.isError ? (
        <EmptyState
          title={labels.errorTitle}
          description={safeRelationshipError(query.error, labels)}
          action={
            <Button type="button" variant="secondary" onClick={() => void query.refetch()}>
              {labels.retry}
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState title={emptyTitle} description={description} action={action} />
      ) : (
        <div className="grid gap-2" role="list" aria-label={title}>
          {items.map((item) => (
            <RelationshipTaskRow
              key={item.id}
              labels={labels}
              task={item}
              action={rowAction?.(item)}
              onSelectTask={onSelectTask}
            />
          ))}
        </div>
      )}
      {totalPages > 1 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={page <= 1}
            onClick={() => onPage(Math.max(1, page - 1))}
          >
            {labels.previous}
          </Button>
          <span className="text-sm text-[hsl(var(--muted-foreground))]">
            {labels.page} {page} / {totalPages}
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
      ) : null}
    </section>
  );
}

function RelationshipTaskRow({
  labels,
  task,
  action,
  onSelectTask,
}: {
  labels: AllTaskLabels;
  task: WorkspaceTaskRelationship;
  action?: ReactNode;
  onSelectTask: (taskId: string) => void;
}) {
  return (
    <div
      role="listitem"
      className="flex flex-col gap-3 rounded-md border border-[hsl(var(--border))] p-3 sm:flex-row sm:items-start sm:justify-between"
    >
      <div className="min-w-0">
        <button
          type="button"
          aria-label={`${labels.openTaskDetails}: ${task.title}`}
          className="break-words text-left text-sm font-semibold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          onClick={() => onSelectTask(task.id)}
        >
          {task.title}
        </button>
        <div className="mt-2 flex flex-wrap gap-2">
          <StatusBadge task={task as WorkspaceTask} />
          <Badge variant={task.status.isTerminal ? 'success' : 'info'}>
            {task.status.isTerminal ? labels.terminalTask : labels.activeTask}
          </Badge>
          <Badge variant={priorityBadge(task.priority)}>
            {priorityLabel(task.priority, labels)}
          </Badge>
          <span className="text-xs text-[hsl(var(--muted-foreground))]">
            {task.dueAt ? formatDateTime(task.dueAt) : labels.noDueDate}
          </span>
        </div>
        <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
          {assigneeSummary(task as WorkspaceTask, labels)}
        </p>
      </div>
      {action ? <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">{action}</div> : null}
    </div>
  );
}

function TaskRelationshipDialog({
  labels,
  workspaceId,
  task,
  open,
  mode,
  onOpenChange,
  onSaved,
}: {
  labels: AllTaskLabels;
  workspaceId: string | null;
  task: WorkspaceTask;
  open: boolean;
  mode: 'blocker' | 'related';
  onOpenChange: (open: boolean) => void;
  onSaved: (result: TaskRelationshipResult, selectedIds: string[]) => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [selectedTasks, setSelectedTasks] = useState<WorkspaceTaskRelationship[]>([]);
  const submitLockedRef = useRef(false);
  const contextKeyRef = useRef(`${workspaceId ?? 'none'}:${task.id}`);
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const params = useMemo(() => ({ page: 1, pageSize: 10 }), []);
  const selectedIds = useMemo(() => selectedTasks.map((item) => item.id), [selectedTasks]);
  const candidatesQuery = useQuery({
    queryKey: taskKeys.relationshipSearch(workspaceId, task.id, debouncedSearch, params),
    queryFn: () =>
      listWorkspaceTasks(workspaceId as string, {
        ...params,
        search: debouncedSearch.length >= 2 ? debouncedSearch : undefined,
        sortBy: 'title',
        sortDirection: 'asc',
      }),
    enabled: Boolean(workspaceId && open),
  });
  const mutation = useMutation({
    mutationFn: () => {
      if (!workspaceId) throw new Error(labels.noWorkspace);
      if (selectedIds.length === 0) throw new Error(labels.selectRelationshipTasks);
      if (selectedIds.length > 100) throw new Error(labels.relationshipSelectionLimit);
      return mode === 'blocker'
        ? addWorkspaceTaskBlockedBy(workspaceId, task.id, selectedIds)
        : addWorkspaceTaskRelated(workspaceId, task.id, selectedIds);
    },
    onSuccess: async (result) => {
      await onSaved(result, selectedIds);
      submitLockedRef.current = false;
      setSelectedTasks([]);
      setSearch('');
      onOpenChange(false);
    },
    onError: (error) => {
      submitLockedRef.current = false;
      toast.error(safeRelationshipError(error, labels));
    },
  });
  const candidates = (candidatesQuery.data?.items ?? []).filter(
    (candidate) => candidate.id !== task.id,
  );
  const title = mode === 'blocker' ? labels.addBlocker : labels.addRelatedTask;
  const description =
    mode === 'blocker' ? labels.addBlockerDescription : labels.addRelatedDescription;
  const selectionLimitReached = selectedIds.length >= 100;

  useEffect(() => {
    const contextKey = `${workspaceId ?? 'none'}:${task.id}`;
    if (open && contextKeyRef.current !== contextKey) {
      submitLockedRef.current = false;
      setSearch('');
      setSelectedTasks([]);
      onOpenChange(false);
    }
    contextKeyRef.current = contextKey;
  }, [onOpenChange, open, task.id, workspaceId]);

  useEffect(() => {
    if (!open) {
      submitLockedRef.current = false;
      setSearch('');
      setSelectedTasks([]);
    }
  }, [open]);

  function toggleCandidate(candidate: WorkspaceTaskRelationship) {
    setSelectedTasks((current) => toggleRelationshipSelection(current, candidate));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!mutation.isPending && !submitLockedRef.current) {
              submitLockedRef.current = true;
              mutation.mutate();
            }
          }}
        >
          <Input
            label={labels.searchTasks}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={labels.searchTasks}
          />
          <div className="grid gap-2">
            <p className="text-sm font-semibold">{labels.selectedTasks}</p>
            <div className="flex min-h-9 flex-wrap gap-2 rounded-md border border-[hsl(var(--border))] p-2">
              {selectedIds.length === 0 ? (
                <span className="text-sm text-[hsl(var(--muted-foreground))]">
                  {labels.noTasksSelected}
                </span>
              ) : (
                selectedTasks.map((selectedTask) => {
                  return (
                    <button
                      key={selectedTask.id}
                      type="button"
                      aria-label={`${labels.removeSelectedTask}: ${selectedTask.title}`}
                      className="inline-flex items-center gap-1 rounded-full border border-[hsl(var(--border))] px-2 py-1 text-xs font-semibold"
                      onClick={() =>
                        setSelectedTasks((current) =>
                          current.filter((item) => item.id !== selectedTask.id),
                        )
                      }
                    >
                      {selectedTask.title}
                      <X aria-hidden="true" className="h-3 w-3" />
                    </button>
                  );
                })
              )}
            </div>
            {selectionLimitReached ? (
              <p className="text-xs font-semibold text-[hsl(var(--danger))]">
                {labels.relationshipSelectionLimit}
              </p>
            ) : null}
          </div>
          <div className="grid max-h-72 gap-2 overflow-y-auto rounded-md border border-[hsl(var(--border))] p-2">
            {candidatesQuery.isLoading ? <Skeleton className="h-16 w-full" /> : null}
            {candidatesQuery.isError ? (
              <p className="text-sm text-[hsl(var(--danger))]">
                {safeRelationshipError(candidatesQuery.error, labels)}
              </p>
            ) : null}
            {!candidatesQuery.isLoading && !candidatesQuery.isError && candidates.length === 0 ? (
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                {labels.noMatchingTasks}
              </p>
            ) : null}
            {candidates.map((candidate) => {
              const checked = selectedIds.includes(candidate.id);
              const disabled = !checked && selectionLimitReached;
              return (
                <button
                  key={candidate.id}
                  type="button"
                  className={[
                    'grid gap-2 rounded-md border p-3 text-left',
                    checked
                      ? 'border-[hsl(var(--primary))] bg-[hsl(var(--surface-muted))]'
                      : 'border-[hsl(var(--border))]',
                  ].join(' ')}
                  aria-pressed={checked}
                  disabled={disabled}
                  onClick={() => toggleCandidate(candidate)}
                >
                  <span className="font-semibold">{candidate.title}</span>
                  <span className="flex flex-wrap gap-2">
                    <StatusBadge task={candidate} />
                    <Badge variant={candidate.status.isTerminal ? 'success' : 'info'}>
                      {candidate.status.isTerminal ? labels.terminalTask : labels.activeTask}
                    </Badge>
                    <Badge variant={priorityBadge(candidate.priority)}>
                      {priorityLabel(candidate.priority, labels)}
                    </Badge>
                    <span className="text-xs text-[hsl(var(--muted-foreground))]">
                      {candidate.dueAt ? formatDateTime(candidate.dueAt) : labels.noDueDate}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              {labels.cancel}
            </Button>
            <Button type="submit" disabled={mutation.isPending || selectedIds.length === 0}>
              {mutation.isPending ? labels.applying : title}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreateSubtaskDialog({
  labels,
  workspaceId,
  parent,
  onOpenChange,
  onCreated,
}: {
  labels: AllTaskLabels;
  workspaceId: string | null;
  parent: WorkspaceTask | null;
  onOpenChange: (open: boolean) => void;
  onCreated: (parentTaskId: string, createdTaskId: string) => Promise<void>;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [form, setForm] = useState(() => defaultSubtaskForm());
  const [assigneeSearch, setAssigneeSearch] = useState('');
  const [projectSearch, setProjectSearch] = useState('');
  const submitLockedRef = useRef(false);
  const debouncedAssigneeSearch = useDebouncedValue(assigneeSearch.trim(), 300);
  const debouncedProjectSearch = useDebouncedValue(projectSearch.trim(), 300);
  const usersQuery = useQuery({
    queryKey: taskCreationKeys.users(workspaceId, `subtask:${debouncedAssigneeSearch}`),
    queryFn: () =>
      listWorkspaceUsers({
        workspaceId: workspaceId as string,
        page: 1,
        pageSize: 10,
        search: debouncedAssigneeSearch.length >= 2 ? debouncedAssigneeSearch : undefined,
      }),
    enabled: Boolean(workspaceId && parent),
  });
  const statusesQuery = useQuery({
    queryKey: taskCreationKeys.statuses(workspaceId),
    queryFn: () => listWorkspaceStatuses(workspaceId as string, 'TASK', 'ACTIVE'),
    enabled: Boolean(workspaceId && parent && advancedOpen),
    staleTime: 30_000,
  });
  const departmentsQuery = useQuery({
    queryKey: taskCreationKeys.departments(workspaceId),
    queryFn: () =>
      listDepartments({ workspaceId: workspaceId as string, pageSize: 100, status: 'ACTIVE' }),
    enabled: Boolean(workspaceId && parent && advancedOpen),
    staleTime: 30_000,
  });
  const projectsQuery = useQuery({
    queryKey: taskCreationKeys.projects(workspaceId, `subtask:${debouncedProjectSearch}`),
    queryFn: () =>
      listWorkspaceProjects({
        workspaceId: workspaceId as string,
        page: 1,
        pageSize: 10,
        search: debouncedProjectSearch.length >= 2 ? debouncedProjectSearch : undefined,
      }),
    enabled: Boolean(workspaceId && parent && advancedOpen),
  });
  const createMutation = useMutation({
    mutationFn: async () => {
      if (!workspaceId || !parent) throw new Error(labels.noWorkspace);
      if (!form.title.trim()) throw new Error(labels.titleRequired);
      if (!form.assigneeMembershipId) throw new Error(labels.selectAssignees);
      if (!form.dueDate) throw new Error(labels.dueDateRequired);
      const payload: CreateTaskPayload = {
        title: form.title,
        dueAt: taskDueAtFromLocalDate(form.dueDate, form.dueTime),
        assigneeMembershipIds: uniqueIds([
          form.assigneeMembershipId,
          ...form.additionalAssigneeMembershipIds,
        ]),
        ...(form.description.trim() ? { description: form.description.trim() } : {}),
        ...(form.priority === 'MEDIUM' ? {} : { priority: form.priority }),
        ...(form.statusDefinitionId ? { statusDefinitionId: form.statusDefinitionId } : {}),
        ...(form.departmentId ? { departmentId: form.departmentId } : {}),
        ...(form.followerMembershipIds.length
          ? { followerMembershipIds: form.followerMembershipIds }
          : {}),
        ...(form.projectIds.length ? { projectIds: form.projectIds } : {}),
      };
      return createWorkspaceSubtask(workspaceId, parent.id, payload);
    },
    onSuccess: async (created) => {
      if (parent) await onCreated(parent.id, created.id);
      toast.success(labels.subtaskCreated);
      submitLockedRef.current = false;
      setForm(defaultSubtaskForm());
      setAdvancedOpen(false);
      onOpenChange(false);
    },
    onError: (error) => {
      submitLockedRef.current = false;
      toast.error(safeHierarchyError(error, labels));
    },
  });
  const users = usersQuery.data?.items ?? [];
  const statuses = statusesQuery.data ?? [];
  const departments = departmentsQuery.data?.items ?? [];
  const projects = projectsQuery.data?.items ?? [];

  useEffect(() => {
    if (!parent) {
      submitLockedRef.current = false;
      setForm(defaultSubtaskForm());
      setAdvancedOpen(false);
      setAssigneeSearch('');
      setProjectSearch('');
    }
  }, [parent]);

  return (
    <Dialog open={Boolean(parent)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{labels.createSubtask}</DialogTitle>
          <DialogDescription>
            {parent ? `${labels.parentTask}: ${parent.title}` : labels.directChildrenOnly}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!createMutation.isPending && !submitLockedRef.current) {
              submitLockedRef.current = true;
              createMutation.mutate();
            }
          }}
        >
          <Input
            label={labels.titleLabel}
            required
            value={form.title}
            onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
          />
          <SimpleUserSelector
            labels={labels}
            label={labels.assignee}
            users={users}
            search={assigneeSearch}
            selectedIds={form.assigneeMembershipId ? [form.assigneeMembershipId] : []}
            onSearch={setAssigneeSearch}
            onToggle={(membershipId) =>
              setForm((current) => ({ ...current, assigneeMembershipId: membershipId }))
            }
            single
          />
          <Input
            label={labels.dueDate}
            required
            type="date"
            value={form.dueDate}
            onChange={(event) =>
              setForm((current) => ({ ...current, dueDate: event.target.value }))
            }
          />
          <Button
            type="button"
            variant="secondary"
            className="justify-start"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((value) => !value)}
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            {labels.addMoreDetails}
          </Button>
          {advancedOpen ? (
            <div className="grid gap-4 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
              <Textarea
                label={labels.descriptionField}
                value={form.description}
                onChange={(event) =>
                  setForm((current) => ({ ...current, description: event.target.value }))
                }
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <Select
                  value={form.priority}
                  onValueChange={(priority) =>
                    setForm((current) => ({ ...current, priority: priority as TaskPriority }))
                  }
                >
                  <SelectTrigger label={labels.priority}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {priorities.map((priority) => (
                      <SelectItem key={priority} value={priority}>
                        {priorityLabel(priority, labels)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  label={labels.dueTime}
                  type="time"
                  value={form.dueTime}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, dueTime: event.target.value }))
                  }
                />
                <Select
                  value={form.statusDefinitionId || noneValue}
                  onValueChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      statusDefinitionId: value === noneValue ? '' : value,
                    }))
                  }
                >
                  <SelectTrigger label={labels.status}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={noneValue}>{labels.backendDefault}</SelectItem>
                    {statuses.map((status) => (
                      <SelectItem key={status.id} value={status.id}>
                        {status.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={form.departmentId || noneValue}
                  onValueChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      departmentId: value === noneValue ? '' : value,
                    }))
                  }
                >
                  <SelectTrigger label={labels.department}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={noneValue}>{labels.none}</SelectItem>
                    {departments.map((department) => (
                      <SelectItem key={department.id} value={department.id}>
                        {department.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <SimpleUserSelector
                labels={labels}
                label={labels.additionalAssignees}
                users={users}
                search={assigneeSearch}
                selectedIds={form.additionalAssigneeMembershipIds}
                onSearch={setAssigneeSearch}
                onToggle={(membershipId) =>
                  setForm((current) => ({
                    ...current,
                    additionalAssigneeMembershipIds: toggleId(
                      current.additionalAssigneeMembershipIds,
                      membershipId,
                    ),
                  }))
                }
              />
              <SimpleUserSelector
                labels={labels}
                label={labels.followers}
                users={users}
                search={assigneeSearch}
                selectedIds={form.followerMembershipIds}
                onSearch={setAssigneeSearch}
                onToggle={(membershipId) =>
                  setForm((current) => ({
                    ...current,
                    followerMembershipIds: toggleId(current.followerMembershipIds, membershipId),
                  }))
                }
              />
              <ProjectSelector
                labels={labels}
                projects={projects}
                search={projectSearch}
                selectedIds={form.projectIds}
                onSearch={setProjectSearch}
                onToggle={(projectId) =>
                  setForm((current) => ({
                    ...current,
                    projectIds: toggleId(current.projectIds, projectId),
                  }))
                }
              />
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              {labels.cancel}
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? labels.creating : labels.createSubtask}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MoveTaskDialog({
  labels,
  workspaceId,
  task,
  onOpenChange,
  onMoved,
}: {
  labels: AllTaskLabels;
  workspaceId: string | null;
  task: WorkspaceTask | null;
  onOpenChange: (open: boolean) => void;
  onMoved: (
    moved: WorkspaceTask,
    oldParentId: string | null | undefined,
    newParentId: string | null,
  ) => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [selectedParentId, setSelectedParentId] = useState<string | null | undefined>(undefined);
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const currentParentId = task?.parentTaskId ?? null;
  const hasMoveSelection = selectedParentId !== undefined;
  const unchangedMove = hasMoveSelection && selectedParentId === currentParentId;
  const candidatesQuery = useQuery({
    queryKey: taskKeys.list(
      workspaceId,
      normalizeTaskListParams({
        page: 1,
        pageSize: 10,
        search: debouncedSearch.length >= 2 ? debouncedSearch : undefined,
        sortBy: 'title',
        sortDirection: 'asc',
      }),
    ),
    queryFn: () =>
      listWorkspaceTasks(workspaceId as string, {
        page: 1,
        pageSize: 10,
        search: debouncedSearch.length >= 2 ? debouncedSearch : undefined,
        sortBy: 'title',
        sortDirection: 'asc',
      }),
    enabled: Boolean(workspaceId && task),
  });
  const moveMutation = useMutation({
    mutationFn: async () => {
      if (!workspaceId || !task || selectedParentId === undefined)
        throw new Error(labels.selectParent);
      if (selectedParentId === currentParentId) throw new Error(labels.unchangedParent);
      return updateWorkspaceTaskParent(workspaceId, task.id, selectedParentId);
    },
    onSuccess: async (moved) => {
      await onMoved(moved, task?.parentTaskId, selectedParentId ?? null);
      toast.success(labels.taskMoved);
      onOpenChange(false);
    },
    onError: (error) => toast.error(safeMoveError(error, labels)),
  });
  const candidates = (candidatesQuery.data?.items ?? []).filter(
    (candidate) => candidate.id !== task?.id,
  );

  useEffect(() => {
    setSearch('');
    setSelectedParentId(undefined);
  }, [task?.id, workspaceId]);

  return (
    <Dialog open={Boolean(task)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{labels.moveTask}</DialogTitle>
          <DialogDescription>{task?.title}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <DetailRow label={labels.currentParent} value={task?.parent?.title ?? labels.rootTask} />
          <Input
            label={labels.newParent}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={labels.searchTasks}
          />
          <div className="grid gap-2">
            <button
              type="button"
              className={[
                'flex items-center justify-between rounded-md border p-3 text-left text-sm font-semibold',
                selectedParentId === null
                  ? 'border-[hsl(var(--primary))] bg-[hsl(var(--surface-muted))]'
                  : 'border-[hsl(var(--border))]',
                currentParentId === null ? 'cursor-not-allowed opacity-60' : '',
              ].join(' ')}
              disabled={currentParentId === null}
              onClick={() => setSelectedParentId(null)}
            >
              <span>{labels.moveToRoot}</span>
              <CornerDownRight aria-hidden="true" className="h-4 w-4" />
            </button>
            {candidates.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                className={[
                  'grid gap-2 rounded-md border p-3 text-left',
                  selectedParentId === candidate.id
                    ? 'border-[hsl(var(--primary))] bg-[hsl(var(--surface-muted))]'
                    : 'border-[hsl(var(--border))]',
                  candidate.id === currentParentId ? 'cursor-not-allowed opacity-60' : '',
                ].join(' ')}
                disabled={candidate.id === currentParentId}
                onClick={() => setSelectedParentId(candidate.id)}
              >
                <span className="font-semibold">{candidate.title}</span>
                <span className="flex flex-wrap gap-2">
                  <StatusBadge task={candidate} />
                  <Badge variant={priorityBadge(candidate.priority)}>
                    {priorityLabel(candidate.priority, labels)}
                  </Badge>
                  <span className="text-xs text-[hsl(var(--muted-foreground))]">
                    {candidate.dueAt ? formatDateTime(candidate.dueAt) : labels.noDueDate}
                  </span>
                </span>
              </button>
            ))}
            {candidatesQuery.isLoading ? <Skeleton className="h-14 w-full" /> : null}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            {labels.cancel}
          </Button>
          <Button
            type="button"
            disabled={moveMutation.isPending || selectedParentId === undefined || unchangedMove}
            onClick={() => moveMutation.mutate()}
          >
            <MoveRight aria-hidden="true" className="h-4 w-4" />
            {labels.move}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({
  label,
  value,
  actionLabel,
  onAction,
}: {
  label: string;
  value: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="rounded-md border border-[hsl(var(--border))] p-3">
      <p className="text-xs font-semibold uppercase text-[hsl(var(--muted-foreground))]">{label}</p>
      <div className="mt-1 flex items-center justify-between gap-2">
        <p className="break-words text-sm font-semibold">{value}</p>
        {actionLabel && onAction ? (
          <Button type="button" variant="ghost" onClick={onAction}>
            {actionLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function RelationList({
  label,
  values,
  empty,
}: {
  label: string;
  values: string[];
  empty: string;
}) {
  return (
    <section className="grid gap-2">
      <h4 className="text-sm font-semibold">{label}</h4>
      {values.length ? (
        <div className="flex flex-wrap gap-2">
          {values.map((value) => (
            <Badge key={value} variant="neutral">
              {value}
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">{empty}</p>
      )}
    </section>
  );
}

function SimpleUserSelector({
  labels,
  label,
  users,
  search,
  selectedIds,
  onSearch,
  onToggle,
  single = false,
}: {
  labels: AllTaskLabels;
  label: string;
  users: WorkspaceUser[];
  search: string;
  selectedIds: string[];
  onSearch: (value: string) => void;
  onToggle: (membershipId: string) => void;
  single?: boolean;
}) {
  return (
    <div className="grid gap-2">
      <Input
        label={label}
        value={search}
        onChange={(event) => onSearch(event.target.value)}
        placeholder={labels.searchPeople}
      />
      <div className="grid gap-2 rounded-md border border-[hsl(var(--border))] p-2">
        {users.length === 0 ? (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">{labels.noEligibleUsers}</p>
        ) : (
          users.map((user) => {
            const id = user.membershipId;
            const checked = selectedIds.includes(id);
            return (
              <Checkbox
                key={id}
                label={displayUser(user)}
                checked={checked}
                onCheckedChange={() => {
                  if (single && checked) return;
                  onToggle(id);
                }}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

function ProjectSelector({
  labels,
  projects,
  search,
  selectedIds,
  onSearch,
  onToggle,
}: {
  labels: AllTaskLabels;
  projects: WorkspaceProject[];
  search: string;
  selectedIds: string[];
  onSearch: (value: string) => void;
  onToggle: (projectId: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <Input
        label={labels.projects}
        value={search}
        onChange={(event) => onSearch(event.target.value)}
        placeholder={labels.searchProjects}
      />
      <div className="grid gap-2 rounded-md border border-[hsl(var(--border))] p-2">
        {projects.length === 0 ? (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">{labels.noProjects}</p>
        ) : (
          projects.map((project) => (
            <Checkbox
              key={project.id}
              label={project.name}
              checked={selectedIds.includes(project.id)}
              onCheckedChange={() => onToggle(project.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function TaskResultsSkeleton({ view }: { view: TaskView }) {
  if (view === 'kanban') {
    return (
      <div className="flex gap-3 overflow-x-auto p-3" aria-label="Board loading">
        {Array.from({ length: 4 }, (_, column) => (
          <div key={column} className="grid w-[20rem] shrink-0 gap-2">
            <Skeleton className="h-16 w-full" />
            {Array.from({ length: 4 }, (_, card) => (
              <Skeleton key={card} className="h-32 w-full" />
            ))}
          </div>
        ))}
      </div>
    );
  }
  if (view === 'grid') {
    return (
      <div
        className="grid gap-3 p-3 sm:grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))]"
        aria-label="Loading tasks"
      >
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-56 w-full" />
        ))}
      </div>
    );
  }
  if (view === 'compact') {
    return (
      <div className="grid gap-1 p-3" aria-label="Loading tasks">
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="h-11 w-full" />
        ))}
      </div>
    );
  }
  return (
    <div className="grid gap-3 p-4" aria-label="Loading tasks">
      {Array.from({ length: 5 }, (_, index) => (
        <Skeleton key={index} className="h-16 w-full" />
      ))}
    </div>
  );
}

function StatusBadge({ task }: { task: WorkspaceTask }) {
  return (
    <span
      className="inline-flex max-w-full items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-2.5 py-1 text-xs font-semibold"
      title={task.status.name}
    >
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: safeStatusColor(task.status.color) }}
      />
      <span className="truncate">{task.status.name}</span>
    </span>
  );
}

function DueDateCell({ task, labels }: { task: WorkspaceTask; labels: AllTaskLabels }) {
  return (
    <div className="grid gap-1">
      <DueDateText task={task} labels={labels} />
      <DueStateBadge task={task} labels={labels} />
    </div>
  );
}

function DueDateText({ task, labels }: { task: WorkspaceTask; labels: AllTaskLabels }) {
  return <>{task.dueAt ? formatDateTime(task.dueAt) : labels.noDueDate}</>;
}

function DueStateBadge({ task, labels }: { task: WorkspaceTask; labels: AllTaskLabels }) {
  if (task.status.isTerminal) return null;
  const state = dueState(task.dueAt);
  if (!state) return <Badge variant="neutral">{labels.noDueDate}</Badge>;
  if (state === 'overdue') return <Badge variant="danger">{labels.overdue}</Badge>;
  if (state === 'today') return <Badge variant="warning">{labels.dueToday}</Badge>;
  return <Badge variant="info">{labels.upcoming}</Badge>;
}

function assigneeSummary(task: WorkspaceTask, labels: AllTaskLabels) {
  if (!task.assignees.length) return labels.emptyDash;
  const names = task.assignees.map((item) => displayPerson(item.user));
  const total = task.counts?.assignees ?? names.length;
  const visible = names.slice(0, 2).join(', ');
  return total > 2 ? `${visible} +${total - 2}` : visible;
}

function projectSummary(task: WorkspaceTask, labels: AllTaskLabels) {
  if (!task.projects.length) return labels.emptyDash;
  const names = task.projects.map((project) => project.name);
  const total = task.counts?.projects ?? names.length;
  return total > 1 ? `${names[0]} +${total - 1}` : names[0];
}

function dueState(dueAt: string | null) {
  if (!dueAt) return null;
  const due = new Date(dueAt);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (due < startToday) return 'overdue';
  if (due < startTomorrow) return 'today';
  return 'upcoming';
}

function priorityBadge(priority: TaskPriority) {
  if (priority === 'URGENT') return 'danger' as const;
  if (priority === 'HIGH') return 'warning' as const;
  if (priority === 'LOW') return 'neutral' as const;
  return 'info' as const;
}

function priorityLabel(priority: TaskPriority, labels: AllTaskLabels) {
  return labels[`priority${priority}`];
}

function recurrenceStatusLabel(status: string, labels: AllTaskLabels) {
  if (status === 'PAUSED') return labels.paused;
  if (status === 'ENDED') return labels.ended;
  if (status === 'ERROR') return labels.needsAttention;
  return labels.active;
}

function formatRecurrencePattern(series: TaskRecurrenceSeries, labels: AllTaskLabels) {
  if (series.frequency === 'DAILY') return labels.daily;
  if (series.frequency === 'WEEKDAYS') return `${labels.weekdays} (${labels.mondayFriday})`;
  if (series.frequency === 'WEEKLY') {
    const names = series.selectedWeekdays.map((day) => weekdayLabel(day, labels)).join(', ');
    return `${labels.weekly}: ${names || labels.emptyDash}`;
  }
  if (series.frequency === 'MONTHLY') return labels.monthly;
  const unit =
    series.customIntervalUnit === 'WEEK'
      ? labels.weeks
      : series.customIntervalUnit === 'MONTH'
        ? labels.months
        : labels.days;
  return `${labels.every} ${series.interval} ${unit}`;
}

function weekdayLabel(day: number, labels: AllTaskLabels) {
  const map: Record<number, string> = {
    1: labels.monday,
    2: labels.tuesday,
    3: labels.wednesday,
    4: labels.thursday,
    5: labels.friday,
    6: labels.saturday,
    7: labels.sunday,
  };
  return map[day] ?? String(day);
}

function defaultRecurrenceForm(timezone = defaultTimezone()): RecurrenceFormState {
  return {
    frequency: 'DAILY',
    startLocalDate: '',
    localTime: '',
    timezone,
    selectedWeekdays: [],
    interval: 1,
    customIntervalUnit: 'DAY',
    endMode: 'NEVER',
    untilLocalDate: '',
    maxOccurrences: 10,
  };
}

function recurrencePayloadFromForm(form: RecurrenceFormState) {
  if (!form.startLocalDate || !form.localTime || !form.timezone) return null;
  return {
    timezone: form.timezone,
    frequency: form.frequency,
    interval: form.frequency === 'CUSTOM' ? form.interval : 1,
    ...(form.frequency === 'CUSTOM' ? { customIntervalUnit: form.customIntervalUnit } : {}),
    startLocalDate: form.startLocalDate,
    localTime: form.localTime,
    ...(form.frequency === 'WEEKLY' ? { selectedWeekdays: form.selectedWeekdays } : {}),
    ...(form.frequency === 'MONTHLY'
      ? { monthlyDay: Number(form.startLocalDate.split('-')[2]) }
      : {}),
    endMode: form.endMode,
    ...(form.endMode === 'ON_DATE' ? { untilLocalDate: form.untilLocalDate } : {}),
    ...(form.endMode === 'AFTER_COUNT' ? { maxOccurrences: form.maxOccurrences } : {}),
  };
}

function defaultTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function recurrenceFrequencyLabel(value: TaskRecurrenceFrequency, labels: AllTaskLabels) {
  if (value === 'WEEKDAYS') return labels.weekdays;
  if (value === 'WEEKLY') return labels.weekly;
  if (value === 'MONTHLY') return labels.monthly;
  if (value === 'CUSTOM') return labels.custom;
  return labels.daily;
}

function customUnitLabel(value: TaskRecurrenceCustomUnit, labels: AllTaskLabels) {
  if (value === 'WEEK') return labels.weeks;
  if (value === 'MONTH') return labels.months;
  return labels.days;
}

function endModeLabel(value: TaskRecurrenceEndMode, labels: AllTaskLabels) {
  if (value === 'ON_DATE') return labels.onDate;
  if (value === 'AFTER_COUNT') return labels.afterOccurrences;
  return labels.never;
}

function editScopeLabel(value: TaskRecurrenceEditScope, labels: AllTaskLabels) {
  if (value === 'THIS_AND_FUTURE') return labels.thisAndFutureTasks;
  if (value === 'ENTIRE_SERIES') return labels.editRecurrenceSeries;
  return labels.thisTaskOnly;
}

function editScopeDescription(value: TaskRecurrenceEditScope, labels: AllTaskLabels) {
  if (value === 'THIS_AND_FUTURE') return labels.thisAndFutureDescription;
  if (value === 'ENTIRE_SERIES') return labels.entireSeriesDescription;
  return labels.thisTaskOnlyDescription;
}

function sortLabel(sortBy: TaskSortBy, labels: AllTaskLabels) {
  if (sortBy === 'title') return labels.task;
  if (sortBy === 'dueAt') return labels.dueDate;
  if (sortBy === 'updatedAt') return labels.updated;
  return labels.createdAtLabel;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatLabel(template: string, values: Record<string, string>) {
  return Object.entries(values).reduce(
    (formatted, [key, value]) => formatted.replace(`{${key}}`, value),
    template,
  );
}

function uploadCompletionProofFile(url: string, file: File, onProgress: (value: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url);
    if (file.type) request.setRequestHeader('Content-Type', file.type);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(100);
        resolve();
      } else {
        reject(new Error(`Upload failed with status ${request.status}`));
      }
    };
    request.onerror = () => reject(new Error('Upload failed.'));
    request.send(file);
  });
}

function displayPerson(user: { email: string; name: string | null }) {
  return user.name ?? user.email;
}

function displayUser(user: WorkspaceUser) {
  return user.name ?? user.email;
}

function safeTaskError(error: unknown, labels: AllTaskLabels) {
  const status =
    typeof error === 'object' && error && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : undefined;
  if (status === 401 || status === 403) return labels.permissionDenied;
  if (status === 404) return labels.taskNotFound;
  if (status === 422) return labels.invalidFilters;
  if (error instanceof TypeError) return labels.networkError;
  return labels.taskLoadFailed;
}

function safeKanbanError(error: unknown, labels: AllTaskLabels) {
  const status =
    typeof error === 'object' && error && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : undefined;
  if (status === 401 || status === 403) return labels.permissionDenied;
  if (status === 404) return labels.taskNotFound;
  if (status === 409)
    return error instanceof Error && error.message ? error.message : labels.unableToMoveTask;
  if (status === 400 || status === 422) return labels.wipLimitInvalid;
  if (error instanceof TypeError) return labels.networkError;
  if (error instanceof Error && error.message) return error.message;
  return labels.unableToMoveTask;
}

function isCompletionFlowRequired(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'body' in error &&
    (error as { body?: { code?: unknown } }).body?.code === 'COMPLETION_FLOW_REQUIRED'
  );
}

function completionFlowDetails(error: unknown) {
  if (
    typeof error !== 'object' ||
    error === null ||
    !('body' in error) ||
    typeof (error as { body?: { details?: unknown } }).body?.details !== 'object' ||
    !(error as { body?: { details?: unknown } }).body?.details
  ) {
    return null;
  }
  const details = (error as { body: { details: Record<string, unknown> } }).body.details;
  return {
    taskId: typeof details.taskId === 'string' ? details.taskId : null,
    taskIds: Array.isArray(details.taskIds)
      ? details.taskIds.filter((id): id is string => typeof id === 'string')
      : [],
    requestedTerminalStatusDefinitionId:
      typeof details.requestedTerminalStatusDefinitionId === 'string'
        ? details.requestedTerminalStatusDefinitionId
        : null,
  };
}

function safeCompletionError(error: unknown, labels: AllTaskLabels) {
  const status =
    typeof error === 'object' && error && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : undefined;
  if (error instanceof Error && error.message === labels.fileTooLarge) return labels.fileTooLarge;
  if (status === 401 || status === 403) return labels.permissionDenied;
  if (status === 404) return labels.attachmentUnavailable;
  if (status === 409 && isCompletionFlowRequired(error)) return labels.completionRequired;
  if (status === 409) return labels.completionActionFailed;
  if (status === 413) return labels.fileTooLarge;
  if (status === 400 || status === 422) return labels.invalidAttachment;
  if (error instanceof TypeError) return labels.networkError;
  return labels.completionActionFailed;
}

function safeBulkError(error: unknown, labels: AllTaskLabels) {
  if (isCompletionFlowRequired(error)) {
    const count = completionFlowDetails(error)?.taskIds.length ?? 0;
    return count > 0
      ? formatLabel(labels.bulkCompletionRequiredCount, { count: String(count) })
      : labels.bulkCompletionRequired;
  }
  const status =
    typeof error === 'object' && error && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : undefined;
  if (status === 401 || status === 403) return labels.permissionDenied;
  if (status === 404) return labels.selectedTasksUnavailable;
  if (status === 409) return labels.statusConfigChanged;
  if (status === 400 || status === 422) return labels.bulkActionInvalid;
  if (error instanceof TypeError) return labels.networkError;
  if (error instanceof Error && error.message) return error.message;
  return labels.bulkActionFailed;
}

function safeHierarchyError(error: unknown, labels: AllTaskLabels) {
  const status =
    typeof error === 'object' && error && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : undefined;
  const message = error instanceof Error ? error.message : '';
  if (status === 401 || status === 403) return labels.permissionDenied;
  if (status === 404) return labels.taskNotFound;
  if (status === 409 && /cycle/i.test(message)) return labels.hierarchyCycleNotAllowed;
  if (status === 409 && /terminal/i.test(message)) return labels.terminalParentRestriction;
  if (status === 409) return labels.hierarchyConflict;
  if (status === 400 || status === 422) return labels.bulkActionInvalid;
  if (error instanceof TypeError) return labels.networkError;
  return labels.taskLoadFailed;
}

function safeMoveError(error: unknown, labels: AllTaskLabels) {
  const status =
    typeof error === 'object' && error && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : undefined;
  if (status === 404) return labels.parentTaskUnavailable;
  return safeHierarchyError(error, labels);
}

function safeRelationshipError(error: unknown, labels: AllTaskLabels) {
  const status =
    typeof error === 'object' && error && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : undefined;
  const message = error instanceof Error ? error.message : '';
  if (status === 401 || status === 403) return labels.permissionDenied;
  if (status === 404) return labels.relationshipTaskUnavailable;
  if (status === 409 && /cycle/i.test(message)) return labels.dependencyCycleNotAllowed;
  if (status === 409 && /terminal|non-terminal/i.test(message))
    return labels.terminalBlockerRestriction;
  if (status === 409 || /serializ|concurrent/i.test(message)) return labels.relationshipRetry;
  if (status === 400 || status === 422) return labels.relationshipUpdateFailed;
  if (error instanceof TypeError) return labels.networkError;
  if (error instanceof Error && error.message) return error.message;
  return labels.relationshipUpdateFailed;
}

function relationshipSuccessMessage(
  labels: AllTaskLabels,
  result: TaskRelationshipResult,
  changedLabel: string,
) {
  if (result.changedCount === 0) {
    return labels.relationshipNoop;
  }
  const base = changedLabel.replace('{count}', String(result.changedCount));
  return result.unchangedCount > 0
    ? `${base} ${labels.alreadyLinked.replace('{count}', String(result.unchangedCount))}`
    : base;
}

async function invalidateDependencyQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string | null,
  taskId: string,
  counterpartTaskId?: string,
) {
  if (!workspaceId) return;
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: taskKeys.blockedByBase(workspaceId, taskId) }),
    queryClient.invalidateQueries({ queryKey: taskKeys.blocksBase(workspaceId, taskId) }),
    queryClient.invalidateQueries({ queryKey: taskKeys.detail(workspaceId, taskId) }),
    counterpartTaskId
      ? queryClient.invalidateQueries({
          queryKey: taskKeys.blocksBase(workspaceId, counterpartTaskId),
        })
      : Promise.resolve(),
    counterpartTaskId
      ? queryClient.invalidateQueries({
          queryKey: taskKeys.detail(workspaceId, counterpartTaskId),
        })
      : Promise.resolve(),
  ]);
}

function invalidateDependencyCounterpartQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string | null,
  counterpartTaskId: string,
) {
  if (!workspaceId) return Promise.resolve();
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: taskKeys.blocksBase(workspaceId, counterpartTaskId),
    }),
    queryClient.invalidateQueries({ queryKey: taskKeys.detail(workspaceId, counterpartTaskId) }),
  ]);
}

async function invalidateRelatedQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string | null,
  taskId: string,
  counterpartTaskIds: string[],
) {
  if (!workspaceId) return;
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: taskKeys.relatedBase(workspaceId, taskId) }),
    queryClient.invalidateQueries({ queryKey: taskKeys.detail(workspaceId, taskId) }),
    ...counterpartTaskIds.flatMap((id) => [
      queryClient.invalidateQueries({ queryKey: taskKeys.relatedBase(workspaceId, id) }),
      queryClient.invalidateQueries({ queryKey: taskKeys.detail(workspaceId, id) }),
    ]),
  ]);
}

function selectedCountLabel(count: number, labels: AllTaskLabels) {
  return count === 1
    ? labels.oneTaskSelected
    : labels.tasksSelected.replace('{count}', String(count));
}

function successMessage(labels: AllTaskLabels, action: BulkAction | null, result: BulkResultLike) {
  if (action === 'addAssignees') {
    return labels.assignmentsAdded.replace('{count}', String(result.relationChangedCount ?? 0));
  }
  if (action === 'removeAssignees') {
    return labels.assignmentsRemoved.replace('{count}', String(result.relationChangedCount ?? 0));
  }
  const base = labels.tasksUpdated.replace('{count}', String(result.changedCount));
  return result.unchangedCount > 0
    ? `${base} ${labels.alreadyMatched.replace('{count}', String(result.unchangedCount))}`
    : base;
}

function bulkDialogTitle(action: BulkAction | null, selectedCount: number, labels: AllTaskLabels) {
  const count = String(selectedCount);
  if (action === 'status') return labels.changeStatusForTasks.replace('{count}', count);
  if (action === 'priority') return labels.changePriorityForTasks.replace('{count}', count);
  if (action === 'addAssignees') return labels.addAssigneesForTasks.replace('{count}', count);
  if (action === 'removeAssignees') return labels.removeAssigneesForTasks.replace('{count}', count);
  if (action === 'delete') return labels.deleteTasksConfirmation.replace('{count}', count);
  return labels.bulkActions;
}

function bulkDialogDescription(action: BulkAction | null, labels: AllTaskLabels) {
  if (action === 'addAssignees') return labels.addAssigneesDescription;
  if (action === 'removeAssignees') return labels.removeAssigneesDescription;
  if (action === 'delete') return labels.deleteConfirmationDescription;
  return labels.bulkDialogDescription;
}

function bulkSubmitLabel(action: BulkAction | null, selectedCount: number, labels: AllTaskLabels) {
  const count = String(selectedCount);
  if (action === 'addAssignees') return labels.addToTasks.replace('{count}', count);
  if (action === 'removeAssignees') return labels.removeFromTasks.replace('{count}', count);
  if (action === 'delete') return labels.deleteTasksCount.replace('{count}', count);
  return labels.updateTasks.replace('{count}', count);
}

function isDatasetPatch(patch: Record<string, string | number | null>) {
  return Object.keys(patch).some(
    (key) =>
      key !== 'view' &&
      [
        'search',
        'status',
        'priority',
        'assignee',
        'department',
        'project',
        'tagId',
        'dueFrom',
        'dueTo',
        'sortBy',
        'sortDirection',
        'page',
        'pageSize',
      ].includes(key),
  );
}

function toggleId(ids: string[], id: string) {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}

function uniqueIds(ids: string[]) {
  return [...new Set(ids.filter(Boolean))];
}

function defaultSubtaskForm(): SubtaskFormState {
  return {
    title: '',
    assigneeMembershipId: '',
    dueDate: '',
    dueTime: '',
    description: '',
    priority: 'MEDIUM',
    statusDefinitionId: '',
    departmentId: '',
    additionalAssigneeMembershipIds: [],
    followerMembershipIds: [],
    projectIds: [],
  };
}

function activeFilters(state: TaskUrlState) {
  return [...tenantFilterParams, ...genericFilterParams].filter((key) =>
    Boolean(state[key as keyof TaskUrlState]),
  );
}

function activeFilterLabel(
  key: string,
  state: TaskUrlState,
  labels: AllTaskLabels,
  statuses: { id: string; name: string }[],
  departments: Department[],
  assignees: WorkspaceUser[],
  projects: WorkspaceProject[],
  tags: WorkspaceTagSummary[],
) {
  if (key === 'status') {
    return `${labels.status}: ${statuses.find((status) => status.id === state.status)?.name ?? labels.selected}`;
  }
  if (key === 'priority' && state.priority)
    return `${labels.priority}: ${priorityLabel(state.priority, labels)}`;
  if (key === 'assignee') {
    return `${labels.assignee}: ${assignees.find((user) => user.membershipId === state.assignee)?.name ?? labels.selected}`;
  }
  if (key === 'department') {
    return `${labels.department}: ${departments.find((department) => department.id === state.department)?.name ?? labels.selected}`;
  }
  if (key === 'project') {
    return `${labels.project}: ${projects.find((project) => project.id === state.project)?.name ?? labels.selected}`;
  }
  if (key === 'tagId') {
    const tag = tags.find((item) => item.id === state.tagId);
    const label = tag
      ? tag.status === 'ARCHIVED'
        ? `${tag.name} (${labels.archived})`
        : tag.name
      : labels.selected;
    return `${labels.filterByTag}: ${label}`;
  }
  if (key === 'dueFrom') return `${labels.dueFrom}: ${state.dueFrom}`;
  if (key === 'dueTo') return `${labels.dueTo}: ${state.dueTo}`;
  return labels.selected;
}

function readTaskUrlState(searchParams: URLSearchParams): TaskUrlState {
  const sortBy = searchParams.get('sortBy');
  const sortDirection = searchParams.get('sortDirection');
  const priority = searchParams.get('priority');
  const view = searchParams.get('view');
  return {
    view: view === null ? undefined : isTaskView(view) ? view : 'list',
    search: searchParams.get('search') ?? '',
    page: positiveNumber(searchParams.get('page'), 1),
    pageSize: pageSizes.includes(Number(searchParams.get('pageSize')) as (typeof pageSizes)[number])
      ? Number(searchParams.get('pageSize'))
      : 25,
    sortBy: sortFields.includes(sortBy as (typeof sortFields)[number])
      ? (sortBy as TaskSortBy)
      : 'createdAt',
    sortDirection: sortDirection === 'asc' ? 'asc' : 'desc',
    status: opaqueParam(searchParams.get('status')),
    priority: priorities.includes(priority as TaskPriority)
      ? (priority as TaskPriority)
      : undefined,
    assignee: opaqueParam(searchParams.get('assignee')),
    department: opaqueParam(searchParams.get('department')),
    project: opaqueParam(searchParams.get('project')),
    tagId: opaqueParam(searchParams.get('tagId')),
    dueFrom: localDateParam(searchParams.get('dueFrom')),
    dueTo: localDateParam(searchParams.get('dueTo')),
  };
}

function setUrlState(
  router: ReturnType<typeof useRouter>,
  pathname: string,
  searchParams: URLSearchParams,
  patch: Record<string, string | number | null>,
) {
  const next = new URLSearchParams(searchParams.toString());
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === '') next.delete(key);
    else next.set(key, String(value));
  }
  if (!('page' in patch)) next.delete('page');
  replaceUrl(router, pathname, next);
}

function replaceUrl(
  router: ReturnType<typeof useRouter>,
  pathname: string,
  params: URLSearchParams,
) {
  const query = params.toString();
  router.replace((query ? `${pathname}?${query}` : pathname) as never, { scroll: false });
}

function positiveNumber(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function localDateParam(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const [year = 0, month = 1, day = 1] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? value
    : '';
}

function opaqueParam(value: string | null) {
  return value && /^[A-Za-z0-9_-]+$/.test(value) ? value : '';
}

function safeStatusColor(value: string) {
  return /^#[0-9A-Fa-f]{6}$/.test(value) ? value : '#64748B';
}

function localInputDate(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function localDateToIso(value: string) {
  return value ? new Date(`${value}T00:00:00`).toISOString() : null;
}

function ganttWidth(start: string | null, end: string | null, from: string, to: string) {
  if (!start || !end) return 0;
  const rangeStart = new Date(`${from}T00:00:00`).getTime();
  const rangeEnd = new Date(`${to}T23:59:59`).getTime();
  const taskStart = Math.max(new Date(start).getTime(), rangeStart);
  const taskEnd = Math.min(new Date(end).getTime(), rangeEnd);
  if (rangeEnd <= rangeStart || taskEnd <= taskStart) return 2;
  return Math.max(2, Math.min(100, ((taskEnd - taskStart) / (rangeEnd - rangeStart)) * 100));
}

function urgencyLabel(value: 'SAFE' | 'WARNING' | 'OVERDUE', labels: AllTaskLabels) {
  if (value === 'OVERDUE') return labels.overdue;
  if (value === 'WARNING') return labels.dueSoon;
  return labels.safe;
}

function isTaskView(value: unknown): value is TaskView {
  return (
    value === 'list' ||
    value === 'grid' ||
    value === 'compact' ||
    value === 'kanban' ||
    value === 'calendar' ||
    value === 'gantt'
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

interface TaskUrlState {
  view?: TaskView;
  search: string;
  page: number;
  pageSize: number;
  sortBy: TaskSortBy;
  sortDirection: TaskSortDirection;
  status: string;
  priority?: TaskPriority;
  assignee: string;
  department: string;
  project: string;
  tagId: string;
  dueFrom: string;
  dueTo: string;
}

interface SelectedTask {
  workspaceId: string;
  taskId: string;
}

type TaskView = 'list' | 'grid' | 'compact' | 'kanban' | 'calendar' | 'gantt';
type BulkAction = 'status' | 'priority' | 'addAssignees' | 'removeAssignees' | 'delete';
type BulkResultLike = {
  changedCount: number;
  unchangedCount: number;
  relationChangedCount?: number;
};
type PageResultLike<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};
type SubtaskFormState = {
  title: string;
  assigneeMembershipId: string;
  dueDate: string;
  dueTime: string;
  description: string;
  priority: TaskPriority;
  statusDefinitionId: string;
  departmentId: string;
  additionalAssigneeMembershipIds: string[];
  followerMembershipIds: string[];
  projectIds: string[];
};

type AllTaskLabels = ReturnType<typeof allTaskLabels>;

function allTaskLabels(
  locale: Parameters<ReturnType<typeof useLanguage>['t']>[0],
  t: ReturnType<typeof useLanguage>['t'],
) {
  const keys = [
    'allTasks',
    'taskView',
    'viewList',
    'viewGrid',
    'viewCompact',
    'kanban',
    'kanbanBoard',
    'calendar',
    'gantt',
    'month',
    'week',
    'today',
    'date',
    'tasksDue',
    'viewTasks',
    'noTasks',
    'unableToLoadTasks',
    'tryAgain',
    'safe',
    'dueSoon',
    'overdue',
    'plannedStart',
    'unscheduled',
    'scheduleTask',
    'startDate',
    'endDate',
    'updated',
    'moveToStatus',
    'wipLimit',
    'setWipLimit',
    'removeWipLimit',
    'wipLimitReached',
    'wipLimitExceeded',
    'wipLimitUpdated',
    'wipLimitInvalid',
    'wipLimitDescription',
    'unlimited',
    'noTasksInStatus',
    'noKanbanColumns',
    'noKanbanColumnsDescription',
    'unableToMoveTask',
    'reordering',
    'boardLoading',
    'loadMore',
    'openTaskDetails',
    'tasks',
    'searchTasks',
    'filters',
    'filterDescription',
    'clearFilters',
    'clearFiltersSearch',
    'activeFilters',
    'removeFilter',
    'status',
    'priority',
    'assignee',
    'assignees',
    'department',
    'project',
    'projects',
    'dueDate',
    'dueFrom',
    'dueTo',
    'sort',
    'createdAtLabel',
    'updated',
    'task',
    'taskDetails',
    'taskDetailsDescription',
    'overview',
    'subtasks',
    'dependencies',
    'related',
    'comments',
    'tags',
    'tagsDescription',
    'addTags',
    'manageTags',
    'loadingTags',
    'tagsLoadFailed',
    'noTags',
    'addTagsDescription',
    'searchTags',
    'tagSearchResults',
    'alreadyAdded',
    'selectedTags',
    'noTagsFound',
    'manageTagsDescription',
    'createTag',
    'editTag',
    'tagName',
    'tagColor',
    'save',
    'invalidColor',
    'filterByTagStatus',
    'active',
    'archived',
    'allTags',
    'archive',
    'reactivate',
    'archiveConfirmation',
    'tagCreated',
    'tagUpdated',
    'tagArchived',
    'tagReactivated',
    'removeTagFromTask',
    'tagsAdded',
    'tagsAlreadyAssigned',
    'noTagsAdded',
    'tagRemoved',
    'tagRemoveNoop',
    'noTagsRemoved',
    'selectionLimit',
    'staleTag',
    'tagConflict',
    'archivedTagCannotBeAssigned',
    'duplicateTag',
    'tagInvalid',
    'tagActionFailed',
    'attachments',
    'attachmentsDescription',
    'loadingAttachments',
    'attachmentsLoadFailed',
    'noAttachments',
    'uploadFile',
    'uploadFileDescription',
    'addLink',
    'addLinkDescription',
    'file',
    'url',
    'displayName',
    'largeFileSuggestion',
    'fileTooLarge',
    'uploading',
    'fileUploaded',
    'linkAdded',
    'fileAttachment',
    'urlAttachment',
    'download',
    'openLink',
    'removeAttachment',
    'removeAttachmentNamed',
    'attachmentRemoved',
    'attachmentUnavailable',
    'attachmentNotReady',
    'invalidAttachment',
    'invalidUrl',
    'attachmentActionFailed',
    'filterByTag',
    'clearTagFilter',
    'anyTag',
    'taskRelationshipTabs',
    'dependenciesDeferred',
    'relatedDeferred',
    'blockedBy',
    'blockedByDescription',
    'blocks',
    'blocksDescription',
    'addBlocker',
    'addBlockerDescription',
    'removeBlocker',
    'noActiveBlockers',
    'notBlockingTasks',
    'blockersAdded',
    'blockerRemoved',
    'relatedTasks',
    'relatedDescription',
    'addRelatedTask',
    'addRelatedDescription',
    'removeRelatedTask',
    'noRelatedTasks',
    'relatedAdded',
    'relatedRemoved',
    'selectedTasks',
    'removeSelectedTask',
    'selectRelationshipTasks',
    'relationshipSelectionLimit',
    'terminalTask',
    'activeTask',
    'loadingRelationships',
    'dependencyCycleNotAllowed',
    'terminalBlockerRestriction',
    'relationshipTaskUnavailable',
    'relationshipRetry',
    'relationshipUpdateFailed',
    'relationshipNoop',
    'alreadyLinked',
    'applying',
    'createSubtask',
    'subtaskCreated',
    'noSubtasks',
    'noSubtasksDescription',
    'expand',
    'collapse',
    'viewTask',
    'actions',
    'parentTask',
    'viewParent',
    'viewSubtasks',
    'directSubtasks',
    'directChildrenOnly',
    'moveTask',
    'changeParent',
    'currentParent',
    'newParent',
    'moveToRoot',
    'rootTask',
    'move',
    'taskMoved',
    'selectParent',
    'unchangedParent',
    'retry',
    'parentTaskUnavailable',
    'hierarchyCycleNotAllowed',
    'hierarchyCycleDetected',
    'terminalParentRestriction',
    'hierarchyConflict',
    'titleLabel',
    'additionalAssignees',
    'dueTime',
    'addMoreDetails',
    'creating',
    'backendDefault',
    'none',
    'noProjects',
    'titleRequired',
    'dueDateRequired',
    'descriptionField',
    'creator',
    'followers',
    'noTasks',
    'noTasksDescription',
    'noMatchingTasks',
    'noMatchingTasksDescription',
    'overdue',
    'dueToday',
    'upcoming',
    'page',
    'rowsPerPage',
    'rows',
    'previous',
    'next',
    'anyStatus',
    'anyPriority',
    'anyAssignee',
    'anyDepartment',
    'anyProject',
    'searchPeople',
    'searchProjects',
    'ascending',
    'descending',
    'emptyDash',
    'selected',
    'noDueDate',
    'priorityLOW',
    'priorityMEDIUM',
    'priorityHIGH',
    'priorityURGENT',
    'errorTitle',
    'taskLoadFailed',
    'taskNotFound',
    'invalidFilters',
    'permissionDenied',
    'networkError',
    'cancel',
    'noEligibleUsers',
    'selectCurrentPage',
    'deselectCurrentPage',
    'selectTask',
    'oneTaskSelected',
    'tasksSelected',
    'bulkActions',
    'changeStatus',
    'changePriority',
    'addAssignees',
    'removeAssignees',
    'deleteTasks',
    'clearSelection',
    'apply',
    'updateTasks',
    'addToTasks',
    'removeFromTasks',
    'deleteTasksCount',
    'changeStatusForTasks',
    'changePriorityForTasks',
    'addAssigneesForTasks',
    'removeAssigneesForTasks',
    'deleteTasksConfirmation',
    'bulkDialogDescription',
    'addAssigneesDescription',
    'removeAssigneesDescription',
    'deleteConfirmationDescription',
    'alreadyMatched',
    'assignmentsAdded',
    'assignmentsRemoved',
    'tasksUpdated',
    'bulkActionFailed',
    'bulkCompletionRequired',
    'bulkCompletionRequiredCount',
    'bulkActionInvalid',
    'selectedTasksUnavailable',
    'statusConfigChanged',
    'staleMembership',
    'unassignedWarning',
    'selectStatus',
    'selectAssignees',
    'noTasksSelected',
    'tooManySelected',
    'noWorkspace',
    'recurring',
    'notRecurring',
    'recurringTaskSummary',
    'nonRecurringTaskSummary',
    'pattern',
    'timezone',
    'scheduledFor',
    'seriesStatus',
    'nextOccurrence',
    'generatedCount',
    'daily',
    'weekdays',
    'weekly',
    'monthly',
    'every',
    'days',
    'weeks',
    'months',
    'mondayFriday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
    'active',
    'paused',
    'ended',
    'needsAttention',
    'pause',
    'resume',
    'endRecurrence',
    'pauseRecurrenceConfirmation',
    'resumeRecurrenceConfirmation',
    'endRecurrenceConfirmation',
    'recurrenceUpdated',
    'recurrenceActionFailed',
    'recurrenceUnavailable',
    'saveAsTemplate',
    'saveTemplateDescription',
    'saveTemplateCopyWarning',
    'templateName',
    'templateSaved',
    'templateActionFailed',
    'makeRecurring',
    'makeRecurringDescription',
    'repeat',
    'startDate',
    'time',
    'repeatOn',
    'monthlyClampHelper',
    'custom',
    'intervalUnit',
    'ends',
    'never',
    'onDate',
    'afterOccurrences',
    'endDate',
    'occurrences',
    'fixRequiredFields',
    'recurrenceInvalid',
    'editTask',
    'applyChangesTo',
    'editScopeDescription',
    'thisTaskOnly',
    'thisTaskOnlyDescription',
    'thisAndFutureTasks',
    'thisAndFutureDescription',
    'editRecurrenceSeries',
    'entireSeriesDescription',
    'selectEditScope',
    'taskUpdated',
    'taskUpdateFailed',
    'save',
    'completionApproval',
    'completionReady',
    'pendingApproval',
    'completionRequired',
    'completionPolicy',
    'completionPolicyDescription',
    'proofRequirement',
    'proofNone',
    'proofAny',
    'proofSpecific',
    'approvalRequired',
    'approverMode',
    'anyOneApprover',
    'allApprovers',
    'includeTaskCreator',
    'includePermissionApprovers',
    'requestCompletionStatus',
    'textProof',
    'urlProof',
    'checklistProof',
    'attachmentProof',
    'uploadFileImage',
    'removeProofFile',
    'submitProof',
    'waitingForApproval',
    'submitForCompletion',
    'completionSubmitted',
    'completionPolicySaved',
    'completionDecisionSaved',
    'completionActionFailed',
    'completionHistory',
    'noCompletionHistory',
    'approvalQueue',
    'noApprovals',
    'version',
    'approve',
    'reject',
    'rejectionReason',
    'accepted',
    'rejected',
  ] as const;
  return Object.fromEntries(keys.map((key) => [key, t(locale, `workspaceTasks.${key}`)])) as Record<
    (typeof keys)[number],
    string
  >;
}
