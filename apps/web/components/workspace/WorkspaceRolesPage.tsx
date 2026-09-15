'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
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
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  cn,
} from '@zea-play/ui';
import { Copy, LockKeyhole, Plus, Save, Search, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { useLanguage } from '../../contexts/language-provider';
import { useSessionStore } from '../../stores/session';
import { PageContainer } from '../layout/PageContainer';
import { PageHeader } from '../layout/PageHeader';
import {
  cloneWorkspaceRole,
  createWorkspaceRole,
  getWorkspaceRole,
  listWorkspacePermissions,
  listWorkspaceRoles,
  permissionsKeys,
  replaceWorkspaceRolePermissions,
  rolesKeys,
  updateWorkspaceRole,
} from '../../services/workspace-roles';
import type { WorkspacePermission, WorkspaceRole } from '../../services/workspace-roles';

const roleFormSchema = z.object({
  name: z.string().trim().min(2, 'Role name is required.').max(80),
  description: z.string().max(240).optional(),
});

type RoleFormValues = z.infer<typeof roleFormSchema>;
type RoleFilter = 'ALL' | 'SYSTEM' | 'CUSTOM' | 'ACTIVE' | 'INACTIVE';

export function WorkspaceRolesPage() {
  const { locale, t } = useLanguage();
  const queryClient = useQueryClient();
  const workspaceId = useSessionStore((state) => state.selectedWorkspaceId);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<RoleFilter>('ALL');
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [draftPermissionIds, setDraftPermissionIds] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [cloneSource, setCloneSource] = useState<WorkspaceRole | null>(null);
  const [dirty, setDirty] = useState(false);

  const rolesQuery = useQuery({
    queryKey: rolesKeys.all(workspaceId),
    queryFn: () => listWorkspaceRoles(workspaceId as string),
    enabled: Boolean(workspaceId),
  });
  const permissionsQuery = useQuery({
    queryKey: permissionsKeys.catalog(workspaceId),
    queryFn: () => listWorkspacePermissions(workspaceId as string),
    enabled: Boolean(workspaceId),
  });
  const detailQuery = useQuery({
    queryKey: rolesKeys.detail(workspaceId, selectedRoleId),
    queryFn: () => getWorkspaceRole(workspaceId as string, selectedRoleId as string),
    enabled: Boolean(workspaceId && selectedRoleId),
  });

  const roles = rolesQuery.data ?? [];
  const permissions = permissionsQuery.data ?? [];
  const selectedRole = detailQuery.data ?? roles.find((role) => role.id === selectedRoleId) ?? null;

  useEffect(() => {
    if (!roles.length) {
      setSelectedRoleId(null);
      return;
    }
    setSelectedRoleId((current) => {
      const firstRole = roles[0];
      return current && roles.some((role) => role.id === current)
        ? current
        : (firstRole?.id ?? null);
    });
  }, [roles, workspaceId]);

  useEffect(() => {
    setDirty(false);
    setDraftPermissionIds(new Set(selectedRole?.permissions.map((permission) => permission.id)));
  }, [selectedRole?.id, selectedRole?.permissions]);

  useEffect(() => {
    setSelectedRoleId(null);
    setDirty(false);
  }, [workspaceId]);

  const visibleRoles = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return roles.filter((role) => {
      if (filter === 'SYSTEM' && !role.isSystem) return false;
      if (filter === 'CUSTOM' && role.isSystem) return false;
      if (filter === 'ACTIVE' && !role.isActive) return false;
      if (filter === 'INACTIVE' && role.isActive) return false;
      if (!needle) return true;
      return `${role.name} ${role.description ?? ''}`.toLowerCase().includes(needle);
    });
  }, [filter, roles, search]);

  const permissionGroups = useMemo(() => groupPermissions(permissions), [permissions]);

  const createForm = useForm<RoleFormValues>({
    resolver: zodResolver(roleFormSchema),
    defaultValues: { name: '', description: '' },
  });
  const editForm = useForm<RoleFormValues>({
    resolver: zodResolver(roleFormSchema),
    values: {
      name: selectedRole?.name ?? '',
      description: selectedRole?.description ?? '',
    },
  });

  const invalidateRoles = async () => {
    await queryClient.invalidateQueries({ queryKey: rolesKeys.all(workspaceId) });
    if (selectedRoleId) {
      await queryClient.invalidateQueries({
        queryKey: rolesKeys.detail(workspaceId, selectedRoleId),
      });
    }
  };

  const createMutation = useMutation({
    mutationFn: (values: RoleFormValues) =>
      createWorkspaceRole(workspaceId as string, {
        name: values.name.trim(),
        description: values.description?.trim() || undefined,
      }),
    onSuccess: async (role) => {
      toast.success(t(locale, 'workspaceRoles.roleCreated'));
      setCreateOpen(false);
      createForm.reset({ name: '', description: '' });
      await queryClient.invalidateQueries({ queryKey: rolesKeys.all(workspaceId) });
      setSelectedRoleId(role.id);
    },
    onError: (error) => toast.error(errorMessage(error, t(locale, 'workspaceRoles.createFailed'))),
  });

  const editMutation = useMutation({
    mutationFn: (values: RoleFormValues) =>
      updateWorkspaceRole(workspaceId as string, selectedRoleId as string, {
        name: values.name.trim(),
        description: values.description?.trim() || null,
      }),
    onSuccess: async () => {
      toast.success(t(locale, 'workspaceRoles.roleSaved'));
      await invalidateRoles();
    },
    onError: (error) => toast.error(errorMessage(error, t(locale, 'workspaceRoles.saveFailed'))),
  });

  const cloneMutation = useMutation({
    mutationFn: (roleId: string) => cloneWorkspaceRole(workspaceId as string, roleId),
    onSuccess: async (role) => {
      toast.success(t(locale, 'workspaceRoles.roleCloned'));
      setCloneSource(null);
      await queryClient.invalidateQueries({ queryKey: rolesKeys.all(workspaceId) });
      setSelectedRoleId(role.id);
    },
    onError: (error) => toast.error(errorMessage(error, t(locale, 'workspaceRoles.cloneFailed'))),
  });

  const statusMutation = useMutation({
    mutationFn: ({ roleId, isActive }: { roleId: string; isActive: boolean }) =>
      updateWorkspaceRole(workspaceId as string, roleId, { isActive }),
    onSuccess: async () => {
      toast.success(t(locale, 'workspaceRoles.statusSaved'));
      await invalidateRoles();
    },
    onError: (error) => toast.error(errorMessage(error, t(locale, 'workspaceRoles.statusFailed'))),
  });

  const permissionMutation = useMutation({
    mutationFn: () =>
      replaceWorkspaceRolePermissions(
        workspaceId as string,
        selectedRoleId as string,
        Array.from(draftPermissionIds),
      ),
    onSuccess: async () => {
      toast.success(t(locale, 'workspaceRoles.permissionsSaved'));
      setDirty(false);
      await invalidateRoles();
    },
    onError: (error) =>
      toast.error(errorMessage(error, t(locale, 'workspaceRoles.delegationDenied'))),
  });

  function selectRole(roleId: string) {
    if (dirty && !window.confirm(t(locale, 'workspaceRoles.discardChanges'))) return;
    setSelectedRoleId(roleId);
  }

  function setPermission(permissionId: string, checked: boolean) {
    setDraftPermissionIds((current) => {
      const next = new Set(current);
      if (checked) next.add(permissionId);
      else next.delete(permissionId);
      return next;
    });
    setDirty(true);
  }

  function setPermissionGroup(group: PermissionGroup, checked: boolean) {
    setDraftPermissionIds((current) => {
      const next = new Set(current);
      for (const permission of group.permissions) {
        if (checked) next.add(permission.id);
        else next.delete(permission.id);
      }
      return next;
    });
    setDirty(true);
  }

  const loading = rolesQuery.isLoading || permissionsQuery.isLoading;

  return (
    <PageContainer>
      <PageHeader
        title={t(locale, 'workspaceRoles.title')}
        description={t(locale, 'workspaceRoles.description')}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> {t(locale, 'workspaceRoles.createRole')}
          </Button>
        }
      />
      <Tabs defaultValue="roles">
        <TabsList aria-label={t(locale, 'workspaceRoles.tabs')}>
          <TabsTrigger value="roles">{t(locale, 'workspaceRoles.rolesTab')}</TabsTrigger>
          <TabsTrigger value="matrix">{t(locale, 'workspaceRoles.matrixTab')}</TabsTrigger>
        </TabsList>
        <TabsContent value="roles">
          <div className="grid gap-4 xl:grid-cols-[minmax(280px,420px)_1fr]">
            <Card>
              <CardContent className="grid gap-3 pt-5">
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-[hsl(var(--muted-foreground))]" />
                  <Input
                    aria-label={t(locale, 'workspaceRoles.searchRoles')}
                    className="pl-9"
                    placeholder={t(locale, 'workspaceRoles.searchPlaceholder')}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
                <Select value={filter} onValueChange={(value) => setFilter(value as RoleFilter)}>
                  <SelectTrigger label={t(locale, 'workspaceRoles.filter')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['ALL', 'SYSTEM', 'CUSTOM', 'ACTIVE', 'INACTIVE'] as const).map((item) => (
                      <SelectItem key={item} value={item}>
                        {t(locale, `workspaceRoles.filter${item}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>
            <RoleDetailSkeleton hidden={!loading} />
          </div>
          {loading ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(280px,420px)_1fr]">
              <RoleListSkeleton />
              <RoleDetailSkeleton />
            </div>
          ) : rolesQuery.isError || permissionsQuery.isError ? (
            <EmptyState
              title={t(locale, 'workspaceRoles.loadError')}
              description={t(locale, 'workspaceRoles.retryDescription')}
            />
          ) : visibleRoles.length === 0 ? (
            <EmptyState
              title={
                roles.length === 0
                  ? t(locale, 'workspaceRoles.noRoles')
                  : t(locale, 'workspaceRoles.noMatchingRoles')
              }
              description={t(locale, 'workspaceRoles.emptyDescription')}
            />
          ) : (
            <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(280px,420px)_1fr]">
              <RoleList
                roles={visibleRoles}
                selectedRoleId={selectedRoleId}
                onSelect={selectRole}
                onClone={setCloneSource}
                labels={{
                  system: t(locale, 'workspaceRoles.system'),
                  custom: t(locale, 'workspaceRoles.custom'),
                  active: t(locale, 'workspaceRoles.active'),
                  inactive: t(locale, 'workspaceRoles.inactive'),
                  permissions: t(locale, 'workspaceRoles.permissions'),
                  clone: t(locale, 'workspaceRoles.clone'),
                  protected: t(locale, 'workspaceRoles.protected'),
                  noDescription: t(locale, 'workspaceRoles.noDescription'),
                }}
              />
              {selectedRole ? (
                <RoleDetail
                  role={selectedRole}
                  permissions={permissions}
                  permissionGroups={permissionGroups}
                  draftPermissionIds={draftPermissionIds}
                  dirty={dirty}
                  editForm={editForm}
                  savingRole={editMutation.isPending}
                  savingStatus={statusMutation.isPending}
                  savingPermissions={permissionMutation.isPending}
                  onEdit={(event) =>
                    void editForm.handleSubmit((values) => editMutation.mutate(values))(event)
                  }
                  onStatusChange={(isActive) =>
                    statusMutation.mutate({ roleId: selectedRole.id, isActive })
                  }
                  onTogglePermission={setPermission}
                  onToggleGroup={setPermissionGroup}
                  onSelectAll={() => {
                    setDraftPermissionIds(new Set(permissions.map((permission) => permission.id)));
                    setDirty(true);
                  }}
                  onClear={() => {
                    setDraftPermissionIds(new Set());
                    setDirty(true);
                  }}
                  onReset={() => {
                    setDraftPermissionIds(
                      new Set(selectedRole.permissions.map((permission) => permission.id)),
                    );
                    setDirty(false);
                  }}
                  onSavePermissions={() => permissionMutation.mutate()}
                  labels={roleLabels(locale, t)}
                />
              ) : null}
            </div>
          )}
        </TabsContent>
        <TabsContent value="matrix">
          <Card>
            <CardHeader>
              <CardTitle>{t(locale, 'workspaceRoles.matrixTab')}</CardTitle>
              <CardDescription>{t(locale, 'workspaceRoles.matrixDescription')}</CardDescription>
            </CardHeader>
            <CardContent>
              {permissionsQuery.isLoading ? (
                <RoleListSkeleton />
              ) : (
                <CatalogMatrix groups={permissionGroups} labels={roleLabels(locale, t)} />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      <CreateRoleDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        form={createForm}
        onSubmit={(event) =>
          void createForm.handleSubmit((values) => createMutation.mutate(values))(event)
        }
        loading={createMutation.isPending}
        labels={roleLabels(locale, t)}
      />
      <CloneRoleDialog
        source={cloneSource}
        loading={cloneMutation.isPending}
        onOpenChange={(open) => {
          if (!open) setCloneSource(null);
        }}
        onClone={(roleId) => cloneMutation.mutate(roleId)}
        labels={roleLabels(locale, t)}
      />
    </PageContainer>
  );
}

function RoleList({
  roles,
  selectedRoleId,
  onSelect,
  onClone,
  labels,
}: {
  roles: WorkspaceRole[];
  selectedRoleId: string | null;
  onSelect: (roleId: string) => void;
  onClone: (role: WorkspaceRole) => void;
  labels: Record<string, string>;
}) {
  return (
    <div className="grid gap-3">
      {roles.map((role) => (
        <Card
          key={role.id}
          interactive
          className={cn(
            'p-0',
            selectedRoleId === role.id &&
              'border-[hsl(var(--ring))] ring-2 ring-[hsl(var(--ring))]',
          )}
        >
          <button
            type="button"
            className="w-full p-4 text-left focus-visible:outline-none"
            onClick={() => onSelect(role.id)}
            aria-pressed={selectedRoleId === role.id}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-semibold">{role.name}</p>
                <p className="mt-1 line-clamp-2 text-sm text-[hsl(var(--muted-foreground))]">
                  {role.description ?? labels.noDescription}
                </p>
              </div>
              {role.isSystem ? (
                <LockKeyhole className="h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge variant={role.isSystem ? 'info' : 'neutral'}>
                {role.isSystem ? labels.system : labels.custom}
              </Badge>
              <Badge variant={role.isActive ? 'success' : 'warning'}>
                {role.isActive ? labels.active : labels.inactive}
              </Badge>
              <Badge variant="neutral">
                {role.permissions.length} {labels.permissions}
              </Badge>
            </div>
          </button>
          <div className="flex justify-end border-t border-[hsl(var(--border))] px-4 py-3">
            <Button size="sm" variant="secondary" onClick={() => onClone(role)}>
              <Copy className="h-4 w-4" /> {labels.clone}
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}

function RoleDetail({
  role,
  permissionGroups,
  draftPermissionIds,
  dirty,
  editForm,
  savingRole,
  savingStatus,
  savingPermissions,
  onEdit,
  onStatusChange,
  onTogglePermission,
  onToggleGroup,
  onSelectAll,
  onClear,
  onReset,
  onSavePermissions,
  labels,
}: {
  role: WorkspaceRole;
  permissions: WorkspacePermission[];
  permissionGroups: PermissionGroup[];
  draftPermissionIds: Set<string>;
  dirty: boolean;
  editForm: ReturnType<typeof useForm<RoleFormValues>>;
  savingRole: boolean;
  savingStatus: boolean;
  savingPermissions: boolean;
  onEdit: (event: React.FormEvent<HTMLFormElement>) => void;
  onStatusChange: (isActive: boolean) => void;
  onTogglePermission: (permissionId: string, checked: boolean) => void;
  onToggleGroup: (group: PermissionGroup, checked: boolean) => void;
  onSelectAll: () => void;
  onClear: () => void;
  onReset: () => void;
  onSavePermissions: () => void;
  labels: Record<string, string>;
}) {
  const editable = !role.isSystem;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" /> {role.name}
            </CardTitle>
            <CardDescription>
              {role.isSystem ? labels.systemProtectedDescription : labels.customDescription}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={role.isSystem ? 'info' : 'neutral'}>
              {role.isSystem ? labels.system : labels.custom}
            </Badge>
            <Badge variant={role.isActive ? 'success' : 'warning'}>
              {role.isActive ? labels.active : labels.inactive}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-6">
        {editable ? (
          <form className="grid gap-3" onSubmit={onEdit}>
            <Input
              label={labels.roleName}
              error={editForm.formState.errors.name?.message}
              {...editForm.register('name')}
            />
            <Textarea
              label={labels.descriptionField}
              error={editForm.formState.errors.description?.message}
              {...editForm.register('description')}
            />
            <div className="flex flex-col gap-3 rounded-md border border-[hsl(var(--border))] p-3 sm:flex-row sm:items-center sm:justify-between">
              <Switch
                label={labels.activeRole}
                description={labels.deactivationRule}
                checked={role.isActive}
                disabled={savingStatus}
                onCheckedChange={(checked) => onStatusChange(Boolean(checked))}
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit" loading={savingRole}>
                {labels.saveRole}
              </Button>
            </div>
          </form>
        ) : (
          <div className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-muted))] p-4">
            <p className="font-semibold">{labels.systemProtected}</p>
            <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
              {role.key === 'OWNER' ? labels.ownerFullAccess : labels.systemReadOnly}
            </p>
          </div>
        )}
        <PermissionMatrix
          role={role}
          groups={permissionGroups}
          selectedIds={draftPermissionIds}
          editable={editable}
          dirty={dirty}
          saving={savingPermissions}
          onTogglePermission={onTogglePermission}
          onToggleGroup={onToggleGroup}
          onSelectAll={onSelectAll}
          onClear={onClear}
          onReset={onReset}
          onSave={onSavePermissions}
          labels={labels}
        />
      </CardContent>
    </Card>
  );
}

function PermissionMatrix({
  role,
  groups,
  selectedIds,
  editable,
  dirty,
  saving,
  onTogglePermission,
  onToggleGroup,
  onSelectAll,
  onClear,
  onReset,
  onSave,
  labels,
}: {
  role: WorkspaceRole;
  groups: PermissionGroup[];
  selectedIds: Set<string>;
  editable: boolean;
  dirty: boolean;
  saving: boolean;
  onTogglePermission: (permissionId: string, checked: boolean) => void;
  onToggleGroup: (group: PermissionGroup, checked: boolean) => void;
  onSelectAll: () => void;
  onClear: () => void;
  onReset: () => void;
  onSave: () => void;
  labels: Record<string, string>;
}) {
  return (
    <section className="grid gap-4" aria-label={`${role.name} ${labels.permissionMatrix}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-semibold">{labels.permissionMatrix}</h3>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {editable ? labels.matrixHelp : labels.readOnlyMatrix}
          </p>
        </div>
        {editable ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={onSelectAll}>
              {labels.selectAll}
            </Button>
            <Button size="sm" variant="secondary" onClick={onClear}>
              {labels.clear}
            </Button>
            <Button size="sm" variant="outline" disabled={!dirty} onClick={onReset}>
              {labels.reset}
            </Button>
            <Button size="sm" disabled={!dirty} loading={saving} onClick={onSave}>
              <Save className="h-4 w-4" /> {labels.savePermissions}
            </Button>
          </div>
        ) : null}
      </div>
      {groups.length === 0 ? (
        <EmptyState
          title={labels.noPermissions ?? 'No permissions'}
          description={labels.noPermissionsDescription ?? ''}
        />
      ) : (
        <div className="grid gap-3">
          {groups.map((group) => {
            const selectedCount = group.permissions.filter((permission) =>
              selectedIds.has(permission.id),
            ).length;
            const checked =
              selectedCount === 0
                ? false
                : selectedCount === group.permissions.length
                  ? true
                  : 'indeterminate';
            return (
              <div
                key={group.name}
                className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))]"
              >
                <div className="flex flex-col gap-3 border-b border-[hsl(var(--border))] p-4 sm:flex-row sm:items-center sm:justify-between">
                  <Checkbox
                    label={group.name}
                    description={`${selectedCount}/${group.permissions.length} ${labels.selected}`}
                    checked={checked}
                    disabled={!editable}
                    onCheckedChange={(value) => onToggleGroup(group, value === true)}
                  />
                </div>
                <div className="grid gap-3 p-4 md:grid-cols-2">
                  {group.permissions.map((permission) => (
                    <Checkbox
                      key={permission.id}
                      label={permissionLabel(permission.key, labels)}
                      description={permission.description ?? permission.key}
                      checked={selectedIds.has(permission.id)}
                      disabled={!editable}
                      onCheckedChange={(value) => onTogglePermission(permission.id, value === true)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function CatalogMatrix({
  groups,
  labels,
}: {
  groups: PermissionGroup[];
  labels: Record<string, string>;
}) {
  return (
    <div className="grid gap-3">
      {groups.map((group) => (
        <div
          key={group.name}
          className="rounded-md border border-[hsl(var(--border))] p-4"
          data-testid="permission-group"
        >
          <h3 className="font-semibold">{group.name}</h3>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {group.permissions.map((permission) => (
              <div key={permission.id} className="rounded-md bg-[hsl(var(--surface-muted))] p-3">
                <p className="text-sm font-semibold">{permissionLabel(permission.key, labels)}</p>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">{permission.key}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function CreateRoleDialog({
  open,
  onOpenChange,
  form,
  onSubmit,
  loading,
  labels,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: ReturnType<typeof useForm<RoleFormValues>>;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  loading: boolean;
  labels: Record<string, string>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{labels.createRole}</DialogTitle>
          <DialogDescription>{labels.createDescription}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={onSubmit}>
          <Input
            label={labels.roleName}
            error={form.formState.errors.name?.message}
            {...form.register('name')}
          />
          <Textarea
            label={labels.descriptionField}
            error={form.formState.errors.description?.message}
            {...form.register('description')}
          />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              {labels.cancel}
            </Button>
            <Button type="submit" loading={loading}>
              {labels.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CloneRoleDialog({
  source,
  loading,
  onOpenChange,
  onClone,
  labels,
}: {
  source: WorkspaceRole | null;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onClone: (roleId: string) => void;
  labels: Record<string, string>;
}) {
  return (
    <Dialog open={Boolean(source)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{labels.cloneRole}</DialogTitle>
          <DialogDescription>{labels.cloneDescription}</DialogDescription>
        </DialogHeader>
        {source ? (
          <div className="grid gap-3 rounded-md border border-[hsl(var(--border))] p-3">
            <p className="font-semibold">{source.name}</p>
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              {source.permissions.length} {labels.permissions}
            </p>
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            {labels.cancel}
          </Button>
          <Button loading={loading} onClick={() => source && onClone(source.id)}>
            {labels.clone}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RoleListSkeleton({ hidden = false }: { hidden?: boolean }) {
  if (hidden) return null;
  return (
    <div className="grid gap-3">
      {Array.from({ length: 4 }).map((_, index) => (
        <Skeleton key={index} className="h-36 w-full" />
      ))}
    </div>
  );
}

function RoleDetailSkeleton({ hidden = false }: { hidden?: boolean }) {
  if (hidden) return null;
  return <Skeleton className="h-96 w-full" />;
}

interface PermissionGroup {
  name: string;
  permissions: WorkspacePermission[];
}

function groupPermissions(permissions: WorkspacePermission[]): PermissionGroup[] {
  const groups = new Map<string, WorkspacePermission[]>();
  for (const permission of permissions.filter((item) => item.key !== '*')) {
    const prefix = permission.key.split('.')[0] ?? 'other';
    const group = moduleLabel(prefix);
    groups.set(group, [...(groups.get(group) ?? []), permission]);
  }
  return Array.from(groups.entries()).map(([name, items]) => ({
    name,
    permissions: items.sort((a, b) => a.key.localeCompare(b.key)),
  }));
}

function moduleLabel(prefix: string) {
  if (prefix === 'roles') return 'Roles & Permissions';
  return prefix
    .split('_')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function permissionLabel(key: string, labels: Record<string, string>) {
  const explicit = permissionLabels[key];
  if (explicit) return labels[explicit] ?? key;
  const [, action = key] = key.split('.');
  return action
    .split('_')
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

const permissionLabels: Record<string, string> = {
  'users.view': 'permissionUsersView',
  'users.manage': 'permissionUsersManage',
  'departments.view': 'permissionDepartmentsView',
  'departments.create': 'permissionDepartmentsCreate',
  'departments.update': 'permissionDepartmentsUpdate',
  'departments.manage_members': 'permissionDepartmentsManageMembers',
  'roles.view': 'permissionRolesView',
  'roles.create': 'permissionRolesCreate',
  'roles.update': 'permissionRolesUpdate',
  'roles.manage_permissions': 'permissionRolesManagePermissions',
  'roles.assign': 'permissionRolesAssign',
};

function roleLabels(
  locale: ReturnType<typeof useLanguage>['locale'],
  t: ReturnType<typeof useLanguage>['t'],
) {
  const keys = [
    'createRole',
    'roleName',
    'descriptionField',
    'create',
    'cancel',
    'clone',
    'cloneRole',
    'cloneDescription',
    'createDescription',
    'system',
    'custom',
    'active',
    'inactive',
    'permissions',
    'protected',
    'systemProtectedDescription',
    'customDescription',
    'systemProtected',
    'ownerFullAccess',
    'systemReadOnly',
    'activeRole',
    'deactivationRule',
    'saveRole',
    'permissionMatrix',
    'matrixHelp',
    'readOnlyMatrix',
    'selectAll',
    'clear',
    'reset',
    'savePermissions',
    'selected',
    'noPermissions',
    'noPermissionsDescription',
    'permissionUsersView',
    'permissionUsersManage',
    'permissionDepartmentsView',
    'permissionDepartmentsCreate',
    'permissionDepartmentsUpdate',
    'permissionDepartmentsManageMembers',
    'permissionRolesView',
    'permissionRolesCreate',
    'permissionRolesUpdate',
    'permissionRolesManagePermissions',
    'permissionRolesAssign',
  ] as const;
  return Object.fromEntries(keys.map((key) => [key, t(locale, `workspaceRoles.${key}`)]));
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) {
    if (/delegate/i.test(error.message)) return fallback;
    return error.message;
  }
  return fallback;
}
