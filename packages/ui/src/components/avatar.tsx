import { cn } from '../lib/cn';

export function Avatar({
  name,
  src,
  className,
}: {
  name: string;
  src?: string | null;
  className?: string;
}) {
  const initials = name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return src ? (
    <img alt="" className={cn('h-9 w-9 rounded-full object-cover', className)} src={src} />
  ) : (
    <span
      className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded-full bg-[hsl(var(--primary))] text-sm font-bold text-[hsl(var(--primary-foreground))]',
        className,
      )}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}
