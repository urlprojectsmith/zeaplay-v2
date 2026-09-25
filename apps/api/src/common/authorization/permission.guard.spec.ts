import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from './permission.guard';
import { REQUIRED_PERMISSIONS_KEY } from './require-permissions.decorator';

describe('PermissionGuard', () => {
  it('requires explicit permissions instead of owner role-name bypasses', async () => {
    const guard = new PermissionGuard(reflector(['project.delete']));
    await expect(
      guard.canActivate(context({ roleName: 'OWNER', permissions: [] })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      guard.canActivate(context({ roleName: 'OWNER', permissions: ['project.delete'] })),
    ).resolves.toBe(true);
  });

  it('rejects users missing required permissions', async () => {
    const guard = new PermissionGuard(reflector(['member.create']));
    await expect(
      guard.canActivate(context({ roleName: 'MEMBER', permissions: ['project.read'] })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks tenant business writes when billing access is restricted', async () => {
    const prisma = {
      superAgencySubscription: {
        findFirst: jest.fn().mockResolvedValue({ status: 'RESTRICTED', graceEndsAt: null }),
      },
    };
    const guard = new PermissionGuard(reflector(['project.delete']), prisma as never);

    await expect(
      guard.canActivate(
        context(
          { roleName: 'ADMIN', permissions: ['project.delete'], superAgencyId: 'super-agency-1' },
          { method: 'DELETE', url: '/api/v1/projects/project-1' },
        ),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

function reflector(required: string[]) {
  return {
    getAllAndOverride: jest.fn((key) => (key === REQUIRED_PERMISSIONS_KEY ? required : undefined)),
  } as unknown as Reflector;
}

function context(
  tenant: { roleName: string; permissions: string[]; superAgencyId?: string },
  request: { method?: string; url?: string } = {},
) {
  return {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({ getRequest: () => ({ tenant, ...request }) }),
  } as unknown as ExecutionContext;
}
