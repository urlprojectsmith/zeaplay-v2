'use client';

import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import * as React from 'react';
import { cn } from '../lib/cn';

export function Checkbox({
  className,
  label,
  description,
  error,
  ...props
}: React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> & {
  label?: string;
  description?: string;
  error?: string;
}) {
  const id = React.useId();
  return (
    <div className="grid gap-1.5">
      <div className="flex items-start gap-2">
        <CheckboxPrimitive.Root
          id={id}
          className={cn(
            'mt-0.5 flex h-4 w-4 items-center justify-center rounded border border-[hsl(var(--input))] bg-[hsl(var(--surface))] outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] data-[state=checked]:bg-[hsl(var(--primary))] data-[state=checked]:text-[hsl(var(--primary-foreground))]',
            className,
          )}
          {...props}
        >
          <CheckboxPrimitive.Indicator>
            <Check className="h-3 w-3" />
          </CheckboxPrimitive.Indicator>
        </CheckboxPrimitive.Root>
        {label ? (
          <label htmlFor={id} className="text-sm font-semibold">
            {label}
          </label>
        ) : null}
      </div>
      {description ? (
        <p className="pl-6 text-xs text-[hsl(var(--muted-foreground))]">{description}</p>
      ) : null}
      {error ? (
        <p className="pl-6 text-xs font-semibold text-[hsl(var(--danger))]">{error}</p>
      ) : null}
    </div>
  );
}
