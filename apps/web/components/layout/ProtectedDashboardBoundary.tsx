'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSessionStore } from '../../stores/session';
import { DashboardSkeleton } from './loading-states';

export function ProtectedDashboardBoundary({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { accessToken, hydrated, hydrate, user } = useSessionStore();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (hydrated && !accessToken) router.replace('/login');
  }, [accessToken, hydrated, router]);

  if (!hydrated || !accessToken || !user) return <DashboardSkeleton />;

  return <>{children}</>;
}
