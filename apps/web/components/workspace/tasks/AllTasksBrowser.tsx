'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Pagination,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@zea-play/ui';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Filter,
  Grid2X2,
  List,
  Rows3,
  X,
} from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useLanguage } from '../../../contexts/language-provider';
import {
  listDepartments,
  listWorkspaceUsers,
  type Department,
  type WorkspaceUser,
} from '../../../services/workspace-management';
import { listWorkspaceStatuses } from '../../../services/workspace-statuses';
import {
  getWorkspaceTask,
  listWorkspaceProjects,
  listWorkspaceTasks,
  normalizeTaskListParams,
  taskCreationKeys,
  taskDueBoundaryFromLocalDate,
  taskKeys,
  type TaskPriority,
  type TaskSortBy,
  type TaskSortDirection,
  type WorkspaceProject,
  type WorkspaceTask,
} from '../../../services/workspace-tasks';

const priorities = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
const pageSizes = [10, 25, 50] as const;
const sortFields = ['createdAt', 'updatedAt', 'dueAt', 'title'] as const;
const noneValue = '__none__';
const viewPreferenceKey = 'zea-play-all-tasks-view';
const tenantFilterParams = ['status', 'assignee', 'department', 'project', 'createdBy'];
const genericFilterParams = ['priority', 'dueFrom', 'dueTo'];

export function AllTasksBrowser({ workspaceId }: { workspaceId: string | null }) {
  const { locale, t } = useLanguage();
  const labels = allTaskLabels(locale, t);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamString = searchParams.toString();
  const previousWorkspaceId = useRef(workspaceId);
  const [searchInput, setSearchInput] = useState(searchParams.get('search') ?? '');
  const debouncedSearch = useDebouncedValue(searchInput.trim(), 300);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<SelectedTask | null>(null);
  const [assigneeSearch, setAssigneeSearch] = useState('');
  const [projectSearch, setProjectSearch] = useState('');
  const [preferredView, setPreferredView] = useState<TaskView>('list');
  const [preferenceReady, setPreferenceReady] = useState(false);
  const debouncedAssigneeSearch = useDebouncedValue(assigneeSearch.trim(), 300);
  const debouncedProjectSearch = useDebouncedValue(projectSearch.trim(), 300);

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
      urlState.search,
      urlState.sortBy,
      urlState.sortDirection,
      urlState.status,
    ],
  );

  const tasksQuery = useQuery({
    queryKey: taskKeys.list(workspaceId, listParams),
    queryFn: () => listWorkspaceTasks(workspaceId as string, listParams),
    enabled: Boolean(workspaceId),
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
      setUrlState(router, pathname, searchParams, { search: debouncedSearch || null, page: null });
    }
  }, [debouncedSearch, pathname, router, searchParams]);

  useEffect(() => {
    if (previousWorkspaceId.current === workspaceId) return;
    previousWorkspaceId.current = workspaceId;
    setSelectedTask(null);
    setAssigneeSearch('');
    setProjectSearch('');
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

  useEffect(() => {
    if (!tasksQuery.isSuccess || total === 0 || urlState.page <= totalPages) return;
    updateState({ page: totalPages });
  }, [tasksQuery.isSuccess, total, totalPages, urlState.page]);

  function updateState(patch: Record<string, string | number | null>) {
    setUrlState(router, pathname, searchParams, patch);
  }

  function clearFilters() {
    const patch: Record<string, null> = { page: null };
    for (const key of [...tenantFilterParams, ...genericFilterParams]) patch[key] = null;
    setUrlState(router, pathname, searchParams, patch);
  }

  function clearSearchAndFilters() {
    const patch: Record<string, null> = { search: null, page: null };
    for (const key of [...tenantFilterParams, ...genericFilterParams]) patch[key] = null;
    setSearchInput('');
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

  return (
    <section className="grid gap-4" aria-labelledby="all-tasks-heading">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 id="all-tasks-heading" className="text-xl font-semibold">
            {labels.allTasks}
          </h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {total} {labels.tasks}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Input
            label={labels.searchTasks}
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
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
          assigneeSearch={assigneeSearch}
          projectSearch={projectSearch}
          onAssigneeSearch={setAssigneeSearch}
          onProjectSearch={setProjectSearch}
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
            assigneeSearch={assigneeSearch}
            projectSearch={projectSearch}
            onAssigneeSearch={setAssigneeSearch}
            onProjectSearch={setProjectSearch}
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
        onRemove={(key) => updateState({ [key]: null, page: null })}
        onClear={clearFilters}
      />

      <Card>
        <CardContent className="p-0">
          {tasksQuery.isLoading ? (
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
              onSort={changeSort}
              onOpenDetail={(taskId) =>
                workspaceId ? setSelectedTask({ workspaceId, taskId }) : setSelectedTask(null)
              }
            />
          )}
        </CardContent>
      </Card>

      <TaskPagination
        labels={labels}
        page={urlState.page}
        pageSize={urlState.pageSize}
        total={total}
        totalPages={totalPages}
        onPage={(page) => updateState({ page })}
        onPageSize={(pageSize) => updateState({ pageSize, page: null })}
      />

      <TaskDetailDialog
        labels={labels}
        workspaceId={workspaceId}
        taskId={selectedTaskId}
        onOpenChange={(open) => {
          if (!open) setSelectedTask(null);
        }}
      />
    </section>
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
  ];
  return (
    <div
      className="inline-flex rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-1"
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
              'inline-flex min-h-10 items-center gap-2 rounded px-3 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
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
  assigneeSearch,
  projectSearch,
  onAssigneeSearch,
  onProjectSearch,
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
  assigneeSearch: string;
  projectSearch: string;
  onAssigneeSearch: (value: string) => void;
  onProjectSearch: (value: string) => void;
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
  onRemove,
  onClear,
}: {
  labels: AllTaskLabels;
  state: TaskUrlState;
  statuses: { id: string; name: string }[];
  departments: Department[];
  assignees: WorkspaceUser[];
  projects: WorkspaceProject[];
  onRemove: (key: string) => void;
  onClear: () => void;
}) {
  const chips = activeFilters(state).map((key) => ({
    key,
    label: activeFilterLabel(key, state, labels, statuses, departments, assignees, projects),
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

function TaskResults({
  labels,
  tasks,
  view,
  sortBy,
  sortDirection,
  onSort,
  onOpenDetail,
}: {
  labels: AllTaskLabels;
  tasks: WorkspaceTask[];
  view: TaskView;
  sortBy: TaskSortBy;
  sortDirection: TaskSortDirection;
  onSort: (sortBy: TaskSortBy) => void;
  onOpenDetail: (taskId: string) => void;
}) {
  if (view === 'grid') {
    return <TaskGridView labels={labels} tasks={tasks} onOpenDetail={onOpenDetail} />;
  }
  if (view === 'compact') {
    return <TaskCompactView labels={labels} tasks={tasks} onOpenDetail={onOpenDetail} />;
  }
  return (
    <>
      <div className="hidden overflow-x-auto xl:block">
        <table className="w-full min-w-[960px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[hsl(var(--border))] text-left text-xs uppercase text-[hsl(var(--muted-foreground))]">
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
            {tasks.map((task) => (
              <tr
                key={task.id}
                className="border-b border-[hsl(var(--border))] last:border-0 hover:bg-[hsl(var(--surface-muted))]"
              >
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
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 p-3 xl:hidden">
        {tasks.map((task) => (
          <button
            key={task.id}
            type="button"
            className="grid gap-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
            onClick={() => onOpenDetail(task.id)}
          >
            <span className="min-w-0">
              <span className="block truncate font-semibold" title={task.title}>
                {task.title}
              </span>
              <span className="mt-1 flex flex-wrap gap-2">
                <StatusBadge task={task} />
                <Badge variant={priorityBadge(task.priority)}>
                  {priorityLabel(task.priority, labels)}
                </Badge>
              </span>
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
          </button>
        ))}
      </div>
    </>
  );
}

function TaskGridView({
  labels,
  tasks,
  onOpenDetail,
}: {
  labels: AllTaskLabels;
  tasks: WorkspaceTask[];
  onOpenDetail: (taskId: string) => void;
}) {
  return (
    <div className="grid gap-3 p-3 sm:grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))]">
      {tasks.map((task) => (
        <button
          key={task.id}
          type="button"
          className="grid min-h-56 content-start gap-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4 text-left outline-none transition-colors hover:bg-[hsl(var(--surface-muted))] focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          onClick={() => onOpenDetail(task.id)}
          aria-label={`${labels.openTaskDetails}: ${task.title}`}
        >
          <span className="grid min-w-0 gap-2">
            <span className="line-clamp-2 text-base font-semibold leading-snug" title={task.title}>
              {task.title}
            </span>
            <span className="flex flex-wrap gap-2">
              <StatusBadge task={task} />
              <Badge variant={priorityBadge(task.priority)}>
                {priorityLabel(task.priority, labels)}
              </Badge>
            </span>
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
        </button>
      ))}
    </div>
  );
}

function TaskCompactView({
  labels,
  tasks,
  onOpenDetail,
}: {
  labels: AllTaskLabels;
  tasks: WorkspaceTask[];
  onOpenDetail: (taskId: string) => void;
}) {
  return (
    <div className="divide-y divide-[hsl(var(--border))]">
      {tasks.map((task) => (
        <button
          key={task.id}
          type="button"
          className="grid w-full gap-2 px-3 py-2.5 text-left outline-none transition-colors hover:bg-[hsl(var(--surface-muted))] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[hsl(var(--ring))] sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-center"
          onClick={() => onOpenDetail(task.id)}
          aria-label={`${labels.openTaskDetails}: ${task.title}`}
        >
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <StatusBadge task={task} />
            <span className="min-w-0 flex-1 truncate font-semibold" title={task.title}>
              {task.title}
            </span>
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
            className="min-w-0 truncate text-xs text-[hsl(var(--muted-foreground))] sm:col-span-4"
            title={`${labels.department}: ${task.department?.name ?? labels.emptyDash} · ${labels.projects}: ${projectSummary(task, labels)}`}
          >
            {labels.department}: {task.department?.name ?? labels.emptyDash} · {labels.projects}:{' '}
            {projectSummary(task, labels)}
          </span>
        </button>
      ))}
    </div>
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
  onOpenChange,
}: {
  labels: AllTaskLabels;
  workspaceId: string | null;
  taskId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const detailQuery = useQuery({
    queryKey: taskKeys.detail(workspaceId, taskId),
    queryFn: () => getWorkspaceTask(workspaceId as string, taskId as string),
    enabled: Boolean(workspaceId && taskId),
  });
  const task = detailQuery.data;
  return (
    <Dialog open={Boolean(taskId)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
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
                label={labels.dueDate}
                value={task.dueAt ? formatDateTime(task.dueAt) : labels.noDueDate}
              />
              <DetailRow
                label={labels.department}
                value={task.department?.name ?? labels.emptyDash}
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
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[hsl(var(--border))] p-3">
      <p className="text-xs font-semibold uppercase text-[hsl(var(--muted-foreground))]">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold">{value}</p>
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

function TaskResultsSkeleton({ view }: { view: TaskView }) {
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

function isTaskView(value: unknown): value is TaskView {
  return value === 'list' || value === 'grid' || value === 'compact';
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
  dueFrom: string;
  dueTo: string;
}

interface SelectedTask {
  workspaceId: string;
  taskId: string;
}

type TaskView = 'list' | 'grid' | 'compact';

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
  ] as const;
  return Object.fromEntries(keys.map((key) => [key, t(locale, `workspaceTasks.${key}`)])) as Record<
    (typeof keys)[number],
    string
  >;
}
