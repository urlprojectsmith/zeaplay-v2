'use client';

import { useEffect, useState } from 'react';
import { AppHeader } from './AppHeader';
import { AppSidebar } from './AppSidebar';
import { MobileSidebar } from './MobileSidebar';
import type { DashboardConfig } from '../navigation/navigation-config';

const storageKey = 'zea-play-sidebar-collapsed';

export function DashboardShell({
  config,
  children,
}: {
  config: DashboardConfig;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem(storageKey) === 'true');
  }, []);

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      localStorage.setItem(storageKey, String(next));
      return next;
    });
  }

  return (
    <div className="flex min-h-screen bg-[hsl(var(--background))] text-[hsl(var(--foreground))]">
      <AppSidebar config={config} collapsed={collapsed} />
      <MobileSidebar config={config} open={mobileOpen} onOpenChange={setMobileOpen} />
      <div className="min-w-0 flex-1">
        <AppHeader
          config={config}
          collapsed={collapsed}
          onOpenMobile={() => setMobileOpen(true)}
          onToggleCollapsed={toggleCollapsed}
        />
        {children}
      </div>
    </div>
  );
}
