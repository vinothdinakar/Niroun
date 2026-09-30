'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '@bond/console-core/lib/api';
import { useFlow } from '@bond/console-core/lib/flow';
import { useHealth } from '@bond/console-core/lib/health';
import { useRedirectIfSignedIn } from '@bond/console-core/lib/hooks';
import { PasswordInput } from '@bond/console-core/components/ui';

// Self-serve signup: just an email and a password. Nothing exists until the emailed link is used. The account's name
// and its organization (name and type) start as placeholders and are set afterwards in Account and Organization.
export default function SignupPage() {
  useRedirectIfSignedIn();
  const router = useRouter();
  const flow = useFlow();
  const health = useHealth();
  const [f, setF] = useState({ email: '', password: '', website: '', acceptTerms: false });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string; checked?: boolean; type?: string } }) =>
    setF((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? !!e.target.checked : e.target.value }));

  if (health && health.signup !== 'open') {
    return (
      <div>
        <h2>Sign-up is closed</h2>
        <p className="muted">Accounts are created by invitation. Ask your administrator for an invite link.</p>
        <Link className="btn primary" href="/login">Back to sign in</Link>
      </div>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('POST', '/v1/signup', {
        email: f.email, password: f.password, acceptTerms: f.acceptTerms, website: f.website,
      });
      flow.setSignupEmail(f.email.trim());
      router.push('/signup/check-email');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="signup-form" onSubmit={submit}>
      <h2>Create your account</h2>
      <p className="muted">Register to connect and monitor your AI agents. You can add your name and organization details after signing in.</p>
      <label htmlFor="su-email">Email</label>
      <input id="su-email" type="email" autoComplete="email" required autoFocus value={f.email} onChange={set('email')} />
      <label htmlFor="su-pw">Password (12+ characters)</label>
      <PasswordInput id="su-pw" autoComplete="new-password" minLength={12} required value={f.password} onChange={set('password')} />
      {/* honeypot: people never see or fill this; bots do */}
      <div className="hp" aria-hidden="true"><label>Website <input tabIndex={-1} autoComplete="off" value={f.website} onChange={set('website')} /></label></div>
      <details className="terms">
        <summary>Preview terms (draft)</summary>
        <p>Bond is a private preview. It runs on simulated funds: no real money moves and no real insurance or coverage is in force. Scores, prices and outcomes are for evaluation only and carry no warranty. Your organization starts unverified; Bond staff verify organizations separately. These terms are placeholders and must be replaced by counsel-approved terms before launch.</p>
      </details>
      <label className="check">
        <input type="checkbox" checked={f.acceptTerms} onChange={set('acceptTerms')} />
        {' '}I accept the preview terms.
      </label>
      <p className="form-error" role="alert">{error}</p>
      <button className="btn primary" type="submit" disabled={busy}>Create account</button>
      <p className="small"><Link href="/login">Already have an account? Sign in</Link></p>
    </form>
  );
}
