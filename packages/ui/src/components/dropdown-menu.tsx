'use client';

import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import * as React from 'react';
import { cn } from '../lib/cn';

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;
export const DropdownMenuLabel = DropdownMenuPrimitive.Label;
export const DropdownMenuSeparator = DropdownMenuPrimitive.Separator;

export function DropdownMenuContent({
  className,
  sideOffset = 8,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          'z-50 max-h-[min(28rem,calc(100dvh-1rem-env(safe-area-inset-top)-env(safe-area-inset-bottom)))] min-w-44 overflow-y-auto rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-elevated))] p-1 text-sm shadow-lg',
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        'flex min-h-10 cursor-default select-none items-center gap-2 rounded px-2 py-2 outline-none focus:bg-[hsl(var(--surface-muted))] data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
