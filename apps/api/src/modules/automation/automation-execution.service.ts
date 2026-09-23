import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  Optional,
  forwardRef,
} from '@nestjs/common';
import {
  AutomationActionType,
  AutomationConditionOperator,
  AutomationExecutionStatus,
  AutomationStepExecutionStatus,
  AutomationWorkflowNodeType,
  Prisma,
} from '@prisma/client';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import type { WorkspaceTenantContext } from '../../common/auth/auth.types';
import {
  AUTOMATION_EXECUTION_JOB_TYPE,
  AUTOMATION_EXECUTION_QUEUE,
} from '../../infrastructure/queue/queue.constants';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  toPrismaJson,
  validateAutomationActionConfig,
  validateAutomationDefinition,
} from './automation-graph.validator';
import { AutomationActionService } from './automation-action.service';
import {
  AutomationVariableContext,
  AutomationVariableResolver,
  isFullVariableReference,
} from './automation-variable-resolver';
import {
  AUTOMATION_DEFAULT_MAX_ATTEMPTS,
  AUTOMATION_DISPATCH_BATCH_SIZE,
  AUTOMATION_MAX_FUTURE_DEPTH,
} from './automation.constants';
import type { AutomationExecutionQueryDto } from './dto/automation.dto';

type Tx = Prisma.TransactionClient;

interface RuntimeNode {
  nodeId: string;
  type: AutomationWorkflowNodeType;
  config: Record<string, unknown>;
}

interface RuntimeEdge {
  sourceNodeId: string;
  targetNodeId: string;
  branchKey: string | null;
}

type ErrorKind = 'RETRYABLE' | 'NON_RETRYABLE';
const STALE_RUNNING_EXECUTION_MS = 5 * 60 * 1000;
type RuntimePlan =
  { status: 'PENDING_QUEUE' } | { status: 'SUCCEEDED' } | { status: 'BLOCKED'; reason: string };

@Injectable()
export class AutomationExecutionService {
  private readonly logger = new Logger(AutomationExecutionService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => AutomationActionService))
    private readonly actions: AutomationActionService,
    @Optional()
    @InjectQueue(AUTOMATION_EXECUTION_QUEUE)
    private readonly queue?: Queue<{ executionId: string }>,
  ) {}

  async createForTriggerMatch(triggerMatchId: string, client: Tx | PrismaService = this.prisma) {
    const match = await client.automationTriggerMatch.findUnique({
      where: { id: triggerMatchId },
      select: {
        id: true,
        workspaceId: true,
        domainEventId: true,
        workflowId: true,
        workflowVersionId: true,
        runtimeEligibleAt: true,
        domainEvent: {
          select: {
            id: true,
            workspaceId: true,
            correlationId: true,
            automationDepth: true,
          },
        },
        workflowVersion: {
          select: {
            id: true,
            workspaceId: true,
            nodesDefinition: true,
            edgesDefinition: true,
          },
        },
      },
    });
    if (!match || !match.runtimeEligibleAt) return null;
    const existing = await client.automationExecution.findUnique({
      where: { triggerMatchId: match.id },
      select: { id: true },
    });
    if (existing) return existing;

    const blockedDepth = match.domainEvent.automationDepth >= AUTOMATION_MAX_FUTURE_DEPTH;
    const plan = blockedDepth
      ? { status: AutomationExecutionStatus.BLOCKED, reason: 'AUTOMATION_MAX_DEPTH_EXCEEDED' }
      : planDeterministicRuntime(
          match.workflowVersion.nodesDefinition,
          match.workflowVersion.edgesDefinition,
        );
    const executionId = randomUUID();
    const status =
      plan.status === AutomationExecutionStatus.SUCCEEDED
        ? AutomationExecutionStatus.SUCCEEDED
        : plan.status === AutomationExecutionStatus.BLOCKED
          ? AutomationExecutionStatus.BLOCKED
          : AutomationExecutionStatus.PENDING_QUEUE;
    const now = new Date();

    try {
      return await client.automationExecution.create({
        data: {
          workspaceId: match.workspaceId,
          id: executionId,
          triggerMatchId: match.id,
          domainEventId: match.domainEventId,
          workflowId: match.workflowId,
          workflowVersionId: match.workflowVersionId,
          status,
          correlationId: match.domainEvent.correlationId,
          automationDepth: match.domainEvent.automationDepth,
          maxAttempts: AUTOMATION_DEFAULT_MAX_ATTEMPTS,
          failureCode: 'reason' in plan ? plan.reason : null,
          failureMessage: 'reason' in plan ? safeMessage(plan.reason) : null,
          finishedAt:
            status === AutomationExecutionStatus.SUCCEEDED ||
            status === AutomationExecutionStatus.BLOCKED
              ? now
              : null,
        },
        select: { id: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return client.automationExecution.findUnique({
          where: { triggerMatchId: match.id },
          select: { id: true },
        });
      }
      throw error;
    }
  }

  async dispatchPendingExecutions(limit = AUTOMATION_DISPATCH_BATCH_SIZE) {
    if (!this.queue) return { enqueued: 0 };
    const pending = await this.prisma.automationExecution.findMany({
      where: {
        status: { in: [AutomationExecutionStatus.PENDING_QUEUE, AutomationExecutionStatus.QUEUED] },
      },
      select: { id: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: Math.min(Math.max(limit, 1), AUTOMATION_DISPATCH_BATCH_SIZE),
    });
    let enqueued = 0;
    for (const execution of pending) {
      await this.queue.add(
        AUTOMATION_EXECUTION_JOB_TYPE,
        { executionId: execution.id },
        {
          jobId: execution.id,
          attempts: AUTOMATION_DEFAULT_MAX_ATTEMPTS,
          backoff: { type: 'exponential', delay: 1_000 },
          removeOnComplete: { age: 86_400, count: 1_000 },
          removeOnFail: { age: 604_800 },
        },
      );
      await this.prisma.automationExecution.updateMany({
        where: { id: execution.id, status: AutomationExecutionStatus.PENDING_QUEUE },
        data: { status: AutomationExecutionStatus.QUEUED, queuedAt: new Date() },
      });
      enqueued += 1;
    }
    return { enqueued };
  }

  async listExecutions(tenant: WorkspaceTenantContext, query: AutomationExecutionQueryDto) {
    const where: Prisma.AutomationExecutionWhereInput = {
      workspaceId: tenant.workspaceId,
      status: query.status,
      workflowId: query.workflowId,
      workflowVersionId: query.workflowVersionId,
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.automationExecution.count({ where }),
      this.prisma.automationExecution.findMany({
        where,
        select: executionListSelect,
        orderBy: [{ createdAt: query.sortDirection }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async getExecution(tenant: WorkspaceTenantContext, executionId: string) {
    const execution = await this.prisma.automationExecution.findFirst({
      where: { id: executionId, workspaceId: tenant.workspaceId },
      select: executionDetailSelect,
    });
    if (!execution) throw new BadRequestException('AUTOMATION_EXECUTION_NOT_FOUND');
    return execution;
  }

  async processExecution(executionId: string) {
    const staleStartedBefore = new Date(Date.now() - STALE_RUNNING_EXECUTION_MS);
    const claimed = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id
        FROM automation_executions
        WHERE id = ${executionId}::uuid
          AND (
            status IN ('QUEUED', 'RETRYING')
            OR (status = 'RUNNING' AND started_at <= ${staleStartedBefore})
          )
        FOR UPDATE SKIP LOCKED
      `);
      if (rows.length === 0) return null;
      return tx.automationExecution.update({
        where: { id: executionId },
        data: {
          status: AutomationExecutionStatus.RUNNING,
          startedAt: new Date(),
          attemptCount: { increment: 1 },
        },
        select: executionSelect,
      });
    });
    if (!claimed) return;
    if (claimed.automationDepth >= AUTOMATION_MAX_FUTURE_DEPTH) {
      await this.blockExecution(executionId, 'AUTOMATION_MAX_DEPTH_EXCEEDED');
      return;
    }

    const tenant = tenantFromExecution(claimed);
    const graph = runtimeGraph(
      claimed.workflowVersion.nodesDefinition,
      claimed.workflowVersion.edgesDefinition,
    );
    if (!graph) {
      await this.blockExecution(executionId, 'AUTOMATION_RUNTIME_UNSUPPORTED_GRAPH');
      return;
    }
    let current = graph.trigger;
    while (true) {
      const edge = await this.nextEdgeForNode(claimed, current, graph);
      if (!edge) break;
      const next = graph.nodes.get(edge.targetNodeId);
      if (!next) {
        await this.blockExecution(executionId, 'AUTOMATION_RUNTIME_UNSUPPORTED_GRAPH');
        return;
      }
      if (next.type === AutomationWorkflowNodeType.ACTION) {
        const step = await this.ensureStep(claimed, next);
        const completed = isCompletedStep(step.status);
        if (!completed) {
          if (step.status === AutomationStepExecutionStatus.RUNNING) {
            const recovered = await this.recoverAmbiguousRunningStep(claimed, step);
            if (!recovered) {
              await this.failExecution(
                executionId,
                step.id,
                'AUTOMATION_STEP_AMBIGUOUS_STATE',
                'Step outcome is ambiguous after worker interruption; operator review is required.',
                'NON_RETRYABLE',
              );
              return;
            }
          } else {
            const claimedStep = await this.claimStep(step.id);
            if (!claimedStep) return;
            try {
              const context = await this.variableContext(claimed);
              const resolvedConfig = new AutomationVariableResolver().resolveConfig(
                next.config,
                context,
              );
              validateAutomationActionConfig(resolvedConfig, 'resolvedAction.config');
              const result = await this.actions.executeAction(
                tenant,
                {
                  workspaceId: claimed.workspaceId,
                  actionNodeId: next.nodeId,
                  mutation: {
                    workflowId: claimed.workflowId,
                    workflowVersionId: claimed.workflowVersionId,
                    triggerDomainEventId: claimed.domainEventId,
                    triggerMatchId: claimed.triggerMatchId,
                    correlationId: claimed.correlationId,
                    causationId: claimed.domainEventId,
                    parentAutomationDepth: claimed.automationDepth,
                    invocationKey: step.invocationKey,
                  },
                },
                resolvedConfig,
              );
              await this.prisma.automationStepExecution.update({
                where: { id: step.id },
                data: {
                  status:
                    result.status === 'NO_OP'
                      ? AutomationStepExecutionStatus.NO_OP
                      : AutomationStepExecutionStatus.SUCCEEDED,
                  result: toPrismaJson(result),
                  errorCode: null,
                  errorMessage: null,
                  finishedAt: new Date(),
                },
              });
            } catch (error) {
              const classified = classifyError(error);
              await this.failExecution(
                executionId,
                step.id,
                classified.code,
                classified.message,
                classified.kind,
              );
              if (classified.kind === 'RETRYABLE') throw error;
              return;
            }
          }
        }
      }
      current = next;
    }
    await this.prisma.automationExecution.updateMany({
      where: { id: executionId, status: AutomationExecutionStatus.RUNNING },
      data: {
        status: AutomationExecutionStatus.SUCCEEDED,
        failureCode: null,
        failureMessage: null,
        finishedAt: new Date(),
      },
    });
  }

  private async nextEdgeForNode(
    execution: ExecutionRecord,
    node: RuntimeNode,
    graph: RuntimeGraph,
  ) {
    const outgoing = graph.outgoing.get(node.nodeId) ?? [];
    if (
      node.type === AutomationWorkflowNodeType.TRIGGER ||
      node.type === AutomationWorkflowNodeType.ACTION
    ) {
      return outgoing[0] ?? null;
    }
    if (node.type === AutomationWorkflowNodeType.CONDITION) {
      const step = await this.ensureStep(execution, node);
      let branchKey = step.selectedBranchKey;
      if (!isCompletedStep(step.status)) {
        if (step.status === AutomationStepExecutionStatus.RUNNING) {
          await this.failExecution(
            execution.id,
            step.id,
            'AUTOMATION_STEP_AMBIGUOUS_STATE',
            'Step decision is ambiguous after worker interruption; operator review is required.',
            'NON_RETRYABLE',
          );
          return null;
        }
        const claimedStep = await this.claimStep(step.id);
        if (!claimedStep) return null;
        try {
          const result = this.evaluateConditionNode(
            node.config,
            await this.variableContext(execution),
          );
          branchKey = result ? 'TRUE' : 'FALSE';
          await this.prisma.automationStepExecution.update({
            where: { id: step.id },
            data: {
              status: AutomationStepExecutionStatus.SUCCEEDED,
              conditionResult: result,
              selectedBranchKey: branchKey,
              result: toPrismaJson({
                nodeType: node.type,
                conditionResult: result,
                selectedBranchKey: branchKey,
              }),
              errorCode: null,
              errorMessage: null,
              finishedAt: new Date(),
            },
          });
        } catch (error) {
          const classified = classifyError(error);
          await this.failExecution(
            execution.id,
            step.id,
            classified.code,
            classified.message,
            classified.kind,
          );
          return null;
        }
      }
      return outgoing.find((edge) => edge.branchKey === branchKey) ?? null;
    }
    if (node.type === AutomationWorkflowNodeType.BRANCH) {
      const step = await this.ensureStep(execution, node);
      let branchKey = step.selectedBranchKey;
      if (!isCompletedStep(step.status)) {
        if (step.status === AutomationStepExecutionStatus.RUNNING) {
          await this.failExecution(
            execution.id,
            step.id,
            'AUTOMATION_STEP_AMBIGUOUS_STATE',
            'Step decision is ambiguous after worker interruption; operator review is required.',
            'NON_RETRYABLE',
          );
          return null;
        }
        const claimedStep = await this.claimStep(step.id);
        if (!claimedStep) return null;
        try {
          branchKey = this.evaluateBranchNode(node.config, await this.variableContext(execution));
          await this.prisma.automationStepExecution.update({
            where: { id: step.id },
            data: {
              status: AutomationStepExecutionStatus.SUCCEEDED,
              selectedBranchKey: branchKey,
              result: toPrismaJson({ nodeType: node.type, selectedBranchKey: branchKey }),
              errorCode: null,
              errorMessage: null,
              finishedAt: new Date(),
            },
          });
        } catch (error) {
          const classified = classifyError(error);
          await this.failExecution(
            execution.id,
            step.id,
            classified.code,
            classified.message,
            classified.kind,
          );
          return null;
        }
      }
      return outgoing.find((edge) => edge.branchKey === branchKey) ?? null;
    }
    return null;
  }

  private async ensureStep(execution: ExecutionRecord, node: RuntimeNode) {
    const existing = await this.prisma.automationStepExecution.findUnique({
      where: { executionId_nodeId: { executionId: execution.id, nodeId: node.nodeId } },
      select: stepSelect,
    });
    if (existing) return existing;
    const last = await this.prisma.automationStepExecution.aggregate({
      where: { executionId: execution.id },
      _max: { sequence: true },
    });
    return this.prisma.automationStepExecution.create({
      data: {
        workspaceId: execution.workspaceId,
        executionId: execution.id,
        workflowVersionId: execution.workflowVersionId,
        nodeId: node.nodeId,
        nodeType: node.type,
        sequence: (last._max.sequence ?? 0) + 1,
        actionType:
          node.type === AutomationWorkflowNodeType.ACTION
            ? actionTypeFromConfig(node.config)
            : null,
        status: AutomationStepExecutionStatus.PENDING,
        invocationKey: invocationKey(execution.id, node.nodeId),
      },
      select: stepSelect,
    });
  }

  private async variableContext(execution: ExecutionRecord): Promise<AutomationVariableContext> {
    const steps = await this.prisma.automationStepExecution.findMany({
      where: {
        executionId: execution.id,
        status: {
          in: [AutomationStepExecutionStatus.SUCCEEDED, AutomationStepExecutionStatus.NO_OP],
        },
      },
      select: { nodeId: true, result: true },
      orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
    });
    const stepContext = Object.fromEntries(
      steps.map((step) => [step.nodeId, { result: safeStepResult(step.result) }]),
    );
    return {
      event: {
        id: execution.domainEvent.id,
        eventType: execution.domainEvent.eventType,
        entityType: execution.domainEvent.entityType,
        entityId: execution.domainEvent.entityId,
        occurredAt: execution.domainEvent.occurredAt.toISOString(),
        actorMembershipId: execution.domainEvent.actorMembershipId,
      },
      trigger: triggerPayload(execution.domainEvent.payload),
      execution: {
        id: execution.id,
        workspaceId: execution.workspaceId,
        correlationId: execution.correlationId,
        automationDepth: execution.automationDepth,
      },
      steps: stepContext,
    };
  }

  private evaluateConditionNode(
    config: Record<string, unknown>,
    context: AutomationVariableContext,
  ) {
    return evaluateCondition(config, context);
  }

  private evaluateBranchNode(config: Record<string, unknown>, context: AutomationVariableContext) {
    const cases = Array.isArray(config.cases) ? config.cases : [];
    for (const branchCase of cases) {
      if (!branchCase || typeof branchCase !== 'object' || Array.isArray(branchCase)) continue;
      const record = branchCase as Record<string, unknown>;
      if (evaluateCondition(record, context)) return String(record.key);
    }
    return String(config.defaultKey);
  }

  private async claimStep(stepId: string) {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id
        FROM automation_step_executions
        WHERE id = ${stepId}::uuid
          AND status IN ('PENDING', 'RETRYING', 'FAILED')
        FOR UPDATE SKIP LOCKED
      `);
      if (rows.length === 0) return null;
      return tx.automationStepExecution.update({
        where: { id: stepId },
        data: {
          status: AutomationStepExecutionStatus.RUNNING,
          attemptCount: { increment: 1 },
          startedAt: new Date(),
        },
        select: { id: true },
      });
    });
  }

  private async recoverAmbiguousRunningStep(
    execution: ExecutionRecord,
    step: Prisma.AutomationStepExecutionGetPayload<{ select: typeof stepSelect }>,
  ) {
    if (step.actionType !== AutomationActionType.CREATE_TASK) return false;
    const task = await this.prisma.task.findFirst({
      where: {
        workspaceId: execution.workspaceId,
        automationInvocationKey: step.invocationKey,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!task) return false;
    await this.prisma.automationStepExecution.update({
      where: { id: step.id },
      data: {
        status: AutomationStepExecutionStatus.SUCCEEDED,
        result: toPrismaJson({
          actionType: AutomationActionType.CREATE_TASK,
          status: 'SUCCEEDED',
          entityType: 'TASK',
          entityId: task.id,
          changed: true,
          recoveredFromInvocationKey: true,
          generatedDomainEventIds: [],
        }),
        errorCode: null,
        errorMessage: null,
        finishedAt: new Date(),
      },
    });
    return true;
  }

  private async failExecution(
    executionId: string,
    stepId: string,
    code: string,
    message: string,
    kind: ErrorKind,
  ) {
    const execution = await this.prisma.automationExecution.findUnique({
      where: { id: executionId },
      select: { attemptCount: true, maxAttempts: true },
    });
    const exhausted =
      kind === 'RETRYABLE' && execution ? execution.attemptCount >= execution.maxAttempts : false;
    await this.prisma.$transaction([
      this.prisma.automationStepExecution.update({
        where: { id: stepId },
        data: {
          status:
            kind === 'RETRYABLE' && !exhausted
              ? AutomationStepExecutionStatus.RETRYING
              : AutomationStepExecutionStatus.FAILED,
          errorCode: code,
          errorMessage: safeMessage(message),
          finishedAt: exhausted || kind === 'NON_RETRYABLE' ? new Date() : null,
        },
      }),
      this.prisma.automationExecution.update({
        where: { id: executionId },
        data: {
          status:
            kind === 'RETRYABLE' && !exhausted
              ? AutomationExecutionStatus.RETRYING
              : exhausted
                ? AutomationExecutionStatus.DEAD_LETTERED
                : AutomationExecutionStatus.FAILED,
          failureCode: code,
          failureMessage: safeMessage(message),
          finishedAt: kind === 'NON_RETRYABLE' || exhausted ? new Date() : null,
        },
      }),
    ]);
  }

  private async blockExecution(executionId: string, code: string) {
    await this.prisma.automationExecution.update({
      where: { id: executionId },
      data: {
        status: AutomationExecutionStatus.BLOCKED,
        failureCode: code,
        failureMessage: safeMessage(code),
        finishedAt: new Date(),
      },
    });
  }
}

const executionSelect = {
  id: true,
  workspaceId: true,
  triggerMatchId: true,
  domainEventId: true,
  workflowId: true,
  workflowVersionId: true,
  correlationId: true,
  automationDepth: true,
  workflowVersion: { select: { nodesDefinition: true, edgesDefinition: true } },
  domainEvent: {
    select: {
      id: true,
      eventType: true,
      entityType: true,
      entityId: true,
      occurredAt: true,
      actorMembershipId: true,
      payload: true,
    },
  },
} satisfies Prisma.AutomationExecutionSelect;

const executionListSelect = {
  id: true,
  workspaceId: true,
  triggerMatchId: true,
  domainEventId: true,
  workflowId: true,
  workflowVersionId: true,
  status: true,
  correlationId: true,
  automationDepth: true,
  attemptCount: true,
  maxAttempts: true,
  failureCode: true,
  failureMessage: true,
  createdAt: true,
  queuedAt: true,
  startedAt: true,
  finishedAt: true,
} satisfies Prisma.AutomationExecutionSelect;

const executionDetailSelect = {
  ...executionListSelect,
  steps: {
    select: {
      id: true,
      nodeId: true,
      nodeType: true,
      sequence: true,
      actionType: true,
      selectedBranchKey: true,
      conditionResult: true,
      status: true,
      attemptCount: true,
      invocationKey: true,
      result: true,
      errorCode: true,
      errorMessage: true,
      startedAt: true,
      finishedAt: true,
      createdAt: true,
    },
    orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.AutomationExecutionSelect;

const stepSelect = {
  id: true,
  nodeId: true,
  nodeType: true,
  sequence: true,
  status: true,
  actionType: true,
  selectedBranchKey: true,
  conditionResult: true,
  invocationKey: true,
} satisfies Prisma.AutomationStepExecutionSelect;

type ExecutionRecord = Prisma.AutomationExecutionGetPayload<{ select: typeof executionSelect }>;

interface RuntimeGraph {
  nodes: Map<string, RuntimeNode>;
  outgoing: Map<string, RuntimeEdge[]>;
  trigger: RuntimeNode;
}

function planDeterministicRuntime(
  nodesValue: Prisma.JsonValue,
  edgesValue: Prisma.JsonValue,
): RuntimePlan {
  const graph = runtimeGraph(nodesValue, edgesValue);
  if (!graph) return blocked('AUTOMATION_RUNTIME_UNSUPPORTED_GRAPH');
  return [...graph.nodes.values()].some((node) => node.type !== AutomationWorkflowNodeType.TRIGGER)
    ? { status: AutomationExecutionStatus.PENDING_QUEUE }
    : { status: AutomationExecutionStatus.SUCCEEDED };
}

function blocked(reason: string): Extract<RuntimePlan, { status: 'BLOCKED' }> {
  return { status: AutomationExecutionStatus.BLOCKED, reason };
}

function parseNodes(value: Prisma.JsonValue): RuntimeNode[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const node = item as Record<string, unknown>;
    if (typeof node.nodeId !== 'string') return [];
    if (
      !Object.values(AutomationWorkflowNodeType).includes(node.type as AutomationWorkflowNodeType)
    ) {
      return [];
    }
    return [
      {
        nodeId: node.nodeId,
        type: node.type as AutomationWorkflowNodeType,
        config:
          node.config && typeof node.config === 'object' && !Array.isArray(node.config)
            ? (node.config as Record<string, unknown>)
            : {},
      },
    ];
  });
}

function parseEdges(value: Prisma.JsonValue): RuntimeEdge[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const edge = item as Record<string, unknown>;
    const sourceNodeId = stringValue(edge.sourceNodeId ?? edge.fromNodeId ?? edge.source);
    const targetNodeId = stringValue(edge.targetNodeId ?? edge.toNodeId ?? edge.target);
    const branchKey = stringValue(edge.branchKey) ?? null;
    return sourceNodeId && targetNodeId ? [{ sourceNodeId, targetNodeId, branchKey }] : [];
  });
}

function runtimeGraph(
  nodesValue: Prisma.JsonValue,
  edgesValue: Prisma.JsonValue,
): RuntimeGraph | null {
  const nodes = parseNodes(nodesValue);
  const edges = parseEdges(edgesValue);
  const triggers = nodes.filter((node) => node.type === AutomationWorkflowNodeType.TRIGGER);
  if (triggers.length !== 1) return null;
  const trigger = triggers[0];
  if (!trigger) return null;
  try {
    validateAutomationDefinition({
      trigger: trigger.config,
      nodes,
      edges: edges.map((edge) => ({
        fromNodeId: edge.sourceNodeId,
        toNodeId: edge.targetNodeId,
        branchKey: edge.branchKey,
      })),
      settings: {},
    });
  } catch {
    return null;
  }
  if (nodes.some((node) => node.type === AutomationWorkflowNodeType.DELAY)) return null;
  if (hasCycle(nodes, edges)) return null;
  const nodeMap = new Map(nodes.map((node) => [node.nodeId, node]));
  const outgoing = new Map<string, RuntimeEdge[]>();
  for (const edge of edges) {
    if (!nodeMap.has(edge.sourceNodeId) || !nodeMap.has(edge.targetNodeId)) return null;
    outgoing.set(edge.sourceNodeId, [...(outgoing.get(edge.sourceNodeId) ?? []), edge]);
  }
  const reachable = reachableFrom(trigger, outgoing);
  if (nodes.some((node) => !reachable.has(node.nodeId))) return null;
  for (const node of nodes) {
    const nodeEdges = outgoing.get(node.nodeId) ?? [];
    if (
      node.type === AutomationWorkflowNodeType.TRIGGER ||
      node.type === AutomationWorkflowNodeType.ACTION
    ) {
      if (nodeEdges.length > 1 || nodeEdges.some((edge) => edge.branchKey)) return null;
    } else if (node.type === AutomationWorkflowNodeType.CONDITION) {
      const keys = nodeEdges.map((edge) => edge.branchKey);
      if (
        nodeEdges.length !== 2 ||
        keys.filter((key) => key === 'TRUE').length !== 1 ||
        keys.filter((key) => key === 'FALSE').length !== 1
      )
        return null;
    } else if (node.type === AutomationWorkflowNodeType.BRANCH) {
      const cases = Array.isArray(node.config.cases) ? node.config.cases : [];
      const required = new Set(
        cases
          .map((item) => String((item as { key?: unknown }).key))
          .concat(String(node.config.defaultKey)),
      );
      const actual = nodeEdges.map((edge) => edge.branchKey).filter(Boolean) as string[];
      if (actual.length !== nodeEdges.length || actual.length !== required.size) return null;
      for (const key of actual) required.delete(key);
      if (required.size > 0) return null;
    }
  }
  return { nodes: nodeMap, outgoing, trigger };
}

function hasCycle(nodes: RuntimeNode[], edges: RuntimeEdge[]) {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    outgoing.set(edge.sourceNodeId, [
      ...(outgoing.get(edge.sourceNodeId) ?? []),
      edge.targetNodeId,
    ]);
  }
  const visit = (nodeId: string): boolean => {
    if (visiting.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    visiting.add(nodeId);
    for (const next of outgoing.get(nodeId) ?? []) {
      if (visit(next)) return true;
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return false;
  };
  return nodes.some((node) => visit(node.nodeId));
}

function reachableFrom(trigger: RuntimeNode, outgoing: Map<string, RuntimeEdge[]>) {
  const reachable = new Set<string>();
  const stack = [trigger.nodeId];
  while (stack.length > 0) {
    const nodeId = stack.pop();
    if (!nodeId || reachable.has(nodeId)) continue;
    reachable.add(nodeId);
    for (const edge of outgoing.get(nodeId) ?? []) stack.push(edge.targetNodeId);
  }
  return reachable;
}

function evaluateCondition(config: Record<string, unknown>, context: AutomationVariableContext) {
  const operator = config.operator as AutomationConditionOperator;
  const resolver = new AutomationVariableResolver();
  const leftRaw = config.left ?? config.field;
  if (
    operator === AutomationConditionOperator.EXISTS ||
    operator === AutomationConditionOperator.NOT_EXISTS
  ) {
    const exists = isFullVariableReference(leftRaw)
      ? resolver.pathExists(stripReference(leftRaw), context)
      : leftRaw !== undefined && leftRaw !== null;
    return operator === AutomationConditionOperator.EXISTS ? exists : !exists;
  }
  const left = resolveOperand(leftRaw, context);
  const right = resolveOperand(config.right ?? config.value, context);
  if (operator === AutomationConditionOperator.EQUALS) return deepEqual(left, right);
  if (operator === AutomationConditionOperator.NOT_EQUALS) return !deepEqual(left, right);
  if (
    operator === AutomationConditionOperator.IN ||
    operator === AutomationConditionOperator.NOT_IN
  ) {
    if (!Array.isArray(right)) {
      throw new BadRequestException({
        code: 'AUTOMATION_CONDITION_INVALID',
        message: 'IN requires an array.',
      });
    }
    const included = right.some((item) => deepEqual(left, item));
    return operator === AutomationConditionOperator.IN ? included : !included;
  }
  throw new BadRequestException({
    code: 'AUTOMATION_CONDITION_INVALID',
    message: 'Condition operator is invalid.',
  });
}

function resolveOperand(value: unknown, context: AutomationVariableContext) {
  return new AutomationVariableResolver().resolveConfig(value, context);
}

function stripReference(value: string) {
  return value
    .replace(/^\{\{\s*/, '')
    .replace(/\s*\}\}$/, '')
    .trim();
}

function deepEqual(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isCompletedStep(status: AutomationStepExecutionStatus) {
  return (
    status === AutomationStepExecutionStatus.SUCCEEDED ||
    status === AutomationStepExecutionStatus.NO_OP ||
    status === AutomationStepExecutionStatus.SKIPPED
  );
}

function triggerPayload(value: Prisma.JsonValue) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const payload = value as Record<string, unknown>;
  if (typeof payload.taskId === 'string')
    return { ...payload, task: entityPayload(payload, 'taskId') };
  if (typeof payload.projectId === 'string')
    return { ...payload, project: entityPayload(payload, 'projectId') };
  if (typeof payload.ticketId === 'string')
    return { ...payload, ticket: entityPayload(payload, 'ticketId') };
  return payload;
}

function entityPayload(payload: Record<string, unknown>, idKey: string) {
  return { ...payload, id: payload[idKey] };
}

function safeStepResult(value: Prisma.JsonValue) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const result = value as Record<string, unknown>;
  return {
    actionType: result.actionType,
    status: result.status,
    entityType: result.entityType,
    entityId: result.entityId,
    changed: result.changed,
    generatedDomainEventIds: Array.isArray(result.generatedDomainEventIds)
      ? result.generatedDomainEventIds
      : [],
    conditionResult: result.conditionResult,
    selectedBranchKey: result.selectedBranchKey,
  };
}

function actionTypeFromConfig(config: Record<string, unknown>) {
  if (!Object.values(AutomationActionType).includes(config.actionType as AutomationActionType)) {
    throw new BadRequestException('AUTOMATION_ACTION_CONFIG_INVALID');
  }
  return config.actionType as AutomationActionType;
}

function invocationKey(executionId: string, nodeId: string) {
  return `automation-step:${executionId}:${nodeId}`;
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function tenantFromExecution(execution: ExecutionRecord): WorkspaceTenantContext {
  return {
    agencyId: '',
    workspaceId: execution.workspaceId,
    userId: '',
    workspaceMembershipId: execution.domainEvent.actorMembershipId,
    agencyMembershipId: null,
    roleId: '',
    roleName: 'AUTOMATION',
    permissions: [],
    accessSource: 'WORKSPACE_MEMBERSHIP',
  };
}

function classifyError(error: unknown): { kind: ErrorKind; code: string; message: string } {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    ['P1001', 'P1002', 'P1008', 'P1017', 'P2034'].includes(error.code)
  ) {
    return { kind: 'RETRYABLE', code: error.code, message: 'Transient database error.' };
  }
  const response =
    error && typeof error === 'object' && 'getResponse' in error
      ? (error as { getResponse: () => unknown }).getResponse()
      : null;
  if (response && typeof response === 'object' && 'code' in response) {
    return {
      kind: 'NON_RETRYABLE',
      code: String((response as { code: unknown }).code),
      message: safeMessage(
        (response as { message?: unknown }).message ?? 'Automation action failed.',
      ),
    };
  }
  return {
    kind: 'NON_RETRYABLE',
    code: error instanceof Error ? error.name : 'AUTOMATION_ACTION_FAILED',
    message: 'Automation action failed.',
  };
}

function safeMessage(value: unknown) {
  const text = typeof value === 'string' ? value : 'Automation action failed.';
  const normalized = text.replace(/[\r\n\t]+/g, ' ').slice(0, 500);
  if (
    /(postgres(?:ql)?:\/\/|password|secret|token|authorization|cookie|jwt|bearer|stack|select\s|insert\s|update\s|delete\s)/i.test(
      normalized,
    )
  ) {
    return 'Automation action failed.';
  }
  return normalized;
}
