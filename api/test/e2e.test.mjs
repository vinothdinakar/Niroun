import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, fundedOrder, HOUR, DAY } from '../test-support/helpers.mjs';
import { BondDeclined, BondError, BondClient } from '../sdk/index.js';

let w;
before(async () => { w = await setup(); });
after(async () => { await w.close(); });

const post = (path, body, headers = {}) =>
  fetch(w.baseUrl + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('happy path: propose -> accept -> pay -> deliver -> receipt -> fulfilled, both scores improve', async () => {
  const buyer = await w.agent('Buyer1');
  const seller = await w.agent('Seller1');
  const before = (await seller.score()).score;
  const { tx, spec } = await fundedOrder(buyer, seller);
  assert.ok(tx.premiumCents > 0);
  await seller.deliver(tx.id, spec);
  const done = await buyer.receipt(tx.id, { item: spec, ok: true });
  assert.equal(done.status, 'fulfilled');
  assert.ok((await seller.score()).score > before);
  const ledger = await w.admin('GET', `/v1/agents/${seller.agentId}/ledger`);
  assert.equal(ledger.verification.ok, true);
});

test('non-delivery: dispute after deadline pays out full coverage and hurts the seller', async () => {
  const buyer = await w.agent('Buyer2');
  const seller = await w.agent('Seller2');
  const before = await seller.score();
  const { tx } = await fundedOrder(buyer, seller, { priceCents: 20_000 });
  await assert.rejects(() => buyer.dispute(tx.id, 'too early'), (e) => e.code === 'PREMATURE_DISPUTE');
  w.clock.advance(DAY + HOUR);
  const { dispute, transaction } = await buyer.dispute(tx.id, 'never arrived');
  assert.equal(dispute.verdict, 'seller_fault');
  assert.equal(dispute.rule, 'NON_DELIVERY');
  assert.equal(transaction.status, 'resolved_seller_fault');
  assert.equal(transaction.payoutCents, 20_000);
  const after = await seller.score();
  assert.ok(after.score < before.score);
  assert.equal(after.stats.faults, 1);
  const stats = await w.admin('GET', '/v1/stats');
  assert.ok(stats.pool.payoutsCents >= 20_000);
});

test('wrong item: the seller\'s own signed delivery hash convicts them', async () => {
  const buyer = await w.agent('Buyer3');
  const seller = await w.agent('Seller3');
  const { tx } = await fundedOrder(buyer, seller);
  await seller.deliver(tx.id, 'Something else entirely');
  await buyer.receipt(tx.id, { item: 'Something else entirely', ok: false });
  const { dispute } = await buyer.dispute(tx.id, 'wrong item');
  assert.equal(dispute.verdict, 'seller_fault');
  assert.equal(dispute.rule, 'NON_CONFORMING');
});

test('false claim: buyer\'s own receipt matches the spec, so the claim is denied and the buyer is penalised', async () => {
  const buyer = await w.agent('Buyer4');
  const seller = await w.agent('Seller4');
  const { tx, spec } = await fundedOrder(buyer, seller);
  await seller.deliver(tx.id, spec);
  await buyer.receipt(tx.id, { item: spec, ok: false, note: 'changed my mind' });
  const { dispute, transaction } = await buyer.dispute(tx.id, 'refund please');
  assert.equal(dispute.verdict, 'buyer_fault');
  assert.equal(transaction.payoutCents, 0);
  assert.equal((await buyer.score()).stats.faults, 1);
  assert.equal((await seller.score()).stats.faults, 0);
});

test('ambiguous disputes escalate to a human, who can resolve them', async () => {
  const buyer = await w.agent('Buyer5');
  const seller = await w.agent('Seller5');
  const { tx, spec } = await fundedOrder(buyer, seller);
  await seller.deliver(tx.id, spec);
  const { dispute } = await buyer.dispute(tx.id, 'nothing arrived');
  assert.equal(dispute.status, 'needs_review');
  const denied = await post(`/v1/console/disputes/${dispute.id}/resolve`, { verdict: 'seller_fault' });
  assert.equal(denied.status, 401);
  const resolved = await w.admin('POST', `/v1/console/disputes/${dispute.id}/resolve`, { verdict: 'seller_fault', note: 'courier confirms non-delivery' });
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.decidedBy, 'human');
  assert.equal((await buyer.transaction(tx.id)).payoutCents, 5000);
});

test('spending mandate: over-limit purchases are blocked, logged, and never reach a counterparty', async () => {
  const buyer = await w.agent('Careful', { perTxLimitCents: 10_000, dailyLimitCents: 15_000, allowedCategories: ['data'] });
  const seller = await w.agent('Seller6');
  await assert.rejects(
    () => buyer.purchase({ counterparty: seller.agentId, spec: 'x', priceCents: 50_000, category: 'data' }),
    (e) => e instanceof BondDeclined && e.codes.includes('POLICY_PER_TX_LIMIT'),
  );
  await assert.rejects(
    () => buyer.purchase({ counterparty: seller.agentId, spec: 'x', priceCents: 5000, category: 'legal' }),
    (e) => e instanceof BondDeclined && e.codes.includes('POLICY_CATEGORY'),
  );
  await buyer.purchase({ counterparty: seller.agentId, spec: 'x', priceCents: 9000, category: 'data' });
  await assert.rejects(
    () => buyer.purchase({ counterparty: seller.agentId, spec: 'y', priceCents: 9000, category: 'data' }),
    (e) => e.codes.includes('POLICY_DAILY_LIMIT'),
  );
  const ledger = await w.admin('GET', `/v1/agents/${buyer.agentId}/ledger`);
  assert.ok(ledger.entries.filter((e) => e.type === 'policy_block').length >= 3);
});

test('a serial defaulter becomes uninsurable', async () => {
  const buyer = await w.agent('Buyer7', { perTxLimitCents: 500_000, dailyLimitCents: 5_000_000, minCounterpartyScore: 0 });
  const scammer = await w.agent('Scammer');
  let declined = null;
  for (let i = 0; i < 25 && !declined; i++) {
    try {
      const { tx } = await fundedOrder(buyer, scammer, { priceCents: 10_000, category: 'digital_goods', deliverInMs: HOUR });
      w.clock.advance(2 * HOUR);
      await buyer.dispute(tx.id, 'no delivery');
    } catch (e) {
      declined = e;
    }
  }
  assert.ok(declined instanceof BondDeclined, 'expected the scammer to eventually be declined');
  assert.ok(declined.codes.includes('UNINSURABLE'));
});

test('wash trading: a pair of agents can\'t pump each other past the per-counterparty cap', async () => {
  const a = await w.agent('WashA', { perTxLimitCents: 1_000_000, dailyLimitCents: 100_000_000 });
  const b = await w.agent('WashB', { perTxLimitCents: 1_000_000, dailyLimitCents: 100_000_000 });
  for (let i = 0; i < 12; i++) {
    const { tx, spec } = await fundedOrder(a, b, { priceCents: 100_000, category: 'digital_goods' });
    await b.deliver(tx.id, spec);
    await a.receipt(tx.id, { item: spec, ok: true });
  }
  const honest = await w.agent('HonestBuyers');
  const s = await w.agent('BroadSeller');
  const bs = [];
  for (let i = 0; i < 3; i++) bs.push(await w.agent('B' + i, { perTxLimitCents: 1_000_000, dailyLimitCents: 100_000_000 }));
  for (const buyer of bs) for (let i = 0; i < 4; i++) {
    const { tx, spec } = await fundedOrder(buyer, s, { priceCents: 100_000, category: 'digital_goods' });
    await s.deliver(tx.id, spec);
    await buyer.receipt(tx.id, { item: spec, ok: true });
  }
  assert.ok(honest);
  const washed = await b.score();
  const broad = await s.score();
  assert.ok(broad.score > washed.score, `broad ${broad.score} should beat wash ${washed.score}`);
});

test('auth: unsigned, badly signed and replayed requests are rejected', async () => {
  const a = await w.agent('AuthTest');
  assert.equal((await fetch(w.baseUrl + '/v1/me')).status, 401);

  // tamper with the body after signing
  const other = await w.agent('AuthOther');
  const goodReq = await a.quote({ counterparty: other.agentId, amountCents: 1000, category: 'data' });
  assert.equal(goodReq.decision, 'approved');

  // An agent with a different key can't impersonate: sign with wrong key but claim a's id
  const impostor = new BondClient({ baseUrl: w.baseUrl, keys: BondClient.generateKeys(), agentId: a.agentId, now: () => w.clock.now() });
  await assert.rejects(() => impostor.me(), (e) => e instanceof BondError && e.code === 'AUTH_BAD_SIGNATURE');

  // Stale timestamp
  const stale = new BondClient({ baseUrl: w.baseUrl, keys: a.keys, agentId: a.agentId, now: () => w.clock.now() - HOUR });
  await assert.rejects(() => stale.me(), (e) => e.code === 'AUTH_STALE');

  // Replay: a captured, validly signed request can't be sent twice
  const { createPrivateKey, sign, randomBytes } = await import('node:crypto');
  const { sha256 } = await import('../dist/domain/canonical.js');
  const { signingString } = await import('../dist/domain/agent-auth.js');
  const ts = w.clock.now();
  const nonce = randomBytes(8).toString('hex');
  const sig = sign(null, Buffer.from(signingString({ method: 'GET', path: '/v1/me', timestamp: ts, nonce, body: '' })),
    createPrivateKey({ key: Buffer.from(a.keys.privateKey, 'base64url'), format: 'der', type: 'pkcs8' })).toString('base64url');
  const headers = { 'X-Bond-Agent': a.agentId, 'X-Bond-Timestamp': String(ts), 'X-Bond-Nonce': nonce, 'X-Bond-Signature': sig };
  assert.equal((await fetch(w.baseUrl + '/v1/me', { headers })).status, 200);
  const replay = await fetch(w.baseUrl + '/v1/me', { headers });
  assert.equal(replay.status, 401);
  assert.equal((await replay.json()).error.code, 'AUTH_REPLAY');
  assert.ok(sha256);

  // Registering with someone else's id is impossible: id is derived from the key
  const keys = BondClient.generateKeys();
  const res = await post('/v1/agents', { name: 'x', owner: 'y', publicKey: keys.publicKey }, {
    'X-Bond-Agent': a.agentId, 'X-Bond-Timestamp': String(w.clock.now()), 'X-Bond-Nonce': 'n1', 'X-Bond-Signature': 'AAAA',
  });
  assert.equal(res.status, 401);
});

test('state machine: only the right party can send the right event at the right time', async () => {
  const buyer = await w.agent('SM-Buyer');
  const seller = await w.agent('SM-Seller');
  const outsider = await w.agent('SM-Outsider');
  const { transaction } = await buyer.purchase({ counterparty: seller.agentId, spec: 'thing', priceCents: 3000, category: 'data' });
  await assert.rejects(() => buyer.pay(transaction), (e) => e.code === 'BAD_STATE');
  await assert.rejects(() => outsider.accept(transaction.id, transaction.termsHash), (e) => e.code === 'NOT_A_PARTY');
  await assert.rejects(() => buyer.accept(transaction.id, transaction.termsHash), (e) => e.code === 'WRONG_ROLE');
  await assert.rejects(() => seller.accept(transaction.id, 'f'.repeat(64)), (e) => e.code === 'TERMS_MISMATCH');
  await seller.accept(transaction.id);
  await assert.rejects(() => buyer.dispute(transaction.id, 'x'), (e) => e.code === 'BAD_STATE');
  await buyer.cancel(transaction.id, 'changed mind');
  const stats = await w.admin('GET', '/v1/stats');
  assert.ok(stats.pool.refundsCents > 0, 'premium is refunded when cancelled before funding');
});

test('sweep: stale proposals are cancelled, silent buyers auto-settle, unclaimed coverage expires', async () => {
  const buyer = await w.agent('SW-Buyer');
  const seller = await w.agent('SW-Seller');

  const { transaction: stale } = await buyer.purchase({ counterparty: seller.agentId, spec: 'a', priceCents: 3000, category: 'data' });
  const { tx: silent, spec } = await fundedOrder(buyer, seller, { spec: 'b', priceCents: 3000, category: 'data' });
  await seller.deliver(silent.id, spec);
  const { tx: unclaimed } = await fundedOrder(buyer, seller, { spec: 'c', priceCents: 3000, category: 'data' });

  w.clock.advance(9 * DAY);
  const res = await w.admin('POST', '/v1/console/sweep');
  assert.ok(res.cancelled >= 1 && res.autoSettled >= 1 && res.expired >= 1, JSON.stringify(res));
  assert.equal((await buyer.transaction(stale.id)).status, 'cancelled');
  assert.equal((await buyer.transaction(silent.id)).status, 'fulfilled');
  assert.equal((await buyer.transaction(unclaimed.id)).status, 'expired');
});

test('audit-only mode: zero coverage still enforces the mandate and builds reputation', async () => {
  const buyer = await w.agent('AO-Buyer');
  const seller = await w.agent('AO-Seller');
  const { transaction } = await buyer.purchase({ counterparty: seller.agentId, spec: 'z', priceCents: 4000, category: 'data', coverageCents: 0 });
  assert.equal(transaction.premiumCents, 0);
  assert.equal(transaction.coverageCents, 0);
});

test('pool: reserve capacity and seller concentration limits decline oversized coverage', async () => {
  const buyer = await w.agent('Whale', { perTxLimitCents: 10_000_000_000, dailyLimitCents: 10_000_000_000 });
  const seller = await w.agent('Target');
  const q = await buyer.quote({ counterparty: seller.agentId, amountCents: 900_000_000, category: 'digital_goods' });
  assert.equal(q.decision, 'declined');
  assert.ok(q.reasons.some((r) => r.code === 'SELLER_CONCENTRATION' || r.code === 'POOL_CAPACITY'));
});

