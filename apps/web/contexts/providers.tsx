'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@zea-play/ui';
import { BrandProvider } from '../components/branding/BrandProvider';
import { LanguageProvider } from './language-provider';
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
            <TooltipProvider delayDuration={250}>{children}</TooltipProvider>
            <Toaster richColors position="top-right" />
          </BrandProvider>
        </LanguageProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
