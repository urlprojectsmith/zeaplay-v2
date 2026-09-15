import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MembershipStatus, Prisma, RoleScope } from '@prisma/client';
import type { AgencyTenantContext, AuthenticatedUser } from '../../common/auth/auth.types';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateAgencyDto } from './dto/create-agency.dto';
import { UpdateAgencyDto } from './dto/update-agency.dto';
import { CreateAgencyMembershipDto, UpdateAgencyMembershipDto } from './dto/agency-membership.dto';

@Injectable()
export class AgenciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(user: AuthenticatedUser, dto: CreateAgencyDto) {
    const ownerRole = await this.role('AGENCY_OWNER', RoleScope.AGENCY);
    const agency = await this.prisma.agency
      .create({
        data: {
          name: dto.name.trim(),
          slug: dto.slug.trim().toLowerCase(),
          createdById: user.id,
          memberships: { create: { userId: user.id, roleId: ownerRole.id } },
        },
        select: agencySelect,
      })
      .catch((error: unknown) => {
        if (isUniqueConflict(error)) throw new ConflictException('Agency slug already exists.');
        throw error;
      });
    await this.audit.record({
      agencyId: agency.id,
      userId: user.id,
      action: 'agency.create',
      entityType: 'Agency',
      entityId: agency.id,
    });
    return agency;
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
  name: true,
  slug: true,
  status: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
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
