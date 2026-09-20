'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Clock,
  Download,
  Edit,
  Filter,
  LinkIcon,
  MessageSquare,
  Paperclip,
  Plus,
  Save,
  Search,
  Trash2,
  Upload,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Button,
  Textarea,
  Dialog,
  DialogContent,
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
import { useLanguage } from '../../../contexts/language-provider';
import { translate as t } from '../../../lib/i18n';
import { useSessionStore } from '../../../stores/session';
import {
  listDepartments,
  listWorkspaceUsers,
  type Department,
  type WorkspaceUser,
} from '../../../services/workspace-management';
import { listWorkspaceRoles, rolesKeys } from '../../../services/workspace-roles';
import { listWorkspaceStatuses, statusKeys } from '../../../services/workspace-statuses';
import {
  createWorkspaceTicket,
  createWorkspaceTicketConversationEntry,
  createWorkspaceTicketSavedView,
  addTicketUrlAttachment,
  claimWorkspaceTicket,
  completeTicketAttachmentUpload,
  deleteWorkspaceTicketSavedView,
  deleteWorkspaceTicket,
  downloadTicketAttachment,
  downloadTicketConversationAttachment,
  getWorkspaceTicketActivity,
  getWorkspaceTicketSla,
  getWorkspaceTicket,
  getWorkspaceTicketQueueSummary,
  initTicketAttachmentUpload,
  listWorkspaceTicketAttachments,
  listWorkspaceTicketConversation,
  listWorkspaceTicketSavedViews,
  listWorkspaceTickets,
  normalizeTicketListParams,
  ticketKeys,
  updateWorkspaceTicketSavedView,
  type ListWorkspaceTicketsParams,
  type TicketAssignmentState,
  type TicketBuiltInQueue,
  type TicketConversationEntry,
  type TicketConversationEntryType,
  type TicketEscalationAction,
  type TicketAttachmentSummary,
  type TicketPayload,
  type TicketPriority,
  type TicketRequesterTypeFilter,
  type TicketSavedView,
  type TicketSavedViewScope,
  type TicketSlaMetricFilter,
  type TicketSlaState,
  type TicketRequesterPayload,
  type WorkspaceTicketSummary,
  updateWorkspaceTicketAssignment,
  updateWorkspaceTicketEscalation,
  updateWorkspaceTicketRequester,
  updateWorkspaceTicket,
  updateWorkspaceTicketStatus,
  removeTicketAttachment,
} from '../../../services/workspace-tickets';

const priorities: TicketPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const noneValue = '__none__';
const builtInQueues: TicketBuiltInQueue[] = [
  'ALL_VISIBLE',
  'MY_ASSIGNED',
  'MY_REQUESTED',
  'MY_DEPARTMENT',
  'UNASSIGNED_MY_DEPARTMENT',
  'SLA_BREACHED',
];
const requesterTypes: TicketRequesterTypeFilter[] = ['INTERNAL', 'EXTERNAL', 'UNSET'];
const assignmentStates: TicketAssignmentState[] = ['ANY', 'ASSIGNED', 'UNASSIGNED'];
const slaMetrics: TicketSlaMetricFilter[] = ['ANY', 'FIRST_RESPONSE', 'RESOLUTION'];
const slaStates: TicketSlaState['firstResponse']['state'][] = [
  'NOT_CONFIGURED',
  'RUNNING',
  'PAUSED',
  'MET',
  'BREACHED',
  'NOT_APPLICABLE',
];
const ticketDetailTabs = ['overview', 'conversation', 'attachments', 'activity'] as const;
type TicketDetailTab = (typeof ticketDetailTabs)[number];

export function WorkspaceTicketsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { locale } = useLanguage();
  const selectedWorkspaceId = useSessionStore((state) => state.selectedWorkspaceId);
  const accessToken = useSessionStore((state) => state.accessToken);
  const agencies = useSessionStore((state) => state.agencies);
  const [createOpen, setCreateOpen] = useState(false);
  const [savedViewName, setSavedViewName] = useState('');
  const [savedViewScope, setSavedViewScope] = useState<TicketSavedViewScope>('PERSONAL');
  const searchParamString = searchParams.toString();
  const [localQuery, setLocalQuery] = useState<Record<string, string>>({});
  const didMountSearchParams = useRef(false);
  const paramValue = (key: string) => localQuery[key] ?? searchParams.get(key) ?? '';
  const activeViewId = paramValue('viewId');
  const previousWorkspaceId = useRef(selectedWorkspaceId);
  const currentQueryRef = useRef<Record<string, string>>({});
  currentQueryRef.current = Object.fromEntries(
    new URLSearchParams(Object.keys(localQuery).length > 0 ? localQuery : searchParams).entries(),
  );

  useEffect(() => {
    if (!didMountSearchParams.current) {
      didMountSearchParams.current = true;
      return;
    }
    setLocalQuery({});
  }, [searchParamString]);

  useEffect(() => {
    setCreateOpen(false);
    setSavedViewName('');
    const previousWorkspaceIdValue = previousWorkspaceId.current;
    previousWorkspaceId.current = selectedWorkspaceId;
    if (
      previousWorkspaceIdValue &&
      selectedWorkspaceId &&
      previousWorkspaceIdValue !== selectedWorkspaceId
    ) {
      const query = new URLSearchParams();
      const queue = safeQueue(currentQueryRef.current.queue ?? null);
      if (queue) query.set('queue', queue);
      query.set('page', '1');
      const nextQuery = Object.fromEntries(query.entries());
      setLocalQuery(nextQuery);
      router.replace(`/workspace/tickets?${query.toString()}` as Route);
      return;
    }
    setLocalQuery({});
  }, [selectedWorkspaceId]);

  const params = normalizeTicketListParams({
    page: Number(paramValue('page') || 1),
    pageSize: 20,
    queue: safeQueue(paramValue('queue')),
    search: paramValue('search') || undefined,
    statusDefinitionId: paramValue('statusDefinitionId') || undefined,
    priority: safePriority(paramValue('priority')),
    requesterType: safeRequesterType(paramValue('requesterType')),
    internalRequesterMembershipId: paramValue('internalRequesterMembershipId') || undefined,
    departmentId: paramValue('departmentId') || undefined,
    assignedToMembershipId: paramValue('assignedToMembershipId') || undefined,
    assignmentState: safeAssignmentState(paramValue('assignmentState')),
    createdFrom: paramValue('createdFrom') || undefined,
    createdTo: paramValue('createdTo') || undefined,
    updatedFrom: paramValue('updatedFrom') || undefined,
    updatedTo: paramValue('updatedTo') || undefined,
    slaMetric: safeSlaMetric(paramValue('slaMetric')),
    slaState: safeSlaState(paramValue('slaState')),
    slaDueFrom: paramValue('slaDueFrom') || undefined,
    slaDueTo: paramValue('slaDueTo') || undefined,
    sortBy: safeSortBy(paramValue('sortBy')),
    sortDirection: safeSortDirection(paramValue('sortDirection')),
  });

  function updateListState(next: Partial<Record<keyof typeof params | 'viewId', string | null>>) {
    const query = new URLSearchParams(
      Object.keys(localQuery).length > 0 ? localQuery : searchParams,
    );
    for (const [key, value] of Object.entries(next)) {
      if (!value) query.delete(key);
      else query.set(key, value);
    }
    if (!('page' in next)) query.set('page', '1');
    setLocalQuery(Object.fromEntries(query.entries()));
    router.replace(`/workspace/tickets?${query.toString()}` as Route);
  }

  function clearTicketFilters() {
    updateListState({
      search: null,
      statusDefinitionId: null,
      priority: null,
      requesterType: null,
      internalRequesterMembershipId: null,
      departmentId: null,
      assignedToMembershipId: null,
      assignmentState: null,
      createdFrom: null,
      createdTo: null,
      updatedFrom: null,
      updatedTo: null,
      slaMetric: null,
      slaState: null,
      slaDueFrom: null,
      slaDueTo: null,
      sortBy: null,
      sortDirection: null,
      viewId: null,
      page: '1',
    });
  }

  const ticketsQuery = useQuery({
    queryKey: ticketKeys.list(selectedWorkspaceId, params),
    queryFn: () => listWorkspaceTickets(selectedWorkspaceId as string, params),
    enabled: Boolean(accessToken && selectedWorkspaceId),
  });
  const queueSummaryQuery = useQuery({
    queryKey: ticketKeys.queueSummary(selectedWorkspaceId),
    queryFn: () => getWorkspaceTicketQueueSummary(selectedWorkspaceId as string),
    enabled: Boolean(accessToken && selectedWorkspaceId),
  });
  const savedViewsQuery = useQuery({
    queryKey: ticketKeys.savedViews(selectedWorkspaceId),
    queryFn: () => listWorkspaceTicketSavedViews(selectedWorkspaceId as string),
    enabled: Boolean(accessToken && selectedWorkspaceId),
  });
  const statusesQuery = useQuery({
    queryKey: statusKeys.list(selectedWorkspaceId, 'TICKET', 'ACTIVE'),
    queryFn: () => listWorkspaceStatuses(selectedWorkspaceId as string, 'TICKET', 'ACTIVE'),
    enabled: Boolean(accessToken && selectedWorkspaceId),
  });
  const rolesQuery = useQuery({
    queryKey: rolesKeys.all(selectedWorkspaceId),
    queryFn: () => listWorkspaceRoles(selectedWorkspaceId as string),
    enabled: Boolean(accessToken && selectedWorkspaceId),
  });
  const usersQuery = useQuery({
    queryKey: ['workspace', selectedWorkspaceId, 'ticket-requester-users', 'ACTIVE'],
    queryFn: () =>
      listWorkspaceUsers({
        workspaceId: selectedWorkspaceId as string,
        page: 1,
        pageSize: 20,
        status: 'ACTIVE',
      }),
    enabled: Boolean(accessToken && selectedWorkspaceId),
  });
  const departmentsQuery = useQuery({
    queryKey: ['workspace', selectedWorkspaceId, 'ticket-departments', 'ACTIVE'],
    queryFn: () =>
      listDepartments({
        workspaceId: selectedWorkspaceId as string,
        page: 1,
        pageSize: 50,
        status: 'ACTIVE',
      }),
    enabled: Boolean(accessToken && selectedWorkspaceId),
  });

  const permissions = useWorkspacePermissions(agencies, selectedWorkspaceId, rolesQuery.data ?? []);
  const canCreate = hasPermission(permissions, 'tickets.create');
  const canAssign = hasPermission(permissions, 'tickets.assign');
  const canManageViews = hasPermission(permissions, 'tickets.views.manage');
  const canManageSharedViews = hasPermission(permissions, 'tickets.views.manage_shared');
  const canViewReports = hasPermission(permissions, 'tickets.reports.view');
  const tickets = ticketsQuery.data?.items ?? [];
  const totalPages = Math.max(1, Math.ceil((ticketsQuery.data?.total ?? 0) / 20));
  const activeSavedView = savedViewsQuery.data?.find((view) => view.id === activeViewId) ?? null;
  const currentFilters = ticketFiltersFromParams(params);
  const currentSort = { sortBy: params.sortBy, sortDirection: params.sortDirection };
  const isDirtyView =
    activeSavedView &&
    (JSON.stringify(activeSavedView.filters) !== JSON.stringify(currentFilters) ||
      JSON.stringify(activeSavedView.sort) !== JSON.stringify(currentSort));
  const canManageActiveSavedView = activeSavedView
    ? activeSavedView.scope === 'PERSONAL'
      ? canManageViews
      : canManageSharedViews
    : false;
  const activeFilterChips = ticketFilterChips(
    params,
    locale,
    statusesQuery.data ?? [],
    usersQuery.data?.items ?? [],
    departmentsQuery.data?.items ?? [],
  );

  const createMutation = useMutation({
    mutationFn: (body: TicketPayload) => createWorkspaceTicket(selectedWorkspaceId as string, body),
    onSuccess(ticket) {
      toast.success(t(locale, 'workspaceTickets.ticketCreated'));
      setCreateOpen(false);
      void queryClient.invalidateQueries({
        queryKey: ticketKeys.list(selectedWorkspaceId, params),
      });
      router.push(`/workspace/tickets/${ticket.id}` as Route);
    },
    onError() {
      toast.error(t(locale, 'workspaceTickets.unableToCreateTicket'));
    },
  });
  const createSavedViewMutation = useMutation({
    mutationFn: () =>
      createWorkspaceTicketSavedView(selectedWorkspaceId as string, {
        name: savedViewName,
        scope: savedViewScope,
        filters: currentFilters,
        sort: currentSort,
      }),
    onSuccess(view) {
      toast.success(t(locale, 'workspaceTickets.savedViewCreated'));
      setSavedViewName('');
      void queryClient.invalidateQueries({ queryKey: ticketKeys.savedViews(selectedWorkspaceId) });
      updateListState({ viewId: view.id });
    },
    onError() {
      toast.error(t(locale, 'workspaceTickets.unableToSaveView'));
    },
  });
  const updateSavedViewMutation = useMutation({
    mutationFn: (view: TicketSavedView) =>
      updateWorkspaceTicketSavedView(selectedWorkspaceId as string, view.id, {
        filters: currentFilters,
        sort: currentSort,
      }),
    onSuccess() {
      toast.success(t(locale, 'workspaceTickets.savedViewUpdated'));
      void queryClient.invalidateQueries({ queryKey: ticketKeys.savedViews(selectedWorkspaceId) });
    },
    onError() {
      toast.error(t(locale, 'workspaceTickets.unableToSaveView'));
    },
  });
  const deleteSavedViewMutation = useMutation({
    mutationFn: (viewId: string) =>
      deleteWorkspaceTicketSavedView(selectedWorkspaceId as string, viewId),
    onSuccess() {
      toast.success(t(locale, 'workspaceTickets.savedViewDeleted'));
      void queryClient.invalidateQueries({ queryKey: ticketKeys.savedViews(selectedWorkspaceId) });
      updateListState({ viewId: null });
    },
    onError() {
      toast.error(t(locale, 'workspaceTickets.unableToDeleteView'));
    },
  });

  if (!selectedWorkspaceId) {
    return (
      <EmptyState title={t(locale, 'workspaceTickets.title')} description="Select a Workspace." />
    );
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{t(locale, 'navigation.tickets')}</p>
          <h1 className="text-2xl font-semibold tracking-normal">
            {t(locale, 'workspaceTickets.title')}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {canViewReports ? (
            <Link
              href={'/workspace/tickets/reports' as Route}
              className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-muted"
            >
              <Filter className="mr-2 h-4 w-4" />
              {t(locale, 'workspaceTickets.serviceDeskReports')}
            </Link>
          ) : null}
          {canCreate ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              {t(locale, 'workspaceTickets.createTicket')}
            </Button>
          ) : null}
        </div>
      </header>

      <nav
        aria-label={t(locale, 'workspaceTickets.ticketQueues')}
        className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
      >
        {builtInQueues.map((queue) => (
          <button
            key={queue}
            type="button"
            aria-current={params.queue === queue ? 'page' : undefined}
            className={[
              'flex min-h-12 items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors',
              params.queue === queue
                ? 'border-primary bg-primary/10 text-primary'
                : 'bg-card hover:bg-muted',
            ].join(' ')}
            onClick={() => updateListState({ queue, viewId: null })}
          >
            <span className="font-medium">{queueLabel(locale, queue)}</span>
            <span className="text-muted-foreground">
              {queueSummaryQuery.data?.[queue] ?? (queueSummaryQuery.isLoading ? '...' : 0)}
            </span>
          </button>
        ))}
      </nav>

      <section
        className="space-y-3 rounded-md border bg-card p-4"
        aria-label={t(locale, 'workspaceTickets.savedViews')}
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <label className="block space-y-1 text-sm font-medium">
            {t(locale, 'workspaceTickets.savedViews')}
            <Select
              value={activeViewId || noneValue}
              onValueChange={(value) => {
                if (value === noneValue) {
                  updateListState({ viewId: null });
                  return;
                }
                const view = savedViewsQuery.data?.find((item) => item.id === value);
                if (!view) return;
                applySavedView(view, updateListState);
              }}
            >
              <SelectTrigger
                className="min-w-60"
                aria-label={t(locale, 'workspaceTickets.savedViews')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={noneValue}>
                  {t(locale, 'workspaceTickets.noSavedView')}
                </SelectItem>
                {(savedViewsQuery.data ?? []).map((view) => (
                  <SelectItem key={view.id} value={view.id}>
                    {view.name} -{' '}
                    {view.scope === 'PERSONAL'
                      ? t(locale, 'workspaceTickets.personalView')
                      : t(locale, 'workspaceTickets.workspaceView')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <div className="grid gap-2 sm:grid-cols-[minmax(180px,1fr)_160px_auto_auto]">
            <Input
              aria-label={t(locale, 'workspaceTickets.savedViewName')}
              placeholder={t(locale, 'workspaceTickets.savedViewName')}
              value={savedViewName}
              onChange={(event) => setSavedViewName(event.target.value)}
            />
            <Select
              value={savedViewScope}
              onValueChange={(value) => setSavedViewScope(value as TicketSavedViewScope)}
            >
              <SelectTrigger aria-label={t(locale, 'workspaceTickets.savedViewScope')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PERSONAL">
                  {t(locale, 'workspaceTickets.personalView')}
                </SelectItem>
                <SelectItem value="WORKSPACE" disabled={!canManageSharedViews}>
                  {t(locale, 'workspaceTickets.workspaceView')}
                </SelectItem>
              </SelectContent>
            </Select>
            <Button
              type="button"
              disabled={
                !savedViewName.trim() ||
                createSavedViewMutation.isPending ||
                (savedViewScope === 'PERSONAL' ? !canManageViews : !canManageSharedViews)
              }
              onClick={() => createSavedViewMutation.mutate()}
            >
              <Save className="mr-2 h-4 w-4" />
              {t(locale, 'workspaceTickets.saveAsNewView')}
            </Button>
            {activeSavedView && canManageActiveSavedView ? (
              <Button
                type="button"
                variant="outline"
                disabled={!isDirtyView || updateSavedViewMutation.isPending}
                onClick={() => updateSavedViewMutation.mutate(activeSavedView)}
              >
                {t(locale, 'workspaceTickets.saveChanges')}
              </Button>
            ) : null}
          </div>
        </div>
        {activeSavedView ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{activeSavedView.name}</span>
            {isDirtyView ? <span>{t(locale, 'workspaceTickets.unsavedChanges')}</span> : null}
            {canManageActiveSavedView ? (
              <Button
                type="button"
                variant="ghost"
                disabled={deleteSavedViewMutation.isPending}
                onClick={() => deleteSavedViewMutation.mutate(activeSavedView.id)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {t(locale, 'workspaceTickets.deleteView')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </section>

      <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_220px_180px]">
        <label className="space-y-1 text-sm font-medium">
          {t(locale, 'workspaceTickets.searchTickets')}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label={t(locale, 'workspaceTickets.searchTickets')}
              className="pl-9"
              value={params.search ?? ''}
              onChange={(event) => {
                updateListState({ search: event.target.value, viewId: null });
              }}
            />
          </div>
        </label>
        <label className="space-y-1 text-sm font-medium">
          {t(locale, 'workspaceTickets.status')}
          <Select
            value={params.statusDefinitionId || noneValue}
            onValueChange={(value) => {
              updateListState({
                statusDefinitionId: value === noneValue ? null : value,
                viewId: null,
              });
            }}
          >
            <SelectTrigger aria-label={t(locale, 'workspaceTickets.status')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={noneValue}>{t(locale, 'workspaceTickets.allStatuses')}</SelectItem>
              {(statusesQuery.data ?? []).map((status) => (
                <SelectItem key={status.id} value={status.id}>
                  {status.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1 text-sm font-medium">
          {t(locale, 'workspaceTickets.priority')}
          <Select
            value={params.priority || noneValue}
            onValueChange={(value) => {
              updateListState({ priority: value === noneValue ? null : value, viewId: null });
            }}
          >
            <SelectTrigger aria-label={t(locale, 'workspaceTickets.priority')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={noneValue}>
                {t(locale, 'workspaceTickets.allPriorities')}
              </SelectItem>
              {priorities.map((item) => (
                <SelectItem key={item} value={item}>
                  {priorityLabel(locale, item)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>

      <section
        className="space-y-3 rounded-md border p-4"
        aria-label={t(locale, 'workspaceTickets.filters')}
      >
        <div className="flex items-center gap-2 text-sm font-medium">
          <Filter className="h-4 w-4" />
          {t(locale, 'workspaceTickets.filters')}
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <TicketSelectFilter
            label={t(locale, 'workspaceTickets.requesterType')}
            value={params.requesterType ?? noneValue}
            options={requesterTypes.map((value) => ({
              value,
              label: requesterTypeLabel(locale, value),
            }))}
            onChange={(value) =>
              updateListState({ requesterType: value === noneValue ? null : value, viewId: null })
            }
          />
          <TicketSelectFilter
            label={t(locale, 'workspaceTickets.department')}
            value={params.departmentId ?? noneValue}
            options={(departmentsQuery.data?.items ?? []).map((department) => ({
              value: department.id,
              label: department.name,
            }))}
            onChange={(value) =>
              updateListState({ departmentId: value === noneValue ? null : value, viewId: null })
            }
          />
          <TicketSelectFilter
            label={t(locale, 'workspaceTickets.assignedTo')}
            value={params.assignedToMembershipId ?? noneValue}
            options={(usersQuery.data?.items ?? []).map((user) => ({
              value: user.id,
              label: user.name ?? user.email,
            }))}
            onChange={(value) =>
              updateListState({
                assignedToMembershipId: value === noneValue ? null : value,
                viewId: null,
              })
            }
          />
          <TicketSelectFilter
            label={t(locale, 'workspaceTickets.internalRequester')}
            value={params.internalRequesterMembershipId ?? noneValue}
            options={(usersQuery.data?.items ?? []).map((user) => ({
              value: user.id,
              label: user.name ?? user.email,
            }))}
            onChange={(value) =>
              updateListState({
                internalRequesterMembershipId: value === noneValue ? null : value,
                viewId: null,
              })
            }
          />
          <TicketSelectFilter
            label={t(locale, 'workspaceTickets.assignmentState')}
            value={params.assignmentState ?? noneValue}
            options={assignmentStates.map((value) => ({
              value,
              label: assignmentStateLabel(locale, value),
            }))}
            onChange={(value) =>
              updateListState({ assignmentState: value === noneValue ? null : value, viewId: null })
            }
          />
          <TicketSelectFilter
            label={t(locale, 'workspaceTickets.slaMetric')}
            value={params.slaMetric ?? noneValue}
            options={slaMetrics.map((value) => ({ value, label: slaMetricLabel(locale, value) }))}
            onChange={(value) =>
              updateListState({ slaMetric: value === noneValue ? null : value, viewId: null })
            }
          />
          <TicketSelectFilter
            label={t(locale, 'workspaceTickets.slaState')}
            value={params.slaState ?? noneValue}
            options={slaStates.map((value) => ({ value, label: slaStateLabel(locale, value) }))}
            onChange={(value) =>
              updateListState({ slaState: value === noneValue ? null : value, viewId: null })
            }
          />
          <TicketSelectFilter
            label={t(locale, 'workspaceTickets.sortBy')}
            value={params.sortBy}
            options={['createdAt', 'updatedAt', 'ticketNumber', 'priority'].map((value) => ({
              value,
              label: sortLabel(locale, value),
            }))}
            includeAll={false}
            onChange={(value) => updateListState({ sortBy: value, viewId: null })}
          />
          <TicketSelectFilter
            label={t(locale, 'workspaceTickets.sortDirection')}
            value={params.sortDirection}
            options={[
              { value: 'desc', label: t(locale, 'workspaceTickets.descending') },
              { value: 'asc', label: t(locale, 'workspaceTickets.ascending') },
            ]}
            includeAll={false}
            onChange={(value) => updateListState({ sortDirection: value, viewId: null })}
          />
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {(
            [
              'createdFrom',
              'createdTo',
              'updatedFrom',
              'updatedTo',
              'slaDueFrom',
              'slaDueTo',
            ] as const
          ).map((key) => (
            <label key={key} className="space-y-1 text-sm font-medium">
              {dateFilterLabel(locale, key)}
              <Input
                type="date"
                value={params[key] ?? ''}
                onChange={(event) =>
                  updateListState({ [key]: event.target.value || null, viewId: null })
                }
              />
            </label>
          ))}
        </div>
        {activeFilterChips.length > 0 ? (
          <div
            className="flex flex-wrap gap-2"
            aria-label={t(locale, 'workspaceTickets.activeFilters')}
          >
            {activeFilterChips.map((chip) => (
              <Button
                key={chip.key}
                type="button"
                variant="outline"
                className="h-8 px-2 text-xs"
                aria-label={`${t(locale, 'workspaceTickets.removeFilter')} ${chip.label}`}
                onClick={() =>
                  updateListState({
                    [chip.key]: null,
                    viewId: null,
                  } as Partial<Record<keyof typeof params | 'viewId', string | null>>)
                }
              >
                <span>{chip.label}</span>
                <X className="ml-2 h-3 w-3" />
              </Button>
            ))}
          </div>
        ) : null}
        <Button type="button" variant="outline" onClick={clearTicketFilters}>
          <X className="mr-2 h-4 w-4" />
          {t(locale, 'workspaceTickets.clearFilters')}
        </Button>
      </section>

      {ticketsQuery.isError ? (
        <EmptyState
          title={t(locale, 'workspaceTickets.unableToLoadTickets')}
          description={t(locale, 'states.pageLoadFailed')}
          action={
            <Button onClick={() => void ticketsQuery.refetch()}>
              {t(locale, 'common.tryAgain')}
            </Button>
          }
        />
      ) : null}
      {ticketsQuery.isLoading ? <TicketSkeleton /> : null}
      {!ticketsQuery.isLoading && !ticketsQuery.isError && tickets.length === 0 ? (
        <EmptyState
          title={
            hasActiveTicketFilters(params)
              ? t(locale, 'workspaceTickets.noTicketsMatchFilters')
              : t(locale, 'workspaceTickets.noTicketsInThisQueue')
          }
          description={t(locale, 'workspaceTickets.emptyDescription')}
        />
      ) : null}
      {tickets.length > 0 ? <TicketList tickets={tickets} /> : null}

      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          disabled={params.page <= 1 || ticketsQuery.isFetching}
          onClick={() => updateListState({ page: String(params.page - 1) })}
        >
          {t(locale, 'workspaceTickets.previous')}
        </Button>
        <span className="text-sm text-muted-foreground">
          {t(locale, 'workspaceTickets.page')} {params.page} {t(locale, 'workspaceTickets.of')}{' '}
          {totalPages}
        </span>
        <Button
          variant="outline"
          disabled={params.page >= totalPages || ticketsQuery.isFetching}
          onClick={() => updateListState({ page: String(params.page + 1) })}
        >
          {t(locale, 'workspaceTickets.next')}
        </Button>
      </div>

      <TicketFormDialog
        open={createOpen}
        title={t(locale, 'workspaceTickets.createTicket')}
        statuses={statusesQuery.data ?? []}
        requesterUsers={usersQuery.data?.items ?? []}
        departments={departmentsQuery.data?.items ?? []}
        includeRequester
        canAssign={canAssign}
        submitLabel={t(locale, 'workspaceTickets.createTicket')}
        isSubmitting={createMutation.isPending}
        onOpenChange={setCreateOpen}
        onSubmit={(body) => createMutation.mutate(body)}
      />
    </section>
  );
}

export function WorkspaceTicketDetailPage({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { locale } = useLanguage();
  const selectedWorkspaceId = useSessionStore((state) => state.selectedWorkspaceId);
  const accessToken = useSessionStore((state) => state.accessToken);
  const agencies = useSessionStore((state) => state.agencies);
  const [editOpen, setEditOpen] = useState(false);
  const [requesterOpen, setRequesterOpen] = useState(false);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [escalationAction, setEscalationAction] = useState<TicketEscalationAction | null>(null);

  useEffect(() => {
    setEditOpen(false);
    setRequesterOpen(false);
    setAssignmentOpen(false);
    setDeleteOpen(false);
    setEscalationAction(null);
  }, [selectedWorkspaceId, ticketId]);

  const ticketQuery = useQuery({
    queryKey: ticketKeys.detail(selectedWorkspaceId, ticketId),
    queryFn: () => getWorkspaceTicket(selectedWorkspaceId as string, ticketId),
    enabled: Boolean(accessToken && selectedWorkspaceId && ticketId),
  });
  const statusesQuery = useQuery({
    queryKey: statusKeys.list(selectedWorkspaceId, 'TICKET', 'ACTIVE'),
    queryFn: () => listWorkspaceStatuses(selectedWorkspaceId as string, 'TICKET', 'ACTIVE'),
    enabled: Boolean(accessToken && selectedWorkspaceId),
  });
  const rolesQuery = useQuery({
    queryKey: rolesKeys.all(selectedWorkspaceId),
    queryFn: () => listWorkspaceRoles(selectedWorkspaceId as string),
    enabled: Boolean(accessToken && selectedWorkspaceId),
  });
  const usersQuery = useQuery({
    queryKey: ['workspace', selectedWorkspaceId, 'ticket-detail-users', 'ACTIVE'],
    queryFn: () =>
      listWorkspaceUsers({
        workspaceId: selectedWorkspaceId as string,
        page: 1,
        pageSize: 20,
        status: 'ACTIVE',
      }),
    enabled: Boolean(accessToken && selectedWorkspaceId && (requesterOpen || assignmentOpen)),
  });
  const departmentsQuery = useQuery({
    queryKey: ['workspace', selectedWorkspaceId, 'ticket-detail-departments', 'ACTIVE'],
    queryFn: () =>
      listDepartments({
        workspaceId: selectedWorkspaceId as string,
        page: 1,
        pageSize: 50,
        status: 'ACTIVE',
      }),
    enabled: Boolean(accessToken && selectedWorkspaceId && assignmentOpen),
  });
  const permissions = useWorkspacePermissions(agencies, selectedWorkspaceId, rolesQuery.data ?? []);
  const canUpdate = hasPermission(permissions, 'tickets.update');
  const canDelete = hasPermission(permissions, 'tickets.delete');
  const canAssign = hasPermission(permissions, 'tickets.assign');
  const canClaim = hasPermission(permissions, 'tickets.claim');
  const canEscalate = hasPermission(permissions, 'tickets.escalate');
  const canManageRequester = hasPermission(permissions, 'tickets.manage_requester');
  const canReply = hasPermission(permissions, 'tickets.reply');
  const canViewNotes = hasPermission(permissions, 'tickets.notes.view');
  const canCreateNotes = hasPermission(permissions, 'tickets.notes.create');
  const canViewSla = hasPermission(permissions, 'tickets.sla.view');
  const canViewAttachments = hasPermission(permissions, 'tickets.attachments.view');
  const canAddAttachments = hasPermission(permissions, 'tickets.attachments.add');
  const canRemoveAttachments = hasPermission(permissions, 'tickets.attachments.remove');
  const canViewActivity = hasPermission(permissions, 'tickets.activity.view');
  const ticket = ticketQuery.data;
  const requestedTab = safeTicketDetailTab(searchParams.get('tab'));
  const availableTabs = useMemo(
    () =>
      ticketDetailTabs.filter((tab) => {
        if (tab === 'attachments') return canViewAttachments;
        if (tab === 'activity') return canViewActivity;
        return true;
      }),
    [canViewActivity, canViewAttachments],
  );
  const activeTab = availableTabs.includes(requestedTab) ? requestedTab : 'overview';
  const locallyClaimable = Boolean(
    canClaim && ticket?.departmentId && !ticket.assignedToMembershipId,
  );
  const slaQuery = useQuery({
    queryKey: ticketKeys.sla(selectedWorkspaceId, ticketId),
    queryFn: () => getWorkspaceTicketSla(selectedWorkspaceId as string, ticketId),
    enabled: Boolean(
      accessToken && selectedWorkspaceId && ticketId && canViewSla && activeTab === 'overview',
    ),
  });

  useEffect(() => {
    if (ticketQuery.error && (ticketQuery.error as { status?: number }).status === 404) {
      setRequesterOpen(false);
      setAssignmentOpen(false);
      router.replace('/workspace/tickets' as Route);
    }
  }, [router, ticketQuery.error]);

  useEffect(() => {
    const rawTab = searchParams.get('tab');
    if (!rawTab || activeTab === rawTab) return;
    const query = new URLSearchParams(searchParams);
    if (activeTab === 'overview') query.delete('tab');
    else query.set('tab', activeTab);
    const suffix = query.toString();
    router.replace(`/workspace/tickets/${ticketId}${suffix ? `?${suffix}` : ''}` as Route);
  }, [activeTab, router, searchParams, ticketId]);

  const updateMutation = useMutation({
    mutationFn: (body: TicketPayload) =>
      updateWorkspaceTicket(selectedWorkspaceId as string, ticketId, body),
    onSuccess() {
      toast.success(t(locale, 'workspaceTickets.ticketUpdated'));
      setEditOpen(false);
      void queryClient.invalidateQueries({
        queryKey: ticketKeys.detail(selectedWorkspaceId, ticketId),
      });
      void queryClient.invalidateQueries({ queryKey: ticketKeys.all(selectedWorkspaceId) });
    },
    onError() {
      toast.error(t(locale, 'workspaceTickets.unableToUpdateTicket'));
    },
  });
  const statusMutation = useMutation({
    mutationFn: (statusDefinitionId: string) =>
      updateWorkspaceTicketStatus(selectedWorkspaceId as string, ticketId, statusDefinitionId),
    onSuccess() {
      toast.success(t(locale, 'workspaceTickets.ticketUpdated'));
      void queryClient.invalidateQueries({
        queryKey: ticketKeys.detail(selectedWorkspaceId, ticketId),
      });
      void queryClient.invalidateQueries({ queryKey: ticketKeys.all(selectedWorkspaceId) });
    },
    onError() {
      toast.error(t(locale, 'workspaceTickets.unableToUpdateTicket'));
    },
  });
  const requesterMutation = useMutation({
    mutationFn: (requester: TicketRequesterPayload) =>
      updateWorkspaceTicketRequester(selectedWorkspaceId as string, ticketId, requester),
    onSuccess() {
      toast.success(t(locale, 'workspaceTickets.ticketUpdated'));
      setRequesterOpen(false);
      queryClient.removeQueries({ queryKey: ticketKeys.detail(selectedWorkspaceId, ticketId) });
      void queryClient.invalidateQueries({ queryKey: ticketKeys.all(selectedWorkspaceId) });
    },
    onError(error: { status?: number }) {
      toast.error(t(locale, 'workspaceTickets.unableToUpdateTicket'));
      if (error.status === 404) {
        setRequesterOpen(false);
        queryClient.removeQueries({ queryKey: ticketKeys.detail(selectedWorkspaceId, ticketId) });
        router.replace('/workspace/tickets' as Route);
      }
    },
  });
  const assignmentMutation = useMutation({
    mutationFn: (body: { departmentId?: string | null; assignedToMembershipId?: string | null }) =>
      updateWorkspaceTicketAssignment(selectedWorkspaceId as string, ticketId, body),
    onSuccess() {
      toast.success(t(locale, 'workspaceTickets.ticketUpdated'));
      setAssignmentOpen(false);
      queryClient.removeQueries({ queryKey: ticketKeys.detail(selectedWorkspaceId, ticketId) });
      void queryClient.invalidateQueries({ queryKey: ticketKeys.all(selectedWorkspaceId) });
    },
    onError(error: { status?: number }) {
      toast.error(t(locale, 'workspaceTickets.unableToUpdateTicket'));
      if (error.status === 404) {
        setAssignmentOpen(false);
        queryClient.removeQueries({ queryKey: ticketKeys.detail(selectedWorkspaceId, ticketId) });
        router.replace('/workspace/tickets' as Route);
      }
    },
  });
  const claimMutation = useMutation({
    mutationFn: () => claimWorkspaceTicket(selectedWorkspaceId as string, ticketId),
    onSuccess() {
      toast.success(t(locale, 'workspaceTickets.ticketClaimed'));
      queryClient.removeQueries({ queryKey: ticketKeys.detail(selectedWorkspaceId, ticketId) });
      void queryClient.invalidateQueries({ queryKey: ticketKeys.all(selectedWorkspaceId) });
      void queryClient.invalidateQueries({
        queryKey: ticketKeys.queueSummary(selectedWorkspaceId),
      });
    },
    onError(error: { status?: number }) {
      toast.error(
        error.status === 409
          ? t(locale, 'workspaceTickets.ticketWorkflowStale')
          : t(locale, 'workspaceTickets.unableToUpdateTicket'),
      );
      queryClient.removeQueries({ queryKey: ticketKeys.detail(selectedWorkspaceId, ticketId) });
      void queryClient.invalidateQueries({ queryKey: ticketKeys.all(selectedWorkspaceId) });
    },
  });
  const escalationMutation = useMutation({
    mutationFn: (body: { action: TicketEscalationAction; reason: string }) =>
      updateWorkspaceTicketEscalation(selectedWorkspaceId as string, ticketId, {
        action: body.action,
        expectedLevel: ticket?.escalationLevel ?? 'NONE',
        reason: body.reason,
      }),
    onSuccess() {
      toast.success(t(locale, 'workspaceTickets.escalationUpdated'));
      setEscalationAction(null);
      queryClient.removeQueries({ queryKey: ticketKeys.detail(selectedWorkspaceId, ticketId) });
      void queryClient.invalidateQueries({ queryKey: ticketKeys.all(selectedWorkspaceId) });
    },
    onError(error: { status?: number }) {
      toast.error(
        error.status === 409
          ? t(locale, 'workspaceTickets.ticketWorkflowStale')
          : t(locale, 'workspaceTickets.unableToUpdateTicket'),
      );
      queryClient.removeQueries({ queryKey: ticketKeys.detail(selectedWorkspaceId, ticketId) });
      void queryClient.invalidateQueries({ queryKey: ticketKeys.all(selectedWorkspaceId) });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: () => deleteWorkspaceTicket(selectedWorkspaceId as string, ticketId),
    onSuccess() {
      toast.success(t(locale, 'workspaceTickets.ticketDeleted'));
      void queryClient.invalidateQueries({ queryKey: ticketKeys.all(selectedWorkspaceId) });
      router.replace('/workspace/tickets' as Route);
    },
    onError() {
      toast.error(t(locale, 'workspaceTickets.unableToDeleteTicket'));
    },
  });
  if (ticketQuery.isLoading) return <TicketSkeleton />;
  if (ticketQuery.isError || !ticket) {
    return (
      <EmptyState
        title={t(locale, 'workspaceTickets.ticketNotFound')}
        description={t(locale, 'workspaceTickets.ticketNotFoundDescription')}
        action={
          <Link className="text-sm text-primary" href={'/workspace/tickets' as Route}>
            {t(locale, 'navigation.tickets')}
          </Link>
        }
      />
    );
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <Link className="text-sm text-primary" href={'/workspace/tickets' as Route}>
            {t(locale, 'navigation.tickets')}
          </Link>
          <p className="mt-2 text-sm font-medium text-muted-foreground">{ticket.ticketNumber}</p>
          <h1 className="break-words text-2xl font-semibold tracking-normal">{ticket.subject}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {canUpdate ? (
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Edit className="mr-2 h-4 w-4" />
              {t(locale, 'workspaceTickets.editTicket')}
            </Button>
          ) : null}
          {canManageRequester ? (
            <Button variant="outline" onClick={() => setRequesterOpen(true)}>
              <UserCog className="mr-2 h-4 w-4" />
              {t(locale, 'workspaceTickets.changeRequester')}
            </Button>
          ) : null}
          {canAssign ? (
            <Button variant="outline" onClick={() => setAssignmentOpen(true)}>
              <Users className="mr-2 h-4 w-4" />
              {t(locale, 'workspaceTickets.assignment')}
            </Button>
          ) : null}
          {locallyClaimable ? (
            <Button
              variant="outline"
              disabled={claimMutation.isPending}
              onClick={() => claimMutation.mutate()}
            >
              <UserCog className="mr-2 h-4 w-4" />
              {t(locale, 'workspaceTickets.claimTicket')}
            </Button>
          ) : null}
          {canEscalate ? (
            <>
              <Button
                variant="outline"
                disabled={ticket.escalationLevel === 'LEVEL_3'}
                onClick={() => setEscalationAction('ESCALATE')}
              >
                {t(locale, 'workspaceTickets.escalate')}
              </Button>
              <Button
                variant="outline"
                disabled={ticket.escalationLevel === 'NONE'}
                onClick={() => setEscalationAction('DEESCALATE')}
              >
                {t(locale, 'workspaceTickets.deescalate')}
              </Button>
              <Button
                variant="outline"
                disabled={ticket.escalationLevel === 'NONE'}
                onClick={() => setEscalationAction('CLEAR')}
              >
                {t(locale, 'workspaceTickets.clearEscalation')}
              </Button>
            </>
          ) : null}
          {canDelete ? (
            <Button variant="danger" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="mr-2 h-4 w-4" />
              {t(locale, 'workspaceTickets.deleteTicket')}
            </Button>
          ) : null}
        </div>
      </header>

      <nav
        role="tablist"
        aria-label={t(locale, 'workspaceTickets.ticketDetailTabs')}
        className="flex gap-2 overflow-x-auto border-b pb-2"
      >
        {availableTabs.map((tab) => (
          <button
            key={tab}
            id={ticketDetailTabId(tab)}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls={ticketDetailPanelId(tab)}
            tabIndex={activeTab === tab ? 0 : -1}
            className={[
              'whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors',
              activeTab === tab ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
            ].join(' ')}
            onClick={() => {
              const query = new URLSearchParams(searchParams);
              if (tab === 'overview') query.delete('tab');
              else query.set('tab', tab);
              const suffix = query.toString();
              router.push(`/workspace/tickets/${ticketId}${suffix ? `?${suffix}` : ''}` as Route);
            }}
          >
            {ticketDetailTabLabel(locale, tab)}
          </button>
        ))}
      </nav>

      <div
        id={ticketDetailPanelId(activeTab)}
        role="tabpanel"
        aria-labelledby={ticketDetailTabId(activeTab)}
        className="space-y-6"
      >
        {activeTab === 'overview' ? (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <TicketField
                label={t(locale, 'workspaceTickets.status')}
                value={ticket.status.name}
              />
              <TicketField
                label={t(locale, 'workspaceTickets.priority')}
                value={priorityLabel(locale, ticket.priority)}
              />
              <TicketField
                label={t(locale, 'workspaceTickets.requester')}
                value={requesterLabel(locale, ticket)}
              />
              <TicketField
                label={t(locale, 'workspaceTickets.department')}
                value={ticket.department?.name ?? t(locale, 'workspaceTickets.notSet')}
              />
              <TicketField
                label={t(locale, 'workspaceTickets.assignedTo')}
                value={assigneeLabel(locale, ticket)}
              />
              <TicketField
                label={t(locale, 'workspaceTickets.escalation')}
                value={escalationLevelLabel(locale, ticket.escalationLevel)}
              />
              {ticket.escalationChangedAt ? (
                <TicketField
                  label={t(locale, 'workspaceTickets.escalationUpdated')}
                  value={`${formatDate(ticket.escalationChangedAt)}${
                    ticket.escalationChangedBy
                      ? ` - ${ticket.escalationChangedBy.user.name ?? ticket.escalationChangedBy.user.email}`
                      : ''
                  }`}
                />
              ) : null}
              <TicketField
                label={t(locale, 'workspaceTickets.created')}
                value={formatDate(ticket.createdAt)}
              />
              <TicketField
                label={t(locale, 'workspaceTickets.updated')}
                value={formatDate(ticket.updatedAt)}
              />
            </div>

            {canUpdate ? (
              <label className="block max-w-sm space-y-1 text-sm font-medium">
                {t(locale, 'workspaceTickets.status')}
                <Select
                  value={ticket.statusDefinitionId}
                  disabled={statusMutation.isPending}
                  onValueChange={(value) => statusMutation.mutate(value)}
                >
                  <SelectTrigger aria-label={t(locale, 'workspaceTickets.status')}>
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
              </label>
            ) : null}

            <section className="space-y-2">
              <h2 className="text-lg font-semibold tracking-normal">
                {t(locale, 'workspaceTickets.description')}
              </h2>
              <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
                {ticket.description || t(locale, 'workspaceTickets.noDescription')}
              </p>
            </section>

            {canViewSla ? (
              <TicketSlaCard
                sla={slaQuery.data}
                isLoading={slaQuery.isLoading}
                isError={slaQuery.isError}
                onRetry={() => void slaQuery.refetch()}
              />
            ) : null}
          </>
        ) : null}

        {activeTab === 'attachments' && canViewAttachments ? (
          <TicketAttachmentsSection
            workspaceId={selectedWorkspaceId}
            ticketId={ticketId}
            canAdd={canAddAttachments}
            canRemove={canRemoveAttachments}
            onAccessLost={() => {
              queryClient.removeQueries({
                queryKey: ticketKeys.detail(selectedWorkspaceId, ticketId),
              });
              router.replace('/workspace/tickets' as Route);
            }}
          />
        ) : null}

        {activeTab === 'conversation' ? (
          <TicketConversationSection
            workspaceId={selectedWorkspaceId}
            ticketId={ticketId}
            canReply={canReply}
            canViewNotes={canViewNotes}
            canCreateNotes={canCreateNotes}
            canViewAttachments={canViewAttachments}
            canAddAttachments={canAddAttachments}
            onAccessLost={() => {
              queryClient.removeQueries({
                queryKey: ticketKeys.detail(selectedWorkspaceId, ticketId),
              });
              queryClient.removeQueries({
                queryKey: ticketKeys.conversationBase(selectedWorkspaceId, ticketId),
              });
              router.replace('/workspace/tickets' as Route);
            }}
          />
        ) : null}

        {activeTab === 'activity' && canViewActivity ? (
          <TicketActivitySection workspaceId={selectedWorkspaceId} ticketId={ticketId} />
        ) : null}
      </div>

      <TicketFormDialog
        open={editOpen}
        title={t(locale, 'workspaceTickets.editTicket')}
        ticket={ticket}
        statuses={statusesQuery.data ?? []}
        requesterUsers={[]}
        departments={[]}
        includeRequester={false}
        canAssign={false}
        submitLabel={t(locale, 'workspaceTickets.save')}
        isSubmitting={updateMutation.isPending}
        onOpenChange={setEditOpen}
        onSubmit={(body) => updateMutation.mutate(body)}
      />
      <RequesterDialog
        open={requesterOpen}
        ticket={ticket}
        requesterUsers={usersQuery.data?.items ?? []}
        isSubmitting={requesterMutation.isPending}
        onOpenChange={setRequesterOpen}
        onSubmit={(requester) => requesterMutation.mutate(requester)}
      />
      <AssignmentDialog
        open={assignmentOpen}
        ticket={ticket}
        departments={departmentsQuery.data?.items ?? []}
        isSubmitting={assignmentMutation.isPending}
        onOpenChange={setAssignmentOpen}
        onSubmit={(body) => assignmentMutation.mutate(body)}
      />
      <EscalationDialog
        open={Boolean(escalationAction)}
        action={escalationAction}
        currentLevel={ticket.escalationLevel}
        isSubmitting={escalationMutation.isPending}
        onOpenChange={(open) => {
          if (!open) setEscalationAction(null);
        }}
        onSubmit={(reason) => {
          if (!escalationAction) return;
          escalationMutation.mutate({ action: escalationAction, reason });
        }}
      />
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t(locale, 'workspaceTickets.deleteTicket')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t(locale, 'workspaceTickets.deleteConfirmation')}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              {t(locale, 'workspaceTickets.cancel')}
            </Button>
            <Button
              variant="danger"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              {t(locale, 'workspaceTickets.deleteTicket')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function TicketList({ tickets }: { tickets: WorkspaceTicketSummary[] }) {
  const { locale } = useLanguage();
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="hidden grid-cols-[110px_minmax(160px,1fr)_130px_130px_130px_110px_100px_110px_120px] gap-3 border-b bg-muted/40 px-4 py-3 text-sm font-medium text-muted-foreground xl:grid">
        <span>{t(locale, 'workspaceTickets.ticketNumber')}</span>
        <span>{t(locale, 'workspaceTickets.subject')}</span>
        <span>{t(locale, 'workspaceTickets.requester')}</span>
        <span>{t(locale, 'workspaceTickets.department')}</span>
        <span>{t(locale, 'workspaceTickets.assignedTo')}</span>
        <span>{t(locale, 'workspaceTickets.status')}</span>
        <span>{t(locale, 'workspaceTickets.priority')}</span>
        <span>{t(locale, 'workspaceTickets.escalation')}</span>
        <span>{t(locale, 'workspaceTickets.updated')}</span>
      </div>
      <div className="divide-y">
        {tickets.map((ticket) => (
          <Link
            key={ticket.id}
            href={`/workspace/tickets/${ticket.id}` as Route}
            className="grid gap-2 px-4 py-4 text-sm hover:bg-muted/40 xl:grid-cols-[110px_minmax(160px,1fr)_130px_130px_130px_110px_100px_110px_120px] xl:gap-3"
          >
            <span className="font-medium">{ticket.ticketNumber}</span>
            <span className="break-words">{ticket.subject}</span>
            <span>{requesterLabel(locale, ticket)}</span>
            <span>{ticket.department?.name ?? t(locale, 'workspaceTickets.notSet')}</span>
            <span>{assigneeLabel(locale, ticket)}</span>
            <span>{ticket.status.name}</span>
            <span>{priorityLabel(locale, ticket.priority)}</span>
            <span>{escalationLevelLabel(locale, ticket.escalationLevel)}</span>
            <span>{formatDate(ticket.updatedAt)}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function TicketFormDialog({
  open,
  title,
  ticket,
  statuses,
  requesterUsers,
  departments,
  includeRequester,
  canAssign,
  submitLabel,
  isSubmitting,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  title: string;
  ticket?: WorkspaceTicketSummary;
  statuses: Array<{ id: string; name: string }>;
  requesterUsers: WorkspaceUser[];
  departments: Department[];
  includeRequester: boolean;
  canAssign: boolean;
  submitLabel: string;
  isSubmitting: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (body: TicketPayload) => void;
}) {
  const { locale } = useLanguage();
  const selectedWorkspaceId = useSessionStore((state) => state.selectedWorkspaceId);
  const accessToken = useSessionStore((state) => state.accessToken);
  const [subject, setSubject] = useState(ticket?.subject ?? '');
  const [description, setDescription] = useState(ticket?.description ?? '');
  const [priority, setPriority] = useState<TicketPriority>(ticket?.priority ?? 'MEDIUM');
  const [statusDefinitionId, setStatusDefinitionId] = useState(ticket?.statusDefinitionId ?? '');
  const [requesterType, setRequesterType] = useState<'INTERNAL' | 'EXTERNAL'>('INTERNAL');
  const [requesterMembershipId, setRequesterMembershipId] = useState('');
  const [externalName, setExternalName] = useState('');
  const [externalEmail, setExternalEmail] = useState('');
  const [externalPhone, setExternalPhone] = useState('');
  const [departmentId, setDepartmentId] = useState(ticket?.departmentId ?? '');
  const [assignedToMembershipId, setAssignedToMembershipId] = useState(
    ticket?.assignedToMembershipId ?? '',
  );

  useEffect(() => {
    if (!open) return;
    setSubject(ticket?.subject ?? '');
    setDescription(ticket?.description ?? '');
    setPriority(ticket?.priority ?? 'MEDIUM');
    setStatusDefinitionId(ticket?.statusDefinitionId ?? '');
    setRequesterType('INTERNAL');
    setRequesterMembershipId(requesterUsers[0]?.membershipId ?? '');
    setExternalName('');
    setExternalEmail('');
    setExternalPhone('');
    setDepartmentId(ticket?.departmentId ?? '');
    setAssignedToMembershipId(ticket?.assignedToMembershipId ?? '');
  }, [open, ticket, requesterUsers]);

  const assigneeUsersQuery = useQuery({
    queryKey: ['workspace', selectedWorkspaceId, 'ticket-assignees', departmentId, 'ACTIVE'],
    queryFn: () =>
      listWorkspaceUsers({
        workspaceId: selectedWorkspaceId as string,
        page: 1,
        pageSize: 20,
        status: 'ACTIVE',
        departmentId,
      }),
    enabled: Boolean(accessToken && selectedWorkspaceId && open && canAssign && departmentId),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const body: TicketPayload = {
      subject,
      description: description.trim() ? description : null,
      priority,
    };
    if (statusDefinitionId) body.statusDefinitionId = statusDefinitionId;
    if (includeRequester) {
      body.requester =
        requesterType === 'INTERNAL'
          ? { type: 'INTERNAL', membershipId: requesterMembershipId }
          : {
              type: 'EXTERNAL',
              name: externalName,
              email: externalEmail || undefined,
              phone: externalPhone || undefined,
            };
    }
    if (canAssign) {
      body.departmentId = departmentId || null;
      body.assignedToMembershipId = assignedToMembershipId || null;
    }
    onSubmit(body);
  }

  const assigneeOptions = departmentId ? (assigneeUsersQuery.data?.items ?? []) : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <label className="block space-y-1 text-sm font-medium">
            {t(locale, 'workspaceTickets.subject')}
            <Input
              value={subject}
              maxLength={200}
              required
              onChange={(event) => setSubject(event.target.value)}
            />
          </label>
          <label className="block space-y-1 text-sm font-medium">
            {t(locale, 'workspaceTickets.description')}
            <textarea
              className="min-h-28 w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={description}
              maxLength={4000}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <label className="block space-y-1 text-sm font-medium">
            {t(locale, 'workspaceTickets.priority')}
            <Select
              value={priority}
              onValueChange={(value) => setPriority(value as TicketPriority)}
            >
              <SelectTrigger aria-label={t(locale, 'workspaceTickets.priority')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {priorities.map((item) => (
                  <SelectItem key={item} value={item}>
                    {priorityLabel(locale, item)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="block space-y-1 text-sm font-medium">
            {t(locale, 'workspaceTickets.status')}
            <Select
              value={statusDefinitionId || noneValue}
              onValueChange={(value) => setStatusDefinitionId(value === noneValue ? '' : value)}
            >
              <SelectTrigger aria-label={t(locale, 'workspaceTickets.status')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={noneValue}>
                  {t(locale, 'workspaceTickets.serverDefault')}
                </SelectItem>
                {statuses.map((status) => (
                  <SelectItem key={status.id} value={status.id}>
                    {status.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          {includeRequester ? (
            <RequesterFields
              requesterType={requesterType}
              requesterMembershipId={requesterMembershipId}
              externalName={externalName}
              externalEmail={externalEmail}
              externalPhone={externalPhone}
              users={requesterUsers}
              onRequesterTypeChange={(value) => {
                setRequesterType(value);
                setRequesterMembershipId(requesterUsers[0]?.membershipId ?? '');
                setExternalName('');
                setExternalEmail('');
                setExternalPhone('');
              }}
              onRequesterMembershipIdChange={setRequesterMembershipId}
              onExternalNameChange={setExternalName}
              onExternalEmailChange={setExternalEmail}
              onExternalPhoneChange={setExternalPhone}
            />
          ) : null}
          {canAssign ? (
            <AssignmentFields
              departmentId={departmentId}
              assignedToMembershipId={assignedToMembershipId}
              departments={departments}
              users={assigneeOptions}
              onDepartmentIdChange={(value) => {
                setDepartmentId(value);
                setAssignedToMembershipId('');
              }}
              onAssignedToMembershipIdChange={setAssignedToMembershipId}
            />
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t(locale, 'workspaceTickets.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RequesterFields({
  requesterType,
  requesterMembershipId,
  externalName,
  externalEmail,
  externalPhone,
  users,
  onRequesterTypeChange,
  onRequesterMembershipIdChange,
  onExternalNameChange,
  onExternalEmailChange,
  onExternalPhoneChange,
}: {
  requesterType: 'INTERNAL' | 'EXTERNAL';
  requesterMembershipId: string;
  externalName: string;
  externalEmail: string;
  externalPhone: string;
  users: WorkspaceUser[];
  onRequesterTypeChange: (value: 'INTERNAL' | 'EXTERNAL') => void;
  onRequesterMembershipIdChange: (value: string) => void;
  onExternalNameChange: (value: string) => void;
  onExternalEmailChange: (value: string) => void;
  onExternalPhoneChange: (value: string) => void;
}) {
  const { locale } = useLanguage();
  return (
    <div className="space-y-3">
      <label className="block space-y-1 text-sm font-medium">
        {t(locale, 'workspaceTickets.requesterType')}
        <Select
          value={requesterType}
          onValueChange={(value) => onRequesterTypeChange(value as 'INTERNAL' | 'EXTERNAL')}
        >
          <SelectTrigger aria-label={t(locale, 'workspaceTickets.requesterType')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="INTERNAL">
              {t(locale, 'workspaceTickets.internalRequester')}
            </SelectItem>
            <SelectItem value="EXTERNAL">
              {t(locale, 'workspaceTickets.externalRequester')}
            </SelectItem>
          </SelectContent>
        </Select>
      </label>
      {requesterType === 'INTERNAL' ? (
        <label className="block space-y-1 text-sm font-medium">
          {t(locale, 'workspaceTickets.requester')}
          <Select value={requesterMembershipId} onValueChange={onRequesterMembershipIdChange}>
            <SelectTrigger aria-label={t(locale, 'workspaceTickets.requester')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {users.map((user) => (
                <SelectItem key={user.membershipId} value={user.membershipId}>
                  {user.name ?? user.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block space-y-1 text-sm font-medium md:col-span-2">
            {t(locale, 'workspaceTickets.externalName')}
            <Input
              value={externalName}
              maxLength={160}
              required
              onChange={(event) => onExternalNameChange(event.target.value)}
            />
          </label>
          <label className="block space-y-1 text-sm font-medium">
            {t(locale, 'workspaceTickets.externalEmail')}
            <Input
              value={externalEmail}
              type="email"
              maxLength={320}
              onChange={(event) => onExternalEmailChange(event.target.value)}
            />
          </label>
          <label className="block space-y-1 text-sm font-medium">
            {t(locale, 'workspaceTickets.externalPhone')}
            <Input
              value={externalPhone}
              maxLength={40}
              onChange={(event) => onExternalPhoneChange(event.target.value)}
            />
          </label>
        </div>
      )}
    </div>
  );
}

function AssignmentFields({
  departmentId,
  assignedToMembershipId,
  departments,
  users,
  onDepartmentIdChange,
  onAssignedToMembershipIdChange,
}: {
  departmentId: string;
  assignedToMembershipId: string;
  departments: Department[];
  users: WorkspaceUser[];
  onDepartmentIdChange: (value: string) => void;
  onAssignedToMembershipIdChange: (value: string) => void;
}) {
  const { locale } = useLanguage();
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <label className="block space-y-1 text-sm font-medium">
        {t(locale, 'workspaceTickets.department')}
        <Select
          value={departmentId || noneValue}
          onValueChange={(value) => onDepartmentIdChange(value === noneValue ? '' : value)}
        >
          <SelectTrigger aria-label={t(locale, 'workspaceTickets.department')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={noneValue}>{t(locale, 'workspaceTickets.notSet')}</SelectItem>
            {departments.map((department) => (
              <SelectItem key={department.id} value={department.id}>
                {department.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className="block space-y-1 text-sm font-medium">
        {t(locale, 'workspaceTickets.assignedTo')}
        <Select
          value={assignedToMembershipId || noneValue}
          disabled={!departmentId}
          onValueChange={(value) =>
            onAssignedToMembershipIdChange(value === noneValue ? '' : value)
          }
        >
          <SelectTrigger aria-label={t(locale, 'workspaceTickets.assignedTo')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={noneValue}>{t(locale, 'workspaceTickets.unassigned')}</SelectItem>
            {users.map((user) => (
              <SelectItem key={user.membershipId} value={user.membershipId}>
                {user.name ?? user.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
    </div>
  );
}

function RequesterDialog({
  open,
  ticket,
  requesterUsers,
  isSubmitting,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  ticket: WorkspaceTicketSummary;
  requesterUsers: WorkspaceUser[];
  isSubmitting: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (requester: TicketRequesterPayload) => void;
}) {
  const { locale } = useLanguage();
  const [requesterType, setRequesterType] = useState<'INTERNAL' | 'EXTERNAL'>('INTERNAL');
  const [requesterMembershipId, setRequesterMembershipId] = useState('');
  const [externalName, setExternalName] = useState('');
  const [externalEmail, setExternalEmail] = useState('');
  const [externalPhone, setExternalPhone] = useState('');

  useEffect(() => {
    if (!open) return;
    const requester = ticket.requester;
    setRequesterType(requester?.type ?? 'INTERNAL');
    setRequesterMembershipId(
      requester?.internalMembershipId ?? requesterUsers[0]?.membershipId ?? '',
    );
    setExternalName(requester?.externalName ?? requester?.displayName ?? '');
    setExternalEmail(requester?.externalEmail ?? '');
    setExternalPhone(requester?.externalPhone ?? '');
  }, [open, ticket, requesterUsers]);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit(
      requesterType === 'INTERNAL'
        ? { type: 'INTERNAL', membershipId: requesterMembershipId }
        : {
            type: 'EXTERNAL',
            name: externalName,
            email: externalEmail || undefined,
            phone: externalPhone || undefined,
          },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(locale, 'workspaceTickets.changeRequester')}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <RequesterFields
            requesterType={requesterType}
            requesterMembershipId={requesterMembershipId}
            externalName={externalName}
            externalEmail={externalEmail}
            externalPhone={externalPhone}
            users={requesterUsers}
            onRequesterTypeChange={(value) => {
              setRequesterType(value);
              setRequesterMembershipId(requesterUsers[0]?.membershipId ?? '');
              setExternalName('');
              setExternalEmail('');
              setExternalPhone('');
            }}
            onRequesterMembershipIdChange={setRequesterMembershipId}
            onExternalNameChange={setExternalName}
            onExternalEmailChange={setExternalEmail}
            onExternalPhoneChange={setExternalPhone}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t(locale, 'workspaceTickets.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {t(locale, 'workspaceTickets.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AssignmentDialog({
  open,
  ticket,
  departments,
  isSubmitting,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  ticket: WorkspaceTicketSummary;
  departments: Department[];
  isSubmitting: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (body: { departmentId: string | null; assignedToMembershipId: string | null }) => void;
}) {
  const { locale } = useLanguage();
  const selectedWorkspaceId = useSessionStore((state) => state.selectedWorkspaceId);
  const accessToken = useSessionStore((state) => state.accessToken);
  const [departmentId, setDepartmentId] = useState(ticket.departmentId ?? '');
  const [assignedToMembershipId, setAssignedToMembershipId] = useState(
    ticket.assignedToMembershipId ?? '',
  );
  const assigneeUsersQuery = useQuery({
    queryKey: ['workspace', selectedWorkspaceId, 'ticket-assignees', departmentId, 'ACTIVE'],
    queryFn: () =>
      listWorkspaceUsers({
        workspaceId: selectedWorkspaceId as string,
        page: 1,
        pageSize: 20,
        status: 'ACTIVE',
        departmentId,
      }),
    enabled: Boolean(accessToken && selectedWorkspaceId && open && departmentId),
  });
  const assigneeOptions = departmentId ? (assigneeUsersQuery.data?.items ?? []) : [];

  useEffect(() => {
    if (!open) return;
    setDepartmentId(ticket.departmentId ?? '');
    setAssignedToMembershipId(ticket.assignedToMembershipId ?? '');
  }, [open, ticket]);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit({
      departmentId: departmentId || null,
      assignedToMembershipId: assignedToMembershipId || null,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(locale, 'workspaceTickets.assignment')}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <AssignmentFields
            departmentId={departmentId}
            assignedToMembershipId={assignedToMembershipId}
            departments={departments}
            users={assigneeOptions}
            onDepartmentIdChange={(value) => {
              setDepartmentId(value);
              setAssignedToMembershipId('');
            }}
            onAssignedToMembershipIdChange={setAssignedToMembershipId}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t(locale, 'workspaceTickets.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {t(locale, 'workspaceTickets.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EscalationDialog({
  open,
  action,
  currentLevel,
  isSubmitting,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  action: TicketEscalationAction | null;
  currentLevel: WorkspaceTicketSummary['escalationLevel'];
  isSubmitting: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (reason: string) => void;
}) {
  const { locale } = useLanguage();
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!open) setReason('');
  }, [open]);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit(reason);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(locale, 'workspaceTickets.escalation')}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="grid gap-2 text-sm text-muted-foreground">
            <span>
              {t(locale, 'workspaceTickets.currentEscalation')}:{' '}
              {escalationLevelLabel(locale, currentLevel)}
            </span>
            <span>
              {t(locale, 'workspaceTickets.action')}: {escalationActionLabel(locale, action)}
            </span>
          </div>
          <label className="block space-y-1 text-sm font-medium">
            {t(locale, 'workspaceTickets.escalationReason')}
            <Textarea
              value={reason}
              maxLength={500}
              required
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t(locale, 'workspaceTickets.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting || !reason.trim()}>
              {t(locale, 'workspaceTickets.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TicketSlaCard({
  sla,
  isLoading,
  isError,
  onRetry,
}: {
  sla: TicketSlaState | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  const { locale } = useLanguage();
  if (isLoading) return <TicketSkeleton />;
  if (isError) {
    return (
      <EmptyState
        title={t(locale, 'workspaceTickets.unableToLoadSla')}
        description={t(locale, 'states.pageLoadFailed')}
        action={
          <Button type="button" variant="secondary" onClick={onRetry}>
            {t(locale, 'common.tryAgain')}
          </Button>
        }
      />
    );
  }
  return (
    <section aria-label={t(locale, 'workspaceTickets.sla')} className="space-y-3">
      <div className="flex items-center gap-2">
        <Clock className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold tracking-normal">
          {t(locale, 'workspaceTickets.sla')}
        </h2>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <SlaMetricCard
          title={t(locale, 'workspaceTickets.firstResponse')}
          metric={sla?.firstResponse}
        />
        <SlaMetricCard title={t(locale, 'workspaceTickets.resolution')} metric={sla?.resolution} />
      </div>
      {sla?.configured ? (
        <p className="text-sm text-muted-foreground">
          {sla.policy?.name ?? t(locale, 'workspaceTickets.slaPolicy')} - {sla.timezone}
        </p>
      ) : null}
    </section>
  );
}

function SlaMetricCard({
  title,
  metric,
}: {
  title: string;
  metric?: TicketSlaState['firstResponse'];
}) {
  const { locale } = useLanguage();
  const state = metric?.state ?? 'NOT_CONFIGURED';
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className="mt-1 text-sm font-semibold">{slaStateLabel(locale, state)}</p>
      <div className="mt-3 grid gap-1 text-sm text-muted-foreground">
        <span>
          {t(locale, 'workspaceTickets.due')}:{' '}
          {metric?.dueAt ? formatDate(metric.dueAt) : t(locale, 'workspaceTickets.notSet')}
        </span>
        <span>
          {t(locale, 'workspaceTickets.remaining')}:{' '}
          {metric?.remainingMinutes ?? t(locale, 'workspaceTickets.notSet')}
        </span>
      </div>
    </div>
  );
}

function TicketAttachmentsSection({
  workspaceId,
  ticketId,
  canAdd,
  canRemove,
  onAccessLost,
}: {
  workspaceId: string | null;
  ticketId: string;
  canAdd: boolean;
  canRemove: boolean;
  onAccessLost: () => void;
}) {
  const { locale } = useLanguage();
  const queryClient = useQueryClient();
  const accessToken = useSessionStore((state) => state.accessToken);
  const [url, setUrl] = useState('');
  const [displayName, setDisplayName] = useState('');
  const attachmentsQuery = useQuery({
    queryKey: ticketKeys.attachments(workspaceId, ticketId, { page: 1, pageSize: 20 }),
    queryFn: () =>
      listWorkspaceTicketAttachments(workspaceId as string, ticketId, { page: 1, pageSize: 20 }),
    enabled: Boolean(accessToken && workspaceId && ticketId),
  });

  useEffect(() => {
    if (attachmentsQuery.error && (attachmentsQuery.error as { status?: number }).status === 404) {
      onAccessLost();
    }
  }, [attachmentsQuery.error, onAccessLost]);

  const addUrlMutation = useMutation({
    mutationFn: () =>
      addTicketUrlAttachment(workspaceId as string, ticketId, {
        url,
        displayName: displayName.trim() || undefined,
      }),
    onSuccess() {
      toast.success(t(locale, 'workspaceTickets.attachmentAdded'));
      setUrl('');
      setDisplayName('');
      void queryClient.invalidateQueries({
        queryKey: ticketKeys.attachmentsBase(workspaceId, ticketId),
      });
      void queryClient.invalidateQueries({
        queryKey: ticketKeys.activityBase(workspaceId, ticketId),
      });
    },
    onError() {
      toast.error(t(locale, 'workspaceTickets.unableToAddAttachment'));
    },
  });
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const initialized = await initTicketAttachmentUpload(workspaceId as string, ticketId, {
        filename: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
      });
      const upload = await fetch(initialized.uploadUrl, {
        method: 'PUT',
        body: file,
        headers: file.type ? { 'Content-Type': file.type } : undefined,
      });
      if (!upload.ok) throw new Error('UPLOAD_FAILED');
      return completeTicketAttachmentUpload(
        workspaceId as string,
        ticketId,
        initialized.attachment.id,
        { sizeBytes: file.size },
      );
    },
    onSuccess() {
      toast.success(t(locale, 'workspaceTickets.attachmentAdded'));
      void queryClient.invalidateQueries({
        queryKey: ticketKeys.attachmentsBase(workspaceId, ticketId),
      });
      void queryClient.invalidateQueries({
        queryKey: ticketKeys.activityBase(workspaceId, ticketId),
      });
    },
    onError() {
      toast.error(t(locale, 'workspaceTickets.unableToAddAttachment'));
    },
  });
  const removeMutation = useMutation({
    mutationFn: (attachmentId: string) =>
      removeTicketAttachment(workspaceId as string, ticketId, attachmentId),
    onSuccess() {
      toast.success(t(locale, 'workspaceTickets.attachmentRemoved'));
      void queryClient.invalidateQueries({
        queryKey: ticketKeys.attachmentsBase(workspaceId, ticketId),
      });
      void queryClient.invalidateQueries({
        queryKey: ticketKeys.activityBase(workspaceId, ticketId),
      });
    },
    onError() {
      toast.error(t(locale, 'workspaceTickets.unableToRemoveAttachment'));
    },
  });

  return (
    <section className="space-y-4" aria-label={t(locale, 'workspaceTickets.attachments')}>
      <div className="flex items-center gap-2">
        <Paperclip className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold tracking-normal">
          {t(locale, 'workspaceTickets.attachments')}
        </h2>
      </div>
      {attachmentsQuery.isLoading ? <Skeleton className="h-16 w-full" /> : null}
      {attachmentsQuery.isError ? (
        <EmptyState title={t(locale, 'workspaceTickets.attachmentsLoadFailed')} />
      ) : null}
      {!attachmentsQuery.isLoading && !attachmentsQuery.isError ? (
        <div className="space-y-2">
          {(attachmentsQuery.data?.items ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t(locale, 'workspaceTickets.noAttachments')}
            </p>
          ) : null}
          {(attachmentsQuery.data?.items ?? []).map((attachment) => (
            <TicketAttachmentRow
              key={attachment.id}
              workspaceId={workspaceId}
              ticketId={ticketId}
              attachment={attachment}
              canRemove={canRemove}
              onRemove={(id) => removeMutation.mutate(id)}
            />
          ))}
        </div>
      ) : null}
      {canAdd ? (
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <Input
            value={url}
            placeholder={t(locale, 'workspaceTickets.attachmentUrl')}
            onChange={(event) => setUrl(event.target.value)}
          />
          <Input
            value={displayName}
            placeholder={t(locale, 'workspaceTickets.attachmentDisplayName')}
            onChange={(event) => setDisplayName(event.target.value)}
          />
          <Button
            type="button"
            disabled={!url.trim() || addUrlMutation.isPending}
            onClick={() => addUrlMutation.mutate()}
          >
            <LinkIcon className="mr-2 h-4 w-4" />
            {t(locale, 'workspaceTickets.addLink')}
          </Button>
          <label className="inline-flex items-center justify-center rounded-md border px-3 py-2 text-sm font-medium">
            <Upload className="mr-2 h-4 w-4" />
            {t(locale, 'workspaceTickets.uploadFile')}
            <input
              className="sr-only"
              type="file"
              disabled={uploadMutation.isPending}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.currentTarget.value = '';
                if (file) uploadMutation.mutate(file);
              }}
            />
          </label>
        </div>
      ) : null}
    </section>
  );
}

function TicketAttachmentRow({
  workspaceId,
  ticketId,
  attachment,
  canRemove,
  onRemove,
}: {
  workspaceId: string | null;
  ticketId: string;
  attachment: TicketAttachmentSummary;
  canRemove: boolean;
  onRemove: (attachmentId: string) => void;
}) {
  const { locale } = useLanguage();
  const downloadMutation = useMutation({
    mutationFn: () => downloadTicketAttachment(workspaceId as string, ticketId, attachment.id),
    onSuccess(result) {
      window.open(result.downloadUrl, '_blank', 'noopener,noreferrer');
    },
    onError() {
      toast.error(t(locale, 'workspaceTickets.unableToDownloadAttachment'));
    },
  });
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{attachment.displayName}</p>
        <p className="text-xs text-muted-foreground">
          {attachment.type === 'FILE'
            ? `${attachment.file?.mimeType ?? 'file'} - ${formatBytes(attachment.file?.sizeBytes ?? 0)}`
            : t(locale, 'workspaceTickets.linkAttachment')}
        </p>
      </div>
      <div className="flex gap-2">
        {attachment.type === 'URL' && attachment.url ? (
          <Button
            type="button"
            variant="outline"
            aria-label={t(locale, 'workspaceTickets.openLink')}
            onClick={() => window.open(attachment.url ?? '', '_blank', 'noopener,noreferrer')}
          >
            <LinkIcon className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            aria-label={t(locale, 'workspaceTickets.download')}
            disabled={downloadMutation.isPending || attachment.file?.status !== 'READY'}
            onClick={() => downloadMutation.mutate()}
          >
            <Download className="h-4 w-4" />
          </Button>
        )}
        {canRemove ? (
          <Button
            type="button"
            variant="outline"
            aria-label={t(locale, 'workspaceTickets.removeFromTicket')}
            onClick={() => onRemove(attachment.id)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function TicketActivitySection({
  workspaceId,
  ticketId,
}: {
  workspaceId: string | null;
  ticketId: string;
}) {
  const { locale } = useLanguage();
  const accessToken = useSessionStore((state) => state.accessToken);
  const activityQuery = useQuery({
    queryKey: ticketKeys.activity(workspaceId, ticketId, { page: 1, pageSize: 20 }),
    queryFn: () =>
      getWorkspaceTicketActivity(workspaceId as string, ticketId, { page: 1, pageSize: 20 }),
    enabled: Boolean(accessToken && workspaceId && ticketId),
  });
  return (
    <section className="space-y-3" aria-label={t(locale, 'workspaceTickets.activity')}>
      <div className="flex items-center gap-2">
        <Clock className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold tracking-normal">
          {t(locale, 'workspaceTickets.activity')}
        </h2>
      </div>
      {activityQuery.isLoading ? <Skeleton className="h-16 w-full" /> : null}
      {activityQuery.isError ? (
        <EmptyState title={t(locale, 'workspaceTickets.activityLoadFailed')} />
      ) : (
        <div className="space-y-2">
          {(activityQuery.data?.items ?? []).map((item) => (
            <div key={item.id} className="rounded-md border p-3 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-medium">{activityLabel(locale, item.action)}</span>
                <span className="text-muted-foreground">{formatDate(item.createdAt)}</span>
              </div>
              <p className="text-muted-foreground">
                {item.actor?.displayName ?? t(locale, 'workspaceTickets.systemActor')}
              </p>
            </div>
          ))}
          {!activityQuery.isLoading && (activityQuery.data?.items.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t(locale, 'workspaceTickets.noActivity')}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

function TicketConversationSection({
  workspaceId,
  ticketId,
  canReply,
  canViewNotes,
  canCreateNotes,
  canViewAttachments,
  canAddAttachments,
  onAccessLost,
}: {
  workspaceId: string | null;
  ticketId: string;
  canReply: boolean;
  canViewNotes: boolean;
  canCreateNotes: boolean;
  canViewAttachments: boolean;
  canAddAttachments: boolean;
  onAccessLost: () => void;
}) {
  const { locale } = useLanguage();
  const queryClient = useQueryClient();
  const accessToken = useSessionStore((state) => state.accessToken);
  const [pageSize, setPageSize] = useState(20);
  const [entryType, setEntryType] = useState<TicketConversationEntryType>(
    canReply ? 'PUBLIC_REPLY' : 'INTERNAL_NOTE',
  );
  const [body, setBody] = useState('');
  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<string[]>([]);
  const canPostSelected = entryType === 'PUBLIC_REPLY' ? canReply : canCreateNotes;
  const canPostAny = canReply || canCreateNotes;

  useEffect(() => {
    setPageSize(20);
    setBody('');
    setSelectedAttachmentIds([]);
    setEntryType(canReply ? 'PUBLIC_REPLY' : 'INTERNAL_NOTE');
  }, [canReply, ticketId, workspaceId]);

  useEffect(() => {
    if (entryType === 'PUBLIC_REPLY' && !canReply && canCreateNotes) setEntryType('INTERNAL_NOTE');
    if (entryType === 'INTERNAL_NOTE' && !canCreateNotes && canReply) setEntryType('PUBLIC_REPLY');
  }, [canCreateNotes, canReply, entryType]);

  const conversationQuery = useQuery({
    queryKey: ticketKeys.conversation(workspaceId, ticketId, {
      page: 1,
      pageSize,
      notesView: canViewNotes,
    }),
    queryFn: () =>
      listWorkspaceTicketConversation(workspaceId as string, ticketId, { page: 1, pageSize }),
    enabled: Boolean(accessToken && workspaceId && ticketId),
  });
  const attachmentsQuery = useQuery({
    queryKey: ticketKeys.attachments(workspaceId, ticketId, { page: 1, pageSize: 20 }),
    queryFn: () =>
      listWorkspaceTicketAttachments(workspaceId as string, ticketId, { page: 1, pageSize: 20 }),
    enabled: Boolean(accessToken && workspaceId && ticketId && canViewAttachments && canPostAny),
  });

  useEffect(() => {
    if (
      conversationQuery.error &&
      (conversationQuery.error as { status?: number }).status === 404
    ) {
      onAccessLost();
    }
  }, [conversationQuery.error, onAccessLost]);

  const createMutation = useMutation({
    mutationFn: () =>
      createWorkspaceTicketConversationEntry(workspaceId as string, ticketId, {
        type: entryType,
        body,
        attachmentIds: selectedAttachmentIds.length > 0 ? selectedAttachmentIds : undefined,
      }),
    onSuccess() {
      toast.success(
        entryType === 'PUBLIC_REPLY'
          ? t(locale, 'workspaceTickets.replyPosted')
          : t(locale, 'workspaceTickets.notePosted'),
      );
      setBody('');
      setSelectedAttachmentIds([]);
      void queryClient.invalidateQueries({
        queryKey: ticketKeys.conversationBase(workspaceId, ticketId),
      });
    },
    onError(error: { status?: number }) {
      toast.error(
        entryType === 'PUBLIC_REPLY'
          ? t(locale, 'workspaceTickets.unableToPostReply')
          : t(locale, 'workspaceTickets.unableToAddInternalNote'),
      );
      if (error.status === 404) onAccessLost();
    },
  });

  const entries = (conversationQuery.data?.items ?? []).filter(
    (entry) => canViewNotes || entry.type !== 'INTERNAL_NOTE',
  );
  const total = conversationQuery.data?.total ?? 0;
  const canLoadOlder = entries.length < total && pageSize < 50;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!canPostSelected || !body.trim() || createMutation.isPending) return;
    createMutation.mutate();
  }

  function toggleComposerAttachment(attachmentId: string) {
    setSelectedAttachmentIds((current) =>
      current.includes(attachmentId)
        ? current.filter((id) => id !== attachmentId)
        : [...current, attachmentId].slice(0, 10),
    );
  }

  return (
    <section aria-label={t(locale, 'workspaceTickets.conversation')} className="space-y-4">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold tracking-normal">
          {t(locale, 'workspaceTickets.conversation')}
        </h2>
      </div>

      {conversationQuery.isLoading ? <TicketSkeleton /> : null}
      {conversationQuery.isError ? (
        <EmptyState
          title={t(locale, 'workspaceTickets.unableToLoadConversation')}
          description={t(locale, 'states.pageLoadFailed')}
          action={
            <Button
              type="button"
              variant="secondary"
              onClick={() => void conversationQuery.refetch()}
            >
              {t(locale, 'common.tryAgain')}
            </Button>
          }
        />
      ) : null}
      {!conversationQuery.isLoading && !conversationQuery.isError && entries.length === 0 ? (
        <EmptyState title={t(locale, 'workspaceTickets.noConversationYet')} />
      ) : null}
      {entries.length > 0 ? (
        <div className="space-y-3">
          {canLoadOlder ? (
            <Button
              type="button"
              variant="outline"
              disabled={conversationQuery.isFetching}
              onClick={() => setPageSize((value) => Math.min(50, value + 20))}
            >
              {t(locale, 'workspaceTickets.loadOlder')}
            </Button>
          ) : null}
          {entries.map((entry) => (
            <ConversationEntryItem key={entry.id} entry={entry} />
          ))}
        </div>
      ) : null}

      {canPostAny ? (
        <form className="space-y-3" onSubmit={submit}>
          <label className="block max-w-xs space-y-1 text-sm font-medium">
            {t(locale, 'workspaceTickets.entryType')}
            <Select
              value={entryType}
              onValueChange={(value) => setEntryType(value as TicketConversationEntryType)}
            >
              <SelectTrigger aria-label={t(locale, 'workspaceTickets.entryType')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {canReply ? (
                  <SelectItem value="PUBLIC_REPLY">
                    {t(locale, 'workspaceTickets.publicReply')}
                  </SelectItem>
                ) : null}
                {canCreateNotes ? (
                  <SelectItem value="INTERNAL_NOTE">
                    {t(locale, 'workspaceTickets.internalNote')}
                  </SelectItem>
                ) : null}
              </SelectContent>
            </Select>
          </label>
          <label className="block space-y-1 text-sm font-medium">
            {entryType === 'PUBLIC_REPLY'
              ? t(locale, 'workspaceTickets.publicReply')
              : t(locale, 'workspaceTickets.internalNote')}
            <textarea
              className="min-h-32 w-full rounded-md border bg-background px-3 py-2 text-sm"
              maxLength={12000}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </label>
          {canAddAttachments &&
          canViewAttachments &&
          (attachmentsQuery.data?.items.length ?? 0) > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">{t(locale, 'workspaceTickets.attachments')}</p>
              <div className="flex flex-wrap gap-2">
                {(attachmentsQuery.data?.items ?? []).map((attachment) => (
                  <label
                    key={attachment.id}
                    className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={selectedAttachmentIds.includes(attachment.id)}
                      onChange={() => toggleComposerAttachment(attachment.id)}
                    />
                    <span className="max-w-48 truncate">{attachment.displayName}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}
          <Button
            type="submit"
            disabled={!body.trim() || !canPostSelected || createMutation.isPending}
          >
            {entryType === 'PUBLIC_REPLY'
              ? t(locale, 'workspaceTickets.postReply')
              : t(locale, 'workspaceTickets.postNote')}
          </Button>
        </form>
      ) : null}
    </section>
  );
}

function ConversationEntryItem({ entry }: { entry: TicketConversationEntry }) {
  const { locale } = useLanguage();
  const isInternal = entry.type === 'INTERNAL_NOTE';
  return (
    <article
      className={[
        'rounded-lg border p-4',
        isInternal
          ? 'border-amber-300 bg-amber-50 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100'
          : 'bg-card',
      ].join(' ')}
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">
          {isInternal
            ? t(locale, 'workspaceTickets.internalNote')
            : t(locale, 'workspaceTickets.publicReply')}
        </span>
        <span className="text-muted-foreground">
          {t(locale, 'workspaceTickets.author')}: {entry.author.displayName}
          {entry.author.inactive ? ` (${t(locale, 'workspaceTickets.inactive')})` : ''}
        </span>
        <span className="text-muted-foreground">
          {t(locale, 'workspaceTickets.posted')}: {formatDate(entry.createdAt)}
        </span>
      </div>
      <p className="mt-3 whitespace-pre-wrap break-words text-sm">{entry.body}</p>
      {(entry.attachments ?? []).length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {(entry.attachments ?? []).map((attachment) => (
            <ConversationAttachmentChip
              key={attachment.id}
              ticketId={entry.ticketId}
              entryId={entry.id}
              attachment={attachment}
            />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function ConversationAttachmentChip({
  ticketId,
  entryId,
  attachment,
}: {
  ticketId: string;
  entryId: string;
  attachment: TicketAttachmentSummary;
}) {
  const { locale } = useLanguage();
  const selectedWorkspaceId = useSessionStore((state) => state.selectedWorkspaceId);
  const downloadMutation = useMutation({
    mutationFn: () =>
      downloadTicketConversationAttachment(
        selectedWorkspaceId as string,
        ticketId,
        entryId,
        attachment.id,
      ),
    onSuccess(result) {
      window.open(result.downloadUrl, '_blank', 'noopener,noreferrer');
    },
    onError() {
      toast.error(t(locale, 'workspaceTickets.unableToDownloadAttachment'));
    },
  });
  if (attachment.type === 'URL' && attachment.url) {
    return (
      <Button
        type="button"
        variant="outline"
        aria-label={t(locale, 'workspaceTickets.openLink')}
        onClick={() => window.open(attachment.url ?? '', '_blank', 'noopener,noreferrer')}
      >
        <LinkIcon className="mr-2 h-4 w-4" />
        {attachment.displayName}
      </Button>
    );
  }
  return (
    <Button
      type="button"
      variant="outline"
      aria-label={t(locale, 'workspaceTickets.download')}
      disabled={downloadMutation.isPending || attachment.file?.status !== 'READY'}
      onClick={() => downloadMutation.mutate()}
    >
      <Paperclip className="mr-2 h-4 w-4" />
      {attachment.displayName}
    </Button>
  );
}

function TicketSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  );
}

function TicketSelectFilter({
  label,
  value,
  options,
  includeAll = true,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  includeAll?: boolean;
  onChange: (value: string) => void;
}) {
  const { locale } = useLanguage();
  return (
    <label className="space-y-1 text-sm font-medium">
      {label}
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {includeAll ? (
            <SelectItem value={noneValue}>{t(locale, 'workspaceTickets.any')}</SelectItem>
          ) : null}
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function ticketFiltersFromParams(
  params: ReturnType<typeof normalizeTicketListParams>,
): Partial<ListWorkspaceTicketsParams> {
  const filters: Partial<ListWorkspaceTicketsParams> = {};
  const keys = [
    'queue',
    'search',
    'statusDefinitionId',
    'priority',
    'requesterType',
    'internalRequesterMembershipId',
    'departmentId',
    'assignedToMembershipId',
    'assignmentState',
    'createdFrom',
    'createdTo',
    'updatedFrom',
    'updatedTo',
    'slaMetric',
    'slaState',
    'slaDueFrom',
    'slaDueTo',
  ] as const;
  for (const key of keys) {
    const value = params[key];
    if (value) {
      Object.assign(filters, { [key]: value });
    }
  }
  return filters;
}

function applySavedView(
  view: TicketSavedView,
  updateListState: (next: Partial<Record<string, string | null>>) => void,
) {
  const next: Partial<Record<string, string | null>> = {
    viewId: view.id,
    search: null,
    statusDefinitionId: null,
    priority: null,
    queue: null,
    requesterType: null,
    internalRequesterMembershipId: null,
    departmentId: null,
    assignedToMembershipId: null,
    assignmentState: null,
    createdFrom: null,
    createdTo: null,
    updatedFrom: null,
    updatedTo: null,
    slaMetric: null,
    slaState: null,
    slaDueFrom: null,
    slaDueTo: null,
    sortBy: view.sort.sortBy,
    sortDirection: view.sort.sortDirection,
  };
  for (const [key, value] of Object.entries(view.filters)) {
    if (value) next[key] = String(value);
  }
  updateListState(next);
}

function safeQueue(value: string | null): TicketBuiltInQueue | undefined {
  return builtInQueues.includes(value as TicketBuiltInQueue)
    ? (value as TicketBuiltInQueue)
    : undefined;
}

function safePriority(value: string | null): TicketPriority | undefined {
  return priorities.includes(value as TicketPriority) ? (value as TicketPriority) : undefined;
}

function safeRequesterType(value: string | null): TicketRequesterTypeFilter | undefined {
  return requesterTypes.includes(value as TicketRequesterTypeFilter)
    ? (value as TicketRequesterTypeFilter)
    : undefined;
}

function safeAssignmentState(value: string | null): TicketAssignmentState | undefined {
  return assignmentStates.includes(value as TicketAssignmentState)
    ? (value as TicketAssignmentState)
    : undefined;
}

function safeSlaMetric(value: string | null): TicketSlaMetricFilter | undefined {
  return slaMetrics.includes(value as TicketSlaMetricFilter)
    ? (value as TicketSlaMetricFilter)
    : undefined;
}

function safeSlaState(value: string | null): TicketSlaState['firstResponse']['state'] | undefined {
  return slaStates.includes(value as TicketSlaState['firstResponse']['state'])
    ? (value as TicketSlaState['firstResponse']['state'])
    : undefined;
}

function safeSortBy(value: string | null) {
  return ['createdAt', 'updatedAt', 'ticketNumber', 'priority'].includes(value ?? '')
    ? (value as 'createdAt' | 'updatedAt' | 'ticketNumber' | 'priority')
    : undefined;
}

function safeSortDirection(value: string | null) {
  return value === 'asc' || value === 'desc' ? value : undefined;
}

function hasActiveTicketFilters(params: ReturnType<typeof normalizeTicketListParams>) {
  return Object.keys(ticketFiltersFromParams(params)).some((key) => key !== 'queue');
}

function ticketFilterChips(
  params: ReturnType<typeof normalizeTicketListParams>,
  locale: 'en' | 'ta',
  statuses: Array<{ id: string; name: string }>,
  users: WorkspaceUser[],
  departments: Department[],
) {
  const chips: Array<{ key: keyof ListWorkspaceTicketsParams; label: string }> = [];
  const statusLabel = (id: string) =>
    statuses.find((status) => status.id === id)?.name ?? t(locale, 'workspaceTickets.status');
  const userLabel = (id: string) => {
    const user = users.find((item) => item.id === id);
    return user ? (user.name ?? user.email) : t(locale, 'workspaceTickets.requester');
  };
  const departmentLabel = (id: string) =>
    departments.find((department) => department.id === id)?.name ??
    t(locale, 'workspaceTickets.department');

  if (params.search) {
    chips.push({
      key: 'search',
      label: `${t(locale, 'workspaceTickets.searchTickets')}: ${params.search}`,
    });
  }
  if (params.statusDefinitionId) {
    chips.push({
      key: 'statusDefinitionId',
      label: `${t(locale, 'workspaceTickets.status')}: ${statusLabel(params.statusDefinitionId)}`,
    });
  }
  if (params.priority) {
    chips.push({
      key: 'priority',
      label: `${t(locale, 'workspaceTickets.priority')}: ${priorityLabel(locale, params.priority)}`,
    });
  }
  if (params.requesterType) {
    chips.push({
      key: 'requesterType',
      label: `${t(locale, 'workspaceTickets.requesterType')}: ${requesterTypeLabel(
        locale,
        params.requesterType,
      )}`,
    });
  }
  if (params.internalRequesterMembershipId) {
    chips.push({
      key: 'internalRequesterMembershipId',
      label: `${t(locale, 'workspaceTickets.internalRequester')}: ${userLabel(
        params.internalRequesterMembershipId,
      )}`,
    });
  }
  if (params.departmentId) {
    chips.push({
      key: 'departmentId',
      label: `${t(locale, 'workspaceTickets.department')}: ${departmentLabel(params.departmentId)}`,
    });
  }
  if (params.assignedToMembershipId) {
    chips.push({
      key: 'assignedToMembershipId',
      label: `${t(locale, 'workspaceTickets.assignedTo')}: ${userLabel(
        params.assignedToMembershipId,
      )}`,
    });
  }
  if (params.assignmentState) {
    chips.push({
      key: 'assignmentState',
      label: `${t(locale, 'workspaceTickets.assignmentState')}: ${assignmentStateLabel(
        locale,
        params.assignmentState,
      )}`,
    });
  }
  for (const key of [
    'createdFrom',
    'createdTo',
    'updatedFrom',
    'updatedTo',
    'slaDueFrom',
    'slaDueTo',
  ] as const) {
    if (params[key]) chips.push({ key, label: `${dateFilterLabel(locale, key)}: ${params[key]}` });
  }
  if (params.slaMetric) {
    chips.push({
      key: 'slaMetric',
      label: `${t(locale, 'workspaceTickets.slaMetric')}: ${slaMetricLabel(
        locale,
        params.slaMetric,
      )}`,
    });
  }
  if (params.slaState) {
    chips.push({
      key: 'slaState',
      label: `${t(locale, 'workspaceTickets.slaState')}: ${slaStateLabel(locale, params.slaState)}`,
    });
  }
  return chips;
}

function TicketField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-sm font-medium">{value}</p>
    </div>
  );
}

function useWorkspacePermissions(
  agencies: ReturnType<typeof useSessionStore.getState>['agencies'],
  workspaceId: string | null,
  roles: Array<{ id: string; key?: string; permissions: Array<{ key: string }> }>,
) {
  return useMemo(() => {
    const workspace = agencies
      .flatMap((agency) => agency.workspaces)
      .find((item) => item.id === workspaceId);
    const role = roles.find((item) => item.id === workspace?.role || item.key === workspace?.role);
    return new Set(role?.permissions.map((permission) => permission.key) ?? []);
  }, [agencies, roles, workspaceId]);
}

function hasPermission(permissions: Set<string>, permission: string) {
  return permissions.has('*') || permissions.has(permission);
}

function priorityLabel(locale: 'en' | 'ta', priority: TicketPriority) {
  return t(
    locale,
    `workspaceTickets.priority${priority[0]}${priority.slice(1).toLowerCase()}` as const,
  );
}

function queueLabel(locale: 'en' | 'ta', queue: TicketBuiltInQueue) {
  const labels = {
    ALL_VISIBLE: t(locale, 'workspaceTickets.allTickets'),
    MY_ASSIGNED: t(locale, 'workspaceTickets.myAssigned'),
    MY_REQUESTED: t(locale, 'workspaceTickets.myRequested'),
    MY_DEPARTMENT: t(locale, 'workspaceTickets.myDepartment'),
    UNASSIGNED_MY_DEPARTMENT: t(locale, 'workspaceTickets.unassignedMyDepartment'),
    SLA_BREACHED: t(locale, 'workspaceTickets.slaBreached'),
  };
  return labels[queue];
}

function requesterTypeLabel(locale: 'en' | 'ta', value: TicketRequesterTypeFilter) {
  if (value === 'INTERNAL') return t(locale, 'workspaceTickets.internalRequester');
  if (value === 'EXTERNAL') return t(locale, 'workspaceTickets.externalRequester');
  return t(locale, 'workspaceTickets.requesterNotSet');
}

function assignmentStateLabel(locale: 'en' | 'ta', value: TicketAssignmentState) {
  if (value === 'ASSIGNED') return t(locale, 'workspaceTickets.assigned');
  if (value === 'UNASSIGNED') return t(locale, 'workspaceTickets.unassigned');
  return t(locale, 'workspaceTickets.any');
}

function slaMetricLabel(locale: 'en' | 'ta', value: TicketSlaMetricFilter) {
  if (value === 'FIRST_RESPONSE') return t(locale, 'workspaceTickets.firstResponse');
  if (value === 'RESOLUTION') return t(locale, 'workspaceTickets.resolution');
  return t(locale, 'workspaceTickets.any');
}

function sortLabel(locale: 'en' | 'ta', value: string) {
  const labels: Record<string, string> = {
    createdAt: t(locale, 'workspaceTickets.created'),
    updatedAt: t(locale, 'workspaceTickets.updated'),
    ticketNumber: t(locale, 'workspaceTickets.ticketNumber'),
    priority: t(locale, 'workspaceTickets.priority'),
  };
  return labels[value] ?? value;
}

function dateFilterLabel(locale: 'en' | 'ta', value: string) {
  const labels: Record<string, string> = {
    createdFrom: t(locale, 'workspaceTickets.createdFrom'),
    createdTo: t(locale, 'workspaceTickets.createdTo'),
    updatedFrom: t(locale, 'workspaceTickets.updatedFrom'),
    updatedTo: t(locale, 'workspaceTickets.updatedTo'),
    slaDueFrom: t(locale, 'workspaceTickets.slaDueFrom'),
    slaDueTo: t(locale, 'workspaceTickets.slaDueTo'),
  };
  return labels[value] ?? value;
}

function requesterLabel(locale: 'en' | 'ta', ticket: WorkspaceTicketSummary) {
  if (!ticket.requester) return t(locale, 'workspaceTickets.requesterNotSet');
  const label = ticket.requester.displayName ?? t(locale, 'workspaceTickets.requesterNotSet');
  if (
    ticket.requester.type === 'INTERNAL' &&
    ticket.requester.internalMembership?.status &&
    ticket.requester.internalMembership.status !== 'ACTIVE'
  ) {
    return `${label} (${t(locale, 'workspaceTickets.inactive')})`;
  }
  return label;
}

function assigneeLabel(locale: 'en' | 'ta', ticket: WorkspaceTicketSummary) {
  if (!ticket.assignedTo) return t(locale, 'workspaceTickets.unassigned');
  const label = ticket.assignedTo.user.name ?? ticket.assignedTo.user.email;
  if (ticket.assignedTo.status !== 'ACTIVE') {
    return `${label} (${t(locale, 'workspaceTickets.inactive')})`;
  }
  return label;
}

function safeTicketDetailTab(value: string | null): TicketDetailTab {
  return ticketDetailTabs.includes(value as TicketDetailTab)
    ? (value as TicketDetailTab)
    : 'overview';
}

function ticketDetailTabLabel(locale: 'en' | 'ta', tab: TicketDetailTab) {
  const labels = {
    overview: t(locale, 'workspaceTickets.overview'),
    conversation: t(locale, 'workspaceTickets.conversation'),
    attachments: t(locale, 'workspaceTickets.attachments'),
    activity: t(locale, 'workspaceTickets.activity'),
  };
  return labels[tab];
}

function ticketDetailTabId(tab: TicketDetailTab) {
  return `ticket-detail-tab-${tab}`;
}

function ticketDetailPanelId(tab: TicketDetailTab) {
  return `ticket-detail-panel-${tab}`;
}

function escalationLevelLabel(
  locale: 'en' | 'ta',
  level: WorkspaceTicketSummary['escalationLevel'],
) {
  const labels = {
    NONE: t(locale, 'workspaceTickets.escalationNone'),
    LEVEL_1: t(locale, 'workspaceTickets.escalationLevel1'),
    LEVEL_2: t(locale, 'workspaceTickets.escalationLevel2'),
    LEVEL_3: t(locale, 'workspaceTickets.escalationLevel3'),
  };
  return labels[level];
}

function escalationActionLabel(locale: 'en' | 'ta', action: TicketEscalationAction | null) {
  if (action === 'ESCALATE') return t(locale, 'workspaceTickets.escalate');
  if (action === 'DEESCALATE') return t(locale, 'workspaceTickets.deescalate');
  if (action === 'CLEAR') return t(locale, 'workspaceTickets.clearEscalation');
  return t(locale, 'workspaceTickets.notSet');
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function activityLabel(locale: 'en' | 'ta', action: string) {
  const labels: Record<string, string> = {
    'ticket.created': t(locale, 'workspaceTickets.activityCreated'),
    'ticket.updated': t(locale, 'workspaceTickets.activityUpdated'),
    'ticket.deleted': t(locale, 'workspaceTickets.activityDeleted'),
    'ticket.public_reply_added': t(locale, 'workspaceTickets.activityReplyAdded'),
    'ticket.internal_note_added': t(locale, 'workspaceTickets.activityNoteAdded'),
    'ticket.attachment_file_uploaded': t(locale, 'workspaceTickets.activityFileUploaded'),
    'ticket.attachment_url_added': t(locale, 'workspaceTickets.activityLinkAdded'),
    'ticket.attachments_linked': t(locale, 'workspaceTickets.activityFilesLinked'),
    'ticket.attachment_download_authorized': t(locale, 'workspaceTickets.activityFileDownloaded'),
    'ticket.attachment_removed': t(locale, 'workspaceTickets.activityFileRemoved'),
    'ticket.escalation_changed': t(locale, 'workspaceTickets.activityEscalationChanged'),
  };
  return labels[action] ?? t(locale, 'workspaceTickets.activityUpdated');
}

function slaStateLabel(locale: 'en' | 'ta', state: TicketSlaState['firstResponse']['state']) {
  const key = `workspaceTickets.slaState${state
    .toLowerCase()
    .replace(/(^|_)([a-z])/g, (_, __, char: string) => char.toUpperCase())}` as const;
  return t(locale, key);
}
