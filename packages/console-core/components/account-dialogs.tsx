'use client';

import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import { useCopy, useToast } from '../lib/toast';
import { Modal } from './modal';

export function PasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <Modal open={open} onClose={onClose}><PasswordForm onClose={onClose} /></Modal>;
}

function PasswordForm({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api('POST', '/v1/auth/change-password', { current, next });
      onClose();
      toast('Password changed. Other devices were signed out.');
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <form onSubmit={submit}>
      <h3>Change password</h3>
      <label htmlFor="pw-cur">Current password</label>
      <input id="pw-cur" type="password" autoComplete="current-password" required autoFocus value={current} onChange={(e) => setCurrent(e.target.value)} />
      <label htmlFor="pw-new">New password (12+ characters)</label>
      <input id="pw-new" type="password" autoComplete="new-password" minLength={12} required value={next} onChange={(e) => setNext(e.target.value)} />
      <p className="form-error" role="alert">{error}</p>
      <p className="muted small">You&apos;ll stay signed in here; every other device is signed out.</p>
      <div className="row-end">
        <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
        <button className="btn primary" type="submit">Change password</button>
      </div>
    </form>
  );
}

export function RecoveryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Unmounting the form on close drops the new codes from memory.
  return <Modal open={open} onClose={onClose}><RecoveryForm onClose={onClose} /></Modal>;
}

function RecoveryForm({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const copy = useCopy();
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const r = await api<{ recoveryCodes: string[] }>('POST', '/v1/auth/2fa/recovery-codes', { code });
      setCodes(r.recoveryCodes);
      toast('New recovery codes created. The old ones no longer work.');
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <form onSubmit={submit}>
      <h3>New recovery codes</h3>
      <p className="muted small">This replaces your current set: the old codes stop working. Enter the current 6-digit code from your authenticator app to confirm. (If you just signed in, wait for the next code to appear.)</p>
      {codes ? (
        <pre className="codes">{codes.join('\n')}</pre>
      ) : (
        <div>
          <label htmlFor="rcd-code">6-digit code</label>
          <input id="rcd-code" inputMode="numeric" autoComplete="one-time-code" maxLength={10} required autoFocus value={code} onChange={(e) => setCode(e.target.value)} />
          <p className="form-error" role="alert">{error}</p>
        </div>
      )}
      <div className="row-end">
        <button className="btn ghost" type="button" onClick={onClose}>Close</button>
        {codes ? (
          <button className="btn ghost" type="button" onClick={() => copy(codes.join('\n'))}>Copy all</button>
        ) : (
          <button className="btn primary" type="submit">Generate new codes</button>
        )}
      </div>
    </form>
  );
}
