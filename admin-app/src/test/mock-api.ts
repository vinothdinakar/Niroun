import { vi } from 'vitest';

export interface MockErrorResponse { status: number; body?: unknown }
type HandlerFn = (url: string, init?: RequestInit) => unknown;
type Entry = unknown | HandlerFn;

/** `mockApi({ '/v1/auth/me': mockError(401) })` — an explicit escape hatch, not an ambient object shape,
 * so a real response body can never be mistaken for one. */
export const mockError = (status: number, body: unknown = {}): MockErrorResponse => ({ status, body });

const isMockError = (v: unknown): v is MockErrorResponse =>
  !!v && typeof v === 'object' && Object.keys(v).sort().join() === 'body,status' && typeof (v as MockErrorResponse).status === 'number';

/**
 * Stubs global fetch for one test: routes by path (the query string is ignored) to a canned JSON response.
 * A plain value means "200 OK, this is the body"; a function receives (url, init) so a test can vary the
 * response by method (e.g. the same /v1/console/orgs path for both the list and the create endpoints) or
 * return `mockError(status)` for a failure. `@bond/console-core`'s `api()` always calls a bare path like
 * `/v1/auth/me`, so paths here are matched exactly as written, no origin.
 *
 * Every render wrapped in <Providers> (see ./render) triggers `GET /v1/auth/me` on mount — mock it in every
 * test, even a 401, or the request throws (harmlessly caught by SessionProvider, but the intent is clearer
 * spelled out).
 */
export function mockApi(handlers: Record<string, Entry>) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const path = url.split('?')[0];
    if (!(path in handlers)) throw new Error(`mockApi: no handler for ${path} (mocked: ${Object.keys(handlers).join(', ') || 'none'})`);
    const entry = handlers[path];
    const resolved = typeof entry === 'function' ? await (entry as HandlerFn)(url, init) : entry;
    const { status, body } = isMockError(resolved) ? resolved : { status: 200, body: resolved };
    return new Response(JSON.stringify(body ?? {}), { status, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}
