import { ForbiddenException } from '@nestjs/common';
import { WorkspacesService } from './workspaces.service';

describe('WorkspacesService hierarchy management', () => {
  const agencyTenant = {
    userId: '00000000-0000-4000-8000-000000000001',
    superAgencyId: '00000000-0000-4000-8000-000000000010',
    agencyId: '00000000-0000-4000-8000-000000000020',
    agencyMembershipId: '00000000-0000-4000-8000-000000000021',
    roleId: '00000000-0000-4000-8000-000000000022',
    roleName: 'AGENCY_OWNER',
    permissions: ['workspace.read', 'workspace.create'],
  };
  const superAgencyTenant = {
    userId: agencyTenant.userId,
    superAgencyId: agencyTenant.superAgencyId,
    superAgencyMembershipId: '00000000-0000-4000-8000-000000000011',
    roleId: '00000000-0000-4000-8000-000000000012',
    roleName: 'SUPER_AGENCY_OWNER',
    permissions: ['agency.read', 'workspace.read'],
    status: 'ACTIVE',
  };

  it('lists only Workspaces for the current Agency with bounded paging', async () => {
    const prisma = {
      $transaction: jest.fn().mockResolvedValue([
        [
          {
            id: 'workspace-id',
            agencyId: agencyTenant.agencyId,
            name: 'Workspace',
            slug: 'workspace',
            timezone: 'UTC',
            status: 'ACTIVE',
            createdById: agencyTenant.userId,
            createdAt: new Date(),
            updatedAt: new Date(),
            agency: {
              id: agencyTenant.agencyId,
              name: 'Agency',
              slug: 'agency',
              superAgencyId: agencyTenant.superAgencyId,
            },
            _count: { memberships: 4 },
          },
        ],
        1,
      ]),
      workspace: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };
    const service = new WorkspacesService(prisma as never, {} as never, {} as never);

    const result = await service.listForAgencyPaginated(agencyTenant, {
      page: 1,
      pageSize: 100,
      search: 'Workspace',
      sort: 'NAME_ASC',
    });

    expect(prisma.workspace.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ agencyId: agencyTenant.agencyId }),
        take: 100,
      }),
    );
    expect(result.items[0]).toMatchObject({ counts: { members: 4 } });
  });

  it('blocks Workspace creation when the Agency parent is not active', async () => {
    const service = new WorkspacesService(
      {
        agency: {
          findFirst: jest.fn().mockResolvedValue({
            id: agencyTenant.agencyId,
            superAgencyId: agencyTenant.superAgencyId,
            status: 'SUSPENDED',
          }),
        },
      } as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.create(agencyTenant, { name: 'Workspace', slug: 'workspace' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('lists safe descendant Workspace metadata for a child Agency under the current Super Agency', async () => {
    const hierarchy = { assertAgencyBelongsToSuperAgency: jest.fn().mockResolvedValue(undefined) };
    const prisma = {
      $transaction: jest.fn().mockResolvedValue([[], 0]),
      workspace: { findMany: jest.fn(), count: jest.fn() },
      workspaceMembership: { create: jest.fn() },
    };
    const service = new WorkspacesService(prisma as never, {} as never, hierarchy as never);

    await service.listForSuperAgencyAgency(superAgencyTenant, agencyTenant.agencyId, {
      page: 1,
      pageSize: 25,
      sort: 'NEWEST',
    });

    expect(hierarchy.assertAgencyBelongsToSuperAgency).toHaveBeenCalledWith(
      agencyTenant.agencyId,
      superAgencyTenant.superAgencyId,
    );
    expect(prisma.workspace.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.not.objectContaining({
          tasks: expect.anything(),
          projects: expect.anything(),
          tickets: expect.anything(),
        }),
      }),
    );
    expect(prisma.workspaceMembership.create).not.toHaveBeenCalled();
  });

  it('checks membership capacity before activating a new Workspace membership', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-2' }) },
      role: { findFirst: jest.fn().mockResolvedValue({ id: 'role-member' }) },
      $transaction: jest.fn((callback) =>
        callback({
          workspaceMembership: {
            findUnique: jest.fn().mockResolvedValue(null),
            upsert: jest.fn().mockResolvedValue({
              id: 'membership-2',
              userId: 'user-2',
              workspaceId: 'workspace-1',
              status: 'ACTIVE',
              createdAt: new Date(),
              updatedAt: new Date(),
              user: { id: 'user-2', email: 'user@example.com', name: null, status: 'ACTIVE' },
              role: { id: 'role-member', key: 'MEMBER', name: 'Member' },
            }),
          },
        }),
      ),
    };
    const audit = { record: jest.fn() };
    const billing = { assertWorkspaceMembershipAvailableTx: jest.fn() };
    const service = new WorkspacesService(
      prisma as never,
      audit as never,
      {} as never,
      billing as never,
    );

    await service.addMembership(
      {
        ...agencyTenant,
        workspaceId: 'workspace-1',
        workspaceMembershipId: 'membership-1',
      } as never,
      { email: 'user@example.com', role: 'MEMBER' },
    );

    expect(billing.assertWorkspaceMembershipAvailableTx).toHaveBeenCalledWith(
      expect.anything(),
      'workspace-1',
    );
  });

  it('allows membership reduction without checking capacity', async () => {
    const prisma = {
      workspaceMembership: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'membership-2',
          userId: 'user-2',
          status: 'ACTIVE',
          role: { key: 'MEMBER' },
        }),
      },
      $transaction: jest.fn((callback) =>
        callback({
          workspaceMembership: {
            update: jest.fn().mockResolvedValue({
              id: 'membership-2',
              userId: 'user-2',
              workspaceId: 'workspace-1',
              status: 'INACTIVE',
              createdAt: new Date(),
              updatedAt: new Date(),
              user: { id: 'user-2', email: 'user@example.com', name: null, status: 'ACTIVE' },
              role: { id: 'role-member', key: 'MEMBER', name: 'Member' },
            }),
          },
        }),
      ),
    };
    const audit = { record: jest.fn() };
    const billing = { assertWorkspaceMembershipAvailableTx: jest.fn() };
    const service = new WorkspacesService(
      prisma as never,
      audit as never,
      {} as never,
      billing as never,
    );

    await service.updateMembership(
      {
        ...agencyTenant,
        workspaceId: 'workspace-1',
        workspaceMembershipId: 'membership-1',
      } as never,
      'membership-2',
      { status: 'INACTIVE' as never },
    );

    expect(billing.assertWorkspaceMembershipAvailableTx).not.toHaveBeenCalled();
  });
});
