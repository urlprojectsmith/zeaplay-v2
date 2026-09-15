'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@zea-play/ui';
import { RefreshCw, Search } from 'lucide-react';
import { toast } from 'sonner';
import { PageContainer } from '../layout/PageContainer';
import { PageHeader } from '../layout/PageHeader';
import { useLanguage } from '../../contexts/language-provider';
import { useSessionStore } from '../../stores/session';
import {
  listDepartments,
  listWorkspaceUsers,
  updateWorkspaceUser,
} from '../../services/workspace-management';
import type { Department, WorkspaceUser } from '../../services/workspace-management';
import { listWorkspaceRoles, rolesKeys } from '../../services/workspace-roles';
import type { WorkspaceRole } from '../../services/workspace-roles';

const pageSize = 10;

export function WorkspaceUsersPage() {
  const { locale, t } = useLanguage();
  const workspaceId = useSessionStore((state) => state.selectedWorkspaceId);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [role, setRole] = useState('ALL');
  const [departmentId, setDepartmentId] = useState('ALL');
  const [page, setPage] = useState(1);
  const [users, setUsers] = useState<WorkspaceUser[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<WorkspaceUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const rolesQuery = useQuery({
    queryKey: rolesKeys.all(workspaceId),
    queryFn: () => listWorkspaceRoles(workspaceId as string),
    enabled: Boolean(workspaceId),
  });

  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    setLoading(true);
    setError(null);
    void Promise.all([
      listWorkspaceUsers({
        workspaceId,
        page,
        pageSize,
        search: search.trim().length >= 2 ? search.trim() : undefined,
        status: status === 'ALL' ? undefined : status,
        role: role === 'ALL' ? undefined : role,
        departmentId: departmentId === 'ALL' ? undefined : departmentId,
      }),
      listDepartments({ workspaceId, pageSize: 100 }),
    ])
      .then(([userPage, departmentPage]) => {
        if (!active) return;
        setUsers(userPage.items);
        setDepartments(departmentPage.items);
        setTotal(userPage.total);
        setSelected((current) =>
          current ? (userPage.items.find((item) => item.id === current.id) ?? current) : null,
        );
      })
      .catch((nextError: Error) => {
        if (active) setError(nextError.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [departmentId, page, role, search, status, workspaceId]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasFilters = Boolean(
    search || status !== 'ALL' || role !== 'ALL' || departmentId !== 'ALL',
  );

  async function mutateUser(user: WorkspaceUser, body: Parameters<typeof updateWorkspaceUser>[2]) {
    if (!workspaceId) return;
    try {
      const updated = await updateWorkspaceUser(workspaceId, user.id, body);
      setUsers((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      setSelected(updated);
      toast.success(t(locale, 'workspaceUsers.updated'));
    } catch (nextError) {
      toast.error(
        nextError instanceof Error ? nextError.message : t(locale, 'workspaceUsers.updateFailed'),
      );
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title={t(locale, 'workspaceUsers.title')}
        description={t(locale, 'workspaceUsers.description')}
      />
      <Card>
        <CardContent className="grid gap-3 pt-6 md:grid-cols-[1fr_160px_160px_180px]">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-[hsl(var(--muted-foreground))]" />
            <Input
              aria-label="Search users"
              className="pl-9"
              placeholder={t(locale, 'workspaceUsers.searchPlaceholder')}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <FilterSelect
            label={t(locale, 'workspaceUsers.status')}
            value={status}
            onChange={setStatus}
            values={['ALL', 'ACTIVE', 'INVITED', 'SUSPENDED']}
            allLabel={t(locale, 'workspaceUsers.allStatus')}
          />
          <FilterSelect
            label={t(locale, 'workspaceUsers.role')}
            value={role}
            onChange={setRole}
            values={['ALL', 'ADMIN', 'MANAGER', 'MEMBER']}
            allLabel={t(locale, 'workspaceUsers.allRoles')}
          />
          <Select
            value={departmentId}
            onValueChange={(value) => {
              setDepartmentId(value);
              setPage(1);
            }}
          >
            <SelectTrigger label={t(locale, 'workspaceUsers.department')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t(locale, 'workspaceUsers.allDepartments')}</SelectItem>
              {departments.map((department) => (
                <SelectItem key={department.id} value={department.id}>
                  {department.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>
      {loading ? (
        <UserSkeleton />
      ) : error ? (
        <EmptyState title={t(locale, 'workspaceUsers.loadError')} description={error} />
      ) : users.length === 0 ? (
        <EmptyState
          title={
            hasFilters
              ? t(locale, 'workspaceUsers.noMatchingUsers')
              : t(locale, 'workspaceUsers.noUsers')
          }
          description={t(locale, 'workspaceUsers.emptyDescription')}
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
          <div className="grid gap-3">
            {users.map((user) => (
              <button
                key={user.id}
                type="button"
                className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4 text-left transition hover:bg-[hsl(var(--surface-muted))]"
                onClick={() => setSelected(user)}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold">{user.name ?? user.email}</p>
                    <p className="text-sm text-[hsl(var(--muted-foreground))]">{user.email}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge>{user.role.name}</Badge>
                    <Badge variant={user.membershipStatus === 'ACTIVE' ? 'success' : 'warning'}>
                      {user.membershipStatus}
                    </Badge>
                    <Badge variant="neutral">
                      {user.department?.name ?? t(locale, 'workspaceUsers.noDepartment')}
                    </Badge>
                  </div>
                </div>
              </button>
            ))}
            <div className="flex items-center justify-between">
              <Button
                variant="secondary"
                disabled={page <= 1}
                onClick={() => setPage((value) => value - 1)}
              >
                {t(locale, 'workspaceUsers.previous')}
              </Button>
              <span className="text-sm text-[hsl(var(--muted-foreground))]">
                {t(locale, 'workspaceUsers.page')} {page} {t(locale, 'workspaceUsers.of')}{' '}
                {totalPages}
              </span>
              <Button
                variant="secondary"
                disabled={page >= totalPages}
                onClick={() => setPage((value) => value + 1)}
              >
                {t(locale, 'workspaceUsers.next')}
              </Button>
            </div>
          </div>
          <UserDetail
            user={(selected ?? users[0]) as WorkspaceUser}
            departments={departments}
            onChange={mutateUser}
            labels={{
              membership: t(locale, 'workspaceUsers.membership'),
              role: t(locale, 'workspaceUsers.role'),
              department: t(locale, 'workspaceUsers.department'),
              noDepartment: t(locale, 'workspaceUsers.noDepartment'),
              joined: t(locale, 'workspaceUsers.joined'),
              suspend: t(locale, 'workspaceUsers.suspend'),
              reactivate: t(locale, 'workspaceUsers.reactivate'),
              ownerProtected: t(locale, 'workspaceUsers.ownerProtected'),
            }}
            roles={(rolesQuery.data ?? []).filter((item) => item.isActive && item.key !== 'OWNER')}
          />
        </div>
      )}
    </PageContainer>
  );
}

function FilterSelect({
  label,
  value,
  values,
  onChange,
  allLabel,
}: {
  label: string;
  value: string;
  values: string[];
  onChange: (value: string) => void;
  allLabel: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        onChange(next);
      }}
    >
      <SelectTrigger label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {values.map((item) => (
          <SelectItem key={item} value={item}>
            {item === 'ALL' ? allLabel : item}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function UserDetail({
  user,
  departments,
  onChange,
  labels,
  roles,
}: {
  user: WorkspaceUser;
  departments: Department[];
  onChange: (user: WorkspaceUser, body: Parameters<typeof updateWorkspaceUser>[2]) => Promise<void>;
  roles: WorkspaceRole[];
  labels: {
    membership: string;
    role: string;
    department: string;
    noDepartment: string;
    joined: string;
    suspend: string;
    reactivate: string;
    ownerProtected: string;
  };
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{user.name ?? user.email}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Detail label="Email" value={user.email} />
        <Detail label={labels.membership} value={user.membershipStatus} />
        <Detail label={labels.role} value={user.role.name} />
        <Detail label={labels.department} value={user.department?.name ?? labels.noDepartment} />
        <Detail label={labels.joined} value={new Date(user.joinedAt).toLocaleDateString()} />
        {user.role.key !== 'OWNER' ? (
          <div className="grid gap-3">
            <Select
              value={user.role.id}
              onValueChange={(roleId) => void onChange(user, { roleId })}
            >
              <SelectTrigger label={labels.role}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roles.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={user.department?.id ?? 'NONE'}
              onValueChange={(value) =>
                void onChange(user, { departmentId: value === 'NONE' ? null : value })
              }
            >
              <SelectTrigger label={labels.department}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">{labels.noDepartment}</SelectItem>
                {departments.map((department) => (
                  <SelectItem key={department.id} value={department.id}>
                    {department.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="secondary"
              onClick={() =>
                void onChange(user, {
                  status: user.membershipStatus === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE',
                })
              }
            >
              <RefreshCw className="h-4 w-4" />{' '}
              {user.membershipStatus === 'ACTIVE' ? labels.suspend : labels.reactivate}
            </Button>
          </div>
        ) : (
          <Badge variant="neutral">{labels.ownerProtected}</Badge>
        )}
      </CardContent>
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase text-[hsl(var(--muted-foreground))]">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  );
}

function UserSkeleton() {
  return (
    <div className="grid gap-3">
      {Array.from({ length: 4 }).map((_, index) => (
        <Skeleton key={index} className="h-24 w-full" />
      ))}
    </div>
  );
}
