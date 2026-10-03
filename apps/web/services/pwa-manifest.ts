import type { PublicBranding } from './public-branding.shared';
import { PWA_MANIFEST_PATH } from './pwa-policy';

export function buildWebManifest(brand: PublicBranding) {
  const themeColor = safeHexColor(brand.primaryColor, '#1F7A68');
  const backgroundColor = safeHexColor(brand.accentColor, '#F8FAFC');
  const name = safeName(brand.appName) ?? 'Zea Play';
  return {
    id: '/',
    name,
    short_name: shortName(name),
    description: safeName(brand.metaDescription) ?? 'Zea Play workspace platform',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: backgroundColor,
    theme_color: themeColor,
    icons: [
      {
        src: '/icons/zeaplay-icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/zeaplay-icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/zeaplay-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    related_applications: [],
    prefer_related_applications: false,
    manifest_version: PWA_MANIFEST_PATH,
  };
}

function safeName(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 80);
}

function shortName(value: string) {
  return value.length <= 12 ? value : value.slice(0, 12).trim();
}

function safeHexColor(value: string | null | undefined, fallback: string) {
  const trimmed = value?.trim();
  return trimmed && /^#[\da-f]{6}$/i.test(trimmed) ? trimmed : fallback;
}
