'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSessionStore } from '../../stores/session';

export function LoginForm() {
  const router = useRouter();
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
      router.replace('/dashboard');
    } catch {
      setError('Unable to sign in with those credentials.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="auth-panel" onSubmit={(event) => void onSubmit(event)}>
      <div>
        <p className="eyebrow">Zea Play</p>
        <h1>Sign in</h1>
      </div>
      <label>
        Email
        <input
          autoComplete="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </label>
      <label>
        Password
        <input
          autoComplete="current-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          minLength={12}
          required
        />
      </label>
      {error ? <p className="form-error">{error}</p> : null}
      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Signing in...' : 'Sign in'}
      </button>
    </form>
  );
}
