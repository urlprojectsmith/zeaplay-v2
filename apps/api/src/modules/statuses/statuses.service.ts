import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StatusEntityType } from '@prisma/client';
import type { WorkspaceTenantContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateStatusDto,
  ReorderStatusesDto,
  StatusQueryDto,
  UpdateStatusDto,
} from './dto/status.dto';
import { initializeDefaultStatuses, normalizeStatusName } from './status-templates';

const MAX_STATUSES_PER_ENTITY_TYPE = 50;

@Injectable()
export class StatusesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async initializeDefaults(tenant: WorkspaceTenantContext) {
    await initializeDefaultStatuses(this.prisma, tenant.workspaceId);
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'statuses.defaults_initialized',
      entityType: 'StatusDefinition',
      metadata: { entityTypes: Object.values(StatusEntityType) },
    });
    return this.list(tenant, {});
  }

  async list(tenant: WorkspaceTenantContext, query: StatusQueryDto) {
    const statuses = await this.prisma.statusDefinition.findMany({
      where: {
        workspaceId: tenant.workspaceId,
        entityType: query.entityType,
        isActive: query.isActive,
      },
      select: statusSelect,
      orderBy: [{ entityType: 'asc' }, { position: 'asc' }, { name: 'asc' }],
    });
    return statuses.map(serializeStatus);
  }

  async listForEntity(tenant: WorkspaceTenantContext, entityType: StatusEntityType) {
    const statuses = await this.prisma.statusDefinition.findMany({
      where: { workspaceId: tenant.workspaceId, entityType },
      select: statusSelect,
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
    });
    return statuses.map(serializeStatus);
  }

  async get(tenant: WorkspaceTenantContext, entityType: StatusEntityType, statusId: string) {
    const status = await this.findStatus(tenant.workspaceId, entityType, statusId);
    return serializeStatus(status);
  }

  async create(tenant: WorkspaceTenantContext, entityType: StatusEntityType, dto: CreateStatusDto) {
    const name = normalizeStatusInputName(dto.name);
    const status = await this.prisma
      .$transaction(
        async (tx) => {
          await this.assertStatusLimit(tx, tenant.workspaceId, entityType);
          const activeCount = await tx.statusDefinition.count({
            where: { workspaceId: tenant.workspaceId, entityType, isActive: true },
          });
          const position =
            (
              await tx.statusDefinition.aggregate({
                where: { workspaceId: tenant.workspaceId, entityType },
                _max: { position: true },
              })
            )._max.position ?? 0;
          const isDefault = Boolean(dto.isDefault) || activeCount === 0;
          if (isDefault) {
            await tx.statusDefinition.updateMany({
              where: { workspaceId: tenant.workspaceId, entityType, isDefault: true },
              data: { isDefault: false },
            });
          }
          return tx.statusDefinition.create({
            data: {
              workspaceId: tenant.workspaceId,
              entityType,
              name,
              nameNormalized: normalizeStatusName(name),
              description: dto.description?.trim(),
              color: normalizeHex(dto.color),
              position: position + 1,
              category: dto.category,
              isDefault,
              isTerminal: Boolean(dto.isTerminal),
              isActive: true,
              isSystem: false,
            },
            select: statusSelect,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
      .catch(handleStatusWriteError);
    await this.record(tenant, 'status.created', entityType, status.id, {
      isDefault: status.isDefault,
    });
    return serializeStatus(status);
  }

  async update(
    tenant: WorkspaceTenantContext,
    entityType: StatusEntityType,
    statusId: string,
    dto: UpdateStatusDto,
  ) {
    const name = dto.name === undefined ? undefined : normalizeStatusInputName(dto.name);
    const status = await this.prisma
      .$transaction(
        async (tx) => {
          const existing = await this.findStatusInTx(tx, tenant.workspaceId, entityType, statusId);
          if (dto.isDefault === false && existing.isDefault) {
            throw new BadRequestException('Default status cannot be unset directly.');
          }
          if (dto.isDefault === true && dto.isActive === false) {
            throw new BadRequestException('Inactive status cannot be the default.');
          }
          if (dto.isActive === false) {
            if (existing.isDefault) {
              throw new BadRequestException('Default status cannot be deactivated.');
            }
            const activeCount = await tx.statusDefinition.count({
              where: { workspaceId: tenant.workspaceId, entityType, isActive: true },
            });
            if (activeCount <= 1 && existing.isActive) {
              throw new BadRequestException('At least one active status is required.');
            }
          }
          if (dto.isDefault === true && !existing.isActive) {
            throw new BadRequestException('Inactive status cannot be the default.');
          }
          if (dto.isDefault === true) {
            await tx.statusDefinition.updateMany({
              where: { workspaceId: tenant.workspaceId, entityType, isDefault: true },
              data: { isDefault: false },
            });
          }
          return tx.statusDefinition.update({
            where: { id: statusId },
            data: {
              name,
              nameNormalized: name === undefined ? undefined : normalizeStatusName(name),
              description:
                dto.description === undefined ? undefined : (dto.description?.trim() ?? null),
              color: dto.color ? normalizeHex(dto.color) : undefined,
              category: dto.category,
              isDefault: dto.isDefault,
              isTerminal: dto.isTerminal,
              isActive: dto.isActive,
            },
            select: statusSelect,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
      .catch(handleStatusWriteError);
    await this.record(
      tenant,
      dto.isActive === false
        ? 'status.deactivated'
        : dto.isActive === true
          ? 'status.activated'
          : dto.isDefault === true
            ? 'status.default_changed'
            : 'status.updated',
      entityType,
      statusId,
      { changed: Object.keys(dto) },
    );
    return serializeStatus(status);
  }

  async setDefault(tenant: WorkspaceTenantContext, entityType: StatusEntityType, statusId: string) {
    const status = await this.prisma
      .$transaction(
        async (tx) => {
          const existing = await this.findStatusInTx(tx, tenant.workspaceId, entityType, statusId);
          if (!existing.isActive)
            throw new BadRequestException('Inactive status cannot be default.');
          await tx.statusDefinition.updateMany({
            where: { workspaceId: tenant.workspaceId, entityType, isDefault: true },
            data: { isDefault: false },
          });
          return tx.statusDefinition.update({
            where: { id: statusId },
            data: { isDefault: true },
            select: statusSelect,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
      .catch(handleStatusWriteError);
    await this.record(tenant, 'status.default_changed', entityType, statusId);
    return serializeStatus(status);
  }

  async reorder(
    tenant: WorkspaceTenantContext,
    entityType: StatusEntityType,
    dto: ReorderStatusesDto,
  ) {
    const uniqueIds = new Set(dto.orderedStatusIds);
    if (uniqueIds.size !== dto.orderedStatusIds.length) {
      throw new BadRequestException('Duplicate status ids are not allowed.');
    }
    const statuses = await this.prisma
      .$transaction(
        async (tx) => {
          const existing = await tx.statusDefinition.findMany({
            where: { workspaceId: tenant.workspaceId, entityType },
            select: { id: true },
            orderBy: { position: 'asc' },
          });
          if (
            existing.length !== dto.orderedStatusIds.length ||
            existing.some((status) => !uniqueIds.has(status.id))
          ) {
            throw new BadRequestException(
              'Reorder must include every status for this entity type.',
            );
          }
          await Promise.all(
            dto.orderedStatusIds.map((id, index) =>
              tx.statusDefinition.update({
                where: { id },
                data: { position: index + 1 },
              }),
            ),
          );
          return tx.statusDefinition.findMany({
            where: { workspaceId: tenant.workspaceId, entityType },
            select: statusSelect,
            orderBy: [{ position: 'asc' }, { name: 'asc' }],
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
      .catch(handleStatusWriteError);
    await this.record(tenant, 'statuses.reordered', entityType, null, {
      orderedStatusIds: dto.orderedStatusIds,
    });
    return statuses.map(serializeStatus);
  }

  private async findStatus(workspaceId: string, entityType: StatusEntityType, statusId: string) {
    const status = await this.prisma.statusDefinition.findFirst({
      where: { id: statusId, workspaceId, entityType },
      select: statusSelect,
    });
    if (!status) throw new NotFoundException('Status not found.');
    return status;
  }

  private async findStatusInTx(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    entityType: StatusEntityType,
    statusId: string,
  ) {
    const status = await tx.statusDefinition.findFirst({
      where: { id: statusId, workspaceId, entityType },
      select: statusSelect,
    });
    if (!status) throw new NotFoundException('Status not found.');
    return status;
  }

  private async assertStatusLimit(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    entityType: StatusEntityType,
  ) {
    const count = await tx.statusDefinition.count({ where: { workspaceId, entityType } });
    if (count >= MAX_STATUSES_PER_ENTITY_TYPE) {
      throw new ConflictException('Maximum statuses reached for this entity type.');
    }
  }

  private record(
    tenant: WorkspaceTenantContext,
    action: string,
    entityType: StatusEntityType,
    statusId?: string | null,
    metadata: Record<string, unknown> = {},
  ) {
    return this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action,
      entityType: 'StatusDefinition',
      entityId: statusId ?? undefined,
      metadata: { entityType, ...metadata },
    });
  }
}

const statusSelect = {
  id: true,
  workspaceId: true,
  entityType: true,
  name: true,
  description: true,
  color: true,
  position: true,
  category: true,
  isDefault: true,
  isTerminal: true,
  isActive: true,
  isSystem: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.StatusDefinitionSelect;

type StatusRecord = Prisma.StatusDefinitionGetPayload<{ select: typeof statusSelect }>;

function serializeStatus(status: StatusRecord) {
  return status;
}

function normalizeHex(color: string) {
  return color.toUpperCase();
}

function normalizeStatusInputName(name: string) {
  const normalized = name.trim().replace(/\s+/g, ' ');
  if (normalized.length < 2) {
    throw new BadRequestException('Status name must be at least 2 characters.');
  }
  return normalized;
}

function handleStatusWriteError(error: unknown): never {
  const code = prismaErrorCode(error);
  if (code === 'P2002') {
    throw new ConflictException('Status name already exists for this entity type.');
  }
  if (code === 'P2034' || code === 'P2028') {
    throw new ConflictException('Status update conflicted with another request. Please retry.');
  }
  if (isRetryableTransactionConflict(error)) {
    throw new ConflictException('Status update conflicted with another request. Please retry.');
  }
  throw error;
}

function prismaErrorCode(error: unknown): string | undefined {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code;
  if (typeof error !== 'object' || error === null) return undefined;
  const maybeError = error as { code?: unknown; cause?: unknown };
  if (typeof maybeError.code === 'string') return maybeError.code;
  return prismaErrorCode(maybeError.cause);
}

function isRetryableTransactionConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const maybeError = error as { message?: unknown; cause?: unknown };
  const message = typeof maybeError.message === 'string' ? maybeError.message.toLowerCase() : '';
  if (
    message.includes('transaction already closed') ||
    message.includes('write conflict') ||
    message.includes('deadlock') ||
    message.includes('could not serialize')
  ) {
    return true;
  }
  return isRetryableTransactionConflict(maybeError.cause);
}
