import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

@Injectable()
export class TenantHierarchyService {
  constructor(private readonly prisma: PrismaService) {}

  async getSuperAgencyForAgency(agencyId: string) {
    const agency = await this.prisma.agency.findUnique({
      where: { id: agencyId },
      select: {
        id: true,
        superAgency: { select: { id: true, name: true, slug: true, status: true } },
      },
    });
    if (!agency) throw new NotFoundException('Agency not found.');
    return agency.superAgency;
  }

  async getAgencyForWorkspace(workspaceId: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        id: true,
        agency: { select: { id: true, name: true, slug: true, status: true, superAgencyId: true } },
      },
    });
    if (!workspace) throw new NotFoundException('Workspace not found.');
    return workspace.agency;
  }

  async getSuperAgencyForWorkspace(workspaceId: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        id: true,
        agency: {
          select: {
            superAgency: { select: { id: true, name: true, slug: true, status: true } },
          },
        },
      },
    });
    if (!workspace) throw new NotFoundException('Workspace not found.');
    return workspace.agency.superAgency;
  }

  async assertAgencyExistsWithSuperAgency(agencyId: string) {
    const agency = await this.prisma.agency.findUnique({
      where: { id: agencyId },
      select: { id: true, superAgencyId: true },
    });
    if (!agency) throw new NotFoundException('Agency not found.');
    return agency;
  }

  async assertSuperAgencyExists(superAgencyId: string) {
    const superAgency = await this.prisma.superAgency.findUnique({
      where: { id: superAgencyId },
      select: { id: true },
    });
    if (!superAgency) throw new NotFoundException('Super Agency not found.');
    return superAgency;
  }

  async assertAgencyBelongsToSuperAgency(agencyId: string, superAgencyId: string) {
    const agency = await this.prisma.agency.findFirst({
      where: { id: agencyId, superAgencyId },
      select: { id: true, superAgencyId: true },
    });
    if (!agency) throw new ForbiddenException('Agency does not belong to Super Agency.');
    return agency;
  }

  async assertWorkspaceBelongsToAgency(workspaceId: string, agencyId: string) {
    const workspace = await this.prisma.workspace.findFirst({
      where: { id: workspaceId, agencyId },
      select: { id: true, agencyId: true },
    });
    if (!workspace) throw new ForbiddenException('Workspace does not belong to Agency.');
    return workspace;
  }

  async assertWorkspaceBelongsToSuperAgency(workspaceId: string, superAgencyId: string) {
    const workspace = await this.prisma.workspace.findFirst({
      where: { id: workspaceId, agency: { superAgencyId } },
      select: { id: true, agencyId: true, agency: { select: { superAgencyId: true } } },
    });
    if (!workspace) throw new ForbiddenException('Workspace does not belong to Super Agency.');
    return workspace;
  }

  async listAgencyIdsForSuperAgency(superAgencyId: string) {
    const agencies = await this.prisma.agency.findMany({
      where: { superAgencyId },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    return agencies.map((agency) => agency.id);
  }

  async listWorkspaceIdsForAgency(agencyId: string) {
    const workspaces = await this.prisma.workspace.findMany({
      where: { agencyId },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    return workspaces.map((workspace) => workspace.id);
  }
}
