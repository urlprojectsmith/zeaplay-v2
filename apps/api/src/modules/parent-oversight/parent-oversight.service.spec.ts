import { ParentOversightService } from './parent-oversight.service';

describe('ParentOversightService', () => {
  const agencyTenant = {
    userId: 'user-1',
    superAgencyId: 'super-1',
    agencyId: 'agency-1',
    agencyMembershipId: 'agency-membership-1',
    roleId: 'role-1',
    roleName: 'AGENCY_OWNER',
    permissions: ['tasks.parent.read', 'projects.parent.read', 'tickets.parent.read'],
  };
  const superAgencyTenant = {
    userId: 'user-1',
    superAgencyId: 'super-1',
    superAgencyMembershipId: 'super-membership-1',
    roleId: 'role-1',
    roleName: 'SUPER_AGENCY_OWNER',
    permissions: ['tasks.parent.read', 'projects.parent.read', 'tickets.parent.read'],
    status: 'ACTIVE',
  };

  function serviceWithPrisma() {
    const prisma = {
      task: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      project: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      ticket: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      statusDefinition: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn((operations: Array<Promise<unknown>>) => Promise.all(operations)),
    };
    return {
      prisma,
      service: new ParentOversightService(prisma as never),
    };
  }

  it('fences Super Agency parent Task oversight through descendant Agency and Workspace metadata only', async () => {
    const { prisma, service } = serviceWithPrisma();

    await service.listSuperAgencyTasks(superAgencyTenant, {
      page: 1,
      pageSize: 500,
      agencyId: 'agency-1',
      workspaceId: 'workspace-1',
      search: 'launch',
      sortBy: 'dueAt',
      sortDirection: 'asc',
    });

    expect(prisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspace: {
            id: 'workspace-1',
            agencyId: 'agency-1',
            agency: { superAgencyId: 'super-1' },
          },
          deletedAt: null,
        }),
        select: expect.not.objectContaining({
          attachments: expect.anything(),
          comments: expect.anything(),
          completionSubmissions: expect.anything(),
          timeEntries: expect.anything(),
        }),
        orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
        take: 100,
      }),
    );
  });

  it('does not allow an Agency parent Project query to replace the current Agency fence', async () => {
    const { prisma, service } = serviceWithPrisma();

    await service.listAgencyProjects(agencyTenant, {
      page: 1,
      pageSize: 25,
      agencyId: 'foreign-agency',
      sortBy: 'createdAt',
      sortDirection: 'desc',
    });

    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspace: expect.objectContaining({
            agencyId: 'agency-1',
            id: '00000000-0000-4000-8000-000000000000',
          }),
          archivedAt: null,
        }),
        select: expect.not.objectContaining({
          attachments: expect.anything(),
          taskLinks: expect.anything(),
          assets: expect.anything(),
        }),
      }),
    );
  });

  it('keeps parent Ticket oversight metadata-only and excludes conversation/requester detail', async () => {
    const { prisma, service } = serviceWithPrisma();

    await service.listSuperAgencyTickets(superAgencyTenant, {
      page: 2,
      pageSize: 10,
      priority: 'HIGH',
      sortBy: 'ticketNumber',
      sortDirection: 'desc',
    });

    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspace: { agency: { superAgencyId: 'super-1' } },
          priority: 'HIGH',
          deletedAt: null,
        }),
        select: expect.not.objectContaining({
          conversationEntries: expect.anything(),
          requester: expect.anything(),
          attachments: expect.anything(),
        }),
        skip: 10,
        take: 10,
      }),
    );
  });

  it('uses the same hierarchy fence for Task lists, totals, counts, and sensitive projections', async () => {
    const { prisma, service } = serviceWithPrisma();

    await service.listAgencyTasks(agencyTenant, {
      page: 1,
      pageSize: 25,
      workspaceId: 'workspace-1',
      statusDefinitionId: 'status-1',
      departmentId: 'department-1',
      assigneeMembershipId: 'membership-1',
      sortBy: 'createdAt',
      sortDirection: 'desc',
    });

    const findArgs = prisma.task.findMany.mock.calls[0][0];
    expect(findArgs.where).toEqual(
      expect.objectContaining({
        workspace: { id: 'workspace-1', agencyId: 'agency-1' },
        statusDefinitionId: 'status-1',
        departmentId: 'department-1',
        deletedAt: null,
      }),
    );
    expect(findArgs.where.assignees).toEqual({
      some: {
        membershipId: 'membership-1',
        workspace: { id: 'workspace-1', agencyId: 'agency-1' },
      },
    });
    expect(findArgs.select).toEqual(
      expect.not.objectContaining({
        comments: expect.anything(),
        attachments: expect.anything(),
        completionSubmissions: expect.anything(),
        completionProofs: expect.anything(),
        timeEntries: expect.anything(),
      }),
    );
    expect(findArgs.select.assignees.select.membership.select.user.select).toEqual({
      id: true,
      name: true,
    });
    expect(prisma.task.count).toHaveBeenCalledWith({ where: findArgs.where });
    expect(prisma.task.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ['statusDefinitionId'], where: findArgs.where }),
    );
    expect(prisma.task.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ['priority'], where: findArgs.where }),
    );
  });

  it('keeps Super Agency Project filters inside the current Super Agency and excludes file/activity graph data', async () => {
    const { prisma, service } = serviceWithPrisma();

    await service.listSuperAgencyProjects(superAgencyTenant, {
      page: 1,
      pageSize: 25,
      agencyId: 'agency-from-request',
      workspaceId: 'workspace-from-request',
      statusDefinitionId: 'project-status-1',
      departmentId: 'department-1',
      ownerMembershipId: 'owner-membership-1',
      sortBy: 'name',
      sortDirection: 'asc',
    });

    const findArgs = prisma.project.findMany.mock.calls[0][0];
    expect(findArgs.where).toEqual(
      expect.objectContaining({
        workspace: {
          id: 'workspace-from-request',
          agencyId: 'agency-from-request',
          agency: { superAgencyId: 'super-1' },
        },
        statusDefinitionId: 'project-status-1',
        departmentId: 'department-1',
        ownerMembershipId: 'owner-membership-1',
        archivedAt: null,
      }),
    );
    expect(findArgs.select).toEqual(
      expect.not.objectContaining({
        assets: expect.anything(),
        attachments: expect.anything(),
        taskLinks: expect.anything(),
        activity: expect.anything(),
      }),
    );
    expect(findArgs.select.ownerMembership.select.user.select).toEqual({ id: true, name: true });
    expect(prisma.project.count).toHaveBeenCalledWith({ where: findArgs.where });
    expect(prisma.project.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ['statusDefinitionId'], where: findArgs.where }),
    );
    expect(prisma.project.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ['priority'], where: findArgs.where }),
    );
  });

  it('keeps Super Agency Ticket filters fenced and excludes requester, conversation, notes, and attachment data', async () => {
    const { prisma, service } = serviceWithPrisma();

    await service.listSuperAgencyTickets(superAgencyTenant, {
      page: 1,
      pageSize: 25,
      agencyId: 'agency-from-request',
      workspaceId: 'workspace-from-request',
      statusDefinitionId: 'ticket-status-1',
      departmentId: 'department-1',
      assignedToMembershipId: 'assigned-membership-1',
      sortBy: 'updatedAt',
      sortDirection: 'asc',
    });

    const findArgs = prisma.ticket.findMany.mock.calls[0][0];
    expect(findArgs.where).toEqual(
      expect.objectContaining({
        workspace: {
          id: 'workspace-from-request',
          agencyId: 'agency-from-request',
          agency: { superAgencyId: 'super-1' },
        },
        statusDefinitionId: 'ticket-status-1',
        departmentId: 'department-1',
        assignedToMembershipId: 'assigned-membership-1',
        deletedAt: null,
      }),
    );
    expect(findArgs.select).toEqual(
      expect.not.objectContaining({
        requester: expect.anything(),
        conversationEntries: expect.anything(),
        internalNotes: expect.anything(),
        attachments: expect.anything(),
      }),
    );
    expect(findArgs.select.assignedToMembership.select.user.select).toEqual({
      id: true,
      name: true,
    });
    expect(prisma.ticket.count).toHaveBeenCalledWith({ where: findArgs.where });
    expect(prisma.ticket.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ['statusDefinitionId'], where: findArgs.where }),
    );
    expect(prisma.ticket.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ['priority'], where: findArgs.where }),
    );
  });
});
