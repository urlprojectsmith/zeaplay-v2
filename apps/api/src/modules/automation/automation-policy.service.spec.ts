import { AutomationExecutionStatus } from '@prisma/client';
import type { WorkspaceTenantContext } from '../../common/auth/auth.types';
import {
  AUTOMATION_MAX_PUBLISHED_WORKFLOWS,
  AUTOMATION_MAX_REPLAYS_PER_HOUR,
} from './automation.constants';
import { AutomationPolicyService } from './automation-policy.service';

describe('AutomationPolicyService', () => {
  const tenant: WorkspaceTenantContext = {
    agencyId: 'agency-1',
    workspaceId: 'workspace-1',
    workspaceMembershipId: 'member-1',
    agencyMembershipId: null,
    roleId: 'role-1',
    roleName: 'ADMIN',
    permissions: [],
    accessSource: 'WORKSPACE_MEMBERSHIP',
    userId: 'user-1',
  };

  it('rejects workspace overrides that exceed platform hard caps', async () => {
    const prisma = {
      automationWorkspacePolicy: { upsert: jest.fn() },
    };
    const service = new AutomationPolicyService(prisma as never);

    await expect(
      service.updateRuntimePolicy(tenant, {
        maxPublishedWorkflows: AUTOMATION_MAX_PUBLISHED_WORKFLOWS + 1,
        maxExecutionsPerMinute: 1,
        maxConcurrentExecutions: 1,
        maxActionsPerExecution: 1,
        maxReplaysPerHour: 1,
      }),
    ).rejects.toThrow('AUTOMATION_POLICY_EXCEEDS_PLATFORM_CAP');
    expect(prisma.automationWorkspacePolicy.upsert).not.toHaveBeenCalled();
  });

  it('uses a PostgreSQL advisory transaction lock for workspace quota decisions', async () => {
    const tx = { $executeRaw: jest.fn().mockResolvedValue(1) };
    const service = new AutomationPolicyService({} as never);
    const callback = jest.fn().mockResolvedValue('locked');

    await expect(
      service.withWorkspaceQuotaLock('workspace-1', tx as never, 118, callback),
    ).resolves.toBe('locked');

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('enforces replay-per-hour limits with workspace-scoped PostgreSQL counts', async () => {
    const tx = {
      automationWorkspacePolicy: {
        findUnique: jest.fn().mockResolvedValue({ maxReplaysPerHour: 1 }),
      },
      automationExecution: {
        count: jest.fn().mockResolvedValue(1),
      },
    };
    const service = new AutomationPolicyService(tx as never);

    await expect(service.assertReplayLimit('workspace-1', tx as never)).rejects.toThrow(
      'AUTOMATION_REPLAY_LIMIT_EXCEEDED',
    );
    expect(tx.automationExecution.count).toHaveBeenCalledWith({
      where: {
        workspaceId: 'workspace-1',
        replayOfExecutionId: { not: null },
        createdAt: { gte: expect.any(Date) },
      },
    });
  });

  it('enforces concurrent execution limits and can exclude the pending row being dispatched', async () => {
    const tx = {
      automationWorkspacePolicy: {
        findUnique: jest.fn().mockResolvedValue({ maxConcurrentExecutions: 1 }),
      },
      automationExecution: {
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const service = new AutomationPolicyService(tx as never);

    await service.assertConcurrentExecutionLimit('workspace-1', tx as never, 'execution-1');

    expect(tx.automationExecution.count).toHaveBeenCalledWith({
      where: {
        workspaceId: 'workspace-1',
        status: {
          in: [
            AutomationExecutionStatus.PENDING_QUEUE,
            AutomationExecutionStatus.QUEUED,
            AutomationExecutionStatus.RUNNING,
            AutomationExecutionStatus.RETRYING,
          ],
        },
        id: { not: 'execution-1' },
      },
    });
  });

  it('uses platform defaults when no workspace policy row exists', async () => {
    const prisma = {
      automationWorkspacePolicy: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const service = new AutomationPolicyService(prisma as never);

    const policy = await service.getRuntimePolicy(tenant);

    expect(policy.source).toBe('PLATFORM_DEFAULT');
    expect(policy.effective.maxReplaysPerHour).toBe(AUTOMATION_MAX_REPLAYS_PER_HOUR);
  });
});
