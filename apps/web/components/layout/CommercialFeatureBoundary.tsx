'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  buttonVariants,
} from '@zea-play/ui';
import { LockKeyhole } from 'lucide-react';
import { useLanguage } from '../../contexts/language-provider';
import { featureEnabled, resolveRouteFeature } from '../navigation/commercial-entitlements';
import type { DashboardScope } from '../navigation/navigation-config';
import { useCommercialEntitlements } from '../navigation/use-commercial-entitlements';
import { PageContainer } from './PageContainer';

export function CommercialFeatureBoundary({
  scope,
  children,
}: {
  scope: DashboardScope;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { locale, t } = useLanguage();
  const entitlements = useCommercialEntitlements(scope);
  const routeFeature = resolveRouteFeature(scope, pathname);

  if (
    !routeFeature ||
    entitlements.isLoading ||
    entitlements.isFetching ||
    featureEnabled(entitlements.data, routeFeature.featureKey)
  ) {
    return <>{children}</>;
  }

  return (
    <PageContainer>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[hsl(var(--warning)/0.12)] text-[hsl(var(--warning))]">
                <LockKeyhole aria-hidden="true" className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <CardTitle>{t(locale, 'commercial.featureLocked')}</CardTitle>
                <CardDescription>{t(locale, 'commercial.unavailableCurrentPlan')}</CardDescription>
              </div>
            </div>
            <Badge variant="warning">{t(locale, 'commercial.locked')}</Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3">
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {scope === 'super-agency'
              ? t(locale, 'commercial.managePlanDescription')
              : t(locale, 'commercial.contactBillingAdmin')}
          </p>
          {scope === 'super-agency' ? (
            <Link className={buttonVariants({ variant: 'primary' })} href="/super-agency/billing">
              {t(locale, 'commercial.managePlan')}
            </Link>
          ) : null}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
