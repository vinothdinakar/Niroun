// Client-side port of the Bond scoring + pricing model (see api/src/domain/scoring.ts and api/src/domain/pricing.ts
// in the API prototype). It powers the interactive calculator on the site.
//
// Simplifications, stated on the page too: every deal is ~$100, no time decay, and the
// deals were made with many different counterparties (so the per-counterparty cap never binds).
// TODO: replace with the shared `risk-core` package once the monorepo exists.

export type Category = 'digital_goods' | 'data' | 'physical_goods' | 'services' | 'other' | 'financial' | 'legal';
export type Verification = 0 | 1 | 2;
export type Tier = 'A' | 'B' | 'C' | 'D' | 'E' | 'NR';

export const CATEGORIES: Record<Category, { label: string; load: number }> = {
  digital_goods: { label: 'Digital goods', load: 0.8 },
  data: { label: 'Data', load: 0.9 },
  physical_goods: { label: 'Physical goods', load: 1.1 },
  services: { label: 'Services', load: 1.2 },
  other: { label: 'Other', load: 1.3 },
  financial: { label: 'Financial', load: 1.4 },
  legal: { label: 'Legal', load: 1.6 },
};

export const VERIFICATION_LABELS = ['Unverified', 'Owner verified', 'Fully verified (KYB)'] as const;

const PRIOR = { a: 9, b: 1 };
const K = 2;
const BONUS = [0, 25, 50];
const DISCOUNT = [0, 0.25, 0.4];
const LOADING = 1.5;
const MIN_RATE = 0.005;
export const MAX_PD = 0.35;
// Outcome weight for a ~$100 deal: log10(1 + cents / 1000)
const DEAL_WEIGHT = Math.log10(1 + 10_000 / 1000);

export function tierFor(score: number, outcomes: number): Tier {
  if (outcomes < 3) return 'NR';
  if (score >= 850) return 'A';
  if (score >= 700) return 'B';
  if (score >= 550) return 'C';
  if (score >= 400) return 'D';
  return 'E';
}

export function bondScore(fulfilled: number, faults: number, verification: Verification) {
  const a = PRIOR.a + fulfilled * DEAL_WEIGHT;
  const b = PRIOR.b + faults * DEAL_WEIGHT;
  const mean = a / (a + b);
  const sd = Math.sqrt((a * b) / ((a + b) ** 2 * (a + b + 1)));
  const raw = Math.round(1000 * (mean - K * sd)) + BONUS[verification];
  const score = Math.max(0, Math.min(1000, raw));
  return { score, tier: tierFor(score, fulfilled + faults), mean };
}

export interface QuoteInput {
  fulfilled: number;
  faults: number;
  verification: Verification;
  category: Category;
  amountUsd: number;
}

export function quote(input: QuoteInput) {
  const s = bondScore(input.fulfilled, input.faults, input.verification);
  const baseFaultProb = 1 - s.mean;
  const verificationDiscount = DISCOUNT[input.verification];
  const categoryLoad = CATEGORIES[input.category].load;
  const pd = Math.min(0.99, baseFaultProb * (1 - verificationDiscount) * categoryLoad);
  const amountCents = Math.round(input.amountUsd * 100);
  const sizeLoad = 1 + Math.min(0.5, amountCents / 20_000_000);
  const declined = pd > MAX_PD;
  const rate = Math.max(MIN_RATE, pd * LOADING * sizeLoad);
  const premiumUsd = declined ? 0 : Math.max(1, Math.ceil(amountCents * rate)) / 100;
  return { ...s, baseFaultProb, verificationDiscount, categoryLoad, sizeLoad, loading: LOADING, pd, declined, rate, premiumUsd };
}

export const usd = (n: number) =>
  '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const pct = (x: number, digits = 1) => (x * 100).toFixed(digits) + '%';
