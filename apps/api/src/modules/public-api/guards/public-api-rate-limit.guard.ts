import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { PublicApiRateLimitService } from '../public-api-rate-limit.service';
import type { PublicApiPrincipal } from '../public-api.types';

@Injectable()
export class PublicApiRateLimitGuard implements CanActivate {
  constructor(private readonly rateLimit: PublicApiRateLimitService) {}

  async canActivate(context: ExecutionContext) {
    const principal = context
      .switchToHttp()
      .getRequest<{ publicApi?: PublicApiPrincipal }>().publicApi;
    if (!principal) return true;
    await this.rateLimit.assertWithinLimit(principal);
    return true;
  }
}
