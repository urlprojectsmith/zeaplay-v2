'use client';

import { FormEvent, useState } from 'react';
import { Button, Input } from '@zea-play/ui';
import { verifyGamificationResetEmailOtp } from '../../services/workspace-gamification';

export function VerifyOtpForm() {
  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [verifiedUntil, setVerifiedUntil] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setVerifiedUntil(null);
    setIsSubmitting(true);
    try {
      const grant = await verifyGamificationResetEmailOtp(challengeId.trim(), code);
      setVerifiedUntil(new Date(grant.expiresAt).toLocaleString());
      setChallengeId('');
      setCode('');
    } catch {
      setError('Unable to verify that code.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="auth-panel" onSubmit={(event) => void onSubmit(event)}>
      <div>
        <p className="eyebrow">Zea Play</p>
        <h1>Verify OTP</h1>
      </div>
      <Input
        autoComplete="off"
        label="Challenge ID"
        value={challengeId}
        onChange={(event) => setChallengeId(event.target.value)}
        required
      />
      <Input
        autoComplete="one-time-code"
        inputMode="numeric"
        label="Verification code"
        maxLength={6}
        pattern="[0-9]{6}"
        value={code}
        onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
        required
      />
      {error ? <p className="form-error">{error}</p> : null}
      {verifiedUntil ? (
        <p className="form-success">Verification active until {verifiedUntil}.</p>
      ) : null}
      <Button
        type="submit"
        disabled={isSubmitting || !challengeId.trim() || code.length !== 6}
        loading={isSubmitting}
      >
        {isSubmitting ? 'Verifying...' : 'Verify code'}
      </Button>
    </form>
  );
}
