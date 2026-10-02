import type { Metadata } from 'next';
import { PublicBrandShell } from '../../../components/branding/PublicBrandShell';
import { PublicPlaceholder } from '../../../components/dashboards/public-placeholder';
import { getPublicBrandingForRequest } from '../../../services/public-branding';

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getPublicBrandingForRequest();
  return {
    title: `Forgot password - ${brand.appName}`,
    description: brand.metaDescription,
    icons: brand.favicon?.url ? { icon: brand.favicon.url } : undefined,
  };
}

export default async function ForgotPasswordPage() {
  const brand = await getPublicBrandingForRequest();
  return (
    <PublicBrandShell brand={brand}>
      <PublicPlaceholder titleKey="publicBranding.forgotPasswordTitle" />
    </PublicBrandShell>
  );
}
