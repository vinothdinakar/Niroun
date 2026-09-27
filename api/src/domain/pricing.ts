import { Category, PriceFactors, Verification } from '../storage/db.types';
import { ScoreResult } from './scoring';

// Premium = coverage x P(counterparty fault) x loading x size load, floored at 0.5%.
// P(fault) is the *posterior mean* fault rate (not the conservative score), adjusted
// for verification level and how loss-prone the transaction category is.

export const CATEGORIES: Record<Category, number> = {
  digital_goods: 0.8,
  data: 0.9,
  physical_goods: 1.1,
  services: 1.2,
  other: 1.3,
  financial: 1.4,
  legal: 1.6,
};
export const isCategory = (c: unknown): c is Category => typeof c === 'string' && c in CATEGORIES;

export const LOADING = 1.5; // expenses + profit margin over expected loss
export const MIN_RATE = 0.005;
export const MAX_PD = 0.35; // above this we decline: some risks aren't insurable at any price
export const QUOTE_TTL_MS = 10 * 60 * 1000;
export const VERIFY_DISCOUNT = [0, 0.25, 0.4];

export type PriceResult =
  | { declined: true; pd: number }
  | { declined: false; pd: number; rate: number; premiumCents: number; factors: PriceFactors };

export function priceQuote(input: {
  seller: { verification?: Verification };
  score: ScoreResult;
  amountCents: number;
  coverageCents: number;
  category: Category;
}): PriceResult {
  const { seller, score, amountCents, coverageCents, category } = input;
  const baseFaultProb = 1 - score.mean;
  const verificationDiscount = VERIFY_DISCOUNT[seller.verification || 0];
  const categoryLoad = CATEGORIES[category];
  const pd = Math.min(0.99, baseFaultProb * (1 - verificationDiscount) * categoryLoad);
  if (pd > MAX_PD) return { declined: true, pd };

  const sizeLoad = 1 + Math.min(0.5, amountCents / 20_000_000);
  const rate = Math.max(MIN_RATE, pd * LOADING * sizeLoad);
  return {
    declined: false,
    pd,
    rate,
    premiumCents: Math.max(1, Math.ceil(coverageCents * rate)),
    factors: { baseFaultProb, verificationDiscount, categoryLoad, sizeLoad, loading: LOADING },
  };
}
