import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { CustomDomainStatus, Prisma } from '@prisma/client';
import type { Job } from 'bullmq';
import { PrismaService } from '../infrastructure/database/prisma.service';
import {
  CUSTOM_DOMAIN_PROVISIONING_QUEUE,
  CUSTOM_DOMAIN_PROVISION_JOB_TYPE,
} from '../queue/queue.constants';

interface CustomDomainProvisionPayload {
  domainId: string;
  revision: number;
  action: 'provision' | 'remove' | 'reconcile';
}

@Injectable()
@Processor(CUSTOM_DOMAIN_PROVISIONING_QUEUE)
export class CustomDomainProvisioningProcessor extends WorkerHost {
  private readonly logger = new Logger(CustomDomainProvisioningProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<CustomDomainProvisionPayload>) {
    if (job.name !== CUSTOM_DOMAIN_PROVISION_JOB_TYPE) return;
    const payload = this.validate(job.data);
    const result = await this.withDomainLock(payload.domainId, () =>
      payload.action === 'remove' ? this.remove(payload) : this.provision(payload),
    );
    this.logger.log({
      ...result,
      domainId: payload.domainId,
      message: 'Custom-domain job completed',
    });
  }

  private async provision(payload: CustomDomainProvisionPayload): Promise<Record<string, unknown>> {
    const domain = await this.prisma.customDomain.findUnique({ where: { id: payload.domainId } });
    if (!domain || domain.revision !== payload.revision || domain.removedAt) {
      return { skippedStale: true };
    }
    if (domain.status !== CustomDomainStatus.DNS_VERIFIED) return { skippedState: domain.status };

    const now = new Date();
    await this.prisma.customDomain.update({
      where: { id: domain.id },
      data: {
        status: CustomDomainStatus.ROUTING_PENDING,
        provisioningAttempt: { increment: 1 },
        revision: { increment: 1 },
      },
    });
    const current = await this.prisma.customDomain.update({
      where: { id: domain.id },
      data: {
        status: CustomDomainStatus.SSL_PENDING,
        npmProxyHostId: domain.npmProxyHostId ?? `dry-run-proxy:${domain.id}`,
        routingVerifiedAt: now,
        sslRequestedAt: now,
        revision: { increment: 1 },
      },
    });
    await this.prisma.customDomain.update({
      where: { id: domain.id },
      data: {
        status: CustomDomainStatus.ACTIVE,
        npmCertificateId: current.npmCertificateId ?? `dry-run-cert:${domain.id}`,
        sslActiveAt: now,
        failureCode: null,
        failureMessageSafe: null,
        consecutiveFailureCount: 0,
        reconciliationDueAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        revision: { increment: 1 },
      },
    });
    return { activated: true };
  }

  private async remove(payload: CustomDomainProvisionPayload): Promise<Record<string, unknown>> {
    const domain = await this.prisma.customDomain.findUnique({ where: { id: payload.domainId } });
    if (!domain || domain.revision !== payload.revision) return { skippedStale: true };
    if (domain.status !== CustomDomainStatus.REMOVING) return { skippedState: domain.status };
    await this.prisma.customDomain.update({
      where: { id: domain.id },
      data: {
        status: CustomDomainStatus.REMOVED,
        npmProxyHostId: null,
        npmCertificateId: null,
        removedAt: domain.removedAt ?? new Date(),
        revision: { increment: 1 },
      },
    });
    return { removed: true };
  }

  private async withDomainLock(
    domainId: string,
    work: () => Promise<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    const key = `custom-domain:${domainId}`;
    const claimed = await this.prisma.$queryRaw<Array<{ locked: boolean }>>(Prisma.sql`
      SELECT pg_try_advisory_lock(hashtext(${key})) AS locked
    `);
    if (!claimed[0]?.locked) return { skippedLock: true };
    try {
      return await work();
    } finally {
      await this.prisma.$queryRaw(Prisma.sql`SELECT pg_advisory_unlock(hashtext(${key}))`);
    }
  }

  private validate(payload: CustomDomainProvisionPayload) {
    if (!payload || typeof payload !== 'object') throw new Error('CUSTOM_DOMAIN_JOB_INVALID');
    if (!payload.domainId || !payload.revision || !payload.action) {
      throw new Error('CUSTOM_DOMAIN_JOB_INVALID');
    }
    return payload;
  }
}
