import { BadRequestException, Injectable } from '@nestjs/common';
import { WebhookUrlValidatorService } from '../webhooks/webhook-url-validator.service';

const RESTRICTED_HEADERS = new Set([
  'accept',
  'authorization',
  'connection',
  'content-length',
  'content-type',
  'cookie',
  'host',
  'proxy-authorization',
  'transfer-encoding',
]);

@Injectable()
export class IntegrationGenericRestSecurityService {
  constructor(private readonly urls: WebhookUrlValidatorService) {}

  async validateBaseUrl(value: unknown) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException('INTEGRATION_GENERIC_BASE_URL_REQUIRED');
    }
    const safe = await this.urls.assertSafeUrl(value.trim());
    const url = new URL(safe);
    url.username = '';
    url.password = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  }

  validateRelativePath(value: unknown) {
    const path = typeof value === 'string' && value.trim() ? value.trim() : '/';
    if (path.length > 500) throw new BadRequestException('INTEGRATION_GENERIC_PATH_INVALID');
    if (!path.startsWith('/') || path.startsWith('//')) {
      throw new BadRequestException('INTEGRATION_GENERIC_PATH_INVALID');
    }
    if (/[\u0000-\u001f\u007f]/.test(path)) {
      throw new BadRequestException('INTEGRATION_GENERIC_PATH_INVALID');
    }
    const decoded = decodeURIComponent(path);
    if (decoded.includes('..') || decoded.includes('\\')) {
      throw new BadRequestException('INTEGRATION_GENERIC_PATH_INVALID');
    }
    return path;
  }

  validateCredentialHeaderName(value: unknown) {
    const name = typeof value === 'string' && value.trim() ? value.trim() : 'X-API-Key';
    const normalized = name.toLowerCase();
    if (!/^[A-Za-z0-9-]{1,60}$/.test(name) || RESTRICTED_HEADERS.has(normalized)) {
      throw new BadRequestException('INTEGRATION_GENERIC_HEADER_RESTRICTED');
    }
    return name;
  }
}
