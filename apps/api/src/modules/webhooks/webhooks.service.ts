import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import {
  AutomationTriggerType,
  Prisma,
  WebhookDeliveryStatus,
  WebhookSubscriptionStatus,
} from '@prisma/client';
import { Queue } from 'bullmq';
import { validateEnvironment } from '@zea-play/config';
import type { WorkspaceTenantContext } from '../../common/auth/auth.types';
import {
  WEBHOOK_DELIVERY_DISPATCH_JOB_TYPE,
  WEBHOOK_DELIVERY_QUEUE,
} from '../../infrastructure/queue/queue.constants';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CloudDriveTokenEncryptionService } from '../cloud-drives/cloud-drive-token-encryption.service';
import {
  WEBHOOK_ACTIVE_SUBSCRIPTION_LIMIT,
  WEBHOOK_EVENT_TYPE_SET,
  WEBHOOK_EVENT_VERSION,
} from './webhooks.constants';
import { WebhookSigningService } from './webhook-signing.service';
import { WebhookUrlValidatorService } from './webhook-url-validator.service';
import type {
  CreateWebhookSubscriptionDto,
  UpdateWebhookSubscriptionDto,
  WebhookDeliveryListQueryDto,
  WebhookListQueryDto,
} from './dto/webhook.dto';

type Tx = Prisma.TransactionClient;

const WEBHOOK_MAX_PAYLOAD_BYTES = 256 * 1024;
const WEBHOOK_CLEANUP_BATCH_SIZE = 500;

const deliverySelect = {
  id: true,
  workspaceId: true,
  eventId: true,
  subscriptionId: true,
  status: true,
  attemptCount: true,
  nextAttemptAt: true,
  lastAttemptAt: true,
  deliveredAt: true,
  httpStatus: true,
  safeErrorCode: true,
  responseDurationMs: true,
  responseSnippet: true,
  createdAt: true,
  updatedAt: true,
  event: { select: { id: true, eventType: true, eventVersion: true, createdAt: true } },
} satisfies Prisma.WebhookDeliverySelect;

const subscriptionSelect = {
  id: true,
  workspaceId: true,
  name: true,
  description: true,
  endpointUrl: true,
  status: true,
  eventTypes: true,
  lastSuccessAt: true,
  lastFailureAt: true,
  createdAt: true,
  updatedAt: true,
  createdByMembership: {
    select: { id: true, user: { select: { id: true, email: true, name: true } } },
  },
} satisfies Prisma.WebhookSubscriptionSelect;

@Injectable()
export class WebhooksService {
  private readonly env = validateEnvironment(process.env);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly encryption: CloudDriveTokenEncryptionService,
    private readonly signing: WebhookSigningService,
    private readonly urls: WebhookUrlValidatorService,
    @InjectQueue(WEBHOOK_DELIVERY_QUEUE) private readonly deliveryQueue: Queue,
  ) {}

  async list(tenant: WorkspaceTenantContext, query: WebhookListQueryDto) {
    const where = {
      workspaceId: tenant.workspaceId,
    } satisfies Prisma.WebhookSubscriptionWhereInput;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.webhookSubscription.findMany({
        where,
        select: subscriptionSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.webhookSubscription.count({ where }),
    ]);
    return {
      items: items.map(serializeSubscription),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async create(tenant: WorkspaceTenantContext, dto: CreateWebhookSubscriptionDto) {
    const membershipId = this.requireActiveWorkspaceMembership(tenant);
    const endpointUrl = await this.urls.assertSafeUrl(dto.endpointUrl, {
      allowLocalHttp: this.env.WEBHOOK_ALLOW_LOCAL_HTTP,
    });
    const eventTypes = validateEventTypes(dto.eventTypes);
    const plaintextSecret = this.signing.generateSecret();
    const encryptedSecret = this.encryption.encrypt(plaintextSecret);

    const subscription = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`webhook-cap:${tenant.workspaceId}`}))::text AS lock
      `;
      const activeCount = await tx.webhookSubscription.count({
        where: { workspaceId: tenant.workspaceId, status: WebhookSubscriptionStatus.ACTIVE },
      });
      if (activeCount >= WEBHOOK_ACTIVE_SUBSCRIPTION_LIMIT) {
        throw new ConflictException('WEBHOOK_SUBSCRIPTION_LIMIT_REACHED');
      }
      return tx.webhookSubscription.create({
        data: {
          workspaceId: tenant.workspaceId,
          name: dto.name,
          description: dto.description || null,
          endpointUrl,
          encryptedSecret,
          eventTypes,
          createdByMembershipId: membershipId,
        },
        select: subscriptionSelect,
      });
    });

    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'webhook_subscription.created',
      entityType: 'WebhookSubscription',
      entityId: subscription.id,
      metadata: { webhookId: subscription.id, eventTypes, createdByMembershipId: membershipId },
    });

    return { ...serializeSubscription(subscription), plaintextSecret };
  }

  async update(
    tenant: WorkspaceTenantContext,
    webhookId: string,
    dto: UpdateWebhookSubscriptionDto,
  ) {
    const existing = await this.findSubscriptionOrThrow(tenant.workspaceId, webhookId);
    const endpointUrl =
      dto.endpointUrl === undefined
        ? undefined
        : await this.urls.assertSafeUrl(dto.endpointUrl, {
            allowLocalHttp: this.env.WEBHOOK_ALLOW_LOCAL_HTTP,
          });
    const eventTypes = dto.eventTypes ? validateEventTypes(dto.eventTypes) : undefined;
    const updated = await this.prisma.webhookSubscription.update({
      where: { id: existing.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description || null } : {}),
        ...(endpointUrl !== undefined ? { endpointUrl } : {}),
        ...(eventTypes ? { eventTypes } : {}),
      },
      select: subscriptionSelect,
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'webhook_subscription.updated',
      entityType: 'WebhookSubscription',
      entityId: updated.id,
      metadata: { webhookId: updated.id, eventTypes: updated.eventTypes },
    });
    return serializeSubscription(updated);
  }

  async disable(tenant: WorkspaceTenantContext, webhookId: string) {
    const existing = await this.findSubscriptionOrThrow(tenant.workspaceId, webhookId);
    if (existing.status === WebhookSubscriptionStatus.DISABLED)
      return serializeSubscription(existing);
    const updated = await this.prisma.webhookSubscription.update({
      where: { id: existing.id },
      data: { status: WebhookSubscriptionStatus.DISABLED },
      select: subscriptionSelect,
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'webhook_subscription.disabled',
      entityType: 'WebhookSubscription',
      entityId: updated.id,
      metadata: { webhookId: updated.id },
    });
    return serializeSubscription(updated);
  }

  async rotateSecret(tenant: WorkspaceTenantContext, webhookId: string) {
    const existing = await this.findSubscriptionOrThrow(tenant.workspaceId, webhookId);
    const plaintextSecret = this.signing.generateSecret();
    const updated = await this.prisma.webhookSubscription.update({
      where: { id: existing.id },
      data: { encryptedSecret: this.encryption.encrypt(plaintextSecret) },
      select: subscriptionSelect,
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'webhook_subscription.secret_rotated',
      entityType: 'WebhookSubscription',
      entityId: updated.id,
      metadata: { webhookId: updated.id },
    });
    return { ...serializeSubscription(updated), plaintextSecret };
  }

  async sendTest(tenant: WorkspaceTenantContext, webhookId: string) {
    const subscription = await this.findSubscriptionOrThrow(tenant.workspaceId, webhookId);
    if (subscription.status !== WebhookSubscriptionStatus.ACTIVE)
      throw new BadRequestException('WEBHOOK_DISABLED');
    const createdAt = new Date().toISOString();
    const payloadJson = {
      id: '',
      type: 'webhook.test',
      version: WEBHOOK_EVENT_VERSION,
      createdAt,
      workspaceId: tenant.workspaceId,
      data: { webhookId: subscription.id, test: true },
    } satisfies Prisma.InputJsonObject;
    assertPayloadSize(payloadJson);
    const event = await this.prisma.webhookEvent.create({
      data: {
        workspaceId: tenant.workspaceId,
        eventType: 'webhook.test',
        eventVersion: WEBHOOK_EVENT_VERSION,
        aggregateType: 'webhook_subscription',
        aggregateId: subscription.id,
        payloadJson,
        isTest: true,
      },
      select: { id: true },
    });
    await this.prisma.webhookEvent.update({
      where: { id: event.id },
      data: {
        payloadJson: {
          id: event.id,
          type: 'webhook.test',
          version: WEBHOOK_EVENT_VERSION,
          createdAt,
          workspaceId: tenant.workspaceId,
          data: { webhookId: subscription.id, test: true },
        },
      },
    });
    const delivery = await this.createDeliveryForSubscription(
      this.prisma,
      tenant.workspaceId,
      event.id,
      subscription.id,
    );
    await this.enqueueDelivery(delivery.id);
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'webhook_subscription.test_requested',
      entityType: 'WebhookSubscription',
      entityId: subscription.id,
      metadata: { webhookId: subscription.id, deliveryId: delivery.id },
    });
    return { deliveryId: delivery.id };
  }

  async listDeliveries(
    tenant: WorkspaceTenantContext,
    webhookId: string,
    query: WebhookDeliveryListQueryDto,
  ) {
    await this.findSubscriptionOrThrow(tenant.workspaceId, webhookId);
    const where = {
      workspaceId: tenant.workspaceId,
      subscriptionId: webhookId,
    } satisfies Prisma.WebhookDeliveryWhereInput;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.webhookDelivery.findMany({
        where,
        select: deliverySelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.webhookDelivery.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async getDelivery(tenant: WorkspaceTenantContext, deliveryId: string) {
    const delivery = await this.prisma.webhookDelivery.findFirst({
      where: { id: deliveryId, workspaceId: tenant.workspaceId },
      select: deliverySelect,
    });
    if (!delivery) throw new NotFoundException('WEBHOOK_DELIVERY_NOT_FOUND');
    return delivery;
  }

  async retryDelivery(tenant: WorkspaceTenantContext, deliveryId: string) {
    const delivery = await this.prisma.webhookDelivery.findFirst({
      where: { id: deliveryId, workspaceId: tenant.workspaceId },
      select: { id: true, status: true, subscriptionId: true },
    });
    if (!delivery) throw new NotFoundException('WEBHOOK_DELIVERY_NOT_FOUND');
    if (
      delivery.status !== WebhookDeliveryStatus.FAILED &&
      delivery.status !== WebhookDeliveryStatus.DEAD_LETTERED
    ) {
      throw new BadRequestException('WEBHOOK_DELIVERY_NOT_RETRYABLE');
    }
    const claimed = await this.prisma.webhookDelivery.updateMany({
      where: {
        id: delivery.id,
        workspaceId: tenant.workspaceId,
        status: { in: [WebhookDeliveryStatus.FAILED, WebhookDeliveryStatus.DEAD_LETTERED] },
      },
      data: {
        status: WebhookDeliveryStatus.PENDING,
        nextAttemptAt: new Date(),
        safeErrorCode: null,
        httpStatus: null,
        responseSnippet: null,
      },
    });
    if (claimed.count !== 1) throw new BadRequestException('WEBHOOK_DELIVERY_NOT_RETRYABLE');
    const updated = await this.prisma.webhookDelivery.findUniqueOrThrow({
      where: { id: delivery.id },
      select: deliverySelect,
    });
    await this.enqueueDelivery(updated.id);
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'webhook_delivery.manual_retry_requested',
      entityType: 'WebhookDelivery',
      entityId: updated.id,
      metadata: { deliveryId: updated.id, webhookId: delivery.subscriptionId },
    });
    return updated;
  }

  async captureAutomationDomainEvent(domainEventId: string) {
    const domainEvent = await this.prisma.automationDomainEvent.findUnique({
      where: { id: domainEventId },
      select: {
        id: true,
        workspaceId: true,
        eventType: true,
        entityType: true,
        entityId: true,
        occurredAt: true,
        correlationId: true,
        causationId: true,
        payload: true,
      },
    });
    if (!domainEvent) return { captured: false, reason: 'DOMAIN_EVENT_NOT_FOUND' };
    const eventType = mapAutomationEventType(domainEvent.eventType);
    if (!eventType) return { captured: false, reason: 'EVENT_TYPE_NOT_SUPPORTED' };
    const subscriptions = await this.prisma.webhookSubscription.findMany({
      where: {
        workspaceId: domainEvent.workspaceId,
        status: WebhookSubscriptionStatus.ACTIVE,
        eventTypes: { has: eventType },
      },
      select: { id: true },
      take: WEBHOOK_ACTIVE_SUBSCRIPTION_LIMIT,
    });
    if (subscriptions.length === 0) return { captured: false, reason: 'NO_SUBSCRIPTIONS' };
    const existing = await this.prisma.webhookEvent.findUnique({
      where: {
        workspaceId_sourceAutomationDomainEventId: {
          workspaceId: domainEvent.workspaceId,
          sourceAutomationDomainEventId: domainEvent.id,
        },
      },
      select: { id: true },
    });
    if (existing)
      return { captured: false, reason: 'DUPLICATE_DOMAIN_EVENT', eventId: existing.id };

    const createdAt = domainEvent.occurredAt.toISOString();
    const payloadJson = {
      id: '',
      type: eventType,
      version: WEBHOOK_EVENT_VERSION,
      createdAt,
      workspaceId: domainEvent.workspaceId,
      data: minimizePayload(domainEvent.payload),
    } satisfies Prisma.InputJsonObject;
    assertPayloadSize(payloadJson);

    const eventAndDeliveries = await this.prisma.$transaction(async (tx) => {
      try {
        const event = await tx.webhookEvent.create({
          data: {
            workspaceId: domainEvent.workspaceId,
            sourceAutomationDomainEventId: domainEvent.id,
            eventType,
            eventVersion: WEBHOOK_EVENT_VERSION,
            aggregateType: domainEvent.entityType.toLowerCase(),
            aggregateId: domainEvent.entityId,
            correlationId: domainEvent.correlationId,
            causationId: domainEvent.causationId,
            payloadJson,
          },
          select: { id: true },
        });
        const finalPayload = { ...payloadJson, id: event.id };
        assertPayloadSize(finalPayload);
        await tx.webhookEvent.update({
          where: { id: event.id },
          data: { payloadJson: finalPayload },
        });
        const deliveries = [];
        for (const subscription of subscriptions) {
          deliveries.push(
            await this.createDeliveryForSubscription(
              tx,
              domainEvent.workspaceId,
              event.id,
              subscription.id,
            ),
          );
        }
        return { event, deliveries };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const event = await tx.webhookEvent.findUniqueOrThrow({
            where: {
              workspaceId_sourceAutomationDomainEventId: {
                workspaceId: domainEvent.workspaceId,
                sourceAutomationDomainEventId: domainEvent.id,
              },
            },
            select: { id: true },
          });
          return { event, deliveries: [] };
        }
        throw error;
      }
    });
    const deliveries = eventAndDeliveries.deliveries;
    await Promise.all(deliveries.map((delivery) => this.enqueueDelivery(delivery.id)));
    return {
      captured: true,
      eventId: eventAndDeliveries.event.id,
      deliveryCount: deliveries.length,
    };
  }

  async cleanupRetainedDeliveries(limit = WEBHOOK_CLEANUP_BATCH_SIZE, now = new Date()) {
    const retentionDays = this.env.WEBHOOK_DELIVERY_RETENTION_DAYS;
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.webhookDelivery.findMany({
      where: {
        createdAt: { lt: cutoff },
        status: {
          in: [
            WebhookDeliveryStatus.SUCCEEDED,
            WebhookDeliveryStatus.FAILED,
            WebhookDeliveryStatus.DEAD_LETTERED,
          ],
        },
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: Math.min(Math.max(limit, 1), WEBHOOK_CLEANUP_BATCH_SIZE),
    });
    if (rows.length === 0) return { deliveriesDeleted: 0, eventsDeleted: 0 };
    const deliveryResult = await this.prisma.webhookDelivery.deleteMany({
      where: { id: { in: rows.map((row) => row.id) } },
    });
    const orphanEvents = await this.prisma.webhookEvent.findMany({
      where: { createdAt: { lt: cutoff }, deliveries: { none: {} } },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: Math.min(Math.max(limit, 1), WEBHOOK_CLEANUP_BATCH_SIZE),
    });
    const eventResult =
      orphanEvents.length === 0
        ? { count: 0 }
        : await this.prisma.webhookEvent.deleteMany({
            where: { id: { in: orphanEvents.map((event) => event.id) } },
          });
    return { deliveriesDeleted: deliveryResult.count, eventsDeleted: eventResult.count };
  }

  async enqueueDelivery(deliveryId: string, delayMs = 0) {
    await this.deliveryQueue.add(
      WEBHOOK_DELIVERY_DISPATCH_JOB_TYPE,
      { deliveryId },
      {
        jobId: `${WEBHOOK_DELIVERY_DISPATCH_JOB_TYPE}:${deliveryId}:${delayMs}:${Date.now()}`,
        delay: delayMs,
      },
    );
  }

  private async findSubscriptionOrThrow(workspaceId: string, webhookId: string) {
    const subscription = await this.prisma.webhookSubscription.findFirst({
      where: { id: webhookId, workspaceId },
      select: subscriptionSelect,
    });
    if (!subscription) throw new NotFoundException('WEBHOOK_SUBSCRIPTION_NOT_FOUND');
    return subscription;
  }

  private async createDeliveryForSubscription(
    tx: Tx | PrismaService,
    workspaceId: string,
    eventId: string,
    subscriptionId: string,
  ) {
    return tx.webhookDelivery.create({
      data: {
        workspaceId,
        eventId,
        subscriptionId,
        status: WebhookDeliveryStatus.PENDING,
        nextAttemptAt: new Date(),
      },
      select: { id: true },
    });
  }

  private requireActiveWorkspaceMembership(tenant: WorkspaceTenantContext) {
    if (!tenant.workspaceMembershipId || tenant.accessSource !== 'WORKSPACE_MEMBERSHIP') {
      throw new BadRequestException('ACTIVE_WORKSPACE_MEMBERSHIP_REQUIRED');
    }
    return tenant.workspaceMembershipId;
  }
}

function serializeSubscription(
  subscription: Prisma.WebhookSubscriptionGetPayload<{ select: typeof subscriptionSelect }>,
) {
  return {
    id: subscription.id,
    workspaceId: subscription.workspaceId,
    name: subscription.name,
    description: subscription.description,
    endpointUrl: subscription.endpointUrl,
    status: subscription.status,
    eventTypes: subscription.eventTypes,
    lastSuccessAt: subscription.lastSuccessAt,
    lastFailureAt: subscription.lastFailureAt,
    createdAt: subscription.createdAt,
    updatedAt: subscription.updatedAt,
    createdBy: {
      membershipId: subscription.createdByMembership.id,
      userId: subscription.createdByMembership.user.id,
      email: subscription.createdByMembership.user.email,
      name: subscription.createdByMembership.user.name,
    },
  };
}

function validateEventTypes(eventTypes: string[]) {
  const normalized = [...new Set(eventTypes)].sort();
  if (
    normalized.length === 0 ||
    normalized.some((eventType) => !WEBHOOK_EVENT_TYPE_SET.has(eventType))
  ) {
    throw new BadRequestException('WEBHOOK_EVENT_TYPE_UNSUPPORTED');
  }
  return normalized;
}

function mapAutomationEventType(eventType: AutomationTriggerType) {
  switch (eventType) {
    case AutomationTriggerType.TASK_CREATED:
      return 'task.created';
    case AutomationTriggerType.TASK_STATUS_CHANGED:
      return 'task.status_changed';
    case AutomationTriggerType.TASK_COMPLETED:
      return 'task.completed';
    case AutomationTriggerType.PROJECT_CREATED:
      return 'project.created';
    case AutomationTriggerType.PROJECT_STATUS_CHANGED:
      return 'project.status_changed';
    case AutomationTriggerType.TICKET_CREATED:
      return 'ticket.created';
    case AutomationTriggerType.TICKET_STATUS_CHANGED:
      return 'ticket.status_changed';
    case AutomationTriggerType.TICKET_RESOLVED:
      return 'ticket.resolved';
    default:
      return null;
  }
}

function minimizePayload(payload: Prisma.JsonValue): Prisma.InputJsonObject {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  const source = payload as Record<string, unknown>;
  const allowed = [
    'id',
    'title',
    'name',
    'statusDefinitionId',
    'previousStatusDefinitionId',
    'newStatusDefinitionId',
    'ownerMembershipId',
    'assignedToMembershipId',
    'priority',
    'dueAt',
  ];
  return Object.fromEntries(
    allowed
      .filter((key) => source[key] !== undefined)
      .map((key) => [key, source[key] as Prisma.InputJsonValue]),
  );
}

function assertPayloadSize(payload: Prisma.InputJsonValue) {
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > WEBHOOK_MAX_PAYLOAD_BYTES) {
    throw new BadRequestException('WEBHOOK_PAYLOAD_TOO_LARGE');
  }
}
