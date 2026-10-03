import { Injectable } from '@nestjs/common';
import { parseCorsOrigins, validateEnvironment } from '@zea-play/config';
import { CustomDomainResolverService } from './custom-domain-resolver.service';

@Injectable()
export class CustomDomainCorsService {
  private readonly env = validateEnvironment(process.env);
  private readonly canonicalOrigins = new Set(parseCorsOrigins(this.env.CORS_ORIGINS));

  constructor(private readonly resolver: CustomDomainResolverService) {}

  async isAllowedOrigin(origin: string | undefined): Promise<boolean> {
    if (!origin) return true;
    if (this.canonicalOrigins.has(origin)) return true;
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      return false;
    }
    if (url.protocol !== 'https:') return false;
    if (url.port) return false;
    return Boolean(await this.resolver.resolveHost(url.hostname));
  }
}
