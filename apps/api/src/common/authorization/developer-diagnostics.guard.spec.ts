import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { MembershipStatus, RoleScope } from '@prisma/client';
import { DeveloperDiagnosticsGuard } from './developer-diagnostics.guard';
import { PermissionKeys } from './permissions';

describe('DeveloperDiagnosticsGuard', () => {
  it('requires authentication', async () => {
    const guard = new DeveloperDiagnosticsGuard(prismaMock() as never);
    await expect(guard.canActivate(context(undefined))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('denies ordinary users without the developer diagnostics permission', async () => {
    const prisma = prismaMock();
    prisma.agencyMembership.findFirst.mockResolvedValueOnce(null);
    prisma.workspaceMembership.findFirst.mockResolvedValueOnce(null);
    const guard = new DeveloperDiagnosticsGuard(prisma as never);

    await expect(guard.canActivate(context('user-1'))).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.agencyMembership.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: expect.objectContaining({
            rolePermissions: {
              some: { permission: { key: PermissionKeys.gamificationDeveloperDiagnostics } },
            },
            scope: RoleScope.AGENCY,
          }),
          status: MembershipStatus.ACTIVE,
        }),
      }),
    );
  });

  it('allows users explicitly granted the developer diagnostics permission', async () => {
    const prisma = prismaMock();
    prisma.agencyMembership.findFirst.mockResolvedValueOnce({ id: 'agency-membership-1' });
    prisma.workspaceMembership.findFirst.mockResolvedValueOnce(null);
    const guard = new DeveloperDiagnosticsGuard(prisma as never);

    await expect(guard.canActivate(context('developer-user'))).resolves.toBe(true);
  });

  it('does not grant access from role names alone', async () => {
    const prisma = prismaMock();
    prisma.agencyMembership.findFirst.mockResolvedValueOnce(null);
    prisma.workspaceMembership.findFirst.mockResolvedValueOnce(null);
    const guard = new DeveloperDiagnosticsGuard(prisma as never);

    await expect(guard.canActivate(context('developer-named-user'))).rejects.toBeInstanceOf(
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
      }),
    }),
  } as ExecutionContext;
}
