'use client';

import { Button } from '@zea-play/ui';
import { useLanguage } from '../../contexts/language-provider';
import type { Locale } from '../../lib/i18n';

const options: { locale: Locale; label: string }[] = [
  { locale: 'en', label: 'EN' },
  { locale: 'ta', label: 'தமிழ்' },
];

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useLanguage();
  return (
    <div
      className="flex rounded-md border border-[hsl(var(--border))] p-1"
      aria-label={t(locale, 'common.language')}
    >
      {options.map((option) => (
        <Button
          key={option.locale}
          aria-pressed={locale === option.locale}
          size="sm"
          type="button"
          variant={locale === option.locale ? 'primary' : 'ghost'}
          onClick={() => setLocale(option.locale)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
