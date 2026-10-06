import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ApiClientError } from '../../../packages/api-client/src';
import {
  assertOnlineMutationAllowed,
  cacheOfflineRead,
  deleteOfflineUser,
  getOfflineResultMeta,
  setOfflineSessionContext,
} from '../services/offline-cache';
import {
  OFFLINE_DATABASE_NAME,
  offlinePolicies,
  sanitizeOfflineData,
} from '../services/offline-cache-policy';

const workspaceContext = {
  userId: 'user-a',
  scopeType: 'WORKSPACE' as const,
  scopeId: 'workspace-a',
  accessTokenPresent: true,
  tenantStatus: 'ACTIVE',
};

describe('Phase 19.3 offline read cache', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T08:00:00.000Z'));
    setNavigatorOnline(true);
    setOfflineSessionContext(workspaceContext);
    await deleteOfflineUser('user-a');
    await deleteOfflineUser('user-b');
  });

  afterEach(() => {
    setOfflineSessionContext(null);
    vi.useRealTimers();
    setNavigatorOnline(true);
  });

  it('uses a scoped IndexedDB database name and central policy registry', () => {
    expect(OFFLINE_DATABASE_NAME).toBe('zea-play-offline');
    expect(offlinePolicies['workspace-task-list'].allowedFields).toContain('title');
    expect(offlinePolicies['workspace-ticket-list'].allowedFields).not.toContain('externalEmail');
    expect(offlinePolicies['workspace-project-detail'].detailCaching).toBe(true);
  });

  it('stores safe online reads and serves them only for the same user and tenant when offline', async () => {
    const online = await cacheOfflineRead({
      resourceType: 'workspace-task-list',
      queryKey: { page: 1 },
      request: () => Promise.resolve(taskPage('task-a', 'Task A')),
    });
    expect(online.items[0]?.title).toBe('Task A');

    setNavigatorOnline(false);
    const cached = await cacheOfflineRead<ReturnType<typeof taskPage>>({
      resourceType: 'workspace-task-list',
      queryKey: { page: 1 },
      request: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    expect(cached.items[0]?.title).toBe('Task A');
    expect(getOfflineResultMeta(cached)?.offline).toBe(true);

    setOfflineSessionContext({ ...workspaceContext, scopeId: 'workspace-b' });
    await expect(
      cacheOfflineRead({
        resourceType: 'workspace-task-list',
        queryKey: { page: 1 },
        request: () => Promise.reject(new TypeError('Failed to fetch')),
      }),
    ).rejects.toThrow('Failed to fetch');

    setOfflineSessionContext({ ...workspaceContext, userId: 'user-b' });
    await expect(
      cacheOfflineRead({
        resourceType: 'workspace-task-list',
        queryKey: { page: 1 },
        request: () => Promise.reject(new TypeError('Failed to fetch')),
      }),
    ).rejects.toThrow('Failed to fetch');
  });

  it('excludes sensitive ticket requester fields and private descriptions', () => {
    const sanitized = sanitizeOfflineData('workspace-ticket-list', {
      items: [
        {
          ...ticket('ticket-a'),
          description: 'private body',
          requester: {
            id: 'requester-a',
            type: 'EXTERNAL',
            displayName: 'Customer',
            externalEmail: 'customer@example.test',
            externalPhone: '+10000000000',
          },
        },
      ],
      page: 1,
      pageSize: 20,
      total: 1,
    });

    expect(JSON.stringify(sanitized)).not.toContain('customer@example.test');
    expect(JSON.stringify(sanitized)).not.toContain('+10000000000');
    expect(JSON.stringify(sanitized)).not.toContain('private body');
    expect(JSON.stringify(sanitized)).toContain('ticket-a');
  });

  it('does not fall back to cache after 401 or 403 authorization denial', async () => {
    await cacheOfflineRead({
      resourceType: 'workspace-project-list',
      queryKey: { page: 1 },
      request: () => Promise.resolve(projectPage('project-a', 'Project A')),
    });

    await expect(
      cacheOfflineRead({
        resourceType: 'workspace-project-list',
        queryKey: { page: 1 },
        request: () =>
          Promise.reject(
            new ApiClientError(403, {
              code: 'FORBIDDEN',
              message: 'Forbidden',
              requestId: 'request-a',
            }),
          ),
      }),
    ).rejects.toMatchObject({ status: 403 });

    setNavigatorOnline(false);
    await expect(
      cacheOfflineRead({
        resourceType: 'workspace-project-list',
        queryKey: { page: 1 },
        request: () => Promise.reject(new TypeError('Failed to fetch')),
      }),
    ).rejects.toThrow('Failed to fetch');
  });

  it('rejects cache older than maximum stale age', async () => {
    await cacheOfflineRead({
      resourceType: 'workspace-ticket-list',
      queryKey: { page: 1 },
      request: () =>
        Promise.resolve({ items: [ticket('ticket-a')], page: 1, pageSize: 20, total: 1 }),
    });
    vi.setSystemTime(new Date('2026-10-06T10:01:00.000Z'));
    setNavigatorOnline(false);
    await expect(
      cacheOfflineRead({
        resourceType: 'workspace-ticket-list',
        queryKey: { page: 1 },
        request: () => Promise.reject(new TypeError('Failed to fetch')),
      }),
    ).rejects.toThrow('Failed to fetch');
  });

  it('purges cached private data on logout cleanup', async () => {
    await cacheOfflineRead({
      resourceType: 'workspace-project-detail',
      resourceId: 'project-a',
      request: () => Promise.resolve(project('project-a', 'Project A')),
    });
    await deleteOfflineUser('user-a');
    setNavigatorOnline(false);
    await expect(
      cacheOfflineRead({
        resourceType: 'workspace-project-detail',
        resourceId: 'project-a',
        request: () => Promise.reject(new TypeError('Failed to fetch')),
      }),
    ).rejects.toThrow('Failed to fetch');
  });

  it('does not write private cache for suspended tenants and blocks offline mutations', async () => {
    setOfflineSessionContext({ ...workspaceContext, tenantStatus: 'SUSPENDED' });
    await cacheOfflineRead({
      resourceType: 'workspace-task-detail',
      resourceId: 'task-a',
      request: () => Promise.resolve(task('task-a', 'Task A')),
    });

    setNavigatorOnline(false);
    await expect(
      cacheOfflineRead({
        resourceType: 'workspace-task-detail',
        resourceId: 'task-a',
        request: () => Promise.reject(new TypeError('Failed to fetch')),
      }),
    ).rejects.toThrow('Failed to fetch');
    expect(() => assertOnlineMutationAllowed()).toThrow('Reconnect to make changes');
  });
});

function setNavigatorOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    value,
  });
}

function taskPage(id: string, title: string) {
  return { items: [task(id, title)], page: 1, pageSize: 25, total: 1 };
}

function task(id: string, title: string) {
  return {
    id,
    workspaceId: 'workspace-a',
    title,
    priority: 'HIGH',
    kanbanRank: null,
    status: status('status-open'),
    parentTaskId: null,
    department: null,
    plannedStartAt: null,
    dueAt: '2026-10-06T12:00:00.000Z',
    assignees: [
      { membershipId: 'membership-a', user: { id: 'user-a', email: 'a@test', name: 'A' } },
    ],
    projects: [],
    counts: { assignees: 1, followers: 0, projects: 0 },
    createdAt: '2026-10-06T07:00:00.000Z',
    updatedAt: '2026-10-06T07:30:00.000Z',
  };
}

function projectPage(id: string, name: string) {
  return { items: [project(id, name)], page: 1, pageSize: 20, total: 1 };
}

function project(id: string, name: string) {
  return {
    id,
    workspaceId: 'workspace-a',
    name,
    description: 'private notes',
    statusDefinitionId: 'status-open',
    status: status('status-open'),
    priority: 'HIGH',
    xpCategory: null,
    visibility: 'WORKSPACE',
    calculatedProgress: 20,
    manualProgressPercent: null,
    manualProgressUpdatedAt: null,
    effectiveProgress: 20,
    taskCounts: { totalTasks: 2, openTasks: 1, completedTasks: 1, overdueTasks: 0 },
    plannedStartAt: null,
    dueAt: null,
    departmentId: null,
    department: null,
    ownerMembershipId: 'membership-a',
    owner: {
      id: 'membership-a',
      status: 'ACTIVE',
      user: { id: 'user-a', email: 'a@test', name: 'A' },
    },
    memberCount: 1,
    createdAt: '2026-10-06T07:00:00.000Z',
    updatedAt: '2026-10-06T07:30:00.000Z',
  };
}

function ticket(id: string) {
  return {
    id,
    workspaceId: 'workspace-a',
    sequenceNumber: 1,
    ticketNumber: 'T-1',
    subject: 'Safe subject',
    statusDefinitionId: 'status-open',
    status: { ...status('status-open'), active: true },
    priority: 'HIGH',
    requester: null,
    departmentId: null,
    department: null,
    assignedToMembershipId: null,
    assignedTo: null,
    escalationLevel: 'NONE',
    createdBy: null,
    createdAt: '2026-10-06T07:00:00.000Z',
    updatedAt: '2026-10-06T07:30:00.000Z',
  };
}

function status(id: string) {
  return { id, name: 'Open', color: '#2563EB', terminal: false };
}
