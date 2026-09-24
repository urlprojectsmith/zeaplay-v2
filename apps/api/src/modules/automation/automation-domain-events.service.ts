import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  AutomationDomainEventEntityType,
  AutomationTriggerMatchStatus,
  AutomationTriggerType,
  AutomationWorkflowNodeType,
  Prisma,
} from '@prisma/client';
import type { WorkspaceTenantContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { toPrismaJson } from './automation-graph.validator';
import {
  AUTOMATION_DOMAIN_EVENT_MAX_PAYLOAD_BYTES,
  AUTOMATION_DOMAIN_EVENT_SCHEMA_VERSION,
} from './automation.constants';
import { AutomationExecutionService } from './automation-execution.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import {
  AutomationDomainEventQueryDto,
  AutomationTriggerMatchQueryDto,
} from './dto/automation.dto';

type Tx = Prisma.TransactionClient;

export interface RecordAutomationDomainEventInput {
  workspaceId: string;
  eventType: AutomationTriggerType;
  entityType: AutomationDomainEventEntityType;
  entityId: string;
  actorMembershipId?: string | null;
  occurredAt?: Date;
  correlationId?: string;
  causationId?: string | null;
  automationDepth?: number;
  payload: Record<string, unknown>;
  idempotencyKey: string;
}

interface TriggerNode {
  nodeId: string;
  type: AutomationWorkflowNodeType;
  config: Record<string, unknown>;
}

@Injectable()
export class AutomationDomainEventsService {
  private readonly logger = new Logger(AutomationDomainEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly executions?: AutomationExecutionService,
    @Optional() private readonly webhooks?: WebhooksService,
  ) {}

  async recordDomainEvent(input: RecordAutomationDomainEventInput) {
    const event = await this.recordDomainEventInTransaction(this.prisma, input);
    await this.evaluateDomainEvent(event.id);
    await this.executions?.dispatchPendingExecutions();
    return event;
  }

  async recordDomainEventInTransaction(
    client: Tx | PrismaService,
    input: RecordAutomationDomainEventInput,
  ) {
    const payloadSize = Buffer.byteLength(JSON.stringify(input.payload), 'utf8');
    if (payloadSize > AUTOMATION_DOMAIN_EVENT_MAX_PAYLOAD_BYTES) {
      throw new BadRequestException('Automation domain event payload is too large.');
    }
    const occurredAt = input.occurredAt ?? new Date();
    try {
      return await client.automationDomainEvent.create({
        data: {
          workspaceId: input.workspaceId,
          eventType: input.eventType,
          entityType: input.entityType,
          entityId: input.entityId,
          actorMembershipId: input.actorMembershipId ?? null,
          occurredAt,
          schemaVersion: AUTOMATION_DOMAIN_EVENT_SCHEMA_VERSION,
          correlationId: input.correlationId ?? `${input.idempotencyKey}`,
          causationId: input.causationId ?? null,
          automationDepth: input.automationDepth ?? 0,
          payload: toPrismaJson(input.payload),
          idempotencyKey: input.idempotencyKey,
        },
        select: domainEventSelect,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return client.automationDomainEvent.findUniqueOrThrow({
          where: {
            workspaceId_idempotencyKey: {
              workspaceId: input.workspaceId,
              idempotencyKey: input.idempotencyKey,
            },
          },
          select: domainEventSelect,
        });
      }
      throw error;
    }
  }

  async evaluateDomainEvent(domainEventId: string) {
    const event = await this.prisma.automationDomainEvent.findUnique({
      where: { id: domainEventId },
      select: domainEventSelect,
    });
    if (!event) throw new NotFoundException('Automation domain event not found.');

    const workflows = await this.prisma.automationWorkflow.findMany({
      where: {
        workspaceId: event.workspaceId,
        status: 'PUBLISHED',
        archivedAt: null,
        activePublishedVersionId: { not: null },
        activePublishedVersion: { is: { state: 'PUBLISHED', workspaceId: event.workspaceId } },
      },
      select: {
        id: true,
        activePublishedVersion: {
          select: {
            id: true,
            workspaceId: true,
            triggerDefinition: true,
            nodesDefinition: true,
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 500,
    });

    const matches = workflows.flatMap((workflow) => {
      const version = workflow.activePublishedVersion;
      if (!version || version.workspaceId !== event.workspaceId) return [];
      const trigger = triggerNodeFromVersion(version.nodesDefinition);
      if (!trigger) return [];
      if (!triggerMatchesEvent(trigger.config, event)) return [];
      return [
        {
          workspaceId: event.workspaceId,
          domainEventId: event.id,
          workflowId: workflow.id,
          workflowVersionId: version.id,
          triggerNodeId: trigger.nodeId,
          status: AutomationTriggerMatchStatus.MATCHED,
        },
      ];
    });

    if (matches.length > 0) await this.createRuntimeMatches(matches);
    try {
      await this.webhooks?.captureAutomationDomainEvent(event.id);
    } catch (error) {
      this.logger.warn({
        message: 'Outbound webhook capture failed after committed domain event',
        domainEventId: event.id,
        workspaceId: event.workspaceId,
        error: error instanceof Error ? error.name : 'UnknownError',
      });
    }
    await this.executions?.dispatchPendingExecutions();
    return { domainEventId: event.id, matched: matches.length };
  }

  private async createRuntimeMatches(
    matches: Array<{
      workspaceId: string;
      domainEventId: string;
      workflowId: string;
      workflowVersionId: string;
      triggerNodeId: string;
      status: AutomationTriggerMatchStatus;
    }>,
  ) {
    const now = new Date();
    const run = async (tx: Tx) => {
      for (const match of matches) {
        const created = await createTriggerMatchIfAbsent(tx, { ...match, runtimeEligibleAt: now });
        if (created && this.executions) {
          await this.executions.createForTriggerMatch(created.id, tx);
        }
      }
    };
    if (typeof this.prisma.$transaction === 'function') {
      await this.prisma.$transaction(run);
    } else {
      await run(this.prisma as unknown as Tx);
    }
  }

  async listEvents(tenant: WorkspaceTenantContext, query: AutomationDomainEventQueryDto) {
    const where: Prisma.AutomationDomainEventWhereInput = {
      workspaceId: tenant.workspaceId,
      eventType: query.eventType,
      entityType: query.entityType,
      entityId: query.entityId,
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.automationDomainEvent.count({ where }),
      this.prisma.automationDomainEvent.findMany({
        where,
        select: {
          ...domainEventSelect,
          _count: { select: { triggerMatches: true } },
        },
        orderBy: [{ occurredAt: query.sortDirection }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: items.map((event) => ({
        ...event,
        matchedWorkflowCount: event._count.triggerMatches,
        _count: undefined,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async getEvent(tenant: WorkspaceTenantContext, eventId: string) {
    const event = await this.prisma.automationDomainEvent.findFirst({
      where: { id: eventId, workspaceId: tenant.workspaceId },
      select: {
        ...domainEventSelect,
        triggerMatches: {
          select: triggerMatchSelect,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          take: 50,
        },
      },
    });
    if (!event) throw new NotFoundException('Automation domain event not found.');
    return event;
  }

  async listTriggerMatches(tenant: WorkspaceTenantContext, query: AutomationTriggerMatchQueryDto) {
    const where: Prisma.AutomationTriggerMatchWhereInput = {
      workspaceId: tenant.workspaceId,
      domainEventId: query.domainEventId,
      workflowId: query.workflowId,
      workflowVersionId: query.workflowVersionId,
      status: query.status,
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.automationTriggerMatch.count({ where }),
      this.prisma.automationTriggerMatch.findMany({
        where,
        select: triggerMatchSelect,
        orderBy: [{ createdAt: query.sortDirection }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }
}

const domainEventSelect = {
  id: true,
  workspaceId: true,
  eventType: true,
  entityType: true,
  entityId: true,
  actorMembershipId: true,
  occurredAt: true,
  schemaVersion: true,
  correlationId: true,
  causationId: true,
  automationDepth: true,
  payload: true,
  idempotencyKey: true,
  createdAt: true,
} satisfies Prisma.AutomationDomainEventSelect;

const triggerMatchSelect = {
  id: true,
  workspaceId: true,
  domainEventId: true,
  workflowId: true,
  workflowVersionId: true,
  triggerNodeId: true,
  status: true,
  reasonCode: true,
  runtimeEligibleAt: true,
  createdAt: true,
} satisfies Prisma.AutomationTriggerMatchSelect;

type DomainEventRecord = Prisma.AutomationDomainEventGetPayload<{
  select: typeof domainEventSelect;
}>;

function triggerNodeFromVersion(value: Prisma.JsonValue): TriggerNode | null {
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const node = item as Record<string, unknown>;
    if (node.type !== AutomationWorkflowNodeType.TRIGGER) continue;
    if (typeof node.nodeId !== 'string') continue;
    if (!node.config || typeof node.config !== 'object' || Array.isArray(node.config)) continue;
    return {
      nodeId: node.nodeId,
      type: AutomationWorkflowNodeType.TRIGGER,
      config: node.config as Record<string, unknown>,
    };
  }
  return null;
}

function triggerMatchesEvent(config: Record<string, unknown>, event: DomainEventRecord) {
  if (config.triggerType !== event.eventType) return false;
  if (typeof config.fromStatusId === 'string') {
    const previous = payloadString(event.payload, 'previousStatusDefinitionId');
    if (previous !== config.fromStatusId) return false;
  }
  if (typeof config.toStatusId === 'string') {
    const next = payloadString(event.payload, 'newStatusDefinitionId');
    if (next !== config.toStatusId) return false;
  }
  return true;
}

function payloadString(payload: Prisma.JsonValue, key: string) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const value = payload[key];
  return typeof value === 'string' ? value : null;
}

async function createTriggerMatchIfAbsent(
  tx: Tx,
  data: {
    workspaceId: string;
    domainEventId: string;
    workflowId: string;
    workflowVersionId: string;
    triggerNodeId: string;
    status: AutomationTriggerMatchStatus;
    runtimeEligibleAt: Date;
  },
) {
  if (typeof tx.automationTriggerMatch.create !== 'function') {
    await tx.automationTriggerMatch.createMany({
      data: [data],
      skipDuplicates: true,
    });
    return null;
  }
  try {
    return await tx.automationTriggerMatch.create({
      data,
      select: { id: true },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return null;
    }
    throw error;
  }
}
