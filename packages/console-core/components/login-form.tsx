'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import { useFlow } from '../lib/flow';
import { useHealth } from '../lib/health';
import { useRedirectIfSignedIn } from '../lib/hooks';
import { useSession } from '../lib/session';
import type { SignInResult } from '../lib/types';

/**
 * `mode: 'staff'` is for the admin app: staff accounts are never self-service, so it never offers a signup
 * link regardless of whether the customer dashboard has company signup open.
 */
export function LoginForm({ mode = 'customer' }: { mode?: 'customer' | 'staff' }) {
  useRedirectIfSignedIn();
  const flow = useFlow();
  const { notice, setNotice } = useSession();
  const health = useHealth();
  const [email, setEmail] = useState(flow.prefillEmail);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Coming back to the start (from "Back", or a challenge that expired) begins a fresh flow.
  useEffect(() => { flow.setChallenge(null); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const r = await api<SignInResult>('POST', '/v1/auth/login', { email, password });
      setPassword('');
      await flow.continueSignIn(r);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <h2>Sign in</h2>
      <label htmlFor="li-email">Email</label>
      <input id="li-email" type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
      <label htmlFor="li-pw">Password</label>
      <input id="li-pw" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      <p className="form-error" role="alert">{error || notice}</p>
      <button className="btn primary" type="submit" disabled={busy}>Sign in</button>
      {mode === 'staff' ? (
        <p className="muted small">Accounts are created by invitation. Ask another admin for an invite link.</p>
      ) : health?.signup === 'open' ? (
        <p className="muted small">New to Bond? <Link href="/signup">Create an account for your company</Link></p>
      ) : (
        <p className="muted small">Accounts are created by invitation. Ask your administrator for an invite link.</p>
      )}
    </form>
  );
}
