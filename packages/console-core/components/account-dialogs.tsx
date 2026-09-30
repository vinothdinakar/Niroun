'use client';

import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import { useCopy, useToast } from '../lib/toast';
import { Modal } from './modal';

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
