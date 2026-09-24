import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRED_PUBLIC_API_SCOPES_KEY } from '../decorators/public-api.decorator';
import type { PublicApiPrincipal } from '../public-api.types';

@Injectable()
export class PublicApiScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const required = this.reflector.getAllAndOverride<string[]>(REQUIRED_PUBLIC_API_SCOPES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;
    const principal = context
      .switchToHttp()
      .getRequest<{ publicApi?: PublicApiPrincipal }>().publicApi;
    if (!principal) throw new ForbiddenException('PUBLIC_API_SCOPE_REQUIRED');
    const scopes = new Set<string>(principal.scopes);
    const allowed = required.some((scope) => scopes.has(scope));
    if (!allowed) throw new ForbiddenException('PUBLIC_API_SCOPE_REQUIRED');
    return true;
  }
}
