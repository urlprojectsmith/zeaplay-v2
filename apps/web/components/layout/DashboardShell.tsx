'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { AppHeader } from './AppHeader';
import { AppSidebar } from './AppSidebar';
import { MobileSidebar } from './MobileSidebar';
import type { DashboardConfig } from '../navigation/navigation-config';
import { listWorkspaceRoles, rolesKeys } from '../../services/workspace-roles';
import { useSessionStore } from '../../stores/session';

const storageKey = 'zea-play-sidebar-collapsed';

export function DashboardShell({
  config,
  children,
}: {
  config: DashboardConfig;
  children: React.ReactNode;
}) {
  const accessToken = useSessionStore((state) => state.accessToken);
  const selectedWorkspaceId = useSessionStore((state) => state.selectedWorkspaceId);
  const selectedWorkspace = useSessionStore((state) =>
    state.agencies
      .flatMap((agency) => agency.workspaces)
      .find((workspace) => workspace.id === state.selectedWorkspaceId),
  );
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const rolesQuery = useQuery({
    queryKey: rolesKeys.all(selectedWorkspaceId),
    queryFn: () => listWorkspaceRoles(selectedWorkspaceId as string),
    enabled: Boolean(accessToken && selectedWorkspaceId && config.scope === 'workspace'),
  });
  const filteredConfig =
    config.scope === 'workspace'
      ? {
          ...config,
          groups: config.groups
            .map((group) => ({
              ...group,
              items: group.items.filter((item) => {
                if (!item.requiredPermissions?.length) return true;
                const role = rolesQuery.data?.find(
                  (candidate) =>
                    candidate.id === selectedWorkspace?.role ||
                    candidate.key === selectedWorkspace?.role,
                );
                const permissions = new Set(
                  role?.permissions.map((permission) => permission.key) ?? [],
                );
                return (
                  permissions.has('*') ||
                  item.requiredPermissions.every((permission) => permissions.has(permission))
                );
              }),
            }))
            .filter((group) => group.items.length > 0),
        }
      : config;

  useEffect(() => {
    setCollapsed(localStorage.getItem(storageKey) === 'true');
  }, []);

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      localStorage.setItem(storageKey, String(next));
      return next;
    });
  }

  return (
    <div className="flex min-h-screen bg-[hsl(var(--background))] text-[hsl(var(--foreground))]">
      <AppSidebar config={filteredConfig} collapsed={collapsed} />
      <MobileSidebar config={filteredConfig} open={mobileOpen} onOpenChange={setMobileOpen} />
      <div className="min-w-0 flex-1">
        <AppHeader
          config={filteredConfig}
          collapsed={collapsed}
          onOpenMobile={() => setMobileOpen(true)}
          onToggleCollapsed={toggleCollapsed}
        />
        {children}
      </div>
    </div>
  );
}
