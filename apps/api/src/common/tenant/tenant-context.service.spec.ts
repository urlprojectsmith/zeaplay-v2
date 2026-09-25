import { ForbiddenException } from '@nestjs/common';
import { TenantContextService } from './tenant-context.service';

describe('TenantContextService', () => {
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
});
