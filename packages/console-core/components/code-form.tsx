'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { ApiError, api, errorMessage } from '../lib/api';
import { useFlow } from '../lib/flow';
import { useRequireChallenge } from '../lib/hooks';
import { useSession } from '../lib/session';
import { useToast } from '../lib/toast';
import type { Me } from '../lib/types';

// Step 2 for accounts that already have an authenticator (or a recovery code to fall back on).
export function CodeForm() {
  const ok = useRequireChallenge();
  const router = useRouter();
  const flow = useFlow();
  const { setNotice, signedIn } = useSession();
  const toast = useToast();
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  if (!ok) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const r = await api<Me & { usedRecoveryCode?: boolean; recoveryCodesLeft?: number }>('POST', '/v1/auth/2fa/verify', { challenge: flow.challenge, code });
      if (r.usedRecoveryCode) toast(`Recovery code used. ${r.recoveryCodesLeft} left. Consider generating new ones.`);
      signedIn({ user: r.user, permissions: r.permissions });
      router.replace('/');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INVALID_CHALLENGE') {
        setNotice(err.message); // the challenge expired or was used up: back to the password step
        router.replace('/login');
        return;
      }
      setError(errorMessage(err));
      input.current?.select();
    } finally {
      setBusy(false);
    }
  }

  function toggle() {
    setRecoveryMode((m) => !m);
    setCode('');
    setError('');
    input.current?.focus();
  }

  return (
    <form onSubmit={submit}>
      <h2>Two-factor code</h2>
      <p className="muted">
        {recoveryMode
          ? 'Enter one of the recovery codes you saved when you set up two-factor. Each one works once.'
          : 'Open your authenticator app and enter the 6-digit code shown for Bond.'}
      </p>
      <label htmlFor="tp-code">{recoveryMode ? 'Recovery code' : '6-digit code'}</label>
      <input
        id="tp-code" ref={input} required autoFocus maxLength={24} autoComplete="one-time-code"
        inputMode={recoveryMode ? 'text' : 'numeric'} placeholder={recoveryMode ? 'xxxxx-xxxxx' : ''}
        value={code} onChange={(e) => setCode(e.target.value)}
      />
      <p className="form-error" role="alert">{error}</p>
      <button className="btn primary" type="submit" disabled={busy}>Verify</button>
      <p className="small">
        <button type="button" className="linklike" onClick={toggle}>{recoveryMode ? 'Use my authenticator app instead' : 'Use a recovery code instead'}</button>
        {' · '}<Link href="/login">Back</Link>
      </p>
    </form>
  );
}
