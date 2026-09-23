import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { AutomationActionType, AutomationDomainEventEntityType } from '@prisma/client';
import type { WorkspaceTenantContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { ProjectsService } from '../projects/projects.service';
import { TasksService } from '../tasks/tasks.service';
import { TicketsService } from '../tickets/tickets.service';
import { AUTOMATION_MAX_FUTURE_DEPTH } from './automation.constants';
import { validateAutomationActionConfig } from './automation-graph.validator';
import type {
  AutomationActionExecutionContext,
  AutomationActionResult,
  AutomationMutationContext,
} from './automation-action.types';

type ActionConfig = Record<string, unknown> & { actionType: AutomationActionType };

@Injectable()
export class AutomationActionService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly tasks?: TasksService,
    @Optional() private readonly projects?: ProjectsService,
    @Optional() private readonly tickets?: TicketsService,
    @Optional() private readonly moduleRef?: ModuleRef,
  ) {}

  async executeAction(
    tenant: WorkspaceTenantContext,
    context: AutomationActionExecutionContext,
    rawConfig: Record<string, unknown>,
  ): Promise<AutomationActionResult> {
    if (tenant.workspaceId !== context.workspaceId) {
      throw new ForbiddenException('AUTOMATION_WORKSPACE_MISMATCH');
    }
    const config = validateAutomationActionConfig(rawConfig);
    assertNoUnresolvedVariables(config);
    const mutation = normalizeMutationContext(context);

    switch (config.actionType) {
      case AutomationActionType.CREATE_TASK:
        return this.createTask(tenant, config, mutation);
      case AutomationActionType.UPDATE_TASK:
        return this.updateTask(tenant, config, mutation);
      case AutomationActionType.ASSIGN_TASK:
        return this.assignTask(tenant, config, mutation);
      case AutomationActionType.CHANGE_TASK_STATUS:
        return this.changeTaskStatus(tenant, config, mutation);
      case AutomationActionType.ADD_TASK_TAG:
        return this.addTaskTag(tenant, config, mutation);
      case AutomationActionType.UPDATE_PROJECT:
        return this.updateProject(tenant, config, mutation);
      case AutomationActionType.CHANGE_PROJECT_STATUS:
        return this.changeProjectStatus(tenant, config, mutation);
      case AutomationActionType.ASSIGN_TICKET:
        return this.assignTicket(tenant, config, mutation);
      case AutomationActionType.CHANGE_TICKET_STATUS:
        return this.changeTicketStatus(tenant, config, mutation);
      case AutomationActionType.ADD_TICKET_TAG:
        throw new BadRequestException('AUTOMATION_ACTION_UNSUPPORTED_CANONICAL_SERVICE');
      default:
        throw new BadRequestException('AUTOMATION_ACTION_UNSUPPORTED');
    }
  }

  private async createTask(
    tenant: WorkspaceTenantContext,
    config: ActionConfig,
    mutation: AutomationMutationContext,
  ) {
    const tasks = this.requireTasks();
    const task = await tasks.create(
      tenant,
      compact({
        title: asString(config.title),
        description: optionalString(config.description),
        priority: optionalString(config.priority),
        statusDefinitionId: optionalString(config.statusDefinitionId),
        departmentId: optionalString(config.departmentId),
        assigneeMembershipIds: optionalStringArray(config.assigneeMembershipIds),
        plannedStartAt: optionalString(config.plannedStartAt),
        dueAt: optionalString(config.dueAt),
        tagIds: optionalStringArray(config.tagIds),
      }) as never,
      mutation,
    );
    return result(config.actionType, AutomationDomainEventEntityType.TASK, entityId(task), true);
  }

  private async updateTask(
    tenant: WorkspaceTenantContext,
    config: ActionConfig,
    mutation: AutomationMutationContext,
  ) {
    const tasks = this.requireTasks();
    await this.assertTask(tenant.workspaceId, asString(config.taskId));
    const task = await tasks.update(
      tenant,
      asString(config.taskId),
      compact({
        title: optionalString(config.title),
        description: optionalString(config.description),
        priority: optionalString(config.priority),
        departmentId: optionalString(config.departmentId),
        plannedStartAt: optionalString(config.plannedStartAt),
        dueAt: optionalString(config.dueAt),
      }) as never,
      mutation,
    );
    return result(config.actionType, AutomationDomainEventEntityType.TASK, entityId(task), true);
  }

  private async assignTask(
    tenant: WorkspaceTenantContext,
    config: ActionConfig,
    mutation: AutomationMutationContext,
  ) {
    const taskId = asString(config.taskId);
    const membershipIds = uniqueStrings(config.membershipIds);
    await this.assertTask(tenant.workspaceId, taskId);
    const current = await this.prisma.taskAssignee.findMany({
      where: { workspaceId: tenant.workspaceId, taskId },
      select: { membershipId: true },
      orderBy: { membershipId: 'asc' },
    });
    if (
      sameSet(
        current.map((item) => item.membershipId),
        membershipIds,
      )
    ) {
      return result(config.actionType, AutomationDomainEventEntityType.TASK, taskId, false);
    }
    const task = await this.requireTasks().replaceAssignees(
      tenant,
      taskId,
      { membershipIds },
      mutation,
    );
    return result(config.actionType, AutomationDomainEventEntityType.TASK, entityId(task), true);
  }

  private async changeTaskStatus(
    tenant: WorkspaceTenantContext,
    config: ActionConfig,
    mutation: AutomationMutationContext,
  ) {
    const taskId = asString(config.taskId);
    const task = await this.assertTask(tenant.workspaceId, taskId);
    const statusDefinitionId = asString(config.statusDefinitionId);
    if (task.statusDefinitionId === statusDefinitionId) {
      return result(config.actionType, AutomationDomainEventEntityType.TASK, taskId, false);
    }
    const updated = await this.requireTasks().updateStatus(
      tenant,
      taskId,
      statusDefinitionId,
      undefined,
      optionalString(config.reopenDueAt),
      mutation,
    );
    return result(config.actionType, AutomationDomainEventEntityType.TASK, entityId(updated), true);
  }

  private async addTaskTag(
    tenant: WorkspaceTenantContext,
    config: ActionConfig,
    mutation: AutomationMutationContext,
  ) {
    const taskId = asString(config.taskId);
    const tagIds = uniqueStrings(config.tagIds);
    await this.assertTask(tenant.workspaceId, taskId);
    const existingCount = await this.prisma.taskTag.count({
      where: { workspaceId: tenant.workspaceId, taskId, tagId: { in: tagIds } },
    });
    if (existingCount === tagIds.length) {
      return result(config.actionType, AutomationDomainEventEntityType.TASK, taskId, false);
    }
    const task = await this.requireTasks().addTaskTags(tenant, taskId, { tagIds }, mutation);
    return result(config.actionType, AutomationDomainEventEntityType.TASK, entityId(task), true);
  }

  private async updateProject(
    tenant: WorkspaceTenantContext,
    config: ActionConfig,
    mutation: AutomationMutationContext,
  ) {
    const projectId = asString(config.projectId);
    await this.assertProject(tenant.workspaceId, projectId);
    const project = await this.requireProjects().update(
      tenant,
      projectId,
      compact({
        name: optionalString(config.name),
        description: optionalString(config.description),
        priority: optionalString(config.priority),
        xpCategory: optionalString(config.xpCategory),
        plannedStartAt: optionalString(config.plannedStartAt),
        dueAt: optionalString(config.dueAt),
        departmentId: optionalString(config.departmentId),
        visibility: optionalString(config.visibility),
      }) as never,
      mutation,
    );
    return result(
      config.actionType,
      AutomationDomainEventEntityType.PROJECT,
      entityId(project),
      true,
    );
  }

  private async changeProjectStatus(
    tenant: WorkspaceTenantContext,
    config: ActionConfig,
    mutation: AutomationMutationContext,
  ) {
    const projectId = asString(config.projectId);
    const project = await this.assertProject(tenant.workspaceId, projectId);
    const statusDefinitionId = asString(config.statusDefinitionId);
    if (project.statusDefinitionId === statusDefinitionId) {
      return result(config.actionType, AutomationDomainEventEntityType.PROJECT, projectId, false);
    }
    const updated = await this.requireProjects().updateStatus(
      tenant,
      projectId,
      statusDefinitionId,
      optionalString(config.dueAt),
      mutation,
    );
    return result(
      config.actionType,
      AutomationDomainEventEntityType.PROJECT,
      entityId(updated),
      true,
    );
  }

  private async assignTicket(
    tenant: WorkspaceTenantContext,
    config: ActionConfig,
    mutation: AutomationMutationContext,
  ) {
    const ticketId = asString(config.ticketId);
    const ticket = await this.assertTicket(tenant.workspaceId, ticketId);
    const departmentId = nullableString(config.departmentId);
    const assignedToMembershipId = nullableString(config.assignedToMembershipId);
    if (
      ticket.departmentId === departmentId &&
      ticket.assignedToMembershipId === assignedToMembershipId
    ) {
      return result(config.actionType, AutomationDomainEventEntityType.TICKET, ticketId, false);
    }
    const updated = await this.requireTickets().updateAssignment(
      tenant,
      ticketId,
      { departmentId, assignedToMembershipId },
      mutation,
    );
    return result(
      config.actionType,
      AutomationDomainEventEntityType.TICKET,
      entityId(updated),
      true,
    );
  }

  private async changeTicketStatus(
    tenant: WorkspaceTenantContext,
    config: ActionConfig,
    mutation: AutomationMutationContext,
  ) {
    const ticketId = asString(config.ticketId);
    const ticket = await this.assertTicket(tenant.workspaceId, ticketId);
    const statusDefinitionId = asString(config.statusDefinitionId);
    if (ticket.statusDefinitionId === statusDefinitionId) {
      return result(config.actionType, AutomationDomainEventEntityType.TICKET, ticketId, false);
    }
    const updated = await this.requireTickets().updateStatus(
      tenant,
      ticketId,
      statusDefinitionId,
      optionalString(config.gamificationResolutionTargetAt),
      mutation,
    );
    return result(
      config.actionType,
      AutomationDomainEventEntityType.TICKET,
      entityId(updated),
      true,
    );
  }

  private requireTasks() {
    const service = this.tasks ?? this.moduleRef?.get(TasksService, { strict: false });
    if (!service) throw new ServiceUnavailableException('AUTOMATION_TASK_ACTIONS_UNAVAILABLE');
    return service;
  }

  private requireProjects() {
    const service = this.projects ?? this.moduleRef?.get(ProjectsService, { strict: false });
    if (!service) throw new ServiceUnavailableException('AUTOMATION_PROJECT_ACTIONS_UNAVAILABLE');
    return service;
  }

  private requireTickets() {
    const service = this.tickets ?? this.moduleRef?.get(TicketsService, { strict: false });
    if (!service) throw new ServiceUnavailableException('AUTOMATION_TICKET_ACTIONS_UNAVAILABLE');
    return service;
  }

  private async assertTask(workspaceId: string, taskId: string) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, workspaceId, deletedAt: null },
      select: { id: true, statusDefinitionId: true },
    });
    if (!task) throw new BadRequestException('AUTOMATION_TARGET_NOT_FOUND');
    return task;
  }

  private async assertProject(workspaceId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId },
      select: { id: true, statusDefinitionId: true },
    });
    if (!project) throw new BadRequestException('AUTOMATION_TARGET_NOT_FOUND');
    return project;
  }

  private async assertTicket(workspaceId: string, ticketId: string) {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id: ticketId, workspaceId, deletedAt: null },
      select: {
        id: true,
        statusDefinitionId: true,
        departmentId: true,
        assignedToMembershipId: true,
      },
    });
    if (!ticket) throw new BadRequestException('AUTOMATION_TARGET_NOT_FOUND');
    return ticket;
  }
}

function normalizeMutationContext(
  context: AutomationActionExecutionContext,
): AutomationMutationContext {
  const parentAutomationDepth = context.mutation.parentAutomationDepth ?? 0;
  if (parentAutomationDepth + 1 > AUTOMATION_MAX_FUTURE_DEPTH) {
    throw new BadRequestException('AUTOMATION_MAX_DEPTH_EXCEEDED');
  }
  return {
    ...context.mutation,
    actionNodeId: context.actionNodeId,
    parentAutomationDepth,
  };
}

function assertNoUnresolvedVariables(value: unknown, path = 'action.config') {
  if (typeof value === 'string' && value.includes('{{')) {
    throw new BadRequestException({
      code: 'AUTOMATION_UNRESOLVED_VARIABLE',
      message: `${path} contains an unresolved automation variable.`,
    });
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoUnresolvedVariables(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assertNoUnresolvedVariables(child, `${path}.${key}`);
  }
}

function result(
  actionType: AutomationActionType,
  entityType: AutomationDomainEventEntityType,
  entityId: string,
  changed: boolean,
): AutomationActionResult {
  return {
    actionType,
    status: changed ? 'SUCCEEDED' : 'NO_OP',
    entityType,
    entityId,
    changed,
    generatedDomainEventIds: [],
  };
}

function compact<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter((entry) => entry[1] !== undefined));
}

function asString(value: unknown) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BadRequestException('AUTOMATION_ACTION_CONFIG_INVALID');
  }
  return value.trim();
}

function optionalString(value: unknown) {
  return value === undefined || value === null ? undefined : asString(value);
}

function nullableString(value: unknown) {
  return value === undefined ? null : value === null ? null : asString(value);
}

function optionalStringArray(value: unknown) {
  if (value === undefined || value === null) return undefined;
  return uniqueStrings(value);
}

function uniqueStrings(value: unknown) {
  if (!Array.isArray(value)) throw new BadRequestException('AUTOMATION_ACTION_CONFIG_INVALID');
  return [...new Set(value.map((item) => asString(item)))];
}

function sameSet(a: string[], b: string[]) {
  return a.length === b.length && a.every((item) => b.includes(item));
}

function entityId(value: unknown) {
  if (!value || typeof value !== 'object' || typeof (value as { id?: unknown }).id !== 'string') {
    throw new BadRequestException('AUTOMATION_ACTION_RESULT_INVALID');
  }
  return (value as { id: string }).id;
}
