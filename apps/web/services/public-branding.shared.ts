import type { BrandTokens } from '@zea-play/ui';
import type { BrandingAssetRef } from './branding';

export interface PublicBranding {
  appName: string;
  companyName: string;
  logo: BrandingAssetRef | null;
  darkLogo: BrandingAssetRef | null;
  favicon: BrandingAssetRef | null;
  loginBackground: BrandingAssetRef | null;
  primaryColor: string;
  primaryForeground: string;
  accentColor: string;
  accentForeground: string;
  supportEmail: string;
  supportUrl: string;
  footerText: string;
  metaDescription: string;
  fingerprint: string;
}

export const defaultPublicBranding: PublicBranding = {
  appName: 'Zea Play',
  companyName: 'Zea Play',
  logo: null,
  darkLogo: null,
  favicon: null,
  loginBackground: null,
  primaryColor: '#1F7A68',
  primaryForeground: '#FFFFFF',
  accentColor: '#7C3AED',
  accentForeground: '#FFFFFF',
  supportEmail: 'support@zeaplay.test',
  supportUrl: 'https://zeaplay.test/support',
  footerText: 'Powered by ZeaPlay',
  metaDescription: 'Zea Play workspace platform',
  fingerprint: 'platform-default',
};

export function publicBrandToTokens(brand: PublicBranding): BrandTokens {
  return {
    brandName: brand.appName,
    agencyName: brand.companyName,
    logoUrl: brand.logo?.url,
    faviconUrl: brand.favicon?.url,
    loginBackground: brand.loginBackground?.url,
    primaryColor: brand.primaryColor,
    primaryForeground: brand.primaryForeground,
    accentColor: brand.accentColor,
    accentForeground: brand.accentForeground,
  };
}
