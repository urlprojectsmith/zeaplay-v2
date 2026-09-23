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

  it('checks action and published workflow limits inside a workspace quota lock before publish', async () => {
    const workflowId = 'workflow-1';
    const draft = versionRecord({ workflowId, workspaceId: tenant.workspaceId });
    const tx = {
      automationWorkflow: {
        findFirst: jest.fn().mockResolvedValue({ id: workflowId }),
        update: jest.fn().mockResolvedValue({ id: workflowId }),
      },
      automationWorkflowVersion: {
        findFirst: jest.fn().mockResolvedValue(draft),
        aggregate: jest.fn().mockResolvedValue({ _max: { versionNumber: 0 } }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ ...draft, state: 'PUBLISHED', versionNumber: 1 }),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const policy = {
      assertActionCountLimit: jest.fn().mockResolvedValue(undefined),
      withWorkspaceQuotaLock: jest.fn((_workspaceId, _tx, _suffix, callback) => callback()),
      assertPublishedWorkflowLimit: jest.fn().mockResolvedValue(undefined),
    };
    const service = new AutomationService(prisma as never, audit as never, policy as never);

    await service.publish(tenant, workflowId);

    expect(policy.assertActionCountLimit).toHaveBeenCalledWith(tenant.workspaceId, 0, tx);
    expect(policy.withWorkspaceQuotaLock).toHaveBeenCalledWith(
      tenant.workspaceId,
      tx,
      11800,
      expect.any(Function),
    );
    expect(policy.assertPublishedWorkflowLimit).toHaveBeenCalledWith(
      tenant.workspaceId,
      workflowId,
      tx,
    );
  });

  it('clones a workflow into a new draft workflow with an audit record', async () => {
    const workflowId = 'workflow-1';
    const sourceVersion = versionRecord({ workflowId, workspaceId: tenant.workspaceId });
    const clonedVersion = versionRecord({
      workflowId: 'workflow-copy',
      workspaceId: tenant.workspaceId,
    });
    const tx = {
      automationWorkflow: {
        create: jest.fn().mockResolvedValue({ id: 'workflow-copy' }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'workflow-copy',
          workspaceId: tenant.workspaceId,
          name: 'Source Copy',
          description: 'Source description',
          status: 'DRAFT',
          activePublishedVersionId: null,
          archivedAt: null,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          activePublishedVersion: null,
          createdByMembershipId: tenant.workspaceMembershipId,
          updatedByMembershipId: tenant.workspaceMembershipId,
          versions: [clonedVersion],
        }),
      },
      automationWorkflowVersion: {
        create: jest.fn().mockResolvedValue(clonedVersion),
      },
    };
    const prisma = {
      automationWorkflow: {
        findFirst: jest.fn().mockResolvedValue({
          id: workflowId,
          name: 'Source',
          description: 'Source description',
          activePublishedVersionId: null,
        }),
      },
      automationWorkflowVersion: {
        findFirst: jest.fn().mockResolvedValue(sourceVersion),
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new AutomationService(prisma as never, audit as never);

    const result = await service.cloneWorkflow(tenant, workflowId, { name: 'Source Copy' });

    expect(result.id).toBe('workflow-copy');
    expect(prisma.automationWorkflow.findFirst).toHaveBeenCalledWith({
      where: { id: workflowId, workspaceId: tenant.workspaceId, archivedAt: null },
      select: {
        id: true,
        name: true,
        description: true,
        activePublishedVersionId: true,
      },
    });
    expect(tx.automationWorkflow.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workspaceId: tenant.workspaceId,
          name: 'Source Copy',
          description: 'Source description',
        }),
      }),
    );
    expect(tx.automationWorkflowVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          triggerDefinition: { triggerType: AutomationTriggerType.TASK_CREATED },
          nodesDefinition: expect.arrayContaining([
            expect.objectContaining({
              type: AutomationWorkflowNodeType.TRIGGER,
              nodeId: expect.not.stringMatching(/^trigger$/),
            }),
          ]),
        }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: tenant.workspaceId,
        action: 'automation.workflow_cloned',
        entityType: 'AutomationWorkflow',
        entityId: 'workflow-copy',
      }),
    );
  });

  it('creates a draft from a historical published version without mutating that version', async () => {
    const workflowId = 'workflow-1';
    const source = versionRecord({
      id: 'version-1',
      workflowId,
      workspaceId: tenant.workspaceId,
      state: 'PUBLISHED',
      versionNumber: 1,
    });
    const draft = versionRecord({
      id: 'draft-from-v1',
      workflowId,
      workspaceId: tenant.workspaceId,
    });
    const tx = {
      automationWorkflow: {
        findFirst: jest.fn().mockResolvedValue({ id: workflowId }),
        update: jest.fn().mockResolvedValue({ id: workflowId }),
      },
      automationWorkflowVersion: {
        findFirst: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(source),
        create: jest.fn().mockResolvedValue(draft),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new AutomationService(prisma as never, audit as never);

    const result = await service.createDraftFromVersion(tenant, workflowId, source.id);

    expect(result.id).toBe('draft-from-v1');
    expect(tx.automationWorkflowVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workflow: {
            connect: { id_workspaceId: { id: workflowId, workspaceId: tenant.workspaceId } },
          },
          triggerDefinition: source.triggerDefinition,
          nodesDefinition: source.nodesDefinition,
          edgesDefinition: source.edgesDefinition,
        }),
      }),
    );
    expect(tx.automationWorkflowVersion.create).toHaveBeenCalledTimes(1);
    expect(tx.automationWorkflowVersion).not.toHaveProperty('update');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'automation.draft_created_from_version',
        entityId: workflowId,
        metadata: expect.objectContaining({
          sourceVersionId: source.id,
          draftVersionId: draft.id,
        }),
      }),
    );
  });

  it('blocks historical draft restore when an active draft already exists', async () => {
    const workflowId = 'workflow-1';
    const existingDraft = versionRecord({ workflowId, workspaceId: tenant.workspaceId });
    const tx = {
      automationWorkflow: {
        findFirst: jest.fn().mockResolvedValue({ id: workflowId }),
      },
      automationWorkflowVersion: {
        findFirst: jest.fn().mockResolvedValue(existingDraft),
        create: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };
    const audit = { record: jest.fn() };
    const service = new AutomationService(prisma as never, audit as never);

    await expect(service.createDraftFromVersion(tenant, workflowId, 'version-1')).rejects.toThrow(
      'Archive or publish the current draft before restoring.',
    );
    expect(tx.automationWorkflowVersion.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});

function versionRecord(input: {
  id?: string;
  workflowId: string;
  workspaceId: string;
  state?: 'DRAFT' | 'PUBLISHED';
  versionNumber?: number | null;
}) {
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
    id: input.id ?? 'version-1',
    workflowId: input.workflowId,
    workspaceId: input.workspaceId,
    versionNumber: input.versionNumber ?? null,
    state: input.state ?? 'DRAFT',
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
