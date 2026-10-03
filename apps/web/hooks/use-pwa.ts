'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  PWA_INSTALL_DISMISSED_KEY,
  type BeforeInstallPromptEvent,
  getPwaCapabilities,
  isStandaloneMode,
  registerPwaServiceWorker,
  requestServiceWorkerUpdate,
  resolveInstallPlatform,
} from '../services/pwa';
import { PWA_VERSION } from '../services/pwa-policy';

export function usePwa() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [online, setOnline] = useState(true);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [controllerChanged, setControllerChanged] = useState(false);
  const [platform, setPlatform] = useState<'browser' | 'ios' | 'unsupported'>('unsupported');
  const [capabilities, setCapabilities] = useState({
    serviceWorker: false,
    push: false,
    notifications: false,
  });

  useEffect(() => {
    setOnline(navigator.onLine);
    setInstalled(isStandaloneMode());
    setPlatform(resolveInstallPlatform());
    setDismissed(localStorage.getItem(PWA_INSTALL_DISMISSED_KEY) === 'true');
    setCapabilities(getPwaCapabilities());

    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
      setPlatform('browser');
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
      localStorage.removeItem(PWA_INSTALL_DISMISSED_KEY);
      setDismissed(false);
    };
    const onDisplayModeChange = () => setInstalled(isStandaloneMode());

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);
    const displayMode = window.matchMedia?.('(display-mode: standalone)');
    displayMode?.addEventListener('change', onDisplayModeChange);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
      displayMode?.removeEventListener('change', onDisplayModeChange);
    };
  }, []);

  useEffect(() => {
    void registerPwaServiceWorker((nextRegistration) => {
      setRegistration(nextRegistration);
      setUpdateAvailable(true);
    }).then((nextRegistration) => {
      if (nextRegistration) setRegistration(nextRegistration);
    });
  }, []);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined;
    const onControllerChange = () => setControllerChanged(true);
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    return () =>
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
  }, []);

  const promptInstall = useCallback(async () => {
    if (!installPrompt) return false;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstallPrompt(null);
    if (choice.outcome === 'dismissed') {
      localStorage.setItem(PWA_INSTALL_DISMISSED_KEY, 'true');
      setDismissed(true);
    }
    return choice.outcome === 'accepted';
  }, [installPrompt]);

  const dismissInstall = useCallback(() => {
    localStorage.setItem(PWA_INSTALL_DISMISSED_KEY, 'true');
    setDismissed(true);
  }, []);

  const refreshForUpdate = useCallback(() => {
    requestServiceWorkerUpdate(registration);
    if (!registration?.waiting) window.location.reload();
  }, [registration]);

  return useMemo(
    () => ({
      version: PWA_VERSION,
      capabilities,
      canInstall: Boolean(installPrompt && !installed && !dismissed),
      showIosInstall: platform === 'ios' && !installed && !dismissed,
      installed,
      online,
      updateAvailable,
      controllerChanged,
      platform,
      promptInstall,
      dismissInstall,
      refreshForUpdate,
    }),
    [
      controllerChanged,
      dismissInstall,
      installed,
      installPrompt,
      online,
      platform,
      promptInstall,
      refreshForUpdate,
      updateAvailable,
      dismissed,
      capabilities,
    ],
  );
}

export type PwaState = ReturnType<typeof usePwa>;
