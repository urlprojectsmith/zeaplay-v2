import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, WorkspaceTagStatus } from '@prisma/client';
import type { WorkspaceTenantContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateTagDto, TagQueryDto, UpdateTagDto } from './dto/tag.dto';

@Injectable()
export class TagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenant: WorkspaceTenantContext, query: TagQueryDto) {
    const search = query.search ? normalizeTagName(query.search) : undefined;
    const where: Prisma.WorkspaceTagWhereInput = {
      workspaceId: tenant.workspaceId,
      status: query.status,
      ...(search ? { nameNormalized: { contains: normalizeTagNameForKey(search) } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.workspaceTag.findMany({
        where,
        select: workspaceTagSelect,
        orderBy: tagOrderBy(query.sortBy, query.sortDirection),
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.workspaceTag.count({ where }),
    ]);
    return {
      items: items.map(serializeWorkspaceTag),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async get(tenant: WorkspaceTenantContext, tagId: string) {
    const tag = await this.findTag(tenant.workspaceId, tagId);
    return serializeWorkspaceTag(tag);
  }

  async create(tenant: WorkspaceTenantContext, dto: CreateTagDto) {
    const name = normalizeTagName(dto.name);
    const tag = await this.prisma.workspaceTag
      .create({
        data: {
          workspaceId: tenant.workspaceId,
          name,
          nameNormalized: normalizeTagNameForKey(name),
          color: normalizeTagColor(dto.color),
          status: WorkspaceTagStatus.ACTIVE,
          createdById: tenant.userId,
        },
        select: workspaceTagSelect,
      })
      .catch(mapTagWriteError);
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'tag.created',
      entityType: 'WorkspaceTag',
      entityId: tag.id,
    });
    return serializeWorkspaceTag(tag);
  }

  async update(tenant: WorkspaceTenantContext, tagId: string, dto: UpdateTagDto) {
    const existing = await this.findTag(tenant.workspaceId, tagId);
    const name = dto.name === undefined ? undefined : normalizeTagName(dto.name);
    const color = dto.color === undefined ? undefined : normalizeTagColor(dto.color);
    const nextNameNormalized = name === undefined ? undefined : normalizeTagNameForKey(name);
    const changed =
      (name !== undefined && name !== existing.name) ||
      (color !== undefined && color !== existing.color);
    if (!changed) return serializeWorkspaceTag(existing);

    const tag = await this.prisma.workspaceTag
      .update({
        where: { id: tagId },
        data: {
          name,
          nameNormalized: nextNameNormalized,
          color,
        },
        select: workspaceTagSelect,
      })
      .catch(mapTagWriteError);
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'tag.updated',
      entityType: 'WorkspaceTag',
      entityId: tagId,
      metadata: { changed: Object.keys(dto) },
    });
    return serializeWorkspaceTag(tag);
  }

  async archive(tenant: WorkspaceTenantContext, tagId: string) {
    const result = await this.prisma
      .$transaction(async (tx) => {
        const existing = await this.findTag(tenant.workspaceId, tagId, tx);
        if (existing.status === WorkspaceTagStatus.ARCHIVED) {
          return { tag: existing, changed: false };
        }
        const tag = await tx.workspaceTag.update({
          where: { id: tagId },
          data: { status: WorkspaceTagStatus.ARCHIVED },
          select: workspaceTagSelect,
        });
        return { tag, changed: true };
      }, serializableTransaction)
      .catch(mapTagWriteError);
    if (!result.changed) return serializeWorkspaceTag(result.tag);
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'tag.archived',
      entityType: 'WorkspaceTag',
      entityId: tagId,
    });
    return serializeWorkspaceTag(result.tag);
  }

  async reactivate(tenant: WorkspaceTenantContext, tagId: string) {
    const result = await this.prisma
      .$transaction(async (tx) => {
        const existing = await this.findTag(tenant.workspaceId, tagId, tx);
        if (existing.status === WorkspaceTagStatus.ACTIVE) {
          return { tag: existing, changed: false };
        }
        const tag = await tx.workspaceTag.update({
          where: { id: tagId },
          data: { status: WorkspaceTagStatus.ACTIVE },
          select: workspaceTagSelect,
        });
        return { tag, changed: true };
      }, serializableTransaction)
      .catch(mapTagWriteError);
    if (!result.changed) return serializeWorkspaceTag(result.tag);
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'tag.reactivated',
      entityType: 'WorkspaceTag',
      entityId: tagId,
    });
    return serializeWorkspaceTag(result.tag);
  }

  private async findTag(
    workspaceId: string,
    tagId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const tag = await tx.workspaceTag.findFirst({
      where: { id: tagId, workspaceId },
      select: workspaceTagSelect,
    });
    if (!tag) throw new NotFoundException('Tag not found.');
    return tag;
  }
}

export const workspaceTagSelect = {
  id: true,
  workspaceId: true,
  name: true,
  nameNormalized: true,
  color: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.WorkspaceTagSelect;

type WorkspaceTagRecord = Prisma.WorkspaceTagGetPayload<{ select: typeof workspaceTagSelect }>;

export function serializeWorkspaceTag(tag: WorkspaceTagRecord) {
  return {
    id: tag.id,
    workspaceId: tag.workspaceId,
    name: tag.name,
    color: tag.color,
    status: tag.status,
    createdAt: tag.createdAt,
    updatedAt: tag.updatedAt,
  };
}

export function normalizeTagName(name: string) {
  const normalized = name.trim().replace(/\s+/g, ' ');
  if (!normalized) throw new BadRequestException('Tag name is required.');
  if ([...normalized].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
    throw new BadRequestException('Tag name contains unsupported characters.');
  }
  return normalized;
}

export function normalizeTagNameForKey(name: string) {
  return normalizeTagName(name).toLocaleLowerCase('en-US');
}

export function normalizeTagColor(color: string | null | undefined) {
  if (color === undefined) return undefined;
  if (color === null || color === '') return null;
  return color.toUpperCase();
}

function tagOrderBy(sortBy: TagQueryDto['sortBy'], sortDirection: Prisma.SortOrder) {
  if (sortBy === 'name') return { nameNormalized: sortDirection };
  return { [sortBy]: sortDirection } as Prisma.WorkspaceTagOrderByWithRelationInput;
}

function mapTagWriteError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new ConflictException('Tag name already exists in this workspace.');
  }
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2034' || error.meta?.code === '40001')
  ) {
    throw new ConflictException('Tag changed concurrently. Retry the request.');
  }
  throw error;
}

const serializableTransaction = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
};
