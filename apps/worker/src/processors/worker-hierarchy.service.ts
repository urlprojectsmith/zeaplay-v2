import { Injectable } from '@nestjs/common';
import {
  AgencyStatus,
  Prisma,
  SuperAgencyStatus,
  SuperAgencySubscriptionStatus,
  WorkspaceStatus,
} from '@prisma/client';
import { PrismaService } from '../infrastructure/database/prisma.service';

@Injectable()
export class WorkerHierarchyService {
  constructor(private readonly prisma: PrismaService) {}

  async effectiveWorkspaceStatus(
    workspaceId: string,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const hierarchy = await client.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        id: true,
        status: true,
        agencyId: true,
        agency: {
          select: {
            id: true,
            status: true,
            superAgencyId: true,
            superAgency: {
              select: {
                id: true,
                status: true,
                subscriptions: {
                  where: { isCurrent: true },
                  select: { status: true, graceEndsAt: true },
                  orderBy: { createdAt: 'desc' },
                  take: 1,
                },
              },
            },
          },
        },
      },
    });

    if (!hierarchy) {
      return blocked('TENANT_INACTIVE', 'Workspace is unavailable.');
    }
    if (hierarchy.status === WorkspaceStatus.SUSPENDED) {
      return blocked('TENANT_SUSPENDED', 'Workspace is suspended.');
    }
    if (hierarchy.status !== WorkspaceStatus.ACTIVE) {
      return blocked('TENANT_INACTIVE', 'Workspace is not active.');
    }
    if (hierarchy.agency.status === AgencyStatus.SUSPENDED) {
      return blocked('TENANT_SUSPENDED', 'Agency is suspended.');
    }
    if (hierarchy.agency.status !== AgencyStatus.ACTIVE) {
      return blocked('TENANT_INACTIVE', 'Agency is not active.');
    }
    if (hierarchy.agency.superAgency.status === SuperAgencyStatus.SUSPENDED) {
      return blocked('TENANT_SUSPENDED', 'Super Agency is suspended.');
    }
    if (hierarchy.agency.superAgency.status !== SuperAgencyStatus.ACTIVE) {
      return blocked('TENANT_INACTIVE', 'Super Agency is not active.');
    }
    const subscription = hierarchy.agency.superAgency.subscriptions[0];
    if (subscription && isCommerciallyRestricted(subscription.status, subscription.graceEndsAt)) {
      return blocked('ACCOUNT_RESTRICTED', 'Commercial account is restricted.');
    }

    return {
      operational: true as const,
      workspaceId: hierarchy.id,
      agencyId: hierarchy.agencyId,
      superAgencyId: hierarchy.agency.superAgencyId,
    };
  }
}

function blocked(
  code: 'TENANT_SUSPENDED' | 'TENANT_INACTIVE' | 'ACCOUNT_RESTRICTED',
  message: string,
) {
  return { operational: false as const, code, message };
}

function isCommerciallyRestricted(status: SuperAgencySubscriptionStatus, graceEndsAt: Date | null) {
  if (
    status === SuperAgencySubscriptionStatus.RESTRICTED ||
    status === SuperAgencySubscriptionStatus.SUSPENDED ||
    status === SuperAgencySubscriptionStatus.CANCELED ||
    status === SuperAgencySubscriptionStatus.EXPIRED
  ) {
    return true;
  }
  return (graceEndsAt?.getTime() ?? Number.POSITIVE_INFINITY) < Date.now();
}
