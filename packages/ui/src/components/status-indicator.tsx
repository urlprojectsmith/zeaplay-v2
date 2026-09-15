import { cn } from '../lib/cn';

const tones = {
  success: 'bg-[hsl(var(--success))]',
  warning: 'bg-[hsl(var(--warning))]',
  danger: 'bg-[hsl(var(--danger))]',
  info: 'bg-[hsl(var(--info))]',
  neutral: 'bg-[hsl(var(--muted-foreground))]',
};

export function StatusIndicator({
  tone = 'neutral',
  label,
}: {
  tone?: keyof typeof tones;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
      <span aria-hidden="true" className={cn('h-2.5 w-2.5 rounded-full', tones[tone])} />
      {label}
    </span>
  );
}
