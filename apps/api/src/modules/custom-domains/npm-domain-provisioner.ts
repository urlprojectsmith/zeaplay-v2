import { Injectable } from '@nestjs/common';
import { validateEnvironment } from '@zea-play/config';
import type { CustomDomain } from '@prisma/client';
import type { DomainProvisioner, DomainProvisioningResult } from './domain-provisioner';

@Injectable()
export class NpmDomainProvisioner implements DomainProvisioner {
  private readonly env = validateEnvironment(process.env);

  async provisionProxyHost(domain: CustomDomain): Promise<DomainProvisioningResult> {
    if (this.env.CUSTOM_DOMAIN_PROVISIONING_MODE !== 'live') {
      return {
        npmProxyHostId: domain.npmProxyHostId ?? `dry-run-proxy:${domain.id}`,
        routingVerified: true,
      };
    }
    const token = await this.login();
    const result = await this.npmFetch<{ id?: number | string }>('/api/nginx/proxy-hosts', {
      method: 'POST',
      token,
      body: {
        domain_names: [domain.normalizedHostname],
        forward_scheme: this.env.NPM_UPSTREAM_SCHEME,
        forward_host: this.env.NPM_UPSTREAM_HOST,
        forward_port: this.env.NPM_UPSTREAM_PORT,
        access_list_id: 0,
        certificate_id: 0,
        ssl_forced: true,
        caching_enabled: false,
        block_exploits: true,
        advanced_config: '',
        meta: { zeaplayDomainId: domain.id },
      },
    });
    return {
      npmProxyHostId: String(result.id ?? domain.npmProxyHostId ?? ''),
      routingVerified: true,
    };
  }

  async requestTls(domain: CustomDomain): Promise<DomainProvisioningResult> {
    if (this.env.CUSTOM_DOMAIN_PROVISIONING_MODE !== 'live') {
      return {
        npmProxyHostId: domain.npmProxyHostId ?? `dry-run-proxy:${domain.id}`,
        npmCertificateId: domain.npmCertificateId ?? `dry-run-cert:${domain.id}`,
        sslActive: true,
      };
    }
    const token = await this.login();
    const result = await this.npmFetch<{ id?: number | string }>('/api/nginx/certificates', {
      method: 'POST',
      token,
      body: {
        provider: 'letsencrypt',
        domain_names: [domain.normalizedHostname],
        meta: {
          letsencrypt_email: this.env.NPM_LETS_ENCRYPT_EMAIL,
          letsencrypt_agree: true,
          zeaplayDomainId: domain.id,
        },
      },
    });
    return {
      npmCertificateId: String(result.id ?? domain.npmCertificateId ?? ''),
      sslActive: true,
    };
  }

  checkProvisioning(domain: CustomDomain): Promise<DomainProvisioningResult> {
    return Promise.resolve({
      npmProxyHostId: domain.npmProxyHostId,
      npmCertificateId: domain.npmCertificateId,
      routingVerified: Boolean(domain.npmProxyHostId),
      sslActive: Boolean(domain.npmCertificateId),
    });
  }

  async removeProxyHost(domain: CustomDomain): Promise<void> {
    if (this.env.CUSTOM_DOMAIN_PROVISIONING_MODE !== 'live' || !domain.npmProxyHostId) return;
    const token = await this.login();
    await this.npmFetch(`/api/nginx/proxy-hosts/${encodeURIComponent(domain.npmProxyHostId)}`, {
      method: 'DELETE',
      token,
    });
  }

  private async login() {
    if (!this.env.NPM_API_URL || !this.env.NPM_ADMIN_EMAIL || !this.env.NPM_ADMIN_PASSWORD) {
      throw new Error('NPM_CREDENTIALS_REQUIRED');
    }
    const result = await this.npmFetch<{ token?: string }>('/api/tokens', {
      method: 'POST',
      body: {
        identity: this.env.NPM_ADMIN_EMAIL,
        secret: this.env.NPM_ADMIN_PASSWORD,
      },
    });
    if (!result.token) throw new Error('NPM_TOKEN_MISSING');
    return result.token;
  }

  private async npmFetch<T>(
    path: string,
    input: { method: string; token?: string; body?: Record<string, unknown> },
  ): Promise<T> {
    const response = await fetch(new URL(path, this.env.NPM_API_URL).href, {
      method: input.method,
      headers: {
        'content-type': 'application/json',
        ...(input.token ? { authorization: `Bearer ${input.token}` } : {}),
      },
      body: input.body ? JSON.stringify(input.body) : undefined,
    });
    if (!response.ok) throw new Error(`NPM_REQUEST_FAILED_${response.status}`);
    if (response.status === 204) return {} as T;
    return (await response.json()) as T;
  }
}
