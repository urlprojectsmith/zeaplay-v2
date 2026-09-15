import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MembershipStatus, Prisma, RoleScope } from '@prisma/client';
import type { WorkspaceTenantContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { UpdateWorkspaceUserMembershipDto } from './dto/update-workspace-user.dto';
import { WorkspaceUserQueryDto } from './dto/workspace-user-query.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listWorkspaceUsers(tenant: WorkspaceTenantContext, query: WorkspaceUserQueryDto) {
    const where = await this.workspaceMembershipWhere(tenant.workspaceId, query);
    const orderBy = userOrderBy(query.sortBy, query.sortDirection);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.workspaceMembership.findMany({
        where,
        select: workspaceUserSelect,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.workspaceMembership.count({ where }),
    ]);
    return {
      items: items.map(serializeWorkspaceUser),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async getWorkspaceUser(tenant: WorkspaceTenantContext, userId: string) {
    const membership = await this.prisma.workspaceMembership.findUnique({
      where: { userId_workspaceId: { userId, workspaceId: tenant.workspaceId } },
      select: workspaceUserSelect,
    });
    if (!membership) throw new NotFoundException('Workspace user not found.');
    return serializeWorkspaceUser(membership);
  }

  async updateWorkspaceUser(
    tenant: WorkspaceTenantContext,
    userId: string,
    dto: UpdateWorkspaceUserMembershipDto,
  ) {
    const existing = await this.prisma.workspaceMembership.findUnique({
      where: { userId_workspaceId: { userId, workspaceId: tenant.workspaceId } },
      select: {
        id: true,
        userId: true,
        workspaceId: true,
        status: true,
        role: { select: { key: true } },
        managedDepartments: { select: { id: true } },
      },
    });
    if (!existing) throw new NotFoundException('Workspace user not found.');
    if (existing.role.key === 'OWNER')
      throw new ForbiddenException('Workspace owner membership cannot be changed.');
    if (existing.userId === tenant.userId && dto.status === MembershipStatus.SUSPENDED) {
      throw new ForbiddenException('You cannot suspend your own active workspace membership.');
    }

    const [role, department] = await Promise.all([
      dto.role ? this.role(dto.role) : null,
      dto.departmentId ? this.department(tenant.workspaceId, dto.departmentId) : null,
    ]);

    const data: Prisma.WorkspaceMembershipUncheckedUpdateInput = {
      roleId: role?.id,
      status: dto.status,
      departmentId: dto.departmentId === null ? null : department?.id,
    };
    const membership = await this.prisma.$transaction(async (tx) => {
      if (dto.status === MembershipStatus.SUSPENDED && existing.managedDepartments.length > 0) {
        await tx.department.updateMany({
          where: { workspaceId: tenant.workspaceId, managerMembershipId: existing.id },
          data: { managerMembershipId: null },
        });
      }
      return tx.workspaceMembership.update({
        where: { id: existing.id },
        data,
        select: workspaceUserSelect,
      });
    });

    await Promise.all(
      auditActionsForUserUpdate(dto).map((action) =>
        this.audit.record({
          agencyId: tenant.agencyId,
          workspaceId: tenant.workspaceId,
          userId: tenant.userId,
          action,
          entityType: 'WorkspaceMembership',
          entityId: membership.id,
          metadata: { targetUserId: userId, changed: Object.keys(dto) },
        }),
      ),
    );
    return serializeWorkspaceUser(membership);
  }

  private async workspaceMembershipWhere(workspaceId: string, query: WorkspaceUserQueryDto) {
    const where: Prisma.WorkspaceMembershipWhereInput = { workspaceId };
    if (query.status) where.status = query.status;
    if (query.role) where.role = { key: query.role, scope: RoleScope.WORKSPACE };
    if (query.departmentId) {
      await this.department(workspaceId, query.departmentId);
      where.departmentId = query.departmentId;
    }
    const search = query.search?.trim();
    if (search) {
      if (search.length < 2) throw new BadRequestException('Search must be at least 2 characters.');
      const searchConditions: Prisma.WorkspaceMembershipWhereInput[] = [
        { user: { email: { startsWith: search, mode: Prisma.QueryMode.insensitive } } },
        { user: { name: { startsWith: search, mode: Prisma.QueryMode.insensitive } } },
      ];
      if (uuidPattern.test(search)) searchConditions.push({ userId: search });
      where.OR = searchConditions;
    }
    return where;
  }

  private async role(key: string) {
    const role = await this.prisma.role.findFirst({
      where: { key, scope: RoleScope.WORKSPACE, workspaceId: null },
      select: { id: true },
    });
    if (!role) throw new NotFoundException('Role not found.');
    return role;
  }

  private async department(workspaceId: string, departmentId: string) {
    const department = await this.prisma.department.findFirst({
      where: { id: departmentId, workspaceId },
      select: { id: true, status: true },
    });
    if (!department) throw new NotFoundException('Department not found.');
    if (department.status !== 'ACTIVE') throw new BadRequestException('Department is not active.');
    return department;
  }
}

const workspaceUserSelect = {
  id: true,
  userId: true,
  workspaceId: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { id: true, email: true, name: true, status: true, createdAt: true } },
  role: { select: { id: true, key: true, name: true } },
  department: { select: { id: true, name: true, status: true } },
} satisfies Prisma.WorkspaceMembershipSelect;

type WorkspaceUserRecord = Prisma.WorkspaceMembershipGetPayload<{
  select: typeof workspaceUserSelect;
}>;

function serializeWorkspaceUser(membership: WorkspaceUserRecord) {
  return {
    id: membership.user.id,
    membershipId: membership.id,
    workspaceId: membership.workspaceId,
    email: membership.user.email,
    name: membership.user.name,
    userStatus: membership.user.status,
    membershipStatus: membership.status,
    role: membership.role,
    department: membership.department,
    joinedAt: membership.createdAt,
    updatedAt: membership.updatedAt,
    createdAt: membership.user.createdAt,
  };
}

function userOrderBy(sortBy: string, sortDirection: Prisma.SortOrder) {
  if (sortBy === 'name') return { user: { name: sortDirection } };
  return { createdAt: sortDirection };
}

function auditActionsForUserUpdate(dto: UpdateWorkspaceUserMembershipDto) {
  const actions: string[] = [];
  if (dto.status === MembershipStatus.ACTIVE) actions.push('workspace.user.activated');
  if (dto.status === MembershipStatus.SUSPENDED) actions.push('workspace.user.suspended');
  if (dto.role) actions.push('workspace.user.role_changed');
  if (dto.departmentId === null) actions.push('workspace.user.department_removed');
  if (dto.departmentId) actions.push('workspace.user.department_assigned');
  return actions.length > 0 ? actions : ['workspace.user.updated'];
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
