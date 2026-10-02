'use client';

import type React from 'react';
import { BrandProvider } from './BrandProvider';
import { BrandLogo } from './BrandLogo';
import { publicBrandToTokens, type PublicBranding } from '../../services/public-branding.shared';
import { useLanguage } from '../../contexts/language-provider';

export function PublicBrandShell({
  brand,
  children,
  title,
}: {
  brand: PublicBranding;
  children: React.ReactNode;
  title?: string;
}) {
  const { locale, t } = useLanguage();
  const background = brand.loginBackground?.url;
  return (
    <BrandProvider brand={publicBrandToTokens(brand)}>
      <main
        className="public-brand-shell min-h-screen bg-[hsl(var(--background))] text-[hsl(var(--foreground))]"
        style={
          background
            ? {
                backgroundImage: `linear-gradient(rgb(15 23 42 / 0.40), rgb(15 23 42 / 0.24)), url("${background}")`,
                backgroundPosition: 'center',
                backgroundSize: 'cover',
              }
            : undefined
        }
      >
        <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-5 py-6 sm:px-8">
          <header className="flex min-h-12 items-center justify-between gap-4">
            <BrandLogo />
            {brand.supportUrl ? (
              <a
                className="text-sm font-semibold text-[hsl(var(--primary))]"
                href={brand.supportUrl}
              >
                {t(locale, 'publicBranding.support')}
              </a>
            ) : null}
          </header>
          <section className="grid flex-1 place-items-center py-8">
            <div className="w-full max-w-3xl">
              {title ? <p className="eyebrow">{title}</p> : null}
              {children}
            </div>
          </section>
          <footer className="pb-2 text-center text-xs text-[hsl(var(--muted-foreground))]">
            {brand.footerText}
            {brand.supportEmail ? <span> - {brand.supportEmail}</span> : null}
          </footer>
        </div>
      </main>
    </BrandProvider>
  );
}
