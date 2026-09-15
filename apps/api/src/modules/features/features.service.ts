import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

@Injectable()
export class FeaturesService {
  constructor(private readonly prisma: PrismaService) {}

  async isEnabled(key: string, agencyId: string, workspaceId?: string | null) {
    const feature = await this.prisma.featureDefinition.findUnique({
      where: { key },
      select: {
        enabledByDefault: true,
        entitlements: {
          where: {
            OR: [
              { agencyId: null, workspaceId: null },
              { agencyId, workspaceId: null },
              ...(workspaceId ? [{ workspaceId }] : []),
            ],
          },
          select: { agencyId: true, workspaceId: true, enabled: true },
        },
      },
    });
    if (!feature) return false;
    const platform = feature.entitlements.find((item) => !item.agencyId && !item.workspaceId);
    const agency = feature.entitlements.find(
      (item) => item.agencyId === agencyId && !item.workspaceId,
    );
    const workspace = feature.entitlements.find((item) => item.workspaceId === workspaceId);
    const parentEnabled = platform?.enabled ?? feature.enabledByDefault;
    if (!parentEnabled) return false;
    if (agency?.enabled === false) return false;
    if (workspace?.enabled === false) return false;
    return workspace?.enabled ?? agency?.enabled ?? parentEnabled;
  }
}
