# @bond/admin-app: Bond staff console

The internal app for **Bond staff only** (`admin`, `reviewer`). Every organization's agents, deals, disputes,
and the reserve pool — plus the Organizations and Audit log sections the customer dashboard doesn't have.
Next.js 15 (App Router) + React 19 + TypeScript, same stack as [`../dashboard`](../dashboard/README.md), and
built from the same shared package, [`@bond/console-core`](../packages/console-core).

## Why this is a separate app, not a tab in the dashboard

Staff can see *every* customer's deals, disputes and the pool's financials — a much bigger blast radius than
an owner's own-company view. Splitting it out means:

- **A different origin, a different session cookie.** A bug in the customer-facing app (XSS, a bad dependency,
  whatever) cannot reach a staff session. This needs one more thing than just "different origin" to actually
  hold: cookies are scoped by hostname, not port, so two apps sharing a hostname in dev (`localhost:3300` /
  `localhost:3400`) would otherwise share one cookie jar. Each app's own server stamps every request it
  proxies with `X-Bond-App: customer`/`staff` (`@bond/console-core/lib/middleware.ts`), which the API uses to
  pick between two entirely separate session cookies — see `api/README.md` for the full mechanism.
- **It can be put behind a VPN/IP-allowlist independently**, with no effect on the public dashboard, once
  that matters (not yet — this is still a prototype on simulated funds).
- **A visible cue.** The header carries a "STAFF" badge (`badge="STAFF"` on the shared `AppShell`) so it's
  obvious which console a tab is, if you have both open.

The real access control is still the **API** — every endpoint checks the caller's role and org regardless of
which frontend calls it. This app is defense-in-depth on top of that, not a replacement for it.

## Run

```bash
npm install   # from the repo root — dashboard, admin-app and packages/console-core are one npm workspace
cd admin-app
npm run dev        # http://localhost:3400 (hot reload)
npm test           # component tests for this app's own pages (login, layout nav, Organizations, Audit) — vitest + RTL
npm run typecheck
npm run build && npm start   # production build, on port 3400
```

It needs the API running (`npm run api:demo` from the repo root gives you one with sample data, including
`admin@bond.test` / `reviewer@bond.test` — see `api/demo/demo-users.json`). Node 20.9+.

| Variable | Default | What it does |
|---|---|---|
| `BOND_API_URL` | `http://localhost:4100` | Where the API lives. Server-side only; read when Next starts (`.env.example`) |

Start the API with this app's address included in its trusted origins (these are the defaults when nothing is set):

```bash
BOND_PUBLIC_URL=http://localhost:3300 BOND_STAFF_URL=http://localhost:3400 \
BOND_ALLOWED_ORIGINS=http://localhost:3300,http://localhost:3400 BOND_TRUST_PROXY=1 npm start   # in api/
```

## What's different from the dashboard

- **No signup, no email verification.** Staff accounts are never self-service — `/signup` and `/verify`
  don't exist here. Every staff account starts as either the bootstrap admin (`BOND_BOOTSTRAP_EMAIL`, printed
  to the API's console on first run) or an invite from another admin.
- **Two extra sections:** Organizations (create companies, set verification level) and the Audit log — both
  gated server-side to staff permissions (`orgs`, `audit`), so they'd refuse the data even if the tabs were
  copied into the dashboard by mistake.
- **The sign-in page never offers "Create an account for your company,"** regardless of whether the customer
  dashboard has signup open (`LoginForm mode="staff"` in the shared package).

Everything else — Overview, Connect agents, Team, the agent drawer, the price calculator, two-factor sign-in —
is the exact same code as the dashboard, imported from `@bond/console-core`. See that package's own notes for
how the sharing works and why it doesn't complicate deploying the two apps to different servers.
