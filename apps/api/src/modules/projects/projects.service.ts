import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DepartmentStatus,
  Prisma,
  ProjectStatus,
  StatusEntityType,
  TaskPriority,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type { WorkspaceTenantContext } from '../../common/auth/auth.types';
import { AuditService } from '../audit/audit.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { ProjectQueryDto } from './dto/project-query.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(tenant: WorkspaceTenantContext, dto: CreateProjectDto) {
    const name = normalizeName(dto.name);
    const description = normalizeDescription(dto.description);
    const { plannedStartAt, dueAt } = normalizeProjectDates(dto);
    const status = await this.projectStatus(tenant.workspaceId, dto.statusDefinitionId);
    const department = await this.projectDepartment(tenant.workspaceId, dto.departmentId);
    const project = await this.prisma.$transaction(async (tx) =>
      tx.project.create({
        data: {
          workspaceId: tenant.workspaceId,
          createdById: tenant.userId,
          name,
          description,
          statusDefinitionId: status.id,
          priority: dto.priority ?? TaskPriority.MEDIUM,
          plannedStartAt,
          dueAt,
          departmentId: department?.id ?? null,
          status: ProjectStatus.ACTIVE,
        },
        select: projectDetailSelect,
      }),
    );
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'project.created',
      entityType: 'Project',
      entityId: project.id,
      metadata: { statusDefinitionId: status.id },
    });
    return serializeProject(project);
  }

  async list(tenant: WorkspaceTenantContext, query: ProjectQueryDto) {
    const where = this.projectWhere(tenant.workspaceId, query);
    const orderBy = projectOrderBy(query.sortBy, query.sortDirection);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.project.findMany({
        where,
        select: projectListSelect,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.project.count({ where }),
    ]);
    return {
      items: items.map(serializeProject),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async get(tenant: WorkspaceTenantContext, id: string) {
    const project = await this.prisma.project.findFirst({
      where: { id, workspaceId: tenant.workspaceId, archivedAt: null },
      select: projectDetailSelect,
    });
    if (!project) throw new NotFoundException('Project not found.');
    return serializeProject(project);
  }

  async update(tenant: WorkspaceTenantContext, id: string, dto: UpdateProjectDto) {
    const existing = await this.prisma.project.findFirst({
      where: { id, workspaceId: tenant.workspaceId, archivedAt: null },
      select: {
        id: true,
        statusDefinitionId: true,
        name: true,
        description: true,
        priority: true,
        plannedStartAt: true,
        dueAt: true,
        departmentId: true,
      },
    });
    if (!existing) throw new NotFoundException('Project not found.');

    const nextDates = normalizeProjectDates({
      plannedStartAt:
        dto.plannedStartAt === undefined ? existing.plannedStartAt : dto.plannedStartAt,
      dueAt: dto.dueAt === undefined ? existing.dueAt : dto.dueAt,
    });
    const status = dto.statusDefinitionId
      ? await this.projectStatus(tenant.workspaceId, dto.statusDefinitionId)
      : null;
    const department =
      dto.departmentId !== undefined
        ? await this.projectDepartment(tenant.workspaceId, dto.departmentId)
        : undefined;
    const data: Prisma.ProjectUpdateInput = {
      ...(dto.name !== undefined ? { name: normalizeName(dto.name) } : {}),
      ...(dto.description !== undefined
        ? { description: normalizeDescription(dto.description) }
        : {}),
      ...(dto.priority ? { priority: dto.priority } : {}),
      plannedStartAt: nextDates.plannedStartAt,
      dueAt: nextDates.dueAt,
      ...(status
        ? {
            statusDefinition: {
              connect: { id_workspaceId: { id: status.id, workspaceId: tenant.workspaceId } },
            },
          }
        : {}),
      ...(department !== undefined
        ? department
          ? {
              department: {
                connect: { id_workspaceId: { id: department.id, workspaceId: tenant.workspaceId } },
              },
            }
          : { department: { disconnect: true } }
        : {}),
    };
    const changed = changedProjectFields(existing, dto, nextDates);
    if (status && status.id !== existing.statusDefinitionId) changed.push('statusDefinitionId');
    if (department !== undefined && (department?.id ?? null) !== existing.departmentId)
      changed.push('departmentId');
    if (changed.length === 0) return this.get(tenant, id);

    const project = await this.prisma.project.update({
      where: { id_workspaceId: { id, workspaceId: tenant.workspaceId } },
      data,
      select: projectDetailSelect,
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'project.updated',
      entityType: 'Project',
      entityId: id,
      metadata: { changed },
    });
    return serializeProject(project);
  }

  async updateStatus(tenant: WorkspaceTenantContext, id: string, statusDefinitionId: string) {
    const existing = await this.prisma.project.findFirst({
      where: { id, workspaceId: tenant.workspaceId, archivedAt: null },
      select: { id: true, statusDefinitionId: true },
    });
    if (!existing) throw new NotFoundException('Project not found.');
    const status = await this.projectStatus(tenant.workspaceId, statusDefinitionId);
    if (existing.statusDefinitionId === status.id) return this.get(tenant, id);
    const project = await this.prisma.project.update({
      where: { id_workspaceId: { id, workspaceId: tenant.workspaceId } },
      data: { statusDefinitionId: status.id },
      select: projectDetailSelect,
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'project.status_changed',
      entityType: 'Project',
      entityId: id,
      metadata: {
        fromStatusId: existing.statusDefinitionId,
        toStatusId: status.id,
      },
    });
    return serializeProject(project);
  }

  async archive(tenant: WorkspaceTenantContext, id: string) {
    const update = await this.prisma.project.updateMany({
      where: { id, workspaceId: tenant.workspaceId, archivedAt: null },
      data: { status: ProjectStatus.ARCHIVED, archivedAt: new Date() },
    });
    if (update.count !== 1) throw new NotFoundException('Project not found.');
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'project.deleted',
      entityType: 'Project',
      entityId: id,
    });
    return { id, deleted: true };
  }

  private projectWhere(workspaceId: string, query: ProjectQueryDto): Prisma.ProjectWhereInput {
    const plannedRange = dateRange(
      query.plannedFrom,
      query.plannedTo,
      'INVALID_PROJECT_DATE_RANGE',
    );
    const dueRange = dateRange(query.dueFrom, query.dueTo, 'INVALID_PROJECT_DATE_RANGE');
    return {
      workspaceId,
      archivedAt: null,
      statusDefinitionId: query.statusDefinitionId,
      priority: query.priority,
      departmentId: query.departmentId,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search.trim(), mode: Prisma.QueryMode.insensitive } },
              {
                description: {
                  contains: query.search.trim(),
                  mode: Prisma.QueryMode.insensitive,
                },
              },
            ],
          }
        : {}),
      ...(plannedRange ? { plannedStartAt: plannedRange } : {}),
      ...(dueRange ? { dueAt: dueRange } : {}),
    };
  }

  private async projectStatus(workspaceId: string, statusDefinitionId?: string) {
    const where: Prisma.StatusDefinitionWhereInput = statusDefinitionId
      ? { id: statusDefinitionId, workspaceId }
      : { workspaceId, entityType: StatusEntityType.PROJECT, isDefault: true, isActive: true };
    const status = await this.prisma.statusDefinition.findFirst({
      where,
      select: statusSelect,
      orderBy: { position: 'asc' },
    });
    if (!status) throw new BadRequestException('INVALID_PROJECT_STATUS');
    if (status.entityType !== StatusEntityType.PROJECT)
      throw new BadRequestException('INVALID_PROJECT_STATUS');
    if (!status.isActive) throw new BadRequestException('INVALID_PROJECT_STATUS');
    return status;
  }

  private async projectDepartment(workspaceId: string, departmentId?: string | null) {
    if (departmentId === undefined) return undefined;
    if (departmentId === null || departmentId === '') return null;
    const department = await this.prisma.department.findFirst({
      where: { id: departmentId, workspaceId },
      select: { id: true, status: true },
    });
    if (!department || department.status !== DepartmentStatus.ACTIVE)
      throw new BadRequestException('INVALID_PROJECT_DEPARTMENT');
    return department;
  }
}

const statusSelect = {
  id: true,
  workspaceId: true,
  entityType: true,
  name: true,
  color: true,
  isTerminal: true,
  isActive: true,
  isDefault: true,
  position: true,
} satisfies Prisma.StatusDefinitionSelect;

const departmentSelect = {
  id: true,
  name: true,
  status: true,
} satisfies Prisma.DepartmentSelect;

const projectListSelect = {
  id: true,
  workspaceId: true,
  name: true,
  description: true,
  statusDefinitionId: true,
  statusDefinition: { select: statusSelect },
  priority: true,
  plannedStartAt: true,
  dueAt: true,
  departmentId: true,
  department: { select: departmentSelect },
  createdById: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProjectSelect;

const projectDetailSelect = {
  ...projectListSelect,
} satisfies Prisma.ProjectSelect;

type ProjectRecord = Prisma.ProjectGetPayload<{ select: typeof projectDetailSelect }>;

function serializeProject(project: ProjectRecord) {
  return {
    id: project.id,
    workspaceId: project.workspaceId,
    name: project.name,
    description: project.description,
    statusDefinitionId: project.statusDefinitionId,
    status: project.statusDefinition
      ? {
          id: project.statusDefinition.id,
          name: project.statusDefinition.name,
          color: project.statusDefinition.color,
          terminal: project.statusDefinition.isTerminal,
        }
      : null,
    priority: project.priority,
    plannedStartAt: project.plannedStartAt,
    dueAt: project.dueAt,
    departmentId: project.departmentId,
    department: project.department
      ? {
          id: project.department.id,
          name: project.department.name,
          status: project.department.status,
        }
      : null,
    createdById: 'createdById' in project ? project.createdById : undefined,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

function normalizeName(value: string) {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) throw new BadRequestException('Project name is required.');
  return normalized;
}

function normalizeDescription(value?: string | null) {
  if (value === undefined) return undefined;
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeProjectDates(input: {
  plannedStartAt?: string | Date | null;
  dueAt?: string | Date | null;
}) {
  const plannedStartAt = input.plannedStartAt ? new Date(input.plannedStartAt) : null;
  const dueAt = input.dueAt ? new Date(input.dueAt) : null;
  if (plannedStartAt && Number.isNaN(plannedStartAt.getTime()))
    throw new BadRequestException('INVALID_PROJECT_DATE_RANGE');
  if (dueAt && Number.isNaN(dueAt.getTime()))
    throw new BadRequestException('INVALID_PROJECT_DATE_RANGE');
  if (plannedStartAt && dueAt && plannedStartAt > dueAt)
    throw new BadRequestException('INVALID_PROJECT_DATE_RANGE');
  return { plannedStartAt, dueAt };
}

function dateRange(from?: string, to?: string, errorCode = 'INVALID_DATE_RANGE') {
  if (!from && !to) return undefined;
  const start = from ? new Date(from) : null;
  const end = to ? new Date(to) : null;
  if (start && Number.isNaN(start.getTime())) throw new BadRequestException(errorCode);
  if (end && Number.isNaN(end.getTime())) throw new BadRequestException(errorCode);
  if (start && end && start > end) throw new BadRequestException(errorCode);
  return {
    ...(start ? { gte: start } : {}),
    ...(end ? { lte: end } : {}),
  };
}

function projectOrderBy(sortBy: ProjectQueryDto['sortBy'], sortDirection: Prisma.SortOrder) {
  if (sortBy === 'dueAt' || sortBy === 'plannedStartAt') {
    return [
      { [sortBy]: { sort: sortDirection, nulls: 'last' } },
      { createdAt: 'desc' },
      { id: 'asc' },
    ] satisfies Prisma.ProjectOrderByWithRelationInput[];
  }
  return [{ [sortBy]: sortDirection }, { id: 'asc' }] as Prisma.ProjectOrderByWithRelationInput[];
}

function changedProjectFields(
  existing: {
    name: string;
    description: string | null;
    priority: TaskPriority;
    plannedStartAt: Date | null;
    dueAt: Date | null;
  },
  dto: UpdateProjectDto,
  dates: { plannedStartAt: Date | null; dueAt: Date | null },
) {
  const changed: string[] = [];
  if (dto.name !== undefined && normalizeName(dto.name) !== existing.name) changed.push('name');
  if (
    dto.description !== undefined &&
    normalizeDescription(dto.description) !== existing.description
  )
    changed.push('description');
  if (dto.priority && dto.priority !== existing.priority) changed.push('priority');
  if (dateTime(dates.plannedStartAt) !== dateTime(existing.plannedStartAt))
    changed.push('plannedStartAt');
  if (dateTime(dates.dueAt) !== dateTime(existing.dueAt)) changed.push('dueAt');
  return changed;
}

function dateTime(value: Date | null) {
  return value?.getTime() ?? null;
}
