export const PWA_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? '0.1.0';
export const PWA_CACHE_PREFIX = 'zeaplay';
export const PWA_STATIC_CACHE = `${PWA_CACHE_PREFIX}-static-v19-1`;
export const PWA_SHELL_CACHE = `${PWA_CACHE_PREFIX}-shell-v19-1`;
export const PWA_OFFLINE_PATH = '/offline';
export const PWA_SERVICE_WORKER_PATH = '/sw.js';
export const PWA_MANIFEST_PATH = '/site.webmanifest';

const staticExtensions = new Set([
  'css',
  'js',
  'mjs',
  'png',
  'webp',
  'jpg',
  'jpeg',
  'ico',
  'woff',
  'woff2',
]);

const authPathPrefixes = [
  '/api/auth',
  '/auth/login',
  '/auth/logout',
  '/auth/refresh',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/verify-otp',
];

export interface CachePolicyRequest {
  url: string;
  method?: string;
  destination?: string;
  mode?: string;
  hasAuthorization?: boolean;
}

export function isApiLikePath(pathname: string) {
  return pathname === '/api' || pathname.startsWith('/api/') || pathname.startsWith('/api/v1/');
}

export function isAuthLikePath(pathname: string) {
  return authPathPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function isStaticAssetPath(pathname: string) {
  if (pathname.startsWith('/_next/static/')) return true;
  if (pathname.startsWith('/icons/')) return true;
  if (pathname === PWA_MANIFEST_PATH || pathname === PWA_SERVICE_WORKER_PATH) return true;
  const extension = pathname.split('.').pop()?.toLowerCase();
  return Boolean(extension && staticExtensions.has(extension));
}

export function shouldCacheRequest(
  request: CachePolicyRequest,
  origin = 'https://play.zeaplay.test',
) {
  const method = request.method ?? 'GET';
  if (method !== 'GET') return false;
  if (request.hasAuthorization) return false;
  const url = new URL(request.url, origin);
  if (url.origin !== origin) return false;
  if (isApiLikePath(url.pathname) || isAuthLikePath(url.pathname)) return false;
  return isStaticAssetPath(url.pathname);
}

export function shouldUseNavigationFallback(request: CachePolicyRequest) {
  return (request.method ?? 'GET') === 'GET' && request.mode === 'navigate';
}

export function tenantCacheNamespace(scopeType: string, scopeId: string) {
  const normalizedType = scopeType.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const normalizedId = scopeId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  return `${PWA_CACHE_PREFIX}-tenant-${normalizedType}-${normalizedId}`;
}

export function isTrustedNotificationNavigation(targetUrl: string, origin: string) {
  try {
    const url = new URL(targetUrl, origin);
    return url.origin === origin && !isApiLikePath(url.pathname) && !isAuthLikePath(url.pathname);
  } catch {
    return false;
  }
}
