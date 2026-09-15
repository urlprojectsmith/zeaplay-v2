import { ForbiddenException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { MembershipStatus, OrganizationStatus, UserStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type { TenantContext } from '../auth/auth.types';
import { OWNER_ROLE } from '../authorization/permissions';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class TenantContextService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(userId: string, organizationId: string): Promise<TenantContext> {
    if (!uuidPattern.test(organizationId)) {
      throw new UnprocessableEntityException('Invalid organization id.');
    }

    const membership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: {
        id: true,
        status: true,
        user: { select: { status: true } },
        organization: { select: { status: true } },
        role: {
          select: {
            id: true,
            name: true,
            rolePermissions: { select: { permission: { select: { key: true } } } },
          },
        },
      },
    });

    if (!membership) throw new ForbiddenException('Organization access denied.');
    if (membership.user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('User is not active.');
    }
    if (membership.organization.status !== OrganizationStatus.ACTIVE) {
      throw new ForbiddenException('Organization is not active.');
    }
    if (membership.status !== MembershipStatus.ACTIVE) {
      throw new ForbiddenException('Membership is not active.');
    }

    return {
      userId,
      organizationId,
      membershipId: membership.id,
      roleId: membership.role.id,
      roleName: membership.role.name,
      permissions:
        membership.role.name === OWNER_ROLE
          ? ['*']
          : membership.role.rolePermissions.map((item) => item.permission.key),
    };
  }
}
