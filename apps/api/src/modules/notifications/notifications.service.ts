import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  NotificationCategory,
  NotificationEntityType,
  NotificationPriority,
  NotificationType,
  Prisma,
} from '@prisma/client';
import type { WorkspaceTenantContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { NotificationListQueryDto, UpdateNotificationPreferencesDto } from './dto/notification.dto';

const TITLE_MAX = 160;
const MESSAGE_MAX = 600;
const METADATA_MAX_BYTES = 4000;
const SENSITIVE_KEY_PATTERN =
  /(password|passwd|jwt|otp|api[-_]?key|authorization|auth[-_]?header|secret|token|raw[-_]?body)/i;
const missingRealtimeService = {
  publishMember: () => Promise.resolve(undefined),
} as unknown as RealtimeService;

export interface CreateNotificationInput {
  workspaceId: string;
  recipientMembershipId: string;
  category: NotificationCategory;
  type: NotificationType;
  title: string;
  message: string;
  entityType?: NotificationEntityType | null;
  entityId?: string | null;
  actorMembershipId?: string | null;
  priority?: NotificationPriority;
  metadata?: Prisma.InputJsonValue | null;
  dedupeKey?: string | null;
  expiresAt?: Date | null;
  critical?: boolean;
  tx?: Prisma.TransactionClient;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly realtime: RealtimeService = missingRealtimeService,
  ) {}

  async createNotification(input: CreateNotificationInput) {
    const db = input.tx ?? this.prisma;
    const recipient = await db.workspaceMembership.findFirst({
      where: {
        id: input.recipientMembershipId,
        workspaceId: input.workspaceId,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    if (!recipient) throw new BadRequestException('INVALID_NOTIFICATION_RECIPIENT');
    if (input.actorMembershipId) {
      const actor = await db.workspaceMembership.findFirst({
        where: { id: input.actorMembershipId, workspaceId: input.workspaceId },
        select: { id: true },
      });
      if (!actor) throw new BadRequestException('INVALID_NOTIFICATION_ACTOR');
    }
    const preference = await this.resolvePreference(
      input.workspaceId,
      input.recipientMembershipId,
      input.category,
      db,
    );
    const now = new Date();
    const bypass = Boolean(
      input.critical &&
      input.category === NotificationCategory.SYSTEM &&
      isCriticalSystemNotification(input.type),
    );
    if (
      !bypass &&
      (!preference.inAppEnabled || (preference.mutedUntil && preference.mutedUntil > now))
    ) {
      return null;
    }
    const data = {
      workspaceId: input.workspaceId,
      recipientMembershipId: input.recipientMembershipId,
      category: input.category,
      type: input.type,
      title: normalizeText(input.title, TITLE_MAX, 'Notification title'),
      message: normalizeText(input.message, MESSAGE_MAX, 'Notification message'),
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      actorMembershipId: input.actorMembershipId ?? null,
      priority: input.priority ?? NotificationPriority.NORMAL,
      metadata: sanitizeMetadata(input.metadata ?? null),
      dedupeKey: normalizeDedupeKey(input.dedupeKey),
      expiresAt: input.expiresAt ?? null,
    };
    try {
      const created = await db.notification.create({ data, select: notificationSelect });
      if (!input.tx) await this.publishNotificationCreated(created);
      return created;
    } catch (error) {
      if (isUniqueConstraintError(error) && data.dedupeKey) {
        const existing = await db.notification.findFirst({
          where: {
            workspaceId: data.workspaceId,
            recipientMembershipId: data.recipientMembershipId,
            dedupeKey: data.dedupeKey,
          },
          select: notificationSelect,
        });
        if (existing && !input.tx) await this.publishUnreadCountChanged(existing);
        return existing;
      }
      throw error;
    }
  }

  async createManyNotifications(inputs: CreateNotificationInput[]) {
    const results = [];
    for (const input of inputs) {
      results.push(await this.createNotification(input));
    }
    return results.filter(Boolean);
  }

  async listForMembership(tenant: WorkspaceTenantContext, query: NotificationListQueryDto) {
    const membershipId = requireMembership(tenant);
    const where = notificationWhere(tenant.workspaceId, membershipId, query);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        select: notificationSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.notification.count({ where }),
    ]);
    return {
      items: items.map(serializeNotification),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async getUnreadCount(tenant: WorkspaceTenantContext) {
    const membershipId = requireMembership(tenant);
    const count = await this.prisma.notification.count({
      where: {
        workspaceId: tenant.workspaceId,
        recipientMembershipId: membershipId,
        readAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    return { count };
  }

  async markRead(tenant: WorkspaceTenantContext, notificationId: string) {
    return this.setReadState(tenant, notificationId, true);
  }

  async markUnread(tenant: WorkspaceTenantContext, notificationId: string) {
    return this.setReadState(tenant, notificationId, false);
  }

  async markAllRead(tenant: WorkspaceTenantContext) {
    const membershipId = requireMembership(tenant);
    const result = await this.prisma.notification.updateMany({
      where: {
        workspaceId: tenant.workspaceId,
        recipientMembershipId: membershipId,
        readAt: null,
      },
      data: { readAt: new Date() },
    });
    if (result.count > 0) {
      await this.realtime.publishMember(tenant.workspaceId, membershipId, {
        eventType: 'NOTIFICATIONS_READ_ALL',
        entityType: 'NOTIFICATION',
        entityId: null,
        actorMembershipId: tenant.workspaceMembershipId,
        payload: { updatedCount: result.count },
      });
      await this.realtime.publishMember(tenant.workspaceId, membershipId, {
        eventType: 'NOTIFICATION_UNREAD_COUNT_CHANGED',
        entityType: 'NOTIFICATION',
        entityId: null,
        actorMembershipId: tenant.workspaceMembershipId,
        payload: { updatedCount: result.count },
      });
    }
    return { updatedCount: result.count };
  }

  async listPreferences(tenant: WorkspaceTenantContext) {
    const membershipId = requireMembership(tenant);
    const rows = await this.prisma.notificationPreference.findMany({
      where: { workspaceId: tenant.workspaceId, membershipId },
      orderBy: { category: 'asc' },
    });
    const byCategory = new Map(rows.map((row) => [row.category, row]));
    return notificationCategories.map((category) =>
      serializePreference(
        byCategory.get(category) ?? {
          category,
          inAppEnabled: true,
          emailEnabled: false,
          pushEnabled: false,
          mutedUntil: null,
        },
      ),
    );
  }

  async updatePreferences(tenant: WorkspaceTenantContext, dto: UpdateNotificationPreferencesDto) {
    const membershipId = requireMembership(tenant);
    const categories = new Set<NotificationCategory>();
    for (const item of dto.preferences) {
      if (categories.has(item.category)) throw new BadRequestException('DUPLICATE_CATEGORY');
      categories.add(item.category);
      await this.prisma.notificationPreference.upsert({
        where: { membershipId_category: { membershipId, category: item.category } },
        create: {
          workspaceId: tenant.workspaceId,
          membershipId,
          category: item.category,
          inAppEnabled: item.inAppEnabled ?? true,
          emailEnabled: item.emailEnabled ?? false,
          mutedUntil: parseMutedUntil(item.mutedUntil),
        },
        update: {
          inAppEnabled: item.inAppEnabled,
          emailEnabled: item.emailEnabled,
          mutedUntil: parseMutedUntil(item.mutedUntil),
        },
      });
    }
    return this.listPreferences(tenant);
  }

  private async setReadState(
    tenant: WorkspaceTenantContext,
    notificationId: string,
    read: boolean,
  ) {
    const membershipId = requireMembership(tenant);
    const existing = await this.prisma.notification.findFirst({
      where: {
        id: notificationId,
        workspaceId: tenant.workspaceId,
        recipientMembershipId: membershipId,
      },
      select: notificationSelect,
    });
    if (!existing) throw new NotFoundException('NOTIFICATION_NOT_FOUND');
    if ((read && existing.readAt) || (!read && !existing.readAt)) {
      return serializeNotification(existing);
    }
    const updated = await this.prisma.notification.update({
      where: { id_workspaceId: { id: notificationId, workspaceId: tenant.workspaceId } },
      data: { readAt: read ? new Date() : null },
      select: notificationSelect,
    });
    await this.realtime.publishMember(tenant.workspaceId, membershipId, {
      eventType: read ? 'NOTIFICATION_READ' : 'NOTIFICATION_UNREAD',
      entityType: 'NOTIFICATION',
      entityId: updated.id,
      actorMembershipId: tenant.workspaceMembershipId,
      payload: notificationPayload(updated),
    });
    await this.publishUnreadCountChanged(updated);
    return serializeNotification(updated);
  }

  private async publishNotificationCreated(
    notification: Prisma.NotificationGetPayload<{ select: typeof notificationSelect }>,
  ) {
    await this.realtime.publishMember(
      notification.workspaceId,
      notification.recipientMembershipId,
      {
        eventType: 'NOTIFICATION_CREATED',
        entityType: 'NOTIFICATION',
        entityId: notification.id,
        actorMembershipId: notification.actorMembershipId,
        payload: notificationPayload(notification),
      },
    );
    await this.publishUnreadCountChanged(notification);
  }

  private async publishUnreadCountChanged(
    notification: Prisma.NotificationGetPayload<{ select: typeof notificationSelect }>,
  ) {
    await this.realtime.publishMember(
      notification.workspaceId,
      notification.recipientMembershipId,
      {
        eventType: 'NOTIFICATION_UNREAD_COUNT_CHANGED',
        entityType: 'NOTIFICATION',
        entityId: notification.id,
        actorMembershipId: notification.actorMembershipId,
        payload: {
          notificationId: notification.id,
          category: notification.category,
        },
      },
    );
  }

  private async resolvePreference(
    workspaceId: string,
    membershipId: string,
    category: NotificationCategory,
    db: Prisma.TransactionClient | PrismaService,
  ) {
    const row = await db.notificationPreference.findUnique({
      where: { membershipId_category: { membershipId, category } },
      select: { inAppEnabled: true, mutedUntil: true },
    });
    return row ?? { inAppEnabled: true, mutedUntil: null };
  }
}

const notificationCategories = Object.values(NotificationCategory);

const notificationSelect = {
  id: true,
  workspaceId: true,
  recipientMembershipId: true,
  category: true,
  type: true,
  title: true,
  message: true,
  entityType: true,
  entityId: true,
  actorMembershipId: true,
  priority: true,
  readAt: true,
  metadata: true,
  dedupeKey: true,
  createdAt: true,
  expiresAt: true,
} satisfies Prisma.NotificationSelect;

function notificationWhere(
  workspaceId: string,
  membershipId: string,
  query: NotificationListQueryDto,
): Prisma.NotificationWhereInput {
  const where: Prisma.NotificationWhereInput = {
    workspaceId,
    recipientMembershipId: membershipId,
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
  };
  if (query.state === 'unread') where.readAt = null;
  if (query.category) where.category = query.category;
  if (query.priority) where.priority = query.priority;
  const createdAt: Prisma.DateTimeFilter = {};
  if (query.from) createdAt.gte = parseDate(query.from);
  if (query.to) createdAt.lte = parseDate(query.to);
  if (createdAt.gte || createdAt.lte) where.createdAt = createdAt;
  return where;
}

function requireMembership(tenant: WorkspaceTenantContext) {
  if (!tenant.workspaceMembershipId) {
    throw new ForbiddenException('WORKSPACE_MEMBERSHIP_REQUIRED');
  }
  return tenant.workspaceMembershipId;
}

function normalizeText(value: string, max: number, label: string) {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) throw new BadRequestException(`${label} is required.`);
  return normalized.slice(0, max);
}

function normalizeDedupeKey(value: string | null | undefined) {
  const normalized = value?.trim() ?? '';
  if (!normalized) return null;
  if (!/^[a-zA-Z0-9:._-]{1,180}$/.test(normalized)) {
    throw new BadRequestException('INVALID_NOTIFICATION_DEDUPE_KEY');
  }
  return normalized;
}

function sanitizeMetadata(value: Prisma.InputJsonValue | null) {
  if (value === null) return Prisma.JsonNull;
  assertSafeMetadata(value, []);
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json, 'utf8') > METADATA_MAX_BYTES) {
    throw new UnprocessableEntityException('NOTIFICATION_METADATA_TOO_LARGE');
  }
  return value;
}

function assertSafeMetadata(value: unknown, path: string[]) {
  if (path.some((key) => SENSITIVE_KEY_PATTERN.test(key))) {
    throw new UnprocessableEntityException('NOTIFICATION_METADATA_SENSITIVE');
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeMetadata(item, [...path, String(index)]));
    return;
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        throw new UnprocessableEntityException('NOTIFICATION_METADATA_SENSITIVE');
      }
      assertSafeMetadata(item, [...path, key]);
    }
    return;
  }
  throw new UnprocessableEntityException('NOTIFICATION_METADATA_UNSAFE');
}

function parseDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new BadRequestException('INVALID_NOTIFICATION_DATE');
  return date;
}

function parseMutedUntil(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return parseDate(value);
}

function isCriticalSystemNotification(type: NotificationType) {
  return type === NotificationType.SYSTEM_ANNOUNCEMENT;
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function serializeNotification(
  item: Prisma.NotificationGetPayload<{ select: typeof notificationSelect }>,
) {
  return {
    ...item,
    unread: item.readAt === null,
  };
}

function notificationPayload(
  item: Prisma.NotificationGetPayload<{ select: typeof notificationSelect }>,
) {
  return {
    notificationId: item.id,
    category: item.category,
    type: item.type,
    priority: item.priority,
    entityType: item.entityType,
    entityId: item.entityId,
    unread: item.readAt === null,
    createdAt: item.createdAt.toISOString(),
  };
}

function serializePreference(item: {
  category: NotificationCategory;
  inAppEnabled: boolean;
  emailEnabled: boolean;
  pushEnabled: boolean;
  mutedUntil: Date | null;
}) {
  return item;
}
