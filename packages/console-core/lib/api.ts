// The console's only door to the Bond API. Calls go to this origin's /v1/*, which Next forwards to the API
// (see each app's next.config.ts), so the HttpOnly session cookie travels automatically and is never readable from script.

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

// The session provider registers this: any 401 on a data call means the session ended, so go back to sign-in.
// (401s from /v1/auth/* are ordinary "wrong password" answers, not an ended session.)
let onSessionEnded: (() => void) | null = null;
export const setSessionEndedHandler = (fn: (() => void) | null): void => { onSessionEnded = fn; };

export async function api<T = unknown>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    cache: 'no-store',
  });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: string } } & Record<string, unknown>;
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/v1/auth/')) onSessionEnded?.();
    throw new ApiError(json.error?.message || `Request failed (${res.status})`, res.status, json.error?.code);
  }
  return json as T;
}

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : 'Something went wrong');
