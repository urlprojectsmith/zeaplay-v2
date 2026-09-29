'use client';

import { usePathname, useSearchParams } from 'next/navigation';
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
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const currentRoute = `${pathname}${search ? `?${search}` : ''}`;
  const exactQueryMatch = group.items.some((item) => isExactQueryRoute(currentRoute, item.href));

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
          active={isActiveRoute(pathname, currentRoute, item.href, exactQueryMatch)}
        />
      ))}
    </div>
  );
}

function isActiveRoute(
  pathname: string,
  currentRoute: string,
  href: string,
  exactQueryMatch: boolean,
) {
  if (href === '#') return false;
  const route = normalizeNavigationHref(href);
  if (route.search) return currentRoute === route.fullPath;
  if (exactQueryMatch && pathname === route.pathname) return false;
  return pathname === route.pathname || pathname.startsWith(`${route.pathname}/`);
}

function isExactQueryRoute(currentRoute: string, href: string) {
  const route = normalizeNavigationHref(href);
  return Boolean(route.search) && currentRoute === route.fullPath;
}

function normalizeNavigationHref(href: string) {
  const withoutHash = href.split('#')[0] ?? '';
  const [pathname, search = ''] = withoutHash.split('?');
  return {
    pathname,
    search,
    fullPath: search ? `${pathname}?${search}` : pathname,
  };
}
