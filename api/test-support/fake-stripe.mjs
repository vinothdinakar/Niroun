// A stand-in for Stripe in tests: the same interface as LiveStripeGateway, recording what it was asked and letting a
// test decide what "Stripe" says back. Webhooks are signed with the literal signature 'whsec_valid'.
export class FakeStripe {
  testMode = true;
  calls = [];
  sessions = new Map(); // id -> { id, walletTxId, amountTotal, status, paymentStatus }
  accounts = new Map(); // id -> { id, payoutsEnabled, detailsSubmitted, bank }
  fail = {}; // e.g. { transfer: true } makes that call throw once
  #n = 0;

  #maybeFail(what) {
    if (this.fail[what]) { delete this.fail[what]; throw new Error(`fake Stripe: ${what} failed`); }
  }
  #record(name, input) { this.calls.push({ name, input }); }
  called(name) { return this.calls.filter((c) => c.name === name); }

  async createCheckoutSession(input, idempotencyKey) {
    this.#record('createCheckoutSession', { ...input, idempotencyKey });
    this.#maybeFail('checkout');
    const id = `cs_test_${++this.#n}`;
    this.sessions.set(id, { id, walletTxId: input.walletTxId, amountTotal: input.amountCents + input.feeCents, status: 'open', paymentStatus: 'unpaid', paymentIntentId: `pi_${this.#n}` });
    return this.#session(id, `https://checkout.stripe.test/${id}`);
  }
  #session(id, url = null) {
    const s = this.sessions.get(id);
    return { id, url, paymentStatus: s.paymentStatus, status: s.status, amountTotalCents: s.amountTotal, paymentIntentId: s.paymentIntentId, walletTxId: s.walletTxId };
  }
  async retrieveCheckoutSession(id) { this.#record('retrieveCheckoutSession', { id }); return this.#session(id); }
  lastSession() { return [...this.sessions.values()].at(-1); }
  /** What the Stripe webhook object for a session looks like. */
  sessionObject(id, over = {}) {
    const s = this.sessions.get(id);
    return { id, object: 'checkout.session', payment_status: s.paymentStatus, status: s.status, amount_total: s.amountTotal, payment_intent: s.paymentIntentId, metadata: { walletTxId: s.walletTxId }, ...over };
  }

  async createConnectAccount(input, idempotencyKey) {
    this.#record('createConnectAccount', { ...input, idempotencyKey });
    this.#maybeFail('account');
    const id = `acct_test_${++this.#n}`;
    this.accounts.set(id, { id, payoutsEnabled: false, detailsSubmitted: false, bank: null });
    return { id };
  }
  async createAccountLink(accountId, returnUrl, refreshUrl) {
    this.#record('createAccountLink', { accountId, returnUrl, refreshUrl });
    return { url: `https://connect.stripe.test/onboard/${accountId}` };
  }
  async getConnectAccount(accountId) { this.#record('getConnectAccount', { accountId }); return { ...this.accounts.get(accountId) }; }
  finishOnboarding(accountId, bank = { last4: '6789', name: 'Test Bank' }) {
    Object.assign(this.accounts.get(accountId), { payoutsEnabled: true, detailsSubmitted: true, bank });
  }

  async createTransfer(input, idempotencyKey) {
    this.#record('createTransfer', { ...input, idempotencyKey });
    this.#maybeFail('transfer');
    return { id: `tr_test_${++this.#n}` };
  }
  async createPayout(input, idempotencyKey) {
    this.#record('createPayout', { ...input, idempotencyKey });
    this.#maybeFail('payout');
    return { id: `po_test_${++this.#n}` };
  }
  async reverseTransfer(transferId, idempotencyKey) { this.#record('reverseTransfer', { transferId, idempotencyKey }); this.#maybeFail('reverse'); }

  constructEvent(rawBody, signature) {
    if (signature !== 'whsec_valid') throw new Error('bad signature');
    const e = JSON.parse(rawBody);
    return { id: e.id, type: e.type, account: e.account ?? null, object: e.data.object };
  }
}
