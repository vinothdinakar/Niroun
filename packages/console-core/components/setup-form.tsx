'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, errorMessage } from '../lib/api';
import { groupBy4 } from '../lib/format';
import { useFlow } from '../lib/flow';
import { useRequireChallenge } from '../lib/hooks';
import { useSession } from '../lib/session';
import { useCopy } from '../lib/toast';
import type { Me } from '../lib/types';

// Bond staff must set up an authenticator before they can sign in at all.
export function SetupForm() {
  const ok = useRequireChallenge();
  const router = useRouter();
  const flow = useFlow();
  const { setNotice } = useSession();
  const copy = useCopy();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // No setup key in memory (a reload, or someone typed the URL): the challenge can't produce one again, so start over.
  useEffect(() => { if (ok && !flow.enroll) router.replace('/login'); }, [ok, flow.enroll, router]);
  if (!ok || !flow.enroll) return null;
  const { account, secret, otpauthUri } = flow.enroll;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const r = await api<Me & { recoveryCodes: string[] }>('POST', '/v1/auth/2fa/confirm', { challenge: flow.challenge, code });
      flow.setRecovery({ codes: r.recoveryCodes, me: { user: r.user, permissions: r.permissions } });
      router.push('/login/recovery-codes');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INVALID_CHALLENGE') {
        setNotice(err.message);
        router.replace('/login');
        return;
      }
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <h2>Set up two-factor</h2>
      <p className="muted">Bond staff accounts require an authenticator app. It takes about a minute.</p>
      <ol className="setup">
        <li>Install an authenticator app (Google Authenticator, Authy, 1Password, Microsoft Authenticator&hellip;).</li>
        <li>
          Add an account and choose <b>Enter a setup key</b>:
          <div className="keybox">
            <span className="muted small">Account</span><code>{account}</code>
            <span className="muted small">Key (time-based)</span><code>{groupBy4(secret)}</code>
            <span>
              <button type="button" className="btn ghost sm" onClick={() => copy(secret)}>Copy key</button>{' '}
              <button type="button" className="btn ghost sm" onClick={() => copy(otpauthUri)}>Copy setup link</button>
            </span>
          </div>
        </li>
        <li>Type the 6-digit code the app shows.</li>
      </ol>
      <label htmlFor="en-code">6-digit code</label>
      <input id="en-code" inputMode="numeric" autoComplete="one-time-code" maxLength={10} required autoFocus value={code} onChange={(e) => setCode(e.target.value)} />
      <p className="form-error" role="alert">{error}</p>
      <button className="btn primary" type="submit" disabled={busy}>Turn on two-factor</button>
    </form>
  );
}
