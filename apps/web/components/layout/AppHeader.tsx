'use client';

import { Bell, Menu, PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react';
import { Button } from '@zea-play/ui';
import { useLanguage } from '../../contexts/language-provider';
import type { DashboardConfig } from '../navigation/navigation-config';
import { AgencySwitcher } from '../navigation/AgencySwitcher';
import { LanguageSwitcher } from '../navigation/LanguageSwitcher';
import { ProfileMenu } from '../navigation/ProfileMenu';
import { ThemeSwitcher } from '../navigation/ThemeSwitcher';
import { WorkspaceSwitcher } from '../navigation/WorkspaceSwitcher';
import { Breadcrumbs } from './Breadcrumbs';

export function AppHeader({
  config,
  collapsed,
  onToggleCollapsed,
  onOpenMobile,
}: {
  config: DashboardConfig;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onOpenMobile: () => void;
}) {
  const { locale, t } = useLanguage();
  return (
    <header className="sticky top-0 z-30 border-b border-[hsl(var(--border))] bg-[hsl(var(--header-background)/0.94)] backdrop-blur">
      <div className="flex min-h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
        <Button
          aria-label={t(locale, 'common.openMenu')}
          className="lg:hidden"
          size="icon"
          type="button"
          variant="ghost"
          onClick={onOpenMobile}
        >
          <Menu aria-hidden="true" className="h-5 w-5" />
        </Button>
        <Button
          aria-label={
            collapsed ? t(locale, 'common.expandSidebar') : t(locale, 'common.collapseSidebar')
          }
          className="hidden lg:inline-flex"
          size="icon"
          type="button"
          variant="ghost"
          onClick={onToggleCollapsed}
        >
          {collapsed ? (
            <PanelLeftOpen aria-hidden="true" className="h-5 w-5" />
          ) : (
            <PanelLeftClose aria-hidden="true" className="h-5 w-5" />
          )}
        </Button>
        <div className="min-w-0 flex-1">
          <Breadcrumbs items={['Zea Play', config.title]} />
        </div>
        <div className="hidden items-center gap-2 xl:flex">
          <div className="flex h-10 min-w-64 items-center gap-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 text-sm text-[hsl(var(--muted-foreground))]">
            <Search aria-hidden="true" className="h-4 w-4" />
            <span>{t(locale, 'common.search')}</span>
          </div>
          <AgencySwitcher compact />
          {config.scope === 'workspace' ? <WorkspaceSwitcher compact /> : null}
        </div>
        <div className="hidden items-center gap-2 md:flex">
          <ThemeSwitcher />
          <LanguageSwitcher />
        </div>
        <Button
          aria-label={t(locale, 'common.notifications')}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Bell aria-hidden="true" className="h-5 w-5" />
        </Button>
        <ProfileMenu />
      </div>
    </header>
  );
}
