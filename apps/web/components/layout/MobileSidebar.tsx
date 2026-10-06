'use client';

import { Button, Dialog, DialogContent, DialogTitle } from '@zea-play/ui';
import { X } from 'lucide-react';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { BrandLogo } from '../branding/BrandLogo';
import { useLanguage } from '../../contexts/language-provider';
import { AccountContextSwitcher } from '../navigation/AccountContextSwitcher';
import type { DashboardConfig } from '../navigation/navigation-config';
import { LanguageSwitcher } from '../navigation/LanguageSwitcher';
import { NavigationGroup } from '../navigation/NavigationGroup';
import { ThemeSwitcher } from '../navigation/ThemeSwitcher';

export function MobileSidebar({
  config,
  open,
  onOpenChange,
}: {
  config: DashboardConfig;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { locale, t } = useLanguage();
  const pathname = usePathname();

  useEffect(() => {
    onOpenChange(false);
  }, [onOpenChange, pathname]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        id="mobile-navigation-drawer"
        className="safe-area-top left-0 top-0 flex h-[100dvh] w-80 max-w-[min(88vw,24rem)] translate-x-0 translate-y-0 flex-col overflow-hidden rounded-none p-0"
        hideCloseButton
      >
        <div className="safe-area-x flex min-h-16 items-center justify-between gap-3 border-b border-[hsl(var(--border))]">
          <DialogTitle asChild>
            <BrandLogo />
          </DialogTitle>
          <Button
            aria-label={t(locale, 'common.closeMenu')}
            size="icon"
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </Button>
        </div>
        <nav
          className="safe-area-x grid flex-1 content-start gap-5 overflow-y-auto py-3"
          aria-label={`${config.title} mobile navigation`}
        >
          <AccountContextSwitcher collapsed={false} />
          {config.groups.map((group) => (
            <NavigationGroup key={group.label} group={group} collapsed={false} />
          ))}
        </nav>
        <div className="safe-area-x safe-area-bottom grid gap-3 border-t border-[hsl(var(--border))] py-3 md:hidden">
          <ThemeSwitcher />
          <LanguageSwitcher />
        </div>
      </DialogContent>
    </Dialog>
  );
}
