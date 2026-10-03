import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { CustomDomainScopeType, CustomDomainStatus } from '@prisma/client';
import { CUSTOM_DOMAIN_PROVISION_JOB_TYPE } from '../../infrastructure/queue/queue.constants';
import { CustomDomainCorsService } from './custom-domain-cors.service';
import { CustomDomainDnsService } from './custom-domain-dns.service';
import { normalizeCustomHostname, normalizeRequestHost } from './custom-domain-normalization';
import { CustomDomainRateLimitService } from './custom-domain-rate-limit.service';
import { CustomDomainResolverService } from './custom-domain-resolver.service';
import {
  createVerificationToken,
  extractVerificationToken,
  formatTxtRecordValue,
  hashVerificationToken,
} from './custom-domain-secrets';
import { assertDomainTransition } from './custom-domain-state';
import { CustomDomainsService } from './custom-domains.service';
import { NpmDomainProvisioner } from './npm-domain-provisioner';

describe('Custom domains Phase 18.2 foundation', () => {
  beforeEach(() => {
    process.env.CANONICAL_HOSTS = 'localhost,app.zeaplay.test';
    process.env.CUSTOM_DOMAIN_PUBLIC_IPS = '203.0.113.10';
    process.env.CUSTOM_DOMAIN_APPROVED_CNAME_HOSTS = 'ingress.zeaplay.test';
    process.env.CUSTOM_DOMAIN_TOKEN_TTL_HOURS = '48';
    process.env.CUSTOM_DOMAIN_VERIFY_RATE_LIMIT_PER_MINUTE = '10';
    process.env.CUSTOM_DOMAIN_TOKEN_RATE_LIMIT_PER_HOUR = '5';
    process.env.CUSTOM_DOMAIN_RESOLVER_CACHE_SECONDS = '30';
    process.env.CUSTOM_DOMAIN_NEGATIVE_CACHE_SECONDS = '1';
    process.env.CUSTOM_DOMAIN_PROVISIONING_MODE = 'dry-run';
    process.env.NPM_UPSTREAM_SCHEME = 'http';
    process.env.NPM_UPSTREAM_HOST = '127.0.0.1';
    process.env.NPM_UPSTREAM_PORT = '7100';
  });

  it('normalizes hostnames with IDNA and rejects unsafe host input', () => {
    expect(normalizeCustomHostname('  Example.COM. ').normalized).toBe('example.com');
    expect(normalizeCustomHostname('bücher.example').normalized).toBe('xn--bcher-kva.example');
    expect(normalizeRequestHost('Example.COM:443')).toBe('example.com');

    for (const host of [
      'https://portal.example.com/login',
      'portal.example.com:8443',
      '127.0.0.1',
      '::1',
      'localhost',
      'internal.local',
      'singlelabel',
    ]) {
      expect(() => normalizeCustomHostname(host)).toThrow(UnprocessableEntityException);
    }
  });

  it('hashes verification tokens and formats TXT records without storing plaintext', () => {
    const token = createVerificationToken();
    const hash = hashVerificationToken(token);

    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(token);
    expect(extractVerificationToken(formatTxtRecordValue(token))).toBe(token);
  });

  it('rejects illegal client-side status jumps', () => {
    expect(() =>
      assertDomainTransition(CustomDomainStatus.PENDING_VERIFICATION, CustomDomainStatus.ACTIVE),
    ).toThrow(ConflictException);
    expect(() =>
      assertDomainTransition(
        CustomDomainStatus.PENDING_VERIFICATION,
        CustomDomainStatus.DNS_VERIFIED,
      ),
    ).not.toThrow();
  });

  it('creates pending domains with hash-only token storage and queues after DNS verification', async () => {
    const prisma = mockPrisma();
    const queue = { add: jest.fn() };
    const service = new CustomDomainsService(
      prisma as never,
      { record: jest.fn() } as never,
      { verifyTxt: jest.fn().mockResolvedValue({ ok: true }) } as unknown as CustomDomainDnsService,
      { assertVerifyAllowed: jest.fn(), assertTokenAllowed: jest.fn() } as never,
      { invalidate: jest.fn(), resolveHost: jest.fn() } as never,
      queue as never,
    );
    const scope = service.workspaceScope({
      userId: 'user-1',
      superAgencyId: 'super-1',
      agencyId: 'agency-1',
      workspaceId: 'workspace-1',
      workspaceMembershipId: 'member-1',
      agencyMembershipId: null,
      roleId: 'role-1',
      roleName: 'OWNER',
      permissions: ['custom_domains.manage'],
      accessSource: 'WORKSPACE_MEMBERSHIP',
    });

    const created = await service.create(
      scope,
      { id: 'user-1', email: 'owner@example.com' },
      {
        hostname: 'Portal.Example.com.',
      },
    );

    const createArg = prisma.customDomain.create.mock.calls[0][0].data;
    expect(createArg.normalizedHostname).toBe('portal.example.com');
    expect(createArg.verificationTokenHash).toHaveLength(64);
    expect(created.txtRecordValue).toContain('zea-verification=');
    expect(JSON.stringify(createArg)).not.toContain(created.txtRecordValue);

    const verified = await service.verify(
      scope,
      { id: 'user-1', email: 'owner@example.com' },
      created.id,
    );

    expect(verified.status).toBe(CustomDomainStatus.DNS_VERIFIED);
    expect(queue.add).toHaveBeenCalledWith(
      CUSTOM_DOMAIN_PROVISION_JOB_TYPE,
      expect.objectContaining({ domainId: created.id, action: 'provision' }),
      expect.objectContaining({ jobId: expect.stringContaining(created.id) }),
    );
  });

  it('resolves only active domains with active owner status and allows active-domain CORS', async () => {
    const prisma = {
      customDomain: {
        findFirst: jest.fn(({ where }) =>
          where.normalizedHostname === 'portal.example.com'
            ? {
                id: 'domain-1',
                scopeType: CustomDomainScopeType.WORKSPACE,
                scopeId: 'workspace-1',
                workspaceId: 'workspace-1',
                agencyId: 'agency-1',
                superAgencyId: 'super-1',
                status: CustomDomainStatus.ACTIVE,
                revision: 1,
              }
            : null,
        ),
      },
      workspace: {
        findUnique: jest.fn().mockResolvedValue({
          status: 'ACTIVE',
          agency: { status: 'ACTIVE', superAgency: { status: 'ACTIVE' } },
        }),
      },
    };
    const resolver = new CustomDomainResolverService(prisma as never);
    const cors = new CustomDomainCorsService(resolver);

    await expect(resolver.resolveHost('portal.example.com')).resolves.toMatchObject({
      domainId: 'domain-1',
      scopeType: CustomDomainScopeType.WORKSPACE,
      scopeId: 'workspace-1',
    });
    await expect(cors.isAllowedOrigin('https://portal.example.com')).resolves.toBe(true);
    await expect(cors.isAllowedOrigin('https://portal.example.com:4443')).resolves.toBe(false);
    await expect(cors.isAllowedOrigin('https://unknown.example.com')).resolves.toBe(false);
    expect(prisma.customDomain.findFirst).toHaveBeenCalledTimes(2);
  });

  it('uses the NPM adapter dry-run boundary without credentials or shell access', async () => {
    const provisioner = new NpmDomainProvisioner();
    await expect(
      provisioner.provisionProxyHost(
        customDomain({ id: 'domain-1', normalizedHostname: 'portal.example.com' }),
      ),
    ).resolves.toMatchObject({ npmProxyHostId: 'dry-run-proxy:domain-1', routingVerified: true });
  });

  it('rate limits with a non-production fallback when Redis is unavailable', async () => {
    const rateLimit = new CustomDomainRateLimitService({
      rateLimit: {
        multi: jest.fn(() => ({
          incr: () => ({ expire: () => ({ exec: () => Promise.reject(new Error('down')) }) }),
        })),
      },
    } as never);
    await expect(
      rateLimit.assertVerifyAllowed('WORKSPACE:workspace-1', 'user-1'),
    ).resolves.toBeUndefined();
  });
});

function customDomain(overrides: Record<string, unknown>) {
  const verificationTokenCreatedAt = new Date(Date.now() - 60_000);
  const verificationExpiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

  return {
    id: 'domain-1',
    scopeType: CustomDomainScopeType.WORKSPACE,
    scopeId: 'workspace-1',
    superAgencyId: 'super-1',
    agencyId: 'agency-1',
    workspaceId: 'workspace-1',
    hostname: 'portal.example.com',
    normalizedHostname: 'portal.example.com',
    displayHostname: 'portal.example.com',
    status: CustomDomainStatus.DNS_VERIFIED,
    verificationTokenHash: hashVerificationToken('token'),
    verificationTokenCreatedAt,
    verificationExpiresAt,
    verifiedAt: null,
    lastDnsCheckedAt: null,
    routingVerifiedAt: null,
    sslRequestedAt: null,
    sslActiveAt: null,
    failureCode: null,
    failureMessageSafe: null,
    consecutiveFailureCount: 0,
    npmProxyHostId: null,
    npmCertificateId: null,
    provisioningAttempt: 0,
    reconciliationDueAt: null,
    revision: 1,
    createdById: 'user-1',
    updatedById: 'user-1',
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    removedAt: null,
    ...overrides,
  };
}

function mockPrisma() {
  const created = customDomain({});
  return {
    customDomain: {
      create: jest.fn().mockImplementation(({ data }) => ({ ...created, ...data })),
      findFirst: jest.fn().mockResolvedValue(created),
      update: jest.fn().mockImplementation(({ data }) => ({ ...created, ...data, revision: 2 })),
    },
  };
}
