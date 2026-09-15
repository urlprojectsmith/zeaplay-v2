export interface AuthenticatedUser {
  id: string;
  email: string;
}

export interface RequestWithAuth {
  user?: AuthenticatedUser;
  tenant?: TenantContext;
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  get?: (name: string) => string | undefined;
}

export interface TenantContext {
  userId: string;
  organizationId: string;
  membershipId: string;
  roleId: string;
  roleName: string;
  permissions: string[];
}
