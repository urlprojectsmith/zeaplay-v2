'use client';

import * as React from 'react';
import { cn } from '../lib/cn';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  description?: string;
  error?: string;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, id, label, description, error, required, ...props }, ref) => {
    const generatedId = React.useId();
    const textareaId = id ?? generatedId;
    return (
      <div className="grid gap-1.5">
        {label ? (
          <label className="text-sm font-semibold" htmlFor={textareaId}>
            {label}
            {required ? <span className="text-[hsl(var(--danger))]"> *</span> : null}
          </label>
        ) : null}
        <textarea
          ref={ref}
          id={textareaId}
          required={required}
          aria-invalid={Boolean(error)}
          className={cn(
            'min-h-24 rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--surface))] px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:cursor-not-allowed disabled:opacity-60',
            error && 'border-[hsl(var(--danger))]',
            className,
          )}
          {...props}
        />
        {description ? (
          <p className="text-xs text-[hsl(var(--muted-foreground))]">{description}</p>
        ) : null}
        {error ? <p className="text-xs font-semibold text-[hsl(var(--danger))]">{error}</p> : null}
      </div>
    );
  },
);
Textarea.displayName = 'Textarea';
