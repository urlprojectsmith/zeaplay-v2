'use client';

import { Button, Dialog, DialogContent, DialogTitle } from '@zea-play/ui';
import { X } from 'lucide-react';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { BrandLogo } from '../branding/BrandLogo';
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
  const pathname = usePathname();

  useEffect(() => {
    onOpenChange(false);
  }, [onOpenChange, pathname]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="left-0 top-0 flex h-full w-80 max-w-[86vw] translate-x-0 translate-y-0 flex-col rounded-none p-0">
        <div className="flex h-16 items-center justify-between border-b border-[hsl(var(--border))] px-4">
          <DialogTitle asChild>
            <BrandLogo />
          </DialogTitle>
          <Button
            aria-label="Close navigation"
            size="icon"
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </Button>
        </div>
        <nav
          className="grid flex-1 content-start gap-5 overflow-y-auto p-3"
          aria-label={`${config.title} mobile navigation`}
        >
          {config.groups.map((group) => (
            <NavigationGroup key={group.label} group={group} collapsed={false} />
          ))}
        </nav>
        <div className="grid gap-3 border-t border-[hsl(var(--border))] p-3 md:hidden">
          <ThemeSwitcher />
          <LanguageSwitcher />
        </div>
      </DialogContent>
    </Dialog>
  );
}
