'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useSessionStore } from '../../stores/session';

export function ProtectedDashboard() {
  const router = useRouter();
  const {
    accessToken,
    user,
    organizations,
    organizationId,
    hydrated,
    hydrate,
    logout,
    setOrganization,
  } = useSessionStore();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (hydrated && !accessToken) router.replace('/login');
  }, [accessToken, hydrated, router]);

  if (!hydrated || !accessToken || !user) {
    return <main className="page-shell">Loading...</main>;
  }

  const selected = organizations.find((organization) => organization.id === organizationId);

  return (
    <main className="page-shell">
      <section className="dashboard-header">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1>{selected?.name ?? 'Zea Play'}</h1>
          <p>{user.email}</p>
        </div>
        <button type="button" onClick={() => void logout()}>
          Logout
        </button>
      </section>

      <section className="dashboard-section">
        <label>
          Organization
          <select
            value={organizationId ?? ''}
            onChange={(event) => setOrganization(event.target.value)}
          >
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name} ({organization.role})
              </option>
            ))}
          </select>
        </label>
        <Link className="text-link" href={'/dashboard/projects' as Route}>
          Open projects
        </Link>
      </section>
    </main>
  );
}
