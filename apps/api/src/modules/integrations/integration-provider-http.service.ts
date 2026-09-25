import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { validateEnvironment } from '@zea-play/config';
import { lookup } from 'node:dns/promises';
import https from 'node:https';
import { isBlockedAddress } from '../webhooks/webhook-url-validator.service';

export interface IntegrationHttpRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT';
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  bindToResolvedPublicAddress?: boolean;
}

export interface IntegrationHttpResponse {
  ok: boolean;
  status: number;
  headers: Headers;
  body: string;
  json: unknown;
}

@Injectable()
export class IntegrationProviderHttpService {
  private readonly env = validateEnvironment(process.env);

  async request(input: IntegrationHttpRequest): Promise<IntegrationHttpResponse> {
    if (input.bindToResolvedPublicAddress) return this.requestBoundToResolvedAddress(input);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.env.INTEGRATION_REQUEST_TIMEOUT_MS);
    timeout.unref?.();
    try {
      const response = await fetch(input.url, {
        method: input.method,
        redirect: 'error',
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          ...(input.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...input.headers,
        },
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
      });
      const body = await this.readBounded(response);
      return {
        ok: response.ok,
        status: response.status,
        headers: response.headers,
        body,
        json: parseJson(body),
      };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('INTEGRATION_PROVIDER_REQUEST_FAILED');
    } finally {
      clearTimeout(timeout);
    }
  }

  private async requestBoundToResolvedAddress(
    input: IntegrationHttpRequest,
  ): Promise<IntegrationHttpResponse> {
    const url = new URL(input.url);
    if (url.protocol !== 'https:') {
      throw new ServiceUnavailableException('INTEGRATION_PROVIDER_HTTPS_REQUIRED');
    }
    const addresses = await lookup(url.hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some((address) => isBlockedAddress(address.address))) {
      throw new ServiceUnavailableException('INTEGRATION_PROVIDER_PRIVATE_ADDRESS');
    }
    const selected = addresses[0];
    if (!selected) throw new ServiceUnavailableException('INTEGRATION_PROVIDER_DNS_FAILED');
    return new Promise<IntegrationHttpResponse>((resolve, reject) => {
      const body = input.body === undefined ? undefined : JSON.stringify(input.body);
      const request = https.request(
        url,
        {
          method: input.method,
          timeout: this.env.INTEGRATION_REQUEST_TIMEOUT_MS,
          servername: url.hostname,
          headers: {
            accept: 'application/json',
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
            ...input.headers,
          },
          lookup: (_hostname, _options, callback) => {
            callback(null, selected.address, selected.family);
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          let received = 0;
          const maxBytes = this.env.INTEGRATION_PROVIDER_RESPONSE_MAX_BYTES;
          const contentLength = Number(response.headers['content-length'] ?? '0');
          if (contentLength > maxBytes) {
            response.destroy();
            reject(new ServiceUnavailableException('INTEGRATION_PROVIDER_RESPONSE_TOO_LARGE'));
            return;
          }
          response.on('data', (chunk: Buffer) => {
            received += chunk.byteLength;
            if (received > maxBytes) {
              response.destroy();
              reject(new ServiceUnavailableException('INTEGRATION_PROVIDER_RESPONSE_TOO_LARGE'));
              return;
            }
            chunks.push(chunk);
          });
          response.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            resolve({
              ok: Boolean(
                response.statusCode && response.statusCode >= 200 && response.statusCode < 300,
              ),
              status: response.statusCode ?? 0,
              headers: new Headers(
                Object.entries(response.headers).flatMap(([key, value]) =>
                  Array.isArray(value)
                    ? value.map((item) => [key, item] as [string, string])
                    : value
                      ? [[key, value] as [string, string]]
                      : [],
                ),
              ),
              body: text,
              json: parseJson(text),
            });
          });
        },
      );
      request.on('timeout', () => request.destroy(new Error('INTEGRATION_PROVIDER_TIMEOUT')));
      request.on('error', () =>
        reject(new ServiceUnavailableException('INTEGRATION_PROVIDER_REQUEST_FAILED')),
      );
      if (body !== undefined) request.write(body);
      request.end();
    });
  }

  private async readBounded(response: Response) {
    const maxBytes = this.env.INTEGRATION_PROVIDER_RESPONSE_MAX_BYTES;
    const contentLength = Number(response.headers.get('content-length') ?? '0');
    if (contentLength > maxBytes) {
      throw new ServiceUnavailableException('INTEGRATION_PROVIDER_RESPONSE_TOO_LARGE');
    }
    if (!response.body) return '';
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        received += value.byteLength;
        if (received > maxBytes) {
          await reader.cancel();
          throw new ServiceUnavailableException('INTEGRATION_PROVIDER_RESPONSE_TOO_LARGE');
        }
        chunks.push(value);
      }
    }
    return Buffer.concat(chunks).toString('utf8');
  }
}

function parseJson(body: string) {
  if (!body) return null;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}
