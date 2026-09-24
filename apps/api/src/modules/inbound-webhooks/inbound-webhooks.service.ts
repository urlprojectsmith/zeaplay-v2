import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  InboundWebhookEventStatus,
  InboundWebhookSourceStatus,
  InboundWebhookSourceType,
  Prisma,
} from '@prisma/client';
import { validateEnvironment } from '@zea-play/config';
import type { WorkspaceTenantContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CloudDriveTokenEncryptionService } from '../cloud-drives/cloud-drive-token-encryption.service';
import { InboundWebhookAdapterRegistry } from './inbound-webhook-adapters';
import { InboundWebhookCryptoService } from './inbound-webhook-crypto.service';
import { InboundWebhookRateLimitService } from './inbound-webhook-rate-limit.service';
import {
  INBOUND_WEBHOOK_CLEANUP_BATCH_SIZE,
  INBOUND_WEBHOOK_HEADERS,
  INBOUND_WEBHOOK_SOURCE_LIMIT,
} from './inbound-webhooks.constants';
import type {
  CreateInboundWebhookSourceDto,
  InboundWebhookListQueryDto,
  UpdateInboundWebhookSourceDto,
} from './dto/inbound-webhook.dto';

type HeaderBag = Record<string, string | string[] | undefined>;

const sourceSelect = {
  id: true,
  workspaceId: true,
  name: true,
  description: true,
  publicIdentifier: true,
  type: true,
  status: true,
  lastReceivedAt: true,
  lastVerifiedAt: true,
  lastFailureAt: true,
  createdAt: true,
  updatedAt: true,
  createdByMembership: {
    select: { id: true, user: { select: { id: true, email: true, name: true } } },
  },
} satisfies Prisma.InboundWebhookSourceSelect;

const eventListSelect = {
  id: true,
  workspaceId: true,
  sourceId: true,
  externalEventId: true,
  eventType: true,
  eventVersion: true,
  status: true,
  normalizedType: true,
  receivedAt: true,
  verifiedAt: true,
  normalizedAt: true,
  safeErrorCode: true,
  correlationId: true,
  createdAt: true,
} satisfies Prisma.InboundWebhookEventSelect;

const eventDetailSelect = {
  ...eventListSelect,
  normalizedPayload: true,
} satisfies Prisma.InboundWebhookEventSelect;

@Injectable()
export class InboundWebhooksService {
  private readonly env = validateEnvironment(process.env);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly encryption: CloudDriveTokenEncryptionService,
    private readonly crypto: InboundWebhookCryptoService,
    private readonly rateLimit: InboundWebhookRateLimitService,
    private readonly adapters: InboundWebhookAdapterRegistry,
  ) {}

  async listSources(tenant: WorkspaceTenantContext, query: InboundWebhookListQueryDto) {
    const where = {
      workspaceId: tenant.workspaceId,
    } satisfies Prisma.InboundWebhookSourceWhereInput;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.inboundWebhookSource.findMany({
        where,
        select: sourceSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.inboundWebhookSource.count({ where }),
    ]);
    return {
      items: items.map((source) => this.serializeSource(source)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async createSource(tenant: WorkspaceTenantContext, dto: CreateInboundWebhookSourceDto) {
    const membershipId = this.requireActiveWorkspaceMembership(tenant);
    const plaintextSecret = this.crypto.generateSecret();
    const encryptedSigningSecret = this.encryption.encrypt(plaintextSecret);
    const publicIdentifier = this.crypto.generatePublicIdentifier();
    const source = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`inbound-webhook-cap:${tenant.workspaceId}`}))::text AS lock
      `;
      const activeCount = await tx.inboundWebhookSource.count({
        where: { workspaceId: tenant.workspaceId, status: InboundWebhookSourceStatus.ACTIVE },
      });
      if (activeCount >= INBOUND_WEBHOOK_SOURCE_LIMIT) {
        throw new ConflictException('INBOUND_SOURCE_LIMIT_REACHED');
      }
      return tx.inboundWebhookSource.create({
        data: {
          workspaceId: tenant.workspaceId,
          name: dto.name,
          description: dto.description || null,
          publicIdentifier,
          type: dto.type,
          encryptedSigningSecret,
          createdByMembershipId: membershipId,
        },
        select: sourceSelect,
      });
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'inbound_webhook_source.created',
      entityType: 'InboundWebhookSource',
      entityId: source.id,
      metadata: { sourceId: source.id, type: source.type, createdByMembershipId: membershipId },
    });
    return {
      ...this.serializeSource(source),
      endpointUrl: this.endpointUrl(source.publicIdentifier),
      plaintextSecret,
    };
  }

  async getSource(tenant: WorkspaceTenantContext, sourceId: string) {
    return this.serializeSource(await this.findSourceOrThrow(tenant.workspaceId, sourceId));
  }

  async updateSource(
    tenant: WorkspaceTenantContext,
    sourceId: string,
    dto: UpdateInboundWebhookSourceDto,
  ) {
    await this.findSourceOrThrow(tenant.workspaceId, sourceId);
    const source = await this.prisma.inboundWebhookSource.update({
      where: { id: sourceId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description || null } : {}),
      },
      select: sourceSelect,
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'inbound_webhook_source.updated',
      entityType: 'InboundWebhookSource',
      entityId: source.id,
      metadata: { sourceId: source.id },
    });
    return this.serializeSource(source);
  }

  async rotateSecret(tenant: WorkspaceTenantContext, sourceId: string) {
    await this.findSourceOrThrow(tenant.workspaceId, sourceId);
    const plaintextSecret = this.crypto.generateSecret();
    const source = await this.prisma.inboundWebhookSource.update({
      where: { id: sourceId },
      data: { encryptedSigningSecret: this.encryption.encrypt(plaintextSecret) },
      select: sourceSelect,
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'inbound_webhook_source.secret_rotated',
      entityType: 'InboundWebhookSource',
      entityId: source.id,
      metadata: { sourceId: source.id },
    });
    return { ...this.serializeSource(source), plaintextSecret };
  }

  async disableSource(tenant: WorkspaceTenantContext, sourceId: string) {
    const existing = await this.findSourceOrThrow(tenant.workspaceId, sourceId);
    if (existing.status === InboundWebhookSourceStatus.DISABLED) {
      return this.serializeSource(existing);
    }
    const source = await this.prisma.inboundWebhookSource.update({
      where: { id: sourceId },
      data: { status: InboundWebhookSourceStatus.DISABLED },
      select: sourceSelect,
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'inbound_webhook_source.disabled',
      entityType: 'InboundWebhookSource',
      entityId: source.id,
      metadata: { sourceId: source.id },
    });
    return this.serializeSource(source);
  }

  async listEvents(
    tenant: WorkspaceTenantContext,
    sourceId: string,
    query: InboundWebhookListQueryDto,
  ) {
    await this.findSourceOrThrow(tenant.workspaceId, sourceId);
    const where = {
      workspaceId: tenant.workspaceId,
      sourceId,
    } satisfies Prisma.InboundWebhookEventWhereInput;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.inboundWebhookEvent.findMany({
        where,
        select: eventListSelect,
        orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.inboundWebhookEvent.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async getEvent(tenant: WorkspaceTenantContext, eventId: string) {
    const event = await this.prisma.inboundWebhookEvent.findFirst({
      where: { id: eventId, workspaceId: tenant.workspaceId },
      select: eventDetailSelect,
    });
    if (!event) throw new NotFoundException('INBOUND_EVENT_NOT_FOUND');
    return event;
  }

  async receive(publicId: string, headers: HeaderBag, rawBody: Buffer) {
    this.assertRawBody(rawBody);
    this.assertContentHeaders(headers);
    const now = new Date();
    const source = await this.prisma.inboundWebhookSource.findUnique({
      where: { publicIdentifier: publicId },
      select: {
        id: true,
        workspaceId: true,
        type: true,
        status: true,
        encryptedSigningSecret: true,
      },
    });
    if (!source) throw new NotFoundException('INBOUND_SOURCE_NOT_FOUND');
    if (source.status !== InboundWebhookSourceStatus.ACTIVE) {
      throw new NotFoundException('INBOUND_SOURCE_NOT_FOUND');
    }
    await this.rateLimit.assertWithinLimit(source.id, source.workspaceId);

    const timestamp = this.requireSingleHeader(headers, INBOUND_WEBHOOK_HEADERS.timestamp, 20);
    this.assertTimestampFresh(timestamp, now);
    const signature = this.requireSingleHeader(headers, INBOUND_WEBHOOK_HEADERS.signature, 80);
    const secret = this.decryptSecret(source.encryptedSigningSecret);
    if (!this.crypto.verify(signature, timestamp, rawBody, secret)) {
      await this.markSourceFailure(source.id, now);
      throw new UnauthorizedException('INBOUND_SIGNATURE_INVALID');
    }
    const externalEventId = this.requireExternalEventId(headers);
    const rawBodyHash = this.crypto.hashRawBody(rawBody);
    const existing = await this.prisma.inboundWebhookEvent.findUnique({
      where: { sourceId_externalEventId: { sourceId: source.id, externalEventId } },
      select: { id: true, rawBodyHash: true, status: true, safeErrorCode: true },
    });
    if (existing) return this.handleExistingEvent(existing, rawBodyHash);

    try {
      return await this.createAndNormalizeEvent({
        source,
        externalEventId,
        rawBody,
        rawBodyHash,
        receivedAt: now,
      });
    } catch (error) {
      if (error instanceof ExistingInboundEventResult) return error.result;
      throw error;
    }
  }

  async cleanupRetainedEvents(limit = INBOUND_WEBHOOK_CLEANUP_BATCH_SIZE, now = new Date()) {
    const cutoff = new Date(
      now.getTime() - this.env.INBOUND_WEBHOOK_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    const events = await this.prisma.inboundWebhookEvent.findMany({
      where: { receivedAt: { lt: cutoff } },
      select: { id: true },
      orderBy: { receivedAt: 'asc' },
      take: Math.min(Math.max(limit, 1), INBOUND_WEBHOOK_CLEANUP_BATCH_SIZE),
    });
    if (events.length === 0) return { eventsDeleted: 0, normalizedEventsDeleted: 0 };
    const ids = events.map((event) => event.id);
    const normalized = await this.prisma.normalizedInboundEvent.deleteMany({
      where: { inboundEventId: { in: ids } },
    });
    const deleted = await this.prisma.inboundWebhookEvent.deleteMany({
      where: { id: { in: ids } },
    });
    return { eventsDeleted: deleted.count, normalizedEventsDeleted: normalized.count };
  }

  private async createAndNormalizeEvent(args: {
    source: {
      id: string;
      workspaceId: string;
      type: InboundWebhookSourceType;
    };
    externalEventId: string;
    rawBody: Buffer;
    rawBodyHash: string;
    receivedAt: Date;
  }) {
    const event = await this.createVerifiedEvent(args);
    try {
      const parsed = JSON.parse(args.rawBody.toString('utf8')) as unknown;
      const normalized = this.adapters.get(args.source.type).normalize(parsed);
      const updated = await this.prisma.$transaction(async (tx) => {
        await tx.normalizedInboundEvent.create({
          data: {
            workspaceId: args.source.workspaceId,
            sourceId: args.source.id,
            inboundEventId: event.id,
            sourceType: args.source.type,
            externalEventId: args.externalEventId,
            type: normalized.type,
            version: normalized.version,
            occurredAt: normalized.occurredAt,
            receivedAt: args.receivedAt,
            data: normalized.data,
            correlationId: normalized.correlationId,
          },
        });
        return tx.inboundWebhookEvent.update({
          where: { id: event.id },
          data: {
            status: InboundWebhookEventStatus.NORMALIZED,
            eventType: normalized.type,
            eventVersion: normalized.version,
            normalizedType: normalized.type,
            normalizedPayload: {
              type: normalized.type,
              version: normalized.version,
              occurredAt: normalized.occurredAt?.toISOString() ?? null,
              receivedAt: args.receivedAt.toISOString(),
              data: normalized.data,
              correlationId: normalized.correlationId,
            } satisfies Prisma.InputJsonObject,
            normalizedAt: new Date(),
            correlationId: normalized.correlationId,
          },
          select: { id: true, status: true },
        });
      });
      await this.prisma.inboundWebhookSource.update({
        where: { id: args.source.id },
        data: { lastReceivedAt: args.receivedAt, lastVerifiedAt: args.receivedAt },
      });
      return { eventId: updated.id, status: updated.status, replayed: false };
    } catch (error) {
      const safeErrorCode = resolveNormalizationErrorCode(error);
      await this.prisma.inboundWebhookEvent.update({
        where: { id: event.id },
        data: { status: InboundWebhookEventStatus.FAILED_NORMALIZATION, safeErrorCode },
      });
      await this.markSourceFailure(args.source.id, new Date());
      throw new UnprocessableEntityException(safeErrorCode);
    }
  }

  private async createVerifiedEvent(args: {
    source: { id: string; workspaceId: string };
    externalEventId: string;
    rawBodyHash: string;
    receivedAt: Date;
  }) {
    try {
      return await this.prisma.inboundWebhookEvent.create({
        data: {
          workspaceId: args.source.workspaceId,
          sourceId: args.source.id,
          externalEventId: args.externalEventId,
          rawBodyHash: args.rawBodyHash,
          status: InboundWebhookEventStatus.VERIFIED,
          receivedAt: args.receivedAt,
          verifiedAt: args.receivedAt,
        },
        select: { id: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.inboundWebhookEvent.findUniqueOrThrow({
          where: {
            sourceId_externalEventId: {
              sourceId: args.source.id,
              externalEventId: args.externalEventId,
            },
          },
          select: { id: true, rawBodyHash: true, status: true, safeErrorCode: true },
        });
        throw new ExistingInboundEventResult(this.handleExistingEvent(existing, args.rawBodyHash));
      }
      throw error;
    }
  }

  private handleExistingEvent(
    event: {
      id: string;
      rawBodyHash: string;
      status: InboundWebhookEventStatus;
      safeErrorCode?: string | null;
    },
    rawBodyHash: string,
  ): { eventId: string; status: InboundWebhookEventStatus; replayed: true } {
    if (event.rawBodyHash !== rawBodyHash) {
      throw new ConflictException('INBOUND_EVENT_ID_REUSED');
    }
    if (event.status === InboundWebhookEventStatus.FAILED_NORMALIZATION) {
      throw new UnprocessableEntityException(event.safeErrorCode ?? 'INBOUND_NORMALIZATION_FAILED');
    }
    return { eventId: event.id, status: event.status, replayed: true };
  }

  private assertRawBody(rawBody: Buffer) {
    if (!Buffer.isBuffer(rawBody)) throw new BadRequestException('INBOUND_RAW_BODY_REQUIRED');
    if (rawBody.length === 0) throw new BadRequestException('INBOUND_BODY_REQUIRED');
    if (rawBody.length > this.env.INBOUND_WEBHOOK_MAX_BODY_BYTES) {
      throw new HttpException('INBOUND_BODY_TOO_LARGE', HttpStatus.PAYLOAD_TOO_LARGE);
    }
  }

  private assertContentHeaders(headers: HeaderBag) {
    const contentType = this.optionalSingleHeader(headers, 'content-type', 120);
    if (!contentType || !/^application\/json(?:\s*;|$)/i.test(contentType)) {
      throw new BadRequestException('INBOUND_CONTENT_TYPE_UNSUPPORTED');
    }
    const encoding = this.optionalSingleHeader(headers, 'content-encoding', 40);
    if (encoding && encoding.toLowerCase() !== 'identity') {
      throw new BadRequestException('INBOUND_CONTENT_ENCODING_UNSUPPORTED');
    }
  }

  private requireExternalEventId(headers: HeaderBag) {
    const eventId = this.requireSingleHeader(headers, INBOUND_WEBHOOK_HEADERS.eventId, 200).trim();
    if (!eventId) throw new BadRequestException('INBOUND_EVENT_ID_REQUIRED');
    return eventId;
  }

  private assertTimestampFresh(timestamp: string, now: Date) {
    if (!/^\d{1,12}$/.test(timestamp)) throw new UnauthorizedException('INBOUND_TIMESTAMP_INVALID');
    const seconds = Number(timestamp);
    if (!Number.isSafeInteger(seconds))
      throw new UnauthorizedException('INBOUND_TIMESTAMP_INVALID');
    const driftSeconds = Math.abs(Math.floor(now.getTime() / 1000) - seconds);
    if (driftSeconds > this.env.INBOUND_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS) {
      throw new UnauthorizedException('INBOUND_TIMESTAMP_OUT_OF_TOLERANCE');
    }
  }

  private requireSingleHeader(headers: HeaderBag, name: string, maxLength: number) {
    const value = this.optionalSingleHeader(headers, name, maxLength);
    if (!value) throw new UnauthorizedException(`${name.toUpperCase()}_REQUIRED`);
    return value;
  }

  private optionalSingleHeader(headers: HeaderBag, name: string, maxLength: number) {
    const value = headers[name] ?? headers[name.toLowerCase()];
    const normalized = Array.isArray(value) ? value[0] : value;
    if (normalized === undefined) return null;
    if (typeof normalized !== 'string' || normalized.length > maxLength) {
      throw new BadRequestException('INBOUND_HEADER_INVALID');
    }
    return normalized;
  }

  private decryptSecret(encryptedSigningSecret: string) {
    try {
      return this.encryption.decrypt(encryptedSigningSecret);
    } catch {
      throw new UnauthorizedException('INBOUND_SIGNATURE_INVALID');
    }
  }

  private async markSourceFailure(sourceId: string, at: Date) {
    await this.prisma.inboundWebhookSource.update({
      where: { id: sourceId },
      data: { lastReceivedAt: at, lastFailureAt: at },
    });
  }

  private async findSourceOrThrow(workspaceId: string, sourceId: string) {
    const source = await this.prisma.inboundWebhookSource.findFirst({
      where: { id: sourceId, workspaceId },
      select: sourceSelect,
    });
    if (!source) throw new NotFoundException('INBOUND_SOURCE_NOT_FOUND');
    return source;
  }

  private requireActiveWorkspaceMembership(tenant: WorkspaceTenantContext) {
    if (!tenant.workspaceMembershipId || tenant.accessSource !== 'WORKSPACE_MEMBERSHIP') {
      throw new BadRequestException('ACTIVE_WORKSPACE_MEMBERSHIP_REQUIRED');
    }
    return tenant.workspaceMembershipId;
  }

  private serializeSource(
    source: Prisma.InboundWebhookSourceGetPayload<{ select: typeof sourceSelect }>,
  ) {
    return {
      id: source.id,
      workspaceId: source.workspaceId,
      name: source.name,
      description: source.description,
      publicIdentifier: source.publicIdentifier,
      endpointUrl: this.endpointUrl(source.publicIdentifier),
      type: source.type,
      status: source.status,
      lastReceivedAt: source.lastReceivedAt,
      lastVerifiedAt: source.lastVerifiedAt,
      lastFailureAt: source.lastFailureAt,
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
      createdBy: {
        membershipId: source.createdByMembership.id,
        userId: source.createdByMembership.user.id,
        email: source.createdByMembership.user.email,
        name: source.createdByMembership.user.name,
      },
    };
  }

  private endpointUrl(publicIdentifier: string) {
    return `${this.env.API_PUBLIC_URL.replace(/\/$/, '')}/inbound/${publicIdentifier}`;
  }
}

class ExistingInboundEventResult extends Error {
  constructor(
    readonly result: { eventId: string; status: InboundWebhookEventStatus; replayed: true },
  ) {
    super('EXISTING_INBOUND_EVENT');
  }
}

function resolveNormalizationErrorCode(error: unknown) {
  if (error instanceof ExistingInboundEventResult) return 'INBOUND_DUPLICATE';
  if (error instanceof SyntaxError) return 'INBOUND_JSON_INVALID';
  if (error instanceof BadRequestException) {
    const response = error.getResponse();
    if (typeof response === 'string') return response;
  }
  return 'INBOUND_NORMALIZATION_FAILED';
}
