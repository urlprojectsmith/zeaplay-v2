import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AgenciesService } from './agencies.service';

describe('AgenciesService hierarchy foundation', () => {
  const superAgencyTenant = {
    userId: '00000000-0000-4000-8000-000000000001',
    superAgencyId: '00000000-0000-4000-8000-000000000010',
    superAgencyMembershipId: '00000000-0000-4000-8000-000000000011',
    roleId: '00000000-0000-4000-8000-000000000012',
    roleName: 'SUPER_AGENCY_OWNER',
    permissions: ['agency.read', 'agency.create', 'agency.update'],
    status: 'ACTIVE',
  };

  it('requires a valid Super Agency before creating an Agency', async () => {
    const service = new AgenciesService(
      {} as never,
      {} as never,
      { assertSuperAgencyExists: jest.fn().mockRejectedValue(new NotFoundException()) } as never,
    );

    await expect(
      service.create(
        { id: '00000000-0000-4000-8000-000000000001', email: 'owner@zeaplay.test' },
        {
          superAgencyId: '00000000-0000-4000-8000-000000000010',
          name: 'Agency',
          slug: 'agency',
        },
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('does not expose parent transfer through normal update data', async () => {
    const prisma = {
      agency: {
        update: jest.fn().mockResolvedValue({
          id: 'agency-id',
          superAgencyId: 'super-agency-id',
          name: 'Agency',
          slug: 'agency',
          status: 'ACTIVE',
          createdById: 'user-id',
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      },
    };
    const service = new AgenciesService(
      prisma as never,
      { record: jest.fn() } as never,
      { assertSuperAgencyExists: jest.fn() } as never,
    );

    await service.update(
      {
        userId: 'user-id',
        superAgencyId: 'super-agency-id',
        agencyId: 'agency-id',
        agencyMembershipId: 'membership-id',
        roleId: 'role-id',
        roleName: 'AGENCY_OWNER',
        permissions: [],
      },
      { name: 'New Agency' },
    );

    expect(prisma.agency.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { name: 'New Agency', status: undefined },
      }),
    );
  });

  it('rejects Super Agency-scoped Agency creation under a foreign parent', async () => {
    const service = new AgenciesService(
      {} as never,
      {} as never,
      { assertSuperAgencyExists: jest.fn() } as never,
    );

    await expect(
      service.create(
        { id: '00000000-0000-4000-8000-000000000001', email: 'owner@zeaplay.test' },
        {
          superAgencyId: '00000000-0000-4000-8000-000000000010',
          name: 'Agency',
          slug: 'agency',
        },
        {
          userId: '00000000-0000-4000-8000-000000000001',
          superAgencyId: '00000000-0000-4000-8000-000000000099',
          superAgencyMembershipId: '00000000-0000-4000-8000-000000000098',
          roleId: '00000000-0000-4000-8000-000000000097',
          roleName: 'SUPER_AGENCY_OWNER',
          permissions: ['agency.create'],
          status: 'ACTIVE',
        },
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('server-assigns current Super Agency when creating through parent context', async () => {
    const tx = {
      role: {
        findFirst: jest.fn().mockResolvedValue({ id: 'role-id' }),
      },
      agency: {
        create: jest.fn().mockResolvedValue({
          id: 'agency-id',
          superAgencyId: superAgencyTenant.superAgencyId,
          name: 'Agency',
          slug: 'agency',
          status: 'ACTIVE',
          createdById: superAgencyTenant.userId,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      },
    };
    const prisma = {
      ...tx,
      $transaction: jest.fn((callback: (inner: typeof tx) => unknown) => callback(tx)),
    };
    const service = new AgenciesService(
      prisma as never,
      { record: jest.fn() } as never,
      { assertSuperAgencyExists: jest.fn() } as never,
    );

    await service.create(
      { id: superAgencyTenant.userId, email: 'owner@zeaplay.test' },
      { name: 'Agency', slug: 'agency' },
      superAgencyTenant,
    );

    expect(prisma.agency.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ superAgencyId: superAgencyTenant.superAgencyId }),
      }),
    );
  });

  it('lists only Agencies under the current Super Agency with bounded paging', async () => {
    const prisma = {
      $transaction: jest.fn().mockResolvedValue([
        [
          {
            id: 'agency-id',
            superAgencyId: superAgencyTenant.superAgencyId,
            name: 'Agency',
            slug: 'agency',
            status: 'ACTIVE',
            createdById: superAgencyTenant.userId,
            createdAt: new Date(),
            updatedAt: new Date(),
            _count: { memberships: 2, workspaces: 3 },
          },
        ],
        1,
      ]),
      agency: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };
    const service = new AgenciesService(prisma as never, {} as never, {} as never);

    const result = await service.listForSuperAgency(superAgencyTenant, {
      page: 1,
      pageSize: 100,
      search: 'Agency',
      sort: 'NAME_ASC',
    });

    expect(prisma.agency.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ superAgencyId: superAgencyTenant.superAgencyId }),
        take: 100,
      }),
    );
    expect(result.items[0]).toMatchObject({ counts: { members: 2, workspaces: 3 } });
  });

  it('denies parent detail for an Agency outside the current Super Agency', async () => {
    const service = new AgenciesService(
      { agency: { findFirst: jest.fn().mockResolvedValue(null) } } as never,
      {} as never,
      {} as never,
    );

    await expect(service.getForSuperAgency(superAgencyTenant, 'foreign-agency')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('does not expose Super Agency parent transfer through parent update data', async () => {
    const prisma = {
      agency: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'agency-id',
          superAgencyId: superAgencyTenant.superAgencyId,
          name: 'Agency',
          slug: 'agency',
          status: 'ACTIVE',
          createdById: superAgencyTenant.userId,
          createdAt: new Date(),
          updatedAt: new Date(),
          _count: { memberships: 1, workspaces: 1 },
        }),
        update: jest.fn().mockResolvedValue({
          id: 'agency-id',
          superAgencyId: superAgencyTenant.superAgencyId,
          name: 'Updated',
          slug: 'agency',
          status: 'SUSPENDED',
          createdById: superAgencyTenant.userId,
          createdAt: new Date(),
          updatedAt: new Date(),
          _count: { memberships: 1, workspaces: 1 },
        }),
      },
    };
    const service = new AgenciesService(
      prisma as never,
      { record: jest.fn() } as never,
      {} as never,
    );

    await service.updateForSuperAgency(superAgencyTenant, 'agency-id', {
      name: 'Updated',
      status: 'SUSPENDED' as never,
    });

    expect(prisma.agency.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { name: 'Updated', status: 'SUSPENDED' },
      }),
    );
  });
});
