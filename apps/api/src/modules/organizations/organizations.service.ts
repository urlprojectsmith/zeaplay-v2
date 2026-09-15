import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrganizationStatus, Prisma, UserStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import type { AuthenticatedUser, TenantContext } from '../../common/auth/auth.types';
import { PermissionKeys } from '../../common/authorization/permissions';
import { AuditService } from '../audit/audit.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  async create(user: AuthenticatedUser, dto: CreateOrganizationDto) {
    await this.assertActiveUser(user.id);
    const ownerRole = await this.prisma.role.findUniqueOrThrow({ where: { name: 'OWNER' } });
    const slug = normalizeSlug(dto.slug ?? dto.name);
    try {
      const organization = await this.prisma.organization.create({
        data: {
          name: dto.name.trim(),
          slug,
          memberships: {
            create: { userId: user.id, roleId: ownerRole.id },
          },
        },
        select: organizationSelect,
      });
      await this.audit.record({
        organizationId: organization.id,
        userId: user.id,
        action: 'organization.create',
        entityType: 'Organization',
        entityId: organization.id,
      });
      return organization;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Organization slug already exists.');
      }
      throw error;
    }
  }

  async list(userId: string) {
    await this.assertActiveUser(userId);
    const memberships = await this.prisma.membership.findMany({
      where: {
        userId,
        status: 'ACTIVE',
        organization: { status: OrganizationStatus.ACTIVE },
      },
      select: { organization: { select: organizationSelect }, role: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((membership) => ({
      ...membership.organization,
      role: membership.role.name,
    }));
  }

  async get(userId: string, organizationId: string) {
    await this.tenantContext.resolve(userId, organizationId);
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: organizationSelect,
    });
    if (!organization) throw new NotFoundException('Organization not found.');
    return organization;
  }

  async update(tenant: TenantContext, dto: UpdateOrganizationDto) {
    if (!can(tenant, PermissionKeys.organizationUpdate)) {
      throw new ForbiddenException('Insufficient permissions.');
    }
    const organization = await this.prisma.organization.update({
      where: { id: tenant.organizationId },
      data: { name: dto.name?.trim(), status: dto.status },
      select: organizationSelect,
    });
    await this.audit.record({
      organizationId: tenant.organizationId,
      userId: tenant.userId,
      action: 'organization.update',
      entityType: 'Organization',
      entityId: tenant.organizationId,
      metadata: { changed: Object.keys(dto) },
    });
    return organization;
  }

  private async assertActiveUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true },
    });
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('User is not active.');
    }
  }
}

const organizationSelect = {
  id: true,
  name: true,
  slug: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.OrganizationSelect;

function normalizeSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function can(tenant: TenantContext, permission: string) {
  return tenant.roleName === 'OWNER' || tenant.permissions.includes(permission);
}
