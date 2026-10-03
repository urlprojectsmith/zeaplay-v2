const PWA_VERSION = '19.1';
const CACHE_PREFIX = 'zeaplay';
const STATIC_CACHE = `${CACHE_PREFIX}-static-v19-1`;
const SHELL_CACHE = `${CACHE_PREFIX}-shell-v19-1`;
const OFFLINE_URL = '/offline';
const STATIC_ASSET_PATTERN = /^\/(?:_next\/static\/|icons\/|site\.webmanifest$|favicon\.ico$)/;
const BLOCKED_PATH_PATTERN =
  /^\/(?:api(?:\/|$)|api\/v1(?:\/|$)|auth\/(?:login|logout|refresh|forgot-password|reset-password|verify-otp)(?:\/|$))/;
const PRECACHE_URLS = [
  OFFLINE_URL,
  '/icons/zeaplay-icon-192.png',
  '/icons/zeaplay-icon-512.png',
  '/icons/zeaplay-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch(() => undefined),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith(`${CACHE_PREFIX}-`) && ![STATIC_CACHE, SHELL_CACHE].includes(key),
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (data.type === 'CLEAR_TENANT_CACHES') {
    event.waitUntil(
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter((key) =>
                data.namespace ? key === data.namespace : key.startsWith(`${CACHE_PREFIX}-tenant-`),
              )
              .map((key) => caches.delete(key)),
          ),
        ),
    );
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.headers.has('authorization') || BLOCKED_PATH_PATTERN.test(url.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (STATIC_ASSET_PATTERN.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
  }
});

self.addEventListener('push', (event) => {
  event.waitUntil(Promise.resolve());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl =
    typeof event.notification.data?.url === 'string' ? event.notification.data.url : '/';
  event.waitUntil(openTrustedWindow(targetUrl));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic' && !response.redirected) {
    const cache = await caches.open(STATIC_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

async function networkFirstNavigation(request) {
  try {
    return await fetch(request);
  } catch {
    return (await caches.match(OFFLINE_URL)) || Response.error();
  }
}

async function openTrustedWindow(targetUrl) {
  const url = new URL(targetUrl, self.location.origin);
  if (url.origin !== self.location.origin || BLOCKED_PATH_PATTERN.test(url.pathname)) return;
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const existing = windows.find((client) => 'focus' in client && client.url === url.href);
  if (existing) {
    await existing.focus();
    return;
  }
  await self.clients.openWindow(url.href);
}
