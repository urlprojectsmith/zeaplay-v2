import { expect, type Page, test } from '@playwright/test';

const apiHeaders = {
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers':
    'authorization,content-type,x-correlation-id,x-csrf-token,x-agency-id,x-workspace-id',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,OPTIONS',
  'access-control-allow-origin': 'http://127.0.0.1:3000',
};

async function fulfillApi(
  route: Parameters<Page['route']>[1] extends (route: infer R) => unknown ? R : never,
  data: unknown,
  status = 200,
) {
  const request = route.request();
  await route.fulfill({
    status: request.method() === 'OPTIONS' ? 204 : status,
    contentType: 'application/json',
    headers: apiHeaders,
    body: request.method() === 'OPTIONS' ? '' : JSON.stringify({ data }),
  });
}

async function mockAuthenticatedSession(page: Page) {
  await page.context().addCookies([
    {
      name: 'zea_csrf',
      value: 'csrf-token',
      url: 'http://127.0.0.1:3000',
      httpOnly: false,
      sameSite: 'Lax',
    },
  ]);
  await page.addInitScript(() => {
    document.cookie = 'zea_csrf=csrf-token; path=/';
  });
  await page.route(/.*\/auth\/refresh$/, async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      headers: apiHeaders,
      body: JSON.stringify({ data: { accessToken: 'access-token', csrfToken: 'csrf-token' } }),
    });
  });
  await page.route(/.*\/auth\/me$/, async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      headers: apiHeaders,
      body: JSON.stringify({
        data: {
          id: 'user-1',
          email: 'owner@zeaplay.test',
          name: 'Owner',
          agencies: [
            {
              id: 'agency-1',
              name: 'Agency One',
              slug: 'agency-one',
              status: 'active',
              role: 'owner',
              membershipId: 'membership-1',
              workspaces: [
                {
                  id: 'workspace-1',
                  agencyId: 'agency-1',
                  name: 'Workspace One',
                  slug: 'workspace-one',
                  status: 'active',
                  role: 'admin',
                  membershipId: 'workspace-membership-1',
                },
              ],
            },
            {
              id: 'agency-2',
              name: 'Agency Two',
              slug: 'agency-two',
              status: 'active',
              role: 'admin',
              membershipId: 'membership-2',
              workspaces: [
                {
                  id: 'workspace-2',
                  agencyId: 'agency-2',
                  name: 'Workspace Two',
                  slug: 'workspace-two',
                  status: 'active',
                  role: 'member',
                  membershipId: 'workspace-membership-2',
                },
              ],
            },
          ],
        },
      }),
    });
  });
}

async function mockRoleManagementApi(page: Page) {
  const permissions = [
    { id: 'permission-users-view', key: 'users.view', description: null, createdAt: '' },
    { id: 'permission-users-manage', key: 'users.manage', description: null, createdAt: '' },
    {
      id: 'permission-roles-manage',
      key: 'roles.manage_permissions',
      description: null,
      createdAt: '',
    },
  ];
  const roles = [
    {
      id: 'role-owner',
      key: 'OWNER',
      name: 'Owner',
      description: null,
      scope: 'WORKSPACE',
      isSystem: true,
      isActive: true,
      workspaceId: null,
      permissions,
      createdAt: '',
      updatedAt: '',
    },
    {
      id: 'role-member',
      key: 'MEMBER',
      name: 'Member',
      description: null,
      scope: 'WORKSPACE',
      isSystem: true,
      isActive: true,
      workspaceId: null,
      permissions: [permissions[0]],
      createdAt: '',
      updatedAt: '',
    },
  ];

  await page.route(/.*\/workspaces\/workspace-1\/permissions$/, async (route) => {
    await fulfillApi(route, permissions);
  });
  await page.route(/.*\/workspaces\/workspace-1\/roles$/, async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { name: string; description?: string };
      roles.push({
        id: 'role-qa-lead',
        key: 'workspace:workspace-1:qa-lead',
        name: body.name,
        description: body.description ?? null,
        scope: 'WORKSPACE',
        isSystem: false,
        isActive: true,
        workspaceId: 'workspace-1',
        permissions: [],
        createdAt: '',
        updatedAt: '',
      });
      await fulfillApi(route, roles.at(-1));
      return;
    }
    await fulfillApi(route, roles);
  });
  await page.route(/.*\/workspaces\/workspace-1\/roles\/([^/]+)$/, async (route) => {
    const roleId = new URL(route.request().url()).pathname.split('/').at(-1);
    await fulfillApi(route, roles.find((role) => role.id === roleId) ?? roles[0]);
  });
  await page.route(/.*\/workspaces\/workspace-1\/roles\/([^/]+)\/clone$/, async (route) => {
    const role = roles.find((item) => item.id === 'role-qa-lead') ?? roles[1];
    const clone = { ...role, id: 'role-qa-lead-copy', name: `${role.name} Copy` };
    roles.push(clone);
    await fulfillApi(route, clone);
  });
  await page.route(/.*\/workspaces\/workspace-1\/roles\/([^/]+)\/permissions$/, async (route) => {
    const roleId = new URL(route.request().url()).pathname.split('/').at(-2);
    const body = route.request().postDataJSON() as { permissionIds: string[] };
    const role = roles.find((item) => item.id === roleId) ?? roles[1];
    role.permissions = permissions.filter((permission) =>
      body.permissionIds.includes(permission.id),
    );
    await fulfillApi(route, role);
  });
  await page.route(/.*\/workspaces\/workspace-1\/users.*/, async (route) => {
    await fulfillApi(route, {
      items: [
        {
          id: 'user-2',
          membershipId: 'workspace-membership-2',
          workspaceId: 'workspace-1',
          email: 'member@zeaplay.test',
          name: 'Member One',
          userStatus: 'ACTIVE',
          membershipStatus: 'ACTIVE',
          role: { id: 'role-member', key: 'MEMBER', name: 'Member' },
          department: null,
          joinedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        },
      ],
      page: 1,
      pageSize: 10,
      total: 1,
    });
  });
  await page.route(/.*\/workspaces\/workspace-1\/departments.*/, async (route) => {
    await fulfillApi(route, { items: [], page: 1, pageSize: 10, total: 0 });
  });
}

async function mockStatusManagementApi(page: Page) {
  type EntityType = 'TASK' | 'PROJECT' | 'TICKET';
  type StatusDefinition = {
    id: string;
    workspaceId: string;
    entityType: EntityType;
    name: string;
    description: string | null;
    color: string;
    position: number;
    category: string;
    isDefault: boolean;
    isTerminal: boolean;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
  };

  const now = new Date().toISOString();
  const makeStatus = (
    id: string,
    entityType: EntityType,
    name: string,
    position: number,
    overrides: Partial<StatusDefinition> = {},
  ): StatusDefinition => ({
    id,
    workspaceId: 'workspace-1',
    entityType,
    name,
    description: null,
    color: '#64748B',
    position,
    category: 'TODO',
    isDefault: false,
    isTerminal: false,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });

  const statuses: Record<EntityType, StatusDefinition[]> = {
    TASK: [
      makeStatus('task-todo', 'TASK', 'To Do', 1, { isDefault: true }),
      makeStatus('task-progress', 'TASK', 'In Progress', 2, {
        color: '#2563EB',
        category: 'IN_PROGRESS',
      }),
    ],
    PROJECT: [
      makeStatus('project-lead', 'PROJECT', 'Lead', 1, {
        isDefault: true,
        category: 'BACKLOG',
      }),
      makeStatus('project-review', 'PROJECT', 'Client Review', 2, { category: 'REVIEW' }),
    ],
    TICKET: [
      makeStatus('ticket-new', 'TICKET', 'New', 1, { isDefault: true }),
      makeStatus('ticket-closed', 'TICKET', 'Closed', 2, {
        isTerminal: true,
        category: 'COMPLETED',
      }),
    ],
  };

  await page.route(/.*\/workspaces\/workspace-1\/statuses.*/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const parts = url.pathname.split('/').filter(Boolean);
    const entityType = parts[parts.indexOf('statuses') + 1] as EntityType | undefined;
    const statusId = parts[parts.indexOf('statuses') + 2];
    const action = parts[parts.indexOf('statuses') + 3];

    if (request.method() === 'POST' && entityType === 'initialize-defaults') {
      await fulfillApi(route, Object.values(statuses).flat());
      return;
    }

    if (!entityType || !statuses[entityType]) {
      await fulfillApi(route, []);
      return;
    }

    if (request.method() === 'GET') {
      await fulfillApi(
        route,
        statuses[entityType].sort((a, b) => a.position - b.position),
      );
      return;
    }

    if (request.method() === 'POST' && !statusId) {
      const body = request.postDataJSON() as Partial<StatusDefinition>;
      const created = makeStatus(
        `${entityType.toLowerCase()}-${Date.now()}`,
        entityType,
        body.name ?? 'Custom',
        statuses[entityType].length + 1,
        {
          description: body.description ?? null,
          color: body.color ?? '#64748B',
          category: body.category ?? 'TODO',
          isTerminal: Boolean(body.isTerminal),
        },
      );
      statuses[entityType].push(created);
      await fulfillApi(route, created, 201);
      return;
    }

    if (request.method() === 'PATCH' && statusId === 'reorder') {
      const body = request.postDataJSON() as { orderedStatusIds: string[] };
      statuses[entityType] = body.orderedStatusIds.map((id, index) => ({
        ...statuses[entityType].find((status) => status.id === id)!,
        position: index + 1,
      }));
      await fulfillApi(route, statuses[entityType]);
      return;
    }

    const existing = statuses[entityType].find((status) => status.id === statusId);
    if (!existing) {
      await fulfillApi(route, { message: 'Not found' }, 404);
      return;
    }

    if (request.method() === 'POST' && action === 'set-default') {
      statuses[entityType] = statuses[entityType].map((status) => ({
        ...status,
        isDefault: status.id === statusId,
      }));
      await fulfillApi(
        route,
        statuses[entityType].find((status) => status.id === statusId),
      );
      return;
    }

    if (request.method() === 'PATCH') {
      const body = request.postDataJSON() as Partial<StatusDefinition>;
      Object.assign(existing, body, { updatedAt: now });
      await fulfillApi(route, existing);
    }
  });
}

async function mockTaskCreationApi(page: Page, options: { extraTasks?: number } = {}) {
  const now = '2026-09-16T00:00:00.000Z';
  const users = [
    {
      id: 'user-anya',
      membershipId: 'membership-anya',
      workspaceId: 'workspace-1',
      email: 'anya@zeaplay.test',
      name: 'Anya',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
      role: { id: 'role-member', key: 'MEMBER', name: 'Member' },
      department: null,
      joinedAt: now,
      createdAt: now,
    },
  ];
  const taskStatus = {
    id: 'status-task-todo',
    workspaceId: 'workspace-1',
    entityType: 'TASK',
    name: 'To Do',
    description: null,
    color: '#64748B',
    position: 1,
    category: 'TODO',
    isDefault: true,
    isTerminal: false,
    isActive: true,
    isSystem: true,
    createdAt: now,
    updatedAt: now,
  };
  const completedTaskStatus = {
    ...taskStatus,
    id: 'status-task-completed',
    name: 'Completed',
    position: 2,
    category: 'DONE',
    isDefault: false,
    isTerminal: true,
  };
  const taskStatuses = [taskStatus, completedTaskStatus];
  const tasks: Array<Record<string, unknown>> = [
    {
      id: 'task-seed-alpha',
      workspaceId: 'workspace-1',
      title: 'Seed alpha task',
      description: null,
      priority: 'MEDIUM',
      kanbanRank: '1024',
      status: taskStatus,
      department: null,
      dueAt: '2026-09-30T00:00:00.000Z',
      assignees: [],
      followers: [],
      projects: [],
      counts: { assignees: 0, followers: 0, projects: 0 },
      parentTaskId: null,
      directSubtaskCount: 0,
      blockedByCount: 0,
      blocksCount: 0,
      relatedTaskCount: 0,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'task-seed-beta',
      workspaceId: 'workspace-1',
      title: 'Seed beta task',
      description: null,
      priority: 'LOW',
      kanbanRank: '2048',
      status: taskStatus,
      department: null,
      dueAt: '2026-10-01T00:00:00.000Z',
      assignees: [],
      followers: [],
      projects: [],
      counts: { assignees: 0, followers: 0, projects: 0 },
      parentTaskId: null,
      directSubtaskCount: 0,
      blockedByCount: 0,
      blocksCount: 0,
      relatedTaskCount: 0,
      createdAt: now,
      updatedAt: now,
    },
  ];
  for (let index = 1; index <= (options.extraTasks ?? 0); index += 1) {
    tasks.push({
      id: `task-extra-${index}`,
      workspaceId: 'workspace-1',
      title: `Extra task ${index}`,
      description: null,
      priority: 'MEDIUM',
      kanbanRank: String((index + 2) * 1024),
      status: taskStatus,
      department: null,
      dueAt: '2026-10-15T00:00:00.000Z',
      assignees: [],
      followers: [],
      projects: [],
      counts: { assignees: 0, followers: 0, projects: 0 },
      parentTaskId: null,
      directSubtaskCount: 0,
      blockedByCount: 0,
      blocksCount: 0,
      relatedTaskCount: 0,
      createdAt: now,
      updatedAt: now,
    });
  }
  const dependencies = new Map<string, Set<string>>();
  const relatedPairs = new Set<string>();
  const tags: Array<Record<string, unknown>> = [
    {
      id: 'tag-bug',
      workspaceId: 'workspace-1',
      name: 'Bug',
      color: '#DC2626',
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'tag-feature',
      workspaceId: 'workspace-1',
      name: 'Feature',
      color: '#2563EB',
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'tag-legacy',
      workspaceId: 'workspace-1',
      name: 'Legacy',
      color: '#64748B',
      status: 'ARCHIVED',
      createdAt: now,
      updatedAt: now,
    },
  ];
  const taskTags = new Map<string, Set<string>>([
    ['task-seed-alpha', new Set(['tag-bug', 'tag-legacy'])],
    ['task-seed-beta', new Set(['tag-feature'])],
  ]);
  const recurrenceSeries: Array<Record<string, unknown>> = [
    {
      id: 'series-alpha',
      workspaceId: 'workspace-1',
      status: 'ACTIVE',
      title: 'Seed alpha task',
      description: null,
      priority: 'MEDIUM',
      statusDefinitionId: taskStatus.id,
      departmentId: null,
      timezone: 'Asia/Calcutta',
      frequency: 'DAILY',
      interval: 1,
      customIntervalUnit: null,
      startLocalDate: '2026-09-20',
      localTime: '09:00',
      selectedWeekdays: [],
      monthlyDay: null,
      endMode: 'NEVER',
      untilLocalDate: null,
      maxOccurrences: null,
      nextOccurrenceAt: '2026-09-21T03:30:00.000Z',
      lastGeneratedAt: now,
      generatedCount: 1,
      endedAt: null,
      lastErrorCode: null,
      assigneeMembershipIds: [],
      followerMembershipIds: [],
      projectIds: [],
      tagIds: [],
      createdAt: now,
      updatedAt: now,
    },
  ];
  tasks[0].recurrenceSeriesId = 'series-alpha';
  tasks[0].recurrenceScheduledFor = '2026-09-20T03:30:00.000Z';
  tasks[0].recurrenceSequence = 1;
  tasks[0].recurrenceIsException = false;
  const templates: Array<Record<string, unknown>> = [
    {
      id: 'template-alpha',
      workspaceId: 'workspace-1',
      name: 'Launch template',
      title: 'Templated launch task',
      description: 'Template description',
      priority: 'HIGH',
      status: 'ACTIVE',
      statusDefinitionId: taskStatus.id,
      departmentId: null,
      assigneeMembershipIds: ['membership-anya'],
      followerMembershipIds: [],
      projectIds: [],
      tagIds: ['tag-feature'],
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    },
  ];
  const attachments = new Map<string, Array<Record<string, unknown>>>([
    [
      'task-seed-alpha',
      [
        {
          id: 'attachment-existing-url',
          workspaceId: 'workspace-1',
          taskId: 'task-seed-alpha',
          type: 'URL',
          displayName: 'Existing Brief',
          url: 'https://example.com/existing-brief',
          file: null,
          attachedAt: now,
          createdAt: now,
          updatedAt: now,
        },
      ],
    ],
  ]);
  const emptyReactionCounts = () => ({ LIKE: 0, LOVE: 0, CELEBRATE: 0, EYES: 0, CHECK: 0 });
  const comments = new Map<string, Array<Record<string, unknown>>>([
    [
      'task-seed-alpha',
      [
        {
          id: 'comment-root',
          workspaceId: 'workspace-1',
          taskId: 'task-seed-alpha',
          parentCommentId: null,
          body: 'Initial discussion note',
          visibility: 'NORMAL',
          deleted: false,
          editedAt: null,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
          author: {
            membershipId: 'workspace-membership-1',
            userId: 'user-1',
            name: 'Owner',
            email: 'owner@zeaplay.test',
          },
          mentions: [],
          directReplyCount: 0,
          reactionCounts: emptyReactionCounts(),
          currentUserReactions: [],
        },
      ],
    ],
  ]);
  const canonicalRelatedKey = (left: string, right: string) =>
    [left, right].sort((a, b) => a.localeCompare(b)).join(':');
  const findTask = (taskId: string) => tasks.find((item) => item.id === taskId);
  const taskComments = (taskId: string) => comments.get(taskId) ?? [];
  const visibleComments = (taskId: string, parentCommentId: string | null) =>
    taskComments(taskId).filter((comment) => comment.parentCommentId === parentCommentId);
  const recomputeCommentCounts = (taskId: string) => {
    const items = taskComments(taskId);
    for (const comment of items) {
      comment.directReplyCount = items.filter(
        (reply) => reply.parentCommentId === comment.id,
      ).length;
    }
  };
  const pageComments = (items: Array<Record<string, unknown>>, url: string) => {
    const params = new URL(url).searchParams;
    const pageNumber = Number(params.get('page') ?? 1);
    const pageSize = Number(params.get('pageSize') ?? 10);
    return {
      items: items.slice((pageNumber - 1) * pageSize, pageNumber * pageSize),
      page: pageNumber,
      pageSize,
      total: items.length,
    };
  };
  const taskWithCounts = (task: Record<string, unknown>) => {
    const taskId = String(task.id);
    const blockedByCount = dependencies.get(taskId)?.size ?? 0;
    let blocksCount = 0;
    for (const blockers of dependencies.values()) {
      if (blockers.has(taskId)) blocksCount += 1;
    }
    let relatedTaskCount = 0;
    for (const key of relatedPairs) {
      if (key.split(':').includes(taskId)) relatedTaskCount += 1;
    }
    return {
      ...task,
      directSubtaskCount: tasks.filter((item) => item.parentTaskId === taskId).length,
      blockedByCount,
      blocksCount,
      relatedTaskCount,
      parent:
        task.parentTaskId && findTask(String(task.parentTaskId))
          ? {
              id: task.parentTaskId,
              title: findTask(String(task.parentTaskId))?.title,
            }
          : null,
    };
  };
  const pageResult = (items: Record<string, unknown>[], url: string) => {
    const params = new URL(url).searchParams;
    const pageNumber = Number(params.get('page') ?? 1);
    const pageSize = Number(params.get('pageSize') ?? 10);
    return {
      items: items.slice((pageNumber - 1) * pageSize, pageNumber * pageSize).map(taskWithCounts),
      page: pageNumber,
      pageSize,
      total: items.length,
    };
  };

  await page.route(/.*\/workspaces\/workspace-1\/users(\?.*)?$/, async (route) => {
    await fulfillApi(route, { items: users, page: 1, pageSize: 10, total: users.length });
  });
  await page.route(/.*\/workspaces\/workspace-1\/roles$/, async (route) => {
    await fulfillApi(route, [
      {
        id: 'role-admin',
        key: 'admin',
        name: 'Admin',
        description: null,
        scope: 'WORKSPACE',
        isSystem: true,
        isActive: true,
        workspaceId: null,
        permissions: [
          {
            id: 'permission-tasks-update',
            key: 'tasks.update',
            description: null,
            createdAt: now,
          },
          {
            id: 'permission-tasks-view',
            key: 'tasks.view',
            description: null,
            createdAt: now,
          },
          {
            id: 'permission-projects-reports-view',
            key: 'projects.reports.view',
            description: null,
            createdAt: now,
          },
          {
            id: 'permission-projects-create',
            key: 'projects.create',
            description: null,
            createdAt: now,
          },
          {
            id: 'permission-projects-update',
            key: 'projects.update',
            description: null,
            createdAt: now,
          },
          {
            id: 'permission-projects-delete',
            key: 'projects.delete',
            description: null,
            createdAt: now,
          },
          {
            id: 'permission-projects-manage-status',
            key: 'projects.manage_status',
            description: null,
            createdAt: now,
          },
          {
            id: 'permission-projects-manage-members',
            key: 'projects.manage_members',
            description: null,
            createdAt: now,
          },
          {
            id: 'permission-projects-manage-owner',
            key: 'projects.manage_owner',
            description: null,
            createdAt: now,
          },
          {
            id: 'permission-projects-manage-progress',
            key: 'projects.manage_progress',
            description: null,
            createdAt: now,
          },
          {
            id: 'permission-project-files-view',
            key: 'projects.files.view',
            description: null,
            createdAt: now,
          },
          {
            id: 'permission-project-files-add',
            key: 'projects.files.add',
            description: null,
            createdAt: now,
          },
          {
            id: 'permission-project-files-remove',
            key: 'projects.files.remove',
            description: null,
            createdAt: now,
          },
          {
            id: 'permission-project-files-download',
            key: 'projects.files.download',
            description: null,
            createdAt: now,
          },
          {
            id: 'permission-project-activity-view',
            key: 'projects.activity.view',
            description: null,
            createdAt: now,
          },
          {
            id: 'permission-tags-view',
            key: 'tags.view',
            description: null,
            createdAt: now,
          },
          {
            id: 'permission-tags-create',
            key: 'tags.create',
            description: null,
            createdAt: now,
          },
          {
            id: 'permission-tags-update',
            key: 'tags.update',
            description: null,
            createdAt: now,
          },
          {
            id: 'permission-tags-archive',
            key: 'tags.archive',
            description: null,
            createdAt: now,
          },
          {
            id: 'permission-tags-assign',
            key: 'tags.assign',
            description: null,
            createdAt: now,
          },
          {
            id: 'permission-comments-internal',
            key: 'tasks.comments.internal',
            description: null,
            createdAt: now,
          },
          {
            id: 'permission-task-attachments-view',
            key: 'tasks.attachments.view',
            description: null,
            createdAt: now,
          },
          {
            id: 'permission-task-attachments-add',
            key: 'tasks.attachments.add',
            description: null,
            createdAt: now,
          },
          {
            id: 'permission-task-attachments-remove',
            key: 'tasks.attachments.remove',
            description: null,
            createdAt: now,
          },
          {
            id: 'permission-task-attachments-download',
            key: 'tasks.attachments.download',
            description: null,
            createdAt: now,
          },
        ],
        createdAt: now,
        updatedAt: now,
      },
    ]);
  });
  await page.route(/.*\/workspaces\/workspace-2\/users(\?.*)?$/, async (route) => {
    await fulfillApi(route, { items: [], page: 1, pageSize: 10, total: 0 });
  });
  await page.route(/.*\/workspaces\/workspace-2\/roles$/, async (route) => {
    await fulfillApi(route, [
      {
        id: 'role-member',
        key: 'member',
        name: 'Member',
        description: null,
        scope: 'WORKSPACE',
        isSystem: true,
        isActive: true,
        workspaceId: null,
        permissions: [],
        createdAt: now,
        updatedAt: now,
      },
    ]);
  });
  await page.route(/.*\/workspaces\/workspace-1\/departments(\?.*)?$/, async (route) => {
    await fulfillApi(route, { items: [], page: 1, pageSize: 100, total: 0 });
  });
  await page.route(/.*\/workspaces\/workspace-2\/departments(\?.*)?$/, async (route) => {
    await fulfillApi(route, { items: [], page: 1, pageSize: 100, total: 0 });
  });
  await page.route(/.*\/workspaces\/workspace-1\/statuses\/TASK(\?.*)?$/, async (route) => {
    await fulfillApi(route, taskStatuses);
  });
  await page.route(/.*\/workspaces\/workspace-2\/statuses\/TASK(\?.*)?$/, async (route) => {
    await fulfillApi(route, [{ ...taskStatus, workspaceId: 'workspace-2' }]);
  });
  await page.route(/.*\/projects(\?.*)?$/, async (route) => {
    await fulfillApi(route, { items: [], page: 1, pageSize: 10, total: 0 });
  });
  await page.route(/.*\/workspaces\/workspace-1\/tags(\?.*)?$/, async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as { name: string; color?: string | null };
      const tag = {
        id: `tag-${body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${tags.length + 1}`,
        workspaceId: 'workspace-1',
        name: body.name,
        color: body.color ?? null,
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
      };
      tags.unshift(tag);
      await fulfillApi(route, tag, 201);
      return;
    }
    const url = new URL(request.url());
    const search = url.searchParams.get('search')?.toLowerCase() ?? '';
    const status = url.searchParams.get('status');
    const pageNumber = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? 10);
    const filtered = tags.filter((tag) => {
      if (status && tag.status !== status) return false;
      if (search && !String(tag.name).toLowerCase().includes(search)) return false;
      return true;
    });
    await fulfillApi(route, {
      items: filtered.slice((pageNumber - 1) * pageSize, pageNumber * pageSize),
      page: pageNumber,
      pageSize,
      total: filtered.length,
    });
  });
  await page.route(
    /.*\/workspaces\/workspace-1\/tags\/([^/]+)(\/archive|\/reactivate)?$/,
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const parts = url.pathname.split('/');
      const tagId =
        parts.at(-1) === 'archive' || parts.at(-1) === 'reactivate' ? parts.at(-2) : parts.at(-1);
      const tag = tags.find((item) => item.id === tagId);
      if (!tag) {
        await fulfillApi(route, { message: 'Not found' }, 404);
        return;
      }
      if (url.pathname.endsWith('/archive')) tag.status = 'ARCHIVED';
      else if (url.pathname.endsWith('/reactivate')) tag.status = 'ACTIVE';
      else if (request.method() === 'PATCH') {
        const body = request.postDataJSON() as { name?: string; color?: string | null };
        if (body.name !== undefined) tag.name = body.name;
        if (body.color !== undefined) tag.color = body.color;
      }
      tag.updatedAt = now;
      await fulfillApi(route, tag);
    },
  );
  await page.route(/.*\/workspaces\/workspace-1\/tasks\/bulk\/priority$/, async (route) => {
    const body = route.request().postDataJSON() as { taskIds: string[]; priority: string };
    if (body.priority === 'URGENT') {
      await fulfillApi(route, { message: 'One or more selected tasks are unavailable.' }, 404);
      return;
    }
    let changedCount = 0;
    for (const task of tasks) {
      if (!body.taskIds.includes(String(task.id))) continue;
      if (task.priority !== body.priority) {
        task.priority = body.priority;
        task.updatedAt = now;
        changedCount += 1;
      }
    }
    await fulfillApi(route, {
      requestedCount: body.taskIds.length,
      changedCount,
      unchangedCount: body.taskIds.length - changedCount,
    });
  });
  await page.route(/.*\/workspaces\/workspace-1\/tasks\/bulk\/status$/, async (route) => {
    const body = route.request().postDataJSON() as {
      taskIds: string[];
      statusDefinitionId: string;
    };
    let changedCount = 0;
    const nextStatus =
      taskStatuses.find((status) => status.id === body.statusDefinitionId) ?? taskStatus;
    for (const task of tasks) {
      if (!body.taskIds.includes(String(task.id))) continue;
      if ((task.status as { id?: string }).id !== body.statusDefinitionId) {
        task.status = nextStatus;
        task.updatedAt = now;
        changedCount += 1;
      }
    }
    await fulfillApi(route, {
      requestedCount: body.taskIds.length,
      changedCount,
      unchangedCount: body.taskIds.length - changedCount,
    });
  });
  await page.route(/.*\/workspaces\/workspace-1\/tasks\/bulk\/assignees\/add$/, async (route) => {
    const body = route.request().postDataJSON() as { taskIds: string[]; membershipIds: string[] };
    let relationChangedCount = 0;
    for (const task of tasks) {
      if (!body.taskIds.includes(String(task.id))) continue;
      const assignees = task.assignees as Array<{ id: string; user: unknown }>;
      for (const membershipId of body.membershipIds) {
        if (assignees.some((assignee) => assignee.id === membershipId)) continue;
        const user = users.find((item) => item.membershipId === membershipId);
        if (!user) continue;
        assignees.push({
          id: user.membershipId,
          user: { id: user.id, email: user.email, name: user.name },
        });
        relationChangedCount += 1;
      }
      task.counts = { ...(task.counts as Record<string, number>), assignees: assignees.length };
      task.updatedAt = now;
    }
    const requestedRelations = body.taskIds.length * body.membershipIds.length;
    await fulfillApi(route, {
      requestedCount: body.taskIds.length,
      changedCount: relationChangedCount > 0 ? body.taskIds.length : 0,
      unchangedCount: relationChangedCount > 0 ? 0 : body.taskIds.length,
      relationChangedCount,
      relationUnchangedCount: requestedRelations - relationChangedCount,
    });
  });
  await page.route(
    /.*\/workspaces\/workspace-1\/tasks\/bulk\/assignees\/remove$/,
    async (route) => {
      const body = route.request().postDataJSON() as {
        taskIds: string[];
        membershipIds: string[];
      };
      let relationChangedCount = 0;
      for (const task of tasks) {
        if (!body.taskIds.includes(String(task.id))) continue;
        const assignees = task.assignees as Array<{ id: string; user: unknown }>;
        const before = assignees.length;
        task.assignees = assignees.filter((assignee) => !body.membershipIds.includes(assignee.id));
        relationChangedCount += before - (task.assignees as unknown[]).length;
        task.counts = {
          ...(task.counts as Record<string, number>),
          assignees: (task.assignees as unknown[]).length,
        };
        task.updatedAt = now;
      }
      const requestedRelations = body.taskIds.length * body.membershipIds.length;
      await fulfillApi(route, {
        requestedCount: body.taskIds.length,
        changedCount: relationChangedCount > 0 ? body.taskIds.length : 0,
        unchangedCount: relationChangedCount > 0 ? 0 : body.taskIds.length,
        relationChangedCount,
        relationUnchangedCount: requestedRelations - relationChangedCount,
      });
    },
  );
  await page.route(/.*\/workspaces\/workspace-1\/tasks\/bulk$/, async (route) => {
    const body = route.request().postDataJSON() as { taskIds: string[] };
    const before = tasks.length;
    for (let index = tasks.length - 1; index >= 0; index -= 1) {
      if (body.taskIds.includes(String(tasks[index].id))) tasks.splice(index, 1);
    }
    const changedCount = before - tasks.length;
    await fulfillApi(route, {
      requestedCount: body.taskIds.length,
      changedCount,
      unchangedCount: body.taskIds.length - changedCount,
    });
  });
  await page.route(
    /.*\/workspaces\/workspace-1\/tasks\/([^/]+)\/subtasks(\?.*)?$/,
    async (route) => {
      const url = new URL(route.request().url());
      const parentTaskId = url.pathname.split('/').at(-2) ?? '';
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON() as {
          title: string;
          dueAt: string;
          assigneeMembershipIds?: string[];
        };
        const parent = findTask(parentTaskId);
        if (!parent) {
          await fulfillApi(route, { message: 'Not found' }, 404);
          return;
        }
        const task = {
          id: `task-subtask-${tasks.length + 1}`,
          workspaceId: 'workspace-1',
          title: body.title,
          description: null,
          priority: 'MEDIUM',
          kanbanRank: String((tasks.length + 1) * 1024),
          status: taskStatus,
          department: null,
          dueAt: body.dueAt,
          assignees: users
            .filter((user) => body.assigneeMembershipIds?.includes(user.membershipId))
            .map((user) => ({
              id: user.membershipId,
              user: { id: user.id, email: user.email, name: user.name },
            })),
          followers: [],
          projects: [],
          counts: {
            assignees: body.assigneeMembershipIds?.length ?? 0,
            followers: 0,
            projects: 0,
          },
          parentTaskId,
          directSubtaskCount: 0,
          blockedByCount: 0,
          blocksCount: 0,
          relatedTaskCount: 0,
          createdAt: now,
          updatedAt: now,
        };
        tasks.push(task);
        await fulfillApi(route, taskWithCounts(task));
        return;
      }
      await fulfillApi(
        route,
        pageResult(
          tasks.filter((task) => task.parentTaskId === parentTaskId),
          route.request().url(),
        ),
      );
    },
  );
  await page.route(/.*\/workspaces\/workspace-1\/tasks\/([^/]+)\/parent$/, async (route) => {
    const url = new URL(route.request().url());
    const taskId = url.pathname.split('/').at(-2) ?? '';
    const body = route.request().postDataJSON() as { parentTaskId: string | null };
    const task = findTask(taskId);
    if (!task) {
      await fulfillApi(route, { message: 'Not found' }, 404);
      return;
    }
    task.parentTaskId = body.parentTaskId;
    task.updatedAt = now;
    await fulfillApi(route, taskWithCounts(task));
  });
  await page.route(/.*\/workspaces\/workspace-1\/tasks\/kanban\/settings$/, async (route) => {
    await fulfillApi(route, {
      columns: taskStatuses.map((status) => ({
        status,
        wipLimit: status.id === 'status-task-completed' ? 1 : null,
      })),
    });
  });
  await page.route(
    /.*\/workspaces\/workspace-1\/tasks\/kanban\/columns\/([^/]+)$/,
    async (route) => {
      const statusDefinitionId = route.request().url().split('/').pop() ?? '';
      const body = route.request().postDataJSON() as { wipLimit: number | null };
      await fulfillApi(route, { statusDefinitionId, wipLimit: body.wipLimit ?? null });
    },
  );
  await page.route(
    /.*\/workspaces\/workspace-1\/tasks\/([^/]+)\/kanban-position$/,
    async (route) => {
      const taskId =
        route
          .request()
          .url()
          .match(/tasks\/([^/]+)\/kanban-position/)?.[1] ?? '';
      const body = route.request().postDataJSON() as { statusDefinitionId: string };
      const task = findTask(taskId);
      const nextStatus = taskStatuses.find((status) => status.id === body.statusDefinitionId);
      if (!task || !nextStatus) {
        await fulfillApi(route, { message: 'Not found' }, 404);
        return;
      }
      task.status = nextStatus;
      task.kanbanRank = String((tasks.length + 10) * 1024);
      task.updatedAt = now;
      await fulfillApi(route, taskWithCounts(task));
    },
  );
  await page.route(
    /.*\/workspaces\/workspace-1\/tasks\/([^/]+)\/blocked-by(\/remove)?(\?.*)?$/,
    async (route) => {
      const url = new URL(route.request().url());
      const parts = url.pathname.split('/');
      const taskId = parts.at(-1) === 'remove' ? (parts.at(-3) ?? '') : (parts.at(-2) ?? '');
      const blockers = dependencies.get(taskId) ?? new Set<string>();
      dependencies.set(taskId, blockers);
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON() as { taskIds: string[] };
        let changedCount = 0;
        if (body.taskIds.includes('task-seed-alpha')) {
          await route.fulfill({
            status: 409,
            contentType: 'application/json',
            headers: apiHeaders,
            body: JSON.stringify({
              code: 'TASK_DEPENDENCY_CYCLE',
              message: 'Dependency cycle detected.',
              requestId: 'e2e-cycle',
            }),
          });
          return;
        }
        for (const blockerId of body.taskIds) {
          if (url.pathname.endsWith('/remove')) {
            if (blockers.delete(blockerId)) changedCount += 1;
          } else if (!blockers.has(blockerId)) {
            blockers.add(blockerId);
            changedCount += 1;
          }
        }
        await fulfillApi(route, {
          requestedCount: body.taskIds.length,
          changedCount,
          unchangedCount: body.taskIds.length - changedCount,
        });
        return;
      }
      const items = [...blockers]
        .map((blockerId) => findTask(blockerId))
        .filter((task): task is Record<string, unknown> => Boolean(task));
      await fulfillApi(route, pageResult(items, route.request().url()));
    },
  );
  await page.route(/.*\/workspaces\/workspace-1\/tasks\/([^/]+)\/blocks(\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    const blockerTaskId = url.pathname.split('/').at(-2) ?? '';
    const items = tasks.filter((task) => dependencies.get(String(task.id))?.has(blockerTaskId));
    await fulfillApi(route, pageResult(items, route.request().url()));
  });
  await page.route(
    /.*\/workspaces\/workspace-1\/tasks\/([^/]+)\/related(\/remove)?(\?.*)?$/,
    async (route) => {
      const url = new URL(route.request().url());
      const parts = url.pathname.split('/');
      const taskId = parts.at(-1) === 'remove' ? (parts.at(-3) ?? '') : (parts.at(-2) ?? '');
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON() as { taskIds: string[] };
        let changedCount = 0;
        for (const relatedTaskId of body.taskIds) {
          const key = canonicalRelatedKey(taskId, relatedTaskId);
          if (url.pathname.endsWith('/remove')) {
            if (relatedPairs.delete(key)) changedCount += 1;
          } else if (!relatedPairs.has(key)) {
            relatedPairs.add(key);
            changedCount += 1;
          }
        }
        await fulfillApi(route, {
          requestedCount: body.taskIds.length,
          changedCount,
          unchangedCount: body.taskIds.length - changedCount,
        });
        return;
      }
      const items = [...relatedPairs]
        .map((key) => key.split(':'))
        .filter((pair) => pair.includes(taskId))
        .map((pair) => findTask(pair.find((id) => id !== taskId) ?? ''))
        .filter((task): task is Record<string, unknown> => Boolean(task));
      await fulfillApi(route, pageResult(items, route.request().url()));
    },
  );
  await page.route(
    /.*\/workspaces\/workspace-1\/tasks\/([^/]+)\/comments(?:\?.*)?$/,
    async (route) => {
      const request = route.request();
      const taskId = request.url().match(/tasks\/([^/]+)\/comments/)?.[1] ?? '';
      if (request.method() === 'POST') {
        const body = request.postDataJSON() as {
          body: string;
          visibility?: string;
          mentionedMembershipIds?: string[];
        };
        const created = {
          id: `comment-${Date.now()}`,
          workspaceId: 'workspace-1',
          taskId,
          parentCommentId: null,
          body: body.body,
          visibility: body.visibility ?? 'NORMAL',
          deleted: false,
          editedAt: null,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
          author: {
            membershipId: 'workspace-membership-1',
            userId: 'user-1',
            name: 'Owner',
            email: 'owner@zeaplay.test',
          },
          mentions: (body.mentionedMembershipIds ?? []).map((membershipId) => {
            const member = users.find((user) => user.membershipId === membershipId);
            return {
              membershipId,
              userId: member?.id ?? membershipId,
              name: member?.name ?? null,
              email: member?.email ?? `${membershipId}@zeaplay.test`,
            };
          }),
          directReplyCount: 0,
          reactionCounts: emptyReactionCounts(),
          currentUserReactions: [],
        };
        const next = taskComments(taskId);
        next.push(created);
        comments.set(taskId, next);
        recomputeCommentCounts(taskId);
        await fulfillApi(route, created, 201);
        return;
      }
      recomputeCommentCounts(taskId);
      await fulfillApi(route, pageComments(visibleComments(taskId, null), request.url()));
    },
  );
  await page.route(
    /.*\/workspaces\/workspace-1\/tasks\/([^/]+)\/comments\/([^/]+)\/replies(?:\?.*)?$/,
    async (route) => {
      const request = route.request();
      const match = request.url().match(/tasks\/([^/]+)\/comments\/([^/]+)\/replies/);
      const taskId = match?.[1] ?? '';
      const commentId = match?.[2] ?? '';
      if (request.method() === 'POST') {
        const body = request.postDataJSON() as { body: string; visibility?: string };
        const created = {
          id: `reply-${Date.now()}`,
          workspaceId: 'workspace-1',
          taskId,
          parentCommentId: commentId,
          body: body.body,
          visibility: body.visibility ?? 'NORMAL',
          deleted: false,
          editedAt: null,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
          author: {
            membershipId: 'workspace-membership-1',
            userId: 'user-1',
            name: 'Owner',
            email: 'owner@zeaplay.test',
          },
          mentions: [],
          directReplyCount: 0,
          reactionCounts: emptyReactionCounts(),
          currentUserReactions: [],
        };
        taskComments(taskId).push(created);
        recomputeCommentCounts(taskId);
        await fulfillApi(route, created, 201);
        return;
      }
      recomputeCommentCounts(taskId);
      await fulfillApi(route, pageComments(visibleComments(taskId, commentId), request.url()));
    },
  );
  await page.route(
    /.*\/workspaces\/workspace-1\/tasks\/([^/]+)\/comments\/([^/]+)\/reactions(\/remove)?$/,
    async (route) => {
      const request = route.request();
      const match = request.url().match(/tasks\/([^/]+)\/comments\/([^/]+)\/reactions/);
      const taskId = match?.[1] ?? '';
      const commentId = match?.[2] ?? '';
      const reactionType = (request.postDataJSON() as { reactionType: string }).reactionType;
      const comment = taskComments(taskId).find((item) => item.id === commentId);
      if (comment) {
        const counts = comment.reactionCounts as Record<string, number>;
        const current = new Set(comment.currentUserReactions as string[]);
        if (request.url().endsWith('/remove')) {
          if (current.delete(reactionType)) {
            counts[reactionType] = Math.max(0, (counts[reactionType] ?? 0) - 1);
          }
        } else if (!current.has(reactionType)) {
          current.add(reactionType);
          counts[reactionType] = (counts[reactionType] ?? 0) + 1;
        }
        comment.currentUserReactions = [...current];
      }
      await fulfillApi(route, { changed: true, reactionType });
    },
  );
  await page.route(
    /.*\/workspaces\/workspace-1\/tasks\/([^/]+)\/comments\/([^/]+)$/,
    async (route) => {
      const request = route.request();
      const match = request.url().match(/tasks\/([^/]+)\/comments\/([^/]+)$/);
      const taskId = match?.[1] ?? '';
      const commentId = match?.[2] ?? '';
      const comment = taskComments(taskId).find((item) => item.id === commentId);
      if (!comment) {
        await fulfillApi(route, { message: 'Not found' }, 404);
        return;
      }
      if (request.method() === 'PATCH') {
        const body = request.postDataJSON() as { body: string };
        comment.body = body.body;
        comment.editedAt = now;
        await fulfillApi(route, comment);
        return;
      }
      if (request.method() === 'DELETE') {
        comment.body = null;
        comment.deleted = true;
        comment.deletedAt = now;
        await fulfillApi(route, comment);
        return;
      }
      await fulfillApi(route, comment);
    },
  );
  await page.route(
    /.*\/workspaces\/workspace-1\/tasks\/([^/]+)\/tags(\/add|\/remove)?$/,
    async (route) => {
      const request = route.request();
      const match = request.url().match(/tasks\/([^/]+)\/tags/);
      const taskId = match?.[1] ?? '';
      const current = taskTags.get(taskId) ?? new Set<string>();
      taskTags.set(taskId, current);
      if (request.method() === 'POST') {
        const body = request.postDataJSON() as { tagIds: string[] };
        let changedCount = 0;
        for (const tagId of body.tagIds) {
          if (request.url().endsWith('/remove')) {
            if (current.delete(tagId)) changedCount += 1;
          } else {
            const tag = tags.find((item) => item.id === tagId);
            if (!tag || tag.status === 'ARCHIVED') continue;
            if (!current.has(tagId)) {
              current.add(tagId);
              changedCount += 1;
            }
          }
        }
        await fulfillApi(route, {
          requestedCount: body.tagIds.length,
          changedCount,
          unchangedCount: body.tagIds.length - changedCount,
        });
        return;
      }
      await fulfillApi(
        route,
        [...current]
          .map((tagId) => tags.find((tag) => tag.id === tagId))
          .filter((tag): tag is Record<string, unknown> => Boolean(tag)),
      );
    },
  );
  await page.route(
    /.*\/workspaces\/workspace-1\/tasks\/([^/]+)\/attachments\/([^/?]+)(\?.*)?$/,
    async (route) => {
      const request = route.request();
      const match = request.url().match(/tasks\/([^/]+)\/attachments\/([^/?]+)/);
      const taskId = match?.[1] ?? '';
      const attachmentId = match?.[2] ?? '';
      if (attachmentId === 'url' || attachmentId === 'link' || attachmentId === 'upload-init') {
        await route.fallback();
        return;
      }
      const current = attachments.get(taskId) ?? [];
      if (request.method() === 'DELETE') {
        const index = current.findIndex((attachment) => attachment.id === attachmentId);
        if (index >= 0) current.splice(index, 1);
        await fulfillApi(route, { changed: index >= 0 });
        return;
      }
      await fulfillApi(route, { message: 'Not found' }, 404);
    },
  );
  await page.route(
    /.*\/workspaces\/workspace-1\/tasks\/([^/]+)\/attachments(\/url)?(\?.*)?$/,
    async (route) => {
      const request = route.request();
      const match = request.url().match(/tasks\/([^/]+)\/attachments/);
      const taskId = match?.[1] ?? '';
      const current = attachments.get(taskId) ?? [];
      attachments.set(taskId, current);
      if (request.method() === 'POST' && request.url().includes('/attachments/url')) {
        const body = request.postDataJSON() as { url: string; displayName?: string };
        const attachment = {
          id: `attachment-url-${current.length + 1}`,
          workspaceId: 'workspace-1',
          taskId,
          type: 'URL',
          displayName: body.displayName || body.url,
          url: body.url,
          file: null,
          attachedAt: now,
          createdAt: now,
          updatedAt: now,
        };
        current.unshift(attachment);
        await fulfillApi(route, attachment, 201);
        return;
      }
      await fulfillApi(route, pageResult(current, request.url()));
    },
  );
  await page.route(/.*\/workspaces\/workspace-1\/tasks\/recurrence(\?.*)?$/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const search = url.searchParams.get('search')?.toLowerCase() ?? '';
    const status = url.searchParams.get('status');
    const pageNumber = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? 20);
    const filtered = recurrenceSeries.filter((series) => {
      if (status && series.status !== status) return false;
      if (search && !String(series.title).toLowerCase().includes(search)) return false;
      return true;
    });
    await fulfillApi(route, {
      items: filtered.slice((pageNumber - 1) * pageSize, pageNumber * pageSize),
      page: pageNumber,
      pageSize,
      total: filtered.length,
    });
  });
  await page.route(
    /.*\/workspaces\/workspace-1\/tasks\/recurrence\/([^/]+)\/(pause|resume|end)$/,
    async (route) => {
      const match = route
        .request()
        .url()
        .match(/recurrence\/([^/]+)\/(pause|resume|end)$/);
      const series = recurrenceSeries.find((item) => item.id === match?.[1]);
      if (!series) {
        await fulfillApi(route, { message: 'Not found' }, 404);
        return;
      }
      const action = match?.[2];
      series.status = action === 'pause' ? 'PAUSED' : action === 'resume' ? 'ACTIVE' : 'ENDED';
      if (action === 'end') series.endedAt = now;
      series.updatedAt = now;
      await fulfillApi(route, series);
    },
  );
  await page.route(/.*\/workspaces\/workspace-1\/tasks\/templates(\?.*)?$/, async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>;
      const template = {
        id: `template-${templates.length + 1}`,
        workspaceId: 'workspace-1',
        name: body.name,
        title: body.title,
        description: body.description ?? null,
        priority: body.priority ?? 'MEDIUM',
        status: 'ACTIVE',
        statusDefinitionId: body.statusDefinitionId ?? taskStatus.id,
        departmentId: body.departmentId ?? null,
        assigneeMembershipIds: body.assigneeMembershipIds ?? [],
        followerMembershipIds: body.followerMembershipIds ?? [],
        projectIds: body.projectIds ?? [],
        tagIds: body.tagIds ?? [],
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      templates.unshift(template);
      await fulfillApi(route, template, 201);
      return;
    }
    const url = new URL(request.url());
    const search = url.searchParams.get('search')?.toLowerCase() ?? '';
    const status = url.searchParams.get('status');
    const pageNumber = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? 20);
    const filtered = templates.filter((template) => {
      if (status && template.status !== status) return false;
      if (search && !String(template.name).toLowerCase().includes(search)) return false;
      return true;
    });
    await fulfillApi(route, {
      items: filtered.slice((pageNumber - 1) * pageSize, pageNumber * pageSize),
      page: pageNumber,
      pageSize,
      total: filtered.length,
    });
  });
  await page.route(
    /.*\/workspaces\/workspace-1\/tasks\/templates\/([^/]+)(\/archive|\/reactivate)?$/,
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const parts = url.pathname.split('/');
      const templateId =
        parts.at(-1) === 'archive' || parts.at(-1) === 'reactivate' ? parts.at(-2) : parts.at(-1);
      const template = templates.find((item) => item.id === templateId);
      if (!template) {
        await fulfillApi(route, { message: 'Not found' }, 404);
        return;
      }
      if (url.pathname.endsWith('/archive')) {
        template.status = 'ARCHIVED';
        template.archivedAt = now;
      } else if (url.pathname.endsWith('/reactivate')) {
        template.status = 'ACTIVE';
        template.archivedAt = null;
      } else if (request.method() === 'PATCH') {
        Object.assign(template, request.postDataJSON(), { updatedAt: now });
      }
      await fulfillApi(route, template);
    },
  );
  await page.route(/.*\/workspaces\/workspace-1\/tasks\/([^/]+)\/recurrence$/, async (route) => {
    const request = route.request();
    const taskId = request.url().match(/tasks\/([^/]+)\/recurrence/)?.[1] ?? '';
    const task = findTask(taskId);
    if (!task) {
      await fulfillApi(route, { message: 'Not found' }, 404);
      return;
    }
    const body = request.postDataJSON() as Record<string, unknown>;
    const series = {
      id: `series-${recurrenceSeries.length + 1}`,
      workspaceId: 'workspace-1',
      status: 'ACTIVE',
      title: task.title,
      description: task.description,
      priority: task.priority,
      statusDefinitionId: (task.status as { id: string }).id,
      departmentId: null,
      timezone: body.timezone,
      frequency: body.frequency,
      interval: body.interval ?? 1,
      customIntervalUnit: body.customIntervalUnit ?? null,
      startLocalDate: body.startLocalDate,
      localTime: body.localTime,
      selectedWeekdays: body.selectedWeekdays ?? [],
      monthlyDay: body.monthlyDay ?? null,
      endMode: body.endMode,
      untilLocalDate: body.untilLocalDate ?? null,
      maxOccurrences: body.maxOccurrences ?? null,
      nextOccurrenceAt: '2026-09-22T03:30:00.000Z',
      lastGeneratedAt: now,
      generatedCount: 1,
      endedAt: null,
      lastErrorCode: null,
      assigneeMembershipIds: [],
      followerMembershipIds: [],
      projectIds: [],
      tagIds: [],
      createdAt: now,
      updatedAt: now,
    };
    recurrenceSeries.unshift(series);
    task.recurrenceSeriesId = series.id;
    task.recurrenceScheduledFor = '2026-09-22T03:30:00.000Z';
    task.recurrenceSequence = 1;
    task.recurrenceIsException = false;
    await fulfillApi(route, taskWithCounts(task));
  });
  await page.route(/.*\/workspaces\/workspace-1\/tasks\/([^/]+)\/templates$/, async (route) => {
    const taskId =
      route
        .request()
        .url()
        .match(/tasks\/([^/]+)\/templates/)?.[1] ?? '';
    const task = findTask(taskId);
    const body = route.request().postDataJSON() as { name: string };
    if (!task) {
      await fulfillApi(route, { message: 'Not found' }, 404);
      return;
    }
    const template = {
      id: `template-${templates.length + 1}`,
      workspaceId: 'workspace-1',
      name: body.name,
      title: task.title,
      description: task.description,
      priority: task.priority,
      status: 'ACTIVE',
      statusDefinitionId: (task.status as { id: string }).id,
      departmentId: null,
      assigneeMembershipIds: [],
      followerMembershipIds: [],
      projectIds: [],
      tagIds: [],
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    templates.unshift(template);
    await fulfillApi(route, template, 201);
  });
  await page.route(
    /.*\/workspaces\/workspace-1\/tasks\/(?!(bulk|recurrence|templates)(\?|$))[^/]+$/,
    async (route) => {
      const taskId = route.request().url().split('/').pop();
      const task = tasks.find((item) => item.id === taskId);
      if (!task) {
        await fulfillApi(route, { message: 'Not found' }, 404);
        return;
      }
      if (route.request().method() === 'PATCH') {
        Object.assign(task, route.request().postDataJSON(), { updatedAt: now });
      }
      await fulfillApi(route, {
        ...taskWithCounts(task),
        createdBy: { id: 'admin-1', email: 'admin@zeaplay.test', name: 'Admin' },
        updatedBy: { id: 'admin-1', email: 'admin@zeaplay.test', name: 'Admin' },
      });
    },
  );
  await page.route(/.*\/workspaces\/workspace-1\/tasks(\?.*)?$/, async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as {
        title: string;
        dueAt: string;
        assigneeMembershipIds: string[];
        recurrence?: Record<string, unknown>;
      };
      const task = {
        id: 'task-e2e',
        workspaceId: 'workspace-1',
        title: body.title,
        description: null,
        priority: 'MEDIUM',
        kanbanRank: String((tasks.length + 1) * 1024),
        status: taskStatus,
        department: null,
        dueAt: body.dueAt,
        assignees: users
          .filter((user) => body.assigneeMembershipIds.includes(user.membershipId))
          .map((user) => ({
            id: user.membershipId,
            user: { id: user.id, email: user.email, name: user.name },
          })),
        followers: [],
        projects: [],
        counts: { assignees: body.assigneeMembershipIds.length, followers: 0, projects: 0 },
        recurrenceSeriesId: null,
        recurrenceScheduledFor: null,
        recurrenceSequence: null,
        recurrenceIsException: false,
        createdAt: now,
        updatedAt: now,
      };
      if (body.recurrence) {
        const series = {
          id: `series-${recurrenceSeries.length + 1}`,
          workspaceId: 'workspace-1',
          status: 'ACTIVE',
          title: body.title,
          description: null,
          priority: 'MEDIUM',
          statusDefinitionId: taskStatus.id,
          departmentId: null,
          timezone: body.recurrence.timezone,
          frequency: body.recurrence.frequency,
          interval: body.recurrence.interval ?? 1,
          customIntervalUnit: body.recurrence.customIntervalUnit ?? null,
          startLocalDate: body.recurrence.startLocalDate,
          localTime: body.recurrence.localTime,
          selectedWeekdays: body.recurrence.selectedWeekdays ?? [],
          monthlyDay: body.recurrence.monthlyDay ?? null,
          endMode: body.recurrence.endMode,
          untilLocalDate: body.recurrence.untilLocalDate ?? null,
          maxOccurrences: body.recurrence.maxOccurrences ?? null,
          nextOccurrenceAt: '2026-09-23T03:30:00.000Z',
          lastGeneratedAt: now,
          generatedCount: 1,
          endedAt: null,
          lastErrorCode: null,
          assigneeMembershipIds: body.assigneeMembershipIds,
          followerMembershipIds: [],
          projectIds: [],
          tagIds: [],
          createdAt: now,
          updatedAt: now,
        };
        recurrenceSeries.unshift(series);
        task.recurrenceSeriesId = series.id;
        task.recurrenceScheduledFor = '2026-09-22T03:30:00.000Z';
        task.recurrenceSequence = 1;
      }
      tasks.unshift(task);
      await fulfillApi(route, task);
      return;
    }
    const url = new URL(route.request().url());
    const search = url.searchParams.get('search')?.toLowerCase() ?? '';
    const statusDefinitionId = url.searchParams.get('statusDefinitionId');
    const tagId = url.searchParams.get('tagId');
    const pageNumber = Number(url.searchParams.get('page') ?? 1);
    const pageSize = Number(url.searchParams.get('pageSize') ?? 20);
    const filtered = tasks.filter((task) => {
      if (search && !String(task.title).toLowerCase().includes(search)) return false;
      if (
        statusDefinitionId &&
        (task.status as { id?: string } | undefined)?.id !== statusDefinitionId
      ) {
        return false;
      }
      if (tagId && !taskTags.get(String(task.id))?.has(tagId)) return false;
      return true;
    });
    await fulfillApi(route, {
      items: filtered.slice((pageNumber - 1) * pageSize, pageNumber * pageSize),
      page: pageNumber,
      pageSize,
      total: filtered.length,
    });
  });
  await page.route(/.*\/workspaces\/workspace-2\/tasks(\?.*)?$/, async (route) => {
    await fulfillApi(route, { items: [], page: 1, pageSize: 25, total: 0 });
  });
}

async function mockProjectUiApi(page: Page) {
  const now = new Date().toISOString();
  const projectStatus = {
    id: 'status-project-todo',
    workspaceId: 'workspace-1',
    entityType: 'PROJECT',
    name: 'Planned',
    description: null,
    color: '#2563EB',
    position: 1,
    category: 'TODO',
    isDefault: true,
    isTerminal: false,
    isActive: true,
    isSystem: false,
    createdAt: now,
    updatedAt: now,
  };
  const owner = {
    id: 'membership-anya',
    status: 'ACTIVE',
    user: { id: 'user-anya', email: 'anya@zeaplay.test', name: 'Anya' },
  };
  const project = {
    id: 'project-e2e',
    workspaceId: 'workspace-1',
    name: 'Project UI E2E',
    description: 'Project UI integration journey',
    statusDefinitionId: projectStatus.id,
    status: { id: projectStatus.id, name: 'Planned', color: '#2563EB', terminal: false },
    priority: 'MEDIUM',
    visibility: 'WORKSPACE',
    calculatedProgress: 0,
    manualProgressPercent: null,
    manualProgressUpdatedAt: null,
    effectiveProgress: 0,
    taskCounts: { totalTasks: 1, openTasks: 1, completedTasks: 0, overdueTasks: 0 },
    plannedStartAt: null,
    dueAt: now,
    departmentId: null,
    department: null,
    ownerMembershipId: owner.id,
    owner,
    memberCount: 0,
    createdById: 'user-1',
    createdAt: now,
    updatedAt: now,
  };
  const report = {
    project: { id: project.id, name: project.name },
    timezone: 'UTC',
    filters: {},
    kpis: {
      totalTasks: 1,
      openTasks: 1,
      completedTasks: 0,
      overdueTasks: 0,
      pendingApprovalTasks: 0,
      completionRate: 0,
      estimatedMinutes: 30,
      trackedSeconds: null,
      trackedTimeAvailable: false,
    },
    progress: {
      calculatedProgress: 0,
      manualProgressPercent: null,
      effectiveProgress: 0,
    },
    distributions: {
      status: [
        {
          statusDefinitionId: 'status-task-todo',
          name: 'To Do',
          color: '#2563EB',
          terminal: false,
          count: 1,
        },
      ],
      priority: [{ priority: 'HIGH', count: 1 }],
      assignees: [],
      departments: [],
    },
    completionTrend: [],
    semantics: {
      dateRange: 'Task due date',
      assigneeBreakdown: 'Assignments are counted independently.',
      completionTrend: 'AuditLog terminal events.',
      multiProject: 'Tasks contribute to each linked Project.',
    },
  };

  await page.route(/.*\/workspaces\/workspace-1\/statuses\/PROJECT(\?.*)?$/, async (route) => {
    await fulfillApi(route, [projectStatus]);
  });
  await page.route(/.*\/workspaces\/workspace-1\/projects(\?.*)?$/, async (route) => {
    if (route.request().method() === 'POST') {
      await fulfillApi(route, project, 201);
      return;
    }
    await fulfillApi(route, { items: [project], page: 1, pageSize: 20, total: 1 });
  });
  await page.route(/.*\/workspaces\/workspace-1\/projects\/project-e2e$/, async (route) => {
    await fulfillApi(route, project);
  });
  await page.route(/.*\/workspaces\/workspace-1\/projects\/project-e2e\/tags$/, async (route) => {
    await fulfillApi(route, []);
  });
  await page.route(
    /.*\/workspaces\/workspace-1\/projects\/project-e2e\/members(\?.*)?$/,
    async (route) => {
      await fulfillApi(route, { items: [], page: 1, pageSize: 20, total: 0 });
    },
  );
  await page.route(
    /.*\/workspaces\/workspace-1\/projects\/project-e2e\/attachments(\?.*)?$/,
    async (route) => {
      await fulfillApi(route, { items: [], page: 1, pageSize: 20, total: 0 });
    },
  );
  await page.route(
    /.*\/workspaces\/workspace-1\/projects\/project-e2e\/activity(\?.*)?$/,
    async (route) => {
      await fulfillApi(route, { items: [], page: 1, pageSize: 20, total: 0 });
    },
  );
  await page.route(
    /.*\/workspaces\/workspace-1\/projects\/project-e2e\/reports(\?.*)?$/,
    async (route) => {
      await fulfillApi(route, report);
    },
  );
}

test('application boots and login route loads', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('dashboard route requires authentication', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login$/);
});

test('protected dashboard routes redirect unauthenticated users', async ({ page }) => {
  for (const path of [
    '/developer/dashboard',
    '/super-admin/dashboard',
    '/agency/dashboard',
    '/workspace/dashboard',
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
  }
});

test('authenticated workspace shell supports tenant, theme, language, and mobile navigation', async ({
  page,
}) => {
  await mockAuthenticatedSession(page);
  await page.goto('/workspace/dashboard');
  await expect(page.getByRole('heading', { name: 'Workspace Dashboard' })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByText('Agency One').first()).toBeVisible();

  const agencySelector = page.getByText('Agency One').first();
  await agencySelector.click();
  await page.getByRole('option', { name: 'Agency Two' }).click();
  await expect(page.getByText('Workspace Two').first()).toBeVisible();

  await page.getByRole('button', { name: 'Colorful' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'colorful');

  await page.getByRole('button', { name: 'தமிழ்' }).click();
  await expect(page.getByText('டாஷ்போர்டு அடித்தளம் தயார்')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /வழிசெலுத்தலை திற|open navigation/i }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('authenticated role management supports custom roles and permission assignment UI', async ({
  page,
}) => {
  await mockAuthenticatedSession(page);
  await mockRoleManagementApi(page);

  await page.goto('/workspace/roles');
  await expect(page.getByRole('heading', { name: 'Roles & Permissions' })).toBeVisible();
  await page.getByRole('button', { name: /create role/i }).click();
  await page.getByLabel('Role name').fill('QA Lead');
  await page.getByLabel('Description').fill('Owns release quality');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('QA Lead').first()).toBeVisible();

  await page
    .getByRole('button', { name: /QA Lead/ })
    .first()
    .click();
  await page.getByLabel('Manage workspace users').click();
  await expect(page.getByRole('button', { name: /save permissions/i })).toBeEnabled();
  await page.getByRole('button', { name: /save permissions/i }).click();

  await page.getByRole('button', { name: /clone/i }).last().click();
  await page.getByRole('button', { name: 'Clone' }).click();
  await expect(page.getByText('QA Lead Copy').first()).toBeVisible();

  await page.goto('/workspace/users');
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
  await expect(page.getByText('Member One').first()).toBeVisible();
  await page.getByRole('combobox', { name: 'Role' }).nth(1).click();
  await expect(page.getByRole('option', { name: 'QA Lead', exact: true })).toBeVisible();
});

test('authenticated status management supports workspace status lifecycle UI', async ({ page }) => {
  await mockAuthenticatedSession(page);
  await mockStatusManagementApi(page);

  await page.goto('/workspace/statuses');
  await expect(page.getByRole('heading', { name: 'Status Management' })).toBeVisible();
  await expect(page.getByText('To Do').first()).toBeVisible();

  await page.getByRole('tab', { name: 'Project Pipeline' }).click();
  await expect(page.getByText('Client Review').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Ticket Statuses' }).click();
  await expect(page.getByText('Closed').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Task Statuses' }).click();

  await page.getByRole('button', { name: /create task status/i }).click();
  await page.getByLabel('Name').fill('Blocked');
  await page.getByLabel('Description').fill('Waiting on a dependency');
  await page.getByRole('textbox', { name: 'Color' }).fill('#DC2626');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText('Blocked').first()).toBeVisible();

  await page.getByRole('button', { name: 'Actions: In Progress' }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  await page.getByLabel('Name').fill('Doing');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Doing').first()).toBeVisible();

  await page.getByRole('button', { name: 'Actions: Doing' }).click();
  await page.getByRole('menuitem', { name: 'Set as Default' }).click();
  await expect(page.getByText('Current Default:')).toBeVisible();
  await page.getByRole('button', { name: 'Set as Default' }).click();
  await expect(
    page.locator('.p-0').filter({ hasText: 'Doing' }).getByText('Default'),
  ).toBeVisible();

  const doingCard = page.locator('.p-0').filter({ hasText: 'Doing' }).first();
  await doingCard.getByRole('button', { name: /move up/i }).click();
  await page.reload();
  await expect(page.getByText('Doing').first()).toBeVisible();
  await expect(page.getByText('To Do').first()).toBeVisible();
  const doingBox = await page.getByText('Doing').first().boundingBox();
  const todoBox = await page.getByText('To Do').first().boundingBox();
  expect(doingBox?.y ?? 0).toBeLessThan(todoBox?.y ?? Number.MAX_SAFE_INTEGER);
});

test('authenticated Project UI journey creates a Project and opens each detail tab', async ({
  page,
}) => {
  await mockAuthenticatedSession(page);
  await mockTaskCreationApi(page);
  await page.unroute(/.*\/projects(\?.*)?$/);
  await mockProjectUiApi(page);

  await page.goto('/workspace/projects');
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Project UI E2E/ })).toBeVisible();

  await page.getByRole('button', { name: 'Create Project' }).click();
  await page.getByLabel('Project Name').fill('Project UI E2E');
  await page.getByRole('button', { name: 'Create Project' }).last().click();
  await expect(page).toHaveURL(/\/workspace\/projects\/project-e2e$/);
  await expect(page.getByRole('heading', { name: 'Project UI E2E' })).toBeVisible();
  await expect(page.getByText('Effective Progress').first()).toBeVisible();

  const tabs = [
    ['Project Tasks', 'tasks'],
    ['Project Kanban', 'kanban'],
    ['Project Timeline', 'timeline'],
    ['Files', 'files'],
    ['Project Members', 'members'],
    ['Activity', 'activity'],
    ['Project Reports', 'reports'],
  ] as const;

  for (const [name, tab] of tabs) {
    await page.getByRole('tab', { name }).click();
    await expect(page).toHaveURL(new RegExp(`tab=${tab}`));
  }

  await expect(page.getByText('Total Tasks').first()).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Project Reports' })).toBeVisible();
});

test('authenticated task creation supports the quick-create flow', async ({ page }) => {
  await mockAuthenticatedSession(page);
  await mockTaskCreationApi(page);

  await page.goto('/workspace/tasks');
  await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create Task' }).click();
  await expect(page.getByLabel('Title *')).toBeVisible();
  await expect(page.getByLabel('Assignee *')).toBeVisible();
  await expect(page.getByLabel('Due Date *')).toBeVisible();
  await expect(page.getByLabel('Description')).toBeHidden();

  await page.getByLabel('Title *').fill('E2E quick task');
  await page.getByRole('button', { name: /Anya/ }).click();
  await page.getByLabel('Due Date *').fill('2026-09-30');
  await page.getByRole('button', { name: 'Create Task' }).click();

  await expect(page.getByText('Task created')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'All Tasks' })).toBeVisible();
  await expect(page.getByText('E2E quick task').first()).toBeVisible();

  await page.goto('/workspace/tasks?search=quick');
  await expect(page).toHaveURL(/search=quick/);
  await expect(page.getByText('E2E quick task').first()).toBeVisible();

  await page.goto('/workspace/tasks?search=quick&status=status-task-todo');
  await expect(page).toHaveURL(/status=status-task-todo/);
  await expect(page.getByText('E2E quick task').first()).toBeVisible();

  await page.getByRole('button', { name: 'Grid' }).click();
  await expect(page).toHaveURL(/view=grid/);
  await expect(page.getByText('E2E quick task').first()).toBeVisible();
  await page.getByRole('button', { name: /Open task details: E2E quick task/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Task details');
  await expect(page.getByRole('dialog')).toContainText('Anya');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();

  await page.getByRole('button', { name: 'Compact' }).click();
  await expect(page).toHaveURL(/view=compact/);
  await expect(page.getByText('E2E quick task').first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Compact' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByText('E2E quick task').first()).toBeVisible();

  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const view of ['List', 'Grid', 'Compact']) {
      await page.getByRole('button', { name: view }).click();
      await expect(page.getByText('E2E quick task').first()).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
    }
  }

  await page.getByText('Agency One').first().click();
  await page.getByRole('option', { name: 'Agency Two' }).click();
  await expect(page.getByText('Workspace Two').first()).toBeVisible();
  await expect(page.getByText('E2E quick task')).toBeHidden();
  await expect(page.getByText('No matching tasks')).toBeVisible();
});

test('authenticated recurrence and template UX supports lifecycle, scope, and reuse', async ({
  page,
}) => {
  await mockAuthenticatedSession(page);
  await mockTaskCreationApi(page);
  page.on('dialog', (dialog) => dialog.accept());

  await page.goto('/workspace/tasks');
  await page.getByRole('button', { name: 'Create Task' }).click();
  await page.getByLabel('Title *').fill('Daily recurring task');
  await page.getByRole('button', { name: /Anya/ }).click();
  await page.getByLabel('Due Date *').fill('2026-09-30');
  await page.getByRole('button', { name: 'Add more details' }).click();
  await page.getByRole('combobox', { name: 'Repeat' }).click();
  await page
    .getByRole('option', { name: 'Daily' })
    .evaluate((element) => (element as HTMLElement).click());
  await page.getByLabel('Start Date').fill('2026-09-20');
  await page.getByRole('textbox', { name: 'Time', exact: true }).fill('09:00');
  await page.getByRole('button', { name: 'Create Task' }).click();
  await expect(page.getByText('Task created')).toBeVisible();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByText('Daily recurring task').first()).toBeVisible();

  await page.getByRole('button', { name: 'Daily recurring task' }).click();
  await expect(page.getByRole('dialog')).toContainText('Recurring');
  await expect(page.getByRole('dialog')).toContainText('Pattern');
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByText('Recurrence updated').first()).toBeVisible();
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByText('Recurrence updated').first()).toBeVisible();
  await page.getByRole('button', { name: 'Edit Task' }).click();
  await expect(page.getByRole('dialog')).toContainText('Apply changes to');
  await page.getByLabel(/This task only/).check();
  await page.getByLabel('Title').fill('Daily recurring edited');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Task updated')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Seed beta task' }).click();
  await page.getByRole('button', { name: 'Make Recurring' }).click();
  await page.getByLabel('Start Date').fill('2026-10-01');
  await page.getByRole('textbox', { name: 'Time', exact: true }).fill('10:00');
  await page.getByRole('button', { name: 'Make Recurring' }).click();
  await expect(page.getByText('Recurrence updated').first()).toBeVisible();
  await page.keyboard.press('Escape');

  await page.goto('/workspace/tasks/recurring');
  await expect(page.getByRole('heading', { name: 'Recurring Tasks' })).toBeVisible();
  await expect(page.getByText('Seed alpha task').first()).toBeVisible();
  await page.getByRole('combobox', { name: 'Series Status' }).click();
  await page
    .getByRole('option', { name: 'Active' })
    .evaluate((element) => (element as HTMLElement).click());
  await expect(page.getByText('Generated Count').first()).toBeVisible();

  await page.goto('/workspace/tasks/templates');
  await expect(page.getByRole('heading', { name: 'Task Templates' })).toBeVisible();
  await expect(page.getByText('Launch template')).toBeVisible();
  await page.getByRole('button', { name: 'Create Template' }).click();
  await page.getByLabel('Template Name').fill('E2E template');
  await page.getByLabel('Title').fill('E2E template task');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Template updated').first()).toBeVisible();
  await page.getByRole('button', { name: 'Use Template' }).first().click();
  await expect(page.getByRole('dialog')).toContainText('Create Task');
  await expect(page.getByLabel('Title *')).toHaveValue(/E2E template task|Templated launch task/);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Archive Template' }).first().click();
  await expect(page.getByText('Template updated').first()).toBeVisible();
  await page.getByRole('combobox', { name: 'Status' }).click();
  await page
    .getByRole('option', { name: 'Archived' })
    .evaluate((element) => (element as HTMLElement).click());
  await page.getByRole('button', { name: 'Reactivate Template' }).first().click();
  await expect(page.getByText('Template updated').first()).toBeVisible();

  await page.goto('/workspace/tasks');
  await page.getByRole('button', { name: 'Seed alpha task' }).click();
  await page.getByRole('button', { name: 'Save as Template' }).click();
  await page.getByLabel('Template Name').fill('Saved from task');
  await page.getByRole('button', { name: 'Save as Template' }).click();
  await expect(page.getByText('Template saved')).toBeVisible();
});

test('authenticated task Kanban supports status columns, fallback move, persistence, and detail open', async ({
  page,
}) => {
  await mockAuthenticatedSession(page);
  await mockTaskCreationApi(page);

  await page.goto('/workspace/tasks?view=kanban');
  await expect(page.getByRole('heading', { name: 'To Do' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Completed' })).toBeVisible();
  await expect(page.getByText('Seed alpha task').first()).toBeVisible();

  await page.getByRole('combobox', { name: 'Move to status' }).first().click();
  await page
    .getByRole('option', { name: 'Completed' })
    .evaluate((element) => (element as HTMLElement).click());
  await expect(page.getByText('Task moved')).toBeVisible();
  await expect(
    page.locator('section', { hasText: 'Completed' }).getByText('Seed alpha task'),
  ).toBeVisible();

  await page.reload();
  await expect(
    page.locator('section', { hasText: 'Completed' }).getByText('Seed alpha task'),
  ).toBeVisible();
  await page
    .locator('section', { hasText: 'Completed' })
    .getByRole('button', { name: 'Open task details: Seed alpha task' })
    .click();
  await expect(page.getByRole('dialog').filter({ hasText: 'Task details' })).toBeVisible();

  await page.setViewportSize({ width: 375, height: 760 });
  await page.goto('/workspace/tasks?view=kanban');
  await expect(page.getByRole('combobox', { name: 'Move to status' }).first()).toBeVisible();
});

test('authenticated task detail tabs lazy-load only the active relationship surface', async ({
  page,
}) => {
  await mockAuthenticatedSession(page);
  await mockTaskCreationApi(page);

  let subtaskRequests = 0;
  let blockedByRequests = 0;
  let blocksRequests = 0;
  let relatedRequests = 0;
  let commentRequests = 0;
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/workspaces/workspace-1/tasks/task-seed-alpha/subtasks')) {
      subtaskRequests += 1;
    }
    if (url.includes('/workspaces/workspace-1/tasks/task-seed-alpha/blocked-by')) {
      blockedByRequests += 1;
    }
    if (url.includes('/workspaces/workspace-1/tasks/task-seed-alpha/blocks')) {
      blocksRequests += 1;
    }
    if (url.includes('/workspaces/workspace-1/tasks/task-seed-alpha/related')) {
      relatedRequests += 1;
    }
    if (url.match(/\/workspaces\/workspace-1\/tasks\/task-seed-alpha\/comments(\?|$)/)) {
      commentRequests += 1;
    }
  });

  await page.goto('/workspace/tasks');
  await page.getByRole('button', { name: 'Seed alpha task' }).click();
  const detailDialog = page.getByRole('dialog').filter({ hasText: 'Task details' });
  await expect(detailDialog).toContainText('Task details');
  await expect(detailDialog.getByText('Bug')).toBeVisible();
  await expect(detailDialog.getByText('Existing Brief')).toBeVisible();
  await expect(detailDialog.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect
    .poll(
      () =>
        subtaskRequests + blockedByRequests + blocksRequests + relatedRequests + commentRequests,
    )
    .toBe(0);

  await detailDialog.getByRole('tab', { name: 'Subtasks' }).click();
  await expect(detailDialog.getByText('No subtasks')).toBeVisible();
  expect(subtaskRequests).toBe(1);
  expect(blockedByRequests + blocksRequests + relatedRequests).toBe(0);

  await detailDialog.getByRole('tab', { name: 'Overview' }).click();
  await expect(detailDialog.getByText('Existing Brief')).toBeVisible();
  expect(subtaskRequests).toBe(1);

  await detailDialog.getByRole('tab', { name: 'Dependencies' }).click();
  await expect(detailDialog.getByText('Blocked By')).toBeVisible();
  await expect(detailDialog.getByText('Blocks')).toBeVisible();
  expect(blockedByRequests).toBe(1);
  expect(blocksRequests).toBe(1);
  expect(relatedRequests).toBe(0);

  await detailDialog.getByRole('tab', { name: 'Related' }).click();
  await expect(
    detailDialog.getByRole('heading', { name: 'Related Tasks', exact: true }),
  ).toBeVisible();
  expect(relatedRequests).toBe(1);
  expect(commentRequests).toBe(0);

  await detailDialog.getByRole('tab', { name: 'Comments' }).click();
  await expect(detailDialog.getByText('Initial discussion note')).toBeVisible();
  expect(commentRequests).toBe(1);

  await detailDialog.getByRole('tab', { name: 'Overview' }).click();
  await expect(detailDialog.getByText('Bug')).toBeVisible();
  await expect(detailDialog.getByText('Existing Brief')).toBeVisible();
  expect(subtaskRequests).toBe(1);
  expect(blockedByRequests).toBe(1);
  expect(blocksRequests).toBe(1);
  expect(relatedRequests).toBe(1);
  expect(commentRequests).toBe(1);
});

test('authenticated task comments support mention, reply, edit, reaction, and tombstone flow', async ({
  page,
}) => {
  await mockAuthenticatedSession(page);
  await mockTaskCreationApi(page);

  await page.goto('/workspace/tasks');
  await page.getByRole('button', { name: 'Seed alpha task' }).click();
  await page.getByRole('tab', { name: 'Comments' }).click();
  await expect(page.getByText('Initial discussion note')).toBeVisible();

  await page.getByLabel('Write a comment').fill('Please review @A');
  await page.getByRole('option', { name: 'Anya' }).click();
  await page.getByRole('checkbox', { name: /Internal comment/i }).click();
  await page.getByRole('button', { name: 'Post comment' }).click();
  await expect(page.getByText('Comment posted')).toBeVisible();
  await expect(page.getByText(/Please review/)).toBeVisible();
  await expect(page.getByText('@Anya').first()).toBeVisible();
  await expect(page.getByText('Internal').first()).toBeVisible();

  await page.getByRole('button', { name: 'Reply' }).last().click();
  await page.getByLabel('Write a reply').fill('Reply from E2E');
  await page.getByRole('button', { name: 'Post reply' }).click();
  await expect(page.getByText('Reply posted')).toBeVisible();
  await expect(page.getByText('Reply from E2E')).toBeVisible();

  await page.getByRole('button', { name: 'Edit' }).first().click();
  await page.getByLabel('Edit comment').fill('Edited E2E discussion note');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Comment updated')).toBeVisible();
  await expect(page.getByText('Edited', { exact: true })).toBeVisible();

  await page
    .getByRole('button', { name: /React with Like/i })
    .first()
    .click();
  await expect(page.getByRole('button', { name: /Remove reaction Like/i }).first()).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete comment' }).first().click();
  await expect(
    page.getByRole('region', { name: 'Comments' }).getByText('Comment deleted'),
  ).toBeVisible();
  await expect(page.getByText('Reply from E2E')).toBeVisible();
});

test('authenticated task tags support assignment, catalog management, and list filtering', async ({
  page,
}) => {
  await mockAuthenticatedSession(page);
  await mockTaskCreationApi(page);

  await page.goto('/workspace/tasks');
  await page.getByRole('button', { name: 'Seed alpha task' }).click();
  const detailDialog = page.getByRole('dialog').filter({ hasText: 'Task details' });
  await expect(detailDialog.getByText('Bug')).toBeVisible();
  await expect(detailDialog.getByText('Legacy')).toBeVisible();
  await expect(detailDialog.getByText('Archived')).toBeVisible();
  await expect(detailDialog.getByText('Existing Brief')).toBeVisible();

  await detailDialog.getByRole('button', { name: 'Add Link' }).click();
  const addLinkDialog = page.getByRole('dialog').filter({ hasText: 'Attach an external URL' });
  await addLinkDialog.getByLabel('URL').fill('https://example.com/phase-7-4d');
  await addLinkDialog.getByLabel('Display name').fill('Phase 7.4D Link');
  await addLinkDialog.getByRole('button', { name: 'Add Link' }).click();
  await expect(page.getByText('Link attached')).toBeVisible();
  await expect(detailDialog.getByText('Phase 7.4D Link')).toBeVisible();
  await expect(detailDialog.getByRole('button', { name: 'Open Link' }).first()).toBeVisible();
  await detailDialog.getByRole('button', { name: 'Remove Phase 7.4D Link from task' }).click();
  await expect(page.getByText('Attachment removed from task')).toBeVisible();
  await expect(detailDialog.getByText('Phase 7.4D Link')).toHaveCount(0);

  await detailDialog.getByRole('button', { name: 'Add Tags' }).click();
  const addTagsDialog = page.getByRole('dialog').filter({ hasText: 'Add Tags' });
  await addTagsDialog.getByRole('textbox', { name: 'Search tags' }).fill('Feature');
  await addTagsDialog.getByRole('option', { name: /Feature/ }).click();
  await addTagsDialog.getByRole('button', { name: 'Add Tags' }).click();
  await expect(page.getByText('1 tags added.')).toBeVisible();
  await expect(detailDialog.getByText('Feature')).toBeVisible();

  await detailDialog.getByRole('button', { name: 'Remove Legacy from task' }).click();
  await expect(page.getByText('1 tag removed.')).toBeVisible();
  await expect(detailDialog.getByText('Legacy')).toHaveCount(0);

  await detailDialog.getByRole('button', { name: 'Manage Tags' }).click();
  const manageTagsDialog = page.getByRole('dialog').filter({ hasText: 'Manage Tags' });
  await manageTagsDialog.getByLabel('Tag Name').fill('QA');
  await manageTagsDialog.getByLabel('Tag Color').fill('#16A34A');
  await manageTagsDialog.getByRole('button', { name: 'Create Tag' }).click();
  await expect(page.getByText('Tag created')).toBeVisible();
  await expect(manageTagsDialog.getByText('QA')).toBeVisible();

  await manageTagsDialog.getByRole('button', { name: 'Edit Tag: QA' }).click();
  await manageTagsDialog.getByLabel('Tag Name').fill('QA Ready');
  await manageTagsDialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Tag updated')).toBeVisible();
  await expect(manageTagsDialog.getByText('QA Ready')).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await manageTagsDialog.getByRole('button', { name: 'Archive: QA Ready' }).click();
  await expect(page.getByText('Tag archived')).toBeVisible();
  await manageTagsDialog.getByRole('combobox', { name: 'Tag status' }).click();
  await page
    .getByRole('option', { name: 'Archived' })
    .evaluate((element) => (element as HTMLElement).click());
  await manageTagsDialog.getByRole('button', { name: 'Reactivate: QA Ready' }).click();
  await expect(page.getByText('Tag reactivated')).toBeVisible();

  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('textbox', { name: 'Search tags' }).fill('Bug');
  await page.getByRole('combobox', { name: 'Filter by Tag' }).click();
  await page
    .getByRole('option', { name: 'Bug' })
    .evaluate((element) => (element as HTMLElement).click());
  await expect(page).toHaveURL(/tagId=tag-bug/);
  await expect(page.getByText('Seed alpha task').first()).toBeVisible();
  await expect(page.getByText('Seed beta task')).toHaveCount(0);
});

test('authenticated task detail supports subtask create, reparent, detach, and mobile widths', async ({
  page,
}) => {
  await mockAuthenticatedSession(page);
  await mockTaskCreationApi(page);

  await page.setViewportSize({ width: 375, height: 760 });
  await page.goto('/workspace/tasks');
  await page.getByRole('button', { name: 'Seed alpha task' }).click();
  await page.getByRole('tab', { name: 'Subtasks' }).click();
  await page.getByRole('button', { name: 'Create Subtask' }).first().click();
  await expect(page.getByLabel('Description')).toHaveCount(0);
  await page.getByLabel('Title *').fill('E2E child task');
  await page.getByLabel('Anya').click();
  await page.getByLabel('Due Date *').fill('2026-10-10');
  await page.getByRole('button', { name: 'Create Subtask' }).click();
  await expect(page.getByText('Subtask created')).toBeVisible();
  await expect(page.getByText('E2E child task')).toBeVisible();
  let overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  await page.getByRole('button', { name: 'Move / Change Parent' }).click();
  await page.getByLabel('New Parent').fill('Seed beta');
  await page.getByRole('button', { name: 'Seed beta task' }).click();
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(page.getByText('Task moved')).toBeVisible();
  await expect(page.getByText('E2E child task')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.getByRole('button', { name: 'Seed beta task' }).click();
  await page.getByRole('tab', { name: 'Subtasks' }).click();
  await expect(page.getByText('E2E child task')).toBeVisible();
  await page.getByRole('button', { name: 'Move / Change Parent' }).click();
  await page.getByText('Move to Root').click();
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(page.getByText('Task moved')).toBeVisible();
  await expect(page.getByText('E2E child task')).toHaveCount(0);
});

test('authenticated task detail supports dependency and related mutations safely', async ({
  page,
}) => {
  await mockAuthenticatedSession(page);
  await mockTaskCreationApi(page);

  let addBlockerRequests = 0;
  let removeBlockerRequests = 0;
  let addRelatedRequests = 0;
  let removeRelatedRequests = 0;
  page.on('request', (request) => {
    const url = request.url();
    if (url.endsWith('/workspaces/workspace-1/tasks/task-seed-alpha/blocked-by')) {
      addBlockerRequests += 1;
    }
    if (url.endsWith('/workspaces/workspace-1/tasks/task-seed-alpha/blocked-by/remove')) {
      removeBlockerRequests += 1;
    }
    if (url.endsWith('/workspaces/workspace-1/tasks/task-seed-alpha/related')) {
      addRelatedRequests += 1;
    }
    if (url.endsWith('/workspaces/workspace-1/tasks/task-seed-alpha/related/remove')) {
      removeRelatedRequests += 1;
    }
  });

  await page.goto('/workspace/tasks');
  await page.getByRole('button', { name: 'Seed alpha task' }).click();
  await page.getByRole('tab', { name: 'Dependencies' }).click();
  await page.getByRole('button', { name: 'Add Blocker' }).first().click();
  const blockerDialog = page.getByRole('dialog').filter({ hasText: 'Add Blocker' });
  await blockerDialog.getByLabel('Search tasks').fill('Seed beta');
  await blockerDialog.getByRole('button', { name: /^Seed beta task/ }).click();
  await blockerDialog.getByRole('button', { name: 'Add Blocker' }).click();
  await expect(page.getByText('1 blockers added.')).toBeVisible();
  expect(addBlockerRequests).toBe(1);
  await expect(
    page.getByRole('button', { name: 'Open task details: Seed beta task' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Open task details: Seed beta task' }).click();
  await page.getByRole('tab', { name: 'Dependencies' }).click();
  await expect(
    page.getByRole('button', { name: 'Open task details: Seed alpha task' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Open task details: Seed alpha task' }).click();
  await page.getByRole('tab', { name: 'Dependencies' }).click();
  await page.getByRole('button', { name: /Remove Blocker:/ }).click();
  await expect(page.getByText('1 blockers removed.')).toBeVisible();
  expect(removeBlockerRequests).toBe(1);

  await page.getByRole('tab', { name: 'Related' }).click();
  await page.getByRole('button', { name: 'Add Related Task' }).first().click();
  const relatedDialog = page.getByRole('dialog').filter({ hasText: 'Add Related Task' });
  await relatedDialog.getByLabel('Search tasks').fill('Seed beta');
  await relatedDialog.getByRole('button', { name: /^Seed beta task/ }).click();
  await relatedDialog.getByRole('button', { name: 'Add Related Task' }).click();
  await expect(page.getByText('1 related tasks added.')).toBeVisible();
  expect(addRelatedRequests).toBe(1);
  await expect(
    page.getByRole('button', { name: 'Open task details: Seed beta task' }),
  ).toBeVisible();
  await page.getByRole('button', { name: /Remove Related Task:/ }).click();
  await expect(page.getByText('1 related tasks removed.')).toBeVisible();
  expect(removeRelatedRequests).toBe(1);

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('button', { name: 'Seed beta task' }).click();
  await page.getByRole('tab', { name: 'Dependencies' }).click();
  await page.getByRole('button', { name: 'Add Blocker' }).first().click();
  const cycleDialog = page.getByRole('dialog').filter({ hasText: 'Add Blocker' });
  await cycleDialog.getByLabel('Search tasks').fill('Seed alpha');
  await cycleDialog.getByRole('button', { name: /^Seed alpha task/ }).click();
  await cycleDialog.getByRole('button', { name: 'Add Blocker' }).click();
  await expect(page.getByText('This dependency would create a cycle.')).toBeVisible();

  await cycleDialog.getByLabel('Search tasks').fill('Seed beta');
  await expect(
    cycleDialog.getByRole('button', { name: 'Remove selected task: Seed alpha task' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Add Blocker' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByText('Agency One').first().click();
  await page.getByRole('option', { name: 'Agency Two' }).click();
  await expect(page.getByText('Workspace Two').first()).toBeVisible();
  await expect(page.getByText('Add Blocker')).toHaveCount(0);
  await expect(page.getByText('Seed alpha task')).toHaveCount(0);
});

test('authenticated task browser supports current-page bulk actions', async ({ page }) => {
  await mockAuthenticatedSession(page);
  await mockTaskCreationApi(page);

  let statusRequests = 0;
  let priorityRequests = 0;
  let addAssigneeRequests = 0;
  let removeAssigneeRequests = 0;
  let deleteRequests = 0;
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('/workspaces/workspace-1/tasks/bulk/status')) statusRequests += 1;
    if (url.includes('/workspaces/workspace-1/tasks/bulk/priority')) priorityRequests += 1;
    if (url.includes('/workspaces/workspace-1/tasks/bulk/assignees/add')) {
      addAssigneeRequests += 1;
    }
    if (url.includes('/workspaces/workspace-1/tasks/bulk/assignees/remove')) {
      removeAssigneeRequests += 1;
    }
    if (url.match(/\/workspaces\/workspace-1\/tasks\/bulk$/)) deleteRequests += 1;
  });

  await page.goto('/workspace/tasks');
  await expect(page.getByText('Seed alpha task').first()).toBeVisible();
  await page.getByLabel('Select all on this page').click();
  await expect(page.getByText('2 tasks selected').first()).toBeVisible();
  await page.getByRole('button', { name: 'Grid' }).click();
  await expect(page.getByText('2 tasks selected').first()).toBeVisible();
  await page.getByRole('button', { name: 'Compact' }).click();
  await expect(page.getByText('2 tasks selected').first()).toBeVisible();

  await page.getByRole('button', { name: 'Change priority' }).click();
  await page.getByRole('button', { name: 'Update 2 tasks' }).click();
  await expect(page.getByText('2 tasks selected')).toHaveCount(0);
  expect(priorityRequests).toBe(1);
  await expect(page.getByText('Medium').first()).toBeVisible();

  await page.getByLabel('Select task: Seed alpha task').click();
  await page.getByRole('button', { name: 'Change status' }).click();
  await page.getByRole('combobox', { name: 'Status' }).click();
  await page
    .getByRole('option', { name: 'To Do' })
    .evaluate((element) => (element as HTMLElement).click());
  await page.getByRole('button', { name: 'Update 1 tasks' }).click();
  await expect(page.getByText('1 task selected')).toHaveCount(0);
  expect(statusRequests).toBe(1);

  await page.getByLabel('Select task: Seed alpha task').click();
  await page.getByRole('button', { name: 'Add assignees' }).click();
  await page.getByLabel('Anya').click();
  await page.getByRole('button', { name: 'Add to 1 tasks' }).click();
  await expect(page.getByText('1 task selected')).toHaveCount(0);
  expect(addAssigneeRequests).toBe(1);
  await expect(page.getByText('Anya').first()).toBeVisible();

  await page.getByLabel('Select task: Seed alpha task').click();
  await page.getByRole('button', { name: 'Remove assignees' }).click();
  await page.getByLabel('Anya').click();
  await page.getByRole('button', { name: 'Remove from 1 tasks' }).click();
  await expect(page.getByText('1 task selected')).toHaveCount(0);
  expect(removeAssigneeRequests).toBe(1);

  await expect(page.getByText('Select all on this page')).toBeVisible();
  await page.getByLabel('Select all on this page').click();
  await expect(page.getByText('2 tasks selected').first()).toBeVisible();
  await page.getByRole('button', { name: 'Delete tasks' }).click();
  await expect(page.getByText('Delete 2 selected tasks?')).toBeVisible();
  await page.getByRole('button', { name: 'Delete 2 tasks' }).click();
  await expect(page.getByText('Seed alpha task')).toHaveCount(0);
  await expect(page.getByText('Seed beta task')).toHaveCount(0);
  expect(deleteRequests).toBe(1);
});

test('authenticated task browser clears bulk selection on workspace change', async ({ page }) => {
  await mockAuthenticatedSession(page);
  await mockTaskCreationApi(page);

  await page.goto('/workspace/tasks');
  await expect(page.getByText('Seed alpha task').first()).toBeVisible();
  await page.getByLabel('Select task: Seed alpha task').first().click();
  await expect(page.getByText('1 task selected').first()).toBeVisible();

  await page.getByText('Agency One').first().click();
  await page.getByRole('option', { name: 'Agency Two' }).click();

  await expect(page.getByText('Workspace Two').first()).toBeVisible();
  await expect(page.getByText('1 task selected')).toHaveCount(0);
});

test('authenticated task browser handles stale, terminal, detail, pagination, and mobile bulk states', async ({
  page,
}) => {
  await mockAuthenticatedSession(page);
  await mockTaskCreationApi(page, { extraTasks: 9 });

  await page.goto('/workspace/tasks');
  await expect(page.getByText('Seed alpha task').first()).toBeVisible();

  await page.getByLabel('Select task: Seed alpha task').first().click();
  await page.getByRole('button', { name: 'Change priority' }).click();
  await page.getByRole('combobox', { name: 'Priority' }).click();
  await page
    .getByRole('option', { name: 'Urgent' })
    .evaluate((element) => (element as HTMLElement).click());
  await page.getByRole('button', { name: 'Update 1 tasks' }).click();
  await expect(
    page.getByText('One or more selected tasks are no longer available. Refresh and try again.'),
  ).toBeVisible();
  await expect(page.getByText('1 task selected').first()).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  await page.getByRole('button', { name: 'Change status' }).click();
  await page.getByRole('combobox', { name: 'Status' }).click();
  await page
    .getByRole('option', { name: 'Completed' })
    .evaluate((element) => (element as HTMLElement).click());
  await page.getByRole('button', { name: 'Update 1 tasks' }).click();
  await expect(page.getByText('1 task selected')).toHaveCount(0);
  const alphaRow = page.getByRole('row', { name: /Seed alpha task/ });
  await expect(alphaRow.getByText('Completed')).toBeVisible();
  await expect(alphaRow.getByText('Upcoming')).toHaveCount(0);

  await page.getByRole('button', { name: 'Seed alpha task' }).click();
  await expect(page.getByRole('dialog')).toContainText('Completed');
  await expect(page.getByRole('dialog')).not.toContainText('Upcoming');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();

  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto('/workspace/tasks?page=2&pageSize=10');
  await expect(page.locator('button:visible', { hasText: 'Extra task 9' }).first()).toBeVisible();
  await page.getByLabel('Select all on this page').click();
  await expect(page.getByText('1 task selected').first()).toBeVisible();
  await page.getByRole('button', { name: 'Delete tasks' }).click();
  await page.getByRole('button', { name: 'Delete 1 tasks' }).click();
  await expect(page.getByText('1 task selected')).toHaveCount(0);
  await expect.poll(() => page.url()).not.toContain('page=2');
  await expect(page.getByText('Extra task 9')).toHaveCount(0);

  await page.setViewportSize({ width: 375, height: 900 });
  await page.locator('[aria-label="Select task: Seed alpha task"]:visible').click();
  await page.getByRole('button', { name: 'Bulk actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete tasks' }).click();
  await expect(page.getByText('Delete 1 selected tasks?')).toBeVisible();
  await page.getByRole('button', { name: 'Delete 1 tasks' }).click();
  await expect(page.getByText('Seed alpha task')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('workspace roles page remains responsive across supported widths', async ({ page }) => {
  await mockAuthenticatedSession(page);
  await mockRoleManagementApi(page);

  for (const width of [375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/workspace/roles');
    await expect(page.getByRole('heading', { name: 'Roles & Permissions' })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  }
});
