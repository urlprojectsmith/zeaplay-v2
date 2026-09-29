'use client';

import { useMemo } from 'react';
import { useSessionStore } from '../../stores/session';

export function useWorkspacePermissions(
  workspaceId: string | null,
  roles: Array<{ id: string; key?: string; permissions: Array<{ key: string }> }>,
) {
  const agencies = useSessionStore((state) => state.agencies);
  const accountContextPermissions = useSessionStore((state) => state.accountContextPermissions);

  return useMemo(() => {
    const workspace = agencies
      .flatMap((agency) => agency.workspaces)
      .find((item) => item.id === workspaceId);
    const role = roles.find(
      (item) =>
        item.id === workspace?.role || item.key?.toLowerCase() === workspace?.role?.toLowerCase(),
    );
    if (role) return new Set(role.permissions.map((permission) => permission.key));
    if (accountContextPermissions.length > 0) return new Set(accountContextPermissions);
    return new Set<string>();
  }, [accountContextPermissions, agencies, roles, workspaceId]);
}
