import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DepartmentStatus, MembershipStatus, Prisma } from '@prisma/client';
import type { WorkspaceTenantContext } from '../../common/auth/auth.types';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateDepartmentDto, UpdateDepartmentDto } from './dto/department.dto';
import { DepartmentQueryDto } from './dto/department-query.dto';

@Injectable()
export class DepartmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenant: WorkspaceTenantContext, query: DepartmentQueryDto) {
    const where: Prisma.DepartmentWhereInput = {
      workspaceId: tenant.workspaceId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? { name: { startsWith: query.search.trim(), mode: Prisma.QueryMode.insensitive } }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.department.findMany({
        where,
        select: departmentSelect,
        orderBy: { [query.sortBy]: query.sortDirection },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.department.count({ where }),
    ]);
    return {
      items: items.map(serializeDepartment),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async get(tenant: WorkspaceTenantContext, departmentId: string) {
    const department = await this.prisma.department.findFirst({
      where: { id: departmentId, workspaceId: tenant.workspaceId },
      select: departmentSelect,
    });
    if (!department) throw new NotFoundException('Department not found.');
    return serializeDepartment(department);
  }

  async create(tenant: WorkspaceTenantContext, dto: CreateDepartmentDto) {
    const manager = dto.managerUserId
      ? await this.managerMembership(tenant.workspaceId, dto.managerUserId)
      : null;
    const status = dto.status ?? DepartmentStatus.ACTIVE;
    if (status !== DepartmentStatus.ACTIVE && manager) {
      throw new BadRequestException('Inactive departments cannot have a manager.');
    }
    await this.assertUniqueName(tenant.workspaceId, dto.name);
    const department = await this.prisma.department
      .create({
        data: {
          workspaceId: tenant.workspaceId,
          name: dto.name.trim(),
          description: dto.description?.trim(),
          status,
          managerMembershipId: manager?.id,
        },
        select: departmentSelect,
      })
      .catch((error: unknown) => {
        if (isUniqueConflict(error))
          throw new ConflictException('Department name already exists in this workspace.');
        throw error;
      });
    await this.audit.record({
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      userId: tenant.userId,
      action: 'department.created',
      entityType: 'Department',
      entityId: department.id,
    });
    return serializeDepartment(department);
  }

  async update(tenant: WorkspaceTenantContext, departmentId: string, dto: UpdateDepartmentDto) {
    await this.assertDepartment(tenant.workspaceId, departmentId);
    if (dto.name) await this.assertUniqueName(tenant.workspaceId, dto.name, departmentId);
    const nextStatus = dto.status;
    if (nextStatus === DepartmentStatus.INACTIVE && dto.managerUserId) {
      throw new BadRequestException('Inactive departments cannot have a manager.');
    }
    if (dto.managerUserId && nextStatus !== DepartmentStatus.ACTIVE) {
      const existing = await this.prisma.department.findFirst({
        where: { id: departmentId, workspaceId: tenant.workspaceId },
        select: { status: true },
      });
      if (existing?.status !== DepartmentStatus.ACTIVE) {
        throw new BadRequestException('Inactive departments cannot have a manager.');
      }
    }
    const manager =
      dto.managerUserId === undefined || dto.managerUserId === null
        ? null
        : await this.managerMembership(tenant.workspaceId, dto.managerUserId);
    const department = await this.prisma.department
      .update({
        where: { id: departmentId },
        data: {
          name: dto.name?.trim(),
          description: dto.description?.trim(),
          status: dto.status,
          managerMembershipId:
            dto.status === DepartmentStatus.INACTIVE
              ? null
              : dto.managerUserId === undefined
                ? undefined
                : dto.managerUserId === null
                  ? null
                  : manager?.id,
        },
        select: departmentSelect,
      })
      .catch((error: unknown) => {
        if (isUniqueConflict(error))
          throw new ConflictException('Department name already exists in this workspace.');
        throw error;
      });
    await Promise.all(
      auditActionsForDepartmentUpdate(dto).map((action) =>
        this.audit.record({
          agencyId: tenant.agencyId,
          workspaceId: tenant.workspaceId,
          userId: tenant.userId,
          action,
          entityType: 'Department',
          entityId: departmentId,
          metadata: { changed: Object.keys(dto) },
        }),
      ),
    );
    return serializeDepartment(department);
  }

  async members(tenant: WorkspaceTenantContext, departmentId: string, query: DepartmentQueryDto) {
    await this.assertDepartment(tenant.workspaceId, departmentId);
    const where: Prisma.WorkspaceMembershipWhereInput = {
      workspaceId: tenant.workspaceId,
      departmentId,
      ...(query.search
        ? {
            OR: [
              {
                user: {
                  email: { startsWith: query.search.trim(), mode: Prisma.QueryMode.insensitive },
                },
              },
              {
                user: {
                  name: { startsWith: query.search.trim(), mode: Prisma.QueryMode.insensitive },
                },
              },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.workspaceMembership.findMany({
        where,
        select: departmentMemberSelect,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.workspaceMembership.count({ where }),
    ]);
    return { items, page: query.page, pageSize: query.pageSize, total };
  }

  private async assertDepartment(workspaceId: string, departmentId: string) {
    const department = await this.prisma.department.findFirst({
      where: { id: departmentId, workspaceId },
      select: { id: true },
    });
    if (!department) throw new NotFoundException('Department not found.');
  }

  private async managerMembership(workspaceId: string, userId: string) {
    const membership = await this.prisma.workspaceMembership.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
      select: { id: true, status: true },
    });
    if (!membership) throw new NotFoundException('Manager must belong to this workspace.');
    if (membership.status !== MembershipStatus.ACTIVE) {
      throw new BadRequestException('Manager membership is not active.');
    }
    return membership;
  }

  private async assertUniqueName(workspaceId: string, name: string, exceptId?: string) {
    const normalized = name.trim();
    const existing = await this.prisma.department.findFirst({
      where: {
        workspaceId,
        name: { equals: normalized, mode: Prisma.QueryMode.insensitive },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (existing) throw new ConflictException('Department name already exists in this workspace.');
  }
}

const departmentSelect = {
  id: true,
  workspaceId: true,
  name: true,
  description: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  managerMembership: {
    select: {
      user: { select: { id: true, email: true, name: true } },
    },
  },
  _count: { select: { members: true } },
} satisfies Prisma.DepartmentSelect;

const departmentMemberSelect = {
  id: true,
  userId: true,
  status: true,
  createdAt: true,
  user: { select: { id: true, email: true, name: true, status: true } },
  role: { select: { key: true, name: true } },
} satisfies Prisma.WorkspaceMembershipSelect;

type DepartmentRecord = Prisma.DepartmentGetPayload<{ select: typeof departmentSelect }>;

function serializeDepartment(department: DepartmentRecord) {
  return {
    id: department.id,
    workspaceId: department.workspaceId,
    name: department.name,
    description: department.description,
    status: department.status,
    manager: department.managerMembership?.user ?? null,
    memberCount: department._count.members,
    createdAt: department.createdAt,
    updatedAt: department.updatedAt,
  };
}

function auditActionsForDepartmentUpdate(dto: UpdateDepartmentDto) {
  const actions: string[] = [];
  if (dto.name !== undefined || dto.description !== undefined) actions.push('department.updated');
  if (dto.status) actions.push('department.status_changed');
  if ('managerUserId' in dto) actions.push('department.manager_changed');
  return actions.length > 0 ? actions : ['department.updated'];
}

function isUniqueConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
