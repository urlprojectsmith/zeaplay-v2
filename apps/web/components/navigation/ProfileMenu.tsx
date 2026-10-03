'use client';

import { useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import {
  Avatar,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@zea-play/ui';
import { useLanguage } from '../../contexts/language-provider';
import { usePwaContext } from '../../contexts/pwa-provider';
import { useSessionStore } from '../../stores/session';
import { PwaInstallDialog } from '../pwa/PwaInstallDialog';

export function ProfileMenu() {
  const { locale, t } = useLanguage();
  const { user, logout } = useSessionStore();
  const pwa = usePwaContext();
  const [installOpen, setInstallOpen] = useState(false);
  const name = user?.name ?? user?.email ?? 'Zea Play';
  const showInstall = pwa.canInstall || pwa.showIosInstall;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button aria-label={t(locale, 'common.openProfileMenu')} size="icon" variant="ghost">
            <Avatar name={name} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled>{user?.email}</DropdownMenuItem>
          {showInstall ? (
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                setInstallOpen(true);
              }}
            >
              <Download aria-hidden="true" className="h-4 w-4" />
              {t(locale, 'pwa.install')}
            </DropdownMenuItem>
          ) : null}
          {pwa.updateAvailable ? (
            <DropdownMenuItem onSelect={() => pwa.refreshForUpdate()}>
              <RefreshCw aria-hidden="true" className="h-4 w-4" />
              {t(locale, 'pwa.refresh')}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={() => void logout()}>
            {t(locale, 'common.logout')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <PwaInstallDialog open={installOpen} onOpenChange={setInstallOpen} />
    </>
  );
}
