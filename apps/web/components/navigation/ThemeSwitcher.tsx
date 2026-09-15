'use client';

import { Button } from '@zea-play/ui';
import type { ZeaTheme } from '@zea-play/ui';
import { useLanguage } from '../../contexts/language-provider';
import { useTheme } from '../../contexts/theme-provider';

const options: ZeaTheme[] = ['light', 'dark', 'colorful'];

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const { locale, t } = useLanguage();
  return (
    <div
      className="flex rounded-md border border-[hsl(var(--border))] p-1"
      aria-label={t(locale, 'common.theme')}
    >
      {options.map((option) => (
        <Button
          key={option}
          aria-pressed={theme === option}
          size="sm"
          type="button"
          variant={theme === option ? 'primary' : 'ghost'}
          onClick={() => setTheme(option)}
        >
          {t(locale, `dashboard.${option}`)}
        </Button>
      ))}
    </div>
  );
}
