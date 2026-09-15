import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { RequestWithAuth } from '../auth/auth.types';
import { AGENCY_HEADER, WORKSPACE_HEADER } from './tenant-context.decorator';
import { TenantContextService } from './tenant-context.service';

@Injectable()
export class TenantContextGuard implements CanActivate {
  constructor(private readonly tenantContext: TenantContextService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & RequestWithAuth>();
    if (!request.user) throw new UnauthorizedException('Authentication required.');
    const agencyId = request.header(AGENCY_HEADER);
    const workspaceId = request.header(WORKSPACE_HEADER);
    if (!agencyId || !workspaceId) throw new UnauthorizedException('Workspace context required.');
    request.workspaceTenant = await this.tenantContext.resolveWorkspace(
      request.user.id,
      agencyId,
      workspaceId,
    );
    request.tenant = request.workspaceTenant;
    if (request.params?.agencyId && request.params.agencyId !== request.tenant.agencyId)
      throw new ForbiddenException('Tenant context does not match the requested resource.');
    if (request.params?.workspaceId && request.params.workspaceId !== request.tenant.workspaceId)
      throw new ForbiddenException('Tenant context does not match the requested resource.');
    return true;
  }
}

@Injectable()
export class AgencyTenantGuard implements CanActivate {
  constructor(private readonly tenantContext: TenantContextService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & RequestWithAuth>();
    if (!request.user) throw new UnauthorizedException('Authentication required.');
    const agencyId = firstValue(request.params?.agencyId) ?? request.header(AGENCY_HEADER);
    if (!agencyId) throw new UnauthorizedException('Agency context required.');
    request.agencyTenant = await this.tenantContext.resolveAgency(request.user.id, agencyId);
    if (request.params?.agencyId && request.params.agencyId !== request.agencyTenant.agencyId) {
      throw new ForbiddenException('Tenant context does not match the requested resource.');
    }
    return true;
  }
}

export const WorkspaceTenantGuard = TenantContextGuard;

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
