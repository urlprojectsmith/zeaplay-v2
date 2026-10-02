import type { CustomDomain } from '@prisma/client';

export interface DomainProvisioningResult {
  npmProxyHostId?: string | null;
  npmCertificateId?: string | null;
  routingVerified?: boolean;
  sslActive?: boolean;
}

export interface DomainProvisioner {
  provisionProxyHost(domain: CustomDomain): Promise<DomainProvisioningResult>;
  requestTls(domain: CustomDomain): Promise<DomainProvisioningResult>;
  checkProvisioning(domain: CustomDomain): Promise<DomainProvisioningResult>;
  removeProxyHost(domain: CustomDomain): Promise<void>;
}

export const DOMAIN_PROVISIONER = Symbol('DOMAIN_PROVISIONER');
