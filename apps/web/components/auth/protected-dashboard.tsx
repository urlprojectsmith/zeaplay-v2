'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@zea-play/ui';
import { useSessionStore } from '../../stores/session';
import { DashboardSkeleton } from '../layout/loading-states';

export function ProtectedDashboard() {
  const router = useRouter();
  const {
    accessToken,
    user,
    agencies,
    selectedAgencyId,
    selectedWorkspaceId,
    hydrated,
    hydrate,
    logout,
    setAgency,
    setWorkspace,
  } = useSessionStore();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (hydrated && !accessToken) router.replace('/login');
  }, [accessToken, hydrated, router]);

  if (!hydrated || !accessToken || !user) {
    return <DashboardSkeleton />;
  }

  const selectedAgency = agencies.find((agency) => agency.id === selectedAgencyId);
  const selectedWorkspace = selectedAgency?.workspaces.find(
    (workspace) => workspace.id === selectedWorkspaceId,
  );

  return (
    <main className="page-shell">
      <section className="dashboard-header">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1>{selectedWorkspace?.name ?? selectedAgency?.name ?? 'Zea Play'}</h1>
          <p>{user.email}</p>
        </div>
        <Button type="button" onClick={() => void logout()}>
          Logout
        </Button>
      </section>

      <Card className="mt-8 max-w-xl">
        <CardHeader>
          <CardTitle>Legacy dashboard route</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <label>
            Agency
            <select
              className="h-10 rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--surface))] px-3"
              value={selectedAgencyId ?? ''}
              onChange={(event) => setAgency(event.target.value)}
            >
              {agencies.map((agency) => (
                <option key={agency.id} value={agency.id}>
                  {agency.name} ({agency.role})
                </option>
              ))}
            </select>
          </label>
          <label>
            Workspace
            <select
              className="h-10 rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--surface))] px-3"
              value={selectedWorkspaceId ?? ''}
              onChange={(event) => setWorkspace(event.target.value)}
            >
              {(selectedAgency?.workspaces ?? []).map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name} ({workspace.role ?? selectedAgency?.role})
                </option>
              ))}
            </select>
          </label>
          <Link className="text-link" href={'/dashboard/projects' as Route}>
            Open projects
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
