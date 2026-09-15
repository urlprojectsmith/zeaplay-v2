'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { Badge, Tooltip, TooltipContent, TooltipTrigger, cn } from '@zea-play/ui';
import { useLanguage } from '../../contexts/language-provider';
import type { NavigationItemConfig } from './navigation-config';

export function NavigationItem({
  item,
  collapsed,
  active,
}: {
  item: NavigationItemConfig;
  collapsed: boolean;
  active: boolean;
}) {
  const { locale, t } = useLanguage();
  const Icon = item.icon;
  const label = t(locale, item.labelKey);
  const content = (
    <span
      className={cn(
        'flex h-10 w-full items-center gap-3 rounded-md px-3 text-sm font-semibold transition-colors',
        active
          ? 'bg-[hsl(var(--sidebar-active))] text-white'
          : 'text-[hsl(var(--sidebar-foreground))] hover:bg-white/10',
        item.disabled && 'cursor-not-allowed opacity-55',
        collapsed && 'justify-center px-0',
      )}
      aria-disabled={item.disabled}
    >
      <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
      {collapsed ? null : <span className="truncate">{label}</span>}
      {!collapsed && item.badge ? <Badge variant="neutral">{item.badge}</Badge> : null}
    </span>
  );

  const wrapped = item.disabled ? (
    <span>{content}</span>
  ) : (
    <Link href={item.href as Route} aria-current={active ? 'page' : undefined}>
      {content}
    </Link>
  );

  if (!collapsed) return wrapped;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{wrapped}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
