import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { MembershipStatus, RoleScope } from '@prisma/client';
import { PermissionKeys } from '../../common/authorization/permissions';
import { ReportsPlatformGuard } from './reports-platform.guard';

describe('ReportsPlatformGuard', () => {
  it('requires authentication', async () => {
    const guard = new ReportsPlatformGuard(prismaMock() as never);

    await expect(guard.canActivate(context(undefined))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('requires explicit platform reports permission without trusting tenant headers', async () => {
    const prisma = prismaMock();
    prisma.superAgencyMembership.findFirst.mockResolvedValueOnce({ id: 'super-membership-1' });
    prisma.agencyMembership.findFirst.mockResolvedValueOnce(null);
    prisma.workspaceMembership.findFirst.mockResolvedValueOnce(null);
    const guard = new ReportsPlatformGuard(prisma as never);

    await expect(guard.canActivate(context('platform-user'))).resolves.toBe(true);
    expect(prisma.superAgencyMembership.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: expect.objectContaining({
            rolePermissions: {
              some: { permission: { key: PermissionKeys.reportsPlatformRead } },
            },
            scope: RoleScope.SUPER_AGENCY,
          }),
          status: MembershipStatus.ACTIVE,
          userId: 'platform-user',
        }),
      }),
    );
  });

  it('does not grant access from route or tenant IDs alone', async () => {
    const prisma = prismaMock();
    prisma.superAgencyMembership.findFirst.mockResolvedValueOnce(null);
    prisma.agencyMembership.findFirst.mockResolvedValueOnce(null);
    prisma.workspaceMembership.findFirst.mockResolvedValueOnce(null);
    const guard = new ReportsPlatformGuard(prisma as never);

    await expect(guard.canActivate(context('tenant-user'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

function prismaMock() {
  return {
    superAgencyMembership: { findFirst: jest.fn() },
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
          'x-agency-id': 'tampered-agency',
          'x-workspace-id': 'tampered-workspace',
          'x-super-agency-id': 'tampered-super-agency',
        },
      }),
    }),
  } as ExecutionContext;
}
