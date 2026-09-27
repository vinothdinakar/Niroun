# @bond/dashboard: Bond customer console

The signed-in app for **agent owners** (`owner_admin`, `owner_viewer`): sign-in with two-factor, company signup, agent registry and reputation, deals, disputes, spending mandates, team. Next.js 15 (App Router) + React 19 + TypeScript. It holds no data of its own: everything comes from the [API](../api/README.md).

Bond staff (`admin`, `reviewer`) sign in to a **separate app**, [`../admin-app`](../admin-app/README.md), on its own origin — see that README for why. Most of this app's code is shared with it via [`@bond/console-core`](../packages/console-core/README.md).

## Run

```bash
cd dashboard
npm install
npm run dev        # http://localhost:3300 (hot reload)
npm test           # unit tests (vitest; currently none of its own — see packages/console-core)
npm run typecheck
npm run build && npm start   # production build, on port 3300
```

It needs the API running (`npm run api:demo` from the repo root gives you one with sample data). Node 20.9+.

Start the API with both consoles' addresses, so emailed links and the origin check line up (these are the defaults):

```bash
BOND_PUBLIC_URL=http://localhost:3300 BOND_STAFF_URL=http://localhost:3400 \
BOND_ALLOWED_ORIGINS=http://localhost:3300,http://localhost:3400 BOND_TRUST_PROXY=1 npm start   # in api/
```

| Variable | Default | What it does |
|---|---|---|
| `BOND_API_URL` | `http://localhost:4100` | Where the API lives. Server-side only; read when Next starts (`.env.example`) |

## How it talks to the API

The browser only ever calls `/v1/*` on the dashboard's own origin; `next.config.ts` rewrites those to `BOND_API_URL`. So:

- the session cookie (`HttpOnly; SameSite=Strict`) is first-party and never readable from script;
- the API needs no CORS, and trusts this origin (and the staff app's) for cookie-authenticated writes (`BOND_ALLOWED_ORIGINS`);
- the API sees visitors' addresses through `X-Forwarded-For` (`BOND_TRUST_PROXY=1`), so per-address rate limits still work.

## Layout

```
src/
├── middleware.ts            re-exports the shared CSP middleware (Next needs this file physically here)
├── app/
│   ├── layout.tsx           providers + shared stylesheet, from @bond/console-core
│   ├── (auth)/              signed-out screens, in a centred card
│   │   ├── login/           password  ->  code/ (2FA)  |  setup/ -> recovery-codes/ (first-time staff)
│   │   ├── signup/          company signup  ->  check-email/     (customer-only: staff never self-registers)
│   │   ├── verify/          /verify#token=...  (emailed link)    (customer-only)
│   │   └── invite/          /invite#token=...  (invitation, first-run admin, reset)
│   └── (app)/               signed-in screens, inside the header + navigation shell
│       ├── page.tsx         Overview (live, refreshes every 3s)
│       └── connect/ team/
```

Nearly every file here is a thin wrapper — `export { X as default } from '@bond/console-core/components/...'` —
because the actual logic lives in the shared package. What's specific to this app is just: which nav tabs it
shows (no Organizations/Audit — customers never have those permissions), the sign-in page's copy (`mode="customer"`
on the shared login form), and the two customer-only routes (`signup`, `verify`).

## Things to know

- **Who sees what is decided by the API**, never by this app. The navigation hides sections a role doesn't have, and pages show "Not available", but the data endpoints refuse regardless.
- **One-time tokens travel in the URL fragment** (`#token=`), which browsers don't send to servers or log, and the page removes it from the address bar as soon as it's used.
- **Sign-in state is memory only.** The 2FA challenge, the authenticator setup key and recovery codes live in React state, never in the URL or browser storage. Reloading mid-flow sends you back to sign in.
- **Strict CSP.** Scripts run only with the per-request nonce (so every page is rendered on request, not prerendered). Styles allow inline because React `style` attributes can't carry a nonce.
- **Ended sessions are handled:** a 401 on any data call returns you to sign-in with a message.
- **Ports.** 3300 by default (3000/3100/3200 are commonly taken by other Next.js apps; 3400 is the staff app). If you change it, set `BOND_PUBLIC_URL` and `BOND_ALLOWED_ORIGINS` on the API to match.
