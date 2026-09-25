import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AgencyStatus, MembershipStatus, Prisma, RoleScope } from '@prisma/client';
import type {
  AgencyTenantContext,
  SuperAgencyTenantContext,
  WorkspaceTenantContext,
} from '../../common/auth/auth.types';
import { TenantHierarchyService } from '../../common/tenant/tenant-hierarchy.service';
import { normalizeIanaTimezone } from '../../common/timezones';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BillingEntitlementService } from '../billing/billing-entitlement.service';
import { initializeDefaultStatuses } from '../statuses/status-templates';
import { WorkspaceManagementListQueryDto } from '../agencies/dto/agency-management.dto';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import {
  CreateWorkspaceMembershipDto,
  UpdateWorkspaceMembershipDto,
} from './dto/workspace-membership.dto';

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly hierarchy: TenantHierarchyService,
    private readonly billingEntitlements?: BillingEntitlementService,
  ) {}

  async create(tenant: AgencyTenantContext, dto: CreateWorkspaceDto) {
    const agencyParent = await this.getActiveAgencyParent(tenant);
    const ownerRole = await this.role('OWNER', RoleScope.WORKSPACE);
    const workspace = await this.prisma
      .$transaction(async (tx) => {
        await this.billingEntitlements?.assertWorkspaceCreationAvailableTx(tx, tenant.agencyId);
        return tx.workspace.create({
          data: {
            agencyId: tenant.agencyId,
            name: dto.name.trim(),
            slug: dto.slug.trim().toLowerCase(),
            timezone: normalizeIanaTimezone(dto.timezone, 'Workspace timezone'),
            createdById: tenant.userId,
            memberships: { create: { userId: tenant.userId, roleId: ownerRole.id } },
          },
          select: workspaceSelect,
        });
      })
      .catch((error: unknown) => {
        if (isUniqueConflict(error))
          throw new ConflictException('Workspace slug already exists for this agency.');
        throw error;
      });
    await this.audit.record({
      superAgencyId: agencyParent.superAgencyId,
      agencyId: tenant.agencyId,
      workspaceId: workspace.id,
      userId: tenant.userId,
      action: 'workspace.create',
      entityType: 'Workspace',
      entityId: workspace.id,
    });
    await initializeDefaultStatuses(this.prisma, workspace.id);
    return serializeWorkspace(workspace);
  }

  async listForAgency(tenant: AgencyTenantContext) {
    return this.listAgencyWorkspaces(tenant.agencyId, {});
  }

  async listForAgencyPaginated(
    tenant: AgencyTenantContext,
    query: WorkspaceManagementListQueryDto,
  ) {
    return this.listAgencyWorkspaces(tenant.agencyId, query);
  }

  async listForSuperAgencyAgency(
    tenant: SuperAgencyTenantContext,
    agencyId: string,
    query: WorkspaceManagementListQueryDto,
  ) {
    await this.hierarchy.assertAgencyBelongsToSuperAgency(agencyId, tenant.superAgencyId);
    return this.listAgencyWorkspaces(agencyId, query);
  }

  async get(tenant: WorkspaceTenantContext) {
    const workspace = await this.prisma.workspace.findFirst({
      where: { id: tenant.workspaceId, agencyId: tenant.agencyId },
      select: workspaceSelect,
    });
    if (!workspace) throw new NotFoundException('Workspace not found.');
    return serializeWorkspace(workspace);
  }

  async update(tenant: WorkspaceTenantContext, dto: UpdateWorkspaceDto) {
    const workspace = await this.prisma.workspace.update({
      where: { id: tenant.workspaceId },
      data: {
        name: dto.name?.trim(),
        status: dto.status,
        timezone:
          dto.timezone === undefined
            ? undefined
            : normalizeIanaTimezone(dto.timezone, 'Workspace timezone'),
      },
      select: workspaceSelect,
    });
    await this.audit.record({
      superAgencyId: tenant.superAgencyId,
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'workspace.update',
      entityType: 'Workspace',
      entityId: tenant.workspaceId,
      metadata: { changed: Object.keys(dto) },
    });
    return serializeWorkspace(workspace);
  }

  async listMemberships(tenant: WorkspaceTenantContext) {
    return this.prisma.workspaceMembership.findMany({
      where: { workspaceId: tenant.workspaceId },
      select: workspaceMembershipSelect,
      orderBy: { createdAt: 'asc' },
    });
  }

  async addMembership(tenant: WorkspaceTenantContext, dto: CreateWorkspaceMembershipDto) {
    const [user, role] = await Promise.all([
      this.prisma.user.findUnique({
        where: { email: dto.email.trim().toLowerCase() },
        select: { id: true },
      }),
      this.role(dto.role, RoleScope.WORKSPACE),
    ]);
    if (!user) throw new NotFoundException('User not found.');
    const membership = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.workspaceMembership.findUnique({
        where: { userId_workspaceId: { userId: user.id, workspaceId: tenant.workspaceId } },
        select: { id: true, status: true },
      });
      if (!existing || existing.status !== MembershipStatus.ACTIVE) {
        await this.billingEntitlements?.assertWorkspaceMembershipAvailableTx(
          tx,
          tenant.workspaceId,
        );
      }
      return tx.workspaceMembership.upsert({
        where: { userId_workspaceId: { userId: user.id, workspaceId: tenant.workspaceId } },
        update: { roleId: role.id, status: MembershipStatus.ACTIVE },
        create: { userId: user.id, workspaceId: tenant.workspaceId, roleId: role.id },
        select: workspaceMembershipSelect,
      });
    });
    await this.audit.record({
      superAgencyId: tenant.superAgencyId,
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'workspace.membership.upsert',
      entityType: 'WorkspaceMembership',
      entityId: membership.id,
    });
    return membership;
  }

  async updateMembership(
    tenant: WorkspaceTenantContext,
    membershipId: string,
    dto: UpdateWorkspaceMembershipDto,
  ) {
    const existing = await this.prisma.workspaceMembership.findFirst({
      where: { id: membershipId, workspaceId: tenant.workspaceId },
      select: { id: true, userId: true, status: true, role: { select: { key: true } } },
    });
    if (!existing) throw new NotFoundException('Membership not found.');
    if (existing.role.key === 'OWNER')
      throw new ForbiddenException('Workspace owner membership cannot be changed.');
    if (existing.userId === tenant.userId && (dto.role || dto.roleId)) {
      throw new ForbiddenException('You cannot change your own workspace role.');
    }
    const role =
      dto.role || dto.roleId
        ? await this.workspaceRoleForAssignment(tenant.workspaceId, dto.role, dto.roleId)
        : null;
    const membership = await this.prisma.$transaction(async (tx) => {
      if (dto.status === MembershipStatus.ACTIVE && existing.status !== MembershipStatus.ACTIVE) {
        await this.billingEntitlements?.assertWorkspaceMembershipAvailableTx(
          tx,
          tenant.workspaceId,
        );
      }
      return tx.workspaceMembership.update({
        where: { id: membershipId },
        data: { roleId: role?.id, status: dto.status },
        select: workspaceMembershipSelect,
      });
    });
    await this.audit.record({
      superAgencyId: tenant.superAgencyId,
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action:
        dto.role || dto.roleId
          ? 'workspace.membership.role_changed'
          : 'workspace.membership.update',
      entityType: 'WorkspaceMembership',
      entityId: membershipId,
      metadata: {
        targetUserId: existing.userId,
        changed: Object.keys(dto),
      },
    });
    return membership;
  }

  private async role(key: string, scope: RoleScope) {
    const role = await this.prisma.role.findFirst({ where: { key, scope }, select: { id: true } });
    if (!role) throw new NotFoundException('Role not found.');
    return role;
  }

  private async getActiveAgencyParent(tenant: AgencyTenantContext) {
    const agency = tenant.superAgencyId
      ? await this.prisma.agency.findFirst({
          where: { id: tenant.agencyId, superAgencyId: tenant.superAgencyId },
          select: { id: true, superAgencyId: true, status: true },
        })
      : await this.prisma.agency.findUnique({
          where: { id: tenant.agencyId },
          select: { id: true, superAgencyId: true, status: true },
        });
    if (!agency) throw new NotFoundException('Agency not found.');
    if (agency.status !== AgencyStatus.ACTIVE) {
      throw new ForbiddenException('Agency is not active.');
    }
    return agency;
  }

  private async listAgencyWorkspaces(
    agencyId: string,
    query: Partial<WorkspaceManagementListQueryDto>,
  ) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(Math.max(1, query.pageSize ?? 25), 100);
    const where: Prisma.WorkspaceWhereInput = {
      agencyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search?.trim()
        ? { name: { contains: query.search.trim(), mode: 'insensitive' } }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.workspace.findMany({
        where,
        select: workspaceMetadataSelect,
        orderBy: workspaceOrderBy(query.sort ?? 'NEWEST'),
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.workspace.count({ where }),
    ]);
    return {
      items: items.map(serializeWorkspaceMetadata),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  private async workspaceRoleForAssignment(workspaceId: string, key?: string, roleId?: string) {
    if (key && roleId) throw new ForbiddenException('Provide either role or roleId.');
    const role = await this.prisma.role.findFirst({
      where: roleId
        ? { id: roleId, scope: RoleScope.WORKSPACE, workspaceId }
        : { key, scope: RoleScope.WORKSPACE, workspaceId: null },
      select: { id: true, isActive: true },
    });
    if (!role) throw new NotFoundException('Role not found.');
    if (!role.isActive) throw new ForbiddenException('Role is not active.');
    return role;
  }
}

const workspaceSelect = {
  id: true,
  agencyId: true,
  name: true,
  slug: true,
  timezone: true,
  status: true,
  storageUsedBytes: true,
  storageLimitBytes: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.WorkspaceSelect;

const workspaceMetadataSelect = {
  id: true,
  agencyId: true,
  name: true,
  slug: true,
  timezone: true,
  status: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  agency: { select: { id: true, name: true, slug: true, superAgencyId: true } },
  _count: { select: { memberships: true } },
} satisfies Prisma.WorkspaceSelect;

const workspaceMembershipSelect = {
  id: true,
  userId: true,
  workspaceId: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { id: true, email: true, name: true, status: true } },
  role: { select: { id: true, key: true, name: true } },
} satisfies Prisma.WorkspaceMembershipSelect;

type WorkspaceRecord = Prisma.WorkspaceGetPayload<{ select: typeof workspaceSelect }>;

function serializeWorkspace(workspace: WorkspaceRecord) {
  return {
    ...workspace,
    storageUsedBytes: Number(workspace.storageUsedBytes),
    storageLimitBytes: Number(workspace.storageLimitBytes),
  };
}

type WorkspaceMetadataRecord = Prisma.WorkspaceGetPayload<{
  select: typeof workspaceMetadataSelect;
}>;

function serializeWorkspaceMetadata(workspace: WorkspaceMetadataRecord) {
  return {
    id: workspace.id,
    agencyId: workspace.agencyId,
    name: workspace.name,
    slug: workspace.slug,
    timezone: workspace.timezone,
    status: workspace.status,
    createdById: workspace.createdById,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
    agency: workspace.agency,
    counts: { members: workspace._count.memberships },
  };
}

function isUniqueConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function workspaceOrderBy(sort: WorkspaceManagementListQueryDto['sort']) {
  switch (sort) {
    case 'OLDEST':
      return { createdAt: 'asc' } satisfies Prisma.WorkspaceOrderByWithRelationInput;
    case 'NAME_ASC':
      return { name: 'asc' } satisfies Prisma.WorkspaceOrderByWithRelationInput;
    case 'NAME_DESC':
      return { name: 'desc' } satisfies Prisma.WorkspaceOrderByWithRelationInput;
    case 'NEWEST':
    default:
      return { createdAt: 'desc' } satisfies Prisma.WorkspaceOrderByWithRelationInput;
  }
}
