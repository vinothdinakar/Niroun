import { Inject, Injectable, Logger } from '@nestjs/common';
import { MongoService } from '../storage/mongo.service';
import { newId } from '../storage/ids';
import { ClockService } from '../core/clock.service';
import { AuditService } from '../core/audit.service';
import { BOND_OPTIONS, BondOptions } from '../config/options';
import { HttpError, badRequest } from '../common/http-error';
import { User, WalletAccount, WalletTx } from '../storage/db.types';
import { buildEntry } from '../domain/ledger-chain';
import {
  DAILY_DEPOSIT_LIMIT_CENTS, DAILY_WITHDRAWAL_LIMIT_CENTS, DAY_MS, DEPOSIT_METHODS, DepositMethod, LEDGER_DEPOSIT,
  LEDGER_WITHDRAWAL, LEDGER_WITHDRAWAL_REVERSED, MAX_DEPOSIT_CENTS, MIN_AMOUNT_CENTS, quoteDeposit,
} from '../domain/wallet';
import { MfaService } from '../identity/mfa.service';
import { OrgsService } from '../identity/orgs.service';
import { CheckoutSessionInfo, StripeEventInfo, StripeGateway } from './stripe.gateway';

type Doc = Record<string, unknown>;
const fromDoc = (d: Doc): WalletTx => { const { _id, ...rest } = d; return { id: _id as string, ...rest } as unknown as WalletTx; };
const toDoc = (t: WalletTx): Doc => { const { id, ...rest } = t; return { _id: id, ...rest }; };
const accountFromDoc = (d: Doc): WalletAccount => { const { _id, ...rest } = d; return { id: _id as string, ...rest } as unknown as WalletAccount; };
const sum = (rows: WalletTx[]): number => rows.reduce((n, r) => n + r.amountCents, 0);
const LIVE: WalletTx['status'][] = ['pending', 'processing', 'completed'];

export type PayoutStatus = 'not_setup' | 'incomplete' | 'ready';

// The organization wallet: money the organization has put in through Stripe (deposits) and can take out through
// Stripe Connect (withdrawals), with every change to the balance written to a tamper-evident ledger.
//
//  - The balance is the last entry of the org's hash-chained ledger (`wallet_ledger`, the same chain the agents' logs
//    use). Two requests racing to change it collide on the entry's sequence number and one retries, so the balance can
//    never go negative or fork.
//  - `wallet_tx` is the friendly list: one document per deposit or withdrawal, with its lifecycle and Stripe ids.
//  - A deposit is credited only when Stripe says the money arrived (a signed webhook, or a check made on return from
//    Stripe). A withdrawal is debited the moment it is asked for, and put back if Stripe can't complete it.
//  - Every step that changes state is a compare-and-set on the status, so a repeated webhook does nothing twice.
@Injectable()
export class WalletService {
  private readonly log = new Logger('Wallet');

  constructor(
    private readonly mongo: MongoService,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
    private readonly orgs: OrgsService,
    private readonly mfa: MfaService,
    @Inject(BOND_OPTIONS) private readonly options: BondOptions,
  ) {}

  private get txs() { return this.mongo.col('wallet_tx'); }
  private get ledger() { return this.mongo.col('wallet_ledger'); }
  private get accounts() { return this.mongo.col('wallet_accounts'); }

  private get gateway(): StripeGateway {
    if (!this.options.stripe) throw new HttpError(503, 'WALLET_UNAVAILABLE', 'The wallet is not available yet: payments are not set up on this server');
    return this.options.stripe;
  }

  private orgIdOf(user: User): string {
    if (!user.orgId) throw new HttpError(404, 'NO_ORGANIZATION', 'This account does not belong to an organization');
    return user.orgId;
  }

  private dashboardUrl(query: string): string {
    return `${(this.options.publicUrl ?? 'http://localhost:3300').replace(/\/$/, '')}/organization?${query}#wallet`;
  }

  // ------------------------------------------------------------------------------------------------ reading

  async balanceOf(orgId: string): Promise<number> {
    const last = await this.ledger.findOne({ agentId: orgId }, { sort: { seq: -1 }, projection: { data: 1 }, ...this.mongo.tx });
    return ((last?.data as { balanceCents?: number } | undefined)?.balanceCents) ?? 0;
  }

  private async recent(orgId: string, type: WalletTx['type'], statuses: WalletTx['status'][], since = 0): Promise<WalletTx[]> {
    const docs = await this.txs.find({ orgId, type, status: { $in: statuses }, createdAt: { $gte: since } }, this.mongo.tx).toArray();
    return docs.map(fromDoc);
  }

  private payoutStatus(account: WalletAccount | null): PayoutStatus {
    return !account ? 'not_setup' : account.payoutsEnabled ? 'ready' : 'incomplete';
  }

  async summary(user: User): Promise<Doc> {
    if (!this.options.stripe) return { enabled: false };
    const orgId = this.orgIdOf(user);
    let account = await this.accountOf(orgId);
    // While onboarding is unfinished, ask Stripe (the webhook may not reach a laptop): the person just came back from it.
    if (account && !account.payoutsEnabled) account = (await this.syncAccount(orgId)) ?? account;
    const now = this.clock.now();
    const [available, inTransit, pendingDeposits, deposits24, withdrawals24] = await Promise.all([
      this.balanceOf(orgId),
      this.recent(orgId, 'withdrawal', ['processing']),
      this.recent(orgId, 'deposit', ['pending', 'processing']),
      this.recent(orgId, 'deposit', LIVE, now - DAY_MS),
      this.recent(orgId, 'withdrawal', LIVE, now - DAY_MS),
    ]);
    return {
      enabled: true,
      testMode: this.options.stripe.testMode,
      balance: { availableCents: available, heldCents: 0, inTransitCents: sum(inTransit), pendingDepositsCents: sum(pendingDeposits) },
      payouts: { status: this.payoutStatus(account), bank: account?.bank ?? null },
      limits: {
        minCents: MIN_AMOUNT_CENTS, maxDepositCents: MAX_DEPOSIT_CENTS,
        dailyDepositCents: DAILY_DEPOSIT_LIMIT_CENTS, usedDepositCents: sum(deposits24),
        dailyWithdrawalCents: DAILY_WITHDRAWAL_LIMIT_CENTS, usedWithdrawalCents: sum(withdrawals24),
      },
      twoStepEnabled: !!user.totp?.enabledAt,
    };
  }

  async list(user: User, q: { page?: number; pageSize?: number; type?: string; status?: string } = {}): Promise<{ rows: WalletTx[]; total: number }> {
    const orgId = this.orgIdOf(user);
    const filter: Doc = { orgId };
    if (q.type === 'deposit' || q.type === 'withdrawal') filter.type = q.type;
    else if (q.type === 'other') filter.type = { $in: ['hold', 'release', 'fee'] };
    if (q.status && ['pending', 'processing', 'completed', 'failed', 'canceled'].includes(q.status)) filter.status = q.status;
    const size = Math.min(100, Math.max(1, Number(q.pageSize) || 25));
    const page = Math.max(1, Number(q.page) || 1);
    const [docs, total] = await Promise.all([
      this.txs.find(filter, { sort: { createdAt: -1, _id: -1 }, skip: (page - 1) * size, limit: size }).toArray(),
      this.txs.countDocuments(filter),
    ]);
    return { rows: docs.map(fromDoc), total };
  }

  private async accountOf(orgId: string): Promise<WalletAccount | null> {
    const d = await this.accounts.findOne({ _id: orgId as never }, this.mongo.tx);
    return d ? accountFromDoc(d) : null;
  }

  // ------------------------------------------------------------------------------------------------ ledger

  /** Appends a signed amount to the org's ledger and returns the balance after it. Call inside a transaction. */
  private async append(orgId: string, type: string, walletTxId: string, signedCents: number): Promise<number> {
    const last = await this.ledger.findOne({ agentId: orgId }, { sort: { seq: -1 }, projection: { seq: 1, hash: 1, data: 1 }, ...this.mongo.tx });
    const before = ((last?.data as { balanceCents?: number } | undefined)?.balanceCents) ?? 0;
    const after = before + signedCents;
    if (after < 0) throw new HttpError(409, 'INSUFFICIENT_FUNDS', 'Your available balance is too low for this withdrawal');
    // `agentId` is the ledger entry's owner: for the wallet, the organization.
    const entry = buildEntry(last ? { seq: last.seq as number, hash: last.hash as string } : null, {
      agentId: orgId, txId: walletTxId, type, data: { amountCents: signedCents, balanceCents: after }, ts: this.clock.now(),
    });
    await this.ledger.insertOne({ _id: `${orgId}:${entry.seq}` as never, ...entry }, this.mongo.tx);
    return after;
  }

  // ------------------------------------------------------------------------------------------------ deposits

  private checkAmount(amount: unknown, kind: 'deposit' | 'withdrawal'): number {
    if (typeof amount !== 'number' || !Number.isInteger(amount)) throw badRequest('INVALID_AMOUNT', 'amountCents must be a whole number of cents');
    if (amount < MIN_AMOUNT_CENTS) throw badRequest('AMOUNT_TOO_SMALL', 'The minimum is $10.00');
    if (kind === 'deposit' && amount > MAX_DEPOSIT_CENTS) throw badRequest('AMOUNT_TOO_LARGE', 'The most you can deposit at once is $25,000.00');
    return amount;
  }

  async createDeposit(user: User, input: Doc): Promise<{ id: string; url: string }> {
    const gateway = this.gateway;
    const orgId = this.orgIdOf(user);
    const amountCents = this.checkAmount(input.amountCents, 'deposit');
    if (!DEPOSIT_METHODS.includes(input.method as DepositMethod)) throw badRequest('INVALID_METHOD', 'method must be "card" or "ach"');
    const method = input.method as DepositMethod;
    const used = sum(await this.recent(orgId, 'deposit', LIVE, this.clock.now() - DAY_MS));
    if (used + amountCents > DAILY_DEPOSIT_LIMIT_CENTS) throw new HttpError(409, 'DAILY_LIMIT', 'This would go over your daily deposit limit of $25,000.00');

    const { feeCents, chargeCents } = quoteDeposit(method, amountCents);
    const now = this.clock.now();
    const tx: WalletTx = {
      id: newId('wtx'), orgId, type: 'deposit', status: 'pending', amountCents, feeCents, chargeCents, method,
      description: method === 'card' ? 'Deposit by card' : 'Deposit by bank transfer (ACH)',
      createdBy: user.id, createdAt: now, updatedAt: now, balanceAfterCents: null, stripe: {},
    };
    await this.mongo.transaction(async () => {
      await this.txs.insertOne(toDoc(tx), this.mongo.tx);
      await this.audit.record(user, 'wallet.deposit_started', tx.id, { orgId, amountCents, method });
    });
    try {
      const session = await gateway.createCheckoutSession({
        walletTxId: tx.id, orgId, method, amountCents, feeCents, customerEmail: user.email,
        successUrl: this.dashboardUrl(`wallet=success&tx=${tx.id}`), cancelUrl: this.dashboardUrl(`wallet=cancelled&tx=${tx.id}`),
      }, `dep_${tx.id}`);
      if (!session.url) throw new Error('Stripe returned no checkout address');
      await this.txs.updateOne({ _id: tx.id as never }, { $set: { 'stripe.sessionId': session.id, updatedAt: this.clock.now() } });
      return { id: tx.id, url: session.url };
    } catch (e) {
      this.log.error(`could not start deposit ${tx.id}: ${(e as Error).message}`);
      await this.txs.updateOne({ _id: tx.id as never, status: 'pending' }, { $set: { status: 'failed', failureReason: 'Could not reach Stripe', updatedAt: this.clock.now() } });
      throw new HttpError(502, 'STRIPE_ERROR', 'We could not start the payment with Stripe. Please try again.');
    }
  }

  /** The person came back from Stripe: check on their deposit now instead of waiting for the webhook. */
  async syncDeposit(user: User, txId: string): Promise<WalletTx> {
    const gateway = this.gateway;
    const orgId = this.orgIdOf(user);
    const doc = await this.txs.findOne({ _id: txId as never, orgId });
    if (!doc) throw new HttpError(404, 'TRANSACTION_NOT_FOUND', 'Unknown transaction');
    const tx = fromDoc(doc);
    if (tx.type === 'deposit' && (tx.status === 'pending' || tx.status === 'processing') && tx.stripe.sessionId) {
      await this.applySession(await gateway.retrieveCheckoutSession(tx.stripe.sessionId), 'sync');
    }
    return fromDoc((await this.txs.findOne({ _id: txId as never })) as Doc);
  }

  private sessionOf(o: Doc): CheckoutSessionInfo {
    const meta = (o.metadata ?? {}) as Record<string, string>;
    const pi = o.payment_intent;
    return {
      id: String(o.id), url: (o.url as string) ?? null,
      paymentStatus: (o.payment_status as CheckoutSessionInfo['paymentStatus']) ?? 'unpaid',
      status: (o.status as CheckoutSessionInfo['status']) ?? 'open',
      amountTotalCents: typeof o.amount_total === 'number' ? o.amount_total : null,
      paymentIntentId: typeof pi === 'string' ? pi : (pi as { id?: string } | null)?.id ?? null,
      walletTxId: meta.walletTxId ?? (o.client_reference_id as string) ?? null,
    };
  }

  /**
   * Applies what Stripe says about a checkout session to our deposit. `signal` is which event told us:
   * 'sync' and 'completed' read the session's own state; the async ones are the outcome of a bank debit that was clearing.
   */
  private async applySession(s: CheckoutSessionInfo, signal: 'sync' | 'completed' | 'async_succeeded' | 'async_failed' | 'expired'): Promise<void> {
    const doc = s.walletTxId ? await this.txs.findOne({ _id: s.walletTxId as never }) : await this.txs.findOne({ 'stripe.sessionId': s.id });
    if (!doc) return;
    const tx = fromDoc(doc);
    if (tx.type !== 'deposit' || (tx.status !== 'pending' && tx.status !== 'processing')) return; // already settled: a repeat does nothing
    if (s.amountTotalCents !== null && s.amountTotalCents !== tx.chargeCents) {
      await this.audit.record(null, 'wallet.deposit_amount_mismatch', tx.id, { expected: tx.chargeCents, got: s.amountTotalCents });
      this.log.error(`deposit ${tx.id}: Stripe says ${s.amountTotalCents}, expected ${tx.chargeCents}; not credited`);
      return;
    }
    if (signal === 'async_failed') return this.settle(tx, { status: 'failed', reason: 'The bank transfer did not go through' });
    if (signal === 'expired' || (signal === 'sync' && s.status === 'expired')) return this.settle(tx, { status: 'canceled', reason: 'The payment page was not completed' });
    if (signal === 'async_succeeded' || s.paymentStatus === 'paid') return this.settle(tx, { status: 'completed', paymentIntentId: s.paymentIntentId });
    if (s.status === 'complete' && tx.status === 'pending') return this.settle(tx, { status: 'processing', paymentIntentId: s.paymentIntentId }); // a bank debit that is still clearing
  }

  private async settle(tx: WalletTx, to: { status: WalletTx['status']; reason?: string; paymentIntentId?: string | null }): Promise<void> {
    await this.mongo.transaction(async () => {
      const set: Doc = { status: to.status, updatedAt: this.clock.now() };
      if (to.reason) set.failureReason = to.reason;
      if (to.paymentIntentId) set['stripe.paymentIntentId'] = to.paymentIntentId;
      // compare-and-set: only the caller that moves it out of pending/processing gets to credit it
      const won = await this.txs.updateOne({ _id: tx.id as never, status: { $in: ['pending', 'processing'] } }, { $set: set }, this.mongo.tx);
      if (!won.matchedCount) return;
      if (to.status === 'completed') {
        const balance = await this.append(tx.orgId, LEDGER_DEPOSIT, tx.id, tx.amountCents);
        await this.txs.updateOne({ _id: tx.id as never }, { $set: { balanceAfterCents: balance } }, this.mongo.tx);
      }
      await this.audit.record(null, `wallet.deposit_${to.status}`, tx.id, { orgId: tx.orgId, amountCents: tx.amountCents });
    });
  }

  // ------------------------------------------------------------------------------------------------ payouts (Stripe Connect)

  private async syncAccount(orgId: string): Promise<WalletAccount | null> {
    const account = await this.accountOf(orgId);
    if (!account) return null;
    try {
      const info = await this.gateway.getConnectAccount(account.stripeAccountId);
      const next = { payoutsEnabled: info.payoutsEnabled, detailsSubmitted: info.detailsSubmitted, bank: info.bank ?? account.bank, updatedAt: this.clock.now() };
      await this.accounts.updateOne({ _id: orgId as never }, { $set: next });
      return { ...account, ...next };
    } catch (e) {
      this.log.warn(`could not refresh the Stripe account for ${orgId}: ${(e as Error).message}`);
      return account;
    }
  }

  /** Starts (or resumes) Stripe's onboarding for this organization; returns the page to send the person to. */
  async startPayoutSetup(user: User): Promise<{ url: string }> {
    const gateway = this.gateway;
    const orgId = this.orgIdOf(user);
    let account = await this.accountOf(orgId);
    if (!account) {
      const org = await this.orgs.orThrow(orgId);
      let created: { id: string };
      try {
        created = await gateway.createConnectAccount({ orgId, email: user.email, businessType: org.accountType === 'individual' ? 'individual' : 'company' }, `acct_${orgId}`);
      } catch (e) {
        this.log.error(`could not create a Stripe account for ${orgId}: ${(e as Error).message}`);
        throw new HttpError(502, 'STRIPE_ERROR', 'We could not reach Stripe. Please try again.');
      }
      const now = this.clock.now();
      account = { id: orgId, orgId, stripeAccountId: created.id, payoutsEnabled: false, detailsSubmitted: false, bank: null, createdAt: now, updatedAt: now };
      const { id, ...rest } = account;
      await this.mongo.transaction(async () => {
        await this.accounts.insertOne({ _id: id as never, ...rest }, this.mongo.tx);
        await this.audit.record(user, 'wallet.payout_account_created', orgId, { stripeAccountId: created.id });
      });
    }
    try {
      const link = await gateway.createAccountLink(account.stripeAccountId, this.dashboardUrl('wallet=payouts'), this.dashboardUrl('wallet=payouts-retry'));
      return { url: link.url };
    } catch (e) {
      this.log.error(`could not open Stripe onboarding for ${orgId}: ${(e as Error).message}`);
      throw new HttpError(502, 'STRIPE_ERROR', 'We could not reach Stripe. Please try again.');
    }
  }

  // ------------------------------------------------------------------------------------------------ withdrawals

  async withdraw(user: User, input: Doc): Promise<WalletTx> {
    const gateway = this.gateway;
    const orgId = this.orgIdOf(user);
    const amountCents = this.checkAmount(input.amountCents, 'withdrawal');
    if (!user.totp?.enabledAt) throw new HttpError(409, 'TWO_STEP_REQUIRED', 'Turn on two-step verification in your account before you withdraw');
    let account = await this.accountOf(orgId);
    if (account && !account.payoutsEnabled) account = await this.syncAccount(orgId);
    if (!account || !account.payoutsEnabled) throw new HttpError(409, 'PAYOUTS_NOT_READY', 'Finish setting up payouts with Stripe before you withdraw');
    const used = sum(await this.recent(orgId, 'withdrawal', LIVE, this.clock.now() - DAY_MS));
    if (used + amountCents > DAILY_WITHDRAWAL_LIMIT_CENTS) throw new HttpError(409, 'DAILY_LIMIT', 'This would go over your daily withdrawal limit of $10,000.00');
    if (amountCents > (await this.balanceOf(orgId))) throw new HttpError(409, 'INSUFFICIENT_FUNDS', 'Your available balance is too low for this withdrawal'); // before the code is spent
    await this.mfa.confirmCode(user, input.code); // last check before money moves: a stolen session alone can't withdraw

    const now = this.clock.now();
    const tx: WalletTx = {
      id: newId('wtx'), orgId, type: 'withdrawal', status: 'processing', amountCents, feeCents: 0, chargeCents: 0, method: 'bank',
      description: account.bank?.last4 ? `Withdrawal to bank account •••• ${account.bank.last4}` : 'Withdrawal to your bank account',
      createdBy: user.id, createdAt: now, updatedAt: now, balanceAfterCents: null, stripe: { accountId: account.stripeAccountId },
    };
    // The debit and the record are one atomic step, so the money is reserved before Stripe is asked to send it.
    await this.mongo.transaction(async () => {
      tx.balanceAfterCents = await this.append(orgId, LEDGER_WITHDRAWAL, tx.id, -amountCents);
      await this.txs.insertOne(toDoc(tx), this.mongo.tx);
      await this.audit.record(user, 'wallet.withdrawal_started', tx.id, { orgId, amountCents });
    });

    let transferId: string | null = null;
    try {
      transferId = (await gateway.createTransfer({ accountId: account.stripeAccountId, amountCents, walletTxId: tx.id }, `wd_t_${tx.id}`)).id;
      await this.txs.updateOne({ _id: tx.id as never }, { $set: { 'stripe.transferId': transferId } });
      const payout = await gateway.createPayout({ accountId: account.stripeAccountId, amountCents, walletTxId: tx.id }, `wd_p_${tx.id}`);
      await this.txs.updateOne({ _id: tx.id as never }, { $set: { 'stripe.payoutId': payout.id, updatedAt: this.clock.now() } });
    } catch (e) {
      this.log.error(`withdrawal ${tx.id} failed at Stripe: ${(e as Error).message}`);
      await this.failWithdrawal(tx.id, 'Stripe could not send the money', transferId);
      throw new HttpError(502, 'STRIPE_ERROR', 'Stripe could not send this withdrawal. Nothing was taken from your balance.');
    }
    return fromDoc((await this.txs.findOne({ _id: tx.id as never })) as Doc);
  }

  /** The withdrawal did not happen: put the money back on the ledger, and pull it back from Stripe if it had already moved. */
  private async failWithdrawal(txId: string, reason: string, transferId: string | null): Promise<void> {
    const reversed = await this.mongo.transaction(async () => {
      const won = await this.txs.updateOne({ _id: txId as never, type: 'withdrawal', status: 'processing' }, { $set: { status: 'failed', failureReason: reason, updatedAt: this.clock.now() } }, this.mongo.tx);
      if (!won.matchedCount) return false; // already settled one way or the other
      const doc = fromDoc((await this.txs.findOne({ _id: txId as never }, this.mongo.tx)) as Doc);
      await this.append(doc.orgId, LEDGER_WITHDRAWAL_REVERSED, txId, doc.amountCents);
      await this.audit.record(null, 'wallet.withdrawal_failed', txId, { orgId: doc.orgId, amountCents: doc.amountCents, reason });
      return true;
    });
    if (reversed && transferId && this.options.stripe) {
      try {
        await this.options.stripe.reverseTransfer(transferId, `wd_r_${txId}`);
      } catch (e) {
        this.log.error(`withdrawal ${txId}: the balance was restored but reversing transfer ${transferId} at Stripe failed (${(e as Error).message}); do it by hand`);
      }
    }
  }

  // ------------------------------------------------------------------------------------------------ webhooks

  /** One verified event from Stripe. Unknown kinds are ignored; known ones are safe to receive twice. */
  async handleEvent(e: StripeEventInfo): Promise<void> {
    switch (e.type) {
      case 'checkout.session.completed': return this.applySession(this.sessionOf(e.object), 'completed');
      case 'checkout.session.async_payment_succeeded': return this.applySession(this.sessionOf(e.object), 'async_succeeded');
      case 'checkout.session.async_payment_failed': return this.applySession(this.sessionOf(e.object), 'async_failed');
      case 'checkout.session.expired': return this.applySession(this.sessionOf(e.object), 'expired');
      case 'payout.paid':
      case 'payout.failed':
      case 'payout.canceled': return this.applyPayout(e);
      case 'account.updated': {
        const orgId = ((e.object.metadata ?? {}) as Record<string, string>).orgId;
        if (orgId) await this.syncAccount(orgId);
        return;
      }
      default: return;
    }
  }

  private async applyPayout(e: StripeEventInfo): Promise<void> {
    const walletTxId = ((e.object.metadata ?? {}) as Record<string, string>).walletTxId;
    if (!walletTxId) return; // not one of ours
    const doc = await this.txs.findOne({ _id: walletTxId as never });
    if (!doc) return;
    const tx = fromDoc(doc);
    if (tx.type !== 'withdrawal' || tx.stripe.accountId !== e.account) return; // wrong account: never act on it
    if (e.type === 'payout.paid') {
      await this.mongo.transaction(async () => {
        const won = await this.txs.updateOne({ _id: tx.id as never, status: 'processing' }, { $set: { status: 'completed', updatedAt: this.clock.now() } }, this.mongo.tx);
        if (won.matchedCount) await this.audit.record(null, 'wallet.withdrawal_completed', tx.id, { orgId: tx.orgId, amountCents: tx.amountCents });
      });
      return;
    }
    await this.failWithdrawal(tx.id, (e.object.failure_message as string) || 'The bank did not accept the payout', tx.stripe.transferId ?? null);
  }
}
