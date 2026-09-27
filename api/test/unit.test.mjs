import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeScore, outcomeWeight, PAIR_CAP } from '../dist/domain/scoring.js';
import { priceQuote, MAX_PD } from '../dist/domain/pricing.js';
import { checkPolicy, validatePolicy, DEFAULT_POLICY } from '../dist/domain/policy.js';
import * as ledger from '../dist/domain/ledger-chain.js';
import { arbitrate } from '../dist/domain/arbiter.js';
import { sha256 } from '../dist/domain/canonical.js';

const T0 = 1_700_000_000_000;
const outs = (kind, n, w = 1) => Array.from({ length: n }, (_, i) => ({ ts: T0 + i, kind, weight: w, amountCents: 5000 }));

test('score: new agents start mid-pack and are tiered NR', () => {
  const s = computeScore({ verification: 0 }, [], T0);
  assert.equal(s.tier, 'NR');
  assert.ok(s.score > 600 && s.score < 800, `got ${s.score}`);
});

test('score: fulfilments raise it, faults lower it, verification adds a bonus', () => {
  const base = computeScore({ verification: 0 }, [], T0).score;
  const good = computeScore({ verification: 0 }, outs('fulfilled', 30), T0 + 100).score;
  const bad = computeScore({ verification: 0 }, [...outs('fulfilled', 10), ...outs('fault', 10)], T0 + 100).score;
  const verified = computeScore({ verification: 2 }, [], T0).score;
  assert.ok(good > base, 'good history beats no history');
  assert.ok(bad < base, 'bad history is worse than no history');
  assert.equal(verified - base, 50);
});

test('score: old outcomes decay toward the prior', () => {
  const fresh = computeScore({}, outs('fault', 10), T0 + 1000).score;
  const stale = computeScore({}, outs('fault', 10), T0 + 720 * 86_400_000).score;
  assert.ok(stale > fresh);
});

test('score: outcome weight scales with value; micro trades barely count', () => {
  assert.ok(outcomeWeight(100) < 0.2);
  assert.ok(outcomeWeight(1_000_000) > 3);
});

test('pricing: worse counterparties cost more; hopeless ones are declined', () => {
  const price = (a, b, verification = 0, category = 'digital_goods') => {
    const score = computeScore({ verification }, [...outs('fulfilled', a), ...outs('fault', b)], T0 + 100);
    return priceQuote({ seller: { verification }, score, amountCents: 10_000, coverageCents: 10_000, category });
  };
  const great = price(40, 0);
  const meh = price(10, 3);
  assert.ok(great.premiumCents < meh.premiumCents);
  assert.ok(price(40, 0, 2).premiumCents < great.premiumCents, 'verification discounts the premium');
  assert.equal(price(2, 12).declined, true);
  assert.ok(price(2, 12).pd > MAX_PD);
  assert.ok(price(40, 3, 0, 'legal').premiumCents > price(40, 3, 0, 'digital_goods').premiumCents);
});

test('policy: every limit is enforced and reported with a code', () => {
  const p = { ...DEFAULT_POLICY, perTxLimitCents: 1000, dailyLimitCents: 1500, allowedCategories: ['data'], minCounterpartyScore: 700 };
  const codes = checkPolicy(p, { amountCents: 2000, category: 'legal', counterpartyScore: 500, spentTodayCents: 0 }).map((v) => v.code);
  assert.deepEqual(codes.sort(), ['POLICY_CATEGORY', 'POLICY_COUNTERPARTY_SCORE', 'POLICY_DAILY_LIMIT', 'POLICY_PER_TX_LIMIT']);
  assert.equal(checkPolicy(p, { amountCents: 500, category: 'data', counterpartyScore: 800, spentTodayCents: 0 }).length, 0);
  assert.ok(validatePolicy({ ...DEFAULT_POLICY, perTxLimitCents: -5 }).errors.length > 0);
});

const chainOf = (n) => {
  const chain = [];
  for (let i = 0; i < n; i++) chain.push(ledger.nextEntry(chain, { agentId: 'a', type: 'x', data: { i }, ts: T0 + i }));
  return chain;
};

test('ledger: tampering with any entry breaks the chain', () => {
  const chain = chainOf(5);
  assert.equal(ledger.verifyChain(chain).ok, true);
  chain[2].data.i = 999;
  const v = ledger.verifyChain(chain);
  assert.equal(v.ok, false);
  assert.equal(v.brokenAt, 2);

  const chain2 = chainOf(5);
  chain2.splice(1, 1); // deleting an entry is also detected
  assert.equal(ledger.verifyChain(chain2).ok, false);
});

test('arbiter: verdicts follow the evidence', () => {
  const spec = 'Widget x10';
  const tx = { terms: { spec, deliverBy: T0 + 1000 } };
  const e = (type, data = {}, ts = T0) => ({ type, data, ts });
  const ok = { buyer: true, seller: true };
  const base = [e('accept'), e('payment')];

  assert.equal(arbitrate({ tx, entries: base, integrity: ok, now: T0 + 5000 }).verdict, 'seller_fault');
  assert.equal(arbitrate({ tx, entries: base, integrity: ok, now: T0 + 500 }).verdict, 'not_covered');
  assert.equal(arbitrate({ tx, entries: [...base, e('deliver', { specHash: sha256('junk') })], integrity: ok, now: T0 + 5000 }).rule, 'NON_CONFORMING');
  const good = [...base, e('deliver', { specHash: sha256(spec) }, T0 + 100)];
  assert.equal(arbitrate({ tx, entries: [...good, e('receipt', { ok: false, specHash: sha256(spec) })], integrity: ok, now: T0 + 5000 }).verdict, 'buyer_fault');
  assert.equal(arbitrate({ tx, entries: [...good, e('receipt', { ok: false, specHash: sha256('other') })], integrity: ok, now: T0 + 5000 }).verdict, 'needs_review');
  assert.equal(arbitrate({ tx, entries: good, integrity: ok, now: T0 + 5000 }).verdict, 'needs_review');
  assert.equal(arbitrate({ tx, entries: good, integrity: { buyer: true, seller: false }, now: T0 + 5000 }).rule, 'LEDGER_TAMPERED');
  assert.ok(PAIR_CAP > 0);
});
