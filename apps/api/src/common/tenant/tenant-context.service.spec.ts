import { ForbiddenException } from '@nestjs/common';
import { TenantContextService } from './tenant-context.service';

describe('TenantContextService', () => {
  it('rejects suspended memberships', async () => {
    const service = new TenantContextService({
      workspace: {
        findFirst: jest.fn().mockResolvedValue({
          status: 'ACTIVE',
          agency: { status: 'ACTIVE' },
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
