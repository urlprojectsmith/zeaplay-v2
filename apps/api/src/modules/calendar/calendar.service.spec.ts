import {
  CalendarEventVisibility,
  CalendarSourceType,
  MembershipStatus,
  TaskPriority,
} from '@prisma/client';
import { CalendarService } from './calendar.service';

const tenant = {
  userId: 'user-1',
  agencyId: 'agency-1',
  workspaceId: 'workspace-1',
  workspaceMembershipId: 'member-1',
  agencyMembershipId: null,
  roleId: 'role-1',
  roleName: 'MEMBER',
  permissions: [
    'calendar.view',
    'calendar.events.create',
    'calendar.events.edit_own',
    'tasks.view',
    'projects.view',
    'tickets.view',
  ],
  accessSource: 'WORKSPACE_MEMBERSHIP' as const,
};

function prismaMock() {
  return {
    workspace: { findUnique: jest.fn().mockResolvedValue({ timezone: 'Asia/Kolkata' }) },
    task: { findMany: jest.fn().mockResolvedValue([]) },
    project: { findMany: jest.fn().mockResolvedValue([]) },
    ticket: { findMany: jest.fn().mockResolvedValue([]) },
    calendarEvent: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    calendarEventParticipant: { deleteMany: jest.fn() },
    workspaceMembership: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn((callback) =>
      callback({
        calendarEvent: {
          create: jest.fn().mockResolvedValue(calendarEventRow()),
          update: jest.fn().mockResolvedValue(calendarEventRow({ title: 'Updated' })),
        },
        calendarEventParticipant: { deleteMany: jest.fn() },
      }),
    ),
  };
}

function serviceWith(prisma = prismaMock()) {
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const realtime = {
    publishWorkspace: jest.fn().mockResolvedValue(undefined),
    publishMember: jest.fn().mockResolvedValue(undefined),
  };
  return {
    prisma,
    audit,
    realtime,
    service: new CalendarService(prisma as never, audit as never, realtime as never),
  };
}

describe('CalendarService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects inverted and oversized ranges', async () => {
    const { service } = serviceWith();
    await expect(
      service.list(tenant, {
        from: '2026-01-02T00:00:00.000Z',
        to: '2026-01-01T00:00:00.000Z',
      }),
    ).rejects.toThrow('CALENDAR_RANGE_INVERTED');
    await expect(
      service.list(tenant, {
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-06-01T00:00:00.000Z',
      }),
    ).rejects.toThrow('CALENDAR_RANGE_TOO_LARGE');
  });

  it('aggregates task, project, ticket, and custom event items without reminder duplicates', async () => {
    const prisma = prismaMock();
    prisma.task.findMany.mockResolvedValue([
      {
        id: 'task-1',
        title: 'Task due',
        priority: TaskPriority.HIGH,
        plannedStartAt: null,
        dueAt: new Date('2026-01-05T10:00:00.000Z'),
        departmentId: 'dept-1',
        statusDefinition: { id: 'status-1', name: 'Open', isTerminal: false },
        assignees: [{ membershipId: 'member-1' }],
      },
      {
        id: 'task-empty',
        title: 'No date',
        priority: TaskPriority.LOW,
        plannedStartAt: null,
        dueAt: null,
        departmentId: null,
        statusDefinition: { id: 'status-1', name: 'Open', isTerminal: false },
        assignees: [],
      },
    ]);
    prisma.project.findMany.mockResolvedValue([
      {
        id: 'project-1',
        name: 'Project range',
        priority: TaskPriority.MEDIUM,
        visibility: 'WORKSPACE',
        plannedStartAt: new Date('2026-01-04T00:00:00.000Z'),
        dueAt: new Date('2026-01-08T00:00:00.000Z'),
        departmentId: null,
        ownerMembershipId: 'member-1',
        statusDefinition: { id: 'project-status', name: 'Active', isTerminal: false },
        status: 'ACTIVE',
        members: [],
      },
    ]);
    prisma.ticket.findMany.mockResolvedValue([
      {
        id: 'ticket-1',
        ticketNumber: 'T-1',
        subject: 'SLA',
        priority: TaskPriority.URGENT,
        departmentId: 'dept-1',
        assignedToMembershipId: 'member-1',
        statusDefinition: { id: 'ticket-status', name: 'Open', isTerminal: false },
        requester: { internalMembershipId: 'member-2' },
        slaState: { resolutionDueAt: new Date('2026-01-06T10:00:00.000Z') },
      },
    ]);
    prisma.calendarEvent.findMany.mockResolvedValue([calendarEventRow()]);
    const { service } = serviceWith(prisma);
    const result = await service.list(tenant, {
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-02-01T00:00:00.000Z',
    });
    expect(result.items.map((item) => item.sourceType).sort()).toEqual([
      CalendarSourceType.CUSTOM_EVENT,
      CalendarSourceType.PROJECT,
      CalendarSourceType.TASK,
      CalendarSourceType.TICKET,
    ]);
    expect(result.items.some((item) => item.sourceId === 'task-empty')).toBe(false);
  });

  it('applies source/member/department/priority/status filters in source queries', async () => {
    const prisma = prismaMock();
    const { service } = serviceWith(prisma);
    await service.list(tenant, {
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-02-01T00:00:00.000Z',
      sourceTypes: [CalendarSourceType.TASK],
      memberIds: ['member-2'],
      departmentIds: ['dept-1'],
      priorities: [TaskPriority.URGENT],
      statuses: ['status-1'],
    });
    expect(prisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          priority: { in: [TaskPriority.URGENT] },
          statusDefinitionId: { in: ['status-1'] },
          departmentId: { in: ['dept-1'] },
          assignees: {
            some: { workspaceId: tenant.workspaceId, membershipId: { in: ['member-2'] } },
          },
        }),
      }),
    );
    expect(prisma.project.findMany).not.toHaveBeenCalled();
    expect(prisma.ticket.findMany).not.toHaveBeenCalled();
  });

  it('uses source visibility predicates for restricted projects and tickets', async () => {
    const prisma = prismaMock();
    const { service } = serviceWith(prisma);
    await service.list(tenant, {
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-02-01T00:00:00.000Z',
      sourceTypes: [CalendarSourceType.PROJECT, CalendarSourceType.TICKET],
      memberIds: ['member-1'],
    });
    expect(JSON.stringify(prisma.project.findMany.mock.calls[0][0].where)).toContain('visibility');
    expect(JSON.stringify(prisma.ticket.findMany.mock.calls[0][0].where)).toContain('requester');
    expect(JSON.stringify(prisma.ticket.findMany.mock.calls[0][0].where)).toContain(
      'assignedToMembershipId',
    );
    expect(JSON.stringify(prisma.ticket.findMany.mock.calls[0][0].where)).not.toContain(
      'internalMembershipId":{"in"',
    );
  });

  it('creates custom events only with active same-workspace participants and audits safely', async () => {
    const prisma = prismaMock();
    prisma.workspaceMembership.findMany.mockResolvedValue([
      { id: 'member-1', status: MembershipStatus.ACTIVE },
      { id: 'member-2', status: MembershipStatus.ACTIVE },
    ]);
    const { service, audit, realtime } = serviceWith(prisma);
    const created = await service.createCustomEvent(tenant, {
      title: ' Planning ',
      startAt: '2026-01-05T10:00:00.000Z',
      endAt: '2026-01-05T11:00:00.000Z',
      participantMembershipIds: ['member-2'],
    });
    expect(created.sourceType).toBe(CalendarSourceType.CUSTOM_EVENT);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'calendar.event_created',
        metadata: expect.objectContaining({ participantCount: 1 }),
      }),
    );
    expect(realtime.publishWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'CALENDAR_EVENT_CREATED',
        payload: { calendarEventId: 'event-1', visibility: 'WORKSPACE' },
      }),
    );
  });

  it('rejects foreign participants and end before start', async () => {
    const prisma = prismaMock();
    prisma.workspaceMembership.findMany.mockResolvedValue([
      { id: 'member-1', status: MembershipStatus.ACTIVE },
    ]);
    const { service } = serviceWith(prisma);
    await expect(
      service.createCustomEvent(tenant, {
        title: 'Bad',
        startAt: '2026-01-05T12:00:00.000Z',
        endAt: '2026-01-05T11:00:00.000Z',
        participantMembershipIds: [],
      }),
    ).rejects.toThrow('CALENDAR_EVENT_END_BEFORE_START');
    await expect(
      service.createCustomEvent(tenant, {
        title: 'Foreign',
        startAt: '2026-01-05T10:00:00.000Z',
        participantMembershipIds: ['foreign-member'],
      }),
    ).rejects.toThrow('CALENDAR_EVENT_FOREIGN_PARTICIPANT');
    await expect(
      service.createCustomEvent(tenant, {
        title: 'Duplicate',
        startAt: '2026-01-05T10:00:00.000Z',
        participantMembershipIds: ['member-1', 'member-1'],
      }),
    ).rejects.toThrow('CALENDAR_EVENT_DUPLICATE_PARTICIPANT');
  });

  it('allows owner edit, denies unauthorized edit, and manage-all can edit any visible event', async () => {
    const prisma = prismaMock();
    prisma.calendarEvent.findFirst.mockResolvedValue(
      calendarEventRow({ ownerMembershipId: 'member-1' }),
    );
    prisma.workspaceMembership.findMany.mockResolvedValue([
      { id: 'member-1', status: MembershipStatus.ACTIVE },
    ]);
    const { service } = serviceWith(prisma);
    await expect(
      service.updateCustomEvent(tenant, 'event-1', { title: 'Updated' }),
    ).resolves.toEqual(expect.objectContaining({ title: 'Updated' }));

    const otherTenant = { ...tenant, workspaceMembershipId: 'member-x' };
    await expect(
      service.updateCustomEvent(otherTenant, 'event-1', { title: 'No' }),
    ).rejects.toThrow('CALENDAR_EVENT_EDIT_DENIED');

    await expect(
      service.updateCustomEvent(
        {
          ...otherTenant,
          permissions: ['calendar.view', 'calendar.events.edit_own', 'calendar.events.manage_all'],
        },
        'event-1',
        { title: 'Managed' },
      ),
    ).resolves.toEqual(expect.any(Object));
  });

  it('does not audit or publish idempotent no-op updates', async () => {
    const prisma = prismaMock();
    prisma.calendarEvent.findFirst.mockResolvedValue(
      calendarEventRow({ ownerMembershipId: 'member-1' }),
    );
    prisma.workspaceMembership.findMany.mockResolvedValue([
      { id: 'member-1', status: MembershipStatus.ACTIVE },
    ]);
    const { service, audit, realtime } = serviceWith(prisma);
    await expect(
      service.updateCustomEvent(tenant, 'event-1', {
        title: 'Planning',
        description: 'Short',
        startAt: '2026-01-05T10:00:00.000Z',
        endAt: '2026-01-05T11:00:00.000Z',
        allDay: false,
        timezone: 'Asia/Kolkata',
        visibility: CalendarEventVisibility.WORKSPACE,
        participantMembershipIds: ['member-1'],
      }),
    ).resolves.toEqual(expect.objectContaining({ sourceId: 'event-1' }));
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(realtime.publishWorkspace).not.toHaveBeenCalled();
  });

  it('cancels custom events softly and excludes cancelled events from default list', async () => {
    const prisma = prismaMock();
    prisma.calendarEvent.findFirst.mockResolvedValue(
      calendarEventRow({ ownerMembershipId: 'member-1' }),
    );
    prisma.calendarEvent.update.mockResolvedValue(
      calendarEventRow({ cancelledAt: new Date('2026-01-05T10:00:00.000Z') }),
    );
    const { service } = serviceWith(prisma);
    await service.cancelCustomEvent(tenant, 'event-1');
    expect(prisma.calendarEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ cancelledAt: expect.any(Date) }) }),
    );
    await service.list(tenant, {
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-02-01T00:00:00.000Z',
      sourceTypes: [CalendarSourceType.CUSTOM_EVENT],
    });
    expect(JSON.stringify(prisma.calendarEvent.findMany.mock.calls[0][0].where)).toContain(
      'cancelledAt',
    );
  });

  it('does not broadcast private event details workspace-wide', async () => {
    const prisma = prismaMock();
    prisma.workspaceMembership.findMany.mockResolvedValue([
      { id: 'member-1', status: MembershipStatus.ACTIVE },
      { id: 'member-2', status: MembershipStatus.ACTIVE },
    ]);
    prisma.$transaction.mockImplementation((callback) =>
      callback({
        calendarEvent: {
          create: jest
            .fn()
            .mockResolvedValue(calendarEventRow({ visibility: CalendarEventVisibility.PRIVATE })),
        },
      }),
    );
    const { service, realtime } = serviceWith(prisma);
    await service.createCustomEvent(tenant, {
      title: 'Private',
      startAt: '2026-01-05T10:00:00.000Z',
      visibility: CalendarEventVisibility.PRIVATE,
      participantMembershipIds: ['member-2'],
    });
    expect(realtime.publishWorkspace).not.toHaveBeenCalled();
    expect(realtime.publishMember).toHaveBeenCalled();
    expect(JSON.stringify(realtime.publishMember.mock.calls)).not.toContain('Private');
  });
});

interface CalendarEventTestRow {
  id: string;
  workspaceId: string;
  title: string;
  description: string | null;
  startAt: Date;
  endAt: Date | null;
  allDay: boolean;
  timezone: string | null;
  visibility: CalendarEventVisibility;
  createdByMembershipId: string;
  ownerMembershipId: string;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  participants: Array<{ membershipId: string; participantRole: string }>;
}

function calendarEventRow(overrides: Partial<CalendarEventTestRow> = {}): CalendarEventTestRow {
  return {
    id: 'event-1',
    workspaceId: 'workspace-1',
    title: 'Planning',
    description: 'Short',
    startAt: new Date('2026-01-05T10:00:00.000Z'),
    endAt: new Date('2026-01-05T11:00:00.000Z'),
    allDay: false,
    timezone: 'Asia/Kolkata',
    visibility: CalendarEventVisibility.WORKSPACE,
    createdByMembershipId: 'member-1',
    ownerMembershipId: 'member-1',
    cancelledAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    participants: [{ membershipId: 'member-1', participantRole: 'OWNER' }],
    ...overrides,
  };
}
