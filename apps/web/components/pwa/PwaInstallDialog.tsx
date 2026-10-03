'use client';

import { Download, RefreshCw, Smartphone } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@zea-play/ui';
import { useLanguage } from '../../contexts/language-provider';
import { usePwaContext } from '../../contexts/pwa-provider';

export function PwaInstallDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const pwa = usePwaContext();
  const { locale, t } = useLanguage();
  const ios = pwa.showIosInstall;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {ios ? t(locale, 'pwa.iosTitle') : t(locale, 'pwa.installTitle')}
          </DialogTitle>
          <DialogDescription>
            {ios ? t(locale, 'pwa.iosDescription') : t(locale, 'pwa.installDescription')}
          </DialogDescription>
        </DialogHeader>
        {ios ? (
          <ol className="grid gap-2 text-sm text-[hsl(var(--foreground))]">
            <li className="flex items-center gap-2">
              <Smartphone aria-hidden="true" className="h-4 w-4" />
              {t(locale, 'pwa.iosShare')}
            </li>
            <li className="flex items-center gap-2">
              <Download aria-hidden="true" className="h-4 w-4" />
              {t(locale, 'pwa.iosAdd')}
            </li>
          </ol>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => pwa.dismissInstall()}>
            {t(locale, 'pwa.notNow')}
          </Button>
          {pwa.canInstall ? (
            <Button
              type="button"
              onClick={() => {
                void pwa.promptInstall().finally(() => onOpenChange(false));
              }}
            >
              <Download aria-hidden="true" className="h-4 w-4" />
              {t(locale, 'pwa.install')}
            </Button>
          ) : null}
          {pwa.updateAvailable ? (
            <Button type="button" onClick={pwa.refreshForUpdate}>
              <RefreshCw aria-hidden="true" className="h-4 w-4" />
              {t(locale, 'pwa.refresh')}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
