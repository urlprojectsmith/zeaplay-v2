'use client';

import React from 'react';
import { useLanguage } from '../../contexts/language-provider';

export function PublicPlaceholder({
  title,
  titleKey,
}: {
  title?: string;
  titleKey?:
    | 'publicBranding.forgotPasswordTitle'
    | 'publicBranding.resetPasswordTitle'
    | 'publicBranding.invitationTitle';
}) {
  const { locale, t } = useLanguage();
  return (
    <section className="mx-auto w-full max-w-sm rounded border border-[hsl(var(--border))] bg-[hsl(var(--surface-elevated))] p-6 shadow-sm">
      <h1 className="text-2xl font-semibold tracking-normal">
        {titleKey ? t(locale, titleKey) : title}
      </h1>
      <p className="mt-3 text-sm leading-6 text-[hsl(var(--muted-foreground))]">
        {t(locale, 'publicBranding.authPlaceholder')}
      </p>
    </section>
  );
}
