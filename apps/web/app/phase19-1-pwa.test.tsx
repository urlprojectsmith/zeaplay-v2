import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { messages, translate } from '../lib/i18n';
import { buildWebManifest } from '../services/pwa-manifest';
import {
  PWA_MANIFEST_PATH,
  PWA_OFFLINE_PATH,
  PWA_SERVICE_WORKER_PATH,
  PWA_SHELL_CACHE,
  PWA_STATIC_CACHE,
  isAuthLikePath,
  isTrustedNotificationNavigation,
  shouldCacheRequest,
  shouldUseNavigationFallback,
  tenantCacheNamespace,
} from '../services/pwa-policy';
import { defaultPublicBranding } from '../services/public-branding.shared';
import { isSafeNotificationClickTarget, shouldRegisterServiceWorker } from '../services/pwa';

const root = join(__dirname, '..');

describe('Phase 19.1 PWA foundation', () => {
  it('builds a valid installable manifest with platform icon fallbacks', () => {
    const manifest = buildWebManifest(defaultPublicBranding);
    expect(manifest).toEqual(
      expect.objectContaining({
        name: 'Zea Play',
        short_name: 'Zea Play',
        description: 'Zea Play workspace platform',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#7C3AED',
        theme_color: '#1F7A68',
      }),
    );
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: '/icons/zeaplay-icon-192.png', sizes: '192x192' }),
        expect.objectContaining({ src: '/icons/zeaplay-icon-512.png', sizes: '512x512' }),
        expect.objectContaining({ src: '/icons/zeaplay-maskable-512.png', purpose: 'maskable' }),
      ]),
    );
  });

  it('supports host-resolved white-label identity without tenant query parameters', () => {
    const route = read('app/site.webmanifest/route.ts');
    expect(route).toContain('getPublicBrandingForRequest');
    expect(route).toContain("'Cache-Control': 'private, no-store, max-age=0, must-revalidate'");
    expect(route).toContain("Vary: 'Host'");
    expect(route).not.toContain('searchParams');
    expect(route).not.toContain('localStorage');
    const manifest = buildWebManifest({
      ...defaultPublicBranding,
      appName: 'Agency Portal',
      primaryColor: '#004D40',
      accentColor: 'bad-color',
    });
    expect(manifest.name).toBe('Agency Portal');
    expect(manifest.short_name).toBe('Agency Porta');
    expect(manifest.theme_color).toBe('#004D40');
    expect(manifest.background_color).toBe('#F8FAFC');
  });

  it('registers service workers only for production and exposes canonical paths', () => {
    expect(shouldRegisterServiceWorker('development')).toBe(false);
    expect(shouldRegisterServiceWorker('test')).toBe(false);
    expect(shouldRegisterServiceWorker('production')).toBe(true);
    expect(PWA_SERVICE_WORKER_PATH).toBe('/sw.js');
    expect(PWA_MANIFEST_PATH).toBe('/site.webmanifest');
    expect(PWA_OFFLINE_PATH).toBe('/offline');
  });

  it('uses conservative cache boundaries for static assets only', () => {
    const origin = 'https://play.zeaplay.test';
    expect(shouldCacheRequest({ url: '/_next/static/chunks/app.js' }, origin)).toBe(true);
    expect(shouldCacheRequest({ url: '/icons/zeaplay-icon-192.png' }, origin)).toBe(true);
    expect(shouldCacheRequest({ url: '/api/v1/workspaces' }, origin)).toBe(false);
    expect(shouldCacheRequest({ url: '/auth/login' }, origin)).toBe(false);
    expect(shouldCacheRequest({ url: '/_next/static/chunks/app.js', method: 'POST' }, origin)).toBe(
      false,
    );
    expect(
      shouldCacheRequest({ url: '/_next/static/chunks/app.js', hasAuthorization: true }, origin),
    ).toBe(false);
    expect(shouldCacheRequest({ url: 'https://api.play.zeacrm.com/api/v1/health' }, origin)).toBe(
      false,
    );
    expect(shouldUseNavigationFallback({ url: '/workspace/dashboard', mode: 'navigate' })).toBe(
      true,
    );
  });

  it('versions ZeaPlay caches and prepares tenant-scoped namespaces', () => {
    expect(PWA_STATIC_CACHE).toBe('zeaplay-static-v19-1');
    expect(PWA_SHELL_CACHE).toBe('zeaplay-shell-v19-1');
    expect(tenantCacheNamespace('WORKSPACE', 'Workspace_123')).toBe(
      'zeaplay-tenant-workspace-workspace-123',
    );
  });

  it('keeps auth and notification navigation safe', () => {
    expect(isAuthLikePath('/auth/logout')).toBe(true);
    expect(isTrustedNotificationNavigation('/workspace/tasks', 'https://play.zeaplay.test')).toBe(
      true,
    );
    expect(
      isSafeNotificationClickTarget(
        'https://api.play.zeacrm.com/api/v1/private',
        'https://play.zeaplay.test',
      ),
    ).toBe(false);
    expect(isSafeNotificationClickTarget('/auth/logout', 'https://play.zeaplay.test')).toBe(false);
  });

  it('keeps the service worker free of private API/auth caching and auto permission prompts', () => {
    const source = read('public/sw.js');
    expect(source).toContain('CLEAR_TENANT_CACHES');
    expect(source).toContain('SKIP_WAITING');
    expect(source).toContain('notificationclick');
    expect(source).toContain('push');
    expect(source).toContain("request.headers.has('authorization')");
    expect(source).toContain('BLOCKED_PATH_PATTERN');
    expect(source).toContain('!response.redirected');
    expect(source).not.toContain('Notification.requestPermission');
    expect(source).not.toContain('localStorage');
  });

  it('localizes install, update, and offline strings in EN and TA', () => {
    expect(translate('en', 'pwa.install')).toBe('Install app');
    expect(translate('ta', 'pwa.install')).toBe(messages.ta.pwa.install);
    expect(messages.ta.pwa.offline).not.toBe(messages.en.pwa.offline);
    for (const key of ['updateAvailable', 'refresh', 'offline', 'backOnline'] as const) {
      expect(messages.en.pwa[key]).toBeTruthy();
      expect(messages.ta.pwa[key]).toBeTruthy();
    }
  });
});

function read(path: string) {
  return readFileSync(join(root, path), 'utf8');
}
