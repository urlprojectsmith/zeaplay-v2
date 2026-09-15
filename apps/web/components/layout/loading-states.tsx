import { Card, CardContent, CardHeader, Skeleton } from '@zea-play/ui';

export function CardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-4 w-56" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-24 w-full" />
      </CardContent>
    </Card>
  );
}

export function TableSkeleton() {
  return <Skeleton className="h-64 w-full" />;
}

export function PageSkeleton() {
  return (
    <div className="grid gap-6 p-6">
      <Skeleton className="h-8 w-64" />
      <div className="grid gap-4 md:grid-cols-3">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <main className="min-h-screen bg-[hsl(var(--background))]">
      <PageSkeleton />
    </main>
  );
}
