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
import {
  Archive,
  Copy,
  Eye,
  LayoutTemplate,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Rocket,
  Settings,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { useLanguage } from '../../../contexts/language-provider';
import {
  type AutomationActionDraft,
  type AutomationActionType,
  type AutomationConditionOperator,
  type AutomationExecutionDetail,
  type AutomationExecutionStatus,
  type AutomationRuntimePolicy,
  type AutomationTriggerType,
  type AutomationWorkflow,
  type AutomationWorkflowTemplate,
  archiveAutomationTemplate,
  automationActionTypes,
  automationKeys,
  automationTriggerTypes,
  createWorkspaceAutomation,
  disableAutomation,
  enableAutomation,
  getAutomationTemplate,
  getAutomationExecution,
  getAutomationHealth,
  getAutomationRuntimePolicy,
  listAutomationTemplates,
  listAutomationExecutions,
  listWorkspaceAutomations,
  publishAutomation,
  replayAutomationExecution,
  updateAutomationRuntimePolicy,
  useAutomationTemplate,
} from '../../../services/workspace-automations';
import { useSessionStore } from '../../../stores/session';
import { PageContainer } from '../../layout/PageContainer';
import { PageHeader } from '../../layout/PageHeader';

const automationLabelKeys = [
  'title',
  'description',
  'createWorkflow',
  'workflowBuilder',
  'name',
  'descriptionField',
  'trigger',
  'action',
  'condition',
  'branch',
  'variable',
  'operator',
  'true',
  'default',
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
  'publishedToast',
  'disabledToast',
  'enabledToast',
  'loadError',
  'requiredName',
  'executions',
  'settings',
  'running',
  'succeeded',
  'failed',
  'deadLettered',
  'blocked',
  'replay',
  'replayExecution',
  'replayReason',
  'stepTimeline',
  'attempts',
  'duration',
  'runtimeLimits',
  'effectiveLimit',
  'platformDefault',
  'workspaceOverride',
] as const;

type AutomationLabels = Record<(typeof automationLabelKeys)[number], string>;
type TabKey = 'workflows' | 'templates' | 'executions' | 'settings';

const initialForm = {
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
};

export function WorkspaceAutomationsPage() {
  const { locale, t } = useLanguage();
  const labels = Object.fromEntries(
    automationLabelKeys.map((key) => [key, t(locale, `workspaceAutomations.${key}`)]),
  ) as AutomationLabels;
  const workspaceId = useSessionStore((state) => state.selectedWorkspaceId);
  const queryClient = useQueryClient();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>('workflows');
  const [createOpen, setCreateOpen] = useState(false);
  const [publishTarget, setPublishTarget] = useState<AutomationWorkflow | null>(null);
  const [useTemplateTarget, setUseTemplateTarget] = useState<AutomationWorkflowTemplate | null>(
    null,
  );
  const [previewTemplateId, setPreviewTemplateId] = useState<string | null>(null);
  const [templateWorkflowName, setTemplateWorkflowName] = useState('');
  const [form, setForm] = useState(initialForm);
  const [executionStatus, setExecutionStatus] = useState<AutomationExecutionStatus | 'ALL'>('ALL');
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null);
  const [replayTarget, setReplayTarget] = useState<AutomationExecutionDetail | null>(null);
  const [replayReason, setReplayReason] = useState('');
  const [replayConfirmation, setReplayConfirmation] = useState('');
  const [policyDraft, setPolicyDraft] = useState<AutomationRuntimePolicy['effective'] | null>(null);

  const automationsQuery = useQuery({
    queryKey: automationKeys.list(workspaceId, 1),
    queryFn: () => listWorkspaceAutomations(workspaceId as string, 1),
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
  });

  const templatesQuery = useQuery({
    queryKey: automationKeys.templates(workspaceId, 1),
    queryFn: () => listAutomationTemplates(workspaceId as string, 1),
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
  });

  const templatePreviewQuery = useQuery({
    queryKey: automationKeys.templateDetail(workspaceId, previewTemplateId),
    queryFn: () => getAutomationTemplate(workspaceId as string, previewTemplateId as string),
    enabled: Boolean(workspaceId && previewTemplateId),
    staleTime: 30_000,
  });

  const executionsQuery = useQuery({
    queryKey: automationKeys.executions(workspaceId, 1, executionStatus),
    queryFn: () =>
      listAutomationExecutions(workspaceId as string, {
        page: 1,
        status: executionStatus === 'ALL' ? undefined : executionStatus,
      }),
    enabled: Boolean(workspaceId),
    staleTime: 10_000,
  });

  const selectedExecutionQuery = useQuery({
    queryKey: automationKeys.executionDetail(workspaceId, selectedExecutionId),
    queryFn: () => getAutomationExecution(workspaceId as string, selectedExecutionId as string),
    enabled: Boolean(workspaceId && selectedExecutionId),
    refetchInterval: (query) =>
      query.state.data && isTerminalExecution(query.state.data.status) ? false : 7000,
  });

  const healthQuery = useQuery({
    queryKey: automationKeys.health(workspaceId),
    queryFn: () => getAutomationHealth(workspaceId as string),
    enabled: Boolean(workspaceId),
    staleTime: 20_000,
  });

  const policyQuery = useQuery({
    queryKey: automationKeys.runtimePolicy(workspaceId),
    queryFn: () => getAutomationRuntimePolicy(workspaceId as string),
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: automationKeys.all(workspaceId) });
    await queryClient.invalidateQueries({ queryKey: automationKeys.templates(workspaceId, 1) });
    await queryClient.invalidateQueries({ queryKey: automationKeys.executions(workspaceId, 1) });
    await queryClient.invalidateQueries({ queryKey: automationKeys.health(workspaceId) });
  };

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
    onSuccess: async (workflow) => {
      toast.success(labels.created);
      setCreateOpen(false);
      setForm(initialForm);
      await invalidate();
      router.push(`/workspace/automations/${workflow.id}` as never);
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

  const useTemplateMutation = useMutation({
    mutationFn: () => {
      if (!useTemplateTarget) throw new Error(labels.validationError);
      return useAutomationTemplate(workspaceId as string, useTemplateTarget.id, {
        name: templateWorkflowName.trim() || `${useTemplateTarget.name} Workflow`,
      });
    },
    onSuccess: async (workflow) => {
      toast.success(labels.created);
      setUseTemplateTarget(null);
      setTemplateWorkflowName('');
      await invalidate();
      router.push(`/workspace/automations/${workflow.id}` as never);
    },
    onError: (error) => toast.error(errorMessage(error, labels.validationError)),
  });

  const archiveTemplateMutation = useMutation({
    mutationFn: (templateId: string) =>
      archiveAutomationTemplate(workspaceId as string, templateId),
    onSuccess: async () => {
      toast.success(labels.archived);
      await invalidate();
    },
    onError: (error) => toast.error(errorMessage(error, labels.validationError)),
  });

  const replayMutation = useMutation({
    mutationFn: () => {
      if (!replayTarget || replayConfirmation !== 'REPLAY') throw new Error(labels.validationError);
      return replayAutomationExecution(workspaceId as string, replayTarget.id, {
        reason: replayReason.trim(),
        confirmation: 'REPLAY',
        idempotencyKey: `replay-${replayTarget.id}-${Date.now()}`,
      });
    },
    onSuccess: async (execution) => {
      toast.success(labels.replayExecution);
      setReplayTarget(null);
      setReplayReason('');
      setReplayConfirmation('');
      setSelectedExecutionId(execution.id);
      await invalidate();
    },
    onError: (error) => toast.error(errorMessage(error, labels.validationError)),
  });

  const policyMutation = useMutation({
    mutationFn: () => {
      if (!policyDraft) throw new Error(labels.validationError);
      return updateAutomationRuntimePolicy(workspaceId as string, policyDraft);
    },
    onSuccess: async () => {
      toast.success(labels.runtimeLimits);
      await queryClient.invalidateQueries({ queryKey: automationKeys.runtimePolicy(workspaceId) });
    },
    onError: (error) => toast.error(errorMessage(error, labels.validationError)),
  });

  const workflows = automationsQuery.data?.items ?? [];
  const templates = templatesQuery.data?.items ?? [];
  const executions = executionsQuery.data?.items ?? [];
  const policy = policyQuery.data;
  const editablePolicy = policyDraft ?? policy?.effective ?? null;

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

      <div className="mb-4 flex w-fit rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-1">
        <TabButton active={activeTab === 'workflows'} onClick={() => setActiveTab('workflows')}>
          {labels.title}
        </TabButton>
        <TabButton active={activeTab === 'templates'} onClick={() => setActiveTab('templates')}>
          Templates
        </TabButton>
        <TabButton active={activeTab === 'executions'} onClick={() => setActiveTab('executions')}>
          {labels.executions}
        </TabButton>
        <TabButton active={activeTab === 'settings'} onClick={() => setActiveTab('settings')}>
          <Settings className="h-4 w-4" /> {labels.settings}
        </TabButton>
      </div>

      {activeTab === 'workflows' ? (
        <WorkflowList
          labels={labels}
          workflows={workflows}
          loading={automationsQuery.isLoading}
          error={automationsQuery.isError}
          onCreate={() => setCreateOpen(true)}
          onOpen={(workflowId) => router.push(`/workspace/automations/${workflowId}` as never)}
          onPublish={setPublishTarget}
          onToggle={(workflow) =>
            disableMutation.mutate({
              workflowId: workflow.id,
              disabled: workflow.status === 'DISABLED',
            })
          }
        />
      ) : activeTab === 'templates' ? (
        <TemplateList
          templates={templates}
          loading={templatesQuery.isLoading}
          error={templatesQuery.isError}
          onUse={(template) => {
            setUseTemplateTarget(template);
            setTemplateWorkflowName(`${template.name} Workflow`);
          }}
          onPreview={(templateId) => setPreviewTemplateId(templateId)}
          onArchive={(templateId) => archiveTemplateMutation.mutate(templateId)}
        />
      ) : activeTab === 'executions' ? (
        <ExecutionsPanel
          labels={labels}
          executions={executions}
          health={healthQuery.data ?? null}
          loading={executionsQuery.isLoading}
          error={executionsQuery.isError}
          status={executionStatus}
          onStatusChange={setExecutionStatus}
          onRefresh={() => {
            void executionsQuery.refetch();
            void healthQuery.refetch();
          }}
          onOpen={setSelectedExecutionId}
        />
      ) : (
        <RuntimePolicyPanel
          labels={labels}
          policy={policy ?? null}
          draft={editablePolicy}
          loading={policyQuery.isLoading}
          onDraftChange={setPolicyDraft}
          onSave={() => policyMutation.mutate()}
          saving={policyMutation.isPending}
        />
      )}

      <CreateWorkflowDialog
        labels={labels}
        open={createOpen}
        form={form}
        loading={createMutation.isPending}
        onOpenChange={setCreateOpen}
        onChange={setForm}
        onCreate={() => createMutation.mutate()}
      />

      <Dialog
        open={Boolean(publishTarget)}
        onOpenChange={(open) => !open && setPublishTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{labels.publishConfirmTitle}</DialogTitle>
            <DialogDescription>
              {labels.publishConfirmDescription}
              {publishTarget ? ` Next version: ${(publishTarget.currentVersion ?? 0) + 1}.` : ''}
            </DialogDescription>
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

      <Dialog
        open={Boolean(useTemplateTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setUseTemplateTarget(null);
            setTemplateWorkflowName('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create From Template</DialogTitle>
            <DialogDescription>
              {useTemplateTarget
                ? `${useTemplateTarget.name} will be copied into a new draft workflow.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <Input
            label={labels.name}
            value={templateWorkflowName}
            onChange={(event) => setTemplateWorkflowName(event.target.value)}
          />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setUseTemplateTarget(null)}>
              {labels.cancel}
            </Button>
            <Button
              loading={useTemplateMutation.isPending}
              onClick={() => useTemplateMutation.mutate()}
            >
              <Copy className="h-4 w-4" /> Create Workflow
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(previewTemplateId)}
        onOpenChange={(open) => !open && setPreviewTemplateId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Template Preview</DialogTitle>
            <DialogDescription>
              Read-only template definition summary. Previewing never creates a workflow or draft.
            </DialogDescription>
          </DialogHeader>
          {templatePreviewQuery.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : templatePreviewQuery.isError || !templatePreviewQuery.data ? (
            <EmptyState title="Template Preview" description="Unable to load this template." />
          ) : (
            <TemplatePreview template={templatePreviewQuery.data} />
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPreviewTemplateId(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(selectedExecutionId)}
        onOpenChange={(open) => !open && setSelectedExecutionId(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{labels.executions}</DialogTitle>
            <DialogDescription>{selectedExecutionQuery.data?.id ?? ''}</DialogDescription>
          </DialogHeader>
          {selectedExecutionQuery.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : selectedExecutionQuery.data ? (
            <ExecutionDetail
              labels={labels}
              execution={selectedExecutionQuery.data}
              onReplay={(execution) => {
                setReplayTarget(execution);
                setReplayReason('');
                setReplayConfirmation('');
              }}
            />
          ) : (
            <EmptyState title={labels.executions} description={labels.loadError} />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(replayTarget)} onOpenChange={(open) => !open && setReplayTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{labels.replayExecution}</DialogTitle>
            <DialogDescription>
              Replay may repeat successful business actions from the selected workflow path.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            label={labels.replayReason}
            value={replayReason}
            onChange={(event) => setReplayReason(event.target.value)}
          />
          <Input
            label="REPLAY"
            value={replayConfirmation}
            onChange={(event) => setReplayConfirmation(event.target.value)}
          />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setReplayTarget(null)}>
              {labels.cancel}
            </Button>
            <Button
              loading={replayMutation.isPending}
              disabled={replayReason.trim().length < 3 || replayConfirmation !== 'REPLAY'}
              onClick={() => replayMutation.mutate()}
            >
              <RotateCcw className="h-4 w-4" /> {labels.replay}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}

function WorkflowList({
  labels,
  workflows,
  loading,
  error,
  onCreate,
  onOpen,
  onPublish,
  onToggle,
}: {
  labels: AutomationLabels;
  workflows: AutomationWorkflow[];
  loading: boolean;
  error: boolean;
  onCreate: () => void;
  onOpen: (workflowId: string) => void;
  onPublish: (workflow: AutomationWorkflow) => void;
  onToggle: (workflow: AutomationWorkflow) => void;
}) {
  if (loading) return <AutomationSkeleton />;
  if (error) return <EmptyState title={labels.loadError} description={labels.validationError} />;
  if (workflows.length === 0) {
    return (
      <EmptyState
        title={labels.noAutomations}
        description={labels.emptyDescription}
        action={
          <Button onClick={onCreate}>
            <Plus className="h-4 w-4" /> {labels.createWorkflow}
          </Button>
        }
      />
    );
  }
  return (
    <div className="grid gap-3">
      {workflows.map((workflow) => (
        <Card key={workflow.id}>
          <CardContent className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-center">
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
                {labels.version}: {workflow.currentVersion ?? '-'} | {labels.updated}:{' '}
                {new Date(workflow.updatedAt).toLocaleDateString()}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 lg:justify-end">
              <Button variant="outline" onClick={() => onOpen(workflow.id)}>
                {labels.workflowBuilder}
              </Button>
              <Button variant="outline" onClick={() => onPublish(workflow)}>
                <Rocket className="h-4 w-4" /> {labels.publish}
              </Button>
              <Button
                variant="secondary"
                disabled={!workflow.activePublishedVersionId}
                onClick={() => onToggle(workflow)}
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
      ))}
    </div>
  );
}

function TemplateList({
  templates,
  loading,
  error,
  onUse,
  onPreview,
  onArchive,
}: {
  templates: AutomationWorkflowTemplate[];
  loading: boolean;
  error: boolean;
  onUse: (template: AutomationWorkflowTemplate) => void;
  onPreview: (templateId: string) => void;
  onArchive: (templateId: string) => void;
}) {
  if (loading) return <AutomationSkeleton />;
  if (error) return <EmptyState title="Templates" description="Unable to load templates." />;
  if (templates.length === 0) {
    return (
      <EmptyState
        title="No templates"
        description="Save a workflow as a template from the visual builder."
      />
    );
  }
  return (
    <div className="grid gap-3">
      {templates.map((template) => (
        <Card key={template.id}>
          <CardContent className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-center">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <LayoutTemplate className="h-4 w-4 text-[hsl(var(--primary))]" />
                <p className="break-words font-semibold">{template.name}</p>
                <Badge variant="neutral">{template.definitionSizeBytes} bytes</Badge>
              </div>
              <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
                {template.description || 'Reusable workflow definition'}
              </p>
              <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
                Updated: {new Date(template.updatedAt).toLocaleDateString()}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 lg:justify-end">
              <Button variant="outline" onClick={() => onPreview(template.id)}>
                <Eye className="h-4 w-4" /> Preview
              </Button>
              <Button variant="outline" onClick={() => onUse(template)}>
                <Copy className="h-4 w-4" /> Use
              </Button>
              <Button variant="secondary" onClick={() => onArchive(template.id)}>
                <Archive className="h-4 w-4" /> Archive
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function TemplatePreview({ template }: { template: AutomationWorkflowTemplate }) {
  const nodes = template.nodesDefinition ?? [];
  const edges = template.edgesDefinition ?? [];
  const triggerType = template.triggerDefinition?.triggerType;
  const actionCount = nodes.filter((node) => node.type === 'ACTION').length;
  const branchCount = nodes.filter((node) => node.type === 'BRANCH').length;
  const conditionCount = nodes.filter((node) => node.type === 'CONDITION').length;
  return (
    <div className="grid gap-3 rounded-md border border-[hsl(var(--border))] p-3 text-sm">
      <div>
        <p className="font-semibold">{template.name}</p>
        <p className="text-[hsl(var(--muted-foreground))]">
          {template.description || 'Reusable workflow definition'}
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <PreviewMetric
          label="Trigger"
          value={triggerType ? automationTypeLabel(triggerType) : 'Unknown trigger'}
        />
        <PreviewMetric label="Nodes" value={String(nodes.length)} />
        <PreviewMetric label="Edges" value={String(edges.length)} />
        <PreviewMetric label="Actions" value={String(actionCount)} />
        <PreviewMetric label="Conditions" value={String(conditionCount)} />
        <PreviewMetric label="Branches" value={String(branchCount)} />
      </div>
      <p className="text-xs text-[hsl(var(--muted-foreground))]">
        Updated {new Date(template.updatedAt).toLocaleString()} | Definition{' '}
        {template.definitionVersion}
      </p>
    </div>
  );
}

function ExecutionsPanel({
  labels,
  executions,
  health,
  loading,
  error,
  status,
  onStatusChange,
  onRefresh,
  onOpen,
}: {
  labels: AutomationLabels;
  executions: Array<Awaited<ReturnType<typeof listAutomationExecutions>>['items'][number]>;
  health: Awaited<ReturnType<typeof getAutomationHealth>> | null;
  loading: boolean;
  error: boolean;
  status: AutomationExecutionStatus | 'ALL';
  onStatusChange: (status: AutomationExecutionStatus | 'ALL') => void;
  onRefresh: () => void;
  onOpen: (executionId: string) => void;
}) {
  if (error) return <EmptyState title={labels.executions} description={labels.loadError} />;
  return (
    <div className="grid gap-4">
      {health ? (
        <div className="grid gap-3 md:grid-cols-4">
          <PreviewMetric label="24h" value={String(health.executionsLast24h)} />
          <PreviewMetric label={labels.succeeded} value={String(health.succeeded)} />
          <PreviewMetric label={labels.failed} value={String(health.failed)} />
          <PreviewMetric label={labels.deadLettered} value={String(health.deadLettered)} />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={status} onValueChange={(value) => onStatusChange(value as never)}>
          <SelectTrigger label={labels.executions}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All</SelectItem>
            {executionStatuses.map((item) => (
              <SelectItem key={item} value={item}>
                {executionStatusLabel(item, labels)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={onRefresh}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>
      {loading ? (
        <AutomationSkeleton />
      ) : executions.length === 0 ? (
        <EmptyState title={labels.executions} description={labels.emptyDescription} />
      ) : (
        <div className="overflow-x-auto rounded-md border border-[hsl(var(--border))]">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-[hsl(var(--muted))] text-xs text-[hsl(var(--muted-foreground))]">
              <tr>
                <th className="p-3">ID</th>
                <th className="p-3">Workflow</th>
                <th className="p-3">Status</th>
                <th className="p-3">{labels.attempts}</th>
                <th className="p-3">Started</th>
                <th className="p-3">{labels.duration}</th>
                <th className="p-3">Failure</th>
              </tr>
            </thead>
            <tbody>
              {executions.map((execution) => (
                <tr key={execution.id} className="border-t border-[hsl(var(--border))]">
                  <td className="p-3">
                    <Button variant="ghost" onClick={() => onOpen(execution.id)}>
                      {execution.shortRef}
                    </Button>
                  </td>
                  <td className="p-3">{execution.workflowName}</td>
                  <td className="p-3">
                    <Badge variant={executionBadgeVariant(execution.status)}>
                      {executionStatusLabel(execution.status, labels)}
                    </Badge>
                  </td>
                  <td className="p-3">
                    {execution.attemptCount}/{execution.maxAttempts}
                  </td>
                  <td className="p-3">{formatDate(execution.startedAt ?? execution.createdAt)}</td>
                  <td className="p-3">{formatDuration(execution.durationMs)}</td>
                  <td className="p-3">{execution.failureCode ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ExecutionDetail({
  labels,
  execution,
  onReplay,
}: {
  labels: AutomationLabels;
  execution: AutomationExecutionDetail;
  onReplay: (execution: AutomationExecutionDetail) => void;
}) {
  const canReplay = execution.status === 'FAILED' || execution.status === 'DEAD_LETTERED';
  return (
    <div className="grid gap-4">
      <div className="grid gap-2 text-sm sm:grid-cols-2">
        <PreviewMetric label="Workflow" value={execution.workflowName} />
        <PreviewMetric label="Version" value={String(execution.workflowVersion ?? '-')} />
        <PreviewMetric label="Trigger" value={automationTypeLabel(execution.triggerEvent)} />
        <PreviewMetric label="Correlation" value={execution.correlationId} />
        <PreviewMetric
          label={labels.attempts}
          value={`${execution.attemptCount}/${execution.maxAttempts}`}
        />
        <PreviewMetric label={labels.duration} value={formatDuration(execution.durationMs)} />
      </div>
      {execution.failureCode ? (
        <div className="rounded-md border border-[hsl(var(--border))] p-3 text-sm">
          <p className="font-medium">{execution.failureCode}</p>
          <p className="text-[hsl(var(--muted-foreground))]">{execution.failureMessage}</p>
        </div>
      ) : null}
      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="font-semibold">{labels.stepTimeline}</p>
          <Button variant="outline" disabled={!canReplay} onClick={() => onReplay(execution)}>
            <RotateCcw className="h-4 w-4" /> {labels.replay}
          </Button>
        </div>
        <div className="grid gap-2">
          {execution.steps.map((step) => (
            <div
              key={step.id}
              className="rounded-md border border-[hsl(var(--border))] p-3 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="neutral">#{step.sequence}</Badge>
                <span className="font-medium">{step.nodeId}</span>
                <Badge variant={step.status === 'FAILED' ? 'danger' : 'neutral'}>
                  {step.status}
                </Badge>
                {step.actionType ? <span>{automationTypeLabel(step.actionType)}</span> : null}
              </div>
              <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
                {step.selectedBranchKey
                  ? `${labels.selectedBranch}: ${step.selectedBranchKey}`
                  : ''}
                {step.conditionResult !== null ? ` Condition: ${String(step.conditionResult)}` : ''}
                {step.failureSummary ? ` ${step.failureSummary.code}` : ''}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RuntimePolicyPanel({
  labels,
  policy,
  draft,
  loading,
  onDraftChange,
  onSave,
  saving,
}: {
  labels: AutomationLabels;
  policy: AutomationRuntimePolicy | null;
  draft: AutomationRuntimePolicy['effective'] | null;
  loading: boolean;
  onDraftChange: (draft: AutomationRuntimePolicy['effective']) => void;
  onSave: () => void;
  saving: boolean;
}) {
  if (loading || !draft || !policy) return <AutomationSkeleton />;
  const sourceLabel =
    policy.source === 'WORKSPACE_OVERRIDE' ? labels.workspaceOverride : labels.platformDefault;
  return (
    <div className="grid gap-4">
      <div>
        <p className="font-semibold">{labels.runtimeLimits}</p>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          {labels.effectiveLimit}: {sourceLabel}
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {policyFields.map((field) => (
          <Input
            key={field.key}
            label={field.label}
            type="number"
            value={String(draft[field.key])}
            onChange={(event) =>
              onDraftChange({ ...draft, [field.key]: Number(event.target.value) })
            }
          />
        ))}
        <PreviewMetric
          label="Max retry attempts"
          value={String(policy.platformCaps.maxRetryAttempts)}
        />
        <PreviewMetric
          label="Max automation depth"
          value={String(policy.platformCaps.maxAutomationDepth)}
        />
      </div>
      <Button loading={saving} onClick={onSave}>
        {labels.runtimeLimits}
      </Button>
    </div>
  );
}

function PreviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-[hsl(var(--muted))] p-2">
      <p className="text-xs text-[hsl(var(--muted-foreground))]">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}

function CreateWorkflowDialog({
  labels,
  open,
  form,
  loading,
  onOpenChange,
  onChange,
  onCreate,
}: {
  labels: AutomationLabels;
  open: boolean;
  form: typeof initialForm;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (form: typeof initialForm) => void;
  onCreate: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{labels.createWorkflow}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Input
            label={labels.name}
            value={form.name}
            onChange={(event) => onChange({ ...form, name: event.target.value })}
          />
          <Textarea
            label={labels.descriptionField}
            value={form.description}
            onChange={(event) => onChange({ ...form, description: event.target.value })}
          />
          <Select
            value={form.triggerType}
            onValueChange={(value) =>
              onChange({ ...form, triggerType: value as AutomationTriggerType })
            }
          >
            <SelectTrigger label={labels.trigger}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {automationTriggerTypes.map((trigger) => (
                <SelectItem key={trigger} value={trigger}>
                  {automationTypeLabel(trigger)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={form.workflowKind}
            onValueChange={(value) =>
              onChange({ ...form, workflowKind: value as 'ACTION' | 'CONDITION' | 'BRANCH' })
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
          <Select
            value={form.actionType}
            onValueChange={(value) =>
              onChange({ ...form, actionType: value as AutomationActionType })
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
          {form.workflowKind !== 'ACTION' ? (
            <div className="grid gap-3 rounded-md border border-[hsl(var(--border))] p-3 sm:grid-cols-2">
              <Input
                label={labels.variable}
                value={form.conditionLeft}
                onChange={(event) => onChange({ ...form, conditionLeft: event.target.value })}
              />
              <Select
                value={form.conditionOperator}
                onValueChange={(value) =>
                  onChange({ ...form, conditionOperator: value as AutomationConditionOperator })
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
                  onChange={(event) => onChange({ ...form, conditionRight: event.target.value })}
                />
              ) : null}
              {form.workflowKind === 'BRANCH' ? (
                <>
                  <Input
                    label={labels.branch}
                    value={form.branchKey}
                    onChange={(event) => onChange({ ...form, branchKey: event.target.value })}
                  />
                  <Input
                    label={labels.default}
                    value={form.branchDefaultKey}
                    onChange={(event) =>
                      onChange({ ...form, branchDefaultKey: event.target.value })
                    }
                  />
                </>
              ) : null}
            </div>
          ) : null}
          {form.actionType === 'CREATE_TASK' ? (
            <Input
              label={labels.actionTitle}
              value={form.actionTitle}
              onChange={(event) => onChange({ ...form, actionTitle: event.target.value })}
            />
          ) : (
            <Input
              label={labels.targetId}
              value={form.targetId}
              onChange={(event) => onChange({ ...form, targetId: event.target.value })}
            />
          )}
          {form.actionType.includes('STATUS') ? (
            <Input
              label={labels.statusDefinition}
              value={form.statusDefinitionId}
              onChange={(event) => onChange({ ...form, statusDefinitionId: event.target.value })}
            />
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {labels.cancel}
          </Button>
          <Button loading={loading} onClick={onCreate}>
            {labels.createWorkflow}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button variant={active ? 'secondary' : 'ghost'} onClick={onClick}>
      {children}
    </Button>
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

const executionStatuses: AutomationExecutionStatus[] = [
  'PENDING_QUEUE',
  'QUEUED',
  'RUNNING',
  'RETRYING',
  'SUCCEEDED',
  'FAILED',
  'DEAD_LETTERED',
  'BLOCKED',
];

const policyFields: Array<{
  key: keyof AutomationRuntimePolicy['effective'];
  label: string;
}> = [
  { key: 'maxPublishedWorkflows', label: 'Published Workflows limit' },
  { key: 'maxExecutionsPerMinute', label: 'Executions/minute' },
  { key: 'maxConcurrentExecutions', label: 'Concurrent executions' },
  { key: 'maxActionsPerExecution', label: 'Actions/execution' },
  { key: 'maxReplaysPerHour', label: 'Replays/hour' },
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

function executionStatusLabel(status: AutomationExecutionStatus, labels: AutomationLabels) {
  const map: Record<AutomationExecutionStatus, string> = {
    PENDING_QUEUE: 'Pending Queue',
    QUEUED: 'Queued',
    RUNNING: labels.running,
    RETRYING: 'Retrying',
    SUCCEEDED: labels.succeeded,
    FAILED: labels.failed,
    DEAD_LETTERED: labels.deadLettered,
    BLOCKED: labels.blocked,
  };
  return map[status];
}

function executionBadgeVariant(status: AutomationExecutionStatus) {
  if (status === 'SUCCEEDED') return 'success';
  if (status === 'FAILED' || status === 'DEAD_LETTERED' || status === 'BLOCKED') return 'danger';
  if (status === 'RUNNING' || status === 'RETRYING') return 'warning';
  return 'neutral';
}

function isTerminalExecution(status: AutomationExecutionStatus) {
  return ['SUCCEEDED', 'FAILED', 'DEAD_LETTERED', 'BLOCKED'].includes(status);
}

function formatDuration(value: number | null) {
  if (value === null) return '-';
  if (value < 1000) return `${value}ms`;
  return `${Math.round(value / 100) / 10}s`;
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : '-';
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
