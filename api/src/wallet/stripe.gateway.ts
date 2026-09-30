import Stripe from 'stripe';

// The only file that talks to Stripe. The wallet service depends on this interface, so tests use a fake one and the
// rest of the code never sees Stripe's SDK. Everything here is in cents and US dollars.

export interface CheckoutSessionInput {
  walletTxId: string;
  orgId: string;
  method: 'card' | 'ach';
  amountCents: number;
  feeCents: number;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
}
export interface CheckoutSessionInfo {
  id: string;
  url: string | null;
  /** 'paid' once the money has arrived; 'unpaid' while a bank debit is still clearing. */
  paymentStatus: 'paid' | 'unpaid' | 'no_payment_required';
  /** 'expired' when the customer never finished. */
  status: 'open' | 'complete' | 'expired';
  amountTotalCents: number | null;
  paymentIntentId: string | null;
  walletTxId: string | null;
}
export interface ConnectAccountInfo {
  id: string;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  bank: { last4: string | null; name: string | null } | null;
}
/** The part of a Stripe webhook event the wallet cares about. `account` is set for events from a connected account. */
export interface StripeEventInfo {
  id: string;
  type: string;
  account: string | null;
  object: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export interface StripeGateway {
  /** true while Stripe is in test mode (a test secret key). */
  readonly testMode: boolean;
  createCheckoutSession(input: CheckoutSessionInput, idempotencyKey: string): Promise<CheckoutSessionInfo>;
  retrieveCheckoutSession(id: string): Promise<CheckoutSessionInfo>;
  createConnectAccount(input: { orgId: string; email: string; businessType: 'individual' | 'company' }, idempotencyKey: string): Promise<{ id: string }>;
  createAccountLink(accountId: string, returnUrl: string, refreshUrl: string): Promise<{ url: string }>;
  getConnectAccount(accountId: string): Promise<ConnectAccountInfo>;
  /** Moves money from Bond's Stripe balance to the organization's connected account. */
  createTransfer(input: { accountId: string; amountCents: number; walletTxId: string }, idempotencyKey: string): Promise<{ id: string }>;
  /** Pays the connected account's balance out to its bank. One payout per withdrawal, so events map back to it. */
  createPayout(input: { accountId: string; amountCents: number; walletTxId: string }, idempotencyKey: string): Promise<{ id: string }>;
  reverseTransfer(transferId: string, idempotencyKey: string): Promise<void>;
  /** Verifies a webhook's signature against the raw request body. Throws when it doesn't match. */
  constructEvent(rawBody: string, signature: string): StripeEventInfo;
}

const summarizeSession = (s: Stripe.Checkout.Session): CheckoutSessionInfo => ({
  id: s.id,
  url: s.url ?? null,
  paymentStatus: s.payment_status as CheckoutSessionInfo['paymentStatus'],
  status: (s.status ?? 'open') as CheckoutSessionInfo['status'],
  amountTotalCents: s.amount_total ?? null,
  paymentIntentId: typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id ?? null,
  walletTxId: s.metadata?.walletTxId ?? s.client_reference_id ?? null,
});

/**
 * The real thing, over Stripe's SDK. Built from environment variables in main.ts:
 *   STRIPE_SECRET_KEY              sk_test_... (test mode) or sk_live_...
 *   STRIPE_WEBHOOK_SECRET          signing secret of the webhook endpoint for your account's events
 *   STRIPE_CONNECT_WEBHOOK_SECRET  signing secret of the endpoint for connected-account events (optional: same URL,
 *                                  a second endpoint in Stripe with "Listen to events on Connected accounts" ticked)
 */
export class LiveStripeGateway implements StripeGateway {
  private readonly stripe: Stripe;
  readonly testMode: boolean;

  constructor(secretKey: string, private readonly webhookSecrets: string[]) {
    this.stripe = new Stripe(secretKey);
    this.testMode = secretKey.startsWith('sk_test_') || secretKey.startsWith('rk_test_');
  }

  async createCheckoutSession(input: CheckoutSessionInput, idempotencyKey: string): Promise<CheckoutSessionInfo> {
    const line = (name: string, cents: number): Stripe.Checkout.SessionCreateParams.LineItem => ({
      quantity: 1, price_data: { currency: 'usd', unit_amount: cents, product_data: { name } },
    });
    const metadata = { walletTxId: input.walletTxId, orgId: input.orgId };
    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: [input.method === 'ach' ? 'us_bank_account' : 'card'],
      line_items: [line('Wallet deposit', input.amountCents), ...(input.feeCents > 0 ? [line('Processing fee', input.feeCents)] : [])],
      customer_email: input.customerEmail,
      client_reference_id: input.walletTxId,
      metadata,
      payment_intent_data: { metadata },
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
    }, { idempotencyKey });
    return summarizeSession(session);
  }

  async retrieveCheckoutSession(id: string): Promise<CheckoutSessionInfo> {
    return summarizeSession(await this.stripe.checkout.sessions.retrieve(id));
  }

  async createConnectAccount(input: { orgId: string; email: string; businessType: 'individual' | 'company' }, idempotencyKey: string): Promise<{ id: string }> {
    const account = await this.stripe.accounts.create({
      type: 'express',
      country: 'US',
      email: input.email,
      business_type: input.businessType,
      capabilities: { transfers: { requested: true } },
      // Bond decides when money leaves (one payout per withdrawal), so Stripe must not pay out on its own schedule.
      settings: { payouts: { schedule: { interval: 'manual' } } },
      metadata: { orgId: input.orgId },
    }, { idempotencyKey });
    return { id: account.id };
  }

  async createAccountLink(accountId: string, returnUrl: string, refreshUrl: string): Promise<{ url: string }> {
    const link = await this.stripe.accountLinks.create({ account: accountId, type: 'account_onboarding', return_url: returnUrl, refresh_url: refreshUrl });
    return { url: link.url };
  }

  async getConnectAccount(accountId: string): Promise<ConnectAccountInfo> {
    const a = await this.stripe.accounts.retrieve(accountId);
    const ext = a.external_accounts?.data?.[0] as { last4?: string; bank_name?: string | null } | undefined;
    return {
      id: a.id,
      payoutsEnabled: !!a.payouts_enabled,
      detailsSubmitted: !!a.details_submitted,
      bank: ext ? { last4: ext.last4 ?? null, name: ext.bank_name ?? null } : null,
    };
  }

  async createTransfer(input: { accountId: string; amountCents: number; walletTxId: string }, idempotencyKey: string): Promise<{ id: string }> {
    const t = await this.stripe.transfers.create(
      { amount: input.amountCents, currency: 'usd', destination: input.accountId, metadata: { walletTxId: input.walletTxId } },
      { idempotencyKey },
    );
    return { id: t.id };
  }

  async createPayout(input: { accountId: string; amountCents: number; walletTxId: string }, idempotencyKey: string): Promise<{ id: string }> {
    const p = await this.stripe.payouts.create(
      { amount: input.amountCents, currency: 'usd', metadata: { walletTxId: input.walletTxId } },
      { stripeAccount: input.accountId, idempotencyKey },
    );
    return { id: p.id };
  }

  async reverseTransfer(transferId: string, idempotencyKey: string): Promise<void> {
    await this.stripe.transfers.createReversal(transferId, {}, { idempotencyKey });
  }

  constructEvent(rawBody: string, signature: string): StripeEventInfo {
    let lastError: unknown = new Error('No webhook signing secret is configured');
    for (const secret of this.webhookSecrets) {
      try {
        const e = this.stripe.webhooks.constructEvent(rawBody, signature, secret);
        return { id: e.id, type: e.type, account: (e as { account?: string }).account ?? null, object: e.data.object as unknown as Record<string, unknown> };
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError;
  }
}
