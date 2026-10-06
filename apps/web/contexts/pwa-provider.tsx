'use client';

import { createContext, useContext, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { Button } from '@zea-play/ui';
import { useLanguage } from './language-provider';
import { usePwa, type PwaState } from '../hooks/use-pwa';

const PwaContext = createContext<PwaState | null>(null);

export function PwaProvider({ children }: { children: React.ReactNode }) {
  const state = usePwa();
  const { locale, t } = useLanguage();
  const wasOnline = useRef<boolean | null>(null);
  const updateToastShown = useRef(false);

  useEffect(() => {
    if (!state.updateAvailable) return;
    if (updateToastShown.current) return;
    updateToastShown.current = true;
    toast(t(locale, 'pwa.updateAvailable'), {
      action: {
        label: t(locale, 'pwa.refresh'),
        onClick: state.refreshForUpdate,
      },
      duration: Number.POSITIVE_INFINITY,
    });
  }, [locale, state.refreshForUpdate, state.updateAvailable, t]);

  useEffect(() => {
    if (state.controllerChanged) window.location.reload();
  }, [state.controllerChanged]);

  useEffect(() => {
    if (wasOnline.current === null) {
      wasOnline.current = state.online;
      return;
    }
    if (wasOnline.current === state.online) return;
    wasOnline.current = state.online;
    if (state.online) {
      toast.success(t(locale, 'pwa.backOnline'));
      return;
    }
    toast.warning(t(locale, 'pwa.offline'));
  }, [locale, state.online, t]);

  return (
    <PwaContext.Provider value={state}>
      {children}
      <div aria-live="polite" className="sr-only">
        {state.online ? t(locale, 'pwa.backOnline') : t(locale, 'pwa.offline')}
      </div>
      {!state.online ? (
        <div
          className="safe-area-bottom fixed inset-x-3 bottom-0 z-50 mx-auto flex max-w-xl flex-wrap items-center justify-between gap-3 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-elevated))] px-4 py-3 text-sm shadow-lg sm:bottom-3"
          role="status"
        >
          <span className="min-w-0 flex-1">{t(locale, 'pwa.offlineDetail')}</span>
          {state.updateAvailable ? (
            <Button size="sm" type="button" variant="outline" onClick={state.refreshForUpdate}>
              {t(locale, 'pwa.refresh')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </PwaContext.Provider>
  );
}

export function usePwaContext() {
  const value = useContext(PwaContext);
  if (!value) throw new Error('usePwaContext must be used within PwaProvider');
  return value;
}
