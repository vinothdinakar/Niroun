import { useId, useState, type FormEvent } from 'react';

type Status = 'idle' | 'sending' | 'sent' | 'preview' | 'error';

const ROLES = ['We build agents that buy', 'We build agents that sell', 'Both', 'We run a marketplace or platform', 'Something else'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// VITE_WAITLIST_ENDPOINT is unset until the API exists. In that case we say so plainly instead
// of pretending the signup was stored.
const ENDPOINT = import.meta.env.VITE_WAITLIST_ENDPOINT;

export function WaitlistForm() {
  const id = useId();
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (form.get('website')) return; // honeypot: real people never fill this

    const payload = {
      name: String(form.get('name') ?? '').trim(),
      email: String(form.get('email') ?? '').trim(),
      company: String(form.get('company') ?? '').trim(),
      role: String(form.get('role') ?? ''),
      message: String(form.get('message') ?? '').trim(),
    };
    if (!payload.name || !EMAIL.test(payload.email)) {
      setError('Please enter your name and a valid work email.');
      setStatus('error');
      return;
    }
    if (!ENDPOINT) {
      setStatus('preview');
      return;
    }
    setStatus('sending');
    try {
      const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error(String(res.status));
      setStatus('sent');
    } catch {
      setError('Something went wrong sending that. Please try again in a moment.');
      setStatus('error');
    }
  }

  if (status === 'sent') {
    return (
      <div className="form-done" role="status">
        <h3>You’re on the list.</h3>
        <p className="muted">Thanks. We’ll reach out when there’s a spot in the private preview.</p>
      </div>
    );
  }

  return (
    <form className="form" onSubmit={onSubmit} noValidate>
      <div className="row2">
        <div>
          <label htmlFor={`${id}-n`}>Name</label>
          <input id={`${id}-n`} name="name" autoComplete="name" required />
        </div>
        <div>
          <label htmlFor={`${id}-e`}>Work email</label>
          <input id={`${id}-e`} name="email" type="email" autoComplete="email" required />
        </div>
      </div>
      <div className="row2">
        <div>
          <label htmlFor={`${id}-c`}>Company <span className="muted">(optional)</span></label>
          <input id={`${id}-c`} name="company" autoComplete="organization" />
        </div>
        <div>
          <label htmlFor={`${id}-r`}>What are your agents doing?</label>
          <select id={`${id}-r`} name="role" defaultValue={ROLES[0]}>
            {ROLES.map((r) => <option key={r}>{r}</option>)}
          </select>
        </div>
      </div>
      <label htmlFor={`${id}-m`}>Anything we should know? <span className="muted">(optional)</span></label>
      <textarea id={`${id}-m`} name="message" rows={3} />

      {/* honeypot */}
      <div className="hp" aria-hidden="true">
        <label>Website <input name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>

      <button className="btn btn-primary" type="submit" disabled={status === 'sending'}>
        {status === 'sending' ? 'Sending…' : 'Join the waitlist'}
      </button>

      <div aria-live="polite">
        {status === 'error' && <p className="form-msg form-err">{error}</p>}
        {status === 'preview' && (
          <p className="form-msg form-note">
            Preview build: the waitlist endpoint isn’t connected yet, so nothing was sent or stored.
          </p>
        )}
      </div>
    </form>
  );
}
