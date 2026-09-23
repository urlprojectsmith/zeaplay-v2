'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  CardContent,
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
  Textarea,
} from '@zea-play/ui';
import { PauseCircle, PlayCircle, Plus, Rocket, Save } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useLanguage } from '../../../contexts/language-provider';
import {
  AutomationActionDraft,
  AutomationActionType,
  AutomationConditionOperator,
  AutomationTriggerType,
  AutomationWorkflow,
  automationKeys,
  automationActionTypes,
  automationTriggerTypes,
  createWorkspaceAutomation,
  disableAutomation,
  enableAutomation,
  listWorkspaceAutomations,
  publishAutomation,
  updateAutomationDraft,
} from '../../../services/workspace-automations';
import { useSessionStore } from '../../../stores/session';
import { PageContainer } from '../../layout/PageContainer';
import { PageHeader } from '../../layout/PageHeader';

const automationLabelKeys = [
  'title',
  'description',
  'createWorkflow',
  'name',
  'descriptionField',
  'trigger',
  'action',
  'condition',
  'branch',
  'variable',
  'operator',
  'true',
  'false',
  'default',
  'addCase',
  'selectedBranch',
  'equals',
  'notEquals',
  'in',
  'notIn',
  'exists',
  'notExists',
  'actionTitle',
  'targetId',
  'statusDefinition',
  'saveDraft',
  'publish',
  'disable',
  'enable',
  'version',
  'updated',
  'draft',
  'published',
  'disabled',
  'archived',
  'noAutomations',
  'emptyDescription',
  'validationError',
  'publishConfirmTitle',
  'publishConfirmDescription',
  'cancel',
  'created',
  'draftSaved',
  'publishedToast',
  'disabledToast',
  'enabledToast',
  'loadError',
  'requiredName',
] as const;

type AutomationLabels = Record<(typeof automationLabelKeys)[number], string>;

export function WorkspaceAutomationsPage() {
  const { locale, t } = useLanguage();
  const labels = Object.fromEntries(
    automationLabelKeys.map((key) => [key, t(locale, `workspaceAutomations.${key}`)]),
  ) as AutomationLabels;
  const workspaceId = useSessionStore((state) => state.selectedWorkspaceId);
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [publishTarget, setPublishTarget] = useState<AutomationWorkflow | null>(null);
  const [draftTriggerByWorkflow, setDraftTriggerByWorkflow] = useState<
    Record<string, AutomationTriggerType>
  >({});
  const [draftActionByWorkflow, setDraftActionByWorkflow] = useState<
    Record<string, AutomationActionDraft>
  >({});
  const [form, setForm] = useState({
    name: '',
    description: '',
    triggerType: 'TASK_CREATED' as AutomationTriggerType,
    workflowKind: 'ACTION' as 'ACTION' | 'CONDITION' | 'BRANCH',
    actionType: 'CREATE_TASK' as AutomationActionType,
    actionTitle: '',
    targetId: '',
    statusDefinitionId: '',
    conditionLeft: '{{trigger.task.priority}}',
    conditionOperator: 'EQUALS' as AutomationConditionOperator,
    conditionRight: 'HIGH',
    branchKey: 'HIGH',
    branchDefaultKey: 'DEFAULT',
  });

  const automationsQuery = useQuery({
    queryKey: automationKeys.list(workspaceId, 1),
    queryFn: () => listWorkspaceAutomations(workspaceId as string, 1),
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: automationKeys.all(workspaceId) });

  const createMutation = useMutation({
    mutationFn: () => {
      if (form.name.trim().length < 2) throw new Error(labels.requiredName);
      return createWorkspaceAutomation(workspaceId as string, {
        name: form.name.trim(),
        description: form.description.trim() || null,
        triggerType: form.triggerType,
        action: formActionDraft(form),
        condition:
          form.workflowKind === 'CONDITION'
            ? {
                left: form.conditionLeft,
                operator: form.conditionOperator,
                right: form.conditionRight,
              }
            : null,
        branch:
          form.workflowKind === 'BRANCH'
            ? {
                cases: [
                  {
                    key: form.branchKey,
                    left: form.conditionLeft,
                    operator: form.conditionOperator,
                    right: form.conditionRight,
                  },
                ],
                defaultKey: form.branchDefaultKey,
              }
            : null,
      });
    },
    onSuccess: async () => {
      toast.success(labels.created);
      setCreateOpen(false);
      setForm({
        name: '',
        description: '',
        triggerType: 'TASK_CREATED',
        workflowKind: 'ACTION',
        actionType: 'CREATE_TASK',
        actionTitle: '',
        targetId: '',
        statusDefinitionId: '',
        conditionLeft: '{{trigger.task.priority}}',
        conditionOperator: 'EQUALS',
        conditionRight: 'HIGH',
        branchKey: 'HIGH',
        branchDefaultKey: 'DEFAULT',
      });
      await invalidate();
    },
    onError: (error) => toast.error(errorMessage(error, labels.validationError)),
  });

  const saveDraftMutation = useMutation({
    mutationFn: ({
      workflowId,
      triggerType,
      action,
    }: {
      workflowId: string;
      triggerType: AutomationTriggerType;
      action?: AutomationActionDraft | null;
    }) => updateAutomationDraft(workspaceId as string, workflowId, triggerType, action),
    onSuccess: async () => {
      toast.success(labels.draftSaved);
      await invalidate();
    },
    onError: (error) => toast.error(errorMessage(error, labels.validationError)),
  });

  const publishMutation = useMutation({
    mutationFn: (workflowId: string) => publishAutomation(workspaceId as string, workflowId),
    onSuccess: async () => {
      toast.success(labels.publishedToast);
      setPublishTarget(null);
      await invalidate();
    },
    onError: (error) => toast.error(errorMessage(error, labels.validationError)),
  });

  const disableMutation = useMutation({
    mutationFn: ({ workflowId, disabled }: { workflowId: string; disabled: boolean }) =>
      disabled
        ? enableAutomation(workspaceId as string, workflowId)
        : disableAutomation(workspaceId as string, workflowId),
    onSuccess: async (_data, variables) => {
      toast.success(variables.disabled ? labels.enabledToast : labels.disabledToast);
      await invalidate();
    },
    onError: (error) => toast.error(errorMessage(error, labels.validationError)),
  });

  const workflows = automationsQuery.data?.items ?? [];

  return (
    <PageContainer>
      <PageHeader
        title={labels.title}
        description={labels.description}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> {labels.createWorkflow}
          </Button>
        }
      />
      {automationsQuery.isLoading ? (
        <AutomationSkeleton />
      ) : automationsQuery.isError ? (
        <EmptyState title={labels.loadError} description={labels.validationError} />
      ) : workflows.length === 0 ? (
        <EmptyState
          title={labels.noAutomations}
          description={labels.emptyDescription}
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> {labels.createWorkflow}
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3">
          {workflows.map((workflow) => {
            const selectedTrigger = draftTriggerByWorkflow[workflow.id] ?? 'TASK_CREATED';
            const selectedAction = draftActionByWorkflow[workflow.id] ?? {
              actionType: 'CREATE_TASK',
              title: 'Automation task',
            };
            return (
              <Card key={workflow.id}>
                <CardContent className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_190px_190px_220px] lg:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="break-words font-semibold">{workflow.name}</p>
                      <Badge variant={statusVariant(workflow.status)}>
                        {statusLabel(workflow.status, labels)}
                      </Badge>
                      {workflow.hasDraft ? <Badge variant="info">{labels.draft}</Badge> : null}
                    </div>
                    <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
                      {workflow.description || labels.descriptionField}
                    </p>
                    <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
                      {labels.version}: {workflow.currentVersion ?? '-'} · {labels.updated}:{' '}
                      {new Date(workflow.updatedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <Select
                    value={selectedTrigger}
                    onValueChange={(value) =>
                      setDraftTriggerByWorkflow((current) => ({
                        ...current,
                        [workflow.id]: value as AutomationTriggerType,
                      }))
                    }
                  >
                    <SelectTrigger label={labels.trigger}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {automationTriggerTypes.map((trigger) => (
                        <SelectItem key={trigger} value={trigger}>
                          {triggerLabel(trigger)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={selectedAction.actionType}
                    onValueChange={(value) =>
                      setDraftActionByWorkflow((current) => ({
                        ...current,
                        [workflow.id]: {
                          ...selectedAction,
                          actionType: value as AutomationActionType,
                        },
                      }))
                    }
                  >
                    <SelectTrigger label={labels.action}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {automationActionTypes.map((action) => (
                        <SelectItem key={action} value={action}>
                          {automationTypeLabel(action)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex flex-wrap gap-2 lg:justify-end">
                    <Button
                      variant="outline"
                      onClick={() =>
                        saveDraftMutation.mutate({
                          workflowId: workflow.id,
                          triggerType: selectedTrigger,
                          action: selectedAction,
                        })
                      }
                    >
                      <Save className="h-4 w-4" /> {labels.saveDraft}
                    </Button>
                    <Button variant="outline" onClick={() => setPublishTarget(workflow)}>
                      <Rocket className="h-4 w-4" /> {labels.publish}
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={!workflow.activePublishedVersionId}
                      onClick={() =>
                        disableMutation.mutate({
                          workflowId: workflow.id,
                          disabled: workflow.status === 'DISABLED',
                        })
                      }
                    >
                      {workflow.status === 'DISABLED' ? (
                        <PlayCircle className="h-4 w-4" />
                      ) : (
                        <PauseCircle className="h-4 w-4" />
                      )}
                      {workflow.status === 'DISABLED' ? labels.enable : labels.disable}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{labels.createWorkflow}</DialogTitle>
            <DialogDescription>{labels.description}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Input
              label={labels.name}
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            />
            <Textarea
              label={labels.descriptionField}
              value={form.description}
              onChange={(event) =>
                setForm((current) => ({ ...current, description: event.target.value }))
              }
            />
            <Select
              value={form.triggerType}
              onValueChange={(value) =>
                setForm((current) => ({ ...current, triggerType: value as AutomationTriggerType }))
              }
            >
              <SelectTrigger label={labels.trigger}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {automationTriggerTypes.map((trigger) => (
                  <SelectItem key={trigger} value={trigger}>
                    {triggerLabel(trigger)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={form.actionType}
              onValueChange={(value) =>
                setForm((current) => ({ ...current, actionType: value as AutomationActionType }))
              }
            >
              <SelectTrigger label={labels.action}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {automationActionTypes.map((action) => (
                  <SelectItem key={action} value={action}>
                    {automationTypeLabel(action)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={form.workflowKind}
              onValueChange={(value) =>
                setForm((current) => ({
                  ...current,
                  workflowKind: value as 'ACTION' | 'CONDITION' | 'BRANCH',
                }))
              }
            >
              <SelectTrigger label={labels.selectedBranch}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ACTION">{labels.action}</SelectItem>
                <SelectItem value="CONDITION">{labels.condition}</SelectItem>
                <SelectItem value="BRANCH">{labels.branch}</SelectItem>
              </SelectContent>
            </Select>
            {form.workflowKind !== 'ACTION' ? (
              <div className="grid gap-3 rounded-md border border-[hsl(var(--border))] p-3 sm:grid-cols-2">
                <Input
                  label={labels.variable}
                  value={form.conditionLeft}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, conditionLeft: event.target.value }))
                  }
                />
                <Select
                  value={form.conditionOperator}
                  onValueChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      conditionOperator: value as AutomationConditionOperator,
                    }))
                  }
                >
                  <SelectTrigger label={labels.operator}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {conditionOperators.map((operator) => (
                      <SelectItem key={operator} value={operator}>
                        {conditionOperatorLabel(operator, labels)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!['EXISTS', 'NOT_EXISTS'].includes(form.conditionOperator) ? (
                  <Input
                    label={form.workflowKind === 'BRANCH' ? labels.selectedBranch : labels.true}
                    value={form.conditionRight}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, conditionRight: event.target.value }))
                    }
                  />
                ) : null}
                {form.workflowKind === 'BRANCH' ? (
                  <>
                    <Input
                      label={labels.branch}
                      value={form.branchKey}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, branchKey: event.target.value }))
                      }
                    />
                    <Input
                      label={labels.default}
                      value={form.branchDefaultKey}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          branchDefaultKey: event.target.value,
                        }))
                      }
                    />
                  </>
                ) : null}
                <div className="text-xs text-[hsl(var(--muted-foreground))] sm:col-span-2">
                  {variableHints(form.triggerType).join(' · ')}
                </div>
              </div>
            ) : null}
            {form.actionType === 'CREATE_TASK' ? (
              <Input
                label={labels.actionTitle}
                value={form.actionTitle}
                onChange={(event) =>
                  setForm((current) => ({ ...current, actionTitle: event.target.value }))
                }
              />
            ) : (
              <Input
                label={labels.targetId}
                value={form.targetId}
                onChange={(event) =>
                  setForm((current) => ({ ...current, targetId: event.target.value }))
                }
              />
            )}
            {form.actionType.includes('STATUS') ? (
              <Input
                label={labels.statusDefinition}
                value={form.statusDefinitionId}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    statusDefinitionId: event.target.value,
                  }))
                }
              />
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              {labels.cancel}
            </Button>
            <Button loading={createMutation.isPending} onClick={() => createMutation.mutate()}>
              {labels.createWorkflow}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(publishTarget)}
        onOpenChange={(open) => !open && setPublishTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{labels.publishConfirmTitle}</DialogTitle>
            <DialogDescription>{labels.publishConfirmDescription}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPublishTarget(null)}>
              {labels.cancel}
            </Button>
            <Button
              loading={publishMutation.isPending}
              onClick={() => publishTarget && publishMutation.mutate(publishTarget.id)}
            >
              <Rocket className="h-4 w-4" /> {labels.publish}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}

function AutomationSkeleton() {
  return (
    <div className="grid gap-3">
      {Array.from({ length: 4 }).map((_, index) => (
        <Skeleton key={index} className="h-32 w-full" />
      ))}
    </div>
  );
}

function statusVariant(status: AutomationWorkflow['status']) {
  if (status === 'PUBLISHED') return 'success';
  if (status === 'DISABLED') return 'warning';
  return 'neutral';
}

function statusLabel(status: AutomationWorkflow['status'], labels: AutomationLabels) {
  if (status === 'PUBLISHED') return labels.published;
  if (status === 'DISABLED') return labels.disabled;
  if (status === 'ARCHIVED') return labels.archived;
  return labels.draft;
}

function automationTypeLabel(value: AutomationTriggerType | AutomationActionType) {
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

const triggerLabel = automationTypeLabel;

function formActionDraft(form: {
  actionType: AutomationActionType;
  actionTitle: string;
  targetId: string;
  statusDefinitionId: string;
}): AutomationActionDraft {
  return {
    actionType: form.actionType,
    title: form.actionTitle,
    targetId: form.targetId,
    statusDefinitionId: form.statusDefinitionId,
  };
}

const conditionOperators: AutomationConditionOperator[] = [
  'EQUALS',
  'NOT_EQUALS',
  'IN',
  'NOT_IN',
  'EXISTS',
  'NOT_EXISTS',
];

function conditionOperatorLabel(operator: AutomationConditionOperator, labels: AutomationLabels) {
  const map: Record<AutomationConditionOperator, string> = {
    EQUALS: labels.equals,
    NOT_EQUALS: labels.notEquals,
    IN: labels.in,
    NOT_IN: labels.notIn,
    EXISTS: labels.exists,
    NOT_EXISTS: labels.notExists,
  };
  return map[operator];
}

function variableHints(triggerType: AutomationTriggerType) {
  if (triggerType.startsWith('PROJECT_')) {
    return ['{{trigger.project.id}}', '{{trigger.project.xpCategory}}', '{{event.entityId}}'];
  }
  if (triggerType.startsWith('TICKET_')) {
    return ['{{trigger.ticket.id}}', '{{trigger.ticket.priority}}', '{{event.entityId}}'];
  }
  return ['{{trigger.task.id}}', '{{trigger.task.priority}}', '{{event.entityId}}'];
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
