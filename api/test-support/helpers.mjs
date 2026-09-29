import { randomBytes } from 'node:crypto';
import { createApp } from '../dist/bootstrap.js';
import { BondClient } from '../sdk/index.js';
import { newSecret, newRecoveryCode, totpCode, stepAt, STEP_SECONDS } from '../dist/domain/totp.js';

// Every test app gets its own throwaway database on the local MongoDB (npm run db:start), dropped when it closes.
export async function testApp(options = {}) {
  return createApp({ mongoDb: 'bond_test_' + randomBytes(5).toString('hex'), dropDbOnClose: true, ...options });
}

// Everything in the database as one JSON string, for "is this secret stored anywhere?" checks.
export async function dumpDb(app) {
  const out = {};
  for (const c of await app.mongo.db.listCollections().toArray()) out[c.name] = await app.mongo.db.collection(c.name).find().toArray();
  return JSON.stringify(out);
}

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export async function setup() {
  const clock = {
    offset: 0,
    now() { return Date.now() + this.offset; },
    advance(ms) { this.offset += ms; },
  };
  const app = await testApp({ clock, signup: 'open', devMailbox: true });
  const port = await app.listen(0);
  const baseUrl = `http://127.0.0.1:${port}`;
  const now = () => clock.now();
  const agent = (name, policy, extra = {}) => BondClient.register({ baseUrl, name, owner: name + ' Inc', policy, now, ...extra });

  // A valid, never-yet-used authenticator code. Each code works once, so when several sign-ins happen within
  // the same 30 seconds we take the next step, and move the test clock forward when the window runs out.
  const nextCode = async (email, secret) => {
    const last = (await app.accounts.findByEmail(email)).totp?.lastStep ?? -1;
    const step = Math.max(stepAt(clock.now()), last + 1);
    while (step > stepAt(clock.now()) + 1) clock.advance(STEP_SECONDS * 1000);
    return totpCode(secret, step * STEP_SECONDS * 1000);
  };

  // A cookie-holding console client for one signed-in person (completing two-factor if the account has it).
  const signIn = async (email, password, totpSecret) => {
    let cookie = '';
    const req = async (method, path, body, headers = {}) => {
      const res = await fetch(baseUrl + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
        body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
      return { status: res.status, body: await res.json().catch(() => ({})), headers: res.headers };
    };
    let r = await req('POST', '/v1/auth/login', { email, password });
    if (r.status === 200 && r.body.needs === 'totp') {
      if (!totpSecret) throw new Error('this account needs a two-factor code but the test gave no secret');
      r = await req('POST', '/v1/auth/2fa/verify', { challenge: r.body.challenge, code: await nextCode(email, totpSecret) });
    }
    if (r.status !== 200 || r.body.needs) throw new Error(`sign-in failed: ${r.status} ${JSON.stringify(r.body)}`);
    // An evidence-file upload: the body is the file's bytes, the details ride in the query string.
    const upload = async (kind, data, contentType, filename = 'evidence.pdf') => {
      const res = await fetch(baseUrl + `/v1/console/verification-documents?kind=${kind}&filename=${encodeURIComponent(filename)}`, {
        method: 'POST', headers: { 'Content-Type': contentType, ...(cookie ? { Cookie: cookie } : {}) }, body: data,
      });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    };
    // A download: the raw bytes, not JSON.
    const download = async (path) => {
      const res = await fetch(baseUrl + path, { headers: cookie ? { Cookie: cookie } : {} });
      return { status: res.status, data: Buffer.from(await res.arrayBuffer()), headers: res.headers };
    };
    return { req, upload, download, user: r.body.user, permissions: r.body.permissions, get cookie() { return cookie; } };
  };

  // Creates a person with a random strong password (never hard-coded) and returns their credentials + a sign-in helper.
  // Staff come fully enrolled in two-factor (as they must be); customers don't have it.
  let n = 0;
  const makeUser = async ({ role, orgId, name = 'Test Person', enrolled = true }) => {
    const email = `${role}-${++n}@test.example`;
    const password = 'Ts-' + randomBytes(14).toString('base64url');
    const staff = role === 'admin' || role === 'reviewer';
    const totpSecret = staff && enrolled ? newSecret() : undefined;
    const recoveryCodes = totpSecret ? Array.from({ length: 3 }, newRecoveryCode) : [];
    const user = await app.accounts.createUser({ email, name, role, orgId, password, totpSecret, recoveryCodes });
    return { email, password, user, totpSecret, recoveryCodes, signIn: () => signIn(email, password, totpSecret) };
  };

  // Sessions expire when idle (tests fast-forward the clock), so admin calls sign in fresh, like a real admin would.
  const adminUser = await makeUser({ role: 'admin', name: 'Test Admin' });
  const admin = async (method, path, body) => (await (await adminUser.signIn()).req(method, path, body)).body;

  return { app, clock, baseUrl, agent, admin, adminUser, makeUser, signIn, nextCode, close: () => app.close() };
}

// Runs one order up to (and including) payment. Returns the funded transaction.
export async function fundedOrder(buyer, seller, { spec = 'Widget x10', priceCents = 5000, category = 'physical_goods', deliverInMs = DAY } = {}) {
  const { transaction } = await buyer.purchase({
    counterparty: seller.agentId, spec, priceCents, category, deliverBy: buyer.now() + deliverInMs,
  });
  await seller.accept(transaction.id);
  await buyer.pay(transaction);
  return { tx: transaction, spec };
}
