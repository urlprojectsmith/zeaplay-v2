import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TaskPriority, TicketEscalationLevel } from '@prisma/client';
import { TicketsService } from './tickets.service';

const tenant = {
  userId: '00000000-0000-4000-8000-000000000001',
  agencyId: '00000000-0000-4000-8000-000000000002',
  workspaceId: '00000000-0000-4000-8000-000000000003',
  workspaceMembershipId: '00000000-0000-4000-8000-000000000004',
  agencyMembershipId: null,
  roleId: '00000000-0000-4000-8000-000000000005',
  roleName: 'OWNER',
  permissions: ['*'],
  accessSource: 'WORKSPACE_MEMBERSHIP' as const,
};

describe('TicketsService', () => {
  it('uses workspaceId and non-deleted predicates for detail reads', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const service = new TicketsService(
      { ticket: { findFirst } } as never,
      { record: jest.fn() } as never,
      slaServiceMock() as never,
    );

    await expect(service.get(tenant, '00000000-0000-4000-8000-000000000006')).rejects.toThrow(
      NotFoundException,
    );
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: '00000000-0000-4000-8000-000000000006',
          workspaceId: tenant.workspaceId,
          deletedAt: null,
          AND: [{}],
        },
      }),
    );
  });

  it('allocates a workspace-scoped ticket number inside the create transaction', async () => {
    const ticket = ticketRecord();
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ last_number: 7 }]),
      ticket: {
        create: jest.fn().mockResolvedValue(ticket),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ ...ticket, sequenceNumber: 7, ticketNumber: 'TKT-000007' }),
      },
      ticketRequester: { create: jest.fn().mockResolvedValue({ id: 'requester-id' }) },
    };
    const audit = { record: jest.fn() };
    const sla = slaServiceMock();
    const prisma = {
      statusDefinition: {
        findFirst: jest.fn().mockResolvedValue({ id: ticket.statusDefinitionId }),
      },
      workspaceMembership: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: tenant.workspaceMembershipId, status: 'ACTIVE' }),
      },
      $transaction: jest.fn((callback: (txClient: typeof tx) => unknown) => callback(tx)),
    };
    const service = new TicketsService(prisma as never, audit as never, sla as never);

    const created = await service.create(tenant, {
      subject: ' Login issue ',
      priority: TaskPriority.HIGH,
      requester: { type: 'INTERNAL', membershipId: tenant.workspaceMembershipId! },
    });

    expect(tx.ticket.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workspaceId: tenant.workspaceId,
          sequenceNumber: 7,
          ticketNumber: 'TKT-000007',
          subject: 'Login issue',
          priority: TaskPriority.HIGH,
          createdByMembershipId: tenant.workspaceMembershipId,
        }),
      }),
    );
    expect(tx.ticketRequester.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: tenant.workspaceId,
        ticketId: ticket.id,
        type: 'INTERNAL',
        internalMembershipId: tenant.workspaceMembershipId,
      }),
    });
    expect(sla.initializeForTicket).toHaveBeenCalledWith(tx, ticket);
    expect(created.ticketNumber).toBe('TKT-000007');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ticket.created' }),
    );
  });

  it('suppresses no-op update audit and mutation', async () => {
    const ticket = ticketRecord();
    const prisma = {
      ticket: { findFirst: jest.fn().mockResolvedValue(ticket), updateMany: jest.fn() },
    };
    const audit = { record: jest.fn() };
    const service = new TicketsService(prisma as never, audit as never, slaServiceMock() as never);

    await service.update(tenant, ticket.id, {
      subject: ticket.subject,
      priority: ticket.priority,
      statusDefinitionId: ticket.statusDefinitionId,
    });

    expect(prisma.ticket.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('soft deletes tickets without hard deleting shared records', async () => {
    const ticket = ticketRecord();
    const tx = { ticket: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
    const prisma = {
      ticket: { findFirst: jest.fn().mockResolvedValue(ticket) },
      $transaction: jest.fn((callback: (txClient: typeof tx) => unknown) => callback(tx)),
    };
    const audit = { record: jest.fn() };
    const service = new TicketsService(prisma as never, audit as never, slaServiceMock() as never);

    await expect(service.delete(tenant, ticket.id)).resolves.toEqual({
      id: ticket.id,
      deleted: true,
    });
    expect(tx.ticket.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ticket.id, workspaceId: tenant.workspaceId, deletedAt: null },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
          deletedByMembershipId: tenant.workspaceMembershipId,
        }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ticket.deleted' }),
    );
  });

  it('composes built-in queues with existing scoped visibility before pagination', async () => {
    const scopedTenant = { ...tenant, permissions: ['tickets.view'] };
    const prisma = {
      workspaceMembership: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: tenant.workspaceMembershipId, departmentId: 'dept-1' }),
      },
      workspace: { findUnique: jest.fn().mockResolvedValue({ timezone: 'Asia/Kolkata' }) },
      ticket: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn((operations: Array<Promise<unknown>>) => Promise.all(operations)),
    };
    const service = new TicketsService(
      prisma as never,
      { record: jest.fn() } as never,
      slaServiceMock() as never,
    );

    await service.list(scopedTenant, {
      page: 1,
      pageSize: 20,
      queue: 'MY_ASSIGNED',
      sortBy: 'createdAt',
      sortDirection: 'desc',
    });

    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: tenant.workspaceId,
          deletedAt: null,
          AND: expect.arrayContaining([
            expect.objectContaining({ OR: expect.any(Array) }),
            expect.objectContaining({
              assignedToMembershipId: tenant.workspaceMembershipId,
              assignedToMembership: { status: 'ACTIVE' },
            }),
          ]),
        }),
        skip: 0,
        take: 20,
      }),
    );
  });

  it('applies workspace timezone date filters and deterministic order ties', async () => {
    const prisma = {
      workspaceMembership: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: tenant.workspaceMembershipId, departmentId: 'dept-1' }),
      },
      workspace: { findUnique: jest.fn().mockResolvedValue({ timezone: 'Asia/Kolkata' }) },
      ticket: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn((operations: Array<Promise<unknown>>) => Promise.all(operations)),
    };
    const service = new TicketsService(
      prisma as never,
      { record: jest.fn() } as never,
      slaServiceMock() as never,
    );

    await service.list(tenant, {
      page: 2,
      pageSize: 10,
      createdFrom: '2026-01-02',
      createdTo: '2026-01-02',
      sortBy: 'priority',
      sortDirection: 'asc',
    });

    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: {
            gte: new Date('2026-01-01T18:30:00.000Z'),
            lte: new Date('2026-01-02T18:29:59.999Z'),
          },
        }),
        orderBy: [{ priority: 'asc' }, { sequenceNumber: 'desc' }, { id: 'desc' }],
        skip: 10,
        take: 10,
      }),
    );
  });

  it('returns queue counts through one bounded summary path with visibility predicates', async () => {
    const scopedTenant = { ...tenant, permissions: ['tickets.view'] };
    const prisma = {
      workspaceMembership: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: tenant.workspaceMembershipId, departmentId: 'dept-1' }),
      },
      ticket: { count: jest.fn().mockResolvedValue(3) },
      $transaction: jest.fn((operations: Array<Promise<unknown>>) => Promise.all(operations)),
    };
    const service = new TicketsService(
      prisma as never,
      { record: jest.fn() } as never,
      slaServiceMock() as never,
    );

    const summary = await service.queueSummary(scopedTenant);

    expect(summary).toEqual({
      ALL_VISIBLE: 3,
      MY_ASSIGNED: 3,
      MY_REQUESTED: 3,
      MY_DEPARTMENT: 3,
      UNASSIGNED_MY_DEPARTMENT: 3,
      SLA_BREACHED: 3,
    });
    expect(prisma.ticket.count).toHaveBeenCalledTimes(6);
    expect(prisma.ticket.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: tenant.workspaceId,
          deletedAt: null,
          AND: expect.arrayContaining([expect.objectContaining({ OR: expect.any(Array) })]),
        }),
      }),
    );
  });

  it('rejects unknown saved-view filter JSON before persistence', async () => {
    const prisma = {
      workspaceMembership: {
        findFirst: jest.fn().mockResolvedValue({ id: tenant.workspaceMembershipId }),
      },
      ticketSavedView: { create: jest.fn() },
    };
    const service = new TicketsService(
      prisma as never,
      { record: jest.fn() } as never,
      slaServiceMock() as never,
    );

    await expect(
      service.createSavedView(tenant, {
        name: 'Unsafe',
        scope: 'PERSONAL',
        filters: { rawSql: '1=1' },
        sort: { sortBy: 'createdAt', sortDirection: 'desc' },
      }),
    ).rejects.toThrow('INVALID_TICKET_VIEW_FILTER');
    expect(prisma.ticketSavedView.create).not.toHaveBeenCalled();
  });

  it('self-claims a visible unassigned department ticket without assignment permission', async () => {
    const ticket = ticketRecord({ departmentId: 'dept-1' });
    const scopedTenant = { ...tenant, permissions: ['tickets.view', 'tickets.claim'] };
    const prisma: {
      workspaceMembership: { findFirst: jest.Mock };
      ticket: { findFirst: jest.Mock; updateMany: jest.Mock; findUniqueOrThrow: jest.Mock };
      $transaction: jest.Mock;
    } = {
      workspaceMembership: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: tenant.workspaceMembershipId, departmentId: 'dept-1' }),
      },
      ticket: {
        findFirst: jest.fn().mockResolvedValue(ticket),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          ...ticket,
          assignedToMembershipId: tenant.workspaceMembershipId,
        }),
      },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((callback: (txClient: never) => unknown) =>
      callback(prisma as never),
    );
    const audit = { record: jest.fn() };
    const service = new TicketsService(prisma as never, audit as never, slaServiceMock() as never);

    const updated = await service.claim(scopedTenant, ticket.id);

    expect(prisma.ticket.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: ticket.id,
          workspaceId: tenant.workspaceId,
          deletedAt: null,
          updatedAt: ticket.updatedAt,
          departmentId: 'dept-1',
          assignedToMembershipId: null,
        }),
        data: { assignedToMembershipId: tenant.workspaceMembershipId },
      }),
    );
    expect(updated.assignedToMembershipId).toBe(tenant.workspaceMembershipId);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ticket.claimed' }),
    );
  });

  it('does not allow claim to take over an assigned ticket', async () => {
    const ticket = ticketRecord({
      departmentId: 'dept-1',
      assignedToMembershipId: '00000000-0000-4000-8000-000000000009',
    });
    const prisma = {
      workspaceMembership: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: tenant.workspaceMembershipId, departmentId: 'dept-1' }),
      },
      ticket: { findFirst: jest.fn().mockResolvedValue(ticket) },
    };
    const audit = { record: jest.fn() };
    const service = new TicketsService(prisma as never, audit as never, slaServiceMock() as never);

    await expect(
      service.claim({ ...tenant, permissions: ['tickets.view', 'tickets.claim'] }, ticket.id),
    ).rejects.toThrow('TICKET_ALREADY_ASSIGNED');
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('rejects claim when the actor has no current active department membership', async () => {
    const ticket = ticketRecord({ departmentId: 'dept-1' });
    const prisma: {
      workspaceMembership: { findFirst: jest.Mock };
      ticket: { findFirst: jest.Mock; updateMany: jest.Mock };
      $transaction: jest.Mock;
    } = {
      workspaceMembership: { findFirst: jest.fn().mockResolvedValue(null) },
      ticket: { findFirst: jest.fn().mockResolvedValue(ticket), updateMany: jest.fn() },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((callback: (txClient: never) => unknown) =>
      callback(prisma as never),
    );
    const audit = { record: jest.fn() };
    const service = new TicketsService(prisma as never, audit as never, slaServiceMock() as never);

    await expect(
      service.claim({ ...tenant, permissions: ['tickets.view', 'tickets.claim'] }, ticket.id),
    ).rejects.toThrow('TICKET_CLAIM_ACTIVE_DEPARTMENT_REQUIRED');
    expect(prisma.ticket.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('rejects stale claim when department or assignment changed after visibility read', async () => {
    const ticket = ticketRecord({ departmentId: 'dept-1' });
    const prisma: {
      workspaceMembership: { findFirst: jest.Mock };
      ticket: { findFirst: jest.Mock; updateMany: jest.Mock };
      $transaction: jest.Mock;
    } = {
      workspaceMembership: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: tenant.workspaceMembershipId, departmentId: 'dept-1' }),
      },
      ticket: {
        findFirst: jest.fn().mockResolvedValue(ticket),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((callback: (txClient: never) => unknown) =>
      callback(prisma as never),
    );
    const audit = { record: jest.fn() };
    const service = new TicketsService(prisma as never, audit as never, slaServiceMock() as never);

    await expect(
      service.claim({ ...tenant, permissions: ['tickets.view', 'tickets.claim'] }, ticket.id),
    ).rejects.toThrow('TICKET_CLAIM_STALE');
    expect(prisma.ticket.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          updatedAt: ticket.updatedAt,
          departmentId: 'dept-1',
          assignedToMembershipId: null,
        }),
      }),
    );
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('rejects stale escalation expected levels without audit', async () => {
    const ticket = ticketRecord({ escalationLevel: TicketEscalationLevel.LEVEL_1 });
    const prisma = {
      ticket: { findFirst: jest.fn().mockResolvedValue(ticket), updateMany: jest.fn() },
    };
    const audit = { record: jest.fn() };
    const service = new TicketsService(prisma as never, audit as never, slaServiceMock() as never);

    await expect(
      service.updateEscalation(tenant, ticket.id, {
        action: 'ESCALATE',
        expectedLevel: TicketEscalationLevel.NONE,
        reason: 'Needs manager attention',
      }),
    ).rejects.toThrow('TICKET_ESCALATION_STALE');
    expect(prisma.ticket.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('escalates one level with bounded reason and safe audit metadata', async () => {
    const ticket = ticketRecord();
    const prisma: {
      ticket: { findFirst: jest.Mock; updateMany: jest.Mock; findUniqueOrThrow: jest.Mock };
      $transaction: jest.Mock;
    } = {
      ticket: {
        findFirst: jest.fn().mockResolvedValue(ticket),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ ...ticket, escalationLevel: TicketEscalationLevel.LEVEL_1 }),
      },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((callback: (txClient: never) => unknown) =>
      callback(prisma as never),
    );
    const audit = { record: jest.fn() };
    const service = new TicketsService(prisma as never, audit as never, slaServiceMock() as never);

    await service.updateEscalation(tenant, ticket.id, {
      action: 'ESCALATE',
      expectedLevel: TicketEscalationLevel.NONE,
      reason: ' Needs manager attention ',
    });

    expect(prisma.ticket.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ escalationLevel: TicketEscalationLevel.NONE }),
        data: expect.objectContaining({
          escalationLevel: TicketEscalationLevel.LEVEL_1,
          escalationLastReason: 'Needs manager attention',
        }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ticket.escalation_changed',
        metadata: expect.objectContaining({
          fromLevel: TicketEscalationLevel.NONE,
          toLevel: TicketEscalationLevel.LEVEL_1,
          reason: 'Needs manager attention',
        }),
      }),
    );
  });

  it('rejects duplicate concurrent escalation without moving a second level or auditing success', async () => {
    const ticket = ticketRecord();
    const prisma: {
      ticket: { findFirst: jest.Mock; updateMany: jest.Mock };
      $transaction: jest.Mock;
    } = {
      ticket: {
        findFirst: jest.fn().mockResolvedValue(ticket),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((callback: (txClient: never) => unknown) =>
      callback(prisma as never),
    );
    const audit = { record: jest.fn() };
    const service = new TicketsService(prisma as never, audit as never, slaServiceMock() as never);

    await expect(
      service.updateEscalation(tenant, ticket.id, {
        action: 'ESCALATE',
        expectedLevel: TicketEscalationLevel.NONE,
        reason: 'Needs manager attention',
      }),
    ).rejects.toThrow('TICKET_ESCALATION_STALE');
    expect(prisma.ticket.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ escalationLevel: TicketEscalationLevel.NONE }),
        data: expect.objectContaining({ escalationLevel: TicketEscalationLevel.LEVEL_1 }),
      }),
    );
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('rejects foreign saved-view filter references before persistence', async () => {
    const prisma = {
      workspaceMembership: {
        findFirst: jest.fn().mockResolvedValue({ id: tenant.workspaceMembershipId }),
      },
      statusDefinition: { findFirst: jest.fn().mockResolvedValue(null) },
      ticketSavedView: { create: jest.fn() },
    };
    const service = new TicketsService(
      prisma as never,
      { record: jest.fn() } as never,
      slaServiceMock() as never,
    );

    await expect(
      service.createSavedView(tenant, {
        name: 'Foreign status',
        scope: 'PERSONAL',
        filters: { statusDefinitionId: 'foreign-status' },
        sort: { sortBy: 'createdAt', sortDirection: 'desc' },
      }),
    ).rejects.toThrow('INVALID_TICKET_STATUS');
    expect(prisma.ticketSavedView.create).not.toHaveBeenCalled();
  });

  it('suppresses no-op saved-view audit and mutation', async () => {
    const view = savedViewRecord();
    const prisma = {
      ticketSavedView: {
        findFirst: jest.fn().mockResolvedValue(view),
        update: jest.fn(),
      },
    };
    const audit = { record: jest.fn() };
    const service = new TicketsService(prisma as never, audit as never, slaServiceMock() as never);

    await expect(
      service.updateSavedView(tenant, view.id, {
        filters: { queue: 'ALL_VISIBLE' },
        sort: { sortBy: 'createdAt', sortDirection: 'desc' },
      }),
    ).resolves.toMatchObject({ id: view.id, filters: view.filters, sort: view.sort });
    expect(prisma.ticketSavedView.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('lists ticket attachments through visible ticket scope without presigned URL fan-out', async () => {
    const ticket = ticketRecord();
    const storage = { createPresignedDownloadUrl: jest.fn() };
    const prisma = {
      ticket: { findFirst: jest.fn().mockResolvedValue(ticket) },
      ticketAttachment: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn((queries: Array<Promise<unknown>>) => Promise.all(queries)),
    };
    const service = new TicketsService(
      prisma as never,
      { record: jest.fn() } as never,
      slaServiceMock() as never,
      storage as never,
      { add: jest.fn() } as never,
    );

    await expect(
      service.listAttachments(
        {
          ...tenant,
          permissions: ['tickets.view', 'tickets.view_all', 'tickets.attachments.view'],
        },
        ticket.id,
        { page: 1, pageSize: 20 },
      ),
    ).resolves.toEqual({ items: [], page: 1, pageSize: 20, total: 0 });

    expect(prisma.ticket.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: ticket.id }) }),
    );
    expect(prisma.ticketAttachment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: tenant.workspaceId,
          ticketId: ticket.id,
          removedAt: null,
          attachment: { deletedAt: null },
        }),
      }),
    );
    expect(storage.createPresignedDownloadUrl).not.toHaveBeenCalled();
  });

  it('filters private ticket activity before count and pagination', async () => {
    const ticket = ticketRecord();
    const prisma = {
      ticket: { findFirst: jest.fn().mockResolvedValue(ticket) },
      workspace: { findUnique: jest.fn().mockResolvedValue({ timezone: 'UTC' }) },
      auditLog: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn((queries: Array<Promise<unknown>>) => Promise.all(queries)),
    };
    const service = new TicketsService(
      prisma as never,
      { record: jest.fn() } as never,
      slaServiceMock() as never,
    );

    await service.activity(
      { ...tenant, permissions: ['tickets.view', 'tickets.view_all', 'tickets.activity.view'] },
      ticket.id,
      { page: 1, pageSize: 20 },
    );

    expect(prisma.auditLog.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          action: expect.objectContaining({
            notIn: expect.arrayContaining([
              'ticket.internal_note_added',
              'ticket.attachment_file_uploaded',
              'ticket.attachment_url_added',
              'ticket.attachment_removed',
            ]),
          }),
        }),
      }),
    );
  });

  it('validates ticket activity action filters and scopes actor membership to the workspace', async () => {
    const ticket = ticketRecord();
    const prisma = {
      ticket: { findFirst: jest.fn().mockResolvedValue(ticket) },
      workspace: { findUnique: jest.fn().mockResolvedValue({ timezone: 'UTC' }) },
      workspaceMembership: {
        findFirst: jest.fn().mockResolvedValue({ userId: '00000000-0000-4000-8000-000000000099' }),
      },
      auditLog: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn((queries: Array<Promise<unknown>>) => Promise.all(queries)),
    };
    const service = new TicketsService(
      prisma as never,
      { record: jest.fn() } as never,
      slaServiceMock() as never,
    );

    await service.activity(
      { ...tenant, permissions: ['tickets.view', 'tickets.view_all', 'tickets.activity.view'] },
      ticket.id,
      {
        page: 1,
        pageSize: 20,
        action: 'ticket.status_changed',
        actorMembershipId: '00000000-0000-4000-8000-000000000088',
      },
    );

    expect(prisma.workspaceMembership.findFirst).toHaveBeenCalledWith({
      where: {
        id: '00000000-0000-4000-8000-000000000088',
        workspaceId: tenant.workspaceId,
      },
      select: { userId: true },
    });
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          action: 'ticket.status_changed',
          userId: '00000000-0000-4000-8000-000000000099',
        }),
      }),
    );

    await expect(
      service.activity(
        { ...tenant, permissions: ['tickets.view', 'tickets.view_all', 'tickets.activity.view'] },
        ticket.id,
        { page: 1, pageSize: 20, action: 'workspace.settings_changed' },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('stores URL attachments without copying sensitive query strings into audit metadata', async () => {
    const ticket = ticketRecord();
    const attachmentId = '00000000-0000-4000-8000-000000000090';
    const tx = {
      ticket: {
        findFirst: jest.fn().mockResolvedValue({ id: ticket.id }),
      },
      attachment: {
        create: jest.fn().mockResolvedValue({ id: attachmentId }),
      },
      ticketAttachment: {
        create: jest.fn().mockResolvedValue({}),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          ticketId: ticket.id,
          attachmentId,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          removedAt: null,
          attachment: {
            id: attachmentId,
            workspaceId: tenant.workspaceId,
            type: 'URL',
            assetId: null,
            url: 'https://example.com/path?token=secret#frag',
            displayName: 'https://example.com/path',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            asset: null,
            createdBy: { id: tenant.userId, email: 'owner@example.com', name: 'Owner' },
          },
          attachedBy: { id: tenant.userId, email: 'owner@example.com', name: 'Owner' },
        }),
      },
    };
    const prisma = {
      ticket: { findFirst: jest.fn().mockResolvedValue(ticket) },
      $transaction: jest.fn((callback: (txClient: typeof tx) => unknown) => callback(tx)),
    };
    const audit = { record: jest.fn() };
    const service = new TicketsService(prisma as never, audit as never, slaServiceMock() as never);

    const result = await service.addUrlAttachment(
      { ...tenant, permissions: ['tickets.view', 'tickets.view_all', 'tickets.attachments.add'] },
      ticket.id,
      { url: '  https://example.com/path?token=secret#frag  ' },
    );

    expect(tx.attachment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          url: 'https://example.com/path?token=secret#frag',
          displayName: 'https://example.com/path',
        }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { attachmentId } }),
    );
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('secret');
    expect(result.displayName).toBe('https://example.com/path');
  });

  it('requires tickets.view and tickets.reports.view for service desk reports', async () => {
    const service = new TicketsService(
      {} as never,
      { record: jest.fn() } as never,
      slaServiceMock() as never,
    );

    await expect(
      service.reports(
        { ...tenant, permissions: ['tickets.reports.view'] },
        reportQuery({ page: 1, pageSize: 20 }),
      ),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.reports(
        { ...tenant, permissions: ['tickets.view'] },
        reportQuery({ page: 1, pageSize: 20 }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('exports report CSV from the authorized population with formula protection and no requester contact PII', async () => {
    const prisma = {
      ticket: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([
          {
            id: '00000000-0000-4000-8000-000000000091',
            ticketNumber: 'TKT-000009',
            sequenceNumber: 9,
            subject: '=cmd',
            priority: TaskPriority.URGENT,
            escalationLevel: TicketEscalationLevel.LEVEL_1,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-02T00:00:00.000Z'),
            statusDefinition: { name: '+Resolved' },
            requester: {
              type: 'EXTERNAL',
              externalName: '@Customer',
              externalEmail: 'customer@example.com',
              externalPhone: '+15555550100',
              internalMembership: null,
            },
            department: { name: '-Support' },
            assignedToMembership: { user: { name: 'Agent', email: 'agent@example.com' } },
            slaState: {
              firstResponseDueAt: new Date('2026-01-01T01:00:00.000Z'),
              firstResponseCompletedAt: null,
              firstResponseBreachedAt: new Date('2026-01-01T02:00:00.000Z'),
              firstResponsePausedAt: null,
              firstResponseNotApplicableAt: null,
              resolutionDueAt: new Date('2026-01-02T01:00:00.000Z'),
              resolutionCompletedAt: new Date('2026-01-02T02:00:00.000Z'),
              resolutionBreachedAt: new Date('2026-01-02T01:30:00.000Z'),
              resolutionPausedAt: null,
            },
          },
        ]),
      },
      workspaceMembership: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: tenant.workspaceMembershipId, departmentId: null }),
      },
      workspace: { findUnique: jest.fn().mockResolvedValue({ timezone: 'UTC' }) },
    };
    const service = new TicketsService(
      prisma as never,
      { record: jest.fn() } as never,
      slaServiceMock() as never,
    );

    const result = await service.reportsCsv(
      {
        ...tenant,
        permissions: ['tickets.view', 'tickets.view_all', 'tickets.reports.export'],
      },
      reportQuery({ page: 1, pageSize: 20, search: 'login' }),
    );

    expect(prisma.ticket.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: tenant.workspaceId,
          deletedAt: null,
          OR: expect.any(Array),
        }),
      }),
    );
    expect(result.contentType).toBe('text/csv; charset=utf-8');
    expect(result.csv).toContain('"\'=cmd"');
    expect(result.csv).toContain('"\' +Resolved"'.replace(' ', ''));
    expect(result.csv).toContain('"\'@Customer"');
    expect(result.csv).toContain('"\'-Support"');
    expect(result.csv).toContain('"BREACHED"');
    expect(result.csv).not.toContain('customer@example.com');
    expect(result.csv).not.toContain('+15555550100');
    expect(result.csv).not.toContain('escalation reason');
  });

  it('keeps resolution trends to first terminal evidence before applying the report window', async () => {
    const prisma = {
      statusDefinition: {
        findMany: jest.fn().mockResolvedValue([{ id: '00000000-0000-4000-8000-000000000077' }]),
      },
      ticket: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: '00000000-0000-4000-8000-000000000091' },
            { id: '00000000-0000-4000-8000-000000000092' },
          ]),
      },
      auditLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            entityId: '00000000-0000-4000-8000-000000000091',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
          },
          {
            entityId: '00000000-0000-4000-8000-000000000091',
            createdAt: new Date('2026-02-01T00:00:00.000Z'),
          },
          {
            entityId: '00000000-0000-4000-8000-000000000092',
            createdAt: new Date('2026-02-02T00:00:00.000Z'),
          },
        ]),
      },
    };
    const service = new TicketsService(
      prisma as never,
      { record: jest.fn() } as never,
      slaServiceMock() as never,
    );

    const rows = await (
      service as unknown as {
        resolutionTrendRows: (
          workspaceId: string,
          where: Record<string, unknown>,
          range: { gte: Date; lte: Date },
        ) => Promise<Array<{ createdAt: Date }>>;
      }
    ).resolutionTrendRows(
      tenant.workspaceId,
      { workspaceId: tenant.workspaceId },
      {
        gte: new Date('2026-02-01T00:00:00.000Z'),
        lte: new Date('2026-02-28T23:59:59.999Z'),
      },
    );

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ createdAt: expect.anything() }),
      }),
    );
    expect(rows).toEqual([{ createdAt: new Date('2026-02-02T00:00:00.000Z') }]);
  });
});

function ticketRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000006',
    workspaceId: tenant.workspaceId,
    sequenceNumber: 1,
    ticketNumber: 'TKT-000001',
    subject: 'Login issue',
    description: null,
    statusDefinitionId: '00000000-0000-4000-8000-000000000007',
    statusDefinition: {
      id: '00000000-0000-4000-8000-000000000007',
      name: 'New',
      color: '#64748B',
      isTerminal: false,
      isActive: true,
    },
    priority: TaskPriority.MEDIUM,
    requester: null,
    departmentId: null,
    department: null,
    assignedToMembershipId: null,
    assignedToMembership: null,
    escalationLevel: TicketEscalationLevel.NONE,
    escalationChangedAt: null,
    escalationChangedByMembershipId: null,
    escalationChangedByMembership: null,
    createdByMembership: null,
    slaState: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function reportQuery(overrides: Record<string, unknown> = {}) {
  return {
    page: 1,
    pageSize: 20,
    queue: 'ALL_VISIBLE',
    sortBy: 'createdAt',
    sortDirection: 'desc',
    bucket: 'DAY',
    ...overrides,
  } as never;
}

function slaServiceMock() {
  return {
    initializeForTicket: jest.fn(),
    handleStatusChange: jest.fn().mockResolvedValue([]),
    handleConversationEntry: jest.fn().mockResolvedValue(null),
  };
}

function savedViewRecord() {
  return {
    id: '00000000-0000-4000-8000-000000000008',
    workspaceId: tenant.workspaceId,
    name: 'My queue',
    scope: 'PERSONAL',
    ownerMembershipId: tenant.workspaceMembershipId,
    filterSchemaVersion: 1,
    filters: { queue: 'ALL_VISIBLE' },
    sort: { sortBy: 'createdAt', sortDirection: 'desc' },
    createdByMembershipId: tenant.workspaceMembershipId,
    updatedByMembershipId: tenant.workspaceMembershipId,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}
