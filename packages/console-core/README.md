# @bond/console-core

Code shared between [`../../dashboard`](../../dashboard) (customer console) and [`../../admin-app`](../../admin-app)
(staff console): the API client, session and sign-in state, and the UI they have in common — the agent drawer,
the price calculator, the overview/connect/team pages, every sign-in screen, the app shell.

## Not a runtime dependency

This package is never published or run on its own. `dashboard`, `admin-app` and this package are one npm
workspace (see the root `package.json`'s `"workspaces"` field) — a single `npm install` from the repo root
hoists their shared dependencies (react, next, ...) to one copy and symlinks `@bond/console-core` into each
app's `node_modules`. Both apps compile it with Next's `transpilePackages`, so it becomes part of each app's
own `.next` build output. Once built, `dashboard` and `admin-app` are two fully independent artifacts — deploy
them to two different servers, two different origins, scale them separately — neither one references this
package, or the other app, at runtime. The only requirement is that whatever builds each app (CI, a Dockerfile,
Vercel) has this whole repo checked out, since it's a workspace member, not a published package.

(An earlier version of this linked the three with npm's `file:` protocol instead of real workspaces. That
works for the Next build itself, but not for tests: this package ships its own installed `react`/`next`, for
its own standalone `typecheck`, and a `file:` link doesn't hoist/dedupe — so a component test in `dashboard`
or `admin-app` ended up loading two copies of React, one through each app's own install and one by following
the symlink into this package's, and crashed with "Invalid hook call". Real workspaces hoist everything to a
single copy, which is what actually fixes it.)

What this buys you: fix a bug in the agent drawer once, both consoles get it. Add a field to an API response,
update the type once. Without it, the same ~20 files would be hand-copied into two folders and drift the first
time someone edits one and forgets the other.

## Layout

```
lib/          api client, types, format helpers, CSP builder, session/sign-in-flow state, hooks
components/   ui primitives, agent drawer, price calculator, app shell, auth forms, page-level views
styles/       globals.css — the console's entire visual design (dark theme, one stylesheet)
```

`lib/middleware.ts` and `components/*` that differ only by which nav tabs or copy they show (the app shell,
the login form) take a small prop (`tabs`, `badge`, `mode`) rather than being duplicated — see how `dashboard`
and `admin-app` each pass their own values from a two-line wrapper.

## Run

```bash
npm install   # from the repo root — installs the whole workspace in one pass
cd packages/console-core
npm run typecheck
npm test          # format.ts / csp.ts unit tests (vitest)
```

`dashboard` and `admin-app` each have their own `src/test/` (a vitest config, a `fetch` mock, and a
`renderWithProviders` helper) and write full component tests — rendering a real page against a mocked API —
for what's genuinely theirs: the customer-only signup/verify flow, the staff-only Organizations/Audit pages,
and each app's own nav list. What's shared stays covered here instead, at the unit level.

It has no `build`/`dev`/`start` script on purpose: it's consumed as TypeScript source by whichever app imports it.
