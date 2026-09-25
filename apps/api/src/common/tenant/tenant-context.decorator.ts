import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type {
  AgencyTenantContext,
  RequestWithAuth,
  SuperAgencyTenantContext,
  WorkspaceTenantContext,
} from '../auth/auth.types';

export const SUPER_AGENCY_HEADER = 'x-super-agency-id';
export const AGENCY_HEADER = 'x-agency-id';
export const WORKSPACE_HEADER = 'x-workspace-id';

export const CurrentWorkspaceTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): WorkspaceTenantContext | undefined =>
    ctx.switchToHttp().getRequest<RequestWithAuth>().tenant,
);

export const CurrentAgencyTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AgencyTenantContext | undefined =>
    ctx.switchToHttp().getRequest<RequestWithAuth>().agencyTenant,
);

export const CurrentSuperAgencyTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SuperAgencyTenantContext | undefined =>
    ctx.switchToHttp().getRequest<RequestWithAuth>().superAgencyTenant,
);

export const CurrentTenant = CurrentWorkspaceTenant;
