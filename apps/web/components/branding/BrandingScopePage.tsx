'use client';

import type { AnalyticsScopeType } from '../../services/analytics';
import { useSessionStore } from '../../stores/session';
import { PageContainer } from '../layout/PageContainer';
import { PageHeader } from '../layout/PageHeader';
import { BrandingSettingsPanel } from './BrandingSettingsPanel';

const platformScopeId = '00000000-0000-0000-0000-000000000000';

export function BrandingScopePage({ scope }: { scope: AnalyticsScopeType }) {
  const scopeId = useSessionStore((state) => {
    if (scope === 'SUPER_AGENCY') return state.selectedSuperAgencyId;
    if (scope === 'AGENCY') return state.selectedAgencyId;
    if (scope === 'WORKSPACE') return state.selectedWorkspaceId;
    return platformScopeId;
  });
  return (
    <PageContainer>
      <PageHeader title="Branding" description={`${scopeTitle(scope)} white-label settings`} />
      <BrandingSettingsPanel scope={scope} scopeId={scopeId} />
    </PageContainer>
  );
}

function scopeTitle(scope: AnalyticsScopeType) {
  if (scope === 'SUPER_AGENCY') return 'Super Agency';
  if (scope === 'AGENCY') return 'Agency';
  if (scope === 'WORKSPACE') return 'Workspace';
  return 'Platform';
}
