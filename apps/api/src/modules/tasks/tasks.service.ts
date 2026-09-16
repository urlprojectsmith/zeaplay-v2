import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DepartmentStatus,
  MembershipStatus,
  Prisma,
  ProjectStatus,
  StatusEntityType,
  TaskPriority,
} from '@prisma/client';
import type { WorkspaceTenantContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateTaskDto,
  ReplaceTaskMembershipsDto,
  ReplaceTaskProjectsDto,
  TaskQueryDto,
  UpdateTaskDto,
} from './dto/task.dto';

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(tenant: WorkspaceTenantContext, dto: CreateTaskDto) {
    const title = normalizeTitle(dto.title);
    const status = await this.taskStatus(tenant.workspaceId, dto.statusDefinitionId);
    const department = await this.activeDepartment(tenant.workspaceId, dto.departmentId);
    const assigneeIds = await this.activeMembershipIds(
      tenant.workspaceId,
      dto.assigneeMembershipIds ?? [],
    );
    const followerIds = await this.activeMembershipIds(
      tenant.workspaceId,
      dto.followerMembershipIds ?? [],
    );
    const projectIds = await this.activeProjectIds(tenant.workspaceId, dto.projectIds ?? []);

    const task = await this.prisma.$transaction(async (tx) => {
      const created = await tx.task.create({
        data: {
          workspaceId: tenant.workspaceId,
          title,
          description: normalizeDescription(dto.description),
          priority: dto.priority ?? TaskPriority.MEDIUM,
          statusDefinitionId: status.id,
          departmentId: department?.id,
          dueAt: parseOptionalDate(dto.dueAt),
          createdById: tenant.userId,
        },
        select: { id: true },
      });
      if (assigneeIds.length > 0) {
        await tx.taskAssignee.createMany({
          data: assigneeIds.map((membershipId) => ({
            taskId: created.id,
            workspaceId: tenant.workspaceId,
            membershipId,
          })),
        });
      }
      if (followerIds.length > 0) {
        await tx.taskFollower.createMany({
          data: followerIds.map((membershipId) => ({
            taskId: created.id,
            workspaceId: tenant.workspaceId,
            membershipId,
          })),
        });
      }
      if (projectIds.length > 0) {
        await tx.taskProject.createMany({
          data: projectIds.map((projectId) => ({
            taskId: created.id,
            workspaceId: tenant.workspaceId,
            projectId,
          })),
        });
      }
      return tx.task.findUniqueOrThrow({ where: { id: created.id }, select: taskDetailSelect });
    });

    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'task.created',
      entityType: 'Task',
      entityId: task.id,
      metadata: relationCounts(assigneeIds, followerIds, projectIds),
    });
    return serializeTaskDetail(task);
  }

  async list(tenant: WorkspaceTenantContext, query: TaskQueryDto) {
    const where = this.taskWhere(tenant.workspaceId, query);
    const orderBy = taskOrderBy(query.sortBy, query.sortDirection);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.task.findMany({
        where,
        select: taskListSelect,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.task.count({ where }),
    ]);
    return {
      items: items.map(serializeTaskListItem),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async get(tenant: WorkspaceTenantContext, taskId: string) {
    return serializeTaskDetail(await this.findTask(tenant.workspaceId, taskId));
  }

  async update(tenant: WorkspaceTenantContext, taskId: string, dto: UpdateTaskDto) {
    const existing = await this.assertTask(tenant.workspaceId, taskId);
    const status = dto.statusDefinitionId
      ? await this.taskStatus(tenant.workspaceId, dto.statusDefinitionId)
      : null;
    const department =
      'departmentId' in dto
        ? await this.activeDepartment(tenant.workspaceId, dto.departmentId)
        : undefined;
    const data: Prisma.TaskUncheckedUpdateInput = {
      title: dto.title === undefined ? undefined : normalizeTitle(dto.title),
      description:
        dto.description === undefined ? undefined : normalizeDescription(dto.description),
      priority: dto.priority,
      statusDefinitionId: status?.id,
      departmentId: department === undefined ? undefined : (department?.id ?? null),
      dueAt: dto.dueAt === undefined ? undefined : parseOptionalDate(dto.dueAt),
      updatedById: tenant.userId,
    };
    const task = await this.prisma.task.update({
      where: { id: taskId },
      data,
      select: taskDetailSelect,
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action:
        dto.statusDefinitionId && dto.statusDefinitionId !== existing.statusDefinitionId
          ? 'task.status_changed'
          : 'task.updated',
      entityType: 'Task',
      entityId: taskId,
      metadata: { changed: Object.keys(dto) },
    });
    return serializeTaskDetail(task);
  }

  async updateStatus(tenant: WorkspaceTenantContext, taskId: string, statusDefinitionId: string) {
    const existing = await this.assertTask(tenant.workspaceId, taskId);
    if (existing.statusDefinitionId === statusDefinitionId) {
      return serializeTaskDetail(await this.findTask(tenant.workspaceId, taskId));
    }
    const status = await this.taskStatus(tenant.workspaceId, statusDefinitionId);
    const task = await this.prisma.task.update({
      where: { id: taskId },
      data: { statusDefinitionId: status.id, updatedById: tenant.userId },
      select: taskDetailSelect,
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'task.status_changed',
      entityType: 'Task',
      entityId: taskId,
      metadata: {
        fromStatusDefinitionId: existing.statusDefinitionId,
        toStatusDefinitionId: status.id,
      },
    });
    return serializeTaskDetail(task);
  }

  async replaceAssignees(
    tenant: WorkspaceTenantContext,
    taskId: string,
    dto: ReplaceTaskMembershipsDto,
  ) {
    await this.assertTask(tenant.workspaceId, taskId);
    const membershipIds = await this.activeMembershipIds(tenant.workspaceId, dto.membershipIds);
    const task = await this.prisma.$transaction(async (tx) => {
      await tx.taskAssignee.deleteMany({ where: { taskId, workspaceId: tenant.workspaceId } });
      if (membershipIds.length > 0) {
        await tx.taskAssignee.createMany({
          data: membershipIds.map((membershipId) => ({
            taskId,
            workspaceId: tenant.workspaceId,
            membershipId,
          })),
        });
      }
      return tx.task.findUniqueOrThrow({ where: { id: taskId }, select: taskDetailSelect });
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'task.assignees_changed',
      entityType: 'Task',
      entityId: taskId,
      metadata: { count: membershipIds.length },
    });
    return serializeTaskDetail(task);
  }

  async replaceFollowers(
    tenant: WorkspaceTenantContext,
    taskId: string,
    dto: ReplaceTaskMembershipsDto,
  ) {
    await this.assertTask(tenant.workspaceId, taskId);
    const membershipIds = await this.activeMembershipIds(tenant.workspaceId, dto.membershipIds);
    const task = await this.prisma.$transaction(async (tx) => {
      await tx.taskFollower.deleteMany({ where: { taskId, workspaceId: tenant.workspaceId } });
      if (membershipIds.length > 0) {
        await tx.taskFollower.createMany({
          data: membershipIds.map((membershipId) => ({
            taskId,
            workspaceId: tenant.workspaceId,
            membershipId,
          })),
        });
      }
      return tx.task.findUniqueOrThrow({ where: { id: taskId }, select: taskDetailSelect });
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'task.followers_changed',
      entityType: 'Task',
      entityId: taskId,
      metadata: { count: membershipIds.length },
    });
    return serializeTaskDetail(task);
  }

  async replaceProjects(
    tenant: WorkspaceTenantContext,
    taskId: string,
    dto: ReplaceTaskProjectsDto,
  ) {
    await this.assertTask(tenant.workspaceId, taskId);
    const projectIds = await this.activeProjectIds(tenant.workspaceId, dto.projectIds);
    const task = await this.prisma.$transaction(async (tx) => {
      await tx.taskProject.deleteMany({ where: { taskId, workspaceId: tenant.workspaceId } });
      if (projectIds.length > 0) {
        await tx.taskProject.createMany({
          data: projectIds.map((projectId) => ({
            taskId,
            workspaceId: tenant.workspaceId,
            projectId,
          })),
        });
      }
      return tx.task.findUniqueOrThrow({ where: { id: taskId }, select: taskDetailSelect });
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'task.projects_changed',
      entityType: 'Task',
      entityId: taskId,
      metadata: { count: projectIds.length },
    });
    return serializeTaskDetail(task);
  }

  async remove(tenant: WorkspaceTenantContext, taskId: string) {
    const update = await this.prisma.task.updateMany({
      where: { id: taskId, workspaceId: tenant.workspaceId, deletedAt: null },
      data: { deletedAt: new Date(), updatedById: tenant.userId },
    });
    if (update.count !== 1) throw new NotFoundException('Task not found.');
    const task = await this.prisma.task.findFirstOrThrow({
      where: { id: taskId, workspaceId: tenant.workspaceId },
      select: taskDetailSelect,
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'task.deleted',
      entityType: 'Task',
      entityId: taskId,
    });
    return serializeTaskDetail(task);
  }

  private taskWhere(workspaceId: string, query: TaskQueryDto): Prisma.TaskWhereInput {
    return {
      workspaceId,
      deletedAt: null,
      statusDefinitionId: query.statusDefinitionId,
      priority: query.priority,
      departmentId: query.departmentId,
      createdById: query.createdById,
      ...(query.search
        ? { title: { contains: query.search.trim(), mode: Prisma.QueryMode.insensitive } }
        : {}),
      ...(query.assigneeMembershipId
        ? { assignees: { some: { membershipId: query.assigneeMembershipId, workspaceId } } }
        : {}),
      ...(query.projectId
        ? { projects: { some: { projectId: query.projectId, workspaceId } } }
        : {}),
      ...(query.dueFrom || query.dueTo
        ? {
            dueAt: {
              gte: query.dueFrom ? new Date(query.dueFrom) : undefined,
              lte: query.dueTo ? new Date(query.dueTo) : undefined,
            },
          }
        : {}),
    };
  }

  private async assertTask(workspaceId: string, taskId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, workspaceId, deletedAt: null },
      select: { id: true, statusDefinitionId: true },
    });
    if (!task) throw new NotFoundException('Task not found.');
    return task;
  }

  private async findTask(workspaceId: string, taskId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, workspaceId, deletedAt: null },
      select: taskDetailSelect,
    });
    if (!task) throw new NotFoundException('Task not found.');
    return task;
  }

  private async taskStatus(workspaceId: string, statusDefinitionId?: string) {
    const where: Prisma.StatusDefinitionWhereInput = statusDefinitionId
      ? {
          id: statusDefinitionId,
          workspaceId,
          entityType: StatusEntityType.TASK,
          isActive: true,
        }
      : {
          workspaceId,
          entityType: StatusEntityType.TASK,
          isActive: true,
          isDefault: true,
        };
    const status = await this.prisma.statusDefinition.findFirst({
      where,
      select: { id: true },
    });
    if (!status) {
      throw new ConflictException(
        statusDefinitionId
          ? 'Task status is not available for this workspace.'
          : 'No active default task status is configured for this workspace.',
      );
    }
    return status;
  }

  private async activeMembershipIds(workspaceId: string, membershipIds: string[]) {
    if (membershipIds.length === 0) return [];
    const memberships = await this.prisma.workspaceMembership.findMany({
      where: { id: { in: membershipIds }, workspaceId },
      select: { id: true, status: true },
    });
    if (memberships.length !== membershipIds.length) {
      throw new NotFoundException('One or more workspace memberships were not found.');
    }
    if (memberships.some((membership) => membership.status !== MembershipStatus.ACTIVE)) {
      throw new BadRequestException('Task memberships must be active.');
    }
    return membershipIds;
  }

  private async activeProjectIds(workspaceId: string, projectIds: string[]) {
    if (projectIds.length === 0) return [];
    const projects = await this.prisma.project.findMany({
      where: { id: { in: projectIds }, workspaceId },
      select: { id: true, status: true },
    });
    if (projects.length !== projectIds.length) {
      throw new NotFoundException('One or more projects were not found.');
    }
    if (projects.some((project) => project.status === ProjectStatus.ARCHIVED)) {
      throw new BadRequestException('Archived projects cannot be linked to new task updates.');
    }
    return projectIds;
  }

  private async activeDepartment(workspaceId: string, departmentId?: string | null) {
    if (!departmentId) return null;
    const department = await this.prisma.department.findFirst({
      where: { id: departmentId, workspaceId },
      select: { id: true, status: true },
    });
    if (!department) throw new NotFoundException('Department not found.');
    if (department.status !== DepartmentStatus.ACTIVE) {
      throw new BadRequestException('Department is not active.');
    }
    return department;
  }
}

const taskListSelect = {
  id: true,
  workspaceId: true,
  title: true,
  priority: true,
  dueAt: true,
  createdAt: true,
  updatedAt: true,
  statusDefinition: {
    select: { id: true, name: true, color: true, category: true, isTerminal: true },
  },
  department: { select: { id: true, name: true, status: true } },
  assignees: {
    select: {
      membership: {
        select: {
          id: true,
          user: { select: { id: true, email: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
    take: 5,
  },
  projects: {
    select: { project: { select: { id: true, name: true, status: true } } },
    orderBy: { createdAt: 'asc' },
    take: 5,
  },
  _count: { select: { assignees: true, followers: true, projects: true } },
} satisfies Prisma.TaskSelect;

const taskDetailSelect = {
  id: true,
  workspaceId: true,
  title: true,
  description: true,
  priority: true,
  dueAt: true,
  archivedAt: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  statusDefinition: {
    select: {
      id: true,
      workspaceId: true,
      entityType: true,
      name: true,
      color: true,
      category: true,
      isDefault: true,
      isTerminal: true,
      isActive: true,
      position: true,
    },
  },
  department: { select: { id: true, name: true, status: true } },
  createdBy: { select: { id: true, email: true, name: true } },
  updatedBy: { select: { id: true, email: true, name: true } },
  assignees: {
    select: {
      membership: {
        select: {
          id: true,
          status: true,
          user: { select: { id: true, email: true, name: true } },
          role: { select: { id: true, key: true, name: true } },
          department: { select: { id: true, name: true, status: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  },
  followers: {
    select: {
      membership: {
        select: {
          id: true,
          status: true,
          user: { select: { id: true, email: true, name: true } },
          role: { select: { id: true, key: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  },
  projects: {
    select: { project: { select: { id: true, name: true, status: true } } },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.TaskSelect;

type TaskListRecord = Prisma.TaskGetPayload<{ select: typeof taskListSelect }>;
type TaskDetailRecord = Prisma.TaskGetPayload<{ select: typeof taskDetailSelect }>;

function serializeTaskListItem(task: TaskListRecord) {
  return {
    ...task,
    status: task.statusDefinition,
    assignees: task.assignees.map((item) => item.membership),
    projects: task.projects.map((item) => item.project),
    counts: task._count,
    statusDefinition: undefined,
    _count: undefined,
  };
}

function serializeTaskDetail(task: TaskDetailRecord) {
  return {
    ...task,
    status: task.statusDefinition,
    assignees: task.assignees.map((item) => item.membership),
    followers: task.followers.map((item) => item.membership),
    projects: task.projects.map((item) => item.project),
    statusDefinition: undefined,
  };
}

function taskOrderBy(sortBy: TaskQueryDto['sortBy'], sortDirection: Prisma.SortOrder) {
  return { [sortBy]: sortDirection } as Prisma.TaskOrderByWithRelationInput;
}

function normalizeTitle(title: string) {
  const normalized = title.trim().replace(/\s+/g, ' ');
  if (!normalized) throw new BadRequestException('Task title is required.');
  return normalized;
}

function normalizeDescription(description: string | null | undefined) {
  if (description === undefined) return undefined;
  if (description === null) return null;
  const normalized = description.trim();
  return normalized ? normalized : null;
}

function parseOptionalDate(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return new Date(value);
}

function relationCounts(assigneeIds: string[], followerIds: string[], projectIds: string[]) {
  return {
    assigneeCount: assigneeIds.length,
    followerCount: followerIds.length,
    projectCount: projectIds.length,
  };
}
