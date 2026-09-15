import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MembershipStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type { TenantContext } from '../../common/auth/auth.types';
import { OWNER_ROLE, PermissionKeys } from '../../common/authorization/permissions';
import { AuditService } from '../audit/audit.service';
import { CreateMembershipDto } from './dto/create-membership.dto';
import { UpdateMembershipDto } from './dto/update-membership.dto';

@Injectable()
export class MembershipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenant: TenantContext) {
    assertPermission(tenant, PermissionKeys.memberRead);
    return this.prisma.membership.findMany({
      where: { organizationId: tenant.organizationId },
      select: membershipSelect,
      orderBy: { createdAt: 'asc' },
    });
  }

  async addExistingUser(tenant: TenantContext, dto: CreateMembershipDto) {
    assertPermission(tenant, PermissionKeys.memberCreate);
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.trim().toLowerCase() },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found.');
    const role = await this.prisma.role.findUniqueOrThrow({ where: { name: dto.role } });

    try {
      const membership = await this.prisma.membership.create({
        data: {
          userId: user.id,
          organizationId: tenant.organizationId,
          roleId: role.id,
          status: MembershipStatus.ACTIVE,
        },
        select: membershipSelect,
      });
      await this.audit.record({
        organizationId: tenant.organizationId,
        userId: tenant.userId,
        action: 'membership.create',
        entityType: 'Membership',
        entityId: membership.id,
        metadata: { targetUserId: user.id, role: dto.role },
      });
      return membership;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('User is already a member of this organization.');
      }
      throw error;
    }
  }

  async update(tenant: TenantContext, membershipId: string, dto: UpdateMembershipDto) {
    assertPermission(tenant, PermissionKeys.memberUpdate);
    if (dto.role === OWNER && tenant.roleName !== OWNER) {
      throw new ForbiddenException('Only owners can assign the owner role.');
    }
    const existing = await this.findTenantMembership(tenant.organizationId, membershipId);
    const role = dto.role
      ? await this.prisma.role.findUniqueOrThrow({ where: { name: dto.role } })
      : null;
    const membership = await this.prisma.membership.update({
      where: { id: existing.id },
      data: {
        roleId: role?.id,
        status: dto.status,
      },
      select: membershipSelect,
    });
    await this.audit.record({
      organizationId: tenant.organizationId,
      userId: tenant.userId,
      action: dto.role ? 'membership.role_update' : 'membership.update',
      entityType: 'Membership',
      entityId: membership.id,
      metadata: { changed: Object.keys(dto) },
    });
    return membership;
  }

  async suspend(tenant: TenantContext, membershipId: string) {
    assertPermission(tenant, PermissionKeys.memberDelete);
    const existing = await this.findTenantMembership(tenant.organizationId, membershipId);
    if (existing.userId === tenant.userId) {
      throw new ForbiddenException('Users cannot suspend their own membership.');
    }
    const membership = await this.prisma.membership.update({
      where: { id: existing.id },
      data: { status: MembershipStatus.SUSPENDED },
      select: membershipSelect,
    });
    await this.audit.record({
      organizationId: tenant.organizationId,
      userId: tenant.userId,
      action: 'membership.suspend',
      entityType: 'Membership',
      entityId: membership.id,
      metadata: { targetUserId: existing.userId },
    });
    return membership;
  }

  private async findTenantMembership(organizationId: string, membershipId: string) {
    const membership = await this.prisma.membership.findFirst({
      where: { id: membershipId, organizationId },
      select: { id: true, userId: true },
    });
    if (!membership) throw new NotFoundException('Membership not found.');
    return membership;
  }
}

const membershipSelect = {
  id: true,
  userId: true,
  organizationId: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { id: true, email: true, name: true, status: true } },
  role: { select: { id: true, name: true } },
} satisfies Prisma.MembershipSelect;

const OWNER = OWNER_ROLE;

function assertPermission(tenant: TenantContext, permission: string) {
  if (tenant.roleName === OWNER_ROLE || tenant.permissions.includes(permission)) return;
  throw new ForbiddenException('Insufficient permissions.');
}
