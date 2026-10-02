'use client';

import { createContext, useContext, useEffect, useMemo } from 'react';
import type { BrandTokens } from '@zea-play/ui';
import { useQuery } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';
import type { AnalyticsScopeType } from '../../services/analytics';
import { brandingKeys, getEffectiveBranding } from '../../services/branding';
import { useSessionStore } from '../../stores/session';

export const defaultBrand: Required<Pick<BrandTokens, 'brandName' | 'agencyName'>> & BrandTokens = {
  brandName: 'Zea Play',
  agencyName: 'Zea Play',
  primaryColor: '176 72% 28%',
  secondaryColor: '214 32% 91%',
  accentColor: '262 80% 58%',
};

interface BrandContextValue {
  brand: BrandTokens;
}

const BrandContext = createContext<BrandContextValue | null>(null);

export function BrandProvider({
  children,
  brand,
}: {
  children: React.ReactNode;
  brand?: BrandTokens;
}) {
  if (brand) {
    return <ResolvedBrandProvider brand={brand}>{children}</ResolvedBrandProvider>;
  }

  return <QueriedBrandProvider>{children}</QueriedBrandProvider>;
}

function QueriedBrandProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { accessToken, selectedAgencyId, selectedSuperAgencyId, selectedWorkspaceId } =
    useSessionStore();
  const scope = useMemo(
    () => resolveScope(pathname, selectedSuperAgencyId, selectedAgencyId, selectedWorkspaceId),
    [pathname, selectedAgencyId, selectedSuperAgencyId, selectedWorkspaceId],
  );
  const brandQuery = useQuery({
    queryKey: brandingKeys.effective(scope?.type ?? null, scope?.id ?? null),
    queryFn: () => getEffectiveBranding(scope?.type as AnalyticsScopeType, scope?.id as string),
    enabled: Boolean(accessToken && scope),
    staleTime: 30_000,
    retry: false,
  });
  const effectiveBrand = brandQuery.data
    ? {
        brandName: brandQuery.data.appName,
        agencyName: brandQuery.data.companyName,
        logoUrl: brandQuery.data.logo?.url,
        faviconUrl: brandQuery.data.favicon?.url,
        loginBackground: brandQuery.data.loginBackground?.url,
        primaryColor: brandQuery.data.primaryColor,
        primaryForeground: brandQuery.data.primaryForeground,
        accentColor: brandQuery.data.accentColor,
        accentForeground: brandQuery.data.accentForeground,
      }
    : defaultBrand;

  return <ResolvedBrandProvider brand={effectiveBrand}>{children}</ResolvedBrandProvider>;
}

function ResolvedBrandProvider({
  children,
  brand,
}: {
  children: React.ReactNode;
  brand: BrandTokens;
}) {
  const merged = useMemo(
    () => ({
      ...defaultBrand,
      ...brand,
      primaryColor: sanitizeBrandColor(brand.primaryColor) ?? defaultBrand.primaryColor,
      primaryForeground: sanitizeBrandColor(brand.primaryForeground) ?? undefined,
      secondaryColor: sanitizeBrandColor(brand.secondaryColor) ?? defaultBrand.secondaryColor,
      accentColor: sanitizeBrandColor(brand.accentColor) ?? defaultBrand.accentColor,
      accentForeground: sanitizeBrandColor(brand.accentForeground) ?? undefined,
      logoUrl: sanitizeBrandUrl(brand.logoUrl),
      faviconUrl: sanitizeBrandUrl(brand.faviconUrl),
      loginBackground: sanitizeBrandUrl(brand.loginBackground),
    }),
    [brand],
  );

  useEffect(() => {
    const root = document.documentElement;
    if (merged.primaryColor) root.style.setProperty('--primary', merged.primaryColor);
    if (merged.primaryForeground)
      root.style.setProperty('--primary-foreground', merged.primaryForeground);
    if (merged.secondaryColor) root.style.setProperty('--secondary', merged.secondaryColor);
    if (merged.accentColor) root.style.setProperty('--accent', merged.accentColor);
    if (merged.accentForeground)
      root.style.setProperty('--accent-foreground', merged.accentForeground);
  }, [merged]);

  useEffect(() => {
    document.title = merged.brandName ?? defaultBrand.brandName;
    if (!merged.faviconUrl) return;
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = merged.faviconUrl;
  }, [merged.brandName, merged.faviconUrl]);

  return <BrandContext.Provider value={{ brand: merged }}>{children}</BrandContext.Provider>;
}

export function useBrand() {
  const value = useContext(BrandContext);
  if (!value) throw new Error('useBrand must be used within BrandProvider');
  return value;
}

function sanitizeBrandColor(value: string | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d{1,3}(?:\.\d+)?\s+\d{1,3}(?:\.\d+)?%\s+\d{1,3}(?:\.\d+)?%$/.test(trimmed)) {
    const parts = trimmed.split(/\s+/);
    const hue = parts[0] ?? '';
    const saturation = parts[1] ?? '';
    const lightness = parts[2] ?? '';
    const hueValue = Number(hue);
    const saturationValue = Number(saturation.replace('%', ''));
    const lightnessValue = Number(lightness.replace('%', ''));
    if (
      hueValue >= 0 &&
      hueValue <= 360 &&
      saturationValue >= 0 &&
      saturationValue <= 100 &&
      lightnessValue >= 0 &&
      lightnessValue <= 100
    ) {
      return `${hueValue} ${saturationValue}% ${lightnessValue}%`;
    }
  }

  const hex = trimmed.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (!hex) return null;
  const raw = hex[1] ?? '';
  const expanded =
    raw.length === 3
      ? raw
          .split('')
          .map((character) => `${character}${character}`)
          .join('')
      : raw;
  const red = Number.parseInt(expanded.slice(0, 2), 16) / 255;
  const green = Number.parseInt(expanded.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(expanded.slice(4, 6), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const delta = max - min;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (delta !== 0) {
    if (max === red) hue = ((green - blue) / delta) % 6;
    if (max === green) hue = (blue - red) / delta + 2;
    if (max === blue) hue = (red - green) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  return `${Math.round(hue)} ${Math.round(saturation * 100)}% ${Math.round(lightness * 100)}%`;
}

function sanitizeBrandUrl(value: string | undefined) {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed.startsWith('/')) return trimmed;
  try {
    const url = new URL(trimmed);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function resolveScope(
  pathname: string | null,
  selectedSuperAgencyId: string | null,
  selectedAgencyId: string | null,
  selectedWorkspaceId: string | null,
): { type: AnalyticsScopeType; id: string } | null {
  if (selectedWorkspaceId) return { type: 'WORKSPACE', id: selectedWorkspaceId };
  if (selectedAgencyId) return { type: 'AGENCY', id: selectedAgencyId };
  if (selectedSuperAgencyId) return { type: 'SUPER_AGENCY', id: selectedSuperAgencyId };
  if (pathname?.startsWith('/super-admin')) {
    return { type: 'PLATFORM', id: '00000000-0000-0000-0000-000000000000' };
  }
  return null;
}
