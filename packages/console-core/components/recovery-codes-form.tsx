'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useFlow } from '../lib/flow';
import { useSession } from '../lib/session';
import { useCopy } from '../lib/toast';

// Shown once, right after two-factor setup. Leaving without saving them is the one thing that can lock someone out.
export function RecoveryCodesForm() {
  const router = useRouter();
  const flow = useFlow();
  const { status, signedIn } = useSession();
  const copy = useCopy();
  const [saved, setSaved] = useState(false);
  const recovery = flow.recovery;
  const leaving = useRef(false);

  // After a reload the codes are gone (and can't be shown again): back to sign-in.
  useEffect(() => { if (status !== 'loading' && !recovery && !leaving.current) router.replace('/login'); }, [status, recovery, router]);
  if (!recovery) return null;

  function done() {
    if (!recovery) return;
    const me = recovery.me;
    leaving.current = true;
    flow.reset(); // the codes are dropped from memory as soon as they've been acknowledged
    signedIn(me);
    router.replace('/');
  }

  return (
    <div>
      <h2>Save your recovery codes</h2>
      <p className="muted">If you lose your phone, each of these signs you in once. They are shown <b>only now</b>. Keep them somewhere safe, like a password manager.</p>
      <pre className="codes">{recovery.codes.join('\n')}</pre>
      <p><button className="btn ghost sm" onClick={() => copy(recovery.codes.join('\n'))}>Copy all</button></p>
      <label className="check"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I have saved these codes</label>
      <button className="btn primary" disabled={!saved} onClick={done}>Continue to Bond</button>
    </div>
  );
}
