import { SuperAgenciesService } from './super-agencies.service';
import { PermissionKeys } from '../../common/authorization/permissions';

describe('SuperAgenciesService', () => {
  it('creates a persisted Super Agency and records parent-scope audit metadata', async () => {
    const createdAt = new Date();
    const prisma = {
      superAgency: {
        create: jest.fn().mockResolvedValue({
          id: 'super-agency-id',
          name: 'Super Agency A',
          slug: 'super-agency-a',
          status: 'ACTIVE',
          createdById: 'user-id',
          createdAt,
          updatedAt: createdAt,
        }),
      },
    };
    const audit = { record: jest.fn() };
    const service = new SuperAgenciesService(prisma as never, audit as never, {} as never);

    await expect(
      service.create(
        { id: 'user-id', email: 'owner@zeaplay.test' },
        { name: ' Super Agency A ', slug: 'SUPER-AGENCY-A'.toLowerCase() },
      ),
    ).resolves.toMatchObject({ id: 'super-agency-id' });

    expect(prisma.superAgency.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          name: 'Super Agency A',
          slug: 'super-agency-a',
          createdById: 'user-id',
        },
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        superAgencyId: 'super-agency-id',
        action: 'super_agency.create',
      }),
    );
  });

  it('lists Super Agencies with bounded pagination and safe filters', async () => {
    const createdAt = new Date();
    const prisma = {
      $transaction: jest.fn().mockResolvedValue([
        [
          {
            id: 'super-agency-id',
            name: 'Super Agency A',
            slug: 'super-agency-a',
            status: 'ACTIVE',
            createdById: 'user-id',
            createdAt,
            updatedAt: createdAt,
          },
        ],
        1,
      ]),
      superAgency: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };
    const service = new SuperAgenciesService(
      prisma as never,
      { record: jest.fn() } as never,
      {} as never,
    );

    await expect(
      service.list({ page: 2, pageSize: 100, status: 'ACTIVE', search: 'Agency' }),
    ).resolves.toMatchObject({ page: 2, pageSize: 100, total: 1, totalPages: 1 });

    expect(prisma.superAgency.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 100,
        take: 100,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    );
  });

  it('rejects duplicate active Super Agency memberships safely', async () => {
    const service = new SuperAgenciesService(
      {
        user: { findUnique: jest.fn().mockResolvedValue({ id: 'target-user-id' }) },
        role: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'role-id',
            key: 'SUPER_AGENCY_MEMBER',
            rolePermissions: [{ permission: { key: 'super_agency.view' } }],
          }),
        },
        superAgencyMembership: {
          findUnique: jest.fn().mockResolvedValue({ id: 'existing-id', status: 'ACTIVE' }),
        },
      } as never,
      { record: jest.fn() } as never,
      {} as never,
    );

    await expect(
      service.addMembership(
        {
          userId: 'actor-id',
          superAgencyId: 'super-agency-id',
          superAgencyMembershipId: 'actor-membership-id',
          roleId: 'actor-role-id',
          roleName: 'SUPER_AGENCY_OWNER',
          permissions: ['super_agency.members.manage', 'super_agency.view'],
          status: 'ACTIVE',
        },
        { email: 'target@zeaplay.test', role: 'SUPER_AGENCY_MEMBER' },
      ),
    ).rejects.toThrow('User already has an active Super Agency membership.');
  });

  it('creates tenant-bound invitations with a hashed token and safe audit metadata', async () => {
    const createdAt = new Date();
    const audit = { record: jest.fn() };
    const prisma = {
      role: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'role-id',
          key: 'SUPER_AGENCY_MEMBER',
          rolePermissions: [{ permission: { key: 'super_agency.view' } }],
        }),
      },
      superAgencyMembership: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      superAgencyInvitation: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'invite-id',
          superAgencyId: 'super-agency-id',
          email: 'target@zeaplay.test',
          roleId: 'role-id',
          status: 'PENDING',
          expiresAt: createdAt,
          acceptedAt: null,
          revokedAt: null,
          createdAt,
          updatedAt: createdAt,
          role: {
            id: 'role-id',
            key: 'SUPER_AGENCY_MEMBER',
            name: 'Member',
            scope: 'SUPER_AGENCY',
          },
        }),
      },
    };
    const mail = { send: jest.fn().mockResolvedValue(undefined) };
    const service = new SuperAgenciesService(prisma as never, audit as never, mail as never);

    const result = await service.createInvitation(
      {
        userId: 'actor-id',
        superAgencyId: 'super-agency-id',
        superAgencyMembershipId: 'actor-membership-id',
        roleId: 'actor-role-id',
        roleName: 'SUPER_AGENCY_OWNER',
        permissions: ['super_agency.members.invite', 'super_agency.view'],
        status: 'ACTIVE',
      },
      { email: 'TARGET@zeaplay.test', role: 'SUPER_AGENCY_MEMBER' },
    );

    expect(result).not.toHaveProperty('token');
    const sentText = mail.send.mock.calls[0]?.[0]?.text as string;
    const token = sentText.match(/Invitation token: ([A-Za-z0-9_-]+)/)?.[1];
    expect(token).toEqual(expect.any(String));
    const tokenText = token ?? '';
    expect(prisma.superAgencyInvitation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tokenHash: expect.not.stringContaining(tokenText),
          superAgencyId: 'super-agency-id',
          emailNormalized: 'target@zeaplay.test',
          roleId: 'role-id',
        }),
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'super_agency.invitation.created',
        metadata: expect.not.objectContaining({ token: expect.any(String) }),
      }),
    );
  });

  it('rejects already-claimed invitation acceptance without creating a membership', async () => {
    type PrismaHarness = {
      superAgencyInvitation: {
        findUnique: jest.Mock;
        updateMany: jest.Mock;
      };
      user: { findUnique: jest.Mock };
      superAgencyMembership: { upsert: jest.Mock };
      $transaction: jest.Mock;
    };
    const prisma = {} as PrismaHarness;
    Object.assign(prisma, {
      superAgencyInvitation: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'invite-id',
          superAgencyId: 'super-agency-id',
          emailNormalized: 'target@zeaplay.test',
          roleId: 'role-id',
          status: 'PENDING',
          expiresAt: new Date(Date.now() + 60_000),
          superAgency: { status: 'ACTIVE' },
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'target-user-id',
          email: 'target@zeaplay.test',
        }),
      },
      superAgencyMembership: {
        upsert: jest.fn(),
      },
      $transaction: jest.fn((callback: (tx: PrismaHarness) => unknown) => callback(prisma)),
    });
    const service = new SuperAgenciesService(
      prisma as never,
      { record: jest.fn() } as never,
      {} as never,
    );

    await expect(
      service.acceptInvitation(
        { id: 'target-user-id', email: 'target@zeaplay.test' },
        { token: 'abcdefghijklmnopqrstuvwxyzABCDEFGH123456' },
      ),
    ).rejects.toThrow('Invitation has already been used.');
    expect(prisma.superAgencyMembership.upsert).not.toHaveBeenCalled();
  });

  it('rejects platform-only billing permissions when creating custom Super Agency roles', async () => {
    const prisma = {
      permission: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'permission-price', key: PermissionKeys.billingPriceManage }]),
      },
      role: { create: jest.fn() },
      $transaction: jest.fn(),
    };
    const service = new SuperAgenciesService(
      prisma as never,
      { record: jest.fn() } as never,
      {} as never,
    );

    await expect(
      service.createRole(
        {
          userId: 'actor-id',
          superAgencyId: 'super-agency-id',
          superAgencyMembershipId: 'membership-id',
          roleId: 'role-id',
          roleName: 'SUPER_AGENCY_OWNER',
          permissions: ['*'],
          status: 'ACTIVE',
        },
        { name: 'Unsafe Billing Admin', permissionIds: ['permission-price'] },
      ),
    ).rejects.toThrow('Platform permissions are not assignable.');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects platform-only billing permissions when replacing custom role permissions', async () => {
    const prisma = {
      role: {
        findFirst: jest.fn().mockResolvedValue({ id: 'role-id' }),
      },
      permission: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'permission-trial', key: PermissionKeys.billingTrialManage },
          { id: 'permission-support', key: PermissionKeys.billingSupportView },
        ]),
      },
      $transaction: jest.fn(),
    };
    const service = new SuperAgenciesService(
      prisma as never,
      { record: jest.fn() } as never,
      {} as never,
    );

    await expect(
      service.replaceRolePermissions(
        {
          userId: 'actor-id',
          superAgencyId: 'super-agency-id',
          superAgencyMembershipId: 'membership-id',
          roleId: 'role-id',
          roleName: 'SUPER_AGENCY_OWNER',
          permissions: ['*'],
          status: 'ACTIVE',
        },
        'role-id',
        { permissionIds: ['permission-trial', 'permission-support'] },
      ),
    ).rejects.toThrow('Platform permissions are not assignable.');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
