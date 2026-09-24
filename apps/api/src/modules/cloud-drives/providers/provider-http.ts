import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { ServiceUnavailableException } from '@nestjs/common';

export type CloudProviderErrorKind =
  'AUTH' | 'NOT_FOUND' | 'PERMISSION' | 'RATE_LIMIT' | 'TRANSIENT' | 'INVALID_REQUEST' | 'UNKNOWN';

export class CloudProviderHttpError extends ServiceUnavailableException {
  constructor(
    public readonly kind: CloudProviderErrorKind,
    public readonly httpStatus: number,
  ) {
    super(providerErrorCode(kind));
  }
}

export async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = (await response.json().catch(() => null)) as T | { error?: unknown } | null;
  if (!response.ok) {
    throw new CloudProviderHttpError(classifyProviderStatus(response.status), response.status);
  }
  return body as T;
}

export async function fetchStream(url: string, init: RequestInit): Promise<Readable> {
  const response = await fetch(url, init);
  if (!response.ok || !response.body) {
    throw new CloudProviderHttpError(classifyProviderStatus(response.status), response.status);
  }
  return Readable.fromWeb(response.body as unknown as NodeReadableStream);
}

export function formBody(values: Record<string, string | undefined>) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) body.set(key, value);
  }
  return body;
}

export function authHeaders(accessToken: string, extra?: HeadersInit): HeadersInit {
  return { authorization: `Bearer ${accessToken}`, ...extra };
}

export function safeWebUrl(value: unknown) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function isProviderAuthError(error: unknown) {
  return error instanceof CloudProviderHttpError && error.kind === 'AUTH';
}

function classifyProviderStatus(status: number): CloudProviderErrorKind {
  if (status === 400) return 'INVALID_REQUEST';
  if (status === 401 || status === 403) return 'AUTH';
  if (status === 404) return 'NOT_FOUND';
  if (status === 408 || status === 409 || status === 425 || status === 429) return 'RATE_LIMIT';
  if (status >= 500) return 'TRANSIENT';
  return 'UNKNOWN';
}

function providerErrorCode(kind: CloudProviderErrorKind) {
  if (kind === 'AUTH') return 'CLOUD_CONNECTION_REAUTH_REQUIRED';
  if (kind === 'NOT_FOUND') return 'CLOUD_FILE_NOT_FOUND';
  if (kind === 'PERMISSION') return 'CLOUD_PROVIDER_PERMISSION_DENIED';
  if (kind === 'RATE_LIMIT') return 'CLOUD_PROVIDER_RATE_LIMITED';
  if (kind === 'TRANSIENT') return 'CLOUD_PROVIDER_TRANSIENT_ERROR';
  if (kind === 'INVALID_REQUEST') return 'CLOUD_PROVIDER_INVALID_REQUEST';
  return 'CLOUD_PROVIDER_ERROR';
}
