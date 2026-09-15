import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RoleScope } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { WorkspaceTenantContext } from '../../common/auth/auth.types';
import { OWNER_ROLE } from '../../common/authorization/permissions';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateRoleDto, ReplaceRolePermissionsDto, UpdateRoleDto } from './dto/role.dto';

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenant: WorkspaceTenantContext) {
    const roles = await this.prisma.role.findMany({
      where: {
        scope: RoleScope.WORKSPACE,
        OR: [{ workspaceId: null }, { workspaceId: tenant.workspaceId }],
      },
      select: roleSelect,
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
    return roles.map(serializeRole);
  }

  async get(tenant: WorkspaceTenantContext, roleId: string) {
    const role = await this.findWorkspaceVisibleRole(tenant.workspaceId, roleId);
    return serializeRole(role);
  }

  async create(tenant: WorkspaceTenantContext, dto: CreateRoleDto) {
    await this.assertUniqueName(tenant.workspaceId, dto.name);
    const permissionIds = await this.validatedPermissionIds(dto.permissionIds ?? [], tenant);
    const role = await this.prisma
      .$transaction(async (tx) => {
        const created = await tx.role.create({
          data: {
            key: `workspace:${tenant.workspaceId}:${randomUUID()}`,
            workspaceId: tenant.workspaceId,
            name: dto.name.trim(),
            nameNormalized: normalizeRoleName(dto.name),
            description: dto.description?.trim(),
            scope: RoleScope.WORKSPACE,
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
      })
      .catch((error: unknown) => {
        if (isUniqueConflict(error))
          throw new ConflictException('Role name already exists in this workspace.');
        throw error;
      });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'role.created',
      entityType: 'Role',
      entityId: role.id,
      metadata: { permissionIds },
    });
    return serializeRole(role);
  }

  async update(tenant: WorkspaceTenantContext, roleId: string, dto: UpdateRoleDto) {
    await this.findCustomRole(tenant.workspaceId, roleId);
    if (dto.name) await this.assertUniqueName(tenant.workspaceId, dto.name, roleId);
    const role = await this.prisma
      .$transaction(
        async (tx) => {
          const freshRole = await tx.role.findFirst({
            where: { id: roleId, workspaceId: tenant.workspaceId, isSystem: false },
            select: { id: true, isActive: true },
          });
          if (!freshRole) throw new NotFoundException('Role not found.');
          if (dto.isActive === false && freshRole.isActive) {
            const activeMembers = await tx.workspaceMembership.count({
              where: { roleId, status: 'ACTIVE' },
            });
            if (activeMembers > 0) {
              throw new ConflictException(
                'Active memberships must be reassigned before deactivation.',
              );
            }
          }
          return tx.role.update({
            where: { id: roleId },
            data: {
              name: dto.name?.trim(),
              nameNormalized: dto.name ? normalizeRoleName(dto.name) : undefined,
              description:
                dto.description === undefined ? undefined : (dto.description?.trim() ?? null),
              isActive: dto.isActive,
            },
            select: roleSelect,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
      .catch((error: unknown) => {
        if (isUniqueConflict(error))
          throw new ConflictException('Role name already exists in this workspace.');
        throw error;
      });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action:
        dto.isActive === false
          ? 'role.deactivated'
          : dto.isActive === true
            ? 'role.activated'
            : 'role.updated',
      entityType: 'Role',
      entityId: roleId,
      metadata: { changed: Object.keys(dto) },
    });
    return serializeRole(role);
  }

  async clone(tenant: WorkspaceTenantContext, roleId: string) {
    const source = await this.findWorkspaceVisibleRole(tenant.workspaceId, roleId);
    if (!source.isActive) throw new BadRequestException('Inactive roles cannot be cloned.');
    const baseName = `${source.name} Copy`;
    const name = await this.nextCloneName(tenant.workspaceId, baseName);
    const permissionIds = source.rolePermissions
      .filter((item) => item.permission.key !== '*')
      .map((item) => item.permission.id);
    await this.validatedPermissionIds(permissionIds, tenant);
    const role = await this.prisma.$transaction(async (tx) => {
      const created = await tx.role.create({
        data: {
          key: `workspace:${tenant.workspaceId}:${randomUUID()}`,
          workspaceId: tenant.workspaceId,
          name,
          nameNormalized: normalizeRoleName(name),
          description: source.description,
          scope: RoleScope.WORKSPACE,
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
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'role.cloned',
      entityType: 'Role',
      entityId: role.id,
      metadata: { sourceRoleId: roleId, permissionIds },
    });
    return serializeRole(role);
  }

  async replacePermissions(
    tenant: WorkspaceTenantContext,
    roleId: string,
    dto: ReplaceRolePermissionsDto,
  ) {
    await this.findCustomRole(tenant.workspaceId, roleId);
    const permissionIds = await this.validatedPermissionIds(dto.permissionIds, tenant);
    const role = await this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId } });
      if (permissionIds.length) {
        await tx.rolePermission.createMany({
          data: permissionIds.map((permissionId) => ({ roleId, permissionId })),
        });
      }
      return tx.role.findUniqueOrThrow({ where: { id: roleId }, select: roleSelect });
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'role.permissions_changed',
      entityType: 'Role',
      entityId: roleId,
      metadata: { permissionIds },
    });
    return serializeRole(role);
  }

  private async findWorkspaceVisibleRole(workspaceId: string, roleId: string) {
    const role = await this.prisma.role.findFirst({
      where: {
        id: roleId,
        scope: RoleScope.WORKSPACE,
        OR: [{ workspaceId: null }, { workspaceId }],
      },
      select: roleSelect,
    });
    if (!role) throw new NotFoundException('Role not found.');
    return role;
  }

  private async findCustomRole(workspaceId: string, roleId: string) {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, workspaceId, scope: RoleScope.WORKSPACE, isSystem: false },
      select: roleSelect,
    });
    if (!role) throw new NotFoundException('Role not found.');
    return role;
  }

  private async assertUniqueName(workspaceId: string, name: string, exceptId?: string) {
    if (protectedSystemRoleNames.has(normalizeRoleName(name))) {
      throw new ConflictException('Role name is reserved for a system role.');
    }
    const existing = await this.prisma.role.findFirst({
      where: {
        workspaceId,
        nameNormalized: normalizeRoleName(name),
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (existing) throw new ConflictException('Role name already exists in this workspace.');
  }

  private async validatedPermissionIds(permissionIds: string[], tenant: WorkspaceTenantContext) {
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
    if (permissions.some((permission) => permission.key === '*')) {
      throw new BadRequestException('Wildcard permissions are not assignable.');
    }
    if (tenant.roleName !== OWNER_ROLE && !tenant.permissions.includes('*')) {
      const callerPermissions = new Set(tenant.permissions);
      const forbidden = permissions.filter((permission) => !callerPermissions.has(permission.key));
      if (forbidden.length) {
        throw new ForbiddenException('Cannot delegate permissions you do not have.');
      }
    }
    return permissionIds;
  }

  private async nextCloneName(workspaceId: string, baseName: string) {
    let candidate = baseName.slice(0, 80);
    for (let suffix = 2; suffix < 100; suffix += 1) {
      const existing = await this.prisma.role.findFirst({
        where: { workspaceId, nameNormalized: normalizeRoleName(candidate) },
        select: { id: true },
      });
      if (!existing) return candidate;
      const tail = ` ${suffix}`;
      candidate = `${baseName.slice(0, 80 - tail.length)}${tail}`;
    }
    throw new ConflictException('Could not create a unique clone name.');
  }
}

const protectedSystemRoleNames = new Set(['owner', 'admin', 'manager', 'member']);

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

function isUniqueConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
