'use client';

import { Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Button } from '@zea-play/ui';
import { useLanguage } from '../../contexts/language-provider';
import { GlobalSearch } from '../search/GlobalSearch';
import type { DashboardConfig } from '../navigation/navigation-config';
import { AgencySwitcher } from '../navigation/AgencySwitcher';
import { LanguageSwitcher } from '../navigation/LanguageSwitcher';
import { ProfileMenu } from '../navigation/ProfileMenu';
import { SuperAgencySwitcher } from '../navigation/SuperAgencySwitcher';
import { ThemeSwitcher } from '../navigation/ThemeSwitcher';
import { WorkspaceSwitcher } from '../navigation/WorkspaceSwitcher';
import { NotificationCenter } from '../notifications/NotificationCenter';
import { GlobalTimerIndicator } from '../workspace/tasks/GlobalTimerIndicator';
import { Breadcrumbs } from './Breadcrumbs';

export function AppHeader({
  config,
  collapsed,
  mobileOpen,
  onToggleCollapsed,
  onOpenMobile,
}: {
  config: DashboardConfig;
  collapsed: boolean;
  mobileOpen: boolean;
  onToggleCollapsed: () => void;
  onOpenMobile: () => void;
}) {
  const { locale, t } = useLanguage();
  return (
    <header className="safe-area-top sticky top-0 z-30 border-b border-[hsl(var(--border))] bg-[hsl(var(--header-background)/0.94)] backdrop-blur">
      <div className="safe-area-x flex min-h-16 items-center gap-2 sm:gap-3 lg:px-8">
        <Button
          aria-controls="mobile-navigation-drawer"
          aria-expanded={mobileOpen}
          aria-label={t(locale, 'common.openMenu')}
          className="shrink-0 lg:hidden"
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
        <div className="min-w-0 flex-1 overflow-hidden">
          <Breadcrumbs items={['Zea Play', config.title]} />
        </div>
        <div className="hidden min-w-0 items-center gap-2 xl:flex">
          <GlobalSearch scope={config.scope} />
          {config.scope === 'super-agency' ? <SuperAgencySwitcher compact /> : null}
          {config.scope === 'agency' || config.scope === 'workspace' ? (
            <AgencySwitcher compact />
          ) : null}
          {config.scope === 'workspace' ? <WorkspaceSwitcher compact /> : null}
        </div>
        <div className="hidden shrink-0 items-center gap-2 md:flex">
          <ThemeSwitcher />
          <LanguageSwitcher />
        </div>
        <div className="shrink-0 xl:hidden">
          <GlobalSearch scope={config.scope} />
        </div>
        {config.scope === 'workspace' ? (
          <div className="hidden shrink-0 sm:block">
            <GlobalTimerIndicator />
          </div>
        ) : null}
        {config.scope === 'workspace' ? <NotificationCenter /> : null}
        <ProfileMenu />
      </div>
    </header>
  );
}
