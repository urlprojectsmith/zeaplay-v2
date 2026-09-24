import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { validateEnvironment } from '@zea-play/config';

export interface IntegrationHttpRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT';
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
}

@Injectable()
export class IntegrationProviderHttpService {
  private readonly env = validateEnvironment(process.env);

  async request(input: IntegrationHttpRequest) {
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
