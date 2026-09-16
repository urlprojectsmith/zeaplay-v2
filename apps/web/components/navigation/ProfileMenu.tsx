'use client';

import {
  Avatar,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@zea-play/ui';
import { useLanguage } from '../../contexts/language-provider';
import { useSessionStore } from '../../stores/session';

export function ProfileMenu() {
  const { locale, t } = useLanguage();
  const { user, logout } = useSessionStore();
  const name = user?.name ?? user?.email ?? 'Zea Play';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label={t(locale, 'common.openProfileMenu')} size="icon" variant="ghost">
          <Avatar name={name} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled>{user?.email}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void logout()}>
          {t(locale, 'common.logout')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
