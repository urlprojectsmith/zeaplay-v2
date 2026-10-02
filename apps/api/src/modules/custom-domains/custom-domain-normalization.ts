import { UnprocessableEntityException } from '@nestjs/common';
import { domainToASCII, domainToUnicode } from 'node:url';
import { isIP } from 'node:net';

const unsafeExactHosts = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata',
  'instance-data',
]);

const unsafeSuffixes = ['.localhost', '.localdomain', '.local', '.internal', '.invalid'];

export interface NormalizedHostname {
  normalized: string;
  display: string;
}

export function normalizeCustomHostname(input: string): NormalizedHostname {
  const raw = input.trim();
  if (!raw) throw new UnprocessableEntityException('CUSTOM_DOMAIN_HOST_REQUIRED');
  if (
    raw.includes('://') ||
    raw.includes('/') ||
    raw.includes('\\') ||
    raw.includes('?') ||
    raw.includes('#')
  ) {
    throw new UnprocessableEntityException('CUSTOM_DOMAIN_HOST_MUST_BE_HOSTNAME_ONLY');
  }
  if (raw.includes('@')) throw new UnprocessableEntityException('CUSTOM_DOMAIN_HOST_INVALID');
  if (raw.startsWith('[') || raw.endsWith(']')) {
    throw new UnprocessableEntityException('CUSTOM_DOMAIN_IP_LITERAL_DENIED');
  }
  if (raw.includes(':')) throw new UnprocessableEntityException('CUSTOM_DOMAIN_PORT_DENIED');

  const withoutTrailingDot = raw.replace(/\.+$/, '');
  const ascii = domainToASCII(withoutTrailingDot).toLowerCase();
  if (!ascii || ascii.length > 253) {
    throw new UnprocessableEntityException('CUSTOM_DOMAIN_HOST_INVALID');
  }
  assertSafeHostname(ascii);
  return { normalized: ascii, display: domainToUnicode(ascii) || ascii };
}

export function normalizeRequestHost(input: string | undefined | null): string | null {
  if (!input) return null;
  const first = input.split(',')[0]?.trim() ?? '';
  if (!first) return null;
  const host = stripRequestPort(first);
  try {
    return normalizeCustomHostname(host).normalized;
  } catch {
    return null;
  }
}

export function txtRecordName(normalizedHostname: string) {
  return `_zeaplay-verification.${normalizedHostname}`;
}

function stripRequestPort(value: string) {
  if (value.startsWith('[')) return value;
  const lastColon = value.lastIndexOf(':');
  if (lastColon > -1 && value.indexOf(':') === lastColon) {
    const maybePort = value.slice(lastColon + 1);
    if (/^\d{1,5}$/.test(maybePort)) return value.slice(0, lastColon);
  }
  return value;
}

function assertSafeHostname(hostname: string) {
  if (
    unsafeExactHosts.has(hostname) ||
    unsafeSuffixes.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw new UnprocessableEntityException('CUSTOM_DOMAIN_INTERNAL_HOST_DENIED');
  }
  if (isIP(hostname)) {
    throw new UnprocessableEntityException('CUSTOM_DOMAIN_IP_LITERAL_DENIED');
  }
  if (hostname.includes('..') || !hostname.includes('.')) {
    throw new UnprocessableEntityException('CUSTOM_DOMAIN_PUBLIC_HOST_REQUIRED');
  }
  const labels = hostname.split('.');
  if (labels.some((label) => !isValidLabel(label))) {
    throw new UnprocessableEntityException('CUSTOM_DOMAIN_HOST_INVALID');
  }
  const tld = labels.at(-1) ?? '';
  if (!/^[a-z][a-z0-9-]{1,62}$/.test(tld)) {
    throw new UnprocessableEntityException('CUSTOM_DOMAIN_TLD_INVALID');
  }
  if (isMetadataServiceHost(hostname)) {
    throw new UnprocessableEntityException('CUSTOM_DOMAIN_METADATA_HOST_DENIED');
  }
}

function isValidLabel(label: string) {
  return label.length > 0 && label.length <= 63 && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label);
}

function isMetadataServiceHost(hostname: string) {
  return (
    hostname === '169.254.169.254' ||
    hostname.endsWith('.metadata.google.internal') ||
    hostname.endsWith('.compute.internal')
  );
}
