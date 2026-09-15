'use client';

import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as React from 'react';
import { cn } from '../lib/cn';

export function Switch({
  label,
  description,
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> & {
  label?: string;
  description?: string;
}) {
  const id = React.useId();
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="grid gap-0.5">
        {label ? (
          <label htmlFor={id} className="text-sm font-semibold">
            {label}
          </label>
        ) : null}
        {description ? (
          <p className="text-xs text-[hsl(var(--muted-foreground))]">{description}</p>
        ) : null}
      </div>
      <SwitchPrimitive.Root
        id={id}
        className={cn(
          'h-6 w-10 rounded-full bg-[hsl(var(--muted))] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] data-[state=checked]:bg-[hsl(var(--primary))]',
          className,
        )}
        {...props}
      >
        <SwitchPrimitive.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px]" />
      </SwitchPrimitive.Root>
    </div>
  );
}
