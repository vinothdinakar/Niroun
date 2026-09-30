// Simulates ~6 weeks of an agent marketplace through the real SDK + HTTP API, then leaves
// the API running (http://localhost:4100) for the dashboard app to talk to.
//
//   npm run demo          (paced, so the dashboard animates)
//   npm run demo:fast     (no delays)
//   node demo/simulate.mjs --days=60 --seed=3 --port=4100

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const { MongoClient } = createRequire(import.meta.url)('mongodb');
import { createApp } from '../dist/bootstrap.js';
import { newSecret, newRecoveryCode } from '../dist/domain/totp.js';
import { BondClient, BondDeclined, BondError } from '../sdk/index.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v = 'true'] = a.replace(/^--/, '').split('=');
  return [k, v];
}));
const DAYS = Number(args.days) || 45;
const PORT = Number(args.port) || 4100;
const FAST = args.fast === 'true';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// deterministic RNG so runs are reproducible
let seed = Number(args.seed) || 7;
const rand = () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (lo, hi) => Math.round((lo + rand() * (hi - lo)) / 100) * 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const usd = (c) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });

const clock = { offset: -(DAYS * 33 * HOUR), now() { return Date.now() + this.offset; }, advance(ms) { this.offset += ms; } };
// The demo lives in its own database ("bond_demo") on the local MongoDB (npm run db:start), wiped on every run.
const API_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MONGO_URL = process.env.BOND_MONGO_URL || 'mongodb://127.0.0.1:27018/?replicaSet=bond0';
const MONGO_DB = process.env.BOND_MONGO_DB || 'bond_demo';
{
  const wipe = new MongoClient(MONGO_URL, { serverSelectionTimeoutMS: 6000 });
  try {
    await wipe.connect();
    await wipe.db(MONGO_DB).dropDatabase();
  } catch (e) {
    console.error(`Cannot reach MongoDB at ${MONGO_URL}: ${e.message}\nStart it with: npm run db:start`);
    process.exit(1);
  } finally {
    await wipe.close();
  }
}
// Demo server: signup is open and emails go to an in-memory demo mailbox (nothing is sent). It expects to sit
// behind both frontends' proxies: the customer dashboard (default http://localhost:3300, where signup-verify
// links point) and the staff admin app (default http://localhost:3400) — both origins are trusted.
const DASHBOARD_URL = process.env.BOND_PUBLIC_URL || 'http://localhost:3300';
const STAFF_URL = process.env.BOND_STAFF_URL || 'http://localhost:3400';
const app = await createApp({
  mongoUrl: MONGO_URL, mongoDb: MONGO_DB, keyFile: join(API_DIR, 'data', 'encryption.key'),
  clock, signup: 'open', devMailbox: true,
  publicUrl: DASHBOARD_URL, allowedOrigins: [DASHBOARD_URL, STAFF_URL], trustProxy: true,
});
await app.listen(PORT);
const baseUrl = `http://localhost:${PORT}`;
const now = () => clock.now();
const reg = (o) => BondClient.register({ baseUrl, now, ...o });

// ---------------- console sign-ins ----------------
// Demo people, created fresh on every run. Their passwords are generated once, at random, into
// demo/demo-users.json (git-ignored). `npm start` never creates or reads any of this.
const usersFile = join(dirname(fileURLToPath(import.meta.url)), 'demo-users.json');
if (!existsSync(usersFile)) {
  const pw = () => randomBytes(15).toString('base64url');
  const people = [
    { email: 'admin@bond.test', name: 'Ada Admin', role: 'admin', org: null },
    { email: 'reviewer@bond.test', name: 'Rex Reviewer', role: 'reviewer', org: null },
    { email: 'owner@acme.test', name: 'Olivia Owner', role: 'owner_admin', org: 'Acme Corp' },
    { email: 'finance@acme.test', name: 'Finn Finance', role: 'owner_viewer', org: 'Acme Corp' },
    { email: 'owner@northwind.test', name: 'Nora Northwind', role: 'owner_admin', org: 'Northwind' },
  ].map((p) => ({ ...p, password: pw() }));
  writeFileSync(usersFile, JSON.stringify({ note: 'Local demo sign-ins created by `npm run demo`. Not used by `npm start`.', users: people }, null, 2));
}
const demoFile = JSON.parse(readFileSync(usersFile, 'utf8'));
const demoPeople = demoFile.users;
// Staff accounts require two-factor, so the demo staff come pre-enrolled. Their authenticator key and recovery
// codes are generated once and kept in the same git-ignored file, so one setup in a phone app lasts across runs.
let patched = false;
for (const p of demoPeople) {
  if (['admin', 'reviewer'].includes(p.role) && !p.totpSecret) {
    p.totpSecret = newSecret();
    p.recoveryCodes = Array.from({ length: 5 }, newRecoveryCode);
    patched = true;
  }
}
if (patched) writeFileSync(usersFile, JSON.stringify(demoFile, null, 2));
const orgs = {};
for (const n of ['Acme Corp', 'Northwind']) orgs[n] = await app.accounts.createOrg(n, null);
let demoAdmin;
for (const p of demoPeople) {
  const u = await app.accounts.createUser({ email: p.email, name: p.name, role: p.role, orgId: p.org ? orgs[p.org].id : undefined, password: p.password, totpSecret: p.totpSecret, recoveryCodes: p.recoveryCodes });
  if (p.role === 'admin') demoAdmin = u;
}
// Two of the buyers belong to customer organisations, enrolled the way a real owner would do it.
const enrollment = async (orgName, label) => (await app.accounts.createEnrollment(demoAdmin, orgs[orgName].id, label)).code;

console.log(`Bond demo server on ${baseUrl}  (simulating ${DAYS} days)\n`);

// ---------------- cast ----------------
const sellerDefs = [
  { name: 'DataFeed-Prime', owner: 'DataFeed Inc.', verify: 2, cats: ['data', 'digital_goods'], noDeliver: 0.01, wrong: 0.005, price: [2000, 40000] },
  { name: 'CloudGPU-Broker', owner: 'Nimbus Compute', verify: 1, cats: ['digital_goods', 'services'], noDeliver: 0.03, wrong: 0.02, price: [20000, 120000] },
  { name: 'QuickWidgets-Agent', owner: 'QuickWidgets LLC', verify: 0, cats: ['physical_goods'], noDeliver: 0.12, wrong: 0.1, price: [5000, 90000] },
  { name: 'ShadyDeals-Bot', owner: '(unverified)', verify: 0, cats: ['physical_goods', 'digital_goods'], noDeliver: 0.55, wrong: 0.15, price: [8000, 150000] },
  { name: 'NewCo-Agent', owner: 'NewCo', verify: 0, cats: ['services', 'data'], noDeliver: 0.02, wrong: 0.02, price: [3000, 60000] },
];
const buyerDefs = [
  { name: 'ProcureBot', owner: 'Acme Corp', policy: { perTxLimitCents: 150_000, dailyLimitCents: 400_000, minCounterpartyScore: 550 }, falseClaims: 0 },
  { name: 'OpsAgent', owner: 'Northwind', policy: { perTxLimitCents: 100_000, dailyLimitCents: 250_000, minCounterpartyScore: 600 }, falseClaims: 0 },
  { name: 'TravelAgent', owner: 'Globex', policy: { perTxLimitCents: 60_000, dailyLimitCents: 150_000, allowedCategories: ['services', 'digital_goods', 'data'], minCounterpartyScore: 600 }, falseClaims: 0 },
  { name: 'ClaimHappy-Bot', owner: 'Initech', policy: { perTxLimitCents: 80_000, dailyLimitCents: 200_000, minCounterpartyScore: 0 }, falseClaims: 0.5 },
];

const sellers = [];
for (const d of sellerDefs) {
  const c = await reg({ name: d.name, owner: d.owner, policy: { perTxLimitCents: 1_000_000, dailyLimitCents: 10_000_000 } });
  if (d.verify) await app.engine.setVerification(c.agentId, d.verify);
  sellers.push({ ...d, client: c });
}
// A fleet of smaller buyers, so reputation comes from many counterparties (as in a real market).
// Half of them have no minimum score in their own mandate: for those, only Bond's underwriting
// stands between them and a known scammer.
['Lumen', 'Orbit', 'Pixel', 'Quanta', 'Ridge', 'Sable', 'Tandem', 'Umbra'].forEach((n, i) => buyerDefs.push({
  name: `${n}-Purchasing`, owner: `${n} Labs`, fleet: true, falseClaims: 0,
  policy: { perTxLimitCents: 100_000, dailyLimitCents: 250_000, minCounterpartyScore: i % 2 ? 500 : 0 },
}));
const buyers = [];
const orgOf = { ProcureBot: 'Acme Corp', OpsAgent: 'Northwind' };
for (const d of buyerDefs) {
  const enrollmentCode = orgOf[d.name] ? await enrollment(orgOf[d.name], d.name) : undefined;
  buyers.push({ ...d, client: await reg({ ...d, enrollmentCode }) });
}
const washA = await reg({ name: 'WashTrader-A', owner: '(unverified)', policy: { perTxLimitCents: 100_000, dailyLimitCents: 1_000_000 } });
const washB = await reg({ name: 'WashTrader-B', owner: '(unverified)', policy: { perTxLimitCents: 100_000, dailyLimitCents: 1_000_000 } });

// ---------------- one order ----------------
const totals = { orders: 0, blocked: 0, declined: 0, fulfilled: 0, disputes: 0, payoutsCents: 0, deniedClaims: 0 };
const notable = new Set();
const note = (key, msg) => { if (!notable.has(key)) { notable.add(key); console.log('  * ' + msg); } };

async function placeOrder(buyer, seller, { category, priceCents, behavior }) {
  const spec = `${category} order #${Math.floor(rand() * 1e6)}: ${(priceCents / 100).toFixed(0)} USD of goods`;
  let tx;
  try {
    ({ transaction: tx } = await buyer.client.purchase({
      counterparty: seller.client.agentId, spec, priceCents, category, deliverBy: now() + DAY,
    }));
  } catch (e) {
    if (!(e instanceof BondDeclined)) throw e;
    if (e.codes.some((c) => c.startsWith('POLICY_'))) {
      totals.blocked++;
      note(`block:${buyer.name}:${e.codes[0]}`, `${buyer.name} blocked by its own mandate: ${e.reasons[0].message}`);
    } else {
      totals.declined++;
      note(`decl:${seller.name}`, `Bond declined coverage for ${seller.name}: ${e.reasons[0].message}`);
    }
    return null;
  }
  totals.orders++;
  clock.advance(between(60_000, 600_000));

  // sellers screen buyers too
  const buyerScore = (await seller.client.score(buyer.client.agentId)).score;
  if (buyerScore < 500) {
    await seller.client.decline(tx.id, 'buyer score too low');
    note(`sellerdecl:${buyer.name}`, `${seller.name} refused to trade with ${buyer.name} (score ${buyerScore})`);
    return null;
  }
  await seller.client.accept(tx.id);
  await buyer.client.pay(tx);
  clock.advance(between(60_000, 3_600_000));

  let delivered = spec;
  if (behavior === 'none') delivered = null;
  else if (behavior === 'wrong') delivered = 'A different item than the one ordered';
  if (delivered !== null) await seller.client.deliver(tx.id, delivered);
  return { tx, spec, delivered, buyer, seller };
}

const behaviorOf = (s) => { const r = rand(); return r < s.noDeliver ? 'none' : r < s.noDeliver + s.wrong ? 'wrong' : 'ok'; };

async function settleOrder(o) {
  const { tx, spec, delivered, buyer, seller } = o;
  const c = buyer.client;
  if (delivered === null) {
    const { dispute, transaction } = await c.dispute(tx.id, 'Paid but nothing was delivered');
    totals.disputes++; totals.payoutsCents += transaction.payoutCents;
    if (transaction.payoutCents) note(`payout:${seller.name}`, `PAYOUT ${usd(transaction.payoutCents)} to ${buyer.name}: ${seller.name} never delivered (${dispute.rule})`);
  } else if (delivered !== spec) {
    await c.receipt(tx.id, { item: delivered, ok: false });
    const { transaction } = await c.dispute(tx.id, 'Received the wrong item');
    totals.disputes++; totals.payoutsCents += transaction.payoutCents;
  } else if (rand() < buyer.falseClaims) {
    await c.receipt(tx.id, { item: spec, ok: false, note: 'buyer remorse' });
    const { dispute, transaction } = await c.dispute(tx.id, 'Item not as described');
    totals.disputes++; totals.deniedClaims++;
    if (dispute.verdict === 'buyer_fault') note(`falseclaim:${buyer.name}`, `${buyer.name} filed a false claim against ${seller.name}: denied (${dispute.rule}), buyer score penalised`);
    totals.payoutsCents += transaction.payoutCents;
  } else {
    await c.receipt(tx.id, { item: spec, ok: true });
    totals.fulfilled++;
  }
}

// ---------------- the days ----------------
const pace = () => (FAST ? 0 : 25);
for (let day = 1; day <= DAYS; day++) {
  const pending = [];

  for (const buyer of buyers) {
    const n = buyer.fleet ? Math.floor(rand() * 2.2) : 1 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      const seller = pick(sellers);
      const category = pick(seller.cats);
      const priceCents = between(...seller.price);
      const o = await placeOrder(buyer, seller, { category, priceCents, behavior: behaviorOf(seller) });
      if (o) pending.push(o);
      await sleep(pace());
    }
  }

  // two wash traders farm each other with big, "perfect" trades from day 10 to 30
  if (day >= 10 && day <= 30) {
    for (const [x, y] of [[washA, washB], [washB, washA]]) {
      const spec = `wash ${day}-${Math.floor(rand() * 1e6)}`;
      try {
        const { transaction: tx } = await x.purchase({ counterparty: y.agentId, spec, priceCents: 90_000, category: 'digital_goods', deliverBy: now() + DAY });
        await y.accept(tx.id);
        await x.pay(tx);
        await y.deliver(tx.id, spec);
        await x.receipt(tx.id, { item: spec, ok: true });
        totals.orders++; totals.fulfilled++;
      } catch (e) {
        if (!(e instanceof BondDeclined)) throw e;
      }
    }
  }

  clock.advance(25 * HOUR); // end of day: deadlines pass
  for (const o of pending) {
    if (o.delivered === null || o.delivered !== o.spec || rand() < 0.97) await settleOrder(o).catch((e) => {
      if (!(e instanceof BondError)) throw e;
    });
    await sleep(pace() / 2);
  }
  await app.engine.sweep();

  if (day % 5 === 0 || day === DAYS) {
    const s = await app.engine.stats();
    console.log(`day ${String(day).padStart(2)}  orders ${String(totals.orders).padStart(3)}  blocked ${totals.blocked}  declined ${String(totals.declined).padStart(3)}  disputes ${String(totals.disputes).padStart(2)}  loss ratio ${(s.lossRatio * 100).toFixed(0)}%  solvency ${s.solvencyRatio ? s.solvencyRatio.toFixed(1) + 'x' : 'n/a'}`);
  }
}

// The simulation ran on a fast-forwarded clock. Authenticator codes depend on real time, so hand the
// server back to the real clock now that the simulated weeks are over.
clock.offset = 0;

// ---------------- summary ----------------
const { rows: agents } = await app.engine.listAgents();
const stats = await app.engine.stats();
console.log('\nFinal Bond Scores');
console.log('  score  tier  fault%  name');
for (const a of agents) console.log(`  ${String(a.score).padStart(5)}  ${a.tier.padEnd(4)}  ${(a.faultRate * 100).toFixed(1).padStart(5)}  ${a.name}`);
const p = stats.pool;
console.log(`\nPool: premiums ${usd(p.premiumsCents - p.refundsCents)}  payouts ${usd(p.payoutsCents)}  balance ${usd(p.balanceCents)}  loss ratio ${(stats.lossRatio * 100).toFixed(0)}%`);
console.log(`Volume ${usd(stats.volumeCents)} across ${stats.counts.transactions} transactions; ${totals.blocked} blocked by mandate, ${totals.declined} declined as uninsurable, ${totals.deniedClaims} false claims denied.`);
if (args.exit === 'true') {
  await app.close();
  process.exit(0);
}
console.log(`\nAPI running at ${baseUrl}`);
console.log(`  customer dashboard: ${DASHBOARD_URL}  (owner_admin / owner_viewer accounts)`);
console.log(`  staff admin app:    ${STAFF_URL}  (admin / reviewer accounts)`);
console.log('Sign in with one of the demo accounts listed in demo/demo-users.json:');
for (const p of demoPeople) console.log(`  ${p.email.padEnd(24)} ${p.role.padEnd(13)} ${p.org ?? 'Bond staff'}`);
console.log('Bond staff accounts also need a two-factor code. Either add the key from demo/demo-users.json to an authenticator app,');
console.log('or print the current code with:  npm run demo:code -- admin@bond.test');
console.log('Ctrl+C to stop.');
process.on('SIGINT', () => app.close().then(() => process.exit(0)));
setInterval(() => app.engine.sweep().catch(() => {}), 60_000).unref();
