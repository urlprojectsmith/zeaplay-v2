import { NotFoundException } from '@nestjs/common';
import { ProjectsService } from './projects.service';

const tenant = {
  userId: '00000000-0000-4000-8000-000000000001',
  organizationId: '00000000-0000-4000-8000-000000000002',
  membershipId: '00000000-0000-4000-8000-000000000003',
  roleId: '00000000-0000-4000-8000-000000000004',
  roleName: 'OWNER',
  permissions: ['*'],
};

describe('ProjectsService', () => {
  it('uses organizationId with resource ID lookups', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const service = new ProjectsService(
      { project: { findFirst } } as never,
      { record: jest.fn() } as never,
    );

    await expect(service.get(tenant, '00000000-0000-4000-8000-000000000005')).rejects.toThrow(
      NotFoundException,
    );
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: '00000000-0000-4000-8000-000000000005',
          organizationId: tenant.organizationId,
        },
      }),
    );
  });
});
