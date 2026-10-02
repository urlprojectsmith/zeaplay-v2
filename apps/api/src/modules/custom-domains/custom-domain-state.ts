import { ConflictException } from '@nestjs/common';
import { CustomDomainStatus } from '@prisma/client';

const allowedTransitions: Record<CustomDomainStatus, CustomDomainStatus[]> = {
  PENDING_VERIFICATION: ['DNS_VERIFIED', 'FAILED', 'REMOVING', 'SUSPENDED'],
  DNS_VERIFIED: ['ROUTING_PENDING', 'FAILED', 'REMOVING', 'SUSPENDED', 'PENDING_VERIFICATION'],
  ROUTING_PENDING: ['SSL_PENDING', 'FAILED', 'REMOVING', 'SUSPENDED'],
  SSL_PENDING: ['ACTIVE', 'FAILED', 'REMOVING', 'SUSPENDED'],
  ACTIVE: ['PENDING_VERIFICATION', 'SUSPENDED', 'REMOVING', 'FAILED'],
  FAILED: ['PENDING_VERIFICATION', 'DNS_VERIFIED', 'REMOVING', 'SUSPENDED'],
  SUSPENDED: ['PENDING_VERIFICATION', 'DNS_VERIFIED', 'REMOVING'],
  REMOVING: ['REMOVED'],
  REMOVED: [],
};

export function assertDomainTransition(from: CustomDomainStatus, to: CustomDomainStatus) {
  if (from === to) return;
  if (!allowedTransitions[from].includes(to)) {
    throw new ConflictException(`CUSTOM_DOMAIN_ILLEGAL_TRANSITION_${from}_TO_${to}`);
  }
}
