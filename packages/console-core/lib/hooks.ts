'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFlow } from './flow';
import { useSession } from './session';

/** Signed-in people have no business on the sign-in or signup screens: send them to the console. */
export function useRedirectIfSignedIn(): void {
  const { status } = useSession();
  const router = useRouter();
  useEffect(() => { if (status === 'in') router.replace('/'); }, [status, router]);
}

/** The second and later sign-in screens only make sense mid-flow. After a reload the flow is gone: start over. */
export function useRequireChallenge(): boolean {
  const { challenge } = useFlow();
  const { status } = useSession();
  const router = useRouter();
  const missing = status !== 'loading' && !challenge;
  useEffect(() => { if (missing) router.replace('/login'); }, [missing, router]);
  return !missing;
}

/** Load data when a page opens (and again on `reload()`). Errors are reported as text, never thrown into the render. */
export function useLoader<T>(load: () => Promise<T>, deps: unknown[]): { data: T | null; error: string; reload: () => Promise<void> } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const loadRef = useRef(load);
  loadRef.current = load;
  const reload = useCallback(async () => {
    try {
      setData(await loadRef.current());
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    }
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [reload, ...deps]);
  return { data, error, reload };
}

/**
 * Read a one-time token out of the URL fragment (`#token=...`) once the page has mounted.
 * The fragment is browser-only, so it can't be read while rendering on the server.
 * `strip` removes it from the address bar and history entry: call it as soon as the token has been used.
 */
export function useHashToken(parse: (hash: string) => string | null): { token: string | null; ready: boolean; strip: () => void } {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const parseRef = useRef(parse);
  useEffect(() => {
    setToken(parseRef.current(window.location.hash));
    setReady(true);
  }, []);
  const strip = () => window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return { token, ready, strip };
}
