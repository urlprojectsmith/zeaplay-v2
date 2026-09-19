'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Textarea,
  cn,
} from '@zea-play/ui';
import { CalendarClock, Check, ChevronsUpDown, Plus, Settings, UserPlus, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { useLanguage } from '../../../contexts/language-provider';
import {
  listDepartments,
  listWorkspaceUsers,
  type WorkspaceUser,
} from '../../../services/workspace-management';
import { listWorkspaceStatuses } from '../../../services/workspace-statuses';
import {
  createWorkspaceTask,
  listWorkspaceTags,
  listWorkspaceProjects,
  taskCreationKeys,
  taskDueAtFromLocalDate,
  taskDueBoundaryFromLocalDate,
  taskKeys,
  type TaskRecurrenceCustomUnit,
  type TaskRecurrenceEndMode,
  type TaskRecurrenceFrequency,
  type TaskPriority,
  type WorkspaceTagSummary,
} from '../../../services/workspace-tasks';
import { useSessionStore } from '../../../stores/session';
import { PageContainer } from '../../layout/PageContainer';
import { PageHeader } from '../../layout/PageHeader';
import { AllTasksBrowser } from './AllTasksBrowser';

const priorities = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
const noneValue = '__none__';
const recurrenceOptions = ['NONE', 'DAILY', 'WEEKDAYS', 'WEEKLY', 'MONTHLY', 'CUSTOM'] as const;
const recurrenceEndModes = ['NEVER', 'ON_DATE', 'AFTER_COUNT'] as const;
const customUnits = ['DAY', 'WEEK', 'MONTH'] as const;
const weekdays = [
  { value: 1, key: 'monday' },
  { value: 2, key: 'tuesday' },
  { value: 3, key: 'wednesday' },
  { value: 4, key: 'thursday' },
  { value: 5, key: 'friday' },
  { value: 6, key: 'saturday' },
  { value: 7, key: 'sunday' },
] as const;

const taskFormSchema = z
  .object({
    title: z.string().trim().min(1, 'Task title is required.').max(160),
    assigneeMembershipId: z.string().min(1, 'Assignee is required.'),
    plannedStartDate: z.string().optional(),
    dueDate: z.string().min(1, 'Due date is required.'),
    dueTime: z.string().optional(),
    description: z.string().max(4000).optional(),
    priority: z.enum(priorities),
    statusDefinitionId: z.string().optional(),
    departmentId: z.string().optional(),
    additionalAssigneeMembershipIds: z.array(z.string()).default([]),
    followerMembershipIds: z.array(z.string()).default([]),
    projectIds: z.array(z.string()).default([]),
    tagIds: z.array(z.string()).default([]),
    recurrenceFrequency: z.enum(recurrenceOptions).default('NONE'),
    recurrenceStartDate: z.string().optional(),
    recurrenceTime: z.string().optional(),
    recurrenceTimezone: z.string().default('UTC'),
    recurrenceWeekdays: z.array(z.number().int().min(1).max(7)).default([]),
    recurrenceInterval: z.coerce.number().int().min(1).max(365).default(1),
    recurrenceCustomUnit: z.enum(customUnits).default('DAY'),
    recurrenceEndMode: z.enum(recurrenceEndModes).default('NEVER'),
    recurrenceUntilDate: z.string().optional(),
    recurrenceMaxOccurrences: z.coerce.number().int().min(1).max(1000).default(10),
    createAnother: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.recurrenceFrequency === 'NONE') return;
    if (!value.recurrenceStartDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recurrenceStartDate'],
        message: 'Start Date is required.',
      });
    }
    if (!value.recurrenceTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recurrenceTime'],
        message: 'Time is required.',
      });
    }
    if (!value.recurrenceTimezone || !isLikelyIanaZone(value.recurrenceTimezone)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recurrenceTimezone'],
        message: 'Timezone is required.',
      });
    }
    if (value.recurrenceFrequency === 'WEEKLY' && value.recurrenceWeekdays.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recurrenceWeekdays'],
        message: 'Select at least one weekday.',
      });
    }
    if (
      value.recurrenceEndMode === 'ON_DATE' &&
      (!value.recurrenceUntilDate || value.recurrenceUntilDate < (value.recurrenceStartDate ?? ''))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recurrenceUntilDate'],
        message: 'End Date must be on or after Start Date.',
      });
    }
  });

type TaskFormValues = z.infer<typeof taskFormSchema>;

export function WorkspaceTasksPage() {
  const { locale, t } = useLanguage();
  const labels = taskLabels(locale, t);
  const workspaceId = useSessionStore((state) => state.selectedWorkspaceId);
  const accessToken = useSessionStore((state) => state.accessToken);
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (!accessToken) setCreateOpen(false);
  }, [accessToken]);

  useQuery({
    queryKey: taskCreationKeys.statuses(workspaceId),
    queryFn: () => listWorkspaceStatuses(workspaceId as string, 'TASK', 'ACTIVE'),
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
  });
  useQuery({
    queryKey: taskCreationKeys.departments(workspaceId),
    queryFn: () =>
      listDepartments({ workspaceId: workspaceId as string, pageSize: 100, status: 'ACTIVE' }),
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
  });
  return (
    <PageContainer>
      <PageHeader
        title={labels.title}
        description={labels.description}
        actions={
          <Button disabled={!workspaceId} onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden="true" className="h-4 w-4" />
            {labels.createTask}
          </Button>
        }
      />
      <AllTasksBrowser workspaceId={workspaceId} />
      <TaskCreateDialog
        labels={labels}
        open={createOpen}
        workspaceId={workspaceId}
        onOpenChange={setCreateOpen}
        onCreated={async () => {
          await queryClient.invalidateQueries({ queryKey: taskKeys.all(workspaceId) });
        }}
      />
    </PageContainer>
  );
}

export function TaskCreateDialog({
  labels,
  open,
  workspaceId,
  prefill,
  onPrefillConsumed,
  onOpenChange,
  onCreated,
}: {
  labels: TaskLabels;
  open: boolean;
  workspaceId: string | null;
  prefill?: Partial<TaskFormValues> | null;
  onPrefillConsumed?: () => void;
  onOpenChange: (open: boolean) => void;
  onCreated: () => Promise<void>;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewData>(defaultPreviewData);
  const workspaceTimezone = useSessionStore((state) => {
    for (const agency of state.agencies) {
      const workspace = agency.workspaces.find((item) => item.id === workspaceId);
      if (workspace) return workspace.timezone;
    }
    return 'UTC';
  });
  const form = useForm<TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: defaultTaskForm(workspaceTimezone),
    mode: 'onSubmit',
  });
  const previousWorkspaceKeyRef = useRef(`${workspaceId}:${workspaceTimezone}`);
  const values = useWatch({ control: form.control });
  const activeWorkspaceId = workspaceId;
  const statusesQuery = useQuery({
    queryKey: taskCreationKeys.statuses(workspaceId),
    queryFn: () => listWorkspaceStatuses(workspaceId as string, 'TASK', 'ACTIVE'),
    enabled: Boolean(workspaceId) && open,
    staleTime: 30_000,
  });

  useEffect(() => {
    const workspaceKey = `${workspaceId}:${workspaceTimezone}`;
    if (previousWorkspaceKeyRef.current === workspaceKey) return;
    previousWorkspaceKeyRef.current = workspaceKey;
    form.reset(defaultTaskForm(workspaceTimezone));
    setPreviewData(defaultPreviewData);
    setAdvancedOpen(false);
    if (open) onOpenChange(false);
  }, [form, onOpenChange, open, workspaceId, workspaceTimezone]);

  const createMutation = useMutation({
    mutationFn: (data: TaskFormValues) => {
      if (!activeWorkspaceId) throw new Error(labels.noWorkspace);
      const assigneeMembershipIds = uniqueIds([
        data.assigneeMembershipId,
        ...data.additionalAssigneeMembershipIds,
      ]);
      const recurrence =
        data.recurrenceFrequency !== 'NONE' && data.recurrenceStartDate && data.recurrenceTime
          ? {
              timezone: data.recurrenceTimezone,
              frequency: data.recurrenceFrequency as TaskRecurrenceFrequency,
              interval: data.recurrenceFrequency === 'CUSTOM' ? data.recurrenceInterval : 1,
              ...(data.recurrenceFrequency === 'CUSTOM'
                ? { customIntervalUnit: data.recurrenceCustomUnit as TaskRecurrenceCustomUnit }
                : {}),
              startLocalDate: data.recurrenceStartDate,
              localTime: data.recurrenceTime,
              ...(data.recurrenceFrequency === 'WEEKLY'
                ? { selectedWeekdays: data.recurrenceWeekdays }
                : {}),
              ...(data.recurrenceFrequency === 'MONTHLY'
                ? { monthlyDay: Number(data.recurrenceStartDate.split('-')[2]) }
                : {}),
              endMode: data.recurrenceEndMode as TaskRecurrenceEndMode,
              ...(data.recurrenceEndMode === 'ON_DATE'
                ? { untilLocalDate: data.recurrenceUntilDate }
                : {}),
              ...(data.recurrenceEndMode === 'AFTER_COUNT'
                ? { maxOccurrences: data.recurrenceMaxOccurrences }
                : {}),
            }
          : undefined;
      return createWorkspaceTask(activeWorkspaceId, {
        title: data.title,
        ...(data.plannedStartDate
          ? { plannedStartAt: taskDueBoundaryFromLocalDate(data.plannedStartDate, 'start') }
          : {}),
        dueAt: taskDueAtFromLocalDate(data.dueDate, data.dueTime),
        assigneeMembershipIds,
        ...(data.description?.trim() ? { description: data.description } : {}),
        ...(data.priority === 'MEDIUM' ? {} : { priority: data.priority }),
        ...(data.statusDefinitionId ? { statusDefinitionId: data.statusDefinitionId } : {}),
        ...(data.departmentId ? { departmentId: data.departmentId } : {}),
        ...(data.followerMembershipIds.length
          ? { followerMembershipIds: data.followerMembershipIds }
          : {}),
        ...(data.projectIds.length ? { projectIds: data.projectIds } : {}),
        ...(data.tagIds.length ? { tagIds: data.tagIds } : {}),
        ...(recurrence ? { recurrence } : {}),
      });
    },
    onSuccess: async (_task, data) => {
      toast.success(labels.created);
      await onCreated();
      const keepOpen = data.createAnother;
      form.reset({ ...defaultTaskForm(workspaceTimezone), createAnother: keepOpen });
      setPreviewData(defaultPreviewData);
      setAdvancedOpen(false);
      if (!keepOpen) onOpenChange(false);
    },
    onError: (error) => {
      const message = errorMessage(error, labels);
      if (/title/i.test(message)) form.setError('title', { message });
      else if (/assignee|membership/i.test(message))
        form.setError('assigneeMembershipId', { message });
      else if (/status/i.test(message)) form.setError('statusDefinitionId', { message });
      toast.error(message);
    },
  });

  useEffect(() => {
    if (!open || !prefill) return;
    form.reset({ ...defaultTaskForm(workspaceTimezone), ...prefill });
    setAdvancedOpen(true);
    onPrefillConsumed?.();
  }, [form, onPrefillConsumed, open, prefill]);

  function requestOpenChange(nextOpen: boolean) {
    if (!nextOpen && form.formState.isDirty && !window.confirm(labels.discardChanges)) return;
    if (!nextOpen) {
      form.reset(defaultTaskForm(workspaceTimezone));
      setPreviewData(defaultPreviewData);
      setAdvancedOpen(false);
    }
    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={requestOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{labels.createTask}</DialogTitle>
          <DialogDescription>{labels.quickCreateDescription}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="grid gap-5"
          onSubmit={(event) => {
            if (createMutation.isPending) {
              event.preventDefault();
              return;
            }
            void form.handleSubmit((data) => {
              if (
                statusesQuery.data &&
                statusesQuery.data.length === 0 &&
                !data.statusDefinitionId
              ) {
                form.setError('statusDefinitionId', {
                  message: labels.statusConfigurationRequired,
                });
                toast.error(labels.statusConfigurationRequired);
                return;
              }
              if (!createMutation.isPending) createMutation.mutate(data);
            })(event);
          }}
        >
          <div className={cn('grid gap-5', advancedOpen && 'lg:grid-cols-[minmax(0,1fr)_320px]')}>
            <div className="grid gap-4">
              <TaskQuickCreateForm
                form={form}
                labels={labels}
                workspaceId={workspaceId}
                onPreviewChange={(patch) => setPreviewData((current) => ({ ...current, ...patch }))}
              />
              <Button
                type="button"
                variant="secondary"
                className="justify-start"
                aria-expanded={advancedOpen}
                onClick={() => setAdvancedOpen((value) => !value)}
              >
                <Plus aria-hidden="true" className="h-4 w-4" />
                {labels.addMoreDetails}
              </Button>
              {advancedOpen ? (
                <TaskAdvancedFields
                  form={form}
                  labels={labels}
                  workspaceId={workspaceId}
                  primaryAssigneeId={form.watch('assigneeMembershipId')}
                  onPreviewChange={(patch) =>
                    setPreviewData((current) => ({ ...current, ...patch }))
                  }
                />
              ) : null}
            </div>
            {advancedOpen ? (
              <TaskLivePreview values={values} preview={previewData} labels={labels} />
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => requestOpenChange(false)}>
              {labels.cancel}
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? labels.creating : labels.createTask}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TaskQuickCreateForm({
  form,
  labels,
  workspaceId,
  onPreviewChange,
}: {
  form: ReturnType<typeof useForm<TaskFormValues>>;
  labels: TaskLabels;
  workspaceId: string | null;
  onPreviewChange: (patch: Partial<PreviewData>) => void;
}) {
  return (
    <div className="grid gap-4">
      <Input
        autoFocus
        label={labels.titleLabel}
        required
        error={form.formState.errors.title?.message}
        {...form.register('title')}
      />
      <Controller
        control={form.control}
        name="assigneeMembershipId"
        render={({ field, fieldState }) => (
          <TaskUserSelector
            label={labels.assignee}
            required
            workspaceId={workspaceId}
            mode="single"
            selectedIds={field.value ? [field.value] : []}
            onChange={(ids) => field.onChange(ids[0] ?? '')}
            onSelectedChange={(users) =>
              onPreviewChange({ assignees: users.map((user) => displayUser(user)) })
            }
            error={fieldState.error?.message}
            labels={labels}
          />
        )}
      />
      <Input
        label={labels.dueDate}
        required
        type="date"
        error={form.formState.errors.dueDate?.message}
        {...form.register('dueDate')}
      />
    </div>
  );
}

function TaskAdvancedFields({
  form,
  labels,
  workspaceId,
  primaryAssigneeId,
  onPreviewChange,
}: {
  form: ReturnType<typeof useForm<TaskFormValues>>;
  labels: TaskLabels;
  workspaceId: string | null;
  primaryAssigneeId: string;
  onPreviewChange: (patch: Partial<PreviewData>) => void;
}) {
  const statusesQuery = useQuery({
    queryKey: taskCreationKeys.statuses(workspaceId),
    queryFn: () => listWorkspaceStatuses(workspaceId as string, 'TASK', 'ACTIVE'),
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
  });
  const departmentsQuery = useQuery({
    queryKey: taskCreationKeys.departments(workspaceId),
    queryFn: () =>
      listDepartments({ workspaceId: workspaceId as string, pageSize: 100, status: 'ACTIVE' }),
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
  });
  const activeStatuses = statusesQuery.data ?? [];
  const activeDepartments = departmentsQuery.data?.items ?? [];
  const defaultStatus = activeStatuses.find((status) => status.isDefault);

  return (
    <div className="grid gap-4 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
      <Textarea label={labels.descriptionField} {...form.register('description')} />
      <Controller
        control={form.control}
        name="priority"
        render={({ field }) => (
          <Select value={field.value} onValueChange={field.onChange}>
            <SelectTrigger label={labels.priority}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {priorities.map((priority) => (
                <SelectItem key={priority} value={priority}>
                  {labels[`priority${priority}`]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
      <Controller
        control={form.control}
        name="statusDefinitionId"
        render={({ field, fieldState }) => (
          <Select
            value={field.value || noneValue}
            onValueChange={(value) => {
              const next = value === noneValue ? '' : value;
              field.onChange(next);
              onPreviewChange({
                statusName: activeStatuses.find((status) => status.id === next)?.name ?? '',
              });
            }}
          >
            <SelectTrigger label={labels.status} error={fieldState.error?.message}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={noneValue}>
                {defaultStatus
                  ? `${labels.defaultStatus}: ${defaultStatus.name}`
                  : labels.backendDefault}
              </SelectItem>
              {activeStatuses.map((status) => (
                <SelectItem key={status.id} value={status.id}>
                  {status.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
      {!statusesQuery.isLoading && activeStatuses.length === 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[hsl(var(--danger))]">
          <span>{labels.statusConfigurationRequired}</span>
          <a
            className="inline-flex items-center gap-1 rounded underline outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
            href="/workspace/statuses?type=TASK"
          >
            <Settings aria-hidden="true" className="h-3.5 w-3.5" />
            {labels.configureTaskStatuses}
          </a>
        </div>
      ) : null}
      <Controller
        control={form.control}
        name="additionalAssigneeMembershipIds"
        render={({ field }) => (
          <TaskUserSelector
            label={labels.additionalAssignees}
            workspaceId={workspaceId}
            mode="multiple"
            selectedIds={field.value.filter((id) => id !== primaryAssigneeId)}
            onChange={(ids) => field.onChange(ids.filter((id) => id !== primaryAssigneeId))}
            onSelectedChange={(users) =>
              onPreviewChange({ additionalAssignees: users.map((user) => displayUser(user)) })
            }
            labels={labels}
          />
        )}
      />
      <Controller
        control={form.control}
        name="followerMembershipIds"
        render={({ field }) => (
          <TaskUserSelector
            label={labels.followers}
            workspaceId={workspaceId}
            mode="multiple"
            selectedIds={field.value}
            onChange={field.onChange}
            onSelectedChange={(users) =>
              onPreviewChange({ followers: users.map((user) => displayUser(user)) })
            }
            labels={labels}
          />
        )}
      />
      <Controller
        control={form.control}
        name="departmentId"
        render={({ field }) => (
          <Select
            value={field.value || noneValue}
            onValueChange={(value) => {
              const next = value === noneValue ? '' : value;
              field.onChange(next);
              onPreviewChange({
                departmentName:
                  activeDepartments.find((department) => department.id === next)?.name ?? '',
              });
            }}
          >
            <SelectTrigger label={labels.department}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={noneValue}>{labels.none}</SelectItem>
              {activeDepartments.map((department) => (
                <SelectItem key={department.id} value={department.id}>
                  {department.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
      {!departmentsQuery.isLoading && activeDepartments.length === 0 ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">{labels.noDepartments}</p>
      ) : null}
      <Controller
        control={form.control}
        name="projectIds"
        render={({ field }) => (
          <TaskProjectSelector
            label={labels.projects}
            workspaceId={workspaceId}
            selectedIds={field.value}
            onChange={field.onChange}
            onSelectedChange={(projects) =>
              onPreviewChange({ projects: projects.map((project) => project.name) })
            }
            labels={labels}
          />
        )}
      />
      <Controller
        control={form.control}
        name="tagIds"
        render={({ field }) => (
          <TaskTagSelector
            label={labels.tags}
            workspaceId={workspaceId}
            selectedIds={field.value}
            onChange={field.onChange}
            labels={labels}
          />
        )}
      />
      <Input label={labels.plannedStart} type="date" {...form.register('plannedStartDate')} />
      <Input label={labels.dueTime} type="time" {...form.register('dueTime')} />
      <TaskRecurrenceFields form={form} labels={labels} />
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input className="h-4 w-4" type="checkbox" {...form.register('createAnother')} />
        {labels.createAnother}
      </label>
    </div>
  );
}

function TaskRecurrenceFields({
  form,
  labels,
}: {
  form: ReturnType<typeof useForm<TaskFormValues>>;
  labels: TaskLabels;
}) {
  const frequency = form.watch('recurrenceFrequency');
  const endMode = form.watch('recurrenceEndMode');
  const timezone = form.watch('recurrenceTimezone') || 'UTC';

  useEffect(() => {
    if (frequency !== 'WEEKLY') {
      form.setValue('recurrenceWeekdays', [], { shouldDirty: false, shouldValidate: true });
    }
    if (frequency !== 'CUSTOM') {
      form.setValue('recurrenceInterval', 1, { shouldDirty: false, shouldValidate: true });
      form.setValue('recurrenceCustomUnit', 'DAY', { shouldDirty: false, shouldValidate: true });
    }
    if (frequency === 'NONE') {
      form.setValue('recurrenceEndMode', 'NEVER', { shouldDirty: false, shouldValidate: true });
      form.setValue('recurrenceUntilDate', '', { shouldDirty: false, shouldValidate: true });
      form.setValue('recurrenceMaxOccurrences', 1, { shouldDirty: false, shouldValidate: true });
    }
  }, [form, frequency]);

  useEffect(() => {
    if (endMode !== 'ON_DATE') {
      form.setValue('recurrenceUntilDate', '', { shouldDirty: false, shouldValidate: true });
    }
    if (endMode !== 'AFTER_COUNT') {
      form.setValue('recurrenceMaxOccurrences', 1, { shouldDirty: false, shouldValidate: true });
    }
  }, [endMode, form]);

  return (
    <section className="grid gap-3 rounded-md border border-[hsl(var(--border))] p-3">
      <Controller
        control={form.control}
        name="recurrenceFrequency"
        render={({ field }) => (
          <Select value={field.value} onValueChange={field.onChange}>
            <SelectTrigger label={labels.repeat}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {recurrenceOptions.map((option) => (
                <SelectItem key={option} value={option}>
                  {recurrenceFrequencyLabel(option, labels)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
      {frequency !== 'NONE' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label={labels.startDate}
            type="date"
            error={form.formState.errors.recurrenceStartDate?.message}
            {...form.register('recurrenceStartDate')}
          />
          <Input
            label={labels.time}
            type="time"
            error={form.formState.errors.recurrenceTime?.message}
            {...form.register('recurrenceTime')}
          />
          <Input
            label={labels.timezone}
            value={timezone}
            error={form.formState.errors.recurrenceTimezone?.message}
            onChange={(event) => form.setValue('recurrenceTimezone', event.target.value)}
          />
          {frequency === 'WEEKDAYS' ? (
            <p className="self-end text-sm text-[hsl(var(--muted-foreground))]">
              {labels.mondayFriday}
            </p>
          ) : null}
          {frequency === 'WEEKLY' ? (
            <div className="grid gap-2 sm:col-span-2">
              <p className="text-sm font-semibold">{labels.repeatOn}</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label={labels.repeatOn}>
                {weekdays.map((day) => {
                  const selected = form.watch('recurrenceWeekdays').includes(day.value);
                  return (
                    <button
                      key={day.value}
                      type="button"
                      aria-pressed={selected}
                      className={cn(
                        'rounded-md border border-[hsl(var(--border))] px-3 py-2 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
                        selected &&
                          'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]',
                      )}
                      onClick={() => {
                        const current = form.getValues('recurrenceWeekdays');
                        form.setValue(
                          'recurrenceWeekdays',
                          selected
                            ? current.filter((value) => value !== day.value)
                            : [...current, day.value].sort((a, b) => a - b),
                          { shouldDirty: true, shouldValidate: true },
                        );
                      }}
                    >
                      {labels[day.key]}
                    </button>
                  );
                })}
              </div>
              {form.formState.errors.recurrenceWeekdays?.message ? (
                <p className="text-sm font-semibold text-[hsl(var(--danger))]">
                  {form.formState.errors.recurrenceWeekdays.message}
                </p>
              ) : null}
            </div>
          ) : null}
          {frequency === 'MONTHLY' ? (
            <p className="sm:col-span-2 text-sm text-[hsl(var(--muted-foreground))]">
              {labels.monthlyClampHelper}
            </p>
          ) : null}
          {frequency === 'CUSTOM' ? (
            <div className="grid gap-3 sm:col-span-2 sm:grid-cols-[1fr_1fr]">
              <Input
                label={labels.every}
                type="number"
                min={1}
                max={365}
                {...form.register('recurrenceInterval', { valueAsNumber: true })}
              />
              <Controller
                control={form.control}
                name="recurrenceCustomUnit"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger label={labels.intervalUnit}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {customUnits.map((unit) => (
                        <SelectItem key={unit} value={unit}>
                          {customUnitLabel(unit, labels)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          ) : null}
          <Controller
            control={form.control}
            name="recurrenceEndMode"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger label={labels.ends}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {recurrenceEndModes.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {endModeLabel(mode, labels)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {endMode === 'ON_DATE' ? (
            <Input
              label={labels.endDate}
              type="date"
              error={form.formState.errors.recurrenceUntilDate?.message}
              {...form.register('recurrenceUntilDate')}
            />
          ) : null}
          {endMode === 'AFTER_COUNT' ? (
            <Input
              label={labels.occurrences}
              type="number"
              min={1}
              max={1000}
              {...form.register('recurrenceMaxOccurrences', { valueAsNumber: true })}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function TaskUserSelector({
  label,
  required,
  workspaceId,
  mode,
  selectedIds,
  onChange,
  onSelectedChange,
  error,
  labels,
}: {
  label: string;
  required?: boolean;
  workspaceId: string | null;
  mode: 'single' | 'multiple';
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  onSelectedChange?: (users: WorkspaceUser[]) => void;
  error?: string;
  labels: TaskLabels;
}) {
  const [search, setSearch] = useState('');
  const [selectedCache, setSelectedCache] = useState<WorkspaceUser[]>([]);
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const usersQuery = useQuery({
    queryKey: taskCreationKeys.users(workspaceId, debouncedSearch),
    queryFn: () =>
      listWorkspaceUsers({
        workspaceId: workspaceId as string,
        page: 1,
        pageSize: 10,
        status: 'ACTIVE',
        search: debouncedSearch.length >= 2 ? debouncedSearch : undefined,
      }),
    enabled: Boolean(workspaceId),
  });
  const users = usersQuery.data?.items.filter((user) => user.membershipStatus === 'ACTIVE') ?? [];
  const selectedUsers = useMemo(
    () => mergeSelectedUsers(users, selectedCache, selectedIds),
    [users, selectedCache, selectedIds],
  );

  useEffect(() => {
    setSearch('');
    setSelectedCache([]);
  }, [workspaceId]);

  useEffect(() => {
    setSelectedCache((current) =>
      current.filter((user) => selectedIds.includes(user.membershipId)),
    );
  }, [selectedIds]);

  function toggle(user: WorkspaceUser) {
    if (mode === 'single') {
      setSelectedCache([user]);
      onChange([user.membershipId]);
      onSelectedChange?.([user]);
      return;
    }
    const selected = selectedIds.includes(user.membershipId);
    const nextIds = selected
      ? selectedIds.filter((id) => id !== user.membershipId)
      : [...selectedIds, user.membershipId];
    const nextCache = selected
      ? selectedCache.filter((item) => item.membershipId !== user.membershipId)
      : mergeSelectedUsers([user], selectedCache, nextIds);
    setSelectedCache(nextCache);
    onChange(nextIds);
    onSelectedChange?.(mergeSelectedUsers(users, nextCache, nextIds));
  }

  function remove(user: WorkspaceUser) {
    const nextIds = selectedIds.filter((id) => id !== user.membershipId);
    const nextCache = selectedCache.filter((item) => item.membershipId !== user.membershipId);
    setSelectedCache(nextCache);
    onChange(nextIds);
    onSelectedChange?.(mergeSelectedUsers(users, nextCache, nextIds));
  }

  function clearSingleSelection() {
    setSelectedCache([]);
    onChange([]);
    onSelectedChange?.([]);
  }

  return (
    <div className="grid gap-2" role="group" aria-label={label}>
      <Input
        label={label}
        required={required}
        placeholder={labels.searchPeople}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        error={error}
      />
      <div className="flex min-h-7 flex-wrap gap-2">
        {selectedUsers.map((user) => (
          <SelectionChip
            key={user.membershipId}
            label={displayUser(user)}
            onRemove={() => (mode === 'single' ? clearSingleSelection() : remove(user))}
          />
        ))}
      </div>
      <div className="grid max-h-44 gap-1 overflow-y-auto rounded-md border border-[hsl(var(--border))] p-2">
        {usersQuery.isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : users.length === 0 ? (
          <p className="px-2 py-3 text-sm text-[hsl(var(--muted-foreground))]">
            {labels.noEligibleUsers}
          </p>
        ) : (
          users.map((user) => {
            const selected = selectedIds.includes(user.membershipId);
            return (
              <button
                key={user.membershipId}
                type="button"
                className={cn(
                  'flex min-h-10 items-center justify-between rounded px-2 text-left text-sm outline-none hover:bg-[hsl(var(--surface-muted))] focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
                  selected && 'bg-[hsl(var(--surface-muted))]',
                )}
                onClick={() => toggle(user)}
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{displayUser(user)}</span>
                  <span className="block truncate text-xs text-[hsl(var(--muted-foreground))]">
                    {user.email}
                  </span>
                </span>
                {selected ? <Check aria-hidden="true" className="h-4 w-4 shrink-0" /> : null}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function TaskProjectSelector({
  label,
  workspaceId,
  selectedIds,
  onChange,
  onSelectedChange,
  labels,
}: {
  label: string;
  workspaceId: string | null;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  onSelectedChange?: (projects: { id: string; name: string }[]) => void;
  labels: TaskLabels;
}) {
  const [search, setSearch] = useState('');
  const [selectedCache, setSelectedCache] = useState<WorkspaceProjectPreview[]>([]);
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const projectsQuery = useQuery({
    queryKey: taskCreationKeys.projects(workspaceId, debouncedSearch),
    queryFn: () =>
      listWorkspaceProjects({
        workspaceId: workspaceId as string,
        pageSize: 10,
        search: debouncedSearch.length >= 2 ? debouncedSearch : undefined,
      }),
    enabled: Boolean(workspaceId),
  });
  const projects = projectsQuery.data?.items ?? [];
  const selectedProjects = useMemo(
    () => mergeSelectedProjects(projects, selectedCache, selectedIds),
    [projects, selectedCache, selectedIds],
  );

  useEffect(() => {
    setSearch('');
    setSelectedCache([]);
  }, [workspaceId]);

  useEffect(() => {
    setSelectedCache((current) => current.filter((project) => selectedIds.includes(project.id)));
  }, [selectedIds]);

  return (
    <div className="grid gap-2" role="group" aria-label={label}>
      <Input
        label={label}
        placeholder={labels.searchProjects}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="flex min-h-7 flex-wrap gap-2">
        {selectedProjects.map((project) => (
          <SelectionChip
            key={project.id}
            label={project.name}
            onRemove={() => {
              const nextIds = selectedIds.filter((id) => id !== project.id);
              const nextCache = selectedCache.filter((item) => item.id !== project.id);
              setSelectedCache(nextCache);
              onChange(nextIds);
              onSelectedChange?.(mergeSelectedProjects(projects, nextCache, nextIds));
            }}
          />
        ))}
      </div>
      <div className="grid max-h-36 gap-1 overflow-y-auto rounded-md border border-[hsl(var(--border))] p-2">
        {projectsQuery.isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : projects.length === 0 ? (
          <p className="px-2 py-3 text-sm text-[hsl(var(--muted-foreground))]">
            {labels.noProjects}
          </p>
        ) : (
          projects.map((project) => {
            const selected = selectedIds.includes(project.id);
            return (
              <button
                key={project.id}
                type="button"
                className={cn(
                  'flex min-h-10 items-center justify-between rounded px-2 text-left text-sm outline-none hover:bg-[hsl(var(--surface-muted))] focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
                  selected && 'bg-[hsl(var(--surface-muted))]',
                )}
                onClick={() => {
                  const nextIds = selected
                    ? selectedIds.filter((id) => id !== project.id)
                    : [...selectedIds, project.id];
                  const nextCache = selected
                    ? selectedCache.filter((item) => item.id !== project.id)
                    : mergeSelectedProjects([project], selectedCache, nextIds);
                  setSelectedCache(nextCache);
                  onChange(nextIds);
                  onSelectedChange?.(mergeSelectedProjects(projects, nextCache, nextIds));
                }}
              >
                <span className="truncate font-semibold">{project.name}</span>
                {selected ? <Check aria-hidden="true" className="h-4 w-4 shrink-0" /> : null}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function TaskTagSelector({
  label,
  workspaceId,
  selectedIds,
  onChange,
  labels,
}: {
  label: string;
  workspaceId: string | null;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  labels: TaskLabels;
}) {
  const [search, setSearch] = useState('');
  const [selectedCache, setSelectedCache] = useState<WorkspaceTagSummary[]>([]);
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const tagsQuery = useQuery({
    queryKey: taskKeys.tagCatalog(workspaceId, {
      page: 1,
      pageSize: 10,
      search: debouncedSearch,
      status: 'ACTIVE',
      sortBy: 'name',
      sortDirection: 'asc',
    }),
    queryFn: () =>
      listWorkspaceTags(workspaceId as string, {
        page: 1,
        pageSize: 10,
        status: 'ACTIVE',
        search: debouncedSearch.length >= 2 ? debouncedSearch : undefined,
        sortBy: 'name',
        sortDirection: 'asc',
      }),
    enabled: Boolean(workspaceId),
  });
  const tags = tagsQuery.data?.items.filter((tag) => tag.status === 'ACTIVE') ?? [];
  const selectedTags = useMemo(
    () => mergeSelectedTags(tags, selectedCache, selectedIds),
    [tags, selectedCache, selectedIds],
  );

  useEffect(() => {
    setSearch('');
    setSelectedCache([]);
  }, [workspaceId]);

  return (
    <div className="grid gap-2" role="group" aria-label={label}>
      <Input
        label={label}
        placeholder={labels.searchTags}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="flex min-h-7 flex-wrap gap-2">
        {selectedTags.map((tag) => (
          <SelectionChip
            key={tag.id}
            label={tag.name}
            onRemove={() => {
              const nextIds = selectedIds.filter((id) => id !== tag.id);
              setSelectedCache((current) => current.filter((item) => item.id !== tag.id));
              onChange(nextIds);
            }}
          />
        ))}
      </div>
      <div className="grid max-h-36 gap-1 overflow-y-auto rounded-md border border-[hsl(var(--border))] p-2">
        {tagsQuery.isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : tags.length === 0 ? (
          <p className="px-2 py-3 text-sm text-[hsl(var(--muted-foreground))]">
            {labels.noTagsFound}
          </p>
        ) : (
          tags.map((tag) => {
            const selected = selectedIds.includes(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                className={cn(
                  'flex min-h-10 items-center justify-between rounded px-2 text-left text-sm outline-none hover:bg-[hsl(var(--surface-muted))] focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
                  selected && 'bg-[hsl(var(--surface-muted))]',
                )}
                onClick={() => {
                  const nextIds = selected
                    ? selectedIds.filter((id) => id !== tag.id)
                    : uniqueIds([...selectedIds, tag.id]).slice(0, 50);
                  setSelectedCache((current) => mergeSelectedTags([tag], current, nextIds));
                  onChange(nextIds);
                }}
              >
                <span className="truncate font-semibold">{tag.name}</span>
                {selected ? <Check aria-hidden="true" className="h-4 w-4 shrink-0" /> : null}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function TaskLivePreview({
  values,
  preview,
  labels,
}: {
  values: Partial<TaskFormValues>;
  preview: PreviewData;
  labels: TaskLabels;
}) {
  return (
    <aside className="grid content-start gap-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
      <div className="flex items-center gap-2">
        <ChevronsUpDown aria-hidden="true" className="h-4 w-4" />
        <h2 className="font-semibold">{labels.preview}</h2>
      </div>
      <p className="break-words text-lg font-semibold">
        {values.title?.trim() || labels.untitledTask}
      </p>
      <PreviewRow
        icon={<UserPlus className="h-4 w-4" />}
        label={labels.assignee}
        value={preview.assignees[0] ?? labels.notSelected}
      />
      {preview.additionalAssignees.length ? (
        <PreviewRow
          icon={<UserPlus className="h-4 w-4" />}
          label={labels.additionalAssignees}
          value={preview.additionalAssignees.join(', ')}
        />
      ) : null}
      <PreviewRow
        icon={<CalendarClock className="h-4 w-4" />}
        label={labels.dueDate}
        value={
          values.dueDate
            ? formatPreviewDueDate(values.dueDate, values.dueTime, labels)
            : labels.notSelected
        }
      />
      <div className="flex flex-wrap gap-2">
        <Badge variant={priorityBadge(values.priority ?? 'MEDIUM')}>
          {labels[`priority${values.priority ?? 'MEDIUM'}`]}
        </Badge>
        {values.statusDefinitionId ? (
          <Badge variant="neutral">{preview.statusName || labels.statusSelected}</Badge>
        ) : null}
        {values.departmentId ? (
          <Badge variant="neutral">{preview.departmentName || labels.departmentSelected}</Badge>
        ) : null}
        {values.projectIds?.length ? (
          <Badge variant="info">
            {labels.projects}: {preview.projects.join(', ') || values.projectIds.length}
          </Badge>
        ) : null}
        {values.followerMembershipIds?.length ? (
          <Badge variant="neutral">
            {labels.followers}:{' '}
            {preview.followers.join(', ') || values.followerMembershipIds.length}
          </Badge>
        ) : null}
      </div>
    </aside>
  );
}

function PreviewRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-[hsl(var(--muted-foreground))]">{icon}</span>
      <span className="font-semibold">{label}</span>
      <span className="min-w-0 truncate text-[hsl(var(--muted-foreground))]">{value}</span>
    </div>
  );
}

function SelectionChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-[hsl(var(--muted))] px-2.5 py-1 text-xs font-semibold">
      <span className="truncate">{label}</span>
      <button
        type="button"
        className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
      >
        <X aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

function useDebouncedValue(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

function defaultTaskForm(timezone = defaultTimezone()): TaskFormValues {
  return {
    title: '',
    assigneeMembershipId: '',
    plannedStartDate: '',
    dueDate: '',
    dueTime: '',
    description: '',
    priority: 'MEDIUM',
    statusDefinitionId: '',
    departmentId: '',
    additionalAssigneeMembershipIds: [],
    followerMembershipIds: [],
    projectIds: [],
    tagIds: [],
    recurrenceFrequency: 'NONE',
    recurrenceStartDate: '',
    recurrenceTime: '',
    recurrenceTimezone: timezone,
    recurrenceWeekdays: [],
    recurrenceInterval: 1,
    recurrenceCustomUnit: 'DAY',
    recurrenceEndMode: 'NEVER',
    recurrenceUntilDate: '',
    recurrenceMaxOccurrences: 10,
    createAnother: false,
  };
}

interface PreviewData {
  assignees: string[];
  additionalAssignees: string[];
  followers: string[];
  projects: string[];
  statusName: string;
  departmentName: string;
}

const defaultPreviewData: PreviewData = {
  assignees: [],
  additionalAssignees: [],
  followers: [],
  projects: [],
  statusName: '',
  departmentName: '',
};

function uniqueIds(ids: string[]) {
  return Array.from(new Set(ids.filter(Boolean)));
}

function displayUser(user: WorkspaceUser) {
  return user.name ?? user.email;
}

type WorkspaceProjectPreview = { id: string; name: string };

function mergeSelectedUsers(
  visible: WorkspaceUser[],
  cached: WorkspaceUser[],
  selectedIds: string[],
) {
  return selectedIds
    .map(
      (id) =>
        visible.find((user) => user.membershipId === id) ??
        cached.find((user) => user.membershipId === id),
    )
    .filter(Boolean) as WorkspaceUser[];
}

function mergeSelectedProjects(
  visible: WorkspaceProjectPreview[],
  cached: WorkspaceProjectPreview[],
  selectedIds: string[],
) {
  return selectedIds
    .map(
      (id) =>
        visible.find((project) => project.id === id) ?? cached.find((project) => project.id === id),
    )
    .filter(Boolean) as WorkspaceProjectPreview[];
}

function mergeSelectedTags(
  visible: WorkspaceTagSummary[],
  cached: WorkspaceTagSummary[],
  selectedIds: string[],
) {
  return selectedIds
    .map((id) => visible.find((tag) => tag.id === id) ?? cached.find((tag) => tag.id === id))
    .filter(Boolean) as WorkspaceTagSummary[];
}

function priorityBadge(priority: TaskPriority) {
  if (priority === 'URGENT') return 'danger' as const;
  if (priority === 'HIGH') return 'warning' as const;
  if (priority === 'LOW') return 'neutral' as const;
  return 'info' as const;
}

function formatPreviewDueDate(date: string, time: string | undefined, labels: TaskLabels) {
  const iso = taskDueAtFromLocalDate(date, time);
  if (!iso) return labels.notSelected;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    ...(time ? { timeStyle: 'short' as const } : {}),
  }).format(new Date(iso));
}

function errorMessage(error: unknown, labels: TaskLabels) {
  const status =
    typeof error === 'object' && error && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : undefined;
  if (status === 403) return labels.permissionDenied;
  if (status === 404) return labels.staleRelation;
  if (status === 409) return labels.conflictError;
  if (status === 422) return error instanceof Error ? error.message : labels.createFailed;
  if (error instanceof TypeError) return labels.networkError;
  return error instanceof Error ? error.message : labels.createFailed;
}

function defaultTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function isLikelyIanaZone(value: string) {
  return /^[A-Za-z]+\/[A-Za-z0-9_+/-]+$/.test(value) || value === 'UTC';
}

function recurrenceFrequencyLabel(value: (typeof recurrenceOptions)[number], labels: TaskLabels) {
  const map = {
    NONE: labels.doesNotRepeat,
    DAILY: labels.daily,
    WEEKDAYS: labels.weekdays,
    WEEKLY: labels.weekly,
    MONTHLY: labels.monthly,
    CUSTOM: labels.custom,
  };
  return map[value];
}

function customUnitLabel(value: TaskRecurrenceCustomUnit, labels: TaskLabels) {
  if (value === 'WEEK') return labels.weeks;
  if (value === 'MONTH') return labels.months;
  return labels.days;
}

function endModeLabel(value: TaskRecurrenceEndMode, labels: TaskLabels) {
  if (value === 'ON_DATE') return labels.onDate;
  if (value === 'AFTER_COUNT') return labels.afterOccurrences;
  return labels.never;
}

export type TaskLabels = ReturnType<typeof taskLabels>;

export function taskLabels(
  locale: Parameters<ReturnType<typeof useLanguage>['t']>[0],
  t: ReturnType<typeof useLanguage>['t'],
) {
  const keys = [
    'title',
    'description',
    'createTask',
    'quickCreateDescription',
    'titleLabel',
    'assignee',
    'additionalAssignees',
    'plannedStart',
    'dueDate',
    'dueTime',
    'addMoreDetails',
    'descriptionField',
    'priority',
    'status',
    'department',
    'followers',
    'projects',
    'tags',
    'searchTags',
    'noTagsFound',
    'repeat',
    'doesNotRepeat',
    'daily',
    'weekdays',
    'weekly',
    'monthly',
    'custom',
    'startDate',
    'time',
    'timezone',
    'repeatOn',
    'mondayFriday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
    'monthlyClampHelper',
    'every',
    'intervalUnit',
    'days',
    'weeks',
    'months',
    'ends',
    'never',
    'onDate',
    'afterOccurrences',
    'endDate',
    'occurrences',
    'recurringTasks',
    'recurringTasksDescription',
    'noRecurringTasks',
    'noRecurringTasksDescription',
    'all',
    'nextOccurrence',
    'generatedCount',
    'lastGenerated',
    'seriesStatus',
    'active',
    'paused',
    'ended',
    'needsAttention',
    'pause',
    'resume',
    'endRecurrence',
    'recurrenceUpdated',
    'recurrenceActionFailed',
    'taskTemplates',
    'taskTemplatesDescription',
    'createTemplate',
    'editTemplate',
    'useTemplate',
    'saveAsTemplate',
    'archiveTemplate',
    'reactivateTemplate',
    'templateName',
    'searchTemplates',
    'archived',
    'noTemplates',
    'noTemplatesFound',
    'templateDialogDescription',
    'archiveTemplateConfirmation',
    'saveTemplateDescription',
    'saveTemplateCopyWarning',
    'templateSaved',
    'templateUpdated',
    'templateActionFailed',
    'outdatedFieldsWarning',
    'errorTitle',
    'page',
    'previous',
    'next',
    'updated',
    'emptyDash',
    'save',
    'preview',
    'create',
    'creating',
    'cancel',
    'createAnother',
    'priorityLOW',
    'priorityMEDIUM',
    'priorityHIGH',
    'priorityURGENT',
    'emptyTitle',
    'emptyDescription',
    'noDueDate',
    'searchPeople',
    'searchProjects',
    'searchTasks',
    'noEligibleUsers',
    'noDepartments',
    'noProjects',
    'none',
    'backendDefault',
    'defaultStatus',
    'statusConfigurationRequired',
    'configureTaskStatuses',
    'untitledTask',
    'selected',
    'notSelected',
    'statusSelected',
    'departmentSelected',
    'created',
    'createFailed',
    'permissionDenied',
    'staleRelation',
    'conflictError',
    'networkError',
    'discardChanges',
    'noWorkspace',
  ] as const;
  return Object.fromEntries(keys.map((key) => [key, t(locale, `workspaceTasks.${key}`)])) as Record<
    (typeof keys)[number],
    string
  >;
}
