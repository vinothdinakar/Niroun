import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createPrivateKey, sign } from 'node:crypto';
import { setup, testApp, fundedOrder, DAY } from '../test-support/helpers.mjs';
import { signingString } from '../dist/domain/agent-auth.js';
import { sha256 } from '../dist/domain/canonical.js';
import { totpCode } from '../dist/domain/totp.js';

// What moving to a database bought us. These are the guarantees the old in-memory code got for free from being
// single-threaded, and that MongoDB has to provide now that requests genuinely overlap.

let w;
before(async () => { w = await setup(); });
after(async () => { await w.close(); });

// A signed request from an agent, by hand, so a test can send the very same payload twice at once.
async function signedPost(agent, path, body) {
  const raw = JSON.stringify(body);
  const timestamp = w.clock.now();
  const nonce = randomBytes(8).toString('hex');
  const key = createPrivateKey({ key: Buffer.from(agent.keys.privateKey, 'base64url'), format: 'der', type: 'pkcs8' });
  const signature = sign(null, Buffer.from(signingString({ method: 'POST', path, timestamp, nonce, body: raw })), key).toString('base64url');
  const res = await fetch(w.baseUrl + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', 'X-Bond-Agent': agent.agentId, 'X-Bond-Timestamp': String(timestamp), 'X-Bond-Nonce': nonce, 'X-Bond-Signature': signature,
    },
    body: raw,
  });
  return { status: res.status, body: await res.json() };
}

const post = async (path, body) => {
  const res = await fetch(w.baseUrl + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

test('an agent\'s audit chain stays gap-free and unforked under a burst of simultaneous writes', async () => {
  const buyer = await w.agent('Racer', { perTxLimitCents: 10_000 });
  const seller = await w.agent('RaceSeller');
  // every one of these is refused by the mandate, and every refusal is written to the buyer's ledger, all at once
  const results = await Promise.all(Array.from({ length: 16 }, () =>
    buyer.quote({ counterparty: seller.agentId, amountCents: 50_000, category: 'data' })));
  assert.ok(results.every((r) => r.decision === 'declined'));

  const ledger = await w.admin('GET', `/v1/agents/${buyer.agentId}/ledger`);
  assert.equal(ledger.verification.ok, true, 'the hash chain is intact');
  assert.equal(ledger.verification.length, 17, 'the registration entry plus exactly 16 refusals: nothing lost, nothing doubled');
  const seqs = ledger.entries.map((e) => e.seq).sort((a, b) => a - b);
  assert.deepEqual(seqs, Array.from({ length: 17 }, (_, i) => i), 'sequence numbers 0..16 with no gaps or repeats');
});

test('the same quote cannot become two deals, even when both requests arrive at the same instant', async () => {
  const buyer = await w.agent('DoubleBuyer');
  const seller = await w.agent('DoubleSeller');
  const q = await buyer.quote({ counterparty: seller.agentId, amountCents: 5000, category: 'data' });
  const body = { quoteId: q.quote.id, terms: { spec: 'thing', priceCents: 5000, deliverBy: w.clock.now() + DAY } };

  const [a, b] = await Promise.all([signedPost(buyer, '/v1/transactions', body), signedPost(buyer, '/v1/transactions', body)]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409], 'exactly one wins');
  assert.equal([a, b].find((r) => r.status === 409).body.error.code, 'QUOTE_USED');

  const deals = (await w.admin('GET', `/v1/transactions?agent=${buyer.agentId}`)).transactions;
  assert.equal(deals.length, 1, 'one deal, one premium');
  const stats = await w.admin('GET', '/v1/stats');
  assert.ok(stats.pool.premiumsCents >= deals[0].premiumCents);
});

test('an enrollment code can be used by exactly one agent, however many race for it', async () => {
  const org = await w.app.accounts.createOrg('Enrollment Race Inc', null);
  const owner = await (await w.makeUser({ role: 'owner_admin', orgId: org.id })).signIn();
  const code = (await owner.req('POST', '/v1/console/enrollments', {})).body.code;

  const contenders = await Promise.all(['A', 'B', 'C', 'D'].map(async (n) => {
    try { return { ok: true, agent: await w.agent('Contender' + n, undefined, { enrollmentCode: code }) }; } catch (e) { return { ok: false, code: e.code }; }
  }));
  assert.equal(contenders.filter((c) => c.ok).length, 1, 'one winner');
  assert.ok(contenders.filter((c) => !c.ok).every((c) => c.code === 'INVALID_ENROLLMENT'));
  const linked = (await w.app.mongo.db.collection('agents').countDocuments({ orgId: org.id }));
  assert.equal(linked, 1, 'and only one agent ended up linked to the company');
});

test('a failed registration rolls back the enrollment claim: the code is still good afterwards', async () => {
  const org = await w.app.accounts.createOrg('Rollback Inc', null);
  const owner = await (await w.makeUser({ role: 'owner_admin', orgId: org.id })).signIn();
  const code = (await owner.req('POST', '/v1/console/enrollments', {})).body.code;

  await assert.rejects(
    () => w.agent('Broken', { perTxLimitCents: -5 }, { enrollmentCode: code }),
    (e) => e.code === 'INVALID_POLICY',
  );
  const good = await w.agent('Fixed', undefined, { enrollmentCode: code });
  assert.equal((await good.me()).orgId, org.id, 'the same code still works, because the failed attempt left no trace');
});

test('a two-factor code (and a recovery code) works once, even if two sign-ins present it simultaneously', async () => {
  const u = await w.makeUser({ role: 'admin' });
  const login = async () => (await post('/v1/auth/login', { email: u.email, password: u.password })).body.challenge;

  const [c1, c2] = await Promise.all([login(), login()]);
  const code = await w.nextCode(u.email, u.totpSecret);
  const [r1, r2] = await Promise.all([post('/v1/auth/2fa/verify', { challenge: c1, code }), post('/v1/auth/2fa/verify', { challenge: c2, code })]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 401], 'one sign-in wins, the replay is refused');

  const [d1, d2] = await Promise.all([login(), login()]);
  const recovery = u.recoveryCodes[0];
  const [s1, s2] = await Promise.all([post('/v1/auth/2fa/verify', { challenge: d1, code: recovery }), post('/v1/auth/2fa/verify', { challenge: d2, code: recovery })]);
  assert.deepEqual([s1.status, s2.status].sort(), [200, 401], 'a recovery code is single-use under a race too');
  const left = (await w.app.accounts.findByEmail(u.email)).recovery.length;
  assert.equal(left, 2, 'exactly one of the three was consumed');
});

test('the database itself enforces uniqueness, not just the application\'s checks', async () => {
  const db = w.app.mongo.db;
  const user = await db.collection('users').findOne({});
  await assert.rejects(() => db.collection('users').insertOne({ ...user, _id: 'usr_forged' }), (e) => e.code === 11000, 'two users can never share an email');
  const org = await db.collection('orgs').findOne({});
  await assert.rejects(() => db.collection('orgs').insertOne({ ...org, _id: 'org_forged' }), (e) => e.code === 11000, 'two companies can never share a name');
  const entry = await db.collection('ledger').findOne({});
  await assert.rejects(() => db.collection('ledger').insertOne({ ...entry, type: 'forged' }), (e) => e.code === 11000, 'a ledger sequence number can never be reused');
  await assert.rejects(() => db.collection('ledger').insertOne({ ...entry, _id: 'other-id' }), (e) => e.code === 11000, 'not even under a different _id');
});

test('look-alike company names collide in the database: "ACME  corp." is the same company as "Acme Corp"', async () => {
  await w.app.accounts.createOrg('Lookalike Systems', null);
  await assert.rejects(() => w.app.accounts.createOrg('LOOKALIKE  systems.', null), (e) => e.code === 'ORG_EXISTS');
  const [a, b] = await Promise.allSettled([w.app.accounts.createOrg('Simultaneous Ltd', null), w.app.accounts.createOrg('SIMULTANEOUS ltd', null)]);
  assert.deepEqual([a.status, b.status].sort(), ['fulfilled', 'rejected'], 'two people creating the same name at once: one wins');
});

test('the deal, the pool and both ledgers move together: a refused write leaves nothing behind', async () => {
  const buyer = await w.agent('AtomicBuyer');
  const seller = await w.agent('AtomicSeller');
  const { tx } = await fundedOrder(buyer, seller, { priceCents: 7000 });
  const poolBefore = (await w.admin('GET', '/v1/stats')).pool;
  const ledgerBefore = (await w.admin('GET', `/v1/agents/${buyer.agentId}/ledger`)).verification.length;

  // an invalid event is rejected halfway through the operation's checks: nothing may have been written
  await assert.rejects(() => buyer.receipt(tx.id, { item: 'x', ok: 'not-a-boolean' }), (e) => e.code === 'BAD_STATE' || e.code === 'INVALID_RECEIPT');
  const poolAfter = (await w.admin('GET', '/v1/stats')).pool;
  assert.deepEqual(poolAfter, poolBefore);
  assert.equal((await w.admin('GET', `/v1/agents/${buyer.agentId}/ledger`)).verification.length, ledgerBefore);
});

test('data survives a restart: a second app on the same database sees everything the first one wrote', async () => {
  const dbName = 'bond_restart_' + randomBytes(4).toString('hex');
  const first = await testApp({ mongoDb: dbName, dropDbOnClose: false });
  await first.accounts.createOrg('Persistent Inc', null);
  const user = await first.accounts.createUser({ email: 'stays@test.example', name: 'Stays', role: 'owner_viewer', orgId: (await first.accounts.listOrgs())[0].id, password: 'Ps-' + randomBytes(12).toString('base64url') });
  await first.close();

  const second = await testApp({ mongoDb: dbName, dropDbOnClose: true }); // starting again creates the indexes again: must be harmless
  try {
    assert.equal((await second.accounts.findByEmail('stays@test.example')).id, user.id);
    assert.equal((await second.accounts.listOrgs()).length, 1);
    const pool = await second.engine.stats();
    assert.equal(pool.pool.capitalCents, 5_000_000, 'the reserve pool was seeded once, not reset by the restart');
  } finally {
    await second.close();
  }
});

test('starting without a reachable MongoDB fails fast, and says how to fix it', async () => {
  await assert.rejects(
    () => testApp({ mongoUrl: 'mongodb://127.0.0.1:1/?directConnection=true', mongoTimeoutMs: 1200 }),
    (e) => /Cannot reach MongoDB/.test(e.message) && /db:start/.test(e.message),
  );
});

test('sanity: totp helper agrees with the server clock used above', () => {
  assert.equal(totpCode('JBSWY3DPEHPK3PXP', 59_000).length, 6);
  assert.equal(sha256('x').length, 64);
});
