import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { PublicApiPrincipal } from '../public-api.types';

export const REQUIRED_PUBLIC_API_SCOPES_KEY = 'requiredPublicApiScopes';

export function RequirePublicApiScopes(...scopes: string[]) {
  return SetMetadata(REQUIRED_PUBLIC_API_SCOPES_KEY, scopes);
}

export const CurrentPublicApi = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PublicApiPrincipal | undefined =>
    ctx.switchToHttp().getRequest().publicApi,
);
