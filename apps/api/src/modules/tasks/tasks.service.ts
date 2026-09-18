import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  DepartmentStatus,
  MembershipStatus,
  Prisma,
  ProjectStatus,
  TaskCommentReactionType,
  TaskCommentVisibility,
  StatusEntityType,
  TaskPriority,
} from '@prisma/client';
import type { WorkspaceTenantContext } from '../../common/auth/auth.types';
import { PermissionKeys } from '../../common/authorization/permissions';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  BulkTaskIdsDto,
  BulkTaskMembershipsDto,
  BulkTaskPriorityDto,
  BulkTaskStatusDto,
  CreateTaskCommentDto,
  CreateTaskDto,
  ReplaceTaskMembershipsDto,
  ReplaceTaskProjectsDto,
  TaskCommentReactionDto,
  TaskQueryDto,
  TaskRelationshipIdsDto,
  UpdateTaskCommentDto,
  UpdateTaskDto,
} from './dto/task.dto';

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(tenant: WorkspaceTenantContext, dto: CreateTaskDto) {
    return this.createTask(tenant, dto, null);
  }

  async createSubtask(tenant: WorkspaceTenantContext, parentTaskId: string, dto: CreateTaskDto) {
    await this.assertTask(tenant.workspaceId, parentTaskId);
    return this.createTask(tenant, dto, parentTaskId);
  }

  private async createTask(
    tenant: WorkspaceTenantContext,
    dto: CreateTaskDto,
    parentTaskId: string | null,
  ) {
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

    const task = await this.prisma
      .$transaction(async (tx) => {
        if (parentTaskId) {
          await this.assertCanAttachToParent(
            tenant.workspaceId,
            parentTaskId,
            status.isTerminal,
            tx,
          );
        }
        const created = await tx.task.create({
          data: {
            workspaceId: tenant.workspaceId,
            parentTaskId,
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
      }, serializableTransaction)
      .catch(mapHierarchyWriteError);

    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'task.created',
      entityType: 'Task',
      entityId: task.id,
      metadata: { ...relationCounts(assigneeIds, followerIds, projectIds), parentTaskId },
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

  async bulkUpdateStatus(tenant: WorkspaceTenantContext, dto: BulkTaskStatusDto) {
    const status = await this.taskStatus(tenant.workspaceId, dto.statusDefinitionId);
    const tasks = await this.assertBulkTasks(tenant.workspaceId, dto.taskIds);
    const changedTaskIds = tasks
      .filter((task) => task.statusDefinitionId !== status.id)
      .map((task) => task.id);
    if (changedTaskIds.length === 0) {
      return bulkResult(dto.taskIds.length, 0);
    }

    await this.prisma
      .$transaction(async (tx) => {
        await this.assertBulkTasks(tenant.workspaceId, dto.taskIds, tx);
        await this.assertBulkStatusTransition(
          tenant.workspaceId,
          dto.taskIds,
          status.isTerminal,
          tx,
        );
        const update = await tx.task.updateMany({
          where: { id: { in: changedTaskIds }, workspaceId: tenant.workspaceId, deletedAt: null },
          data: { statusDefinitionId: status.id, updatedById: tenant.userId },
        });
        if (update.count !== changedTaskIds.length) throw new NotFoundException('Task not found.');
        await tx.auditLog.create({
          data: {
            agencyId: tenant.agencyId,
            workspaceId: tenant.workspaceId,
            userId: tenant.userId,
            action: 'task.bulk_status_changed',
            entityType: 'Task',
            metadata: {
              requestedCount: dto.taskIds.length,
              changedCount: changedTaskIds.length,
              unchangedCount: dto.taskIds.length - changedTaskIds.length,
              statusDefinitionId: status.id,
              taskIds: changedTaskIds,
            },
          },
        });
      }, serializableTransaction)
      .catch(mapHierarchyWriteError);
    return bulkResult(dto.taskIds.length, changedTaskIds.length);
  }

  async bulkUpdatePriority(tenant: WorkspaceTenantContext, dto: BulkTaskPriorityDto) {
    const tasks = await this.assertBulkTasks(tenant.workspaceId, dto.taskIds);
    const changedTaskIds = tasks
      .filter((task) => task.priority !== dto.priority)
      .map((task) => task.id);
    if (changedTaskIds.length === 0) {
      return bulkResult(dto.taskIds.length, 0);
    }

    await this.prisma.$transaction(async (tx) => {
      const update = await tx.task.updateMany({
        where: { id: { in: changedTaskIds }, workspaceId: tenant.workspaceId, deletedAt: null },
        data: { priority: dto.priority, updatedById: tenant.userId },
      });
      if (update.count !== changedTaskIds.length) throw new NotFoundException('Task not found.');
      await tx.auditLog.create({
        data: {
          agencyId: tenant.agencyId,
          workspaceId: tenant.workspaceId,
          userId: tenant.userId,
          action: 'task.bulk_priority_changed',
          entityType: 'Task',
          metadata: {
            requestedCount: dto.taskIds.length,
            changedCount: changedTaskIds.length,
            unchangedCount: dto.taskIds.length - changedTaskIds.length,
            priority: dto.priority,
            taskIds: changedTaskIds,
          },
        },
      });
    });
    return bulkResult(dto.taskIds.length, changedTaskIds.length);
  }

  async bulkAddAssignees(tenant: WorkspaceTenantContext, dto: BulkTaskMembershipsDto) {
    await this.assertBulkTasks(tenant.workspaceId, dto.taskIds);
    const membershipIds = await this.activeMembershipIds(tenant.workspaceId, dto.membershipIds);
    const existing = await this.prisma.taskAssignee.findMany({
      where: {
        workspaceId: tenant.workspaceId,
        taskId: { in: dto.taskIds },
        membershipId: { in: membershipIds },
      },
      select: { taskId: true, membershipId: true },
    });
    const existingKeys = new Set(
      existing.map((assignee) => relationKey(assignee.taskId, assignee.membershipId)),
    );
    const rows = dto.taskIds.flatMap((taskId) =>
      membershipIds
        .filter((membershipId) => !existingKeys.has(relationKey(taskId, membershipId)))
        .map((membershipId) => ({ taskId, workspaceId: tenant.workspaceId, membershipId })),
    );
    if (rows.length === 0) {
      return bulkRelationResult(
        dto.taskIds.length,
        0,
        0,
        dto.taskIds.length * membershipIds.length,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await this.assertBulkTasks(tenant.workspaceId, dto.taskIds, tx);
      const createdRows = await insertTaskAssigneeRows(tx, rows);
      const createdCount = createdRows.length;
      const changedTaskIds = [...new Set(createdRows.map((row) => row.taskId))];
      if (createdCount === 0) {
        return { changedTaskIds, createdCount };
      }
      const update = await tx.task.updateMany({
        where: { id: { in: changedTaskIds }, workspaceId: tenant.workspaceId, deletedAt: null },
        data: { updatedById: tenant.userId },
      });
      if (update.count !== changedTaskIds.length) throw new NotFoundException('Task not found.');
      await tx.auditLog.create({
        data: {
          agencyId: tenant.agencyId,
          workspaceId: tenant.workspaceId,
          userId: tenant.userId,
          action: 'task.bulk_assignees_added',
          entityType: 'Task',
          metadata: {
            requestedCount: dto.taskIds.length,
            changedCount: changedTaskIds.length,
            unchangedCount: dto.taskIds.length - changedTaskIds.length,
            relationChangedCount: createdCount,
            relationUnchangedCount: dto.taskIds.length * membershipIds.length - createdCount,
            membershipIds,
            taskIds: changedTaskIds,
          },
        },
      });
      return { changedTaskIds, createdCount };
    });
    return bulkRelationResult(
      dto.taskIds.length,
      result.changedTaskIds.length,
      result.createdCount,
      dto.taskIds.length * membershipIds.length - result.createdCount,
    );
  }

  async bulkRemoveAssignees(tenant: WorkspaceTenantContext, dto: BulkTaskMembershipsDto) {
    await this.assertBulkTasks(tenant.workspaceId, dto.taskIds);
    const membershipIds = await this.activeMembershipIds(tenant.workspaceId, dto.membershipIds);
    const existing = await this.prisma.taskAssignee.findMany({
      where: {
        workspaceId: tenant.workspaceId,
        taskId: { in: dto.taskIds },
        membershipId: { in: membershipIds },
      },
      select: { taskId: true, membershipId: true },
    });
    const changedTaskIds = [...new Set(existing.map((assignee) => assignee.taskId))];
    if (existing.length === 0) {
      return bulkRelationResult(
        dto.taskIds.length,
        0,
        0,
        dto.taskIds.length * membershipIds.length,
      );
    }

    const deletedCount = await this.prisma.$transaction(async (tx) => {
      await this.assertBulkTasks(tenant.workspaceId, dto.taskIds, tx);
      const deleted = await tx.taskAssignee.deleteMany({
        where: {
          workspaceId: tenant.workspaceId,
          taskId: { in: dto.taskIds },
          membershipId: { in: membershipIds },
        },
      });
      const update = await tx.task.updateMany({
        where: { id: { in: changedTaskIds }, workspaceId: tenant.workspaceId, deletedAt: null },
        data: { updatedById: tenant.userId },
      });
      if (update.count !== changedTaskIds.length) throw new NotFoundException('Task not found.');
      await tx.auditLog.create({
        data: {
          agencyId: tenant.agencyId,
          workspaceId: tenant.workspaceId,
          userId: tenant.userId,
          action: 'task.bulk_assignees_removed',
          entityType: 'Task',
          metadata: {
            requestedCount: dto.taskIds.length,
            changedCount: changedTaskIds.length,
            unchangedCount: dto.taskIds.length - changedTaskIds.length,
            relationChangedCount: deleted.count,
            relationUnchangedCount: dto.taskIds.length * membershipIds.length - deleted.count,
            membershipIds,
            taskIds: changedTaskIds,
          },
        },
      });
      return deleted.count;
    });
    return bulkRelationResult(
      dto.taskIds.length,
      changedTaskIds.length,
      deletedCount,
      dto.taskIds.length * membershipIds.length - deletedCount,
    );
  }

  async bulkRemove(tenant: WorkspaceTenantContext, dto: BulkTaskIdsDto) {
    await this.assertBulkTasks(tenant.workspaceId, dto.taskIds);
    const deletedAt = new Date();
    await this.prisma
      .$transaction(async (tx) => {
        const update = await tx.task.updateMany({
          where: { id: { in: dto.taskIds }, workspaceId: tenant.workspaceId, deletedAt: null },
          data: { deletedAt, updatedById: tenant.userId },
        });
        if (update.count !== dto.taskIds.length) throw new NotFoundException('Task not found.');
        const detach = await tx.task.updateMany({
          where: {
            workspaceId: tenant.workspaceId,
            deletedAt: null,
            parentTaskId: { in: dto.taskIds },
            id: { notIn: dto.taskIds },
          },
          data: { parentTaskId: null, updatedById: tenant.userId },
        });
        await tx.auditLog.create({
          data: {
            agencyId: tenant.agencyId,
            workspaceId: tenant.workspaceId,
            userId: tenant.userId,
            action: 'task.bulk_deleted',
            entityType: 'Task',
            metadata: {
              requestedCount: dto.taskIds.length,
              changedCount: update.count,
              unchangedCount: 0,
              taskIds: dto.taskIds,
              detachedChildCount: detach.count,
            },
          },
        });
      }, serializableTransaction)
      .catch(mapHierarchyWriteError);
    return bulkResult(dto.taskIds.length, dto.taskIds.length);
  }

  async get(tenant: WorkspaceTenantContext, taskId: string) {
    return serializeTaskDetail(await this.findTask(tenant.workspaceId, taskId));
  }

  async listSubtasks(tenant: WorkspaceTenantContext, taskId: string, query: TaskQueryDto) {
    await this.assertTask(tenant.workspaceId, taskId);
    const where = { ...this.taskWhere(tenant.workspaceId, query), parentTaskId: taskId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.task.findMany({
        where,
        select: taskListSelect,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
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

  async updateParent(tenant: WorkspaceTenantContext, taskId: string, parentTaskId: string | null) {
    const result = await this.prisma
      .$transaction(async (tx) => {
        const task = await this.assertTask(tenant.workspaceId, taskId, tx);
        if (task.parentTaskId === parentTaskId) {
          return {
            task: await tx.task.findFirstOrThrow({
              where: { id: taskId, workspaceId: tenant.workspaceId },
              select: taskDetailSelect,
            }),
            oldParentTaskId: task.parentTaskId,
            changed: false,
          };
        }
        if (parentTaskId) {
          if (parentTaskId === taskId) throw new BadRequestException('Task cannot parent itself.');
          await this.assertCanReparent(tenant.workspaceId, taskId, parentTaskId, tx);
        }
        const updated = await tx.task.update({
          where: { id: taskId },
          data: { parentTaskId, updatedById: tenant.userId },
          select: taskDetailSelect,
        });
        await tx.auditLog.create({
          data: {
            agencyId: tenant.agencyId,
            workspaceId: tenant.workspaceId,
            userId: tenant.userId,
            action: parentTaskId ? 'task.parent_changed' : 'task.detached',
            entityType: 'Task',
            entityId: taskId,
            metadata: {
              taskId,
              oldParentTaskId: task.parentTaskId,
              newParentTaskId: parentTaskId,
            },
          },
        });
        return { task: updated, oldParentTaskId: task.parentTaskId, changed: true };
      }, serializableTransaction)
      .catch(mapHierarchyWriteError);
    return serializeTaskDetail(result.task);
  }

  async listBlockedBy(tenant: WorkspaceTenantContext, taskId: string, query: TaskQueryDto) {
    await this.assertTask(tenant.workspaceId, taskId);
    const where = {
      workspaceId: tenant.workspaceId,
      blockedTaskId: taskId,
      blockerTask: { deletedAt: null },
      blockedTask: { deletedAt: null },
    } satisfies Prisma.TaskDependencyWhereInput;
    const [edges, total] = await this.prisma.$transaction([
      this.prisma.taskDependency.findMany({
        where,
        select: { blockerTask: { select: taskRelationshipSelect } },
        orderBy: [{ createdAt: 'asc' }, { blockerTaskId: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.taskDependency.count({ where }),
    ]);
    return paginatedRelationship(
      edges.map((edge) => edge.blockerTask),
      query,
      total,
    );
  }

  async listBlocks(tenant: WorkspaceTenantContext, taskId: string, query: TaskQueryDto) {
    await this.assertTask(tenant.workspaceId, taskId);
    const where = {
      workspaceId: tenant.workspaceId,
      blockerTaskId: taskId,
      blockerTask: { deletedAt: null },
      blockedTask: { deletedAt: null },
    } satisfies Prisma.TaskDependencyWhereInput;
    const [edges, total] = await this.prisma.$transaction([
      this.prisma.taskDependency.findMany({
        where,
        select: { blockedTask: { select: taskRelationshipSelect } },
        orderBy: [{ createdAt: 'asc' }, { blockedTaskId: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.taskDependency.count({ where }),
    ]);
    return paginatedRelationship(
      edges.map((edge) => edge.blockedTask),
      query,
      total,
    );
  }

  async addBlockedBy(
    tenant: WorkspaceTenantContext,
    blockedTaskId: string,
    dto: TaskRelationshipIdsDto,
  ) {
    if (dto.taskIds.includes(blockedTaskId))
      throw new BadRequestException('Task cannot block itself.');
    const taskIds = uniqueIds([blockedTaskId, ...dto.taskIds]);
    await this.assertBulkTasks(tenant.workspaceId, taskIds);
    const result = await this.prisma
      .$transaction(async (tx) => {
        const tasks = await this.assertBulkTasks(tenant.workspaceId, taskIds, tx);
        const blockedTask = tasks.find((task) => task.id === blockedTaskId);
        if (
          blockedTask?.statusDefinition.isTerminal &&
          tasks.some((task) => task.id !== blockedTaskId && !task.statusDefinition.isTerminal)
        ) {
          throw new ConflictException('Terminal tasks cannot accept active non-terminal blockers.');
        }
        const edges = dto.taskIds.map((blockerTaskId) => ({ blockerTaskId, blockedTaskId }));
        await assertDependencyGraphAcyclic(tx, tenant.workspaceId, edges);
        const create = await tx.taskDependency.createMany({
          data: edges.map((edge) => ({
            workspaceId: tenant.workspaceId,
            blockerTaskId: edge.blockerTaskId,
            blockedTaskId: edge.blockedTaskId,
            createdById: tenant.userId,
          })),
          skipDuplicates: true,
        });
        if (create.count > 0) {
          await tx.auditLog.create({
            data: {
              agencyId: tenant.agencyId,
              workspaceId: tenant.workspaceId,
              userId: tenant.userId,
              action: 'task.dependencies_added',
              entityType: 'Task',
              entityId: blockedTaskId,
              metadata: {
                taskId: blockedTaskId,
                requestedCount: dto.taskIds.length,
                changedCount: create.count,
                unchangedCount: dto.taskIds.length - create.count,
                taskIds: dto.taskIds,
              },
            },
          });
        }
        return bulkResult(dto.taskIds.length, create.count);
      }, serializableTransaction)
      .catch(mapHierarchyWriteError);
    return result;
  }

  async removeBlockedBy(
    tenant: WorkspaceTenantContext,
    blockedTaskId: string,
    dto: TaskRelationshipIdsDto,
  ) {
    if (dto.taskIds.includes(blockedTaskId))
      throw new BadRequestException('Task cannot block itself.');
    const taskIds = uniqueIds([blockedTaskId, ...dto.taskIds]);
    await this.assertBulkTasks(tenant.workspaceId, taskIds);
    const result = await this.prisma.$transaction(async (tx) => {
      await this.assertBulkTasks(tenant.workspaceId, taskIds, tx);
      const removed = await tx.taskDependency.deleteMany({
        where: {
          workspaceId: tenant.workspaceId,
          blockedTaskId,
          blockerTaskId: { in: dto.taskIds },
        },
      });
      if (removed.count > 0) {
        await tx.auditLog.create({
          data: {
            agencyId: tenant.agencyId,
            workspaceId: tenant.workspaceId,
            userId: tenant.userId,
            action: 'task.dependencies_removed',
            entityType: 'Task',
            entityId: blockedTaskId,
            metadata: {
              taskId: blockedTaskId,
              requestedCount: dto.taskIds.length,
              changedCount: removed.count,
              unchangedCount: dto.taskIds.length - removed.count,
              taskIds: dto.taskIds,
            },
          },
        });
      }
      return bulkResult(dto.taskIds.length, removed.count);
    });
    return result;
  }

  async listRelated(tenant: WorkspaceTenantContext, taskId: string, query: TaskQueryDto) {
    await this.assertTask(tenant.workspaceId, taskId);
    const where = {
      workspaceId: tenant.workspaceId,
      OR: [
        { taskAId: taskId, taskB: { deletedAt: null } },
        { taskBId: taskId, taskA: { deletedAt: null } },
      ],
      taskA: { deletedAt: null },
      taskB: { deletedAt: null },
    } satisfies Prisma.TaskRelatedTaskWhereInput;
    const [links, total] = await this.prisma.$transaction([
      this.prisma.taskRelatedTask.findMany({
        where,
        select: {
          taskAId: true,
          taskA: { select: taskRelationshipSelect },
          taskB: { select: taskRelationshipSelect },
        },
        orderBy: [{ createdAt: 'asc' }, { taskAId: 'asc' }, { taskBId: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.taskRelatedTask.count({ where }),
    ]);
    const items = links.map((link) => (link.taskAId === taskId ? link.taskB : link.taskA));
    return paginatedRelationship(items, query, total);
  }

  async addRelated(tenant: WorkspaceTenantContext, taskId: string, dto: TaskRelationshipIdsDto) {
    if (dto.taskIds.includes(taskId))
      throw new BadRequestException('Task cannot relate to itself.');
    const taskIds = uniqueIds([taskId, ...dto.taskIds]);
    await this.assertBulkTasks(tenant.workspaceId, taskIds);
    const pairs = dto.taskIds.map((relatedTaskId) => canonicalRelatedPair(taskId, relatedTaskId));
    const result = await this.prisma
      .$transaction(async (tx) => {
        await this.assertBulkTasks(tenant.workspaceId, taskIds, tx);
        const create = await tx.taskRelatedTask.createMany({
          data: pairs.map((pair) => ({
            workspaceId: tenant.workspaceId,
            taskAId: pair.taskAId,
            taskBId: pair.taskBId,
            createdById: tenant.userId,
          })),
          skipDuplicates: true,
        });
        if (create.count > 0) {
          await tx.auditLog.create({
            data: {
              agencyId: tenant.agencyId,
              workspaceId: tenant.workspaceId,
              userId: tenant.userId,
              action: 'task.related_added',
              entityType: 'Task',
              entityId: taskId,
              metadata: {
                taskId,
                requestedCount: dto.taskIds.length,
                changedCount: create.count,
                unchangedCount: dto.taskIds.length - create.count,
                taskIds: dto.taskIds,
              },
            },
          });
        }
        return bulkResult(dto.taskIds.length, create.count);
      })
      .catch(mapHierarchyWriteError);
    return result;
  }

  async removeRelated(tenant: WorkspaceTenantContext, taskId: string, dto: TaskRelationshipIdsDto) {
    if (dto.taskIds.includes(taskId))
      throw new BadRequestException('Task cannot relate to itself.');
    const taskIds = uniqueIds([taskId, ...dto.taskIds]);
    await this.assertBulkTasks(tenant.workspaceId, taskIds);
    const pairs = dto.taskIds.map((relatedTaskId) => canonicalRelatedPair(taskId, relatedTaskId));
    const result = await this.prisma.$transaction(async (tx) => {
      await this.assertBulkTasks(tenant.workspaceId, taskIds, tx);
      const removed = await tx.taskRelatedTask.deleteMany({
        where: {
          workspaceId: tenant.workspaceId,
          OR: pairs.map((pair) => ({ taskAId: pair.taskAId, taskBId: pair.taskBId })),
        },
      });
      if (removed.count > 0) {
        await tx.auditLog.create({
          data: {
            agencyId: tenant.agencyId,
            workspaceId: tenant.workspaceId,
            userId: tenant.userId,
            action: 'task.related_removed',
            entityType: 'Task',
            entityId: taskId,
            metadata: {
              taskId,
              requestedCount: dto.taskIds.length,
              changedCount: removed.count,
              unchangedCount: dto.taskIds.length - removed.count,
              taskIds: dto.taskIds,
            },
          },
        });
      }
      return bulkResult(dto.taskIds.length, removed.count);
    });
    return result;
  }

  async createComment(tenant: WorkspaceTenantContext, taskId: string, dto: CreateTaskCommentDto) {
    return this.createTaskComment(tenant, taskId, null, dto, 'task.comment_created');
  }

  async createCommentReply(
    tenant: WorkspaceTenantContext,
    taskId: string,
    parentCommentId: string,
    dto: CreateTaskCommentDto,
  ) {
    return this.createTaskComment(tenant, taskId, parentCommentId, dto, 'task.comment_replied');
  }

  async listComments(tenant: WorkspaceTenantContext, taskId: string, query: TaskQueryDto) {
    await this.assertTask(tenant.workspaceId, taskId);
    return this.listCommentPage(tenant, taskId, null, query);
  }

  async listCommentReplies(
    tenant: WorkspaceTenantContext,
    taskId: string,
    parentCommentId: string,
    query: TaskQueryDto,
  ) {
    await this.assertVisibleComment(tenant, taskId, parentCommentId);
    return this.listCommentPage(tenant, taskId, parentCommentId, query);
  }

  async updateComment(
    tenant: WorkspaceTenantContext,
    taskId: string,
    commentId: string,
    dto: UpdateTaskCommentDto,
  ) {
    const comment = await this.assertVisibleComment(tenant, taskId, commentId, true);
    this.assertCanChangeComment(
      tenant,
      comment.authorMembershipId,
      PermissionKeys.taskCommentsUpdateOwn,
    );
    const body = normalizeCommentBody(dto.body);
    if (body === comment.body) return this.serializeCommentById(tenant, taskId, commentId);
    const updated = await this.prisma.taskComment.update({
      where: { id: commentId },
      data: { body, editedAt: new Date() },
      select: taskCommentSelect,
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'task.comment_updated',
      entityType: 'TaskComment',
      entityId: commentId,
      metadata: { taskId, visibility: comment.visibility },
    });
    return this.enrichAndSerializeComments(tenant, taskId, [updated]).then((items) => items[0]);
  }

  async deleteComment(tenant: WorkspaceTenantContext, taskId: string, commentId: string) {
    const comment = await this.assertVisibleComment(tenant, taskId, commentId, true);
    this.assertCanChangeComment(
      tenant,
      comment.authorMembershipId,
      PermissionKeys.taskCommentsDeleteOwn,
    );
    const deleted = await this.prisma
      .$transaction(async (tx) => {
        await this.lockCommentForWrite(tenant, taskId, commentId, tx);
        const deletedComment = await tx.taskComment.update({
          where: { id: commentId },
          data: { deletedAt: new Date() },
          select: taskCommentSelect,
        });
        await tx.auditLog.create({
          data: {
            agencyId: tenant.agencyId,
            workspaceId: tenant.workspaceId,
            userId: tenant.userId,
            action: 'task.comment_deleted',
            entityType: 'TaskComment',
            entityId: commentId,
            metadata: { taskId, visibility: comment.visibility },
          },
        });
        return deletedComment;
      }, serializableTransaction)
      .catch(mapHierarchyWriteError);
    return this.enrichAndSerializeComments(tenant, taskId, [deleted]).then((items) => items[0]);
  }

  async addCommentReaction(
    tenant: WorkspaceTenantContext,
    taskId: string,
    commentId: string,
    dto: TaskCommentReactionDto,
  ) {
    const membershipId = this.requireWorkspaceMembership(tenant);
    await this.assertVisibleComment(tenant, taskId, commentId, true);
    const created = await this.prisma.taskCommentReaction.createMany({
      data: {
        workspaceId: tenant.workspaceId,
        commentId,
        membershipId,
        reactionType: dto.reactionType,
      },
      skipDuplicates: true,
    });
    if (created.count > 0) {
      await this.audit.record({
        agencyId: tenant.agencyId,
        workspaceId: tenant.workspaceId,
        userId: tenant.userId,
        action: 'task.comment_reaction_added',
        entityType: 'TaskComment',
        entityId: commentId,
        metadata: { taskId, reactionType: dto.reactionType },
      });
    }
    return { changed: created.count > 0, reactionType: dto.reactionType };
  }

  async removeCommentReaction(
    tenant: WorkspaceTenantContext,
    taskId: string,
    commentId: string,
    dto: TaskCommentReactionDto,
  ) {
    const membershipId = this.requireWorkspaceMembership(tenant);
    await this.assertVisibleComment(tenant, taskId, commentId);
    const removed = await this.prisma.taskCommentReaction.deleteMany({
      where: {
        workspaceId: tenant.workspaceId,
        commentId,
        membershipId,
        reactionType: dto.reactionType,
      },
    });
    if (removed.count > 0) {
      await this.audit.record({
        agencyId: tenant.agencyId,
        workspaceId: tenant.workspaceId,
        userId: tenant.userId,
        action: 'task.comment_reaction_removed',
        entityType: 'TaskComment',
        entityId: commentId,
        metadata: { taskId, reactionType: dto.reactionType },
      });
    }
    return { changed: removed.count > 0, reactionType: dto.reactionType };
  }

  async update(tenant: WorkspaceTenantContext, taskId: string, dto: UpdateTaskDto) {
    const existing = await this.assertTask(tenant.workspaceId, taskId);
    const changedFields = Object.entries(dto)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key);
    if (
      changedFields.length === 1 &&
      dto.statusDefinitionId &&
      dto.statusDefinitionId === existing.statusDefinitionId
    ) {
      return serializeTaskDetail(await this.findTask(tenant.workspaceId, taskId));
    }
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
    const task = await this.prisma
      .$transaction(async (tx) => {
        if (status && status.id !== existing.statusDefinitionId) {
          await this.assertStatusTransition(tenant.workspaceId, [taskId], status.isTerminal, tx);
        }
        return tx.task.update({
          where: { id: taskId },
          data,
          select: taskDetailSelect,
        });
      }, serializableTransaction)
      .catch(mapHierarchyWriteError);
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
      metadata: { changed: changedFields },
    });
    return serializeTaskDetail(task);
  }

  async updateStatus(tenant: WorkspaceTenantContext, taskId: string, statusDefinitionId: string) {
    const existing = await this.assertTask(tenant.workspaceId, taskId);
    if (existing.statusDefinitionId === statusDefinitionId) {
      return serializeTaskDetail(await this.findTask(tenant.workspaceId, taskId));
    }
    const status = await this.taskStatus(tenant.workspaceId, statusDefinitionId);
    const task = await this.prisma
      .$transaction(async (tx) => {
        await this.assertStatusTransition(tenant.workspaceId, [taskId], status.isTerminal, tx);
        return tx.task.update({
          where: { id: taskId },
          data: { statusDefinitionId: status.id, updatedById: tenant.userId },
          select: taskDetailSelect,
        });
      }, serializableTransaction)
      .catch(mapHierarchyWriteError);
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
    const task = await this.prisma
      .$transaction(async (tx) => {
        const update = await tx.task.updateMany({
          where: { id: taskId, workspaceId: tenant.workspaceId, deletedAt: null },
          data: { deletedAt: new Date(), updatedById: tenant.userId },
        });
        if (update.count !== 1) throw new NotFoundException('Task not found.');
        const detach = await tx.task.updateMany({
          where: { parentTaskId: taskId, workspaceId: tenant.workspaceId, deletedAt: null },
          data: { parentTaskId: null, updatedById: tenant.userId },
        });
        const deletedTask = await tx.task.findFirstOrThrow({
          where: { id: taskId, workspaceId: tenant.workspaceId },
          select: taskDetailSelect,
        });
        await tx.auditLog.create({
          data: {
            agencyId: tenant.agencyId,
            workspaceId: tenant.workspaceId,
            userId: tenant.userId,
            action: 'task.deleted',
            entityType: 'Task',
            entityId: taskId,
            metadata: { detachedChildCount: detach.count },
          },
        });
        return deletedTask;
      }, serializableTransaction)
      .catch(mapHierarchyWriteError);
    return serializeTaskDetail(task);
  }

  private async createTaskComment(
    tenant: WorkspaceTenantContext,
    taskId: string,
    parentCommentId: string | null,
    dto: CreateTaskCommentDto,
    action: 'task.comment_created' | 'task.comment_replied',
  ) {
    const authorMembershipId = this.requireWorkspaceMembership(tenant);
    const body = normalizeCommentBody(dto.body);
    const visibility = dto.visibility ?? TaskCommentVisibility.NORMAL;
    if (visibility === TaskCommentVisibility.INTERNAL)
      this.assertPermission(tenant, PermissionKeys.taskCommentsInternal);
    const mentionedMembershipIds = await this.activeMembershipIds(
      tenant.workspaceId,
      uniqueIds(dto.mentionedMembershipIds ?? []),
    );
    const commentId = await this.prisma
      .$transaction(async (tx) => {
        await this.assertTask(tenant.workspaceId, taskId, tx);
        if (parentCommentId) {
          const parent = await this.lockCommentForWrite(tenant, taskId, parentCommentId, tx);
          if (parent.visibility === TaskCommentVisibility.INTERNAL) {
            this.assertPermission(tenant, PermissionKeys.taskCommentsInternal);
          }
        }
        const created = await tx.taskComment.create({
          data: {
            workspaceId: tenant.workspaceId,
            taskId,
            parentCommentId,
            authorMembershipId,
            authorUserId: tenant.userId,
            body,
            visibility,
          },
          select: taskCommentSelect,
        });
        if (mentionedMembershipIds.length > 0) {
          await tx.taskCommentMention.createMany({
            data: mentionedMembershipIds.map((membershipId) => ({
              workspaceId: tenant.workspaceId,
              commentId: created.id,
              membershipId,
            })),
          });
        }
        await tx.auditLog.create({
          data: {
            agencyId: tenant.agencyId,
            workspaceId: tenant.workspaceId,
            userId: tenant.userId,
            action,
            entityType: 'TaskComment',
            entityId: created.id,
            metadata: {
              taskId,
              parentCommentId,
              visibility,
              mentionCount: mentionedMembershipIds.length,
              mentionedMembershipIds,
            },
          },
        });
        return created.id;
      }, serializableTransaction)
      .catch(mapHierarchyWriteError);
    return this.serializeCommentById(tenant, taskId, commentId);
  }

  private async listCommentPage(
    tenant: WorkspaceTenantContext,
    taskId: string,
    parentCommentId: string | null,
    query: TaskQueryDto,
  ) {
    const where = this.visibleCommentWhere(tenant, taskId, { parentCommentId });
    const [items, total] = await this.prisma.$transaction([
      this.prisma.taskComment.findMany({
        where,
        select: taskCommentSelect,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.taskComment.count({ where }),
    ]);
    return {
      items: await this.enrichAndSerializeComments(tenant, taskId, items),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  private async serializeCommentById(
    tenant: WorkspaceTenantContext,
    taskId: string,
    commentId: string,
  ) {
    const comment = await this.prisma.taskComment.findFirst({
      where: this.visibleCommentWhere(tenant, taskId, { id: commentId }),
      select: taskCommentSelect,
    });
    if (!comment) throw new NotFoundException('Comment not found.');
    const [serialized] = await this.enrichAndSerializeComments(tenant, taskId, [comment]);
    return serialized;
  }

  private async enrichAndSerializeComments(
    tenant: WorkspaceTenantContext,
    taskId: string,
    comments: TaskCommentRecord[],
  ) {
    if (comments.length === 0) return [];
    const ids = comments.map((comment) => comment.id);
    const visibleReplyWhere = this.visibleCommentWhere(tenant, taskId, {
      parentCommentId: { in: ids },
    });
    const [visibleReplies, reactions, currentReactions] = await this.prisma.$transaction([
      this.prisma.taskComment.findMany({
        where: visibleReplyWhere,
        select: { parentCommentId: true },
      }),
      this.prisma.taskCommentReaction.findMany({
        where: { workspaceId: tenant.workspaceId, commentId: { in: ids } },
        select: { commentId: true, reactionType: true },
      }),
      tenant.workspaceMembershipId
        ? this.prisma.taskCommentReaction.findMany({
            where: {
              workspaceId: tenant.workspaceId,
              commentId: { in: ids },
              membershipId: tenant.workspaceMembershipId,
            },
            select: { commentId: true, reactionType: true },
          })
        : this.prisma.taskCommentReaction.findMany({
            where: { workspaceId: tenant.workspaceId, commentId: { in: [] } },
            select: { commentId: true, reactionType: true },
          }),
    ]);
    const replyCountByParent = new Map<string, number>();
    for (const reply of visibleReplies) {
      if (!reply.parentCommentId) continue;
      replyCountByParent.set(
        reply.parentCommentId,
        (replyCountByParent.get(reply.parentCommentId) ?? 0) + 1,
      );
    }
    const reactionCountsByComment = new Map<string, Record<TaskCommentReactionType, number>>();
    for (const reaction of reactions) {
      const counts = reactionCountsByComment.get(reaction.commentId) ?? emptyReactionCounts();
      counts[reaction.reactionType] += 1;
      reactionCountsByComment.set(reaction.commentId, counts);
    }
    const currentReactionsByComment = new Map<string, TaskCommentReactionType[]>();
    for (const reaction of currentReactions) {
      const list = currentReactionsByComment.get(reaction.commentId) ?? [];
      list.push(reaction.reactionType);
      currentReactionsByComment.set(reaction.commentId, list);
    }
    return comments.map((comment) =>
      serializeTaskComment(comment, {
        directReplyCount: replyCountByParent.get(comment.id) ?? 0,
        reactionCounts: reactionCountsByComment.get(comment.id) ?? emptyReactionCounts(),
        currentUserReactions: currentReactionsByComment.get(comment.id) ?? [],
      }),
    );
  }

  private visibleCommentWhere(
    tenant: WorkspaceTenantContext,
    taskId: string,
    extra: Prisma.TaskCommentWhereInput = {},
  ): Prisma.TaskCommentWhereInput {
    return {
      workspaceId: tenant.workspaceId,
      taskId,
      ...extra,
      ...(this.canSeeInternal(tenant) ? {} : { visibility: TaskCommentVisibility.NORMAL }),
    };
  }

  private async assertVisibleComment(
    tenant: WorkspaceTenantContext,
    taskId: string,
    commentId: string,
    requireNotDeleted = false,
  ) {
    await this.assertTask(tenant.workspaceId, taskId);
    const comment = await this.prisma.taskComment.findFirst({
      where: this.visibleCommentWhere(tenant, taskId, {
        id: commentId,
        ...(requireNotDeleted ? { deletedAt: null } : {}),
      }),
      select: {
        id: true,
        body: true,
        authorMembershipId: true,
        visibility: true,
        deletedAt: true,
      },
    });
    if (!comment) throw new NotFoundException('Comment not found.');
    return comment;
  }

  private async lockCommentForWrite(
    tenant: WorkspaceTenantContext,
    taskId: string,
    commentId: string,
    tx: Prisma.TransactionClient,
  ) {
    const internalFilter = this.canSeeInternal(tenant)
      ? Prisma.empty
      : Prisma.sql`AND visibility = 'NORMAL'::"TaskCommentVisibility"`;
    const [comment] = await tx.$queryRaw<Array<{ id: string; visibility: TaskCommentVisibility }>>`
      SELECT id, visibility
      FROM task_comments
      WHERE workspace_id = ${tenant.workspaceId}::uuid
        AND task_id = ${taskId}::uuid
        AND id = ${commentId}::uuid
        AND deleted_at IS NULL
        ${internalFilter}
      FOR UPDATE
    `;
    if (!comment) throw new NotFoundException('Comment not found.');
    return comment;
  }

  private assertCanChangeComment(
    tenant: WorkspaceTenantContext,
    authorMembershipId: string,
    ownPermission: string,
  ) {
    if (this.hasPermission(tenant, PermissionKeys.taskCommentsModerate)) return;
    if (
      tenant.workspaceMembershipId === authorMembershipId &&
      this.hasPermission(tenant, ownPermission)
    ) {
      return;
    }
    throw new ForbiddenException('Insufficient comment permissions.');
  }

  private requireWorkspaceMembership(tenant: WorkspaceTenantContext) {
    if (!tenant.workspaceMembershipId) {
      throw new ForbiddenException('Workspace membership is required for task comments.');
    }
    return tenant.workspaceMembershipId;
  }

  private assertPermission(tenant: WorkspaceTenantContext, permission: string) {
    if (!this.hasPermission(tenant, permission))
      throw new ForbiddenException('Insufficient permissions.');
  }

  private hasPermission(tenant: WorkspaceTenantContext, permission: string) {
    return tenant.permissions.includes('*') || tenant.permissions.includes(permission);
  }

  private canSeeInternal(tenant: WorkspaceTenantContext) {
    return this.hasPermission(tenant, PermissionKeys.taskCommentsInternal);
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

  private async assertTask(
    workspaceId: string,
    taskId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    const task = await tx.task.findFirst({
      where: { id: taskId, workspaceId, deletedAt: null },
      select: {
        id: true,
        parentTaskId: true,
        statusDefinitionId: true,
        statusDefinition: { select: { isTerminal: true } },
      },
    });
    if (!task) throw new NotFoundException('Task not found.');
    return task;
  }

  private async assertBulkTasks(
    workspaceId: string,
    taskIds: string[],
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    const tasks = await tx.task.findMany({
      where: { id: { in: taskIds }, workspaceId, deletedAt: null },
      select: {
        id: true,
        parentTaskId: true,
        statusDefinitionId: true,
        priority: true,
        statusDefinition: { select: { isTerminal: true } },
      },
    });
    if (tasks.length !== taskIds.length) {
      throw new NotFoundException('One or more tasks were not found.');
    }
    return tasks;
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
      select: { id: true, isTerminal: true },
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

  private async assertCanAttachToParent(
    workspaceId: string,
    parentTaskId: string,
    childStatusIsTerminal: boolean,
    tx: Prisma.TransactionClient,
  ) {
    const parent = await this.assertTask(workspaceId, parentTaskId, tx);
    if (parent.statusDefinition.isTerminal && !childStatusIsTerminal) {
      throw new ConflictException(
        'Terminal parent tasks cannot contain active non-terminal subtasks.',
      );
    }
  }

  private async assertCanReparent(
    workspaceId: string,
    taskId: string,
    parentTaskId: string,
    tx: Prisma.TransactionClient,
  ) {
    const parent = await this.assertTask(workspaceId, parentTaskId, tx);
    const descendants = await descendantTaskIds(tx, workspaceId, [taskId], true);
    if (descendants.includes(parentTaskId)) {
      throw new ConflictException('Task hierarchy cycles are not allowed.');
    }
    if (parent.statusDefinition.isTerminal) {
      const hasOpenMovedWork = await subtreeHasNonTerminalTask(tx, workspaceId, taskId);
      if (hasOpenMovedWork) {
        throw new ConflictException(
          'Terminal parent tasks cannot contain active non-terminal subtasks.',
        );
      }
    }
  }

  private async assertStatusTransition(
    workspaceId: string,
    taskIds: string[],
    targetIsTerminal: boolean,
    tx: Prisma.TransactionClient,
  ) {
    await this.assertBulkStatusTransition(workspaceId, taskIds, targetIsTerminal, tx);
  }

  private async assertBulkStatusTransition(
    workspaceId: string,
    taskIds: string[],
    targetIsTerminal: boolean,
    tx: Prisma.TransactionClient,
  ) {
    const selectedIds = [...new Set(taskIds)];
    if (targetIsTerminal) {
      const blocking = await nonTerminalDescendantsOutsideSelection(tx, workspaceId, selectedIds);
      if (blocking.length > 0) {
        throw new ConflictException(
          'Parent tasks cannot become terminal while active descendants remain non-terminal.',
        );
      }
      const dependencyBlocking = await nonTerminalBlockersOutsideSelection(
        tx,
        workspaceId,
        selectedIds,
      );
      if (dependencyBlocking.length > 0) {
        throw new ConflictException(
          'Blocked tasks cannot become terminal while active blockers remain non-terminal.',
        );
      }
      return;
    }
    const blocking = await terminalAncestorsOutsideSelection(tx, workspaceId, selectedIds);
    if (blocking.length > 0) {
      throw new ConflictException(
        'A task cannot become non-terminal while an active ancestor remains terminal.',
      );
    }
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
  parentTaskId: true,
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

const taskRelationshipSelect = {
  id: true,
  title: true,
  priority: true,
  dueAt: true,
  statusDefinition: {
    select: { id: true, name: true, color: true, category: true, isTerminal: true },
  },
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
    take: 3,
  },
} satisfies Prisma.TaskSelect;

const taskDetailSelect = {
  id: true,
  workspaceId: true,
  parentTaskId: true,
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
  parentTask: {
    select: {
      id: true,
      title: true,
      deletedAt: true,
      statusDefinition: {
        select: { id: true, name: true, color: true, category: true, isTerminal: true },
      },
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
  _count: {
    select: {
      subtasks: { where: { deletedAt: null } },
      blockedByDependencies: {
        where: { blockerTask: { deletedAt: null }, blockedTask: { deletedAt: null } },
      },
      blockingDependencies: {
        where: { blockerTask: { deletedAt: null }, blockedTask: { deletedAt: null } },
      },
      relatedTaskALinks: { where: { taskA: { deletedAt: null }, taskB: { deletedAt: null } } },
      relatedTaskBLinks: { where: { taskA: { deletedAt: null }, taskB: { deletedAt: null } } },
    },
  },
} satisfies Prisma.TaskSelect;

const taskCommentSelect = {
  id: true,
  workspaceId: true,
  taskId: true,
  parentCommentId: true,
  body: true,
  visibility: true,
  editedAt: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  authorMembership: {
    select: {
      id: true,
      user: { select: { id: true, email: true, name: true } },
    },
  },
  mentions: {
    select: {
      membership: {
        select: {
          id: true,
          user: { select: { id: true, email: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
    take: 100,
  },
} satisfies Prisma.TaskCommentSelect;

type TaskListRecord = Prisma.TaskGetPayload<{ select: typeof taskListSelect }>;
type TaskRelationshipRecord = Prisma.TaskGetPayload<{ select: typeof taskRelationshipSelect }>;
type TaskDetailRecord = Prisma.TaskGetPayload<{ select: typeof taskDetailSelect }>;
type TaskCommentRecord = Prisma.TaskCommentGetPayload<{ select: typeof taskCommentSelect }>;

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
    parent:
      task.parentTask && !task.parentTask.deletedAt
        ? {
            id: task.parentTask.id,
            title: task.parentTask.title,
            status: task.parentTask.statusDefinition,
            statusDefinition: undefined,
          }
        : null,
    directSubtaskCount: task._count.subtasks,
    blockedByCount: task._count.blockedByDependencies,
    blocksCount: task._count.blockingDependencies,
    relatedTaskCount: task._count.relatedTaskALinks + task._count.relatedTaskBLinks,
    statusDefinition: undefined,
    parentTask: undefined,
    _count: undefined,
  };
}

function serializeTaskRelationship(task: TaskRelationshipRecord) {
  return {
    ...task,
    status: task.statusDefinition,
    assignees: task.assignees.map((item) => item.membership),
    statusDefinition: undefined,
  };
}

function paginatedRelationship(
  items: TaskRelationshipRecord[],
  query: TaskQueryDto,
  total: number,
) {
  return {
    items: items.map(serializeTaskRelationship),
    page: query.page,
    pageSize: query.pageSize,
    total,
  };
}

function serializeTaskComment(
  comment: TaskCommentRecord,
  summary: {
    directReplyCount: number;
    reactionCounts: Record<TaskCommentReactionType, number>;
    currentUserReactions: TaskCommentReactionType[];
  },
) {
  const deleted = Boolean(comment.deletedAt);
  return {
    id: comment.id,
    workspaceId: comment.workspaceId,
    taskId: comment.taskId,
    parentCommentId: comment.parentCommentId,
    body: deleted ? null : comment.body,
    visibility: comment.visibility,
    deleted,
    editedAt: deleted ? null : comment.editedAt,
    deletedAt: comment.deletedAt,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    author: {
      membershipId: comment.authorMembership.id,
      userId: comment.authorMembership.user.id,
      name: comment.authorMembership.user.name,
      email: comment.authorMembership.user.email,
    },
    mentions: deleted
      ? []
      : comment.mentions.map((mention) => ({
          membershipId: mention.membership.id,
          userId: mention.membership.user.id,
          name: mention.membership.user.name,
          email: mention.membership.user.email,
        })),
    directReplyCount: summary.directReplyCount,
    reactionCounts: summary.reactionCounts,
    currentUserReactions: summary.currentUserReactions,
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

function relationKey(taskId: string, membershipId: string) {
  return `${taskId}:${membershipId}`;
}

function uniqueIds(ids: string[]) {
  return [...new Set(ids)];
}

function emptyReactionCounts(): Record<TaskCommentReactionType, number> {
  return {
    LIKE: 0,
    LOVE: 0,
    CELEBRATE: 0,
    EYES: 0,
    CHECK: 0,
  };
}

function normalizeCommentBody(body: string) {
  const normalized = body.trim();
  if (!normalized) throw new BadRequestException('Comment body is required.');
  return normalized;
}

function canonicalRelatedPair(taskId: string, relatedTaskId: string) {
  return taskId < relatedTaskId
    ? { taskAId: taskId, taskBId: relatedTaskId }
    : { taskAId: relatedTaskId, taskBId: taskId };
}

const serializableTransaction = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
};

function mapHierarchyWriteError(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2034' || error.meta?.code === '40001')
  ) {
    throw new ConflictException('Task relationship changed concurrently. Retry the request.');
  }
  throw error;
}

function uuidValues(ids: string[]) {
  return Prisma.join(ids.map((id) => Prisma.sql`(${id}::uuid)`));
}

async function descendantTaskIds(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  rootIds: string[],
  includeSelf = false,
) {
  if (rootIds.length === 0) return [];
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    WITH RECURSIVE roots(id) AS (
      VALUES ${uuidValues(rootIds)}
    ),
    descendants(id, path) AS (
      ${
        includeSelf
          ? Prisma.sql`
            SELECT t.id, ARRAY[t.id]
            FROM tasks t
            JOIN roots r ON r.id = t.id
            WHERE t.workspace_id = ${workspaceId}::uuid
              AND t.deleted_at IS NULL
          `
          : Prisma.sql`
            SELECT child.id, ARRAY[child.id]
            FROM tasks child
            JOIN roots r ON child.parent_task_id = r.id
            WHERE child.workspace_id = ${workspaceId}::uuid
              AND child.deleted_at IS NULL
          `
      }
      UNION ALL
      SELECT child.id, descendants.path || child.id
      FROM tasks child
      JOIN descendants ON child.parent_task_id = descendants.id
      WHERE child.workspace_id = ${workspaceId}::uuid
        AND child.deleted_at IS NULL
        AND NOT child.id = ANY(descendants.path)
    )
    SELECT id FROM descendants
  `);
  return rows.map((row) => row.id);
}

async function nonTerminalDescendantsOutsideSelection(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  selectedIds: string[],
) {
  if (selectedIds.length === 0) return [];
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    WITH RECURSIVE selected(id) AS (
      VALUES ${uuidValues(selectedIds)}
    ),
    descendants(id, path) AS (
      SELECT child.id, ARRAY[child.id]
      FROM tasks child
      JOIN selected ON child.parent_task_id = selected.id
      WHERE child.workspace_id = ${workspaceId}::uuid
        AND child.deleted_at IS NULL
      UNION ALL
      SELECT child.id, descendants.path || child.id
      FROM tasks child
      JOIN descendants ON child.parent_task_id = descendants.id
      WHERE child.workspace_id = ${workspaceId}::uuid
        AND child.deleted_at IS NULL
        AND NOT child.id = ANY(descendants.path)
    )
    SELECT d.id
    FROM descendants d
    JOIN tasks t ON t.id = d.id AND t.workspace_id = ${workspaceId}::uuid
    JOIN status_definitions s
      ON s.id = t.status_definition_id
      AND s.workspace_id = t.workspace_id
      AND s.entity_type = 'TASK'::"StatusEntityType"
    WHERE s.is_terminal = false
      AND NOT EXISTS (SELECT 1 FROM selected WHERE selected.id = d.id)
    LIMIT 1
  `);
  return rows.map((row) => row.id);
}

async function terminalAncestorsOutsideSelection(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  selectedIds: string[],
) {
  if (selectedIds.length === 0) return [];
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    WITH RECURSIVE selected(id) AS (
      VALUES ${uuidValues(selectedIds)}
    ),
    ancestors(id, parent_task_id, path) AS (
      SELECT parent.id, parent.parent_task_id, ARRAY[parent.id]
      FROM tasks child
      JOIN selected ON selected.id = child.id
      JOIN tasks parent
        ON parent.id = child.parent_task_id
        AND parent.workspace_id = child.workspace_id
        AND parent.deleted_at IS NULL
      WHERE child.workspace_id = ${workspaceId}::uuid
        AND child.deleted_at IS NULL
      UNION ALL
      SELECT parent.id, parent.parent_task_id, ancestors.path || parent.id
      FROM tasks parent
      JOIN ancestors
        ON parent.id = ancestors.parent_task_id
        AND parent.workspace_id = ${workspaceId}::uuid
        AND parent.deleted_at IS NULL
      WHERE NOT parent.id = ANY(ancestors.path)
    )
    SELECT a.id
    FROM ancestors a
    JOIN tasks t ON t.id = a.id AND t.workspace_id = ${workspaceId}::uuid
    JOIN status_definitions s
      ON s.id = t.status_definition_id
      AND s.workspace_id = t.workspace_id
      AND s.entity_type = 'TASK'::"StatusEntityType"
    WHERE s.is_terminal = true
      AND NOT EXISTS (SELECT 1 FROM selected WHERE selected.id = a.id)
    LIMIT 1
  `);
  return rows.map((row) => row.id);
}

async function subtreeHasNonTerminalTask(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  taskId: string,
) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    WITH RECURSIVE subtree(id, path) AS (
      SELECT t.id, ARRAY[t.id]
      FROM tasks t
      WHERE t.id = ${taskId}::uuid
        AND t.workspace_id = ${workspaceId}::uuid
        AND t.deleted_at IS NULL
      UNION ALL
      SELECT child.id, subtree.path || child.id
      FROM tasks child
      JOIN subtree ON child.parent_task_id = subtree.id
      WHERE child.workspace_id = ${workspaceId}::uuid
        AND child.deleted_at IS NULL
        AND NOT child.id = ANY(subtree.path)
    )
    SELECT subtree.id
    FROM subtree
    JOIN tasks t ON t.id = subtree.id AND t.workspace_id = ${workspaceId}::uuid
    JOIN status_definitions s
      ON s.id = t.status_definition_id
      AND s.workspace_id = t.workspace_id
      AND s.entity_type = 'TASK'::"StatusEntityType"
    WHERE s.is_terminal = false
    LIMIT 1
  `);
  return rows.length > 0;
}

async function nonTerminalBlockersOutsideSelection(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  selectedIds: string[],
) {
  if (selectedIds.length === 0) return [];
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    WITH selected(id) AS (
      VALUES ${uuidValues(selectedIds)}
    )
    SELECT blocker.id
    FROM task_dependencies dependency
    JOIN selected ON selected.id = dependency.blocked_task_id
    JOIN tasks blocked
      ON blocked.id = dependency.blocked_task_id
      AND blocked.workspace_id = ${workspaceId}::uuid
      AND blocked.deleted_at IS NULL
    JOIN tasks blocker
      ON blocker.id = dependency.blocker_task_id
      AND blocker.workspace_id = ${workspaceId}::uuid
      AND blocker.deleted_at IS NULL
    JOIN status_definitions status
      ON status.id = blocker.status_definition_id
      AND status.workspace_id = blocker.workspace_id
      AND status.entity_type = 'TASK'::"StatusEntityType"
    WHERE dependency.workspace_id = ${workspaceId}::uuid
      AND status.is_terminal = false
      AND NOT EXISTS (SELECT 1 FROM selected WHERE selected.id = blocker.id)
    LIMIT 1
  `);
  return rows.map((row) => row.id);
}

async function assertDependencyGraphAcyclic(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  newEdges: { blockerTaskId: string; blockedTaskId: string }[],
) {
  if (newEdges.length === 0) return;
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    WITH RECURSIVE new_edges(blocker_task_id, blocked_task_id) AS (
      VALUES ${Prisma.join(
        newEdges.map(
          (edge) => Prisma.sql`(${edge.blockerTaskId}::uuid, ${edge.blockedTaskId}::uuid)`,
        ),
      )}
    ),
    active_edges(blocker_task_id, blocked_task_id) AS (
      SELECT dependency.blocker_task_id, dependency.blocked_task_id
      FROM task_dependencies dependency
      JOIN tasks blocker
        ON blocker.id = dependency.blocker_task_id
        AND blocker.workspace_id = ${workspaceId}::uuid
        AND blocker.deleted_at IS NULL
      JOIN tasks blocked
        ON blocked.id = dependency.blocked_task_id
        AND blocked.workspace_id = ${workspaceId}::uuid
        AND blocked.deleted_at IS NULL
      WHERE dependency.workspace_id = ${workspaceId}::uuid
      UNION
      SELECT blocker_task_id, blocked_task_id FROM new_edges
    ),
    paths(start_id, current_id, path, cycle) AS (
      SELECT blocker_task_id, blocked_task_id, ARRAY[blocker_task_id, blocked_task_id], blocker_task_id = blocked_task_id
      FROM active_edges
      UNION ALL
      SELECT paths.start_id, edge.blocked_task_id, paths.path || edge.blocked_task_id, edge.blocked_task_id = ANY(paths.path)
      FROM paths
      JOIN active_edges edge ON edge.blocker_task_id = paths.current_id
      WHERE paths.cycle = false
    )
    SELECT current_id AS id
    FROM paths
    WHERE cycle = true
    LIMIT 1
  `);
  if (rows.length > 0) {
    throw new ConflictException('Task dependency cycles are not allowed.');
  }
}

async function insertTaskAssigneeRows(
  tx: Prisma.TransactionClient,
  rows: { taskId: string; workspaceId: string; membershipId: string }[],
) {
  if (rows.length === 0) return [];
  return tx.$queryRaw<Array<{ taskId: string; membershipId: string }>>(Prisma.sql`
    INSERT INTO task_assignees (task_id, workspace_id, membership_id)
    VALUES ${Prisma.join(
      rows.map(
        (row) =>
          Prisma.sql`(${row.taskId}::uuid, ${row.workspaceId}::uuid, ${row.membershipId}::uuid)`,
      ),
    )}
    ON CONFLICT (task_id, membership_id) DO NOTHING
    RETURNING task_id AS "taskId", membership_id AS "membershipId"
  `);
}

function bulkResult(requestedCount: number, changedCount: number) {
  return {
    requestedCount,
    changedCount,
    unchangedCount: requestedCount - changedCount,
  };
}

function bulkRelationResult(
  requestedCount: number,
  changedCount: number,
  relationChangedCount: number,
  relationUnchangedCount: number,
) {
  return {
    ...bulkResult(requestedCount, changedCount),
    relationChangedCount,
    relationUnchangedCount,
  };
}
