import { Injectable } from '@nestjs/common';
import {
  CustomDomainStatus,
  CustomDomainScopeType,
  SuperAgencyStatus,
  AgencyStatus,
  WorkspaceStatus,
} from '@prisma/client';
import { validateEnvironment } from '@zea-play/config';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { normalizeRequestHost } from './custom-domain-normalization';

export interface ResolvedCustomDomain {
  domainId: string;
  scopeType: CustomDomainScopeType;
  scopeId: string;
  status: CustomDomainStatus;
}

@Injectable()
export class CustomDomainResolverService {
  private readonly env = validateEnvironment(process.env);
  private readonly cache = new Map<
    string,
    { expiresAt: number; value: ResolvedCustomDomain | null }
  >();

  constructor(private readonly prisma: PrismaService) {}

  async resolveHost(host: string | undefined | null): Promise<ResolvedCustomDomain | null> {
    const normalized = normalizeRequestHost(host);
    if (!normalized) return null;
    if (this.isCanonicalHost(normalized)) return null;
    const cached = this.cache.get(normalized);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const row = await this.prisma.customDomain.findFirst({
      where: { normalizedHostname: normalized, removedAt: null, status: CustomDomainStatus.ACTIVE },
      select: {
        id: true,
        scopeType: true,
        scopeId: true,
        superAgencyId: true,
        agencyId: true,
        workspaceId: true,
        status: true,
        revision: true,
      },
    });
    const resolved =
      row && (await this.scopeIsAvailable(row))
        ? {
            domainId: row.id,
            scopeType: row.scopeType,
            scopeId: row.scopeId,
            status: row.status,
          }
        : null;
    const ttl = resolved
      ? this.env.CUSTOM_DOMAIN_RESOLVER_CACHE_SECONDS
      : this.env.CUSTOM_DOMAIN_NEGATIVE_CACHE_SECONDS;
    this.cache.set(normalized, { expiresAt: Date.now() + ttl * 1000, value: resolved });
    return resolved;
  }

  isCanonicalHost(host: string) {
    return csv(this.env.CANONICAL_HOSTS).some((entry) => normalizeRequestHost(entry) === host);
  }

  invalidate(hostname?: string) {
    if (!hostname) {
      this.cache.clear();
      return;
    }
    this.cache.delete(normalizeRequestHost(hostname) ?? hostname);
  }

  private async scopeIsAvailable(row: {
    scopeType: CustomDomainScopeType;
    superAgencyId: string | null;
    agencyId: string | null;
    workspaceId: string | null;
  }) {
    if (row.scopeType === CustomDomainScopeType.SUPER_AGENCY && row.superAgencyId) {
      const superAgency = await this.prisma.superAgency.findUnique({
        where: { id: row.superAgencyId },
        select: { status: true },
      });
      return superAgency?.status === SuperAgencyStatus.ACTIVE;
    }
    if (row.scopeType === CustomDomainScopeType.AGENCY && row.agencyId) {
      const agency = await this.prisma.agency.findUnique({
        where: { id: row.agencyId },
        select: { status: true, superAgency: { select: { status: true } } },
      });
      return (
        agency?.status === AgencyStatus.ACTIVE &&
        agency.superAgency.status === SuperAgencyStatus.ACTIVE
      );
    }
    if (row.scopeType === CustomDomainScopeType.WORKSPACE && row.workspaceId) {
      const workspace = await this.prisma.workspace.findUnique({
        where: { id: row.workspaceId },
        select: {
          status: true,
          agency: { select: { status: true, superAgency: { select: { status: true } } } },
        },
      });
      return (
        workspace?.status === WorkspaceStatus.ACTIVE &&
        workspace.agency.status === AgencyStatus.ACTIVE &&
        workspace.agency.superAgency.status === SuperAgencyStatus.ACTIVE
      );
    }
    return false;
  }
}

function csv(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
