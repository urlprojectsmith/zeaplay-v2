import { ForbiddenException } from '@nestjs/common';
import { TenantContextService } from './tenant-context.service';

describe('TenantContextService', () => {
  it('rejects suspended memberships', async () => {
    const service = new TenantContextService({
      membership: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'membership-id',
          status: 'SUSPENDED',
          user: { status: 'ACTIVE' },
          organization: { status: 'ACTIVE' },
          role: { id: 'role-id', name: 'MEMBER', rolePermissions: [] },
        }),
      },
    } as never);

    await expect(
      service.resolve(
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
      ),
    ).rejects.toThrow(ForbiddenException);
  });
});
