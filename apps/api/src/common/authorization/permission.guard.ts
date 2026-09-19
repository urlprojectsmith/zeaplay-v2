import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { RequestWithAuth } from '../auth/auth.types';
import { REQUIRED_PERMISSIONS_KEY } from './require-permissions.decorator';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const tenant = request.tenant ?? request.agencyTenant;
    if (!tenant) throw new ForbiddenException('Tenant context is required.');
    if (required.every((permission) => tenant.permissions.includes(permission))) return true;
    throw new ForbiddenException('Insufficient permissions.');
  }
}
