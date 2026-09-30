import type { WalletTx } from './types';

export type DepositMethod = 'card' | 'ach';

// What a deposit costs the customer, worked out so the wallet is credited exactly the amount chosen. This is the same
// arithmetic as the API's domain/wallet.ts (which is what actually charges); it is here so the fee can be shown while
// someone types. If Stripe's prices change, change both (the tests pin a few values on each side).
const CARD_RATE = 0.029;
const CARD_FIXED_CENTS = 30;
const ACH_RATE = 0.008;
const ACH_CAP_CENTS = 500;

export function quoteDeposit(method: DepositMethod, amountCents: number): { feeCents: number; chargeCents: number } {
  let chargeCents: number;
  if (method === 'card') {
    chargeCents = Math.ceil((amountCents + CARD_FIXED_CENTS) / (1 - CARD_RATE));
  } else {
    chargeCents = amountCents + Math.min(ACH_CAP_CENTS, Math.ceil((amountCents * ACH_RATE) / (1 - ACH_RATE)));
  }
  return { feeCents: chargeCents - amountCents, chargeCents };
}

/** "5,000.00", "5000" or "$5,000" as whole cents; null when it isn't a money amount. */
export function parseDollars(text: string): number | null {
  const clean = text.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) return null;
  return Math.round(parseFloat(clean) * 100);
}

export const TX_TYPE_LABEL: Record<WalletTx['type'], string> = {
  deposit: 'Deposit', withdrawal: 'Withdrawal', hold: 'Deal hold', release: 'Hold released', fee: 'Fee',
};
export const TX_STATUS: Record<WalletTx['status'], [label: string, color: string]> = {
  completed: ['Completed', 'green'],
  processing: ['Processing', 'amber'],
  pending: ['Waiting for payment', 'amber'],
  failed: ['Failed', 'red'],
  canceled: ['Cancelled', 'gray'],
};
/** Money into the wallet is positive, out is negative. */
export const txSign = (t: WalletTx): 1 | -1 => (t.type === 'deposit' || t.type === 'release' ? 1 : -1);
