import type { PageResult } from './workspace-management';
import type { WorkspaceProjectSummary } from './workspace-projects';
import type { WorkspaceTask } from './workspace-tasks';
import type { TicketQueueSummary, WorkspaceTicketSummary } from './workspace-tickets';

export const OFFLINE_SCHEMA_VERSION = 1;
export const OFFLINE_DATABASE_NAME = 'zea-play-offline';
export const OFFLINE_RECORD_STORE = 'records';

export type OfflineScopeType = 'SUPER_AGENCY' | 'AGENCY' | 'WORKSPACE';
export type OfflineResourceType =
  | 'workspace-task-list'
  | 'workspace-task-detail'
  | 'workspace-task-calendar'
  | 'workspace-project-list'
  | 'workspace-project-detail'
  | 'workspace-ticket-list'
  | 'workspace-ticket-detail'
  | 'workspace-ticket-queue-summary';

export interface OfflinePolicy {
  resourceType: OfflineResourceType;
  scopeType: OfflineScopeType;
  ttlMs: number;
  maxStaleMs: number;
  maxRecords: number;
  detailCaching: boolean;
  displayStale: boolean;
  sensitivity: 'LOW' | 'MEDIUM' | 'HIGH';
  allowedFields: readonly string[];
}

export interface OfflineContext {
  userId: string;
  scopeType: OfflineScopeType;
  scopeId: string;
  accessTokenPresent: boolean;
  tenantStatus?: string | null;
}

export const offlinePolicies: Record<OfflineResourceType, OfflinePolicy> = {
  'workspace-task-list': {
    resourceType: 'workspace-task-list',
    scopeType: 'WORKSPACE',
    ttlMs: 30 * 60_000,
    maxStaleMs: 2 * 60 * 60_000,
    maxRecords: 12,
    detailCaching: false,
    displayStale: true,
    sensitivity: 'MEDIUM',
    allowedFields: [
      'id',
      'workspaceId',
      'parentTaskId',
      'title',
      'priority',
      'kanbanRank',
      'status',
      'department',
      'plannedStartAt',
      'dueAt',
      'assignees',
      'projects',
      'counts',
      'directSubtaskCount',
      'blockedByCount',
      'blocksCount',
      'relatedTaskCount',
      'completion',
      'createdAt',
      'updatedAt',
    ],
  },
  'workspace-task-detail': {
    resourceType: 'workspace-task-detail',
    scopeType: 'WORKSPACE',
    ttlMs: 30 * 60_000,
    maxStaleMs: 2 * 60 * 60_000,
    maxRecords: 60,
    detailCaching: true,
    displayStale: true,
    sensitivity: 'MEDIUM',
    allowedFields: [
      'id',
      'workspaceId',
      'parentTaskId',
      'title',
      'priority',
      'status',
      'department',
      'plannedStartAt',
      'dueAt',
      'estimatedMinutes',
      'assignees',
      'projects',
      'counts',
      'directSubtaskCount',
      'blockedByCount',
      'blocksCount',
      'relatedTaskCount',
      'completion',
      'createdAt',
      'updatedAt',
    ],
  },
  'workspace-task-calendar': {
    resourceType: 'workspace-task-calendar',
    scopeType: 'WORKSPACE',
    ttlMs: 15 * 60_000,
    maxStaleMs: 60 * 60_000,
    maxRecords: 4,
    detailCaching: false,
    displayStale: true,
    sensitivity: 'MEDIUM',
    allowedFields: ['view', 'window', 'days', 'page', 'pageSize', 'total'],
  },
  'workspace-project-list': {
    resourceType: 'workspace-project-list',
    scopeType: 'WORKSPACE',
    ttlMs: 45 * 60_000,
    maxStaleMs: 2 * 60 * 60_000,
    maxRecords: 12,
    detailCaching: false,
    displayStale: true,
    sensitivity: 'MEDIUM',
    allowedFields: [
      'id',
      'workspaceId',
      'name',
      'statusDefinitionId',
      'status',
      'priority',
      'xpCategory',
      'visibility',
      'calculatedProgress',
      'manualProgressPercent',
      'manualProgressUpdatedAt',
      'effectiveProgress',
      'taskCounts',
      'plannedStartAt',
      'dueAt',
      'departmentId',
      'department',
      'ownerMembershipId',
      'owner',
      'memberCount',
      'createdAt',
      'updatedAt',
    ],
  },
  'workspace-project-detail': {
    resourceType: 'workspace-project-detail',
    scopeType: 'WORKSPACE',
    ttlMs: 45 * 60_000,
    maxStaleMs: 2 * 60 * 60_000,
    maxRecords: 60,
    detailCaching: true,
    displayStale: true,
    sensitivity: 'MEDIUM',
    allowedFields: [
      'id',
      'workspaceId',
      'name',
      'statusDefinitionId',
      'status',
      'priority',
      'xpCategory',
      'visibility',
      'calculatedProgress',
      'manualProgressPercent',
      'manualProgressUpdatedAt',
      'effectiveProgress',
      'taskCounts',
      'plannedStartAt',
      'dueAt',
      'departmentId',
      'department',
      'ownerMembershipId',
      'owner',
      'memberCount',
      'createdAt',
      'updatedAt',
    ],
  },
  'workspace-ticket-list': {
    resourceType: 'workspace-ticket-list',
    scopeType: 'WORKSPACE',
    ttlMs: 20 * 60_000,
    maxStaleMs: 60 * 60_000,
    maxRecords: 8,
    detailCaching: false,
    displayStale: true,
    sensitivity: 'HIGH',
    allowedFields: [
      'id',
      'workspaceId',
      'sequenceNumber',
      'ticketNumber',
      'subject',
      'statusDefinitionId',
      'status',
      'priority',
      'departmentId',
      'department',
      'assignedToMembershipId',
      'assignedTo',
      'escalationLevel',
      'createdAt',
      'updatedAt',
      'sla',
    ],
  },
  'workspace-ticket-detail': {
    resourceType: 'workspace-ticket-detail',
    scopeType: 'WORKSPACE',
    ttlMs: 20 * 60_000,
    maxStaleMs: 60 * 60_000,
    maxRecords: 40,
    detailCaching: true,
    displayStale: true,
    sensitivity: 'HIGH',
    allowedFields: [
      'id',
      'workspaceId',
      'sequenceNumber',
      'ticketNumber',
      'subject',
      'statusDefinitionId',
      'status',
      'priority',
      'departmentId',
      'department',
      'assignedToMembershipId',
      'assignedTo',
      'escalationLevel',
      'createdAt',
      'updatedAt',
      'sla',
    ],
  },
  'workspace-ticket-queue-summary': {
    resourceType: 'workspace-ticket-queue-summary',
    scopeType: 'WORKSPACE',
    ttlMs: 10 * 60_000,
    maxStaleMs: 30 * 60_000,
    maxRecords: 3,
    detailCaching: false,
    displayStale: true,
    sensitivity: 'HIGH',
    allowedFields: [
      'ALL_VISIBLE',
      'MY_ASSIGNED',
      'MY_REQUESTED',
      'MY_DEPARTMENT',
      'UNASSIGNED_MY_DEPARTMENT',
      'SLA_BREACHED',
    ],
  },
};

export function sanitizeOfflineData(resourceType: OfflineResourceType, data: unknown): unknown {
  if (resourceType === 'workspace-task-list') {
    return sanitizePage(data, sanitizeTask);
  }
  if (resourceType === 'workspace-task-detail') {
    return sanitizeTask(data as WorkspaceTask);
  }
  if (resourceType === 'workspace-task-calendar') {
    return sanitizeCalendar(data);
  }
  if (resourceType === 'workspace-project-list') {
    return sanitizePage(data, sanitizeProject);
  }
  if (resourceType === 'workspace-project-detail') {
    return sanitizeProject(data as WorkspaceProjectSummary);
  }
  if (resourceType === 'workspace-ticket-list') {
    return sanitizePage(data, sanitizeTicket);
  }
  if (resourceType === 'workspace-ticket-detail') {
    return sanitizeTicket(data as WorkspaceTicketSummary);
  }
  if (resourceType === 'workspace-ticket-queue-summary') {
    return sanitizeQueueSummary(data as TicketQueueSummary);
  }
  const exhaustive: never = resourceType;
  void exhaustive;
  throw new Error('Offline cache sanitizer missing');
}

export function stableOfflineQueryKey(value: unknown) {
  return JSON.stringify(sortJson(value));
}

export function isTenantStatusCacheAllowed(status: string | null | undefined) {
  return !status || ['ACTIVE', 'TRIALING'].includes(status);
}

function sanitizePage<T>(data: unknown, sanitizeItem: (item: T) => T) {
  const page = data as PageResult<T>;
  return {
    items: Array.isArray(page.items) ? page.items.map((item) => sanitizeItem(item)) : [],
    page: numberOr(page.page, 1),
    pageSize: numberOr(page.pageSize, 0),
    total: numberOr(page.total, 0),
  };
}

function sanitizeTask(task: WorkspaceTask): WorkspaceTask {
  return {
    id: task.id,
    workspaceId: task.workspaceId,
    parentTaskId: task.parentTaskId ?? null,
    title: task.title,
    priority: task.priority,
    kanbanRank: task.kanbanRank ?? null,
    status: sanitizeStatus(task.status),
    department: task.department ? sanitizeDepartment(task.department) : null,
    plannedStartAt: task.plannedStartAt ?? null,
    dueAt: task.dueAt ?? null,
    estimatedMinutes: task.estimatedMinutes ?? null,
    assignees: sanitizeMemberships(task.assignees ?? []),
    projects: (task.projects ?? []).map((project) => ({
      id: project.id,
      workspaceId: project.workspaceId,
      name: project.name,
      description: null,
      status:
        typeof project.status === 'object' && project.status
          ? sanitizeStatus(project.status)
          : null,
      createdById: '',
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    })),
    counts: task.counts,
    directSubtaskCount: task.directSubtaskCount,
    blockedByCount: task.blockedByCount,
    blocksCount: task.blocksCount,
    relatedTaskCount: task.relatedTaskCount,
    completion: task.completion,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

function sanitizeProject(project: WorkspaceProjectSummary): WorkspaceProjectSummary {
  return {
    id: project.id,
    workspaceId: project.workspaceId,
    name: project.name,
    description: null,
    statusDefinitionId: project.statusDefinitionId,
    status: project.status ? sanitizeStatus(project.status) : null,
    priority: project.priority,
    xpCategory: project.xpCategory,
    visibility: project.visibility,
    calculatedProgress: project.calculatedProgress,
    manualProgressPercent: project.manualProgressPercent,
    manualProgressUpdatedAt: project.manualProgressUpdatedAt,
    effectiveProgress: project.effectiveProgress,
    taskCounts: {
      totalTasks: project.taskCounts?.totalTasks ?? 0,
      openTasks: project.taskCounts?.openTasks ?? 0,
      completedTasks: project.taskCounts?.completedTasks ?? 0,
      overdueTasks: project.taskCounts?.overdueTasks ?? 0,
    },
    plannedStartAt: project.plannedStartAt,
    dueAt: project.dueAt,
    departmentId: project.departmentId,
    department: project.department ? sanitizeDepartment(project.department) : null,
    ownerMembershipId: project.ownerMembershipId,
    owner: sanitizeProjectMembership(project.owner),
    memberCount: project.memberCount,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

function sanitizeTicket(ticket: WorkspaceTicketSummary): WorkspaceTicketSummary {
  return {
    id: ticket.id,
    workspaceId: ticket.workspaceId,
    sequenceNumber: ticket.sequenceNumber,
    ticketNumber: ticket.ticketNumber,
    subject: ticket.subject,
    statusDefinitionId: ticket.statusDefinitionId,
    status: sanitizeStatus(ticket.status),
    priority: ticket.priority,
    requester: null,
    departmentId: ticket.departmentId,
    department: ticket.department ? sanitizeDepartment(ticket.department) : null,
    assignedToMembershipId: ticket.assignedToMembershipId,
    assignedTo: ticket.assignedTo ? sanitizeTicketMembership(ticket.assignedTo) : null,
    escalationLevel: ticket.escalationLevel,
    createdBy: null,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    sla: ticket.sla
      ? {
          firstResponse: {
            state: ticket.sla.firstResponse.state,
            dueAt: ticket.sla.firstResponse.dueAt,
          },
          resolution: {
            state: ticket.sla.resolution.state,
            dueAt: ticket.sla.resolution.dueAt,
          },
        }
      : undefined,
  };
}

function sanitizeCalendar(data: unknown) {
  const value = data as {
    view?: 'MONTH' | 'WEEK' | 'DAY';
    window?: unknown;
    days?: Array<{ tasks?: WorkspaceTask[] } & Record<string, unknown>>;
    page?: number;
    pageSize?: number;
    total?: number;
  };
  return {
    view: value.view ?? 'MONTH',
    window: jsonClone(value.window ?? {}),
    days: (value.days ?? []).map((day) => ({
      ...jsonClone(day),
      tasks: (day.tasks ?? []).map((task) => sanitizeTask(task)),
    })),
    page: numberOr(value.page, 1),
    pageSize: numberOr(value.pageSize, 0),
    total: numberOr(value.total, 0),
  };
}

function sanitizeQueueSummary(summary: TicketQueueSummary): TicketQueueSummary {
  return {
    ALL_VISIBLE: numberOr(summary.ALL_VISIBLE, 0),
    MY_ASSIGNED: numberOr(summary.MY_ASSIGNED, 0),
    MY_REQUESTED: numberOr(summary.MY_REQUESTED, 0),
    MY_DEPARTMENT: numberOr(summary.MY_DEPARTMENT, 0),
    UNASSIGNED_MY_DEPARTMENT: numberOr(summary.UNASSIGNED_MY_DEPARTMENT, 0),
    SLA_BREACHED: numberOr(summary.SLA_BREACHED, 0),
  };
}

function sanitizeStatus<T extends { id: string; name: string; color: string }>(status: T): T {
  return {
    ...status,
    id: status.id,
    name: status.name,
    color: /^#[0-9A-Fa-f]{6}$/.test(status.color) ? status.color : '#64748B',
  };
}

function sanitizeDepartment<T extends { id: string; name: string; status: string }>(
  department: T,
): T {
  return {
    ...department,
    id: department.id,
    name: department.name,
    status: department.status,
  };
}

function sanitizeMemberships(
  memberships: {
    id?: string;
    membershipId?: string;
    user: { id: string; email: string; name: string | null };
  }[],
) {
  return memberships.map((membership) => ({
    id: membership.id,
    membershipId: membership.membershipId,
    user: sanitizeUser(membership.user),
  }));
}

function sanitizeProjectMembership<
  T extends {
    id: string;
    status: string;
    user: { id: string; email: string; name: string | null };
  },
>(membership: T): T {
  return {
    ...membership,
    id: membership.id,
    status: membership.status,
    user: sanitizeUser(membership.user),
  };
}

function sanitizeTicketMembership<
  T extends {
    id: string;
    status: string;
    departmentId: string | null;
    user: { id: string; email: string; name: string | null; status?: string };
  },
>(membership: T): T {
  return {
    ...membership,
    id: membership.id,
    status: membership.status,
    departmentId: membership.departmentId,
    user: sanitizeUser(membership.user),
  };
}

function sanitizeUser<
  T extends { id: string; email: string; name: string | null; status?: string },
>(user: T): T {
  return {
    ...user,
    id: user.id,
    email: '',
    name: user.name,
    ...(user.status ? { status: user.status } : {}),
  };
}

function numberOr(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, sortJson(item)]),
  );
}
