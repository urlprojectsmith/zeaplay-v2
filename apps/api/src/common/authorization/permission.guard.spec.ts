import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from './permission.guard';
import { REQUIRED_PERMISSIONS_KEY } from './require-permissions.decorator';

describe('PermissionGuard', () => {
  it('allows owners without checking individual permissions', () => {
    const guard = new PermissionGuard(reflector(['project.delete']));
    expect(guard.canActivate(context({ roleName: 'OWNER', permissions: [] }))).toBe(true);
  });

  it('rejects users missing required permissions', () => {
    const guard = new PermissionGuard(reflector(['member.create']));
    expect(() =>
      guard.canActivate(context({ roleName: 'MEMBER', permissions: ['project.read'] })),
    ).toThrow(ForbiddenException);
  });
});

function reflector(required: string[]) {
  return {
    getAllAndOverride: jest.fn((key) => (key === REQUIRED_PERMISSIONS_KEY ? required : undefined)),
  } as unknown as Reflector;
}

function context(tenant: { roleName: string; permissions: string[] }) {
  return {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({ getRequest: () => ({ tenant }) }),
  } as unknown as ExecutionContext;
}
