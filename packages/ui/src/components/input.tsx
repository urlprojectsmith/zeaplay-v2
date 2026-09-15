'use client';

import * as React from 'react';
import { cn } from '../lib/cn';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  description?: string;
  error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, id, label, description, error, required, ...props }, ref) => {
    const generatedId = React.useId();
    const inputId = id ?? generatedId;
    const describedBy = [
      description ? `${inputId}-description` : null,
      error ? `${inputId}-error` : null,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <div className="grid gap-1.5">
        {label ? (
          <label className="text-sm font-semibold text-[hsl(var(--foreground))]" htmlFor={inputId}>
            {label}
            {required ? <span className="text-[hsl(var(--danger))]"> *</span> : null}
          </label>
        ) : null}
        <input
          ref={ref}
          id={inputId}
          required={required}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy || undefined}
          className={cn(
            'h-10 rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--surface))] px-3 text-sm text-[hsl(var(--foreground))] outline-none transition-colors placeholder:text-[hsl(var(--muted-foreground))] focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:cursor-not-allowed disabled:opacity-60',
            error && 'border-[hsl(var(--danger))]',
            className,
          )}
          {...props}
        />
        {description ? (
          <p id={`${inputId}-description`} className="text-xs text-[hsl(var(--muted-foreground))]">
            {description}
          </p>
        ) : null}
        {error ? (
          <p id={`${inputId}-error`} className="text-xs font-semibold text-[hsl(var(--danger))]">
            {error}
          </p>
        ) : null}
      </div>
    );
  },
);
Input.displayName = 'Input';
