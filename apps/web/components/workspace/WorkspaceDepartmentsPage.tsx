'use client';

import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Building2, Plus } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
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
  Textarea,
} from '@zea-play/ui';
import { PageContainer } from '../layout/PageContainer';
import { PageHeader } from '../layout/PageHeader';
import { useSessionStore } from '../../stores/session';
import {
  createDepartment,
  listDepartments,
  listWorkspaceUsers,
  updateDepartment,
} from '../../services/workspace-management';
import type { Department, WorkspaceUser } from '../../services/workspace-management';

const formSchema = z.object({
  name: z.string().min(2, 'Name is required.').max(160),
  description: z.string().max(500).optional(),
  managerUserId: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']),
});

type DepartmentFormValues = z.infer<typeof formSchema>;

export function WorkspaceDepartmentsPage() {
  const workspaceId = useSessionStore((state) => state.selectedWorkspaceId);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [users, setUsers] = useState<WorkspaceUser[]>([]);
  const [editing, setEditing] = useState<Department | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<DepartmentFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: '', description: '', managerUserId: 'NONE', status: 'ACTIVE' },
  });

  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    setLoading(true);
    setError(null);
    void Promise.all([
      listDepartments({
        workspaceId,
        pageSize: 50,
        search: search.trim().length >= 2 ? search.trim() : undefined,
        status: status === 'ALL' ? undefined : status,
      }),
      listWorkspaceUsers({ workspaceId, pageSize: 100, status: 'ACTIVE' }),
    ])
      .then(([departmentPage, userPage]) => {
        if (!active) return;
        setDepartments(departmentPage.items);
        setUsers(userPage.items);
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
  }, [search, status, workspaceId]);

  function startCreate() {
    setEditing(null);
    form.reset({ name: '', description: '', managerUserId: 'NONE', status: 'ACTIVE' });
    setOpen(true);
  }

  function startEdit(department: Department) {
    setEditing(department);
    form.reset({
      name: department.name,
      description: department.description ?? '',
      managerUserId: department.manager?.id ?? 'NONE',
      status: department.status,
    });
    setOpen(true);
  }

  async function submit(values: DepartmentFormValues) {
    if (!workspaceId) return;
    const body = {
      ...values,
      description: values.description?.trim() || undefined,
      managerUserId: values.managerUserId === 'NONE' ? undefined : values.managerUserId,
    };
    const saved = editing
      ? await updateDepartment(workspaceId, editing.id, {
          ...body,
          managerUserId: values.managerUserId === 'NONE' ? null : values.managerUserId,
        })
      : await createDepartment(workspaceId, body);
    setDepartments((items) =>
      editing ? items.map((item) => (item.id === saved.id ? saved : item)) : [saved, ...items],
    );
    setOpen(false);
  }

  const hasFilters = Boolean(search || status !== 'ALL');

  return (
    <PageContainer>
      <PageHeader
        title="Departments"
        description="Workspace-scoped departments, managers, and member visibility."
        actions={
          <Button onClick={startCreate}>
            <Plus className="h-4 w-4" /> New department
          </Button>
        }
      />
      <Card>
        <CardContent className="grid gap-3 pt-6 md:grid-cols-[1fr_180px]">
          <Input
            aria-label="Search departments"
            placeholder="Search departments"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger label="Status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All status</SelectItem>
              <SelectItem value="ACTIVE">ACTIVE</SelectItem>
              <SelectItem value="INACTIVE">INACTIVE</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>
      {loading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-44 w-full" />
          ))}
        </div>
      ) : error ? (
        <EmptyState title="Could not load departments" description={error} />
      ) : departments.length === 0 ? (
        <EmptyState
          title={hasFilters ? 'No matching departments' : 'No departments'}
          description="Create a workspace department to organize members."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {departments.map((department) => (
            <Card key={department.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Building2 className="h-4 w-4" /> {department.name}
                    </CardTitle>
                    <CardDescription>{department.description ?? 'No description'}</CardDescription>
                  </div>
                  <Badge variant={department.status === 'ACTIVE' ? 'success' : 'neutral'}>
                    {department.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3">
                <p className="text-sm text-[hsl(var(--muted-foreground))]">
                  Manager: {department.manager?.name ?? department.manager?.email ?? 'Unassigned'}
                </p>
                <p className="text-sm text-[hsl(var(--muted-foreground))]">
                  Members: {department.memberCount}
                </p>
                <Button variant="secondary" onClick={() => startEdit(department)}>
                  Edit
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit department' : 'Create department'}</DialogTitle>
          </DialogHeader>
          <form className="grid gap-4" onSubmit={(event) => void form.handleSubmit(submit)(event)}>
            <Input
              label="Name"
              error={form.formState.errors.name?.message}
              {...form.register('name')}
            />
            <Textarea
              label="Description"
              error={form.formState.errors.description?.message}
              {...form.register('description')}
            />
            <Select
              value={form.watch('managerUserId')}
              onValueChange={(value) => form.setValue('managerUserId', value)}
            >
              <SelectTrigger label="Manager">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">No manager</SelectItem>
                {users.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.name ?? user.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={form.watch('status')}
              onValueChange={(value) =>
                form.setValue('status', value as DepartmentFormValues['status'])
              }
            >
              <SelectTrigger label="Status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ACTIVE">ACTIVE</SelectItem>
                <SelectItem value="INACTIVE">INACTIVE</SelectItem>
              </SelectContent>
            </Select>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">{editing ? 'Save changes' : 'Create'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
