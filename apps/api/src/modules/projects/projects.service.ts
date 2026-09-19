import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DepartmentStatus,
  MembershipStatus,
  Prisma,
  ProjectStatus,
  ProjectVisibility,
  StatusEntityType,
  TaskPriority,
} from '@prisma/client';
import type { WorkspaceTenantContext } from '../../common/auth/auth.types';
import { PermissionKeys } from '../../common/authorization/permissions';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { ProjectQueryDto } from './dto/project-query.dto';
import {
  ProjectMemberQueryDto,
  ProjectMembersDto,
  ProjectTagIdsDto,
  UpdateProjectDto,
  UpdateProjectProgressDto,
} from './dto/update-project.dto';

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
    const ownerMembershipId = dto.ownerMembershipId ?? tenant.workspaceMembershipId;
    if (!ownerMembershipId) throw new BadRequestException('INVALID_PROJECT_OWNER');
    const owner = await this.activeMembership(tenant.workspaceId, ownerMembershipId);
    const memberIds = uniqueIds(dto.memberMembershipIds ?? []).filter((id) => id !== owner.id);
    await this.activeMemberships(tenant.workspaceId, memberIds);

    const project = await this.prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          workspaceId: tenant.workspaceId,
          createdById: tenant.userId,
          name,
          description,
          statusDefinitionId: status.id,
          priority: dto.priority ?? TaskPriority.MEDIUM,
          visibility: dto.visibility ?? ProjectVisibility.WORKSPACE,
          plannedStartAt,
          dueAt,
          departmentId: department?.id ?? null,
          ownerMembershipId: owner.id,
          status: ProjectStatus.ACTIVE,
        },
        select: { id: true },
      });
      if (memberIds.length > 0) {
        await tx.projectMember.createMany({
          data: memberIds.map((membershipId) => ({
            workspaceId: tenant.workspaceId,
            projectId: created.id,
            workspaceMembershipId: membershipId,
            addedByMembershipId: tenant.workspaceMembershipId,
          })),
          skipDuplicates: true,
        });
      }
      return tx.project.findUniqueOrThrow({
        where: { id_workspaceId: { id: created.id, workspaceId: tenant.workspaceId } },
        select: projectDetailSelect,
      });
    });

    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'project.created',
      entityType: 'Project',
      entityId: project.id,
      metadata: {
        statusDefinitionId: status.id,
        ownerMembershipId: owner.id,
        visibility: project.visibility,
        memberCount: memberIds.length,
      },
    });
    return serializeProject(
      project,
      await this.progressSummaryForProjects(tenant.workspaceId, [project]),
    );
  }

  async list(tenant: WorkspaceTenantContext, query: ProjectQueryDto) {
    const where = this.projectWhere(tenant, query);
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
    const progress = await this.progressSummaryForProjects(tenant.workspaceId, items);
    return {
      items: items.map((project) => serializeProject(project, progress)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async get(tenant: WorkspaceTenantContext, id: string) {
    const project = await this.readAccessibleProject(tenant, id, projectDetailSelect);
    return serializeProject(
      project,
      await this.progressSummaryForProjects(tenant.workspaceId, [project]),
    );
  }

  async update(tenant: WorkspaceTenantContext, id: string, dto: UpdateProjectDto) {
    const existing = await this.readAccessibleProject(tenant, id, {
      id: true,
      statusDefinitionId: true,
      name: true,
      description: true,
      priority: true,
      visibility: true,
      plannedStartAt: true,
      dueAt: true,
      departmentId: true,
    } satisfies Prisma.ProjectSelect);

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
      ...(dto.visibility ? { visibility: dto.visibility } : {}),
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
    if (dto.visibility && dto.visibility !== existing.visibility) changed.push('visibility');
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
      action:
        dto.visibility && dto.visibility !== existing.visibility
          ? 'project.visibility_changed'
          : 'project.updated',
      entityType: 'Project',
      entityId: id,
      metadata:
        dto.visibility && dto.visibility !== existing.visibility
          ? { fromVisibility: existing.visibility, toVisibility: dto.visibility }
          : { changed },
    });
    return serializeProject(
      project,
      await this.progressSummaryForProjects(tenant.workspaceId, [project]),
    );
  }

  async updateStatus(tenant: WorkspaceTenantContext, id: string, statusDefinitionId: string) {
    const existing = await this.readAccessibleProject(tenant, id, {
      id: true,
      statusDefinitionId: true,
    } satisfies Prisma.ProjectSelect);
    const status = await this.projectStatus(tenant.workspaceId, statusDefinitionId);
    if (existing.statusDefinitionId === status.id) return this.get(tenant, id);
    const project = await this.prisma.$transaction(async (tx) => {
      if (status.isTerminal) {
        const openTaskCount = await this.openLinkedTaskCount(tenant.workspaceId, id, tx);
        if (openTaskCount > 0) {
          throw new BadRequestException({
            code: 'PROJECT_HAS_OPEN_TASKS',
            message: 'Project has open tasks.',
            details: { openTaskCount },
          });
        }
      }
      return tx.project.update({
        where: { id_workspaceId: { id, workspaceId: tenant.workspaceId } },
        data: { statusDefinitionId: status.id },
        select: projectDetailSelect,
      });
    }, serializableTransaction);
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
    return serializeProject(
      project,
      await this.progressSummaryForProjects(tenant.workspaceId, [project]),
    );
  }

  async archive(tenant: WorkspaceTenantContext, id: string) {
    await this.readAccessibleProject(tenant, id, { id: true } satisfies Prisma.ProjectSelect);
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

  async listMembers(tenant: WorkspaceTenantContext, id: string, query: ProjectMemberQueryDto) {
    await this.readAccessibleProject(tenant, id, { id: true } satisfies Prisma.ProjectSelect);
    const search = query.search?.trim();
    const where: Prisma.ProjectMemberWhereInput = {
      workspaceId: tenant.workspaceId,
      projectId: id,
      ...(search
        ? {
            workspaceMembership: {
              user: {
                OR: [
                  { email: { contains: search, mode: Prisma.QueryMode.insensitive } },
                  { name: { contains: search, mode: Prisma.QueryMode.insensitive } },
                ],
              },
            },
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.projectMember.findMany({
        where,
        select: projectMemberSelect,
        orderBy: { createdAt: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.projectMember.count({ where }),
    ]);
    return {
      items: items.map(serializeProjectMember),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async addMembers(tenant: WorkspaceTenantContext, id: string, dto: ProjectMembersDto) {
    const project = await this.readAccessibleProject(tenant, id, {
      id: true,
      ownerMembershipId: true,
    } satisfies Prisma.ProjectSelect);
    const membershipIds = uniqueIds(dto.membershipIds).filter(
      (item) => item !== project.ownerMembershipId,
    );
    await this.activeMemberships(tenant.workspaceId, membershipIds);
    const existing = await this.prisma.projectMember.findMany({
      where: {
        workspaceId: tenant.workspaceId,
        projectId: id,
        workspaceMembershipId: { in: membershipIds },
      },
      select: { workspaceMembershipId: true },
    });
    const existingIds = new Set(existing.map((item) => item.workspaceMembershipId));
    const newIds = membershipIds.filter((item) => !existingIds.has(item));
    if (newIds.length === 0) return this.listMembers(tenant, id, new ProjectMemberQueryDto());
    const created = await this.prisma.projectMember.createMany({
      data: newIds.map((membershipId) => ({
        workspaceId: tenant.workspaceId,
        projectId: id,
        workspaceMembershipId: membershipId,
        addedByMembershipId: tenant.workspaceMembershipId,
      })),
      skipDuplicates: true,
    });
    if (created.count === 0) return this.listMembers(tenant, id, new ProjectMemberQueryDto());
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'project.member_added',
      entityType: 'Project',
      entityId: id,
      metadata: { requestedCount: membershipIds.length, addedCount: created.count },
    });
    return this.listMembers(tenant, id, new ProjectMemberQueryDto());
  }

  async removeMember(tenant: WorkspaceTenantContext, id: string, membershipId: string) {
    const project = await this.readAccessibleProject(tenant, id, {
      id: true,
      ownerMembershipId: true,
    } satisfies Prisma.ProjectSelect);
    if (membershipId === project.ownerMembershipId)
      throw new BadRequestException('PROJECT_OWNER_NOT_REMOVABLE');
    const deleted = await this.prisma.projectMember.deleteMany({
      where: {
        workspaceId: tenant.workspaceId,
        projectId: id,
        workspaceMembershipId: membershipId,
      },
    });
    if (deleted.count === 0) return { id, membershipId, removed: false };
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'project.member_removed',
      entityType: 'Project',
      entityId: id,
      metadata: { membershipId },
    });
    return { id, membershipId, removed: true };
  }

  async updateOwner(tenant: WorkspaceTenantContext, id: string, workspaceMembershipId: string) {
    const project = await this.readAccessibleProject(tenant, id, {
      id: true,
      ownerMembershipId: true,
    } satisfies Prisma.ProjectSelect);
    const owner = await this.activeMembership(tenant.workspaceId, workspaceMembershipId);
    if (owner.id === project.ownerMembershipId) return this.get(tenant, id);
    const updated = await this.prisma.project.update({
      where: { id_workspaceId: { id, workspaceId: tenant.workspaceId } },
      data: { ownerMembershipId: owner.id },
      select: projectDetailSelect,
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'project.owner_changed',
      entityType: 'Project',
      entityId: id,
      metadata: { fromMembershipId: project.ownerMembershipId, toMembershipId: owner.id },
    });
    return serializeProject(
      updated,
      await this.progressSummaryForProjects(tenant.workspaceId, [updated]),
    );
  }

  async listTags(tenant: WorkspaceTenantContext, id: string) {
    await this.readAccessibleProject(tenant, id, { id: true } satisfies Prisma.ProjectSelect);
    const tags = await this.prisma.projectTag.findMany({
      where: { workspaceId: tenant.workspaceId, projectId: id },
      select: projectTagSelect,
      orderBy: { createdAt: 'asc' },
    });
    return tags.map(serializeProjectTag);
  }

  async addTags(tenant: WorkspaceTenantContext, id: string, dto: ProjectTagIdsDto) {
    await this.readAccessibleProject(tenant, id, { id: true } satisfies Prisma.ProjectSelect);
    const tagIds = uniqueIds(dto.tagIds);
    const changed = await this.prisma.$transaction(async (tx) => {
      if (tagIds.length === 0) return 0;
      await this.lockActiveWorkspaceTags(tx, tenant.workspaceId, tagIds);
      const created = await tx.projectTag.createMany({
        data: tagIds.map((tagId) => ({
          workspaceId: tenant.workspaceId,
          projectId: id,
          tagId,
          createdById: tenant.userId,
        })),
        skipDuplicates: true,
      });
      return created.count;
    }, serializableTransaction);
    if (changed > 0) {
      await this.audit.record({
        agencyId: tenant.agencyId,
        workspaceId: tenant.workspaceId,
        userId: tenant.userId,
        action: 'project.tag_added',
        entityType: 'Project',
        entityId: id,
        metadata: { requestedCount: tagIds.length, changedCount: changed },
      });
    }
    return { requestedCount: tagIds.length, changedCount: changed };
  }

  async removeTags(tenant: WorkspaceTenantContext, id: string, dto: ProjectTagIdsDto) {
    await this.readAccessibleProject(tenant, id, { id: true } satisfies Prisma.ProjectSelect);
    const tagIds = uniqueIds(dto.tagIds);
    const removed = await this.prisma.projectTag.deleteMany({
      where: { workspaceId: tenant.workspaceId, projectId: id, tagId: { in: tagIds } },
    });
    if (removed.count > 0) {
      await this.audit.record({
        agencyId: tenant.agencyId,
        workspaceId: tenant.workspaceId,
        userId: tenant.userId,
        action: 'project.tag_removed',
        entityType: 'Project',
        entityId: id,
        metadata: { requestedCount: tagIds.length, changedCount: removed.count },
      });
    }
    return { requestedCount: tagIds.length, changedCount: removed.count };
  }

  async updateProgress(tenant: WorkspaceTenantContext, id: string, dto: UpdateProjectProgressDto) {
    const project = await this.readAccessibleProject(tenant, id, {
      id: true,
      manualProgressPercent: true,
    } satisfies Prisma.ProjectSelect);
    const next = dto.manualProgressPercent;
    if (project.manualProgressPercent === next) return this.get(tenant, id);
    const updated = await this.prisma.project.update({
      where: { id_workspaceId: { id, workspaceId: tenant.workspaceId } },
      data: {
        manualProgressPercent: next,
        manualProgressUpdatedAt: new Date(),
        manualProgressUpdatedByMembershipId: tenant.workspaceMembershipId,
      },
      select: projectDetailSelect,
    });
    const progress = await this.progressSummaryForProjects(tenant.workspaceId, [updated]);
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: next === null ? 'project.progress_override_cleared' : 'project.progress_override_set',
      entityType: 'Project',
      entityId: id,
      metadata: {
        fromManualProgressPercent: project.manualProgressPercent,
        toManualProgressPercent: next,
        calculatedProgress: progress.get(id)?.calculatedProgress ?? 0,
      },
    });
    return serializeProject(updated, progress);
  }

  private projectWhere(
    tenant: WorkspaceTenantContext,
    query: ProjectQueryDto,
  ): Prisma.ProjectWhereInput {
    const plannedRange = dateRange(
      query.plannedFrom,
      query.plannedTo,
      'INVALID_PROJECT_DATE_RANGE',
    );
    const dueRange = dateRange(query.dueFrom, query.dueTo, 'INVALID_PROJECT_DATE_RANGE');
    const filters: Prisma.ProjectWhereInput[] = [this.accessibleProjectWhere(tenant)];
    if (query.search) {
      const search = query.search.trim();
      filters.push({
        OR: [
          { name: { contains: search, mode: Prisma.QueryMode.insensitive } },
          { description: { contains: search, mode: Prisma.QueryMode.insensitive } },
        ],
      });
    }
    if (query.tagId) {
      filters.push({ tags: { some: { tagId: query.tagId, workspaceId: tenant.workspaceId } } });
    }
    return {
      AND: filters,
      statusDefinitionId: query.statusDefinitionId,
      priority: query.priority,
      departmentId: query.departmentId,
      ...(plannedRange ? { plannedStartAt: plannedRange } : {}),
      ...(dueRange ? { dueAt: dueRange } : {}),
    };
  }

  private accessibleProjectWhere(tenant: WorkspaceTenantContext): Prisma.ProjectWhereInput {
    const base = { workspaceId: tenant.workspaceId, archivedAt: null };
    if (hasPermission(tenant, PermissionKeys.projectsViewAll)) return base;
    const membershipId = tenant.workspaceMembershipId;
    return {
      ...base,
      OR: [
        { visibility: ProjectVisibility.WORKSPACE },
        ...(membershipId
          ? [
              { ownerMembershipId: membershipId },
              {
                members: {
                  some: { workspaceMembershipId: membershipId, workspaceId: tenant.workspaceId },
                },
              },
            ]
          : []),
      ],
    };
  }

  private async readAccessibleProject<T extends Prisma.ProjectSelect>(
    tenant: WorkspaceTenantContext,
    id: string,
    select: T,
  ) {
    const project = await this.prisma.project.findFirst({
      where: { ...this.accessibleProjectWhere(tenant), id },
      select,
    });
    if (!project) throw new NotFoundException('Project not found.');
    return project as Prisma.ProjectGetPayload<{ select: T }>;
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
    if (!status || status.entityType !== StatusEntityType.PROJECT || !status.isActive)
      throw new BadRequestException('INVALID_PROJECT_STATUS');
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

  private async activeMembership(workspaceId: string, membershipId: string) {
    const membership = await this.prisma.workspaceMembership.findFirst({
      where: { id: membershipId, workspaceId, status: MembershipStatus.ACTIVE },
      select: { id: true },
    });
    if (!membership) throw new BadRequestException('INVALID_PROJECT_MEMBERSHIP');
    return membership;
  }

  private async activeMemberships(workspaceId: string, membershipIds: string[]) {
    if (membershipIds.length === 0) return [];
    const memberships = await this.prisma.workspaceMembership.findMany({
      where: { id: { in: membershipIds }, workspaceId, status: MembershipStatus.ACTIVE },
      select: { id: true },
    });
    if (memberships.length !== membershipIds.length)
      throw new BadRequestException('INVALID_PROJECT_MEMBERSHIP');
    return memberships;
  }

  private async lockActiveWorkspaceTags(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    tagIds: string[],
  ) {
    const tags = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT "id"
      FROM "workspace_tags"
      WHERE "workspace_id" = ${workspaceId}::uuid
        AND "id" IN (${Prisma.join(tagIds)})
        AND "status" = 'ACTIVE'
      FOR UPDATE
    `);
    if (tags.length !== tagIds.length) throw new BadRequestException('INVALID_PROJECT_TAG');
    return tags;
  }

  private async openLinkedTaskCount(
    workspaceId: string,
    projectId: string,
    tx: Prisma.TransactionClient,
  ) {
    await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT "id"
      FROM "projects"
      WHERE "workspace_id" = ${workspaceId}::uuid
        AND "id" = ${projectId}::uuid
      FOR UPDATE
    `);
    return tx.taskProject.count({
      where: {
        workspaceId,
        projectId,
        task: {
          deletedAt: null,
          statusDefinition: { isTerminal: false },
        },
      },
    });
  }

  private async progressSummaryForProjects(workspaceId: string, projects: ProjectRecord[]) {
    const result = new Map<string, ProjectProgressSummary>();
    for (const project of projects) result.set(project.id, emptyProgress(project));
    if (projects.length === 0) return result;

    const now = new Date();
    const rows = await this.prisma.taskProject.findMany({
      where: {
        workspaceId,
        projectId: { in: projects.map((project) => project.id) },
        task: { deletedAt: null },
      },
      select: {
        projectId: true,
        task: {
          select: {
            dueAt: true,
            statusDefinition: { select: { isTerminal: true } },
          },
        },
      },
    });
    for (const row of rows) {
      const summary = result.get(row.projectId);
      if (!summary) continue;
      summary.taskCounts.totalTasks += 1;
      if (row.task.statusDefinition.isTerminal) {
        summary.taskCounts.completedTasks += 1;
      } else {
        summary.taskCounts.openTasks += 1;
        if (row.task.dueAt && row.task.dueAt < now) summary.taskCounts.overdueTasks += 1;
      }
    }
    for (const project of projects) {
      const summary = result.get(project.id)!;
      if (summary.taskCounts.totalTasks > 0) {
        summary.calculatedProgress = Math.round(
          (summary.taskCounts.completedTasks / summary.taskCounts.totalTasks) * 100,
        );
      } else {
        summary.calculatedProgress = project.statusDefinition?.isTerminal ? 100 : 0;
      }
      summary.effectiveProgress = project.manualProgressPercent ?? summary.calculatedProgress;
    }
    return result;
  }
}

const membershipSummarySelect = {
  id: true,
  status: true,
  user: { select: { id: true, email: true, name: true } },
} satisfies Prisma.WorkspaceMembershipSelect;

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
  visibility: true,
  manualProgressPercent: true,
  manualProgressUpdatedAt: true,
  manualProgressUpdatedByMembershipId: true,
  plannedStartAt: true,
  dueAt: true,
  departmentId: true,
  department: { select: departmentSelect },
  ownerMembershipId: true,
  ownerMembership: { select: membershipSummarySelect },
  manualProgressUpdatedBy: { select: membershipSummarySelect },
  _count: { select: { members: true } },
  createdById: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProjectSelect;

const projectDetailSelect = {
  ...projectListSelect,
} satisfies Prisma.ProjectSelect;

const projectMemberSelect = {
  id: true,
  workspaceId: true,
  projectId: true,
  workspaceMembershipId: true,
  workspaceMembership: { select: membershipSummarySelect },
  createdAt: true,
} satisfies Prisma.ProjectMemberSelect;

const projectTagSelect = {
  workspaceId: true,
  projectId: true,
  tagId: true,
  createdAt: true,
  tag: { select: { id: true, name: true, color: true, status: true } },
} satisfies Prisma.ProjectTagSelect;

type ProjectRecord = Prisma.ProjectGetPayload<{ select: typeof projectDetailSelect }>;
type ProjectMemberRecord = Prisma.ProjectMemberGetPayload<{ select: typeof projectMemberSelect }>;
type ProjectTagRecord = Prisma.ProjectTagGetPayload<{ select: typeof projectTagSelect }>;

interface ProjectProgressSummary {
  calculatedProgress: number;
  effectiveProgress: number;
  taskCounts: {
    totalTasks: number;
    openTasks: number;
    completedTasks: number;
    overdueTasks: number;
  };
}

function serializeProject(
  project: ProjectRecord,
  progressByProjectId: Map<string, ProjectProgressSummary>,
) {
  const progress = progressByProjectId.get(project.id) ?? emptyProgress(project);
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
    visibility: project.visibility,
    calculatedProgress: progress.calculatedProgress,
    manualProgressPercent: project.manualProgressPercent,
    manualProgressUpdatedAt: project.manualProgressUpdatedAt,
    manualProgressUpdatedByMembershipId: project.manualProgressUpdatedByMembershipId,
    manualProgressUpdatedBy: project.manualProgressUpdatedBy
      ? serializeMembership(project.manualProgressUpdatedBy)
      : null,
    effectiveProgress: project.manualProgressPercent ?? progress.calculatedProgress,
    taskCounts: progress.taskCounts,
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
    ownerMembershipId: project.ownerMembershipId,
    owner: serializeMembership(project.ownerMembership),
    memberCount: project._count.members,
    createdById: 'createdById' in project ? project.createdById : undefined,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

function serializeProjectMember(member: ProjectMemberRecord) {
  return {
    id: member.id,
    workspaceId: member.workspaceId,
    projectId: member.projectId,
    workspaceMembershipId: member.workspaceMembershipId,
    member: serializeMembership(member.workspaceMembership),
    createdAt: member.createdAt,
  };
}

function serializeProjectTag(projectTag: ProjectTagRecord) {
  return {
    id: projectTag.tag.id,
    workspaceId: projectTag.workspaceId,
    projectId: projectTag.projectId,
    tagId: projectTag.tagId,
    name: projectTag.tag.name,
    color: projectTag.tag.color,
    status: projectTag.tag.status,
    createdAt: projectTag.createdAt,
  };
}

function emptyProgress(project: Pick<ProjectRecord, 'statusDefinition' | 'manualProgressPercent'>) {
  const calculatedProgress = project.statusDefinition?.isTerminal ? 100 : 0;
  return {
    calculatedProgress,
    effectiveProgress: project.manualProgressPercent ?? calculatedProgress,
    taskCounts: {
      totalTasks: 0,
      openTasks: 0,
      completedTasks: 0,
      overdueTasks: 0,
    },
  };
}

function serializeMembership(
  membership: Prisma.WorkspaceMembershipGetPayload<{ select: typeof membershipSummarySelect }>,
) {
  return {
    id: membership.id,
    status: membership.status,
    user: membership.user,
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
  return { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) };
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

function uniqueIds(ids: string[]) {
  return [...new Set(ids)];
}

function hasPermission(tenant: WorkspaceTenantContext, permission: string) {
  return tenant.permissions.includes('*') || tenant.permissions.includes(permission);
}

const serializableTransaction = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 5_000,
  timeout: 10_000,
};
