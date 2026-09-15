'use client';

import { BrandLogo } from '../branding/BrandLogo';
import type { DashboardConfig } from '../navigation/navigation-config';
import { NavigationGroup } from '../navigation/NavigationGroup';

export function AppSidebar({ config, collapsed }: { config: DashboardConfig; collapsed: boolean }) {
  return (
    <aside
      className="hidden border-r border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar-background))] text-[hsl(var(--sidebar-foreground))] transition-[width] lg:block"
      style={{ width: collapsed ? 72 : 280 }}
    >
      <div className="flex h-16 items-center border-b border-[hsl(var(--sidebar-border))] px-4">
        <BrandLogo compact={collapsed} />
      </div>
      <nav className="grid gap-5 p-3" aria-label={`${config.title} navigation`}>
        {config.groups.map((group) => (
          <NavigationGroup key={group.label} group={group} collapsed={collapsed} />
        ))}
      </nav>
    </aside>
  );
}
