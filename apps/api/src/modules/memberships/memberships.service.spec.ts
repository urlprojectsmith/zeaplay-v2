import { ForbiddenException } from '@nestjs/common';
import { MembershipsService } from './memberships.service';

describe('MembershipsService', () => {
  it('blocks admin promotion to owner', async () => {
    const service = new MembershipsService({} as never, { record: jest.fn() } as never);
    await expect(
      service.update(
        {
          userId: 'user-id',
          organizationId: 'organization-id',
          membershipId: 'membership-id',
          roleId: 'role-id',
          roleName: 'ADMIN',
          permissions: ['member.update'],
        },
        'target-membership',
        { role: 'OWNER' },
      ),
    ).rejects.toThrow(ForbiddenException);
  });
});
