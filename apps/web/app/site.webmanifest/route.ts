import { NextResponse } from 'next/server';
import { getPublicBrandingForRequest } from '../../services/public-branding';
import { buildWebManifest } from '../../services/pwa-manifest';

export const dynamic = 'force-dynamic';

export async function GET() {
  const brand = await getPublicBrandingForRequest();
  const manifest = buildWebManifest(brand);
  return NextResponse.json(manifest, {
    headers: {
      'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
      'Content-Type': 'application/manifest+json; charset=utf-8',
      Vary: 'Host',
    },
  });
}
