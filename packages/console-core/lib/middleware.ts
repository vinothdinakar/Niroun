import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp } from './csp';

export type AppName = 'customer' | 'staff';

/**
 * Each console calls this with its own fixed name (see dashboard/src/middleware.ts and admin-app/src/middleware.ts).
 * Two things happen on every request this app's server handles, before anything else:
 *
 *  1. `X-Bond-App` is stamped onto the request, then forwarded through to the API by the /v1/* rewrite in
 *     next.config.ts. The API uses it to pick which of two session cookies to read or set (see the API's
 *     common/cookies.ts). This is what keeps the two consoles' sign-ins apart even when both happen to run
 *     on the same hostname (e.g. localhost, two ports only — cookies aren't port-scoped, so without this a
 *     browser signed into one app would also appear signed into the other). It's trustworthy specifically
 *     because it's set here, by this app's own server, on every request — a script running on the OTHER
 *     app's origin can never reach this server to forge it; it can only ever reach its own, which always
 *     stamps its own true name.
 *  2. Page requests (not /v1/*) get a strict, per-request-nonce Content-Security-Policy.
 */
export function createConsoleMiddleware(app: AppName) {
  function middleware(request: NextRequest) {
    const headers = new Headers(request.headers);
    headers.set('x-bond-app', app);

    if (request.nextUrl.pathname.startsWith('/v1/')) {
      return NextResponse.next({ request: { headers } });
    }

    const nonce = btoa(crypto.randomUUID());
    const csp = buildCsp(nonce, process.env.NODE_ENV !== 'production');
    headers.set('x-nonce', nonce);
    headers.set('Content-Security-Policy', csp);

    const response = NextResponse.next({ request: { headers } });
    response.headers.set('Content-Security-Policy', csp);
    return response;
  }

  const config = {
    matcher: [
      // everything except framework assets and the favicon (this now includes /v1/*, for the header above)
      { source: '/((?!_next/static|_next/image|favicon.svg).*)', missing: [{ type: 'header', key: 'next-router-prefetch' }, { type: 'header', key: 'purpose', value: 'prefetch' }] },
    ],
  };

  return { middleware, config };
}
