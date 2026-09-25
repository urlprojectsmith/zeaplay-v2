'use client';

import { useQuery } from '@tanstack/react-query';
import {
  billingKeys,
  getAgencyBillingEntitlements,
  getSuperAgencyBillingEntitlements,
  getWorkspaceBillingEntitlements,
} from '../../services/billing';
import { useSessionStore } from '../../stores/session';
import type { DashboardScope } from './navigation-config';

export function useCommercialEntitlements(scope: DashboardScope) {
  const accessToken = useSessionStore((state) => state.accessToken);
  const selectedSuperAgencyId = useSessionStore((state) => state.selectedSuperAgencyId);
  const selectedAgencyId = useSessionStore((state) => state.selectedAgencyId);
  const selectedWorkspaceId = useSessionStore((state) => state.selectedWorkspaceId);

  const superAgencyQuery = useQuery({
    queryKey: billingKeys.superAgencyEntitlements(selectedSuperAgencyId),
    queryFn: () => getSuperAgencyBillingEntitlements(selectedSuperAgencyId as string),
    enabled: Boolean(accessToken && scope === 'super-agency' && selectedSuperAgencyId),
    retry: false,
  });
  const agencyQuery = useQuery({
    queryKey: billingKeys.agencyEntitlements(selectedAgencyId),
    queryFn: () => getAgencyBillingEntitlements(selectedAgencyId as string),
    enabled: Boolean(accessToken && scope === 'agency' && selectedAgencyId),
    retry: false,
  });
  const workspaceQuery = useQuery({
    queryKey: billingKeys.workspaceEntitlements(selectedWorkspaceId),
    queryFn: () => getWorkspaceBillingEntitlements(selectedWorkspaceId as string),
    enabled: Boolean(accessToken && scope === 'workspace' && selectedWorkspaceId),
    retry: false,
  });

  if (scope === 'super-agency') return superAgencyQuery;
  if (scope === 'agency') return agencyQuery;
  if (scope === 'workspace') return workspaceQuery;
  return { data: undefined, isLoading: false, isFetching: false, error: null };
}
