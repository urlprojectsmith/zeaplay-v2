import { NotFoundException } from '@nestjs/common';
import { ProjectsService } from './projects.service';

const tenant = {
  userId: '00000000-0000-4000-8000-000000000001',
  agencyId: '00000000-0000-4000-8000-000000000002',
  workspaceId: '00000000-0000-4000-8000-000000000003',
  workspaceMembershipId: '00000000-0000-4000-8000-000000000006',
  agencyMembershipId: null,
  roleId: '00000000-0000-4000-8000-000000000004',
  roleName: 'OWNER',
  permissions: ['*'],
  accessSource: 'WORKSPACE_MEMBERSHIP' as const,
};

describe('ProjectsService', () => {
  it('uses workspaceId with resource ID lookups', async () => {
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
          workspaceId: tenant.workspaceId,
        },
      }),
    );
  });
});
