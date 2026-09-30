// The organization wallet's rules that don't depend on Stripe or the database: what a deposit costs, and the limits.
// All money is integer cents.

export type DepositMethod = 'card' | 'ach';
export const DEPOSIT_METHODS: DepositMethod[] = ['card', 'ach'];

export const MIN_AMOUNT_CENTS = 1_000; // $10, for deposits and withdrawals
export const MAX_DEPOSIT_CENTS = 2_500_000; // $25,000 in one deposit
export const DAILY_DEPOSIT_LIMIT_CENTS = 2_500_000; // in any rolling 24 hours
export const DAILY_WITHDRAWAL_LIMIT_CENTS = 1_000_000; // $10,000 in any rolling 24 hours
export const DAY_MS = 24 * 3_600_000;

// Stripe's published US prices at the time of writing: cards 2.9% + 30c; ACH debit 0.8% capped at $5.
// The customer pays them (the wallet is credited the full amount they chose), so the charge is grossed up: the fee
// is worked out so that charge - Stripe's cut = the amount. Change these if Stripe's prices change.
const CARD_RATE = 0.029;
const CARD_FIXED_CENTS = 30;
const ACH_RATE = 0.008;
const ACH_CAP_CENTS = 500;

export interface DepositQuote { amountCents: number; feeCents: number; chargeCents: number }

export function quoteDeposit(method: DepositMethod, amountCents: number): DepositQuote {
  let chargeCents: number;
  if (method === 'card') {
    chargeCents = Math.ceil((amountCents + CARD_FIXED_CENTS) / (1 - CARD_RATE));
  } else {
    const feeCents = Math.min(ACH_CAP_CENTS, Math.ceil((amountCents * ACH_RATE) / (1 - ACH_RATE)));
    chargeCents = amountCents + feeCents;
  }
  return { amountCents, feeCents: chargeCents - amountCents, chargeCents };
}

/** How the wallet's money moves. `hold` and `release` are for deals that reserve money from the wallet (not wired up yet). */
export type WalletTxType = 'deposit' | 'withdrawal' | 'hold' | 'release' | 'fee';
export type WalletTxStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'canceled';

/** Ledger entry types (the wallet's hash-chained log). */
export const LEDGER_DEPOSIT = 'wallet.deposit_credited';
export const LEDGER_WITHDRAWAL = 'wallet.withdrawal_debited';
export const LEDGER_WITHDRAWAL_REVERSED = 'wallet.withdrawal_reversed';
