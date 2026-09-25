'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { Badge, Tooltip, TooltipContent, TooltipTrigger, cn } from '@zea-play/ui';
import { LockKeyhole } from 'lucide-react';
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
        item.locked &&
          'cursor-not-allowed border border-[hsl(var(--warning)/0.36)] bg-[hsl(var(--warning)/0.08)]',
        collapsed && 'justify-center px-0',
      )}
      aria-disabled={item.disabled || item.locked}
      title={item.locked ? t(locale, 'commercial.unavailableCurrentPlan') : undefined}
    >
      <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
      {collapsed ? null : <span className="truncate">{label}</span>}
      {!collapsed && item.badge ? <Badge variant="neutral">{item.badge}</Badge> : null}
      {!collapsed && item.locked ? (
        <LockKeyhole aria-label={t(locale, 'commercial.featureLocked')} className="h-3.5 w-3.5" />
      ) : null}
    </span>
  );

  const wrapped =
    item.disabled || item.locked ? (
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
      <TooltipContent side="right">
        {item.locked ? `${label}: ${t(locale, 'commercial.unavailableCurrentPlan')}` : label}
      </TooltipContent>
    </Tooltip>
  );
}
