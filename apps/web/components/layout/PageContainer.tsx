import { cn } from '@zea-play/ui';

export function PageContainer({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'safe-area-x mx-auto grid w-full max-w-7xl gap-5 py-5 sm:gap-6 sm:px-6 sm:py-6 lg:px-8',
        className,
      )}
      {...props}
    />
  );
}
