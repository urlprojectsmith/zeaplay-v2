import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SuperAgencySubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { BillingEntitlementService } from '../../billing/billing-entitlement.service';
import { REQUIRED_PUBLIC_API_SCOPES_KEY } from '../decorators/public-api.decorator';
import type { PublicApiPrincipal } from '../public-api.types';

@Injectable()
export class PublicApiScopeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma?: PrismaService,
    private readonly billingEntitlements?: BillingEntitlementService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const required = this.reflector.getAllAndOverride<string[]>(REQUIRED_PUBLIC_API_SCOPES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;
    const request = context
      .switchToHttp()
      .getRequest<{ publicApi?: PublicApiPrincipal; method?: string }>();
    const principal = request.publicApi;
    if (!principal) throw new ForbiddenException('PUBLIC_API_SCOPE_REQUIRED');
    const scopes = new Set<string>(principal.scopes);
    const allowed = required.some((scope) => scopes.has(scope));
    if (!allowed) throw new ForbiddenException('PUBLIC_API_SCOPE_REQUIRED');
    await this.assertRestrictedMode(request.method, principal);
    await this.billingEntitlements?.reservePublicApiRequestUsage(principal.workspaceId);
    return true;
  }

  private async assertRestrictedMode(method: string | undefined, principal: PublicApiPrincipal) {
    if (!this.prisma) return;
    const verb = method?.toUpperCase() ?? 'GET';
    if (verb === 'GET' || verb === 'HEAD' || verb === 'OPTIONS') return;
    const superAgencyId = principal.tenant.superAgencyId;
    if (!superAgencyId) return;
    const subscription = await this.prisma.superAgencySubscription.findFirst({
      where: { superAgencyId, isCurrent: true },
      select: { status: true, graceEndsAt: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!subscription) return;
    const restricted =
      subscription.status === SuperAgencySubscriptionStatus.RESTRICTED ||
      subscription.status === SuperAgencySubscriptionStatus.SUSPENDED ||
      subscription.status === SuperAgencySubscriptionStatus.CANCELED ||
      subscription.status === SuperAgencySubscriptionStatus.EXPIRED ||
      (subscription.graceEndsAt?.getTime() ?? Number.POSITIVE_INFINITY) < Date.now();
    if (restricted) throw new ForbiddenException('ACCOUNT_RESTRICTED');
  }
}
