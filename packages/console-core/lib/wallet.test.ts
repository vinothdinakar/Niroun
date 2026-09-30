import { describe, expect, it } from 'vitest';
import { parseDollars, quoteDeposit, txSign } from './wallet';

describe('quoteDeposit (must match the API\'s domain/wallet.ts)', () => {
  // The same numbers are asserted in api/test/wallet.test.mjs: if one side's prices change, both tests must.
  it('charges the customer Stripe\'s cut so the wallet gets the full amount', () => {
    expect(quoteDeposit('card', 1_000)).toEqual({ feeCents: 61, chargeCents: 1_061 });
    expect(quoteDeposit('card', 500_000)).toEqual({ feeCents: 14_964, chargeCents: 514_964 });
    expect(quoteDeposit('ach', 50_000)).toEqual({ feeCents: 404, chargeCents: 50_404 });
    expect(quoteDeposit('ach', 500_000)).toEqual({ feeCents: 500, chargeCents: 500_500 }); // capped at $5
  });
});

describe('parseDollars', () => {
  it('reads money the way people type it', () => {
    expect(parseDollars('5000')).toBe(500_000);
    expect(parseDollars('$5,000.50')).toBe(500_050);
    expect(parseDollars(' 12.3 ')).toBe(1_230);
    expect(parseDollars('0.99')).toBe(99);
  });
  it('refuses anything that is not an amount', () => {
    for (const bad of ['', 'abc', '-5', '1.234', '1e3', '$', '5.5.5']) expect(parseDollars(bad), bad).toBeNull();
  });
});

describe('txSign', () => {
  it('is positive for money in and negative for money out', () => {
    expect(txSign({ type: 'deposit' } as never)).toBe(1);
    expect(txSign({ type: 'release' } as never)).toBe(1);
    expect(txSign({ type: 'withdrawal' } as never)).toBe(-1);
    expect(txSign({ type: 'hold' } as never)).toBe(-1);
    expect(txSign({ type: 'fee' } as never)).toBe(-1);
  });
});
