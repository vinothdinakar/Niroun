# Bond: trust, bonding and dispute resolution for AI agents

When AI agents do business with agents they've never met, someone has to answer *can I trust them, and who pays if it goes wrong?* Bond gives agents a verifiable identity, a reputation score, live-priced coverage on a deal, and automated dispute resolution, plus spending limits their owners control.

## What's in this folder

```
ProjectHareHare/
├── api/               The Bond API (NestJS + TypeScript + MongoDB)
├── dashboard/         The console for agent owners (Next.js + TypeScript)
├── admin-app/         The staff-only console for Bond admins/reviewers — separate origin, separate app
├── packages/
│   └── console-core/  Code shared by dashboard/ and admin-app/ (API client, UI, sign-in flow)
├── homepage/          The marketing homepage, a standalone React app (React + TypeScript + Vite)
├── docs/              Business plan and roadmap
└── package.json       Shortcut scripts for the apps
```

| Folder | What it is | Start here |
|---|---|---|
| [`api/`](api/README.md) | The core product, as a NestJS + TypeScript JSON API: identity, scoring, pricing, disputes, sign-in and two-factor, signup. | `api/README.md` |
| [`dashboard/`](dashboard/README.md) | The customer console: sign-in and 2FA, signup, agents, deals, disputes, spending mandates, team | `dashboard/README.md` |
| [`admin-app/`](admin-app/README.md) | The staff console: everything the dashboard has, plus Organizations and the Audit log, for every customer | `admin-app/README.md` |
| [`packages/console-core/`](packages/console-core/README.md) | The code both consoles share, compiled into each app's own build — not a runtime dependency | `packages/console-core/README.md` |
| [`homepage/`](homepage/README.md) | The public homepage with an interactive pricing calculator | `homepage/README.md` |
| [`docs/PLAN.md`](docs/PLAN.md) | Market, business model, risks, and the licensing reality | `docs/PLAN.md` |

## Quick start

`dashboard/`, `admin-app/` and `packages/console-core/` are one npm workspace (see `package.json`'s
`"workspaces"`), so **install once from the repo root**: `npm install`. `api/` and `homepage/` are separate,
independently-installed apps — each needs its own `npm install` inside its own folder.

```bash
# 1. the API with a simulated marketplace (http://localhost:4100). Starts the local MongoDB first.
npm run api:demo

# 2. the customer dashboard (http://localhost:3300). Sign in as an owner_admin/owner_viewer from api/demo/demo-users.json
npm run dashboard:dev

# 3. the staff admin app (http://localhost:3400). Sign in as admin/reviewer from api/demo/demo-users.json
npm run admin:dev

# 4. the homepage (http://localhost:5173)
npm run homepage:dev

# all tests
npm test
```

The `dev`/`build`/`start`/`test` scripts also work from inside each app's own folder (`cd admin-app && npm test`). Requires Node 20+.

Ports: API 4100, dashboard 3300, admin app 3400, homepage 5173, local MongoDB 27018. (3000/3100/3200 are left free because they're common defaults for other Next.js projects.)

## Status

A working prototype on simulated funds. The API is **NestJS + TypeScript** on **MongoDB** (single-node replica set for dev: `npm run api:db`). It's fronted by **two separate Next.js apps** — a customer dashboard and a staff-only admin console — on separate origins with separate session cookies, sharing their common code through `packages/console-core` (compiled into each app's own build, not a live dependency between them; see that package's README for why this doesn't complicate deploying the two to different servers). Roadmap: MongoDB in production, a Python SDK and an MCP server (see `docs/PLAN.md`).
