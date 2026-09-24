import { BadRequestException, Injectable } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import net from 'node:net';

export interface WebhookUrlValidationOptions {
  allowLocalHttp?: boolean;
}

@Injectable()
export class WebhookUrlValidatorService {
  async assertSafeUrl(input: string, options: WebhookUrlValidationOptions = {}) {
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      throw new BadRequestException('WEBHOOK_URL_INVALID');
    }
    if (url.username || url.password || url.hash)
      throw new BadRequestException('WEBHOOK_URL_INVALID');
    if (url.protocol !== 'https:') {
      if (!(options.allowLocalHttp && url.protocol === 'http:' && isLocalhostName(url.hostname))) {
        throw new BadRequestException('WEBHOOK_URL_HTTPS_REQUIRED');
      }
    }
    if (options.allowLocalHttp && url.protocol === 'http:' && isLocalhostName(url.hostname)) {
      return url.toString();
    }
    const addresses = await lookup(url.hostname, { all: true, verbatim: true });
    if (addresses.length === 0) throw new BadRequestException('WEBHOOK_URL_DNS_FAILED');
    if (addresses.some((address) => isBlockedAddress(address.address))) {
      throw new BadRequestException('WEBHOOK_URL_PRIVATE_ADDRESS');
    }
    return url.toString();
  }
}

function isLocalhostName(hostname: string) {
  return hostname === 'localhost' || hostname.endsWith('.localhost');
}

export function isBlockedAddress(address: string) {
  const normalized = normalizeIp(address);
  const family = net.isIP(normalized);
  if (family === 4) return isBlockedIpv4(normalized);
  if (family === 6) return isBlockedIpv6(normalized);
  return true;
}

function normalizeIp(address: string) {
  if (address.startsWith('::ffff:')) return address.slice('::ffff:'.length);
  return address;
}

function isBlockedIpv4(address: string) {
  const parts = address.split('.').map((part) => Number(part));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true;
  }
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isBlockedIpv6(address: string) {
  const lower = address.toLowerCase();
  return (
    lower === '::1' ||
    lower === '::' ||
    lower.startsWith('fc') ||
    lower.startsWith('fd') ||
    lower.startsWith('fe80') ||
    lower.startsWith('ff') ||
    lower.startsWith('2001:db8')
  );
}
