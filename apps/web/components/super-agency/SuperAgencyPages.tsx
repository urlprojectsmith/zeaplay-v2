'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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
  StatusIndicator,
} from '@zea-play/ui';
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  MailPlus,
  Plus,
  RefreshCw,
  ShieldCheck,
  UserRoundMinus,
  UserRoundPlus,
} from 'lucide-react';
import Link from 'next/link';
import type { Route } from 'next';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ApiClientError } from '@zea-play/api-client';
import { useLanguage } from '../../contexts/language-provider';
import {
  createSuperAgencyAgency,
  createSuperAgencyInvitation,
  getSuperAgencyAgency,
  getSuperAgencyContext,
  listSuperAgencyAgencies,
  listSuperAgencyAgencyWorkspaces,
  listSuperAgencyInvitations,
  listSuperAgencyMembers,
  listSuperAgencyRoles,
  revokeSuperAgencyInvitation,
  superAgencyKeys,
  updateSuperAgencyAgency,
  type AgencyStatus,
  updateSuperAgencyMembership,
  type MembershipStatus,
  type SuperAgencyAgency,
  type SuperAgencyContext,
  type SuperAgencyInvitation,
  type SuperAgencyMember,
  type SuperAgencyRole,
} from '../../services/super-agencies';
import { useSessionStore } from '../../stores/session';
import { PageContainer } from '../layout/PageContainer';
import { PageHeader } from '../layout/PageHeader';
import { CardSkeleton, TableSkeleton } from '../layout/loading-states';
import { SuperAgencySwitcher } from '../navigation/SuperAgencySwitcher';

const noRoleValue = '__role__';

type AccessRender = (input: {
  context: SuperAgencyContext;
  selectedSuperAgencyId: string;
  permissions: Set<string>;
}) => React.ReactNode;

export function SuperAgencyDashboardPage() {
  const { locale, t } = useLanguage();
  return (
    <SuperAgencyAccessFrame>
      {({ context, permissions }) => {
        const canViewAgencyFoundation =
          hasPermission(permissions, 'agency.create') ||
          hasPermission(permissions, 'super_agency.manage');
        const canViewMembers = hasPermission(permissions, 'super_agency.members.view');
        const canViewInvitations = hasPermission(permissions, 'super_agency.members.invite');

        return (
          <PageContainer>
            <PageHeader
              title={t(locale, 'superAgency.dashboardTitle')}
              description={context.name}
              actions={<StatusBadge status={context.status} />}
            />
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {canViewAgencyFoundation ? (
                <>
                  <MetricCard
                    title={t(locale, 'superAgency.agencies')}
                    value={context.counts.agencies}
                  />
                  <MetricCard
                    title={t(locale, 'superAgency.workspaces')}
                    value={context.counts.workspaces}
                  />
                </>
              ) : null}
              {canViewMembers ? (
                <MetricCard
                  title={t(locale, 'superAgency.activeMembers')}
                  value={context.counts.activeMembers}
                />
              ) : null}
              {canViewInvitations ? (
                <MetricCard
                  title={t(locale, 'superAgency.pendingInvitations')}
                  value={context.counts.pendingInvitations ?? '-'}
                />
              ) : null}
            </div>
            <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
              {canViewAgencyFoundation ? (
                <Card>
                  <CardHeader>
                    <CardTitle>{t(locale, 'superAgency.childAgencies')}</CardTitle>
                    <CardDescription>
                      {t(locale, 'superAgency.agencyManagementDeferred')}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3">
                    {hasPermission(permissions, 'agency.create') ? (
                      <Badge variant="info">{t(locale, 'superAgency.createAgencyAvailable')}</Badge>
                    ) : null}
                    {context.agencies.length ? (
                      context.agencies.map((agency) => (
                        <div
                          key={agency.id}
                          className="flex items-center justify-between rounded-md border border-[hsl(var(--border))] p-3"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{agency.name}</p>
                            <p className="truncate text-xs text-[hsl(var(--muted-foreground))]">
                              {agency.slug}
                            </p>
                          </div>
                          <StatusBadge status={agency.status} />
                        </div>
                      ))
                    ) : (
                      <EmptyState
                        title={t(locale, 'superAgency.noAgencies')}
                        description={t(locale, 'superAgency.noAgenciesDescription')}
                      />
                    )}
                  </CardContent>
                </Card>
              ) : null}
              <Card>
                <CardHeader>
                  <CardTitle>{t(locale, 'superAgency.context')}</CardTitle>
                  <CardDescription>{t(locale, 'superAgency.contextDescription')}</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 text-sm">
                  <KeyValue label={t(locale, 'superAgency.role')} value={context.roleName} />
                  <KeyValue label={t(locale, 'superAgency.slug')} value={context.slug} />
                  <KeyValue
                    label={t(locale, 'superAgency.permissions')}
                    value={String(context.permissions.length)}
                  />
                  <StatusIndicator
                    tone="success"
                    label={t(locale, 'superAgency.backendValidated')}
                  />
                </CardContent>
              </Card>
            </div>
          </PageContainer>
        );
      }}
    </SuperAgencyAccessFrame>
  );
}

export function SuperAgencyAgenciesPage() {
  return (
    <SuperAgencyAccessFrame>
      {({ selectedSuperAgencyId, permissions }) => (
        <SuperAgencyAgenciesContent
          canCreate={hasPermission(permissions, 'agency.create')}
          selectedSuperAgencyId={selectedSuperAgencyId}
        />
      )}
    </SuperAgencyAccessFrame>
  );
}

function SuperAgencyAgenciesContent({
  canCreate,
  selectedSuperAgencyId,
}: {
  canCreate: boolean;
  selectedSuperAgencyId: string;
}) {
  const { locale, t } = useLanguage();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const listParams = { search, page };
  const agenciesQuery = useQuery({
    queryKey: superAgencyKeys.agencies(selectedSuperAgencyId, listParams),
    queryFn: () => listSuperAgencyAgencies(selectedSuperAgencyId, listParams),
  });

  useEffect(() => {
    setSearch('');
    setPage(1);
    setCreateOpen(false);
  }, [selectedSuperAgencyId]);

  return (
    <PageContainer>
      <PageHeader
        title={t(locale, 'superAgency.agencies')}
        description={t(locale, 'superAgency.agenciesDescription')}
        actions={
          canCreate ? (
            <Button type="button" onClick={() => setCreateOpen(true)}>
              <Plus aria-hidden="true" className="mr-2 h-4 w-4" />
              {t(locale, 'superAgency.createAgency')}
            </Button>
          ) : null
        }
      />
      <Input
        className="max-w-md"
        label={t(locale, 'superAgency.searchAgencies')}
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setPage(1);
        }}
      />
      {agenciesQuery.isLoading ? <TableSkeleton /> : null}
      {agenciesQuery.isError ? (
        <EmptyState
          title={t(locale, 'states.pageLoadFailed')}
          description={errorMessage(agenciesQuery.error, t(locale, 'states.pageLoadFailed'))}
        />
      ) : null}
      {agenciesQuery.data ? (
        <Card>
          <CardHeader>
            <CardTitle>{t(locale, 'superAgency.childAgencies')}</CardTitle>
            <CardDescription>
              {agenciesQuery.data.total} {t(locale, 'superAgency.total')}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {agenciesQuery.data.items.length ? (
              agenciesQuery.data.items.map((agency) => (
                <AgencySummaryCard key={agency.id} agency={agency} />
              ))
            ) : (
              <EmptyState
                title={t(locale, 'superAgency.noAgencies')}
                description={t(locale, 'superAgency.noAgenciesDescription')}
              />
            )}
            <PaginationControls
              page={agenciesQuery.data.page}
              totalPages={agenciesQuery.data.totalPages}
              onPageChange={setPage}
            />
          </CardContent>
        </Card>
      ) : null}
      {canCreate ? (
        <CreateAgencyDialog
          open={createOpen}
          selectedSuperAgencyId={selectedSuperAgencyId}
          onOpenChange={setCreateOpen}
        />
      ) : null}
    </PageContainer>
  );
}

function AgencySummaryCard({ agency }: { agency: SuperAgencyAgency }) {
  const { locale, t } = useLanguage();
  return (
    <div className="grid gap-3 rounded-md border border-[hsl(var(--border))] p-3 md:grid-cols-[1fr_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Building2 aria-hidden="true" className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
          <p className="truncate text-sm font-medium">{agency.name}</p>
          <StatusBadge status={agency.status} />
        </div>
        <p className="truncate text-xs text-[hsl(var(--muted-foreground))]">{agency.slug}</p>
        <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
          {agency.counts.workspaces} {t(locale, 'superAgency.workspaces')} · {agency.counts.members}{' '}
          {t(locale, 'superAgency.agencyMembers')}
        </p>
      </div>
      <Link
        className="inline-flex h-10 items-center justify-center rounded-md border border-[hsl(var(--border))] px-4 text-sm font-medium transition-colors hover:bg-[hsl(var(--muted))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
        href={`/super-agency/agencies/${agency.id}` as Route}
      >
        {t(locale, 'superAgency.manageAgency')}
      </Link>
    </div>
  );
}

function CreateAgencyDialog({
  onOpenChange,
  open,
  selectedSuperAgencyId,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  selectedSuperAgencyId: string;
}) {
  const { locale, t } = useLanguage();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const mutation = useMutation({
    mutationFn: () => createSuperAgencyAgency(selectedSuperAgencyId, { name, slug }),
    onSuccess: async () => {
      toast.success(t(locale, 'superAgency.agencyCreated'));
      setName('');
      setSlug('');
      onOpenChange(false);
      await queryClient.invalidateQueries({
        queryKey: superAgencyKeys.base(selectedSuperAgencyId),
      });
    },
    onError: (error) =>
      toast.error(errorMessage(error, t(locale, 'superAgency.agencyCreateFailed'))),
  });

  useEffect(() => {
    setName('');
    setSlug('');
  }, [selectedSuperAgencyId]);

  const canSubmit = name.trim().length >= 2 && /^[a-z0-9-]{2,120}$/.test(slug.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(locale, 'superAgency.createAgency')}</DialogTitle>
          <DialogDescription>{t(locale, 'superAgency.createAgencyDescription')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Input
            label={t(locale, 'superAgency.name')}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Input
            label={t(locale, 'superAgency.slug')}
            value={slug}
            onChange={(event) => setSlug(event.target.value.toLowerCase())}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            {t(locale, 'common.close')}
          </Button>
          <Button
            type="button"
            disabled={!canSubmit}
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {t(locale, 'superAgency.createAgency')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SuperAgencyAgencyDetailPage({ agencyId }: { agencyId: string }) {
  return (
    <SuperAgencyAccessFrame>
      {({ selectedSuperAgencyId, permissions }) => (
        <SuperAgencyAgencyDetailContent
          agencyId={agencyId}
          canManage={hasPermission(permissions, 'agency.update')}
          canViewWorkspaces={hasPermission(permissions, 'workspace.read')}
          selectedSuperAgencyId={selectedSuperAgencyId}
        />
      )}
    </SuperAgencyAccessFrame>
  );
}

function SuperAgencyAgencyDetailContent({
  agencyId,
  canManage,
  canViewWorkspaces,
  selectedSuperAgencyId,
}: {
  agencyId: string;
  canManage: boolean;
  canViewWorkspaces: boolean;
  selectedSuperAgencyId: string;
}) {
  const { locale, t } = useLanguage();
  const queryClient = useQueryClient();
  const [workspacePage, setWorkspacePage] = useState(1);
  const workspaceParams = { page: workspacePage };
  const agencyQuery = useQuery({
    queryKey: superAgencyKeys.agency(selectedSuperAgencyId, agencyId),
    queryFn: () => getSuperAgencyAgency(selectedSuperAgencyId, agencyId),
  });
  const workspaceQuery = useQuery({
    queryKey: superAgencyKeys.agencyWorkspaces(selectedSuperAgencyId, agencyId, workspaceParams),
    queryFn: () =>
      listSuperAgencyAgencyWorkspaces(selectedSuperAgencyId, agencyId, workspaceParams),
    enabled: canViewWorkspaces,
  });
  const [name, setName] = useState('');
  const [status, setStatus] = useState<AgencyStatus>('ACTIVE');
  const updateMutation = useMutation({
    mutationFn: () =>
      updateSuperAgencyAgency(selectedSuperAgencyId, agencyId, {
        name: name.trim(),
        status,
      }),
    onSuccess: async () => {
      toast.success(t(locale, 'superAgency.agencyUpdated'));
      await queryClient.invalidateQueries({
        queryKey: superAgencyKeys.agency(selectedSuperAgencyId, agencyId),
      });
      await queryClient.invalidateQueries({
        queryKey: superAgencyKeys.agencies(selectedSuperAgencyId, {}),
      });
    },
    onError: (error) =>
      toast.error(errorMessage(error, t(locale, 'superAgency.agencyUpdateFailed'))),
  });

  useEffect(() => {
    if (agencyQuery.data) {
      setName(agencyQuery.data.name);
      setStatus(agencyQuery.data.status);
    }
  }, [agencyQuery.data]);

  useEffect(() => {
    setName('');
    setStatus('ACTIVE');
    setWorkspacePage(1);
  }, [selectedSuperAgencyId, agencyId]);

  if (agencyQuery.isLoading) {
    return (
      <PageContainer>
        <CardSkeleton />
        <TableSkeleton />
      </PageContainer>
    );
  }

  if (agencyQuery.isError || !agencyQuery.data) {
    return (
      <PageContainer>
        <EmptyState
          title={t(locale, 'states.pageLoadFailed')}
          description={errorMessage(agencyQuery.error, t(locale, 'states.pageLoadFailed'))}
        />
      </PageContainer>
    );
  }

  const agency = agencyQuery.data;

  return (
    <PageContainer>
      <nav
        aria-label={t(locale, 'superAgency.breadcrumbLabel')}
        className="flex flex-wrap items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]"
      >
        <Link className="hover:text-[hsl(var(--foreground))]" href={'/super-agency' as Route}>
          {t(locale, 'superAgency.dashboardTitle')}
        </Link>
        <span aria-hidden="true">/</span>
        <Link
          className="hover:text-[hsl(var(--foreground))]"
          href={'/super-agency/agencies' as Route}
        >
          {t(locale, 'superAgency.agencies')}
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-[hsl(var(--foreground))]">{agency.name}</span>
      </nav>
      <PageHeader
        title={agency.name}
        description={t(locale, 'superAgency.managedFromSuperAgency')}
        actions={<StatusBadge status={agency.status} />}
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHeader>
            <CardTitle>{t(locale, 'superAgency.agencyDetails')}</CardTitle>
            <CardDescription>{agency.slug}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <KeyValue
              label={t(locale, 'superAgency.workspaces')}
              value={String(agency.counts.workspaces)}
            />
            <KeyValue
              label={t(locale, 'superAgency.agencyMembers')}
              value={String(agency.counts.members)}
            />
            <KeyValue
              label={t(locale, 'superAgency.created')}
              value={new Date(agency.createdAt).toLocaleDateString()}
            />
            {canManage ? (
              <div className="grid gap-3 border-t border-[hsl(var(--border))] pt-3">
                <Input
                  label={t(locale, 'superAgency.name')}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
                <Select value={status} onValueChange={(value) => setStatus(value as AgencyStatus)}>
                  <SelectTrigger label={t(locale, 'superAgency.status')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">ACTIVE</SelectItem>
                    <SelectItem value="SUSPENDED">SUSPENDED</SelectItem>
                    <SelectItem value="ARCHIVED">ARCHIVED</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  disabled={name.trim().length < 2}
                  loading={updateMutation.isPending}
                  onClick={() => updateMutation.mutate()}
                >
                  {t(locale, 'superAgency.updateAgency')}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t(locale, 'superAgency.workspaces')}</CardTitle>
            <CardDescription>
              {t(locale, 'superAgency.workspaceSummaryDescription')}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {!canViewWorkspaces ? (
              <EmptyState
                title={t(locale, 'states.permissionDenied')}
                description={t(locale, 'states.permissionDeniedDescription')}
              />
            ) : null}
            {canViewWorkspaces && workspaceQuery.isLoading ? <TableSkeleton /> : null}
            {canViewWorkspaces && workspaceQuery.data?.items.length
              ? workspaceQuery.data.items.map((workspace) => (
                  <div
                    key={workspace.id}
                    className="grid gap-2 rounded-md border border-[hsl(var(--border))] p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">{workspace.name}</p>
                      <StatusBadge status={workspace.status} />
                    </div>
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">{workspace.slug}</p>
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">
                      {workspace.counts.members} {t(locale, 'superAgency.workspaceMembers')} ·{' '}
                      {workspace.timezone}
                    </p>
                  </div>
                ))
              : null}
            {canViewWorkspaces && workspaceQuery.data?.items.length === 0 ? (
              <EmptyState
                title={t(locale, 'superAgency.noWorkspaces')}
                description={t(locale, 'superAgency.noWorkspacesDescription')}
              />
            ) : null}
            {canViewWorkspaces && workspaceQuery.data ? (
              <PaginationControls
                page={workspaceQuery.data.page}
                totalPages={workspaceQuery.data.totalPages}
                onPageChange={setWorkspacePage}
              />
            ) : null}
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}

function PaginationControls({
  onPageChange,
  page,
  totalPages,
}: {
  onPageChange: (page: number) => void;
  page: number;
  totalPages: number;
}) {
  const { locale, t } = useLanguage();
  const lastPage = Math.max(totalPages, 1);

  return (
    <div
      aria-label={t(locale, 'superAgency.pagination')}
      className="flex flex-wrap items-center justify-between gap-2 border-t border-[hsl(var(--border))] pt-3"
      role="navigation"
    >
      <p className="text-sm text-[hsl(var(--muted-foreground))]">
        {t(locale, 'superAgency.page')} {page} / {lastPage}
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={page <= 1}
          onClick={() => onPageChange(Math.max(page - 1, 1))}
        >
          <ChevronLeft aria-hidden="true" className="mr-2 h-4 w-4" />
          {t(locale, 'superAgency.previous')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={page >= lastPage}
          onClick={() => onPageChange(Math.min(page + 1, lastPage))}
        >
          {t(locale, 'superAgency.next')}
          <ChevronRight aria-hidden="true" className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export function SuperAgencyMembersPage() {
  return (
    <SuperAgencyAccessFrame>
      {({ selectedSuperAgencyId, permissions }) => (
        <SuperAgencyMembersContent
          permissions={permissions}
          selectedSuperAgencyId={selectedSuperAgencyId}
        />
      )}
    </SuperAgencyAccessFrame>
  );
}

function SuperAgencyMembersContent({
  permissions,
  selectedSuperAgencyId,
}: {
  permissions: Set<string>;
  selectedSuperAgencyId: string;
}) {
  const { locale, t } = useLanguage();
  const [search, setSearch] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const canInvite = hasPermission(permissions, 'super_agency.members.invite');
  const canManage = hasPermission(permissions, 'super_agency.members.manage');

  useEffect(() => {
    setSearch('');
    setInviteOpen(false);
  }, [selectedSuperAgencyId]);

  return (
    <PageContainer>
      <PageHeader
        title={t(locale, 'superAgency.members')}
        description={t(locale, 'superAgency.membersDescription')}
        actions={
          canInvite ? (
            <Button type="button" onClick={() => setInviteOpen(true)}>
              <MailPlus aria-hidden="true" className="mr-2 h-4 w-4" />
              {t(locale, 'superAgency.inviteMember')}
            </Button>
          ) : null
        }
      />
      <Input
        className="max-w-md"
        label={t(locale, 'common.search')}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <MemberList
        canManage={canManage}
        search={search}
        selectedSuperAgencyId={selectedSuperAgencyId}
      />
      {canInvite ? (
        <>
          <InvitationList selectedSuperAgencyId={selectedSuperAgencyId} />
          <InviteDialog
            open={inviteOpen}
            selectedSuperAgencyId={selectedSuperAgencyId}
            onOpenChange={setInviteOpen}
          />
        </>
      ) : null}
    </PageContainer>
  );
}

export function SuperAgencyRolesPage() {
  const { locale, t } = useLanguage();
  return (
    <SuperAgencyAccessFrame>
      {({ selectedSuperAgencyId, permissions }) => (
        <PageContainer>
          <PageHeader
            title={t(locale, 'superAgency.roles')}
            description={t(locale, 'superAgency.rolesDescription')}
            actions={
              hasPermission(permissions, 'super_agency.roles.manage') ? (
                <Badge variant="info">{t(locale, 'superAgency.customRolesSupported')}</Badge>
              ) : null
            }
          />
          <RolesList selectedSuperAgencyId={selectedSuperAgencyId} />
        </PageContainer>
      )}
    </SuperAgencyAccessFrame>
  );
}

export function SuperAgencySettingsPage() {
  const { locale, t } = useLanguage();
  return (
    <SuperAgencyAccessFrame>
      {({ context }) => (
        <PageContainer>
          <PageHeader
            title={t(locale, 'superAgency.settings')}
            description={t(locale, 'superAgency.settingsDescription')}
            actions={<StatusBadge status={context.status} />}
          />
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>{t(locale, 'superAgency.general')}</CardTitle>
                <CardDescription>{t(locale, 'superAgency.readOnlySettings')}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm">
                <KeyValue label={t(locale, 'superAgency.name')} value={context.name} />
                <KeyValue label={t(locale, 'superAgency.slug')} value={context.slug} />
                <KeyValue label={t(locale, 'superAgency.status')} value={context.status} />
                <KeyValue
                  label={t(locale, 'superAgency.membership')}
                  value={context.membershipId}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t(locale, 'superAgency.scopeSafety')}</CardTitle>
                <CardDescription>{t(locale, 'superAgency.scopeSafetyDescription')}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm text-[hsl(var(--muted-foreground))]">
                <StatusIndicator tone="warning" label={t(locale, 'superAgency.noNotifications')} />
                <StatusIndicator tone="warning" label={t(locale, 'superAgency.noRealtime')} />
                <StatusIndicator
                  tone="warning"
                  label={t(locale, 'superAgency.noWorkspaceModules')}
                />
              </CardContent>
            </Card>
          </div>
        </PageContainer>
      )}
    </SuperAgencyAccessFrame>
  );
}

function SuperAgencyAccessFrame({ children }: { children: AccessRender }) {
  const { locale, t } = useLanguage();
  const { selectedSuperAgencyId, superAgencies } = useSessionStore();
  const query = useQuery({
    queryKey: superAgencyKeys.context(selectedSuperAgencyId),
    queryFn: () => getSuperAgencyContext(selectedSuperAgencyId as string),
    enabled: Boolean(selectedSuperAgencyId),
    retry: false,
  });

  if (superAgencies.length === 0) {
    return (
      <PageContainer>
        <EmptyState
          title={t(locale, 'superAgency.noSuperAgencies')}
          description={t(locale, 'superAgency.noSuperAgenciesDescription')}
        />
      </PageContainer>
    );
  }

  if (!selectedSuperAgencyId) {
    return (
      <PageContainer>
        <Card>
          <CardHeader>
            <CardTitle>{t(locale, 'superAgency.switchSuperAgency')}</CardTitle>
            <CardDescription>{t(locale, 'superAgency.explicitSelectionRequired')}</CardDescription>
          </CardHeader>
          <CardContent>
            <SuperAgencySwitcher />
          </CardContent>
        </Card>
      </PageContainer>
    );
  }

  if (query.isLoading) {
    return (
      <PageContainer>
        <CardSkeleton />
        <TableSkeleton />
      </PageContainer>
    );
  }

  if (query.isError) {
    const message =
      query.error instanceof ApiClientError && query.error.status === 403
        ? t(locale, 'states.permissionDeniedDescription')
        : t(locale, 'states.pageLoadFailed');
    return (
      <PageContainer>
        <EmptyState title={t(locale, 'states.permissionDenied')} description={message} />
      </PageContainer>
    );
  }

  if (!query.data || query.data.status !== 'ACTIVE') {
    return (
      <PageContainer>
        <EmptyState
          title={t(locale, 'superAgency.restricted')}
          description={t(locale, 'superAgency.restrictedDescription')}
        />
      </PageContainer>
    );
  }

  return (
    <>
      {children({
        context: query.data,
        selectedSuperAgencyId,
        permissions: new Set(query.data.permissions),
      })}
    </>
  );
}

function MemberList({
  canManage,
  search,
  selectedSuperAgencyId,
}: {
  canManage: boolean;
  search: string;
  selectedSuperAgencyId: string;
}) {
  const { locale, t } = useLanguage();
  const queryClient = useQueryClient();
  const membersQuery = useQuery({
    queryKey: superAgencyKeys.members(selectedSuperAgencyId, { search }),
    queryFn: () => listSuperAgencyMembers(selectedSuperAgencyId, { search }),
  });
  const rolesQuery = useQuery({
    queryKey: superAgencyKeys.roles(selectedSuperAgencyId),
    queryFn: () => listSuperAgencyRoles(selectedSuperAgencyId),
  });
  const updateMutation = useMutation({
    mutationFn: ({
      membershipId,
      body,
    }: {
      membershipId: string;
      body: { status?: MembershipStatus; roleId?: string };
    }) => updateSuperAgencyMembership(selectedSuperAgencyId, membershipId, body),
    onSuccess: async () => {
      toast.success(t(locale, 'superAgency.memberUpdated'));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: superAgencyKeys.base(selectedSuperAgencyId) }),
      ]);
    },
    onError: (error) =>
      toast.error(errorMessage(error, t(locale, 'superAgency.memberUpdateFailed'))),
  });

  if (membersQuery.isLoading) return <TableSkeleton />;
  if (membersQuery.isError) {
    return (
      <EmptyState
        title={t(locale, 'superAgency.membersLoadFailed')}
        description={errorMessage(membersQuery.error, t(locale, 'states.pageLoadFailed'))}
      />
    );
  }
  const members = membersQuery.data;
  if (!members) return <TableSkeleton />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(locale, 'superAgency.members')}</CardTitle>
        <CardDescription>
          {members.total} {t(locale, 'superAgency.total')}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {members.items.map((member) => (
          <MemberRow
            key={member.id}
            canManage={canManage}
            member={member}
            roles={rolesQuery.data ?? []}
            updating={updateMutation.isPending}
            onRoleChange={(roleId) =>
              updateMutation.mutate({ membershipId: member.id, body: { roleId } })
            }
            onStatusChange={(status) =>
              updateMutation.mutate({ membershipId: member.id, body: { status } })
            }
          />
        ))}
      </CardContent>
    </Card>
  );
}

function MemberRow({
  canManage,
  member,
  onRoleChange,
  onStatusChange,
  roles,
  updating,
}: {
  canManage: boolean;
  member: SuperAgencyMember;
  onRoleChange: (roleId: string) => void;
  onStatusChange: (status: MembershipStatus) => void;
  roles: SuperAgencyRole[];
  updating: boolean;
}) {
  const { locale, t } = useLanguage();
  return (
    <div className="grid gap-3 rounded-md border border-[hsl(var(--border))] p-3 md:grid-cols-[1fr_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium">{member.user.name ?? member.user.email}</p>
          <StatusBadge status={member.status} />
        </div>
        <p className="truncate text-xs text-[hsl(var(--muted-foreground))]">{member.user.email}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          disabled={!canManage || updating}
          value={member.role.id}
          onValueChange={(roleId) => onRoleChange(roleId)}
        >
          <SelectTrigger className="w-52" label={t(locale, 'superAgency.role')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {roles.map((role) => (
              <SelectItem key={role.id} value={role.id}>
                {role.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canManage && member.status === 'ACTIVE' ? (
          <Button
            size="icon"
            type="button"
            variant="outline"
            aria-label={t(locale, 'superAgency.suspendMember')}
            onClick={() => onStatusChange('SUSPENDED')}
          >
            <UserRoundMinus aria-hidden="true" className="h-4 w-4" />
          </Button>
        ) : null}
        {canManage && member.status !== 'ACTIVE' ? (
          <Button
            size="icon"
            type="button"
            variant="outline"
            aria-label={t(locale, 'superAgency.activateMember')}
            onClick={() => onStatusChange('ACTIVE')}
          >
            <UserRoundPlus aria-hidden="true" className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function InviteDialog({
  onOpenChange,
  open,
  selectedSuperAgencyId,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  selectedSuperAgencyId: string;
}) {
  const { locale, t } = useLanguage();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState(noRoleValue);
  const rolesQuery = useQuery({
    queryKey: superAgencyKeys.roles(selectedSuperAgencyId),
    queryFn: () => listSuperAgencyRoles(selectedSuperAgencyId),
    enabled: open,
  });
  const inviteMutation = useMutation({
    mutationFn: () =>
      createSuperAgencyInvitation(selectedSuperAgencyId, {
        email,
        roleId,
      }),
    onSuccess: async () => {
      toast.success(t(locale, 'superAgency.invitationSent'));
      setEmail('');
      setRoleId(noRoleValue);
      onOpenChange(false);
      await queryClient.invalidateQueries({
        queryKey: superAgencyKeys.base(selectedSuperAgencyId),
      });
    },
    onError: (error) => toast.error(errorMessage(error, t(locale, 'superAgency.invitationFailed'))),
  });

  useEffect(() => {
    setEmail('');
    setRoleId(noRoleValue);
  }, [selectedSuperAgencyId]);

  const canSubmit = email.trim().includes('@') && roleId !== noRoleValue;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(locale, 'superAgency.inviteMember')}</DialogTitle>
          <DialogDescription>{t(locale, 'superAgency.inviteDescription')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Input
            label={t(locale, 'superAgency.email')}
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Select value={roleId} onValueChange={setRoleId}>
            <SelectTrigger label={t(locale, 'superAgency.role')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={noRoleValue}>{t(locale, 'superAgency.selectRole')}</SelectItem>
              {(rolesQuery.data ?? []).map((role) => (
                <SelectItem key={role.id} value={role.id}>
                  {role.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            {t(locale, 'common.close')}
          </Button>
          <Button
            type="button"
            disabled={!canSubmit}
            loading={inviteMutation.isPending}
            onClick={() => inviteMutation.mutate()}
          >
            {t(locale, 'superAgency.sendInvite')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InvitationList({ selectedSuperAgencyId }: { selectedSuperAgencyId: string }) {
  const { locale, t } = useLanguage();
  const queryClient = useQueryClient();
  const invitationsQuery = useQuery({
    queryKey: superAgencyKeys.invitations(selectedSuperAgencyId, { status: 'PENDING' }),
    queryFn: () => listSuperAgencyInvitations(selectedSuperAgencyId, { status: 'PENDING' }),
  });
  const revokeMutation = useMutation({
    mutationFn: (invitationId: string) =>
      revokeSuperAgencyInvitation(selectedSuperAgencyId, invitationId),
    onSuccess: async () => {
      toast.success(t(locale, 'superAgency.invitationRevoked'));
      await queryClient.invalidateQueries({
        queryKey: superAgencyKeys.base(selectedSuperAgencyId),
      });
    },
    onError: (error) => toast.error(errorMessage(error, t(locale, 'superAgency.revokeFailed'))),
  });

  if (invitationsQuery.isLoading) return <TableSkeleton />;
  if (invitationsQuery.isError) return null;
  const invitations = invitationsQuery.data;
  if (!invitations) return <TableSkeleton />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(locale, 'superAgency.invitations')}</CardTitle>
        <CardDescription>{t(locale, 'superAgency.invitationsDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {invitations.items.length ? (
          invitations.items.map((invitation) => (
            <InvitationRow
              key={invitation.id}
              invitation={invitation}
              revoking={revokeMutation.isPending}
              onRevoke={() => revokeMutation.mutate(invitation.id)}
            />
          ))
        ) : (
          <EmptyState
            title={t(locale, 'superAgency.noInvitations')}
            description={t(locale, 'superAgency.noInvitationsDescription')}
          />
        )}
      </CardContent>
    </Card>
  );
}

function InvitationRow({
  invitation,
  onRevoke,
  revoking,
}: {
  invitation: SuperAgencyInvitation;
  onRevoke: () => void;
  revoking: boolean;
}) {
  const { locale, t } = useLanguage();
  return (
    <div className="grid gap-3 rounded-md border border-[hsl(var(--border))] p-3 md:grid-cols-[1fr_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium">{invitation.email}</p>
          <StatusBadge status={invitation.status} />
        </div>
        <p className="truncate text-xs text-[hsl(var(--muted-foreground))]">
          {invitation.role.name} - {new Date(invitation.expiresAt).toLocaleDateString()}
        </p>
      </div>
      {invitation.status === 'PENDING' ? (
        <Button type="button" variant="outline" disabled={revoking} onClick={onRevoke}>
          <RefreshCw aria-hidden="true" className="mr-2 h-4 w-4" />
          {t(locale, 'superAgency.revoke')}
        </Button>
      ) : null}
    </div>
  );
}

function RolesList({ selectedSuperAgencyId }: { selectedSuperAgencyId: string }) {
  const { locale, t } = useLanguage();
  const rolesQuery = useQuery({
    queryKey: superAgencyKeys.roles(selectedSuperAgencyId),
    queryFn: () => listSuperAgencyRoles(selectedSuperAgencyId),
  });
  const permissions = useMemo(
    () =>
      Array.from(
        new Set(
          (rolesQuery.data ?? []).flatMap((role) => role.permissions.map((item) => item.key)),
        ),
      ).sort(),
    [rolesQuery.data],
  );

  if (rolesQuery.isLoading) return <TableSkeleton />;
  if (rolesQuery.isError) {
    return (
      <EmptyState
        title={t(locale, 'superAgency.rolesLoadFailed')}
        description={errorMessage(rolesQuery.error, t(locale, 'states.pageLoadFailed'))}
      />
    );
  }
  const roles = rolesQuery.data;
  if (!roles) return <TableSkeleton />;

  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>{t(locale, 'superAgency.roles')}</CardTitle>
          <CardDescription>
            {roles.length} {t(locale, 'superAgency.total')}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {roles.map((role) => (
            <div key={role.id} className="rounded-md border border-[hsl(var(--border))] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">{role.name}</p>
                <Badge variant={role.isSystem ? 'neutral' : 'info'}>
                  {role.isSystem
                    ? t(locale, 'superAgency.defaultRole')
                    : t(locale, 'superAgency.customRole')}
                </Badge>
                <StatusBadge status={role.isActive ? 'ACTIVE' : 'SUSPENDED'} />
              </div>
              <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                {role.permissions.length} {t(locale, 'superAgency.permissions')}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t(locale, 'superAgency.permissionCatalog')}</CardTitle>
          <CardDescription>{t(locale, 'superAgency.permissionCatalogDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {permissions.map((permission) => (
            <Badge key={permission} variant="neutral">
              <ShieldCheck aria-hidden="true" className="mr-1 h-3 w-3" />
              {permission}
            </Badge>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({ title, value }: { title: string; value: number | string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm text-[hsl(var(--muted-foreground))]">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold tracking-normal">{value}</p>
      </CardContent>
    </Card>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-4 rounded-md border border-[hsl(var(--border))] p-3">
      <span className="text-[hsl(var(--muted-foreground))]">{label}</span>
      <span className="truncate font-medium">{value}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variant = status === 'ACTIVE' ? 'success' : status === 'PENDING' ? 'info' : 'neutral';
  return <Badge variant={variant}>{status}</Badge>;
}

function hasPermission(permissions: Set<string>, permission: string) {
  return permissions.has('*') || permissions.has(permission);
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiClientError) return error.body.message;
  return fallback;
}
