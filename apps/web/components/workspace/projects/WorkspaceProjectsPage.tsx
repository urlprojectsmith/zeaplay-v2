'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  Clock,
  Download,
  ExternalLink,
  Link as LinkIcon,
  Paperclip,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { ApiClientError } from '@zea-play/api-client';
import { toast } from 'sonner';
import {
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@zea-play/ui';
import type { Locale } from '../../../lib/i18n';
import { useLanguage } from '../../../contexts/language-provider';
import { useSessionStore } from '../../../stores/session';
import {
  listDepartments,
  listWorkspaceUsers,
  type WorkspaceUser,
} from '../../../services/workspace-management';
import { listWorkspaceStatuses, statusKeys } from '../../../services/workspace-statuses';
import { listWorkspaceRoles, rolesKeys } from '../../../services/workspace-roles';
import {
  listWorkspaceTags,
  listWorkspaceTasks,
  type WorkspaceTagSummary,
  type WorkspaceTask,
} from '../../../services/workspace-tasks';
import { AllTasksBrowser } from '../tasks/AllTasksBrowser';
import { TaskCreateDialog, taskLabels } from '../tasks/WorkspaceTasksPage';
import {
  addWorkspaceProjectTags,
  addWorkspaceProjectMembers,
  addWorkspaceProjectUrlAttachment,
  completeWorkspaceProjectAttachmentUpload,
  createWorkspaceProject,
  deleteWorkspaceProject,
  downloadWorkspaceProjectAttachment,
  exportWorkspaceProjectReportsCsv,
  getWorkspaceProject,
  getWorkspaceProjectReports,
  initWorkspaceProjectAttachmentUpload,
  listWorkspaceProjectActivity,
  listWorkspaceProjectAttachments,
  listWorkspaceProjectTags,
  listWorkspaceProjectMembers,
  listWorkspaceProjects,
  linkWorkspaceProjectTasks,
  normalizeProjectListParams,
  projectKeys,
  unlinkWorkspaceProjectTasks,
  removeWorkspaceProjectTags,
  removeWorkspaceProjectMember,
  removeWorkspaceProjectAttachment,
  type ProjectActivityItem,
  type ProjectAttachmentSummary,
  type ProjectMember,
  type ProjectPayload,
  type ProjectMembershipSummary,
  type ProjectReportParams,
  type ProjectReportsSummary,
  type ProjectTag,
  type ProjectPriority,
  type ProjectSortBy,
  type ProjectSortDirection,
  type ProjectVisibility,
  type WorkspaceProjectSummary,
  updateWorkspaceProject,
  updateWorkspaceProjectOwner,
  updateWorkspaceProjectProgress,
  updateWorkspaceProjectStatus,
} from '../../../services/workspace-projects';

const priorities: ProjectPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const visibilities: ProjectVisibility[] = ['WORKSPACE', 'RESTRICTED'];
const projectSortOptions: ProjectSortBy[] = [
  'updatedAt',
  'createdAt',
  'name',
  'dueAt',
  'plannedStartAt',
  'priority',
];
const noneValue = '__none__';
const maxProjectAttachmentBytes = 25 * 1024 * 1024;
const driveSuggestionBytes = 2 * 1024 * 1024;
type ProjectDetailTab =
  'overview' | 'tasks' | 'kanban' | 'timeline' | 'files' | 'members' | 'activity' | 'reports';

function projectDetailTab(value: string | null): ProjectDetailTab {
  return value === 'tasks' ||
    value === 'kanban' ||
    value === 'timeline' ||
    value === 'files' ||
    value === 'members' ||
    value === 'activity' ||
    value === 'reports'
    ? value
    : 'overview';
}

export function WorkspaceProjectsPage() {
  const { locale, t } = useLanguage();
  const { accessToken, selectedWorkspaceId, hydrated, hydrate } = useSessionStore();
  const workspaceTimezone = useWorkspaceTimezone(selectedWorkspaceId);
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const previousWorkspaceId = useRef<string | null>(null);
  const [search, setSearch] = useState(() => searchParams.get('search') ?? '');
  const [statusDefinitionId, setStatusDefinitionId] = useState(
    () => searchParams.get('status') ?? '',
  );
  const [priority, setPriority] = useState(() =>
    isProjectPriority(searchParams.get('priority')) ? searchParams.get('priority')! : '',
  );
  const [tagId, setTagId] = useState(() => searchParams.get('tag') ?? '');
  const [departmentId, setDepartmentId] = useState(() => searchParams.get('department') ?? '');
  const [plannedFrom, setPlannedFrom] = useState(() => searchParams.get('plannedFrom') ?? '');
  const [plannedTo, setPlannedTo] = useState(() => searchParams.get('plannedTo') ?? '');
  const [dueFrom, setDueFrom] = useState(() => searchParams.get('dueFrom') ?? '');
  const [dueTo, setDueTo] = useState(() => searchParams.get('dueTo') ?? '');
  const [sortBy, setSortBy] = useState<ProjectSortBy>(() => {
    const urlSort = searchParams.get('sort');
    return isProjectSortOption(urlSort) ? urlSort : 'updatedAt';
  });
  const [sortDirection, setSortDirection] = useState<ProjectSortDirection>(() =>
    searchParams.get('direction') === 'asc' ? 'asc' : 'desc',
  );
  const [page, setPage] = useState(() => safePositiveInt(searchParams.get('page'), 1));
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (previousWorkspaceId.current === null) {
      previousWorkspaceId.current = selectedWorkspaceId;
      return;
    }
    if (previousWorkspaceId.current === selectedWorkspaceId) return;
    previousWorkspaceId.current = selectedWorkspaceId;
    setSearch('');
    setStatusDefinitionId('');
    setPriority('');
    setTagId('');
    setDepartmentId('');
    setPlannedFrom('');
    setPlannedTo('');
    setDueFrom('');
    setDueTo('');
    setSortBy('updatedAt');
    setSortDirection('desc');
    setPage(1);
    setCreateOpen(false);
    router.replace(pathname as Route, { scroll: false });
  }, [pathname, router, selectedWorkspaceId]);

  useEffect(() => {
    const next = projectListUrlParams({
      search,
      statusDefinitionId,
      priority,
      tagId,
      departmentId,
      plannedFrom,
      plannedTo,
      dueFrom,
      dueTo,
      sortBy,
      sortDirection,
      page,
    });
    if (next.toString() !== searchParams.toString()) {
      router.replace(`${pathname}${next.toString() ? `?${next.toString()}` : ''}` as Route, {
        scroll: false,
      });
    }
  }, [
    departmentId,
    dueFrom,
    dueTo,
    page,
    pathname,
    plannedFrom,
    plannedTo,
    priority,
    router,
    search,
    searchParams,
    sortBy,
    sortDirection,
    statusDefinitionId,
    tagId,
  ]);

  const params = normalizeProjectListParams({
    page,
    pageSize: 20,
    search,
    statusDefinitionId,
    priority: priority as ProjectPriority,
    tagId,
    departmentId,
    plannedFrom,
    plannedTo,
    dueFrom,
    dueTo,
    sortBy,
    sortDirection,
  });
  const hasProjectListFilters = Boolean(
    search.trim() ||
    statusDefinitionId ||
    priority ||
    tagId ||
    departmentId ||
    plannedFrom ||
    plannedTo ||
    dueFrom ||
    dueTo,
  );

  const projectsQuery = useQuery({
    queryKey: projectKeys.list(selectedWorkspaceId, params),
    queryFn: () => listWorkspaceProjects(selectedWorkspaceId as string, params),
    enabled: Boolean(accessToken && selectedWorkspaceId),
  });

  const statusesQuery = useProjectStatuses(selectedWorkspaceId, accessToken);
  const departmentsQuery = useDepartments(selectedWorkspaceId, accessToken);
  const tagsQuery = useWorkspaceTags(selectedWorkspaceId, accessToken);
  const usersQuery = useWorkspaceMemberSearch(selectedWorkspaceId, accessToken, '');
  const selectedWorkspace = useSelectedWorkspace(selectedWorkspaceId);
  const rolesQuery = useQuery({
    queryKey: rolesKeys.all(selectedWorkspaceId),
    queryFn: () => listWorkspaceRoles(selectedWorkspaceId as string),
    enabled: Boolean(accessToken && selectedWorkspaceId && selectedWorkspace?.role),
    staleTime: 30_000,
  });
  const permissions = useMemo(() => {
    const role = rolesQuery.data?.find(
      (item) => item.key.toLowerCase() === selectedWorkspace?.role?.toLowerCase(),
    );
    return new Set(role?.permissions.map((permission) => permission.key) ?? []);
  }, [rolesQuery.data, selectedWorkspace?.role]);
  const canCreateProjects = hasPermission(permissions, 'projects.create');

  const createMutation = useMutation({
    mutationFn: (body: ProjectPayload) =>
      createWorkspaceProject(selectedWorkspaceId as string, body),
    onSuccess(project) {
      toast.success(t(locale, 'workspaceProjects.projectCreated'));
      setCreateOpen(false);
      void queryClient.invalidateQueries({ queryKey: projectKeys.all(selectedWorkspaceId) });
      router.push(`/workspace/projects/${project.id}` as Route);
    },
    onError() {
      toast.error(t(locale, 'workspaceProjects.saveFailed'));
    },
  });

  if (!hydrated) return <ProjectShell>{t(locale, 'common.loading')}</ProjectShell>;
  if (!accessToken || !selectedWorkspaceId) {
    return <ProjectShell>{t(locale, 'workspaceProjects.redirecting')}</ProjectShell>;
  }

  const projects = projectsQuery.data?.items ?? [];
  const totalPages = Math.max(1, Math.ceil((projectsQuery.data?.total ?? 0) / 20));

  return (
    <ProjectShell>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">
              {t(locale, 'navigation.projects')}
            </p>
            <h1 className="text-2xl font-semibold tracking-normal">
              {t(locale, 'workspaceProjects.projects')}
            </h1>
          </div>
          {canCreateProjects ? (
            <Button type="button" onClick={() => setCreateOpen((value) => !value)}>
              <Plus className="h-4 w-4" />
              {t(locale, 'workspaceProjects.createProject')}
            </Button>
          ) : null}
        </div>

        {createOpen ? (
          <ProjectForm
            statuses={statusesQuery.data ?? []}
            departments={departmentsQuery.data?.items ?? []}
            users={usersQuery.data?.items ?? []}
            workspaceTimezone={workspaceTimezone}
            onSubmit={(body) => createMutation.mutate(body)}
            submitting={createMutation.isPending}
          />
        ) : null}

        <section
          className="grid gap-3 md:grid-cols-4"
          aria-label={t(locale, 'workspaceProjects.searchProjects')}
        >
          <label className="md:col-span-2">
            <span className="mb-1 block text-sm font-medium">
              {t(locale, 'workspaceProjects.searchProjects')}
            </span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                value={search}
                onChange={(event) => {
                  setPage(1);
                  setSearch(event.target.value);
                }}
              />
            </div>
          </label>
          <Select
            value={statusDefinitionId || noneValue}
            onValueChange={(value) => {
              setPage(1);
              setStatusDefinitionId(value === noneValue ? '' : value);
            }}
          >
            <SelectTrigger label={t(locale, 'workspaceProjects.projectStatus')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={noneValue}>{t(locale, 'workspaceProjects.all')}</SelectItem>
              {(statusesQuery.data ?? []).map((status) => (
                <SelectItem key={status.id} value={status.id}>
                  {status.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={priority || noneValue}
            onValueChange={(value) => {
              setPage(1);
              setPriority(value === noneValue ? '' : value);
            }}
          >
            <SelectTrigger label={t(locale, 'workspaceProjects.projectPriority')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={noneValue}>{t(locale, 'workspaceProjects.all')}</SelectItem>
              {priorities.map((item) => (
                <SelectItem key={item} value={item}>
                  {priorityLabel(item, locale, t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={tagId || noneValue}
            onValueChange={(value) => {
              setPage(1);
              setTagId(value === noneValue ? '' : value);
            }}
          >
            <SelectTrigger label={t(locale, 'workspaceProjects.projectTags')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={noneValue}>{t(locale, 'workspaceProjects.all')}</SelectItem>
              {(tagsQuery.data?.items ?? []).map((tag) => (
                <SelectItem key={tag.id} value={tag.id}>
                  {tag.name}
                  {tag.status === 'ARCHIVED' ? ` (${t(locale, 'workspaceProjects.archived')})` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={departmentId || noneValue}
            onValueChange={(value) => {
              setPage(1);
              setDepartmentId(value === noneValue ? '' : value);
            }}
          >
            <SelectTrigger label={t(locale, 'workspaceProjects.department')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={noneValue}>{t(locale, 'workspaceProjects.all')}</SelectItem>
              {(departmentsQuery.data?.items ?? []).map((department) => (
                <SelectItem key={department.id} value={department.id}>
                  {department.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label>
            <span className="mb-1 block text-sm font-medium">
              {t(locale, 'workspaceProjects.plannedFrom')}
            </span>
            <Input
              type="date"
              value={plannedFrom}
              onChange={(event) => {
                setPage(1);
                setPlannedFrom(event.target.value);
              }}
            />
          </label>
          <label>
            <span className="mb-1 block text-sm font-medium">
              {t(locale, 'workspaceProjects.plannedTo')}
            </span>
            <Input
              type="date"
              value={plannedTo}
              onChange={(event) => {
                setPage(1);
                setPlannedTo(event.target.value);
              }}
            />
          </label>
          <label>
            <span className="mb-1 block text-sm font-medium">
              {t(locale, 'workspaceProjects.dueFrom')}
            </span>
            <Input
              type="date"
              value={dueFrom}
              onChange={(event) => {
                setPage(1);
                setDueFrom(event.target.value);
              }}
            />
          </label>
          <label>
            <span className="mb-1 block text-sm font-medium">
              {t(locale, 'workspaceProjects.dueTo')}
            </span>
            <Input
              type="date"
              value={dueTo}
              onChange={(event) => {
                setPage(1);
                setDueTo(event.target.value);
              }}
            />
          </label>
          <Select
            value={sortBy}
            onValueChange={(value) => {
              setPage(1);
              setSortBy(value as ProjectSortBy);
            }}
          >
            <SelectTrigger label={t(locale, 'workspaceProjects.sortBy')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {projectSortOptions.map((option) => (
                <SelectItem key={option} value={option}>
                  {projectSortLabel(option, locale, t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={sortDirection}
            onValueChange={(value) => {
              setPage(1);
              setSortDirection(value === 'asc' ? 'asc' : 'desc');
            }}
          >
            <SelectTrigger label={t(locale, 'workspaceProjects.sortDirection')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="desc">{t(locale, 'workspaceProjects.descending')}</SelectItem>
              <SelectItem value="asc">{t(locale, 'workspaceProjects.ascending')}</SelectItem>
            </SelectContent>
          </Select>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {projectsQuery.isError ? (
            <EmptyState
              title={t(locale, 'workspaceProjects.unableToLoadProjects')}
              description={t(locale, 'workspaceProjects.projectListLoadFailed')}
              action={
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void projectsQuery.refetch()}
                >
                  {t(locale, 'common.tryAgain')}
                </Button>
              }
            />
          ) : null}
          {projectsQuery.isLoading ? (
            <>
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-64 rounded-lg" />
              ))}
            </>
          ) : null}
          {!projectsQuery.isLoading && !projectsQuery.isError
            ? projects.map((project) => (
                <Link
                  key={project.id}
                  href={`/workspace/projects/${project.id}` as Route}
                  className="rounded-lg border border-border bg-card p-4 text-card-foreground transition hover:border-primary focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-base font-semibold">{project.name}</h2>
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                        {project.description || '-'}
                      </p>
                    </div>
                    <StatusBadge project={project} />
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <ProjectFact
                      label={t(locale, 'workspaceProjects.projectPriority')}
                      value={priorityLabel(project.priority, locale, t)}
                    />
                    <ProjectFact
                      label={t(locale, 'workspaceProjects.dueDate')}
                      value={formatDate(project.dueAt, locale, workspaceTimezone)}
                    />
                    <ProjectFact
                      label={t(locale, 'workspaceProjects.projectOwner')}
                      value={memberName(project.owner)}
                    />
                    <ProjectFact
                      label={t(locale, 'workspaceProjects.visibility')}
                      value={visibilityLabel(project.visibility, locale, t)}
                    />
                    <ProjectFact
                      label={t(locale, 'workspaceProjects.calculatedProgress')}
                      value={`${project.calculatedProgress}%`}
                    />
                    <ProjectFact
                      label={t(locale, 'workspaceProjects.taskCounts')}
                      value={`${project.taskCounts.completedTasks}/${project.taskCounts.totalTasks}`}
                    />
                    <ProjectFact
                      label={t(locale, 'workspaceProjects.department')}
                      value={project.department?.name ?? '-'}
                    />
                    <ProjectFact
                      label={t(locale, 'workspaceProjects.updated')}
                      value={formatDate(project.updatedAt, locale, workspaceTimezone)}
                    />
                  </dl>
                  <ProjectProgressMeter
                    project={project}
                    label={t(locale, 'workspaceProjects.effectiveProgress')}
                  />
                </Link>
              ))
            : null}
          {!projectsQuery.isLoading && !projectsQuery.isError && projects.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground sm:col-span-2 xl:col-span-3">
              <p className="font-medium text-foreground">
                {hasProjectListFilters
                  ? t(locale, 'workspaceProjects.noMatchingProjects')
                  : t(locale, 'workspaceProjects.noProjects')}
              </p>
              <p className="mt-1 text-sm">
                {hasProjectListFilters
                  ? t(locale, 'workspaceProjects.noMatchingProjectsDescription')
                  : t(locale, 'workspaceProjects.noProjectsDescription')}
              </p>
              {!hasProjectListFilters && canCreateProjects ? (
                <Button type="button" className="mt-4" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-4 w-4" />
                  {t(locale, 'workspaceProjects.createProject')}
                </Button>
              ) : null}
            </div>
          ) : null}
        </section>

        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="secondary"
            disabled={page <= 1 || projectsQuery.isFetching}
            onClick={() => setPage(page - 1)}
          >
            {t(locale, 'workspaceProjects.previous')}
          </Button>
          <span className="text-sm text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Button
            type="button"
            variant="secondary"
            disabled={page >= totalPages || projectsQuery.isFetching}
            onClick={() => setPage(page + 1)}
          >
            {t(locale, 'workspaceProjects.next')}
          </Button>
        </div>
      </div>
    </ProjectShell>
  );
}

export function WorkspaceProjectDetailPage({ projectId }: { projectId: string }) {
  const { locale, t } = useLanguage();
  const { accessToken, selectedWorkspaceId, hydrated, hydrate } = useSessionStore();
  const workspaceTimezone = useWorkspaceTimezone(selectedWorkspaceId);
  const currentMembershipId = useCurrentWorkspaceMembershipId(selectedWorkspaceId);
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');
  const [editing, setEditing] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [linkTasksOpen, setLinkTasksOpen] = useState(false);
  const [linkTaskSearch, setLinkTaskSearch] = useState('');
  const [selectedLinkTaskIds, setSelectedLinkTaskIds] = useState<string[]>([]);
  const [fileSearch, setFileSearch] = useState('');
  const [activityAction, setActivityAction] = useState('');
  const [activityUserId, setActivityUserId] = useState('');
  const [activityFrom, setActivityFrom] = useState('');
  const [activityTo, setActivityTo] = useState('');
  const [reportFrom, setReportFrom] = useState('');
  const [reportTo, setReportTo] = useState('');
  const [reportStatusId, setReportStatusId] = useState('');
  const [reportPriority, setReportPriority] = useState('');
  const [reportAssigneeId, setReportAssigneeId] = useState('');
  const [reportDepartmentId, setReportDepartmentId] = useState('');
  const [reportTagId, setReportTagId] = useState('');
  const [reportSearch, setReportSearch] = useState('');
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<ProjectDetailTab>(() => projectDetailTab(tabParam));

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    setEditing(false);
    setCreateTaskOpen(false);
    setLinkTasksOpen(false);
    setLinkTaskSearch('');
    setSelectedLinkTaskIds([]);
    setFileSearch('');
    setActivityAction('');
    setActivityUserId('');
    setActivityFrom('');
    setActivityTo('');
    setReportFrom('');
    setReportTo('');
    setReportStatusId('');
    setReportPriority('');
    setReportAssigneeId('');
    setReportDepartmentId('');
    setReportTagId('');
    setReportSearch('');
    setSelectedMemberIds([]);
    setActiveTab(projectDetailTab(tabParam));
  }, [selectedWorkspaceId, projectId, tabParam]);

  function changeProjectTab(tab: ProjectDetailTab) {
    setActiveTab(tab);
    const next = new URLSearchParams(searchParams.toString());
    if (tab === 'overview') next.delete('tab');
    else next.set('tab', tab);
    router.push(`${pathname}${next.toString() ? `?${next.toString()}` : ''}` as Route);
  }

  function refreshProjectSummaries() {
    void queryClient.invalidateQueries({
      queryKey: projectKeys.detail(selectedWorkspaceId, projectId),
    });
    void queryClient.invalidateQueries({ queryKey: projectKeys.all(selectedWorkspaceId) });
  }

  const projectQuery = useQuery({
    queryKey: projectKeys.detail(selectedWorkspaceId, projectId),
    queryFn: () => getWorkspaceProject(selectedWorkspaceId as string, projectId),
    enabled: Boolean(accessToken && selectedWorkspaceId && projectId),
  });
  const statusesQuery = useProjectStatuses(selectedWorkspaceId, accessToken);
  const departmentsQuery = useDepartments(selectedWorkspaceId, accessToken);
  const usersQuery = useWorkspaceMemberSearch(selectedWorkspaceId, accessToken, memberSearch);
  const selectedWorkspace = useSelectedWorkspace(selectedWorkspaceId);
  const rolesQuery = useQuery({
    queryKey: rolesKeys.all(selectedWorkspaceId),
    queryFn: () => listWorkspaceRoles(selectedWorkspaceId as string),
    enabled: Boolean(accessToken && selectedWorkspaceId && selectedWorkspace?.role),
    staleTime: 30_000,
  });
  const permissions = useMemo(() => {
    const role = rolesQuery.data?.find(
      (item) => item.key.toLowerCase() === selectedWorkspace?.role?.toLowerCase(),
    );
    return new Set(role?.permissions.map((permission) => permission.key) ?? []);
  }, [rolesQuery.data, selectedWorkspace?.role]);
  const canUpdateProject = hasPermission(permissions, 'projects.update');
  const canDeleteProject = hasPermission(permissions, 'projects.delete');
  const canManageProjectStatus =
    canUpdateProject && hasPermission(permissions, 'projects.manage_status');
  const canManageProjectProgress = hasPermission(permissions, 'projects.manage_progress');
  const canManageProjectTags = canUpdateProject && hasPermission(permissions, 'tags.assign');
  const canManageProjectMembers =
    canUpdateProject && hasPermission(permissions, 'projects.manage_members');
  const canManageProjectOwner =
    canUpdateProject && hasPermission(permissions, 'projects.manage_owner');
  const canViewFiles = hasPermission(permissions, 'projects.files.view');
  const canViewActivity = hasPermission(permissions, 'projects.activity.view');
  const canViewReports =
    hasPermission(permissions, 'projects.reports.view') && hasPermission(permissions, 'tasks.view');

  useEffect(() => {
    if (!rolesQuery.isFetched) return;
    const hiddenTab =
      (activeTab === 'files' && !canViewFiles) ||
      (activeTab === 'activity' && !canViewActivity) ||
      (activeTab === 'reports' && !canViewReports);
    if (!hiddenTab) return;
    setActiveTab('overview');
    const next = new URLSearchParams(searchParams.toString());
    next.delete('tab');
    router.replace(`${pathname}${next.toString() ? `?${next.toString()}` : ''}` as Route, {
      scroll: false,
    });
  }, [
    activeTab,
    canViewActivity,
    canViewFiles,
    canViewReports,
    pathname,
    rolesQuery.isFetched,
    router,
    searchParams,
  ]);
  const reportParams = useMemo<ProjectReportParams>(
    () => ({
      ...(reportFrom ? { from: reportFrom } : {}),
      ...(reportTo ? { to: reportTo } : {}),
      ...(reportStatusId ? { statusDefinitionId: reportStatusId } : {}),
      ...(reportPriority ? { priority: reportPriority as ProjectPriority } : {}),
      ...(reportAssigneeId ? { assigneeMembershipId: reportAssigneeId } : {}),
      ...(reportDepartmentId ? { departmentId: reportDepartmentId } : {}),
      ...(reportTagId ? { tagId: reportTagId } : {}),
      ...(reportSearch.trim() ? { search: reportSearch.trim() } : {}),
    }),
    [
      reportAssigneeId,
      reportDepartmentId,
      reportFrom,
      reportPriority,
      reportSearch,
      reportStatusId,
      reportTagId,
      reportTo,
    ],
  );
  const membersQuery = useQuery({
    queryKey: projectKeys.members(selectedWorkspaceId, projectId, {
      page: 1,
      pageSize: 20,
      search: memberSearch,
    }),
    queryFn: () =>
      listWorkspaceProjectMembers(selectedWorkspaceId as string, projectId, {
        page: 1,
        pageSize: 20,
        search: memberSearch,
      }),
    enabled: Boolean(accessToken && selectedWorkspaceId && projectId && activeTab === 'members'),
  });
  const attachmentsQuery = useQuery({
    queryKey: projectKeys.attachments(selectedWorkspaceId, projectId, {
      page: 1,
      pageSize: 20,
      search: fileSearch,
    }),
    queryFn: () =>
      listWorkspaceProjectAttachments(selectedWorkspaceId as string, projectId, {
        page: 1,
        pageSize: 20,
        search: fileSearch,
      }),
    enabled: Boolean(accessToken && selectedWorkspaceId && projectId && activeTab === 'files'),
  });
  const activityQuery = useQuery({
    queryKey: projectKeys.activity(selectedWorkspaceId, projectId, {
      page: 1,
      pageSize: 20,
      action: activityAction,
      userId: activityUserId,
      from: activityFrom,
      to: activityTo,
    }),
    queryFn: () =>
      listWorkspaceProjectActivity(selectedWorkspaceId as string, projectId, {
        page: 1,
        pageSize: 20,
        action: activityAction || undefined,
        userId: activityUserId || undefined,
        from: activityFrom || undefined,
        to: activityTo || undefined,
      }),
    enabled: Boolean(accessToken && selectedWorkspaceId && projectId && activeTab === 'activity'),
  });
  const reportsQuery = useQuery({
    queryKey: projectKeys.reports(selectedWorkspaceId, projectId, reportParams),
    queryFn: () =>
      getWorkspaceProjectReports(selectedWorkspaceId as string, projectId, reportParams),
    enabled: Boolean(
      accessToken && selectedWorkspaceId && projectId && activeTab === 'reports' && canViewReports,
    ),
  });
  const tagsQuery = useQuery({
    queryKey: projectKeys.tags(selectedWorkspaceId, projectId),
    queryFn: () => listWorkspaceProjectTags(selectedWorkspaceId as string, projectId),
    enabled: Boolean(accessToken && selectedWorkspaceId && projectId),
  });
  const tagCatalogQuery = useWorkspaceTags(selectedWorkspaceId, accessToken);
  const linkTaskCandidatesQuery = useQuery({
    queryKey: [
      'workspace',
      selectedWorkspaceId,
      'projects',
      'detail',
      projectId,
      'task-link-candidates',
      linkTaskSearch.trim(),
    ],
    queryFn: () =>
      listWorkspaceTasks(selectedWorkspaceId as string, {
        page: 1,
        pageSize: 20,
        search: linkTaskSearch.trim() || undefined,
        sortBy: 'updatedAt',
        sortDirection: 'desc',
      }),
    enabled: Boolean(accessToken && selectedWorkspaceId && projectId && linkTasksOpen),
  });

  const updateMutation = useMutation({
    mutationFn: (body: ProjectPayload) =>
      updateWorkspaceProject(selectedWorkspaceId as string, projectId, body),
    onSuccess(_project, body) {
      toast.success(t(locale, 'workspaceProjects.projectUpdated'));
      setEditing(false);
      void queryClient.invalidateQueries({ queryKey: projectKeys.all(selectedWorkspaceId) });
      if (body.visibility === 'RESTRICTED') {
        clearProjectDetailAndReturn(
          queryClient,
          selectedWorkspaceId,
          projectId,
          router,
          t(locale, 'workspaceProjects.accessLost'),
        );
      }
    },
    onError() {
      toast.error(t(locale, 'workspaceProjects.saveFailed'));
    },
  });

  const statusMutation = useMutation({
    mutationFn: (statusDefinitionId: string) =>
      updateWorkspaceProjectStatus(selectedWorkspaceId as string, projectId, statusDefinitionId),
    onSuccess() {
      toast.success(t(locale, 'workspaceProjects.projectUpdated'));
      void queryClient.invalidateQueries({ queryKey: projectKeys.all(selectedWorkspaceId) });
    },
    onError(error) {
      toast.error(projectStatusErrorMessage(locale, t, error));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteWorkspaceProject(selectedWorkspaceId as string, projectId),
    onSuccess() {
      toast.success(t(locale, 'workspaceProjects.projectDeleted'));
      void queryClient.invalidateQueries({ queryKey: projectKeys.all(selectedWorkspaceId) });
    },
  });

  const addMemberMutation = useMutation({
    mutationFn: (membershipIds: string[]) =>
      addWorkspaceProjectMembers(selectedWorkspaceId as string, projectId, membershipIds),
    onSuccess() {
      setSelectedMemberIds([]);
      void queryClient.invalidateQueries({ queryKey: projectKeys.all(selectedWorkspaceId) });
      void queryClient.invalidateQueries({
        queryKey: projectKeys.members(selectedWorkspaceId, projectId, {
          page: 1,
          pageSize: 20,
          search: memberSearch,
        }),
      });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: (membershipId: string) =>
      removeWorkspaceProjectMember(selectedWorkspaceId as string, projectId, membershipId),
    onSuccess(_result, membershipId) {
      void queryClient.invalidateQueries({ queryKey: projectKeys.all(selectedWorkspaceId) });
      void queryClient.invalidateQueries({
        queryKey: projectKeys.members(selectedWorkspaceId, projectId, {
          page: 1,
          pageSize: 20,
          search: memberSearch,
        }),
      });
      if (membershipId === currentMembershipId && project?.visibility === 'RESTRICTED') {
        clearProjectDetailAndReturn(
          queryClient,
          selectedWorkspaceId,
          projectId,
          router,
          t(locale, 'workspaceProjects.accessLost'),
        );
      }
    },
  });

  const ownerMutation = useMutation({
    mutationFn: (membershipId: string) =>
      updateWorkspaceProjectOwner(selectedWorkspaceId as string, projectId, membershipId),
    onSuccess(_updated, membershipId) {
      void queryClient.invalidateQueries({ queryKey: projectKeys.all(selectedWorkspaceId) });
      void queryClient.invalidateQueries({
        queryKey: projectKeys.detail(selectedWorkspaceId, projectId),
      });
      if (
        project?.visibility === 'RESTRICTED' &&
        project.ownerMembershipId === currentMembershipId &&
        membershipId !== currentMembershipId
      ) {
        clearProjectDetailAndReturn(
          queryClient,
          selectedWorkspaceId,
          projectId,
          router,
          t(locale, 'workspaceProjects.accessLost'),
        );
      }
    },
  });

  const addTagsMutation = useMutation({
    mutationFn: (tagIds: string[]) =>
      addWorkspaceProjectTags(selectedWorkspaceId as string, projectId, tagIds),
    onSuccess() {
      void queryClient.invalidateQueries({
        queryKey: projectKeys.tags(selectedWorkspaceId, projectId),
      });
      void queryClient.invalidateQueries({ queryKey: projectKeys.all(selectedWorkspaceId) });
    },
    onError() {
      toast.error(t(locale, 'workspaceProjects.tagUpdateFailed'));
    },
  });

  const removeTagsMutation = useMutation({
    mutationFn: (tagIds: string[]) =>
      removeWorkspaceProjectTags(selectedWorkspaceId as string, projectId, tagIds),
    onSuccess() {
      void queryClient.invalidateQueries({
        queryKey: projectKeys.tags(selectedWorkspaceId, projectId),
      });
      void queryClient.invalidateQueries({ queryKey: projectKeys.all(selectedWorkspaceId) });
    },
    onError() {
      toast.error(t(locale, 'workspaceProjects.tagUpdateFailed'));
    },
  });

  const progressMutation = useMutation({
    mutationFn: (manualProgressPercent: number | null) =>
      updateWorkspaceProjectProgress(
        selectedWorkspaceId as string,
        projectId,
        manualProgressPercent,
      ),
    onSuccess() {
      toast.success(t(locale, 'workspaceProjects.projectUpdated'));
      void queryClient.invalidateQueries({ queryKey: projectKeys.all(selectedWorkspaceId) });
    },
    onError() {
      toast.error(t(locale, 'workspaceProjects.progressUpdateFailed'));
    },
  });

  const linkTasksMutation = useMutation({
    mutationFn: (taskIds: string[]) =>
      linkWorkspaceProjectTasks(selectedWorkspaceId as string, projectId, taskIds),
    async onSuccess(result) {
      toast.success(
        `${result.changedCount} ${t(locale, 'workspaceProjects.tasksLinked')}${
          result.unchangedCount
            ? ` ${result.unchangedCount} ${t(locale, 'workspaceProjects.alreadyLinked')}`
            : ''
        }`,
      );
      setLinkTasksOpen(false);
      setSelectedLinkTaskIds([]);
      setLinkTaskSearch('');
      await invalidateProjectTasks(queryClient, selectedWorkspaceId, projectId);
    },
    onError() {
      toast.error(t(locale, 'workspaceProjects.unableToLinkTask'));
    },
  });

  const unlinkTasksMutation = useMutation({
    mutationFn: (taskId: string) =>
      unlinkWorkspaceProjectTasks(selectedWorkspaceId as string, projectId, [taskId]),
    async onSuccess() {
      toast.success(t(locale, 'workspaceProjects.taskRemovedFromProject'));
      await invalidateProjectTasks(queryClient, selectedWorkspaceId, projectId);
    },
    onError() {
      toast.error(t(locale, 'workspaceProjects.unableToRemoveTask'));
    },
  });

  if (!hydrated) return <ProjectShell>{t(locale, 'common.loading')}</ProjectShell>;
  const project = projectQuery.data;

  return (
    <ProjectShell>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <Link href={'/workspace/projects' as Route} className="text-sm text-primary">
              {t(locale, 'workspaceProjects.projects')}
            </Link>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal">
              {project?.name ?? t(locale, 'workspaceProjects.projects')}
            </h1>
          </div>
          {project ? (
            <div className="flex gap-2">
              {canUpdateProject ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setEditing((value) => !value)}
                >
                  {t(locale, 'workspaceProjects.editProject')}
                </Button>
              ) : null}
              {canDeleteProject ? (
                <Button type="button" variant="danger" onClick={() => deleteMutation.mutate()}>
                  {t(locale, 'workspaceProjects.deleteProject')}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        {project ? (
          <>
            {editing && canUpdateProject ? (
              <ProjectForm
                project={project}
                statuses={statusesQuery.data ?? []}
                departments={departmentsQuery.data?.items ?? []}
                users={usersQuery.data?.items ?? []}
                workspaceTimezone={workspaceTimezone}
                onSubmit={(body) => updateMutation.mutate(body)}
                submitting={updateMutation.isPending}
              />
            ) : null}
            <ProjectDetailHeader
              project={project}
              workspaceTimezone={workspaceTimezone}
              locale={locale}
              t={t}
            />
            <Tabs
              value={activeTab}
              onValueChange={(value) => changeProjectTab(projectDetailTab(value))}
              className="grid gap-4"
            >
              <TabsList aria-label={t(locale, 'workspaceProjects.projectTabs')}>
                <TabsTrigger value="overview">
                  {t(locale, 'workspaceProjects.overview')}
                </TabsTrigger>
                <TabsTrigger value="tasks">
                  {t(locale, 'workspaceProjects.projectTasks')}
                </TabsTrigger>
                <TabsTrigger value="kanban">
                  {t(locale, 'workspaceProjects.projectKanban')}
                </TabsTrigger>
                <TabsTrigger value="timeline">
                  {t(locale, 'workspaceProjects.projectTimeline')}
                </TabsTrigger>
                {canViewFiles ? (
                  <TabsTrigger value="files">
                    {t(locale, 'workspaceProjects.projectFiles')}
                  </TabsTrigger>
                ) : null}
                <TabsTrigger value="members">
                  {t(locale, 'workspaceProjects.projectMembers')}
                </TabsTrigger>
                {canViewActivity ? (
                  <TabsTrigger value="activity">
                    {t(locale, 'workspaceProjects.projectActivity')}
                  </TabsTrigger>
                ) : null}
                {canViewReports ? (
                  <TabsTrigger value="reports">
                    {t(locale, 'workspaceProjects.projectReports')}
                  </TabsTrigger>
                ) : null}
              </TabsList>
              <TabsContent value="overview" className="grid gap-4">
                <section className="rounded-lg border border-border bg-card p-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <ProjectFact
                      label={t(locale, 'workspaceProjects.projectDescription')}
                      value={project.description || '-'}
                    />
                    <ProjectFact
                      label={t(locale, 'workspaceProjects.projectStatus')}
                      value={project.status?.name ?? '-'}
                    />
                    <ProjectFact
                      label={t(locale, 'workspaceProjects.projectPriority')}
                      value={priorityLabel(project.priority, locale, t)}
                    />
                    <ProjectFact
                      label={t(locale, 'workspaceProjects.plannedStart')}
                      value={formatDate(project.plannedStartAt, locale, workspaceTimezone)}
                    />
                    <ProjectFact
                      label={t(locale, 'workspaceProjects.dueDate')}
                      value={formatDate(project.dueAt, locale, workspaceTimezone)}
                    />
                    <ProjectFact
                      label={t(locale, 'workspaceProjects.department')}
                      value={project.department?.name ?? '-'}
                    />
                    <ProjectFact
                      label={t(locale, 'workspaceProjects.projectOwner')}
                      value={memberName(project.owner)}
                    />
                    <ProjectFact
                      label={t(locale, 'workspaceProjects.visibility')}
                      value={visibilityLabel(project.visibility, locale, t)}
                    />
                    <ProjectFact
                      label={t(locale, 'workspaceProjects.projectMembers')}
                      value={String(project.memberCount)}
                    />
                  </div>
                  <div className="mt-4 max-w-xs">
                    <Select
                      value={project.statusDefinitionId ?? ''}
                      onValueChange={(value) => statusMutation.mutate(value)}
                      disabled={!canManageProjectStatus}
                    >
                      <SelectTrigger label={t(locale, 'workspaceProjects.projectStatus')}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(statusesQuery.data ?? []).map((status) => (
                          <SelectItem key={status.id} value={status.id}>
                            {status.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </section>
                <ProjectProgressSection
                  project={project}
                  onUpdate={(value) => progressMutation.mutate(value)}
                  updating={progressMutation.isPending}
                  canManage={canManageProjectProgress}
                />
                <ProjectTagsSection
                  tags={tagsQuery.data ?? []}
                  catalog={tagCatalogQuery.data?.items ?? []}
                  onAdd={(tagIds) => addTagsMutation.mutate(tagIds)}
                  onRemove={(tagId) => removeTagsMutation.mutate([tagId])}
                  updating={addTagsMutation.isPending || removeTagsMutation.isPending}
                  canManage={canManageProjectTags}
                />
              </TabsContent>
              <TabsContent value="tasks" className="grid gap-4">
                {activeTab === 'tasks' ? (
                  <>
                    <ProjectTasksToolbar
                      onCreate={() => setCreateTaskOpen(true)}
                      onLink={() => setLinkTasksOpen(true)}
                    />
                    <AllTasksBrowser
                      workspaceId={selectedWorkspaceId}
                      projectContext={{
                        projectId,
                        view: 'list',
                        removingTaskId: unlinkTasksMutation.variables ?? null,
                        onRemove: (task) => {
                          if (
                            window.confirm(t(locale, 'workspaceProjects.removeFromProjectConfirm'))
                          ) {
                            unlinkTasksMutation.mutate(task.id);
                          }
                        },
                        onTaskStatusChanged: refreshProjectSummaries,
                      }}
                    />
                  </>
                ) : null}
              </TabsContent>
              <TabsContent value="kanban" className="grid gap-4">
                {activeTab === 'kanban' ? (
                  <AllTasksBrowser
                    workspaceId={selectedWorkspaceId}
                    projectContext={{
                      projectId,
                      view: 'kanban',
                      removingTaskId: null,
                      onRemove: () => undefined,
                      onTaskStatusChanged: refreshProjectSummaries,
                    }}
                  />
                ) : null}
              </TabsContent>
              <TabsContent value="timeline" className="grid gap-4">
                {activeTab === 'timeline' ? (
                  <AllTasksBrowser
                    workspaceId={selectedWorkspaceId}
                    projectContext={{
                      projectId,
                      view: 'gantt',
                      removingTaskId: null,
                      onRemove: () => undefined,
                    }}
                  />
                ) : null}
              </TabsContent>
              <TabsContent value="files" className="grid gap-4">
                {activeTab === 'files' && canViewFiles ? (
                  <ProjectFilesSection
                    workspaceId={selectedWorkspaceId}
                    projectId={projectId}
                    files={attachmentsQuery.data?.items ?? []}
                    loading={attachmentsQuery.isLoading}
                    error={attachmentsQuery.isError}
                    search={fileSearch}
                    canAdd={hasPermission(permissions, 'projects.files.add')}
                    canRemove={hasPermission(permissions, 'projects.files.remove')}
                    canDownload={hasPermission(permissions, 'projects.files.download')}
                    onSearch={setFileSearch}
                    onRetry={() => void attachmentsQuery.refetch()}
                  />
                ) : null}
              </TabsContent>
              <TabsContent value="members" className="grid gap-4">
                {activeTab === 'members' ? (
                  <ProjectMembersSection
                    project={project}
                    members={membersQuery.data?.items ?? []}
                    users={usersQuery.data?.items ?? []}
                    search={memberSearch}
                    selectedMemberIds={selectedMemberIds}
                    onSearch={setMemberSearch}
                    onToggleSelected={(membershipId) =>
                      setSelectedMemberIds((current) =>
                        current.includes(membershipId)
                          ? current.filter((id) => id !== membershipId)
                          : [...current, membershipId],
                      )
                    }
                    onAdd={() => addMemberMutation.mutate(selectedMemberIds)}
                    onRemove={(membershipId) => removeMemberMutation.mutate(membershipId)}
                    onOwnerChange={(membershipId) => ownerMutation.mutate(membershipId)}
                    adding={addMemberMutation.isPending}
                    canManageMembers={canManageProjectMembers}
                    canManageOwner={canManageProjectOwner}
                  />
                ) : null}
              </TabsContent>
              <TabsContent value="activity" className="grid gap-4">
                {activeTab === 'activity' && canViewActivity ? (
                  <ProjectActivitySection
                    items={activityQuery.data?.items ?? []}
                    loading={activityQuery.isLoading}
                    error={activityQuery.isError}
                    action={activityAction}
                    userId={activityUserId}
                    from={activityFrom}
                    to={activityTo}
                    onActionChange={setActivityAction}
                    onUserChange={setActivityUserId}
                    onFromChange={setActivityFrom}
                    onToChange={setActivityTo}
                    onRetry={() => void activityQuery.refetch()}
                    workspaceTimezone={workspaceTimezone}
                  />
                ) : null}
              </TabsContent>
              <TabsContent value="reports" className="grid gap-4">
                {activeTab === 'reports' && canViewReports ? (
                  <ProjectReportsSection
                    report={reportsQuery.data}
                    loading={reportsQuery.isLoading}
                    error={reportsQuery.isError}
                    from={reportFrom}
                    to={reportTo}
                    statusDefinitionId={reportStatusId}
                    priority={reportPriority}
                    assigneeMembershipId={reportAssigneeId}
                    departmentId={reportDepartmentId}
                    tagId={reportTagId}
                    search={reportSearch}
                    statuses={statusesQuery.data ?? []}
                    users={usersQuery.data?.items ?? []}
                    departments={departmentsQuery.data?.items ?? []}
                    tags={tagCatalogQuery.data?.items ?? []}
                    onFromChange={setReportFrom}
                    onToChange={setReportTo}
                    onStatusChange={setReportStatusId}
                    onPriorityChange={setReportPriority}
                    onAssigneeChange={setReportAssigneeId}
                    onDepartmentChange={setReportDepartmentId}
                    onTagChange={setReportTagId}
                    onSearchChange={setReportSearch}
                    onRetry={() => void reportsQuery.refetch()}
                    onExport={() => {
                      void exportWorkspaceProjectReportsCsv(
                        selectedWorkspaceId as string,
                        projectId,
                        reportParams,
                      ).then((result) =>
                        downloadCsv(result.filename, result.csv, result.contentType),
                      );
                    }}
                  />
                ) : null}
              </TabsContent>
            </Tabs>
            <TaskCreateDialog
              labels={taskLabels(locale, t)}
              open={createTaskOpen}
              workspaceId={selectedWorkspaceId}
              prefill={{ projectIds: [projectId] }}
              onOpenChange={setCreateTaskOpen}
              onCreated={() => invalidateProjectTasks(queryClient, selectedWorkspaceId, projectId)}
            />
            <LinkExistingTasksDialog
              open={linkTasksOpen}
              search={linkTaskSearch}
              tasks={linkTaskCandidatesQuery.data?.items ?? []}
              selectedTaskIds={selectedLinkTaskIds}
              loading={linkTaskCandidatesQuery.isLoading}
              linking={linkTasksMutation.isPending}
              onOpenChange={setLinkTasksOpen}
              onSearch={setLinkTaskSearch}
              onToggle={(taskId) =>
                setSelectedLinkTaskIds((current) =>
                  current.includes(taskId)
                    ? current.filter((id) => id !== taskId)
                    : current.length < 100
                      ? [...current, taskId]
                      : current,
                )
              }
              onSubmit={() => linkTasksMutation.mutate(selectedLinkTaskIds)}
            />
          </>
        ) : (
          <div className="rounded-lg border border-border p-6">{t(locale, 'common.loading')}</div>
        )}
      </div>
    </ProjectShell>
  );
}

function ProjectForm({
  project,
  statuses,
  departments,
  users,
  workspaceTimezone,
  onSubmit,
  submitting,
}: {
  project?: WorkspaceProjectSummary;
  statuses: { id: string; name: string }[];
  departments: { id: string; name: string; status: string }[];
  users: WorkspaceUser[];
  workspaceTimezone: string;
  onSubmit: (body: ProjectPayload) => void;
  submitting: boolean;
}) {
  const { locale, t } = useLanguage();
  const [advanced, setAdvanced] = useState(
    Boolean(project?.description || project?.plannedStartAt || project?.departmentId),
  );
  const [form, setForm] = useState<{
    name: string;
    description: string;
    statusDefinitionId: string;
    priority: ProjectPriority;
    visibility: ProjectVisibility;
    ownerMembershipId: string;
    memberMembershipId: string;
    plannedStartAt: string;
    dueAt: string;
    departmentId: string;
  }>({
    name: project?.name ?? '',
    description: project?.description ?? '',
    statusDefinitionId: project?.statusDefinitionId ?? statuses.find((item) => item)?.id ?? '',
    priority: project?.priority ?? 'MEDIUM',
    visibility: project?.visibility ?? 'WORKSPACE',
    ownerMembershipId: project?.ownerMembershipId ?? '',
    memberMembershipId: '',
    plannedStartAt: toDateInput(project?.plannedStartAt, workspaceTimezone),
    dueAt: toDateInput(project?.dueAt, workspaceTimezone),
    departmentId: project?.departmentId ?? '',
  });
  const invalidRange = Boolean(
    form.plannedStartAt && form.dueAt && form.plannedStartAt > form.dueAt,
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.name.trim() || invalidRange) return;
    onSubmit({
      name: form.name,
      statusDefinitionId: form.statusDefinitionId || undefined,
      dueAt: fromDateInput(form.dueAt, workspaceTimezone),
      description: advanced ? form.description : undefined,
      priority: form.priority as ProjectPriority,
      visibility: form.visibility,
      ownerMembershipId: form.ownerMembershipId || undefined,
      memberMembershipIds: form.memberMembershipId ? [form.memberMembershipId] : undefined,
      plannedStartAt: advanced ? fromDateInput(form.plannedStartAt, workspaceTimezone) : undefined,
      departmentId: advanced ? form.departmentId || null : undefined,
    });
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-border bg-card p-4">
      <div className="grid gap-3 md:grid-cols-3">
        <label>
          <span className="mb-1 block text-sm font-medium">
            {t(locale, 'workspaceProjects.projectName')}
          </span>
          <Input
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            required
            maxLength={160}
          />
        </label>
        <Select
          value={form.statusDefinitionId}
          onValueChange={(value) => setForm({ ...form, statusDefinitionId: value })}
        >
          <SelectTrigger label={t(locale, 'workspaceProjects.projectStatus')}>
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
        <Select
          value={form.ownerMembershipId || noneValue}
          onValueChange={(value) =>
            setForm({ ...form, ownerMembershipId: value === noneValue ? '' : value })
          }
        >
          <SelectTrigger label={t(locale, 'workspaceProjects.projectOwner')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={noneValue}>{t(locale, 'workspaceProjects.currentUser')}</SelectItem>
            {users.map((user) => (
              <SelectItem key={user.membershipId} value={user.membershipId}>
                {user.name || user.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={form.visibility}
          onValueChange={(value) => setForm({ ...form, visibility: value as ProjectVisibility })}
        >
          <SelectTrigger label={t(locale, 'workspaceProjects.visibility')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {visibilities.map((visibility) => (
              <SelectItem key={visibility} value={visibility}>
                {visibilityLabel(visibility, locale, t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label>
          <span className="mb-1 block text-sm font-medium">
            {t(locale, 'workspaceProjects.dueDate')}
          </span>
          <Input
            type="date"
            value={form.dueAt}
            onChange={(event) => setForm({ ...form, dueAt: event.target.value })}
          />
        </label>
      </div>
      <Button type="button" variant="ghost" className="mt-3" onClick={() => setAdvanced(!advanced)}>
        {advanced ? t(locale, 'workspaceProjects.hide') : t(locale, 'workspaceProjects.advanced')}
      </Button>
      {advanced ? (
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <label className="md:col-span-2">
            <span className="mb-1 block text-sm font-medium">
              {t(locale, 'workspaceProjects.projectDescription')}
            </span>
            <Input
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              maxLength={1000}
            />
          </label>
          <Select
            value={form.priority}
            onValueChange={(value) => setForm({ ...form, priority: value as ProjectPriority })}
          >
            <SelectTrigger label={t(locale, 'workspaceProjects.projectPriority')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {priorities.map((item) => (
                <SelectItem key={item} value={item}>
                  {priorityLabel(item, locale, t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label>
            <span className="mb-1 block text-sm font-medium">
              {t(locale, 'workspaceProjects.plannedStart')}
            </span>
            <Input
              type="date"
              value={form.plannedStartAt}
              onChange={(event) => setForm({ ...form, plannedStartAt: event.target.value })}
            />
          </label>
          <Select
            value={form.departmentId || noneValue}
            onValueChange={(value) =>
              setForm({ ...form, departmentId: value === noneValue ? '' : value })
            }
          >
            <SelectTrigger label={t(locale, 'workspaceProjects.department')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={noneValue}>{t(locale, 'workspaceProjects.none')}</SelectItem>
              {departments
                .filter((department) => department.status === 'ACTIVE')
                .map((department) => (
                  <SelectItem key={department.id} value={department.id}>
                    {department.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          {!project ? (
            <Select
              value={form.memberMembershipId || noneValue}
              onValueChange={(value) =>
                setForm({ ...form, memberMembershipId: value === noneValue ? '' : value })
              }
            >
              <SelectTrigger label={t(locale, 'workspaceProjects.addMember')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={noneValue}>{t(locale, 'workspaceProjects.none')}</SelectItem>
                {users.map((user) => (
                  <SelectItem key={user.membershipId} value={user.membershipId}>
                    {user.name || user.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>
      ) : null}
      {invalidRange ? (
        <p className="mt-2 text-sm text-destructive">
          {t(locale, 'workspaceProjects.invalidProjectDateRange')}
        </p>
      ) : null}
      <Button
        className="mt-4"
        type="submit"
        disabled={submitting || invalidRange || !form.name.trim()}
      >
        {project
          ? t(locale, 'workspaceProjects.editProject')
          : t(locale, 'workspaceProjects.createProject')}
      </Button>
    </form>
  );
}

function ProjectTasksToolbar({ onCreate, onLink }: { onCreate: () => void; onLink: () => void }) {
  const { locale, t } = useLanguage();
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="text-lg font-semibold">{t(locale, 'workspaceProjects.projectTasks')}</h2>
        <p className="text-sm text-muted-foreground">
          {t(locale, 'workspaceProjects.projectTasksDescription')}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={onCreate}>
          <Plus aria-hidden="true" className="h-4 w-4" />
          {t(locale, 'workspaceProjects.createTask')}
        </Button>
        <Button type="button" variant="secondary" onClick={onLink}>
          {t(locale, 'workspaceProjects.linkExistingTask')}
        </Button>
      </div>
    </div>
  );
}

function LinkExistingTasksDialog({
  open,
  search,
  tasks,
  selectedTaskIds,
  loading,
  linking,
  onOpenChange,
  onSearch,
  onToggle,
  onSubmit,
}: {
  open: boolean;
  search: string;
  tasks: WorkspaceTask[];
  selectedTaskIds: string[];
  loading: boolean;
  linking: boolean;
  onOpenChange: (open: boolean) => void;
  onSearch: (value: string) => void;
  onToggle: (taskId: string) => void;
  onSubmit: () => void;
}) {
  const { locale, t } = useLanguage();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t(locale, 'workspaceProjects.linkExistingTask')}</DialogTitle>
          <DialogDescription>
            {t(locale, 'workspaceProjects.linkExistingTaskDescription')}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Input
            label={t(locale, 'workspaceProjects.searchTasks')}
            value={search}
            onChange={(event) => onSearch(event.target.value)}
          />
          <div className="flex flex-wrap gap-2" aria-live="polite">
            <span className="sr-only">{t(locale, 'workspaceProjects.selectedTasks')}</span>
            {selectedTaskIds.map((taskId) => {
              const task = tasks.find((item) => item.id === taskId);
              return (
                <span
                  key={taskId}
                  className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold"
                >
                  {task?.title ?? taskId}
                </span>
              );
            })}
          </div>
          <div className="grid max-h-80 gap-2 overflow-y-auto rounded-md border border-border p-2">
            {loading ? (
              <div className="p-3 text-sm text-muted-foreground">{t(locale, 'common.loading')}</div>
            ) : tasks.length ? (
              tasks.map((task) => {
                const checked = selectedTaskIds.includes(task.id);
                return (
                  <label
                    key={task.id}
                    className="flex cursor-pointer items-start gap-3 rounded-md p-2 hover:bg-muted"
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={checked}
                      onChange={() => onToggle(task.id)}
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{task.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {task.status.name} · {task.priority}
                      </span>
                    </span>
                  </label>
                );
              })
            ) : (
              <div className="p-3 text-sm text-muted-foreground">
                {t(locale, 'workspaceProjects.noTasksToLink')}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            {t(locale, 'common.cancel')}
          </Button>
          <Button
            type="button"
            disabled={linking || selectedTaskIds.length === 0}
            onClick={onSubmit}
          >
            {t(locale, 'workspaceProjects.linkTasks')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

async function invalidateProjectTasks(
  queryClient: QueryClient,
  workspaceId: string | null,
  projectId: string,
) {
  await Promise.all([
    queryClient.invalidateQueries({
      predicate: (query) =>
        query.queryKey[0] === 'workspace' &&
        query.queryKey[1] === workspaceId &&
        query.queryKey[2] === 'tasks' &&
        query.queryKey[3] === 'list' &&
        typeof query.queryKey[4] === 'object' &&
        query.queryKey[4] !== null &&
        'projectId' in query.queryKey[4] &&
        query.queryKey[4].projectId === projectId,
    }),
    queryClient.invalidateQueries({ queryKey: projectKeys.detail(workspaceId, projectId) }),
    queryClient.invalidateQueries({ queryKey: projectKeys.all(workspaceId) }),
  ]);
}

function useProjectStatuses(workspaceId: string | null, accessToken: string | null) {
  return useQuery({
    queryKey: statusKeys.list(workspaceId, 'PROJECT', 'ACTIVE'),
    queryFn: () => listWorkspaceStatuses(workspaceId as string, 'PROJECT', 'ACTIVE'),
    enabled: Boolean(accessToken && workspaceId),
  });
}

function useDepartments(workspaceId: string | null, accessToken: string | null) {
  return useQuery({
    queryKey: ['workspace', workspaceId, 'departments', 'projects-active'],
    queryFn: () =>
      listDepartments({
        workspaceId: workspaceId as string,
        page: 1,
        pageSize: 100,
        status: 'ACTIVE',
      }),
    enabled: Boolean(accessToken && workspaceId),
  });
}

function useWorkspaceTags(workspaceId: string | null, accessToken: string | null) {
  return useQuery({
    queryKey: ['workspace', workspaceId, 'project-tags-catalog'],
    queryFn: () =>
      listWorkspaceTags(workspaceId as string, {
        page: 1,
        pageSize: 100,
        sortBy: 'name',
        sortDirection: 'asc',
      }),
    enabled: Boolean(accessToken && workspaceId),
  });
}

function useWorkspaceMemberSearch(
  workspaceId: string | null,
  accessToken: string | null,
  search: string,
) {
  const params = { page: 1, pageSize: 50, search };
  return useQuery({
    queryKey: ['workspace', workspaceId, 'project-member-search', params],
    queryFn: () =>
      listWorkspaceUsers({
        workspaceId: workspaceId as string,
        page: params.page,
        pageSize: params.pageSize,
        search,
        status: 'ACTIVE',
      }),
    enabled: Boolean(accessToken && workspaceId),
  });
}

function useWorkspaceTimezone(workspaceId: string | null) {
  return useSessionStore((state) => {
    for (const agency of state.agencies) {
      const workspace = agency.workspaces.find((item) => item.id === workspaceId);
      if (workspace) return workspace.timezone || 'UTC';
    }
    return 'UTC';
  });
}

function useCurrentWorkspaceMembershipId(workspaceId: string | null) {
  return useSessionStore((state) => {
    for (const agency of state.agencies) {
      const workspace = agency.workspaces.find((item) => item.id === workspaceId);
      if (workspace) return workspace.membershipId;
    }
    return null;
  });
}

function ProjectProgressSection({
  project,
  onUpdate,
  updating,
  canManage,
}: {
  project: WorkspaceProjectSummary;
  onUpdate: (value: number | null) => void;
  updating: boolean;
  canManage: boolean;
}) {
  const { locale, t } = useLanguage();
  const [value, setValue] = useState(
    String(project.manualProgressPercent ?? project.effectiveProgress),
  );

  useEffect(() => {
    setValue(String(project.manualProgressPercent ?? project.effectiveProgress));
  }, [project.effectiveProgress, project.manualProgressPercent, project.id]);

  const parsed = Number(value);
  const invalid = !Number.isInteger(parsed) || parsed < 0 || parsed > 100;

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">
            {t(locale, 'workspaceProjects.projectProgress')}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(locale, 'workspaceProjects.progressCalculatedFromTasks')}
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <ProjectFact
              label={t(locale, 'workspaceProjects.effectiveProgress')}
              value={`${project.effectiveProgress}%`}
            />
            <ProjectFact
              label={t(locale, 'workspaceProjects.calculatedProgress')}
              value={`${project.calculatedProgress}%`}
            />
            <ProjectFact
              label={t(locale, 'workspaceProjects.manualProgress')}
              value={
                project.manualProgressPercent === null
                  ? t(locale, 'workspaceProjects.none')
                  : `${project.manualProgressPercent}%`
              }
            />
            <ProjectFact
              label={t(locale, 'workspaceProjects.taskCounts')}
              value={`${project.taskCounts.completedTasks}/${project.taskCounts.totalTasks}`}
            />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <ProjectFact
              label={t(locale, 'workspaceProjects.openTasks')}
              value={String(project.taskCounts.openTasks)}
            />
            <ProjectFact
              label={t(locale, 'workspaceProjects.completedTasks')}
              value={String(project.taskCounts.completedTasks)}
            />
            <ProjectFact
              label={t(locale, 'workspaceProjects.overdueTasks')}
              value={String(project.taskCounts.overdueTasks)}
            />
          </div>
          <ProjectProgressMeter
            project={project}
            label={t(locale, 'workspaceProjects.effectiveProgress')}
          />
        </div>
        {canManage ? (
          <form
            className="w-full space-y-3 lg:max-w-xs"
            onSubmit={(event) => {
              event.preventDefault();
              if (!invalid) onUpdate(parsed);
            }}
          >
            <label>
              <span className="mb-1 block text-sm font-medium">
                {t(locale, 'workspaceProjects.manualOverride')}
              </span>
              <Input
                type="number"
                min={0}
                max={100}
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={updating || invalid}>
                {t(locale, 'workspaceProjects.setManualProgress')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={updating}
                onClick={() => onUpdate(null)}
              >
                {t(locale, 'workspaceProjects.resetOverride')}
              </Button>
            </div>
          </form>
        ) : null}
      </div>
    </section>
  );
}

function ProjectTagsSection({
  tags,
  catalog,
  onAdd,
  onRemove,
  updating,
  canManage,
}: {
  tags: ProjectTag[];
  catalog: WorkspaceTagSummary[];
  onAdd: (tagIds: string[]) => void;
  onRemove: (tagId: string) => void;
  updating: boolean;
  canManage: boolean;
}) {
  const { locale, t } = useLanguage();
  const attachedIds = new Set(tags.map((tag) => tag.tagId));
  const addable = catalog.filter((tag) => tag.status === 'ACTIVE' && !attachedIds.has(tag.id));
  const [selectedTagId, setSelectedTagId] = useState(noneValue);

  useEffect(() => {
    setSelectedTagId(noneValue);
  }, [tags.length]);

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-base font-semibold">{t(locale, 'workspaceProjects.projectTags')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(locale, 'workspaceProjects.archivedTagsRemainVisible')}
          </p>
        </div>
        {canManage ? (
          <div className="flex w-full gap-2 md:max-w-md">
            <div className="min-w-0 flex-1">
              <Select value={selectedTagId} onValueChange={setSelectedTagId}>
                <SelectTrigger label={t(locale, 'workspaceProjects.addTags')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={noneValue}>{t(locale, 'workspaceProjects.none')}</SelectItem>
                  {addable.map((tag) => (
                    <SelectItem key={tag.id} value={tag.id}>
                      {tag.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              disabled={updating || selectedTagId === noneValue}
              onClick={() => {
                onAdd([selectedTagId]);
                setSelectedTagId(noneValue);
              }}
            >
              {t(locale, 'workspaceProjects.addTags')}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {tags.map((tag) => (
          <span
            key={tag.tagId}
            className="inline-flex max-w-full items-center gap-2 rounded-full border border-border px-3 py-1 text-sm"
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: tag.color ?? '#64748B' }}
              aria-hidden="true"
            />
            <span className="truncate">
              {tag.name}
              {tag.status === 'ARCHIVED' ? ` (${t(locale, 'workspaceProjects.archived')})` : ''}
            </span>
            {canManage ? (
              <button
                type="button"
                className="rounded-full p-0.5 text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                aria-label={`${t(locale, 'workspaceProjects.removeTag')} ${tag.name}`}
                disabled={updating}
                onClick={() => onRemove(tag.tagId)}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </span>
        ))}
        {tags.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t(locale, 'workspaceProjects.noTags')}</p>
        ) : null}
      </div>
    </section>
  );
}

function clearProjectDetailAndReturn(
  queryClient: QueryClient,
  workspaceId: string | null,
  projectId: string,
  router: ReturnType<typeof useRouter>,
  message: string,
) {
  queryClient.removeQueries({ queryKey: projectKeys.detail(workspaceId, projectId) });
  toast.info(message);
  router.replace('/workspace/projects' as Route);
}

function ProjectShell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6">{children}</main>;
}

function ProjectReportsSection({
  report,
  loading,
  error,
  from,
  to,
  statusDefinitionId,
  priority,
  assigneeMembershipId,
  departmentId,
  tagId,
  search,
  statuses,
  users,
  departments,
  tags,
  onFromChange,
  onToChange,
  onStatusChange,
  onPriorityChange,
  onAssigneeChange,
  onDepartmentChange,
  onTagChange,
  onSearchChange,
  onRetry,
  onExport,
}: {
  report: ProjectReportsSummary | undefined;
  loading: boolean;
  error: boolean;
  from: string;
  to: string;
  statusDefinitionId: string;
  priority: string;
  assigneeMembershipId: string;
  departmentId: string;
  tagId: string;
  search: string;
  statuses: { id: string; name: string }[];
  users: WorkspaceUser[];
  departments: { id: string; name: string }[];
  tags: WorkspaceTagSummary[];
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onPriorityChange: (value: string) => void;
  onAssigneeChange: (value: string) => void;
  onDepartmentChange: (value: string) => void;
  onTagChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  onRetry: () => void;
  onExport: () => void;
}) {
  const { locale, t } = useLanguage();
  const kpis = report?.kpis;

  return (
    <section className="grid gap-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-base font-semibold">
              {t(locale, 'workspaceProjects.projectReports')}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {report?.timezone ?? 'UTC'} · {t(locale, 'workspaceProjects.reportDueAtBasis')}
            </p>
          </div>
          <Button type="button" onClick={onExport} disabled={!report || loading}>
            <Download className="h-4 w-4" />
            {t(locale, 'workspaceProjects.exportCsv')}
          </Button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <Input
            label={t(locale, 'workspaceProjects.activityFrom')}
            type="date"
            value={from}
            onChange={(event) => onFromChange(event.target.value)}
          />
          <Input
            label={t(locale, 'workspaceProjects.activityTo')}
            type="date"
            value={to}
            onChange={(event) => onToChange(event.target.value)}
          />
          <Select
            value={statusDefinitionId || noneValue}
            onValueChange={(value) => onStatusChange(value === noneValue ? '' : value)}
          >
            <SelectTrigger label={t(locale, 'workspaceProjects.projectStatus')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={noneValue}>{t(locale, 'workspaceProjects.all')}</SelectItem>
              {statuses.map((status) => (
                <SelectItem key={status.id} value={status.id}>
                  {status.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={priority || noneValue}
            onValueChange={(value) => onPriorityChange(value === noneValue ? '' : value)}
          >
            <SelectTrigger label={t(locale, 'workspaceProjects.projectPriority')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={noneValue}>{t(locale, 'workspaceProjects.all')}</SelectItem>
              {priorities.map((item) => (
                <SelectItem key={item} value={item}>
                  {priorityLabel(item, locale, t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={assigneeMembershipId || noneValue}
            onValueChange={(value) => onAssigneeChange(value === noneValue ? '' : value)}
          >
            <SelectTrigger label={t(locale, 'workspaceProjects.assignee')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={noneValue}>{t(locale, 'workspaceProjects.all')}</SelectItem>
              {users.map((user) => (
                <SelectItem key={user.membershipId} value={user.membershipId}>
                  {user.name || user.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={departmentId || noneValue}
            onValueChange={(value) => onDepartmentChange(value === noneValue ? '' : value)}
          >
            <SelectTrigger label={t(locale, 'workspaceProjects.department')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={noneValue}>{t(locale, 'workspaceProjects.all')}</SelectItem>
              {departments.map((department) => (
                <SelectItem key={department.id} value={department.id}>
                  {department.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={tagId || noneValue}
            onValueChange={(value) => onTagChange(value === noneValue ? '' : value)}
          >
            <SelectTrigger label={t(locale, 'workspaceProjects.projectTags')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={noneValue}>{t(locale, 'workspaceProjects.all')}</SelectItem>
              {tags.map((tag) => (
                <SelectItem key={tag.id} value={tag.id}>
                  {tag.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            label={t(locale, 'workspaceProjects.searchTasks')}
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>
      </div>

      {error ? (
        <EmptyState
          title={t(locale, 'workspaceProjects.unableToLoadReports')}
          description={t(locale, 'workspaceProjects.projectReportsDescription')}
          action={
            <Button type="button" onClick={onRetry}>
              {t(locale, 'common.tryAgain')}
            </Button>
          }
        />
      ) : null}

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-24 rounded-lg" />
          ))}
        </div>
      ) : null}

      {report && !loading ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <ReportCard
              label={t(locale, 'workspaceProjects.totalTasks')}
              value={kpis?.totalTasks ?? 0}
            />
            <ReportCard
              label={t(locale, 'workspaceProjects.openTasks')}
              value={kpis?.openTasks ?? 0}
            />
            <ReportCard
              label={t(locale, 'workspaceProjects.completedTasks')}
              value={kpis?.completedTasks ?? 0}
            />
            <ReportCard
              label={t(locale, 'workspaceProjects.overdueTasks')}
              value={kpis?.overdueTasks ?? 0}
            />
            <ReportCard
              label={t(locale, 'workspaceProjects.pendingApproval')}
              value={kpis?.pendingApprovalTasks ?? 0}
            />
            <ReportCard
              label={t(locale, 'workspaceProjects.completionRate')}
              value={`${kpis?.completionRate ?? 0}%`}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <ReportCard
              label={t(locale, 'workspaceProjects.calculatedProgress')}
              value={`${report.progress.calculatedProgress}%`}
            />
            <ReportCard
              label={t(locale, 'workspaceProjects.effectiveProgress')}
              value={`${report.progress.effectiveProgress}%`}
            />
            <ReportCard
              label={t(locale, 'workspaceProjects.manualOverride')}
              value={
                report.progress.manualProgressPercent === null
                  ? t(locale, 'workspaceProjects.none')
                  : `${report.progress.manualProgressPercent}%`
              }
            />
            <ReportCard
              label={t(locale, 'workspaceProjects.estimatedTime')}
              value={formatMinutes(kpis?.estimatedMinutes ?? 0)}
            />
            <ReportCard
              label={t(locale, 'workspaceProjects.trackedTime')}
              value={
                kpis?.trackedTimeAvailable
                  ? formatSeconds(kpis.trackedSeconds ?? 0)
                  : t(locale, 'workspaceProjects.trackedTimeUnavailable')
              }
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ReportList
              title={t(locale, 'workspaceProjects.statusDistribution')}
              rows={report.distributions.status.map((item) => ({
                label: item.name,
                value: item.count,
                detail: item.terminal ? t(locale, 'workspaceProjects.completedTasks') : undefined,
              }))}
            />
            <ReportList
              title={t(locale, 'workspaceProjects.priorityDistribution')}
              rows={report.distributions.priority.map((item) => ({
                label: priorityLabel(item.priority, locale, t),
                value: item.count,
              }))}
            />
            <ReportList
              title={t(locale, 'workspaceProjects.assigneeBreakdown')}
              rows={report.distributions.assignees.map((item) => ({
                label: item.displayName,
                value: item.taskAssignmentCount,
                detail: `${item.openTaskCount} ${t(locale, 'workspaceProjects.openTasks')}`,
              }))}
            />
            <ReportList
              title={t(locale, 'workspaceProjects.departmentBreakdown')}
              rows={report.distributions.departments.map((item) => ({
                label: item.name,
                value: item.count,
              }))}
            />
          </div>

          <ReportList
            title={t(locale, 'workspaceProjects.completionEvents')}
            rows={report.completionTrend.map((item) => ({ label: item.date, value: item.count }))}
          />
        </>
      ) : null}
    </section>
  );
}

function ReportCard({ label, value }: { label: string; value: string | number }) {
  return (
    <article className="rounded-lg border border-border bg-card p-4" aria-label={label}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </article>
  );
}

function ReportList({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; value: number; detail?: string }>;
}) {
  const { locale, t } = useLanguage();
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-base font-semibold">{title}</h3>
      <div className="mt-3 grid gap-2">
        {rows.length ? (
          rows.map((row) => (
            <div
              key={`${row.label}-${row.detail ?? ''}`}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <span className="min-w-0 truncate">
                {row.label}
                {row.detail ? <span className="text-muted-foreground"> · {row.detail}</span> : null}
              </span>
              <span className="font-medium">{row.value}</span>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">
            {t(locale, 'workspaceProjects.noReportData')}
          </p>
        )}
      </div>
    </section>
  );
}

function ProjectFilesSection({
  workspaceId,
  projectId,
  files,
  loading,
  error,
  search,
  canAdd,
  canRemove,
  canDownload,
  onSearch,
  onRetry,
}: {
  workspaceId: string | null;
  projectId: string;
  files: ProjectAttachmentSummary[];
  loading: boolean;
  error: boolean;
  search: string;
  canAdd: boolean;
  canRemove: boolean;
  canDownload: boolean;
  onSearch: (value: string) => void;
  onRetry: () => void;
}) {
  const { locale, t } = useLanguage();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-base font-semibold">{t(locale, 'workspaceProjects.projectFiles')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(locale, 'workspaceProjects.projectFilesDescription')}
          </p>
        </div>
        {canAdd ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => setUploadOpen(true)}>
              <Upload aria-hidden="true" className="h-4 w-4" />
              {t(locale, 'workspaceProjects.uploadFile')}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setLinkOpen(true)}>
              <LinkIcon aria-hidden="true" className="h-4 w-4" />
              {t(locale, 'workspaceProjects.addExternalLink')}
            </Button>
          </div>
        ) : null}
      </div>
      <label className="mt-4 block">
        <span className="mb-1 block text-sm font-medium">
          {t(locale, 'workspaceProjects.searchFiles')}
        </span>
        <Input value={search} onChange={(event) => onSearch(event.target.value)} />
      </label>
      <div className="mt-4 grid gap-2">
        {loading ? (
          <>
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </>
        ) : error ? (
          <EmptyState
            title={t(locale, 'workspaceProjects.filesLoadFailed')}
            description={t(locale, 'workspaceProjects.saveFailed')}
            action={
              <Button type="button" variant="secondary" onClick={onRetry}>
                {t(locale, 'common.tryAgain')}
              </Button>
            }
          />
        ) : files.length ? (
          files.map((file) => (
            <ProjectFileRow
              key={file.id}
              workspaceId={workspaceId}
              projectId={projectId}
              file={file}
              canDownload={canDownload}
              canRemove={canRemove}
            />
          ))
        ) : (
          <p className="text-sm text-muted-foreground">{t(locale, 'workspaceProjects.noFiles')}</p>
        )}
      </div>
      <ProjectUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        workspaceId={workspaceId}
        projectId={projectId}
      />
      <ProjectUrlDialog
        open={linkOpen}
        onOpenChange={setLinkOpen}
        workspaceId={workspaceId}
        projectId={projectId}
      />
    </section>
  );
}

function ProjectFileRow({
  workspaceId,
  projectId,
  file,
  canDownload,
  canRemove,
}: {
  workspaceId: string | null;
  projectId: string;
  file: ProjectAttachmentSummary;
  canDownload: boolean;
  canRemove: boolean;
}) {
  const { locale, t } = useLanguage();
  const queryClient = useQueryClient();
  const removeMutation = useMutation({
    mutationFn: () => removeWorkspaceProjectAttachment(workspaceId as string, projectId, file.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: projectKeys.attachmentsBase(workspaceId, projectId),
      });
      toast.success(t(locale, 'workspaceProjects.fileRemoved'));
    },
    onError: () => toast.error(t(locale, 'workspaceProjects.fileActionFailed')),
  });
  const downloadMutation = useMutation({
    mutationFn: () => downloadWorkspaceProjectAttachment(workspaceId as string, projectId, file.id),
    onSuccess: (result) => window.location.assign(result.downloadUrl),
    onError: () => toast.error(t(locale, 'workspaceProjects.fileActionFailed')),
  });

  return (
    <div className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="flex min-w-0 items-start gap-3">
        <Paperclip aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{file.displayName}</p>
          <p className="text-xs text-muted-foreground">
            {file.type === 'FILE'
              ? `${t(locale, 'workspaceProjects.fileAttachment')} - ${formatBytes(
                  file.file?.sizeBytes ?? 0,
                )}`
              : t(locale, 'workspaceProjects.urlAttachment')}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {file.type === 'URL' && file.url ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => window.open(file.url ?? '', '_blank', 'noopener,noreferrer')}
          >
            <ExternalLink aria-hidden="true" className="h-4 w-4" />
            {t(locale, 'workspaceProjects.openLink')}
          </Button>
        ) : null}
        {file.type === 'FILE' && canDownload ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={downloadMutation.isPending || file.file?.status !== 'READY'}
            onClick={() => downloadMutation.mutate()}
          >
            <Download aria-hidden="true" className="h-4 w-4" />
            {t(locale, 'workspaceProjects.download')}
          </Button>
        ) : null}
        {canRemove ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={removeMutation.isPending}
            onClick={() => removeMutation.mutate()}
          >
            <Trash2 aria-hidden="true" className="h-4 w-4" />
            {t(locale, 'workspaceProjects.removeFromProject')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function ProjectUploadDialog({
  open,
  onOpenChange,
  workspaceId,
  projectId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string | null;
  projectId: string;
}) {
  const { locale, t } = useLanguage();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!workspaceId || !file) return null;
      if (file.size > maxProjectAttachmentBytes) throw new Error('FILE_TOO_LARGE');
      const init = await initWorkspaceProjectAttachmentUpload(workspaceId, projectId, {
        filename: file.name,
        displayName: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
      });
      await uploadToStorage(init.uploadUrl, file, setProgress);
      return completeWorkspaceProjectAttachmentUpload(workspaceId, projectId, init.attachment.id, {
        sizeBytes: file.size,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: projectKeys.attachmentsBase(workspaceId, projectId),
      });
      toast.success(t(locale, 'workspaceProjects.fileUploaded'));
      setFile(null);
      setProgress(0);
      onOpenChange(false);
    },
    onError: (error) =>
      toast.error(
        error instanceof Error && error.message === 'FILE_TOO_LARGE'
          ? t(locale, 'workspaceProjects.fileTooLarge')
          : t(locale, 'workspaceProjects.fileActionFailed'),
      ),
  });

  useEffect(() => {
    if (!open) {
      setFile(null);
      setProgress(0);
    }
  }, [open, workspaceId, projectId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(locale, 'workspaceProjects.uploadFile')}</DialogTitle>
          <DialogDescription>
            {t(locale, 'workspaceProjects.uploadFileDescription')}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Input
            label={t(locale, 'workspaceProjects.file')}
            type="file"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          {file ? (
            <p className="text-sm text-muted-foreground">
              {file.name} - {formatBytes(file.size)}
            </p>
          ) : null}
          {file && file.size > driveSuggestionBytes ? (
            <p className="text-sm text-muted-foreground">
              {t(locale, 'workspaceProjects.largeFileSuggestion')}
            </p>
          ) : null}
          {progress > 0 ? (
            <div className="h-2 rounded-full bg-muted">
              <div className="h-2 rounded-full bg-primary" style={{ width: `${progress}%` }} />
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            type="button"
            disabled={!file || uploadMutation.isPending}
            onClick={() => uploadMutation.mutate()}
          >
            {uploadMutation.isPending
              ? t(locale, 'workspaceProjects.uploading')
              : t(locale, 'workspaceProjects.uploadFile')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProjectUrlDialog({
  open,
  onOpenChange,
  workspaceId,
  projectId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string | null;
  projectId: string;
}) {
  const { locale, t } = useLanguage();
  const queryClient = useQueryClient();
  const [url, setUrl] = useState('');
  const [displayName, setDisplayName] = useState('');
  const trimmedUrl = url.trim();
  const invalidUrl = trimmedUrl.length > 0 && !isHttpUrl(trimmedUrl);
  const addMutation = useMutation({
    mutationFn: () =>
      addWorkspaceProjectUrlAttachment(workspaceId as string, projectId, {
        url: trimmedUrl,
        ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: projectKeys.attachmentsBase(workspaceId, projectId),
      });
      toast.success(t(locale, 'workspaceProjects.linkAdded'));
      setUrl('');
      setDisplayName('');
      onOpenChange(false);
    },
    onError: () => toast.error(t(locale, 'workspaceProjects.invalidUrl')),
  });

  useEffect(() => {
    if (!open) {
      setUrl('');
      setDisplayName('');
    }
  }, [open, workspaceId, projectId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(locale, 'workspaceProjects.addExternalLink')}</DialogTitle>
          <DialogDescription>{t(locale, 'workspaceProjects.addLinkDescription')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Input
            label={t(locale, 'workspaceProjects.url')}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com"
          />
          {invalidUrl ? (
            <p className="text-sm text-destructive">{t(locale, 'workspaceProjects.invalidUrl')}</p>
          ) : null}
          <Input
            label={t(locale, 'workspaceProjects.displayName')}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </div>
        <DialogFooter>
          <Button
            type="button"
            disabled={!trimmedUrl || invalidUrl || addMutation.isPending}
            onClick={() => addMutation.mutate()}
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            {addMutation.isPending
              ? t(locale, 'workspaceProjects.applying')
              : t(locale, 'workspaceProjects.addExternalLink')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProjectActivitySection({
  items,
  loading,
  error,
  action,
  userId,
  from,
  to,
  onActionChange,
  onUserChange,
  onFromChange,
  onToChange,
  onRetry,
  workspaceTimezone,
}: {
  items: ProjectActivityItem[];
  loading: boolean;
  error: boolean;
  action: string;
  userId: string;
  from: string;
  to: string;
  onActionChange: (value: string) => void;
  onUserChange: (value: string) => void;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onRetry: () => void;
  workspaceTimezone: string;
}) {
  const { locale, t } = useLanguage();
  const actors = useMemo(
    () =>
      Array.from(
        new Map(
          items
            .flatMap((item) => (item.actor ? [item.actor] : []))
            .map((actor) => [actor.id, actor] as const),
        ).values(),
      ),
    [items],
  );

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-base font-semibold">
            {t(locale, 'workspaceProjects.projectActivity')}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(locale, 'workspaceProjects.projectActivityDescription')}
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <Select
          value={action || noneValue}
          onValueChange={(value) => onActionChange(value === noneValue ? '' : value)}
        >
          <SelectTrigger label={t(locale, 'workspaceProjects.activityType')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={noneValue}>{t(locale, 'workspaceProjects.all')}</SelectItem>
            {projectActivityOptions.map((item) => (
              <SelectItem key={item} value={item}>
                {activityLabel(item, locale, t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={userId || noneValue}
          onValueChange={(value) => onUserChange(value === noneValue ? '' : value)}
        >
          <SelectTrigger label={t(locale, 'workspaceProjects.activityUser')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={noneValue}>{t(locale, 'workspaceProjects.all')}</SelectItem>
            {actors.map((actor) => (
              <SelectItem key={actor.id} value={actor.id}>
                {actor.name || actor.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label>
          <span className="mb-1 block text-sm font-medium">
            {t(locale, 'workspaceProjects.activityFrom')}
          </span>
          <Input type="date" value={from} onChange={(event) => onFromChange(event.target.value)} />
        </label>
        <label>
          <span className="mb-1 block text-sm font-medium">
            {t(locale, 'workspaceProjects.activityTo')}
          </span>
          <Input type="date" value={to} onChange={(event) => onToChange(event.target.value)} />
        </label>
      </div>
      <div className="mt-4 grid gap-2">
        {loading ? (
          <>
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </>
        ) : error ? (
          <EmptyState
            title={t(locale, 'workspaceProjects.activityLoadFailed')}
            description={t(locale, 'workspaceProjects.saveFailed')}
            action={
              <Button type="button" variant="secondary" onClick={onRetry}>
                {t(locale, 'common.tryAgain')}
              </Button>
            }
          />
        ) : items.length ? (
          items.map((item) => (
            <div
              key={item.id}
              className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold">{activityLabel(item.action, locale, t)}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {item.actor?.name || item.actor?.email || t(locale, 'workspaceProjects.system')}
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock aria-hidden="true" className="h-4 w-4" />
                {formatDateTime(item.createdAt, locale, workspaceTimezone)}
              </div>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">
            {t(locale, 'workspaceProjects.noActivity')}
          </p>
        )}
      </div>
    </section>
  );
}

function ProjectMembersSection({
  project,
  members,
  users,
  search,
  selectedMemberIds,
  onSearch,
  onToggleSelected,
  onAdd,
  onRemove,
  onOwnerChange,
  adding,
  canManageMembers,
  canManageOwner,
}: {
  project: WorkspaceProjectSummary;
  members: ProjectMember[];
  users: WorkspaceUser[];
  search: string;
  selectedMemberIds: string[];
  onSearch: (value: string) => void;
  onToggleSelected: (membershipId: string) => void;
  onAdd: () => void;
  onRemove: (membershipId: string) => void;
  onOwnerChange: (membershipId: string) => void;
  adding: boolean;
  canManageMembers: boolean;
  canManageOwner: boolean;
}) {
  const { locale, t } = useLanguage();
  const memberIds = new Set(members.map((member) => member.workspaceMembershipId));
  const addableUsers = users.filter(
    (user) => user.membershipId !== project.ownerMembershipId && !memberIds.has(user.membershipId),
  );
  const selectedUsers = users.filter((user) => selectedMemberIds.includes(user.membershipId));

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-base font-semibold">
            {t(locale, 'workspaceProjects.projectMembers')}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {project.visibility === 'RESTRICTED'
              ? t(locale, 'workspaceProjects.projectAccessRestricted')
              : visibilityLabel(project.visibility, locale, t)}
          </p>
        </div>
        {canManageOwner ? (
          <div className="w-full md:max-w-xs">
            <Select value={project.ownerMembershipId} onValueChange={onOwnerChange}>
              <SelectTrigger label={t(locale, 'workspaceProjects.changeOwner')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {users.map((user) => (
                  <SelectItem key={user.membershipId} value={user.membershipId}>
                    {user.name || user.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>

      {canManageMembers ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label>
            <span className="mb-1 block text-sm font-medium">
              {t(locale, 'workspaceProjects.searchMembers')}
            </span>
            <Input value={search} onChange={(event) => onSearch(event.target.value)} />
          </label>
          <Select
            value={noneValue}
            onValueChange={(value) => value !== noneValue && onToggleSelected(value)}
          >
            <SelectTrigger label={t(locale, 'workspaceProjects.addMember')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={noneValue}>{t(locale, 'workspaceProjects.none')}</SelectItem>
              {addableUsers.map((user) => (
                <SelectItem key={user.membershipId} value={user.membershipId}>
                  {selectedMemberIds.includes(user.membershipId)
                    ? `${user.name || user.email} (${t(locale, 'workspaceProjects.selected')})`
                    : user.name || user.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {canManageMembers && selectedMemberIds.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {selectedMemberIds.map((membershipId) => {
            const user = selectedUsers.find((item) => item.membershipId === membershipId);
            const name = user?.name || user?.email || membershipId;
            return (
              <Button
                key={membershipId}
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => onToggleSelected(membershipId)}
              >
                <X aria-hidden="true" className="h-4 w-4" />
                {name}
              </Button>
            );
          })}
          <Button type="button" disabled={adding} onClick={onAdd}>
            {adding
              ? t(locale, 'workspaceProjects.applying')
              : t(locale, 'workspaceProjects.addSelectedMembers')}
          </Button>
        </div>
      ) : null}

      <div className="mt-4 divide-y divide-border rounded-lg border border-border">
        {members.map((member) => {
          const name = memberName(member.member);
          return (
            <div
              key={member.id}
              className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="text-sm font-medium">{name}</p>
                <p className="text-xs text-muted-foreground">
                  {member.member.user.email} - {member.member.status}
                </p>
              </div>
              {canManageMembers ? (
                <Button
                  type="button"
                  variant="secondary"
                  aria-label={`${t(locale, 'workspaceProjects.removeMember')} ${name}`}
                  onClick={() => onRemove(member.workspaceMembershipId)}
                >
                  {t(locale, 'workspaceProjects.removeMember')}
                </Button>
              ) : null}
            </div>
          );
        })}
        {members.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">
            {t(locale, 'workspaceProjects.noMembers')}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function StatusBadge({ project }: { project: WorkspaceProjectSummary }) {
  return (
    <span className="inline-flex max-w-40 items-center gap-2 rounded-full border border-border px-2.5 py-1 text-xs">
      <span
        className="h-2 w-2 rounded-full"
        style={{ backgroundColor: project.status?.color ?? '#64748B' }}
        aria-hidden="true"
      />
      <span className="truncate">{project.status?.name ?? '-'}</span>
    </span>
  );
}

function ProjectDetailHeader({
  project,
  workspaceTimezone,
  locale,
  t,
}: {
  project: WorkspaceProjectSummary;
  workspaceTimezone: string;
  locale: Locale;
  t: (locale: Locale, key: `workspaceProjects.${string}`) => string;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-4" aria-label={project.name}>
      {project.visibility === 'RESTRICTED' ? (
        <p className="mb-3 text-sm font-medium text-muted-foreground">
          {t(locale, 'workspaceProjects.projectAccessRestricted')}
        </p>
      ) : null}
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ProjectFact
          label={t(locale, 'workspaceProjects.projectStatus')}
          value={project.status?.name ?? '-'}
        />
        <ProjectFact
          label={t(locale, 'workspaceProjects.projectPriority')}
          value={priorityLabel(project.priority, locale, t)}
        />
        <ProjectFact
          label={t(locale, 'workspaceProjects.projectOwner')}
          value={memberName(project.owner)}
        />
        <ProjectFact
          label={t(locale, 'workspaceProjects.dueDate')}
          value={formatDate(project.dueAt, locale, workspaceTimezone)}
        />
        <ProjectFact
          label={t(locale, 'workspaceProjects.visibility')}
          value={visibilityLabel(project.visibility, locale, t)}
        />
        <ProjectFact
          label={t(locale, 'workspaceProjects.effectiveProgress')}
          value={`${project.effectiveProgress}%`}
        />
        <ProjectFact
          label={t(locale, 'workspaceProjects.calculatedProgress')}
          value={`${project.calculatedProgress}%`}
        />
        <ProjectFact
          label={t(locale, 'workspaceProjects.manualOverride')}
          value={
            project.manualProgressPercent === null
              ? t(locale, 'workspaceProjects.none')
              : `${project.manualProgressPercent}%`
          }
        />
      </dl>
    </section>
  );
}

function ProjectProgressMeter({
  project,
  label,
}: {
  project: WorkspaceProjectSummary;
  label: string;
}) {
  const value = Math.max(0, Math.min(100, project.effectiveProgress));
  return (
    <div className="mt-4">
      <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span>{value}%</span>
      </div>
      <div
        className="h-2 rounded-full bg-muted"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function ProjectFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm">{value}</dd>
    </div>
  );
}

function projectStatusErrorMessage(
  locale: Locale,
  t: (locale: Locale, key: `workspaceProjects.${string}`) => string,
  error: unknown,
) {
  if (error instanceof ApiClientError && error.body.code === 'PROJECT_HAS_OPEN_TASKS') {
    const details = error.body.details;
    const count =
      details && typeof details === 'object' && 'openTaskCount' in details
        ? Number((details as { openTaskCount: unknown }).openTaskCount)
        : null;
    if (Number.isInteger(count)) {
      return t(locale, 'workspaceProjects.projectHasOpenTasksCount').replace(
        '{count}',
        String(count),
      );
    }
    return t(locale, 'workspaceProjects.projectHasOpenTasks');
  }
  return t(locale, 'workspaceProjects.invalidProjectStatus');
}

function priorityLabel(
  priority: ProjectPriority,
  locale: Locale,
  t: (locale: Locale, key: `workspaceProjects.${string}`) => string,
) {
  const keys: Record<ProjectPriority, 'low' | 'medium' | 'high' | 'urgent'> = {
    LOW: 'low',
    MEDIUM: 'medium',
    HIGH: 'high',
    URGENT: 'urgent',
  };
  return t(locale, `workspaceProjects.${keys[priority]}`);
}

function projectListUrlParams(state: {
  search: string;
  statusDefinitionId: string;
  priority: string;
  tagId: string;
  departmentId: string;
  plannedFrom: string;
  plannedTo: string;
  dueFrom: string;
  dueTo: string;
  sortBy: ProjectSortBy;
  sortDirection: ProjectSortDirection;
  page: number;
}) {
  const params = new URLSearchParams();
  if (state.search.trim()) params.set('search', state.search.trim());
  if (state.statusDefinitionId) params.set('status', state.statusDefinitionId);
  if (state.priority) params.set('priority', state.priority);
  if (state.departmentId) params.set('department', state.departmentId);
  if (state.tagId) params.set('tag', state.tagId);
  if (state.plannedFrom) params.set('plannedFrom', state.plannedFrom);
  if (state.plannedTo) params.set('plannedTo', state.plannedTo);
  if (state.dueFrom) params.set('dueFrom', state.dueFrom);
  if (state.dueTo) params.set('dueTo', state.dueTo);
  if (state.sortBy !== 'updatedAt') params.set('sort', state.sortBy);
  if (state.sortDirection !== 'desc') params.set('direction', state.sortDirection);
  if (state.page > 1) params.set('page', String(state.page));
  return params;
}

function isProjectPriority(value: string | null): value is ProjectPriority {
  return value === 'LOW' || value === 'MEDIUM' || value === 'HIGH' || value === 'URGENT';
}

function isProjectSortOption(value: string | null): value is ProjectSortBy {
  return projectSortOptions.includes(value as ProjectSortBy);
}

function safePositiveInt(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function projectSortLabel(
  sortBy: ProjectSortBy,
  locale: Locale,
  t: (locale: Locale, key: `workspaceProjects.${string}`) => string,
) {
  const keys: Record<ProjectSortBy, `workspaceProjects.${string}`> = {
    createdAt: 'workspaceProjects.created',
    updatedAt: 'workspaceProjects.updated',
    name: 'workspaceProjects.projectName',
    dueAt: 'workspaceProjects.dueDate',
    plannedStartAt: 'workspaceProjects.plannedStart',
    priority: 'workspaceProjects.projectPriority',
  };
  return t(locale, keys[sortBy]);
}

function visibilityLabel(
  visibility: ProjectVisibility,
  locale: Locale,
  t: (locale: Locale, key: `workspaceProjects.${string}`) => string,
) {
  return t(
    locale,
    visibility === 'RESTRICTED'
      ? 'workspaceProjects.restricted'
      : 'workspaceProjects.workspaceVisible',
  );
}

function memberName(membership: ProjectMembershipSummary | null | undefined) {
  return membership?.user.name || membership?.user.email || '-';
}

function formatDate(value: string | null, locale: Locale, timezone: string) {
  if (!value) return '-';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: timezone }).format(
    new Date(value),
  );
}

function formatDateTime(value: string, locale: Locale, timezone: string) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  }).format(new Date(value));
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatMinutes(value: number) {
  if (value < 60) return `${value}m`;
  return `${Math.floor(value / 60)}h ${value % 60}m`;
}

function formatSeconds(value: number) {
  return formatMinutes(Math.round(value / 60));
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

function isHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
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

function uploadToStorage(url: string, file: File, onProgress: (value: number) => void) {
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

const projectActivityOptions = [
  'project.created',
  'project.updated',
  'project.visibility_changed',
  'project.status_changed',
  'project.member_added',
  'project.member_removed',
  'project.owner_changed',
  'project.tag_added',
  'project.tag_removed',
  'project.task_linked',
  'project.task_unlinked',
  'project.progress_override_set',
  'project.progress_override_cleared',
  'project.attachment_file_uploaded',
  'project.attachment_url_added',
  'project.attachments_linked',
  'project.attachment_download_authorized',
  'project.attachment_removed',
];

function activityLabel(
  action: string,
  locale: Locale,
  t: (locale: Locale, key: `workspaceProjects.${string}`) => string,
) {
  const keyByAction: Record<string, `workspaceProjects.${string}`> = {
    'project.created': 'workspaceProjects.activityCreated',
    'project.updated': 'workspaceProjects.activityUpdated',
    'project.visibility_changed': 'workspaceProjects.activityVisibilityChanged',
    'project.status_changed': 'workspaceProjects.activityStatusChanged',
    'project.member_added': 'workspaceProjects.activityMemberAdded',
    'project.member_removed': 'workspaceProjects.activityMemberRemoved',
    'project.owner_changed': 'workspaceProjects.activityOwnerChanged',
    'project.tag_added': 'workspaceProjects.activityTagAdded',
    'project.tag_removed': 'workspaceProjects.activityTagRemoved',
    'project.task_linked': 'workspaceProjects.activityTaskLinked',
    'project.task_unlinked': 'workspaceProjects.activityTaskUnlinked',
    'project.progress_override_set': 'workspaceProjects.activityProgressSet',
    'project.progress_override_cleared': 'workspaceProjects.activityProgressCleared',
    'project.attachment_file_uploaded': 'workspaceProjects.activityFileUploaded',
    'project.attachment_url_added': 'workspaceProjects.activityLinkAdded',
    'project.attachments_linked': 'workspaceProjects.activityFilesLinked',
    'project.attachment_download_authorized': 'workspaceProjects.activityFileDownloaded',
    'project.attachment_removed': 'workspaceProjects.activityFileRemoved',
  };
  return keyByAction[action] ? t(locale, keyByAction[action]) : action;
}

function toDateInput(value: string | null | undefined, timezone: string) {
  if (!value) return '';
  const parts = datePartsInTimezone(new Date(value), timezone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function fromDateInput(value: string, timezone: string) {
  if (!value) return null;
  const parsed = parseDateInput(value);
  if (!parsed) return null;
  const { year, month, day } = parsed;
  const utcGuess = Date.UTC(year, month - 1, day, 12, 0, 0);
  const offset = timezoneOffsetMs(new Date(utcGuess), timezone);
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - offset).toISOString();
}

function parseDateInput(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  return { year, month, day };
}

function datePartsInTimezone(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
  };
}

function timezoneOffsetMs(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - date.getTime();
}
