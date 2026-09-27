'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api, setSessionEndedHandler } from './api';
import type { Me, Permission } from './types';

type Status = 'loading' | 'in' | 'out';

interface SessionValue {
  status: Status;
  me: Me | null;
  has: (p: Permission) => boolean;
  isStaff: boolean;
  /** Called once sign-in has fully finished (password, and second factor when required). */
  signedIn: (me: Me) => void;
  signOut: () => Promise<void>;
  /** A one-off message to show on the sign-in page ("Your session ended...") */
  notice: string;
  setNotice: (m: string) => void;
}

const SessionContext = createContext<SessionValue | null>(null);
export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error('useSession must be used inside <SessionProvider>');
  return v;
}

// Who is signed in, asked of the API (the session cookie is HttpOnly, so the page cannot look at it).
// Nothing secret is kept here: the person's name, role and permission names.
export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let live = true;
    api<Me>('GET', '/v1/auth/me')
      .then((r) => { if (live) { setMe(r); setStatus('in'); } })
      .catch(() => { if (live) setStatus('out'); });
    return () => { live = false; };
  }, []);

  const endSession = useCallback((message: string) => {
    setMe(null);
    setStatus('out');
    setNotice(message);
    router.replace('/login');
  }, [router]);

  // A 401 from any data call while signed in means the session expired or was revoked (e.g. password changed elsewhere).
  useEffect(() => {
    setSessionEndedHandler(() => { if (status === 'in') endSession('Your session ended. Please sign in again.'); });
    return () => setSessionEndedHandler(null);
  }, [status, endSession]);

  const signedIn = useCallback((next: Me) => { setMe(next); setStatus('in'); setNotice(''); }, []);

  const signOut = useCallback(async () => {
    await api('POST', '/v1/auth/logout', {}).catch(() => undefined);
    endSession('');
  }, [endSession]);

  const value = useMemo<SessionValue>(() => ({
    status, me,
    has: (p) => !!me && me.permissions.includes(p),
    isStaff: !!me && (me.user.role === 'admin' || me.user.role === 'reviewer'),
    signedIn, signOut, notice, setNotice,
  }), [status, me, signedIn, signOut, notice]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
