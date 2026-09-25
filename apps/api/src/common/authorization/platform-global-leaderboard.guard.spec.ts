import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { MembershipStatus, RoleScope } from '@prisma/client';
import { PlatformGlobalLeaderboardGuard } from './platform-global-leaderboard.guard';
import { PermissionKeys } from './permissions';

describe('PlatformGlobalLeaderboardGuard', () => {
  it('requires authentication', async () => {
    const guard = new PlatformGlobalLeaderboardGuard(prismaMock() as never);
    await expect(guard.canActivate(context(undefined))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('requires the platform leaderboard permission without using tenant headers', async () => {
    const prisma = prismaMock();
    prisma.agencyMembership.findFirst.mockResolvedValueOnce({ id: 'agency-membership-1' });
    prisma.workspaceMembership.findFirst.mockResolvedValueOnce(null);
    const guard = new PlatformGlobalLeaderboardGuard(prisma as never);

    await expect(guard.canActivate(context('platform-user'))).resolves.toBe(true);
    expect(prisma.agencyMembership.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: expect.objectContaining({
            rolePermissions: {
              some: {
                permission: { key: PermissionKeys.gamificationGlobalLeaderboardViewPlatform },
              },
            },
            scope: RoleScope.AGENCY,
          }),
          status: MembershipStatus.ACTIVE,
          userId: 'platform-user',
        }),
      }),
    );
  });

  it('does not grant access from role names alone', async () => {
    const prisma = prismaMock();
    prisma.agencyMembership.findFirst.mockResolvedValueOnce(null);
    prisma.workspaceMembership.findFirst.mockResolvedValueOnce(null);
    const guard = new PlatformGlobalLeaderboardGuard(prisma as never);

    await expect(guard.canActivate(context('owner-named-user'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

function prismaMock() {
  return {
    agencyMembership: { findFirst: jest.fn() },
    workspaceMembership: { findFirst: jest.fn() },
  };
}

function context(userId: string | undefined) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        user: userId ? { id: userId, email: `${userId}@zeaplay.test` } : undefined,
        headers: {
          'x-agency-id': undefined,
          'x-workspace-id': undefined,
          'x-super-agency-id': undefined,
        },
      }),
    }),
  } as ExecutionContext;
}
