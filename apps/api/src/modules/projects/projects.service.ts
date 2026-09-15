import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProjectStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type { WorkspaceTenantContext } from '../../common/auth/auth.types';
import type { PaginationDto } from '../../common/dto/pagination.dto';
import { AuditService } from '../audit/audit.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(tenant: WorkspaceTenantContext, dto: CreateProjectDto) {
    const project = await this.prisma.project.create({
      data: {
        workspaceId: tenant.workspaceId,
        createdById: tenant.userId,
        name: dto.name.trim(),
        description: dto.description?.trim(),
      },
      select: projectSelect,
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'project.create',
      entityType: 'Project',
      entityId: project.id,
    });
    return project;
  }

  async list(tenant: WorkspaceTenantContext, query: PaginationDto) {
    const where: Prisma.ProjectWhereInput = {
      workspaceId: tenant.workspaceId,
      ...(query.search
        ? { name: { contains: query.search.trim(), mode: Prisma.QueryMode.insensitive } }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.project.findMany({
        where,
        select: projectSelect,
        orderBy: { [query.sortBy]: query.sortDirection },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.project.count({ where }),
    ]);
    return { items, page: query.page, pageSize: query.pageSize, total };
  }

  async get(tenant: WorkspaceTenantContext, id: string) {
    const project = await this.prisma.project.findFirst({
      where: { id, workspaceId: tenant.workspaceId },
      select: projectSelect,
    });
    if (!project) throw new NotFoundException('Project not found.');
    return project;
  }

  async update(tenant: WorkspaceTenantContext, id: string, dto: UpdateProjectDto) {
    const update = await this.prisma.project.updateMany({
      where: { id, workspaceId: tenant.workspaceId },
      data: {
        name: dto.name?.trim(),
        description: dto.description?.trim(),
        status: dto.status,
      },
    });
    if (update.count !== 1) throw new NotFoundException('Project not found.');
    const project = await this.get(tenant, id);
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'project.update',
      entityType: 'Project',
      entityId: id,
      metadata: { changed: Object.keys(dto) },
    });
    return project;
  }

  async archive(tenant: WorkspaceTenantContext, id: string) {
    const update = await this.prisma.project.updateMany({
      where: { id, workspaceId: tenant.workspaceId },
      data: { status: ProjectStatus.ARCHIVED, archivedAt: new Date() },
    });
    if (update.count !== 1) throw new NotFoundException('Project not found.');
    const project = await this.get(tenant, id);
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'project.delete',
      entityType: 'Project',
      entityId: id,
    });
    return project;
  }
}

const projectSelect = {
  id: true,
  workspaceId: true,
  name: true,
  description: true,
  status: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProjectSelect;
