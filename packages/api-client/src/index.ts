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
  getTenantContext?: () => TenantHeaders | null;
  credentials?: RequestCredentials;
}

export interface TenantHeaders {
  agencyId?: string | null;
  workspaceId?: string | null;
}

export const AGENCY_HEADER = 'x-agency-id';
export const WORKSPACE_HEADER = 'x-workspace-id';

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
    const tenant = this.options.getTenantContext?.();
    if (tenant?.agencyId && !headers.has(AGENCY_HEADER))
      headers.set(AGENCY_HEADER, tenant.agencyId);
    if (tenant?.workspaceId && !headers.has(WORKSPACE_HEADER)) {
      headers.set(WORKSPACE_HEADER, tenant.workspaceId);
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
