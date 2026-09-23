'use client';

import {
  addEdge,
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
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
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Copy,
  GitBranch,
  GitFork,
  LayoutTemplate,
  MousePointer2,
  Plus,
  Rocket,
  Save,
  Trash2,
  Zap,
} from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  listWorkspaceRoles,
  rolesKeys,
  type WorkspaceRole,
} from '../../../services/workspace-roles';
import {
  type AutomationActionType,
  type AutomationConditionOperator,
  type AutomationEdgeDefinition,
  type AutomationNodeDefinition,
  type AutomationNodeType,
  type AutomationTriggerType,
  type AutomationWorkflowVersion,
  automationActionTypes,
  automationKeys,
  automationTriggerTypes,
  cloneWorkspaceAutomation,
  createAutomationDraftFromVersion,
  createAutomationTemplate,
  getWorkspaceAutomation,
  publishAutomation,
  updateAutomationDraftDefinition,
} from '../../../services/workspace-automations';
import { useSessionStore } from '../../../stores/session';
import { PageContainer } from '../../layout/PageContainer';

type BuilderNodeData = {
  nodeType: AutomationNodeType;
  label: string;
  summary: string;
  invalid?: boolean;
};

type BuilderNode = Node<BuilderNodeData>;
type BuilderEdge = Edge<{ branchKey?: string | null }>;

const nodeTypes = { automation: AutomationNodeCard };
const executableActions = automationActionTypes.filter((action) => action !== 'ADD_TICKET_TAG');
const executableActionSet = new Set<AutomationActionType>(executableActions);
const operators: AutomationConditionOperator[] = [
  'EQUALS',
  'NOT_EQUALS',
  'IN',
  'NOT_IN',
  'EXISTS',
  'NOT_EXISTS',
];

export function WorkspaceAutomationBuilderPage() {
  const params = useParams<{ workflowId: string }>();
  const router = useRouter();
  const accessToken = useSessionStore((state) => state.accessToken);
  const agencies = useSessionStore((state) => state.agencies);
  const workspaceId = useSessionStore((state) => state.selectedWorkspaceId);
  const queryClient = useQueryClient();
  const workflowId = params.workflowId;
  const [nodes, setNodes, onNodesChange] = useNodesState<BuilderNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<BuilderEdge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [previewVersionId, setPreviewVersionId] = useState<string | null>(null);
  const [cloneName, setCloneName] = useState('');
  const [cloneSourceVersionId, setCloneSourceVersionId] = useState<string>('current');
  const [templateName, setTemplateName] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');
  const [templateSourceVersionId, setTemplateSourceVersionId] = useState<string>('current');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const publishInFlightRef = useRef(false);

  const workflowQuery = useQuery({
    queryKey: automationKeys.detail(workspaceId, workflowId),
    queryFn: () => getWorkspaceAutomation(workspaceId as string, workflowId),
    enabled: Boolean(workspaceId && workflowId),
  });

  const rolesQuery = useQuery({
    queryKey: rolesKeys.all(workspaceId),
    queryFn: () => listWorkspaceRoles(workspaceId as string),
    enabled: Boolean(accessToken && workspaceId),
  });

  const workflow = workflowQuery.data;
  const draft = workflow?.versions?.find((version) => version.state === 'DRAFT') ?? null;
  const published =
    workflow?.versions?.find((version) => version.id === workflow.activePublishedVersionId) ??
    workflow?.versions?.find((version) => version.state === 'PUBLISHED') ??
    null;
  const previewVersion =
    workflow?.versions?.find((version) => version.id === previewVersionId) ?? null;
  const activeVersion = previewVersion ?? draft ?? published;
  const permissions = useMemo(
    () => workspacePermissions(agencies, workspaceId, rolesQuery.data ?? []),
    [agencies, rolesQuery.data, workspaceId],
  );
  const canEdit = hasPermission(permissions, 'automation.edit');
  const canPublish = hasPermission(permissions, 'automation.publish');
  const canCreate = hasPermission(permissions, 'automation.create');
  const canManageTemplates = hasPermission(permissions, 'automation.templates.manage');
  const readOnly = Boolean(previewVersion) || !draft || !canEdit;
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null;
  const validation = useMemo(() => validateGraph(nodes, edges), [nodes, edges]);
  const publishedVersions =
    workflow?.versions
      ?.filter((version) => version.state === 'PUBLISHED')
      .sort((left, right) => (right.versionNumber ?? 0) - (left.versionNumber ?? 0)) ?? [];
  const nextVersionNumber =
    (publishedVersions.reduce(
      (maxVersion, version) => Math.max(maxVersion, version.versionNumber ?? 0),
      0,
    ) ?? 0) + 1;

  useEffect(() => {
    if (!activeVersion) return;
    const graph = versionToFlow(activeVersion);
    setNodes(graph.nodes);
    setEdges(graph.edges);
    setSelectedNodeId(graph.nodes[0]?.id ?? null);
    setDirty(false);
    setLastSavedAt(null);
  }, [activeVersion?.id, workspaceId, setEdges, setNodes]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  useEffect(() => {
    setSelectedNodeId(null);
    setDirty(false);
    setPublishOpen(false);
    setCloneOpen(false);
    setTemplateOpen(false);
    setHistoryOpen(false);
    setPreviewVersionId(null);
    setLastSavedAt(null);
    setNodes([]);
    setEdges([]);
  }, [setEdges, setNodes, workspaceId]);

  const saveMutation = useMutation({
    mutationFn: () =>
      updateAutomationDraftDefinition(workspaceId as string, workflowId, {
        ...flowToDefinition(nodes, edges),
        expectedUpdatedAtMs: draft?.updatedAt ? new Date(draft.updatedAt).getTime() : undefined,
      }),
    onSuccess: async () => {
      setDirty(false);
      setLastSavedAt(new Date());
      toast.success('Draft saved');
      await queryClient.invalidateQueries({
        queryKey: automationKeys.detail(workspaceId, workflowId),
      });
      await queryClient.invalidateQueries({ queryKey: automationKeys.all(workspaceId) });
    },
    onError: (error) =>
      toast.error(safeError(error, 'This draft changed elsewhere. Refresh before saving.')),
  });

  const createDraftMutation = useMutation({
    mutationFn: () =>
      updateAutomationDraftDefinition(
        workspaceId as string,
        workflowId,
        flowToDefinition(nodes, edges),
      ),
    onSuccess: async () => {
      toast.success('Draft created');
      await queryClient.invalidateQueries({
        queryKey: automationKeys.detail(workspaceId, workflowId),
      });
      await queryClient.invalidateQueries({ queryKey: automationKeys.all(workspaceId) });
    },
    onError: (error) => toast.error(safeError(error, 'Unable to create draft')),
  });

  const publishMutation = useMutation({
    mutationFn: async () => {
      if (validation.length > 0) throw new Error('Resolve validation issues before publishing.');
      if (dirty) await saveMutation.mutateAsync();
      return publishAutomation(workspaceId as string, workflowId);
    },
    onSuccess: async () => {
      setPublishOpen(false);
      toast.success('Workflow published');
      await queryClient.invalidateQueries({
        queryKey: automationKeys.detail(workspaceId, workflowId),
      });
      await queryClient.invalidateQueries({ queryKey: automationKeys.all(workspaceId) });
    },
    onError: (error) => toast.error(safeError(error, 'Unable to publish workflow')),
  });

  const cloneMutation = useMutation({
    mutationFn: () =>
      cloneWorkspaceAutomation(workspaceId as string, workflowId, {
        name: cloneName.trim() || `${workflow?.name ?? 'Workflow'} Copy`,
        sourceVersionId: cloneSourceVersionId === 'current' ? undefined : cloneSourceVersionId,
      }),
    onSuccess: async (created) => {
      toast.success('Workflow cloned');
      setCloneOpen(false);
      setCloneName('');
      setCloneSourceVersionId('current');
      await queryClient.invalidateQueries({ queryKey: automationKeys.all(workspaceId) });
      router.push(`/workspace/automations/${created.id}` as never);
    },
    onError: (error) => toast.error(safeError(error, 'Unable to clone workflow')),
  });

  const saveTemplateMutation = useMutation({
    mutationFn: () =>
      createAutomationTemplate(workspaceId as string, {
        name: templateName.trim() || `${workflow?.name ?? 'Workflow'} Template`,
        description: templateDescription.trim() || null,
        sourceWorkflowId: workflowId,
        sourceWorkflowVersionId:
          templateSourceVersionId === 'current' ? undefined : templateSourceVersionId,
      }),
    onSuccess: async () => {
      toast.success('Template saved');
      setTemplateOpen(false);
      setTemplateName('');
      setTemplateDescription('');
      setTemplateSourceVersionId('current');
      await queryClient.invalidateQueries({ queryKey: automationKeys.templates(workspaceId, 1) });
    },
    onError: (error) => toast.error(safeError(error, 'Unable to save template')),
  });

  const restoreVersionMutation = useMutation({
    mutationFn: (versionId: string) =>
      createAutomationDraftFromVersion(workspaceId as string, workflowId, versionId),
    onSuccess: async () => {
      toast.success('Draft created from version');
      setPreviewVersionId(null);
      setHistoryOpen(false);
      await queryClient.invalidateQueries({
        queryKey: automationKeys.detail(workspaceId, workflowId),
      });
      await queryClient.invalidateQueries({ queryKey: automationKeys.all(workspaceId) });
    },
    onError: (error) => toast.error(safeError(error, 'Unable to create draft from version')),
  });

  const markDirty = () => {
    if (!readOnly) setDirty(true);
  };

  const addNode = (type: Exclude<AutomationNodeType, 'TRIGGER' | 'DELAY'>) => {
    if (readOnly) return;
    const id = `${type.toLowerCase()}-${Date.now()}`;
    const config = defaultConfigFor(type);
    setNodes((current) => [
      ...current,
      flowNodeFromDefinition(
        { nodeId: id, type, config },
        { x: 180 + current.length * 40, y: 120 + current.length * 70 },
      ),
    ]);
    setSelectedNodeId(id);
    setDirty(true);
  };

  const onConnect = (connection: Connection) => {
    if (readOnly || !connection.source || !connection.target) return;
    const next = guardedConnect(connection, nodes, edges);
    if (!next) {
      toast.error('That connection is not valid for the current runtime.');
      return;
    }
    setEdges(next);
    setDirty(true);
  };

  const deleteSelected = () => {
    if (readOnly || !selectedNodeId) return;
    const node = nodes.find((item) => item.id === selectedNodeId);
    if (node?.data.nodeType === 'TRIGGER') {
      toast.error('Trigger node cannot be deleted.');
      return;
    }
    setNodes((current) => current.filter((item) => item.id !== selectedNodeId));
    setEdges((current) =>
      current.filter((edge) => edge.source !== selectedNodeId && edge.target !== selectedNodeId),
    );
    setSelectedNodeId(null);
    setDirty(true);
  };

  const updateSelectedConfig = (patch: Record<string, unknown>) => {
    if (!selectedNode || readOnly) return;
    setNodes((current) =>
      current.map((node) =>
        node.id === selectedNode.id
          ? nodeFromConfig(
              node,
              { ...node.data, summary: summaryFor(node.data.nodeType, patch) },
              patch,
            )
          : node,
      ),
    );
    setDirty(true);
  };

  const confirmPublish = () => {
    if (publishInFlightRef.current) return;
    publishInFlightRef.current = true;
    publishMutation.mutate(undefined, {
      onSettled: () => {
        publishInFlightRef.current = false;
      },
    });
  };

  if (workflowQuery.isLoading) {
    return (
      <PageContainer>
        <Skeleton className="h-[42rem] w-full" />
      </PageContainer>
    );
  }

  if (workflowQuery.isError || !workflow || !activeVersion) {
    return (
      <PageContainer>
        <EmptyState title="Workflow Builder" description="Unable to load this workflow." />
      </PageContainer>
    );
  }

  return (
    <PageContainer className="max-w-none">
      <div className="grid min-h-[calc(100vh-7rem)] gap-3">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="ghost"
                onClick={() =>
                  dirty
                    ? window.confirm('Discard unsaved changes?') &&
                      router.push('/workspace/automations')
                    : router.push('/workspace/automations')
                }
                aria-label="Back"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <h1 className="truncate text-lg font-semibold">{workflow.name}</h1>
              <Badge variant={readOnly ? 'neutral' : 'info'}>
                {previewVersion ? 'Historical' : readOnly ? 'Read Only' : 'Draft'}
              </Badge>
              <Badge variant={validation.length ? 'warning' : 'success'}>
                {validation.length ? 'Validation' : 'Valid'}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
              Version {activeVersion.versionNumber ?? 'draft'} -{' '}
              {dirty
                ? 'Unsaved changes'
                : lastSavedAt
                  ? `Saved ${lastSavedAt.toLocaleTimeString()}`
                  : 'Saved'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={!canCreate || cloneMutation.isPending}
              onClick={() => {
                setCloneName(`${workflow.name} Copy`);
                setCloneSourceVersionId(previewVersion?.id ?? 'current');
                setCloneOpen(true);
              }}
            >
              <Copy className="h-4 w-4" /> Clone
            </Button>
            <Button
              variant="outline"
              disabled={!canManageTemplates || saveTemplateMutation.isPending}
              onClick={() => {
                setTemplateName(`${workflow.name} Template`);
                setTemplateDescription(workflow.description ?? '');
                setTemplateSourceVersionId(previewVersion?.id ?? 'current');
                setTemplateOpen(true);
              }}
            >
              <LayoutTemplate className="h-4 w-4" /> Save Template
            </Button>
            <Button variant="outline" onClick={() => setHistoryOpen(true)}>
              <Clock3 className="h-4 w-4" /> History
            </Button>
            {previewVersion ? (
              <Button variant="secondary" onClick={() => setPreviewVersionId(null)}>
                Current
              </Button>
            ) : null}
            {!canEdit ? null : !draft && !previewVersion ? (
              <Button
                onClick={() => createDraftMutation.mutate()}
                loading={createDraftMutation.isPending}
              >
                <Save className="h-4 w-4" /> Create Draft
              </Button>
            ) : (
              <Button onClick={() => saveMutation.mutate()} loading={saveMutation.isPending}>
                <Save className="h-4 w-4" /> Save Draft
              </Button>
            )}
            <Button
              variant="outline"
              disabled={!draft || !canPublish || validation.length > 0 || publishMutation.isPending}
              onClick={() => setPublishOpen(true)}
            >
              <Rocket className="h-4 w-4" /> Publish
            </Button>
          </div>
        </header>

        <main className="grid gap-3 lg:grid-cols-[15rem_minmax(0,1fr)_21rem]">
          <aside className="grid content-start gap-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3">
            <h2 className="text-sm font-semibold">Node Palette</h2>
            <PaletteButton
              label="Action"
              icon={<Zap className="h-4 w-4" />}
              disabled={readOnly}
              onClick={() => addNode('ACTION')}
            />
            <PaletteButton
              label="Condition"
              icon={<GitBranch className="h-4 w-4" />}
              disabled={readOnly}
              onClick={() => addNode('CONDITION')}
            />
            <PaletteButton
              label="Branch"
              icon={<GitFork className="h-4 w-4" />}
              disabled={readOnly}
              onClick={() => addNode('BRANCH')}
            />
            <Button variant="secondary" disabled>
              Delay - Coming Later
            </Button>
            <div className="rounded-md bg-[hsl(var(--muted))] p-2 text-xs text-[hsl(var(--muted-foreground))]">
              Drag nodes, connect handles, and use Delete for selected draft nodes.
            </div>
          </aside>

          <section className="min-h-[34rem] overflow-hidden rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))]">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={(changes) => {
                if (readOnly) return;
                onNodesChange(changes);
                if (
                  changes.some(
                    (change) =>
                      change.type === 'position' && 'dragging' in change && !change.dragging,
                  )
                )
                  markDirty();
              }}
              onEdgesChange={(changes) => {
                if (readOnly) return;
                onEdgesChange(changes);
                if (changes.some((change) => change.type === 'remove')) markDirty();
              }}
              onConnect={onConnect}
              onNodeClick={(_event, node) => setSelectedNodeId(node.id)}
              onPaneClick={() => setSelectedNodeId(null)}
              onNodesDelete={(deleted) => {
                if (readOnly) return;
                if (deleted.some((node) => node.data.nodeType === 'TRIGGER')) {
                  setNodes((current) => [
                    ...current,
                    ...deleted.filter((node) => node.data.nodeType === 'TRIGGER'),
                  ]);
                } else {
                  markDirty();
                }
              }}
              fitView
              nodesDraggable={!readOnly}
              nodesConnectable={!readOnly}
              edgesReconnectable={false}
              deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
              aria-label="Workflow Canvas"
            >
              <Background color="hsl(var(--border))" gap={18} />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable nodeColor={(node) => nodeColor(node.data.nodeType)} />
            </ReactFlow>
          </section>

          <aside className="grid content-start gap-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Node Inspector</h2>
              <Button
                variant="ghost"
                disabled={readOnly || !selectedNodeId}
                onClick={deleteSelected}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            {selectedNode ? (
              <Inspector
                node={selectedNode}
                readOnly={readOnly}
                triggerType={triggerTypeFromNodes(nodes)}
                onChange={updateSelectedConfig}
              />
            ) : (
              <EmptyState title="Select a node" description="Choose a node to configure it." />
            )}
            <ValidationPanel errors={validation} />
          </aside>
        </main>
      </div>

      <Dialog open={cloneOpen} onOpenChange={setCloneOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clone Workflow</DialogTitle>
            <DialogDescription>
              Create a new draft workflow with fresh node references and the same logic.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Input
              label="Name"
              value={cloneName}
              onChange={(event) => setCloneName(event.target.value)}
            />
            <VersionSelect
              label="Source"
              value={cloneSourceVersionId}
              versions={publishedVersions}
              onChange={setCloneSourceVersionId}
            />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCloneOpen(false)}>
              Cancel
            </Button>
            <Button loading={cloneMutation.isPending} onClick={() => cloneMutation.mutate()}>
              <Copy className="h-4 w-4" /> Clone Workflow
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={templateOpen} onOpenChange={setTemplateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save As Template</DialogTitle>
            <DialogDescription>
              Store this workflow definition as a reusable workspace template.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Input
              label="Name"
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
            />
            <Textarea
              label="Description"
              value={templateDescription}
              onChange={(event) => setTemplateDescription(event.target.value)}
            />
            <VersionSelect
              label="Source"
              value={templateSourceVersionId}
              versions={publishedVersions}
              onChange={setTemplateSourceVersionId}
            />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setTemplateOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={saveTemplateMutation.isPending}
              onClick={() => saveTemplateMutation.mutate()}
            >
              <LayoutTemplate className="h-4 w-4" /> Save Template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Version History</DialogTitle>
            <DialogDescription>
              Published versions are immutable. Open one to inspect it or restore it into a new
              draft.
            </DialogDescription>
          </DialogHeader>
          <div className="grid max-h-96 gap-2 overflow-auto">
            {publishedVersions.length === 0 ? (
              <EmptyState
                title="No published versions"
                description="Publish this workflow first."
              />
            ) : (
              publishedVersions.map((version) => (
                <div
                  key={version.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[hsl(var(--border))] p-3"
                >
                  <div>
                    <p className="text-sm font-semibold">Version {version.versionNumber ?? '-'}</p>
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">
                      {version.publishedAt
                        ? new Date(version.publishedAt).toLocaleString()
                        : 'Unpublished'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setPreviewVersionId(version.id);
                        setHistoryOpen(false);
                      }}
                    >
                      View
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={!canEdit || Boolean(draft) || restoreVersionMutation.isPending}
                      onClick={() => restoreVersionMutation.mutate(version.id)}
                    >
                      Create Draft
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setHistoryOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publish Workflow</DialogTitle>
            <DialogDescription>
              Publishing creates an immutable workflow version used by future automation events.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-[hsl(var(--border))] p-3 text-sm">
            {workflow.name} - Next version {nextVersionNumber} -{' '}
            {validation.length ? `${validation.length} validation issue(s)` : 'Validation passed'}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPublishOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={publishMutation.isPending || saveMutation.isPending}
              loading={publishMutation.isPending}
              onClick={confirmPublish}
            >
              <Rocket className="h-4 w-4" /> Publish Workflow
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}

function AutomationNodeCard({ data, selected }: NodeProps<BuilderNode>) {
  const Icon =
    data.nodeType === 'CONDITION'
      ? GitBranch
      : data.nodeType === 'BRANCH'
        ? GitFork
        : data.nodeType === 'TRIGGER'
          ? MousePointer2
          : Zap;
  return (
    <div
      className={`min-w-44 rounded-md border bg-[hsl(var(--card))] p-3 shadow-sm ${selected ? 'border-[hsl(var(--primary))] ring-2 ring-[hsl(var(--ring))]' : 'border-[hsl(var(--border))]'}`}
      aria-label={`${data.nodeType} node ${data.label}`}
    >
      <Handle type="target" position={Position.Top} isConnectable={data.nodeType !== 'TRIGGER'} />
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-[hsl(var(--primary))]" />
        <span className="text-xs font-semibold uppercase">{data.nodeType}</span>
        {data.invalid ? <span className="text-xs text-[hsl(var(--danger))]">!</span> : null}
      </div>
      <div className="mt-2 text-sm font-semibold">{data.label}</div>
      <div className="mt-1 max-w-52 truncate text-xs text-[hsl(var(--muted-foreground))]">
        {data.summary}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

function Inspector({
  node,
  readOnly,
  triggerType,
  onChange,
}: {
  node: BuilderNode;
  readOnly: boolean;
  triggerType: AutomationTriggerType;
  onChange: (config: Record<string, unknown>) => void;
}) {
  const config = (node.data as unknown as { config?: Record<string, unknown> }).config ?? {};
  if (node.data.nodeType === 'TRIGGER') {
    return (
      <div className="grid gap-3">
        <Select
          value={textValue(config.triggerType, 'TASK_CREATED')}
          disabled={readOnly}
          onValueChange={(value) => onChange({ ...config, triggerType: value })}
        >
          <SelectTrigger label="Trigger">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {automationTriggerTypes.map((trigger) => (
              <SelectItem key={trigger} value={trigger}>
                {humanize(trigger)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {textValue(config.triggerType).includes('STATUS_CHANGED') ? (
          <>
            <Input
              label="From Status ID"
              disabled={readOnly}
              value={textValue(config.fromStatusId)}
              onChange={(event) => onChange({ ...config, fromStatusId: event.target.value })}
            />
            <Input
              label="To Status ID"
              disabled={readOnly}
              value={textValue(config.toStatusId)}
              onChange={(event) => onChange({ ...config, toStatusId: event.target.value })}
            />
          </>
        ) : null}
      </div>
    );
  }
  if (node.data.nodeType === 'ACTION') {
    const actionType = textValue(config.actionType, 'CREATE_TASK') as AutomationActionType;
    return (
      <div className="grid gap-3">
        <Select
          value={actionType}
          disabled={readOnly}
          onValueChange={(value) => onChange(defaultActionConfig(value as AutomationActionType))}
        >
          <SelectTrigger label="Action">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {executableActions.map((action) => (
              <SelectItem key={action} value={action}>
                {humanize(action)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ActionFields
          actionType={actionType}
          config={config}
          readOnly={readOnly}
          onChange={onChange}
          triggerType={triggerType}
        />
      </div>
    );
  }
  if (node.data.nodeType === 'CONDITION') {
    return (
      <ConditionFields
        config={config}
        readOnly={readOnly}
        onChange={onChange}
        triggerType={triggerType}
      />
    );
  }
  return (
    <BranchFields
      config={config}
      readOnly={readOnly}
      onChange={onChange}
      triggerType={triggerType}
    />
  );
}

function ActionFields(props: {
  actionType: AutomationActionType;
  config: Record<string, unknown>;
  readOnly: boolean;
  triggerType: AutomationTriggerType;
  onChange: (config: Record<string, unknown>) => void;
}) {
  const { actionType, config, readOnly, triggerType, onChange } = props;
  const targetKey = actionType.includes('TASK')
    ? 'taskId'
    : actionType.includes('PROJECT')
      ? 'projectId'
      : 'ticketId';
  return (
    <div className="grid gap-3">
      {actionType === 'CREATE_TASK' ? (
        <>
          <VariableInput
            label="Title"
            value={textValue(config.title)}
            readOnly={readOnly}
            triggerType={triggerType}
            onChange={(value) => onChange({ ...config, title: value })}
          />
          <Textarea
            label="Description"
            disabled={readOnly}
            value={textValue(config.description)}
            onChange={(event) => onChange({ ...config, description: event.target.value })}
          />
          <VariableInput
            label="Priority"
            value={textValue(config.priority)}
            readOnly={readOnly}
            triggerType={triggerType}
            onChange={(value) => onChange({ ...config, priority: value })}
          />
          <VariableInput
            label="Status Definition"
            value={textValue(config.statusDefinitionId)}
            readOnly={readOnly}
            triggerType={triggerType}
            onChange={(value) => onChange({ ...config, statusDefinitionId: value })}
          />
        </>
      ) : (
        <VariableInput
          label="Target ID"
          value={textValue(config[targetKey])}
          readOnly={readOnly}
          triggerType={triggerType}
          onChange={(value) => onChange({ ...config, [targetKey]: value })}
        />
      )}
      {actionType.includes('STATUS') ? (
        <VariableInput
          label="Status Definition"
          value={textValue(config.statusDefinitionId)}
          readOnly={readOnly}
          triggerType={triggerType}
          onChange={(value) => onChange({ ...config, statusDefinitionId: value })}
        />
      ) : null}
      {actionType === 'ASSIGN_TASK' ? (
        <VariableInput
          label="Membership IDs"
          value={Array.isArray(config.membershipIds) ? config.membershipIds.join(',') : ''}
          readOnly={readOnly}
          triggerType={triggerType}
          onChange={(value) =>
            onChange({
              ...config,
              membershipIds: value ? value.split(',').map((item) => item.trim()) : [],
            })
          }
        />
      ) : null}
      {actionType === 'ADD_TASK_TAG' ? (
        <VariableInput
          label="Tag IDs"
          value={Array.isArray(config.tagIds) ? config.tagIds.join(',') : ''}
          readOnly={readOnly}
          triggerType={triggerType}
          onChange={(value) =>
            onChange({
              ...config,
              tagIds: value ? value.split(',').map((item) => item.trim()) : [],
            })
          }
        />
      ) : null}
    </div>
  );
}

function ConditionFields({
  config,
  readOnly,
  triggerType,
  onChange,
}: {
  config: Record<string, unknown>;
  readOnly: boolean;
  triggerType: AutomationTriggerType;
  onChange: (config: Record<string, unknown>) => void;
}) {
  const operator = textValue(config.operator, 'EQUALS') as AutomationConditionOperator;
  return (
    <div className="grid gap-3">
      <VariableInput
        label="Left value / Variable"
        value={textValue(config.left)}
        readOnly={readOnly}
        triggerType={triggerType}
        onChange={(value) => onChange({ ...config, left: value })}
      />
      <Select
        value={operator}
        disabled={readOnly}
        onValueChange={(value) => {
          if (value === 'EXISTS' || value === 'NOT_EXISTS') {
            const next = { ...config };
            delete next.right;
            onChange({ ...next, operator: value });
            return;
          }
          onChange({ ...config, operator: value });
        }}
      >
        <SelectTrigger label="Operator">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {operators.map((item) => (
            <SelectItem key={item} value={item}>
              {humanize(item)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!['EXISTS', 'NOT_EXISTS'].includes(operator) ? (
        <VariableInput
          label="Right value / Variable"
          value={textValue(config.right)}
          readOnly={readOnly}
          triggerType={triggerType}
          onChange={(value) => onChange({ ...config, right: value })}
        />
      ) : null}
    </div>
  );
}

function BranchFields({
  config,
  readOnly,
  triggerType,
  onChange,
}: {
  config: Record<string, unknown>;
  readOnly: boolean;
  triggerType: AutomationTriggerType;
  onChange: (config: Record<string, unknown>) => void;
}) {
  const cases = Array.isArray(config.cases) ? (config.cases as Array<Record<string, unknown>>) : [];
  return (
    <div className="grid gap-3">
      {cases.map((branchCase, index) => (
        <div key={index} className="grid gap-2 rounded-md border border-[hsl(var(--border))] p-2">
          <Input
            label="Case Key"
            disabled={readOnly}
            value={textValue(branchCase.key)}
            onChange={(event) =>
              onChange({
                ...config,
                cases: cases.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, key: event.target.value } : item,
                ),
              })
            }
          />
          <ConditionFields
            config={branchCase}
            readOnly={readOnly}
            triggerType={triggerType}
            onChange={(next) =>
              onChange({
                ...config,
                cases: cases.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, ...next } : item,
                ),
              })
            }
          />
          <div className="flex gap-2">
            <Button
              variant="secondary"
              disabled={readOnly || index === 0}
              onClick={() => onChange({ ...config, cases: move(cases, index, index - 1) })}
            >
              Move Up
            </Button>
            <Button
              variant="secondary"
              disabled={readOnly || cases.length <= 1}
              onClick={() =>
                onChange({
                  ...config,
                  cases: cases.filter((_item, itemIndex) => itemIndex !== index),
                })
              }
            >
              Remove
            </Button>
          </div>
        </div>
      ))}
      <Button
        variant="outline"
        disabled={readOnly || cases.length >= 10}
        onClick={() =>
          onChange({
            ...config,
            cases: [
              ...cases,
              {
                key: `CASE_${cases.length + 1}`,
                left: variableOptions(triggerType)[0],
                operator: 'EQUALS',
                right: '',
              },
            ],
          })
        }
      >
        <Plus className="h-4 w-4" /> Add Case
      </Button>
      <Input
        label="Default"
        disabled={readOnly}
        value={textValue(config.defaultKey, 'DEFAULT')}
        onChange={(event) => onChange({ ...config, defaultKey: event.target.value })}
      />
    </div>
  );
}

function VariableInput({
  label,
  value,
  readOnly,
  triggerType,
  onChange,
}: {
  label: string;
  value: string;
  readOnly: boolean;
  triggerType: AutomationTriggerType;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <Input
        label={label}
        disabled={readOnly}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="flex flex-wrap gap-1" aria-label="Variable picker">
        {variableOptions(triggerType).map((variable) => (
          <Button
            key={variable}
            type="button"
            variant="secondary"
            disabled={readOnly}
            onClick={() => onChange(`{{${variable}}}`)}
          >
            {variable}
          </Button>
        ))}
      </div>
    </div>
  );
}

function ValidationPanel({ errors }: { errors: string[] }) {
  return (
    <section
      className="grid gap-2 rounded-md bg-[hsl(var(--muted))] p-3 text-sm"
      aria-label="Validation"
    >
      <div className="flex items-center gap-2 font-semibold">
        <CheckCircle2 className="h-4 w-4" /> Validation
      </div>
      {errors.length === 0 ? (
        <p className="text-[hsl(var(--muted-foreground))]">No client-side issues found.</p>
      ) : (
        <ul className="grid gap-1 text-[hsl(var(--danger))]">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PaletteButton({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button variant="outline" disabled={disabled} onClick={onClick}>
      {icon} {label}
    </Button>
  );
}

function VersionSelect({
  label,
  value,
  versions,
  onChange,
}: {
  label: string;
  value: string;
  versions: AutomationWorkflowVersion[];
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="current">Current Draft / Published</SelectItem>
        {versions.map((version) => (
          <SelectItem key={version.id} value={version.id}>
            Version {version.versionNumber ?? '-'}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function versionToFlow(version: AutomationWorkflowVersion) {
  const positions = uiPositions(version.settingsDefinition);
  const nodes = version.nodesDefinition.map((node, index) =>
    flowNodeFromDefinition(
      node as AutomationNodeDefinition,
      positions[node.nodeId] ?? { x: 120 + index * 180, y: 80 + index * 120 },
    ),
  );
  const edges = version.edgesDefinition.map((edge, index) =>
    flowEdgeFromDefinition(edge as AutomationEdgeDefinition, index),
  );
  return { nodes, edges };
}

function flowNodeFromDefinition(
  node: AutomationNodeDefinition,
  position: { x: number; y: number },
): BuilderNode {
  return nodeFromConfig(
    {
      id: node.nodeId,
      type: 'automation',
      position,
      data: {
        nodeType: node.type,
        label: labelFor(node),
        summary: summaryFor(node.type, node.config),
        config: node.config,
      } as BuilderNodeData & { config: Record<string, unknown> },
    },
    undefined,
    node.config,
  );
}

function nodeFromConfig(
  node: BuilderNode,
  data: Partial<BuilderNodeData> | undefined,
  config: Record<string, unknown>,
): BuilderNode {
  const nodeType = data?.nodeType ?? node.data.nodeType;
  const definition = { nodeId: node.id, type: nodeType, config } as AutomationNodeDefinition;
  return {
    ...node,
    data: {
      ...node.data,
      ...data,
      label: labelFor(definition),
      summary: summaryFor(nodeType, config),
      config,
    } as BuilderNodeData & { config: Record<string, unknown> },
  };
}

function flowEdgeFromDefinition(edge: AutomationEdgeDefinition, index: number): BuilderEdge {
  return {
    id: `${edge.fromNodeId}-${edge.toNodeId}-${edge.branchKey ?? index}`,
    source: edge.fromNodeId,
    target: edge.toNodeId,
    label: edge.branchKey ?? undefined,
    data: { branchKey: edge.branchKey ?? null },
    type: 'smoothstep',
  };
}

function flowToDefinition(nodes: BuilderNode[], edges: BuilderEdge[]) {
  const trigger = nodes.find((node) => node.data.nodeType === 'TRIGGER');
  return {
    trigger: (trigger?.data as unknown as { config?: Record<string, unknown> })?.config ?? {
      triggerType: 'TASK_CREATED',
    },
    nodes: nodes.map((node) => ({
      nodeId: node.id,
      type: node.data.nodeType,
      config: normalizeNodeConfig(
        node.data.nodeType,
        (node.data as unknown as { config?: Record<string, unknown> }).config ?? {},
      ),
    })),
    edges: edges.map((edge) => ({
      fromNodeId: edge.source,
      toNodeId: edge.target,
      branchKey: edge.data?.branchKey ?? null,
    })),
    settings: {
      ui: {
        positions: Object.fromEntries(nodes.map((node) => [node.id, node.position])),
      },
    },
  };
}

function normalizeNodeConfig(type: AutomationNodeType, config: Record<string, unknown>) {
  if (type === 'CONDITION') return normalizeConditionConfig(config);
  if (type === 'BRANCH') {
    const cases = Array.isArray(config.cases)
      ? config.cases.map((branchCase) =>
          normalizeConditionConfig(
            typeof branchCase === 'object' && branchCase !== null
              ? (branchCase as Record<string, unknown>)
              : {},
          ),
        )
      : [];
    return { ...config, cases };
  }
  return config;
}

function normalizeConditionConfig(config: Record<string, unknown>) {
  if (config.operator === 'EXISTS' || config.operator === 'NOT_EXISTS') {
    const next = { ...config };
    delete next.right;
    return next;
  }
  return config;
}

function guardedConnect(connection: Connection, nodes: BuilderNode[], edges: BuilderEdge[]) {
  const source = nodes.find((node) => node.id === connection.source);
  const target = nodes.find((node) => node.id === connection.target);
  if (
    !source ||
    !target ||
    target.data.nodeType === 'TRIGGER' ||
    wouldCreateCycle(connection.source!, connection.target!, edges)
  )
    return null;
  const outgoing = edges.filter((edge) => edge.source === source.id);
  let branchKey: string | null = null;
  if (source.data.nodeType === 'TRIGGER' || source.data.nodeType === 'ACTION') {
    if (outgoing.length >= 1) return null;
  } else if (source.data.nodeType === 'CONDITION') {
    const used = new Set(outgoing.map((edge) => edge.data?.branchKey));
    branchKey = !used.has('TRUE') ? 'TRUE' : !used.has('FALSE') ? 'FALSE' : null;
    if (!branchKey) return null;
  } else if (source.data.nodeType === 'BRANCH') {
    const config = (source.data as unknown as { config?: Record<string, unknown> }).config ?? {};
    const keys = branchKeys(config);
    branchKey = keys.find((key) => !outgoing.some((edge) => edge.data?.branchKey === key)) ?? null;
    if (!branchKey) return null;
  }
  return addEdge(
    {
      ...connection,
      id: `${source.id}-${target.id}-${branchKey ?? Date.now()}`,
      label: branchKey ?? undefined,
      data: { branchKey },
      type: 'smoothstep',
    },
    edges,
  );
}

function validateGraph(nodes: BuilderNode[], edges: BuilderEdge[]) {
  const errors: string[] = [];
  const triggers = nodes.filter((node) => node.data.nodeType === 'TRIGGER');
  if (triggers.length !== 1) errors.push('Trigger required');
  if (triggers.some((trigger) => edges.some((edge) => edge.target === trigger.id)))
    errors.push('Trigger cannot have incoming edges');
  if (hasCycle(nodes, edges)) errors.push('Workflow graph cannot contain cycles');
  for (const node of nodes) {
    const outgoing = edges.filter((edge) => edge.source === node.id);
    if (
      (node.data.nodeType === 'TRIGGER' || node.data.nodeType === 'ACTION') &&
      outgoing.length > 1
    )
      errors.push('Action fan-out is not supported');
    if (node.data.nodeType === 'CONDITION') {
      const keys = outgoing.map((edge) => edge.data?.branchKey);
      if (keys.filter((key) => key === 'TRUE').length !== 1)
        errors.push('Condition missing TRUE path');
      if (keys.filter((key) => key === 'FALSE').length !== 1)
        errors.push('Condition missing FALSE path');
      if (keys.some((key) => key !== 'TRUE' && key !== 'FALSE'))
        errors.push('Condition edges must be TRUE or FALSE');
    }
    if (node.data.nodeType === 'BRANCH') {
      const config = (node.data as unknown as { config?: Record<string, unknown> }).config ?? {};
      const keys = branchKeys(config);
      if (new Set(keys).size !== keys.length) errors.push('Branch case keys must be unique');
      for (const key of keys) {
        if (!outgoing.some((edge) => edge.data?.branchKey === key))
          errors.push(`Branch missing ${key} path`);
      }
      for (const edge of outgoing) {
        if (!keys.includes(edge.data?.branchKey ?? '')) {
          errors.push(`Branch has unsupported ${edge.data?.branchKey ?? 'unlabeled'} path`);
        }
      }
      const duplicatedEdges = outgoing
        .map((edge) => edge.data?.branchKey ?? '')
        .filter((key, index, keysList) => key && keysList.indexOf(key) !== index);
      if (duplicatedEdges.length > 0) errors.push('Branch edge keys must be unique');
    }
    const config = (node.data as unknown as { config?: Record<string, unknown> }).config ?? {};
    if (node.data.nodeType === 'ACTION') {
      const actionType = textValue(config.actionType) as AutomationActionType;
      if (!executableActionSet.has(actionType)) {
        errors.push('Unsupported Action selected');
      }
      for (const field of requiredActionFields(actionType)) {
        const value = config[field];
        if (Array.isArray(value) ? value.length === 0 : !textValue(value)) {
          errors.push(`${humanize(actionType)} requires ${humanize(field)}`);
        }
      }
    }
    for (const error of variableReferenceErrors(config)) {
      errors.push(error);
    }
  }
  if (nodes.some((node) => node.data.nodeType === 'DELAY')) errors.push('Delay is not supported');
  return [...new Set(errors)];
}

function defaultConfigFor(type: AutomationNodeType) {
  if (type === 'ACTION') return defaultActionConfig('CREATE_TASK');
  if (type === 'CONDITION')
    return { left: '{{trigger.task.priority}}', operator: 'EQUALS', right: 'HIGH' };
  if (type === 'BRANCH')
    return {
      cases: [
        { key: 'HIGH', left: '{{trigger.task.priority}}', operator: 'EQUALS', right: 'HIGH' },
      ],
      defaultKey: 'DEFAULT',
    };
  return { triggerType: 'TASK_CREATED' };
}

function defaultActionConfig(actionType: AutomationActionType): Record<string, unknown> {
  if (actionType === 'CREATE_TASK') return { actionType, title: 'Automation task' };
  if (actionType === 'ASSIGN_TASK')
    return { actionType, taskId: '{{trigger.task.id}}', membershipIds: [] };
  if (actionType === 'ADD_TASK_TAG')
    return { actionType, taskId: '{{trigger.task.id}}', tagIds: [] };
  if (actionType === 'UPDATE_PROJECT' || actionType === 'CHANGE_PROJECT_STATUS')
    return { actionType, projectId: '{{trigger.project.id}}' };
  if (actionType === 'ASSIGN_TICKET' || actionType === 'CHANGE_TICKET_STATUS')
    return { actionType, ticketId: '{{trigger.ticket.id}}' };
  return { actionType, taskId: '{{trigger.task.id}}' };
}

function requiredActionFields(actionType: AutomationActionType) {
  if (actionType === 'CREATE_TASK') return ['title'];
  if (actionType === 'UPDATE_TASK') return ['taskId'];
  if (actionType === 'ASSIGN_TASK') return ['taskId', 'membershipIds'];
  if (actionType === 'CHANGE_TASK_STATUS') return ['taskId', 'statusDefinitionId'];
  if (actionType === 'ADD_TASK_TAG') return ['taskId', 'tagIds'];
  if (actionType === 'UPDATE_PROJECT') return ['projectId'];
  if (actionType === 'CHANGE_PROJECT_STATUS') return ['projectId', 'statusDefinitionId'];
  if (actionType === 'ASSIGN_TICKET') return ['ticketId'];
  if (actionType === 'CHANGE_TICKET_STATUS') return ['ticketId', 'statusDefinitionId'];
  return ['actionType'];
}

function variableOptions(triggerType: AutomationTriggerType) {
  const common = ['event.id', 'event.entityId', 'execution.id', 'execution.correlationId'];
  if (triggerType.startsWith('PROJECT_'))
    return [
      'trigger.project.id',
      'trigger.project.xpCategory',
      'trigger.project.ownerMembershipId',
      ...common,
    ];
  if (triggerType.startsWith('TICKET_'))
    return [
      'trigger.ticket.id',
      'trigger.ticket.priority',
      'trigger.ticket.statusDefinitionId',
      'trigger.ticket.resolverMembershipId',
      ...common,
    ];
  return [
    'trigger.task.id',
    'trigger.task.priority',
    'trigger.task.statusDefinitionId',
    'trigger.task.departmentId',
    'trigger.task.dueAt',
    ...common,
  ];
}

function triggerTypeFromNodes(nodes: BuilderNode[]) {
  const trigger = nodes.find((node) => node.data.nodeType === 'TRIGGER');
  const config = (trigger?.data as unknown as { config?: Record<string, unknown> })?.config ?? {};
  return textValue(config.triggerType, 'TASK_CREATED') as AutomationTriggerType;
}

function labelFor(node: AutomationNodeDefinition) {
  if (node.type === 'TRIGGER') return humanize(textValue(node.config.triggerType, 'Trigger'));
  if (node.type === 'ACTION') return humanize(textValue(node.config.actionType, 'Action'));
  return humanize(node.type);
}

function summaryFor(type: AutomationNodeType, config: Record<string, unknown>) {
  if (type === 'CONDITION')
    return `${textValue(config.left, 'value')} ${humanize(textValue(config.operator))} ${textValue(config.right)}`.trim();
  if (type === 'BRANCH')
    return `${Array.isArray(config.cases) ? config.cases.length : 0} case(s), default ${textValue(config.defaultKey, 'DEFAULT')}`;
  if (type === 'ACTION') return humanize(textValue(config.actionType, 'Action'));
  return 'Root trigger';
}

function branchKeys(config: Record<string, unknown>) {
  const cases = Array.isArray(config.cases) ? config.cases : [];
  return [
    ...cases.map((item) => textValue((item as { key?: unknown }).key)).filter(Boolean),
    textValue(config.defaultKey, 'DEFAULT'),
  ];
}

function uiPositions(settings: Record<string, unknown>) {
  const ui =
    settings.ui && typeof settings.ui === 'object' && !Array.isArray(settings.ui)
      ? (settings.ui as Record<string, unknown>)
      : {};
  const positions =
    ui.positions && typeof ui.positions === 'object' && !Array.isArray(ui.positions)
      ? (ui.positions as Record<string, { x: number; y: number }>)
      : {};
  return positions;
}

function wouldCreateCycle(source: string, target: string, edges: BuilderEdge[]) {
  const graph = new Map<string, string[]>();
  for (const edge of [...edges, { source, target } as BuilderEdge]) {
    graph.set(edge.source, [...(graph.get(edge.source) ?? []), edge.target]);
  }
  const seen = new Set<string>();
  const visit = (nodeId: string): boolean => {
    if (nodeId === source && seen.size > 0) return true;
    if (seen.has(nodeId)) return false;
    seen.add(nodeId);
    return (graph.get(nodeId) ?? []).some(visit);
  };
  return visit(target);
}

function hasCycle(nodes: BuilderNode[], edges: BuilderEdge[]) {
  const graph = new Map<string, string[]>();
  for (const node of nodes) graph.set(node.id, []);
  for (const edge of edges)
    graph.set(edge.source, [...(graph.get(edge.source) ?? []), edge.target]);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string): boolean => {
    if (visiting.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    visiting.add(nodeId);
    const cyclic = (graph.get(nodeId) ?? []).some(visit);
    visiting.delete(nodeId);
    visited.add(nodeId);
    return cyclic;
  };
  return nodes.some((node) => visit(node.id));
}

function move<T>(items: T[], from: number, to: number) {
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

function nodeColor(type: unknown) {
  if (type === 'TRIGGER') return 'hsl(var(--info))';
  if (type === 'CONDITION') return 'hsl(var(--warning))';
  if (type === 'BRANCH') return 'hsl(var(--accent))';
  return 'hsl(var(--primary))';
}

function workspacePermissions(
  agencies: ReturnType<typeof useSessionStore.getState>['agencies'],
  workspaceId: string | null,
  roles: WorkspaceRole[],
) {
  const roleKey = agencies
    .flatMap((agency) => agency.workspaces)
    .find((workspace) => workspace.id === workspaceId)?.role;
  const role = roles.find((item) => item.key.toLowerCase() === roleKey?.toLowerCase());
  return new Set(role?.permissions.map((permission) => permission.key) ?? []);
}

function hasPermission(permissions: Set<string>, permission: string) {
  return permissions.has('*') || permissions.has(permission);
}

function textValue(value: unknown, fallback = '') {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function variableReferenceErrors(config: unknown, path = 'config'): string[] {
  if (typeof config === 'string') {
    const matches = [...config.matchAll(/\{\{([^}]+)\}\}/g)];
    const withoutValidRefs = matches.reduce((value, match) => value.replace(match[0], ''), config);
    const malformed = withoutValidRefs.includes('{{') || withoutValidRefs.includes('}}');
    const errors = malformed ? [`Invalid variable reference in ${path}`] : [];
    for (const match of matches) {
      const variable = match[1]?.trim();
      if (!variable) continue;
      if (!safeVariablePath(variable)) errors.push(`Unsupported variable reference ${variable}`);
    }
    return errors;
  }
  if (Array.isArray(config))
    return config.flatMap((item, index) => variableReferenceErrors(item, `${path}.${index}`));
  if (config && typeof config === 'object') {
    return Object.entries(config as Record<string, unknown>).flatMap(([key, value]) =>
      variableReferenceErrors(value, `${path}.${key}`),
    );
  }
  return [];
}

function safeVariablePath(value: string) {
  if (
    !/^(trigger\.(task|project|ticket)\.[A-Za-z0-9_]+|event\.[A-Za-z0-9_]+|execution\.[A-Za-z0-9_]+)$/.test(
      value,
    )
  )
    return false;
  return !/(password|secret|token|authorization|jwt|otp|api[_-]?key|headers|process\.env)/i.test(
    value,
  );
}

function humanize(value: string) {
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function safeError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
