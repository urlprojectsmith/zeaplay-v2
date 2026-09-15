import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn';

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold',
  {
    variants: {
      variant: {
        default: 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]',
        success: 'bg-[hsl(var(--success)/0.14)] text-[hsl(var(--success))]',
        warning: 'bg-[hsl(var(--warning)/0.16)] text-[hsl(var(--warning))]',
        danger: 'bg-[hsl(var(--danger)/0.14)] text-[hsl(var(--danger))]',
        info: 'bg-[hsl(var(--info)/0.14)] text-[hsl(var(--info))]',
        neutral: 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
