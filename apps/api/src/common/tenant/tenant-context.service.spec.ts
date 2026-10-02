import { ForbiddenException } from '@nestjs/common';
import { TenantContextService } from './tenant-context.service';

describe('TenantContextService', () => {
  const userId = '00000000-0000-4000-8000-000000000001';
  const superAgencyAId = '00000000-0000-4000-8000-0000000000aa';
  const superAgencyBId = '00000000-0000-4000-8000-0000000000bb';
  const agencyAId = '00000000-0000-4000-8000-0000000000a1';
  const agencyBId = '00000000-0000-4000-8000-0000000000b1';
  const workspaceBId = '00000000-0000-4000-8000-0000000000b2';

  it('resolves an active Super Agency membership with permission-key context', async () => {
    const service = new TenantContextService({
      superAgencyMembership: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'super-membership-id',
          status: 'ACTIVE',
          user: { status: 'ACTIVE' },
          superAgency: { status: 'ACTIVE' },
          role: {
            id: 'role-id',
            key: 'SUPER_AGENCY_OWNER',
            scope: 'SUPER_AGENCY',
            isActive: true,
            rolePermissions: [{ permission: { key: 'super_agency.view' } }],
          },
        }),
      },
    } as never);

    await expect(
      service.resolveSuperAgency(
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
      ),
    ).resolves.toMatchObject({
      superAgencyMembershipId: 'super-membership-id',
      permissions: ['super_agency.view'],
    });
  });

  it('does not fall back to a first Super Agency membership', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const service = new TenantContextService({
      superAgencyMembership: { findUnique },
    } as never);

    await expect(
      service.resolveSuperAgency(
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_superAgencyId: {
            userId: '00000000-0000-4000-8000-000000000001',
            superAgencyId: '00000000-0000-4000-8000-000000000002',
          },
        },
      }),
    );
  });

  it('blocks descendant Workspace access when the parent Super Agency is suspended', async () => {
    const service = new TenantContextService({
      workspace: {
        findFirst: jest.fn().mockResolvedValue({
          status: 'ACTIVE',
          agency: {
            status: 'ACTIVE',
            superAgencyId: '00000000-0000-4000-8000-000000000010',
            superAgency: { status: 'SUSPENDED' },
          },
        }),
      },
    } as never);

    await expect(
      service.resolveWorkspace(
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000003',
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects suspended memberships', async () => {
    const service = new TenantContextService({
      workspace: {
        findFirst: jest.fn().mockResolvedValue({
          status: 'ACTIVE',
          agency: {
            status: 'ACTIVE',
            superAgencyId: '00000000-0000-4000-8000-000000000010',
            superAgency: { status: 'ACTIVE' },
          },
        }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }),
      },
      agencyMembership: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'agency-membership-id',
          status: 'ACTIVE',
          role: { id: 'agency-role-id', key: 'AGENCY_USER', scope: 'AGENCY', rolePermissions: [] },
        }),
      },
      workspaceMembership: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'membership-id',
          status: 'SUSPENDED',
          role: { id: 'role-id', key: 'MEMBER', scope: 'WORKSPACE', rolePermissions: [] },
        }),
      },
    } as never);

    await expect(
      service.resolveWorkspace(
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000003',
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('denies Super Agency A access to an Agency belonging to Super Agency B', async () => {
    const superAgencyMembershipFindUnique = jest.fn().mockResolvedValue(null);
    const service = new TenantContextService({
      agencyMembership: { findUnique: jest.fn().mockResolvedValue(null) },
      agency: {
        findUnique: jest.fn().mockResolvedValue({
          status: 'ACTIVE',
          superAgencyId: superAgencyBId,
          superAgency: { status: 'ACTIVE' },
        }),
      },
      superAgencyMembership: { findUnique: superAgencyMembershipFindUnique },
    } as never);

    await expect(service.resolveAgency(userId, agencyBId)).rejects.toThrow(ForbiddenException);
    expect(superAgencyMembershipFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_superAgencyId: { userId, superAgencyId: superAgencyBId } },
      }),
    );
  });

  it('denies Super Agency A access to a Subaccount under an unrelated Agency', async () => {
    const superAgencyMembershipFindUnique = jest.fn().mockResolvedValue(null);
    const service = new TenantContextService({
      workspace: {
        findFirst: jest.fn().mockResolvedValue({
          status: 'ACTIVE',
          agency: {
            status: 'ACTIVE',
            superAgencyId: superAgencyBId,
            superAgency: { status: 'ACTIVE' },
          },
        }),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) },
      agencyMembership: { findUnique: jest.fn().mockResolvedValue(null) },
      superAgencyMembership: { findUnique: superAgencyMembershipFindUnique },
    } as never);

    await expect(service.resolveWorkspace(userId, agencyBId, workspaceBId)).rejects.toThrow(
      ForbiddenException,
    );
    expect(superAgencyMembershipFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_superAgencyId: { userId, superAgencyId: superAgencyBId } },
      }),
    );
  });

  it('denies Agency A users from resolving Agency B without direct or parent membership', async () => {
    const service = new TenantContextService({
      agencyMembership: { findUnique: jest.fn().mockResolvedValue(null) },
      agency: {
        findUnique: jest.fn().mockResolvedValue({
          status: 'ACTIVE',
          superAgencyId: superAgencyBId,
          superAgency: { status: 'ACTIVE' },
        }),
      },
      superAgencyMembership: { findUnique: jest.fn().mockResolvedValue(null) },
    } as never);

    await expect(service.resolveAgency(userId, agencyBId)).rejects.toThrow(ForbiddenException);
  });

  it('denies Agency A users from resolving Agency B Subaccounts', async () => {
    const service = new TenantContextService({
      workspace: {
        findFirst: jest.fn().mockResolvedValue({
          status: 'ACTIVE',
          agency: {
            status: 'ACTIVE',
            superAgencyId: superAgencyBId,
            superAgency: { status: 'ACTIVE' },
          },
        }),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) },
      agencyMembership: { findUnique: jest.fn().mockResolvedValue(null) },
      superAgencyMembership: { findUnique: jest.fn().mockResolvedValue(null) },
    } as never);

    await expect(service.resolveWorkspace(userId, agencyBId, workspaceBId)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('denies Subaccount-only users from escalating to parent Agency context', async () => {
    const service = new TenantContextService({
      agencyMembership: { findUnique: jest.fn().mockResolvedValue(null) },
      agency: {
        findUnique: jest.fn().mockResolvedValue({
          status: 'ACTIVE',
          superAgencyId: superAgencyAId,
          superAgency: { status: 'ACTIVE' },
        }),
      },
      superAgencyMembership: { findUnique: jest.fn().mockResolvedValue(null) },
    } as never);

    await expect(service.resolveAgency(userId, agencyAId)).rejects.toThrow(ForbiddenException);
  });

  it('denies Agency users from escalating to Super Agency context', async () => {
    const service = new TenantContextService({
      superAgencyMembership: { findUnique: jest.fn().mockResolvedValue(null) },
    } as never);

    await expect(service.resolveSuperAgency(userId, superAgencyAId)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('allows an active custom Workspace host only for its exact Workspace context', async () => {
    const customDomainFindFirst = jest.fn().mockResolvedValue({
      scopeType: 'WORKSPACE',
      scopeId: workspaceBId,
      superAgencyId: superAgencyBId,
      agencyId: agencyBId,
      workspaceId: workspaceBId,
    });
    const service = new TenantContextService({
      customDomain: { findFirst: customDomainFindFirst },
    } as never);

    await expect(
      service.assertHostMatchesWorkspace('Client.Example.com:443', workspaceBId),
    ).resolves.toBeUndefined();
    await expect(service.assertHostMatchesAgency('client.example.com', agencyBId)).rejects.toThrow(
      ForbiddenException,
    );
    expect(customDomainFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          normalizedHostname: 'client.example.com',
          status: 'ACTIVE',
          removedAt: null,
        }),
      }),
    );
  });

  it('does not bind unsafe or canonical hosts to a tenant fallback', async () => {
    const customDomainFindFirst = jest.fn();
    const service = new TenantContextService({
      customDomain: { findFirst: customDomainFindFirst },
    } as never);

    await expect(
      service.assertHostMatchesWorkspace('localhost:7100', workspaceBId),
    ).resolves.toBeUndefined();
    expect(customDomainFindFirst).not.toHaveBeenCalled();
  });
});
