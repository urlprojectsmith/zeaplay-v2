import { CustomDomainStatus } from '@prisma/client';
import type { Job } from 'bullmq';
import { CUSTOM_DOMAIN_PROVISION_JOB_TYPE } from '../queue/queue.constants';
import { CustomDomainProvisioningProcessor } from './custom-domain-provisioning.processor';

describe('CustomDomainProvisioningProcessor', () => {
  it('activates DNS-verified domains through an idempotent dry-run provisioning path', async () => {
    const prisma = mockPrisma({
      id: 'domain-1',
      status: CustomDomainStatus.DNS_VERIFIED,
      revision: 3,
      removedAt: null,
      npmProxyHostId: null,
      npmCertificateId: null,
    });
    const processor = new CustomDomainProvisioningProcessor(prisma as never);

    await processor.process(job({ domainId: 'domain-1', revision: 3, action: 'provision' }));

    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(prisma.customDomain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: CustomDomainStatus.ACTIVE }),
      }),
    );
  });

  it('skips stale jobs so removed domains cannot be reactivated', async () => {
    const prisma = mockPrisma({
      id: 'domain-1',
      status: CustomDomainStatus.REMOVED,
      revision: 4,
      removedAt: new Date('2026-10-01T00:00:00Z'),
    });
    const processor = new CustomDomainProvisioningProcessor(prisma as never);

    await processor.process(job({ domainId: 'domain-1', revision: 3, action: 'provision' }));

    expect(prisma.customDomain.update).not.toHaveBeenCalled();
  });
});

function job(data: unknown) {
  return { name: CUSTOM_DOMAIN_PROVISION_JOB_TYPE, data } as Job;
}

function mockPrisma(domain: Record<string, unknown>) {
  return {
    $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]),
    customDomain: {
      findUnique: jest.fn().mockResolvedValue(domain),
      update: jest.fn().mockImplementation(({ data }) => ({ ...domain, ...data })),
    },
  };
}
