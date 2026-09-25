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
  'proxy-authenticate',
  'set-cookie',
  'transfer-encoding',
]);

const MAX_QUERY_PARAMS = 25;
const MAX_QUERY_KEY_LENGTH = 80;
const MAX_QUERY_VALUE_LENGTH = 500;
const MAX_BODY_BYTES = 262_144;

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
    if (hasControlChar(path)) {
      throw new BadRequestException('INTEGRATION_GENERIC_PATH_INVALID');
    }
    const decoded = decodeRepeated(path);
    if (decoded.includes('..') || decoded.includes('\\') || /https?:\/\//i.test(decoded)) {
      throw new BadRequestException('INTEGRATION_GENERIC_PATH_INVALID');
    }
    return path;
  }

  buildUrl(baseUrl: string, value: unknown, query: unknown) {
    const path = this.validateRelativePath(value);
    const base = new URL(baseUrl);
    const url = new URL(path, base);
    if (url.origin !== base.origin)
      throw new BadRequestException('INTEGRATION_GENERIC_ORIGIN_CHANGED');
    const params = this.validateQuery(query);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url.toString();
  }

  validateQuery(value: unknown) {
    if (value === undefined || value === null) return {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('INTEGRATION_GENERIC_QUERY_INVALID');
    }
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > MAX_QUERY_PARAMS) {
      throw new BadRequestException('INTEGRATION_GENERIC_QUERY_INVALID');
    }
    const output: Record<string, string> = {};
    for (const [key, raw] of entries) {
      if (key.length < 1 || key.length > MAX_QUERY_KEY_LENGTH || hasControlChar(key)) {
        throw new BadRequestException('INTEGRATION_GENERIC_QUERY_INVALID');
      }
      if (!isQueryPrimitive(raw))
        throw new BadRequestException('INTEGRATION_GENERIC_QUERY_INVALID');
      const value = raw === undefined || raw === null ? '' : String(raw);
      if (value.length > MAX_QUERY_VALUE_LENGTH || hasControlChar(value)) {
        throw new BadRequestException('INTEGRATION_GENERIC_QUERY_INVALID');
      }
      output[key] = value;
    }
    return output;
  }

  validateJsonBody(value: unknown) {
    const body = value ?? {};
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('INTEGRATION_GENERIC_BODY_INVALID');
    }
    const encoded = Buffer.byteLength(JSON.stringify(body), 'utf8');
    if (encoded > MAX_BODY_BYTES)
      throw new BadRequestException('INTEGRATION_GENERIC_BODY_TOO_LARGE');
    return body as Record<string, unknown>;
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

function decodeRepeated(value: string) {
  let current = value;
  for (let index = 0; index < 3; index += 1) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      throw new BadRequestException('INTEGRATION_GENERIC_PATH_INVALID');
    }
    if (decoded === current) return decoded;
    current = decoded;
  }
  return current;
}

function hasControlChar(value: string) {
  return [...value].some((char) => {
    const code = char.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

function isQueryPrimitive(value: unknown) {
  return (
    value === undefined ||
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}
