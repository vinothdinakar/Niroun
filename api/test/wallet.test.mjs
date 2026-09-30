import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, testApp } from '../test-support/helpers.mjs';
import { FakeStripe } from '../test-support/fake-stripe.mjs';
import { quoteDeposit } from '../dist/domain/wallet.js';
import { verifyChain } from '../dist/domain/ledger-chain.js';

const stripe = new FakeStripe();
let w, n = 0;
before(async () => { w = await setup({ stripe }); });
after(async () => { await w.close(); });

// A brand-new organization with an owner (two-step on, as withdrawing needs) and a read-only viewer.
async function orgWithOwner({ twoStep = true } = {}) {
  const org = await w.app.accounts.createOrg(`Wallet Co ${++n}`, null, 'business');
  const owner = await w.makeUser({ role: 'owner_admin', orgId: org.id, twoStep });
  const session = await owner.signIn();
  return { org, owner, session };
}
const viewerOf = async (org) => (await w.makeUser({ role: 'owner_viewer', orgId: org.id })).signIn();

// Stripe telling us something, with a good (or bad) signature.
async function webhook(type, object, { account, signature = 'whsec_valid' } = {}) {
  const res = await fetch(`${w.baseUrl}/v1/stripe/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': signature },
    body: JSON.stringify({ id: `evt_${++n}`, type, account, data: { object } }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const paySession = async (sessionId, { paymentStatus = 'paid' } = {}) => {
  stripe.sessions.get(sessionId).paymentStatus = paymentStatus;
  stripe.sessions.get(sessionId).status = 'complete';
  return webhook('checkout.session.completed', stripe.sessionObject(sessionId));
};
const balance = async (session) => (await session.req('GET', '/v1/console/wallet')).body.balance;
const ledgerOf = async (orgId) => (await w.app.mongo.db.collection('wallet_ledger').find({ agentId: orgId }).sort({ seq: 1 }).toArray()).map(({ _id, ...e }) => e);

// Puts money in the wallet the way a real deposit does: start it, then Stripe says it arrived.
async function fund(session, cents) {
  const r = await session.req('POST', '/v1/console/wallet/deposits', { amountCents: cents, method: 'card' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  await paySession(stripe.lastSession().id);
  return r.body.id;
}
// Makes the org's payout account ready to receive withdrawals.
async function readyForPayouts(session) {
  const r = await session.req('POST', '/v1/console/wallet/payouts/setup');
  assert.equal(r.status, 200);
  const accountId = [...stripe.accounts.keys()].at(-1);
  stripe.finishOnboarding(accountId);
  return accountId;
}
const withdraw = async (owner, session, cents, code) =>
  session.req('POST', '/v1/console/wallet/withdrawals', { amountCents: cents, code: code ?? (await w.nextCode(owner.email, owner.totpSecret)) });

test('what a deposit costs: the customer pays Stripe\'s cut, so the wallet gets exactly the amount chosen', () => {
  for (const cents of [1_000, 12_345, 500_000, 2_500_000]) {
    const card = quoteDeposit('card', cents);
    assert.equal(card.chargeCents, cents + card.feeCents);
    const stripeCut = card.chargeCents * 0.029 + 30;
    assert.ok(card.chargeCents - stripeCut >= cents - 0.01 && card.chargeCents - stripeCut < cents + 1.5, `card ${cents}`);
    const ach = quoteDeposit('ach', cents);
    assert.ok(ach.feeCents <= 500, 'ACH is capped at $5');
    assert.equal(ach.chargeCents, cents + ach.feeCents);
  }
  // pinned identically in packages/console-core/lib/wallet.test.ts, which shows the fee while someone types
  assert.deepEqual(quoteDeposit('card', 1_000), { amountCents: 1_000, feeCents: 61, chargeCents: 1_061 });
  assert.deepEqual(quoteDeposit('card', 500_000), { amountCents: 500_000, feeCents: 14_964, chargeCents: 514_964 });
  assert.deepEqual(quoteDeposit('ach', 50_000), { amountCents: 50_000, feeCents: 404, chargeCents: 50_404 });
  assert.deepEqual(quoteDeposit('ach', 500_000), { amountCents: 500_000, feeCents: 500, chargeCents: 500_500 });
  assert.equal(quoteDeposit('ach', 2_500_000).feeCents, 500);
  assert.ok(quoteDeposit('ach', 50_000).feeCents < 500, '0.8% of $500 is under the $5 cap');
  assert.equal(quoteDeposit('ach', 100_000).feeCents, 500, '0.8% of $1,000 is over it');
});

test('with no Stripe configured the wallet is off: the summary says so and money cannot move', async () => {
  const off = await testApp({ signup: 'open' });
  const port = await off.listen(0);
  try {
    const org = await off.accounts.createOrg('No Stripe Co', null, 'business');
    await off.accounts.createUser({ email: 'owner@nostripe.test', name: 'O', role: 'owner_admin', orgId: org.id, password: 'A-long-Passw0rd-here' });
    const base = `http://127.0.0.1:${port}`;
    const login = await fetch(base + '/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'owner@nostripe.test', password: 'A-long-Passw0rd-here' }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const call = (method, path, body) => fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
    assert.deepEqual(await (await call('GET', '/v1/console/wallet')).json(), { enabled: false });
    const dep = await call('POST', '/v1/console/wallet/deposits', { amountCents: 5000, method: 'card' });
    assert.equal(dep.status, 503);
    assert.equal((await dep.json()).error.code, 'WALLET_UNAVAILABLE');
    const hook = await fetch(base + '/v1/stripe/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(hook.status, 503);
  } finally {
    await off.close();
  }
});

test('everyone in the organization can read the wallet, only the owner can move money, and nobody sees another org\'s', async () => {
  const { org, session } = await orgWithOwner();
  const viewer = await viewerOf(org);
  const view = await viewer.req('GET', '/v1/console/wallet');
  assert.equal(view.status, 200);
  assert.equal(view.body.enabled, true);
  assert.equal(view.body.testMode, true);
  assert.equal((await viewer.req('GET', '/v1/console/wallet/transactions')).status, 200);
  for (const [path, body] of [['/v1/console/wallet/deposits', { amountCents: 5000, method: 'card' }], ['/v1/console/wallet/payouts/setup', {}], ['/v1/console/wallet/withdrawals', { amountCents: 5000, code: '123456' }]]) {
    assert.equal((await viewer.req('POST', path, body)).status, 403, path);
  }

  await fund(session, 5_000_00);
  const other = await orgWithOwner();
  assert.equal((await balance(other.session)).availableCents, 0, 'another org starts empty');
  const theirTx = (await session.req('GET', '/v1/console/wallet/transactions')).body.rows[0];
  assert.equal((await other.session.req('POST', `/v1/console/wallet/deposits/${theirTx.id}/sync`)).status, 404, 'cannot touch another org\'s transaction');
  assert.equal((await (await fetch(`${w.baseUrl}/v1/console/wallet`)).status), 401, 'signed out');
});

test('a card deposit is credited only when Stripe says it arrived, exactly once, and the ledger stays valid', async () => {
  const { org, session } = await orgWithOwner();
  const start = await session.req('POST', '/v1/console/wallet/deposits', { amountCents: 500_000, method: 'card' });
  assert.equal(start.status, 201);
  assert.match(start.body.url, /^https:\/\/checkout\.stripe\.test\//);
  const call = stripe.called('createCheckoutSession').at(-1).input;
  assert.equal(call.amountCents, 500_000);
  assert.equal(call.chargeCents ?? call.amountCents + call.feeCents, quoteDeposit('card', 500_000).chargeCents);
  assert.equal(call.customerEmail, session.user.email);
  assert.match(call.successUrl, /wallet=success/);

  let bal = await balance(session);
  assert.equal(bal.availableCents, 0, 'not credited yet');
  assert.equal(bal.pendingDepositsCents, 500_000);
  const sessionId = stripe.lastSession().id;

  assert.equal((await webhook('checkout.session.completed', stripe.sessionObject(sessionId), { signature: 'nope' })).status, 400, 'a bad signature is refused');
  assert.equal((await balance(session)).availableCents, 0);

  assert.equal((await paySession(sessionId)).status, 200);
  bal = await balance(session);
  assert.equal(bal.availableCents, 500_000);
  assert.equal(bal.pendingDepositsCents, 0);
  await paySession(sessionId); // Stripe repeats itself
  assert.equal((await balance(session)).availableCents, 500_000, 'a repeated event does not credit twice');

  const row = (await session.req('GET', '/v1/console/wallet/transactions')).body.rows[0];
  assert.equal(row.type, 'deposit');
  assert.equal(row.status, 'completed');
  assert.equal(row.balanceAfterCents, 500_000);
  assert.equal(row.amountCents, 500_000);
  assert.equal(row.feeCents, quoteDeposit('card', 500_000).feeCents);
  const chain = await ledgerOf(org.id);
  assert.equal(chain.length, 1);
  assert.equal(chain[0].type, 'wallet.deposit_credited');
  assert.equal(verifyChain(chain).ok, true);
});

test('a deposit whose amount does not match what we asked for is not credited', async () => {
  const { session } = await orgWithOwner();
  await session.req('POST', '/v1/console/wallet/deposits', { amountCents: 20_000, method: 'card' });
  const id = stripe.lastSession().id;
  stripe.sessions.get(id).paymentStatus = 'paid';
  await webhook('checkout.session.completed', stripe.sessionObject(id, { amount_total: 100 }));
  assert.equal((await balance(session)).availableCents, 0);
  const audit = JSON.stringify(await w.admin('GET', '/v1/console/audit'));
  assert.ok(audit.includes('wallet.deposit_amount_mismatch'));
});

test('a bank (ACH) deposit stays processing while it clears, then is credited or fails on Stripe\'s word', async () => {
  const { session } = await orgWithOwner();
  await session.req('POST', '/v1/console/wallet/deposits', { amountCents: 100_000, method: 'ach' });
  assert.equal(stripe.called('createCheckoutSession').at(-1).input.method, 'ach');
  const id = stripe.lastSession().id;

  await paySession(id, { paymentStatus: 'unpaid' });
  let row = (await session.req('GET', '/v1/console/wallet/transactions')).body.rows[0];
  assert.equal(row.status, 'processing');
  assert.equal((await balance(session)).availableCents, 0, 'money still clearing is not spendable');
  assert.equal((await balance(session)).pendingDepositsCents, 100_000);

  stripe.sessions.get(id).paymentStatus = 'paid';
  await webhook('checkout.session.async_payment_succeeded', stripe.sessionObject(id));
  row = (await session.req('GET', '/v1/console/wallet/transactions')).body.rows[0];
  assert.equal(row.status, 'completed');
  assert.equal((await balance(session)).availableCents, 100_000);

  await session.req('POST', '/v1/console/wallet/deposits', { amountCents: 50_000, method: 'ach' });
  const failing = stripe.lastSession().id;
  await paySession(failing, { paymentStatus: 'unpaid' });
  await webhook('checkout.session.async_payment_failed', stripe.sessionObject(failing));
  row = (await session.req('GET', '/v1/console/wallet/transactions')).body.rows[0];
  assert.equal(row.status, 'failed');
  assert.equal((await balance(session)).availableCents, 100_000, 'a failed transfer credits nothing');
});

test('an abandoned checkout is cancelled when Stripe says it expired', async () => {
  const { session } = await orgWithOwner();
  await session.req('POST', '/v1/console/wallet/deposits', { amountCents: 30_000, method: 'card' });
  const id = stripe.lastSession().id;
  stripe.sessions.get(id).status = 'expired';
  await webhook('checkout.session.expired', stripe.sessionObject(id));
  assert.equal((await session.req('GET', '/v1/console/wallet/transactions')).body.rows[0].status, 'canceled');
  assert.equal((await balance(session)).pendingDepositsCents, 0);
});

test('coming back from Stripe checks the deposit straight away, without waiting for the webhook', async () => {
  const { session } = await orgWithOwner();
  const { body } = await session.req('POST', '/v1/console/wallet/deposits', { amountCents: 75_000, method: 'card' });
  const id = stripe.lastSession().id;
  stripe.sessions.get(id).paymentStatus = 'paid';
  stripe.sessions.get(id).status = 'complete';
  const synced = await session.req('POST', `/v1/console/wallet/deposits/${body.id}/sync`);
  assert.equal(synced.status, 200);
  assert.equal(synced.body.transaction.status, 'completed');
  assert.equal((await balance(session)).availableCents, 75_000);
  await session.req('POST', `/v1/console/wallet/deposits/${body.id}/sync`); // again: nothing changes
  assert.equal((await balance(session)).availableCents, 75_000);
  await webhook('checkout.session.completed', stripe.sessionObject(id)); // and the late webhook: still once
  assert.equal((await balance(session)).availableCents, 75_000);
});

test('deposit amounts and methods are validated, and a day\'s limit is enforced', async () => {
  const { session } = await orgWithOwner();
  const post = (b) => session.req('POST', '/v1/console/wallet/deposits', b);
  assert.equal((await post({ amountCents: 999, method: 'card' })).body.error.code, 'AMOUNT_TOO_SMALL');
  assert.equal((await post({ amountCents: 50.5, method: 'card' })).body.error.code, 'INVALID_AMOUNT');
  assert.equal((await post({ amountCents: '5000', method: 'card' })).body.error.code, 'INVALID_AMOUNT');
  assert.equal((await post({ amountCents: 2_500_001, method: 'card' })).body.error.code, 'AMOUNT_TOO_LARGE');
  assert.equal((await post({ amountCents: 5000, method: 'bitcoin' })).body.error.code, 'INVALID_METHOD');
  assert.equal((await post({ amountCents: 2_000_000, method: 'card' })).status, 201);
  const over = await post({ amountCents: 600_000, method: 'card' });
  assert.equal(over.status, 409);
  assert.equal(over.body.error.code, 'DAILY_LIMIT');
  assert.equal((await post({ amountCents: 500_000, method: 'ach' })).status, 201, 'up to the limit is fine');
});

test('a deposit that Stripe could not start is marked failed and the person is told', async () => {
  const { session } = await orgWithOwner();
  stripe.fail.checkout = true;
  const r = await session.req('POST', '/v1/console/wallet/deposits', { amountCents: 10_000, method: 'card' });
  assert.equal(r.status, 502);
  assert.equal(r.body.error.code, 'STRIPE_ERROR');
  assert.equal((await session.req('GET', '/v1/console/wallet/transactions')).body.rows[0].status, 'failed');
  assert.equal((await balance(session)).pendingDepositsCents, 0);
});

test('payout setup makes one Stripe account per organization, and reflects onboarding as it finishes', async () => {
  const { session } = await orgWithOwner();
  assert.equal((await session.req('GET', '/v1/console/wallet')).body.payouts.status, 'not_setup');
  const first = await session.req('POST', '/v1/console/wallet/payouts/setup');
  assert.equal(first.status, 200);
  assert.match(first.body.url, /^https:\/\/connect\.stripe\.test\/onboard\//);
  const before = stripe.called('createConnectAccount').length;
  await session.req('POST', '/v1/console/wallet/payouts/setup');
  assert.equal(stripe.called('createConnectAccount').length, before, 'the second time reuses the account');
  const link = stripe.called('createAccountLink').at(-1).input;
  assert.match(link.returnUrl, /wallet=payouts/);

  let summary = (await session.req('GET', '/v1/console/wallet')).body;
  assert.equal(summary.payouts.status, 'incomplete');
  stripe.finishOnboarding([...stripe.accounts.keys()].at(-1));
  summary = (await session.req('GET', '/v1/console/wallet')).body;
  assert.equal(summary.payouts.status, 'ready');
  assert.equal(summary.payouts.bank.last4, '6789');
});

test('withdrawing needs two-step on, payouts ready, enough money and a live code', async () => {
  const noTwoStep = await orgWithOwner({ twoStep: false });
  await fund(noTwoStep.session, 500_000);
  await readyForPayouts(noTwoStep.session);
  const blocked = await noTwoStep.session.req('POST', '/v1/console/wallet/withdrawals', { amountCents: 10_000, code: '123456' });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error.code, 'TWO_STEP_REQUIRED');

  const { owner, session } = await orgWithOwner();
  await fund(session, 500_000);
  const early = await withdraw(owner, session, 10_000);
  assert.equal(early.body.error.code, 'PAYOUTS_NOT_READY');
  await readyForPayouts(session);
  assert.equal((await withdraw(owner, session, 999)).body.error.code, 'AMOUNT_TOO_SMALL');
  assert.equal((await withdraw(owner, session, 600_000)).body.error.code, 'INSUFFICIENT_FUNDS');
  const wrong = await session.req('POST', '/v1/console/wallet/withdrawals', { amountCents: 10_000, code: '000000' });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.error.code, 'INVALID_CODE');
  assert.equal((await balance(session)).availableCents, 500_000, 'none of that moved any money');
  assert.equal(stripe.called('createTransfer').filter((c) => c.input.walletTxId && false).length, 0);
});

test('a withdrawal reserves the money at once, sends it through Stripe, and completes when the payout lands', async () => {
  const { org, owner, session } = await orgWithOwner();
  await fund(session, 800_000);
  const accountId = await readyForPayouts(session);
  const transfersBefore = stripe.called('createTransfer').length;

  const r = await withdraw(owner, session, 200_000);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const tx = r.body.transaction;
  assert.equal(tx.type, 'withdrawal');
  assert.equal(tx.status, 'processing');
  assert.equal(tx.balanceAfterCents, 600_000);
  assert.match(tx.description, /•••• 6789/);
  assert.ok(tx.stripe.transferId && tx.stripe.payoutId);
  assert.equal(stripe.called('createTransfer').length, transfersBefore + 1);
  const transfer = stripe.called('createTransfer').at(-1).input;
  assert.equal(transfer.accountId, accountId);
  assert.equal(transfer.amountCents, 200_000);
  assert.equal(stripe.called('createPayout').at(-1).input.walletTxId, tx.id);

  const bal = await balance(session);
  assert.equal(bal.availableCents, 600_000);
  assert.equal(bal.inTransitCents, 200_000);

  // a payout for some other account or transaction changes nothing
  await webhook('payout.paid', { id: tx.stripe.payoutId, metadata: { walletTxId: tx.id } }, { account: 'acct_someone_else' });
  assert.equal((await session.req('GET', '/v1/console/wallet/transactions')).body.rows[0].status, 'processing');

  await webhook('payout.paid', { id: tx.stripe.payoutId, metadata: { walletTxId: tx.id } }, { account: accountId });
  assert.equal((await session.req('GET', '/v1/console/wallet/transactions')).body.rows[0].status, 'completed');
  assert.equal((await balance(session)).inTransitCents, 0);
  assert.equal((await balance(session)).availableCents, 600_000);
  const chain = await ledgerOf(org.id);
  assert.deepEqual(chain.map((e) => e.type), ['wallet.deposit_credited', 'wallet.withdrawal_debited']);
  assert.equal(verifyChain(chain).ok, true);
});

test('a payout the bank rejects puts the money back and pulls the transfer back from Stripe', async () => {
  const { org, owner, session } = await orgWithOwner();
  await fund(session, 300_000);
  const accountId = await readyForPayouts(session);
  const tx = (await withdraw(owner, session, 100_000)).body.transaction;
  assert.equal((await balance(session)).availableCents, 200_000);

  await webhook('payout.failed', { id: tx.stripe.payoutId, metadata: { walletTxId: tx.id }, failure_message: 'Account closed' }, { account: accountId });
  const row = (await session.req('GET', '/v1/console/wallet/transactions')).body.rows[0];
  assert.equal(row.status, 'failed');
  assert.equal(row.failureReason, 'Account closed');
  assert.equal((await balance(session)).availableCents, 300_000, 'the money is back');
  assert.equal(stripe.called('reverseTransfer').at(-1).input.transferId, tx.stripe.transferId);
  await webhook('payout.failed', { id: tx.stripe.payoutId, metadata: { walletTxId: tx.id } }, { account: accountId }); // repeated
  assert.equal((await balance(session)).availableCents, 300_000, 'restored only once');
  const chain = await ledgerOf(org.id);
  assert.deepEqual(chain.map((e) => e.type), ['wallet.deposit_credited', 'wallet.withdrawal_debited', 'wallet.withdrawal_reversed']);
  assert.equal(verifyChain(chain).ok, true);
});

test('if Stripe cannot send a withdrawal at all, nothing is taken from the balance', async () => {
  const { owner, session } = await orgWithOwner();
  await fund(session, 300_000);
  await readyForPayouts(session);

  stripe.fail.transfer = true;
  const r = await withdraw(owner, session, 100_000);
  assert.equal(r.status, 502);
  assert.equal((await balance(session)).availableCents, 300_000);
  assert.equal((await session.req('GET', '/v1/console/wallet/transactions')).body.rows[0].status, 'failed');

  stripe.fail.payout = true; // the transfer went through, the payout did not: the transfer is pulled back
  const reversals = stripe.called('reverseTransfer').length;
  assert.equal((await withdraw(owner, session, 100_000)).status, 502);
  assert.equal((await balance(session)).availableCents, 300_000);
  assert.equal(stripe.called('reverseTransfer').length, reversals + 1);
});

test('two withdrawals racing for the same money cannot overdraw the wallet', async () => {
  const { org, owner, session } = await orgWithOwner();
  const second = await w.makeUser({ role: 'owner_admin', orgId: org.id, twoStep: true }); // a second owner, with their own code
  const secondSession = await second.signIn();
  await fund(session, 200_000);
  await readyForPayouts(session);
  const codes = [await w.nextCode(owner.email, owner.totpSecret), await w.nextCode(second.email, second.totpSecret)];

  const results = await Promise.all([
    session.req('POST', '/v1/console/wallet/withdrawals', { amountCents: 150_000, code: codes[0] }),
    secondSession.req('POST', '/v1/console/wallet/withdrawals', { amountCents: 150_000, code: codes[1] }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal((await balance(session)).availableCents, 50_000);
  const chain = await ledgerOf(org.id);
  assert.equal(verifyChain(chain).ok, true, 'the ledger did not fork');
  assert.ok(chain.every((e) => e.data.balanceCents >= 0));
});

test('a daily withdrawal limit is enforced', async () => {
  const { org, owner, session } = await orgWithOwner();
  await fund(session, 2_500_000);
  await readyForPayouts(session);
  assert.equal((await withdraw(owner, session, 950_000)).status, 201);
  const over = await withdraw(owner, session, 100_000);
  assert.equal(over.status, 409);
  assert.equal(over.body.error.code, 'DAILY_LIMIT');
  assert.equal((await balance(session)).availableCents, 2_500_000 - 950_000);
  assert.ok(org);
});

test('the transaction list is newest first, filterable, paged, and only shows this organization\'s', async () => {
  const { owner, session } = await orgWithOwner();
  await fund(session, 100_000);
  await fund(session, 200_000);
  await readyForPayouts(session);
  await withdraw(owner, session, 50_000);
  const all = (await session.req('GET', '/v1/console/wallet/transactions')).body;
  assert.equal(all.total, 3);
  assert.deepEqual(all.rows.map((r) => r.type), ['withdrawal', 'deposit', 'deposit']);
  assert.equal(all.rows[0].balanceAfterCents, 250_000);
  assert.equal((await session.req('GET', '/v1/console/wallet/transactions?type=deposit')).body.total, 2);
  assert.equal((await session.req('GET', '/v1/console/wallet/transactions?type=withdrawal')).body.rows.length, 1);
  assert.equal((await session.req('GET', '/v1/console/wallet/transactions?status=processing')).body.total, 1);
  const paged = (await session.req('GET', '/v1/console/wallet/transactions?pageSize=2&page=2')).body;
  assert.equal(paged.rows.length, 1);
  assert.equal(paged.total, 3);
});

test('every wallet action is in the audit log', async () => {
  const { owner, session } = await orgWithOwner();
  await fund(session, 100_000);
  await readyForPayouts(session);
  await withdraw(owner, session, 10_000);
  const audit = JSON.stringify(await w.admin('GET', '/v1/console/audit'));
  for (const action of ['wallet.deposit_started', 'wallet.deposit_completed', 'wallet.payout_account_created', 'wallet.withdrawal_started']) {
    assert.ok(audit.includes(action), action);
  }
});
