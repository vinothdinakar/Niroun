'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '@bond/console-core/lib/api';
import { tokenFromHash } from '@bond/console-core/lib/format';
import { useFlow } from '@bond/console-core/lib/flow';
import { useHealth } from '@bond/console-core/lib/health';

type Result = { ok: true; orgName: string } | { ok: false; message: string } | null;

// The emailed link lands here as /verify#token=... Using it creates the company and its first admin, once.
export default function VerifyPage() {
  const flow = useFlow();
  const health = useHealth();
  const [result, setResult] = useState<Result>(null);
  // The link works exactly once, so guard against React's dev-mode double effect firing a second request.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = tokenFromHash(window.location.hash);
    window.history.replaceState(null, '', window.location.pathname); // a one-time token must not stay in the address bar
    if (!token) { setResult({ ok: false, message: 'This verification link is incomplete. Open the link from your email again.' }); return; }
    api<{ email: string; orgName: string }>('POST', '/v1/signup/verify', { token })
      .then((r) => { flow.setPrefillEmail(r.email); setResult({ ok: true, orgName: r.orgName }); })
      .catch((err) => setResult({ ok: false, message: errorMessage(err) }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!result) return <p className="muted">Verifying your email…</p>;

  if (result.ok) {
    return (
      <div>
        <h2>Email verified</h2>
        <p className="muted">Your account for {result.orgName} is ready. Sign in with the password you chose.</p>
        <Link className="btn primary" href="/login">Sign in</Link>
      </div>
    );
  }
  const open = health?.signup === 'open';
  return (
    <div>
      <h2>This link can’t be used</h2>
      <p className="muted">{result.message}</p>
      <Link className="btn primary" href={open ? '/signup' : '/login'}>{open ? 'Start again' : 'Back to sign in'}</Link>
    </div>
  );
}
