import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { MembershipStatus, RoleScope } from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type { RequestWithAuth } from '../auth/auth.types';
import { PermissionKeys } from './permissions';

@Injectable()
export class DeveloperDiagnosticsGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & RequestWithAuth>();
    if (!request.user) throw new UnauthorizedException('Authentication required.');

    const hasPermission = await this.userHasDeveloperDiagnosticsPermission(request.user.id);
    if (!hasPermission) throw new ForbiddenException('Developer diagnostics access denied.');
    return true;
  }

  private async userHasDeveloperDiagnosticsPermission(userId: string) {
    const permission = PermissionKeys.gamificationDeveloperDiagnostics;
    const [agencyMembership, workspaceMembership] = await Promise.all([
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
    return Boolean(agencyMembership || workspaceMembership);
  }
}
