'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { Plus, Search, X } from 'lucide-react';
import { ApiClientError } from '@zea-play/api-client';
import { toast } from 'sonner';
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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
import { listWorkspaceTags, type WorkspaceTagSummary } from '../../../services/workspace-tasks';
import {
  addWorkspaceProjectTags,
  addWorkspaceProjectMembers,
  createWorkspaceProject,
  deleteWorkspaceProject,
  getWorkspaceProject,
  listWorkspaceProjectTags,
  listWorkspaceProjectMembers,
  listWorkspaceProjects,
  normalizeProjectListParams,
  projectKeys,
  removeWorkspaceProjectTags,
  removeWorkspaceProjectMember,
  type ProjectMember,
  type ProjectPayload,
  type ProjectMembershipSummary,
  type ProjectTag,
  type ProjectPriority,
  type ProjectVisibility,
  type WorkspaceProjectSummary,
  updateWorkspaceProject,
  updateWorkspaceProjectOwner,
  updateWorkspaceProjectProgress,
  updateWorkspaceProjectStatus,
} from '../../../services/workspace-projects';

const priorities: ProjectPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const visibilities: ProjectVisibility[] = ['WORKSPACE', 'RESTRICTED'];
const noneValue = '__none__';

export function WorkspaceProjectsPage() {
  const { locale, t } = useLanguage();
  const { accessToken, selectedWorkspaceId, hydrated, hydrate } = useSessionStore();
  const workspaceTimezone = useWorkspaceTimezone(selectedWorkspaceId);
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusDefinitionId, setStatusDefinitionId] = useState('');
  const [priority, setPriority] = useState('');
  const [tagId, setTagId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    setSearch('');
    setStatusDefinitionId('');
    setPriority('');
    setTagId('');
    setDepartmentId('');
    setPage(1);
    setCreateOpen(false);
  }, [selectedWorkspaceId]);

  const params = normalizeProjectListParams({
    page,
    pageSize: 20,
    search,
    statusDefinitionId,
    priority: priority as ProjectPriority,
    tagId,
    departmentId,
    sortBy: 'updatedAt',
    sortDirection: 'desc',
  });

  const projectsQuery = useQuery({
    queryKey: projectKeys.list(selectedWorkspaceId, params),
    queryFn: () => listWorkspaceProjects(selectedWorkspaceId as string, params),
    enabled: Boolean(accessToken && selectedWorkspaceId),
  });

  const statusesQuery = useProjectStatuses(selectedWorkspaceId, accessToken);
  const departmentsQuery = useDepartments(selectedWorkspaceId, accessToken);
  const tagsQuery = useWorkspaceTags(selectedWorkspaceId, accessToken);
  const usersQuery = useWorkspaceMemberSearch(selectedWorkspaceId, accessToken, '');

  const createMutation = useMutation({
    mutationFn: (body: ProjectPayload) =>
      createWorkspaceProject(selectedWorkspaceId as string, body),
    onSuccess() {
      toast.success(t(locale, 'workspaceProjects.projectCreated'));
      setCreateOpen(false);
      void queryClient.invalidateQueries({ queryKey: projectKeys.all(selectedWorkspaceId) });
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
          <Button type="button" onClick={() => setCreateOpen((value) => !value)}>
            <Plus className="h-4 w-4" />
            {t(locale, 'workspaceProjects.createProject')}
          </Button>
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
        </section>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
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
          ))}
          {!projectsQuery.isLoading && projects.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground sm:col-span-2 xl:col-span-3">
              {t(locale, 'workspaceProjects.noProjects')}
            </div>
          ) : null}
        </section>

        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="secondary"
            disabled={page <= 1}
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
            disabled={page >= totalPages}
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
  const [editing, setEditing] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    setEditing(false);
  }, [selectedWorkspaceId, projectId]);

  const projectQuery = useQuery({
    queryKey: projectKeys.detail(selectedWorkspaceId, projectId),
    queryFn: () => getWorkspaceProject(selectedWorkspaceId as string, projectId),
    enabled: Boolean(accessToken && selectedWorkspaceId && projectId),
  });
  const statusesQuery = useProjectStatuses(selectedWorkspaceId, accessToken);
  const departmentsQuery = useDepartments(selectedWorkspaceId, accessToken);
  const usersQuery = useWorkspaceMemberSearch(selectedWorkspaceId, accessToken, memberSearch);
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
    enabled: Boolean(accessToken && selectedWorkspaceId && projectId),
  });
  const tagsQuery = useQuery({
    queryKey: projectKeys.tags(selectedWorkspaceId, projectId),
    queryFn: () => listWorkspaceProjectTags(selectedWorkspaceId as string, projectId),
    enabled: Boolean(accessToken && selectedWorkspaceId && projectId),
  });
  const tagCatalogQuery = useWorkspaceTags(selectedWorkspaceId, accessToken);

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
    mutationFn: (membershipId: string) =>
      addWorkspaceProjectMembers(selectedWorkspaceId as string, projectId, [membershipId]),
    onSuccess() {
      void queryClient.invalidateQueries({ queryKey: projectKeys.all(selectedWorkspaceId) });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: (membershipId: string) =>
      removeWorkspaceProjectMember(selectedWorkspaceId as string, projectId, membershipId),
    onSuccess(_result, membershipId) {
      void queryClient.invalidateQueries({ queryKey: projectKeys.all(selectedWorkspaceId) });
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
              <Button
                type="button"
                variant="secondary"
                onClick={() => setEditing((value) => !value)}
              >
                {t(locale, 'workspaceProjects.editProject')}
              </Button>
              <Button type="button" variant="danger" onClick={() => deleteMutation.mutate()}>
                {t(locale, 'workspaceProjects.deleteProject')}
              </Button>
            </div>
          ) : null}
        </div>

        {project ? (
          <>
            {editing ? (
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
            />
            <ProjectTagsSection
              tags={tagsQuery.data ?? []}
              catalog={tagCatalogQuery.data?.items ?? []}
              onAdd={(tagIds) => addTagsMutation.mutate(tagIds)}
              onRemove={(tagId) => removeTagsMutation.mutate([tagId])}
              updating={addTagsMutation.isPending || removeTagsMutation.isPending}
            />
            <ProjectMembersSection
              project={project}
              members={membersQuery.data?.items ?? []}
              users={usersQuery.data?.items ?? []}
              search={memberSearch}
              onSearch={setMemberSearch}
              onAdd={(membershipId) => addMemberMutation.mutate(membershipId)}
              onRemove={(membershipId) => removeMemberMutation.mutate(membershipId)}
              onOwnerChange={(membershipId) => ownerMutation.mutate(membershipId)}
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
}: {
  project: WorkspaceProjectSummary;
  onUpdate: (value: number | null) => void;
  updating: boolean;
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
}: {
  tags: ProjectTag[];
  catalog: WorkspaceTagSummary[];
  onAdd: (tagIds: string[]) => void;
  onRemove: (tagId: string) => void;
  updating: boolean;
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
            <button
              type="button"
              className="rounded-full p-0.5 text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              aria-label={`${t(locale, 'workspaceProjects.removeTag')} ${tag.name}`}
              disabled={updating}
              onClick={() => onRemove(tag.tagId)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
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

function ProjectMembersSection({
  project,
  members,
  users,
  search,
  onSearch,
  onAdd,
  onRemove,
  onOwnerChange,
}: {
  project: WorkspaceProjectSummary;
  members: ProjectMember[];
  users: WorkspaceUser[];
  search: string;
  onSearch: (value: string) => void;
  onAdd: (membershipId: string) => void;
  onRemove: (membershipId: string) => void;
  onOwnerChange: (membershipId: string) => void;
}) {
  const { locale, t } = useLanguage();
  const memberIds = new Set(members.map((member) => member.workspaceMembershipId));
  const addableUsers = users.filter(
    (user) => user.membershipId !== project.ownerMembershipId && !memberIds.has(user.membershipId),
  );

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
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label>
          <span className="mb-1 block text-sm font-medium">
            {t(locale, 'workspaceProjects.searchMembers')}
          </span>
          <Input value={search} onChange={(event) => onSearch(event.target.value)} />
        </label>
        <Select value={noneValue} onValueChange={(value) => value !== noneValue && onAdd(value)}>
          <SelectTrigger label={t(locale, 'workspaceProjects.addMember')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={noneValue}>{t(locale, 'workspaceProjects.none')}</SelectItem>
            {addableUsers.map((user) => (
              <SelectItem key={user.membershipId} value={user.membershipId}>
                {user.name || user.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

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
                <p className="text-xs text-muted-foreground">{member.member.user.email}</p>
              </div>
              <Button
                type="button"
                variant="secondary"
                aria-label={`${t(locale, 'workspaceProjects.removeMember')} ${name}`}
                onClick={() => onRemove(member.workspaceMembershipId)}
              >
                {t(locale, 'workspaceProjects.removeMember')}
              </Button>
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
