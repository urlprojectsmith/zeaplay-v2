import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { AutomationExecutionStatus, Prisma } from '@prisma/client';
import type { WorkspaceTenantContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  AUTOMATION_DEFAULT_MAX_ATTEMPTS,
  AUTOMATION_MAX_ACTIONS_PER_EXECUTION,
  AUTOMATION_MAX_CONCURRENT_EXECUTIONS,
  AUTOMATION_MAX_FUTURE_DEPTH,
  AUTOMATION_MAX_PUBLISHED_WORKFLOWS,
  AUTOMATION_MAX_REPLAYS_PER_HOUR,
  AUTOMATION_MAX_EXECUTIONS_PER_MINUTE,
} from './automation.constants';

type Tx = Prisma.TransactionClient;

export interface AutomationEffectivePolicy {
  maxPublishedWorkflows: number;
  maxExecutionsPerMinute: number;
  maxConcurrentExecutions: number;
  maxActionsPerExecution: number;
  maxReplaysPerHour: number;
}

export const activeExecutionStatuses = [
  AutomationExecutionStatus.PENDING_QUEUE,
  AutomationExecutionStatus.QUEUED,
  AutomationExecutionStatus.RUNNING,
  AutomationExecutionStatus.RETRYING,
];

const platformCaps: AutomationEffectivePolicy = {
  maxPublishedWorkflows: AUTOMATION_MAX_PUBLISHED_WORKFLOWS,
  maxExecutionsPerMinute: AUTOMATION_MAX_EXECUTIONS_PER_MINUTE,
  maxConcurrentExecutions: AUTOMATION_MAX_CONCURRENT_EXECUTIONS,
  maxActionsPerExecution: AUTOMATION_MAX_ACTIONS_PER_EXECUTION,
  maxReplaysPerHour: AUTOMATION_MAX_REPLAYS_PER_HOUR,
};

@Injectable()
export class AutomationPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  platformCaps() {
    return {
      ...platformCaps,
      maxRetryAttempts: AUTOMATION_DEFAULT_MAX_ATTEMPTS,
      maxAutomationDepth: AUTOMATION_MAX_FUTURE_DEPTH,
    };
  }

  async getRuntimePolicy(tenant: WorkspaceTenantContext) {
    const policy = await this.prisma.automationWorkspacePolicy.findUnique({
      where: { workspaceId: tenant.workspaceId },
    });
    return {
      effective: this.effective(policy),
      source: policy ? 'WORKSPACE_OVERRIDE' : 'PLATFORM_DEFAULT',
      override: policy ? serializePolicy(policy) : null,
      platformCaps: this.platformCaps(),
    };
  }

  async updateRuntimePolicy(
    tenant: WorkspaceTenantContext,
    dto: Partial<AutomationEffectivePolicy>,
  ) {
    const data = this.validateOverride(dto);
    const policy = await this.prisma.automationWorkspacePolicy.upsert({
      where: { workspaceId: tenant.workspaceId },
      create: { workspaceId: tenant.workspaceId, ...data },
      update: data,
    });
    return {
      effective: this.effective(policy),
      source: 'WORKSPACE_OVERRIDE',
      override: serializePolicy(policy),
      platformCaps: this.platformCaps(),
    };
  }

  async effectiveForWorkspace(workspaceId: string, client: Tx | PrismaService = this.prisma) {
    const policy = await client.automationWorkspacePolicy.findUnique({ where: { workspaceId } });
    return this.effective(policy);
  }

  async withWorkspaceQuotaLock<T>(
    workspaceId: string,
    tx: Tx,
    suffix: number,
    fn: () => Promise<T>,
  ) {
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}), ${suffix})`,
    );
    return fn();
  }

  async assertPublishedWorkflowLimit(workspaceId: string, workflowId: string, tx: Tx) {
    const policy = await this.effectiveForWorkspace(workspaceId, tx);
    const alreadyPublished = await tx.automationWorkflow.findFirst({
      where: { id: workflowId, workspaceId, status: { in: ['PUBLISHED', 'DISABLED'] } },
      select: { id: true },
    });
    if (alreadyPublished) return;
    const count = await tx.automationWorkflow.count({
      where: { workspaceId, archivedAt: null, status: { in: ['PUBLISHED', 'DISABLED'] } },
    });
    if (count >= policy.maxPublishedWorkflows) {
      throw new ForbiddenException('AUTOMATION_WORKFLOW_LIMIT_EXCEEDED');
    }
  }

  async assertExecutionCreationLimits(workspaceId: string, tx: Tx) {
    const policy = await this.effectiveForWorkspace(workspaceId, tx);
    const since = new Date(Date.now() - 60_000);
    const recent = await tx.automationExecution.count({
      where: { workspaceId, createdAt: { gte: since } },
    });
    if (recent >= policy.maxExecutionsPerMinute) {
      throw new ForbiddenException('AUTOMATION_EXECUTION_RATE_LIMITED');
    }
  }

  async assertConcurrentExecutionLimit(workspaceId: string, tx: Tx, excludeExecutionId?: string) {
    const policy = await this.effectiveForWorkspace(workspaceId, tx);
    const active = await tx.automationExecution.count({
      where: {
        workspaceId,
        status: { in: activeExecutionStatuses },
        id: excludeExecutionId ? { not: excludeExecutionId } : undefined,
      },
    });
    if (active >= policy.maxConcurrentExecutions) {
      throw new ForbiddenException('AUTOMATION_CONCURRENCY_LIMIT');
    }
  }

  async assertReplayLimit(workspaceId: string, tx: Tx) {
    const policy = await this.effectiveForWorkspace(workspaceId, tx);
    const since = new Date(Date.now() - 60 * 60_000);
    const recent = await tx.automationExecution.count({
      where: { workspaceId, replayOfExecutionId: { not: null }, createdAt: { gte: since } },
    });
    if (recent >= policy.maxReplaysPerHour) {
      throw new ForbiddenException('AUTOMATION_REPLAY_LIMIT_EXCEEDED');
    }
  }

  async assertActionCountLimit(workspaceId: string, actionCount: number, tx: Tx | PrismaService) {
    const policy = await this.effectiveForWorkspace(workspaceId, tx);
    if (actionCount > policy.maxActionsPerExecution) {
      throw new ForbiddenException('AUTOMATION_ACTION_LIMIT_EXCEEDED');
    }
  }

  private effective(policy: AutomationEffectivePolicy | null): AutomationEffectivePolicy {
    return {
      maxPublishedWorkflows: Math.min(
        policy?.maxPublishedWorkflows ?? platformCaps.maxPublishedWorkflows,
        platformCaps.maxPublishedWorkflows,
      ),
      maxExecutionsPerMinute: Math.min(
        policy?.maxExecutionsPerMinute ?? platformCaps.maxExecutionsPerMinute,
        platformCaps.maxExecutionsPerMinute,
      ),
      maxConcurrentExecutions: Math.min(
        policy?.maxConcurrentExecutions ?? platformCaps.maxConcurrentExecutions,
        platformCaps.maxConcurrentExecutions,
      ),
      maxActionsPerExecution: Math.min(
        policy?.maxActionsPerExecution ?? platformCaps.maxActionsPerExecution,
        platformCaps.maxActionsPerExecution,
      ),
      maxReplaysPerHour: Math.min(
        policy?.maxReplaysPerHour ?? platformCaps.maxReplaysPerHour,
        platformCaps.maxReplaysPerHour,
      ),
    };
  }

  private validateOverride(dto: Partial<AutomationEffectivePolicy>): AutomationEffectivePolicy {
    return {
      maxPublishedWorkflows: limit(dto.maxPublishedWorkflows, platformCaps.maxPublishedWorkflows),
      maxExecutionsPerMinute: limit(
        dto.maxExecutionsPerMinute,
        platformCaps.maxExecutionsPerMinute,
      ),
      maxConcurrentExecutions: limit(
        dto.maxConcurrentExecutions,
        platformCaps.maxConcurrentExecutions,
      ),
      maxActionsPerExecution: limit(
        dto.maxActionsPerExecution,
        platformCaps.maxActionsPerExecution,
      ),
      maxReplaysPerHour: limit(dto.maxReplaysPerHour, platformCaps.maxReplaysPerHour),
    };
  }
}

function limit(value: number | undefined, cap: number): number {
  const candidate = value;
  if (!Number.isInteger(candidate) || candidate === undefined || candidate < 1) {
    throw new BadRequestException('AUTOMATION_POLICY_INVALID');
  }
  if (candidate > cap) throw new BadRequestException('AUTOMATION_POLICY_EXCEEDS_PLATFORM_CAP');
  return candidate;
}

function serializePolicy(
  policy: AutomationEffectivePolicy & { id?: string; workspaceId?: string },
) {
  return {
    maxPublishedWorkflows: policy.maxPublishedWorkflows,
    maxExecutionsPerMinute: policy.maxExecutionsPerMinute,
    maxConcurrentExecutions: policy.maxConcurrentExecutions,
    maxActionsPerExecution: policy.maxActionsPerExecution,
    maxReplaysPerHour: policy.maxReplaysPerHour,
  };
}
