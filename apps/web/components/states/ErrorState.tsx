'use client';

import { Button, Card, CardContent, CardHeader, CardTitle } from '@zea-play/ui';

export function ErrorState({
  title = 'Something went wrong',
  description = 'The page could not be loaded. Please try again.',
  action,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <Card className="mx-auto mt-12 max-w-xl">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm text-[hsl(var(--muted-foreground))]">{description}</p>
        {action ?? (
          <Button type="button" onClick={() => window.location.reload()}>
            Try again
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function PermissionDeniedState() {
  return (
    <ErrorState
      title="Permission denied"
      description="This area is waiting for backend authorization for your account."
    />
  );
}

export function SessionExpiredState() {
  return <ErrorState title="Session expired" description="Please sign in again to continue." />;
}
