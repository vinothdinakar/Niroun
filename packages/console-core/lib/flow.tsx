'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api } from './api';
import { useSession } from './session';
import type { Me, SignInResult } from './types';

interface Enroll { account: string; secret: string; otpauthUri: string }

interface FlowValue {
  /** Proves the password step. Unlocks only the next sign-in step, never data. Held in memory only. */
  challenge: string | null;
  setChallenge: (c: string | null) => void;
  enroll: Enroll | null;
  /** After first-time 2FA setup: the recovery codes (shown once) and who to sign in as once they're saved. */
  recovery: { codes: string[]; me: Me } | null;
  setRecovery: (r: { codes: string[]; me: Me } | null) => void;
  /** Where the sign-in page should start the email field (after verifying an email address). */
  prefillEmail: string;
  setPrefillEmail: (e: string) => void;
  /** The address a signup verification email was just sent to. */
  signupEmail: string;
  setSignupEmail: (e: string) => void;
  /** The password (or invite) step passed: go wherever the account needs to go next. */
  continueSignIn: (r: SignInResult) => Promise<void>;
  reset: () => void;
}

const FlowContext = createContext<FlowValue | null>(null);
export function useFlow(): FlowValue {
  const v = useContext(FlowContext);
  if (!v) throw new Error('useFlow must be used inside <FlowProvider>');
  return v;
}

// State for the multi-step sign-in screens (/login -> /login/code, /login/setup -> /login/recovery-codes).
// It lives in memory only, on purpose: a challenge, a setup key or recovery codes must never sit in the URL,
// localStorage or the history. Reloading mid-flow simply sends you back to the start.
export function FlowProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const session = useSession();
  const [challenge, setChallenge] = useState<string | null>(null);
  const [enroll, setEnroll] = useState<Enroll | null>(null);
  const [recovery, setRecovery] = useState<{ codes: string[]; me: Me } | null>(null);
  const [prefillEmail, setPrefillEmail] = useState('');
  const [signupEmail, setSignupEmail] = useState('');

  const reset = useCallback(() => { setChallenge(null); setEnroll(null); setRecovery(null); }, []);

  const continueSignIn = useCallback(async (r: SignInResult) => {
    if ('needs' in r) {
      setChallenge(r.challenge);
      if (r.needs === 'totp') { router.push('/login/code'); return; }
      const b = await api<{ account: string; secret: string; otpauthUri: string }>('POST', '/v1/auth/2fa/begin', { challenge: r.challenge });
      setEnroll(b);
      router.push('/login/setup');
      return;
    }
    reset();
    session.signedIn(r);
    router.replace('/');
  }, [router, session, reset]);

  const value = useMemo<FlowValue>(() => ({
    challenge, setChallenge, enroll, recovery, setRecovery, prefillEmail, setPrefillEmail, signupEmail, setSignupEmail, continueSignIn, reset,
  }), [challenge, enroll, recovery, prefillEmail, signupEmail, continueSignIn, reset]);

  return <FlowContext.Provider value={value}>{children}</FlowContext.Provider>;
}
