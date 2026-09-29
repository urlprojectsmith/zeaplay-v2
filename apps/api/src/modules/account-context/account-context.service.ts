import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AgencyStatus, Prisma, WorkspaceStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/auth/auth.types';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import type {
  AccountContextAgencyQueryDto,
  AccountContextListQueryDto,
  AccountContextSubaccountQueryDto,
  AccountContextTargetType,
  ReturnAccountContextDto,
  SwitchAccountContextDto,
} from './dto/account-context.dto';

interface RequestMeta {
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AccountContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  async listAgencies(user: AuthenticatedUser, query: AccountContextAgencyQueryDto) {
    await this.tenantContext.resolveSuperAgency(user.id, query.superAgencyId);
    const pagination = normalizePagination(query);
    const where: Prisma.AgencyWhereInput = {
      superAgencyId: query.superAgencyId,
      status: AgencyStatus.ACTIVE,
      ...agencySearchWhere(query.search),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.agency.findMany({
        where,
        select: accountAgencySelect,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: pagination.skip,
        take: pagination.pageSize,
      }),
      this.prisma.agency.count({ where }),
    ]);
    return paginated(items.map(serializeAgency), total, pagination);
  }

  async listSubaccounts(user: AuthenticatedUser, query: AccountContextSubaccountQueryDto) {
    await this.tenantContext.resolveAgency(user.id, query.agencyId);
    const pagination = normalizePagination(query);
    const where: Prisma.WorkspaceWhereInput = {
      agencyId: query.agencyId,
      status: WorkspaceStatus.ACTIVE,
      ...workspaceSearchWhere(query.search),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.workspace.findMany({
        where,
        select: accountWorkspaceSelect,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: pagination.skip,
        take: pagination.pageSize,
      }),
      this.prisma.workspace.count({ where }),
    ]);
    return paginated(items.map(serializeWorkspace), total, pagination);
  }

  async switchContext(user: AuthenticatedUser, dto: SwitchAccountContextDto, meta: RequestMeta) {
    const context = await this.resolveTarget(user.id, dto.targetType, dto.targetId, dto.agencyId);
    await this.audit.record({
      superAgencyId: context.superAgencyId,
      agencyId: context.agencyId,
      workspaceId: context.workspaceId,
      userId: user.id,
      action: 'account_context.switch',
      entityType: 'AccountContext',
      entityId: context.targetId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        sourceType: dto.sourceType ?? null,
        sourceId: dto.sourceId ?? null,
        targetType: dto.targetType,
        targetId: dto.targetId,
      },
    });
    return context;
  }

  validateContext(user: AuthenticatedUser, dto: SwitchAccountContextDto) {
    return this.resolveTarget(user.id, dto.targetType, dto.targetId, dto.agencyId);
  }

  async returnContext(user: AuthenticatedUser, dto: ReturnAccountContextDto, meta: RequestMeta) {
    const context = await this.resolveTarget(user.id, dto.targetType, dto.targetId);
    await this.audit.record({
      superAgencyId: context.superAgencyId,
      agencyId: context.agencyId,
      userId: user.id,
      action: 'account_context.return',
      entityType: 'AccountContext',
      entityId: context.targetId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: {
        sourceType: dto.sourceType ?? null,
        sourceId: dto.sourceId ?? null,
        targetType: dto.targetType,
        targetId: dto.targetId,
      },
    });
    return context;
  }

  private async resolveTarget(
    userId: string,
    targetType: AccountContextTargetType,
    targetId: string,
    agencyId?: string,
  ) {
    if (targetType === 'SUPER_AGENCY') {
      const tenant = await this.tenantContext.resolveSuperAgency(userId, targetId);
      const superAgency = await this.prisma.superAgency.findUnique({
        where: { id: targetId },
        select: accountSuperAgencySelect,
      });
      if (!superAgency) throw new NotFoundException('Super Agency not found.');
      return {
        targetType,
        targetId,
        selectedSuperAgencyId: tenant.superAgencyId,
        selectedAgencyId: null,
        selectedWorkspaceId: null,
        superAgencyId: tenant.superAgencyId,
        agencyId: null,
        workspaceId: null,
        superAgency: serializeSuperAgency(superAgency),
        agency: null,
        workspace: null,
        roleName: tenant.roleName,
        permissions: tenant.permissions,
      };
    }

    if (targetType === 'AGENCY') {
      const tenant = await this.tenantContext.resolveAgency(userId, targetId);
      const agency = await this.prisma.agency.findUnique({
        where: { id: targetId },
        select: accountAgencySelect,
      });
      if (!agency) throw new NotFoundException('Agency not found.');
      return {
        targetType,
        targetId,
        selectedSuperAgencyId: null,
        selectedAgencyId: tenant.agencyId,
        selectedWorkspaceId: null,
        superAgencyId: tenant.superAgencyId ?? null,
        agencyId: tenant.agencyId,
        workspaceId: null,
        superAgency: null,
        agency: serializeAgency(agency),
        workspace: null,
        roleName: tenant.roleName,
        permissions: tenant.permissions,
      };
    }

    const resolvedAgencyId = agencyId ?? (await this.findWorkspaceAgencyId(targetId));
    const tenant = await this.tenantContext.resolveWorkspace(userId, resolvedAgencyId, targetId);
    const workspace = await this.prisma.workspace.findFirst({
      where: { id: tenant.workspaceId, agencyId: tenant.agencyId },
      select: accountWorkspaceSelect,
    });
    if (!workspace) throw new NotFoundException('Subaccount not found.');
    const agency = await this.prisma.agency.findUnique({
      where: { id: tenant.agencyId },
      select: accountAgencySelect,
    });
    if (!agency) throw new NotFoundException('Agency not found.');
    return {
      targetType,
      targetId,
      selectedSuperAgencyId: null,
      selectedAgencyId: tenant.agencyId,
      selectedWorkspaceId: tenant.workspaceId,
      superAgencyId: tenant.superAgencyId ?? null,
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
      superAgency: null,
      agency: { ...serializeAgency(agency), workspaces: [serializeWorkspace(workspace)] },
      workspace: serializeWorkspace(workspace),
      roleName: tenant.roleName,
      permissions: tenant.permissions,
      accessSource: tenant.accessSource,
    };
  }

  private async findWorkspaceAgencyId(workspaceId: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { agencyId: true },
    });
    if (!workspace) throw new ForbiddenException('Workspace access denied.');
    return workspace.agencyId;
  }
}

const accountSuperAgencySelect = {
  id: true,
  name: true,
  slug: true,
  status: true,
} satisfies Prisma.SuperAgencySelect;

const accountAgencySelect = {
  id: true,
  superAgencyId: true,
  name: true,
  slug: true,
  status: true,
} satisfies Prisma.AgencySelect;

const accountWorkspaceSelect = {
  id: true,
  agencyId: true,
  name: true,
  slug: true,
  timezone: true,
  status: true,
} satisfies Prisma.WorkspaceSelect;

type AccountSuperAgencyRecord = Prisma.SuperAgencyGetPayload<{
  select: typeof accountSuperAgencySelect;
}>;
type AccountAgencyRecord = Prisma.AgencyGetPayload<{ select: typeof accountAgencySelect }>;
type AccountWorkspaceRecord = Prisma.WorkspaceGetPayload<{ select: typeof accountWorkspaceSelect }>;

function serializeSuperAgency(superAgency: AccountSuperAgencyRecord) {
  return superAgency;
}

function serializeAgency(agency: AccountAgencyRecord) {
  return {
    id: agency.id,
    superAgencyId: agency.superAgencyId,
    name: agency.name,
    slug: agency.slug,
    status: agency.status,
  };
}

function serializeWorkspace(workspace: AccountWorkspaceRecord) {
  return {
    id: workspace.id,
    agencyId: workspace.agencyId,
    name: workspace.name,
    slug: workspace.slug,
    timezone: workspace.timezone,
    status: workspace.status,
  };
}

function normalizePagination(query: AccountContextListQueryDto) {
  const page = Math.max(1, query.page);
  const pageSize = Math.min(Math.max(1, query.pageSize), 50);
  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
  };
}

function agencySearchWhere(search?: string): Pick<Prisma.AgencyWhereInput, 'OR'> {
  const term = search?.trim();
  if (!term) return {};
  return {
    OR: [
      { name: { startsWith: term, mode: 'insensitive' } },
      { slug: { startsWith: term.toLowerCase(), mode: 'insensitive' } },
    ],
  };
}

function workspaceSearchWhere(search?: string): Pick<Prisma.WorkspaceWhereInput, 'OR'> {
  const term = search?.trim();
  if (!term) return {};
  return {
    OR: [
      { name: { startsWith: term, mode: 'insensitive' } },
      { slug: { startsWith: term.toLowerCase(), mode: 'insensitive' } },
    ],
  };
}

function paginated<T>(items: T[], total: number, pagination: { page: number; pageSize: number }) {
  return {
    items,
    page: pagination.page,
    pageSize: pagination.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)),
  };
}
