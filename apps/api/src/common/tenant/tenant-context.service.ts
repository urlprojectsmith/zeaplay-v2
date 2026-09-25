import { ForbiddenException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import {
  AgencyStatus,
  MembershipStatus,
  RoleScope,
  SuperAgencyStatus,
  UserStatus,
  WorkspaceStatus,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type {
  AgencyTenantContext,
  SuperAgencyTenantContext,
  WorkspaceTenantContext,
} from '../auth/auth.types';
import { AGENCY_ADMIN_ROLES } from '../authorization/permissions';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class TenantContextService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveSuperAgency(
    userId: string,
    superAgencyId: string,
  ): Promise<SuperAgencyTenantContext> {
    if (!uuidPattern.test(superAgencyId)) {
      throw new UnprocessableEntityException('Invalid Super Agency id.');
    }

    const membership = await this.prisma.superAgencyMembership.findUnique({
      where: { userId_superAgencyId: { userId, superAgencyId } },
      select: {
        id: true,
        status: true,
        user: { select: { status: true } },
        superAgency: { select: { status: true } },
        role: {
          select: {
            id: true,
            key: true,
            scope: true,
            isActive: true,
            rolePermissions: { select: { permission: { select: { key: true } } } },
          },
        },
      },
    });

    if (!membership) throw new ForbiddenException('Super Agency access denied.');
    assertActiveUser(membership.user.status);
    assertActiveSuperAgency(membership.superAgency.status);
    assertActiveMembership(membership.status);
    if (membership.role.scope !== RoleScope.SUPER_AGENCY || !membership.role.isActive) {
      throw new ForbiddenException('Invalid Super Agency role.');
    }

    return {
      userId,
      superAgencyId,
      superAgencyMembershipId: membership.id,
      roleId: membership.role.id,
      roleName: membership.role.key,
      permissions: permissionsForRole(membership.role.key, membership.role.rolePermissions),
      status: membership.status,
    };
  }

  async resolveAgency(userId: string, agencyId: string): Promise<AgencyTenantContext> {
    if (!uuidPattern.test(agencyId)) {
      throw new UnprocessableEntityException('Invalid agency id.');
    }

    const membership = await this.prisma.agencyMembership.findUnique({
      where: { userId_agencyId: { userId, agencyId } },
      select: {
        id: true,
        status: true,
        user: { select: { status: true } },
        agency: {
          select: {
            status: true,
            superAgencyId: true,
            superAgency: { select: { status: true } },
          },
        },
        role: {
          select: {
            id: true,
            key: true,
            name: true,
            scope: true,
            rolePermissions: { select: { permission: { select: { key: true } } } },
          },
        },
      },
    });

    if (!membership) throw new ForbiddenException('Agency access denied.');
    assertActiveUser(membership.user.status);
    assertActiveSuperAgency(membership.agency.superAgency.status);
    if (membership.agency.status !== AgencyStatus.ACTIVE)
      throw new ForbiddenException('Agency is not active.');
    assertActiveMembership(membership.status);
    if (membership.role.scope !== RoleScope.AGENCY)
      throw new ForbiddenException('Invalid agency role.');

    return {
      userId,
      superAgencyId: membership.agency.superAgencyId,
      agencyId,
      agencyMembershipId: membership.id,
      roleId: membership.role.id,
      roleName: membership.role.key,
      permissions: permissionsForRole(membership.role.key, membership.role.rolePermissions),
    };
  }

  async resolveWorkspace(
    userId: string,
    agencyId: string,
    workspaceId: string,
  ): Promise<WorkspaceTenantContext> {
    if (!uuidPattern.test(agencyId)) throw new UnprocessableEntityException('Invalid agency id.');
    if (!uuidPattern.test(workspaceId))
      throw new UnprocessableEntityException('Invalid workspace id.');

    const workspace = await this.prisma.workspace.findFirst({
      where: { id: workspaceId, agencyId },
      select: {
        status: true,
        agency: {
          select: {
            status: true,
            superAgencyId: true,
            superAgency: { select: { status: true } },
          },
        },
      },
    });
    if (!workspace) throw new ForbiddenException('Workspace access denied.');
    assertActiveSuperAgency(workspace.agency.superAgency.status);
    if (workspace.agency.status !== AgencyStatus.ACTIVE)
      throw new ForbiddenException('Agency is not active.');
    if (workspace.status !== WorkspaceStatus.ACTIVE)
      throw new ForbiddenException('Workspace is not active.');

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true },
    });
    if (!user) throw new ForbiddenException('Workspace access denied.');
    assertActiveUser(user.status);

    const agencyMembership = await this.prisma.agencyMembership.findUnique({
      where: { userId_agencyId: { userId, agencyId } },
      select: {
        id: true,
        status: true,
        role: {
          select: {
            id: true,
            key: true,
            scope: true,
            rolePermissions: { select: { permission: { select: { key: true } } } },
          },
        },
      },
    });
    if (!agencyMembership) throw new ForbiddenException('Workspace access denied.');
    assertActiveMembership(agencyMembership.status);
    if (agencyMembership.role.scope !== RoleScope.AGENCY) {
      throw new ForbiddenException('Invalid agency role.');
    }

    const workspaceMembership = await this.prisma.workspaceMembership.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
      select: {
        id: true,
        status: true,
        role: {
          select: {
            id: true,
            key: true,
            scope: true,
            rolePermissions: { select: { permission: { select: { key: true } } } },
          },
        },
      },
    });
    if (workspaceMembership) {
      assertActiveMembership(workspaceMembership.status);
      if (workspaceMembership.role.scope !== RoleScope.WORKSPACE) {
        throw new ForbiddenException('Invalid workspace role.');
      }
      return {
        userId,
        superAgencyId: workspace.agency.superAgencyId,
        agencyId,
        workspaceId,
        workspaceMembershipId: workspaceMembership.id,
        agencyMembershipId: agencyMembership.id,
        roleId: workspaceMembership.role.id,
        roleName: workspaceMembership.role.key,
        permissions: permissionsForRole(
          workspaceMembership.role.key,
          workspaceMembership.role.rolePermissions,
        ),
        accessSource: 'WORKSPACE_MEMBERSHIP',
      };
    }

    if (!AGENCY_ADMIN_ROLES.includes(agencyMembership.role.key)) {
      throw new ForbiddenException('Workspace access denied.');
    }
    return {
      userId,
      superAgencyId: workspace.agency.superAgencyId,
      agencyId,
      workspaceId,
      workspaceMembershipId: null,
      agencyMembershipId: agencyMembership.id,
      roleId: agencyMembership.role.id,
      roleName: agencyMembership.role.key,
      permissions: permissionsForRole(
        agencyMembership.role.key,
        agencyMembership.role.rolePermissions,
      ),
      accessSource: 'AGENCY_ADMINISTRATION',
    };
  }
}

function permissionsForRole(_roleKey: string, permissions: { permission: { key: string } }[]) {
  return permissions.map((item) => item.permission.key);
}

function assertActiveUser(status: UserStatus) {
  if (status !== UserStatus.ACTIVE) throw new ForbiddenException('User is not active.');
}

function assertActiveSuperAgency(status: SuperAgencyStatus) {
  if (status !== SuperAgencyStatus.ACTIVE)
    throw new ForbiddenException('Super Agency is not active.');
}

function assertActiveMembership(status: MembershipStatus) {
  if (status !== MembershipStatus.ACTIVE) throw new ForbiddenException('Membership is not active.');
}
