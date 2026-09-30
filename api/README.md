# Bond: trust, bonding & dispute resolution for AI agents

MVP of the idea: when agents transact with agents they've never met, someone has to answer
**"can I trust this counterparty, and who pays if it goes wrong?"** Bond answers with four things:

1. **Identity + tamper-evident audit ledger**: every agent has an Ed25519 identity and a hash-chained log of everything it does.
2. **Bond Score**: a 0-1000 reputation built from real outcomes, hard to farm.
3. **Bonding**: a live price to insure a specific deal, backed by a reserve pool with capacity and concentration limits.
4. **Automated dispute resolution**: an arbiter that reads both parties' signed ledgers and pays out (or denies) in milliseconds, escalating to a human when the evidence is genuinely ambiguous.

It also doubles as the **spending guardrail** for the agent's owner: per-transaction limit, daily limit, allowed categories and minimum counterparty score, enforced server-side so a confused or compromised agent can't exceed its mandate.

Built with **NestJS 11 + TypeScript** (Express platform), Node 20+. It is a JSON API only: the dashboard is a separate app that talks to it. Data lives in **MongoDB** (a replica set, because deals are written as multi-document transactions).

## Run it

```bash
npm install
npm run db:start       # local dev MongoDB on 127.0.0.1:27018 (single-node replica set, data in data/mongo). Also: db:stop, db:status
npm run build          # TypeScript -> dist/
npm test               # starts the DB if needed, builds, then runs 88 tests: unit, end-to-end over HTTP with the real SDK, access control, two-factor, signup, proxy trust, route audit, database guarantees
npm run demo           # simulate 45 days of a marketplace (database `bond_demo`, wiped each run), then leave the API running on http://localhost:4100
npm run demo:fast      # same, without pacing
npm run demo:code -- admin@bond.test   # print the current two-factor code for a demo staff account
BOND_BOOTSTRAP_EMAIL=you@example.com npm start   # real server (database `bond`); prints a one-time link to create the first admin
npm run build:watch    # in one terminal, and `npm run start:dev` in another, for development
```

After `npm run demo`, the demo accounts (staff and two customer companies) and their randomly generated passwords are in `demo/demo-users.json` (git-ignored, created on first run, and never used by `npm start`). **Staff accounts also need a two-factor code**: add the `totpSecret` from that file to an authenticator app (once; it survives restarts), or just run `npm run demo:code -- admin@bond.test`. The file also holds one-time recovery codes.

### Configuration (environment variables)

For local use, copy `.env.example` to `.env.local` and run `npm run start:local`. See "Configuration and secrets" in the root README for how each environment is configured.

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `4100` | Port the API listens on |
| `BOND_MONGO_URL` | `mongodb://127.0.0.1:27018/?replicaSet=bond0` | MongoDB connection string. Must be a replica set (a single node is fine). `docker-compose.yml` is an equivalent of `npm run db:start` |
| `BOND_MONGO_DB` | `bond` | Database name |
| `BOND_ENCRYPTION_KEY` | key file `data/encryption.key` | Base64, 32 bytes. Seals two-factor secrets. Use a KMS in production |
| `BOND_KEY_FILE` | `data/encryption.key` | Where the dev key file lives when no `BOND_ENCRYPTION_KEY` is set (created on first run) |
| `BOND_PUBLIC_URL` | `http://localhost:3300` | The **customer dashboard's** URL: signup verification and email-verification links point here for customer accounts |
| `BOND_STAFF_URL` | `http://localhost:3400` | The **staff admin app's** URL: the first-run admin setup link (printed on first start) and staff accounts' own email-verification links point here |
| `BOND_ALLOWED_ORIGINS` | the dashboard + staff URLs | Comma-separated origins allowed to make cookie-authenticated writes through either app's proxy |
| `BOND_TRUST_PROXY` | off | Set to `1` **only** behind a proxy you control that sets `X-Forwarded-For`, so per-visitor rate limits see the real address |
| `BOND_SIGNUP` | `closed` | `open` lets companies register themselves |
| `BOND_DEV_MAILBOX` | off | `1` keeps emails and SMS texts in memory and exposes them at `/v1/dev/outbox` and `/v1/dev/sms-outbox`. Never in production |
| `RESEND_API_KEY` | none | Sends email through [Resend](https://resend.com). Ignored when `BOND_DEV_MAILBOX=1`. Without it emails are printed to the console |
| `BOND_MAIL_FROM` | `Bond <no-reply@assetslices.com>` | The From address; its domain must be verified in Resend |
| `BOND_BOOTSTRAP_EMAIL` | none | Creates the first admin's one-time setup link when no admin exists |
| `BOND_COOKIE_SECURE` | off | `1` when served over HTTPS |
| `BOND_GCS_BUCKET` | none (local folder `data/uploads`) | Google Cloud Storage bucket for KYB/KYC evidence files. Credentials come from Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS`, or the runtime's service account). Without it the server stores files on local disk and warns: fine for dev, not for production |
| `BOND_DOC_RETENTION_DAYS` | `90` | How long evidence files are kept after their application is decided (see below) |

There are **two frontends**: the customer dashboard (`../dashboard`, owner roles) and a separate staff admin app (`../admin-app`, `admin`/`reviewer` only). Each reaches this API through its own origin (a Next.js proxy forwards `/v1/*`), so the session cookie is never cross-site, and the API trusts both origins for cookie-authenticated writes (`BOND_ALLOWED_ORIGINS`) and reads the visitor's address from the proxy (`BOND_TRUST_PROXY=1`).

Sign-in isolation between the two goes one step further than separate origins: cookies are scoped by **hostname**, not port, so two apps sharing a hostname in dev (`localhost:3300` / `localhost:3400`) would otherwise share one cookie jar. Each console's own server stamps every request it proxies with `X-Bond-App: customer` or `staff` (`@bond/console-core/lib/middleware.ts`) — trustworthy because that header is set server-side by that app's own code, never by the browser, so a script on one console's origin can't reach the other's server to forge it. `AuthGuard`/`AuthController` (`src/common/cookies.ts`) use it to keep two entirely separate session cookies, `bond_session` and `bond_staff_session`, so a bug in one console genuinely can't reach the other's session — in dev on `localhost` as much as in production on distinct hostnames. Regular invite/reset links are built client-side from whichever app the admin was using, so they always point at the right console; only the signup-verification link (customer-only) and the first-run bootstrap link (staff-only) are built server-side, from `BOND_PUBLIC_URL` and `BOND_STAFF_URL` respectively.

### Verification evidence (KYB/KYC documents)

Applicants upload a certificate of incorporation (businesses) or a photo ID (individuals), plus optional proof of address, so staff can check the self-attested fields against something. Flow: `POST /v1/console/verification-documents?kind=&filename=` takes the raw file as the request body (its `Content-Type` is the file type) and returns a document id; the application then lists them in `documentIds`.

- **Accepted:** PDF, PNG, JPEG, at most 5 MB, and the file's first bytes must match its declared type. One document per kind per application; at most 10 unattached uploads per org.
- **Storage:** bytes go to a private Google Cloud Storage bucket (`BOND_GCS_BUCKET`); MongoDB keeps only metadata and a SHA-256. Use a **private bucket with uniform bucket-level access and public access prevention**, and give the service account only object create/read/delete on it. Nothing is ever served from a bucket URL: downloads (`GET /v1/console/verification-documents/:id`) go through the API, are authorised per request (the uploading org's admin, or staff), and every staff view is written to the audit log.
- **Retention:** an upload never attached to an application is deleted after 24 hours. Files of a decided application (approved or rejected) are deleted `BOND_DOC_RETENTION_DAYS` after the decision. Pending applications are never purged. A sweep runs on the same timer as the other sweeps; the bytes are deleted and the metadata row is kept, marked `purgedAt`, so the history still shows what was submitted. Add a bucket **lifecycle rule** (e.g. delete objects older than retention + a margin) as a backstop in case a purge fails.
- **CSRF:** cookie-authenticated writes are normally `application/json` only. The upload route additionally accepts `application/pdf`, `image/png` and `image/jpeg` bodies, which an HTML form cannot send and a cross-site `fetch` could only send after a CORS preflight the API doesn't grant.

## Signing up (agent owners)

A company that owns agents can register itself, when signup is open:

```bash
BOND_SIGNUP=open BOND_PUBLIC_URL=https://console.example.com npm start   # closed unless you say otherwise
```

Flow: **create account** (just an email and a password, plus accepting the preview terms) → **verification email** → click the link → an organization and its first user, the **organization owner** (role `owner_admin`), are created → **sign in** → getting-started checklist (set your name and organization details, connect an agent with an enrollment code, get verified, invite the team).

Every account has an organization, individual or business alike; there is one kind of user. The account's name and the organization's name start as placeholders taken from the email (`pat.smith@widgets.com` → "Pat" / "Pat's Org - 2026-09-30", the day the organization was created; disambiguated if taken; the creation date is also shown on the Organization page), and the type starts as `business`. The owner sets the real values afterwards: their name in Account, and the organization's name in Organization → Profile and its type in Organization → Verification (both `PUT /v1/console/orgs/:id/profile`, with `name` / `accountType`). The type decides which evidence verification asks for, so an owner can change it only until verification starts; after that it takes a Bond admin. Any `name`, `company`, `accountType` or role sent to `POST /v1/signup` is ignored.

Design decisions:
- **Nothing exists until the email is verified.** The pending signup holds only a password *hash* and a hashed link token, for 24 hours. A stranger can't make an account for an address they don't control. Links are single-use; resending kills the previous link.
- **Existing accounts are told so.** Signing up with an email that already has an account returns `409 EMAIL_EXISTS` ("Sign in instead"), and nothing is created or sent. That reveals which addresses are registered, so it relies on the signup rate limits (below). Sign-in itself still gives one generic error for a wrong password or unknown email. A signup whose link has not been used yet is not an account: signing up again just replaces it.
- **People can't choose their role or company.** Signup only ever creates an `owner_admin` of a *new* company. Joining an existing company is by invitation from its admin. Company names are compared loosely ("ACME Corp." = "acme corp") to stop look-alike squatting.
- **New companies start unverified.** Bond staff verify businesses from the Organizations tab (Unverified / Owner verified / Fully verified). Verifying a company upgrades all its agents, and agents enrolled later inherit it, which lowers their bond premiums. Verification is never self-service.
- **Abuse limits.** 5 signups/hour per source address and 3/hour per email, a honeypot field for bots, strong-password rules, and no sign-in before verification. **Add a CAPTCHA/bot check before opening signup to the public internet.**
- **Email links come from configuration** (`BOND_PUBLIC_URL`), never from the request's `Host` header, which would let an attacker send victims a link to their own site. Tokens travel in the URL fragment, which browsers don't send to servers or log.
- **Email is one interface** (`src/core/mailer.service.ts`). It prints to the console by default. In `npm run demo` (and tests) messages are kept in memory and shown in a demo mailbox on the "check your email" screen. Set `RESEND_API_KEY` to send through Resend (delivery failures are logged, never thrown, so signup replies stay identical). `BOND_DEV_MAILBOX=1` turns the mailbox on for a non-demo server; never do that in production, since it exposes verification links.
- **Terms are a placeholder** (`TERMS_VERSION = 'preview-1'`, stored with each account). Have counsel replace them before real customers sign up.

## Who can sign in

Agents never sign in; they use signed requests. People do, in four roles:

| Role | Who | Can do |
|---|---|---|
| `admin` | Bond staff | Everything: all data, pool health, verify agents, resolve disputes, sweep, manage organizations and users, audit log |
| `reviewer` | Bond staff | Read everything, resolve disputes that need a human, suspend an agent. Can't verify agents, manage users, or see the audit log |
| `owner_admin` | A customer's admin | **Only their own company:** see their agents' deals and disputes, set their agents' spending mandate, suspend/resume them, connect new agents, manage their own team |
| `owner_viewer` | A customer's finance/auditor | Read-only view of their own company |

How it works:
- **Isolation.** A customer never sees another company's deals, disputes, or audit trail (the API answers 404, not 403, so existence doesn't leak). Every agent's reputation score stays visible to everyone signed in, because you need it to choose counterparties.
- **Owners control the mandate.** An agent linked to a company can no longer loosen its own limits (`POLICY_LOCKED`). Only that company's admins (or staff) can, and each change is recorded in the agent's audit ledger with who made it. Unlinked agents keep self-service limits.
- **Enrollment.** An owner admin generates a one-time code (24h, single use); the agent registers with `enrollmentCode`, which sets its owner to the organization and links it. Otherwise "owner" is just a string the agent made up.
- **Kill switch.** Owners can suspend an agent: it can still read, but every write is refused (`AGENT_SUSPENDED`).
- **No passwords are handed out.** New people get a one-time invite link (7 days) and choose their own password. "Reset" kills their sessions and old password and issues a fresh link.
- **Two-factor for staff (required).** Admins and reviewers sign in with password **and** a 6-digit code from an authenticator app (standard TOTP, RFC 6238: Google Authenticator, Authy, 1Password, etc.). A correct password alone gets no cookie and unlocks nothing, only a 5-minute, single-purpose challenge. A new staff member (or one whose 2FA was reset) is walked through setup on first sign-in and can't skip it, then is shown 10 one-time **recovery codes** (once). Details:
  - Each code works once (a used or observed code is worthless) and tolerates ±30s of phone clock drift.
  - Brute-force limits: 5 wrong codes kill the challenge (the password must be re-entered), and 5 wrong codes per account in 15 minutes lock it, across challenges.
  - The authenticator secret is stored **encrypted** (AES-256-GCM) with a key from `BOND_ENCRYPTION_KEY` (base64, 32 bytes), or a key file beside the database in dev. Use a KMS in production; the key must not live beside the data. Recovery codes are stored only as hashes.
  - A staff session that never passed two-factor is rejected even if it were forged into the database.
  - Lost phone: use a recovery code, or ask another admin to **Reset** the account (clears the password and 2FA, kills sessions, always audited). Regenerating recovery codes needs a live authenticator code.
  - Customers aren't forced into 2FA, but if an authenticator is set up on a customer account, the code is enforced for them too.
- **Sessions.** Random token in an `HttpOnly; SameSite=Strict` cookie, stored server-side only as a hash. 2 hours idle / 12 hours absolute timeout. Changing your password signs out every other device. `GET /v1/auth/sessions` lists every device currently signed in (when it started, when it was last used, its IP and a best-effort browser/OS from its User-Agent — cosmetic only, never trusted for anything security-sensitive); `POST /v1/auth/sessions/:id/revoke` ends one (your own current one included, in which case it behaves like logout), `POST /v1/auth/sessions/revoke-all` signs out every *other* device, like a password change does.
- **Profile.** `PUT /v1/auth/me` also takes `legalFirstName`/`legalLastName`: a self-attested legal name, separate from the display `name`, used for verification/compliance rather than shown to a team. Optional and independently clearable (send an empty string).
- **Contact verification** proves someone controls the email/phone on the account — not identity verification (that's the org-level KYB/KYC under Organizations). Not required for anything today; it's a signal other checks can build on later.
  - **Email.** `POST /v1/auth/email/verify/send` (rate-limited, refused once already verified) emails a one-time link, `${dashboard-or-staff-URL}/verify-email#token=...`, built from `BOND_PUBLIC_URL`/`BOND_STAFF_URL` depending on which console the request came through — never the request's `Host` header. `POST /v1/auth/email/verify/confirm` (public: the link may be opened with no session, e.g. a different browser) redeems it, single-use, 24h expiry. A signup-created account starts already verified — the clicked signup link already proved the address — so only invited or bootstrapped accounts see "not verified".
  - **Phone.** `PUT /v1/auth/phone` sets the number (E.164-ish, e.g. `+14155550123`); changing it always clears verification. `POST /v1/auth/phone/verify/send` (rate-limited) texts a 6-digit code, 10 minute expiry. `POST /v1/auth/phone/verify/confirm` checks it, with a 5-wrong-codes-per-15-minutes lockout (a 6-digit code is far more guessable than an email link's token, so unlike email this step always runs inside the account's own session). Texts go through `src/core/sms.service.ts`, the same one-interface pattern as `mailer.service.ts`: prints to the console by default, `BOND_DEV_MAILBOX=1` exposes them at `/v1/dev/sms-outbox` instead, and going live means adding a provider (Twilio, SNS, ...) behind `sms.send()`.
- **Hardening.** Passwords use scrypt with per-user salts (12+ characters). 5 failed sign-ins lock an account for 15 minutes, with the same error for wrong password and unknown user. Cookie-authenticated writes must be JSON and come from the API's own origin or a trusted dashboard origin (CSRF). Responses carry a Content-Security-Policy that forbids everything (the API only speaks JSON). Every console action is written to an audit log.
- **First run.** With no admin, `npm start` refuses to guess a default password: set `BOND_BOOTSTRAP_EMAIL` and it prints a one-time setup link. Behind HTTPS, set `BOND_COOKIE_SECURE=1`.

Not built yet: SSO, email delivery of invites, QR-code setup (the key is entered by hand in the authenticator app), hardware security keys / passkeys (WebAuthn, which resist phishing where TOTP does not), a UI for customers to opt in to 2FA, and login rate limits that survive restarts or span multiple servers. Note that a resetting admin can take over another admin's account by design; that power is audited but not dual-controlled.

## What the demo simulates

19 agents trade through the real SDK for ~45 simulated days. It is deterministic: the same seed produces the same scores and dollar amounts every run (and produced identical results on the pre-Nest server, which is how the NestJS port was checked).

| Agent | Behaviour | What you should see |
|---|---|---|
| DataFeed-Prime, CloudGPU-Broker | reliable sellers (verified) | Tier A, cheap premiums |
| NewCo-Agent | reliable but unproven | Lower score, pricier bonds until it earns history |
| QuickWidgets-Agent | sloppy (22% failures) | Tier C, expensive bonds |
| ShadyDeals-Bot | scammer (~70% failures) | Score collapses to E, then Bond declines as **uninsurable** |
| ClaimHappy-Bot | buyer that files false claims | Claims **denied** from its own signed receipts; its score drops; sellers refuse it |
| WashTrader-A/B | two agents trading big "perfect" deals with each other | Score is **capped below tier A** |
| 12 purchasing agents | buyers with owner mandates | Blocked when they exceed their limits; every block is logged |

## Architecture

NestJS, organised by feature. Each feature is a module with its own controllers (HTTP), services (logic) and types.

```
src/
├── main.ts / bootstrap.ts     start-up from the environment / createApp(options) used by main, the demo and the tests
├── app.module.ts              wires the modules, the global auth guard, the error filter and the edge middleware
├── config/                    BondOptions (everything configurable) and its module
├── common/                    cross-cutting: AuthGuard, EdgeMiddleware, exception filter, decorators, HttpError
├── core/                      infrastructure services: clock, ledger, audit log, mailer, rate limiting, nonces
├── storage/                   db.types.ts (every stored shape), MongoService (connection + transactions), EntityStore, indexes
├── domain/                    PURE logic, no framework: scoring, pricing, policy, arbiter, ledger chain, TOTP, passwords, roles
├── identity/                  orgs, users, sessions, two-factor, sign-in, signup, agent enrolment codes  (+ auth/signup controllers)
├── agents/                    registration, the owner's mandate, kill switch, reputation             (+ agents controller)
├── deals/                     quotes, the transaction state machine, pool, disputes, reports, sweeper (+ deals/reports controllers)
└── console/                   the dashboard's API: orgs, users, audit, enrolment, agent controls, dispute review
sdk/                           BondClient for agent developers (own ESM package)
demo/                          marketplace simulation and demo sign-ins
test/                          88 tests (node:test) run against the compiled build: mostly black-box over HTTP, a route audit, and database-race tests
                               (each test app gets a throwaway database, `bond_test_<hex>`, dropped when it closes)
```

### Database design (MongoDB)

- **Transactions.** `MongoService.transaction(fn)` runs an operation all-or-nothing. The current session travels in an `AsyncLocalStorage`, so every query made through `mongo.tx` / the stores joins it automatically, and nested calls join the outer one. A deal, the pool balance and both parties' ledgers commit together or not at all.
- **Ledger.** One document per entry, `_id = "<agentId>:<seq>"`, plus a unique (agent, seq) index: two writers racing to append the same position cannot both win (the loser retries), so the hash chain can never fork or gap.
- **Pool.** A single document updated with `$inc`. Creating a bond takes a lock on it (`$inc version`) *before* checking capacity, which serialises bonding so two deals can't both fit into the last dollar of capacity. Reserved coverage and per-seller exposure are derived from the deals by aggregation, never stored twice.
- **One-time things are compare-and-set in the database**, not check-then-write in code: a TOTP step (`totp.lastStep`), recovery codes (`$pull`), invite acceptance, enrollment codes (claimed inside the registration transaction, so a failed registration leaves the code usable), signup verification (`findOneAndDelete`).
- **Unique indexes** back the rules the code also checks: user email, normalised company name (`nameKey`), ledger position, replayed request nonce.
- **Expiry** uses TTL indexes on `gcAt` for sessions, pending signups, enrollments and nonces. `gcAt` is wall-clock (with slack) and never tied to the virtual clock the tests and demo use.
- **Audit records** are written outside transactions that might roll back, so a refused sign-in still leaves a trace.

Limits to know about: the `audit` collection is unbounded (add retention); rate-limit counters and 2FA challenges are still in process memory, so run one API instance until those move to the database; the dev `mongod` has no authentication (use a secured cluster, TLS and a least-privilege user in production).

How a request flows:

1. **`EdgeMiddleware`** runs first: security headers, the caller's address, the Origin check, and reading the body once (keeping the exact bytes: agent signatures cover them).
2. **`AuthGuard`** (global) authenticates from the route's `@Access('public' | 'agent' | 'register' | 'user' | 'any')` and checks `@RequirePermission(...)`. **A route with no annotation requires a signed-in person, so forgetting one fails closed.** The result is available to handlers through `@CurrentUser()`, `@AgentId()`, `@CallerScope()`.
3. The **controller** hands off to a **service**; services use the pure **domain** functions.
4. **`AllExceptionsFilter`** turns every error into `{ error: { code, message, details? } }`. Business errors are `HttpError`s with stable codes.

Known small differences from the pre-Nest prototype: an unsupported method on a known path answers `404` (the prototype said `405`), and `createApp()` is now `async`.

### Deal lifecycle

```
purchase() ── quote ──▶ proposed ──seller accept──▶ accepted ──buyer payment──▶ funded ──seller deliver──▶ delivered ──buyer receipt(ok)──▶ fulfilled
   │            │           │                            │                          │                          │
   │      declined if:      └─ cancel/decline/timeout ───┴─ premium refunded        └─ deadline passes ─┐      └─ receipt(!ok) ─┐
   │      • mandate breach                                                                            ▼                        ▼
   │      • counterparty uninsurable (P(fault) > 35%)                                            dispute ──▶ arbiter ──▶ seller_fault (payout) / buyer_fault (denied) / needs_review (human)
   │      • pool capacity / seller concentration
```

Delivery is proven by hash: the seller signs `sha256(what it delivered)`, the buyer signs `sha256(what it received)`,
and both are compared with `sha256(agreed spec)`. The arbiter's rules:

| Evidence | Verdict |
|---|---|
| Paid, nothing delivered by deadline | seller at fault, **payout** |
| Seller's own delivery hash != agreed spec | seller at fault, **payout** |
| Buyer's own receipt hash == agreed spec but claim filed | buyer at fault, **denied** (seller credited) |
| Ledger fails hash-chain check | that party at fault |
| Late delivery / conflicting or missing acknowledgements | **human review** |

### Scoring

`score = 1000 x (mean - 2 x stddev)` of a Beta posterior over "honours commitments", starting from a (9 success, 1 fault) prior, plus a verification bonus.

- Outcomes are weighted by value at risk (`log10(1 + $/10)`), so $1 wash trades barely count.
- No single counterparty can contribute more than 6.0 of positive weight, which caps score-pumping between colluding agents.
- 120-day half-life: recent behaviour matters most.
- Faults are never capped.

### Pricing

`premium = coverage x P(fault) x 1.5 x size load`, floored at 0.5%. `P(fault)` is the posterior mean fault rate, reduced by owner verification (-25% / -40%) and scaled by category (digital goods 0.8x ... legal 1.6x). Above 35% the risk is declined at any price.
The pool reserves $0.25 per $1 of coverage in force and won't put more than 10% of capacity on one seller.

## API

One API, one permission model, two frontends. Every endpoint checks the caller's role and permissions itself,
regardless of which console (or neither) called it — the endpoint list below is grouped by who can actually
use each one, but that's a reading aid, not a second layer of routing. See `BOND_ALLOWED_ORIGINS` / two session
cookies above for how the two consoles' sign-ins stay apart.

Nothing is public except `GET /v1/health`, the sign-in endpoints, and (only when signup is open) `POST /v1/signup`, `/v1/signup/resend`, `/v1/signup/verify` — customer-only; staff accounts are never self-service.

**Agent requests** (signed, no cookie, used by the SDK — not either console): `POST /v1/agents` (self-registration, optional `enrollmentCode`), `GET /v1/me`, `PUT /v1/me/policy` (unlinked agents only), `POST /v1/quotes`, `POST /v1/transactions`, `POST /v1/transactions/:id/events`, `POST /v1/transactions/:id/disputes`.

**Sign-in** (both consoles, same endpoints): `POST /v1/auth/login`, `/v1/auth/accept-invite`, `/v1/auth/logout`, `/v1/auth/change-password`, `GET /v1/auth/me`, `PUT /v1/auth/me`, `GET /v1/auth/sessions`, `POST /v1/auth/sessions/:id/revoke`, `/v1/auth/sessions/revoke-all`, `/v1/auth/email/verify/send`, `PUT /v1/auth/phone`, `POST /v1/auth/phone/verify/send`, `/v1/auth/phone/verify/confirm`. Accounts with two-factor get `{ needs: "totp" | "enroll", challenge }` instead of a cookie, then finish with `POST /v1/auth/2fa/verify` (code or recovery code), or `/v1/auth/2fa/begin` + `/v1/auth/2fa/confirm` (first-time setup). `POST /v1/auth/2fa/recovery-codes` (signed in) replaces the recovery codes. `POST /v1/auth/email/verify/confirm` is public (see Contact verification, above) rather than listed here.

**Read endpoints** (both consoles; scoped to what that caller may see — a customer only their own company, staff everyone): `GET /v1/agents`, `/v1/agents/:id`, `/v1/agents/:id/ledger`, `/v1/transactions`, `/v1/transactions/:id`, `/v1/disputes`, `/v1/pricing/preview?seller=&amountCents=&category=`, `GET /v1/console/agents/:id`.

**Shared console actions** (dashboard *and* admin-app — an owner on their own agents/team, staff on anyone's): `PUT /v1/console/agents/:id/policy` (`agents_manage`), `POST /v1/console/agents/:id/status` (`agents_suspend`), `POST /v1/console/enrollments` (`enroll`), `GET/POST /v1/console/users`, `/v1/console/users/:id/{disable,enable,reset}` (`team_manage`).

**Staff-only console actions** (admin-app; the dashboard has no UI for these, and a customer session would get 403 regardless): `GET /v1/stats` (pool health, `stats`), `GET /v1/console/overview` (staff's version reads `/v1/stats` instead), `GET/POST /v1/console/orgs`, `POST /v1/console/orgs/:id/verify` (`orgs`), `GET /v1/console/audit` (`audit`), `POST /v1/console/agents/:id/verify` (`verify`), `POST /v1/console/disputes/:id/resolve` (`resolve`, admin + reviewer), `POST /v1/console/sweep` (`sweep`).

**Organization profile:** `PUT /v1/console/orgs/:id/profile` (`org_manage`: org admins on their own org, staff on any) sets `about` (500 chars), `website` (http/https URL), `contactEmail`, `country` and `industry`. It is partial: only the fields sent change, and an empty string clears one. The profile comes back on `GET /v1/console/orgs`; each edit is audited as `org.profile_update`.

Every signed agent request carries `X-Bond-Agent`, `-Timestamp`, `-Nonce`, `-Signature` (Ed25519 over method, path, timestamp, nonce, body hash). Requests older than 5 minutes or with a reused nonce are rejected. Every browser request from either console carries `X-Bond-App: customer` or `staff` (set by that console's own server, not by the browser — see above), which the auth guard uses to pick the matching session cookie.

## SDK

```js
import { BondClient, BondDeclined } from './sdk/index.js';

const bond = await BondClient.register({
  baseUrl: 'http://localhost:4100', name: 'ProcureBot', owner: 'Acme Corp',
  policy: { perTxLimitCents: 50_000, dailyLimitCents: 200_000, allowedCategories: ['data', 'digital_goods'] },
});

try {
  const { transaction } = await bond.purchase({
    counterparty: sellerId, spec: '10k rows of EU pricing data', priceCents: 12_000, category: 'data',
  });
  // ... seller: await seller.accept(transaction.id); await seller.deliver(transaction.id, item)
  await bond.pay(transaction);
  await bond.receipt(transaction.id, { item, ok: true });
} catch (e) {
  if (e instanceof BondDeclined) console.log(e.codes, e.reasons); // POLICY_PER_TX_LIMIT, UNINSURABLE, ...
}
```

Pass `coverageCents: 0` for **audit-only mode**: the mandate and ledger apply, no premium is charged.

## What this MVP is, and isn't

- **Real:** identity and signing, the state machine, scoring, pricing, pool accounting, arbitration, and the audit ledger. All of it is exercised by tests and the simulation.
- **Simulated:** money. Payments are events in a ledger, not real transfers, and the reserve pool is fictional capital.
- **Synthetic calibration:** priors, loadings, and thresholds are reasoned defaults tuned against a simulation I wrote. They are hypotheses to test against real loss data, not findings.
- **Not production:** an unsecured dev MongoDB, single process (rate-limit counters and sign-in challenges live in memory), a hosted (not decentralised) ledger, and no privacy layer for transaction contents.
- **Not legal:** paying out on failed deals is insurance in most jurisdictions. See `../docs/PLAN.md` for the licensing route.
