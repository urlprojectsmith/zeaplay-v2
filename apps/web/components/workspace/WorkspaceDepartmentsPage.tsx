'use client';

import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Building2, Plus } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { toast } from 'sonner';
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
import { useLanguage } from '../../contexts/language-provider';
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
  const { locale, t } = useLanguage();
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
    try {
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
      toast.success(t(locale, 'workspaceDepartments.saved'));
    } catch (nextError) {
      toast.error(
        nextError instanceof Error
          ? nextError.message
          : t(locale, 'workspaceDepartments.saveFailed'),
      );
    }
  }

  const hasFilters = Boolean(search || status !== 'ALL');

  return (
    <PageContainer>
      <PageHeader
        title={t(locale, 'workspaceDepartments.title')}
        description={t(locale, 'workspaceDepartments.description')}
        actions={
          <Button onClick={startCreate}>
            <Plus className="h-4 w-4" /> {t(locale, 'workspaceDepartments.newDepartment')}
          </Button>
        }
      />
      <Card>
        <CardContent className="grid gap-3 pt-6 md:grid-cols-[1fr_180px]">
          <Input
            aria-label="Search departments"
            placeholder={t(locale, 'workspaceDepartments.searchPlaceholder')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger label={t(locale, 'workspaceDepartments.status')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t(locale, 'workspaceDepartments.allStatus')}</SelectItem>
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
        <EmptyState title={t(locale, 'workspaceDepartments.loadError')} description={error} />
      ) : departments.length === 0 ? (
        <EmptyState
          title={
            hasFilters
              ? t(locale, 'workspaceDepartments.noMatchingDepartments')
              : t(locale, 'workspaceDepartments.noDepartments')
          }
          description={t(locale, 'workspaceDepartments.emptyDescription')}
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
                    <CardDescription>
                      {department.description ?? t(locale, 'workspaceDepartments.noDescription')}
                    </CardDescription>
                  </div>
                  <Badge variant={department.status === 'ACTIVE' ? 'success' : 'neutral'}>
                    {department.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3">
                <p className="text-sm text-[hsl(var(--muted-foreground))]">
                  {t(locale, 'workspaceDepartments.manager')}:{' '}
                  {department.manager?.name ??
                    department.manager?.email ??
                    t(locale, 'workspaceDepartments.unassigned')}
                </p>
                <p className="text-sm text-[hsl(var(--muted-foreground))]">
                  {t(locale, 'workspaceDepartments.members')}: {department.memberCount}
                </p>
                <Button variant="secondary" onClick={() => startEdit(department)}>
                  {t(locale, 'workspaceDepartments.edit')}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing
                ? t(locale, 'workspaceDepartments.editDepartment')
                : t(locale, 'workspaceDepartments.createDepartment')}
            </DialogTitle>
          </DialogHeader>
          <form className="grid gap-4" onSubmit={(event) => void form.handleSubmit(submit)(event)}>
            <Input
              label={t(locale, 'workspaceDepartments.name')}
              error={
                form.formState.errors.name
                  ? t(locale, 'workspaceDepartments.nameRequired')
                  : undefined
              }
              {...form.register('name')}
            />
            <Textarea
              label={t(locale, 'workspaceDepartments.descriptionField')}
              error={form.formState.errors.description?.message}
              {...form.register('description')}
            />
            <Select
              value={form.watch('managerUserId')}
              onValueChange={(value) => form.setValue('managerUserId', value)}
            >
              <SelectTrigger label={t(locale, 'workspaceDepartments.manager')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">{t(locale, 'workspaceDepartments.noManager')}</SelectItem>
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
              <SelectTrigger label={t(locale, 'workspaceDepartments.status')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ACTIVE">ACTIVE</SelectItem>
                <SelectItem value="INACTIVE">INACTIVE</SelectItem>
              </SelectContent>
            </Select>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                {t(locale, 'workspaceDepartments.cancel')}
              </Button>
              <Button type="submit">
                {editing
                  ? t(locale, 'workspaceDepartments.saveChanges')
                  : t(locale, 'workspaceDepartments.create')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
