import { Injectable } from '@nestjs/common';
import { Prisma, TaskPriority } from '@prisma/client';
import type { AgencyTenantContext, SuperAgencyTenantContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  ParentProjectOversightQueryDto,
  ParentTaskOversightQueryDto,
  ParentTicketOversightQueryDto,
} from './dto/parent-oversight.dto';

type ParentScope =
  { kind: 'AGENCY'; agencyId: string } | { kind: 'SUPER_AGENCY'; superAgencyId: string };

@Injectable()
export class ParentOversightService {
  constructor(private readonly prisma: PrismaService) {}

  listAgencyTasks(tenant: AgencyTenantContext, query: ParentTaskOversightQueryDto) {
    return this.listTasks({ kind: 'AGENCY', agencyId: tenant.agencyId }, query);
  }

  listSuperAgencyTasks(tenant: SuperAgencyTenantContext, query: ParentTaskOversightQueryDto) {
    return this.listTasks({ kind: 'SUPER_AGENCY', superAgencyId: tenant.superAgencyId }, query);
  }

  listAgencyProjects(tenant: AgencyTenantContext, query: ParentProjectOversightQueryDto) {
    return this.listProjects({ kind: 'AGENCY', agencyId: tenant.agencyId }, query);
  }

  listSuperAgencyProjects(tenant: SuperAgencyTenantContext, query: ParentProjectOversightQueryDto) {
    return this.listProjects({ kind: 'SUPER_AGENCY', superAgencyId: tenant.superAgencyId }, query);
  }

  listAgencyTickets(tenant: AgencyTenantContext, query: ParentTicketOversightQueryDto) {
    return this.listTickets({ kind: 'AGENCY', agencyId: tenant.agencyId }, query);
  }

  listSuperAgencyTickets(tenant: SuperAgencyTenantContext, query: ParentTicketOversightQueryDto) {
    return this.listTickets({ kind: 'SUPER_AGENCY', superAgencyId: tenant.superAgencyId }, query);
  }

  private async listTasks(scope: ParentScope, query: ParentTaskOversightQueryDto) {
    const page = normalizePage(query.page);
    const pageSize = normalizePageSize(query.pageSize);
    const where = taskWhere(scope, query);
    const [items, total, statusGroups, priorityGroups] = await this.prisma.$transaction([
      this.prisma.task.findMany({
        where,
        select: parentTaskSelect,
        orderBy: taskOrderBy(query),
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.task.count({ where }),
      this.prisma.task.groupBy({
        by: ['statusDefinitionId'],
        where,
        orderBy: { statusDefinitionId: 'asc' },
        _count: { _all: true },
      }),
      this.prisma.task.groupBy({
        by: ['priority'],
        where,
        orderBy: { priority: 'asc' },
        _count: { _all: true },
      }),
    ]);
    return {
      items: items.map(toParentTaskDto),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      counts: {
        byStatus: await this.statusCounts(statusGroups),
        byPriority: priorityCounts(priorityGroups),
      },
    };
  }

  private async listProjects(scope: ParentScope, query: ParentProjectOversightQueryDto) {
    const page = normalizePage(query.page);
    const pageSize = normalizePageSize(query.pageSize);
    const where = projectWhere(scope, query);
    const [items, total, statusGroups, priorityGroups] = await this.prisma.$transaction([
      this.prisma.project.findMany({
        where,
        select: parentProjectSelect,
        orderBy: projectOrderBy(query),
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.project.count({ where }),
      this.prisma.project.groupBy({
        by: ['statusDefinitionId'],
        where,
        orderBy: { statusDefinitionId: 'asc' },
        _count: { _all: true },
      }),
      this.prisma.project.groupBy({
        by: ['priority'],
        where,
        orderBy: { priority: 'asc' },
        _count: { _all: true },
      }),
    ]);
    return {
      items: items.map(toParentProjectDto),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      counts: {
        byStatus: await this.statusCounts(statusGroups),
        byPriority: priorityCounts(priorityGroups),
      },
    };
  }

  private async listTickets(scope: ParentScope, query: ParentTicketOversightQueryDto) {
    const page = normalizePage(query.page);
    const pageSize = normalizePageSize(query.pageSize);
    const where = ticketWhere(scope, query);
    const [items, total, statusGroups, priorityGroups] = await this.prisma.$transaction([
      this.prisma.ticket.findMany({
        where,
        select: parentTicketSelect,
        orderBy: ticketOrderBy(query),
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.ticket.count({ where }),
      this.prisma.ticket.groupBy({
        by: ['statusDefinitionId'],
        where,
        orderBy: { statusDefinitionId: 'asc' },
        _count: { _all: true },
      }),
      this.prisma.ticket.groupBy({
        by: ['priority'],
        where,
        orderBy: { priority: 'asc' },
        _count: { _all: true },
      }),
    ]);
    return {
      items: items.map(toParentTicketDto),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      counts: {
        byStatus: await this.statusCounts(statusGroups),
        byPriority: priorityCounts(priorityGroups),
      },
    };
  }

  private async statusCounts(
    groups: Array<{ statusDefinitionId: string | null; _count?: CountAggregate }>,
  ) {
    const statusIds = groups
      .map((group) => group.statusDefinitionId)
      .filter((id): id is string => Boolean(id));
    const statuses = statusIds.length
      ? await this.prisma.statusDefinition.findMany({
          where: { id: { in: statusIds } },
          select: { id: true, name: true, color: true, entityType: true, isTerminal: true },
        })
      : [];
    const statusMap = new Map(statuses.map((status) => [status.id, status]));
    return groups.map((group) => ({
      statusDefinitionId: group.statusDefinitionId,
      status: group.statusDefinitionId ? (statusMap.get(group.statusDefinitionId) ?? null) : null,
      count: countAll(group),
    }));
  }
}

const parentWorkspaceSelect = {
  id: true,
  name: true,
  slug: true,
  agencyId: true,
  agency: { select: { id: true, name: true, slug: true, superAgencyId: true } },
} satisfies Prisma.WorkspaceSelect;

const safeMembershipSelect = {
  id: true,
  user: { select: { id: true, name: true } },
} satisfies Prisma.WorkspaceMembershipSelect;

const parentStatusSelect = {
  id: true,
  name: true,
  color: true,
  entityType: true,
  isTerminal: true,
} satisfies Prisma.StatusDefinitionSelect;

const parentTaskSelect = {
  id: true,
  workspaceId: true,
  title: true,
  priority: true,
  statusDefinitionId: true,
  plannedStartAt: true,
  dueAt: true,
  createdAt: true,
  updatedAt: true,
  workspace: { select: parentWorkspaceSelect },
  statusDefinition: { select: parentStatusSelect },
  assignees: {
    select: { membership: { select: safeMembershipSelect } },
    orderBy: { createdAt: 'asc' },
    take: 5,
  },
} satisfies Prisma.TaskSelect;

const parentProjectSelect = {
  id: true,
  workspaceId: true,
  name: true,
  status: true,
  priority: true,
  statusDefinitionId: true,
  manualProgressPercent: true,
  plannedStartAt: true,
  dueAt: true,
  createdAt: true,
  updatedAt: true,
  workspace: { select: parentWorkspaceSelect },
  statusDefinition: { select: parentStatusSelect },
  ownerMembership: { select: safeMembershipSelect },
  _count: { select: { members: true } },
} satisfies Prisma.ProjectSelect;

const parentTicketSelect = {
  id: true,
  workspaceId: true,
  ticketNumber: true,
  subject: true,
  priority: true,
  statusDefinitionId: true,
  escalationLevel: true,
  createdAt: true,
  updatedAt: true,
  workspace: { select: parentWorkspaceSelect },
  statusDefinition: { select: parentStatusSelect },
  assignedToMembership: { select: safeMembershipSelect },
  slaState: {
    select: {
      firstResponseDueAt: true,
      firstResponseCompletedAt: true,
      firstResponseBreachedAt: true,
      resolutionDueAt: true,
      resolutionCompletedAt: true,
      resolutionBreachedAt: true,
    },
  },
} satisfies Prisma.TicketSelect;

type ParentTaskRecord = Prisma.TaskGetPayload<{ select: typeof parentTaskSelect }>;
type ParentProjectRecord = Prisma.ProjectGetPayload<{ select: typeof parentProjectSelect }>;
type ParentTicketRecord = Prisma.TicketGetPayload<{ select: typeof parentTicketSelect }>;
type CountAggregate = true | { _all?: number | null } | undefined;

const EMPTY_WORKSPACE_ID = '00000000-0000-4000-8000-000000000000';

function taskWhere(scope: ParentScope, query: ParentTaskOversightQueryDto): Prisma.TaskWhereInput {
  return {
    ...baseTaskProjectWhere(scope, query),
    deletedAt: null,
    ...(query.dueFrom || query.dueTo ? { dueAt: dateRange(query.dueFrom, query.dueTo) } : {}),
    ...(query.assigneeMembershipId
      ? {
          assignees: {
            some: {
              membershipId: query.assigneeMembershipId,
              workspace: workspaceFence(scope, query),
            },
          },
        }
      : {}),
    ...(query.search
      ? {
          title: {
            contains: query.search.trim(),
            mode: Prisma.QueryMode.insensitive,
          },
        }
      : {}),
  };
}

function projectWhere(
  scope: ParentScope,
  query: ParentProjectOversightQueryDto,
): Prisma.ProjectWhereInput {
  return {
    ...baseTaskProjectWhere(scope, query),
    archivedAt: null,
    ...(query.plannedFrom || query.plannedTo
      ? { plannedStartAt: dateRange(query.plannedFrom, query.plannedTo) }
      : {}),
    ...(query.dueFrom || query.dueTo ? { dueAt: dateRange(query.dueFrom, query.dueTo) } : {}),
    ...(query.ownerMembershipId ? { ownerMembershipId: query.ownerMembershipId } : {}),
    ...(query.search
      ? {
          name: {
            contains: query.search.trim(),
            mode: Prisma.QueryMode.insensitive,
          },
        }
      : {}),
  };
}

function ticketWhere(
  scope: ParentScope,
  query: ParentTicketOversightQueryDto,
): Prisma.TicketWhereInput {
  return {
    workspace: workspaceFence(scope, query),
    deletedAt: null,
    ...(query.statusDefinitionId ? { statusDefinitionId: query.statusDefinitionId } : {}),
    ...(query.priority ? { priority: query.priority } : {}),
    ...(query.departmentId ? { departmentId: query.departmentId } : {}),
    ...(query.createdFrom || query.createdTo
      ? { createdAt: dateRange(query.createdFrom, query.createdTo) }
      : {}),
    ...(query.updatedFrom || query.updatedTo
      ? { updatedAt: dateRange(query.updatedFrom, query.updatedTo) }
      : {}),
    ...(query.assignedToMembershipId
      ? { assignedToMembershipId: query.assignedToMembershipId }
      : {}),
    ...(query.slaDueFrom || query.slaDueTo
      ? {
          slaState: {
            OR: [
              { firstResponseDueAt: dateRange(query.slaDueFrom, query.slaDueTo) },
              { resolutionDueAt: dateRange(query.slaDueFrom, query.slaDueTo) },
            ],
          },
        }
      : {}),
    ...(query.search
      ? {
          OR: [
            {
              subject: {
                contains: query.search.trim(),
                mode: Prisma.QueryMode.insensitive,
              },
            },
            {
              ticketNumber: {
                contains: query.search.trim(),
                mode: Prisma.QueryMode.insensitive,
              },
            },
          ],
        }
      : {}),
  };
}

function baseTaskProjectWhere(
  scope: ParentScope,
  query: ParentTaskOversightQueryDto | ParentProjectOversightQueryDto,
) {
  return {
    workspace: workspaceFence(scope, query),
    ...(query.statusDefinitionId ? { statusDefinitionId: query.statusDefinitionId } : {}),
    ...(query.priority ? { priority: query.priority } : {}),
    ...(query.departmentId ? { departmentId: query.departmentId } : {}),
    ...(query.createdFrom || query.createdTo
      ? { createdAt: dateRange(query.createdFrom, query.createdTo) }
      : {}),
    ...(query.updatedFrom || query.updatedTo
      ? { updatedAt: dateRange(query.updatedFrom, query.updatedTo) }
      : {}),
  };
}

function workspaceFence(scope: ParentScope, query: { agencyId?: string; workspaceId?: string }) {
  return {
    ...(query.workspaceId ? { id: query.workspaceId } : {}),
    ...(scope.kind === 'AGENCY'
      ? {
          agencyId: scope.agencyId,
          ...(query.agencyId && query.agencyId !== scope.agencyId
            ? { id: EMPTY_WORKSPACE_ID }
            : {}),
        }
      : {
          ...(query.agencyId ? { agencyId: query.agencyId } : {}),
          agency: { superAgencyId: scope.superAgencyId },
        }),
  };
}

function taskOrderBy(query: ParentTaskOversightQueryDto): Prisma.TaskOrderByWithRelationInput[] {
  return [{ [query.sortBy]: query.sortDirection }, { id: 'asc' }];
}

function projectOrderBy(
  query: ParentProjectOversightQueryDto,
): Prisma.ProjectOrderByWithRelationInput[] {
  return [{ [query.sortBy]: query.sortDirection }, { id: 'asc' }];
}

function ticketOrderBy(
  query: ParentTicketOversightQueryDto,
): Prisma.TicketOrderByWithRelationInput[] {
  return [{ [query.sortBy]: query.sortDirection }, { id: 'asc' }];
}

function normalizePage(page: number | undefined) {
  return Math.max(1, page ?? 1);
}

function normalizePageSize(pageSize: number | undefined) {
  return Math.min(Math.max(1, pageSize ?? 25), 100);
}

function dateRange(from?: string, to?: string) {
  return {
    ...(from ? { gte: new Date(from) } : {}),
    ...(to ? { lte: new Date(to) } : {}),
  };
}

function toParentTaskDto(task: ParentTaskRecord) {
  return {
    id: task.id,
    title: task.title,
    priority: task.priority,
    statusDefinitionId: task.statusDefinitionId,
    status: task.statusDefinition,
    plannedStartAt: task.plannedStartAt,
    dueAt: task.dueAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    workspace: task.workspace,
    agency: task.workspace.agency,
    assignees: task.assignees.map((assignee) => assignee.membership),
  };
}

function toParentProjectDto(project: ParentProjectRecord) {
  return {
    id: project.id,
    name: project.name,
    status: project.status,
    statusDefinitionId: project.statusDefinitionId,
    statusDefinition: project.statusDefinition,
    priority: project.priority,
    manualProgressPercent: project.manualProgressPercent,
    plannedStartAt: project.plannedStartAt,
    dueAt: project.dueAt,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    workspace: project.workspace,
    agency: project.workspace.agency,
    owner: project.ownerMembership,
    memberCount: project._count.members,
  };
}

function toParentTicketDto(ticket: ParentTicketRecord) {
  return {
    id: ticket.id,
    ticketNumber: ticket.ticketNumber,
    subject: ticket.subject,
    priority: ticket.priority,
    statusDefinitionId: ticket.statusDefinitionId,
    status: ticket.statusDefinition,
    escalationLevel: ticket.escalationLevel,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    workspace: ticket.workspace,
    agency: ticket.workspace.agency,
    assignedTo: ticket.assignedToMembership,
    sla: ticket.slaState,
  };
}

function priorityCounts(groups: Array<{ priority: TaskPriority; _count?: CountAggregate }>) {
  const counts = new Map(groups.map((group) => [group.priority, countAll(group)]));
  return Object.values(TaskPriority).map((priority) => ({
    priority,
    count: counts.get(priority) ?? 0,
  }));
}

function countAll(group: { _count?: CountAggregate }) {
  return typeof group._count === 'object' ? (group._count._all ?? 0) : 0;
}
