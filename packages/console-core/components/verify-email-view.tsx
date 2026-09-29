'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { tokenFromHash } from '../lib/format';
import { useSession } from '../lib/session';

type Result = { ok: true; email: string } | { ok: false; message: string } | null;

// The "verify your email" link (sent from the account page, either console) lands here as
// /verify-email#token=... Unlike /verify (customer-only, and creates an account), this confirms an
// existing account's email — with no session required, since the link may be opened in a different
// browser than the one that requested it.
export function VerifyEmailView() {
  const { status, me, signedIn } = useSession();
  const [result, setResult] = useState<Result>(null);
  // The link works exactly once, so guard against React's dev-mode double effect firing a second request.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = tokenFromHash(window.location.hash);
    window.history.replaceState(null, '', window.location.pathname); // a one-time token must not stay in the address bar
    if (!token) { setResult({ ok: false, message: 'This verification link is incomplete. Open the link from your email again.' }); return; }
    api<{ email: string }>('POST', '/v1/auth/email/verify/confirm', { token })
      .then((r) => setResult({ ok: true, email: r.email }))
      .catch((err) => setResult({ ok: false, message: errorMessage(err) }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // If this browser happens to already be signed in as the account that owns that email, reflect the
  // new status right away instead of waiting for the next full reload of the account page.
  useEffect(() => {
    if (result?.ok && me && me.user.email === result.email && !me.user.emailVerified) {
      signedIn({ ...me, user: { ...me.user, emailVerified: true } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  if (!result) return <p className="muted">Confirming your email…</p>;

  const back = status === 'in' ? '/account#profile' : '/login';
  if (result.ok) {
    return (
      <div>
        <h2>Email verified</h2>
        <p className="muted">{result.email} is confirmed.</p>
        <Link className="btn primary" href={back}>{status === 'in' ? 'Back to your account' : 'Sign in'}</Link>
      </div>
    );
  }
  return (
    <div>
      <h2>This link can’t be used</h2>
      <p className="muted">{result.message}</p>
      <Link className="btn primary" href={back}>{status === 'in' ? 'Back to your account' : 'Back to sign in'}</Link>
    </div>
  );
}
