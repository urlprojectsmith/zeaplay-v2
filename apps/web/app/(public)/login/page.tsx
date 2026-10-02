import React from 'react';
import type { Metadata } from 'next';
import { LoginForm } from '../../../components/auth/login-form';
import { PublicBrandShell } from '../../../components/branding/PublicBrandShell';
import { getPublicBrandingForRequest } from '../../../services/public-branding';

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getPublicBrandingForRequest();
  return {
    title: `Sign in - ${brand.appName}`,
    description: brand.metaDescription,
    icons: brand.favicon?.url ? { icon: brand.favicon.url } : undefined,
    openGraph: {
      title: `Sign in - ${brand.appName}`,
      description: brand.metaDescription,
      siteName: brand.companyName,
    },
  };
}

export default async function LoginPage() {
  const brand = await getPublicBrandingForRequest();
  return (
    <PublicBrandShell brand={brand}>
      <LoginForm />
    </PublicBrandShell>
  );
}
