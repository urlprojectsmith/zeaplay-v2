'use client';

import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@zea-play/ui';
import { BrandProvider } from '../components/branding/BrandProvider';
import { useSessionStore } from '../stores/session';
import { LanguageProvider } from './language-provider';
import { PwaProvider } from './pwa-provider';
import { RealtimeProvider } from './realtime-provider';
import { ThemeProvider } from './theme-provider';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry(failureCount, error) {
              const status =
                typeof error === 'object' && error && 'status' in error
                  ? Number((error as { status?: unknown }).status)
                  : undefined;
              if (status && [400, 401, 403, 404, 422].includes(status)) return false;
              return failureCount < 2;
            },
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <LanguageProvider>
          <BrandProvider>
            <RealtimeProvider>
              <SessionQueryBoundary />
              <PwaProvider>
                <TooltipProvider delayDuration={250}>{children}</TooltipProvider>
              </PwaProvider>
            </RealtimeProvider>
            <Toaster richColors position="top-right" />
          </BrandProvider>
        </LanguageProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function SessionQueryBoundary() {
  const queryClient = useQueryClient();
  const hydrated = useSessionStore((state) => state.hydrated);
  const accessToken = useSessionStore((state) => state.accessToken);
  const selectedSuperAgencyId = useSessionStore((state) => state.selectedSuperAgencyId);
  const selectedAgencyId = useSessionStore((state) => state.selectedAgencyId);
  const selectedWorkspaceId = useSessionStore((state) => state.selectedWorkspaceId);
  const previousTenantKey = useRef<string | null>(null);

  useEffect(() => {
    if (hydrated && !accessToken) queryClient.clear();
  }, [accessToken, hydrated, queryClient]);

  useEffect(() => {
    function clearTenantCache() {
      queryClient.clear();
    }
    window.addEventListener('zea-play-tenant-changing', clearTenantCache);
    return () => window.removeEventListener('zea-play-tenant-changing', clearTenantCache);
  }, [queryClient]);

  useEffect(() => {
    if (!hydrated || !accessToken) return;
    const tenantKey = [selectedSuperAgencyId, selectedAgencyId, selectedWorkspaceId].join(':');
    if (previousTenantKey.current === null) {
      previousTenantKey.current = tenantKey;
      return;
    }
    if (previousTenantKey.current !== tenantKey) {
      previousTenantKey.current = tenantKey;
      queryClient.clear();
    }
  }, [
    accessToken,
    hydrated,
    queryClient,
    selectedAgencyId,
    selectedSuperAgencyId,
    selectedWorkspaceId,
  ]);

  return null;
}
