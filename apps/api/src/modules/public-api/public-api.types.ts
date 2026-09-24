import type { WorkspaceTenantContext } from '../../common/auth/auth.types';
import type { PublicApiScope } from './public-api.constants';

export interface PublicApiPrincipal {
  apiKeyId: string;
  workspaceId: string;
  agencyId: string;
  createdByMembershipId: string;
  createdByUserId: string;
  prefix: string;
  scopes: PublicApiScope[];
  tenant: WorkspaceTenantContext;
}

export interface PublicApiRequest {
  publicApi?: PublicApiPrincipal;
  tenant?: WorkspaceTenantContext;
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
}
