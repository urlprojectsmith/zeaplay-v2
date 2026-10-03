import {
  PWA_SERVICE_WORKER_PATH,
  isTrustedNotificationNavigation,
  tenantCacheNamespace,
} from './pwa-policy';

export type PwaInstallPlatform = 'browser' | 'ios' | 'unsupported';

export interface PwaCapabilitySnapshot {
  serviceWorker: boolean;
  push: boolean;
  notifications: boolean;
}

export interface PwaInstallSnapshot {
  canPrompt: boolean;
  installed: boolean;
  platform: PwaInstallPlatform;
  dismissed: boolean;
}

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export const PWA_INSTALL_DISMISSED_KEY = 'zea-play-pwa-install-dismissed';

export function shouldRegisterServiceWorker(environment = process.env.NODE_ENV) {
  return environment === 'production';
}

export function getPwaCapabilities(win: Window = window): PwaCapabilitySnapshot {
  return {
    serviceWorker: 'serviceWorker' in win.navigator,
    push: 'serviceWorker' in win.navigator && 'PushManager' in win,
    notifications: 'Notification' in win,
  };
}

export function isStandaloneMode(win: Window = window) {
  return (
    win.matchMedia?.('(display-mode: standalone)').matches === true ||
    win.matchMedia?.('(display-mode: fullscreen)').matches === true ||
    Boolean((win.navigator as Navigator & { standalone?: boolean }).standalone)
  );
}

export function isIosInstallCandidate(win: Window = window) {
  const userAgent = win.navigator.userAgent;
  const isiOS = /iphone|ipad|ipod/i.test(userAgent);
  const isSafari = /safari/i.test(userAgent) && !/crios|fxios|edgios/i.test(userAgent);
  return isiOS && isSafari && !isStandaloneMode(win);
}

export function resolveInstallPlatform(win: Window = window): PwaInstallPlatform {
  if (isIosInstallCandidate(win)) return 'ios';
  return 'unsupported';
}

export function postServiceWorkerMessage(message: Record<string, unknown>) {
  if (typeof navigator === 'undefined') return;
  navigator.serviceWorker?.controller?.postMessage(message);
}

export function clearTenantBoundPwaCaches() {
  postServiceWorkerMessage({ type: 'CLEAR_TENANT_CACHES' });
}

export function clearScopedPwaCache(scopeType: string, scopeId: string) {
  postServiceWorkerMessage({
    type: 'CLEAR_TENANT_CACHES',
    namespace: tenantCacheNamespace(scopeType, scopeId),
  });
}

export function registerPwaServiceWorker(
  onUpdateAvailable: (registration: ServiceWorkerRegistration) => void,
) {
  if (typeof window === 'undefined' || !shouldRegisterServiceWorker()) {
    return Promise.resolve(null);
  }
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);

  return navigator.serviceWorker
    .register(PWA_SERVICE_WORKER_PATH, { scope: '/' })
    .then((registration) => {
      if (registration.waiting) onUpdateAvailable(registration);
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        installing?.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            onUpdateAvailable(registration);
          }
        });
      });
      return registration;
    })
    .catch((error: unknown) => {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('PWA service worker registration failed', error);
      }
      return null;
    });
}

export function requestServiceWorkerUpdate(registration: ServiceWorkerRegistration | null) {
  registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
}

export function isSafeNotificationClickTarget(targetUrl: string, origin: string) {
  return isTrustedNotificationNavigation(targetUrl, origin);
}
