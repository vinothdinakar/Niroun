export const SESSION_COOKIE = 'bond_session';
export const STAFF_SESSION_COOKIE = 'bond_staff_session';

export type AppHint = 'customer' | 'staff';

/**
 * Which console a request came through, from a header that console's own Next server sets on every request
 * it proxies (see @bond/console-core's middleware) — never the browser directly. That makes it trustworthy:
 * a script running on the customer dashboard's origin can only ever reach the dashboard's own server, which
 * always stamps 'customer', so it cannot forge 'staff' and reach the admin app's session. This is what keeps
 * the two consoles' sign-ins apart even when both happen to share a hostname (e.g. localhost on two ports,
 * where cookies aren't isolated by port). Unset (an older client, or a direct API call) defaults to 'customer'.
 */
export const appHint = (header: string | string[] | undefined): AppHint => (header === 'staff' ? 'staff' : 'customer');

export const sessionCookieName = (hint: AppHint): string => (hint === 'staff' ? STAFF_SESSION_COOKIE : SESSION_COOKIE);

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try {
        out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        /* ignore a malformed cookie rather than failing the request */
      }
    }
  }
  return out;
}

/**
 * HttpOnly (page scripts can't read it), SameSite=Strict (never sent on cross-site requests).
 * `persistent: false` (an unchecked "remember me") omits Max-Age: a true browser-session cookie, gone once the
 * browser closes. The server-side session still expires on its own schedule either way (see SESSION_MAX_MS) —
 * this only controls whether the browser forgets it sooner.
 */
export const sessionCookie = (name: string, token: string, maxAgeSec: number, secure: boolean, persistent = true): string =>
  `${name}=${token}; HttpOnly; SameSite=Strict; Path=/${persistent ? `; Max-Age=${maxAgeSec}` : ''}${secure ? '; Secure' : ''}`;
