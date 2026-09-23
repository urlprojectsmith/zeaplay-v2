import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../contexts/language-provider';
import { WorkspaceAutomationBuilderPage } from '../components/workspace/automations/WorkspaceAutomationBuilderPage';
import { WorkspaceAutomationsPage } from '../components/workspace/automations/WorkspaceAutomationsPage';
import { useSessionStore } from '../stores/session';

const routerPush = vi.fn();
const listWorkspaceAutomations = vi.fn();
const getWorkspaceAutomation = vi.fn();
const updateAutomationDraftDefinition = vi.fn();
const publishAutomation = vi.fn();
const createWorkspaceAutomation = vi.fn();
const listAutomationTemplates = vi.fn();
const getAutomationTemplate = vi.fn();
const useAutomationTemplate = vi.fn();
const archiveAutomationTemplate = vi.fn();
const listWorkspaceRoles = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

type MockFlowNode = { id: string; data: { label: string } };
type MockFlowEdge = { id: string; label?: string };
type MockReactFlowProps = {
  children?: React.ReactNode;
  nodes: MockFlowNode[];
  edges: MockFlowEdge[];
  onNodeClick?: (event: React.MouseEvent<HTMLButtonElement>, node: MockFlowNode) => void;
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
  useParams: () => ({ workflowId: 'workflow-1' }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

vi.mock('@xyflow/react', async () => {
  const React = await import('react');
  return {
    addEdge: (edge: unknown, edges: unknown[]) => [...edges, edge],
    Background: () => <div data-testid="flow-background" />,
    Controls: () => <div aria-label="Fit View" />,
    Handle: () => <span data-testid="handle" />,
    MiniMap: () => <div data-testid="flow-minimap" />,
    Position: { Top: 'top', Bottom: 'bottom' },
    ReactFlow: ({ children, nodes, edges, onNodeClick }: MockReactFlowProps) => (
      <div aria-label="Workflow Canvas">
        {nodes.map((node) => (
          <button key={node.id} onClick={(event) => onNodeClick?.(event, node)}>
            {node.data.label}
          </button>
        ))}
        {edges.map((edge) => (
          <span key={edge.id}>{edge.label}</span>
        ))}
        {children}
      </div>
    ),
    useEdgesState: (initial: unknown[]) => React.useState(initial).concat([vi.fn()]),
    useNodesState: (initial: unknown[]) => React.useState(initial).concat([vi.fn()]),
  };
});

vi.mock('../services/workspace-automations', async () => {
  const actual = await vi.importActual<typeof import('../services/workspace-automations')>(
    '../services/workspace-automations',
  );
  return {
    ...actual,
    listWorkspaceAutomations: (...args: unknown[]) => listWorkspaceAutomations(...args),
    getWorkspaceAutomation: (...args: unknown[]) => getWorkspaceAutomation(...args),
    updateAutomationDraftDefinition: (...args: unknown[]) =>
      updateAutomationDraftDefinition(...args),
    publishAutomation: (...args: unknown[]) => publishAutomation(...args),
    createWorkspaceAutomation: (...args: unknown[]) => createWorkspaceAutomation(...args),
    listAutomationTemplates: (...args: unknown[]) => listAutomationTemplates(...args),
    getAutomationTemplate: (...args: unknown[]) => getAutomationTemplate(...args),
    useAutomationTemplate: (...args: unknown[]) => useAutomationTemplate(...args),
    archiveAutomationTemplate: (...args: unknown[]) => archiveAutomationTemplate(...args),
  };
});

vi.mock('../services/workspace-roles', async () => {
  const actual = await vi.importActual<typeof import('../services/workspace-roles')>(
    '../services/workspace-roles',
  );
  return {
    ...actual,
    listWorkspaceRoles: (...args: unknown[]) => listWorkspaceRoles(...args),
  };
});

describe('Phase 11.6 visual workflow builder UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({
      selectedAgencyId: 'agency-1',
      selectedWorkspaceId: 'workspace-1',
      hydrated: true,
      accessToken: 'token',
      user: { id: 'admin-1', email: 'admin@zeaplay.test' },
      agencies: [
        {
          id: 'agency-1',
          name: 'Agency',
          slug: 'agency',
          status: 'ACTIVE',
          role: 'OWNER',
          membershipId: 'agency-member-1',
          workspaces: [
            {
              id: 'workspace-1',
              agencyId: 'agency-1',
              name: 'Workspace',
              slug: 'workspace',
              timezone: 'UTC',
              status: 'ACTIVE',
              role: 'OWNER',
              membershipId: 'workspace-member-1',
            },
          ],
        },
      ],
    });
    listWorkspaceRoles.mockResolvedValue([
      {
        id: 'role-owner',
        key: 'OWNER',
        name: 'Owner',
        description: null,
        scope: 'WORKSPACE',
        isSystem: true,
        isActive: true,
        workspaceId: 'workspace-1',
        permissions: [
          { id: 'permission-automation-edit', key: 'automation.edit' },
          { id: 'permission-automation-publish', key: 'automation.publish' },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
    listWorkspaceAutomations.mockResolvedValue({
      items: [
        {
          id: 'workflow-1',
          workspaceId: 'workspace-1',
          name: 'Priority Router',
          description: null,
          status: 'PUBLISHED',
          activePublishedVersionId: 'version-published',
          currentVersion: 2,
          hasDraft: true,
          archivedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    getWorkspaceAutomation.mockResolvedValue(workflowDetail(true));
    updateAutomationDraftDefinition.mockResolvedValue(workflowDetail(true).versions[0]);
    publishAutomation.mockResolvedValue(workflowDetail(false).versions[0]);
    createWorkspaceAutomation.mockResolvedValue({ id: 'workflow-new' });
    listAutomationTemplates.mockResolvedValue({
      items: [templateSummary()],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    getAutomationTemplate.mockResolvedValue(templateDetail());
    useAutomationTemplate.mockResolvedValue({ id: 'workflow-from-template' });
    archiveAutomationTemplate.mockResolvedValue(templateDetail());
  });

  it('opens the builder from the workflow list', async () => {
    renderWithProviders(<WorkspaceAutomationsPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Workflow Builder' }));

    expect(routerPush).toHaveBeenCalledWith('/workspace/automations/workflow-1');
  });

  it('previews a template read-only without creating workflows or drafts', async () => {
    renderWithProviders(<WorkspaceAutomationsPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Templates' }));
    fireEvent.click(await screen.findByRole('button', { name: /Preview/ }));

    expect(await screen.findByText('Template Preview')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Read-only template definition summary. Previewing never creates a workflow or draft.',
      ),
    ).toBeInTheDocument();
    expect(await screen.findByText('Task Created')).toBeInTheDocument();
    expect(getAutomationTemplate).toHaveBeenCalledWith('workspace-1', 'template-1');
    expect(useAutomationTemplate).not.toHaveBeenCalled();
    expect(createWorkspaceAutomation).not.toHaveBeenCalled();
    expect(updateAutomationDraftDefinition).not.toHaveBeenCalled();
    expect(archiveAutomationTemplate).not.toHaveBeenCalled();
  });

  it('loads an editable draft with palette restrictions and safe variables', async () => {
    renderWithProviders(<WorkspaceAutomationBuilderPage />);

    expect(await screen.findByText('Priority Router')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Action/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Condition/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /Branch/ }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Delay - Coming Later/ })).toBeDisabled();
    expect(screen.queryByText('Add Ticket Tag')).not.toBeInTheDocument();
    const createTaskNode = screen.getAllByRole('button', { name: 'Create Task' })[0];
    expect(createTaskNode).toBeDefined();
    fireEvent.click(createTaskNode!);
    expect(screen.getAllByRole('button', { name: 'trigger.task.id' }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/password|token|secret|authorization/i)).not.toBeInTheDocument();
  });

  it('saves draft graph without publishing and keeps validation explicit', async () => {
    renderWithProviders(<WorkspaceAutomationBuilderPage />);

    fireEvent.click(await screen.findByRole('button', { name: /Save Draft/ }));

    await waitFor(() => expect(updateAutomationDraftDefinition).toHaveBeenCalled());
    expect(publishAutomation).not.toHaveBeenCalled();
    const payload = updateAutomationDraftDefinition.mock.calls[0]?.[2] as {
      nodes: Array<{ type: string }>;
      settings: { ui: { positions: Record<string, unknown> } };
    };
    expect(payload.nodes.some((node) => node.type === 'CONDITION')).toBe(true);
    expect(payload.settings.ui.positions).toBeDefined();
  });

  it('round-trips trigger, nodes, edges, branch keys, configs, and variables on save', async () => {
    getWorkspaceAutomation.mockResolvedValue(workflowDetail(true, true, 'branch'));
    renderWithProviders(<WorkspaceAutomationBuilderPage />);

    fireEvent.click(await screen.findByRole('button', { name: /Save Draft/ }));

    await waitFor(() => expect(updateAutomationDraftDefinition).toHaveBeenCalled());
    const payload = updateAutomationDraftDefinition.mock.calls[0]?.[2] as {
      trigger: Record<string, unknown>;
      nodes: Array<{ nodeId: string; type: string; config: Record<string, unknown> }>;
      edges: Array<{ fromNodeId: string; toNodeId: string; branchKey?: string | null }>;
    };
    expect(payload.trigger).toMatchObject({
      triggerType: 'TASK_STATUS_CHANGED',
      fromStatusId: 'status-open',
      toStatusId: 'status-done',
    });
    expect(payload.nodes.find((node) => node.nodeId === 'branch')?.config).toMatchObject({
      cases: [
        { key: 'HIGH', left: '{{trigger.task.priority}}', operator: 'EQUALS', right: 'HIGH' },
      ],
      defaultKey: 'DEFAULT',
    });
    expect(payload.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fromNodeId: 'branch', branchKey: 'HIGH' }),
        expect.objectContaining({ fromNodeId: 'branch', branchKey: 'DEFAULT' }),
      ]),
    );
  });

  it('shows published-only workflows as read-only and creates draft explicitly', async () => {
    getWorkspaceAutomation.mockResolvedValue(workflowDetail(false));
    renderWithProviders(<WorkspaceAutomationBuilderPage />);

    expect(await screen.findByText('Read Only')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Create Draft/ }));

    await waitFor(() => expect(updateAutomationDraftDefinition).toHaveBeenCalled());
  });

  it('prevents publish while validation has missing branch paths', async () => {
    getWorkspaceAutomation.mockResolvedValue(workflowDetail(true, false));
    renderWithProviders(<WorkspaceAutomationBuilderPage />);

    expect(await screen.findByText(/Condition missing TRUE path/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
  });

  it('validates unsafe variables, unsupported actions, duplicate branch keys, and branch edges', async () => {
    getWorkspaceAutomation.mockResolvedValue(workflowDetail(true, true, 'invalid'));
    renderWithProviders(<WorkspaceAutomationBuilderPage />);

    expect(await screen.findByText('Unsupported Action selected')).toBeInTheDocument();
    expect(
      screen.getByText('Unsupported variable reference process.env.SECRET'),
    ).toBeInTheDocument();
    expect(screen.getByText('Branch case keys must be unique')).toBeInTheDocument();
    expect(screen.getByText('Branch edge keys must be unique')).toBeInTheDocument();
    expect(screen.getByText('Branch has unsupported STALE path')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
  });

  it('publishes explicitly after saving dirty draft and guards duplicate publish clicks', async () => {
    let saveResolved = false;
    updateAutomationDraftDefinition.mockImplementation(() => {
      saveResolved = true;
      return Promise.resolve(workflowDetail(true).versions[0]);
    });
    renderWithProviders(<WorkspaceAutomationBuilderPage />);

    const createTaskNode = (await screen.findAllByRole('button', { name: 'Create Task' }))[0];
    expect(createTaskNode).toBeDefined();
    fireEvent.click(createTaskNode!);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Updated title' } });
    await waitFor(() => expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish Workflow' }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish Workflow' }));

    await waitFor(() => expect(publishAutomation).toHaveBeenCalledTimes(1));
    expect(saveResolved).toBe(true);
    const saveCallOrder = updateAutomationDraftDefinition.mock.invocationCallOrder[0];
    const publishCallOrder = publishAutomation.mock.invocationCallOrder[0];
    expect(saveCallOrder).toBeDefined();
    expect(publishCallOrder).toBeDefined();
    expect(saveCallOrder!).toBeLessThan(publishCallOrder!);
  });

  it('hides edit and publish actions without automation capabilities', async () => {
    listWorkspaceRoles.mockResolvedValue([
      {
        id: 'role-viewer',
        key: 'OWNER',
        name: 'Viewer',
        description: null,
        scope: 'WORKSPACE',
        isSystem: true,
        isActive: true,
        workspaceId: 'workspace-1',
        permissions: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
    renderWithProviders(<WorkspaceAutomationBuilderPage />);

    expect(await screen.findByText('Read Only')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Save Draft/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeDisabled();
  });

  it('clears builder state when the workspace changes', async () => {
    const { rerender } = renderWithProviders(<WorkspaceAutomationBuilderPage />);
    expect(await screen.findByText('Priority Router')).toBeInTheDocument();

    act(() => {
      useSessionStore.setState({ selectedWorkspaceId: 'workspace-2' });
    });
    rerender(
      <LanguageProvider>
        <QueryHarness>
          <WorkspaceAutomationBuilderPage />
        </QueryHarness>
      </LanguageProvider>,
    );

    await waitFor(() =>
      expect(getWorkspaceAutomation).toHaveBeenCalledWith('workspace-2', 'workflow-1'),
    );
  });
});

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <LanguageProvider>
      <QueryHarness>{ui}</QueryHarness>
    </LanguageProvider>,
  );
}

function QueryHarness({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function workflowDetail(
  hasDraft: boolean,
  completeEdges = true,
  variant: 'condition' | 'branch' | 'invalid' = 'condition',
) {
  const isBranch = variant === 'branch' || variant === 'invalid';
  const draft = {
    id: 'version-draft',
    workflowId: 'workflow-1',
    workspaceId: 'workspace-1',
    versionNumber: null,
    state: 'DRAFT',
    triggerDefinition: isBranch
      ? {
          triggerType: 'TASK_STATUS_CHANGED',
          fromStatusId: 'status-open',
          toStatusId: 'status-done',
        }
      : { triggerType: 'TASK_CREATED' },
    nodesDefinition: isBranch
      ? [
          {
            nodeId: 'trigger',
            type: 'TRIGGER',
            config: {
              triggerType: 'TASK_STATUS_CHANGED',
              fromStatusId: 'status-open',
              toStatusId: 'status-done',
            },
          },
          {
            nodeId: 'branch',
            type: 'BRANCH',
            config:
              variant === 'invalid'
                ? {
                    cases: [
                      {
                        key: 'HIGH',
                        left: '{{process.env.SECRET}}',
                        operator: 'EQUALS',
                        right: 'HIGH',
                      },
                      {
                        key: 'HIGH',
                        left: '{{trigger.task.priority}}',
                        operator: 'EQUALS',
                        right: 'LOW',
                      },
                    ],
                    defaultKey: 'DEFAULT',
                  }
                : {
                    cases: [
                      {
                        key: 'HIGH',
                        left: '{{trigger.task.priority}}',
                        operator: 'EQUALS',
                        right: 'HIGH',
                      },
                    ],
                    defaultKey: 'DEFAULT',
                  },
          },
          {
            nodeId: 'create-task',
            type: 'ACTION',
            config:
              variant === 'invalid'
                ? {
                    actionType: 'ADD_TICKET_TAG',
                    ticketId: '{{trigger.ticket.id}}',
                    tagIds: ['tag-1'],
                  }
                : { actionType: 'CREATE_TASK', title: 'Follow up {{trigger.task.id}}' },
          },
          {
            nodeId: 'fallback-task',
            type: 'ACTION',
            config: { actionType: 'CREATE_TASK', title: 'Fallback' },
          },
        ]
      : [
          { nodeId: 'trigger', type: 'TRIGGER', config: { triggerType: 'TASK_CREATED' } },
          {
            nodeId: 'condition',
            type: 'CONDITION',
            config: { left: '{{trigger.task.priority}}', operator: 'EQUALS', right: 'HIGH' },
          },
          {
            nodeId: 'create-task',
            type: 'ACTION',
            config: { actionType: 'CREATE_TASK', title: 'Follow up' },
          },
          {
            nodeId: 'fallback-task',
            type: 'ACTION',
            config: { actionType: 'CREATE_TASK', title: 'Fallback' },
          },
        ],
    edgesDefinition: isBranch
      ? variant === 'invalid'
        ? [
            { fromNodeId: 'trigger', toNodeId: 'branch' },
            { fromNodeId: 'branch', toNodeId: 'create-task', branchKey: 'HIGH' },
            { fromNodeId: 'branch', toNodeId: 'fallback-task', branchKey: 'HIGH' },
            { fromNodeId: 'branch', toNodeId: 'fallback-task', branchKey: 'STALE' },
          ]
        : [
            { fromNodeId: 'trigger', toNodeId: 'branch' },
            { fromNodeId: 'branch', toNodeId: 'create-task', branchKey: 'HIGH' },
            { fromNodeId: 'branch', toNodeId: 'fallback-task', branchKey: 'DEFAULT' },
          ]
      : completeEdges
        ? [
            { fromNodeId: 'trigger', toNodeId: 'condition' },
            { fromNodeId: 'condition', toNodeId: 'create-task', branchKey: 'TRUE' },
            { fromNodeId: 'condition', toNodeId: 'fallback-task', branchKey: 'FALSE' },
          ]
        : [{ fromNodeId: 'trigger', toNodeId: 'condition' }],
    settingsDefinition: {
      ui: {
        positions: {
          trigger: { x: 0, y: 0 },
          condition: { x: 0, y: 120 },
          'create-task': { x: -140, y: 260 },
          'fallback-task': { x: 140, y: 260 },
        },
      },
    },
    definitionSizeBytes: 1000,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    publishedAt: null,
  };
  const published = {
    ...draft,
    id: 'version-published',
    state: 'PUBLISHED',
    versionNumber: 2,
    publishedAt: new Date().toISOString(),
  };
  return {
    id: 'workflow-1',
    workspaceId: 'workspace-1',
    name: 'Priority Router',
    description: null,
    status: 'PUBLISHED',
    activePublishedVersionId: 'version-published',
    currentVersion: 2,
    hasDraft,
    archivedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    versions: hasDraft ? [draft, published] : [published],
  };
}

function templateSummary() {
  return {
    id: 'template-1',
    workspaceId: 'workspace-1',
    name: 'Priority Template',
    description: 'Reusable priority flow',
    definitionVersion: '1',
    definitionSizeBytes: 512,
    sourceWorkflowId: 'workflow-1',
    sourceWorkflowVersionId: 'version-published',
    archivedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function templateDetail() {
  return {
    ...templateSummary(),
    triggerDefinition: { triggerType: 'TASK_CREATED' },
    nodesDefinition: [
      { nodeId: 'trigger', type: 'TRIGGER', config: { triggerType: 'TASK_CREATED' } },
      { nodeId: 'action', type: 'ACTION', config: { actionType: 'CREATE_TASK', title: 'Task' } },
    ],
    edgesDefinition: [{ fromNodeId: 'trigger', toNodeId: 'action' }],
    settingsDefinition: {},
  };
}
