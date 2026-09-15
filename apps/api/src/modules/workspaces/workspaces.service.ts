import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MembershipStatus, Prisma, RoleScope } from '@prisma/client';
import type { AgencyTenantContext, WorkspaceTenantContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
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
  ) {}

  async create(tenant: AgencyTenantContext, dto: CreateWorkspaceDto) {
    const ownerRole = await this.role('OWNER', RoleScope.WORKSPACE);
    const workspace = await this.prisma.workspace
      .create({
        data: {
          agencyId: tenant.agencyId,
          name: dto.name.trim(),
          slug: dto.slug.trim().toLowerCase(),
          createdById: tenant.userId,
          memberships: { create: { userId: tenant.userId, roleId: ownerRole.id } },
        },
        select: workspaceSelect,
      })
      .catch((error: unknown) => {
        if (isUniqueConflict(error))
          throw new ConflictException('Workspace slug already exists for this agency.');
        throw error;
      });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: workspace.id,
      userId: tenant.userId,
      action: 'workspace.create',
      entityType: 'Workspace',
      entityId: workspace.id,
    });
    return serializeWorkspace(workspace);
  }

  async listForAgency(tenant: AgencyTenantContext) {
    const workspaces = await this.prisma.workspace.findMany({
      where: { agencyId: tenant.agencyId },
      select: workspaceSelect,
      orderBy: { createdAt: 'asc' },
    });
    return workspaces.map(serializeWorkspace);
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
      data: { name: dto.name?.trim(), status: dto.status },
      select: workspaceSelect,
    });
    await this.audit.record({
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
    const membership = await this.prisma.workspaceMembership.upsert({
      where: { userId_workspaceId: { userId: user.id, workspaceId: tenant.workspaceId } },
      update: { roleId: role.id, status: MembershipStatus.ACTIVE },
      create: { userId: user.id, workspaceId: tenant.workspaceId, roleId: role.id },
      select: workspaceMembershipSelect,
    });
    await this.audit.record({
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
      select: { id: true, role: { select: { key: true } } },
    });
    if (!existing) throw new NotFoundException('Membership not found.');
    if (existing.role.key === 'OWNER')
      throw new ForbiddenException('Workspace owner membership cannot be changed.');
    const role = dto.role ? await this.role(dto.role, RoleScope.WORKSPACE) : null;
    const membership = await this.prisma.workspaceMembership.update({
      where: { id: membershipId },
      data: { roleId: role?.id, status: dto.status },
      select: workspaceMembershipSelect,
    });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'workspace.membership.update',
      entityType: 'WorkspaceMembership',
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

const workspaceSelect = {
  id: true,
  agencyId: true,
  name: true,
  slug: true,
  status: true,
  storageUsedBytes: true,
  storageLimitBytes: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
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

function isUniqueConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
