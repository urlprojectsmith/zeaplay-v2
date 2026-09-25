import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MembershipStatus, Prisma, RoleScope } from '@prisma/client';
import type {
  AgencyTenantContext,
  AuthenticatedUser,
  SuperAgencyTenantContext,
} from '../../common/auth/auth.types';
import { TenantHierarchyService } from '../../common/tenant/tenant-hierarchy.service';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BillingEntitlementService } from '../billing/billing-entitlement.service';
import { AgencyManagementListQueryDto } from './dto/agency-management.dto';
import { CreateAgencyDto } from './dto/create-agency.dto';
import { UpdateAgencyDto } from './dto/update-agency.dto';
import { CreateAgencyMembershipDto, UpdateAgencyMembershipDto } from './dto/agency-membership.dto';

@Injectable()
export class AgenciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly hierarchy: TenantHierarchyService,
    private readonly billingEntitlements?: BillingEntitlementService,
  ) {}

  async create(user: AuthenticatedUser, dto: CreateAgencyDto, tenant?: SuperAgencyTenantContext) {
    if (tenant && dto.superAgencyId && dto.superAgencyId !== tenant.superAgencyId) {
      throw new ForbiddenException('Cannot create an Agency under a foreign Super Agency.');
    }
    const superAgencyId = tenant?.superAgencyId ?? dto.superAgencyId;
    if (!superAgencyId) throw new ForbiddenException('Super Agency context is required.');
    await this.hierarchy.assertSuperAgencyExists(superAgencyId);
    const ownerRole = await this.role('AGENCY_OWNER', RoleScope.AGENCY);
    const agency = await this.prisma
      .$transaction(async (tx) => {
        await this.billingEntitlements?.assertAgencyCreationAvailableTx(tx, superAgencyId);
        const created = await tx.agency.create({
          data: {
            superAgencyId,
            name: dto.name.trim(),
            slug: dto.slug.trim().toLowerCase(),
            createdById: user.id,
            memberships: { create: { userId: user.id, roleId: ownerRole.id } },
          },
          select: agencySelect,
        });
        await this.billingEntitlements?.assignDefaultAgencyAllocationTx(tx, created.id, user.id);
        return created;
      })
      .catch((error: unknown) => {
        if (isUniqueConflict(error)) throw new ConflictException('Agency slug already exists.');
        throw error;
      });
    await this.audit.record({
      superAgencyId: agency.superAgencyId,
      agencyId: agency.id,
      userId: user.id,
      action: 'agency.create',
      entityType: 'Agency',
      entityId: agency.id,
      metadata: tenant
        ? {
            sourceScope: 'SUPER_AGENCY',
            superAgencyMembershipId: tenant.superAgencyMembershipId,
          }
        : undefined,
    });
    return agency;
  }

  async listForSuperAgency(tenant: SuperAgencyTenantContext, query: AgencyManagementListQueryDto) {
    const page = Math.max(1, query.page);
    const pageSize = Math.min(Math.max(1, query.pageSize), 100);
    const where: Prisma.AgencyWhereInput = {
      superAgencyId: tenant.superAgencyId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search?.trim()
        ? { name: { contains: query.search.trim(), mode: 'insensitive' } }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.agency.findMany({
        where,
        select: agencyManagementSelect,
        orderBy: agencyOrderBy(query.sort),
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.agency.count({ where }),
    ]);
    return {
      items: items.map(serializeAgencyManagement),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async getForSuperAgency(tenant: SuperAgencyTenantContext, agencyId: string) {
    const agency = await this.prisma.agency.findFirst({
      where: { id: agencyId, superAgencyId: tenant.superAgencyId },
      select: agencyManagementSelect,
    });
    if (!agency) throw new NotFoundException('Agency not found.');
    return serializeAgencyManagement(agency);
  }

  async updateForSuperAgency(
    tenant: SuperAgencyTenantContext,
    agencyId: string,
    dto: UpdateAgencyDto,
  ) {
    await this.getForSuperAgency(tenant, agencyId);
    const agency = await this.prisma.agency.update({
      where: { id: agencyId },
      data: { name: dto.name?.trim(), status: dto.status },
      select: agencyManagementSelect,
    });
    await this.audit.record({
      superAgencyId: tenant.superAgencyId,
      agencyId,
      userId: tenant.userId,
      action: 'agency.parent_update',
      entityType: 'Agency',
      entityId: agencyId,
      metadata: {
        sourceScope: 'SUPER_AGENCY',
        superAgencyMembershipId: tenant.superAgencyMembershipId,
        changed: Object.keys(dto),
      },
    });
    return serializeAgencyManagement(agency);
  }

  async list(userId: string) {
    const memberships = await this.prisma.agencyMembership.findMany({
      where: { userId, status: MembershipStatus.ACTIVE },
      select: { agency: { select: agencySelect }, role: { select: { key: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((membership) => ({ ...membership.agency, role: membership.role.key }));
  }

  async get(tenant: AgencyTenantContext) {
    const agency = await this.prisma.agency.findUnique({
      where: { id: tenant.agencyId },
      select: agencySelect,
    });
    if (!agency) throw new NotFoundException('Agency not found.');
    return agency;
  }

  async update(tenant: AgencyTenantContext, dto: UpdateAgencyDto) {
    const agency = await this.prisma.agency.update({
      where: { id: tenant.agencyId },
      data: { name: dto.name?.trim(), status: dto.status },
      select: agencySelect,
    });
    await this.audit.record({
      superAgencyId: tenant.superAgencyId,
      agencyId: tenant.agencyId,
      userId: tenant.userId,
      action: 'agency.update',
      entityType: 'Agency',
      entityId: tenant.agencyId,
      metadata: { changed: Object.keys(dto) },
    });
    return agency;
  }

  async listMemberships(tenant: AgencyTenantContext) {
    return this.prisma.agencyMembership.findMany({
      where: { agencyId: tenant.agencyId },
      select: agencyMembershipSelect,
      orderBy: { createdAt: 'asc' },
    });
  }

  async addMembership(tenant: AgencyTenantContext, dto: CreateAgencyMembershipDto) {
    const [user, role] = await Promise.all([
      this.prisma.user.findUnique({
        where: { email: dto.email.trim().toLowerCase() },
        select: { id: true },
      }),
      this.role(dto.role, RoleScope.AGENCY),
    ]);
    if (!user) throw new NotFoundException('User not found.');
    const membership = await this.prisma.agencyMembership.upsert({
      where: { userId_agencyId: { userId: user.id, agencyId: tenant.agencyId } },
      update: { roleId: role.id, status: MembershipStatus.ACTIVE },
      create: { userId: user.id, agencyId: tenant.agencyId, roleId: role.id },
      select: agencyMembershipSelect,
    });
    await this.audit.record({
      superAgencyId: tenant.superAgencyId,
      agencyId: tenant.agencyId,
      userId: tenant.userId,
      action: 'agency.membership.upsert',
      entityType: 'AgencyMembership',
      entityId: membership.id,
    });
    return membership;
  }

  async updateMembership(
    tenant: AgencyTenantContext,
    membershipId: string,
    dto: UpdateAgencyMembershipDto,
  ) {
    const existing = await this.prisma.agencyMembership.findFirst({
      where: { id: membershipId, agencyId: tenant.agencyId },
      select: { id: true, role: { select: { key: true } } },
    });
    if (!existing) throw new NotFoundException('Membership not found.');
    if (existing.role.key === 'AGENCY_OWNER')
      throw new ForbiddenException('Agency owner membership cannot be changed.');
    const role = dto.role ? await this.role(dto.role, RoleScope.AGENCY) : null;
    const membership = await this.prisma.agencyMembership.update({
      where: { id: membershipId },
      data: { roleId: role?.id, status: dto.status },
      select: agencyMembershipSelect,
    });
    await this.audit.record({
      superAgencyId: tenant.superAgencyId,
      agencyId: tenant.agencyId,
      userId: tenant.userId,
      action: 'agency.membership.update',
      entityType: 'AgencyMembership',
      entityId: membershipId,
      metadata: { changed: Object.keys(dto) },
    });
    return membership;
  }

  private async role(key: string, scope: RoleScope) {
    const role = await this.prisma.role.findFirst({ where: { key, scope }, select: { id: true } });
    if (!role) throw new NotFoundException('Role not found.');
    return role;
  }
}

const agencySelect = {
  id: true,
  superAgencyId: true,
  name: true,
  slug: true,
  status: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AgencySelect;

const agencyManagementSelect = {
  ...agencySelect,
  _count: { select: { memberships: true, workspaces: true } },
} satisfies Prisma.AgencySelect;

const agencyMembershipSelect = {
  id: true,
  userId: true,
  agencyId: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { id: true, email: true, name: true, status: true } },
  role: { select: { id: true, key: true, name: true } },
} satisfies Prisma.AgencyMembershipSelect;

function isUniqueConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

type AgencyManagementRecord = Prisma.AgencyGetPayload<{ select: typeof agencyManagementSelect }>;

function serializeAgencyManagement(agency: AgencyManagementRecord) {
  return {
    id: agency.id,
    superAgencyId: agency.superAgencyId,
    name: agency.name,
    slug: agency.slug,
    status: agency.status,
    createdById: agency.createdById,
    createdAt: agency.createdAt,
    updatedAt: agency.updatedAt,
    counts: {
      members: agency._count.memberships,
      workspaces: agency._count.workspaces,
    },
  };
}

function agencyOrderBy(sort: AgencyManagementListQueryDto['sort']) {
  switch (sort) {
    case 'OLDEST':
      return { createdAt: 'asc' } satisfies Prisma.AgencyOrderByWithRelationInput;
    case 'NAME_ASC':
      return { name: 'asc' } satisfies Prisma.AgencyOrderByWithRelationInput;
    case 'NAME_DESC':
      return { name: 'desc' } satisfies Prisma.AgencyOrderByWithRelationInput;
    case 'NEWEST':
    default:
      return { createdAt: 'desc' } satisfies Prisma.AgencyOrderByWithRelationInput;
  }
}
