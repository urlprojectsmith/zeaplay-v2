'use client';

import { useEffect, useState } from 'react';
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
import { PageContainer } from '../layout/PageContainer';
import { PageHeader } from '../layout/PageHeader';
import { useSessionStore } from '../../stores/session';
import {
  listDepartments,
  listWorkspaceUsers,
  updateWorkspaceUser,
} from '../../services/workspace-management';
import type { Department, WorkspaceUser } from '../../services/workspace-management';

const pageSize = 10;

export function WorkspaceUsersPage() {
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
    const updated = await updateWorkspaceUser(workspaceId, user.id, body);
    setUsers((items) => items.map((item) => (item.id === updated.id ? updated : item)));
    setSelected(updated);
  }

  return (
    <PageContainer>
      <PageHeader
        title="Users"
        description="Workspace membership, roles, and department assignment."
      />
      <Card>
        <CardContent className="grid gap-3 pt-6 md:grid-cols-[1fr_160px_160px_180px]">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-[hsl(var(--muted-foreground))]" />
            <Input
              aria-label="Search users"
              className="pl-9"
              placeholder="Search name, email, or id"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <FilterSelect
            label="Status"
            value={status}
            onChange={setStatus}
            values={['ALL', 'ACTIVE', 'INVITED', 'SUSPENDED']}
          />
          <FilterSelect
            label="Role"
            value={role}
            onChange={setRole}
            values={['ALL', 'ADMIN', 'MANAGER', 'MEMBER']}
          />
          <Select
            value={departmentId}
            onValueChange={(value) => {
              setDepartmentId(value);
              setPage(1);
            }}
          >
            <SelectTrigger label="Department">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All departments</SelectItem>
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
        <EmptyState title="Could not load users" description={error} />
      ) : users.length === 0 ? (
        <EmptyState
          title={hasFilters ? 'No matching users' : 'No users'}
          description="Adjust filters or add members to this workspace."
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
                    <Badge variant="neutral">{user.department?.name ?? 'No department'}</Badge>
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
                Previous
              </Button>
              <span className="text-sm text-[hsl(var(--muted-foreground))]">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="secondary"
                disabled={page >= totalPages}
                onClick={() => setPage((value) => value + 1)}
              >
                Next
              </Button>
            </div>
          </div>
          <UserDetail
            user={(selected ?? users[0]) as WorkspaceUser}
            departments={departments}
            onChange={mutateUser}
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
}: {
  label: string;
  value: string;
  values: string[];
  onChange: (value: string) => void;
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
            {item === 'ALL' ? `All ${label.toLowerCase()}` : item}
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
}: {
  user: WorkspaceUser;
  departments: Department[];
  onChange: (user: WorkspaceUser, body: Parameters<typeof updateWorkspaceUser>[2]) => Promise<void>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{user.name ?? user.email}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Detail label="Email" value={user.email} />
        <Detail label="Membership" value={user.membershipStatus} />
        <Detail label="Role" value={user.role.name} />
        <Detail label="Department" value={user.department?.name ?? 'None'} />
        <Detail label="Joined" value={new Date(user.joinedAt).toLocaleDateString()} />
        {user.role.key !== 'OWNER' ? (
          <div className="grid gap-3">
            <Select value={user.role.key} onValueChange={(role) => void onChange(user, { role })}>
              <SelectTrigger label="Role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {['ADMIN', 'MANAGER', 'MEMBER'].map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
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
              <SelectTrigger label="Department">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">No department</SelectItem>
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
              {user.membershipStatus === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
            </Button>
          </div>
        ) : (
          <Badge variant="neutral">OWNER protected</Badge>
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
