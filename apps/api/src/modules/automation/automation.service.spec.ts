import { AutomationTriggerType, AutomationWorkflowNodeType } from '@prisma/client';
import type { WorkspaceTenantContext } from '../../common/auth/auth.types';
import { AutomationService } from './automation.service';

describe('AutomationService', () => {
  const tenant: WorkspaceTenantContext = {
    agencyId: 'agency-1',
    workspaceId: 'workspace-1',
    workspaceMembershipId: 'membership-1',
    agencyMembershipId: null,
    roleId: 'role-1',
    roleName: 'ADMIN',
    permissions: ['automation.publish'],
    accessSource: 'WORKSPACE_MEMBERSHIP',
    userId: 'user-1',
  };

  it('publishes the active draft with a workspace-scoped next version number', async () => {
    const workflowId = 'workflow-1';
    const draft = versionRecord({ workflowId, workspaceId: tenant.workspaceId });
    const tx = {
      automationWorkflow: {
        findFirst: jest.fn().mockResolvedValue({ id: workflowId }),
        update: jest.fn().mockResolvedValue({ id: workflowId }),
      },
      automationWorkflowVersion: {
        findFirst: jest.fn().mockResolvedValue(draft),
        aggregate: jest.fn().mockResolvedValue({ _max: { versionNumber: 2 } }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ ...draft, state: 'PUBLISHED', versionNumber: 3 }),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new AutomationService(prisma as never, audit as never);

    const result = await service.publish(tenant, workflowId);

    expect(result.versionNumber).toBe(3);
    expect(tx.automationWorkflow.findFirst).toHaveBeenCalledWith({
      where: { id: workflowId, workspaceId: tenant.workspaceId, archivedAt: null },
      select: { id: true },
    });
    expect(tx.automationWorkflowVersion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workflowId, workspaceId: tenant.workspaceId, state: 'DRAFT' },
      }),
    );
    expect(tx.automationWorkflowVersion.aggregate).toHaveBeenCalledWith({
      where: { workflowId, workspaceId: tenant.workspaceId, state: 'PUBLISHED' },
      _max: { versionNumber: true },
    });
    expect(tx.automationWorkflowVersion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: draft.id, state: 'DRAFT' },
        data: expect.objectContaining({ state: 'PUBLISHED', versionNumber: 3 }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: tenant.workspaceId,
        action: 'automation.workflow_published',
        entityId: workflowId,
      }),
    );
  });
});

function versionRecord(input: { workflowId: string; workspaceId: string }) {
  const definition = {
    trigger: { triggerType: AutomationTriggerType.TASK_CREATED },
    nodes: [
      {
        nodeId: 'trigger',
        type: AutomationWorkflowNodeType.TRIGGER,
        config: { triggerType: AutomationTriggerType.TASK_CREATED },
      },
    ],
    edges: [],
    settings: {},
  };

  return {
    id: 'version-1',
    workflowId: input.workflowId,
    workspaceId: input.workspaceId,
    versionNumber: null,
    state: 'DRAFT',
    definitionVersion: '1',
    triggerDefinition: definition.trigger,
    nodesDefinition: definition.nodes,
    edgesDefinition: definition.edges,
    settingsDefinition: definition.settings,
    definitionSizeBytes: 128,
    createdByMembershipId: 'membership-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    publishedAt: null,
  };
}
