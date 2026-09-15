'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ZeaTheme } from '@zea-play/ui';

interface ThemeContextValue {
  theme: ZeaTheme;
  setTheme: (theme: ZeaTheme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const storageKey = 'zea-play-theme';
const themes: ZeaTheme[] = ['light', 'dark', 'colorful'];

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ZeaTheme>('light');

  useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    const initial = themes.includes(stored as ZeaTheme)
      ? (stored as ZeaTheme)
      : typeof window.matchMedia === 'function' &&
          window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
    setThemeState(initial);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const value = useMemo(
    () => ({
      theme,
      setTheme(next: ZeaTheme) {
        localStorage.setItem(storageKey, next);
        setThemeState(next);
      },
    }),
    [theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used within ThemeProvider');
  return value;
}
