import * as React from 'react';
import { cn } from '../lib/cn';

export function Pagination({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <nav
      aria-label="Pagination"
      className={cn('flex items-center justify-between gap-3 text-sm', className)}
      {...props}
    />
  );
}
