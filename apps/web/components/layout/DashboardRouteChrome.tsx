'use client';

import { DashboardShell } from './DashboardShell';
import { ProtectedDashboardBoundary } from './ProtectedDashboardBoundary';
import { CommercialFeatureBoundary } from './CommercialFeatureBoundary';
import { dashboardConfigs, type DashboardScope } from '../navigation/navigation-config';

export function DashboardRouteChrome({
  scope,
  children,
}: {
  scope: DashboardScope;
  children: React.ReactNode;
}) {
  const config = dashboardConfigs[scope];
  return (
    <ProtectedDashboardBoundary>
      <DashboardShell config={config}>
        <CommercialFeatureBoundary scope={scope}>{children}</CommercialFeatureBoundary>
      </DashboardShell>
    </ProtectedDashboardBoundary>
  );
}
