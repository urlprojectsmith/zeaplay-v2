import { Module } from '@nestjs/common';
import { CustomDomainsController } from './custom-domains.controller';
import { CustomDomainsService } from './custom-domains.service';
import { CustomDomainDnsService } from './custom-domain-dns.service';
import { CustomDomainRateLimitService } from './custom-domain-rate-limit.service';
import { CustomDomainResolverService } from './custom-domain-resolver.service';
import { CustomDomainCorsService } from './custom-domain-cors.service';
import { DOMAIN_PROVISIONER } from './domain-provisioner';
import { NpmDomainProvisioner } from './npm-domain-provisioner';

@Module({
  controllers: [CustomDomainsController],
  providers: [
    CustomDomainsService,
    CustomDomainDnsService,
    CustomDomainRateLimitService,
    CustomDomainResolverService,
    CustomDomainCorsService,
    NpmDomainProvisioner,
    { provide: DOMAIN_PROVISIONER, useExisting: NpmDomainProvisioner },
  ],
  exports: [
    CustomDomainsService,
    CustomDomainResolverService,
    CustomDomainCorsService,
    DOMAIN_PROVISIONER,
  ],
})
export class CustomDomainsModule {}
