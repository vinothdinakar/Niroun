# @bond/console-core

Code shared between [`../../dashboard`](../../dashboard) (customer console) and [`../../admin-app`](../../admin-app)
(staff console): the API client, session and sign-in state, and the UI they have in common — the agent drawer,
the price calculator, the overview/connect/team pages, every sign-in screen, the app shell.

## Not a runtime dependency

This package is never published, versioned, or run on its own. Both apps depend on it as `file:../packages/console-core`
(npm symlinks it into each app's `node_modules`) and compile it with Next's `transpilePackages`, so it becomes
part of each app's own `.next` build output. Once built, `dashboard` and `admin-app` are two fully independent
artifacts — deploy them to two different servers, two different origins, scale them separately — neither one
references this package, or the other app, at runtime. The only requirement is that whatever builds each app
(CI, a Dockerfile, Vercel) has this whole repo checked out, since the `file:` link is a relative path.

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
cd packages/console-core
npm install
npm run typecheck
npm test          # format.ts / csp.ts unit tests (vitest)
```

It has no `build`/`dev`/`start` script on purpose: it's consumed as TypeScript source by whichever app imports it.
