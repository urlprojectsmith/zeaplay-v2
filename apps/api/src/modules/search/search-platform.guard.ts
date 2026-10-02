import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { MembershipStatus, RoleScope } from '@prisma/client';
import type { Request } from 'express';
import type { RequestWithAuth } from '../../common/auth/auth.types';
import { PermissionKeys } from '../../common/authorization/permissions';
import { PrismaService } from '../../infrastructure/database/prisma.service';

@Injectable()
export class SearchPlatformGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & RequestWithAuth>();
    if (!request.user) throw new UnauthorizedException('Authentication required.');
    const allowed = await this.userHasPlatformSearch(request.user.id);
    if (!allowed) throw new ForbiddenException('Platform search access denied.');
    return true;
  }

  private async userHasPlatformSearch(userId: string) {
    const permission = PermissionKeys.searchPlatformRead;
    const [superAgencyMembership, agencyMembership, workspaceMembership] = await Promise.all([
      this.prisma.superAgencyMembership.findFirst({
        where: {
          userId,
          status: MembershipStatus.ACTIVE,
          role: {
            scope: RoleScope.SUPER_AGENCY,
            rolePermissions: { some: { permission: { key: permission } } },
          },
        },
        select: { id: true },
      }),
      this.prisma.agencyMembership.findFirst({
        where: {
          userId,
          status: MembershipStatus.ACTIVE,
          role: {
            scope: RoleScope.AGENCY,
            rolePermissions: { some: { permission: { key: permission } } },
          },
        },
        select: { id: true },
      }),
      this.prisma.workspaceMembership.findFirst({
        where: {
          userId,
          status: MembershipStatus.ACTIVE,
          role: {
            scope: RoleScope.WORKSPACE,
            rolePermissions: { some: { permission: { key: permission } } },
          },
        },
        select: { id: true },
      }),
    ]);
    return Boolean(superAgencyMembership || agencyMembership || workspaceMembership);
  }
}
