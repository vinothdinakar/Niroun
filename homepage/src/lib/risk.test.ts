import { describe, it, expect } from 'vitest';
import { bondScore, quote, tierFor, MAX_PD } from './risk';

const base = { fulfilled: 0, faults: 0, verification: 0 as const, category: 'digital_goods' as const, amountUsd: 500 };

describe('bondScore', () => {
  it('matches the API prototype for a brand-new agent (prior 9/1, conservative bound)', () => {
    const s = bondScore(0, 0, 0);
    expect(s.score).toBe(719);
    expect(s.tier).toBe('NR');
  });

  it('rewards fulfilled deals, punishes faults, and adds the verification bonus', () => {
    const fresh = bondScore(0, 0, 0).score;
    expect(bondScore(60, 0, 0).score).toBeGreaterThan(fresh);
    expect(bondScore(10, 10, 0).score).toBeLessThan(fresh);
    expect(bondScore(0, 0, 2).score - fresh).toBe(50);
    expect(bondScore(0, 0, 1).score - fresh).toBe(25);
  });

  it('clamps to 0..1000', () => {
    expect(bondScore(100_000, 0, 2).score).toBeLessThanOrEqual(1000);
    expect(bondScore(0, 100_000, 0).score).toBeGreaterThanOrEqual(0);
  });

  it('assigns tiers at the documented thresholds', () => {
    expect(tierFor(850, 10)).toBe('A');
    expect(tierFor(849, 10)).toBe('B');
    expect(tierFor(700, 10)).toBe('B');
    expect(tierFor(550, 10)).toBe('C');
    expect(tierFor(400, 10)).toBe('D');
    expect(tierFor(399, 10)).toBe('E');
    expect(tierFor(999, 2)).toBe('NR');
  });
});

describe('quote', () => {
  it('prices a new unverified seller at ~$60 for a $500 digital deal', () => {
    // pd = (1 - 0.9) * 0.8 = 0.08; rate = 0.08 * 1.5 * 1.0025
    const q = quote(base);
    expect(q.declined).toBe(false);
    expect(q.premiumUsd).toBeCloseTo(60.15, 1);
  });

  it('is cheaper for proven, verified sellers', () => {
    const newbie = quote(base);
    const veteran = quote({ ...base, fulfilled: 120, faults: 3, verification: 2 });
    expect(veteran.premiumUsd).toBeLessThan(newbie.premiumUsd);
  });

  it('charges more for riskier categories', () => {
    expect(quote({ ...base, category: 'legal' }).premiumUsd).toBeGreaterThan(quote(base).premiumUsd);
  });

  it('declines serial defaulters as uninsurable', () => {
    const q = quote({ ...base, fulfilled: 5, faults: 15 });
    expect(q.declined).toBe(true);
    expect(q.pd).toBeGreaterThan(MAX_PD);
    expect(q.premiumUsd).toBe(0);
  });

  it('never prices below the 0.5% floor', () => {
    const q = quote({ ...base, fulfilled: 5000, faults: 0, verification: 2, amountUsd: 1000 });
    expect(q.rate).toBeGreaterThanOrEqual(0.005);
  });
});
