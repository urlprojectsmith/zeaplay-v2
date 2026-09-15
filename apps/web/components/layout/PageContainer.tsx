import { cn } from '@zea-play/ui';

export function PageContainer({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:px-8', className)}
      {...props}
    />
  );
}
