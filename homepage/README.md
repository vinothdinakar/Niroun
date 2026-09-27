# @bond/homepage: Bond home page

Marketing site for Bond. React 18 + TypeScript + Vite 5, statically prerendered, no runtime dependencies beyond
`react`, `react-dom` and `react-router-dom`. Deploys to any static host.

## Run

```bash
cd homepage
npm install
npm run dev        # http://localhost:5173 (client-rendered, hot reload)
npm test           # risk model tests (vitest)
npm run build      # typecheck, build, and prerender every route into dist/
npm run preview    # serve dist/ at http://localhost:4173 (what production serves)
```

Requires Node 20+. (Vite is pinned to v5 so it runs on Node 20.10; newer Vite needs Node 20.19+.)

## Pages

| Route | Purpose |
|---|---|
| `/` | Hero with an example bonded deal, problem, four pillars, lifecycle, **interactive pricing calculator**, simulation results, dev snippet, FAQ |
| `/how-it-works` | Deal lifecycle, dispute rules, why the score resists gaming, known limits |
| `/pricing` | Plans, plus a bond-price table generated from the same model as the calculator |
| `/security` | What's built today, design principles, and what's still on the roadmap |
| `/developers` | SDK quickstart (buyer/seller), decline codes |
| `/waitlist` | Signup form |

## How prerendering works

`npm run build` does three things: builds the client bundle, builds a server bundle of the same app
(`src/entry-server.tsx`), then `scripts/prerender.mjs` renders each route in `src/routes.ts` to
`dist/<route>/index.html` with its own `<title>` and meta description. The browser hydrates that HTML.
So crawlers and link previews see real content, with no Node server in production.
`dist/404.html` is emitted for unknown URLs; configure your host to serve it for 404s.

Adding a page: create it in `src/pages/`, add a `<Route>` in `App.tsx`, and add an entry to `src/routes.ts`.
That's all: the prerender script picks it up.

## Waitlist

The form is uncontrolled and validates client-side, with a honeypot field. It POSTs JSON to
`VITE_WAITLIST_ENDPOINT` when set:

```
POST { name, email, company, role, message }   ->   any 2xx = success
```

```bash
VITE_WAITLIST_ENDPOINT=https://api.example.com/v1/public/waitlist npm run build
```

When it is **not** set (the default), the form tells the visitor that nothing was sent or stored. It never fakes a
signup. The endpoint arrives with the NestJS API (`POST /v1/public/waitlist`, rate-limited, with captcha).

## Things to know

- `src/lib/risk.ts` is a TypeScript port of the API prototype's scoring and pricing (`api/src/domain/scoring.ts`,
  `api/src/domain/pricing.ts`). It powers the calculator, the pricing table and the hero card. `risk.test.ts` pins it to the
  prototype's numbers (e.g. a new agent scores exactly 719). When the monorepo gets a shared `risk-core` package,
  delete this file and import from there so the site can't drift from the product.
- The calculator states its simplifications on the page (about $100 deals, no time decay, many counterparties).
- Copy that describes the product is deliberately honest about its stage: private preview, simulated funds, and
  coverage "through licensed partners" as a plan. Keep it that way until that's no longer true.
- Simulation figures on the home page (19 agents, about 480 deals, tier results) come from `npm run demo` in the
  `api/` folder, with seed 7.
