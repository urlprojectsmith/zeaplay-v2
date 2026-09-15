import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { RequestWithAuth, TenantContext } from '../auth/auth.types';

export const ORGANIZATION_HEADER = 'x-organization-id';

export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TenantContext | undefined =>
    ctx.switchToHttp().getRequest<RequestWithAuth>().tenant,
);
