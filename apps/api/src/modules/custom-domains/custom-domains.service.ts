import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { CustomDomainScopeType, CustomDomainStatus, Prisma } from '@prisma/client';
import { validateEnvironment } from '@zea-play/config';
import type { Queue } from 'bullmq';
import type {
  AgencyTenantContext,
  AuthenticatedUser,
  SuperAgencyTenantContext,
  WorkspaceTenantContext,
} from '../../common/auth/auth.types';
import {
  CUSTOM_DOMAIN_PROVISIONING_QUEUE,
  CUSTOM_DOMAIN_PROVISION_JOB_TYPE,
} from '../../infrastructure/queue/queue.constants';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CustomDomainDnsService } from './custom-domain-dns.service';
import { normalizeCustomHostname, txtRecordName } from './custom-domain-normalization';
import { CustomDomainRateLimitService } from './custom-domain-rate-limit.service';
import { CustomDomainResolverService } from './custom-domain-resolver.service';
import { assertDomainTransition } from './custom-domain-state';
import {
  createVerificationToken,
  formatTxtRecordValue,
  hashVerificationToken,
} from './custom-domain-secrets';
import type { CreateCustomDomainDto, CustomDomainRevisionDto } from './dto/custom-domain.dto';

interface DomainScope {
  type: CustomDomainScopeType;
  id: string;
  superAgencyId: string;
  agencyId?: string;
  workspaceId?: string;
}

@Injectable()
export class CustomDomainsService {
  private readonly env = validateEnvironment(process.env);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly dns: CustomDomainDnsService,
    private readonly rateLimit: CustomDomainRateLimitService,
    private readonly resolver: CustomDomainResolverService,
    @InjectQueue(CUSTOM_DOMAIN_PROVISIONING_QUEUE) private readonly queue: Queue,
  ) {}

  superAgencyScope(tenant: SuperAgencyTenantContext): DomainScope {
    return {
      type: CustomDomainScopeType.SUPER_AGENCY,
      id: tenant.superAgencyId,
      superAgencyId: tenant.superAgencyId,
    };
  }

  agencyScope(tenant: AgencyTenantContext): DomainScope {
    if (!tenant.superAgencyId) throw new ForbiddenException('CUSTOM_DOMAIN_SUPER_AGENCY_REQUIRED');
    return {
      type: CustomDomainScopeType.AGENCY,
      id: tenant.agencyId,
      superAgencyId: tenant.superAgencyId,
      agencyId: tenant.agencyId,
    };
  }

  workspaceScope(tenant: WorkspaceTenantContext): DomainScope {
    if (!tenant.superAgencyId) throw new ForbiddenException('CUSTOM_DOMAIN_SUPER_AGENCY_REQUIRED');
    return {
      type: CustomDomainScopeType.WORKSPACE,
      id: tenant.workspaceId,
      superAgencyId: tenant.superAgencyId,
      agencyId: tenant.agencyId,
      workspaceId: tenant.workspaceId,
    };
  }

  async list(scope: DomainScope) {
    const rows = await this.prisma.customDomain.findMany({
      where: { scopeType: scope.type, scopeId: scope.id },
      orderBy: [{ removedAt: 'asc' }, { createdAt: 'desc' }],
    });
    return {
      items: rows.map((row) => this.serialize(row)),
      scopeType: scope.type,
      scopeId: scope.id,
    };
  }

  async create(
    scope: DomainScope,
    actor: AuthenticatedUser | undefined,
    dto: CreateCustomDomainDto,
  ) {
    if (!actor) throw new ForbiddenException('Authentication required.');
    const normalized = normalizeCustomHostname(dto.hostname);
    const token = createVerificationToken();
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + this.env.CUSTOM_DOMAIN_TOKEN_TTL_HOURS * 60 * 60 * 1000,
    );

    try {
      const row = await this.prisma.customDomain.create({
        data: {
          scopeType: scope.type,
          scopeId: scope.id,
          superAgencyId: scope.superAgencyId,
          agencyId: scope.agencyId,
          workspaceId: scope.workspaceId,
          hostname: dto.hostname.trim(),
          normalizedHostname: normalized.normalized,
          displayHostname: normalized.display,
          status: CustomDomainStatus.PENDING_VERIFICATION,
          verificationTokenHash: hashVerificationToken(token),
          verificationTokenCreatedAt: now,
          verificationExpiresAt: expiresAt,
          createdById: actor.id,
          updatedById: actor.id,
        },
      });
      await this.auditDomain(scope, actor.id, 'custom_domain.created', row.id, {
        status: row.status,
        normalizedHostname: row.normalizedHostname,
      });
      return this.serialize(row, token);
    } catch (error) {
      if (isPrismaUniqueError(error)) throw new ConflictException('CUSTOM_DOMAIN_ALREADY_IN_USE');
      throw error;
    }
  }

  async rotateToken(scope: DomainScope, actor: AuthenticatedUser | undefined, domainId: string) {
    if (!actor) throw new ForbiddenException('Authentication required.');
    await this.rateLimit.assertTokenAllowed(scopeKey(scope), actor.id);
    const existing = await this.findOwned(scope, domainId);
    if (existing.status === CustomDomainStatus.REMOVED || existing.removedAt) {
      throw new ConflictException('CUSTOM_DOMAIN_REMOVED');
    }
    const token = createVerificationToken();
    const now = new Date();
    assertDomainTransition(existing.status, CustomDomainStatus.PENDING_VERIFICATION);
    const updated = await this.prisma.customDomain.update({
      where: { id: existing.id },
      data: {
        status: CustomDomainStatus.PENDING_VERIFICATION,
        verificationTokenHash: hashVerificationToken(token),
        verificationTokenCreatedAt: now,
        verificationExpiresAt: new Date(
          now.getTime() + this.env.CUSTOM_DOMAIN_TOKEN_TTL_HOURS * 60 * 60 * 1000,
        ),
        verifiedAt: null,
        failureCode: null,
        failureMessageSafe: null,
        revision: { increment: 1 },
        updatedById: actor.id,
      },
    });
    this.resolver.invalidate(updated.normalizedHostname);
    await this.auditDomain(scope, actor.id, 'custom_domain.token_rotated', updated.id, {
      status: updated.status,
    });
    return this.serialize(updated, token);
  }

  async verify(scope: DomainScope, actor: AuthenticatedUser | undefined, domainId: string) {
    if (!actor) throw new ForbiddenException('Authentication required.');
    await this.rateLimit.assertVerifyAllowed(scopeKey(scope), actor.id);
    const existing = await this.findOwned(scope, domainId);
    if (existing.verificationExpiresAt <= new Date()) {
      const failed = await this.markFailure(
        existing.id,
        'VERIFICATION_TOKEN_EXPIRED',
        'Verification token expired.',
      );
      return this.serialize(failed);
    }
    const result = await this.dns.verifyTxt(
      existing.normalizedHostname,
      existing.verificationTokenHash,
    );
    if (!result.ok) {
      const failed = await this.markSafeFailure(
        existing.id,
        result.code ?? 'TXT_NOT_FOUND',
        result.message ?? 'TXT verification failed.',
      );
      return this.serialize(failed);
    }
    assertDomainTransition(existing.status, CustomDomainStatus.DNS_VERIFIED);
    const updated = await this.prisma.customDomain.update({
      where: { id: existing.id },
      data: {
        status: CustomDomainStatus.DNS_VERIFIED,
        verifiedAt: new Date(),
        lastDnsCheckedAt: new Date(),
        failureCode: null,
        failureMessageSafe: null,
        consecutiveFailureCount: 0,
        revision: { increment: 1 },
        updatedById: actor.id,
      },
    });
    await this.enqueueProvision(updated.id, updated.revision);
    await this.auditDomain(scope, actor.id, 'custom_domain.verified', updated.id, {
      status: updated.status,
    });
    return this.serialize(updated);
  }

  async inspectRouting(scope: DomainScope, domainId: string) {
    const existing = await this.findOwned(scope, domainId);
    const routing = await this.dns.inspectRouting(existing.normalizedHostname);
    const updated = await this.prisma.customDomain.update({
      where: { id: existing.id },
      data: {
        lastDnsCheckedAt: new Date(),
        failureCode: routing.directMatch || routing.cnameMatch ? null : 'ROUTING_NOT_CONFIRMED',
        failureMessageSafe:
          routing.directMatch || routing.cnameMatch
            ? null
            : 'Routing was not confirmed. Proxied DNS is not failed solely by public resolver IP.',
      },
    });
    return { ...this.serialize(updated), routing };
  }

  async remove(
    scope: DomainScope,
    actor: AuthenticatedUser | undefined,
    domainId: string,
    dto: CustomDomainRevisionDto,
  ) {
    if (!actor) throw new ForbiddenException('Authentication required.');
    const existing = await this.findOwned(scope, domainId);
    if (dto.expectedRevision !== undefined && dto.expectedRevision !== existing.revision) {
      throw new ConflictException('CUSTOM_DOMAIN_REVISION_CONFLICT');
    }
    assertDomainTransition(existing.status, CustomDomainStatus.REMOVING);
    const updated = await this.prisma.customDomain.update({
      where: { id: existing.id },
      data: {
        status: CustomDomainStatus.REMOVING,
        removedAt: new Date(),
        revision: { increment: 1 },
        updatedById: actor.id,
      },
    });
    this.resolver.invalidate(updated.normalizedHostname);
    await this.auditDomain(scope, actor.id, 'custom_domain.removing', updated.id, {
      status: updated.status,
    });
    await this.queue.add(
      CUSTOM_DOMAIN_PROVISION_JOB_TYPE,
      { domainId: updated.id, revision: updated.revision, action: 'remove' },
      { jobId: `custom-domain-remove:${updated.id}:${updated.revision}` },
    );
    return this.serialize(updated);
  }

  async resolveForHost(hostname: string) {
    return this.resolver.resolveHost(hostname);
  }

  private async markFailure(id: string, code: string, message: string) {
    return this.prisma.customDomain.update({
      where: { id },
      data: {
        status: CustomDomainStatus.FAILED,
        lastDnsCheckedAt: new Date(),
        failureCode: code,
        failureMessageSafe: message,
        consecutiveFailureCount: { increment: 1 },
        revision: { increment: 1 },
      },
    });
  }

  private async markSafeFailure(id: string, code: string, message: string) {
    return this.prisma.customDomain.update({
      where: { id },
      data: {
        lastDnsCheckedAt: new Date(),
        failureCode: code,
        failureMessageSafe: message,
        consecutiveFailureCount: { increment: 1 },
      },
    });
  }

  private async findOwned(scope: DomainScope, domainId: string) {
    const row = await this.prisma.customDomain.findFirst({
      where: { id: domainId, scopeType: scope.type, scopeId: scope.id },
    });
    if (!row) throw new NotFoundException('CUSTOM_DOMAIN_NOT_FOUND');
    return row;
  }

  private async enqueueProvision(domainId: string, revision: number) {
    await this.queue.add(
      CUSTOM_DOMAIN_PROVISION_JOB_TYPE,
      { domainId, revision, action: 'provision' },
      { jobId: `custom-domain-provision:${domainId}:${revision}` },
    );
  }

  private serialize(row: Prisma.CustomDomainGetPayload<object>, token?: string) {
    return {
      id: row.id,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      hostname: row.hostname,
      normalizedHostname: row.normalizedHostname,
      displayHostname: row.displayHostname,
      status: row.status,
      txtRecordName: txtRecordName(row.normalizedHostname),
      txtRecordValue: token ? formatTxtRecordValue(token) : undefined,
      verificationTokenReturnedOnce: Boolean(token),
      verificationTokenCreatedAt: row.verificationTokenCreatedAt,
      verificationExpiresAt: row.verificationExpiresAt,
      verifiedAt: row.verifiedAt,
      routingVerifiedAt: row.routingVerifiedAt,
      sslRequestedAt: row.sslRequestedAt,
      sslActiveAt: row.sslActiveAt,
      failureCode: row.failureCode,
      failureMessageSafe: row.failureMessageSafe,
      npmProxyHostId: row.npmProxyHostId,
      npmCertificateId: row.npmCertificateId,
      revision: row.revision,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      removedAt: row.removedAt,
    };
  }

  private async auditDomain(
    scope: DomainScope,
    userId: string,
    action: string,
    domainId: string,
    metadata: Prisma.InputJsonValue,
  ) {
    await this.audit.record({
      superAgencyId: scope.superAgencyId,
      agencyId: scope.agencyId,
      workspaceId: scope.workspaceId,
      userId,
      action,
      entityType: 'CustomDomain',
      entityId: domainId,
      metadata,
    });
  }
}

function scopeKey(scope: DomainScope) {
  return `${scope.type}:${scope.id}`;
}

function isPrismaUniqueError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
