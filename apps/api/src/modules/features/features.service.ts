import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

@Injectable()
export class FeaturesService {
  constructor(private readonly prisma: PrismaService) {}

  async isEnabled(key: string, agencyId: string, workspaceId?: string | null) {
    const agencyRecord = await this.prisma.agency.findUnique({
      where: { id: agencyId },
      select: { superAgencyId: true },
    });
    if (!agencyRecord) return false;

    const feature = await this.prisma.featureDefinition.findUnique({
      where: { key },
      select: {
        enabledByDefault: true,
        entitlements: {
          where: {
            OR: [
              { superAgencyId: null, agencyId: null, workspaceId: null },
              { superAgencyId: agencyRecord.superAgencyId, agencyId: null, workspaceId: null },
              { agencyId, workspaceId: null },
              ...(workspaceId ? [{ workspaceId }] : []),
            ],
          },
          select: { superAgencyId: true, agencyId: true, workspaceId: true, enabled: true },
        },
      },
    });
    if (!feature) return false;
    const platform = feature.entitlements.find(
      (item) => !item.superAgencyId && !item.agencyId && !item.workspaceId,
    );
    const superAgency = feature.entitlements.find(
      (item) =>
        item.superAgencyId === agencyRecord.superAgencyId && !item.agencyId && !item.workspaceId,
    );
    const agency = feature.entitlements.find(
      (item) => item.agencyId === agencyId && !item.workspaceId,
    );
    const workspace = feature.entitlements.find((item) => item.workspaceId === workspaceId);
    const parentEnabled = platform?.enabled ?? feature.enabledByDefault;
    if (!parentEnabled) return false;
    if (superAgency?.enabled === false) return false;
    if (agency?.enabled === false) return false;
    if (workspace?.enabled === false) return false;
    return workspace?.enabled ?? agency?.enabled ?? superAgency?.enabled ?? parentEnabled;
  }
}
