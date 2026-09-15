'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { defaultLocale, type Locale, locales, translate } from '../lib/i18n';

interface LanguageContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: typeof translate;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);
const storageKey = 'zea-play-locale';

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(defaultLocale);

  useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    if (locales.includes(stored as Locale)) setLocaleState(stored as Locale);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo(
    () => ({
      locale,
      setLocale(next: Locale) {
        localStorage.setItem(storageKey, next);
        setLocaleState(next);
      },
      t: (activeLocale: Locale, key: Parameters<typeof translate>[1]) =>
        translate(activeLocale, key),
    }),
    [locale],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const value = useContext(LanguageContext);
  if (!value) throw new Error('useLanguage must be used within LanguageProvider');
  return value;
}
