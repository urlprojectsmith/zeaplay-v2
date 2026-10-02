import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { RequestWithAuth } from '../../common/auth/auth.types';
import { PermissionKeys } from '../../common/authorization/permissions';
import { PrismaService } from '../../infrastructure/database/prisma.service';

@Injectable()
export class BrandingPlatformGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const userId = request.user?.id;
    if (!userId) throw new ForbiddenException('BRANDING_PLATFORM_AUTH_REQUIRED');
    const authorized = await this.prisma.rolePermission.findFirst({
      where: {
        permission: { key: PermissionKeys.brandingPlatformManage },
        role: {
          OR: [
            { memberships: { some: { userId } } },
            { superAgencyMemberships: { some: { userId } } },
            { agencyMemberships: { some: { userId } } },
            { workspaceMemberships: { some: { userId } } },
          ],
        },
      },
      select: { roleId: true },
    });
    if (!authorized) throw new ForbiddenException('BRANDING_PLATFORM_DENIED');
    return true;
  }
}
