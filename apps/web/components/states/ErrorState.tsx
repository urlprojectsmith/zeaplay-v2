'use client';

import { Button, Card, CardContent, CardHeader, CardTitle } from '@zea-play/ui';
import { useLanguage } from '../../contexts/language-provider';

export function ErrorState({
  title,
  description,
  action,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
}) {
  const { locale, t } = useLanguage();
  return (
    <Card className="mx-auto mt-12 max-w-xl">
      <CardHeader>
        <CardTitle>{title ?? t(locale, 'states.somethingWentWrong')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          {description ?? t(locale, 'states.pageLoadFailed')}
        </p>
        {action ?? (
          <Button type="button" onClick={() => window.location.reload()}>
            {t(locale, 'common.tryAgain')}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function PermissionDeniedState() {
  const { locale, t } = useLanguage();
  return (
    <ErrorState
      title={t(locale, 'states.permissionDenied')}
      description={t(locale, 'states.permissionDeniedDescription')}
    />
  );
}

export function SessionExpiredState() {
  const { locale, t } = useLanguage();
  return (
    <ErrorState
      title={t(locale, 'states.sessionExpired')}
      description={t(locale, 'states.sessionExpiredDescription')}
    />
  );
}
