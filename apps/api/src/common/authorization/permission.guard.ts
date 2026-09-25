import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SuperAgencySubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type { RequestWithAuth } from '../auth/auth.types';
import { REQUIRED_PERMISSIONS_KEY } from './require-permissions.decorator';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma?: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const request = context
      .switchToHttp()
      .getRequest<RequestWithAuth & { method?: string; url?: string; originalUrl?: string }>();
    const tenant = request.tenant ?? request.agencyTenant ?? request.superAgencyTenant;
    if (!tenant) throw new ForbiddenException('Tenant context is required.');
    if (!required.every((permission) => tenant.permissions.includes(permission))) {
      throw new ForbiddenException('Insufficient permissions.');
    }
    await this.assertBillingWriteAllowed(request, tenant.superAgencyId);
    return true;
  }

  private async assertBillingWriteAllowed(
    request: { method?: string; url?: string; originalUrl?: string },
    superAgencyId?: string,
  ) {
    if (!this.prisma || !superAgencyId) return;
    if (isSafeRestrictedRequest(request)) return;
    const subscription = await this.prisma.superAgencySubscription.findFirst({
      where: { superAgencyId, isCurrent: true },
      select: { status: true, graceEndsAt: true, trialEndsAt: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!subscription) return;
    if (
      isRestrictedSubscription(
        subscription.status,
        subscription.graceEndsAt,
        subscription.trialEndsAt,
      )
    ) {
      throw new ForbiddenException({
        code: 'ACCOUNT_RESTRICTED',
        message: 'Account is in read-only restricted mode.',
      });
    }
  }
}

function isSafeRestrictedRequest(request: { method?: string; url?: string; originalUrl?: string }) {
  const method = request.method?.toUpperCase() ?? 'GET';
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  const path = request.originalUrl ?? request.url ?? '';
  if (path.includes('/billing/')) return true;
  if (/\/download-url(?:\?|$)/.test(path)) return true;
  if (/\/exports?(?:\/|\?|$)/.test(path)) return true;
  return false;
}

function isRestrictedSubscription(
  status: SuperAgencySubscriptionStatus,
  graceEndsAt: Date | null,
  trialEndsAt: Date | null,
) {
  const now = Date.now();
  if (
    status === SuperAgencySubscriptionStatus.RESTRICTED ||
    status === SuperAgencySubscriptionStatus.SUSPENDED ||
    status === SuperAgencySubscriptionStatus.CANCELED ||
    status === SuperAgencySubscriptionStatus.EXPIRED
  ) {
    return true;
  }
  if (graceEndsAt && graceEndsAt.getTime() < now) return true;
  if (status === SuperAgencySubscriptionStatus.TRIALING && trialEndsAt) {
    const graceEnd = trialEndsAt.getTime() + 7 * 24 * 60 * 60 * 1000;
    return graceEnd < now;
  }
  return false;
}
