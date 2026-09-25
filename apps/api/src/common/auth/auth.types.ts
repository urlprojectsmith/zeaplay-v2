export interface AuthenticatedUser {
  id: string;
  email: string;
}

export interface RequestWithAuth {
  user?: AuthenticatedUser;
  tenant?: WorkspaceTenantContext;
  workspaceTenant?: WorkspaceTenantContext;
  agencyTenant?: AgencyTenantContext;
  superAgencyTenant?: SuperAgencyTenantContext;
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  get?: (name: string) => string | undefined;
}

export type WorkspaceAccessSource = 'WORKSPACE_MEMBERSHIP' | 'AGENCY_ADMINISTRATION';

export interface AgencyTenantContext {
  userId: string;
  superAgencyId?: string;
  agencyId: string;
  agencyMembershipId: string;
  roleId: string;
  roleName: string;
  permissions: string[];
}

export interface WorkspaceTenantContext {
  userId: string;
  superAgencyId?: string;
  agencyId: string;
  workspaceId: string;
  workspaceMembershipId: string | null;
  agencyMembershipId: string | null;
  roleId: string;
  roleName: string;
  permissions: string[];
  accessSource: WorkspaceAccessSource;
}

export interface SuperAgencyTenantContext {
  userId: string;
  superAgencyId: string;
  superAgencyMembershipId: string;
  roleId: string;
  roleName: string;
  permissions: string[];
  status: string;
}

export type TenantContext = WorkspaceTenantContext;
