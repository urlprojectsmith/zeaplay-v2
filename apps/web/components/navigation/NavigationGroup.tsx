'use client';

import { usePathname } from 'next/navigation';
import type { NavigationGroupConfig } from './navigation-config';
import { NavigationItem } from './NavigationItem';

export function NavigationGroup({
  group,
  collapsed,
}: {
  group: NavigationGroupConfig;
  collapsed: boolean;
}) {
  const pathname = usePathname();
  return (
    <div className="grid gap-1">
      {collapsed ? null : (
        <p className="px-3 py-2 text-xs font-bold uppercase text-[hsl(var(--sidebar-foreground)/0.58)]">
          {group.label}
        </p>
      )}
      {group.items.map((item) => (
        <NavigationItem
          key={`${item.labelKey}-${item.href}`}
          item={item}
          collapsed={collapsed}
          active={isActiveRoute(pathname, item.href)}
        />
      ))}
    </div>
  );
}

function isActiveRoute(pathname: string, href: string) {
  if (href === '#') return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}
