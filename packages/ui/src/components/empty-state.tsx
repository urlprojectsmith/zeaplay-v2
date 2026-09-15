import * as React from 'react';
import { cn } from '../lib/cn';

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid justify-items-center gap-3 rounded-lg border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-8 text-center',
        className,
      )}
    >
      <h3 className="text-base font-semibold">{title}</h3>
      {description ? (
        <p className="max-w-md text-sm text-[hsl(var(--muted-foreground))]">{description}</p>
      ) : null}
      {action ? <div>{action}</div> : null}
    </div>
  );
}
