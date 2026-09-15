'use client';

import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  StatusIndicator,
} from '@zea-play/ui';
import { useLanguage } from '../../contexts/language-provider';
import { useTheme } from '../../contexts/theme-provider';
import { useSessionStore } from '../../stores/session';
import { PageContainer } from '../layout/PageContainer';
import { PageHeader } from '../layout/PageHeader';
import { dashboardConfigs, type DashboardScope } from '../navigation/navigation-config';
import { AgencySwitcher } from '../navigation/AgencySwitcher';
import { WorkspaceSwitcher } from '../navigation/WorkspaceSwitcher';

export function DashboardFoundation({ scope }: { scope: DashboardScope }) {
  const config = dashboardConfigs[scope];
  const { theme } = useTheme();
  const { locale, t } = useLanguage();
  const { user, agencies, selectedAgencyId, selectedWorkspaceId } = useSessionStore();
  const selectedAgency = agencies.find((agency) => agency.id === selectedAgencyId);
  const selectedWorkspace = selectedAgency?.workspaces.find(
    (workspace) => workspace.id === selectedWorkspaceId,
  );
  const navItems = config.groups.flatMap((group) => group.items);

  return (
    <PageContainer>
      <PageHeader
        title={config.title}
        description={config.description}
        actions={<Badge variant="success">{t(locale, 'dashboard.foundationReady')}</Badge>}
      />
      {config.requiresPlatformScope ? (
        <EmptyState
          title="Backend authorization pending"
          description={t(locale, 'dashboard.noBackendScope')}
        />
      ) : null}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>{t(locale, 'dashboard.sessionStatus')}</CardTitle>
            <CardDescription>{user?.email}</CardDescription>
          </CardHeader>
          <CardContent>
            <StatusIndicator tone="success" label={t(locale, 'dashboard.signedIn')} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t(locale, 'dashboard.selectedContext')}</CardTitle>
            <CardDescription>{selectedAgency?.name ?? 'No agency selected'}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              {selectedWorkspace?.name ?? 'No workspace selected'}
            </p>
            <div className="grid gap-3">
              <AgencySwitcher />
              {scope === 'workspace' ? <WorkspaceSwitcher /> : null}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t(locale, 'common.theme')}</CardTitle>
            <CardDescription>
              {t(locale, `dashboard.${theme}`)} / {t(locale, 'dashboard.languageValue')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <span className="h-8 w-8 rounded-full bg-[hsl(var(--xp))]" aria-hidden="true" />
              <span className="h-8 w-8 rounded-full bg-[hsl(var(--gold))]" aria-hidden="true" />
              <span
                className="h-8 w-8 rounded-full bg-[hsl(var(--achievement))]"
                aria-hidden="true"
              />
            </div>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t(locale, 'dashboard.navigationModules')}</CardTitle>
          <CardDescription>
            Configured for Phase 6 visibility and feature-entitlement filtering.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {navItems.map((item) => (
            <Badge
              key={`${item.labelKey}-${item.href}`}
              variant={item.disabled ? 'neutral' : 'default'}
            >
              {t(locale, item.labelKey)}
            </Badge>
          ))}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
