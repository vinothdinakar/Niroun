'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import { tokenFromHash } from '../lib/format';
import { useFlow } from '../lib/flow';
import { useHashToken } from '../lib/hooks';
import type { SignInResult } from '../lib/types';
import { PasswordInput } from './ui';

// An invitation (or a first-run admin setup, or an account reset) lands here as /invite#token=...
// The person chooses their own password; nobody is ever handed one. Same form for both consoles.
export function InviteForm() {
  const flow = useFlow();
  const { token, ready, strip } = useHashToken(tokenFromHash);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!ready) return null;
  if (!token) {
    return (
      <div>
        <h2>This link can’t be used</h2>
        <p className="muted">The invitation link is incomplete. Open the link you were sent again, or ask your administrator for a new one.</p>
        <Link className="btn primary" href="/login">Back to sign in</Link>
      </div>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (pw !== pw2) { setError('The two passwords do not match.'); return; }
    setBusy(true);
    try {
      const r = await api<SignInResult>('POST', '/v1/auth/accept-invite', { token, password: pw });
      strip(); // the one-time token must not stay in the address bar
      setPw(''); setPw2('');
      await flow.continueSignIn(r);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <h2>Set your password</h2>
      <p className="muted">Choose a password to finish setting up your account (at least 12 characters).</p>
      <label htmlFor="iv-pw">New password</label>
      <PasswordInput id="iv-pw" autoComplete="new-password" minLength={12} required autoFocus value={pw} onChange={(e) => setPw(e.target.value)} />
      <label htmlFor="iv-pw2">Confirm password</label>
      <PasswordInput id="iv-pw2" autoComplete="new-password" minLength={12} required value={pw2} onChange={(e) => setPw2(e.target.value)} />
      <p className="form-error" role="alert">{error}</p>
      <button className="btn primary" type="submit" disabled={busy}>Create account</button>
    </form>
  );
}
