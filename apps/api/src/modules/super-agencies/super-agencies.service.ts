import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MembershipStatus,
  Prisma,
  RoleScope,
  SuperAgencyInvitationStatus,
  SuperAgencyStatus,
} from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { AuthenticatedUser, SuperAgencyTenantContext } from '../../common/auth/auth.types';
import {
  PermissionKeys,
  PLATFORM_ONLY_PERMISSION_KEYS,
} from '../../common/authorization/permissions';
import { MailService } from '../../infrastructure/mail/mail.service';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateSuperAgencyDto,
  SuperAgencyListQueryDto,
  UpdateSuperAgencyDto,
} from './dto/super-agency.dto';
import {
  AcceptSuperAgencyInvitationDto,
  CreateSuperAgencyInvitationDto,
  CreateSuperAgencyMembershipDto,
  CreateSuperAgencyRoleDto,
  ReplaceSuperAgencyRolePermissionsDto,
  SuperAgencyInvitationListQueryDto,
  SuperAgencyMemberListQueryDto,
  UpdateSuperAgencyMembershipDto,
} from './dto/super-agency-membership.dto';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class SuperAgenciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  async create(user: AuthenticatedUser, dto: CreateSuperAgencyDto) {
    const superAgency = await this.prisma.superAgency
      .create({
        data: {
          name: dto.name.trim(),
          slug: dto.slug.trim().toLowerCase(),
          createdById: user.id,
        },
        select: superAgencySelect,
      })
      .catch((error: unknown) => {
        if (isUniqueConflict(error))
          throw new ConflictException('Super Agency slug already exists.');
        throw error;
      });
    await this.audit.record({
      superAgencyId: superAgency.id,
      userId: user.id,
      action: 'super_agency.create',
      entityType: 'SuperAgency',
      entityId: superAgency.id,
    });
    return superAgency;
  }

  async list(query: SuperAgencyListQueryDto) {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 25, 100);
    const where: Prisma.SuperAgencyWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search.trim(), mode: 'insensitive' } },
              { slug: { contains: query.search.trim().toLowerCase(), mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.superAgency.findMany({
        where,
        select: superAgencySelect,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.superAgency.count({ where }),
    ]);
    return {
      items,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async get(superAgencyId: string) {
    const superAgency = await this.prisma.superAgency.findUnique({
      where: { id: superAgencyId },
      select: superAgencySelect,
    });
    if (!superAgency) throw new NotFoundException('Super Agency not found.');
    return superAgency;
  }

  async update(user: AuthenticatedUser, superAgencyId: string, dto: UpdateSuperAgencyDto) {
    const superAgency = await this.prisma.superAgency.update({
      where: { id: superAgencyId },
      data: { name: dto.name?.trim(), status: dto.status },
      select: superAgencySelect,
    });
    await this.audit.record({
      superAgencyId,
      userId: user.id,
      action: 'super_agency.update',
      entityType: 'SuperAgency',
      entityId: superAgencyId,
      metadata: { changed: Object.keys(dto) },
    });
    return superAgency;
  }

  async getCurrentTenant(tenant: SuperAgencyTenantContext) {
    this.assertPermission(tenant, PermissionKeys.superAgencyView);
    const [superAgency, workspaceCount, pendingInvitationCount] = await Promise.all([
      this.prisma.superAgency.findUniqueOrThrow({
        where: { id: tenant.superAgencyId },
        select: {
          ...superAgencySelect,
          _count: {
            select: {
              agencies: true,
              memberships: { where: { status: MembershipStatus.ACTIVE } },
            },
          },
          agencies: {
            select: { id: true, name: true, slug: true, status: true },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            take: 25,
          },
        },
      }),
      this.prisma.workspace.count({
        where: { agency: { superAgencyId: tenant.superAgencyId } },
      }),
      tenant.permissions.includes(PermissionKeys.superAgencyMembersInvite) ||
      tenant.permissions.includes('*')
        ? this.prisma.superAgencyInvitation.count({
            where: {
              superAgencyId: tenant.superAgencyId,
              status: SuperAgencyInvitationStatus.PENDING,
            },
          })
        : Promise.resolve(null),
    ]);

    return {
      id: superAgency.id,
      name: superAgency.name,
      slug: superAgency.slug,
      status: superAgency.status,
      createdAt: superAgency.createdAt,
      updatedAt: superAgency.updatedAt,
      roleId: tenant.roleId,
      roleName: tenant.roleName,
      membershipId: tenant.superAgencyMembershipId,
      permissions: tenant.permissions,
      counts: {
        agencies: superAgency._count.agencies,
        workspaces: workspaceCount,
        activeMembers: superAgency._count.memberships,
        pendingInvitations: pendingInvitationCount,
      },
      agencies: superAgency.agencies,
    };
  }

  async listMemberships(tenant: SuperAgencyTenantContext, query: SuperAgencyMemberListQueryDto) {
    this.assertPermission(tenant, PermissionKeys.superAgencyMembersView);
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 25, 100);
    const where: Prisma.SuperAgencyMembershipWhereInput = {
      superAgencyId: tenant.superAgencyId,
      ...(query.search
        ? {
            user: {
              OR: [
                { email: { contains: query.search.trim().toLowerCase(), mode: 'insensitive' } },
                { name: { contains: query.search.trim(), mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.superAgencyMembership.findMany({
        where,
        select: superAgencyMembershipSelect,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.superAgencyMembership.count({ where }),
    ]);
    return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
  }

  async addMembership(tenant: SuperAgencyTenantContext, dto: CreateSuperAgencyMembershipDto) {
    this.assertPermission(tenant, PermissionKeys.superAgencyMembersManage);
    const [user, role] = await Promise.all([
      this.prisma.user.findUnique({
        where: { email: dto.email.trim().toLowerCase() },
        select: { id: true },
      }),
      this.superAgencyRoleForAssignment(tenant, dto.role, dto.roleId),
    ]);
    if (!user) throw new NotFoundException('User not found.');
    const existing = await this.prisma.superAgencyMembership.findUnique({
      where: { userId_superAgencyId: { userId: user.id, superAgencyId: tenant.superAgencyId } },
      select: { id: true, status: true },
    });
    if (existing?.status === MembershipStatus.ACTIVE) {
      throw new ConflictException('User already has an active Super Agency membership.');
    }
    const membership = existing
      ? await this.prisma.superAgencyMembership.update({
          where: { id: existing.id },
          data: { roleId: role.id, status: MembershipStatus.ACTIVE },
          select: superAgencyMembershipSelect,
        })
      : await this.prisma.superAgencyMembership.create({
          data: { userId: user.id, superAgencyId: tenant.superAgencyId, roleId: role.id },
          select: superAgencyMembershipSelect,
        });
    await this.audit.record({
      superAgencyId: tenant.superAgencyId,
      userId: tenant.userId,
      action: 'super_agency.membership.upsert',
      entityType: 'SuperAgencyMembership',
      entityId: membership.id,
      metadata: { targetUserId: user.id, roleId: role.id },
    });
    return membership;
  }

  async updateMembership(
    tenant: SuperAgencyTenantContext,
    membershipId: string,
    dto: UpdateSuperAgencyMembershipDto,
  ) {
    this.assertPermission(tenant, PermissionKeys.superAgencyMembersManage);
    const existing = await this.prisma.superAgencyMembership.findFirst({
      where: { id: membershipId, superAgencyId: tenant.superAgencyId },
      select: {
        id: true,
        userId: true,
        role: { select: { key: true } },
        status: true,
      },
    });
    if (!existing) throw new NotFoundException('Membership not found.');
    if (existing.id === tenant.superAgencyMembershipId && (dto.role || dto.roleId)) {
      throw new ForbiddenException('You cannot change your own Super Agency role.');
    }
    const demotesOwner =
      existing.role.key === 'SUPER_AGENCY_OWNER' &&
      (dto.role || dto.roleId || (dto.status && dto.status !== MembershipStatus.ACTIVE));
    if (demotesOwner) await this.assertAnotherActiveOwner(tenant.superAgencyId, membershipId);
    const role =
      dto.role || dto.roleId
        ? await this.superAgencyRoleForAssignment(tenant, dto.role, dto.roleId)
        : null;
    const membership = await this.prisma.superAgencyMembership.update({
      where: { id: membershipId },
      data: { roleId: role?.id, status: dto.status },
      select: superAgencyMembershipSelect,
    });
    await this.audit.record({
      superAgencyId: tenant.superAgencyId,
      userId: tenant.userId,
      action: role ? 'super_agency.membership.role_changed' : 'super_agency.membership.update',
      entityType: 'SuperAgencyMembership',
      entityId: membershipId,
      metadata: { targetUserId: existing.userId, changed: Object.keys(dto) },
    });
    return membership;
  }

  async listRoles(tenant: SuperAgencyTenantContext) {
    this.assertPermission(tenant, PermissionKeys.superAgencyRolesView);
    const roles = await this.prisma.role.findMany({
      where: {
        scope: RoleScope.SUPER_AGENCY,
        isActive: true,
        OR: [{ isSystem: true }, { key: { startsWith: customSuperAgencyRolePrefix(tenant) } }],
      },
      select: roleSelect,
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
    return roles.map(serializeRole);
  }

  async createRole(tenant: SuperAgencyTenantContext, dto: CreateSuperAgencyRoleDto) {
    this.assertPermission(tenant, PermissionKeys.superAgencyRolesManage);
    const permissionIds = await this.validatedSuperAgencyPermissionIds(
      dto.permissionIds ?? [],
      tenant,
    );
    const role = await this.prisma.$transaction(async (tx) => {
      const created = await tx.role.create({
        data: {
          key: `super-agency:${tenant.superAgencyId}:${randomUUID()}`,
          name: dto.name.trim(),
          nameNormalized: normalizeRoleName(dto.name),
          description: dto.description?.trim() ?? null,
          scope: RoleScope.SUPER_AGENCY,
          isSystem: false,
          isActive: true,
        },
        select: { id: true },
      });
      if (permissionIds.length) {
        await tx.rolePermission.createMany({
          data: permissionIds.map((permissionId) => ({ roleId: created.id, permissionId })),
        });
      }
      return tx.role.findUniqueOrThrow({ where: { id: created.id }, select: roleSelect });
    });
    await this.audit.record({
      superAgencyId: tenant.superAgencyId,
      userId: tenant.userId,
      action: 'super_agency.role.created',
      entityType: 'Role',
      entityId: role.id,
      metadata: { permissionIds },
    });
    return serializeRole(role);
  }

  async replaceRolePermissions(
    tenant: SuperAgencyTenantContext,
    roleId: string,
    dto: ReplaceSuperAgencyRolePermissionsDto,
  ) {
    this.assertPermission(tenant, PermissionKeys.superAgencyRolesManage);
    const role = await this.prisma.role.findFirst({
      where: {
        id: roleId,
        scope: RoleScope.SUPER_AGENCY,
        isSystem: false,
        key: { startsWith: customSuperAgencyRolePrefix(tenant) },
      },
      select: { id: true },
    });
    if (!role) throw new NotFoundException('Role not found.');
    const permissionIds = await this.validatedSuperAgencyPermissionIds(dto.permissionIds, tenant);
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId } });
      if (permissionIds.length) {
        await tx.rolePermission.createMany({
          data: permissionIds.map((permissionId) => ({ roleId, permissionId })),
        });
      }
      return tx.role.findUniqueOrThrow({ where: { id: roleId }, select: roleSelect });
    });
    await this.audit.record({
      superAgencyId: tenant.superAgencyId,
      userId: tenant.userId,
      action: 'super_agency.role.permissions_changed',
      entityType: 'Role',
      entityId: roleId,
      metadata: { permissionIds },
    });
    return serializeRole(updated);
  }

  async createInvitation(tenant: SuperAgencyTenantContext, dto: CreateSuperAgencyInvitationDto) {
    this.assertPermission(tenant, PermissionKeys.superAgencyMembersInvite);
    const role = await this.superAgencyRoleForAssignment(tenant, dto.role, dto.roleId);
    const email = dto.email.trim().toLowerCase();
    await this.assertNoActiveMembershipForEmail(tenant.superAgencyId, email);
    const existingInvite = await this.prisma.superAgencyInvitation.findFirst({
      where: {
        superAgencyId: tenant.superAgencyId,
        emailNormalized: email,
        status: SuperAgencyInvitationStatus.PENDING,
      },
      select: { id: true },
    });
    if (existingInvite) throw new ConflictException('A pending invitation already exists.');
    const token = randomBytes(32).toString('base64url');
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
    await this.mail.send({
      to: email,
      subject: 'ZeaPlay Super Agency invitation',
      text: [
        'You have been invited to a ZeaPlay Super Agency.',
        `Invitation token: ${token}`,
        `This invitation expires at ${expiresAt.toISOString()}.`,
        'Use this token from your ZeaPlay sign-in flow.',
      ].join('\n'),
      html: [
        '<p>You have been invited to a ZeaPlay Super Agency.</p>',
        `<p>Invitation token: <strong>${token}</strong></p>`,
        `<p>This invitation expires at ${expiresAt.toISOString()}.</p>`,
        '<p>Use this token from your ZeaPlay sign-in flow.</p>',
      ].join(''),
    });
    const invitation = await this.prisma.superAgencyInvitation.create({
      data: {
        superAgencyId: tenant.superAgencyId,
        email,
        emailNormalized: email,
        roleId: role.id,
        invitedByMembershipId: tenant.superAgencyMembershipId,
        tokenHash,
        expiresAt,
      },
      select: superAgencyInvitationSelect,
    });
    await this.audit.record({
      superAgencyId: tenant.superAgencyId,
      userId: tenant.userId,
      action: 'super_agency.invitation.created',
      entityType: 'SuperAgencyInvitation',
      entityId: invitation.id,
      metadata: {
        emailDomain: emailDomain(email),
        roleId: role.id,
        expiresAt: expiresAt.toISOString(),
      },
    });
    return invitation;
  }

  async listInvitations(
    tenant: SuperAgencyTenantContext,
    query: SuperAgencyInvitationListQueryDto,
  ) {
    this.assertPermission(tenant, PermissionKeys.superAgencyMembersInvite);
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 25, 100);
    const where: Prisma.SuperAgencyInvitationWhereInput = {
      superAgencyId: tenant.superAgencyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? { emailNormalized: { contains: query.search.trim().toLowerCase(), mode: 'insensitive' } }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.superAgencyInvitation.findMany({
        where,
        select: superAgencyInvitationSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.superAgencyInvitation.count({ where }),
    ]);
    return { items, page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
  }

  async revokeInvitation(tenant: SuperAgencyTenantContext, invitationId: string) {
    this.assertPermission(tenant, PermissionKeys.superAgencyMembersInvite);
    const invitation = await this.prisma.superAgencyInvitation.findFirst({
      where: {
        id: invitationId,
        superAgencyId: tenant.superAgencyId,
        status: SuperAgencyInvitationStatus.PENDING,
      },
      select: { id: true },
    });
    if (!invitation) throw new NotFoundException('Invitation not found.');
    const revoked = await this.prisma.superAgencyInvitation.update({
      where: { id: invitationId },
      data: { status: SuperAgencyInvitationStatus.REVOKED, revokedAt: new Date() },
      select: superAgencyInvitationSelect,
    });
    await this.audit.record({
      superAgencyId: tenant.superAgencyId,
      userId: tenant.userId,
      action: 'super_agency.invitation.revoked',
      entityType: 'SuperAgencyInvitation',
      entityId: invitationId,
    });
    return revoked;
  }

  async acceptInvitation(user: AuthenticatedUser, dto: AcceptSuperAgencyInvitationDto) {
    const tokenHash = hashToken(dto.token);
    const now = new Date();
    const invitation = await this.prisma.superAgencyInvitation.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        superAgencyId: true,
        emailNormalized: true,
        roleId: true,
        status: true,
        expiresAt: true,
        superAgency: { select: { status: true } },
      },
    });
    if (!invitation || invitation.status !== SuperAgencyInvitationStatus.PENDING) {
      throw new ForbiddenException('Invitation is not valid.');
    }
    if (invitation.expiresAt <= now) {
      await this.prisma.superAgencyInvitation.update({
        where: { id: invitation.id },
        data: { status: SuperAgencyInvitationStatus.EXPIRED },
      });
      throw new ForbiddenException('Invitation has expired.');
    }
    if (invitation.superAgency.status !== SuperAgencyStatus.ACTIVE) {
      throw new ForbiddenException('Super Agency is not active.');
    }
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, email: true },
    });
    if (!dbUser || dbUser.email.toLowerCase() !== invitation.emailNormalized) {
      throw new ForbiddenException('Invitation does not match the authenticated user.');
    }
    const membership = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.superAgencyInvitation.updateMany({
        where: {
          id: invitation.id,
          status: SuperAgencyInvitationStatus.PENDING,
          expiresAt: { gt: now },
        },
        data: {
          status: SuperAgencyInvitationStatus.ACCEPTED,
          acceptedAt: now,
          acceptedByUserId: user.id,
        },
      });
      if (claimed.count !== 1) {
        throw new ConflictException('Invitation has already been used.');
      }
      const created = await tx.superAgencyMembership.upsert({
        where: {
          userId_superAgencyId: {
            userId: user.id,
            superAgencyId: invitation.superAgencyId,
          },
        },
        update: { roleId: invitation.roleId, status: MembershipStatus.ACTIVE },
        create: {
          userId: user.id,
          superAgencyId: invitation.superAgencyId,
          roleId: invitation.roleId,
        },
        select: superAgencyMembershipSelect,
      });
      return created;
    });
    await this.audit.record({
      superAgencyId: invitation.superAgencyId,
      userId: user.id,
      action: 'super_agency.invitation.accepted',
      entityType: 'SuperAgencyInvitation',
      entityId: invitation.id,
      metadata: { membershipId: membership.id },
    });
    return membership;
  }

  private assertPermission(tenant: SuperAgencyTenantContext, permission: string) {
    if (!tenant.permissions.includes(permission) && !tenant.permissions.includes('*')) {
      throw new ForbiddenException('Insufficient permissions.');
    }
  }

  private async superAgencyRoleForAssignment(
    tenant: SuperAgencyTenantContext,
    key?: string,
    roleId?: string,
  ) {
    if (key && roleId) throw new BadRequestException('Provide either role or roleId.');
    const role = await this.prisma.role.findFirst({
      where: roleId
        ? {
            id: roleId,
            scope: RoleScope.SUPER_AGENCY,
            isActive: true,
            OR: [{ isSystem: true }, { key: { startsWith: customSuperAgencyRolePrefix(tenant) } }],
          }
        : {
            key: key ?? 'SUPER_AGENCY_MEMBER',
            scope: RoleScope.SUPER_AGENCY,
            isActive: true,
          },
      select: {
        id: true,
        key: true,
        rolePermissions: { select: { permission: { select: { key: true } } } },
      },
    });
    if (!role) throw new NotFoundException('Role not found.');
    if (
      role.rolePermissions.some((item) => PLATFORM_ONLY_PERMISSION_KEYS.has(item.permission.key))
    ) {
      throw new ForbiddenException(
        'Platform permissions cannot be assigned to Super Agency roles.',
      );
    }
    if (!tenant.permissions.includes('*')) {
      const callerPermissions = new Set(tenant.permissions);
      const forbidden = role.rolePermissions.filter(
        (item) => !callerPermissions.has(item.permission.key),
      );
      if (forbidden.length) {
        throw new ForbiddenException('Cannot delegate permissions you do not have.');
      }
    }
    return role;
  }

  private async validatedSuperAgencyPermissionIds(
    permissionIds: string[],
    tenant: SuperAgencyTenantContext,
  ) {
    if (new Set(permissionIds).size !== permissionIds.length) {
      throw new BadRequestException('Duplicate permissions are not allowed.');
    }
    const permissions = await this.prisma.permission.findMany({
      where: { id: { in: permissionIds } },
      select: { id: true, key: true },
    });
    if (permissions.length !== permissionIds.length) {
      throw new BadRequestException('Unknown permissions are not allowed.');
    }
    if (permissions.some((permission) => PLATFORM_ONLY_PERMISSION_KEYS.has(permission.key))) {
      throw new BadRequestException('Platform permissions are not assignable.');
    }
    if (!tenant.permissions.includes('*')) {
      const callerPermissions = new Set(tenant.permissions);
      const forbidden = permissions.filter((permission) => !callerPermissions.has(permission.key));
      if (forbidden.length) {
        throw new ForbiddenException('Cannot delegate permissions you do not have.');
      }
    }
    return permissionIds;
  }

  private async assertAnotherActiveOwner(superAgencyId: string, excludedMembershipId: string) {
    const count = await this.prisma.superAgencyMembership.count({
      where: {
        superAgencyId,
        id: { not: excludedMembershipId },
        status: MembershipStatus.ACTIVE,
        role: { key: 'SUPER_AGENCY_OWNER', scope: RoleScope.SUPER_AGENCY },
      },
    });
    if (count < 1) throw new ForbiddenException('Super Agency must keep an active owner.');
  }

  private async assertNoActiveMembershipForEmail(superAgencyId: string, email: string) {
    const membership = await this.prisma.superAgencyMembership.findFirst({
      where: {
        superAgencyId,
        status: MembershipStatus.ACTIVE,
        user: { email },
      },
      select: { id: true },
    });
    if (membership)
      throw new ConflictException('User already has an active Super Agency membership.');
  }
}

const superAgencySelect = {
  id: true,
  name: true,
  slug: true,
  status: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SuperAgencySelect;

const superAgencyMembershipSelect = {
  id: true,
  userId: true,
  superAgencyId: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { id: true, email: true, name: true, status: true } },
  role: { select: { id: true, key: true, name: true, scope: true } },
} satisfies Prisma.SuperAgencyMembershipSelect;

const superAgencyInvitationSelect = {
  id: true,
  superAgencyId: true,
  email: true,
  roleId: true,
  status: true,
  expiresAt: true,
  acceptedAt: true,
  revokedAt: true,
  createdAt: true,
  updatedAt: true,
  role: { select: { id: true, key: true, name: true, scope: true } },
} satisfies Prisma.SuperAgencyInvitationSelect;

const roleSelect = {
  id: true,
  key: true,
  name: true,
  description: true,
  scope: true,
  isSystem: true,
  isActive: true,
  workspaceId: true,
  createdAt: true,
  updatedAt: true,
  rolePermissions: {
    select: { permission: { select: { id: true, key: true, description: true } } },
  },
} satisfies Prisma.RoleSelect;

type RoleRecord = Prisma.RoleGetPayload<{ select: typeof roleSelect }>;

function serializeRole(role: RoleRecord) {
  return {
    id: role.id,
    key: role.key,
    name: role.name,
    description: role.description,
    scope: role.scope,
    isSystem: role.isSystem,
    isActive: role.isActive,
    workspaceId: role.workspaceId,
    permissions: role.rolePermissions.map((item) => item.permission),
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}

function normalizeRoleName(name: string) {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function emailDomain(email: string) {
  return email.split('@')[1] ?? null;
}

function customSuperAgencyRolePrefix(tenant: SuperAgencyTenantContext) {
  return `super-agency:${tenant.superAgencyId}:`;
}

function isUniqueConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
