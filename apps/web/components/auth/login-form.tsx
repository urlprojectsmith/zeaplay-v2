'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input } from '@zea-play/ui';
import { useSessionStore } from '../../stores/session';
import { BrandLogo } from '../branding/BrandLogo';
import { useLanguage } from '../../contexts/language-provider';

export function LoginForm() {
  const router = useRouter();
  const { locale, t } = useLanguage();
  const login = useSessionStore((state) => state.login);
  const [email, setEmail] = useState('owner@zeaplay.test');
  const [password, setPassword] = useState('DevelopmentPassword123!');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await login(email, password);
      const { selectedSuperAgencyId, selectedWorkspaceId, selectedAgencyId } =
        useSessionStore.getState();
      router.replace(
        selectedSuperAgencyId
          ? '/super-agency'
          : selectedWorkspaceId
            ? '/workspace/dashboard'
            : selectedAgencyId
              ? '/agency/dashboard'
              : '/',
      );
    } catch {
      setError(t(locale, 'publicBranding.signInError'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="auth-panel" onSubmit={(event) => void onSubmit(event)}>
      <div>
        <BrandLogo />
        <h1>{t(locale, 'publicBranding.signInTitle')}</h1>
      </div>
      <Input
        autoComplete="email"
        label={t(locale, 'publicBranding.email')}
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        required
      />
      <Input
        autoComplete="current-password"
        label={t(locale, 'publicBranding.password')}
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        minLength={12}
        required
      />
      {error ? <p className="form-error">{error}</p> : null}
      <Button type="submit" disabled={isSubmitting} loading={isSubmitting}>
        {isSubmitting ? t(locale, 'publicBranding.signingIn') : t(locale, 'publicBranding.signIn')}
      </Button>
    </form>
  );
}
