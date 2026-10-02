import type { Metadata } from 'next';
import { VerifyOtpForm } from '../../../components/auth/verify-otp-form';
import { PublicBrandShell } from '../../../components/branding/PublicBrandShell';
import { getPublicBrandingForRequest } from '../../../services/public-branding';

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getPublicBrandingForRequest();
  return {
    title: `Verify code - ${brand.appName}`,
    description: brand.metaDescription,
    icons: brand.favicon?.url ? { icon: brand.favicon.url } : undefined,
  };
}

export default async function VerifyOtpPage() {
  const brand = await getPublicBrandingForRequest();
  return (
    <PublicBrandShell brand={brand}>
      <VerifyOtpForm />
    </PublicBrandShell>
  );
}
