'use client';

import type { AnalyticsScopeType } from '../../services/analytics';
import { useSessionStore } from '../../stores/session';
import { PageContainer } from '../layout/PageContainer';
import { PageHeader } from '../layout/PageHeader';
import { CustomDomainSettingsPanel } from './CustomDomainSettingsPanel';

export function CustomDomainScopePage({ scope }: { scope: AnalyticsScopeType }) {
  const scopeId = useSessionStore((state) => {
    if (scope === 'SUPER_AGENCY') return state.selectedSuperAgencyId;
    if (scope === 'AGENCY') return state.selectedAgencyId;
    if (scope === 'WORKSPACE') return state.selectedWorkspaceId;
    return null;
  });
  return (
    <PageContainer>
      <PageHeader title="Custom Domains" description={`${scopeTitle(scope)} domain settings`} />
      <CustomDomainSettingsPanel scope={scope} scopeId={scopeId} />
    </PageContainer>
  );
}

function scopeTitle(scope: AnalyticsScopeType) {
  if (scope === 'SUPER_AGENCY') return 'Super Agency';
  if (scope === 'AGENCY') return 'Agency';
  if (scope === 'WORKSPACE') return 'Workspace';
  return 'Platform';
}
