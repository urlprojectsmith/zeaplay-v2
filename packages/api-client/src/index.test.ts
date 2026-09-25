import { describe, expect, it } from 'vitest';
import { ApiClient, ApiClientError } from './index';

describe('ApiClientError', () => {
  it('exposes stable API error fields', () => {
    const error = new ApiClientError(400, {
      code: 'VALIDATION_ERROR',
      message: 'Invalid request.',
      requestId: 'req_1',
    });

    expect(error.status).toBe(400);
    expect(error.body.code).toBe('VALIDATION_ERROR');
  });
});

describe('ApiClient', () => {
  it('preserves API base paths for common request path forms', async () => {
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = ((input: URL | RequestInfo) => {
      if (input instanceof URL) calls.push(input.toString());
      else if (input instanceof Request) calls.push(input.url);
      else calls.push(input);
      return Promise.resolve(
        new Response(JSON.stringify({ data: { ok: true }, requestId: 'req_1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as typeof fetch;

    try {
      const client = new ApiClient({ baseUrl: 'http://localhost:4000/api/v1' });
      for (const path of [
        'auth/login',
        '/auth/login',
        'projects',
        '/projects',
        'assets',
        '/assets',
      ]) {
        await client.request(path, { method: 'POST' });
      }
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(calls).toEqual([
      'http://localhost:4000/api/v1/auth/login',
      'http://localhost:4000/api/v1/auth/login',
      'http://localhost:4000/api/v1/projects',
      'http://localhost:4000/api/v1/projects',
      'http://localhost:4000/api/v1/assets',
      'http://localhost:4000/api/v1/assets',
    ]);
  });

  it('can skip global tenant context for explicitly scoped requests', async () => {
    const originalFetch = globalThis.fetch;
    let requestHeaders = new Headers();
    globalThis.fetch = ((input: URL | RequestInfo, init?: RequestInit) => {
      requestHeaders = new Headers(init?.headers);
      return Promise.resolve(
        new Response(JSON.stringify({ data: { ok: true }, requestId: 'req_1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }) as typeof fetch;

    try {
      const client = new ApiClient({
        baseUrl: 'http://localhost:4000/api/v1',
        getTenantContext: () => ({ agencyId: 'agency-1', workspaceId: 'workspace-1' }),
      });
      await client.request('/super-agencies/super-1', {
        skipTenantContext: true,
        headers: { 'x-super-agency-id': 'super-1' },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requestHeaders.get('x-super-agency-id')).toBe('super-1');
    expect(requestHeaders.has('x-agency-id')).toBe(false);
    expect(requestHeaders.has('x-workspace-id')).toBe(false);
  });
});
