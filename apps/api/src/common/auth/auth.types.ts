export interface AuthenticatedUser {
  id: string;
  email: string;
}

export interface RequestWithAuth {
  user?: AuthenticatedUser;
  tenant?: WorkspaceTenantContext;
  workspaceTenant?: WorkspaceTenantContext;
  agencyTenant?: AgencyTenantContext;
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  get?: (name: string) => string | undefined;
}

export type WorkspaceAccessSource = 'WORKSPACE_MEMBERSHIP' | 'AGENCY_ADMINISTRATION';

export interface AgencyTenantContext {
  userId: string;
  agencyId: string;
  agencyMembershipId: string;
  roleId: string;
  roleName: string;
  permissions: string[];
}

export interface WorkspaceTenantContext {
  userId: string;
  agencyId: string;
  workspaceId: string;
  workspaceMembershipId: string | null;
  agencyMembershipId: string | null;
  roleId: string;
  roleName: string;
  permissions: string[];
  accessSource: WorkspaceAccessSource;
}

export type TenantContext = WorkspaceTenantContext;
