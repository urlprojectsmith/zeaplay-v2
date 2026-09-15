import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type {
  AgencyTenantContext,
  RequestWithAuth,
  WorkspaceTenantContext,
} from '../auth/auth.types';

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

export const CurrentTenant = CurrentWorkspaceTenant;
