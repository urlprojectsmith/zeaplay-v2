'use client';

import * as React from 'react';
import { cn } from '../lib/cn';

export function Progress({
  value,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { value?: number }) {
  const safeValue = typeof value === 'number' ? Math.max(0, Math.min(100, value)) : undefined;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={safeValue}
      className={cn('h-2 overflow-hidden rounded-full bg-[hsl(var(--surface-muted))]', className)}
      {...props}
    >
      <div
        className="h-full bg-[hsl(var(--primary))] transition-transform motion-reduce:transition-none"
        style={{ transform: `translateX(-${100 - (safeValue ?? 35)}%)` }}
      />
    </div>
  );
}
