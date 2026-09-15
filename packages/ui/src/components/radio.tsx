'use client';

import * as RadioPrimitive from '@radix-ui/react-radio-group';
import * as React from 'react';
import { cn } from '../lib/cn';

export const RadioGroup = RadioPrimitive.Root;

export function RadioItem({
  label,
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof RadioPrimitive.Item> & { label: string }) {
  const id = React.useId();
  return (
    <div className="flex items-center gap-2">
      <RadioPrimitive.Item
        id={id}
        className={cn(
          'h-4 w-4 rounded-full border border-[hsl(var(--input))] bg-[hsl(var(--surface))] outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] data-[state=checked]:border-[hsl(var(--primary))]',
          className,
        )}
        {...props}
      >
        <RadioPrimitive.Indicator className="flex h-full w-full items-center justify-center after:block after:h-2 after:w-2 after:rounded-full after:bg-[hsl(var(--primary))]" />
      </RadioPrimitive.Item>
      <label className="text-sm font-semibold" htmlFor={id}>
        {label}
      </label>
    </div>
  );
}
