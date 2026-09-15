import type { StandardErrorBody, StandardResponse } from '@zea-play/types';

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: StandardErrorBody,
  ) {
    super(body.message);
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  getAccessToken?: () => Promise<string | null> | string | null;
  getCorrelationId?: () => string;
  credentials?: RequestCredentials;
}

export class ApiClient {
  constructor(private readonly options: ApiClientOptions) {}

  async request<T>(path: string, init: RequestInit = {}): Promise<StandardResponse<T>> {
    const headers = new Headers(init.headers);
    headers.set('content-type', headers.get('content-type') ?? 'application/json');
    headers.set('x-correlation-id', this.options.getCorrelationId?.() ?? crypto.randomUUID());

    const token = await this.options.getAccessToken?.();
    if (token) {
      headers.set('authorization', `Bearer ${token}`);
    }

    const response = await fetch(resolveApiUrl(path, this.options.baseUrl), {
      ...init,
      credentials: init.credentials ?? this.options.credentials,
      headers,
    });
    const body = (await response.json().catch(() => null)) as
      StandardResponse<T> | StandardErrorBody | null;

    if (!response.ok) {
      throw new ApiClientError(
        response.status,
        parseErrorBody(body, headers.get('x-correlation-id') ?? ''),
      );
    }

    return body as StandardResponse<T>;
  }
}

function resolveApiUrl(path: string, baseUrl: string): URL {
  if (/^https?:\/\//i.test(path)) {
    return new URL(path);
  }

  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  return new URL(normalizedPath, normalizedBase);
}

function parseErrorBody(body: unknown, requestId: string): StandardErrorBody {
  if (body && typeof body === 'object' && 'code' in body && 'message' in body) {
    return body as StandardErrorBody;
  }

  return {
    code: 'UNEXPECTED_RESPONSE',
    message: 'The API returned an unexpected response.',
    requestId,
  };
}
