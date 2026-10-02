import { headers } from 'next/headers';
import { defaultPublicBranding, type PublicBranding } from './public-branding.shared';

export { defaultPublicBranding, publicBrandToTokens } from './public-branding.shared';
export type { PublicBranding } from './public-branding.shared';

export async function getPublicBrandingForRequest(): Promise<PublicBranding> {
  const requestHeaders = await headers();
  const host = requestHeaders.get('host') ?? '';
  return getPublicBranding(host);
}

export async function getPublicBranding(host: string): Promise<PublicBranding> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/branding/public`, {
      headers: host ? { host } : undefined,
      cache: 'no-store',
    });
    if (!response.ok) return defaultPublicBranding;
    return { ...defaultPublicBranding, ...((await response.json()) as Partial<PublicBranding>) };
  } catch {
    return defaultPublicBranding;
  }
}
