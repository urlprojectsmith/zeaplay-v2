import { Injectable } from '@nestjs/common';
import type { WorkspaceTenantContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../infrastructure/database/prisma.service';

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  list(_tenant: WorkspaceTenantContext) {
    return this.prisma.permission.findMany({
      where: { key: { not: '*' } },
      select: { id: true, key: true, description: true, createdAt: true },
      orderBy: { key: 'asc' },
    });
  }
}
